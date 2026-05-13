/**
 * TestCaseGeneratorService
 * 
 * AI-powered test case generation from Jira tickets.
 * Uses local or cloud AI models to analyze ticket requirements and generate structured test cases.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CloudAIService } from '../../../api/CloudAIService';
import { LocalAIService } from '../../../api/LocalAIService';
import { config } from '../../../api/config';
import { getJiraAxios } from '../../utils/jiraAxios';
import { KnowledgeService } from '../../../api/KnowledgeService';
import { StepValidator } from '../../utils/StepValidator';
import { ChatMentionService } from '../shared/ChatMentionService';
import { SmartTicketSummarizer } from '../shared/SmartTicketSummarizer';
import { appLogger } from '../../utils/logger';
import { TelemetryService } from '../shared/TelemetryService';
import { DiscoveryCacheService } from '../discovery/DiscoveryCacheService';
import { UsageTrackerService } from '../shared/UsageTrackerService';
import { MultiAgentRouter } from '../../../api/MultiAgentRouter';
import { UnifiedAIOrchestrator, TaskType } from '../../../api/UnifiedAIOrchestrator';

import { 
    validateTestSpecification, 
    TestSpecification, 
    TestScenario 
} from './TestSpecSchema';
import { compileTestSpec } from './JSONToPlaywrightCompiler';
import { enrichTestSpec } from '../skills/SelectorEnrichmentService';
import { BugReproductionService } from '../jira/BugReproductionService';

export interface GeneratedTestCases {
    ticketId: string;
    summary: string;
    testCases: TestCase[];
    compiledScripts?: Record<string, string>;
    modelUsed?: string;
    status: 'success' | 'partial' | 'error';
    analysis?: {
        ticketType: string;
        summary: string;
        requirementsCount: number;
        duplicateTicket?: string;
    };
    tokensUsed?: {
        prompt: number;
        completion: number;
        total: number;
    };
}

export interface TestCase {
    caseId: string;
    title: string;
    description: string;
    priority: 'High' | 'Medium' | 'Low';
    steps: TestStep[];
    expectedOutcome: string;
    preconditions: string[];
    isEditable: boolean;
    tags?: string[];
    linkedRequirement?: string;
}

export interface TestStep {
    stepNumber: number;
    action: string;
    expectedResult: string;
    testData?: string;
    selectorHint?: string;
    customCode?: string;      // P1: used for self-healing script injection
    strategyKind?: string;    // P1: used for selector multi-strategy
    framework?: string;       // P1: e.g., 'kendo'
    preWaits?: string[];      // P1: e.g., ['loading-mask']
    _stepData?: any; // Internal: full step object for compiler
}

export class TestCaseGeneratorService {
    private static readonly DEFAULT_PRIORITIES = ['High', 'Medium', 'Low'];

    /**
     * Generate test cases from a Jira ticket
     * Uses the new JSON-based test generation system for deterministic, error-free output
     */
    static async generateTestCases(
        ticketId: string,
        summary: string,
        description: string,
        userScenarios?: string[],
        modelOverride?: string,
        issueType: 'Bug' | 'Story' | 'Task' = 'Story'
    ): Promise<GeneratedTestCases> {
        console.log(`[TestCaseGenerator] Generating test cases for ${ticketId}...`);

        try {
            // Import JsonTestGenerationService dynamically to avoid circular dependencies
            const { JsonTestGenerationService } = require('./JsonTestGenerationService');
            
            // Resolve unified skill context
            const skillContext = await this._resolveSkillContext(ticketId, issueType);
            
            // Resolve learned patterns
            const { learnedPatterns, flakinessData } = await this._resolveLearnedPatternContext(ticketId, issueType);

            const options = {
                ticketId,
                summary,
                description,
                module: this.detectModuleFromSummary(summary),
                issueType: issueType as 'Bug' | 'Story',
                baseUrl: process.env.BASE_URL || 'http://localhost:4200',
                skillContext,
                learnedPatterns,
                flakinessData,
                jiraComments: [], // Will be enriched later if needed
                attachmentSummaries: []
            };

            const result = await JsonTestGenerationService.generateAndCompile(options);

            if (!result.success || !result.specification) {
                throw new Error(result.errors?.join(', ') || 'Failed to generate test specification');
            }

            // Map TestSpecification scenarios back to legacy TestCase format for compatibility
            const testCases = this._mapSpecToTestCases(result.specification, ticketId);
            
            return {
                ticketId,
                summary,
                testCases,
                compiledScripts: result.compiledScripts,
                modelUsed: result.qualityScore?.verdict,
                status: 'success',
                tokensUsed: result.tokensUsed
            };
        } catch (error: any) {
            console.warn(`[TestCaseGenerator] JSON generation threw error, falling back to legacy: ${error.message}`);
            return this.generateTestCasesLegacy(ticketId, summary, description, modelOverride);
        }
    }

    /**
     * Legacy test case generation (fallback when JSON system fails)
     */
    private static async generateTestCasesLegacy(
        ticketId: string,
        summary: string,
        description: string,
        modelOverride?: string
    ): Promise<GeneratedTestCases> {
        console.log(`[TestCaseGenerator] Using legacy generation for ${ticketId}...`);

        const plainDescription = this.extractTextFromADF(description);
        const matrixRules = this.findRelevantBusinessRules(summary, plainDescription);
        const semanticDocs = await KnowledgeService.findSemanticDocs(`${summary} ${plainDescription}`, 5);

        const prompt = this.buildGenerationPrompt(ticketId, summary, plainDescription, matrixRules, semanticDocs);
        
        try {
            const aiResponse = await LocalAIService.generateFull(prompt, modelOverride || 'ANALYST');
            
            if (!aiResponse || !aiResponse.response) {
                throw new Error('AI service returned empty response');
            }

            const testCases = this.parseTestCasesFromResponse(aiResponse.response, ticketId);

            return {
                ticketId,
                summary,
                testCases,
                modelUsed: aiResponse.model,
                status: testCases.length > 0 ? 'success' : 'error',
                tokensUsed: {
                    prompt: aiResponse.usage?.prompt_tokens || 0,
                    completion: aiResponse.usage?.completion_tokens || 0,
                    total: aiResponse.usage?.total_tokens || 0
                }
            };
        } catch (err: any) {
            appLogger.error(`[TestCaseGenerator] Legacy generation failed for ${ticketId}`, { error: err.message });
            return {
                ticketId,
                summary,
                testCases: [this.createFallbackTestCase(ticketId)],
                status: 'error'
            };
        }
    }

    /**
     * Maps a Zod-validated TestSpecification into the legacy TestCase format
     */
    private static _mapSpecToTestCases(spec: TestSpecification, ticketId: string): TestCase[] {
        const priorityMap: Record<string, 'High' | 'Medium' | 'Low'> = {
            'high': 'High',
            'medium': 'Medium',
            'low': 'Low'
        };

        return spec.scenarios.map((scenario: any, index: number) => {
            const title = scenario.name || `Test Case ${index + 1}`;
            
            const actionSteps = (scenario.steps || []).map((step: any, stepIdx: number) => ({
                stepNumber: stepIdx + 1,
                action: step.description || `${step.type}: ${JSON.stringify(step).substring(0, 80)}`,
                testData: (step as any).value ? String((step as any).value) : undefined,
                expectedResult: `Step ${stepIdx + 1} completed successfully`,
                _stepData: step
            }));

            // Map assertions to a single expected outcome
            const assertionSteps = (scenario.assertions || []).map((assertion: any, assertIdx: number) => ({
                stepNumber: actionSteps.length + assertIdx + 1,
                action: `Verify: ${assertion.type}`,
                expectedResult: assertion.expected ? `Value should be ${assertion.expected}` : 'Check passed',
                _stepData: assertion
            }));

            return {
                caseId: scenario.id || `TC-${String(index + 1).padStart(3, '0')}`,
                title,
                description: scenario.preconditions?.join('. ') || `Test case for ${title}`,
                preconditions: scenario.preconditions || [],
                priority: priorityMap[scenario.priority] || 'Medium',
                steps: [...actionSteps, ...assertionSteps],
                expectedOutcome: `All assertions pass for ${title}`,
                isEditable: true,
                tags: scenario.tags || [],
                linkedRequirement: ticketId
            };
        });
    }

    /**
     * Resolve unified skill context for the prompt
     */
    private static async _resolveSkillContext(module: string, issueType: string): Promise<string> {
        try {
            const { UnifiedSkillResolver } = require('../skills/UnifiedSkillResolver');
            const skills = await UnifiedSkillResolver.resolve({
                module,
                issueType: issueType.toLowerCase() as any,
                includeISTQB: true
            });
            return skills.slice(0, 5).map((s: any) => `${s.name}: ${s.content}`).join('\n\n');
        } catch (e) {
            return '';
        }
    }

    /**
     * Resolve learned patterns and flakiness data
     */
    private static async _resolveLearnedPatternContext(ticketId: string, issueType: string) {
        try {
            const { SmartSkillManager } = require('../skills/SmartSkillManager');
            const module = this.detectModuleFromSummary(''); // placeholder
            
            const learnedPatterns = await SmartSkillManager.listPatterns({
                module,
                issueType: issueType.toLowerCase() as any
            });

            return {
                learnedPatterns: learnedPatterns.slice(0, 3),
                flakinessData: undefined // Not implemented yet
            };
        } catch (e) {
            return { learnedPatterns: [], flakinessData: undefined };
        }
    }

    /**
     * Helper to detect HR module from ticket summary/description
     */
    static detectModuleFromSummary(text: string): string {
        const lower = (text || '').toLowerCase();
        if (lower.includes('leave')) return 'Leave';
        if (lower.includes('attendance')) return 'Attendance';
        if (lower.includes('payroll')) return 'Payroll';
        if (lower.includes('designation')) return 'Designation';
        if (lower.includes('department')) return 'Department';
        if (lower.includes('grade')) return 'Grade';
        if (lower.includes('employee')) return 'Employee';
        return 'General';
    }

    /**
     * Legacy ADF text extractor
     */
    static extractTextFromADF(doc: any): string {
        if (!doc) return '';
        if (typeof doc === 'string') return doc;
        
        let text = '';
        const traverse = (node: any) => {
            if (node.type === 'text') text += node.text;
            if (node.content) node.content.forEach(traverse);
        };
        
        traverse(doc);
        return text;
    }

    private static findRelevantBusinessRules(summary: string, description: string): string[] {
        return [];
    }

    private static buildGenerationPrompt(ticketId: string, summary: string, description: string, rules: any[], docs: any[]): string {
        return `Generate test cases for ${ticketId}: ${summary}\n\nDescription: ${description}`;
    }

    private static parseTestCasesFromResponse(response: string, ticketId: string): TestCase[] {
        return [];
    }

    private static createFallbackTestCase(ticketId: string): TestCase {
        return {
            caseId: 'FALLBACK-001',
            title: 'Generic Login & Navigation Test',
            description: 'Verify basic access to the module',
            priority: 'Medium',
            steps: [{ stepNumber: 1, action: 'Login and navigate', expectedResult: 'Page loads' }],
            expectedOutcome: 'Application is accessible',
            preconditions: [],
            isEditable: true
        };
    }

    static stripInlineMarkdown(text: string): string {
        return (text || '').replace(/[*_`]/g, '');
    }
}
