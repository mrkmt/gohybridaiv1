import { Request, Response } from 'express';
import { appLogger } from '../utils/logger';
import { BusinessRulesService } from '../services/execution/BusinessRulesService';

export interface UnifiedActivity {
    type: 'EXECUTION' | 'KB_IMPORT' | 'JIRA_SYNC';
    id: string;
    jiraId?: string;
    title: string;
    description: string;
    status?: string;
    timestamp: string;
    artifactUrl?: string;
}

export class ActivityController {
    static async getUnifiedFeed(req: Request, res: Response, pool: any) {
        try {
            const activities: UnifiedActivity[] = [];
            const limit = parseInt(req.query.limit as string) || 15;

            // 1. Get Recent Test Executions from Database
            try {
                const recordings = await pool.query(
                    'SELECT id, jira_id, app_version, created_at, status, test_url FROM recordings ORDER BY created_at DESC LIMIT $1',
                    [limit]
                );

                recordings.rows.forEach((row: any) => {
                    activities.push({
                        type: 'EXECUTION',
                        id: row.id,
                        jiraId: row.jira_id,
                        title: `Execution: ${row.jira_id || row.id.substring(0, 8)}`,
                        description: `Test run for ${row.app_version} on ${row.test_url || 'N/A'}`,
                        status: row.status,
                        timestamp: row.created_at,
                        artifactUrl: row.video_url
                    });
                });
            } catch (dbErr) {
                appLogger.error('[ActivityFeed] DB error', { source: 'ActivityFeed', error: String(dbErr) });
            }

            // 2. Get Recent KB Imports from PostgreSQL business_rules table
            try {
                const rules = await BusinessRulesService.getAll(pool);
                const kbImports = rules
                    .filter(r => r.jiraId)
                    .slice(-limit);

                kbImports.forEach((rule) => {
                    const timestamp = rule.updatedAt || rule.createdAt || new Date().toISOString();

                    activities.push({
                        type: 'KB_IMPORT',
                        id: rule.id,
                        jiraId: rule.jiraId,
                        title: `KB Import: ${rule.jiraId}`,
                        description: `Rule extracted: ${rule.formulaRule || (rule.expectedUIBehavior?.substring(0, 50) + '...')}`,
                        status: rule.status || 'SUCCESS',
                        timestamp
                    });
                });
            } catch (kbErr) {
                appLogger.error('[ActivityFeed] KB error', { source: 'ActivityFeed', error: String(kbErr) });
            }

            // Sort all activities by timestamp descending
            const sortedActivities = activities
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .slice(0, limit);

            res.json(sortedActivities);
        } catch (error: any) {
            appLogger.error('[ActivityController] Failed to generate unified feed', { source: 'ActivityController', error: error.message });
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}
