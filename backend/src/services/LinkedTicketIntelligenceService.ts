/**
 * LinkedTicketIntelligenceService
 *
 * Reads and classifies Jira issue link relationships for a Testing ticket (GT).
 * Provides structured context for AI test case generation.
 *
 * Link types from your system:
 *   - "is blocked by" (GB/GD) → dependencies that must exist before testing
 *   - "is implemented by" (GD) → new features/changes the developer made
 *   - "tests for" (GB) → what this testing ticket is validating
 *   - "relates to" → other related tickets for additional context
 *
 * This service enables:
 *   1. Better test scenario generation (knowing what changed, what's blocked)
 *   2. Smart re-testing (auto-retest when linked bug is fixed)
 *   3. Context-aware test cases (reading description + comments for business logic)
 */

import { getJiraAxios } from '../utils/jiraAxios';
import { appLogger } from '../utils/logger';

// ─── Data Models ────────────────────────────────────────────────

export enum LinkType {
    /** "is blocked by" — GB bug or GD dev ticket that this GT depends on */
    IS_BLOCKED_BY = 'is blocked by',
    /** "is implemented by" — GD dev ticket with new changes/features */
    IS_IMPLEMENTED_BY = 'is implemented by',
    /** "tests for" — the GB ticket this GT is validating */
    TESTS_FOR = 'tests for',
    /** "relates to" — other related tickets */
    RELATES_TO = 'relates to',
    /** Unknown/unrecognized link type */
    UNKNOWN = 'unknown',
}

export interface LinkedIssue {
    /** Jira ticket key (e.g., "GB-50", "GD-25") */
    key: string;
    /** Link relationship type */
    linkType: LinkType;
    /** Ticket summary */
    summary: string;
    /** Issue type name (Bug, Story, Task, Testing) */
    issueType: string;
    /** Ticket status (To Do, In Progress, Done) */
    status?: string;
}

export interface IssueDetail {
    key: string;
    summary: string;
    issueType: string;
    status?: string;
    linkType: LinkType;
    /** Full description/body of the ticket */
    description?: string;
    /** Comments on the ticket */
    comments: CommentEntry[];
}

export interface CommentEntry {
    body: string;
    author: string;
    created: string;
}

export interface LinkContext {
    /** All linked issues with classification */
    links: LinkedIssue[];
    /** Full details (description + comments) for each linked issue */
    details: IssueDetail[];
}

export interface ExtractedTestContext {
    /** Business logic hints from bug descriptions and comments */
    businessLogicHints: string[];
    /** New fields or features mentioned in implementation tickets */
    newFields: string[];
    /** Selector or UI element hints mentioned across linked tickets */
    selectorHints: string[];
    /** Risk areas flagged in comments (e.g., "this is fragile", "edge case") */
    riskAreas: string[];
}

// ─── Link Type Classification ───────────────────────────────────

function classifyLink(link: any): LinkType {
    const linkType = link.type;
    if (!linkType) return LinkType.UNKNOWN;

    const inward = (linkType.inward || '').toLowerCase();
    const outward = (linkType.outward || '').toLowerCase();
    const name = (linkType.name || '').toLowerCase();

    if (inward.includes('blocked by') || outward.includes('blocks')) return LinkType.IS_BLOCKED_BY;
    if (inward.includes('implemented by') || outward.includes('implements')) return LinkType.IS_IMPLEMENTED_BY;
    if (inward.includes('tests') || outward.includes('is tested by') || outward.includes('tests for')) return LinkType.TESTS_FOR;
    if (inward.includes('relates') || outward.includes('relates')) return LinkType.RELATES_TO;

    return LinkType.UNKNOWN;
}

function getLinkedKey(link: any): string | null {
    // Inward link: the linked issue is on the inwardIssue side (we are blocked by IT)
    if (link.inwardIssue) return link.inwardIssue.key;
    // Outward link: the linked issue is on the outwardIssue side (we test for IT)
    if (link.outwardIssue) return link.outwardIssue.key;
    return null;
}

function getLinkedIssueData(link: any): any | null {
    return link.inwardIssue || link.outwardIssue || null;
}

// ─── Description Parsing Helper ─────────────────────────────────

/**
 * Extract plain text from Jira ADF description.
 * Handles both ADF (Atlassian Document Format) and plain text.
 */
function extractTextFromADF(adf: any): string {
    if (!adf) return '';
    if (typeof adf === 'string') return adf;

    // ADF format
    const texts: string[] = [];
    const walk = (node: any) => {
        if (!node) return;
        if (node.type === 'text' && node.text) {
            texts.push(node.text);
        }
        if (Array.isArray(node.content)) {
            node.content.forEach(walk);
        }
    };
    if (Array.isArray(adf.content)) {
        adf.content.forEach(walk);
    }
    return texts.join(' ');
}

/**
 * Extract plain text from Jira ADF comment body.
 */
function extractCommentBody(body: any): string {
    if (!body) return '';
    // ADF format
    if (body.content) {
        return extractTextFromADF(body);
    }
    // Plain text (older Jira)
    if (typeof body === 'string') return body;
    return String(body);
}

