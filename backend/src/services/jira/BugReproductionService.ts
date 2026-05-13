/**
 * BugReproductionService
 *
 * Comprehensive analysis pipeline for Jira Bug tickets.
 * - Extracts reproduction steps from ticket context (summary, description, comments)
 * - Detects duplicate bugs via JQL keyword matching
 * - Checks if this is a regression (previously tested but reappeared)
 * - Classifies bug severity
 * - Generates bug-focused test specification
 */

import { getJiraAxios } from '../../utils/jiraAxios';
import { TestCaseGeneratorService } from '../generation/TestCaseGeneratorService';
import { LocalAIService } from '../../../api/LocalAIService';
import { UnifiedAIOrchestrator, TaskType } from '../../../api/UnifiedAIOrchestrator';
import { TestScenario, TestSpecification } from './TestSpecSchema';
import { FailureClassificationService } from '../execution/FailureClassificationService';
import { ChatMentionService } from './ChatMentionService';
import { appLogger } from '../../utils/logger';
import { UsageTrackerService } from '../shared/UsageTrackerService';
import { capPromptWithWarning } from '../../utils/PromptUtils';

export interface BugAnalysis {
    ticketKey: string;
    summary: string;
    module: string;
    severity: 'Critical' | 'High' | 'Medium' | 'Low';
    severityExplanation: string;
    isDuplicate: boolean;
    duplicateTicket?: string;
    duplicateReason?: string;
    isRegression: boolean;
    regressionContext?: string;
    previousTestingTicket?: string;
    reproductionSteps: BugReproductionStep[];
    affectedArea: string;
    isNew: boolean;
    suggestedTestScenarios: string[];
}

export interface BugReproductionStep {
    stepNumber: number;
    description: string;
    testData?: string;
    expectedBehavior: string;
    actualBehavior?: string;
    source: 'summary' | 'description' | 'comment' | 'inferred';
    author?: string;
}

export interface DuplicationResult {
    isDuplicate: boolean;
    candidateTickets: Array<{
        key: string;
        summary: string;
        similarity: number;
    }>;
    closestMatch?: {
        key: string;
        summary: string;
        similarity: number;
        reason: string;
    };
}

export class BugReproductionService {
    /**
     * Full analysis pipeline: context extraction + duplicate check + regression check
     */
    static async analyzeFullTicket(
        ticketKey: string,
        module: string,
        summary: string,
        description: string
    ): Promise<BugAnalysis> {
        appLogger.info(`[BugReproduction] Analyzing Bug: ${ticketKey}`);

        // Run duplicate detection, regression check, severity classification, and step extraction in parallel
        const [
            duplicationResult,
            regressionResult,
            severityResult,
            steps,
            scenarios
        ] = await Promise.all([
            this.findDuplicates(ticketKey, summary, description, module),
            this.checkRegression(ticketKey, module),
            this.classifySeverity(summary, description),
            this.extractReproductionSteps(ticketKey, summary, description),
            this.suggestTestScenarios(ticketKey, summary, description, module),
        ]);

        // Determine if this is a new bug
        const isNew = !duplicationResult.isDuplicate && !regressionResult.isRegression;

        return {
            ticketKey,
            summary,
            module,
            severity: severityResult.severity,
            severityExplanation: severityResult.explanation,
            isDuplicate: duplicationResult.isDuplicate,
            duplicateTicket: duplicationResult.closestMatch?.key,
            duplicateReason: duplicationResult.closestMatch?.reason,
            isRegression: regressionResult.isRegression,
            regressionContext: regressionResult.context,
            previousTestingTicket: regressionResult.previousTestingTicket,
            reproductionSteps: steps,
            affectedArea: module,
            isNew,
            suggestedTestScenarios: scenarios,
        };
    }

