/**
 * backend/src/services/session/TestSessionService.ts
 *
 * P0 FIXES applied here:
 *   1. Remove 'public' user fallback — every session requires a real userId
 *   2. approved_test_cases is authoritative — execution blocked without it
 *   3. listSessions() SQL ordering fixed — newest first (ORDER BY updated_at DESC)
 *   4. getSession() restores from DB on cache miss (survives backend restart)
 *   5. Cross-user isolation — getSession() filters by userId
 *
 * This file replaces the session-related methods scattered across
 * TestingWorkflowController.ts and TestSessionCacheService.ts.
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type { JiraTicket, TestCase, TestResult, ExecutionSummary } from '../types';

// ─── types ────────────────────────────────────────────────────────────────────
export type SessionPhase =
  | 'created' | 'discovery' | 'scenarios' | 'generation'
  | 'approved' | 'executing' | 'completed' | 'failed';

export interface ScenarioSeed {
  id: string;
  title: string;
  label?: string;
  tag?: string;
  selected?: boolean;
  source?: string;
}

export interface TestSession {
  id: string;
  ticketId: string;
  userId: string;               // NEVER 'public' — real user UUID
  phase: SessionPhase;
  ticket: JiraTicket | null;
  scenarios: ScenarioSeed[];     // Seeded scenario objects ({id,title,tag,...})
  testCases: TestCase[];
  approvedTestCases: boolean;    // Authoritative — must be true before execute
  compiledScripts: Record<string, string>; // caseId → .spec.ts content
  results: TestResult[];
  summary: ExecutionSummary | null;
  iterationCount: number;
  confidenceAssessment: Record<string, unknown> | null;
  executionLock: boolean;        // Prevents double-execution
  artifactsPath?: string;        // Path to zipped artifacts bundle (set after execution)
  createdAt: Date;
  updatedAt: Date;
}

// ─── in-memory cache (DB is source of truth) ─────────────────────────────────
const _cache = new Map<string, TestSession>();

// ─── helpers ──────────────────────────────────────────────────────────────────
function cacheKey(ticketId: string, userId: string): string {
  return `${ticketId}::${userId}`;
}

/**
 * Tolerate both jsonb (auto-parsed to object by pg) and plain text columns.
 * Raw strings go through JSON.parse; anything else is returned as-is.
 * Bad data (e.g. a legacy row with "[object Object]" written via a previous
 * double-stringify bug) falls back to the default instead of throwing.
 */
function parseJsonColumn<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return fallback;
}

