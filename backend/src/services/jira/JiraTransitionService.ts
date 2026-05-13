/**
 * JiraTransitionService
 * 
 * Handles Jira issue status transitions using Jira REST API v3.
 * Supports dynamic transition detection for any project and status.
 */

import { getJiraAxios, jiraRequest } from '../../utils/jiraAxios';
import { appLogger } from '../../utils/logger';

/**
 * Retry a function with exponential backoff.
 * Used for Jira API calls which may experience transient failures.
 */
async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await jiraRequest(fn);
        } catch (error: any) {
            lastError = error;
            const isRateLimit = error.response?.status === 429;
            const isServerErr = error.response?.status >= 500;
            const isNetworkErr = !error.response && error.code !== 'ERR_BAD_REQUEST';

            // Only retry on transient errors (429, 5xx, network)
            if (!isRateLimit && !isServerErr && !isNetworkErr) {
                throw error; // Immediate error, don't retry
            }

            if (attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt); // 1s, 2s, 4s
                appLogger.warn(`[JiraTransition] Transient error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    throw lastError || new Error('Unknown retry error');
}

export interface JiraStatus {
    id: string;
    name: string;
    statusCategory: {
        key: string;
        colorName: string;
    };
}

export interface JiraTransition {
    id: string;
    name: string;
    to: JiraStatus;
    hasScreen: boolean;
    isGlobal: boolean;
    isInitial: boolean;
    isAvailable: boolean;
    isConditional: boolean;
}

export interface TransitionResult {
    success: boolean;
    ticketId: string;
    fromStatus: string;
    toStatus: string;
    transitionId: string;
    message?: string;
}

export class JiraTransitionService {
    private static readonly DEFAULT_STATUSES = {
        TO_DO: ['To Do', 'Open', 'Backlog', 'New'],
        IN_TESTING: ['In Testing', 'Testing', 'QA', 'Test'],
        DONE: ['Done', 'Closed', 'Resolved', 'Complete'],
        BUG_DONE: ['Bug Done', 'Fixed', 'Resolved Bug']
    };

    /**
     * Get current status of a Jira issue
     * @param ticketId - Jira ticket ID (e.g., "AB-15")
     * @returns Current status name
     */
    static async getCurrentStatus(ticketId: string): Promise<string> {
        try {
            const jiraAxios = getJiraAxios();
            const response = await jiraRequest(() => jiraAxios.get(`/rest/api/3/issue/${ticketId}`, {
                params: { fields: 'status' }
            }));

            return response.data.fields.status?.name || 'Unknown';
        } catch (error: any) {
            appLogger.error(`[JiraTransition] Failed to get status for ${ticketId}`, { error: error.message });
            throw new Error(`Failed to get status for ${ticketId}: ${error.message}`);
        }
    }

    /**
     * Get all available transitions for an issue
     * @param ticketId - Jira ticket ID
     * @returns Array of available transitions
     */
    static async getAvailableTransitions(ticketId: string): Promise<JiraTransition[]> {
        try {
            const jiraAxios = getJiraAxios();
            const response = await jiraRequest(() => jiraAxios.get(`/rest/api/3/issue/${ticketId}/transitions`));

            return response.data.transitions || [];
        } catch (error: any) {
            appLogger.error(`[JiraTransition] Failed to get transitions for ${ticketId}`, { error: error.message });
            return [];
        }
    }

    /**
     * Find transition ID for a target status name
     * @param ticketId - Jira ticket ID
     * @param targetStatus - Target status name (case-insensitive)
     * @returns Transition ID or null if not found
     */
    static async findTransitionId(ticketId: string, targetStatus: string): Promise<string | null> {
        const transitions = await this.getAvailableTransitions(ticketId);
        const targetLower = targetStatus.toLowerCase();

        for (const transition of transitions) {
            const transitionName = transition.to?.name?.toLowerCase() || '';
            if (transitionName === targetLower || transitionName.includes(targetLower)) {
                return transition.id;
            }
        }

        // Fallback: partial match
        for (const transition of transitions) {
            const transitionName = transition.to?.name?.toLowerCase() || '';
            if (transitionName.includes(targetLower)) {
                return transition.id;
            }
        }

        return null;
    }

    /**
     * Transition an issue to a specific status
     * @param ticketId - Jira ticket ID
     * @param targetStatus - Target status name
     * @param comment - Optional comment to add with transition
     * @returns Transition result
     */
    static async transitionToStatus(
        ticketId: string,
        targetStatus: string,
        comment?: string
    ): Promise<TransitionResult> {
        try {
            return await withRetry(async () => {
                const currentStatus = await this.getCurrentStatus(ticketId);
                const transitionId = await this.findTransitionId(ticketId, targetStatus);

                if (!transitionId) {
                    throw new Error(`No transition found to "${targetStatus}" for ${ticketId}`);
                }

                const jiraAxios = getJiraAxios();

                // Build transition payload with optional comment in ADF format
                const payload: any = {
                    transition: { id: transitionId }
                };

                if (comment) {
                    payload.update = {
                        comment: [
                            {
                                add: {
                                    body: {
                                        type: 'doc',
                                        version: 1,
                                        content: [
                                            {
                                                type: 'paragraph',
                                                content: [
                                                    {
                                                        type: 'text',
                                                        text: comment
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                }
                            }
                        ]
                    };
                }

                await jiraRequest(() => jiraAxios.post(`/rest/api/3/issue/${ticketId}/transitions`, payload));

                    appLogger.info(`[JiraTransition] Successfully transitioned ${ticketId} from "${currentStatus}" to "${targetStatus}"`);

                return {
                    success: true,
                    ticketId,
                    fromStatus: currentStatus,
                    toStatus: targetStatus,
                    transitionId
                };
            });
        } catch (error: any) {
            appLogger.error(`[JiraTransition] Transition failed for ${ticketId} after retries`, { error: error.message });
            return {
                success: false,
                ticketId,
                fromStatus: '',
                toStatus: targetStatus,
                transitionId: '',
                message: error.message
            };
        }
    }

    /**
     * Auto-transition from "To Do" to "In Testing" if current status allows
     * @param ticketId - Jira ticket ID
     * @returns Transition result
     */
    static async autoTransitionToInTesting(ticketId: string): Promise<TransitionResult> {
        try {
            const currentStatus = await this.getCurrentStatus(ticketId);
            const currentStatusLower = currentStatus.toLowerCase();

            appLogger.info(`[JiraTransition] Auto-transition requested for ${ticketId}. Current status: ${currentStatus}`);

            // Check if ticket is in a "To Do" like status
            const isToDo = this.DEFAULT_STATUSES.TO_DO.some(
                status => status.toLowerCase() === currentStatusLower ||
                         currentStatusLower.includes(status.toLowerCase())
            );

            if (!isToDo) {
                appLogger.info(`[JiraTransition] Skipping auto-transition for ${ticketId} - Current status: ${currentStatus} is not in To Do list`);
                return {
                    success: false,
                    ticketId,
                    fromStatus: currentStatus,
                    toStatus: 'In Testing',
                    transitionId: '',
                    message: `Ticket is not in "To Do" status. Current: ${currentStatus}`
                };
            }

            appLogger.info(`[JiraTransition] Ticket is in To Do status. Attempting transition to "In Testing"...`);

            // Try "In Testing" first, then fallback to similar statuses
            const targetStatuses = ['In Testing', 'Testing', 'In Progress', 'QA'];

            for (const targetStatus of targetStatuses) {
                appLogger.info(`[JiraTransition] Attempting transition to "${targetStatus}"...`);
                const result = await this.transitionToStatus(
                    ticketId,
                    targetStatus,
                    `🤖 GoHybrid AI: Auto-transitioned to "${targetStatus}" for automated testing.`
                );

                if (result.success) {
                    appLogger.info(`[JiraTransition] Successfully transitioned ${ticketId} to "${targetStatus}"`);
                    return result;
                } else {
                    appLogger.warn(`[JiraTransition] Failed to transition to "${targetStatus}": ${result.message}`);
                }
            }

            throw new Error(`No valid transition found to any testing status for ${ticketId}. Available targets: ${targetStatuses.join(', ')}`);
        } catch (error: any) {
            appLogger.error(`[JiraTransition] Auto-transition failed for ${ticketId}`, { error: error.message, stack: error.stack });
            return {
                success: false,
                ticketId,
                fromStatus: '',
                toStatus: 'In Testing',
                transitionId: '',
                message: error.message
            };
        }
    }

    /**
     * Auto-transition to a "To Do" or "Backlog" status
     * @param ticketId - Jira ticket ID
     * @param comment - Optional comment explaining the fallback
     * @returns Transition result
     */
    static async autoTransitionToToDo(ticketId: string, comment?: string): Promise<TransitionResult> {
        try {
            const currentStatus = await this.getCurrentStatus(ticketId);
            const currentStatusLower = currentStatus.toLowerCase();

            // First, check if already in To Do
            const isToDo = this.DEFAULT_STATUSES.TO_DO.some(
                status => status.toLowerCase() === currentStatusLower ||
                         currentStatusLower.includes(status.toLowerCase())
            );

            if (isToDo) {
                return {
                    success: true,
                    ticketId,
                    fromStatus: currentStatus,
                    toStatus: currentStatus,
                    transitionId: '',
                    message: `Ticket is already in a "To Do" status. Current: ${currentStatus}`
                };
            }

            for (const targetStatus of this.DEFAULT_STATUSES.TO_DO) {
                const result = await this.transitionToStatus(
                    ticketId,
                    targetStatus,
                    comment || `🤖 GoHybrid AI: Test session aborted, returning to "${targetStatus}".`
                );

                if (result.success) {
                    return result;
                }
            }

            throw new Error(`No valid transition found to any To Do status for ${ticketId}`);
        } catch (error: any) {
            appLogger.error(`[JiraTransition] Auto-transition to To Do failed for ${ticketId}`, { error: error.message });
            return {
                success: false,
                ticketId,
                fromStatus: '',
                toStatus: 'To Do',
                transitionId: '',
                message: error.message
            };
        }
    }

    /**
     * Transition to "Done" status
     * @param ticketId - Jira ticket ID
     * @param comment - Optional comment
     * @returns Transition result
     */
    static async transitionToDone(ticketId: string, comment?: string): Promise<TransitionResult> {
        return this.transitionToStatus(ticketId, 'Done', comment);
    }

    /**
     * Transition to "Bug Done" status
     * @param ticketId - Jira ticket ID
     * @param comment - Optional comment
     * @returns Transition result
     */
    static async transitionToBugDone(ticketId: string, comment?: string): Promise<TransitionResult> {
        // Try "Bug Done" first, fallback to "Fixed" or "Done"
        try {
            const result = await this.transitionToStatus(ticketId, 'Bug Done', comment);
            if (result.success) return result;
        } catch (e) {
            // Fallback to "Fixed"
        }

        return this.transitionToStatus(ticketId, 'Fixed', comment || 'Bug fixed and verified');
    }

    /**
     * Check if a status is considered "Done"
     * @param statusName - Status name to check
     * @returns true if status is a done-like status
     */
    static isDoneStatus(statusName: string): boolean {
        const statusLower = statusName.toLowerCase();
        return this.DEFAULT_STATUSES.DONE.some(s => 
            statusLower === s.toLowerCase() || statusLower.includes(s.toLowerCase())
        ) || this.DEFAULT_STATUSES.BUG_DONE.some(s => 
            statusLower === s.toLowerCase() || statusLower.includes(s.toLowerCase())
        );
    }

    /**
     * Check if a status is considered "In Testing"
     * @param statusName - Status name to check
     * @returns true if status is a testing-like status
     */
    static isTestingStatus(statusName: string): boolean {
        const statusLower = statusName.toLowerCase();
        return this.DEFAULT_STATUSES.IN_TESTING.some(s => 
            statusLower === s.toLowerCase() || statusLower.includes(s.toLowerCase())
        );
    }

    /**
     * Add a comment to a Jira issue (ADF format)
     * @param ticketId - Jira ticket ID
     * @param comment - Comment text
     */
    static async addComment(ticketId: string, comment: string): Promise<void> {
        try {
            const jiraAxios = getJiraAxios();
            await jiraRequest(() => jiraAxios.post(`/rest/api/3/issue/${ticketId}/comment`, {
                body: {
                    type: 'doc',
                    version: 1,
                    content: [
                        {
                            type: 'paragraph',
                            content: [
                                {
                                    type: 'text',
                                    text: comment
                                }
                            ]
                        }
                    ]
                }
            }));
            appLogger.info(`[JiraTransition] Comment added to ${ticketId}`);
        } catch (error: any) {
            appLogger.error(`[JiraTransition] Failed to add comment to ${ticketId}`, { error: error.message });
            throw error;
        }
    }

    /**
     * Determines which action buttons to show in the ticket card.
     */
    static getTicketActions(status: string): {
        canStart: boolean;
        canRetest: boolean;
        canAddScenarios: boolean;
        isReadOnly: boolean;
    } {
        const normalized = status.toLowerCase().trim();
        return {
            canStart: normalized === 'to do' || normalized === 'open' || normalized === 'backlog',
            canRetest: normalized === 'in testing' || normalized === 'testing' || normalized === 'qa',
            canAddScenarios: normalized === 'in testing' || normalized === 'testing' || normalized === 'qa',
            isReadOnly: normalized === 'done' || normalized === 'bug done' || normalized === 'closed' || normalized === 'resolved',
        };
    }
}