// ─── Context Extraction ─────────────────────────────────────────

/**
 * Keywords that suggest business logic / user actions
 */
const BUSINESS_LOGIC_PATTERNS = [
    /click(s|ed)?\s+(save|submit|cancel|add|delete|edit|update|search)/i,
    /fill(s|ed)?\s+(field|input|form|username|password|name|email)/i,
    /select(s|ed)?\s+(dropdown|option|menu|category|department)/i,
    /navigate(s|d)?\s+to\s+/i,
    /redirect(s|ed)?\s+/i,
    /display(s|ed)?\s+(error|success|warning|message|alert)/i,
    /validat(es|ed|ion)?\s+/i,
    /calculat(es|ed|ion)?\s+/i,
    /approv(es|ed|al)?\s+/i,
    /reject(s|ed)?\s+/i,
    /submits?\s+form/i,
    /save(s|d)?\s+record/i,
    /grid.*null/i,
    /crash(es|ed)?/i,
    /error.*page/i,
    /page.*freeze/i,
    /cannot\s+/i,
    /unable\s+to\s+/i,
];

/**
 * Keywords that suggest new fields or features added
 */
const NEW_FIELD_PATTERNS = [
    /added?\s+(a|new|the)\s+(field|column|input|dropdown|button|section|tab)/i,
    /new\s+(required|optional)?\s*field\s+"?/i,
    /"?\w+\s*Code"?/i,
    /"?\w+\s*ID"?/i,
    /"?\w+\s*Name"?/i,
    /"?\w+\s*Date"?/i,
    /"?\w+\s*Type"?/i,
];

/**
 * Keywords that suggest UI selectors or element references
 */
const SELECTOR_PATTERNS = [
    /"([^"]+(?:button|dropdown|grid|table|form|input|modal|dialog|tab|menu|panel))"/i,
    /(?:button|dropdown|grid|table|form|input|modal|dialog|tab|menu|panel)\s+(?:named|called|titled|with)\s+"([^"]+)"/i,
    /\[data-testid="([^"]+)"\]/i,
    /\[name="([^"]+)"\]/i,
    /#(\w+)/i,
    /\.k-[\w-]+/i,
];

/**
 * Keywords that suggest risk areas
 */
const RISK_PATTERNS = [
    /fragile/i,
    /edge\s*case/i,
    /race\s*condition/i,
    /timing\s*issue/i,
    /flaky/i,
    /intermittent/i,
    /unpredictable/i,
    /manual\s*(work)?around/i,
    /hack/i,
    /temporary\s*fix/i,
    /needs\s*revisit/i,
    /regression\s*risk/i,
    /careful/i,
    /important/i,
];

// ─── Main Service ───────────────────────────────────────────────

export class LinkedTicketIntelligenceService {

    /**
     * Get all linked issues for a ticket with classified link types.
     * Does NOT fetch full descriptions/comments — use getFullContext for that.
     */
    static async getLinkedIssues(ticketId: string): Promise<LinkedIssue[]> {
        try {
            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get(`/rest/api/3/issue/${ticketId}?fields=issuelinks`);

            const links = response.data.fields?.issuelinks || [];
            const results: LinkedIssue[] = [];

            for (const link of links) {
                const key = getLinkedKey(link);
                if (!key) continue;

                const issueData = getLinkedIssueData(link);
                const fields = issueData?.fields || {};

                results.push({
                    key,
                    linkType: classifyLink(link),
                    summary: fields.summary || '',
                    issueType: fields.issuetype?.name || '',
                    status: fields.status?.name,
                });
            }

            return results;
        } catch (error: any) {
            appLogger.warn(`[LinkedTicket] Failed to fetch links for ${ticketId}`, { error: error.message });
            return [];
        }
    }

    /**
     * Get full context for all linked issues — descriptions + comments.
     */
    static async getFullContext(ticketId: string): Promise<LinkContext> {
        const links = await this.getLinkedIssues(ticketId);
        if (links.length === 0) return { links, details: [] };

        const details: IssueDetail[] = [];

        for (const link of links) {
            try {
                const jiraAxios = getJiraAxios();
                // Fetch with description and comments
                const response = await jiraAxios.get(
                    `/rest/api/3/issue/${link.key}?fields=description,summary,issuetype,status&expand=comment`
                );

                const fields = response.data.fields || {};
                const comments = (response.data.comment?.comments || []).map((c: any) => ({
                    body: extractCommentBody(c.body),
                    author: c.author?.displayName || c.author?.name || 'Unknown',
                    created: c.created,
                }));

                details.push({
                    key: link.key,
                    summary: fields.summary || link.summary,
                    issueType: fields.issuetype?.name || link.issueType,
                    status: fields.status?.name || link.status,
                    linkType: link.linkType,
                    description: extractTextFromADF(fields.description),
                    comments,
                });
            } catch (error: any) {
                appLogger.warn(`[LinkedTicket] Failed to fetch details for ${link.key}`, { error: error.message });
                // Still include the link but without details
                details.push({
                    key: link.key,
                    summary: link.summary,
                    issueType: link.issueType,
                    status: link.status,
                    linkType: link.linkType,
                    description: undefined,
                    comments: [],
                });
            }
        }

        return { links, details };
    }

