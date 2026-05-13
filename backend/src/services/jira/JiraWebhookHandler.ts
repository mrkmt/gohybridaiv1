/**
 * JiraWebhookHandler
 *
 * Processes incoming Jira webhook events for bidirectional sync.
 * - Detects ticket changes (status, description, summary, comments)
 * - Flags sessions that need regeneration when requirements change
 * - Triggers re-test notifications when linked bugs are marked Fixed
 * - Idempotent: tracks processed webhooks to avoid duplicate processing
 */

import { getJiraAxios } from '../../utils/jiraAxios';
import { TestSessionCacheService } from '../session/TestSessionCacheService';
import { appLogger } from '../../utils/logger';
import type { DbClient } from '../shared/TelemetryService';
import type { TestSession } from '../session/TestSessionCacheService';

export interface JiraWebhookEvent {
    webhookEvent: string;
    issue: {
        id: string;
        key: string;
        fields: {
            summary?: string;
            description?: any;
            status?: { name: string; id: string };
            issuetype?: { name: string };
        };
    };
    changelog?: {
        items: Array<{
            field: string;
            fromString: string;
            toString: string;
        }>;
    };
    user: {
        displayName: string;
        name: string;
    };
    comment?: {
        body: any;
        author: { displayName: string };
    };
}

export type WebhookAction =
    | { type: 'no-op'; reason: string }
    | { type: 'flag_regenerate'; ticketId: string; reason: string }
    | { type: 'trigger_rerun'; bugKey: string; reason: string; module?: string }
    | { type: 'update_session'; ticketId: string; reason: string };

export class JiraWebhookHandler {
    private static pool: DbClient | null = null;
    private static processedWebhooks = new Set<string>();
    private static readonly MAX_PROCESSED_CACHE = 10000;

    static setPool(dbPool: DbClient): void {
        this.pool = dbPool;
    }

    /**
     * Main entry point for webhook processing.
     * Validates, deduplicates, and routes the event.
     */
    static async handleWebhook(event: JiraWebhookEvent): Promise<WebhookAction[]> {
        const actions: WebhookAction[] = [];

        // Basic validation
        if (!event?.issue?.key) {
            appLogger.warn('[JiraWebhook] Invalid webhook: missing issue key');
            return [{ type: 'no-op', reason: 'Invalid webhook: missing issue key' }];
        }

        const ticketKey = event.issue.key;

        // Idempotent check via webhookEvent unique ID
        const webhookId = event.webhookEvent + ':' + (event.issue.id || '') + ':' + Date.now();
        if (this.processedWebhooks.has(webhookId)) {
            return [{ type: 'no-op', reason: `Already processed ${webhookId}` }];
        }
        this.processedWebhooks.add(webhookId);
        if (this.processedWebhooks.size > this.MAX_PROCESSED_CACHE) {
            // Clear oldest entries
            const toDelete = [...this.processedWebhooks].slice(0, 2000);
            toDelete.forEach(k => this.processedWebhooks.delete(k));
        }

        // Log webhook for audit
        await this.logWebhook(ticketKey, event.webhookEvent, event);

        appLogger.info(`[JiraWebhook] Processing event ${event.webhookEvent} for ${ticketKey}`);

        // Route by event type
        switch (event.webhookEvent) {
            case 'jira:issue_updated':
                actions.push(...await this.handleIssueUpdated(event));
                break;
            case 'jira:issue_created':
                // New testing ticket potentially — check if it links to existing bugs
                actions.push(...await this.handleIssueCreated(event));
                break;
            case 'jira:comment_created':
                actions.push(...await this.handleCommentCreated(event));
                break;
            default:
                return [{ type: 'no-op', reason: `Unhandled event type: ${event.webhookEvent}` }];
        }

        return actions.length > 0 ? actions : [{ type: 'no-op', reason: 'No actions triggered' }];
    }

