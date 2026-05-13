import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import { ContextManager } from './ContextManager';
import { config } from './config';
import { CloudAIService } from './CloudAIService';
import { BurmeseTranslator } from './BurmeseTranslator';
import { MultiAgentRouter } from './MultiAgentRouter';
import { VisionNavigatorService, NavigatorAction } from './VisionNavigatorService';

export interface AgentResult {
    response: string; // Summarized Anomaly (Local AI)
    cloudVerdict?: string; // Human-readable final verdict (Cloud AI)
    modelUsed: string;
    status: 'success' | 'fallback' | 'error';
    agent?: string;
    fromCache?: boolean;
}

export interface MultiAgentTask {
    task: string;
    context: any;
    agents: AgentType[];
}

export enum AgentType {
    ARCHITECT = 'architect',
    CODER = 'coder',
    REVIEWER = 'reviewer',
    ANALYST = 'analyst'
}

export interface AgentProfile {
    name: AgentType;
    role: string;
    model: string;
    promptPrefix: string;
}

import { UnifiedAIOrchestrator, TaskType } from './UnifiedAIOrchestrator';

export class AgentOrchestrator {
    private static PRIMARY_MODEL = config.ai.defaultModel;
    private static FALLBACK_MODEL = config.ai.fallbackModel;

    private static LOG_FILE = path.join(__dirname, '../../debug_orchestrator.log');

    static log(msg: any) {
        const text = typeof msg === 'object' ? JSON.stringify(msg, null, 2) : msg;
        const line = `[${new Date().toISOString()}] ${text}\n`;
        try {
            const logDir = path.dirname(this.LOG_FILE);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            fs.promises.appendFile(this.LOG_FILE, line).catch(() => { });
        } catch (e) {
            // ignore fs errors
        }
        console.log(text);
    }

    static init() {
        this.log(`[Orchestrator] Initialized with Unified AI Orchestrator`);
    }

