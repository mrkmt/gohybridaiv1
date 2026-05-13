import { Request, Response } from 'express';
import { JiraAutomationService } from '../services/jira/JiraAutomationService';
import { appLogger } from '../utils/logger';
import dotenv from 'dotenv';

dotenv.config();

// Pattern specifically for allowed projects (ATT, AB) to avoid mock IDs like MB-123
const TICKET_KEY_PATTERN = /(ATT|AB)-\d+/gi;

export class JiraCrossProjectController {
    /**
     * Webhook endpoint for cross-project Jira automation.
     * Listens for issue_updated events.
     *
     * Security: Validates shared secret from Jira webhook configuration.
     * Set JIRA_WEBHOOK_SECRET env var to enable validation.
     */
    static async handleCrossProjectWebhook(req: Request, res: Response): Promise<void> {
        // Validate shared secret if configured
        const expectedSecret = process.env.JIRA_WEBHOOK_SECRET;
        if (expectedSecret) {
            const providedSecret = req.headers['x-webhook-secret'] as string || req.query.secret as string;
            if (!providedSecret || providedSecret !== expectedSecret) {
                appLogger.warn('[JiraCrossProject] Webhook rejected: invalid or missing shared secret');
                res.status(401).json({ error: 'Unauthorized: invalid webhook secret' });
                return;
            }
        }

        const payload = req.body;
        const issue = payload.issue;
        const changelog = payload.changelog;

        if (!issue || !issue.key) {
            res.status(400).json({ error: 'Invalid webhook payload' });
            return;
        }

        const projectKey = (issue.fields?.project?.key || '').toUpperCase();
        const issueKey = issue.key;

        appLogger.info(`[JiraWebhook] Received update for ${issueKey} in project ${projectKey}`);

        // Logic: Only process if project is ATT (Automation Test Team)
        if (projectKey !== 'ATT') {
            appLogger.info(`[JiraWebhook] Skipping issue ${issueKey} - Not in ATT project.`);
            res.status(200).json({ status: 'ignored', reason: 'not_att_project' });
            return;
        }

        // Check if status transitioned to "In Testing"
        const statusItem = changelog?.items?.find((item: any) => item.field === 'status');
        const statusValue = (statusItem?.toString || issue.fields?.status?.name || '').trim();

        if (!/in testing/i.test(statusValue)) {
            appLogger.info(`[JiraWebhook] Issue ${issueKey} status is '${statusValue}'. Skipping automation.`);
            res.status(200).json({ status: 'ignored', reason: 'not_in_testing_status' });
            return;
        }

        appLogger.info(`[JiraWebhook] Issue ${issueKey} is now 'In Testing'. Processing automation...`);

        // Attempt 1: Extract from Jira Linked Work Items (issuelinks array)
        let targetId: string | null = null;

        if (issue.fields?.issuelinks && Array.isArray(issue.fields.issuelinks)) {
            for (const link of issue.fields.issuelinks) {
                const linkTarget = link.outwardIssue || link.inwardIssue;
                if (linkTarget && linkTarget.key) {
                    const key = linkTarget.key.toUpperCase();
                    // NEW: Ensure linked ticket belongs to a valid target project (AB)
                    if (key.startsWith('AB-')) {
                        targetId = key;
                        appLogger.info(`[JiraWebhook] Found valid target project ID ${targetId} in issue links.`);
                        break;
                    }
                }
            }
        }

        // Attempt 2: Extract from Summary/Description (regex: /(ATT|AB)-\d+/gi)
        if (!targetId) {
            const summary = issue.fields?.summary || '';
            const description = issue.fields?.description?.content ? JSON.stringify(issue.fields.description) : (issue.fields?.description || '');
            const content = `${summary} ${description}`;
            
            // Find all matches and pick the first one that isn't the current issue
            const matches = content.match(TICKET_KEY_PATTERN);

            if (matches) {
                for (const match of matches) {
                    const candidate = match.toUpperCase();
                    if (candidate !== issueKey.toUpperCase() && candidate.startsWith('AB-')) {
                        targetId = candidate;
                        appLogger.info(`[JiraWebhook] Found valid Target ID ${targetId} in text content.`);
                        break;
                    }
                }
            }
            
            if (!targetId) {
                appLogger.info(`[JiraWebhook] No valid target project (AB) pattern match in text content.`);
            }
        }

        if (!targetId) {
            appLogger.warn(`[JiraWebhook] No Target Bug ID ([PROJECT]-XXX) found in ${issueKey} links or text.`);
            res.status(200).json({ status: 'partial_success', reason: 'no_target_id_found' });
            return;
        }

        // Exclude self-references just in case
        if (targetId === issueKey.toUpperCase()) {
            appLogger.warn(`[JiraWebhook] Found ID is self-referencing (${issueKey}). Skipping link.`);
            res.status(200).json({ status: 'partial_success', reason: 'self_referencing_id' });
            return;
        }

        appLogger.info(`[JiraWebhook] Target Bug ID confirmed: ${targetId}. Triggering actions...`);

        try {
            // 1. Link Tickets using 'Testing' link type
            appLogger.info(`[JiraWebhook] Calling linkTickets(${issueKey}, ${targetId}, 'Testing')...`);
            await JiraAutomationService.linkTickets(issueKey, targetId, 'Testing');

            // 2. Add mention to the linked bug for QA Lead
            const message = `This bug is currently being verified by the Automation Test Team. Reference: ${issueKey}`;
            appLogger.info(`[JiraWebhook] Adding comment to ${targetId}...`);
            await JiraAutomationService.addComment(targetId, message);

            appLogger.info(`[JiraWebhook] Automation completed successfully!`);
            res.status(200).json({ status: 'success', linkedTo: targetId });
        } catch (error: any) {
            const errorMsg = error.message || 'Unknown error';
            const errorStatus = error.response?.status || 'N/A';
            const errorData = error.response?.data || 'N/A';
            appLogger.error(`[JiraWebhook] Automation failed for ${issueKey}: ${errorMsg}`, { source: 'JiraWebhook', issueKey, jiraStatus: errorStatus, errorData: JSON.stringify(errorData) });
            res.status(500).json({ error: errorMsg, jiraStatus: errorStatus, details: errorData });
        }
    }
}