    /**
     * Handle ticket updates — detect field changes and session impact.
     */
    private static async handleIssueUpdated(event: JiraWebhookEvent): Promise<WebhookAction[]> {
        const actions: WebhookAction[] = [];
        const ticketKey = event.issue.key;
        const changelogItems = event.changelog?.items || [];

        if (changelogItems.length === 0) {
            return [{ type: 'no-op', reason: 'No changes in changelog' }];
        }

        // Check for status change
        const statusChange = changelogItems.find(item => item.field === 'status');
        if (statusChange) {
            const statusActions = await this.handleStatusChange(ticketKey, statusChange, event);
            actions.push(...statusActions);
        }

        // Check for description/summary change
        const descChange = changelogItems.find(item => item.field === 'description');
        const summaryChange = changelogItems.find(item => item.field === 'summary');
        if (descChange || summaryChange) {
            const flagAction = await this.handleFieldsChanged(ticketKey, descChange, summaryChange);
            actions.push(flagAction);
        }

        return actions;
    }

    /**
     * Handle ticket creation — potential new testing ticket.
     */
    private static async handleIssueCreated(event: JiraWebhookEvent): Promise<WebhookAction[]> {
        const ticketKey = event.issue.key;

        // Check if this is a testing ticket (ATT- prefix or has testing labels)
        if (!ticketKey.startsWith('ATT-') && !ticketKey.startsWith('TEST-')) {
            return [{ type: 'no-op', reason: `Not a testing ticket: ${ticketKey}` }];
        }

        // Check for linked bugs
        try {
            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get(`/rest/api/3/issue/${ticketKey}`, {
                params: { fields: 'issuelinks' }
            });

            const issueLinks = response.data.fields?.issuelinks || [];
            const linkedBugs = issueLinks
                .map((link: any) => link.outwardIssue || link.inwardIssue)
                .filter(Boolean)
                .filter((issue: any) => issue.fields?.issuetype?.name === 'Bug');

            if (linkedBugs.length > 0) {
                appLogger.info(`[JiraWebhook] New testing ticket ${ticketKey} linked to ${linkedBugs.length} bug(s)`);
                // Auto-orchestrate if not already started
                const existingSession = await this.findSessionByTicketKey(ticketKey);
                if (!existingSession) {
                    return [{ type: 'flag_regenerate', ticketId: ticketKey, reason: 'New testing ticket created with linked bug(s)' }];
                }
            }
        } catch (err: any) {
            appLogger.warn(`[JiraWebhook] Failed to check links for ${ticketKey}`, { error: err.message });
        }

        return [];
    }

    /**
     * Handle new comments on tickets.
     */
    private static async handleCommentCreated(event: JiraWebhookEvent): Promise<WebhookAction[]> {
        const actions: WebhookAction[] = [];
        const ticketKey = event.issue.key;
        const comment = event.comment;

        if (!comment) {
            return [{ type: 'no-op', reason: 'No comment in event' }];
        }

        const commentText = this.extractTextFromADF(comment.body);

        // Check if comment mentions testing (e.g., "please test", "fixed", "ready for QA")
        const testingKeywords = ['please test', 'ready for qa', 'ready for testing', 'fixed and verified', 'test this'];
        const lowerComment = commentText.toLowerCase();

        if (testingKeywords.some(kw => lowerComment.includes(kw))) {
            appLogger.info(`[JiraWebhook] Comment on ${ticketKey} suggests testing: "${commentText.substring(0, 100)}"`);
            const existingSession = await this.findSessionByTicketKey(ticketKey);
            if (existingSession) {
                actions.push({ type: 'update_session', ticketId: ticketKey, reason: 'New comment suggests testing needed' });
            } else {
                actions.push({ type: 'flag_regenerate', ticketId: ticketKey, reason: 'New comment triggers need for testing session' });
            }
        }

        return actions;
    }

