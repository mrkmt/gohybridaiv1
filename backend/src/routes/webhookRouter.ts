/**
 * Webhook Router
 *
 * Minimal Express router for incoming Jira webhooks.
 * Validates the request and delegates to JiraWebhookHandler.
 */

import { Router, Request, Response } from 'express';
import { appLogger } from '../utils/logger';
import { JiraWebhookHandler, JiraWebhookEvent } from '../services/jira/JiraWebhookHandler';
import { z } from 'zod';
import { successResponse, errorResponse, validationError, notFoundError, internalError, unauthorizedError } from '../../api/utils/responseHelpers';

// ── W3.1: Notify and queue auto-start when ticket moves to "In Testing"
// Runs fire-and-forget so webhook responds within Jira's 3-second timeout.
// Creates/gets the session, marks it as queued, and emits a WebSocket notification
// so the frontend can show "Auto-start pending" and the tester can confirm.
async function autoStartTestingSession(ticketId: string, pool: any): Promise<void> {
  try {
    appLogger.info(`[JiraWebhook] Auto-queuing test session for ${ticketId}`);

    const { TestSessionService } = await import('../services/session/TestSessionService');
    const { JobEvents } = require('../../api/WorkerQueue');

    const sessions = new TestSessionService(pool);
    const existing = await sessions.get(ticketId, 'system').catch(() => null);

    // Skip if already running
    if (existing?.phase === 'executing') {
      appLogger.info(`[JiraWebhook] ${ticketId} already executing — skipping`);
      return;
    }

    // Create or get session (ticket field populated later when user opens it)
    const session = await sessions.createOrGet(ticketId, 'system');

    // Update session to reflect it was triggered from Jira webhook
    await sessions.update(ticketId, 'system', {
      phase: session.phase === 'completed' ? 'created' : session.phase,
    }).catch(() => {});

    // Notify frontend via WebSocket — shows "Start Testing" button with auto-trigger badge
    JobEvents.emit('webhook:auto_queued', {
      ticketId,
      source: 'jira_status_change',
      message: `Ticket ${ticketId} moved to "In Testing" — ready to start automated testing`,
      timestamp: new Date().toISOString(),
    });

    appLogger.info(`[JiraWebhook] Auto-queued ${ticketId} — session phase: ${session.phase}`);
  } catch (err: any) {
    appLogger.error(`[JiraWebhook] autoStartTestingSession failed for ${ticketId}: ${err.message}`);
  }
}

const JiraWebhookSchema = z.object({
    webhookEvent: z.string(),
    issue: z.object({
        id: z.string(),
        key: z.string(),
        fields: z.object({
            summary: z.string().optional(),
            description: z.any().optional(),
            status: z.object({ name: z.string(), id: z.string() }).optional(),
            issuetype: z.object({ name: z.string() }).optional(),
        }).optional().default({}),
    }),
    changelog: z.object({
        items: z.array(z.object({
            field: z.string(),
            fromString: z.string().optional().default(''),
            toString: z.string().optional().default(''),
        })).default([]),
    }).optional(),
    user: z.object({
        displayName: z.string().optional().default(''),
        name: z.string().optional().default(''),
    }).optional(),
    comment: z.object({
        body: z.any().optional(),
        author: z.object({ displayName: z.string().optional().default('') }).optional(),
    }).optional(),
});

export function createWebhookRouter(deps: { pool?: any }): Router {
    const router = Router();

    if (deps.pool) {
        JiraWebhookHandler.setPool(deps.pool);
    }

    // POST /api/webhooks/jira
    router.post('/jira', async (req: Request, res: Response) => {
        // Validate webhook secret/token if configured
        const webhookSecret = process.env.JIRA_WEBHOOK_SECRET;
        if (webhookSecret) {
            const providedSecret = req.headers['x-webhook-secret'] || req.headers['x-jira-webhook-secret'];
            if (providedSecret !== webhookSecret) {
                appLogger.warn('[JiraWebhook] Invalid webhook secret');
                return unauthorizedError(res, 'Unauthorized');
            }
        }

        // Validate payload schema
        const parsed = JiraWebhookSchema.safeParse(req.body);
        if (!parsed.success) {
            appLogger.warn('[JiraWebhook] Invalid webhook payload', { errors: parsed.error.issues });
            return validationError(res, parsed.error.issues, 'Invalid payload');
        }

        try {
            const event = parsed.data as JiraWebhookEvent;
            const actions = await JiraWebhookHandler.handleWebhook(event);

            // Emit actionable events via WebSocket for real-time dashboard alerts
            const actionableActions = actions.filter(a => a.type !== 'no-op');
            if (actionableActions.length > 0) {
                const { JobEvents } = require('../../api/WorkerQueue');
                for (const action of actionableActions) {
                    JobEvents.emit('webhook:action', {
                        type: 'webhook:action',
                        payload: action,
                        timestamp: new Date().toISOString()
                    });

                    // W3.1: Actually trigger the testing pipeline for flag_regenerate actions
                    if (action.type === 'flag_regenerate' && (action as any).ticketId && deps.pool) {
                        // Fire-and-forget — do NOT await (Jira requires response within 3s)
                        autoStartTestingSession((action as any).ticketId, deps.pool);
                    }
                }
            }

            appLogger.info(`[JiraWebhook] Webhook processed: ${actions.length} action(s)`, { actions });

            successResponse(res, { actions });
        } catch (error: any) {
            appLogger.error('[JiraWebhook] Failed to process webhook', { error: error.message });
            internalError(res, 'Failed to process webhook');
        }
    });

    // GET /api/webhooks/health — simple health check
    router.get('/health', (_req: Request, res: Response) => {
        successResponse(res, { status: 'ok', message: 'Webhook endpoint active' });
    });

    return router;
}
