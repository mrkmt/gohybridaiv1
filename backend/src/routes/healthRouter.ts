import { Router } from 'express';
import { appLogger } from '../utils/logger';
import { DbClient, TelemetryService } from '../services/shared/TelemetryService';
import { MultiAgentRouter } from '../../api/MultiAgentRouter';
import { config } from '../../api/config';
import { SystemHealthService } from '../services/shared/SystemHealthService';

import { parseLimit } from '../../api/utils/requestUtils';
import { successResponse, errorResponse, validationError, notFoundError, internalError } from '../../api/utils/responseHelpers';

export function createHealthRouter(deps: { pool: DbClient, requireApiKey: any, totalTokensUsed: () => number }) {
    const router = Router();

    router.get('/health', async (req, res) => {
        try {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('DB Query Timeout')), 5000));
            await Promise.race([deps.pool.query('SELECT 1 as ok'), timeoutPromise]);
            const aiConfig = MultiAgentRouter.getConfig();
            const investigatorCB = (MultiAgentRouter as any).getCB?.('INVESTIGATOR');
            const cbState = investigatorCB ? investigatorCB.getState() : 'CLOSED';
            successResponse(res, {
                name: 'Go-Hybrid AI API',
                ok: true, db: true,
                ai: { primary: config.ai.openRouterBaseUrl, defaultModel: config.ai.defaultModel },
                storage: { type: 'local', baseDir: config.storage.baseDir, publicRoute: config.storage.publicRoute },
                stats: { totalTokens: deps.totalTokensUsed(), investigatorCircuit: cbState, activeInvestigator: aiConfig?.assignments?.['INVESTIGATOR'] || 'Unknown' },
                time: new Date().toISOString(), version: '1.1.0'
            });
        } catch (e: any) {
            appLogger.error('[HealthCheck] Error', { module: 'HealthRouter', error: e.message });
            errorResponse(res, 503, 'SERVICE_UNAVAILABLE', 'Health check failed', { error: e.message });
        }
    });

    router.get('/metrics', async (_req, res) => {
        try {
            const recordingsCount = await deps.pool.query('SELECT COUNT(*) FROM recordings');
            const aiLogsCount = await deps.pool.query('SELECT COUNT(*) FROM ai_logs');
            
            // P1 FIX: Expose JobQueue depth and other system metrics
            const { WorkerQueue } = require('../../api/WorkerQueue');
            const queueStats = WorkerQueue.getStats();

            successResponse(res, {
                totalRecordings: parseInt(recordingsCount.rows[0].count),
                totalAiLogs: parseInt(aiLogsCount.rows[0].count),
                queue: queueStats,
                tokens: {
                    total: deps.totalTokensUsed()
                },
                timestamp: new Date().toISOString(),
            });
        } catch (e) { internalError(res, 'Failed to retrieve metrics'); }
    });

    router.get('/logs', async (req, res) => {
        try {
            const limit = parseLimit(req.query.limit, 200);
            const telemetryLogs = TelemetryService.get(limit);
            successResponse(res, telemetryLogs);
        } catch (err: any) {
            appLogger.error('[Logs] Fetch failed', { module: 'HealthRouter', error: err.message });
            internalError(res, 'Failed to fetch logs');
        }
    });

    router.post('/logs/clear', (req, res) => {
        if (!deps.requireApiKey(req, res)) return;
        TelemetryService.clear();
        successResponse(res, { message: 'Logs cleared successfully' });
    });

    return router;
}