    /**
     * Handle status changes — detect "Fixed" transitions on bugs.
     */
    private static async handleStatusChange(
        ticketKey: string,
        change: { field: string; fromString: string; toString: string },
        event: JiraWebhookEvent
    ): Promise<WebhookAction[]> {
        const actions: WebhookAction[] = [];
        const issueType = event.issue.fields?.issuetype?.name || '';

        // If a Bug was marked as Done/Fixed/Resolved → trigger regression re-test
        if (issueType === 'Bug') {
            const fixedStatuses = ['Done', 'Fixed', 'Resolved', 'Closed', 'Bug Done'];
            if (fixedStatuses.includes(change.toString) && !fixedStatuses.includes(change.fromString)) {
                appLogger.info(`[JiraWebhook] Bug ${ticketKey} marked as ${change.toString} — checking for regression tests`);

                // Find the module this bug belongs to
                const module = this.guessModuleFromTicket(ticketKey);

                // Find previous testing sessions for this module
                try {
                    const previousSessions = await this.findPreviousSessions(ticketKey);
                    if (previousSessions.length > 0) {
                        actions.push({
                            type: 'trigger_rerun',
                            bugKey: ticketKey,
                            reason: `Bug marked as ${change.toString} — regression re-test recommended`,
                            module
                        });
                        appLogger.info(`[JiraWebhook] Regression re-test recommended for module: ${module}`);
                    }
                } catch (err: any) {
                    appLogger.warn(`[JiraWebhook] Failed to find previous sessions for ${ticketKey}`, { error: err.message });
                }
            }
        }

        // If a testing ticket (ATT-*) moved to In Testing without a session being started
        if (ticketKey.startsWith('ATT-') && change.toString.includes('Testing')) {
            const existingSession = await this.findSessionByTicketKey(ticketKey);
            if (!existingSession) {
                actions.push({ type: 'flag_regenerate', ticketId: ticketKey, reason: 'Testing ticket moved to In Testing without session' });
            }
        }

        return actions;
    }

    /**
     * Handle description or summary changes — flag regeneration if session exists.
     */
    private static async handleFieldsChanged(
        ticketKey: string,
        descChange?: { field: string; fromString: string; toString: string },
        summaryChange?: { field: string; fromString: string; toString: string }
    ): Promise<WebhookAction> {
        const existingSession = await this.findSessionByTicketKey(ticketKey);

        if (!existingSession) {
            return { type: 'no-op', reason: `No active session for ${ticketKey}, no regeneration needed` };
        }

        // Check if ticket is already completed (session done) — skip if already done
        if (existingSession.phase === 'done' || existingSession.status === 'completed') {
            return { type: 'no-op', reason: `Session for ${ticketKey} already completed, ignoring field changes` };
        }

        const changedFields: string[] = [];
        if (descChange) changedFields.push('description');
        if (summaryChange) changedFields.push('summary');

        // Flag the session as needing regeneration
        // The returning WebhookAction drives the actual regeneration

        appLogger.info(`[JiraWebhook] Session for ${ticketKey} flagged: ${changedFields.join(', ')} changed`);

        return {
            type: 'flag_regenerate',
            ticketId: ticketKey,
            reason: `${changedFields.join(', ')} changed — test cases may need regeneration`
        };
    }

    // ─── Private Helpers ─────────────────────────────────────────────

