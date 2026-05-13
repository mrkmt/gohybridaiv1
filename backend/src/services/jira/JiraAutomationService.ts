import { getJiraAxios } from '../../utils/jiraAxios';
import { appLogger } from '../../utils/logger';

export class JiraAutomationService {
    /**
     * Connect two tickets using an issue link.
     * @param sourceKey The ticket that initiated the link (e.g., ATT-123)
     * @param targetKey The bug/story to link to (e.g., AB-16)
     * @param linkType The type of link (e.g., 'Testing', 'Relates')
     */
    static async linkTickets(sourceKey: string, targetKey: string, linkType: string = 'Testing'): Promise<void> {
        appLogger.info(`[JiraAutomation] Linking ${sourceKey} to ${targetKey} as '${linkType}'`);

        try {
            const jiraApi = getJiraAxios();
            
            // First, verify the link type exists
            appLogger.info(`[JiraAutomation] Verifying link type '${linkType}'...`);
            
            const response = await jiraApi.post('/rest/api/3/issueLink', {
                type: { name: linkType },
                inwardIssue: { key: targetKey },
                outwardIssue: { key: sourceKey }
            });
            
            appLogger.info(`[JiraAutomation] Successfully linked ${sourceKey} <-> ${targetKey}`);
            return response.data;
        } catch (error: any) {
            const status = error.response?.status;
            const data = error.response?.data;
            const errorMessages = data?.errorMessages || [];
            
            appLogger.error(`[JiraAutomation] Failed to link tickets`, { status, error: error.message });

            // Provide helpful diagnostic messages
            if (status === 404) {
                const isMissingIssue = errorMessages.some((m: string) => m.toLowerCase().includes('issue does not exist') || m.toLowerCase().includes('permission to see it'));

                if (isMissingIssue) {
                    appLogger.error(`[JiraAutomation] CRITICAL: One of the tickets (${sourceKey} or ${targetKey}) does not exist or is inaccessible.`);
                } else {
                    appLogger.error(`[JiraAutomation] Link type '${linkType}' may not exist. Available link types:`);
                    try {
                        const linkTypes = await getJiraAxios().get('/rest/api/3/issueLinkType');
                        appLogger.info(`[JiraAutomation] Available link types`, { linkTypes: linkTypes.data.issueLinkTypes.map((lt: any) => lt.name).join(', ') });
                    } catch (e) {
                        appLogger.error(`[JiraAutomation] Could not fetch link types`);
                    }
                }
            } else if (status === 400) {
                 appLogger.error(`[JiraAutomation] Bad Request: Check if tickets are in the same instance or for other business rule violations.`);
            }

            appLogger.error(`[JiraAutomation] Full Response data`, { data: JSON.stringify(data, null, 2) });
            throw error;
        }
    }

    /**
     * Add a comment to an issue with optional user mention.
     * Supports both plain string messages and structured Atlassian Document Format (ADF) objects.
     */
    static async addComment(issueKey: string, message: string | any, accountId?: string, mentionText: string = '@QA Lead'): Promise<void> {
        appLogger.info(`[JiraAutomation] Adding comment to ${issueKey}${accountId ? ` with mention for ${accountId}` : ''}`);
        try {
            let adfBody: any;

            if (typeof message === 'object' && message.type === 'doc') {
                // If message is already an ADF document, use it
                adfBody = message;
                
                // If we have an accountId, prepend the mention to the first paragraph
                if (accountId && adfBody.content && adfBody.content.length > 0) {
                    const firstBlock = adfBody.content[0];
                    if (firstBlock.type === 'paragraph' || firstBlock.type === 'heading') {
                        if (!firstBlock.content) firstBlock.content = [];
                        firstBlock.content.unshift(
                            {
                                type: 'mention',
                                attrs: { id: accountId, text: mentionText, accessLevel: '' }
                            },
                            { type: 'text', text: ' ' }
                        );
                    }
                }
            } else {
                // Otherwise, wrap string in a simple ADF document
                const paragraphContent: any[] = [];
                if (accountId) {
                    paragraphContent.push({
                        type: 'mention',
                        attrs: { id: accountId, text: mentionText, accessLevel: '' }
                    });
                    paragraphContent.push({ type: 'text', text: ' ' });
                }
                
                paragraphContent.push({
                    type: 'text',
                    text: String(message)
                });

                adfBody = {
                    version: 1,
                    type: 'doc',
                    content: [
                        {
                            type: 'paragraph',
                            content: paragraphContent
                        }
                    ]
                };
            }

            await getJiraAxios().post(`/rest/api/3/issue/${issueKey}/comment`, {
                body: adfBody
            });
            appLogger.info(`[JiraAutomation] Comment added to ${issueKey}`);
        } catch (error: any) {
            appLogger.error(`[JiraAutomation] Failed to add comment`, { error: error.message });
            throw error;
        }
    }

    /**
     * Update a specific custom field or system field on an issue.
     */
    static async updateCustomField(issueKey: string, fieldId: string, value: any): Promise<void> {
        appLogger.info(`[JiraAutomation] Updating field ${fieldId} on ${issueKey}`);
        try {
            await getJiraAxios().put(`/rest/api/3/issue/${issueKey}`, {
                fields: {
                    [fieldId]: value
                }
            });
            appLogger.info(`[JiraAutomation] Successfully updated ${fieldId} on ${issueKey}`);
        } catch (error: any) {
            appLogger.error(`[JiraAutomation] Failed to update field`, { error: error.message });
            throw error;
        }
    }
}
