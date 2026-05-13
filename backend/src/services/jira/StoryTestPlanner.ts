/**
 * StoryTestPlanner
 *
 * Comprehensive test planning for Jira Story tickets (new requirements).
 * - Extracts requirements from story + linked developer tickets
 * - Generates full test coverage matrix
 * - Injects new knowledge into skill registry
 * - Produces story-focused test specification
 */

import { getJiraAxios } from '../../utils/jiraAxios';
import { TestCaseGeneratorService } from '../generation/TestCaseGeneratorService';
import { LocalAIService } from '../../../api/LocalAIService';
import { UnifiedAIOrchestrator, TaskType } from '../../../api/UnifiedAIOrchestrator';
import { SmartSkillManager } from '../skills/SmartSkillManager';
import { ChatMentionService } from './ChatMentionService';
import { ISTQB_STANDARDS } from '../../../api/IstqbKnowledgeService';
import { generateBoundaryValues, generateEquivalenceValues } from './TestCaseBuilder';
import { UsageTrackerService } from '../shared/UsageTrackerService';
import { capPromptWithWarning } from '../../utils/PromptUtils';
import { JsonExtractor } from '../../utils/JsonExtractor';
import { appLogger } from '../../utils/logger';

export interface Requirement {
    id: string;
    description: string;
    source: 'acceptance_criteria' | 'description' | 'comment' | 'developer_task';
    sourceTicket?: string;
    priority: 'high' | 'medium' | 'low';
    testable: boolean;
}

export interface CoverageMatrix {
    requirementId: string;
    happyPath: boolean;
    negativeTest: boolean;
    edgeCase: boolean;
    uiValidation: boolean;
    accessControl: boolean;
    dataValidation: boolean;
    coverageNotes: string;
}

export interface StoryAnalysis {
    ticketKey: string;
    summary: string;
    module: string;
    requirements: Requirement[];
    coverageMatrix: CoverageMatrix[];
    newKnowledgeInjected: boolean;
    injectedSkillId?: string;
    linkedDeveloperTickets: Array<{ key: string; summary: string; description: string }>;
    suggestedTestScenarios: string[];
    dataModelChanges?: string[];
    uiChanges?: string[];
    apiChanges?: string[];
}

export class StoryTestPlanner {
    /**
     * Full story analysis pipeline
     */
    static async analyzeFullStory(
        ticketKey: string,
        summary: string,
        description: string,
        module: string
    ): Promise<StoryAnalysis> {
        console.log(`[StoryTestPlanner] 📖 Analyzing Story: ${ticketKey}`);

        const [
            requirements,
            linkedTickets,
            changeAnalysis
        ] = await Promise.all([
            this.extractRequirements(ticketKey, summary, description),
            this.fetchDeveloperTickets(ticketKey),
            this.analyzeChanges(description),
        ]);

        const coverageMatrix = this.generateCoverageMatrix(requirements);
        const suggestedScenarios = await this.suggestStoryScenarios(summary, requirements, module);

        // Inject knowledge
        let newKnowledgeInjected = false;
        let injectedSkillId: string | undefined;
        try {
            const saveResult = await SmartSkillManager.savePattern({
                type: 'jira',
                module,
                issueType: 'story',
                learnedPatterns: [
                    `Story ${ticketKey}: ${summary}`,
                    ...requirements.filter(r => r.testable).map(r => r.description).slice(0, 5),
                ],
                workflow: [{
                    action: 'story_requirements',
                    source: ticketKey,
                    requirementCount: requirements.length,
                    extractedAt: new Date().toISOString(),
                }],
            });
            newKnowledgeInjected = saveResult.status === 'saved';
            injectedSkillId = saveResult.patternId;
            console.log(`[StoryTestPlanner] Knowledge injected: ${newKnowledgeInjected ? '✅' : '⚠️'} ${injectedSkillId}`);
        } catch (err: any) {
            console.warn(`[StoryTestPlanner] Knowledge injection warning: ${err.message}`);
        }

        return {
            ticketKey,
            summary,
            module,
            requirements,
            coverageMatrix,
            newKnowledgeInjected,
            injectedSkillId,
            linkedDeveloperTickets: linkedTickets,
            suggestedTestScenarios: suggestedScenarios,
            ...changeAnalysis,
        };
    }