    /**
     * Extract test-relevant context from linked tickets.
     * Scans descriptions and comments for business logic hints, new fields,
     * selector hints, and risk areas.
     */
    static extractTestContext(context: LinkContext): ExtractedTestContext {
        const result: ExtractedTestContext = {
            businessLogicHints: [],
            newFields: [],
            selectorHints: [],
            riskAreas: [],
        };

        for (const detail of context.details) {
            const textsToScan: string[] = [];

            // Scan description
            if (detail.description) textsToScan.push(detail.description);

            // Scan comments
            for (const comment of detail.comments) {
                textsToScan.push(comment.body);
            }

            for (const text of textsToScan) {
                // Business logic
                for (const pattern of BUSINESS_LOGIC_PATTERNS) {
                    const match = text.match(pattern);
                    if (match && !result.businessLogicHints.includes(match[0])) {
                        result.businessLogicHints.push(match[0].trim());
                    }
                }

                // New fields
                for (const pattern of NEW_FIELD_PATTERNS) {
                    const match = text.match(pattern);
                    if (match && !result.newFields.includes(match[0])) {
                        result.newFields.push(match[0].trim());
                    }
                }

                // Selectors
                for (const pattern of SELECTOR_PATTERNS) {
                    const match = text.match(pattern);
                    if (match && !result.selectorHints.includes(match[0])) {
                        result.selectorHints.push(match[0].trim());
                    }
                }

                // Risk areas
                for (const pattern of RISK_PATTERNS) {
                    const match = text.match(pattern);
                    if (match && !result.riskAreas.includes(match[0])) {
                        result.riskAreas.push(match[0].trim());
                    }
                }
            }
        }

        return result;
    }

    /**
     * Produce a human-readable summary for AI test generation prompts.
     * This text is injected into the test generation pipeline so the AI
     * knows about linked tickets and their context.
     */
    static async summarizeForTestGeneration(ticketId: string): Promise<string> {
        const context = await this.getFullContext(ticketId);
        if (context.links.length === 0) {
            return '📎 Linked Tickets: No linked tickets found.';
        }

        const lines: string[] = [];
        lines.push(`📎 Linked Tickets (${context.links.length}):`);
        lines.push('');

        for (const detail of context.details) {
            const emoji = detail.linkType === LinkType.IS_BLOCKED_BY ? '🚧'
                : detail.linkType === LinkType.IS_IMPLEMENTED_BY ? '🔧'
                : detail.linkType === LinkType.TESTS_FOR ? '🧪'
                : detail.linkType === LinkType.RELATES_TO ? '🔗'
                : '❓';

            lines.push(`${emoji} ${detail.key} (${detail.linkType}) — ${detail.summary}`);
            if (detail.status) lines.push(`   Status: ${detail.status}`);
            if (detail.issueType) lines.push(`   Type: ${detail.issueType}`);

            if (detail.description) {
                const preview = detail.description.length > 200
                    ? detail.description.substring(0, 200) + '...'
                    : detail.description;
                lines.push(`   Description: ${preview}`);
            }

            if (detail.comments.length > 0) {
                const latestComment = detail.comments[detail.comments.length - 1];
                const commentPreview = latestComment.body.length > 150
                    ? latestComment.body.substring(0, 150) + '...'
                    : latestComment.body;
                lines.push(`   Latest Comment (${latestComment.author}): ${commentPreview}`);
            }

            lines.push('');
        }

        // Extract test context hints
        const testContext = this.extractTestContext(context);
        if (testContext.businessLogicHints.length > 0) {
            lines.push('💡 Business Logic Hints:');
            testContext.businessLogicHints.forEach(h => lines.push(`   - ${h}`));
            lines.push('');
        }
        if (testContext.newFields.length > 0) {
            lines.push('🆕 New Fields/Features:');
            testContext.newFields.forEach(f => lines.push(`   - ${f}`));
            lines.push('');
        }
        if (testContext.riskAreas.length > 0) {
            lines.push('⚠️ Risk Areas:');
            testContext.riskAreas.forEach(r => lines.push(`   - ${r}`));
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Get only "is blocked by" tickets — used to determine dependencies
     * that must be verified before running tests.
     */
    static async getBlockingIssues(ticketId: string): Promise<LinkedIssue[]> {
        const links = await this.getLinkedIssues(ticketId);
        return links.filter(l => l.linkType === LinkType.IS_BLOCKED_BY);
    }

    /**
     * Get only "is implemented by" tickets — used to know what changed
     * so tests can focus on the new/modified functionality.
     */
    static async getImplementationTickets(ticketId: string): Promise<LinkedIssue[]> {
        const links = await this.getLinkedIssues(ticketId);
        return links.filter(l => l.linkType === LinkType.IS_IMPLEMENTED_BY);
    }

    /**
     * Get only "tests for" tickets — the primary target this GT is validating.
     */
    static async getTestTargets(ticketId: string): Promise<LinkedIssue[]> {
        const links = await this.getLinkedIssues(ticketId);
        return links.filter(l => l.linkType === LinkType.TESTS_FOR);
    }
}
