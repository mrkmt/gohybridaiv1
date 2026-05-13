/**
 * TestingGenerationService
 *
 * Reconstructed 2026-04-25 (original binary-corrupted).
 *
 * Bridges TestingWorkflowController with the JSON test generation pipeline:
 *   generateScenarios()  — AI scenario planning from session ticket
 *   generateTestCases()  — JsonTestGenerationService.generateAndCompile()
 */

import { JsonTestGenerationService } from './JsonTestGenerationService';
import { TestCase, TestStep } from './TestCaseGeneratorService';
import { AiControllerService } from '../shared/AiControllerService';
import { DiscoveryCacheService } from '../discovery/DiscoveryCacheService';
import { SkillStore } from '../skills/SkillStore';
import { appLogger } from '../../utils/logger';
import type { Pool } from 'pg';
import type { TestSession, ScenarioSeed } from '../session/TestSessionService';
import type { TestSpecification } from './TestSpecSchema';

const SCENARIO_TAGS = ['Happy Path', 'Validation', 'Edge Case', 'Negative', 'Regression'] as const;

export interface GenerationScenarioResult {
    scenarios: ScenarioSeed[];
}

export interface GenerationTestCaseResult {
    testCases: TestCase[];
    compiledScripts: Record<string, string>;
    mcpSteps?: Record<string, import('../../types/mcp.types').McpStep[]>;
    /** scenario_type per scenario ID, extracted from AI-generated spec */
    scenarioTypeMap?: Record<string, string>;
}

export class TestingGenerationService {

    // ── generateScenarios ─────────────────────────────────────────────────────

    async generateScenarios(session: TestSession): Promise<GenerationScenarioResult> {
        const ticket = session.ticket;
        if (!ticket) throw new Error('No ticket loaded in session');

        appLogger.info(`[TestingGenerationService] Generating scenarios for ${session.ticketId}`);

        try {
            const prompt = this.buildScenarioPrompt(ticket, session);
            const raw = await AiControllerService.generate('TEST_GENERATION', prompt);
            const scenarios = this.parseScenarios(raw);
            if (scenarios.length > 0) return { scenarios };
        } catch (err: any) {
            appLogger.warn(`[TestingGenerationService] AI scenario gen failed: ${err.message} — using fallback`);
        }

        return { scenarios: this.heuristicScenarios(ticket) };
    }

    // ── generateTestCases ─────────────────────────────────────────────────────