    /**
     * Generate ISTQB-compliant test data for a requirement.
     * Uses Boundary Value Analysis and Equivalence Partitioning.
     */
    static generateTestDataForRequirement(
        requirement: Requirement,
        fieldConstraints?: Array<{
            field: string;
            type: 'numeric' | 'text' | 'date' | 'select';
            min?: number;
            max?: number;
            minLength?: number;
            maxLength?: number;
            allowedValues?: string[];
            isRequired?: boolean;
        }>
    ): Array<{ testData: Record<string, string | number>; expectedBehavior: string }> {
        const dataSets: Array<{ testData: Record<string, string | number>; expectedBehavior: string }> = [];

        if (!fieldConstraints || fieldConstraints.length === 0) {
            return dataSets;
        }

        // Generate ISTQB-compliant test data for each field
        for (const constraint of fieldConstraints) {
            const { field, type } = constraint;

            switch (type) {
                case 'numeric': {
                    const min = constraint.min ?? 0;
                    const max = constraint.max ?? 100;
                    const values = generateBoundaryValues({ min, max });

                    for (const value of values) {
                        const numVal = Number(value);
                        const isInvalid = numVal < min || numVal > max;
                        dataSets.push({
                            testData: { [field]: numVal },
                            expectedBehavior: isInvalid
                                ? `Should reject ${field}=${value} (invalid boundary)`
                                : `Should accept ${field}=${value} (valid boundary)`
                        });
                    }
                    break;
                }

                case 'text': {
                    const maxLen = constraint.maxLength ?? 255;
                    const minLen = constraint.minLength ?? 0;
                    const validValue = 'Test Value';
                    const emptyValue = '';
                    const tooLongValue = 'A'.repeat(maxLen + 1);

                    dataSets.push({
                        testData: { [field]: validValue },
                        expectedBehavior: `Should accept valid ${field}`
                    });

                    if (constraint.isRequired) {
                        dataSets.push({
                            testData: { [field]: emptyValue },
                            expectedBehavior: `Should reject empty ${field}`
                        });
                    }

                    if (maxLen > 0) {
                        dataSets.push({
                            testData: { [field]: tooLongValue },
                            expectedBehavior: `Should reject ${field} exceeding ${maxLen} chars`
                        });
                    }
                    break;
                }

                case 'select': {
                    const allowed = constraint.allowedValues || [];
                    for (const value of allowed) {
                        dataSets.push({
                            testData: { [field]: value },
                            expectedBehavior: `Should select valid ${field}="${value}"`
                        });
                    }
                    // Add one invalid option
                    dataSets.push({
                        testData: { [field]: '---invalid---' },
                        expectedBehavior: `Should reject invalid ${field}`
                    });
                    break;
                }

                case 'date': {
                    const validDate = new Date().toISOString().split('T')[0];
                    const pastDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
                    const futureDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];

                    dataSets.push({
                        testData: { [field]: validDate },
                        expectedBehavior: `Should accept current date for ${field}`
                    });
                    dataSets.push({
                        testData: { [field]: pastDate },
                        expectedBehavior: `Should handle past date for ${field}`
                    });
                    dataSets.push({
                        testData: { [field]: futureDate },
                        expectedBehavior: `Should handle future date for ${field}`
                    });
                    break;
                }
            }
        }

