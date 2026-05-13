/**
 * backend/src/controllers/TestingWorkflowController.ts
 *
 * REFACTORED — thin controller.
 * Validates input → resolves userId → delegates to service → responds.
 * No business logic lives here anymore.
 *
 * P0 fixes:
 *   - getUserId() throws 401 (not 500) with clear message when unauthenticated
 *   - 'public' fallback completely removed
 *   - approveTestCases() is now explicit + authoritative
 *   - executeTests() checks session.approvedTestCases before proceeding
 */

import type { Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { TestSessionService } from '../services/session/TestSessionService';
import { TestingGenerationService } from '../services/generation/TestingGenerationService';
import { TestingExecutionOrchestrator } from '../services/execution/TestingExecutionOrchestrator';
import { TestingDiscoveryService } from '../services/discovery/TestingDiscoveryService';
import { TestingJiraService } from '../services/jira/TestingJiraService';
import { JobEvents } from '../../api/WorkerQueue';
import { TestExecutionService } from '../services/execution/TestExecutionService';
import { TestScriptStore } from '../services/mcp/TestScriptStore';
import { appLogger } from '../utils/logger';

// ─── userId resolver — P0 FIX ─────────────────────────────────────────────────
/**
 * Resolve the authenticated user's ID from the request.
 * NEVER falls back to 'public'. Throws 401 with clear message if missing.
 *
 * Sources (in priority order):
 *   1. req.user.id — set by JWT authMiddleware
 *   2. req.apiKeyUser.id — set by apiKeyAuth middleware
 *
 * req.body.userId is NOT accepted — it was a security hole.
 */
function getUserId(req: Request): string {
  const userId = (req as unknown as Record<string, Record<string, string>>).user?.id
    || (req as unknown as Record<string, Record<string, string>>).apiKeyUser?.id;

  if (!userId) {
    const err = new Error(
      'Authentication required. Include a Bearer token in the Authorization header.'
    );
    (err as NodeJS.ErrnoException & { statusCode: number }).statusCode = 401;
    throw err;
  }

  if (userId === 'public') {
    const err = new Error(
      'The "public" user identity is not permitted for test sessions. Please log in.'
    );
    (err as NodeJS.ErrnoException & { statusCode: number }).statusCode = 401;
    throw err;
  }

  return userId;
}

// ─── controller ───────────────────────────────────────────────────────────────
export class TestingWorkflowController {
  constructor(
    private sessions: TestSessionService,
    private generation: TestingGenerationService,
    private execution: TestingExecutionOrchestrator,
    private discovery: TestingDiscoveryService,
    private jira: TestingJiraService,
    private pool?: import('pg').Pool,
  ) {}

  // ── POST /api/testing/chat/mention ──────────────────────────────────────────
  async detectTicket(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { message } = req.body as { message?: string };

    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const tickets = await this.jira.extractAndFetchTickets(message, userId, this.pool);

    if (tickets.length === 0) {
      res.json({ success: true, tickets: [], message: 'No Jira ticket IDs found in message.' });
      return;
    }

    // Apply the same field normalisation as startSession:
    //  - type      ← issueType  (frontend JiraTicket.type)
    //  - id        ← key        (required by JiraTicket.id)
    //  - gbContext ← gbTicket   (frontend field name)
    //  - rawComments excluded   (internal only, ~10 KB of raw Jira comment JSON)
    const mappedTickets = tickets.map((t: any) => {
      const { rawComments: _raw, gbTicket: _gb, ...rest } = t;
      return {
        ...rest,
        id:        t.key,
        type:      t.issueType ?? 'Task',
        gbContext: t.gbTicket ?? null,
      };
    });

    // Conversational Reset Intent Detection
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('reset') && mappedTickets.length > 0) {
      const targetTicket = mappedTickets[0].key;
      appLogger.info(`[Chat] Detected RESET intent for ${targetTicket}`);
      
      // Perform Master Reset Logic (Internal call to avoid redundant Auth check)
      try {
        const moduleName = mappedTickets[0].module || '';
        
        // 1. Jira transition
        this.jira.resetTicketStatus(targetTicket).catch(() => {});

        // 2. Wipe DB
        if (this.pool) {
          await this.pool.query('DELETE FROM test_scripts WHERE ticket_id = $1', [targetTicket]);
        }

        // 3. Wipe Cache
        if (moduleName) {
          const cacheFileName = moduleName.toLowerCase().replace(/\s+/g, '_') + '.json';
          const cachePath = path.join(process.cwd(), 'local_storage', 'discovery', 'cache', cacheFileName);
          if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
        }

        // 4. Session reset
        await this.sessions.update(targetTicket, userId, {
          phase: 'created', scenarios: [], testCases: [], approvedTestCases: false, executionLock: false,
        });

        res.json({
          success: true,
          tickets: mappedTickets,
          command: 'reset',
          message: `Master reset complete for ${targetTicket}. Ticket status is now To Do and Wizard is reset.`
        });
        return;
      } catch (err: any) {
        appLogger.warn(`[Chat] Conversational reset failed: ${err.message}`);
      }
    }

    res.json({ success: true, tickets: mappedTickets });
  }

  // ── POST /api/testing/:ticketId/start ───────────────────────────────────────
  async startSession(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;

    let session = await this.sessions.createOrGet(ticketId, userId);

    // Hydrate the Jira ticket into the session if it hasn't been loaded yet.
    // Without this, downstream endpoints (/scenarios, /test-cases, /execute)
    // 404 with "Session not found or ticket not loaded".
    if (!session.ticket) {
      try {
        // Fetch ticket with GB context resolution (user-aware Jira client)
        const ticket = await this.jira.fetchTicket(ticketId, userId, this.pool);
        // Merge GB ticket context into the session description for richer AI generation
        // Keep the AT ticket's own description unless it is genuinely empty (< 30 chars).
        // GB description stays on gbContext for AI generation — do NOT overwrite the AT body.
        const atDesc = (ticket.description ?? '').trim();
        const { rawComments: _raw, gbTicket: _gb, ...ticketRest } = ticket as any;
        const enrichedTicket = {
          ...ticketRest,
          id:          ticket.key,
          type:        (ticket as any).issueType ?? 'Task',
          description: atDesc.length >= 30
            ? atDesc
            : ((ticket as any).gbTicket?.description || atDesc),
          gbContext:   (ticket as any).gbTicket ?? null,
        };
        session = await this.sessions.update(ticketId, userId, { ticket: enrichedTicket });
      } catch (err: any) {
        res.status(502).json({
          error: `Could not load ${ticketId} from Jira: ${err.message}`,
          hint: 'Verify Jira credentials in Settings → Jira Integration, or JIRA_DOMAIN / JIRA_EMAIL / JIRA_API_TOKEN in backend/.env.'
        });
        return;
      }
    }

    // Transition Jira ticket to "In Testing" asynchronously
    // (don't block the response — fire and forget)
    this.jira.transitionToInTesting(ticketId).catch(err =>
      appLogger.warn(`[TestingController] Jira transition failed for ${ticketId}: ${err.message}`)
    );

    // Check discovery cache
    const discoveryStatus = await this.discovery.checkCache(session.ticket?.module || '');

    // Auto-trigger background discovery when cache is stale so that
    // /scenarios and /test-cases get fresh selectors without requiring the
    // user to manually press "Run Discovery". Fire-and-forget — does NOT
    // block this response. The frontend should treat discovery.refreshing===true
    // as a hint to poll /session for cache readiness before generating.
    if (!discoveryStatus.fresh && session.ticket?.module) {
      this.discovery.runLiveBackground(session.ticket.module);
    }

    res.json({
      success: true,
      session: { id: session.id, ticketId, phase: session.phase, iterationCount: session.iterationCount },
      discovery: {
        ...discoveryStatus,
        // Signal to the frontend that a background refresh is underway
        refreshing: !discoveryStatus.fresh && Boolean(session.ticket?.module),
      },
    });
  }

  // ── GET /api/testing/:ticketId/session ──────────────────────────────────────
  async getSession(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;

    const session = await this.sessions.get(ticketId, userId);
    if (!session) {
      res.status(404).json({ error: `No session found for ${ticketId}` });
      return;
    }

    // Include available actions based on Jira ticket status
    const actions = session.ticket
      ? this.jira.getTicketActions(session.ticket.status)
      : { canStart: false, canRetest: false, canAddScenarios: false, isReadOnly: false };

    res.json({ success: true, session, actions });
  }

  // ── GET /api/testing/sessions ───────────────────────────────────────────────
  async listSessions(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    // P0 FIX: listSessions now returns newest first (ORDER BY updated_at DESC)
    const sessions = await this.sessions.list(userId);
    res.json({ success: true, sessions });
  }

  // ── POST /api/testing/:ticketId/discovery/run ───────────────────────────────
  /**
   * Run a LIVE Playwright discovery against the target app and persist the
   * inventory into the cache. Returns real sample selectors so the UI can
   * show verified data instead of mock placeholders.
   *
   * Heavy: ~15-45s. The UI should show a progress/spinner state while waiting.
   */
  async runDiscovery(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;

    const session = await this.sessions.get(ticketId, userId);
    if (!session?.ticket) {
      res.status(404).json({ error: 'Session not found or ticket not loaded' });
      return;
    }

    const moduleName = session.ticket.module || '';
    if (!moduleName) {
      res.status(400).json({ error: 'Cannot run discovery: session ticket has no module.' });
      return;
    }

    const result = await this.discovery.runLive(moduleName);

    // Background discovery still running — tell the UI to poll and retry.
    if (result.pending) {
      res.status(202).json({
        success: false,
        pending: true,
        message: `Discovery is still running for "${moduleName}". Wait 30 seconds and click Re-crawl to check again.`,
        discovery: result,
      });
      return;
    }

    // Gate: 0 elements means login failed, app unreachable, or wrong URL.
    // Block the pipeline — there is nothing useful to generate from an empty inventory.
    if (result.elementCount === 0) {
      await this.sessions.update(ticketId, userId, { phase: 'failed' });
      appLogger.warn(`[Discovery] DISCOVERY_FAIL: 0 elements captured for "${moduleName}" — blocking pipeline`);
      res.status(422).json({
        success: false,
        error: 'DISCOVERY_FAIL',
        message: `Discovery returned 0 elements for module "${moduleName}". ` +
                 `Check that the app is reachable, login credentials are correct, and the module route is valid. ` +
                 `Fix the issue then re-run discovery.`,
        discovery: result,
      });
      return;
    }

    res.json({ success: true, discovery: result });
  }

  // ── POST /api/testing/:ticketId/scenarios ───────────────────────────────────
  async generateScenarios(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;

    const session = await this.sessions.get(ticketId, userId);
    if (!session?.ticket) {
      res.status(404).json({ error: 'Session not found or ticket not loaded' });
      return;
    }

    // Gate: require discovery to have elements before generating scenarios.
    // Prevents AI generating hallucinated test steps when cache is empty.
    const moduleName = session.ticket.module || '';
    if (moduleName) {
      const discoveryStatus = await this.discovery.checkCache(moduleName);
      if (!discoveryStatus.fresh || (discoveryStatus.elementCount ?? 0) === 0) {
        res.status(422).json({
          success: false,
          error: 'DISCOVERY_REQUIRED',
          message: `No discovery data for module "${moduleName}". Run discovery first before generating scenarios.`,
        });
        return;
      }
    }

    const result = await this.generation.generateScenarios(session);

    // P0 FIX: Persist scenarios on the session. Without this, a subsequent
    // /test-cases/generate call receives scenarioIds the server can't resolve
    // (session.scenarios === []), resulting in empty acceptanceCriteria and a
    // downstream generation failure that surfaces as a misleading 404.
    await this.sessions.update(ticketId, userId, {
      scenarios: result.scenarios,
      phase: 'scenarios',
    });

    res.json({ success: true, scenarios: result.scenarios });
  }

  // ── POST /api/testing/:ticketId/test-cases/generate ─────────────────────────
  async generateTestCases(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;
    const { scenarioIds, customInstructions } = req.body as {
      scenarioIds?: string[];
      customInstructions?: string[];
    };

    const session = await this.sessions.get(ticketId, userId);
    if (!session?.ticket) {
      res.status(404).json({ error: 'Session not found or ticket not loaded' });
      return;
    }

    // ── Generation cache: reuse existing test cases for already-generated scenario IDs ──
    // Only call the AI for scenario IDs that don't already have a test case.
    // This avoids spending tokens when the user re-clicks "Generate" on the same scenarios.
    const existingCases: typeof session.testCases = session.testCases ?? [];
    const coveredIds = new Set(existingCases.map((tc: any) => tc.scenarioId).filter(Boolean));

    const requestedIds: string[] | undefined = scenarioIds;
    const uncoveredIds = requestedIds
      ? requestedIds.filter(id => !coveredIds.has(id))
      : undefined; // undefined = generate all (no filter)

    if (requestedIds && uncoveredIds && uncoveredIds.length === 0) {
      // All requested scenarios already have test cases — return cache immediately (0 tokens)
      appLogger.info('[Controller] Generation cache hit — returning cached test cases', {
        ticketId, requestedIds, cachedCount: existingCases.length,
      });
      res.json({ success: true, testCases: existingCases, cached: true });
      return;
    }

    // Pass only uncovered IDs to the generator; merge results with cached cases below.
    const generateForIds = uncoveredIds ?? requestedIds;
    const result = await this.generation.generateTestCases(session, generateForIds, customInstructions, this.pool);

    // Merge: keep cached cases for IDs not regenerated, add newly generated cases
    const mergedCases = [
      ...existingCases.filter((tc: any) => !generateForIds || !generateForIds.includes(tc.scenarioId)),
      ...result.testCases,
    ];

    await this.sessions.update(ticketId, userId, {
      testCases: mergedCases as any[],
      compiledScripts: result.compiledScripts,
      approvedTestCases: false, // Reset approval whenever test cases are regenerated
      phase: 'generation',
    });

    // Save McpStep[] to TestScriptStore for each scenario — execution will load from here.
    // Non-fatal: failure to save steps does not block the response.
    if (result.mcpSteps && this.pool) {
      // Prefer AI-sourced type map (from spec); fall back to tag-based heuristic
      const scenarioTypeMap = result.scenarioTypeMap ?? this.buildScenarioTypeMap(session);
      for (const [scenarioId, steps] of Object.entries(result.mcpSteps)) {
        try {
          await TestScriptStore.save(this.pool, {
            ticketId,
            scenarioId,
            steps,
            scenario_type: scenarioTypeMap[scenarioId] ?? 'happy_path',
            status: 'PENDING',
          } as any);
        } catch (err: any) {
          appLogger.warn(`[Controller] TestScriptStore.save failed for ${scenarioId}: ${err.message}`);
        }
      }
    }

    res.json({ success: true, testCases: mergedCases, cached: false });
  }

  // ── PUT /api/testing/:ticketId/test-cases/:caseId ───────────────────────────
  async updateTestCase(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId, caseId } = req.params;
    const patch = req.body as { name?: string; steps?: any[] };

    const session = await this.sessions.get(ticketId, userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const updated = session.testCases.map(tc =>
      tc.id === caseId ? { ...tc, ...patch } : tc
    );
    await this.sessions.update(ticketId, userId, {
      testCases: updated,
      approvedTestCases: false, // Any edit resets approval
    });

    res.json({ success: true, testCase: updated.find(tc => tc.id === caseId) });
  }

  // ── DELETE /api/testing/:ticketId/test-cases/:caseId ────────────────────────
  async deleteTestCase(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId, caseId } = req.params;

    const session = await this.sessions.get(ticketId, userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const filtered = session.testCases.filter(tc => tc.id !== caseId);
    await this.sessions.update(ticketId, userId, {
      testCases: filtered,
      approvedTestCases: false,
    });

    res.json({ success: true });
  }

  // ── POST /api/testing/:ticketId/test-cases/approve ──────────────────────────
  async approveTestCases(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;

    // P0 FIX: approve() validates test cases exist before setting flag
    const session = await this.sessions.approve(ticketId, userId);

    // Auto-upload approved test cases to Jira "Test Case" custom field.
    // Non-fatal: approval succeeds even if Jira upload fails.
    let jiraUploaded = false;
    let jiraError: string | undefined;
    try {
      jiraUploaded = await this.jira.uploadTestCases(ticketId, session.testCases);
    } catch (err: any) {
      jiraError = err?.message || 'Unknown error';
      appLogger.warn(`[Controller] Jira test-case upload failed (non-fatal) for ${ticketId}: ${jiraError}`);
    }

    res.json({
      success: true,
      approvedTestCases: session.approvedTestCases,
      jiraUploaded,
      ...(jiraError ? { jiraError } : {}),
    });
  }

  // ── POST /api/testing/:ticketId/execute ─────────────────────────────────────
  async executeTests(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;
    const { testCaseIds, environment } = req.body as {
      testCaseIds?: string[];
      environment?: Record<string, string>;
    };

    const session = await this.sessions.get(ticketId, userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    // P0 FIX: Execution blocked without explicit approval
    this.sessions.assertApproved(session);

    // Phase 4: Run in background to avoid Cloudflare/Nginx timeouts (524)
    // Results will arrive via WebSocket (execution:progress and execution:complete)
    this.execution.execute(session, testCaseIds, environment || {}, userId)
      .catch(err => {
        appLogger.error(`[Controller] Background execution failed for ${ticketId}: ${err.message}`);
      });
    
    res.status(202).json({ 
      success: true, 
      message: 'Execution started in background. Monitor progress via WebSockets.',
      isAsync: true 
    });
  }

  // ── POST /api/testing/:ticketId/reset ───────────────────────────────────────
  /**
   * Conversational Reset Flow:
   * 1. Jira transition -> To Do
   * 2. Wipe DB test scripts
   * 3. Wipe Discovery Cache (optional/safe)
   * 4. Reset internal session state
   */
  async resetSession(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;

    appLogger.warn(`[Controller] MASTER RESET triggered for ${ticketId} by user ${userId}`);

    try {
      const session = await this.sessions.get(ticketId, userId);
      if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

      const moduleName = session.ticket?.module || '';

      // 1. Jira transition (asynchronous)
      this.jira.resetTicketStatus(ticketId).catch(err => 
        appLogger.warn(`[Reset] Jira reset failed for ${ticketId}: ${err.message}`)
      );

      // 2. Wipe DB scripts
      if (this.pool) {
        await this.pool.query('DELETE FROM test_scripts WHERE ticket_id = $1', [ticketId]);
      }

      // 3. Wipe Discovery Cache
      if (moduleName) {
        const cacheFileName = moduleName.toLowerCase().replace(/\s+/g, '_') + '.json';
        const cachePath = path.join(process.cwd(), 'local_storage', 'discovery', 'cache', cacheFileName);
        if (fs.existsSync(cachePath)) {
          fs.unlinkSync(cachePath);
        }
      }

      // 4. Reset internal session object
      await this.sessions.update(ticketId, userId, {
        phase: 'created',
        scenarios: [],
        testCases: [],
        approvedTestCases: false,
        executionLock: false,
      });

      res.json({ 
        success: true, 
        message: `MASTER RESET for ${ticketId} complete. System clean and ticket set to To Do.` 
      });
    } catch (err: any) {
      appLogger.error(`[Reset] Reset failed for ${ticketId}: ${err.message}`);
      res.status(500).json({ error: `Reset failed: ${err.message}` });
    }
  }

  // ── POST /api/testing/:ticketId/execute/retry ────────────────────────────────
  async retryFailed(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;
    const { environment } = req.body as { environment?: Record<string, string> };

    const session = await this.sessions.get(ticketId, userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const failedIds = session.results
      .filter(r => {
        const s = r.status.toLowerCase();
        return s === 'fail' || s === 'failed' || s === 'code_fault' || s === 'fault';
      })
      .map(r => r.caseId ?? r.testCaseId);

    if (failedIds.length === 0) {
      res.status(400).json({ error: 'No failed or code fault cases to retry' });
      return;
    }

    // Phase 4: Run in background to avoid Cloudflare/Nginx timeouts (524)
    this.execution.retryFailed(session, failedIds, environment || {}, userId)
      .catch(err => {
        appLogger.error(`[Controller] Background retry failed for ${ticketId}: ${err.message}`);
      });

    res.status(202).json({ 
      success: true, 
      message: 'Retry started in background. Monitor progress via WebSockets.',
      isAsync: true 
    });
  }

  // ── POST /api/testing/:ticketId/test-cases/upload ────────────────────────────
  /**
   * Publish the session's test cases to the Jira "Test Case" custom field.
   * Renders the verbose format (Test Case N, Priority, Description, numbered
   * Steps with per-step Expected, final Expected Outcome) from existing data
   * — no extra LLM call.
   */
  async uploadTestCases(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;

    const session = await this.sessions.get(ticketId, userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (!session.testCases || session.testCases.length === 0) {
      res.status(409).json({ error: 'No test cases in session. Generate test cases first.' });
      return;
    }

    const success = await this.jira.uploadTestCases(ticketId, session.testCases);
    res.json({ success, testCaseCount: session.testCases.length });
  }

  // ── POST /api/testing/:ticketId/results/upload ───────────────────────────────
  async uploadResults(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;

    const session = await this.sessions.get(ticketId, userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    await this.jira.uploadResults(session);

    res.json({ success: true, message: `Results uploaded to ${ticketId}` });
  }

  // ── POST /api/testing/:ticketId/jira/transition ──────────────────────────────
  async transitionTicket(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;
    const { targetStatus } = req.body as { targetStatus?: string };

    if (!targetStatus) {
      res.status(400).json({ error: 'targetStatus is required' });
      return;
    }

    await this.jira.transitionTo(ticketId, targetStatus);

    // Update cached ticket status
    const session = await this.sessions.get(ticketId, userId);
    if (session?.ticket) {
      await this.sessions.update(ticketId, userId, {
        ticket: { ...session.ticket, status: targetStatus as never },
      });
    }

    res.json({ success: true });
  }

  // ── POST /api/testing/:ticketId/user-scenarios ───────────────────────────────
  /**
   * Persist a user-added custom scenario on the session's scenarios array.
   * Custom scenarios are stored alongside AI-generated ones (identified by
   * source: 'custom') so they survive page refreshes and session resumes.
   */
  async addUserScenario(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;
    const { label, tag } = req.body as { label?: string; tag?: string };

    if (!label || !label.trim()) {
      res.status(400).json({ error: 'label is required and must be a non-empty string' });
      return;
    }

    const session = await this.sessions.get(ticketId, userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const newScenario = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: label.trim(),
      label: label.trim(),
      tag: tag || 'Custom',
      selected: true,
      source: 'custom' as const,
    };

    const updatedScenarios = [...session.scenarios, newScenario];
    await this.sessions.update(ticketId, userId, { scenarios: updatedScenarios });

    res.status(201).json({ success: true, scenario: newScenario, scenarios: updatedScenarios });
  }

  // ── DELETE /api/testing/:ticketId/user-scenarios/:id ─────────────────────────
  /**
   * Remove a user-added custom scenario by id.
   * Only scenarios with source === 'custom' can be deleted via this endpoint —
   * AI-generated scenarios are managed by the generation pipeline.
   */
  async deleteUserScenario(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId, id } = req.params;

    const session = await this.sessions.get(ticketId, userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    const target = session.scenarios.find(s => s.id === id);
    if (!target) { res.status(404).json({ error: `Scenario ${id} not found` }); return; }
    if (target.source !== 'custom') {
      res.status(403).json({ error: 'Only custom (user-added) scenarios can be deleted via this endpoint' });
      return;
    }

    const updatedScenarios = session.scenarios.filter(s => s.id !== id);
    await this.sessions.update(ticketId, userId, { scenarios: updatedScenarios });

    res.json({ success: true, scenarios: updatedScenarios });
  }

  // ── DELETE /api/testing/:ticketId/session ────────────────────────────────────
  async deleteSession(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;
    await this.sessions.delete(ticketId, userId);
    res.json({ success: true });
  }

  // ── GET /api/testing/:ticketId/confidence ────────────────────────────────────
  async getConfidence(req: Request, res: Response): Promise<void> {
    const userId = getUserId(req);
    const { ticketId } = req.params;

    const session = await this.sessions.get(ticketId, userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    if (!session.confidenceAssessment) {
      res.json({ success: true, hasAssessment: false, message: 'No confidence assessment available yet.' });
      return;
    }

    res.json({ success: true, hasAssessment: true, assessment: session.confidenceAssessment });
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Build a map of scenarioId → scenario_type from the session's scenario list.
   * Scenario tag ('Negative', 'Edge Case', 'Regression', 'Happy Path') is mapped
   * to the scenario_type stored in test_scripts and used by McpHealingService.
   */
  private buildScenarioTypeMap(session: any): Record<string, string> {
    const map: Record<string, string> = {};
    for (const s of session.scenarios ?? []) {
      const tag = (s.tag ?? s.label ?? '').toLowerCase();
      if (tag.includes('negative'))   map[s.id] = 'negative';
      else if (tag.includes('edge'))  map[s.id] = 'edge_case';
      else if (tag.includes('regr'))  map[s.id] = 'regression';
      else                            map[s.id] = 'happy_path';
    }
    return map;
  }
}

// ─── factory (wires dependencies) ─────────────────────────────────────────────
export function createTestingWorkflowController(pool: import('pg').Pool): TestingWorkflowController {
  const sessions = new TestSessionService(pool);

  // These services are imported here to avoid circular deps
  // In production, use a DI container (tsyringe, awilix, etc.)
  const { TestingGenerationService } = require('../services/generation/TestingGenerationService');
  const { TestingExecutionOrchestrator } = require('../services/execution/TestingExecutionOrchestrator');
  const { TestingDiscoveryService } = require('../services/discovery/TestingDiscoveryService');
  const { TestingJiraService } = require('../services/jira/TestingJiraService');

  return new TestingWorkflowController(
    sessions,
    new TestingGenerationService(),
    new TestingExecutionOrchestrator(sessions, pool),
    new TestingDiscoveryService(),
    new TestingJiraService(),
    pool,
  );
}
