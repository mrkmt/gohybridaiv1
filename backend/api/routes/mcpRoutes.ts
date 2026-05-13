/**
 * mcpRoutes.ts
 *
 * REST API for the MCP layer:
 *
 * Script Library:
 *   GET  /api/mcp/scripts              → paginated list of saved scripts
 *   GET  /api/mcp/scripts/stats        → total/pass/fail/modules summary
 *   GET  /api/mcp/scripts/:ticketId    → all scripts for a ticket
 *   DELETE /api/mcp/scripts/:ticketId/:scenarioId → delete a saved script
 *
 * Sprint Regression:
 *   POST /api/mcp/sprint/run           → start a sprint regression run
 *   GET  /api/mcp/sprint/runs          → list past sprint runs
 *   GET  /api/mcp/sprint/runs/:id      → detail + per-ticket results
 *   GET  /api/mcp/sprint/active        → fetch active sprints from Jira (for picker)
 *
 * Live Discovery (diagnostic):
 *   POST /api/mcp/discover             → run live discovery for a module
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Pool } from 'pg';
import { TestScriptStore } from '../../src/services/mcp/TestScriptStore';
import { McpDiscoveryService } from '../../src/services/mcp/McpDiscoveryService';
import { SprintRegressionRunner } from '../../src/services/mcp/SprintRegressionRunner';
import { getJiraClient } from '../../src/services/jira/JiraClientFactory';
import { appLogger } from '../../src/utils/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveUserId(req: Request): string {
  return (req as any).user?.id ?? (req as any).apiKeyUser?.id ?? 'admin';
}

function resolvePool(req: Request): Pool {
  return (req.app.locals.pool ?? (global as any).dbPool) as Pool;
}

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

// ─── Validation schemas ───────────────────────────────────────────────────────

const SprintRunSchema = z.object({
  sprintId:       z.string().min(1),
  boardId:        z.string().optional(),
  baseUrl:        z.string().url(),
  username:       z.string().min(1),
  password:       z.string().min(1),
  idNumber:       z.string().optional(),
  concurrency:    z.number().int().min(1).max(10).optional(),
  reportTicketId: z.string().optional(),
});

const DiscoverSchema = z.object({
  module:   z.string().min(1),
  baseUrl:  z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  idNumber: z.string().optional(),
  headed:   z.boolean().optional(),
});

// ─── Router factory ───────────────────────────────────────────────────────────

export function createMcpRouter(): Router {
  const router = Router();

  // ── Script Library ──────────────────────────────────────────────────────────

  /** GET /api/mcp/scripts/stats */
  router.get('/scripts/stats', asyncHandler(async (req, res) => {
    const pool = resolvePool(req);
    const stats = await TestScriptStore.getStats(pool);
    res.json({ success: true, data: stats });
  }));

  /** GET /api/mcp/scripts?limit=20&offset=0&module=X&status=PASS */
  router.get('/scripts', asyncHandler(async (req, res) => {
    const pool = resolvePool(req);
    const limit  = Math.min(Number(req.query.limit  ?? 20), 100);
    const offset = Number(req.query.offset ?? 0);
    const mod    = req.query.module as string | undefined;
    const status = req.query.status as string | undefined;

    const result = await TestScriptStore.list(pool, { limit, offset, module: mod, status });
    res.json({ success: true, data: result.rows, meta: { total: result.total, limit, offset } });
  }));

  /** GET /api/mcp/scripts/:ticketId */
  router.get('/scripts/:ticketId', asyncHandler(async (req, res) => {
    const pool = resolvePool(req);
    const scripts = await TestScriptStore.loadAllForTicket(pool, req.params.ticketId);
    res.json({ success: true, data: scripts });
  }));

  /** DELETE /api/mcp/scripts/:ticketId/:scenarioId */
  router.delete('/scripts/:ticketId/:scenarioId', asyncHandler(async (req, res) => {
    const pool = resolvePool(req);
    await TestScriptStore.delete(pool, req.params.ticketId, req.params.scenarioId);
    res.json({ success: true });
  }));

  // ── Sprint Regression ───────────────────────────────────────────────────────

  /** POST /api/mcp/sprint/run */
  router.post('/sprint/run', asyncHandler(async (req, res) => {
    const parse = SprintRunSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ success: false, error: 'Invalid input', details: parse.error.flatten() });
      return;
    }

    const pool   = resolvePool(req);
    const userId = resolveUserId(req);
    const d      = parse.data;

    // Start run in background — return the run ID immediately
    const runPromise = SprintRegressionRunner.run({
      pool,
      userId,
      sprintId:       d.sprintId,
      boardId:        d.boardId,
      baseUrl:        d.baseUrl,
      credentials:    { username: d.username, password: d.password, idNumber: d.idNumber },
      concurrency:    d.concurrency,
      reportTicketId: d.reportTicketId,
    });

    // Attach a background logger so errors surface
    runPromise.then(report => {
      appLogger.info(`[MCP Route] Sprint run ${report.sprintRunId} completed: ${report.passed}✅ ${report.failed}❌`);
    }).catch(err => {
      appLogger.error(`[MCP Route] Sprint run failed: ${err.message}`);
    });

    // We don't await — respond immediately with 202
    // The frontend polls /api/mcp/sprint/runs/:id for updates
    res.status(202).json({
      success: true,
      message: 'Sprint regression run started in background. Poll /api/mcp/sprint/runs/:id for status.',
    });
  }));

  /** GET /api/mcp/sprint/runs */
  router.get('/sprint/runs', asyncHandler(async (req, res) => {
    const pool   = resolvePool(req);
    const limit  = Math.min(Number(req.query.limit ?? 20), 100);
    const offset = Number(req.query.offset ?? 0);

    const { rows: runs, rowCount } = await pool.query(
      `SELECT id, sprint_id, sprint_name, project_key, total_tickets,
              passed, failed, skipped, status, started_at, completed_at
       FROM sprint_runs
       ORDER BY started_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const { rows: [{ total }] } = await pool.query('SELECT COUNT(*)::int AS total FROM sprint_runs');

    res.json({ success: true, data: runs, meta: { total, limit, offset } });
  }));

  /** GET /api/mcp/sprint/runs/:id */
  router.get('/sprint/runs/:id', asyncHandler(async (req, res) => {
    const pool = resolvePool(req);
    const id   = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ success: false, error: 'Invalid run ID' });
      return;
    }

    const [runRes, resultsRes] = await Promise.all([
      pool.query('SELECT * FROM sprint_runs WHERE id = $1', [id]),
      pool.query(
        `SELECT ticket_id, ticket_summary, module_name, status,
                used_saved_script, failure_category, error_message, duration_ms, created_at
         FROM sprint_run_results WHERE sprint_run_id = $1 ORDER BY created_at`,
        [id],
      ),
    ]);

    if (!runRes.rows.length) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }

    res.json({ success: true, data: { run: runRes.rows[0], results: resultsRes.rows } });
  }));

  /** GET /api/mcp/sprint/active — list active Jira sprints */
  router.get('/sprint/active', asyncHandler(async (req, res) => {
    const pool   = resolvePool(req);
    const userId = resolveUserId(req);
    const jira   = await getJiraClient(userId, pool);

    // Fetch all boards for the GT project, then get active sprints
    const boardsResp = await jira.axios.get('/rest/agile/1.0/board', {
      params: { projectKeyOrId: jira.spaces.gt, maxResults: 10 },
    });
    const boards: any[] = boardsResp.data?.values ?? [];

    const allSprints: any[] = [];
    await Promise.all(boards.map(async (board) => {
      try {
        const sr = await jira.axios.get(`/rest/agile/1.0/board/${board.id}/sprint`, {
          params: { state: 'active', maxResults: 5 },
        });
        (sr.data?.values ?? []).forEach((s: any) =>
          allSprints.push({ id: s.id, name: s.name, boardId: board.id, state: s.state }),
        );
      } catch {
        // skip boards without sprint support
      }
    }));

    res.json({ success: true, data: allSprints });
  }));

  // ── Live Discovery (diagnostic) ─────────────────────────────────────────────

  /** POST /api/mcp/discover */
  router.post('/discover', asyncHandler(async (req, res) => {
    const parse = DiscoverSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ success: false, error: 'Invalid input', details: parse.error.flatten() });
      return;
    }

    const d = parse.data;
    appLogger.info(`[MCP Route] Live discovery requested for module "${d.module}"`);

    const result = await McpDiscoveryService.discover({
      module:      d.module,
      baseUrl:     d.baseUrl,
      credentials: { username: d.username, password: d.password, idNumber: d.idNumber },
      headed:      d.headed,
    });

    // Return snapshot summary (don't send the full text — can be very large)
    res.json({
      success: true,
      data: {
        module:       result.module,
        visitedUrl:   result.visitedUrl,
        selectorHash: result.selectorHash,
        capturedAt:   result.capturedAt,
        snapshotLength: result.snapshot.length,
        promptContextLength: result.promptContext.length,
        promptContextPreview: result.promptContext.slice(0, 500),
      },
    });
  }));

  return router;
}
