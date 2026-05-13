/**
 * ChatMentionService — Unit Tests
 */

import { ChatMentionService } from '../../src/services/shared/ChatMentionService';

describe('ChatMentionService', () => {
    describe('extractTicketIds', () => {
        it('extracts standard Jira ticket IDs', () => {
            const message = 'Please check ATT-42 and MB-100';
            const tickets = ChatMentionService.extractTicketIds(message);
            expect(tickets).toHaveLength(2);
            expect(tickets[0].ticketId).toBe('ATT-42');
            expect(tickets[1].ticketId).toBe('MB-100');
        });

        it('handles case-insensitivity during extraction', () => {
            const message = 'att-42 is fixed';
            const tickets = ChatMentionService.extractTicketIds(message);
            expect(tickets).toHaveLength(1);
            expect(tickets[0].ticketId).toBe('ATT-42');
        });

        it('extracts unique ticket IDs', () => {
            const message = 'ATT-42, ATT-42 and more ATT-42';
            const uniqueIds = ChatMentionService.extractUniqueTicketIds(message);
            expect(uniqueIds).toEqual(['ATT-42']);
        });

        it('does not get confused by multiple calls (regex state test)', () => {
            const msg1 = 'ATT-1';
            const msg2 = 'MB-2';
            expect(ChatMentionService.extractTicketIds(msg1)[0].ticketId).toBe('ATT-1');
            expect(ChatMentionService.extractTicketIds(msg2)[0].ticketId).toBe('MB-2');
            expect(ChatMentionService.extractTicketIds(msg1)[0].ticketId).toBe('ATT-1');
        });
    });

    describe('filterBotComments (Allow-list Flip)', () => {
        const comments = [
            { body: 'This is a human comment', author: { displayName: 'Kaung Myat Thu', accountType: 'atlassian' } },
            { body: 'Another human comment', author: { displayName: 'Admin', accountType: 'atlassian' } },
            { body: 'GoHybrid AI execution completed', author: { displayName: 'GoHybrid AI', accountType: 'app' } },
            { body: '🤖 Test Results for ATT-42', author: { displayName: 'Automation Bot', accountType: 'app' } },
            { body: 'Previously tested... Last run pass', author: { displayName: 'Service Desk', accountType: 'atlassian' } }, // Bot-like content from human-type account
        ];

        it('allows human/atlassian comments by default', () => {
            const filtered = ChatMentionService.filterBotComments(comments);
            // Should allow: Kaung Myat Thu, Admin
            // Should reject: GoHybrid AI (app), Automation Bot (app)
            // Should reject: Service Desk (even if atlassian) because it matches BOT_COMMENT_PATTERNS
            expect(filtered).toHaveLength(2);
            expect(filtered[0].author?.displayName).toBe('Kaung Myat Thu');
            expect(filtered[1].author?.displayName).toBe('Admin');
        });

        it('supports explicit HUMAN_AUTHORS allow-list', () => {
            process.env.HUMAN_AUTHORS = 'Kaung Myat Thu, Tester Joe';
            const testComments = [
                { body: 'Hello', author: { displayName: 'Kaung Myat Thu' } },
                { body: 'Hi', author: { displayName: 'Tester Joe' } },
                { body: 'Spam', author: { displayName: 'Other Person' } },
            ];
            const filtered = ChatMentionService.filterBotComments(testComments);
            expect(filtered).toHaveLength(2);
            expect(filtered.some(c => c.author?.displayName === 'Other Person')).toBe(false);
            delete process.env.HUMAN_AUTHORS;
        });

        it('rejects "app" accountType regardless of content', () => {
            const appComments = [
                { body: 'Looks like a human wrote this', author: { displayName: 'Sneaky Bot', accountType: 'app' } }
            ];
            const filtered = ChatMentionService.filterBotComments(appComments);
            expect(filtered).toHaveLength(0);
        });

        it('rejects bot-like content even from "atlassian" accounts', () => {
            const testComments = [
                { body: 'Test Summary for ATT-42', author: { displayName: 'Some User', accountType: 'atlassian' } }
            ];
            const filtered = ChatMentionService.filterBotComments(testComments);
            expect(filtered).toHaveLength(0);
        });
    });
});
