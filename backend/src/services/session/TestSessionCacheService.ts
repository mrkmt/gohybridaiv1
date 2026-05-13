/**
 * TestSessionCacheService
 *
 * Hybrid session cache: PostgreSQL as source of truth with optional in-memory cache.
 * Multi-user: sessions are scoped by (ticket_id, user_id).
 */
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { TestCase } from '../generation/TestCaseGeneratorService';
import type { TestResult, TestEnvironment } from '../execution/TestExecutionService';
import type { TestGenerationResult } from '../../engine/AIBrainEngine';
import { DbClient, TelemetryService } from '../shared/TelemetryService';

export interface UserScenario {
    id: string;
    description: string;
    source: 'user' | 'ai';
    createdAt: string;
    selected: boolean;
}

/**
 * Confidence assessment attached to a generated test session.
 * Provides transparency into AI generation quality for operator review.
 * Omits the `code` field (stored in compiledScripts) to keep the assessment lean.
 */
export type ConfidenceAssessment = Omit<TestGenerationResult, 'code'> & {
    /** Timestamp when assessment was generated */
    assessedAt: string;
};

export interface TestSession {
    id: string;
    ticketId: string;
    userId: string;
    summary: string;
    description: string;
    comments: string[];
    status: 'created' | 'in_progress' | 'completed' | 'abandoned' | 'cancelled';
    phase: 'init' | 'test_case_design' | 'execution' | 'reporting' | 'done';
    testCases: TestCase[];
    approvedTestCases: boolean;
    /** Pre-compiled Playwright scripts from JSONToPlaywrightCompiler, keyed by testCaseId */
    compiledScripts?: Record<string, string>;
    /** AI confidence assessment with risk level and recommendations */
    confidenceAssessment?: ConfidenceAssessment;
    environment?: TestEnvironment;
    jiraSnapshot: {
        summary: string;
        description: string;
        status: string;
        priority?: string;
    };
    similarTickets?: Array<{
        ticketId: string;
        summary: string;
        status: string;
        similarity: number;
    }>;
    userScenarios: UserScenario[];
    results?: TestResult[];
    artifactsPath?: string;

    /** Flag set when execution is aborted mid-run — enables recovery path */
    aborted?: boolean;

    /** Background orchestration status for AI planning/enrichment */
    orchestrationStatus?: {
        status: 'pending' | 'running' | 'completed' | 'failed';
        error?: string;
        lastRunAt: string;
    };

    version: number;
    history: Array<{
        version: number;
        timestamp: string;
        snapshot: {
            phase: string;
            testCases: TestCase[];
            approvedTestCases: boolean;
            compiledScripts?: Record<string, string>;
            confidenceAssessment?: ConfidenceAssessment;
            environment?: TestEnvironment;
            results?: TestResult[];
            artifactsPath?: string;
            userScenarios: UserScenario[];
        };
    }>;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
}

const SESSIONS_TTL_MS = 5 * 60 * 1000; // 5 min
const sessionsCache = new Map<string, { session: TestSession; expires: number }>();

// Abort controllers for active executions — keyed by userId:ticketId
const executionAbortControllers = new Map<string, AbortController>();

function cacheKey(ticketId: string, userId: string): string {
    return `${userId}:${ticketId}`;
}

// --- Private Helpers ---

function serializeSession(session: TestSession): string {
    return JSON.stringify({
        test_cases: session.testCases,
        results: session.results,
        environment: session.environment,
        jira_snapshot: session.jiraSnapshot,
        artifacts_path: session.artifactsPath,
        history: session.history,
        compiled_scripts: session.compiledScripts
    });
}

