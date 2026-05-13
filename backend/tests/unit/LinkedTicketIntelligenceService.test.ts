/**
 * LinkedTicketIntelligenceService — Unit Tests
 */

import {
    LinkedTicketIntelligenceService,
    LinkType,
    LinkContext,
} from '../../src/services/LinkedTicketIntelligenceService';

// Mock getJiraAxios
const mockGet = jest.fn();
jest.mock('../../src/utils/jiraAxios', () => ({
    getJiraAxios: () => ({ get: mockGet }),
}));

describe('LinkedTicketIntelligenceService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('getLinkedIssues', () => {
        it('returns empty array when no links exist', async () => {
            mockGet.mockResolvedValue({ data: { fields: { issuelinks: [] } } });
            const result = await LinkedTicketIntelligenceService.getLinkedIssues('GT-100');
            expect(result).toEqual([]);
        });

        it('classifies "is blocked by" links correctly', async () => {
            mockGet.mockResolvedValue({
                data: {
                    fields: {
                        issuelinks: [{
                            type: { name: 'Blocker', inward: 'is blocked by', outward: 'blocks' },
                            inwardIssue: { key: 'GB-50', fields: { summary: 'Login crashes', issuetype: { name: 'Bug' } } },
                        }],
                    },
                },
            });
            const result = await LinkedTicketIntelligenceService.getLinkedIssues('GT-100');
            expect(result).toHaveLength(1);
            expect(result[0].linkType).toBe(LinkType.IS_BLOCKED_BY);
            expect(result[0].key).toBe('GB-50');
        });

        it('classifies "is implemented by" links correctly', async () => {
            mockGet.mockResolvedValue({
                data: {
                    fields: {
                        issuelinks: [{
                            type: { name: 'Implement', inward: 'is implemented by', outward: 'implements' },
                            inwardIssue: { key: 'GD-25', fields: { summary: 'Add validation', issuetype: { name: 'Task' } } },
                        }],
                    },
                },
            });
            const result = await LinkedTicketIntelligenceService.getLinkedIssues('GT-100');
            expect(result).toHaveLength(1);
            expect(result[0].linkType).toBe(LinkType.IS_IMPLEMENTED_BY);
        });

        it('classifies "tests for" links correctly', async () => {
            mockGet.mockResolvedValue({
                data: {
                    fields: {
                        issuelinks: [{
                            type: { name: 'Tests', inward: 'tests', outward: 'is tested by' },
                            outwardIssue: { key: 'GB-60', fields: { summary: 'Registration', issuetype: { name: 'Story' } } },
                        }],
                    },
                },
            });
            const result = await LinkedTicketIntelligenceService.getLinkedIssues('GT-100');
            expect(result).toHaveLength(1);
            expect(result[0].linkType).toBe(LinkType.TESTS_FOR);
        });

        it('handles multiple link types', async () => {
            mockGet.mockResolvedValue({
                data: {
                    fields: {
                        issuelinks: [
                            { type: { name: 'Blocker', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'GB-50', fields: { summary: 'Bug', issuetype: { name: 'Bug' } } } },
                            { type: { name: 'Implement', inward: 'is implemented by', outward: 'implements' }, inwardIssue: { key: 'GD-25', fields: { summary: 'Fix', issuetype: { name: 'Task' } } } },
                            { type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, outwardIssue: { key: 'GT-99', fields: { summary: 'Related', issuetype: { name: 'Testing' } } } },
                        ],
                    },
                },
            });
            const result = await LinkedTicketIntelligenceService.getLinkedIssues('GT-100');
            expect(result).toHaveLength(3);
            expect(result.map(r => r.linkType)).toContain(LinkType.IS_BLOCKED_BY);
            expect(result.map(r => r.linkType)).toContain(LinkType.IS_IMPLEMENTED_BY);
            expect(result.map(r => r.linkType)).toContain(LinkType.RELATES_TO);
        });

        it('returns empty array on API error', async () => {
            mockGet.mockRejectedValue(new Error('API timeout'));
            const result = await LinkedTicketIntelligenceService.getLinkedIssues('GT-100');
            expect(result).toEqual([]);
        });
    });

    describe('getFullContext', () => {
        it('fetches description and comments for a linked issue', async () => {
            mockGet
                .mockResolvedValueOnce({
                    data: {
                        fields: {
                            issuelinks: [{
                                type: { name: 'Blocker', inward: 'is blocked by', outward: 'blocks' },
                                inwardIssue: { key: 'GB-50', fields: { summary: 'Login bug', issuetype: { name: 'Bug' } } },
                            }],
                        },
                    },
                })
                .mockResolvedValueOnce({
                    data: {
                        fields: {
                            description: { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cannot login' }] }] },
                            issuetype: { name: 'Bug' },
                            summary: 'Login bug',
                            status: { name: 'In Progress' },
                        },
                        comment: {
                            comments: [
                                { body: { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Root cause found' }] }] }, author: { displayName: 'Dev1' }, created: '2026-01-01' },
                            ],
                        },
                    },
                });

            const context = await LinkedTicketIntelligenceService.getFullContext('GT-100');
            expect(context.links).toHaveLength(1);
            expect(context.details).toHaveLength(1);
            expect(context.details[0].key).toBe('GB-50');
            expect(context.details[0].description).toBe('Cannot login');
            expect(context.details[0].comments).toHaveLength(1);
            expect(context.details[0].comments[0].body).toBe('Root cause found');
        });

        it('handles empty links gracefully', async () => {
            mockGet.mockResolvedValue({ data: { fields: { issuelinks: [] } } });
            const context = await LinkedTicketIntelligenceService.getFullContext('GT-100');
            expect(context.links).toEqual([]);
            expect(context.details).toEqual([]);
        });
    });

    describe('extractTestContext', () => {
        it('extracts business logic hints from linked bug descriptions', async () => {
            mockGet
                .mockResolvedValueOnce({
                    data: {
                        fields: {
                            issuelinks: [{
                                type: { name: 'Blocker', inward: 'is blocked by', outward: 'blocks' },
                                inwardIssue: { key: 'GB-50', fields: { summary: 'Bug', issuetype: { name: 'Bug' } } },
                            }],
                        },
                    },
                })
                .mockResolvedValueOnce({
                    data: {
                        fields: {
                            description: 'When user clicks Save on the Employee form, the page crashes. The Kendo grid does not handle null values.',
                            issuetype: { name: 'Bug' },
                            summary: 'Bug',
                            status: { name: 'In Progress' },
                        },
                        comment: { comments: [] },
                    },
                });

            const context = await LinkedTicketIntelligenceService.getFullContext('GT-100');
            const extracted = LinkedTicketIntelligenceService.extractTestContext(context);
            expect(extracted.businessLogicHints.length).toBeGreaterThan(0);
            expect(extracted.businessLogicHints.some(h => h.includes('Save'))).toBe(true);
        });

        it('extracts change hints from implementation tickets', async () => {
            mockGet
                .mockResolvedValueOnce({
                    data: {
                        fields: {
                            issuelinks: [{
                                type: { name: 'Implement', inward: 'is implemented by', outward: 'implements' },
                                inwardIssue: { key: 'GD-25', fields: { summary: 'New field', issuetype: { name: 'Task' } } },
                            }],
                        },
                    },
                })
                .mockResolvedValueOnce({
                    data: {
                        fields: {
                            description: 'Added a new Required field "Department Code" to the Employee form.',
                            issuetype: { name: 'Task' },
                            summary: 'New field',
                            status: { name: 'Done' },
                        },
                        comment: { comments: [] },
                    },
                });

            const context = await LinkedTicketIntelligenceService.getFullContext('GT-100');
            const extracted = LinkedTicketIntelligenceService.extractTestContext(context);
            expect(extracted.newFields.length).toBeGreaterThan(0);
            expect(extracted.newFields.some(f => f.includes('Department Code') || f.includes('new'))).toBe(true);
        });

        it('returns empty context when no links exist', () => {
            const extracted = LinkedTicketIntelligenceService.extractTestContext({ links: [], details: [] });
            expect(extracted.businessLogicHints).toEqual([]);
            expect(extracted.newFields).toEqual([]);
            expect(extracted.selectorHints).toEqual([]);
            expect(extracted.riskAreas).toEqual([]);
        });
    });

    describe('summarizeForTestGeneration', () => {
        it('produces a readable summary', async () => {
            mockGet
                .mockResolvedValueOnce({
                    data: {
                        fields: {
                            issuelinks: [{
                                type: { name: 'Blocker', inward: 'is blocked by', outward: 'blocks' },
                                inwardIssue: { key: 'GB-50', fields: { summary: 'Crash on save', issuetype: { name: 'Bug' } } },
                            }],
                        },
                    },
                })
                .mockResolvedValueOnce({
                    data: {
                        fields: {
                            description: 'Employee form crashes when saving with null department.',
                            issuetype: { name: 'Bug' },
                            summary: 'Crash on save',
                            status: { name: 'In Progress' },
                        },
                        comment: { comments: [] },
                    },
                });

            const summary = await LinkedTicketIntelligenceService.summarizeForTestGeneration('GT-100');
            expect(summary).toContain('Linked Tickets');
            expect(summary).toContain('GB-50');
            expect(summary).toContain('is blocked by');
            expect(summary).toContain('Crash on save');
        });

        it('returns "No linked tickets" when none exist', async () => {
            mockGet.mockResolvedValue({ data: { fields: { issuelinks: [] } } });
            const summary = await LinkedTicketIntelligenceService.summarizeForTestGeneration('GT-100');
            expect(summary).toContain('No linked tickets');
        });
    });
});