        return dataSets;
    }

    /**
     * Extract requirements from story context
     */
    static async extractRequirements(
        ticketKey: string,
        summary: string,
        description: string
    ): Promise<Requirement[]> {
        console.log(`[StoryTestPlanner] Extracting requirements from ${ticketKey}`);

        // Fetch full context (comments + attachments)
        const jiraAxios = getJiraAxios();
        let commentsContext = '';
        try {
            const response = await jiraAxios.get(`/rest/api/3/issue/${ticketKey}`, {
                params: { fields: 'comment,issuelinks' }
            });

            const comments = response.data.fields?.comment?.comments || [];
            const humanComments = ChatMentionService.filterBotComments(comments);
            if (humanComments.length > 0) {
                commentsContext = '\n### Comments:\n';
                for (const c of humanComments as any[]) {
                    const text = TestCaseGeneratorService.extractTextFromADF(c.body || '');
                    if (text) {
                        const author = (c as any).author?.displayName || 'Unknown';
                        commentsContext += `[${author}]: ${text}\n`;
                    }
                }
            }
        } catch {
            // Ignore — comments not available
        }

        const fullContext = `
Story: ${summary}
Description: ${description}
${commentsContext}
`.trim();

        // Use AI to extract structured requirements
        try {
            const prompt = `
You are a senior QA analyst. Extract ALL testable requirements from this Jira story ticket.
Look at the summary, description, and comments. Find:
1. Acceptance criteria (Given/When/Then or explicit criteria)
2. Functional requirements from the description
3. Requirements mentioned in comments (by PM, dev, or stakeholders)

For each requirement, determine if it is testable via UI automation.

Return ONLY a JSON array:
[
  {
    "id": "REQ_1",
    "description": "Clear, testable requirement description",
    "source": "acceptance_criteria|description|comment|developer_task",
    "priority": "high|medium|low",
    "testable": true
  }
]

Return ONLY the JSON array. No markdown, no explanation.

Story Context:
${fullContext}
`.trim();

            const cappedPrompt = capPromptWithWarning(prompt, `Story requirements for ${ticketKey}`);
            const responseJson = await UnifiedAIOrchestrator.generate(cappedPrompt, TaskType.TEST_GENERATION);

            // Track usage
            UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'story_requirements',
                ticketId: ticketKey,
                endpoint: 'StoryTestPlanner.extractRequirements',
                inputChars: cappedPrompt.length,
                outputChars: responseJson.length
            }).catch(() => {});
            const requirements = JsonExtractor.tryArray<Requirement>(responseJson);
            if (requirements.length > 0) {
                appLogger.info(`[StoryTestPlanner] Extracted ${requirements.length} requirements`);
                return requirements;
            }
        } catch (err: any) {
            console.warn(`[StoryTestPlanner] AI requirement extraction failed: ${err.message}`);
        }

        // Fallback: Extract basic requirements from description
        return this.fallbackExtractRequirements(summary, description);
    }

    /**
     * Fetch linked developer tickets for additional context
     */
    static async fetchDeveloperTickets(ticketKey: string): Promise<{ key: string; summary: string; description: string }[]> {
        console.log(`[StoryTestPlanner] Fetching developer tickets linked to ${ticketKey}`);

        const results: { key: string; summary: string; description: string }[] = [];
        try {
            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get(`/rest/api/3/issue/${ticketKey}`, {
                params: { fields: 'issuelinks' }
            });

            const issueLinks = response.data.fields?.issuelinks || [];
            for (const link of issueLinks) {
                const linkedIssue = link.outwardIssue || link.inwardIssue;
                if (!linkedIssue) continue;

                const issueType = linkedIssue.fields?.issuetype?.name || '';
                if (['Task', 'Sub-task', 'Development', 'Dev Task'].includes(issueType)) {
                    try {
                        const detailResponse = await jiraAxios.get(`/rest/api/3/issue/${linkedIssue.key}`, {
                            params: { fields: 'summary,description' }
                        });
                        results.push({
                            key: linkedIssue.key,
                            summary: detailResponse.data.fields?.summary || '',
                            description: TestCaseGeneratorService.extractTextFromADF(detailResponse.data.fields?.description || ''),
                        });
                        console.log(`[StoryTestPlanner] Developer ticket: ${linkedIssue.key} — ${results[results.length - 1].summary}`);
                    } catch (err: any) {
                        console.warn(`[StoryTestPlanner] Failed to fetch ${linkedIssue.key}: ${err.message}`);
                    }
                }
            }
        } catch (err: any) {
            console.warn(`[StoryTestPlanner] Failed to fetch linked tickets: ${err.message}`);
        }

        return results;
    }

    /**
     * Analyze what data models, UI elements, and APIs change
     */
    static async analyzeChanges(description: string): Promise<{
        dataModelChanges?: string[];
        uiChanges?: string[];
        apiChanges?: string[];
    }> {
        try {
            const prompt = `
Analyze this story description and identify what changes:
1. Data model changes (new fields, tables, entities)
2. UI changes (new forms, pages, buttons, screens)
3. API changes (new endpoints, changed payloads)

Description: ${description.substring(0, 5000)}

Return ONLY JSON: { "dataModelChanges": ["..."], "uiChanges": ["..."], "apiChanges": ["..."] }
Return empty arrays if none found.
`.trim();

            const responseJson = await LocalAIService.simpleGenerate(prompt);
            const parsed = JsonExtractor.tryObject<{
                dataModelChanges: string[];
                uiChanges: string[];
                apiChanges: string[];
            }>(responseJson);

            return {
                dataModelChanges: Array.isArray(parsed.dataModelChanges) ? parsed.dataModelChanges : [],
                uiChanges: Array.isArray(parsed.uiChanges) ? parsed.uiChanges : [],
                apiChanges: Array.isArray(parsed.apiChanges) ? parsed.apiChanges : [],
            };
        } catch {
            return {};
        }
    }

    /**
     * Generate test coverage matrix for all requirements
     */
    static generateCoverageMatrix(requirements: Requirement[]): CoverageMatrix[] {
        return requirements.map(req => ({
            requirementId: req.id,
            happyPath: true,         // Every requirement gets a happy path test
            negativeTest: req.testable && req.priority !== 'low',  // Non-low priority gets negative testing
            edgeCase: req.testable && req.priority === 'high',       // High priority gets edge cases
            uiValidation: true,       // All requirements need UI validation
            accessControl: req.priority === 'high',                  // High priority gets access control testing
            dataValidation: req.testable && req.priority !== 'low',  // Data validation for medium+
            coverageNotes: `${req.description} [Priority: ${req.priority}]`,
        }));
    }

    /**
     * Suggest test scenarios for a story, enhanced with ISTQB test design standards
     * and learned skill patterns from previous executions.
     */
    static async suggestStoryScenarios(
        summary: string,
        requirements: Requirement[],
        module: string
    ): Promise<string[]> {
        const defaults = [
            `Happy Path — Complete the new ${module} workflow end-to-end`,
            `Data Validation — Verify all new fields validate correctly`,
            `Negative Testing — Error handling for invalid inputs`,
            `Access Control — Verify role-based permissions`,
            `Edge Cases — Boundary conditions and unusual inputs`,
            `Integration — Verify new feature works with existing modules`,
        ];

        try {
            // Resolve ISTQB test design techniques and skill patterns for context
            const istqbContext = `ISTQB Standards: ${ISTQB_STANDARDS.test_design_techniques.join(' | ')}`;

            const prompt = `
New feature story: ${summary}
Module: ${module}
Requirements: ${requirements.map(r => `- ${r.description}`).join('\n')}

Apply ISTQB test design techniques:
${istqbContext}

Suggest 5-7 test scenarios for comprehensive coverage of this new feature.
Include boundary value analysis, equivalence partitioning, and state transition scenarios.
Return ONLY a JSON array of strings.
`.trim();

            const responseJson = await LocalAIService.simpleGenerate(prompt);
            const arr = JsonExtractor.tryArray<string>(responseJson);
            if (arr.length > 0) return arr;
        } catch {
            // Use defaults
        }

        return defaults;
    }

    /**
     * Fallback: extract basic requirements from text without AI
     */
    private static fallbackExtractRequirements(summary: string, description: string): Requirement[] {
        const requirements: Requirement[] = [];
        const allText = `${summary}\n${description}`;

        // Look for numbered or bulleted items
        const lines = description.split('\n');
        let id = 1;
        for (const line of lines) {
            const trimmed = line.replace(/^[-*]\s*/, '').trim();
            if (trimmed.length > 10 && trimmed.length < 500) {
                if (/^(should|must|shall|ensure|verify|allow|enable|restrict|validate)/i.test(trimmed)) {
                    requirements.push({
                        id: `REQ_${String(id++).padStart(2, '0')}`,
                        description: trimmed,
                        source: 'description',
                        priority: /must|shall|critical|urgent/i.test(trimmed) ? 'high' : 'medium',
                        testable: true,
                    });
                }
            }
        }

        // If no requirements found, create a general one
        if (requirements.length === 0) {
            requirements.push({
                id: 'REQ_01',
                description: summary,
                source: 'description',
                priority: 'medium',
                testable: true,
            });
        }

        return requirements;
    }
}
