/**
 * backend/src/routes/testingRouter.ts
 *
 * Thin router — just mounts endpoints.
 * All logic lives in TestingWorkflowController and its services.
 *
 * Auth: requireTestingAuth applied to all routes.
 *   - JWT Bearer token → req.user.id
 *   - x-api-key header → req.apiKeyUser.id
 *   - NO 'public' fallback
 */

import { Router, Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { sanitizePath } from '../../api/utils/security';
import { appLogger } from '../utils/logger';
import { z, ZodSchema } from 'zod';
import { createTestingWorkflowController } from '../controllers/TestingWorkflowController';
import { ticketRateLimiter } from '../../api/middleware/ticketRateLimiter';
import type { Pool } from 'pg';

// ─── Zod validation middleware ────────────────────────────────────────────────
function validate(schema: ZodSchema) {
  return (req: Request, res: Response, nxt: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data; // replace with coerced + stripped data
    nxt();
  };
}

// ─── Request schemas ──────────────────────────────────────────────────────────
const MentionSchema = z.object({
  message: z.string().min(1, 'message is required').max(2000).trim(),
});

const GenerateTestCasesSchema = z.object({
  scenarioIds:        z.array(z.string()).optional(),
  customInstructions: z.array(z.string().max(500)).max(20).optional(),
});

const UserScenarioSchema = z.object({
  label: z.string().min(1).max(300).trim(),
  tag:   z.string().optional(),
});

const JiraTransitionSchema = z.object({
  targetStatus: z.string().min(1).max(100).trim(),
});

export function createTestingRouter(pool: Pool): Router {
  const router = Router();
  const ctrl = createTestingWorkflowController(pool);

  // Auth is applied by the parent mount in api/app.ts (requireTestingAuth).

  // ── Ticket detection ──────────────────────────────────────────────────────
  router.post('/chat/mention', ticketRateLimiter, validate(MentionSchema), (req, res) =>
    ctrl.detectTicket(req, res).catch(next(res))
  );

  // ── Session lifecycle ─────────────────────────────────────────────────────
  router.get('/sessions', (req, res) =>
    ctrl.listSessions(req, res).catch(next(res))
  );
  router.post('/:ticketId/start', ticketRateLimiter, (req, res) =>
    ctrl.startSession(req, res).catch(next(res))
  );
  router.get('/:ticketId/session', (req, res) =>
    ctrl.getSession(req, res).catch(next(res))
  );
  router.delete('/:ticketId/session', (req, res) =>
    ctrl.deleteSession(req, res).catch(next(res))
  );

  // ── Discovery (live Playwright probe) ─────────────────────────────────────
  router.post('/:ticketId/discovery/run', ticketRateLimiter, (req, res) =>
    ctrl.runDiscovery(req, res).catch(next(res))
  );

  // ── Generation pipeline ───────────────────────────────────────────────────
  router.post('/:ticketId/scenarios', ticketRateLimiter, (req, res) =>
    ctrl.generateScenarios(req, res).catch(next(res))
  );
  router.post('/:ticketId/test-cases/generate', ticketRateLimiter, validate(GenerateTestCasesSchema), (req, res) =>
    ctrl.generateTestCases(req, res).catch(next(res))
  );
  router.put('/:ticketId/test-cases/:caseId', (req, res) =>
    ctrl.updateTestCase(req, res).catch(next(res))
  );
  router.delete('/:ticketId/test-cases/:caseId', (req, res) =>
    ctrl.deleteTestCase(req, res).catch(next(res))
  );

  // ── User scenarios (custom, persisted) ───────────────────────────────────
  router.post('/:ticketId/user-scenarios', validate(UserScenarioSchema), (req, res) =>
    ctrl.addUserScenario(req, res).catch(next(res))
  );
  router.delete('/:ticketId/user-scenarios/:id', (req, res) =>
    ctrl.deleteUserScenario(req, res).catch(next(res))
  );

  // ── Approval (required before execution) ──────────────────────────────────
  router.post('/:ticketId/test-cases/approve', (req, res) =>
    ctrl.approveTestCases(req, res).catch(next(res))
  );

  // ── Execution ─────────────────────────────────────────────────────────────
  router.post('/:ticketId/execute', ticketRateLimiter, (req, res) =>
    ctrl.executeTests(req, res).catch(next(res))
  );
  router.post('/:ticketId/execute/retry', ticketRateLimiter, (req, res) =>
    ctrl.retryFailed(req, res).catch(next(res))
  );

  // ── Session Control ───────────────────────────────────────────────────────
  router.post('/:ticketId/reset', (req, res) =>
    ctrl.resetSession(req, res).catch(next(res))
  );

  // ── Reporting / Jira ──────────────────────────────────────────────────────
  router.post('/:ticketId/test-cases/upload', ticketRateLimiter, (req, res) =>
    ctrl.uploadTestCases(req, res).catch(next(res))
  );
  router.post('/:ticketId/results/upload', ticketRateLimiter, (req, res) =>
    ctrl.uploadResults(req, res).catch(next(res))
  );
  router.post('/:ticketId/jira/transition', validate(JiraTransitionSchema), (req, res) =>
    ctrl.transitionTicket(req, res).catch(next(res))
  );

  // ── Confidence assessment ─────────────────────────────────────────────────
  router.get('/:ticketId/confidence', (req, res) =>
    ctrl.getConfidence(req, res).catch(next(res))
  );

  // ── Screenshot serving ──────────────────────────────────────────────────
  router.get('/:ticketId/screenshot/:caseId', async (req, res) => {
    const { ticketId, caseId } = req.params;
    const base = path.join(process.cwd(), 'test-results');
    let screenshotPath: string;
    try {
      screenshotPath = sanitizePath(base, path.join(ticketId, 'screenshots', `${caseId}_final.png`));
    } catch {
      res.status(400).json({ error: 'Invalid path parameters' });
      return;
    }

    if (!fs.existsSync(screenshotPath)) {
      res.status(404).json({ error: 'Screenshot not found' });
      return;
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(screenshotPath).pipe(res);
  });

  return router;
}

// ─── error forwarder ─────────────────────────────────────────────────────────
function next(res: import('express').Response) {
  return (err: Error & { statusCode?: number; cause?: unknown }) => {
    const status = err.statusCode || 500;
    appLogger.error(`[testingRouter] Unhandled error: ${err.message}`, {
      status, stack: err.stack, cause: err.cause,
    } as any);
    res.status(status).json({
      error: err.message || 'Internal server error',
      // Only expose stack in non-production for faster debugging.
      ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
    });
  };
}
