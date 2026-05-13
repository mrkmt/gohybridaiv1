import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { config } from '../config';
import {
    requireApiKey,
    sanitizeFilename,
    parseLimit,
    RecordingSchema,
    PipelineProcessSchema,
    ExecuteTestSchema,
    InvestigateSchema,
    InvestigateReviseSchema,
    KnowledgeTestQuerySchema,
    CacheInvalidateSchema,
    CustomPathsSchema,
    McpConfigureSchema,
} from '../utils/requestUtils';
import { successResponse, errorResponse, validationError, notFoundError, internalError } from '../utils/responseHelpers';
import { runPlaywrightTest, TestExecutionContext } from '../utils/secureRunner';
import { IntegrityService } from '../IntegrityService';
import { ReportingService } from '../ReportingService';
import { storageService } from '../StorageService';
import { ObjectRepoService } from '../ObjectRepoService';
import { VisualForensicsService } from '../VisualForensicsService';
import { MultiAgentRouter } from '../MultiAgentRouter';
import { ScriptGenerationService } from '../ScriptGenerationService';
import { InvestigationAgentService } from '../InvestigationAgentService';
import { EventDeduplicator } from '../EventDeduplicator';
import { SelectorNormalizer } from '../SelectorNormalizer';
import { SkillFormMatcher } from '../SkillFormMatcher';
import { ReproductionPlanRequestSchema, ReproductionPlanService } from '../ReproductionPlanService';
// Phase3PlaywrightGenerationService import removed — the stub was imported but
// never used in this router. New generation pipeline lives in
// src/services/generation/* (JsonTestGenerationService + JsonToPlaywrightCompiler).
import { PhaseOrchestratorService } from '../../src/services/shared/PhaseOrchestratorService';
import { DnsResolverService } from '../../src/services/DnsResolverService';
import { AiCachingService } from '../../src/services/AiCachingService';
import { KnowledgeService } from '../KnowledgeService';
import { SandboxController } from '../../src/controllers/SandboxController';
import { KBController } from '../../src/controllers/KBController';
import { StagingRulesController } from '../../src/controllers/StagingRulesController';
import { ActivityController } from '../../src/controllers/ActivityController';
import { TestUserController } from '../../src/controllers/TestUserController';
import { DraftController } from '../../src/controllers/DraftController';
import { SystemHealthService } from '../../src/services/shared/SystemHealthService';
import { UsageTrackerService } from '../../src/services/shared/UsageTrackerService';
import { PredictiveAnalyticsService } from '../../src/services/PredictiveAnalyticsService';
import { ElementRepositoryService } from '../../src/services/ElementRepositoryService';
import { ObjectRepositoryService } from '../../src/services/ObjectRepositoryService';
import { CustomSkillManager } from '../../src/services/skills/CustomSkillManager';
import { MCPServerIntegration } from '../../src/services/MCPServerIntegration';
import { TelemetryService } from '../../src/services/shared/TelemetryService';
import { JiraAutomationService } from '../../src/services/jira/JiraAutomationService';
import { AIProviderService } from '../AIProviderService';
import { LinkedTicketIntelligenceService } from '../../src/services/LinkedTicketIntelligenceService';

export interface CoreRouterDeps {
    pool: any;
    requireApiKey: typeof requireApiKey;
    upload: any;
}

