import { Router } from 'express';
import { appLogger } from '../utils/logger';
import { z } from 'zod';
import { DbClient } from '../services/shared/TelemetryService';
import { LocalAIService } from '../../api/LocalAIService';
import { KnowledgeService } from '../../api/KnowledgeService';
import { MultiAgentRouter } from '../../api/MultiAgentRouter';
import { TestingGenerationService as Phase3PlaywrightGenerationService } from '../services/generation/TestingGenerationService';
import { DetectiveDispatcher } from '../../api/DetectiveDispatcher';
import { UnifiedSkillResolver, SkillQuery } from '../services/skills/UnifiedSkillResolver';
import { IstqbKnowledgeService, ISTQB_STANDARDS } from '../../api/IstqbKnowledgeService';
import { UsageTrackerService } from '../services/shared/UsageTrackerService';
import { capPromptWithWarning } from '../utils/PromptUtils';
import { getCachedResponse, setCachedResponse } from '../services/shared/AICache';
import { validateChat } from '../middleware/aiValidation';

import { SearchQuerySchema } from '../../api/utils/requestUtils';
import { successResponse, errorResponse, validationError, notFoundError, internalError } from '../../api/utils/responseHelpers';

// Local schema for Phase 3 since the old import is gone
const Phase3GenerateSchema = z.object({
    ticketId: z.string(),
    summary: z.string(),
    description: z.string(),
    module: z.string(),
    baseUrl: z.string().optional(),
    model: z.string().optional()
});

