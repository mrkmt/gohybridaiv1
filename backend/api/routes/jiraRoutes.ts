import { Router } from 'express';
import {
    JiraConfigSchema,
    JiraSyncActiveSchema,
    JiraWebhookTestSchema,
    verifyWebhookSignature,
    requireApiKey,
} from '../utils/requestUtils';
import { successResponse, errorResponse, validationError, notFoundError, internalError } from '../utils/responseHelpers';
import { JiraIngestionController } from '../../src/controllers/JiraIngestionController';
import { JiraSyncController } from '../../src/controllers/JiraSyncController';
import { JiraConfigController } from '../../src/controllers/JiraConfigController';
import { JiraCrossProjectController } from '../../src/controllers/JiraCrossProjectController';
import { JiraSearchController } from '../../src/controllers/JiraSearchController';
import { JiraService } from '../JiraService';
import { TelemetryService } from '../../src/services/shared/TelemetryService';
import { createTestingWorkflowController } from '../../src/controllers/TestingWorkflowController';

export function createJiraRouter(deps: { pool: any, upload: any }) {
    // Initialize pool-dependent services
    JiraIngestionController.setPool(deps.pool);
    const workflowController = createTestingWorkflowController(deps.pool);

    const router = Router();

    // Parse tickets (file upload)
    router.post('/parse-tickets', deps.upload.single('file'), async (req, res) => {
        if (!req.file) return errorResponse(res, 400, 'INVALID_INPUT', 'No file uploaded');
        try {
            const ext = req.file.originalname.split('.').pop()?.toLowerCase();
            let rows: any[] = [];
            if (ext === 'csv') {
                const fs = await import('fs');
                const content = await fs.promises.readFile(req.file.path, 'utf8');
                rows = JiraService.processJiraCsv(content);
            } else if (ext === 'xlsx' || ext === 'xls') {
                const fs = await import('fs');
                const buffer = await fs.promises.readFile(req.file.path);
                rows = JiraService.processJiraXlsx(buffer);
            } else {
                return errorResponse(res, 400, 'INVALID_INPUT', 'Unsupported file format. Please upload CSV or XLSX.');
            }
            try { const fs = await import('fs'); await fs.promises.unlink(req.file.path); } catch (e) { }
            successResponse(res, { rows });
        } catch (err: any) {
            console.error('[Jira Import] Parse failed:', err);
            errorResponse(res, 500, 'SERVICE_ERROR', 'Failed to parse Jira file', err.message);
        }
    });

    // Ingest
    router.post('/ingest', JiraIngestionController.uploadMiddleware, JiraIngestionController.uploadCSV);

    // Webhooks
    router.post('/webhook', (req, res, next) => {
        if (!verifyWebhookSignature(req, res)) return next();
        JiraSyncController.handleWebhook(req, res);
    });

    // Webhook status
    router.get('/webhook-status', (req, res) => {
        const telemetry = TelemetryService.get(100);
        const webhookLogs = telemetry.filter(log =>
            log.source?.includes('JiraWebhook') ||
            log.source?.includes('JiraSync') ||
            log.message?.includes('Jira')
        );
        res.json({
            status: 'ok',
            webhookUrl: `${req.protocol}://${req.get('host')}/api/jira/webhook`,
            crossProjectWebhookUrl: `${req.protocol}://${req.get('host')}/api/jira/cross-project-webhook`,
            recentWebhookCalls: webhookLogs.slice(0, 20),
            totalWebhookCalls: webhookLogs.length
        });
    });

    // Test webhook
    router.post('/test-webhook', (req, res, next) => {
        if (!requireApiKey(req, res)) return next();
        const parsed = JiraWebhookTestSchema.safeParse(req.body);
        if (!parsed.success) return validationError(res, parsed.error.issues);
        const { type = 'cross-project', issueKey = 'ATT-101', status = 'In Testing', summary, description } = parsed.data;

        console.log(`[TestWebhook] Simulating ${type} webhook for ${issueKey} -> ${status}`);

        if (type === 'cross-project') {
            const payload = {
                issue: {
                    key: issueKey,
                    fields: {
                        project: { key: 'ATT' },
                        summary: summary || `Test webhook for ${issueKey}`,
                        description: description || 'Testing cross-project link',
                        status: { name: status },
                        issuelinks: []
                    }
                },
                changelog: {
                    items: [{
                        field: 'status',
                        from: 'To Do',
                        toString: status
                    }]
                }
            };
            JiraCrossProjectController.handleCrossProjectWebhook(
                { body: payload } as any,
                res
            );
        } else {
            const payload = {
                issue: {
                    key: issueKey,
                    fields: {
                        summary: `Test status sync for ${issueKey}`,
                        status: { name: status },
                        project: { key: 'MB' }
                    }
                },
                changelog: {
                    items: [{
                        field: 'status',
                        from: 'In Progress',
                        toString: status
                    }]
                }
            };
            JiraSyncController.handleWebhook(
                { body: payload } as any,
                res
            );
        }
    });

    // Cross-project webhook
    router.post('/cross-project-webhook', (req, res, next) => {
        if (!verifyWebhookSignature(req, res)) return next();
        JiraCrossProjectController.handleCrossProjectWebhook(req, res);
    });

    // Config
    router.get('/config', (req, res) => JiraConfigController.getConfig(req, res));
    router.post('/config', (req, res) => {
        const parsed = JiraConfigSchema.safeParse(req.body);
        if (!parsed.success) return validationError(res, parsed.error.issues);
        JiraConfigController.saveConfig(req, res);
    });

    // Import
    router.post('/import/:id', (req, res) => JiraIngestionController.importFromApi(req, res));

    // Sync active
    router.get('/active-tickets', (req, res) => JiraSyncController.getActiveTickets(req, res));
    router.post('/sync-active', (req, res) => {
        const parsed = JiraSyncActiveSchema.safeParse(req.body);
        if (!parsed.success) return validationError(res, parsed.error.issues);
        JiraSyncController.syncActiveTickets(req, res);
    });
    router.delete('/active-tickets/:id', (req, res) => JiraSyncController.removeActiveTicket(req, res));

    // Search & Discovery
    router.get('/search', (req, res) => JiraSearchController.search(req, res));
    router.get('/project/:projectKey', (req, res) => JiraSearchController.getProjectIssues(req, res));
    router.get('/ticket/:ticketId', (req, res) => JiraSearchController.getTicket(req, res));
    router.get('/projects', (req, res) => JiraSearchController.getProjects(req, res));

    // Comparison
    router.get('/:id/comparison', async (req, res) => {
        const jiraId = req.params.id;
        try {
            const { rows } = await deps.pool.query(
                `SELECT id, environment, video_url, screenshot_url, status, created_at FROM recordings WHERE jira_id = $1 ORDER BY created_at DESC`,
                [jiraId]
            );
            const environments: Record<string, any[]> = { 'testing': [], 'uat': [], 'live': [] };
            rows.forEach((r: any) => { const env = r.environment || 'testing'; if (environments[env as string]) environments[env as string].push(r); });
            successResponse(res, { jiraId, environments });
        } catch (err: any) { internalError(res, 'Comparison failed'); }
    });

    // Testing workflow (chat mention only still lives here as originally placed near jira routes)
    router.post('/testing/chat/mention', async (req, res) =>
        workflowController.detectTicket(req, res)
    );

    return router;
}
