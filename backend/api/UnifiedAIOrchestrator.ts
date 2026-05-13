import { CliAgentService } from './CliAgentService';
import { CircuitBreakerRegistry, CircuitBreakerError } from '../src/utils/CircuitBreaker';
import { AiControllerService } from '../src/services/shared/AiControllerService';

/**
 * Task types for intelligent model routing
 */
export enum TaskType {
    /** Code generation, refactoring, debugging */
    CODE = 'code',
    /** Complex reasoning, analysis, investigation */
    REASONING = 'reasoning',
    /** Documentation, explanations, summaries */
    DOCUMENTATION = 'documentation',
    /** Quick questions, factual queries */
    QUICK = 'quick',
    /** Test case generation */
    TEST_GENERATION = 'test_generation',
    /** Business logic analysis */
    BUSINESS_LOGIC = 'business_logic'
}

/**
 * Model capabilities and preferences
 */
export enum ModelPreference {
    /** Qwen CLI - Best for code generation and technical tasks */
    QWEN = 'qwen',
    /** Gemini CLI - Best for reasoning and complex analysis */
    GEMINI = 'gemini',
    /** Codex CLI - Best for specialized legacy code analysis */
    CODEX = 'codex',
    /** Playwright Agent — agent-assisted self-healing fallback */
    PLAYWRIGHT_AGENT = 'playwright_agent',
    /** Auto-select based on task type */
    AUTO = 'auto'
}

export interface OrchestratorConfig {
    /** Default model preference */
    defaultModel: ModelPreference;
    /** Enable automatic model selection based on task type */
    enableAutoRouting: boolean;
    /** Timeout for AI requests (ms) */
    timeoutMs: number;
    /** Fallback to other model if primary fails */
    enableFallback: boolean;
}

/**
 * Unified AI Orchestrator - Intelligently routes tasks between Gemini CLI, Qwen CLI and Codex CLI
 * 
 * Strategy:
 * - Qwen CLI: Code generation, technical tasks, quick responses
 * - Gemini CLI: Complex reasoning, analysis, investigation, business logic
 * - Codex CLI: Deep legacy code analysis
 */
export class UnifiedAIOrchestrator {
    private static config: OrchestratorConfig = {
        defaultModel: ModelPreference.AUTO,
        enableAutoRouting: true,
        timeoutMs: 300000, // 5 minutes
        enableFallback: true
    };

    /**
     * Model routing table - maps task types to preferred models
     */
    private static taskModelMap: Record<TaskType, ModelPreference> = {
        [TaskType.CODE]: ModelPreference.QWEN,
        [TaskType.REASONING]: ModelPreference.GEMINI,
        [TaskType.DOCUMENTATION]: ModelPreference.GEMINI,
        [TaskType.QUICK]: ModelPreference.QWEN,
        [TaskType.TEST_GENERATION]: ModelPreference.QWEN,
        [TaskType.BUSINESS_LOGIC]: ModelPreference.GEMINI
    };

    /**
     * Update orchestrator configuration
     */
    static configure(config: Partial<OrchestratorConfig>): void {
        this.config = { ...this.config, ...config };
        console.log('[UnifiedAI] Configuration updated:', this.config);
    }

    /**
     * Generate response using the optimal AI model.
     * Delegates to AiControllerService for clean role-based CLI routing.
     */
    static async generate(
        prompt: string,
        taskType: TaskType = TaskType.CODE,
        preferredModel?: ModelPreference
    ): Promise<string> {
        // Map task type to AiControllerService role
        const roleMap: Record<TaskType, string> = {
            [TaskType.CODE]: 'CODE',
            [TaskType.REASONING]: 'REASONING',
            [TaskType.DOCUMENTATION]: 'DOCUMENTATION',
            [TaskType.QUICK]: 'QUICK',
            [TaskType.TEST_GENERATION]: 'TEST_GENERATION',
            [TaskType.BUSINESS_LOGIC]: 'BUSINESS_LOGIC',
        };
        const role = roleMap[taskType] as Parameters<typeof AiControllerService.generate>[0];

        // If AiControllerService is available, use it (CLI-only, role-based)
        try {
            return await AiControllerService.generate(role, prompt);
        } catch (err: any) {
            console.warn('[UnifiedAI] AiControllerService failed, falling back to legacy routing:', err.message);
        }

        // Legacy fallback: use the old model selection logic
        const model = this.selectModel(taskType, preferredModel);
        console.log(`[UnifiedAI] Legacy routing ${taskType} task to ${model} CLI`);

        try {
            const breaker = model === 'qwen' ? CircuitBreakerRegistry.qwenCli() :
                           model === 'gemini' ? CircuitBreakerRegistry.geminiCli() :
                           CircuitBreakerRegistry.qwenCli();

            const result = await breaker.execute(async () => {
                return await CliAgentService.generateFromCli(prompt, model as 'qwen' | 'gemini' | 'codex');
            });

            console.log(`[UnifiedAI] ${model} CLI completed successfully`);
            return result;
        } catch (error: any) {
            console.error(`[UnifiedAI] ${model} CLI failed:`, error.message);

            if (error instanceof CircuitBreakerError) {
                console.warn(`[UnifiedAI] Circuit breaker OPEN for ${model}. Skipping fallback.`);
                throw error;
            }

            if (this.config.enableFallback) {
                const fallbackModel = model === 'qwen' ? 'gemini' : 'qwen';
                console.log(`[UnifiedAI] Falling back to ${fallbackModel} CLI...`);

                try {
                    const fallbackBreaker = fallbackModel === 'qwen' ? CircuitBreakerRegistry.qwenCli() : CircuitBreakerRegistry.geminiCli();
                    const fallbackResult = await fallbackBreaker.execute(async () => {
                        return await CliAgentService.generateFromCli(prompt, fallbackModel as 'qwen' | 'gemini' | 'codex');
                    });
                    console.log(`[UnifiedAI] Fallback to ${fallbackModel} succeeded`);
                    return fallbackResult;
                } catch (fallbackError: any) {
                    console.error(`[UnifiedAI] Fallback ${fallbackModel} also failed:`, fallbackError.message);
                    throw new Error(`Both AI models failed. Last error: ${fallbackError.message}`);
                }
            }

            throw error;
        }
    }