    /**
     * Detect duplicate bugs via JQL keyword matching
     * Searches for open and recently resolved bugs in the same module with similar keywords
     */
    static async findDuplicates(
        ticketKey: string,
        summary: string,
        description: string,
        module: string
    ): Promise<DuplicationResult> {
        appLogger.info(`[BugReproduction] Checking for duplicates of ${ticketKey}`);

        try {
            // Extract searchable keywords from summary
            const keywords = this.extractKeywords(summary + ' ' + description);
            if (keywords.length === 0) {
                return { isDuplicate: false, candidateTickets: [] };
            }

            const jiraAxios = getJiraAxios();

            // Extract project key from ticket (e.g., "AB-27" → "AB")
            const projectKey = ticketKey.split('-')[0];

            // Build JQL query: same project, different ticket, similar keywords, Bug type
            // Search both open and recently resolved bugs
            const jqlQueries = [
                // Same keywords in summary (open bugs)
                `project = "${projectKey}" AND issuetype = Bug AND key != "${ticketKey}" AND summary ~ "${keywords[0]}" AND resolution is EMPTY`,
                // Keywords in description (open bugs)
                `project = "${projectKey}" AND issuetype = Bug AND key != "${ticketKey}" AND description ~ "${keywords[0]}" AND resolution is EMPTY`,
                // Recently resolved duplicates (within last 3 months)
                `project = "${projectKey}" AND issuetype = Bug AND key != "${ticketKey}" AND summary ~ "${keywords[0]}" AND resolved > -90d`,
            ];

            const candidateTickets: Array<{ key: string; summary: string; similarity: number }> = [];

            for (const jql of jqlQueries) {
                try {
                    const response = await jiraAxios.get('/rest/api/3/search/jql', {
                        params: { jql, maxResults: 10, fields: 'summary,description' }
                    });

                    const issues = response.data?.issues || [];
                    for (const issue of issues) {
                        if (candidateTickets.find(c => c.key === issue.key)) continue;

                        const issueSummary = issue.fields?.summary || '';
                        const issueDesc = TestCaseGeneratorService.extractTextFromADF(issue.fields?.description || '');
                        const similarity = this.calculateSimilarity(summary, description, issueSummary, issueDesc);

                        if (similarity > 0.3) {
                            candidateTickets.push({
                                key: issue.key,
                                summary: issueSummary,
                                similarity: Math.round(similarity * 100) / 100,
                            });
                        }
                    }
                } catch (err: any) {
                    appLogger.warn(`[BugReproduction] JQL query failed`, { error: err.message });
                }
            }

            // Sort by similarity
            candidateTickets.sort((a, b) => b.similarity - a.similarity);

            if (candidateTickets.length > 0 && candidateTickets[0].similarity >= 0.6) {
                const closest = candidateTickets[0];
                appLogger.warn(`[BugReproduction] Possible duplicate found: ${closest.key} (similarity: ${closest.similarity})`);
                return {
                    isDuplicate: true,
                    candidateTickets,
                    closestMatch: {
                        key: closest.key,
                        summary: closest.summary,
                        similarity: closest.similarity,
                        reason: `Similarity score ${Math.round(closest.similarity * 100)}%. Shared keywords: ${keywords.join(', ')}`,
                    },
                };
            }

            return {
                isDuplicate: candidateTickets.length > 0 && candidateTickets[0].similarity >= 0.4,
                candidateTickets: candidateTickets.filter(c => c.similarity >= 0.3),
                closestMatch: candidateTickets[0] ? {
                    ...candidateTickets[0],
                    reason: `Similarity score ${Math.round(candidateTickets[0].similarity * 100)}%`,
                } : undefined,
            };
        } catch (err: any) {
            appLogger.error(`[BugReproduction] Duplicate check failed`, { error: err.message });
            return { isDuplicate: false, candidateTickets: [] };
        }
    }

