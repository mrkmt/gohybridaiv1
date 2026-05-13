import { ContextManager } from './ContextManager';
import { SkillRegistry } from './SkillRegistry';
import { AgentOrchestrator, AgentType } from './AgentOrchestrator';
import type { AgentResult as OrchestratorResult } from './AgentOrchestrator';
import { config } from './config';
import { CliAgentService } from './CliAgentService';
import { MultiAgentRouter, AgentResult as RouterResult } from './MultiAgentRouter';

export interface AIResponse {
    suggestion: string;
    confidence: number;
    metadata?: any;
}

interface CachedAIResponse {
    response: string;
    modelUsed: string;
    status: 'success' | 'fallback' | 'error';
    agent?: string;
    timestamp: number;
    ttl: number;
}

export class LocalAIService {
    private static DEFAULT_MODEL = config.ai.defaultModel;
    private static TIMEOUT_MS = config.ai.timeoutMs;

    // Response cache
    private static responseCache = new Map<string, CachedAIResponse>();
    private static readonly CACHE_TTL = 1_800_000; // 30 minutes

    /**
     * Generates a triage suggestion using skills and agentic orchestration.
     */
    static async suggestRootCause(context: {
        steps: any[],
        error: string,
        appVersion: string,
        annotations?: any[],
        expectedResults?: any,
        domSnapshot?: string,
        a11ySnapshot?: any
    }, options?: { includeCloud?: boolean }): Promise<OrchestratorResult> {
        const cacheKey = `triage:${this.hash(context.error)}:${context.appVersion}`;
        const cached = this.responseCache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < cached.ttl) {
            return {
                response: cached.response,
                modelUsed: cached.modelUsed,
                status: cached.status as 'success' | 'fallback' | 'error',
                agent: cached.agent,
                fromCache: true,
            } as OrchestratorResult & { fromCache: boolean };
        }

        // Use multi-agent approach for more sophisticated analysis
        const result = await AgentOrchestrator.executeRootCauseAnalysis(
            context.error,
            context.steps,
            context.annotations,
            context.expectedResults,
            { 
                includeCloud: options?.includeCloud ?? false,
                domSnapshot: context.domSnapshot,
                a11ySnapshot: context.a11ySnapshot
            }
        );

        // Cache the result
        this.responseCache.set(cacheKey, {
            response: result.response,
            modelUsed: result.modelUsed,
            status: result.status,
            agent: result.agent,
            timestamp: Date.now(),
            ttl: this.CACHE_TTL,
        });