    /**
     * Executes a Hybrid Detective Investigation:
     * 1. Burmese Translator (Preprocessing)
     * 2. Unified AI Orchestrator (Reasoning) - Intelligent routing between Qwen/Gemini CLI.
     */
    static async executeRootCauseAnalysis(
        error: string,
        steps: any[],
        annotations: any[] = [],
        expectedResults: any = {},
        options?: { includeCloud?: boolean, domSnapshot?: string, a11ySnapshot?: any }
    ): Promise<AgentResult> {
        this.init();
        this.log(`[Hybrid Orchestrator] Starting Multilingual Investigation...`);

        try {
            // STEP 0: Burmese Translation
            const annotationText = JSON.stringify(annotations);
            let translatedAnnotations = annotationText;

            if (annotations && annotations.length > 0 && annotationText.trim() !== '[]' && annotationText.trim() !== '') {
                translatedAnnotations = await BurmeseTranslator.translateToForensicEnglish(annotationText);
                this.log(`[Orchestrator] Translated Annotations: ${translatedAnnotations}`);
            }

            // STEP 1: Unified AI Analysis (Reasoning Task)
            const localPrompt = `
                ### Task: Identify Anomalies for Chief Investigator
                CRITICAL: Pay special attention to USER ANNOTATIONS. These are explicit bug reports from a human tester.
                Compare the following execution steps with user annotations (translated). 
                If an annotation says something is "wrong", "failure", or a "mismatch", consider it a high-probability BUG.
                
                Error Trace: ${error}
                User Annotations: ${translatedAnnotations}
                Target Steps (Last 3): ${JSON.stringify(steps.slice(-3))}
                
                ${options?.domSnapshot ? `## DOM Snapshot Context:\n${options.domSnapshot.substring(0, 15000)}...` : ''}
                ${options?.a11ySnapshot ? `## Accessibility Tree Context:\n${JSON.stringify(options.a11ySnapshot, null, 2).substring(0, 5000)}...` : ''}

                Provide a CONCISE summary of findings. If you see a bug mentioned in annotations, use the word "BUG" or "VIOLATION" in your summary.
            `;

            this.log(`[UnifiedAI] Analyzing anomalies via intelligent routing...`);
            const analysis = await UnifiedAIOrchestrator.generate(localPrompt, TaskType.REASONING);
            this.log(`[Orchestrator] Analysis complete.`);

            return {
                response: analysis,
                modelUsed: 'Unified-Hybrid (Qwen/Gemini CLI)',
                status: 'success',
                agent: 'detective-hybrid'
            };
        } catch (err: any) {
            this.log(`[Hybrid Orchestrator] Investigation failed: ${err.message}`);
            return {
                response: "Detective investigation failed.",
                modelUsed: 'none',
                status: 'error'
            };
        }
    }

    /**
     * Executes an autonomous mission using Vision-based navigation.
     * This is the "Best Approach" integration from research: AI that "sees" the UI.
     */
    static async executeAutonomousMission(goal: string, baseUrl: string): Promise<{ status: 'success' | 'failed', steps: NavigatorAction[] }> {
        this.log(`[Orchestrator] Launching autonomous mission: ${goal}`);
        
        // Lazy-load Playwright so the backend can start even if Playwright isn't installed correctly.
        // (In some environments `node_modules/playwright-core` may be incomplete and crash at import time.)
        // This defers the failure to the callsite and keeps the server bootable.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { chromium } = require('playwright');
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        try {
            await page.goto(baseUrl);
            const result = await VisionNavigatorService.navigate(page, goal);
            return result;
        } catch (err: any) {
            this.log(`[Orchestrator] Mission failed: ${err.message}`);
            return { status: 'failed', steps: [] };
        } finally {
            await browser.close();
        }
    }

    /**
     * Executes a test generation task using Unified AI Orchestrator.
     */
    static async executeTestGeneration(requirements: string): Promise<AgentResult> {
        this.init();

        // --- P2 #14: Proactive token usage check before AI call ---
        const fullPrompt = `
You are a senior Playwright test developer.
Generate a precise, reliable Playwright test in TypeScript.
Constraints:
- Prefer stable selectors and explicit waits only when necessary
- Keep it minimal but correct
- Output ONLY the test code (no markdown fences, no JSON)

REQUIREMENTS:
${requirements}
`;
        const tokenCheck = ContextManager.checkTokenUsage(fullPrompt, 4096, process.env.UNIFIED_AI_MODEL);
        if (!tokenCheck.withinLimit) {
            console.warn(`[AgentOrchestrator] Token overflow detected: ${tokenCheck.estimatedTokens}/${tokenCheck.overflowTokens} over limit. Auto-truncating.`);
        }

        const prompt = tokenCheck.suggestedTruncation || ContextManager.trimContext(fullPrompt, 4096, process.env.UNIFIED_AI_MODEL);

        try {
            const code = await UnifiedAIOrchestrator.generate(prompt, TaskType.CODE);
            return {
                response: code,
                modelUsed: 'Unified-Code (Qwen CLI)',
                status: 'success',
                agent: 'hybrid-coder'
            };
        } catch (err: any) {
            return {
                response: err?.message || 'Test generation failed.',
                modelUsed: 'none',
                status: 'error'
            };
        }
    }

    /**
     * Planner → Coder two-agent chain for cost-efficient test generation.
     *
     * Agent 1 (Planner — cheap/fast model like Qwen):
     *   Reads Jira ticket description + acceptance criteria.
     *   Outputs a structured plain-English JSON array of logical test steps.
     *
     * Agent 2 (Coder — smart model like Qwen CLI / Gemini CLI):
     *   Takes the Test Plan from Agent 1 + the Harvester UI Map.
     *   Uses MCP tools / DiscoveryCacheService to write Playwright code.
     *
     * This chain is cheaper and more accurate than one massive monolithic prompt.
     */
    static async executePlannerThenCoder(params: {
        ticketId: string;
        ticketTitle: string;
        ticketDescription: string;
        acceptanceCriteria?: string;
        moduleKnowledge?: string;  // DiscoveryCacheService prompt context
    }): Promise<{ plan: string; code: string }> {
        this.init();
        this.log(`[Planner→Coder] Starting two-agent chain for ${params.ticketId}...`);

        // ── Agent 1: PLANNER (cheap model — QUICK role = qwen) ──
        const plannerPrompt = `
You are a senior QA test planner.

## Context
Ticket: ${params.ticketId}
Title: ${params.ticketTitle}
Description: ${params.ticketDescription || 'N/A'}
Acceptance Criteria: ${params.acceptanceCriteria || 'N/A'}
${params.moduleKnowledge ? `\n## Module UI Knowledge\n${params.moduleKnowledge}` : ''}

## Task
Produce a structured test plan as a JSON array. Each element represents one logical test scenario.

### Output Format (STRICT JSON ONLY — no markdown, no explanation)
[
  {
    "scenario": "Happy path — create valid record",
    "steps": [
      "Navigate to the module page",
      "Click 'Add New' button",
      "Wait for the form dialog to open",
      "Fill required fields with valid test data",
      "Click 'Save' button",
      "Wait for success message",
      "Verify the new record appears in the grid"
    ]
  },
  {
    "scenario": "Validation — empty required fields",
    "steps": [
      "Navigate to the module page",
      "Click 'Add New' button",
      "Leave required fields empty",
      "Click 'Save' button",
      "Verify validation error messages appear"
    ]
  }
]

## Rules
- Keep steps in plain English — no code
- Include both positive and negative test scenarios
- Focus on what the user does, not how the UI works
- Return ONLY the JSON array
`.trim();

        this.log(`[Planner→Coder] Agent 1 (Planner) generating test plan...`);
        const plan = await UnifiedAIOrchestrator.generate(plannerPrompt, TaskType.QUICK);
        this.log(`[Planner→Coder] Agent 1 completed. Plan length: ${plan.length} chars`);

        // ── Agent 2: CODER (smart model — CODE role = qwen CLI) ──
        const coderPrompt = `
You are a senior Playwright test developer.

## Context
Ticket: ${params.ticketId}
Title: ${params.ticketTitle}

## Test Plan (from Planner Agent)
${plan}

${params.moduleKnowledge ? `\n## Module UI Knowledge (selectors, strategies, frameworks)\n${params.moduleKnowledge}` : ''}

## Task
Generate production-ready Playwright TypeScript test code that implements the test plan above.

## Rules
- Use \`test.describe\` and \`test\` blocks — one block per scenario from the plan
- Use stable selectors (getByRole, getByLabel, getByPlaceholder, getByText, then locator)
- Use explicit waits (waitForAngular, waitForLoadingMask) — NEVER waitForTimeout
- Include assertions with expect()
- Output ONLY the TypeScript code — no markdown fences, no explanation
- Import helpers from '../../tests/playwright/playwright-self-healing'
`;

        this.log(`[Planner→Coder] Agent 2 (Coder) generating Playwright code...`);
        const code = await UnifiedAIOrchestrator.generate(coderPrompt, TaskType.CODE);
        this.log(`[Planner→Coder] Agent 2 completed. Code length: ${code.length} chars`);

        return { plan, code };
    }

    /**
     * Adaptive token budgeting — estimates token size of the full context
     * and returns a truncated prompt that fits within the budget.
     *
     * @param contextPieces Array of context strings (Jira data, UI elements, rules)
     * @param maxTokens     Maximum tokens allowed (default: 4096 for tasks, 8192 for stories)
     * @returns             Truncated context that fits within budget
     */
    static computeTokenBudget(contextPieces: string[], maxTokens: number = 4096): string {
        // Rough token estimation: ~4 chars per token for English text
        const charsPerToken = 4;
        const maxChars = maxTokens * charsPerToken;

        const joined = contextPieces.join('\n\n');

        if (joined.length <= maxChars) {
            return joined;
        }

        // Intelligent truncation: keep most important pieces first
        // Priority order: Jira data > module knowledge > rules > old comments
        const sorted = [...contextPieces].sort((a, b) => {
            // Prioritize shorter pieces (likely more focused) and pieces with keywords
            const priority = (text: string) => {
                let score = 0;
                if (text.includes('Acceptance Criteria') || text.includes('Description')) score += 10;
                if (text.includes('selector') || text.includes('getBy')) score += 5;
                if (text.includes('STRICT RULES') || text.includes('Rules')) score += 3;
                return score;
            };
            return priority(b) - priority(a);
        });

        let result = '';
        for (const piece of sorted) {
            if ((result.length + piece.length + 2) > maxChars) {
                // Truncate this piece to fit
                const remaining = maxChars - result.length - 2;
                if (remaining > 100) {
                    result += '\n\n' + piece.slice(0, remaining);
                }
                break;
            }
            result += (result ? '\n\n' : '') + piece;
        }

        this.log(`[TokenBudget] Truncated context from ${joined.length} to ${result.length} chars (budget: ${maxChars})`);
        return result;
    }

    private static async executeMultiAgentTask(task: MultiAgentTask): Promise<AgentResult> {
        try {
            let currentContext: any = { ...task.context };
            let finalResponse = "";

            for (const agentType of task.agents) {
                // Fetch profile DYNAMICALLY inside the loop so overrides are respected
                const profile = await MultiAgentRouter.getProfileForRole(agentType.toUpperCase());
                if (!profile) {
                    this.log(`[MultiAgent] Skipping ${agentType} — profile not found.`);
                    continue;
                }
                const promptPrefix = this.getPromptPrefixForAgent(agentType);

                this.log(`[MultiAgent] Starting ${agentType} task using ${profile.name}...`);
                const agentPrompt = `${promptPrefix}\n\nTask: ${task.task}\n\nContext: ${JSON.stringify(currentContext)}`;
                const result = await this.callModel(profile.model, agentPrompt, true, agentType.toUpperCase());

                let parsedResult = result;
                try {
                    const jsonMatch = result.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        parsedResult = JSON.parse(jsonMatch[0]);
                    }
                } catch (e) { }

                currentContext[`${agentType}_output`] = parsedResult;
                currentContext.previousAgent = agentType;
                finalResponse = result;
                this.log(`[MultiAgent] ${agentType} completed.`);
            }

            const profiles = (await Promise.all(
                task.agents.map(a => MultiAgentRouter.getProfileForRole(a.toUpperCase()))
            )).filter(Boolean);
            return {
                response: finalResponse,
                modelUsed: profiles.map((p: any) => p.model).join(' + '),
                status: 'success',
                agent: 'multi-agent'
            };
        } catch (err) {
            console.error('Multi-agent task failed:', err);
            return {
                response: "Multi-agent collaboration failed.",
                modelUsed: 'none',
                status: 'error'
            };
        }
    }