    /**
     * Find a session by ticket key alone (webhooks don't know the userId).
     * Scans active test_sessions table for any user.
     */
    private static async findSessionByTicketKey(ticketKey: string): Promise<TestSession | undefined> {
        if (!this.pool) return undefined;
        try {
            const { rows } = await this.pool.query(
                `SELECT id, ticket_id, user_id, summary, description, status, phase,
                        test_cases::text as test_cases_raw,
                        results::text as results_raw,
                        environment::text as environment_raw,
                        user_scenarios::text as user_scenarios_raw,
                        comments::text as comments_raw,
                        compiled_scripts::text as compiled_scripts_raw,
                        confidence_assessment::text as confidence_assessment_raw,
                        jira_snapshot,
                        artifacts_path, version, history::text as history_raw,
                        created_at, updated_at, completed_at
                 FROM test_sessions WHERE ticket_id = $1 ORDER BY updated_at DESC LIMIT 1`,
                [ticketKey]
            );
            if (rows.length === 0) return undefined;
            // Deserialize inline — copy the deserialize logic to avoid circular dependency
            const row = rows[0];
            const raw = row.test_cases_raw;
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return {
                id: row.id,
                ticketId: row.ticket_id,
                userId: row.user_id,
                summary: row.summary,
                description: row.description,
                status: row.status,
                phase: row.phase,
                testCases: data,
                approvedTestCases: true,
                environment: row.environment_raw ? (typeof row.environment_raw === 'string' ? JSON.parse(row.environment_raw) : row.environment_raw) : undefined,
                jiraSnapshot: row.jira_snapshot ? (typeof row.jira_snapshot === 'string' ? JSON.parse(row.jira_snapshot) : row.jira_snapshot) : { summary: row.summary || '', description: row.description || '', status: 'Unknown' },
                results: row.results_raw ? (typeof row.results_raw === 'string' ? JSON.parse(row.results_raw) : row.results_raw) : undefined,
                artifactsPath: row.artifacts_path,
                version: row.version,
                history: row.history_raw ? (typeof row.history_raw === 'string' ? JSON.parse(row.history_raw) : row.history_raw) : [],
                userScenarios: row.user_scenarios_raw ? (typeof row.user_scenarios_raw === 'string' ? JSON.parse(row.user_scenarios_raw) : row.user_scenarios_raw) : [],
                comments: row.comments_raw ? (typeof row.comments_raw === 'string' ? JSON.parse(row.comments_raw) : row.comments_raw) : [],
                compiledScripts: row.compiled_scripts_raw ? (typeof row.compiled_scripts_raw === 'string' ? JSON.parse(row.compiled_scripts_raw) : row.compiled_scripts_raw) : undefined,
                confidenceAssessment: row.confidence_assessment_raw ? (typeof row.confidence_assessment_raw === 'string' ? JSON.parse(row.confidence_assessment_raw) : row.confidence_assessment_raw) : undefined,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                completedAt: row.completed_at
            };
        } catch {
            return undefined;
        }
    }

    private static extractTextFromADF(adf: any): string {
        if (!adf) return '';
        if (typeof adf === 'string') return adf;
        if (adf.content && Array.isArray(adf.content)) {
            return adf.content.map((node: any) => {
                if (node.text) return node.text;
                if (node.content) return this.extractTextFromADF({ content: node.content });
                return '';
            }).join(' ');
        }
        return '';
    }

    private static guessModuleFromTicket(ticketKey: string): string {
        // Heuristic: extract from linked issues or use default
        // In production, this could query Jira for the ticket's component/module
        return ticketKey;
    }

    private static async findPreviousSessions(bugKey: string): Promise<any[]> {
        // Find previous testing sessions that were linked to this bug via linked issues
        // Queries the DB for sessions where the ticket links to this bug key
        if (!this.pool) {
            return [];
        }

        try {
            // Search for ATT- tickets that are linked to the given bug
            const jiraAxios = getJiraAxios();
            const response = await jiraAxios.get(`/rest/api/3/search/jql`, {
                params: {
                    jql: `project = ATT AND issuetype = "Testing" AND status != Done ORDER BY created DESC`,
                    maxResults: 10,
                    fields: 'key,summary'
                }
            });

            const issues = response.data?.issues || [];
            const sessionPromises = issues.map(async (issue: any) => {
                return this.findSessionByTicketKey(issue.key);
            });

            const results = await Promise.all(sessionPromises);
            return results.filter(Boolean);
        } catch {
            // Fallback: if we have the pool, query test_sessions table directly
            if (this.pool) {
                try {
                    const result = await this.pool.query(
                        `SELECT * FROM test_sessions WHERE status != 'completed' AND status != 'cancelled' AND updated_at > NOW() - INTERVAL '30 days'`
                    );
                    return result.rows;
                } catch {
                    return [];
                }
            }
            return [];
        }
    }

    private static async logWebhook(
        ticketKey: string,
        eventType: string,
        event: JiraWebhookEvent
    ): Promise<void> {
        if (!this.pool) return;

        try {
            await this.pool.query(
                `INSERT INTO jira_webhook_log (webhook_id, event_type, ticket_key, payload, processed_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (webhook_id) DO NOTHING`,
                [
                    event.webhookEvent + ':' + event.issue.id,
                    eventType,
                    ticketKey,
                    JSON.stringify(event).substring(0, 50000)
                ]
            );
        } catch (err: any) {
            // Table may not exist yet — log warning silently
            if (err.code !== '42P01') {
                appLogger.warn('[JiraWebhook] Failed to log webhook to DB', { error: err.message });
            }
        }
    }
}