    /**
     * Check if this bug is a regression (previously tested but reappeared)
     */
    static async checkRegression(ticketKey: string, module: string): Promise<{
        isRegression: boolean;
        context?: string;
        previousTestingTicket?: string;
    }> {
        appLogger.info(`[BugReproduction] Checking regression status for ${ticketKey}`);

        try {
            const jiraAxios = getJiraAxios();

            // Fetch the bug's changelog to see status transitions
            const response = await jiraAxios.get(`/rest/api/3/issue/${ticketKey}`, {
                params: { fields: 'changelog', expand: 'changelog' }
            });

            const changelog = response.data?.changelog?.histories || [];
            const statusTransitions: Array<{ from: string; to: string; date: string; author: string }> = [];

            for (const history of changelog) {
                for (const item of history.items || []) {
                    if (item.field === 'status') {
                        statusTransitions.push({
                            from: item.fromString || 'Unknown',
                            to: item.toString || 'Unknown',
                            date: history.created || '',
                            author: history.author?.displayName || 'Unknown',
                        });
                    }
                }
            }

            // Check if this ever went through "Done" → "To Do" / "Reopened"
            const wasDoneAndReopened = statusTransitions.some((t, i) =>
                (t.to === 'Done' || t.to === 'Resolved' || t.to === 'Closed') &&
                statusTransitions.slice(i + 1).some(t2 =>
                    t2.from === 'Done' || t2.from === 'Resolved' || t2.from === 'Closed'
                )
            );

            if (wasDoneAndReopened) {
                // Find the previous testing ticket that tested this
                const linkedResponse = await jiraAxios.get(`/rest/api/3/issue/${ticketKey}`, {
                    params: { fields: 'issuelinks' }
                });

                const issueLinks = linkedResponse.data.fields?.issuelinks || [];
                let previousTestingTicket: string | undefined;

                for (const link of issueLinks) {
                    const linkedIssue = link.outwardIssue || link.inwardIssue;
                    if (!linkedIssue) continue;
                    if (linkedIssue.key.startsWith('ATT-') || (link.type?.name || '').includes('test')) {
                        previousTestingTicket = linkedIssue.key;
                        break;
                    }
                }

                return {
                    isRegression: true,
                    context: `Bug was previously resolved then reopened. Status history: ${statusTransitions.map(t => `${t.from}→${t.to}`).join(', ')}`,
                    previousTestingTicket,
                };
            }

            // Check JQL for existing "is tested by" links
            const previousTicket = await this.findPreviousTestingTicket(ticketKey, '');
            if (previousTicket) {
                // This was tested before
                return {
                    isRegression: false, // Not a regression yet, just previously tested
                    context: `Previously tested and passed in testing ticket ${previousTicket}`,
                    previousTestingTicket: previousTicket,
                };
            }

            appLogger.info(`[BugReproduction] New bug — no regression detected`);
            return { isRegression: false };
        } catch (err: any) {
            appLogger.warn(`[BugReproduction] Regression check failed`, { error: err.message });
            return { isRegression: false };
        }
    }