function rowToSession(row: Record<string, unknown>): TestSession {
  return {
    id: String(row.id),
    ticketId: String(row.ticket_id),
    userId: String(row.user_id),
    phase: String(row.phase || 'created') as SessionPhase,
    ticket: parseJsonColumn(row.ticket_data, null),
    scenarios: parseJsonColumn(row.scenarios, [] as any[]),
    testCases: parseJsonColumn(row.test_cases, [] as any[]),
    approvedTestCases: Boolean(row.approved_test_cases),
    compiledScripts: parseJsonColumn(row.compiled_scripts, {} as Record<string, string>),
    results: parseJsonColumn(row.results, [] as any[]),
    summary: parseJsonColumn(row.summary, null),
    iterationCount: Number(row.iteration_count) || 0,
    confidenceAssessment: parseJsonColumn(row.confidence_assessment, null),
    executionLock: Boolean(row.is_running),
    artifactsPath: row.artifacts_path ? String(row.artifacts_path) : undefined,
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

// ─── TestSessionService ───────────────────────────────────────────────────────
export class TestSessionService {
  constructor(private pool: Pool) {
    // P0 FIX: Auto-clear stale locks on startup (crash recovery)
    this.cleanupStaleLocks().catch(err => {
      // eslint-disable-next-line no-console
      console.error(`[TestSessionService] Failed to cleanup stale locks: ${err.message}`);
    });
  }

  /**
   * P0 FIX: Force-clear is_running lock if it's been stuck for > 2 hours (crash recovery).
   * Prevents "Execution already in progress" error after a backend crash.
   */
  async cleanupStaleLocks(): Promise<number> {
    const STALE_TIMEOUT_HOURS = 2;
    const res = await this.pool.query(
      `UPDATE test_sessions
       SET is_running = false, updated_at = NOW()
       WHERE is_running = true
         AND updated_at < NOW() - ($1 * interval '1 hour')`,
      [STALE_TIMEOUT_HOURS]
    );
    const count = res.rowCount || 0;
    if (count > 0) {
      // eslint-disable-next-line no-console
      console.log(`[TestSessionService] ✓ Force-cleared ${count} stale execution lock(s)`);
      // Note: we don't need to clear _cache because this runs on startup
      // when _cache is already empty.
    }
    return count;
  }

  /**
   * P0 FIX: userId is required — no 'public' fallback.
   * Caller must pass a verified userId from req.user.id.
   * Throws if userId is missing or is the legacy 'public' value.
   */
  private assertRealUser(userId: string): void {
    if (!userId || userId === 'public') {
      throw Object.assign(
        new Error('Authenticated user required. Anonymous access to test sessions is not permitted.'),
        { statusCode: 401 }
      );
    }
  }

  /**
   * Create a new session for a ticket.
   * If one already exists for this (ticketId, userId) pair, return the existing one.
   */
  async createOrGet(ticketId: string, userId: string): Promise<TestSession> {
    this.assertRealUser(userId);

    // Check cache first
    const key = cacheKey(ticketId, userId);
    if (_cache.has(key)) return _cache.get(key)!;

    // Check DB
    const existing = await this.getFromDb(ticketId, userId);
    if (existing) {
      _cache.set(key, existing);
      return existing;
    }

    // Create new
    const id = uuidv4();
    const now = new Date();
    const session: TestSession = {
      id, ticketId, userId,
      phase: 'created',
      ticket: null, scenarios: [], testCases: [],
      approvedTestCases: false,
      compiledScripts: {}, results: [], summary: null,
      iterationCount: 0, confidenceAssessment: null,
      executionLock: false,
      createdAt: now, updatedAt: now,
    };

    await this.pool.query(
      `INSERT INTO test_sessions
         (id, ticket_id, user_id, phase, ticket_data, scenarios, test_cases,
          approved_test_cases, compiled_scripts, results, summary,
          iteration_count, confidence_assessment, is_running, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        id, ticketId, userId, 'created',
        JSON.stringify(null), JSON.stringify([]), JSON.stringify([]),
        false, JSON.stringify({}), JSON.stringify([]), JSON.stringify(null),
        0, JSON.stringify(null), false, now, now,
      ]
    );

    _cache.set(key, session);
    return session;
  }

  /**
   * Get a session — restores from DB if not in cache (survives backend restart).
   * P0 FIX: filters by userId so users cannot access each other's sessions.
   */
  async get(ticketId: string, userId: string): Promise<TestSession | null> {
    this.assertRealUser(userId);

    const key = cacheKey(ticketId, userId);
    if (_cache.has(key)) return _cache.get(key)!;

    const session = await this.getFromDb(ticketId, userId);
    if (session) _cache.set(key, session);
    return session;
  }

  private async getFromDb(ticketId: string, userId: string): Promise<TestSession | null> {
    const res = await this.pool.query(
      `SELECT * FROM test_sessions
       WHERE ticket_id = $1 AND user_id = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [ticketId, userId]
    );
    if (res.rows.length === 0) return null;
    return rowToSession(res.rows[0]);
  }

  /**
   * Update session fields and persist to DB.
   * Always updates updated_at.
   */
  async update(ticketId: string, userId: string, patch: Partial<TestSession>): Promise<TestSession> {
    this.assertRealUser(userId);

    const session = await this.get(ticketId, userId);
    if (!session) throw Object.assign(new Error(`Session not found: ${ticketId}`), { statusCode: 404 });

    const updated: TestSession = { ...session, ...patch, updatedAt: new Date() };
    _cache.set(cacheKey(ticketId, userId), updated);

    await this.pool.query(
      `UPDATE test_sessions SET
         phase               = $1,
         ticket_data         = $2,
         scenarios           = $3,
         test_cases          = $4,
         approved_test_cases = $5,
         compiled_scripts    = $6,
         results             = $7,
         summary             = $8,
         iteration_count     = $9,
         confidence_assessment = $10,
         is_running          = $11,
         artifacts_path      = $12,
         updated_at          = $13
       WHERE ticket_id = $14 AND user_id = $15`,
      [
        updated.phase,
        JSON.stringify(updated.ticket),
        JSON.stringify(updated.scenarios),
        JSON.stringify(updated.testCases),
        updated.approvedTestCases,
        JSON.stringify(updated.compiledScripts),
        JSON.stringify(updated.results),
        JSON.stringify(updated.summary),
        updated.iterationCount,
        JSON.stringify(updated.confidenceAssessment),
        updated.executionLock,
        updated.artifactsPath ?? null,
        updated.updatedAt,
        ticketId,
        userId,
      ]
    );

    return updated;
  }

  /**
   * P0 FIX: List sessions for a user — ORDER BY updated_at DESC (newest first).
   * Was: unordered or oldest first.
   */
  async list(userId: string): Promise<TestSession[]> {
    this.assertRealUser(userId);

    const res = await this.pool.query(
      `SELECT * FROM test_sessions
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 50`,
      [userId]
    );
    return res.rows.map(rowToSession);
  }

  /**
   * P0 FIX: Approve test cases — explicit, authoritative.
   * After this, the session.approvedTestCases = true.
   * Execution service checks this before running.
   */
  async approve(ticketId: string, userId: string): Promise<TestSession> {
    const session = await this.get(ticketId, userId);
    if (!session) throw Object.assign(new Error(`Session not found: ${ticketId}`), { statusCode: 404 });
    if (session.testCases.length === 0) {
      throw Object.assign(new Error('No test cases to approve. Generate test cases first.'), { statusCode: 400 });
    }
    return this.update(ticketId, userId, { approvedTestCases: true, phase: 'approved' });
  }

  /**
   * P0 FIX: Execution guard — blocks unapproved execution.
   * Called by TestingExecutionOrchestrator before spawning Playwright.
   */
  assertApproved(session: TestSession): void {
    if (!session.approvedTestCases) {
      throw Object.assign(
        new Error('Test cases must be approved before execution. Call POST /approve first.'),
        { statusCode: 409 }
      );
    }
    if (session.testCases.length === 0) {
      throw Object.assign(
        new Error('No test cases in session. Generate test cases first.'),
        { statusCode: 409 }
      );
    }
  }

  /**
   * Acquire execution lock — prevents double-execution on the same session.
   * Returns false if lock is already held.
   */
  async acquireLock(ticketId: string, userId: string): Promise<boolean> {
    const session = await this.get(ticketId, userId);
    if (!session) return false;
    if (session.executionLock) return false;
    await this.update(ticketId, userId, { executionLock: true });
    return true;
  }

  async releaseLock(ticketId: string, userId: string): Promise<void> {
    const session = await this.get(ticketId, userId);
    if (!session) return;
    await this.update(ticketId, userId, { executionLock: false });
  }

  /** Invalidate cache entry (force DB reload on next get) */
  invalidateCache(ticketId: string, userId: string): void {
    _cache.delete(cacheKey(ticketId, userId));
  }

  /** Delete session from DB and cache */
  async delete(ticketId: string, userId: string): Promise<void> {
    this.assertRealUser(userId);
    _cache.delete(cacheKey(ticketId, userId));
    await this.pool.query(
      'DELETE FROM test_sessions WHERE ticket_id = $1 AND user_id = $2',
      [ticketId, userId]
    );
  }
}