function deserializeSession(id: string, row: any): TestSession {
    const data = row.test_cases_raw ? (typeof row.test_cases_raw === 'string' ? JSON.parse(row.test_cases_raw) : row.test_cases_raw) : [];
    const results = row.results_raw ? (typeof row.results_raw === 'string' ? JSON.parse(row.results_raw) : row.results_raw) : [];
    const env = row.environment_raw ? (typeof row.environment_raw === 'string' ? JSON.parse(row.environment_raw) : row.environment_raw) : undefined;
    const jiraSnapshot = row.jira_snapshot_raw ? (typeof row.jira_snapshot_raw === 'string' ? JSON.parse(row.jira_snapshot_raw) : row.jira_snapshot_raw) : row.jira_snapshot_json ? (typeof row.jira_snapshot_json === 'string' ? JSON.parse(row.jira_snapshot_json) : row.jira_snapshot_json) : { summary: row.summary || '', description: row.description || '', status: row.jira_status || 'Unknown' };
    const historyArr = row.history_raw ? (typeof row.history_raw === 'string' ? JSON.parse(row.history_raw) : row.history_raw) : [];
    const userScenes = row.user_scenarios_raw ? (typeof row.user_scenarios_raw === 'string' ? JSON.parse(row.user_scenarios_raw) : row.user_scenarios_raw) : [];
    const compiledScriptsRaw = row.compiled_scripts_raw ? (typeof row.compiled_scripts_raw === 'string' ? JSON.parse(row.compiled_scripts_raw) : row.compiled_scripts_raw) : undefined;
    const confidenceAssessmentRaw = row.confidence_assessment_raw ? (typeof row.confidence_assessment_raw === 'string' ? JSON.parse(row.confidence_assessment_raw) : row.confidence_assessment_raw) : undefined;
    const orchestrationStatusRaw = row.orchestration_status_raw ? (typeof row.orchestration_status_raw === 'string' ? JSON.parse(row.orchestration_status_raw) : row.orchestration_status_raw) : undefined;
    const similarTicketsRaw = row.similar_tickets_raw ? (typeof row.similar_tickets_raw === 'string' ? JSON.parse(row.similar_tickets_raw) : row.similar_tickets_raw) : undefined;
    const comments = row.comments ? (typeof row.comments === 'string' ? JSON.parse(row.comments) : row.comments) : [];

    return {
        id: row.id,
        ticketId: row.ticket_id,
        userId: row.user_id,
        summary: row.summary || '',
        description: row.description || '',
        comments,
        status: (row.status as TestSession['status']) || 'in_progress',
        phase: (row.phase as TestSession['phase']) || 'init',
        testCases: Array.isArray(data) ? data : [],
        approvedTestCases: !!(Array.isArray(data) && data.length > 0),
        compiledScripts: compiledScriptsRaw && typeof compiledScriptsRaw === 'object' ? compiledScriptsRaw : undefined,
        confidenceAssessment: confidenceAssessmentRaw && typeof confidenceAssessmentRaw === 'object' ? confidenceAssessmentRaw : undefined,
        orchestrationStatus: orchestrationStatusRaw,
        similarTickets: similarTicketsRaw,
        aborted: !!row.aborted,
        userScenarios: Array.isArray(userScenes) ? userScenes : [],
        environment: env,
        jiraSnapshot: jiraSnapshot,
        results: Array.isArray(results) ? results : undefined,
        artifactsPath: row.artifacts_path,
        version: row.version || 1,
        history: Array.isArray(historyArr) ? historyArr : [],
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : undefined
    };
}

// --- Public API ---

export class TestSessionCacheService {
    private static pool: DbClient | null = null;

    static setPool(dbPool: DbClient): void {
        this.pool = dbPool;
    }