    /**
     * Select the best model for the given task type
     */
    private static selectModel(taskType: TaskType, preferredModel?: ModelPreference): 'qwen' | 'gemini' | 'codex' {
        // Explicit preference overrides auto-routing
        if (preferredModel && preferredModel !== ModelPreference.AUTO) {
            return preferredModel as 'qwen' | 'gemini' | 'codex';
        }

        // Auto-routing based on task type
        if (this.config.enableAutoRouting) {
            const mapped = this.taskModelMap[taskType];
            if (mapped && mapped !== ModelPreference.AUTO) {
                return mapped as 'qwen' | 'gemini' | 'codex';
            }
        }

        // Default fallback
        const def = this.config.defaultModel === ModelPreference.AUTO ? ModelPreference.QWEN : this.config.defaultModel;
        return def as 'qwen' | 'gemini' | 'codex';
    }

    /**
     * Code-focused generation (Qwen optimized)
     */
    static async generateCode(prompt: string): Promise<string> {
        return this.generate(prompt, TaskType.CODE, ModelPreference.QWEN);
    }

    /**
     * Reasoning-focused generation (Gemini optimized)
     */
    static async generateReasoning(prompt: string): Promise<string> {
        return this.generate(prompt, TaskType.REASONING, ModelPreference.GEMINI);
    }

    /**
     * Test case generation (Qwen optimized)
     */
    static async generateTest(prompt: string): Promise<string> {
        return this.generate(prompt, TaskType.TEST_GENERATION, ModelPreference.QWEN);
    }

    /**
     * Business logic analysis (Gemini optimized)
     */
    static async analyzeBusinessLogic(prompt: string): Promise<string> {
        return this.generate(prompt, TaskType.BUSINESS_LOGIC, ModelPreference.GEMINI);
    }

    /**
     * Dual-model analysis - Get perspectives from both models
     * Useful for complex investigations requiring multiple viewpoints
     */
    static async dualAnalysis(prompt: string): Promise<{ qwen: string; gemini: string }> {
        console.log('[UnifiedAI] Running dual-model analysis...');
        
        const [qwenResult, geminiResult] = await Promise.allSettled([
            CliAgentService.generateFromCli(prompt, 'qwen'),
            CliAgentService.generateFromCli(prompt, 'gemini')
        ]);

        const results = {
            qwen: qwenResult.status === 'fulfilled' ? qwenResult.value : '[Qwen failed]',
            gemini: geminiResult.status === 'fulfilled' ? geminiResult.value : '[Gemini failed]'
        };

        console.log('[UnifiedAI] Dual-model analysis complete');
        return results;
    }

    /**
     * Get model health status
     */
    static async getModelHealth(): Promise<{ qwen: boolean; gemini: boolean }> {
        const healthCheck = 'Respond with just "OK" if you are working.';
        
        const [qwenHealth, geminiHealth] = await Promise.allSettled([
            CliAgentService.generateFromCli(healthCheck, 'qwen'),
            CliAgentService.generateFromCli(healthCheck, 'gemini')
        ]);

        return {
            qwen: qwenHealth.status === 'fulfilled',
            gemini: geminiHealth.status === 'fulfilled'
        };
    }

    /**
     * Check if Playwright Agent service is available
     */
    static isPlaywrightAgentAvailable(): boolean {
        try {
            const { isAgentAvailable } = require('../src/services/PlaywrightAgentService');
            return isAgentAvailable();
        } catch {
            return false;
        }
    }
}