    private static getPromptPrefixForAgent(type: AgentType): string {
        switch (type) {
            case AgentType.ARCHITECT: return "As a senior test architect, analyze the test requirements and create a comprehensive test plan.";
            case AgentType.CODER: return "As a senior test developer, implement the test code following best practices and ensuring reliability.";
            case AgentType.REVIEWER: return "As a quality assurance expert, review the test implementation for potential issues, stability concerns, and improvement opportunities.";
            case AgentType.ANALYST: return "As a root cause analysis expert, analyze the problem and provide a detailed solution.";
            default: return "";
        }
    }

    private static async callModel(model: string, prompt: string, structured: boolean, roleOverride?: string): Promise<string> {
        // --- P2 #14: Token usage check before model call ---
        const tokenCheck = ContextManager.checkTokenUsage(prompt, 8192, model);
        if (!tokenCheck.withinLimit) {
            console.warn(`[AgentOrchestrator] Token overflow in callModel(${model}): ${tokenCheck.estimatedTokens} tokens. Auto-truncating.`);
        }
        const finalPrompt = tokenCheck.suggestedTruncation || ContextManager.trimContext(prompt, 8192, model);
        const role = roleOverride || 'CODER';

        try {
            // Use MultiAgentRouter for model selection and API routing
            const result = await MultiAgentRouter.route(role, finalPrompt, structured);
            this.log(`[MultiAgent] ${role} routed to ${result.profile} (${result.model}). Tokens: ${result.usage.total_tokens}`);
            return result.response;
        } catch (error) {
            this.log(`[MultiAgent] Router failed for ${role}, trying cloud fallback`);

            try {
                // If CLI/Local fails, use Cloud Gemini as the final resilient layer
                return await CloudAIService.generate(finalPrompt);
            } catch (cloudError: any) {
                this.log(`[Critical Failure] All AI backends failed: ${cloudError.message}`);
                throw cloudError;
            }
        }
    }
}