        return result;
    }

    /**
     * Generates a Playwright test based on requirements using multi-agent collaboration.
     */
    static async generateTest(requirements: string): Promise<OrchestratorResult> {
        const cacheKey = `testgen:${this.hash(requirements)}`;
        const cached = this.responseCache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < cached.ttl) {
            return {
                response: cached.response,
                modelUsed: cached.modelUsed,
                status: cached.status as 'success' | 'fallback' | 'error',
                agent: cached.agent,
                fromCache: true,
            } as OrchestratorResult & { fromCache: boolean };
        }

        const result = await AgentOrchestrator.executeTestGeneration(requirements);

        // Cache the result
        this.responseCache.set(cacheKey, {
            response: result.response,
            modelUsed: result.modelUsed,
            status: result.status,
            agent: result.agent,
            timestamp: Date.now(),
            ttl: this.CACHE_TTL,
        });

        return result;
    }

    /**
     * Executes a simple generation task.
     * All requests are routed through MultiAgentRouter (Puter/Groq/OpenRouter).
     */
    static async simpleGenerate(prompt: string, model?: string, options?: { timeoutMs?: number }): Promise<string> {
        const result = await this.generateFull(prompt, model, options);
        return result.response;
    }

    /**
     * Executes a generation task and returns the full RouterResult (including usage).
     */
    static async generateFull(prompt: string, model?: string, options?: { timeoutMs?: number }): Promise<RouterResult> {
        const timeoutMs = options?.timeoutMs || config.ai.timeoutMs || 60000;
        
        const executeWithTimeout = async (roleOrProfile: string, isRole: boolean) => {
            return Promise.race([
                isRole 
                    ? MultiAgentRouter.route(roleOrProfile, prompt, false, timeoutMs)
                    : MultiAgentRouter.routeWithProfile(roleOrProfile, prompt, false, timeoutMs),
                new Promise<RouterResult>((_, reject) => 
                    setTimeout(() => reject(new Error(`AI generation timed out after ${timeoutMs}ms`)), timeoutMs)
                )
            ]);
        };

        try {
            // 1. If a specific model profile name is provided, use it
            if (model && !model.includes(':')) {
                return await executeWithTimeout(model, false);
            }

            // 2. Default: Route by CODE role
            return await executeWithTimeout('CODE', true);
        } catch (err: any) {
            console.error('Generation failed:', err.message);
            if (err.message.includes('timed out')) throw err;

            // Fallback to a secondary role instead of a broken CLI
            console.log('[Local AI] Falling back to QUICK role...');
            try {
                return await executeWithTimeout('QUICK', true);
            } catch (fallbackErr: any) {
                console.error('[Local AI] Fallback also failed:', fallbackErr.message);
                throw fallbackErr;
            }
        }
    }

    /**
     * Proposes a fix for a failed selector.
     * Uses MultiAgentRouter instead of direct Ollama calls.
     */
    static async repairSelector(oldSelector: string, domSnapshot: string): Promise<string> {
        const prompt = SkillRegistry.executeSkill("SELECTOR_REPAIR", {
            oldSelector: oldSelector,
            dom: domSnapshot
        });
        const trimmedPrompt = ContextManager.trimContext(prompt);

        try {
            // Route through MultiAgentRouter for selector repair
            const result = await MultiAgentRouter.route('CODER', trimmedPrompt, true);
            return result.response;
        } catch (err: any) {
            console.error('Selector repair failed:', err.message);

            // Fallback to original selector if repair fails
            return JSON.stringify({ bestSelector: oldSelector, confidence: 0, error: err.message });
        }
    }

    /**
     * Gets embeddings for semantic search in local knowledge.
     * Uses OpenRouter API (openai/text-embedding-3-small) via config.
     * Throws if OPENROUTER_API_KEY is not configured — no local fallback.
     */
    static async getEmbeddings(text: string): Promise<number[]> {
        const apiKey = config.ai.openRouterApiKey;
        if (!apiKey) {
            throw new Error('OPENROUTER_API_KEY is required for embeddings. Set it in .env or config.');
        }
        return this.getEmbeddingsViaOpenRouter(text, apiKey);
    }

    /**
     * Gets embeddings via OpenRouter API (openai/text-embedding-3-small).
     */
    private static async getEmbeddingsViaOpenRouter(text: string, apiKey: string): Promise<number[]> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15_000);

        const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'GoHybridAI',
            },
            body: JSON.stringify({
                model: 'openai/text-embedding-3-small',
                input: text,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`OpenRouter embeddings returned ${response.status}: ${body.substring(0, 200)}`);
        }

        const data = await response.json() as {
            data: Array<{ embedding: number[]; index: number }>;
        };

        if (!data.data || data.data.length === 0) {
            throw new Error('OpenRouter returned empty embeddings array');
        }

        const embedding = data.data[0].embedding;
        console.log(`[LocalAIService] OpenRouter embeddings OK (${embedding.length} dims)`);
        return embedding;
    }

    /**
     * Clears the response cache.
     */
    static clearCache(): void {
        this.responseCache.clear();
    }

    /**
     * Gets cache statistics.
     */
    static getCacheStats(): { size: number } {
        return { size: this.responseCache.size };
    }

    private static hash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(36);
    }
}