export function createCoreRouter(deps: CoreRouterDeps) {
    console.log('[CoreRouter] Initializing core routes...');
    const router = Router();
    const reportingService = new ReportingService(deps.pool);

    // -----------------------------------------------------------------------
    // System Monitoring & Analytics (D1, A7, D3)
    // -----------------------------------------------------------------------

    router.get('/dashboard', async (req, res) => {
        try {
            // 1. System & AI Provider Health
            const health = await SystemHealthService.checkHealth(deps.pool);
            const aiProviders = AIProviderService.getCliStatuses();
            
            // 2. Usage Stats
            const usageToday = UsageTrackerService.getTodaySummary();
            const usageAllTime = UsageTrackerService.getSummary();
            
            // 3. Automation Stats (last 30 days)
            const statsQuery = `
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'passed') as passed,
                    COUNT(*) FILTER (WHERE status = 'failed') as failed
                FROM recordings
                WHERE created_at > NOW() - INTERVAL '30 days'
            `;
            const statsResult = await deps.pool.query(statsQuery);
            const stats = statsResult.rows[0];
            
            const total = parseInt(stats.total || '0');
            const passed = parseInt(stats.passed || '0');
            const failed = parseInt(stats.failed || '0');
            const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : '0%';

            // 4. Storage Info
            const storagePath = path.join(__dirname, '..', '..', 'local_storage');
            const storageExists = fs.existsSync(storagePath);

            successResponse(res, {
                system: {
                    status: health.status,
                    database: health.details.database,
                    localAI: health.details.localAI,
                    uptime: Math.floor(process.uptime()),
                    timestamp: new Date().toISOString()
                },
                aiProviders: aiProviders.map(p => ({
                    name: p.name,
                    status: p.installed && p.authenticated ? 'healthy' : 'degraded',
                    message: p.message,
                    version: p.version
                })),
                usage: {
                    today: {
                        tokens: usageToday.totalTokens,
                        cost: usageToday.totalCost,
                        calls: usageToday.totalCalls
                    },
                    allTime: {
                        tokens: usageAllTime.totalTokens,
                        cost: usageAllTime.totalCost
                    }
                },
                automation: {
                    totalTests30Days: total,
                    passRate,
                    failedCount: failed
                },
                storage: {
                    status: storageExists ? 'ACTIVE' : 'MISSING',
                    baseDir: 'local_storage/'
                }
            });
        } catch (err: any) {
            console.error('[Dashboard] Failed to aggregate data:', err);
            errorResponse(res, 500, 'DASHBOARD_ERROR', 'Failed to generate system dashboard', err.message);
        }
    });

    router.get('/analytics/predictive', async (req, res) => {
        try {
            const flakinessReport = await PredictiveAnalyticsService.getFlakinessReport();
            const trends = await PredictiveAnalyticsService.getTrendAnalysis(30);

            successResponse(res, {
                flakinessReport,
                trends,
                timestamp: new Date().toISOString()
            });
        } catch (err: any) {
            console.error('[Analytics] Predictive analytics error:', err);
            errorResponse(res, 500, 'ANALYTICS_ERROR', 'Failed to generate predictive analytics', err.message);
        }
    });

    router.get('/health/detailed', async (req, res) => {
        try {
            const health = await SystemHealthService.checkHealth(deps.pool);
            const cliStatuses = AIProviderService.getCliStatuses();
            
            const detailedStatus = {
                ...health,
                aiProviders: cliStatuses.map(s => ({
                    id: s.id,
                    name: s.name,
                    installed: s.installed,
                    authenticated: s.authenticated,
                    message: s.message
                }))
            };
            
            res.status(health.status === 'FAIL' ? 503 : 200).json(detailedStatus);
        } catch (err: any) {
            errorResponse(res, 500, 'HEALTH_CHECK_FAILED', 'Detailed health check failed', err.message);
        }
    });

    // -----------------------------------------------------------------------
    // KB / Staging Rules
    // -----------------------------------------------------------------------

    router.get('/kb/rules', (req, res) => KBController.getRules(req, res, deps.pool));
    router.post('/kb/rules', (req, res) => KBController.addRule(req, res, deps.pool));
    router.put('/kb/rules/:id', (req, res) => KBController.updateRule(req, res, deps.pool));
    router.delete('/kb/rules/:id', (req, res) => KBController.deleteRule(req, res, deps.pool));

    router.get('/kb/staging', (req, res) => StagingRulesController.getStagingRules(req, res, deps.pool));
    router.post('/kb/staging/approve-bulk', (req, res) => StagingRulesController.approveBulk(req, res, deps.pool));
    router.delete('/kb/staging/bulk', (req, res) => StagingRulesController.deleteBulk(req, res, deps.pool));

    router.post('/kb/extract', deps.upload.single('file'), async (req, res) => {
        if (!req.file) return errorResponse(res, 400, 'INVALID_INPUT', 'No file uploaded');
        try {
            const { DocumentParserService } = await import('../../src/skills/DocumentParserService');
            const parser = new DocumentParserService();
            parser.setPool(deps.pool);
            await parser.extractBusinessRules(req.file.path);
            try { await fs.promises.unlink(req.file.path); } catch (e) { }
            successResponse(res, { message: 'Knowledge Base extraction complete. Business rules stored in PostgreSQL.' });
        } catch (err: any) {
            console.error('[KB Extract] Failed:', err);
            errorResponse(res, 500, 'SERVICE_ERROR', 'Failed to extract business rules from document', err.message);
        }
    });

    // -----------------------------------------------------------------------
    // Knowledge
    // -----------------------------------------------------------------------

    router.post('/knowledge/test-query', (req, res) => {
        const qp = KnowledgeTestQuerySchema.safeParse(req.body);
        if (!qp.success) return validationError(res, qp.error.issues);
        SandboxController.handleTestQuery(req, res);
    });
    router.get('/knowledge/templates', (req, res) => SandboxController.getRandomTemplates(req, res));

    router.post('/knowledge/ingest', deps.upload.single('file'), async (req, res) => {
        if (!requireApiKey(req, res)) return;
        try {
            if (!req.file) return errorResponse(res, 400, 'INVALID_INPUT', 'No file uploaded');
            const content = await fs.promises.readFile(req.file.path, 'utf8');
            const targetDir = path.join(__dirname, '..', 'local_storage', 'knowledge');
            await fs.promises.mkdir(targetDir, { recursive: true });
            const safeFilename = sanitizeFilename(req.file.originalname);
            const targetPath = path.join(targetDir, safeFilename);
            await fs.promises.writeFile(targetPath, content, 'utf8');
            await fs.promises.unlink(req.file.path);
            successResponse(res, { success: true, message: `Knowledge ingested: ${safeFilename}` });
        } catch (err: any) { internalError(res, err.message); }
    });

    // -----------------------------------------------------------------------
    // Audit / Health / Activity / Usage / Object repo
    // -----------------------------------------------------------------------

    router.get('/audit/:id', async (req, res) => {
        const executionId = req.params.id;
        const standardId = req.query.standardId as string;
        if (!require('uuid').isUUID(executionId) || !standardId || !require('uuid').isUUID(standardId))
            return errorResponse(res, 400, 'INVALID_INPUT', 'Valid Execution and Standard IDs required');
        try {
            const auditReport = await IntegrityService.performForensicAudit(standardId, executionId, deps.pool);
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const executionData = (await deps.pool.query('SELECT screenshot_url, video_url, manual_snapshot_url, steps FROM recordings WHERE id = $1', [executionId])).rows[0];
            const standardData = (await deps.pool.query('SELECT screenshot_url, video_url, steps FROM recordings WHERE id = $1', [standardId])).rows[0];
            let visualDiffUrl = null;
            if (standardData.screenshot_url && executionData.screenshot_url) {
                const diffPath = await VisualForensicsService.generateVisualDiff(executionId, standardData.screenshot_url, executionData.screenshot_url);
                if (diffPath) visualDiffUrl = storageService.getPublicUrl(diffPath, baseUrl);
            }
            successResponse(res, {
                ...auditReport,
                assets: {
                    execution: {
                        screenshot: executionData.screenshot_url ? storageService.getPublicUrl(executionData.screenshot_url, baseUrl) : null,
                        video: executionData.video_url ? storageService.getPublicUrl(executionData.video_url, baseUrl) : null,
                        manual: executionData.manual_snapshot_url ? storageService.getPublicUrl(executionData.manual_snapshot_url, baseUrl) : null,
                        visualDiff: visualDiffUrl
                    },
                    standard: {
                        screenshot: standardData.screenshot_url ? storageService.getPublicUrl(standardData.screenshot_url, baseUrl) : null,
                        video: standardData.video_url ? storageService.getPublicUrl(standardData.video_url, baseUrl) : null,
                    }
                }
            });
        } catch (err: any) { errorResponse(res, 500, 'SERVICE_ERROR', 'Forensic audit failed', err.message); }
    });

    router.get('/health/system', async (req, res) => {
        const health = await SystemHealthService.checkHealth(deps.pool);
        res.status(health.status === 'FAIL' ? 503 : 200).json(health);
    });

    // S4-4: failure classification + self-heal telemetry snapshot.
    // Rolling in-memory counters; resets on server restart.
    router.get('/health/failure-telemetry', (_req, res) => {
        try {
            const { failureTelemetry } = require('../../src/services/execution/FailureClassificationService');
            res.json({ success: true, data: failureTelemetry.snapshot() });
        } catch (err: any) {
            errorResponse(res, 500, 'TELEMETRY_ERROR', 'Failed to read telemetry', err.message);
        }
    });

    // B5: Locator Knowledge Base stats and module-specific locators
    router.get('/testing/locator-kb/stats', async (req, res) => {
        try {
            const { SkillRegistryService } = await import('../../src/services/SkillRegistryService');
            const stats = SkillRegistryService.getStats();
            res.json(stats);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/testing/locator-kb/:module', async (req, res) => {
        try {
            const { SkillRegistryService } = await import('../../src/services/SkillRegistryService');
            const { module } = req.params;
            const { minConfidence } = req.query;
            const locators = SkillRegistryService.getModuleLocators(
                module,
                minConfidence ? parseFloat(minConfidence as string) : 0.5,
            );
            res.json({ module, locators });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.post('/testing/locator-kb/bootstrap', async (req, res) => {
        try {
            const { SkillRegistryService } = await import('../../src/services/SkillRegistryService');
            const count = await SkillRegistryService.bootstrapFromDiscoveryCache();
            res.json({ bootstrapped: count });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/activity/unified', (req, res) => ActivityController.getUnifiedFeed(req, res, deps.pool));

    router.get('/usage/summary', (req, res) => {
        const summary = UsageTrackerService.getSummary();
        const todaySummary = UsageTrackerService.getTodaySummary();

        // Get per-ticket breakdown if a ticketId is provided
        const ticketId = req.query.ticketId as string | undefined;
        let ticketUsage = null;
        if (ticketId) {
            ticketUsage = UsageTrackerService.getTicketUsage(ticketId);
        }

        successResponse(res, {
            allTime: summary,
            today: todaySummary,
            ...(ticketId && { ticket: ticketUsage })
        });
    });

    router.get('/usage/tickets', (_req, res) => {
        // Return top tickets by token usage
        const summary = UsageTrackerService.getSummary();
        const sorted = Object.entries(summary.byTicket)
            .map(([id, data]) => ({ ticketId: id, ...data }))
            .sort((a, b) => b.tokens - a.tokens)
            .slice(0, 50);
        successResponse(res, { tickets: sorted });
    });

    router.get('/object-repo', async (_req, res) => {
        successResponse(res, await ObjectRepositoryService.getAll());
    });

    // -----------------------------------------------------------------------
    // Linked Ticket Intelligence
    // -----------------------------------------------------------------------

    router.get('/linked-tickets/:ticketId', async (req, res) => {
        try {
            const links = await LinkedTicketIntelligenceService.getLinkedIssues(req.params.ticketId);
            successResponse(res, links);
        } catch (err: any) {
            errorResponse(res, 500, 'INTERNAL_ERROR', 'Failed to fetch linked tickets', err.message);
        }
    });

    router.get('/linked-tickets/:ticketId/context', async (req, res) => {
        try {
            const context = await LinkedTicketIntelligenceService.getFullContext(req.params.ticketId);
            successResponse(res, context);
        } catch (err: any) {
            errorResponse(res, 500, 'INTERNAL_ERROR', 'Failed to fetch linked ticket context', err.message);
        }
    });

    router.get('/linked-tickets/:ticketId/summary', async (req, res) => {
        try {
            const summary = await LinkedTicketIntelligenceService.summarizeForTestGeneration(req.params.ticketId);
            successResponse(res, { summary });
        } catch (err: any) {
            errorResponse(res, 500, 'INTERNAL_ERROR', 'Failed to generate summary', err.message);
        }
    });

    // -----------------------------------------------------------------------
    // Pipeline
    // -----------------------------------------------------------------------

    router.post('/pipeline/process', async (req, res) => {
        const parsed = PipelineProcessSchema.safeParse(req.body);
        if (!parsed.success) return validationError(res, parsed.error.issues);
        const { steps, ticketText, recordingUrl, menuNames } = parsed.data;

        try {
            const cleanSteps = EventDeduplicator.deduplicate(steps);
            const normalizedSteps = SelectorNormalizer.normalizeAll(cleanSteps);
            const uniqueSelectors = SelectorNormalizer.extractUniqueSelectors(normalizedSteps);
            const matchResult = SkillFormMatcher.match(
                uniqueSelectors,
                ticketText || '',
                recordingUrl || '',
                menuNames || []
            );

            successResponse(res, {
                cleanSteps: normalizedSteps,
                detectedForms: matchResult.detectedForms,
                detectedRules: matchResult.detectedRules,
                requirements: matchResult.allRequirements,
                issueType: matchResult.issueType
            });
        } catch (err: any) {
            console.error('[Pipeline] Processing failed:', err);
            internalError(res, 'Pipeline processing failed');
        }
    });

    // -----------------------------------------------------------------------
    // Test users / Drafts
    // -----------------------------------------------------------------------

    router.get('/test-users', (req, res) => TestUserController.list(req, res));
    router.post('/test-users', (req, res) => TestUserController.save(req, res));
    router.delete('/test-users/:id', (req, res) => TestUserController.delete(req, res));

    router.get('/drafts', (req, res) => DraftController.listDrafts(req, res));
    router.get('/drafts/:jiraId', (req, res) => DraftController.getDraft(req, res));
    router.post('/drafts', (req, res) => DraftController.saveDraft(req, res));

    // -----------------------------------------------------------------------
    // Object repository alternatives
    // -----------------------------------------------------------------------

    router.get('/object-repository/alternatives', async (req, res) => {
        const { name, originalSelector } = req.query;
        try {
            const query = `
                SELECT selector_fallbacks, selector_primary
                FROM object_repository
                WHERE name ILIKE $1 OR selector_primary = $2
                LIMIT 1
            `;
            const result = await deps.pool.query(query, [`%${name}%`, originalSelector]);

            if (result.rows.length > 0) {
                const row = result.rows[0];
                const fallbacks = Array.isArray(row.selector_fallbacks) ? row.selector_fallbacks : [];
                if (row.selector_primary && row.selector_primary !== originalSelector) {
                    fallbacks.unshift(row.selector_primary);
                }
                successResponse(res, { fallbacks });
            } else {
                successResponse(res, { fallbacks: [] });
            }
        } catch (err: any) {
            internalError(res, err.message);
        }
    });

    // --- Verification Hub (AI Heal Approval) ---
    
    // GET /api/repository/pending
    router.get('/repository/pending', async (_req, res) => {
        try {
            const all = await ObjectRepositoryService.getAll();
            const pending = all.filter((e: any) => e.status === 'pending_verification');
            successResponse(res, pending);
        } catch (error: any) {
            internalError(res, error.message);
        }
    });

    // POST /api/repository/approve/:id
    router.post('/repository/approve/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const userId = (req as any).user?.id || 'admin';
            const updated = await ObjectRepositoryService.approveHeal(id, userId);
            if (!updated) return notFoundError(res, 'Element');
            successResponse(res, updated, { meta: { message: 'Selector verified and approved' } });
        } catch (error: any) {
            internalError(res, error.message);
        }
    });

    // -----------------------------------------------------------------------
    // Logs / Skills / MCP
    // -----------------------------------------------------------------------

    router.get('/skills/custom', async (req, res) => {
        try {
            successResponse(res, CustomSkillManager.getAllSkills());
        } catch (err: any) {
            internalError(res, 'Failed to fetch custom skills');
        }
    });

    router.post('/skills/custom/paths', async (req, res) => {
        try {
            const spParsed = CustomPathsSchema.safeParse(req.body);
            if (!spParsed.success) return validationError(res, spParsed.error.issues);
            const { paths } = spParsed.data;
            CustomSkillManager.setCustomPaths(paths);
            successResponse(res, { message: 'Custom paths updated and skills reloaded', count: CustomSkillManager.getAllSkills().length });
        } catch (err: any) {
            internalError(res, 'Failed to update custom paths');
        }
    });

    router.get('/mcp/servers', async (req, res) => {
        try {
            successResponse(res, MCPServerIntegration.getServers());
        } catch (err: any) {
            internalError(res, 'Failed to fetch MCP servers');
        }
    });

    router.post('/mcp/servers/configure', async (req, res) => {
        try {
            const mcpParsed = McpConfigureSchema.safeParse(req.body);
            if (!mcpParsed.success) return validationError(res, mcpParsed.error.issues);
            const { servers } = mcpParsed.data;
            await MCPServerIntegration.configureServers(servers as any);
            successResponse(res, { message: 'MCP servers configured successfully' });
        } catch (err: any) {
            internalError(res, 'Failed to configure MCP servers');
        }
    });

    router.get('/mcp/tools', async (req, res) => {
        try {
            successResponse(res, MCPServerIntegration.getAllTools());
        } catch (err: any) {
            internalError(res, 'Failed to fetch MCP tools');
        }
    });

    // -----------------------------------------------------------------------
    // AI providers status
    // -----------------------------------------------------------------------

    router.get('/ai-providers/status', async (req, res) => {
        try {
            const routerConfig = MultiAgentRouter.getConfig();
            const status: any = {};

            if (routerConfig?.profiles) {
                for (const profile of routerConfig.profiles) {
                    status[profile.name] = {
                        apiType: profile.apiType,
                        model: profile.model,
                        isHealthy: true,
                        isLocal: false,
                        description: profile.description || ''
                    };
                }
            }

            try {
                const cliStatuses = AIProviderService.getCliStatuses();
                for (const cli of cliStatuses) {
                    const cliKey = `${cli.name} (${cli.installed ? 'installed' : 'not found'})`;
                    if (!status[cli.name]) {
                        status[cli.name] = {
                            apiType: 'cli',
                            model: cli.id,
                            isHealthy: cli.installed && cli.authenticated,
                            installed: cli.installed,
                            authenticated: cli.authenticated,
                            version: cli.version,
                            message: cli.message
                        };
                    }
                }
            } catch (cliErr) {
                console.warn('[API] CLI provider check skipped:', cliErr);
            }

            res.json(status);
        } catch (err: any) {
            internalError(res, 'Failed to fetch provider status');
        }
    });

    // -----------------------------------------------------------------------
    // Recordings (POST / DELETE)
    // -----------------------------------------------------------------------

    router.delete('/recordings/:id', async (req, res) => {
        if (!requireApiKey(req, res)) return;
        const id = req.params.id;
        if (!require('uuid').isUUID(id)) return errorResponse(res, 400, 'INVALID_INPUT', 'Invalid ID');
        try {
            const result: any = await deps.pool.query('DELETE FROM recordings WHERE id = $1', [id]);
            if ((result.rowCount ?? result.rows?.length ?? 0) === 0) return notFoundError(res, 'Recording');
            await storageService.deleteFolder(id).catch(() => { });
            successResponse(res, { message: 'Recording deleted' });
        } catch (err: any) { internalError(res, 'Failed to delete'); }
    });

    router.post('/recordings', async (req, res) => {
        if (!requireApiKey(req, res)) return;
        const validationResult = RecordingSchema.safeParse(req.body);
        if (!validationResult.success) return validationError(res, validationResult.error.issues);
        const { sessionId, appVersion, environment, steps, isAdmin, jiraId, testUrl, userId } = validationResult.data;
        const id = uuidv4();
        try {
            await deps.pool.query(
                `INSERT INTO recordings (id, session_id, app_version, environment, steps, is_admin, jira_id, test_url, user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
                [id, sessionId || '', appVersion || '', environment || 'testing', JSON.stringify(steps), isAdmin || false, jiraId || '', testUrl || '', userId || 'public']
            );
            successResponse(res, { id, message: 'Recording saved' }, { status: 201 });
        } catch (err: any) { errorResponse(res, 500, 'DATABASE_ERROR', 'Failed to save recording', err.message); }
    });

    // -----------------------------------------------------------------------
    // Investigate / Revise
    // -----------------------------------------------------------------------

    router.post('/investigate', async (req, res) => {
        if (!requireApiKey(req, res)) return;
        const invParsed = InvestigateSchema.safeParse(req.body);
        if (!invParsed.success) return validationError(res, invParsed.error.issues);
        const { jiraId, jiraData } = invParsed.data;
        try {
            const result = await InvestigationAgentService.investigate(jiraId, jiraData as any, deps.pool);
            successResponse(res, result);
        } catch (err: any) { internalError(res, 'Investigation failed'); }
    });

    router.post('/investigate/revise', async (req, res) => {
        const reviseParsed = InvestigateReviseSchema.safeParse(req.body);
        if (!reviseParsed.success) return validationError(res, reviseParsed.error.issues);
        const { jiraId, approvedChecklist, humanInput, targetEnv } = reviseParsed.data;
        try {
            const result = await InvestigationAgentService.revise(jiraId, approvedChecklist || [], humanInput, targetEnv || 'testing');
            successResponse(res, result);
        } catch (err: any) { internalError(res, 'Revision failed'); }
    });

    // -----------------------------------------------------------------------
    // Phase 2
    // -----------------------------------------------------------------------

    router.post('/phase2/reproduction-plan', async (req, res) => {
        const parsed = ReproductionPlanRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error.issues);
        }
        try {
            const result = await ReproductionPlanService.generateBddPlan(parsed.data);
            successResponse(res, {
                jiraId: parsed.data.jiraId,
                steps: result.steps,
                targetRuleId: result.targetRuleId,
                aiModel: result.aiModel
            });
        } catch (err: any) {
            internalError(res, 'Reproduction plan generation failed');
        }
    });

    // -----------------------------------------------------------------------
    // Cache
    // -----------------------------------------------------------------------

    router.get('/cache/stats', (_req, res) => {
        successResponse(res, AiCachingService.getStats());
    });

    router.post('/cache/invalidate/:jiraId', (req, res) => {
        const invParsed = CacheInvalidateSchema.safeParse({ jiraId: req.params.jiraId });
        if (!invParsed.success) return validationError(res, invParsed.error.issues);
        const removed = AiCachingService.invalidateForJiraId(req.params.jiraId);
        successResponse(res, { message: `Invalidated ${removed} cache entries for ${req.params.jiraId}` });
    });

    // -----------------------------------------------------------------------
    // Execute Playwright test
    // -----------------------------------------------------------------------

    router.post('/execute-test', async (req, res) => {
        if (!requireApiKey(req, res)) return;
        const parsedTest = ExecuteTestSchema.safeParse(req.body);
        if (!parsedTest.success) return validationError(res, parsedTest.error.issues);
        const { testScript, moduleName, targetRuleId, environment, baseUrl, customerId, credentials } = parsedTest.data;

        const saveExecutionRecord = async (
            testId: string,
            moduleName: string,
            environment: string,
            stepsPayload: string,
            status: string,
            baseUrl?: string
        ): Promise<boolean> => {
            try {
                await deps.pool.query(`
                    INSERT INTO recordings (
                        id, session_id, app_version, environment, steps, status, test_url, created_at
                    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())
                    ON CONFLICT (id) DO UPDATE SET
                        steps = EXCLUDED.steps, status = EXCLUDED.status, updated_at = NOW()
                `, [
                    testId,
                    `playwright-${Date.now()}`,
                    moduleName,
                    environment || 'testing',
                    stepsPayload,
                    status,
                    baseUrl || ''
                ]);
                return true;
            } catch (dbError: any) {
                console.warn('[API] Primary recording insert failed, retrying with reduced schema:', dbError.message);
                try {
                    await deps.pool.query(`
                        INSERT INTO recordings (id, session_id, app_version, steps, status, test_url, created_at)
                        VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW())
                    `, [
                        testId,
                        `playwright-${Date.now()}`,
                        moduleName,
                        stepsPayload,
                        status,
                        baseUrl || ''
                    ]);
                    return true;
                } catch (fallbackError: any) {
                    console.error('[API] Fallback recording insert failed:', fallbackError.message);
                    return false;
                }
            }
        };

        try {
            console.log(`[API] Executing test: ${moduleName} in ${environment}`);

            const normalizedBaseUrl = (baseUrl || 'http://localhost:4200').replace(/\/+$/, '');
            const testId = uuidv4();
            await saveExecutionRecord(
                testId,
                moduleName,
                environment || 'testing',
                JSON.stringify({ message: 'Execution initiated, waiting for results...' }),
                'running',
                normalizedBaseUrl
            );

            await SystemHealthService.cleanupZombieProcesses();
            await DnsResolverService.preflight(normalizedBaseUrl);

            if (credentials?.idNumber) {
                const locked = await TestUserController.lockUser(credentials.idNumber);
                if (!locked) {
                    console.warn(`[API] Test User ${credentials.idNumber} is currently in use. This test might cause a session kick-out.`);
                }
            }

            const execContext: TestExecutionContext = {
                baseUrl: normalizedBaseUrl,
                customerId: customerId || process.env.CUSTOMER_ID || undefined,
                testModule: moduleName,
                testEnv: environment || 'testing',
                idNumber: credentials?.idNumber || undefined,
                username: credentials?.username || undefined,
                password: credentials?.password || undefined,
            };

            const startTime = Date.now();
            let executionError: any = null;
            let stdout = '';
            let stderr = '';

            try {
                const runnerResult = await runPlaywrightTest(testScript, 300000, execContext);
                stdout = runnerResult.stdout;
                stderr = runnerResult.stderr;
            } catch (err: any) {
                console.error(`[API] Playwright execution failed: ${err.message}`);
                executionError = err;
            }

            const duration = Date.now() - startTime;

            const resultsJsonPath = path.join(__dirname, '..', 'test-results', 'results.json');
            const lastRunPath = path.join(__dirname, '..', 'test-results', '.last-run.json');

            let results: any = { status: 'passed', failedTests: [] };

            if (fs.existsSync(resultsJsonPath)) {
                try {
                    const rawResults = JSON.parse(await fs.promises.readFile(resultsJsonPath, 'utf8'));
                    const failedSpecs: any[] = [];
                    if (rawResults.suites) {
                        rawResults.suites.forEach((suite: any) => {
                            suite.suites?.forEach((subSuite: any) => {
                                subSuite.specs?.forEach((spec: any) => {
                                    if (!spec.ok) {
                                        const errorMsg = spec.tests?.[0]?.results?.[0]?.error?.message || 'Unknown failure';
                                        failedSpecs.push({
                                            title: spec.title,
                                            error: errorMsg,
                                            duration: spec.tests?.[0]?.results?.[0]?.duration
                                        });
                                    }
                                });
                            });
                        });
                    }
                    results = {
                        status: failedSpecs.length > 0 ? 'failed' : 'passed',
                        failedTests: failedSpecs
                    };
                } catch (pe) {
                    console.error('[API] Failed to parse results.json:', pe);
                }
            } else if (fs.existsSync(lastRunPath)) {
                try {
                    results = JSON.parse(fs.readFileSync(lastRunPath, 'utf8'));
                } catch (pe) {
                    console.error('[API] Failed to parse .last-run.json:', pe);
                }
            } else if (executionError) {
                results = { status: 'failed', failedTests: [{ title: 'Execution Error', error: executionError.message }] };
            }

            const executionStatus = results.status === 'passed' ? 'passed' : 'failed';
            const saved = await saveExecutionRecord(
                testId,
                moduleName,
                environment || 'testing',
                JSON.stringify({
                    testScript,
                    environment: environment || 'testing',
                    status: results.status,
                    failedTests: results.failedTests || [],
                    duration,
                    executedAt: new Date().toISOString()
                }),
                executionStatus,
                normalizedBaseUrl
            );

            if (targetRuleId) {
                await KBController.learnFromTestResult(targetRuleId, executionStatus, results.failedTests, deps.pool);
            } else if (moduleName && /^[A-Z]+-\d+$/.test(moduleName)) {
                await KBController.learnFromTestResult(moduleName, executionStatus, results.failedTests, deps.pool);
            }

            if (moduleName && /^[A-Z]+-\d+$/.test(moduleName)) {
                try {
                    const testCases = [{
                        caseId: 'MAIN_BUG',
                        title: 'Verification of reported issue flow',
                        status: executionStatus as 'passed' | 'failed' | 'error',
                        hasVideo: true,
                        screenshotPath: results.status !== 'passed' ? 'error-screenshot.png' : undefined
                    }];

                    const commentMatrix = ReportingService.generateJiraVerificationMatrix(moduleName, testCases, undefined);
                    await JiraAutomationService.addComment(moduleName, commentMatrix);
                } catch (e: any) {
                    console.error('[API] Failed to auto-comment to Jira:', e.message);
                }
            }

            console.log(`[API] Test completed${saved ? ` and saved: ${testId}` : ` but result was not persisted: ${testId}`}`);

            PhaseOrchestratorService.markPhase4Complete(moduleName, {
                status: results.status,
                testId,
                duration,
                failedTests: results.failedTests || []
            });

            successResponse(res, {
                testId,
                status: results.status,
                duration,
                failedTests: results.failedTests || [],
                reportUrl: '/storage/test-results/html-report/index.html'
            });

        } catch (error: any) {
            console.error('[API] Test execution failed:', error.message);

            const errorTestId = uuidv4();
            const saved = await saveExecutionRecord(
                errorTestId,
                moduleName || 'Unknown',
                environment || 'testing',
                JSON.stringify({
                    environment: environment || 'testing',
                    error: error.message
                }),
                'failed',
                baseUrl
            );

            if (!saved) {
                console.warn(`[API] Test failure was not persisted for ${errorTestId}`);
            }

            errorResponse(res, 500, 'INTERNAL_ERROR', error.message, { testId: errorTestId });
        } finally {
            if (credentials && credentials.idNumber) {
                try { await TestUserController.unlockUser(credentials.idNumber); }
                catch (e: any) { console.warn(`[API] Failed to unlock user: ${e.message}`); }
            }
        }
    });

    // -----------------------------------------------------------------------
    // Ingest steps
    // -----------------------------------------------------------------------

    router.post('/ingest-steps', async (req, res) => {
        const { steps, components, networkLogs, moduleName, jiraId, url, pageTitle, metadata } = req.body;
        if (!Array.isArray(steps) || steps.length === 0) {
            return errorResponse(res, 400, 'INVALID_INPUT', 'Steps array is required and cannot be empty');
        }
        try {
            const id = uuidv4();
            await deps.pool.query(
                `INSERT INTO recordings (id, session_id, app_version, environment, steps, jira_id, test_url, user_id)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
                [
                    id,
                    `harvester-${Date.now()}`,
                    moduleName || 'default',
                    'testing',
                    JSON.stringify(steps),
                    jiraId || '',
                    url || '',
                    'public'
                ]
            );
            console.log(`[API] Ingested ${steps.length} steps from Harvester (${id})`);
            successResponse(res, { id, message: 'Steps ingested successfully', stepsCount: steps.length }, { status: 201 });
        } catch (err: any) {
            console.error('[API] Ingest-steps failed:', err.message);
            errorResponse(res, 500, 'DATABASE_ERROR', 'Failed to ingest steps', err.message);
        }
    });

    // -----------------------------------------------------------------------
    // Discovery Strategy Settings
    // -----------------------------------------------------------------------

    const DISCOVERY_CONFIG_PATH = path.join(__dirname, '..', 'data', 'discovery-config.json');

    router.get('/settings/discovery', (_req, res) => {
        try {
            if (fs.existsSync(DISCOVERY_CONFIG_PATH)) {
                const stored = JSON.parse(fs.readFileSync(DISCOVERY_CONFIG_PATH, 'utf8'));
                successResponse(res, { config: stored });
            } else {
                // Return defaults from config
                const defaults = {
                    strategy: config.discovery.defaultStrategy,
                    sourceCodePath: '',
                    fallbackToExtension: true,
                    modules: {},
                };
                successResponse(res, { config: defaults });
            }
        } catch (err: any) {
            internalError(res, 'Failed to fetch discovery config');
        }
    });

    router.post('/settings/discovery', async (req, res) => {
        try {
            const body = req.body as {
                strategy?: string;
                sourceCodePath?: string;
                fallbackToExtension?: boolean;
                modules?: Record<string, { strategy: string }>;
            };
            const validStrategies = ['ai-first', 'source-code', 'extension', 'hybrid'];
            const strategy = body.strategy || 'hybrid';
            if (!validStrategies.includes(strategy)) {
                return errorResponse(res, 400, 'INVALID_INPUT', 'Invalid strategy', { allowed: validStrategies });
            }

            const sourceCodePath = (body.sourceCodePath || '').trim();
            const fallbackToExtension = body.fallbackToExtension !== false;
            const modules = (body.modules || {}) as Record<string, { strategy: string }>;

            const verifiedSourceCodePath = sourceCodePath ? fs.existsSync(sourceCodePath) : false;
            const configObj: Record<string, any> = {
                strategy,
                sourceCodePath,
                fallbackToExtension,
                modules,
                updatedAt: new Date().toISOString(),
            };

            // Validate source code path if set
            if (sourceCodePath) {
                const exists = fs.existsSync(sourceCodePath);
                if (!exists) {
                    console.warn(`[Discovery] Source code path not found: ${sourceCodePath}`);
                }
                configObj.sourceCodePath = sourceCodePath;
                configObj.sourceCodePathVerified = verifiedSourceCodePath;
            }

            fs.mkdirSync(path.dirname(DISCOVERY_CONFIG_PATH), { recursive: true });
            fs.writeFileSync(DISCOVERY_CONFIG_PATH, JSON.stringify(configObj, null, 2), 'utf8');

            successResponse(res, { config: configObj });
        } catch (err: any) {
            internalError(res, 'Failed to save discovery config');
        }
    });

    // -----------------------------------------------------------------------
    // Agent profiles reload
    // -----------------------------------------------------------------------

    router.post('/agent-profiles/reload', (_req, res) => {
        MultiAgentRouter.reload();
        successResponse(res, { config: MultiAgentRouter.getConfig() });
    });

    // -----------------------------------------------------------------------
    // Autonomous Discovery
    // -----------------------------------------------------------------------
    router.post('/discovery/auto-scan', async (req, res) => {
        const { baseUrl, credentials } = req.body;
        if (!baseUrl) return errorResponse(res, 400, 'INVALID_INPUT', 'baseUrl is required');

        // Start in background so the request doesn't timeout
        const { AutonomousCrawlerService } = require('../../src/services/AutonomousCrawlerService');
        AutonomousCrawlerService.crawlApplication(baseUrl, credentials, deps.pool)
            .then(() => console.log(`[Discovery] Auto-scan completed for ${baseUrl}`))
            .catch((err: any) => console.error(`[Discovery] Auto-scan failed: ${err.message}`));

        successResponse(res, { message: 'Autonomous discovery started in background' });
    });

    return router;
}
