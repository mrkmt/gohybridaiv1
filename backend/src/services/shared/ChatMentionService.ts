/**
 * ChatMentionService
 * 
 * Extracts Jira ticket IDs from chat messages and validates their format.
 * Supports any project key pattern (e.g., AB-15, ATT-42, MB-100, KMT-1234)
 */

export interface MentionedTicket {
    ticketId: string;
    projectKey: string;
    issueNumber: string;
    position: number;
}

export class ChatMentionService {
    /**
     * Regex pattern to match Jira ticket IDs
     * Matches: 2-10 uppercase letters, hyphen, 1-6 digits
     * Examples: AB-1, ATT-42, MB-100, KMT-1234, GLOBALHR-999999
     */
    private static readonly JIRA_TICKET_PATTERN = /\b([A-Z]{2,10})-(\d{1,6})\b/gi;

    /**
     * Extract all Jira ticket IDs from a chat message
     * @param message - The chat message text
     * @returns Array of mentioned tickets with metadata
     */
    static extractTicketIds(message: string): MentionedTicket[] {
        const tickets: MentionedTicket[] = [];
        // P1 FIX: Use fresh regex instance to avoid lastIndex state issues across calls
        const pattern = new RegExp(this.JIRA_TICKET_PATTERN.source, this.JIRA_TICKET_PATTERN.flags);
        const matches = [...message.matchAll(pattern)];

        for (const match of matches) {
            const fullMatch = match[0];
            const projectKey = match[1].toUpperCase();
            const issueNumber = match[2];
            const position = match.index || 0;

            tickets.push({
                ticketId: `${projectKey}-${issueNumber}`,
                projectKey,
                issueNumber,
                position
            });
        }

        return tickets;
    }

    /**
     * Extract unique ticket IDs (deduplicated)
     * @param message - The chat message text
     * @returns Array of unique ticket IDs
     */
    static extractUniqueTicketIds(message: string): string[] {
        const tickets = this.extractTicketIds(message);
        const uniqueIds = new Set(tickets.map(t => t.ticketId));
        return Array.from(uniqueIds);
    }

    /**
     * Validate if a string is a valid Jira ticket format
     * @param ticketId - The ticket ID to validate
     * @returns true if valid format
     */
    static validateTicketFormat(ticketId: string): boolean {
        if (!ticketId || typeof ticketId !== 'string') {
            return false;
        }

        const normalized = ticketId.trim().toUpperCase();
        // Use a fresh stateless regex for validation instead of the global one to avoid lastIndex issues
        return /^[A-Z]{2,10}-\d{1,6}$/.test(normalized);
    }

    /**
     * Extract project key from a ticket ID
     * @param ticketId - Full ticket ID (e.g., "AB-15")
     * @returns Project key (e.g., "AB")
     */
    static getProjectKey(ticketId: string): string | null {
        const match = ticketId.toUpperCase().match(/^([A-Z]{2,10})-\d{1,6}$/);
        return match ? match[1] : null;
    }

    /**
     * Extract issue number from a ticket ID
     * @param ticketId - Full ticket ID (e.g., "AB-15")
     * @returns Issue number as string (e.g., "15")
     */
    static getIssueNumber(ticketId: string): string | null {
        const match = ticketId.toUpperCase().match(/^[A-Z]{2,10}-(\d{1,6})$/);
        return match ? match[1] : null;
    }

    /**
     * Normalize ticket ID to standard format (PROJECT-123)
     * @param ticketId - Ticket ID in any case
     * @returns Normalized ticket ID (uppercase project key)
     */
    static normalizeTicketId(ticketId: string): string | null {
        const match = ticketId.trim().match(/^([A-Za-z]{2,10})-(\d{1,6})$/);
        if (!match) {
            return null;
        }
        return `${match[1].toUpperCase()}-${match[2]}`;
    }

    /**
     * Check if a message contains any Jira ticket mentions
     * @param message - The chat message text
     * @returns true if at least one ticket is mentioned
     */
    static hasTicketMention(message: string): boolean {
        // Use matching rather than stateful testing
        return message.search(/\b([A-Z]{2,10})-(\d{1,6})\b/i) !== -1;
    }

