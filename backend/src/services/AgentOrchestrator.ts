import { AiControllerService } from './shared/AiControllerService';
import { JsonGenerationOptions } from './generation/JsonTestGenerationService';
import { appLogger } from '../utils/logger';
import { TokenManagerService } from './TokenManagerService';
import * as fs from 'fs';
import * as path from 'path';

export interface OrchestrationResult {
    testPlan:  string;
    jsonSpec:  string;
    tokenUsage?: { prompt: number; completion: number; total: number };
}

export class AgentOrchestrator {

    static async orchestrateGeneration(options: JsonGenerationOptions): Promise<OrchestrationResult> {
        appLogger.info(`[AgentOrchestrator] Starting multi-agent flow for ${options.ticketId}...`);

        const phase1 = await this.generateTestPlanWithUsage(options);
        appLogger.info(`[AgentOrchestrator] Phase 1 (Planning) complete for ${options.ticketId}`);

        const phase2 = await this.generateJsonSpecWithUsage(phase1.response, options);
        appLogger.info(`[AgentOrchestrator] Phase 2 (Coding) complete for ${options.ticketId}`);

        const tokenUsage = {
            prompt:     (phase1.usage?.prompt_tokens     ?? 0) + (phase2.usage?.prompt_tokens     ?? 0),
            completion: (phase1.usage?.completion_tokens ?? 0) + (phase2.usage?.completion_tokens ?? 0),
            total:      (phase1.usage?.total_tokens      ?? 0) + (phase2.usage?.total_tokens      ?? 0),
        };

        appLogger.info(`[AgentOrchestrator] Token usage for ${options.ticketId}`, tokenUsage);

        const jsonSpec = this.extractCleanJson(phase2.response);
        return { testPlan: phase1.response, jsonSpec, tokenUsage };
    }

    private static extractCleanJson(text: string): string {
        let clean = text.trim();
        if (clean.includes('```json')) {
            clean = clean.split('```json')[1].split('```')[0].trim();
        } else if (clean.includes('```')) {
            const parts = clean.split('```');
            if (parts.length >= 3) {
                clean = parts[1].trim();
            }
        }
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
            clean = clean.substring(start, end + 1);
        }
        return clean;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Skill selector block builder — loads proven selectors from skill files
    // ──────────────────────────────────────────────────────────────────────────

