import { UsageTrackerService } from './shared/UsageTrackerService';

export interface BudgetedPromptResult {
    prompt: string;
    isTruncated: boolean;
    originalTokens: number;
    finalTokens: number;
}

export class TokenManagerService {
    private static readonly DEFAULT_MAX_TOKENS = 30000;

    /**
     * Estimate token count from character count.
     */
    static estimateTokens(text: string): number {
        return UsageTrackerService.estimateTokens(text.length);
    }

    /**
     * Intelligently truncate a Jira ticket object to fit within a token budget.
     * Prioritizes description and recent comments over older ones.
     */
    static truncateJiraTicket(ticket: any, maxTokens: number): { ticket: any; isTruncated: boolean } {
        const ticketStr = JSON.stringify(ticket);
        let currentTokens = this.estimateTokens(ticketStr);

        if (currentTokens <= maxTokens) {
            return { ticket, isTruncated: false };
        }

        const clonedTicket = JSON.parse(JSON.stringify(ticket));
        let truncated = false;

        // 1. Remove/Truncate attachments if present
        if (clonedTicket.attachments && clonedTicket.attachments.length > 5) {
            clonedTicket.attachments = clonedTicket.attachments.slice(0, 5);
            truncated = true;
        }

        // 2. Iteratively remove oldest comments
        if (clonedTicket.comments && clonedTicket.comments.length > 0) {
            while (clonedTicket.comments.length > 0 && this.estimateTokens(JSON.stringify(clonedTicket)) > maxTokens) {
                clonedTicket.comments.shift(); // Remove oldest
                truncated = true;
            }
        }

        // 3. Last resort: truncate the description
        if (this.estimateTokens(JSON.stringify(clonedTicket)) > maxTokens && clonedTicket.description) {
            const descTokens = this.estimateTokens(clonedTicket.description);
            const budgetForDesc = Math.max(1000, maxTokens - (this.estimateTokens(JSON.stringify(clonedTicket)) - descTokens));
            
            // Approx chars = tokens * 3.5
            const maxChars = Math.floor(budgetForDesc * 3.5);
            if (clonedTicket.description.length > maxChars) {
                clonedTicket.description = clonedTicket.description.substring(0, maxChars) + '\n... [truncated due to token limit]';
                truncated = true;
            }
        }

        return { ticket: clonedTicket, isTruncated: truncated };
    }

    /**
     * Truncate a UI element map to fit within a token budget.
     * Prunes generic containers (div, span) that lack unique IDs or text.
     */
    static truncateUIMap(elements: any[], maxTokens: number): { elements: any[]; isTruncated: boolean } {
        let currentTokens = this.estimateTokens(JSON.stringify(elements));

        if (currentTokens <= maxTokens) {
            return { elements, isTruncated: false };
        }

        // 1. Filter out generic elements without "high-signal" attributes
        const filtered = elements.filter(el => {
            const hasId = !!el.id || !!el.attributes?.id;
            const hasText = !!el.text || !!el.innerText;
            const isInput = ['input', 'button', 'select', 'a', 'textarea'].includes(el.tagName?.toLowerCase());
            const hasRole = !!el.role || !!el.attributes?.role;

            return hasId || hasText || isInput || hasRole;
        });

        currentTokens = this.estimateTokens(JSON.stringify(filtered));
        if (currentTokens <= maxTokens) {
            return { elements: filtered, isTruncated: true };
        }

        // 2. If still over, take only the first N elements that fit
        const finalElements: any[] = [];
        let accumulatedTokens = this.estimateTokens('[]');
        
        for (const el of filtered) {
            const elTokens = this.estimateTokens(JSON.stringify(el)) + 1; // +1 for comma
            if (accumulatedTokens + elTokens > maxTokens) break;
            finalElements.push(el);
            accumulatedTokens += elTokens;
        }

        return { elements: finalElements, isTruncated: true };
    }

    /**
     * Builds a prompt by allocating budgets to different components.
     */
    static buildBudgetedPrompt(
        systemPrompt: string,
        jiraData: any,
        uiMap: any[],
        totalBudget: number = this.DEFAULT_MAX_TOKENS
    ): BudgetedPromptResult {
        const sysTokens = this.estimateTokens(systemPrompt);
        
        // Reserve 20% or at least 4k for the Jira ticket, the rest for UI Map
        const jiraBudget = Math.floor(totalBudget * 0.3);
        const uiBudget = totalBudget - sysTokens - jiraBudget - 500; // 500 safety buffer

        const { ticket: truncatedTicket, isTruncated: jiraTruncated } = this.truncateJiraTicket(jiraData, jiraBudget);
        const { elements: truncatedUI, isTruncated: uiTruncated } = this.truncateUIMap(uiMap, uiBudget);

        const finalPrompt = `
${systemPrompt}

### JIRA TICKET DATA
${JSON.stringify(truncatedTicket, null, 2)}

### UI ELEMENT MAP
${JSON.stringify(truncatedUI, null, 2)}
`.trim();

        const originalTokens = sysTokens + this.estimateTokens(JSON.stringify(jiraData)) + this.estimateTokens(JSON.stringify(uiMap));
        const finalTokens = this.estimateTokens(finalPrompt);

        return {
            prompt: finalPrompt,
            isTruncated: jiraTruncated || uiTruncated,
            originalTokens,
            finalTokens
        };
    }
}