    /**
     * Get the first mentioned ticket ID from a message
     * @param message - The chat message text
     * @returns First ticket ID or null if none found
     */
    static getFirstTicketId(message: string): string | null {
        const tickets = this.extractTicketIds(message);
        return tickets.length > 0 ? tickets[0].ticketId : null;
    }

    /**
     * Remove all ticket mentions from a message (for cleaning)
     * @param message - The chat message text
     * @returns Message with ticket IDs removed
     */
    static removeTicketMentions(message: string): string {
        return message.replace(this.JIRA_TICKET_PATTERN, '').trim();
    }

    /**
     * Replace ticket mentions with formatted links
     * @param message - The chat message text
     * @param baseUrl - Jira base URL for links
     * @returns Message with HTML/Markdown links
     */
    static formatTicketLinks(message: string, baseUrl: string = 'https://jira.atlassian.com'): string {
        return message.replace(this.JIRA_TICKET_PATTERN, (match) => {
            const ticketId = match.toUpperCase();
            return `[${ticketId}](${baseUrl}/browse/${ticketId})`;
        });
    }

    // ─── Bot Comment Filtering ───────────────────────────────────────────────

    /**
     * Patterns that identify comments posted BY GoHybrid AI itself.
     * These must be excluded when extracting scenarios from Jira comments,
     * otherwise the system will re-analyze its own test results as requirements.
     */
    private static readonly BOT_COMMENT_PATTERNS = [
        /GoHybrid\s*AI/i,
        /Auto-transitioned/i,
        /Testing\s*started/i,
        /Deduplication\s*Check/i,
        /Testing\s*session\s*aborted/i,
        /previously\s*tested.*Last\s*run/i,
        /Test\s*Results\s*for/i,
        /execution\s*completed/i,
        /Test\s*Summary/i,
        /report\s*uploaded/i,
        /\ud83e\udd16/, // robot emoji (🤖)
        /\ud83d\udcca/, // chart emoji (📊)
        /\ud83d\udcce/, // paperclip emoji (📎)
    ];

    /**
     * Check if a comment was posted by a human.
     * P0 FIX: Flipped from deny-list to allow-list of authors/roles.
     */
    static isHumanComment(commentBody: string, author?: { displayName?: string; accountType?: string }): boolean {
        const body = commentBody || '';
        const authorName = author?.displayName || '';
        const accountType = author?.accountType || '';

        // 1. Explicit Bot Account Type (Jira Cloud API)
        if (accountType === 'app') return false;

        // 2. Explicit Human Account Type (Jira Cloud API)
        if (accountType === 'atlassian' || accountType === 'customer') {
            // Secondary check: even "human" accounts might be used by automation if misconfigured,
            // so we still check our bot patterns.
            return !this.BOT_COMMENT_PATTERNS.some(pattern => pattern.test(body));
        }

        // 3. Known Human Authors Allow-list (from environment)
        const allowedHumans = (process.env.HUMAN_AUTHORS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (allowedHumans.length > 0) {
            const lowerName = authorName.toLowerCase();
            if (allowedHumans.some(h => lowerName === h || lowerName.includes(h))) {
                return true;
            }
            // If we have an allow-list and the author isn't in it, treat as bot/unknown
            return false;
        }

        // 4. Fallback: Legacy Deny-list (if no accountType or allow-list provided)
        const botNames = ['GoHybrid AI', 'go-hybrid-ai', 'gohybridai', 'bot', 'automation'];
        if (botNames.some(name => authorName.toLowerCase().includes(name.toLowerCase()))) {
            return false;
        }

        return !this.BOT_COMMENT_PATTERNS.some(pattern => pattern.test(body));
    }

    /**
     * Filter out GoHybrid AI's own comments from a Jira comment array.
     * Returns only human-written comments for scenario extraction.
     */
    static filterBotComments(comments: Array<{ body?: string; author?: { displayName?: string; accountType?: string } }>): Array<{ body?: string; author?: { displayName?: string; accountType?: string } }> {
        return comments.filter(c => {
            const body = c.body || '';
            // Handle both plain text and ADF body (extractTextFromADF should be used by caller if needed)
            const bodyText = typeof body === 'string' ? body : '';
            return this.isHumanComment(bodyText, c.author);
        });
    }
}
