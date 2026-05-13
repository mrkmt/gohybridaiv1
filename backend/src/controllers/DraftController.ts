import { Request, Response } from 'express';
import { z } from 'zod';
import { appLogger } from '../utils/logger';
import { DbClient } from '../services/shared/TelemetryService';

const DraftSchema = z.object({
    jiraId: z.string().min(1),
    phase: z.number().int().default(1),
    steps: z.array(z.string()).optional(),
    credentials: z.any().optional()
});

export class DraftController {
    private static pool: DbClient;

    static setPool(pool: DbClient) {
        this.pool = pool;
    }

    static async saveDraft(req: Request, res: Response) {
        try {
            const validation = DraftSchema.safeParse(req.body);
            if (!validation.success) {
                return res.status(400).json({ error: 'Invalid draft data', details: validation.error.format() });
            }

            const { jiraId, phase, steps, credentials } = validation.data;

            await this.pool.query(
                `INSERT INTO investigation_drafts (jira_id, phase, steps, credentials, updated_at)
                 VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                 ON CONFLICT (jira_id) DO UPDATE SET
                    phase = EXCLUDED.phase,
                    steps = EXCLUDED.steps,
                    credentials = EXCLUDED.credentials,
                    updated_at = CURRENT_TIMESTAMP`,
                [jiraId, phase, JSON.stringify(steps || []), JSON.stringify(credentials || {})]
            );

            res.json({ success: true, message: 'Draft saved' });
        } catch (e: any) {
            appLogger.error('[DraftController] Save failed', { source: 'DraftController', error: e.message });
            res.status(500).json({ error: e.message });
        }
    }

    static async getDraft(req: Request, res: Response) {
        try {
            const { jiraId } = req.params;
            const { rows } = await this.pool.query('SELECT * FROM investigation_drafts WHERE jira_id = $1', [jiraId]);

            if (rows.length > 0) {
                const draft = rows[0];
                res.json({
                    jiraId: draft.jira_id,
                    phase: draft.phase,
                    steps: typeof draft.steps === 'string' ? JSON.parse(draft.steps) : draft.steps,
                    credentials: typeof draft.credentials === 'string' ? JSON.parse(draft.credentials) : draft.credentials,
                    updatedAt: draft.updated_at
                });
            } else {
                res.status(404).json({ error: 'No draft found' });
            }
        } catch (e: any) {
            appLogger.error('[DraftController] Get failed', { source: 'DraftController', error: e.message });
            res.status(500).json({ error: e.message });
        }
    }

    static async listDrafts(req: Request, res: Response) {
        try {
            const { rows } = await this.pool.query('SELECT * FROM investigation_drafts ORDER BY updated_at DESC');
            res.json(rows.map((r: any) => ({
                jiraId: r.jira_id,
                phase: r.phase,
                updatedAt: r.updated_at
            })));
        } catch (e: any) {
            appLogger.error('[DraftController] List failed', { source: 'DraftController', error: e.message });
            res.status(500).json({ error: e.message });
        }
    }
}