export function createAiRouter(deps: { pool: DbClient, aiLimiter: any }) {
    const router = Router();

    router.post('/external-results', async (req, res) => {
        const { tool, results } = req.body;
        if (!tool || !results) return errorResponse(res, 400, 'INVALID_INPUT', 'Tool name and results required');
        try {
            const id = await DetectiveDispatcher.ingestExternal(tool, results, deps.pool);
            successResponse(res, { id, message: `Intelligence from ${tool} captured` }, { status: 201 });
        } catch (err: any) { internalError(res, 'Failed to ingest external data'); }
    });

    router.get('/search', async (req, res) => {
        const validationResult = SearchQuerySchema.safeParse(req.query);
        if (!validationResult.success) return errorResponse(res, 400, 'INVALID_INPUT', 'Validation failed');
        try {
            const docs = await KnowledgeService.findRelevantDocs(validationResult.data.q);
            successResponse(res, { docs });
        } catch (err: any) { internalError(res, 'Search failed'); }
    });

    router.post('/generate-test', deps.aiLimiter, async (req, res) => {
        const { requirements } = req.body;
        if (!requirements || typeof requirements !== 'string') return errorResponse(res, 400, 'INVALID_INPUT', 'Requirements required');
        try {
            const result = await LocalAIService.generateTest(requirements);
            successResponse(res, { testCode: result.response, modelUsed: result.modelUsed, status: result.status });
        } catch (err: any) { internalError(res, 'Test generation failed'); }
    });

    router.post('/phase3/generate-playwright', deps.aiLimiter, async (req, res) => {
        const parsed = Phase3GenerateSchema.safeParse(req.body);
        if (!parsed.success) {
            return validationError(res, parsed.error.issues);
        }
        try {
            if (req.body.model) {
                MultiAgentRouter.setRoleOverride('CODER', req.body.model);
            }
            // Use static method generateAndSave from the renamed service
            const result = await (Phase3PlaywrightGenerationService as any).generateAndSave(parsed.data);
            if (req.body.model) MultiAgentRouter.clearRoleOverrides();
            successResponse(res, { ...result });
        } catch (err: any) {
            errorResponse(res, 500, 'SERVICE_ERROR', 'Phase 3 script generation failed', err.message);
        }
    });

    router.get('/agent-profiles', async (req, res) => {
        try {
            successResponse(res, MultiAgentRouter.getConfig());
        } catch (err: any) {
            internalError(res, 'Failed to fetch agent profiles');
        }
    });

    router.post('/agent-profiles', async (req, res) => {
        try {
            MultiAgentRouter.saveConfig(req.body);
            successResponse(res, { message: 'Agent profiles updated successfully' });
        } catch (err: any) {
            internalError(res, 'Failed to update agent profiles');
        }
    });

    router.post('/chat', deps.aiLimiter, validateChat, async (req, res) => {
        try {
            const { message, context, mode } = req.body;

            // 1. Build Persona
            const isDetective = mode === 'testing';
            const persona = isDetective 
                ? `You are the "Digital Detective", a high-end Forensic QA Agent for GlobalHR Cloud ERP. 
                   Your tone is sharp, professional, and observant. 
                   Focus on finding bugs, validation rules, and acceptance criteria. 
                   If the user asks to test a ticket, provide technical QA guidance.`
                : `You are a "Pro Productivity Assistant". Your tone is helpful, encouraging, and concise. 
                   Help the user with general tasks, code, or knowledge lookup.`;

            // 2. Build Context-Aware Prompt
            let prompt = `${persona}\n\nUser Message: ${message}`;
            let history = '';
            
            if (context && Array.isArray(context)) {
                const recentContext = context.slice(-3);
                history = recentContext.map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
                prompt = `${persona}\n\n--- Conversation History ---\n${history}\n\nCurrent User Message: ${message}\nAssistant:`;
            }

            // 3. Force specialized response for Detective mode
            const finalPrompt = isDetective 
                ? `### FORCED SYSTEM ROLE: DIGITAL DETECTIVE (FORENSIC QA) ###
                   ${persona}
                   
                   CONTEXT: You are analyzing a GlobalHR ERP ticket. 
                   GOAL: You MUST identify if the user wants to test a specific Jira ID.
                   IF TICKET FOUND: Provide a technical mission plan.
                   IF NO TICKET: Ask for the ID politely but firmly.
                   
                   Conversation History:
                   ${history}
                   
                   CURRENT USER REQUEST: ${message}
                   DETECTIVE VERDICT:`
                : prompt;

            // 4. Bypass cache for specialized modes to prevent "Old Chat" ghosting
            let result;
            if (isDetective) {
                appLogger.info('[AI Router] Detective Mode active - bypassing cache for live reasoning');
                result = await LocalAIService.generateFull(finalPrompt);
            } else {
                const cached = await getCachedResponse(deps.pool, finalPrompt);
                if (cached) {
                    // Reconstruct a result-like object from cache
                    result = { response: cached, profile: 'cache', model: 'cached', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
                } else {
                    result = await LocalAIService.generateFull(finalPrompt);
                    if (result && result.response) {
                        await setCachedResponse(deps.pool, finalPrompt, 'auto', result.response);
                    }
                }
            }

            // Track usage
            if (result) {
                UsageTrackerService.logUsage({
                    model: result.model || 'auto',
                    taskType: 'chat',
                    endpoint: '/api/ai/chat',
                    inputChars: prompt.length,
                    outputChars: result.response?.length || 0,
                    usage: result.usage
                }).catch(() => {});
            }

            if (!result || !result.response) {
                return errorResponse(res, 500, 'SERVICE_ERROR', 'AI service unavailable', { hint: 'Check if Gemini CLI / Qwen CLI are installed or OPENROUTER_API_KEY is set.' });
            }

            successResponse(res, { 
                response: result.response,
                usage: result.usage,
                model: result.model,
                profile: result.profile
            });
        } catch (err: any) {
            appLogger.error('[AI Router] Chat failed', { module: 'AIRouter', error: err.message });
            internalError(res, 'AI Chat failed');
        }
    });

    // -----------------------------------------------------------------------
    // Unified Skill Query
    // -----------------------------------------------------------------------

    router.post('/skills/resolve', deps.aiLimiter, async (req, res) => {
        try {
            const { issueType, module, keywords, includeISTQB = true, maxResults = 15 } = req.body as SkillQuery & { maxResults?: number };
            const skills = await UnifiedSkillResolver.resolve({ issueType, module, keywords, includeISTQB });
            successResponse(res, { skills: skills.slice(0, maxResults), total: skills.length });
        } catch (err: any) {
            internalError(res, 'Skill resolution failed');
        }
    });

    // -----------------------------------------------------------------------
    // ISTQB Knowledge
    // -----------------------------------------------------------------------

    router.get('/istqb/standards', async (req, res) => {
        try {
            successResponse(res, {
                standards: ISTQB_STANDARDS,
                promptInjection: IstqbKnowledgeService.getPromptInjection()
            });
        } catch (err: any) {
            internalError(res, 'Failed to fetch ISTQB standards');
        }
    });

    return router;
}