    async generateTestCases(
        session: TestSession,
        scenarioIds?: string[],
        customInstructions?: string[],
        pool?: Pool,
    ): Promise<GenerationTestCaseResult> {
        const ticket = session.ticket;
        if (!ticket) throw new Error('No ticket loaded in session');

        const ticketId = (ticket as any).id || session.ticketId;
        const summary  = (ticket as any).summary || '';
        const module   = (ticket as any).module  || '';

        appLogger.info(`[TestingGenerationService] Generating test cases for ${ticketId}`);

        const selectedScenarios = scenarioIds && scenarioIds.length > 0
            ? session.scenarios.filter(s => scenarioIds.includes(s.id))
            : session.scenarios;

        const acceptanceCriteria = selectedScenarios.map(
            (s, i) => `${i + 1}. ${s.title || s.label || s.id}`,
        );

        let selectorReference: any = {};
        try {
            const cached = DiscoveryCacheService.get(module);
            if (cached) selectorReference = cached;
        } catch { /* non-critical */ }

        // ── GB (linked backlog) ticket context ────────────────────────────────
        // The session.ticket is enriched in TestingWorkflowController.startSession()
        // with { gbContext: GBTicketContext | null }. Extract it here so the AI
        // planner and coder both receive full requirements context.
        const gbCtx = (ticket as any).gbContext as {
            key?: string;
            summary?: string;
            description?: string;
            issueType?: string;
            comments?: string[];
        } | null | undefined;

        const gbDescription   = gbCtx?.description || '';
        const gbComments      = gbCtx?.comments || [];

        // Merge GB acceptance criteria / business rules into the options arrays.
        // GB comments typically contain acceptance criteria written by the PO.
        const businessRules: string[] = gbComments.slice(0, 5);

        // Prepend GB summary to description when available for richer context.
        const mergedDescription = gbCtx?.summary
            ? `[GB Requirement: ${gbCtx.summary}]\n${gbDescription || (ticket as any).description || ''}`
            : (ticket as any).description || '';

        // ── SkillStore context ────────────────────────────────────────────────
        let skillContext = '';
        if (pool && module) {
            try {
                skillContext = await SkillStore.getContext(module, pool);
                if (skillContext) appLogger.info(`[TestingGenerationService] Loaded skill context for "${module}"`);
            } catch { /* non-critical */ }
        }

        const options = {
            ticketId,
            summary,
            description: mergedDescription,
            module,
            issueType: ((ticket as any).type || 'Story') as 'Bug' | 'Story',
            baseUrl: process.env.BASE_URL || process.env.APP_URL || 'http://localhost:4200',
            acceptanceCriteria,
            businessRules,
            customInstructions: customInstructions || [],
            jiraComments:       gbComments.slice(5, 15), // remaining GB comments as jira context
            attachmentSummaries: [],
            selectorReference,
            enableLiveDiscovery: false,
            skillContext: skillContext || undefined,
        };

        const result = await JsonTestGenerationService.generateAndCompile(options);

        if (!result.success || !result.specification) {
            throw new Error(result.errors?.join(', ') || 'Test case generation failed');
        }

        // Extract scenario_type from AI-generated spec so the controller can
        // persist it accurately without guessing from tag text.
        const scenarioTypeMap: Record<string, string> = {};
        for (const scenario of result.specification.scenarios) {
            const raw = (scenario as any).type || '';
            scenarioTypeMap[scenario.id] =
                raw === 'negative'   ? 'negative'   :
                raw === 'edge_case'  ? 'edge_case'  :
                raw === 'regression' ? 'regression' : 'happy_path';
        }

        return {
            testCases:       this.mapSpecToTestCases(result.specification, ticketId),
            compiledScripts: result.compiledScripts || {},
            mcpSteps:        result.mcpSteps || {},
            scenarioTypeMap,
        };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private buildScenarioPrompt(ticket: any, session: TestSession): string {
        const isBug   = (ticket.type || '').toLowerCase() === 'bug';
        const module  = ticket.module  || 'Unknown';
        const summary = ticket.summary || '';
        const desc    = ((ticket as any).description || '').slice(0, 800);
        const custom  = session.scenarios.filter(s => s.source === 'custom');

        const lines = [
            'You are a senior QA engineer. Return a JSON array of test scenarios for this Jira ticket.',
            '',
            'TICKET:',
            `  ID: ${(ticket as any).id || session.ticketId}`,
            `  Summary: ${summary}`,
            `  Type: ${ticket.type || 'Story'}`,
            `  Module: ${module}`,
            `  Description: ${desc}`,
        ];

        if (custom.length > 0) {
            lines.push('', 'USER-ADDED SCENARIOS:');
            custom.forEach((s, i) => lines.push(`  ${i + 1}. ${s.title || s.label}`));
        }

        lines.push(
            '',
            isBug
                ? 'INSTRUCTION: SC-001 MUST reproduce the bug by using the EXACT invalid or failing data described in the ticket (e.g. entering 6 chars if limit is 5), then asserting the system fails. SC-002 verifies the fix. Titles must be DESCRIPTIVE (e.g. "Reproduce Bug: Enter 6 chars and verify error").'
                : 'INSTRUCTION: Include Create (happy path), Validation (required fields), and at least one edge case.',
            '',
            'MANDATORY RULES:',
            '1. For NEGATIVE tests (tag: Negative): You MUST include an "assertText" step that verifies the SPECIFIC error message or validation text provided in the ticket business rules. Do NOT just click.',
            '2. For VALIDATION tests (tag: Validation): You MUST include steps to verify field-level error markers (e.g., "required", red text).',
            '',
            'Return ONLY a raw JSON array — no markdown, no explanation:',
            '[',
            '  { "id": "SC-001", "title": "Concrete scenario description", "tag": "Negative" },',
            '  { "id": "SC-002", "title": "Validation scenario description", "tag": "Validation" }',
            ']',
            '',
            'Rules: max 5 items. tag must be one of: Happy Path, Validation, Edge Case, Negative, Regression',
        );

        return lines.join('\n');
    }

    private parseScenarios(raw: string): ScenarioSeed[] {
        try {
            const cleaned = raw.trim()
                .replace(/^```[a-z]*\n?/, '')
                .replace(/\n?```$/, '');
            const arr: any[] = JSON.parse(cleaned);
            if (!Array.isArray(arr)) return [];

            return arr.slice(0, 8).map((item: any, i: number) => ({
                id:       String(item.id    || `SC-${String(i + 1).padStart(3, '0')}`),
                title:    String(item.title || item.label || item.name || `Scenario ${i + 1}`),
                label:    String(item.title || item.label || item.name || `Scenario ${i + 1}`),
                tag:      String(item.tag   || SCENARIO_TAGS[i % SCENARIO_TAGS.length]),
                selected: true,
                source:   'ai',
            }));
        } catch {
            return [];
        }
    }

    private heuristicScenarios(ticket: any): ScenarioSeed[] {
        const isBug = (ticket.type || '').toLowerCase() === 'bug';
        const m     = ticket.module || ticket.summary || 'Feature';

        if (isBug) {
            return [
                { id: 'SC-001', title: `Reproduce reported bug in ${m}`,           label: 'Reproduce bug',  tag: 'Negative',   selected: true,  source: 'fallback' },
                { id: 'SC-002', title: `Verify bug fix is applied in ${m}`,         label: 'Verify fix',     tag: 'Regression', selected: true,  source: 'fallback' },
                { id: 'SC-003', title: `Regression check adjacent ${m} functions`,  label: 'Regression',     tag: 'Regression', selected: false, source: 'fallback' },
            ];
        }

        return [
            { id: 'SC-001', title: `Create new ${m} entry with valid data`,    label: 'Create — happy path', tag: 'Happy Path', selected: true,  source: 'fallback' },
            { id: 'SC-002', title: `Required fields show validation errors`,    label: 'Validation',          tag: 'Validation', selected: true,  source: 'fallback' },
            { id: 'SC-003', title: `Edit and save existing ${m} record`,        label: 'Edit record',         tag: 'Happy Path', selected: true,  source: 'fallback' },
            { id: 'SC-004', title: `${m} boundary / edge case input values`,    label: 'Edge case',           tag: 'Edge Case',  selected: false, source: 'fallback' },
        ];
    }

    private mapSpecToTestCases(spec: TestSpecification, ticketId: string): TestCase[] {
        return spec.scenarios.map(scenario => {
            const steps: TestStep[] = scenario.steps.map((step, i) => ({
                stepNumber:   i + 1,
                action:       this.describeStep(step),
                expectedResult: 'Step completes without error',
                testData:    (step as any).value || (step as any).url,
                selectorHint: (step as any).selectorHint,
                _stepData:   step,
            }));

            // Assertions become human-readable verification steps
            (scenario.assertions || []).forEach(a => {
                const aAny = a as any;
                let action: string;
                if (a.type === 'assertText' && aAny.expected) {
                    action = `Verify page shows: "${aAny.expected}"`;
                } else if (a.type === 'assertVisible') {
                    const target = aAny.selector
                        ? aAny.selector.replace(/\.[a-z][\w-]*/g, '').replace(/^\s*|\s*$/g, '') || 'element'
                        : 'element';
                    action = `Verify ${target} is visible on the page`;
                } else if ((a.type as string) === 'assertNotVisible') {
                    action = `Verify element is no longer visible`;
                } else {
                    action = aAny.expected
                        ? `Verify: "${aAny.expected}"`
                        : `Verify ${a.type} passes`;
                }
                steps.push({
                    stepNumber:     steps.length + 1,
                    action,
                    expectedResult: aAny.expected ? `"${aAny.expected}"` : 'Assertion passes',
                    _stepData:      a,
                });
            });

            const priority: 'High' | 'Medium' | 'Low' =
                scenario.priority === 'high' ? 'High' :
                scenario.priority === 'low'  ? 'Low'  : 'Medium';

            const firstAssertion = scenario.assertions?.[0] as any;
            // Use field names that match the frontend TestCase type { id, name, steps, status, approved }
            // and the controller's tc.id lookups. Also keep caseId/title for legacy service compatibility.
            const caseId = `${ticketId}-${scenario.id}`;
            const caseName = scenario.name || scenario.id;
            return {
                id:              caseId,     // frontend + controller use .id
                caseId,                      // legacy services use .caseId
                name:            caseName,   // frontend uses .name
                title:           caseName,   // legacy services use .title
                description:     `${priority} priority — ${spec.feature || ticketId}`,
                priority,
                steps,
                status:          'PENDING' as const,
                approved:        false,
                expectedOutcome: firstAssertion?.expected || 'Test passes without errors',
                preconditions:   scenario.preconditions || [],
                isEditable:      true,
                tags:            [scenario.priority],
            } as any;
        });
    }

    private describeStep(step: any): string {
        const type = step.type || step.action || 'action';
        switch (type) {
            case 'goto':            return `Navigate to ${step.url || step.target || ''}`;
            case 'click':           return `Click "${step.element || step.target || ''}"`;
            case 'fill':            return `Fill "${step.field || step.target || ''}" = "${step.value || ''}"`;
            case 'selectOption':    return `Select "${step.value || ''}" in "${step.field || step.element || ''}"`;
            case 'waitForSelector': return `Wait for "${step.selector || step.target || ''}"`;
            case 'assertText':      return `Assert text "${step.expected || ''}"`;
            case 'assertVisible':   return `Assert visible: "${step.selector || ''}"`;
            default:                return `${type}: ${step.element || step.target || step.field || step.url || ''}`;
        }
    }
}