    /**
     * Extract reproduction steps from bug description and comments using AI
     */
    static async extractReproductionSteps(
        ticketKey: string,
        summary: string,
        description: string
    ): Promise<BugReproductionStep[]> {
        appLogger.info(`[BugReproduction] Extracting reproduction steps for ${ticketKey}`);

        try {
            // Fetch full ticket context including comments
            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get(`/rest/api/3/issue/${ticketKey}`, {
                params: { fields: 'comment,attachment' }
            });

            let context = '';
            context += `Summary: ${summary}\n\n`;
            if (description) {
                context += `Description:\n${description}\n\n`;
            }

            const comments = response.data.fields?.comment?.comments || [];
            const humanComments = ChatMentionService.filterBotComments(comments);
            if (humanComments.length > 0) {
                context += `Comments:\n`;
                for (const comment of humanComments) {
                    const author = (comment as any).author?.displayName || 'Unknown';
                    const text = TestCaseGeneratorService.extractTextFromADF((comment as any).body || '');
                    if (text) {
                        context += `[${author}]: ${text}\n`;
                    }
                }
                context += '\n';
            }

            const attachments = response.data.fields?.attachment || [];
            if (attachments.length > 0) {
                context += `Attachments: ${attachments.map((a: any) => a.filename).join(', ')}\n\n`;
            }

            const prompt = `
You are an expert QA analyst. Extract ALL reproduction steps from this Jira bug ticket context.
Look at the summary, description, and ALL comments. Pay special attention to:
- Specific user actions mentioned (click, navigate, fill, select, etc.)
- Input data provided (exact values for test data extraction)
- Screenshots/attachments that describe what was seen
- Error messages or unexpected behavior described
- Steps the developer or reporter took to reproduce the issue

Extract as discrete, numbered reproduction steps. Each step should be a SINGLE action.

Return ONLY a JSON array of step objects:
[
  {
    "stepNumber": 1,
    "description": "Action description",
    "testData": "exact input value if any",
    "expectedBehavior": "What should have happened",
    "actualBehavior": "What actually happened",
    "source": "summary|description|comment|inferred",
    "author": "Name if from comment"
  }
]

If no clear reproduction steps exist, infer from the bug description what the user was trying to do.
Return ONLY the JSON array. No markdown, no explanation.

Bug Context:
${context}
`.trim();

            const cappedPrompt = capPromptWithWarning(prompt, `Bug reproduction for ${ticketKey}`);
            const responseJson = await UnifiedAIOrchestrator.generate(cappedPrompt, TaskType.TEST_GENERATION);

            // Track usage
            UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'bug_reproduction',
                ticketId: ticketKey,
                endpoint: 'BugReproductionService.extractReproductionSteps',
                inputChars: cappedPrompt.length,
                outputChars: responseJson.length
            }).catch(() => {});

            let jsonText = responseJson.trim();
            if (jsonText.includes('```')) {
                const match = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                if (match) jsonText = match[1].trim();
            }

            const arrayStart = jsonText.indexOf('[');
            const arrayEnd = jsonText.lastIndexOf(']');
            if (arrayStart !== -1 && arrayEnd !== -1) {
                jsonText = jsonText.substring(arrayStart, arrayEnd + 1);
            }