    /**
     * Create a new session (DB-first, cache for speed)
     */
    static async createSession(
        ticketId: string,
        userId: string,
        summary: string = '',
        description: string = '',
        jiraStatus: string = 'Unknown',
        comments: string[] = []
    ): Promise<TestSession> {
        // Check for existing active session for this user+ticket
        if (!this.pool) throw new Error('DB pool not set');

        const existing = await this.pool.query(
            `SELECT id FROM test_sessions WHERE ticket_id = $1 AND user_id = $2 AND status = 'in_progress' LIMIT 1`,
            [ticketId, userId]
        );

        if (existing.rows.length > 0) {
            const session = await this.getSession(ticketId, userId);
            if (session) return session;
        }

        const session: TestSession = {
            id: uuidv4(),
            ticketId,
            userId,
            summary,
            description,
            comments,
            status: 'in_progress',
            phase: 'init',
            testCases: [],
            approvedTestCases: false,
            userScenarios: [],
            jiraSnapshot: { summary, description, status: jiraStatus },
            version: 1,
            history: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await this.pool.query(
            `INSERT INTO test_sessions (id, ticket_id, user_id, summary, description, comments, status, phase, test_cases, approved_test_cases, jira_snapshot, version, history, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', 'init', $7, false, $8, 1, '[]', NOW(), NOW())`,
            [session.id, ticketId, userId, summary, description, JSON.stringify(comments), JSON.stringify(session.testCases), JSON.stringify(session.jiraSnapshot)]
        );

        sessionsCache.set(cacheKey(ticketId, userId), { session, expires: Date.now() + SESSIONS_TTL_MS });
        return session;
    }

    /**
     * Get session for a specific user
     */
    static async getSession(ticketId: string, userId: string): Promise<TestSession | undefined> {
        // Check cache first
        const cached = sessionsCache.get(cacheKey(ticketId, userId));
        if (cached && cached.expires > Date.now()) return cached.session;

        if (!this.pool) throw new Error('DB pool not set');

        const { rows } = await this.pool.query(
            `SELECT id, ticket_id, user_id, summary, description, comments, status, phase,
                    test_cases::text as test_cases_raw,
                    results::text as results_raw,
                    environment::text as environment_raw,
                    user_scenarios::text as user_scenarios_raw,
                    compiled_scripts::text as compiled_scripts_raw,
                    confidence_assessment::text as confidence_assessment_raw,
                    orchestration_status::text as orchestration_status_raw,
                    similar_tickets::text as similar_tickets_raw,
                    aborted,
                    jira_snapshot,
                    artifacts_path, version, history::text as history_raw,
                    created_at, updated_at, completed_at
             FROM test_sessions
             WHERE ticket_id = $1 AND user_id = $2 AND status = 'in_progress'
             ORDER BY updated_at DESC LIMIT 1`,
            [ticketId, userId]
        );

        if (rows.length === 0) return undefined;

        const session = deserializeSession(rows[0].id, rows[0]);
        sessionsCache.set(cacheKey(ticketId, userId), { session, expires: Date.now() + SESSIONS_TTL_MS });
        return session;
    }

    /**
     * Update session (DB + cache)
     */
    static async updateSession(
        ticketId: string,
        userId: string,
        updates: Partial<Pick<TestSession, 'testCases' | 'approvedTestCases' | 'phase' | 'environment' | 'results' | 'artifactsPath' | 'status' | 'version' | 'history' | 'userScenarios' | 'compiledScripts' | 'confidenceAssessment' | 'orchestrationStatus' | 'aborted' | 'similarTickets'>>
    ): Promise<TestSession | undefined> {
        // Get current session
        const session = await this.getSession(ticketId, userId);
        if (!session) return undefined;

        if (!this.pool) throw new Error('DB pool not set');

        // Save current state to history before updating
        session.history.push({
            version: session.version,
            timestamp: new Date().toISOString(),
            snapshot: {
                phase: session.phase,
                testCases: session.testCases,
                approvedTestCases: session.approvedTestCases,
                compiledScripts: session.compiledScripts,
                environment: session.environment,
                results: session.results,
                artifactsPath: session.artifactsPath,
                userScenarios: session.userScenarios
            }
        });

        // Keep max 10 history versions
        if (session.history.length > 10) {
            session.history = session.history.slice(-10);
        }

        // Apply updates
        Object.assign(session, updates);
        session.version += 1;
        session.updatedAt = new Date().toISOString();

        // DB update
        const setClauses: string[] = [];
        const values: any[] = [];
        let idx = 1;

        if (updates.testCases !== undefined) { setClauses.push(`test_cases = $${idx++}`); values.push(JSON.stringify(updates.testCases)); }
        if (updates.approvedTestCases !== undefined) { setClauses.push(`approved_test_cases = $${idx++}`); values.push(updates.approvedTestCases); }
        if (updates.compiledScripts !== undefined) { setClauses.push(`compiled_scripts = $${idx++}`); values.push(JSON.stringify(updates.compiledScripts)); }
        if (updates.confidenceAssessment !== undefined) { setClauses.push(`confidence_assessment = $${idx++}`); values.push(JSON.stringify(updates.confidenceAssessment)); }
        if (updates.userScenarios !== undefined) { setClauses.push(`user_scenarios = $${idx++}`); values.push(JSON.stringify(updates.userScenarios)); }
        if (updates.phase !== undefined) { setClauses.push(`phase = $${idx++}`); values.push(updates.phase); }
        if (updates.status !== undefined) { setClauses.push(`status = $${idx++}`); values.push(updates.status); }
        if (updates.environment !== undefined) { setClauses.push(`environment = $${idx++}`); values.push(JSON.stringify(updates.environment)); }
        if (updates.results !== undefined) { setClauses.push(`results = $${idx++}`); values.push(JSON.stringify(updates.results)); }
        if (updates.artifactsPath !== undefined) { setClauses.push(`artifacts_path = $${idx++}`); values.push(updates.artifactsPath); }
        if (updates.history !== undefined) { setClauses.push(`history = $${idx++}`); values.push(JSON.stringify(updates.history)); }
        if (updates.orchestrationStatus !== undefined) { setClauses.push(`orchestration_status = $${idx++}`); values.push(JSON.stringify(updates.orchestrationStatus)); }
        if (updates.aborted !== undefined) { setClauses.push(`aborted = $${idx++}`); values.push(updates.aborted); }
        if (updates.similarTickets !== undefined) { setClauses.push(`similar_tickets = $${idx++}`); values.push(JSON.stringify(updates.similarTickets)); }

        setClauses.push(`version = $${idx++}`);
        values.push(session.version);
        setClauses.push(`updated_at = NOW()`);

        values.push(ticketId, userId);

        await this.pool.query(
            `UPDATE test_sessions SET ${setClauses.join(', ')} WHERE ticket_id = $${idx++} AND user_id = $${idx++}`,
            values
        );

        // Update cache
        sessionsCache.set(cacheKey(ticketId, userId), { session, expires: Date.now() + SESSIONS_TTL_MS });
        return session;
    }

    /**
     * Delete session
     */
    static async deleteSession(ticketId: string, userId: string): Promise<boolean> {
        if (!this.pool) throw new Error('DB pool not set');

        await this.pool.query(
            `DELETE FROM test_sessions WHERE ticket_id = $1 AND user_id = $2 AND status = 'in_progress'`,
            [ticketId, userId]
        );

        sessionsCache.delete(cacheKey(ticketId, userId));
        return true;
    }

    /**
     * List sessions for a specific user (or all if no userId)
     */
    static async listSessions(userId?: string): Promise<TestSession[]> {
        if (!this.pool) throw new Error('DB pool not set');

        let query = `SELECT id, ticket_id, user_id, summary, description, comments, status, phase,
                            test_cases::text as test_cases_raw,
                            results::text as results_raw,
                            environment::text as environment_raw,
                            user_scenarios::text as user_scenarios_raw,
                            compiled_scripts::text as compiled_scripts_raw,
                            jira_snapshot,
                            artifacts_path, version, history::text as history_raw,
                            created_at, updated_at, completed_at
                     FROM test_sessions ORDER BY updated_at DESC`;
        const params: any[] = [];

        if (userId) {
            query += ` WHERE user_id = $1`;
            params.push(userId);
        }

        const { rows } = await this.pool.query(query, params);
        return rows.map((row: any) => deserializeSession(row.id, row));
    }

    /**
     * Complete session
     */
    static async completeSession(
        ticketId: string,
        userId: string,
        results: TestResult[],
        artifactsPath?: string
    ): Promise<TestSession | undefined> {
        // Update business rule confidence based on test results
        this._updateBusinessRuleConfidence(ticketId, results);

        return await this.updateSession(ticketId, userId, {
            results,
            artifactsPath,
            status: 'completed',
            phase: 'done'
        });
    }

    /**
     * Fire-and-forget business rule confidence update.
     * Extracts module from results and uses pass/fail rates to adjust confidence.
     */
    private static async _updateBusinessRuleConfidence(
        ticketId: string,
        results: TestResult[]
    ): Promise<void> {
        try {
            if (!this.pool || results.length === 0) return;

            // Infer module from results (take first non-empty linkedRequirement or ticketId)
            const moduleGuess = results[0]?.linkedRequirement || ticketId;

            const { BusinessRulesService } = await import('../execution/BusinessRulesService');
            const summary = {
                total: results.length,
                passed: results.filter(r => r.status === 'PASS').length,
                failed: results.filter(r => r.status === 'FAIL').length,
            };

            const result = await BusinessRulesService.updateConfidenceFromTestResults(
                this.pool,
                moduleGuess,
                summary
            );

            if (result.updatedRules > 0) {
                console.log(`[TestSession] Updated confidence for ${result.updatedRules} business rules`);
            }
        } catch (e: any) {
            console.warn('[TestSession] Business rule confidence update failed:', e.message);
        }
    }

    /**
     * Get stats
     */
    static async getStats(userId?: string): Promise<Record<string, any>> {
        if (!this.pool) throw new Error('DB pool not set');

        const where = userId ? `WHERE user_id = $1` : '';
        const params = userId ? [userId] : [];

        const { rows } = await this.pool.query(
            `SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
                COALESCE(SUM(jsonb_array_length(test_cases)), 0) as total_test_cases
             FROM test_sessions ${where}`,
            params
        );

        const r = rows[0];
        return {
            total: parseInt(r.total),
            inProgress: parseInt(r.in_progress),
            completed: parseInt(r.completed),
            cancelled: parseInt(r.cancelled),
            totalTestCases: parseInt(r.total_test_cases)
        };
    }

    /**
     * Get session history
     */
    static async getSessionHistory(ticketId: string, userId: string): Promise<Array<{ version: number; timestamp: string; snapshot: any }>> {
        const session = await this.getSession(ticketId, userId);
        return session ? session.history : [];
    }

    /**
     * Restore from history
     */
    static async restoreFromHistory(ticketId: string, userId: string, version: number): Promise<TestSession | undefined> {
        const session = await this.getSession(ticketId, userId);
        if (!session) return undefined;

        const entry = session.history.find(h => h.version === version);
        if (!entry) return undefined;

        return await this.updateSession(ticketId, userId, {
            phase: entry.snapshot.phase as TestSession['phase'],
            testCases: entry.snapshot.testCases,
            approvedTestCases: entry.snapshot.approvedTestCases,
            environment: entry.snapshot.environment,
            results: entry.snapshot.results,
            artifactsPath: entry.snapshot.artifactsPath
        });
    }

    /**
     * Store an AbortController for an active execution
     */
    static setExecutionAbortController(ticketId: string, userId: string, controller: AbortController): void {
        const key = cacheKey(ticketId, userId);
        executionAbortControllers.set(key, controller);
    }

    /**
     * Get the AbortController for an active execution
     */
    static getExecutionAbortController(ticketId: string, userId: string): AbortController | undefined {
        const key = cacheKey(ticketId, userId);
        return executionAbortControllers.get(key);
    }

    /**
     * Clear the AbortController after execution finishes
     */
    static clearExecutionAbortController(ticketId: string, userId: string): void {
        const key = cacheKey(ticketId, userId);
        executionAbortControllers.delete(key);
    }

    /**
     * Acquire an execution lock for a session. Returns false if already running.
     * Prevents concurrent test execution on the same session by multiple users.
     */
    static async acquireExecutionLock(ticketId: string, userId: string): Promise<boolean> {
        if (!this.pool) throw new Error('DB pool not set');
        try {
            const result = await this.pool.query(
                `UPDATE test_sessions SET is_running = true
                 WHERE ticket_id = $1 AND user_id = $2 AND status = 'in_progress' AND (is_running IS FALSE OR is_running IS NULL)
                 RETURNING id`,
                [ticketId, userId]
            );
            return result.rows.length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Release an execution lock after test execution completes or aborts.
     */
    static async releaseExecutionLock(ticketId: string, userId: string): Promise<void> {
        if (!this.pool) throw new Error('DB pool not set');
        await this.pool.query(
            `UPDATE test_sessions SET is_running = false
             WHERE ticket_id = $1 AND user_id = $2`,
            [ticketId, userId]
        );
    }

    /**
     * Check if execution lock is held
     */
    static async isExecutionLocked(ticketId: string, userId: string): Promise<boolean> {
        if (!this.pool) throw new Error('DB pool not set');
        const result = await this.pool.query(
            `SELECT is_running FROM test_sessions WHERE ticket_id = $1 AND user_id = $2`,
            [ticketId, userId]
        );
        return !!(result.rows[0]?.is_running);
    }

    /**
     * Signal abort to the active execution (non-destructive — keeps results so far)
     */
    static abortExecution(ticketId: string, userId: string): boolean {
        const controller = this.getExecutionAbortController(ticketId, userId);
        if (controller && !controller.signal.aborted) {
            controller.abort();
            return true;
        }
        return false;
    }

    /**
     * Check if execution has been aborted
     */
    static isExecutionAborted(ticketId: string, userId: string): boolean {
        const controller = this.getExecutionAbortController(ticketId, userId);
        return controller?.signal.aborted ?? false;
    }

    /**
     * Clean up stale sessions that have been in_progress beyond maxAgeHours.
     * Also force-clears is_running lock if it's been stuck for > 2 hours (crash recovery).
     * Returns the count of sessions marked as abandoned.
     */
    static async cleanupStaleSessions(maxAgeHours: number = 24): Promise<number> {
        if (!this.pool) {
            // Clear in-memory cache regardless
            const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
            let cleaned = 0;
            for (const [key, entry] of sessionsCache.entries()) {
                if (entry.session.updatedAt && new Date(entry.session.updatedAt).getTime() < cutoff) {
                    sessionsCache.delete(key);
                    cleaned++;
                }
            }
            return cleaned;
        }

        const IS_RUNNING_TIMEOUT_HOURS = 2; // Force-clear is_running after 2 hours (crash recovery)

        // Step 1: Force-clear stale is_running locks (Node.js crash recovery)
        const lockResult = await this.pool.query(
            `UPDATE test_sessions
             SET is_running = false, updated_at = NOW()
             WHERE status = 'in_progress'
               AND is_running = true
               AND updated_at < NOW() - ($1 * interval '1 hour')`,
            [IS_RUNNING_TIMEOUT_HOURS]
        );

        // Step 2: Mark old in_progress sessions as abandoned (only if is_running is false or timed out)
        const result = await this.pool.query(
            `UPDATE test_sessions
             SET status = 'abandoned', updated_at = NOW()
             WHERE status = 'in_progress'
               AND updated_at < NOW() - ($1 * interval '1 hour')
               AND (is_running IS NOT TRUE OR updated_at < NOW() - ($2 * interval '1 hour'))`,
            [maxAgeHours, IS_RUNNING_TIMEOUT_HOURS]
        );

        // Clear matching in-memory cache entries
        const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
        let cleaned = 0;
        for (const [key, entry] of sessionsCache.entries()) {
            if (entry.session.updatedAt && new Date(entry.session.updatedAt).getTime() < cutoff) {
                sessionsCache.delete(key);
                cleaned++;
            }
        }

        const totalAffected = (lockResult.rowCount || 0) + (result.rowCount || 0);
        return totalAffected || cleaned;
    }

    /**
     * Get last execution summary for a ticket (regardless of session status)
     */
    static async getLastRunInfo(ticketId: string, userId?: string): Promise<{
        lastRunAt?: string;
        lastResults?: TestResult[];
        lastSummary?: { total: number; passed: number; failed: number; skipped: number };
        hasResults: boolean;
    } | null> {
        if (!this.pool) return null;

        const params: any[] = [ticketId];
        let whereClause = 'WHERE ticket_id = $1';
        if (userId) {
            params.push(userId);
            whereClause += ' AND user_id = $2';
        }

        const { rows } = await this.pool.query(
            `SELECT results::text as results_raw, updated_at
             FROM test_sessions
             ${whereClause}
               AND results IS NOT NULL
             ORDER BY updated_at DESC
             LIMIT 1`,
            params
        );

        if (rows.length === 0) return null;

        const results = rows[0].results_raw
            ? (typeof rows[0].results_raw === 'string' ? JSON.parse(rows[0].results_raw) : rows[0].results_raw)
            : [];

        if (!Array.isArray(results) || results.length === 0) return null;

        const summary = {
            total: results.length,
            passed: results.filter((r: TestResult) => r.status === 'PASS').length,
            failed: results.filter((r: TestResult) => r.status === 'FAIL').length,
            skipped: results.filter((r: TestResult) => r.status === 'SKIPPED').length,
        };

        return {
            lastRunAt: rows[0].updated_at ? new Date(rows[0].updated_at).toISOString() : undefined,
            lastResults: results,
            lastSummary: summary,
            hasResults: true,
        };
    }
}
