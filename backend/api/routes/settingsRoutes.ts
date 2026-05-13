/**
 * settingsRoutes.ts — Agent profiles, Jira config, and test user settings
 *
 * Routes:
 *   GET  /api/settings/profiles          — list all agent profiles
 *   PUT  /api/settings/profiles          — save updated agent_profiles.json
 *   GET  /api/settings/profiles/health   — health check all AI providers
 *   GET  /api/settings/jira              — read Jira config (token masked)
 *   PUT  /api/settings/jira              — save Jira config to DB
 *   GET  /api/settings/test-users        — read all test users
 *   PUT  /api/settings/test-users/:role  — upsert a test user by role
 *   POST /api/settings/verify            — verify Jira + app connectivity
 */

import { Router, Request, Response } from 'express';
import type { Pool } from 'pg';
import { MultiAgentRouter } from '../MultiAgentRouter';
import { successResponse, errorResponse, internalError } from '../utils/responseHelpers';
import { JiraConfigService } from '../../src/services/JiraConfigService';

export function createSettingsRouter(pool?: Pool): Router {
    const router = Router();

    /** GET /api/settings/profiles */
    router.get('/profiles', (_req: Request, res: Response) => {
        try {
            const cfg = MultiAgentRouter.getConfig();
            successResponse(res, cfg);
        } catch (err: any) {
            internalError(res, `Failed to load agent profiles: ${err.message}`);
        }
    });

    /** PUT /api/settings/profiles */
    router.put('/profiles', (req: Request, res: Response) => {
        try {
            const newConfig = req.body;
            if (!newConfig || !newConfig.profiles || !newConfig.assignments) {
                return errorResponse(res, 400, 'INVALID_INPUT', 'profiles and assignments are required');
            }
            MultiAgentRouter.saveConfig(newConfig);
            successResponse(res, { saved: true });
        } catch (err: any) {
            internalError(res, `Failed to save agent profiles: ${err.message}`);
        }
    });

    /** GET /api/settings/profiles/health */
    router.get('/profiles/health', async (_req: Request, res: Response) => {
        try {
            const health = await MultiAgentRouter.getHealth();
            successResponse(res, health);
        } catch (err: any) {
            internalError(res, `Health check failed: ${err.message}`);
        }
    });

    // ── Jira Config ───────────────────────────────────────────────────────────

    /** GET /api/settings/jira — read Jira config (api_token always masked) */
    router.get('/jira', async (req: Request, res: Response) => {
        if (!pool) { internalError(res, 'DB not available'); return; }
        try {
            const userId = (req as any).user?.id || (req as any).apiKeyUser?.id;
            if (!userId) { errorResponse(res, 401, 'UNAUTHORIZED', 'Authentication required'); return; }
            const config = await JiraConfigService.getMasked(userId, pool);
            if (!config) {
                // Return env fallback values (no token) so UI can show what's set
                successResponse(res, {
                    domain:       process.env.JIRA_DOMAIN  || '',
                    email:        process.env.JIRA_EMAIL   || '',
                    apiToken:     process.env.JIRA_API_TOKEN ? '********' : '',
                    hasToken:     Boolean(process.env.JIRA_API_TOKEN),
                    gtProjectKey: process.env.JIRA_GT_PROJECT_KEY || 'ATT',
                    source:       'env',
                });
                return;
            }
            successResponse(res, { ...config, source: 'db' });
        } catch (err: any) {
            internalError(res, err.message);
        }
    });

    /** PUT /api/settings/jira — save Jira config to DB */
    router.put('/jira', async (req: Request, res: Response) => {
        if (!pool) { internalError(res, 'DB not available'); return; }
        const { domain, email, apiToken, gtProjectKey, gbProjectKey, gdProjectKey } = req.body;
        if (!domain || !email) {
            errorResponse(res, 400, 'INVALID_INPUT', 'domain and email are required');
            return;
        }
        try {
            const userId = (req as any).user?.id || (req as any).apiKeyUser?.id;
            if (!userId) { errorResponse(res, 401, 'UNAUTHORIZED', 'Authentication required'); return; }
            // Reject placeholder mask — preserve existing token instead of overwriting with '********'
            const tokenToSave = (apiToken && apiToken !== '********') ? apiToken : undefined;
            await JiraConfigService.save(userId, {
                domain, email,
                ...(tokenToSave ? { apiToken: tokenToSave } : {}),
                gtProjectKey: gtProjectKey || 'ATT',
                gbProjectKey, gdProjectKey,
            }, pool);
            successResponse(res, { saved: true });
        } catch (err: any) {
            internalError(res, err.message);
        }
    });

    // ── Test Users ────────────────────────────────────────────────────────────

    /** GET /api/settings/test-users — list all test users (passwords masked) */
    router.get('/test-users', async (_req: Request, res: Response) => {
        if (!pool) { internalError(res, 'DB not available'); return; }
        try {
            const { rows } = await pool.query(
                `SELECT id, role, environment, id_number, username, base_url, customer_id, is_default, created_at
                 FROM test_users ORDER BY is_default DESC, role`,
            );
            successResponse(res, rows.map(r => ({ ...r, password: '********' })));
        } catch (err: any) {
            internalError(res, err.message);
        }
    });

    /** PUT /api/settings/test-users/:role — upsert a test user */
    router.put('/test-users/:role', async (req: Request, res: Response) => {
        if (!pool) { internalError(res, 'DB not available'); return; }
        const { role } = req.params;
        const { environment = 'test', idNumber, username, password, baseUrl, customerId, isDefault } = req.body;
        if (!username || !password) {
            errorResponse(res, 400, 'INVALID_INPUT', 'username and password are required');
            return;
        }
        try {
            await pool.query(
                `INSERT INTO test_users (role, environment, id_number, username, password, base_url, customer_id, is_default)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (role, environment) DO UPDATE SET
                   id_number   = EXCLUDED.id_number,
                   username    = EXCLUDED.username,
                   password    = EXCLUDED.password,
                   base_url    = EXCLUDED.base_url,
                   customer_id = EXCLUDED.customer_id,
                   is_default  = EXCLUDED.is_default`,
                [role, environment, idNumber || null, username, password,
                 baseUrl || process.env.BASE_URL || '', customerId || null, isDefault ?? false],
            );
            successResponse(res, { saved: true, role, environment });
        } catch (err: any) {
            internalError(res, err.message);
        }
    });

    // ── Verify ────────────────────────────────────────────────────────────────

    /** POST /api/settings/verify — quick connectivity check */
    router.post('/verify', async (req: Request, res: Response) => {
        if (!pool) { internalError(res, 'DB not available'); return; }
        const results: Record<string, { ok: boolean; message: string }> = {};

        // DB check
        try {
            await pool.query('SELECT 1');
            results.database = { ok: true, message: 'Connected' };
        } catch (e: any) {
            results.database = { ok: false, message: e.message };
        }

        // Jira check
        try {
            const userId = (req as any).user?.id || (req as any).apiKeyUser?.id;
            if (!userId) { errorResponse(res, 401, 'UNAUTHORIZED', 'Authentication required'); return; }
            const cfg = await JiraConfigService.resolve(userId, pool);
            if (!cfg) {
                results.jira = { ok: false, message: 'No Jira config found in DB or env' };
            } else {
                const url = `https://${cfg.domain}/rest/api/3/myself`;
                const resp = await fetch(url, {
                    headers: {
                        Authorization: `Basic ${Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString('base64')}`,
                        Accept: 'application/json',
                    },
                });
                results.jira = resp.ok
                    ? { ok: true, message: `Connected as ${cfg.email}` }
                    : { ok: false, message: `HTTP ${resp.status}` };
            }
        } catch (e: any) {
            results.jira = { ok: false, message: e.message };
        }

        const allOk = Object.values(results).every(r => r.ok);
        res.status(allOk ? 200 : 207).json({ success: allOk, results });
    });

    return router;
}