            const steps = JSON.parse(jsonText);
            if (Array.isArray(steps) && steps.length > 0) {
                appLogger.info(`[BugReproduction] Extracted ${steps.length} reproduction steps`);
                return steps as BugReproductionStep[];
            }
        } catch (err: any) {
            appLogger.warn(`[BugReproduction] AI step extraction failed`, { error: err.message });
        }

        // Fallback: Create basic reproduction step from summary
        return [{
            stepNumber: 1,
            description: `Reproduce the issue: ${summary}`,
            expectedBehavior: 'Feature works as intended',
            actualBehavior: summary,
            source: 'inferred',
        }];
    }

    /**
     * Classify bug severity using AI analysis
     */
    static async classifySeverity(
        summary: string,
        description: string
    ): Promise<{ severity: 'Critical' | 'High' | 'Medium' | 'Low'; explanation: string }> {
        const combinedText = `${summary} ${description}`.toLowerCase();

        // Heuristic severity detection
        const criticalPatterns = [
            /crash|crash|down|unreachable|data loss|security|vulnerability|cannot (login|access|open)/i,
            /production|blocked|urgent|p0|p1|severity.*(1|critical)/i,
        ];

        const highPatterns = [
            /cannot (save|submit|create|edit|delete)/i,
            /error|fail|broken|not (working|responding|loading)/i,
            /p2|severity.*2|high/i,
        ];

        const mediumPatterns = [
            /slow|lag|delay|incorrect|wrong|missing/i,
            /ui|display|layout|alignment|format/i,
            /p3|severity.*3|medium/i,
        ];

        for (const patterns of criticalPatterns) {
            if (patterns.test(combinedText)) {
                return { severity: 'Critical', explanation: 'Critical keywords detected — potential system instability, data loss, or security impact' };
            }
        }

        for (const patterns of highPatterns) {
            if (patterns.test(combinedText)) {
                return { severity: 'High', explanation: 'Functional failure detected — core feature is broken or unusable' };
            }
        }

        for (const patterns of mediumPatterns) {
            if (patterns.test(combinedText)) {
                return { severity: 'Medium', explanation: 'Non-blocking issue — UI/UX or performance concern' };
            }
        }

        // AI fallback
        try {
            const prompt = `
Classify the severity of this bug: ${summary}
Description: ${description}

Return ONLY valid JSON: { "severity": "Critical|High|Medium|Low", "explanation": "brief reason" }
`.trim();
            const responseJson = await LocalAIService.simpleGenerate(prompt);
            const parsed = JSON.parse(responseJson);
            if (['Critical', 'High', 'Medium', 'Low'].includes(parsed.severity)) {
                return { severity: parsed.severity, explanation: parsed.explanation };
            }
        } catch {
            // Use default
        }

        return { severity: 'Medium', explanation: 'Default severity — manual review recommended' };
    }

    /**
     * Suggest test scenarios specific to the bug
     */
    static async suggestTestScenarios(
        ticketKey: string,
        summary: string,
        description: string,
        module: string
    ): Promise<string[]> {
        const defaults = [
            `${ticketKey} — Exact reproduction of the reported bug`,
            `Positive path — Verify the feature works correctly with valid inputs after bug fix`,
            `Boundary conditions — Test edge cases around the bug area`,
            `Related workflow — Test adjacent functionality to catch regressions`,
        ];

        try {
            const prompt = `
Given this bug ticket: ${summary}
Module: ${module}

Suggest 4-6 specific test scenarios to cover:
1. Exact reproduction of this bug
2. Positive path after the fix
3. Regression tests for related functionality
4. Edge cases and boundary conditions

Return ONLY a JSON array of strings.
`.trim();
            const responseJson = await LocalAIService.simpleGenerate(prompt);
            let jsonText = responseJson.trim();
            const m = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (m) jsonText = m[1].trim();
            const arr = JSON.parse(jsonText);
            if (Array.isArray(arr) && arr.length > 0) return arr as string[];
        } catch {
            // Use defaults
        }

        return defaults;
    }

    // ─── Helpers ─────────────────────────────────────────────

    /**
     * Extract keywords for JQL search from text
     */
    static extractKeywords(text: string): string[] {
        const stopWords = new Set(['the','is','on','in','at','to','of','and','or','but','for','not','was','are','with','a','an','this','that','will','can','has','have','been','would','should','from','when','then','it','if','by','about','into','over','after','before','between','under','through','no','yes']);
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3 && !stopWords.has(w))
            .slice(0, 5);
    }

    /**
     * Calculate similarity between two bugs using shared keywords
     */
    static calculateSimilarity(
        summary1: string,
        desc1: string,
        summary2: string,
        desc2: string
    ): number {
        const words1 = new Set(this.extractKeywords(summary1 + ' ' + desc1).map(w => w.toLowerCase()));
        const words2 = new Set(this.extractKeywords(summary2 + ' ' + desc2).map(w => w.toLowerCase()));

        if (words1.size === 0 || words2.size === 0) return 0;

        let overlap = 0;
        for (const w of words1) {
            if (words2.has(w)) overlap++;
        }

        const union = new Set([...words1, ...words2]).size;
        return union > 0 ? overlap / union : 0;
    }

    /**
     * Find previous testing ticket linked to a bug
     */
    private static async findPreviousTestingTicket(
        mainTicketKey: string,
        currentTestingTicketId: string
    ): Promise<string | null> {
        try {
            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get(`/rest/api/3/issue/${mainTicketKey}`, {
                params: { fields: 'issuelinks' }
            });

            const issueLinks = response.data.fields?.issuelinks || [];
            for (const link of issueLinks) {
                const linkedIssue = link.outwardIssue || link.inwardIssue;
                if (!linkedIssue || linkedIssue.key === currentTestingTicketId) continue;

                const linkType = link.type?.name || '';
                if (linkType.toLowerCase().includes('test') || linkedIssue.key.startsWith('ATT-')) {
                    return linkedIssue.key;
                }
            }
            return null;
        } catch {
            return null;
        }
    }
}
