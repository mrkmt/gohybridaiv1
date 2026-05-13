import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { CrawlerService } from '../../src/services/discovery/CrawlerService';
import { normalizeDiscoveryRequest, getAllowedDiscoveryModels, toSafeDiscoveryConfig, getDiscoveryStorageDir } from '../../src/services/discovery/DiscoveryConfig';
import { DiscoveryRunService } from '../../src/services/discovery/DiscoveryRunService';
import { ElementRepositoryService } from '../../src/services/ElementRepositoryService';
import { HarvesterParserService } from '../../src/services/HarvesterParserService';
import { successResponse, errorResponse, validationError, notFoundError, internalError } from '../utils/responseHelpers';

export function createCrawlerRouter(deps: { upload: any }) {
    const router = Router();

    // Models
    router.get('/models', (_req, res) => {
        successResponse(res, {
            models: getAllowedDiscoveryModels(),
            defaultModel: getAllowedDiscoveryModels()[0] || config.ai.defaultModel,
            cloudFallbackEnabled: config.discovery.allowCloudFallback,
        });
    });

    // Preflight
    router.post('/preflight', async (req, res) => {
        try {
            const crawler = new CrawlerService();
            const request = normalizeDiscoveryRequest(req.body);
            const result = await crawler.preflightLogin(request);
            res.status(result.success ? 200 : 400).json({ data: result });
        } catch (err: any) {
            errorResponse(res, 400, 'INVALID_INPUT', err.message);
        }
    });

    // Discover
    router.post('/discover', async (req, res) => {
        try {
            const resumeRunId = req.body.resumeRunId;
            let request = normalizeDiscoveryRequest(req.body);
            let runId = '';

            if (resumeRunId) {
                const existingRun = await DiscoveryRunService.getById(resumeRunId);
                if (!existingRun || !existingRun.hasCheckpoint) {
                    return errorResponse(res, 400, 'INVALID_INPUT', 'No checkpoint found for Run ID: ' + resumeRunId);
                }
                runId = resumeRunId;
                request = normalizeDiscoveryRequest({
                    ...existingRun.config,
                    ...req.body
                });
            } else {
                const run = await DiscoveryRunService.create(toSafeDiscoveryConfig(request));
                runId = run.id;
            }

            const crawler = new CrawlerService();

            crawler.startDiscovery(request, runId).catch(err => {
                console.error('[Crawler] Background error:', err);
            });

            successResponse(res, {
                message: resumeRunId ? 'Discovery resumed.' : 'Discovery started in background.',
                runId: runId,
            });
        } catch (err: any) {
            errorResponse(res, 400, 'INVALID_INPUT', err.message);
        }
    });

    // Import harvester
    router.post('/import-harvester', deps.upload.single('file'), async (req, res) => {
        if (!req.file) return errorResponse(res, 400, 'INVALID_INPUT', 'No file uploaded');
        try {
            const html = await fs.promises.readFile(req.file.path, 'utf8');
            const elements = HarvesterParserService.parseHtmlReport(html);
            await ElementRepositoryService.addElements(elements);
            try { await fs.promises.unlink(req.file.path); } catch (e) { }
            successResponse(res, { message: `Successfully imported ${elements.length} elements from Harvester report.`, count: elements.length });
        } catch (err: any) {
            console.error('[Crawler] Harvester import failed:', err);
            errorResponse(res, 500, 'SERVICE_ERROR', 'Failed to process Harvester report', err.message);
        }
    });

    // Runs listing
    router.get('/runs', (_req, res) => {
        successResponse(res, DiscoveryRunService.list());
    });

    // Single run
    router.get('/runs/:id', (req, res) => {
        const run = DiscoveryRunService.getById(req.params.id);
        if (!run) {
            return notFoundError(res, 'Discovery run');
        }
        return successResponse(res, run);
    });

    // Screenshot
    router.get('/screenshot/:runId/:filename', (req, res) => {
        const { runId, filename } = req.params;
        const filePath = path.join(getDiscoveryStorageDir(), 'screenshots', runId, filename);
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            const legacyPath = path.join(getDiscoveryStorageDir(), 'screenshots', filename);
            if (fs.existsSync(legacyPath)) {
                res.sendFile(legacyPath);
            } else {
                notFoundError(res, 'Screenshot');
            }
        }
    });

    return router;
}