    private static buildSkillSelectorBlock(moduleName: string): string {
        if (!moduleName) return '';
        try {
            const skillPath = path.join(
                process.cwd(), 'skills', 'GlobalHR', 'forms',
                `${moduleName.toLowerCase().replace(/\s+/g, '-')}.json`
            );
            if (!fs.existsSync(skillPath)) return '';
            const skill = JSON.parse(fs.readFileSync(skillPath, 'utf8'));
            if (!skill.stableSelectors || Object.keys(skill.stableSelectors).length === 0) return '';

            const lines: string[] = [];
            lines.push(`## Proven Stable Selectors for "${moduleName}"`);
            lines.push(`When generating test steps, prefer these selectors (in order listed):`);
            for (const [field, selectors] of Object.entries(skill.stableSelectors)) {
                lines.push(`  ${field}: ${(selectors as string[]).map(s => `"${s}"`).join(' | ')}`);
            }
            return lines.join('\n');
        } catch {
            return '';
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Scope block builder
    // ──────────────────────────────────────────────────────────────────────────

    private static buildScopeBlock(options: JsonGenerationOptions): string {
        const cls = options.ticketClassification;
        if (!cls || !cls.scopeInstructions) return '';

        const lines: string[] = [
            '## SCOPE & TYPE INSTRUCTIONS',
            '(Generated from Jira ticket classification — follow these rules strictly)',
            cls.scopeInstructions,
        ];
        if (cls.incompleteItems.length > 0) {
            lines.push(`Incomplete linked tickets: ${cls.incompleteItems.slice(0, 3).join(' | ')}`);
        }
        return lines.join('\n');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Phase 1: Planner
    // ──────────────────────────────────────────────────────────────────────────

    private static async generateTestPlanWithUsage(options: JsonGenerationOptions) {
        const scopeBlock = this.buildScopeBlock(options);
        const jiraData = {
            id: options.ticketId,
            summary: options.summary,
            description: options.description,
            type: options.issueType,
            module: options.module,
            businessRules: options.businessRules || [],
            acceptanceCriteria: options.acceptanceCriteria || [],
            userScenarios: options.customInstructions || [],
            jiraComments: options.jiraComments || [],
        };
        const { ticket: truncatedJira } = TokenManagerService.truncateJiraTicket(jiraData, 8000);
        const prompt = `
# Role: Senior QA Planner
# Task: Analyze the Jira ticket below and create a bulleted test execution strategy in plain English.

## JIRA TICKET
${JSON.stringify(truncatedJira, null, 2)}

${scopeBlock}

## REQUIREMENTS
1. List the key scenarios to be tested (Happy Path, Validation, Edge Cases).
2. For each scenario, describe the high-level steps (e.g., "Navigate to module", "Fill form", "Click Save", "Verify result").
3. DO NOT output code or JSON. Just plain-English strategy.
4. Keep it concise but comprehensive.
5. STRICTLY follow the SCOPE & TYPE INSTRUCTIONS above.

## USER-ADDED SCENARIOS / INSTRUCTIONS
${(options.customInstructions || []).length > 0 ? options.customInstructions!.map((item, index) => `${index + 1}. ${item}`).join('\n') : 'None'}

## RELEVANT SKILLS / KNOWLEDGE
${options.skillContext || 'No extra skill context provided.'}

${this.buildSkillSelectorBlock(options.module || '') ? `\n${this.buildSkillSelectorBlock(options.module || '')}` : ''}
        `.trim();

        return AiControllerService.generateWithUsage('TEST_GENERATION', prompt);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Phase 2: Coder
    // ──────────────────────────────────────────────────────────────────────────

    private static async generateJsonSpecWithUsage(testPlan: string, options: JsonGenerationOptions) {
        const scopeBlock = this.buildScopeBlock(options);
        const jiraData = {
            ticketId: options.ticketId,
            feature: options.summary,
            module: options.module,
            description: options.description,
            acceptanceCriteria: options.acceptanceCriteria || [],
            businessRules: options.businessRules || [],
            jiraComments: options.jiraComments || [],
            userScenarios: options.customInstructions || [],
        };
        const uiMap = Array.isArray(options.selectorReference) ? options.selectorReference : [options.selectorReference || {}];
        const systemPrompt = this.buildCoderSystemPrompt(testPlan, scopeBlock, options);
        const budgetedResult = TokenManagerService.buildBudgetedPrompt(systemPrompt, jiraData, uiMap, 30000);
        return AiControllerService.generateWithUsage('CODE', budgetedResult.prompt, true);
    }

    /** Shared coder system prompt — used by both generateJsonSpec and generateJsonSpecWithUsage */
    private static buildCoderSystemPrompt(testPlan: string, scopeBlock: string, options: JsonGenerationOptions): string {
        return `
# Role: Senior Automation Engineer (Playwright Expert)
# Task: Convert the PLAIN-ENGLISH TEST PLAN below into a structured JSON test specification.

## TEST PLAN (INPUT)
${testPlan}

${scopeBlock}

## USER-ADDED SCENARIOS / INSTRUCTIONS
${(options.customInstructions || []).length > 0 ? options.customInstructions!.map((item, index) => `${index + 1}. ${item}`).join('\n') : 'None'}

## RELEVANT SKILLS / KNOWLEDGE
${options.skillContext || 'No extra skill context provided.'}

${this.buildSkillSelectorBlock(options.module || '') ? `\n${this.buildSkillSelectorBlock(options.module || '')}` : ''}

## OUTPUT FORMAT — EXACT JSON SCHEMA (follow this structure precisely)

Output a JSON object with this EXACT structure. No markdown, no code fences, no comments:

{
  "ticketId": "${options.ticketId}",
  "feature": "${options.summary}",
  "module": "${options.module}",
  "scenarios": [
    {
      "id": "SC-001",
      "name": "Scenario description",
      "type": "happy_path",
      "healStrategy": "action_heal",
      "priority": "high",
      "preconditions": [],
      "steps": [
        { "type": "goto", "url": "/#/app.module", "description": "optional" },
        { "type": "click", "element": "Button Name", "description": "optional" },
        { "type": "fill", "field": "Field Name", "value": "text", "description": "optional" }
      ]
    }
  ]
}

## RULES
1. Every scenario MUST have non-empty "steps" (minimum 4).
2. VALID STEP ACTIONS ONLY: goto, fill, click, waitForSelector, selectOption, assertText, assertVisible.
2a. DO NOT USE: apiListen, apiAssert, generateData, hover, or "unsupported_action".
3. click/fill/selectOption/waitForSelector/assertVisible → "target"/"field" required.
4. CRITICAL: Use ONLY element names exactly as they appear in the UI snapshot. The executor will resolve them.
5. GOTO URLS MUST BE RELATIVE. Use the format: "/#/app.{module-slug}". NEVER include "${options.baseUrl}" or "http://".
6. Output ONLY raw JSON — no markdown, no code fences, no comments, no trailing commas.
7. INLINE ASSERTIONS: Put assertion steps directly inside the "steps" array.
8. Every scenario MUST have "type" and "healStrategy" fields.
9. Use CONCRETE literal test data. Only {{timestamp}} is allowed as a template token.
10. Maximum 8 scenarios, 5-8 steps each. Omit "description" fields from steps to save space.
11. For "negative"/"edge_case": ONE scenario per data variation.
12. BUG REPRODUCTION PRIORITY: First scenario MUST reproduce the bug for Bug tickets.
        `.trim();
    }
}