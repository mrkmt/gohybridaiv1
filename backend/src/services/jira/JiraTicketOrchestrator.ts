/**
 * JiraTicketOrchestrator
 * 
 * Central orchestrator that routes the testing workflow based on the
 * Main Ticket type (Bug vs Story) linked to a Testing ticket.
 * 
 * Flow:
 * 1. Testing ticket is mentioned (e.g. ATT-16)
 * 2. Orchestrator fetches linked issues from the testing ticket
 * 3. Determines the Main Ticket and its type (Bug or Story)
 * 4. Routes to the appropriate handler:
 *    - Bug: Knowledge check → (has knowledge? → proceed : alert user)
 *    - Story: Deep context extraction → knowledge injection → proceed
 * 
 * GlobalHR Rules respected:
 * - Menu access is UserLevel-dependent
 * - Create requires new record creation
 * - Update/Delete requires selecting existing data from grid action column
 * - Delete is blocked for data used in transactions (only delete self-created data)
 * - Setup menus show existing record lists on page load
 */

import { getJiraAxios } from '../../utils/jiraAxios';
import { TestCaseGeneratorService } from '../generation/TestCaseGeneratorService';
import { BugReproductionService, BugAnalysis } from './BugReproductionService';
import { StoryTestPlanner, StoryAnalysis } from './StoryTestPlanner';
import { SmartSkillManager } from '../skills/SmartSkillManager';
import { ModuleRegistry } from '../shared/ModuleRegistry';
import { capPromptWithWarning } from '../../utils/PromptUtils';
import { ChatMentionService } from './ChatMentionService';
import { appLogger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// Cap all context to prevent 2M+ char prompts
const MAX_TICKET_CONTEXT_CHARS = 100_000;
const MAX_DESCRIPTION_CHARS = 30_000;
const MAX_COMMENTS_CHARS = 10_000;
const MAX_LINKED_CONTEXT_CHARS = 20_000;

export interface LinkedTicketInfo {
    key: string;
    summary: string;
    issueType: string;       // 'Bug', 'Story', 'Task', etc.
    status: string;
    description: string;
    linkType: string;         // 'is tested by', 'blocks', etc.
    direction: 'inward' | 'outward';
    reporter?: string;
    assignee?: string;
    comments?: string[];
    attachments?: AttachmentInfo[];
}

export interface AttachmentInfo {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    url: string;
}

export interface OrchestrationResult {
    testingTicketId: string;
    mainTicket: LinkedTicketInfo | null;
    ticketType: 'Bug' | 'Story' | 'Unknown';
    knowledgeAvailable: boolean;
    previousTestingTicket?: string;
    action: 'proceed' | 'alert_manual_record' | 'proceed_with_new_knowledge';
    alertMessage?: string;
    extractedContext?: string;
    linkedTickets: LinkedTicketInfo[];
    skillsFound: string[];

    // Bug-specific analysis
    bugAnalysis?: BugAnalysis;

    // Story-specific analysis
    storyAnalysis?: StoryAnalysis;
}

export class JiraTicketOrchestrator {

    /**
     * Main entry point: Orchestrate a testing ticket
     * Determines the linked main ticket type and routes accordingly.
     */
    static async orchestrate(testingTicketId: string): Promise<OrchestrationResult> {
        appLogger.info(`[Orchestrator] Starting orchestration for testing ticket: ${testingTicketId}`);

        // Step 1: Fetch all linked tickets
        const linkedTickets = await this.fetchLinkedTickets(testingTicketId);
        appLogger.info(`[Orchestrator] Found ${linkedTickets.length} linked ticket(s)`);

        // Step 2: Identify the Main Ticket (Bug or Story)
        const mainTicket = this.identifyMainTicket(linkedTickets);

        if (!mainTicket) {
            appLogger.warn(`[Orchestrator] No main Bug/Story ticket found among linked issues`);
            return {
                testingTicketId,
                mainTicket: null,
                ticketType: 'Unknown',
                knowledgeAvailable: false,
                action: 'alert_manual_record',
                alertMessage: 'No linked Bug or Story ticket found. Please link a main ticket to this testing ticket.',
                linkedTickets,
                skillsFound: []
            };
        }

        appLogger.info(`[Orchestrator] Main ticket: ${mainTicket.key} (${mainTicket.issueType})`);

        // Step 3: Route based on ticket type
        if (mainTicket.issueType.toLowerCase() === 'bug') {
            return this.handleBugTicket(testingTicketId, mainTicket, linkedTickets);
        } else if (mainTicket.issueType.toLowerCase() === 'story') {
            return this.handleStoryTicket(testingTicketId, mainTicket, linkedTickets);
        } else {
            // Treat Task/Sub-task/Epic as Story-like
            appLogger.info(`[Orchestrator] Treating ${mainTicket.issueType} as Story-like ticket`);
            return this.handleStoryTicket(testingTicketId, mainTicket, linkedTickets);
        }
    }

    /**
     * Bug Ticket Handler (Enhanced)
     *
     * 1. Full context extraction: summary + description + ALL comments + attachments
     * 2. Duplicate detection: JQL search for similar bugs
     * 3. Regression check: check if previously tested and passed, now reappearing
     * 4. Severity classification: AI + keyword-based
     * 5. If duplicate → alert with reference to original ticket
     * 6. If regression → flag + reuse existing knowledge
     * 7. If new → extract reproduction steps, generate targeted test spec
     */
    private static async handleBugTicket(
        testingTicketId: string,
        mainTicket: LinkedTicketInfo,
        linkedTickets: LinkedTicketInfo[]
    ): Promise<OrchestrationResult> {
        appLogger.info(`[Orchestrator] Handling Bug ticket: ${mainTicket.key}`);

        // Try to extract module from linked dev tickets first
        const devTickets = linkedTickets.filter(t => t.key !== mainTicket.key && !t.key.startsWith('ATT-'));
        const moduleInfo = this.extractModuleFromDevTickets(devTickets, mainTicket);

        // Store as draft in registry
        if (moduleInfo.moduleName && moduleInfo.moduleName !== 'Unknown') {
            ModuleRegistry.storeDraft(testingTicketId, {
                moduleName: moduleInfo.moduleName,
                menuName: moduleInfo.menuName,
                uiRoute: moduleInfo.uiRoute,
                apiRoute: moduleInfo.apiRoute,
                requirements: moduleInfo.requirements,
            });
            appLogger.info('[Orchestrator] Draft module stored', {
                ticket: testingTicketId,
                module: moduleInfo.moduleName,
            });
        }

        // Fallback to keyword detection if extraction failed
        const { module: keywordModule, menu: keywordMenu } = this.detectModuleFromTicket(mainTicket);
        const moduleName = moduleInfo.moduleName !== 'Unknown' ? moduleInfo.moduleName : keywordModule;
        const menuName = moduleInfo.menuName || keywordMenu;

        // Deep analysis: duplicate check, regression, severity, reproduction steps
        const bugAnalysis = await BugReproductionService.analyzeFullTicket(
            mainTicket.key,
            moduleName,
            mainTicket.summary,
            mainTicket.description
        );

        appLogger.info(`[Orchestrator] Bug analysis`, { severity: bugAnalysis.severity, isNew: bugAnalysis.isNew, regression: bugAnalysis.isRegression, duplicate: bugAnalysis.isDuplicate });

        // Check previous testing
        const previousTestTicket = bugAnalysis.previousTestingTicket || await this.findPreviousTestingTicket(mainTicket.key, testingTicketId);


        // Check knowledge availability
        let hasKnowledge = false;
        const skillNames: string[] = [];
        if (bugAnalysis.isRegression) {
            // Regression → reuse existing knowledge
            hasKnowledge = true;
            skillNames.push(`regression-reuse-${mainTicket.key}`);
        } else if (bugAnalysis.isNew) {
            // New bug — extract knowledge from the bug itself and inject
            try {
                const saveResult = await SmartSkillManager.savePattern({
                    type: 'jira',
                    module: moduleName,
                    issueType: 'bug',
                    learnedPatterns: [
                        `Bug ${mainTicket.key}: ${mainTicket.summary}`,
                        ...bugAnalysis.reproductionSteps.map(s => `Step ${s.stepNumber}: ${s.description}`).slice(0, 5),
                    ],
                    workflow: [{
                        action: 'bug_reproduction',
                        source: mainTicket.key,
                        severity: bugAnalysis.severity,
                        stepCount: bugAnalysis.reproductionSteps.length,
                        extractedAt: new Date().toISOString(),
                    }],
                });
                hasKnowledge = saveResult.status === 'saved';
                if (saveResult.patternId) skillNames.push(saveResult.patternId);
                appLogger.info(`[Orchestrator] Bug knowledge injected: ${hasKnowledge ? 'success' : 'partial'}`);
            } catch (err: any) {
                appLogger.warn(`[Orchestrator] Bug knowledge injection warning`, { error: err.message });
            }
        }

        if (!hasKnowledge && !previousTestTicket && bugAnalysis.isNew) {
            return {
                testingTicketId,
                mainTicket,
                ticketType: 'Bug',
                knowledgeAvailable: false,
                action: 'alert_manual_record',
                alertMessage: `⚠️ "${moduleName} > ${menuName}" module အတွက် testing knowledge မရှိသေးပါ။ Bug severity: ${bugAnalysis.severity}. Manual record (သို့) Online mode record ကို extension နဲ့ အသုံးပြုပါ။`,
                linkedTickets,
                skillsFound: [],
                bugAnalysis,
            };
        }

        return {
            testingTicketId,
            mainTicket,
            ticketType: 'Bug',
            knowledgeAvailable: true,
            previousTestingTicket: previousTestTicket || undefined,
            action: 'proceed',
            linkedTickets,
            skillsFound: skillNames.length > 0 ? skillNames : ['auto-extracted'],
            bugAnalysis,
        };
    }

    /**
     * Story Ticket Handler (Enhanced)
     *
     * Stories are NEW requirements. Full pipeline:
     * 1. Extract requirements from story + developer tickets + comments
     * 2. Generate comprehensive test coverage matrix
     * 3. Inject new knowledge into skill registry
     * 4. Analyze data model / UI / API changes
     * 5. Proceed with test generation using full context
     */
    private static async handleStoryTicket(
        testingTicketId: string,
        mainTicket: LinkedTicketInfo,
        linkedTickets: LinkedTicketInfo[]
    ): Promise<OrchestrationResult> {
        appLogger.info(`[Orchestrator] Handling Story ticket: ${mainTicket.key}`);

        // Step 1: Try to extract module from linked dev tickets first
        const devTickets = linkedTickets.filter(t => t.key !== mainTicket.key && !t.key.startsWith('ATT-'));
        const moduleInfo = this.extractModuleFromDevTickets(devTickets, mainTicket);

        // Store as draft in registry (for both new and existing modules)
        if (moduleInfo.moduleName && moduleInfo.moduleName !== 'Unknown') {
            ModuleRegistry.storeDraft(testingTicketId, {
                moduleName: moduleInfo.moduleName,
                menuName: moduleInfo.menuName,
                uiRoute: moduleInfo.uiRoute,
                apiRoute: moduleInfo.apiRoute,
                requirements: moduleInfo.requirements,
            });
            appLogger.info('[Orchestrator] Draft module stored', {
                ticket: testingTicketId,
                module: moduleInfo.moduleName,
                requirements: moduleInfo.requirements?.length || 0,
            });
        }

        // Step 2: Full story analysis with extracted module
        const storyAnalysis = await StoryTestPlanner.analyzeFullStory(
            mainTicket.key,
            mainTicket.summary,
            mainTicket.description,
            moduleInfo.moduleName
        );

        appLogger.info(`[Orchestrator] Story analysis`, { requirements: storyAnalysis.requirements.length, devTickets: storyAnalysis.linkedDeveloperTickets.length, knowledge: storyAnalysis.newKnowledgeInjected ? 'injected' : 'skipped' });

        return {
            testingTicketId,
            mainTicket,
            ticketType: 'Story',
            knowledgeAvailable: storyAnalysis.newKnowledgeInjected,
            action: 'proceed_with_new_knowledge',
            extractedContext: storyAnalysis.requirements.map(r => `${r.id}: ${r.description}`).join('\n'),
            linkedTickets,
            skillsFound: storyAnalysis.injectedSkillId ? [storyAnalysis.injectedSkillId] : [`story-context-${mainTicket.key}`],
            storyAnalysis,
        };
    }

    /**
     * Fetch all linked tickets from a Jira issue
     */
    static async fetchLinkedTickets(ticketId: string): Promise<LinkedTicketInfo[]> {
        try {
            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get(`/rest/api/3/issue/${ticketId}`, {
                params: {
                    fields: 'issuelinks,summary,description,issuetype,status'
                }
            });

            const issueLinks = response.data.fields?.issuelinks || [];
            const linkedTickets: LinkedTicketInfo[] = [];

            for (const link of issueLinks) {
                const linkedIssue = link.outwardIssue || link.inwardIssue;
                if (!linkedIssue) continue;

                const direction = link.outwardIssue ? 'outward' : 'inward';
                const linkTypeName = direction === 'outward'
                    ? link.type?.outward || link.type?.name || 'relates to'
                    : link.type?.inward || link.type?.name || 'is related to';

                // Fetch full details for each linked ticket
                try {
                    const detailResponse = await jiraAxios.get(`/rest/api/3/issue/${linkedIssue.key}`, {
                        params: {
                            fields: 'summary,description,issuetype,status,reporter,assignee,comment,attachment'
                        }
                    });

                    const fields = detailResponse.data.fields;
                    const description = TestCaseGeneratorService.extractTextFromADF(fields.description || '');

                    // Extract comments
                    const comments: string[] = [];
                    if (fields.comment?.comments) {
                        for (const c of fields.comment.comments) {
                            const commentText = TestCaseGeneratorService.extractTextFromADF(c.body || '');
                            if (commentText) {
                                // Skip GoHybrid AI automation comments to prevent feedback loops
                                if (commentText.includes('GoHybrid AI') || commentText.includes('🤖') || commentText.includes('Agentic AI')) {
                                    continue;
                                }
                                const author = c.author?.displayName || 'Unknown';
                                comments.push(`[${author}]: ${commentText}`);
                            }
                        }
                    }

                    // Extract attachment info
                    const attachments: AttachmentInfo[] = [];
                    if (fields.attachment) {
                        for (const att of fields.attachment) {
                            attachments.push({
                                id: att.id,
                                filename: att.filename,
                                mimeType: att.mimeType || 'application/octet-stream',
                                size: att.size || 0,
                                url: att.content || att.self
                            });
                        }
                    }

                    linkedTickets.push({
                        key: linkedIssue.key,
                        summary: fields.summary || '',
                        issueType: fields.issuetype?.name || 'Unknown',
                        status: fields.status?.name || 'Unknown',
                        description,
                        linkType: linkTypeName,
                        direction,
                        reporter: fields.reporter?.displayName,
                        assignee: fields.assignee?.displayName,
                        comments,
                        attachments
                    });
                } catch (err: any) {
                    appLogger.warn(`[Orchestrator] Failed to fetch details for ${linkedIssue.key}`, { error: err.message });
                    linkedTickets.push({
                        key: linkedIssue.key,
                        summary: linkedIssue.fields?.summary || '',
                        issueType: linkedIssue.fields?.issuetype?.name || 'Unknown',
                        status: linkedIssue.fields?.status?.name || 'Unknown',
                        description: '',
                        linkType: linkTypeName,
                        direction
                    });
                }
            }

            return linkedTickets;
        } catch (error: any) {
            appLogger.error(`[Orchestrator] Failed to fetch linked tickets for ${ticketId}`, { error: error.message });
            return [];
        }
    }

    /**
     * Identify the "Main Ticket" from linked issues
     * Priority: Bug > Story > Task > Epic
     */
    private static identifyMainTicket(linkedTickets: LinkedTicketInfo[]): LinkedTicketInfo | null {
        // Priority order for main ticket identification
        const priorityOrder = ['bug', 'story', 'task', 'sub-task', 'epic'];

        for (const targetType of priorityOrder) {
            const match = linkedTickets.find(t => t.issueType.toLowerCase() === targetType);
            if (match) return match;
        }

        // Fallback: return first linked ticket if any
        return linkedTickets.length > 0 ? linkedTickets[0] : null;
    }

    /**
     * Extract module information from linked developer tickets.
     * Parses technical specs to find:
     * - API routes (e.g., /api/journal-entry, /rest/performance)
     * - UI routes (e.g., /#/app.performance-journal)
     * - Module/component names from technical descriptions
     * - Requirements/features being built (for both new AND existing modules)
     *
     * This works for:
     * 1. New menus — extracts module identity from technical specs
     * 2. Existing menus — extracts specific requirements being added/changed
     */
    private static extractModuleFromDevTickets(
        devTickets: LinkedTicketInfo[],
        mainTicket: LinkedTicketInfo
    ): { moduleName: string; menuName?: string; uiRoute?: string; apiRoute?: string; requirements?: string[] } {
        const allContent = [
            mainTicket.summary,
            mainTicket.description,
            ...devTickets.map(t => `${t.summary} ${t.description}`)
        ].join(' ');

        // Pattern 1: Extract API routes
        const apiMatches = allContent.match(/\/(?:api|rest)\/([a-z0-9\-_]+)/gi);
        const apiRoute = apiMatches?.[0]?.replace(/^\//, '') || undefined;

        // Pattern 2: Extract UI routes
        const uiMatches = allContent.match(/#\/app\.([a-z0-9\-_.]+)/gi);
        const uiRoute = uiMatches?.[0] || undefined;

        // Pattern 3: Extract module/component names from explicit technical declarations
        // Look for patterns like "Module: X", "Component: Y", "Feature: Z" (with capital letter after colon)
        const moduleMatches = allContent.match(/(?:^|\n)\s*(?:module|component|feature)\s*[:=]\s*([A-Z][A-Za-z0-9\s\-_]{3,50})/gi);
        let moduleName: string | undefined;

        if (moduleMatches && moduleMatches.length > 0) {
            const raw = moduleMatches[0].split(/\s*[:=]\s*/).slice(1).join(' ').trim();
            moduleName = raw;
        }

        // Pattern 4: Derive module from ticket summary (cleaned of prefixes)
        if (!moduleName && mainTicket.summary) {
            let cleaned = mainTicket.summary;

            // Remove common prefixes like "WEB UI:", "API:", etc.
            cleaned = cleaned.replace(/^(web ui|api|backend|frontend)\s*[:\-]\s*/i, '').trim();

            // Extract just the feature name (before any dash or "Add"/"Test" qualifiers)
            const featureMatch = cleaned.match(/^([A-Za-z0-9\s\-]+?)(?:\s*[-–—]\s*|\s+(?:add|test|implement|create|fix|update|delete|remove)\b)/i);
            if (featureMatch) {
                cleaned = featureMatch[1].trim();
            }

            // Use if it's a reasonable length and looks like a feature name
            if (cleaned.length > 3 && cleaned.length < 50 && /[A-Za-z]/.test(cleaned)) {
                moduleName = cleaned;
            }
        }

        // Pattern 5: Extract requirements/features from dev ticket descriptions
        const requirements = this.extractRequirementsFromDevTickets(devTickets, mainTicket);

        // Pattern 6: Menu name from main ticket summary
        const menuName = mainTicket.summary?.split(':').pop()?.trim() || undefined;

        return {
            moduleName: moduleName || 'Unknown',
            menuName,
            uiRoute,
            apiRoute,
            requirements,
        };
    }

    /**
     * Extract specific requirements/features from dev ticket descriptions.
     * Works for both new menus and existing menus with new features.
     */
    private static extractRequirementsFromDevTickets(
        devTickets: LinkedTicketInfo[],
        mainTicket: LinkedTicketInfo
    ): string[] {
        const requirements: string[] = [];

        // Combine all dev ticket content
        const allContent = [mainTicket.description, ...devTickets.map(t => t.description)].join('\n');

        // Extract bullet points or numbered lists (common requirement format)
        const bulletMatches = allContent.match(/^[\s]*[-*•]?\s*([A-Z].{10,200})$/gm);
        if (bulletMatches) {
            requirements.push(...bulletMatches.map(b => b.trim().replace(/^[-*•]\s*/, '')));
        }

        // Extract AC (Acceptance Criteria) patterns
        const acMatches = allContent.match(/(?:AC|acceptance criteria|goal)[:\s]+([^.]{10,200})/gi);
        if (acMatches) {
            requirements.push(...acMatches.map(ac => ac.replace(/^.*?:\s*/, '').trim()));
        }

        // Extract field specifications
        const fieldMatches = allContent.match(/(?:field|input|parameter)[:\s]+([A-Za-z][A-Za-z0-9\s_\-]{5,100})/gi);
        if (fieldMatches) {
            requirements.push(...fieldMatches.map(f => f.trim()));
        }

        // Remove duplicates and limit
        return [...new Set(requirements)].slice(0, 20);
    }

    /**
     * Detect module and menu from ticket content
     * Fallback: uses keyword matching when dev ticket extraction fails
     */
    private static detectModuleFromTicket(ticket: LinkedTicketInfo): { module: string; menu: string } {
        const GLOBALHR_KNOWLEDGE: Record<string, { keywords: Record<string, string[]> }> = {
            "Master": {
                keywords: {
                    "Department": ["department", "dept", "division"],
                    "Grade": ["grade", "grades", "salary grade", "level"],
                    "Designation": ["designation", "role", "job title", "position"],
                    "Leave Type": ["leave type", "annual leave", "sick leave"],
                    "Shift Policy": ["shift", "timing", "roster", "schedule"]
                }
            },
            "Employee": {
                keywords: {
                    "Employee Setup": ["employee", "staff", "registration", "employee information"],
                    "Employee Resignation": ["resign", "exit", "separation", "termination"]
                }
            },
            "Time Attendance": {
                keywords: {
                    "Leave Request": ["apply leave", "submit leave", "leave request"],
                    "Leave Approve": ["approve leave", "leave approval"],
                    "OT Request": ["overtime", "ot request"],
                    "Attendance Process": ["attendance", "check-in", "check-out"]
                }
            },
            "Payroll Management": {
                keywords: {
                    "Payment Calculation": ["payroll", "calculate salary", "payment"],
                    "Payment Approve": ["approve salary", "payment approval"],
                    "Salary Adjustment": ["salary adjustment", "bonus", "deduction"]
                }
            }
        };

        const content = `${ticket.summary} ${ticket.description}`.toLowerCase();
        let bestModule = 'Unknown';
        let bestMenu = 'Unknown';
        let maxScore = 0;

        for (const [module, data] of Object.entries(GLOBALHR_KNOWLEDGE)) {
            for (const [menu, keywords] of Object.entries(data.keywords)) {
                const matches = keywords.filter(k => content.includes(k.toLowerCase())).length;
                if (matches > maxScore) {
                    maxScore = matches;
                    bestModule = module;
                    bestMenu = menu;
                }
            }
        }

        return { module: bestModule, menu: bestMenu };
    }

    /**
     * Find a previous testing ticket that tested the same main ticket
     * Searches JQL for testing tickets linked to the same bug/story
     */
    private static async findPreviousTestingTicket(
        mainTicketKey: string,
        currentTestingTicketId: string
    ): Promise<string | null> {
        try {
            const jiraAxios = getJiraAxios();

            // Search for tickets linked to the main ticket
            const response = await jiraAxios.get(`/rest/api/3/issue/${mainTicketKey}`, {
                params: { fields: 'issuelinks' }
            });

            const issueLinks = response.data.fields?.issuelinks || [];

            for (const link of issueLinks) {
                const linkedIssue = link.outwardIssue || link.inwardIssue;
                if (!linkedIssue) continue;

                // Skip the current testing ticket
                if (linkedIssue.key === currentTestingTicketId) continue;

                // Check if this is a testing ticket (ATT-* prefix typically)
                const issueType = linkedIssue.fields?.issuetype?.name || '';
                const linkType = link.type?.name || '';

                // Look for "is tested by" or "Testing" link types, or ATT-prefix tickets
                if (
                    linkType.toLowerCase().includes('test') ||
                    linkedIssue.key.startsWith('ATT-') ||
                    issueType.toLowerCase().includes('test')
                ) {
                    appLogger.info(`[Orchestrator] Found previous testing ticket: ${linkedIssue.key}`);
                    return linkedIssue.key;
                }
            }

            return null;
        } catch (error: any) {
            appLogger.warn(`[Orchestrator] Failed to search for previous testing ticket`, { error: error.message });
            return null;
        }
    }

    /**
     * Deep context extraction for Story tickets
     * Reads everything: summary, description, comments, attachments, linked developer items
     */
    private static async extractDeepContext(storyTicketKey: string): Promise<string> {
        const contextParts: string[] = [];

        try {
            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get(`/rest/api/3/issue/${storyTicketKey}`, {
                params: {
                    fields: 'summary,description,comment,attachment,issuelinks,reporter,assignee,labels,priority'
                }
            });

            const fields = response.data.fields;

            // 1. Summary & Description
            contextParts.push(`## Story: ${fields.summary}`);
            contextParts.push(`### Reporter: ${fields.reporter?.displayName || 'Unknown'}`);
            contextParts.push(`### Assignee: ${fields.assignee?.displayName || 'Unknown'}`);
            contextParts.push(`### Priority: ${fields.priority?.name || 'None'}`);

            if (fields.labels?.length > 0) {
                contextParts.push(`### Labels: ${fields.labels.join(', ')}`);
            }

            const descriptionText = TestCaseGeneratorService.extractTextFromADF(fields.description || '');
            if (descriptionText) {
                const cappedDesc = descriptionText.length > MAX_DESCRIPTION_CHARS
                    ? descriptionText.slice(0, MAX_DESCRIPTION_CHARS) + '\n--- [Description truncated] ---'
                    : descriptionText;
                contextParts.push(`\n### Description:\n${cappedDesc}`);
            }

            // 2. Comments — filter out bot comments, cap total to prevent massive context
            if (fields.comment?.comments?.length > 0) {
                const allComments = fields.comment.comments;
                const humanComments = ChatMentionService.filterBotComments(allComments);
                const filteredComments: string[] = [];
                let commentsTotalChars = 0;

                for (const comment of humanComments) {
                    const author = (comment as any).author?.displayName || 'Unknown';
                    const text = TestCaseGeneratorService.extractTextFromADF((comment as any).body || '');
                    if (text) {
                        const entry = `  [${author}]: ${text}`;
                        if (commentsTotalChars + entry.length > MAX_COMMENTS_CHARS) break;
                        filteredComments.push(entry);
                        commentsTotalChars += entry.length;
                    }
                }

                if (filteredComments.length > 0) {
                    contextParts.push(`\n### Comments (${filteredComments.length} of ${allComments.length} total, bot comments filtered):`);
                    contextParts.push(...filteredComments);
                }
            }

            // 3. Attachments (list them — actual content reading would need download)
            if (fields.attachment?.length > 0) {
                contextParts.push(`\n### Attachments (${fields.attachment.length}):`);
                for (const att of fields.attachment) {
                    const supportedTypes = ['.pdf', '.xlsx', '.docx', '.md', '.txt', '.csv'];
                    const ext = path.extname(att.filename || '').toLowerCase();
                    const isReadable = supportedTypes.includes(ext);
                    contextParts.push(`  - ${att.filename} (${this.formatBytes(att.size)})${isReadable ? ' [READABLE]' : ''}`);
                }
            }

            // 4. Linked work items (sub-tasks, developer tickets)
            if (fields.issuelinks?.length > 0) {
                contextParts.push(`\n### Linked Work Items (${fields.issuelinks.length}):`);
                for (const link of fields.issuelinks) {
                    const linkedIssue = link.outwardIssue || link.inwardIssue;
                    if (!linkedIssue) continue;

                    const linkType = link.outwardIssue
                        ? link.type?.outward || 'relates to'
                        : link.type?.inward || 'is related to';

                    const linkedSummary = linkedIssue.fields?.summary || '';
                    const linkedType = linkedIssue.fields?.issuetype?.name || '';
                    contextParts.push(`  - [${linkedType}] ${linkedIssue.key}: ${linkedSummary} (${linkType})`);

                    // Fetch description of linked developer tickets for extra context
                    if (['Task', 'Sub-task', 'Story'].includes(linkedType)) {
                        try {
                            const devResponse = await jiraAxios.get(`/rest/api/3/issue/${linkedIssue.key}`, {
                                params: { fields: 'description' }
                            });
                            const devDesc = TestCaseGeneratorService.extractTextFromADF(devResponse.data.fields?.description || '');
                            if (devDesc) {
                                contextParts.push(`    Context: ${devDesc.substring(0, 500)}`);
                            }
                        } catch (err) {
                            // Skip if can't fetch
                        }
                    }
                }
            }

        } catch (error: any) {
            appLogger.error(`[Orchestrator] Deep context extraction failed for ${storyTicketKey}`, { error: error.message });
            contextParts.push(`[Error] Failed to extract full context: ${error.message}`);
        }

        const fullContext = contextParts.join('\n');
        return capPromptWithWarning(fullContext, `Orchestrator context for ${storyTicketKey}`);
    }

    /**
     * Format bytes to human-readable string
     */
    private static formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
}
