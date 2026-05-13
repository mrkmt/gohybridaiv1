import { getJiraAxios } from '../../utils/jiraAxios';
import { TestResult } from '../execution/TestExecutionService';
import { FailureClassificationService } from '../execution/FailureClassificationService';
import { AiControllerService } from '../shared/AiControllerService';
import { JiraUploadService } from './JiraUploadService';
import { appLogger } from '../../utils/logger';

export class JiraBugReportingService {
    /**
     * Analyze a test failure and automatically report a Bug in Jira if it's a definitive defect.
     */
    static async reportDefectIfApplicable(originalTicketId: string, result: TestResult): Promise<string | null> {
        if (result.status !== 'FAIL') return null;

        const classification = FailureClassificationService.classifyTestResult(result);
        const isDefect = FailureClassificationService.shouldReportAsBug(classification);

        if (!isDefect) {
            appLogger.info(`[JiraBugReporting] Failure on ${originalTicketId} classified as ${classification.category} (Script issue: ${classification.isScriptIssue}). Skipping auto-bug creation.`);
            return null;
        }

        appLogger.info(`[JiraBugReporting] Definitive defect detected on ${originalTicketId}. Generating bug report...`);

        try {
            // 1. Generate AI Bug Report
            const bugInfo = await this.generateBugDetails(originalTicketId, result);
            
            // 2. Extract Project Key (e.g., "ATT" from "ATT-15")
            const projectKey = originalTicketId.split('-')[0];

            // 3. Create Bug Ticket in Jira
            const jiraAxios = getJiraAxios();
            const createResponse = await jiraAxios.post('/rest/api/3/issue', {
                fields: {
                    project: { key: projectKey },
                    summary: bugInfo.summary,
                    description: {
                        type: "doc",
                        version: 1,
                        content: [
                            {
                                type: "paragraph",
                                content: [{ type: "text", text: bugInfo.description }]
                            }
                        ]
                    },
                    issuetype: { name: "Bug" },
                    // You might want to map other fields like Priority or Component here
                }
            });

            const newBugId = createResponse.data.key;
            appLogger.info(`[JiraBugReporting] ✓ Created Bug ticket: ${newBugId}`);

            // 4. Link to original ticket — isolated try/catch to prevent orphaned tickets
            let linked = false;
            try {
                await jiraAxios.post('/rest/api/3/issueLink', {
                    type: { name: "Relates" }, // or "Blocks"
                    inwardIssue: { key: newBugId },
                    outwardIssue: { key: originalTicketId }
                });
                appLogger.info(`[JiraBugReporting] ✓ Linked ${newBugId} to ${originalTicketId}`);
                linked = true;
            } catch (linkErr: any) {
                // Linking failed — bug ticket exists but is orphaned
                // Mitigation: Add a comment to the bug ticket with the original ticket reference
                appLogger.error(`[JiraBugReporting] Failed to link ${newBugId} to ${originalTicketId}: ${linkErr.message}`);
                try {
                    await jiraAxios.post(`/rest/api/3/issue/${newBugId}/comment`, {
                        body: {
                            type: "doc",
                            version: 1,
                            content: [
                                {
                                    type: "paragraph",
                                    content: [
                                        { type: "text", text: `⚠️ Auto-reported defect from ` },
                                        { type: "text", text: originalTicketId, marks: [{ type: "link", attrs: { href: `https://${process.env.JIRA_DOMAIN || 'jira.atlassian.net'}/browse/${originalTicketId}` } }] },
                                        { type: "text", text: ". Issue linking failed — manual verification required." }
                                    ]
                                }
                            ]
                        }
                    });
                    appLogger.info(`[JiraBugReporting] Added fallback comment to ${newBugId} referencing ${originalTicketId}`);
                } catch (commentErr: any) {
                    // Even comment failed — log critical warning
                    appLogger.error(`[JiraBugReporting] CRITICAL: Bug ticket ${newBugId} is ORPHANED. Could not link or comment. Original ticket: ${originalTicketId}. Manual cleanup required.`, {
                        bugTicket: newBugId,
                        originalTicket: originalTicketId,
                        linkError: linkErr.message,
                        commentError: commentErr.message
                    });
                }
            }

            // 5. Upload Video Attachment if present — non-blocking
            if (result.videoPath) {
                try {
                    await JiraUploadService.uploadAttachment(newBugId, result.videoPath);
                    appLogger.info(`[JiraBugReporting] ✓ Uploaded video to ${newBugId}`);
                } catch (videoErr: any) {
                    appLogger.warn(`[JiraBugReporting] Video upload failed for ${newBugId}: ${videoErr.message}`);
                    // Non-critical — bug ticket is still valid without video
                }
            }

            // Return bug ID only if linked, otherwise return null to signal partial failure
            return linked ? newBugId : null;
        } catch (err: any) {
            appLogger.error(`[JiraBugReporting] Failed to auto-report bug: ${err.message}`, { error: err });
            return null;
        }
    }

    /**
     * Use AI to generate a professional Bug Summary and Description from technical logs.
     */
    private static async generateBugDetails(ticketId: string, result: TestResult): Promise<{ summary: string; description: string }> {
        const prompt = `
# Role: Senior QA Lead
# Task: Create a concise Bug Report for Jira based on a failed Playwright test.

## CONTEXT
- **Original Ticket:** ${ticketId}
- **Test Case:** ${result.testCaseId} - ${result.testCaseTitle}
- **Failing Step:** ${result.steps.find(s => s.status === 'FAIL')?.action || 'Unknown'}
- **Error Log:** ${result.errorMessage}

## REQUIREMENTS
1. Generate a "Bug Summary" (title) that is clear and specific (max 100 chars).
2. Generate a "Bug Description" that includes:
   - What was expected vs what happened.
   - Key technical error details.
   - Mention that this was auto-discovered by the GoHybrid AI platform.
3. Return the data in valid JSON format:
{
  "summary": "...",
  "description": "..."
}
`.trim();

        try {
            const aiResponse = await AiControllerService.generate('ANALYST', prompt);
            
            // Clean AI response (strip markdown blocks if present)
            const cleaned = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleaned);
            
            return {
                summary: parsed.summary || `Bug: ${result.testCaseTitle} failed`,
                description: parsed.description || result.errorMessage || 'No details provided'
            };
        } catch (err) {
            // Fallback if AI fails
            return {
                summary: `[AI-FAIL] Bug: ${result.testCaseTitle} failed during step: ${result.steps.find(s => s.status === 'FAIL')?.action || 'unknown'}`,
                description: `Manual investigation required.\n\nError: ${result.errorMessage}`
            };
        }
    }
}
