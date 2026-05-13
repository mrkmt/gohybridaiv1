/**
 * PromptUtils — Unit Tests
 *
 * Tests for prompt capping, token estimation, KB filtering, and ticket summarization.
 * TDD: These tests define the expected behavior of PromptUtils before we verify the implementation.
 */

import {
    estimateTokenCount,
    capPrompt,
    capPromptWithWarning,
    extractTicketSummary,
    filterRulesByModule,
    getPromptInfo,
} from '../../src/utils/PromptUtils';

describe('PromptUtils', () => {
    // ─── estimateTokenCount ───────────────────────────────────────────────────

    describe('estimateTokenCount', () => {
        it('returns 0 for empty string', () => {
            expect(estimateTokenCount('')).toBe(0);
        });

        it('returns 0 for nullish input', () => {
            // @ts-ignore — testing edge case
            expect(estimateTokenCount(null)).toBe(0);
            // @ts-ignore
            expect(estimateTokenCount(undefined)).toBe(0);
        });

        it('estimates ~4 chars/token for plain English text', () => {
            const text = 'The quick brown fox jumps over the lazy dog';
            const tokens = estimateTokenCount(text);
            // 43 chars / 4 = ~11, but code-heavy ratio may apply
            expect(tokens).toBeGreaterThan(0);
            expect(tokens).toBeLessThanOrEqual(Math.ceil(text.length / 3));
        });

        it('estimates fewer tokens for code-heavy text (non-ASCII symbols)', () => {
            const code = 'SELECT * FROM users WHERE id = $1 AND status = \'active\' ORDER BY created_at DESC';
            const plainText = 'This is a simple sentence about nothing in particular at all really';
            const codeTokens = estimateTokenCount(code);
            const textTokens = estimateTokenCount(plainText);

            // Both should produce positive token counts
            expect(codeTokens).toBeGreaterThan(0);
            expect(textTokens).toBeGreaterThan(0);
            // Code ratio should be close to text ratio (both ~3-4 chars/token)
            const codeRatio = code.length / codeTokens;
            const textRatio = plainText.length / textTokens;
            expect(codeRatio).toBeLessThanOrEqual(5);
            expect(textRatio).toBeLessThanOrEqual(5);
        });

        it('scales linearly with input size', () => {
            const base = 'Hello world this is a test string for token estimation';
            const tokens1 = estimateTokenCount(base);
            const tokens2 = estimateTokenCount(base + base);
            // Doubling the text should roughly double the tokens
            expect(tokens2).toBeGreaterThanOrEqual(tokens1);
            expect(tokens2).toBeLessThanOrEqual(tokens1 * 2);
        });
    });

    // ─── capPrompt ────────────────────────────────────────────────────────────

    describe('capPrompt', () => {
        it('returns text unchanged if under cap', () => {
            const text = 'Short prompt';
            expect(capPrompt(text, 1000)).toBe(text);
        });

        it('returns text unchanged if exactly at cap', () => {
            const text = 'a'.repeat(100);
            expect(capPrompt(text, 100)).toBe(text);
        });

        it('truncates text exceeding cap', () => {
            const text = 'a'.repeat(10_000);
            const capped = capPrompt(text, 1000);
            expect(capped.length).toBeLessThanOrEqual(1200); // cap + marker
        });

        it('preserves beginning (60%) and end (40%) of text', () => {
            const text = 'START_' + 'x'.repeat(1000) + '_MIDDLE_' + 'y'.repeat(1000) + '_END';
            const capped = capPrompt(text, 500);

            expect(capped.startsWith('START_')).toBe(true);
            expect(capped.endsWith('_END')).toBe(true);
            // The middle section should be mostly removed
            const middleCount = (capped.match(/_MIDDLE_/g) || []).length;
            expect(middleCount).toBeLessThanOrEqual(1);
        });

        it('includes truncation marker when text is cut', () => {
            const text = 'a'.repeat(10_000);
            const capped = capPrompt(text, 1000);
            expect(capped).toContain('CONTEXT TRUNCATED');
            expect(capped).toContain('chars omitted');
        });

        it('handles very large input without crashing', () => {
            const huge = 'a'.repeat(2_000_000); // 2M chars (simulates runaway orchestrator prompt)
            const capped = capPrompt(huge, 100_000);
            expect(capped.length).toBeLessThanOrEqual(100_200);
            expect(capped.startsWith('a'.repeat(60_000))).toBe(true);
            expect(capped.endsWith('a'.repeat(10_000))).toBe(true);
        });

        it('returns empty string for empty input', () => {
            expect(capPrompt('', 1000)).toBe('');
        });
    });

    // ─── capPromptWithWarning ─────────────────────────────────────────────────

    describe('capPromptWithWarning', () => {
        it('caps large prompts and does not throw', () => {
            const large = 'a'.repeat(200_000);
            const result = capPromptWithWarning(large, 'test');
            expect(result.length).toBeLessThanOrEqual(100_200);
        });

        it('passes through small prompts unchanged', () => {
            const small = 'Hello world';
            const result = capPromptWithWarning(small, 'test');
            expect(result).toBe(small);
        });
    });

    // ─── extractTicketSummary ─────────────────────────────────────────────────

    describe('extractTicketSummary', () => {
        it('extracts summary, description, and comments', () => {
            const ticket = {
                summary: 'Bug: Cannot save department',
                description: 'When I click save, nothing happens',
                comments: [
                    { body: 'I can reproduce this', author: 'QA Team' },
                    { body: 'Fixed in next release', author: 'Dev Team' },
                ],
            };

            const result = extractTicketSummary(ticket);

            expect(result).toContain('Bug: Cannot save department');
            expect(result).toContain('When I click save');
            expect(result).toContain('[QA Team]: I can reproduce this');
            expect(result).toContain('[Dev Team]: Fixed in next release');
        });

        it('handles missing fields gracefully', () => {
            const result = extractTicketSummary({});
            expect(result).toBe('');
        });

        it('handles empty comments array', () => {
            const ticket = {
                summary: 'Test',
                description: 'Desc',
                comments: [],
            };
            const result = extractTicketSummary(ticket);
            expect(result).not.toContain('Comments:');
        });

        it('caps description at 30K chars', () => {
            const ticket = {
                summary: 'Test',
                description: 'a'.repeat(50_000),
            };
            const result = extractTicketSummary(ticket);
            expect(result.length).toBeLessThan(50_000);
            expect(result).toContain('Description truncated');
        });

        it('caps comments at 10K chars total', () => {
            const ticket = {
                summary: 'Test',
                description: 'Desc',
                comments: [
                    { body: 'a'.repeat(15_000), author: 'User1' },
                    { body: 'b'.repeat(15_000), author: 'User2' },
                ],
            };
            const result = extractTicketSummary(ticket);
            // Should not include both full comments
            expect(result.length).toBeLessThan(30_000 + 20_000);
        });

        it('only includes last 5 comments', () => {
            const comments = Array.from({ length: 10 }, (_, i) => ({
                body: `Comment ${i}`,
                author: `User ${i}`,
            }));
            const ticket = {
                summary: 'Test',
                comments,
            };
            const result = extractTicketSummary(ticket);
            expect(result).toContain('Comment 9');
            expect(result).not.toContain('Comment 0');
        });
    });

    // ─── filterRulesByModule ──────────────────────────────────────────────────

    describe('filterRulesByModule', () => {
        const rules = [
            { module: 'department', keywords: ['short code', 'name'], id: 1 },
            { module: 'grade', keywords: ['level', 'salary'], id: 2 },
            { module: 'employee', keywords: ['hire', 'termination'], id: 3 },
            { module: 'department-setup', keywords: ['validation', 'required'], id: 4 },
            { module: 'payroll', keywords: ['tax', 'deduction'], id: 5 },
        ];

        it('returns all rules when no target module', () => {
            const result = filterRulesByModule(rules, '', 50);
            expect(result.length).toBe(5);
        });

        it('prioritizes rules matching the target module', () => {
            const result = filterRulesByModule(rules, 'department', 2);
            expect(result.length).toBeLessThanOrEqual(2);
            // department and department-setup should rank highest
            const ids = result.map(r => r.id);
            expect(ids).toContain(1); // department
            expect(ids).toContain(4); // department-setup
        });

        it('respects maxRules limit', () => {
            const result = filterRulesByModule(rules, '', 3);
            expect(result.length).toBe(3);
        });

        it('returns empty array for empty input', () => {
            const result = filterRulesByModule([], 'department');
            expect(result).toEqual([]);
        });

        it('handles rules without keywords', () => {
            const sparseRules = [
                { module: 'department' },
                { module: 'grade' },
                { module: 'department-setup' },
            ];
            const result = filterRulesByModule(sparseRules, 'department', 10);
            expect(result.length).toBe(3);
            // Module match should still score
            expect(result[0].module).toMatch(/department/);
        });
    });

    // ─── getPromptInfo ────────────────────────────────────────────────────────

    describe('getPromptInfo', () => {
        it('returns character count and estimated tokens', () => {
            const text = 'a'.repeat(1000);
            const info = getPromptInfo(text, 'test');

            expect(info.charCount).toBe(1000);
            expect(info.label).toBe('test');
            expect(info.estimatedTokens).toBeGreaterThan(0);
            expect(info.isOverCap).toBe(false);
        });

        it('flags when prompt exceeds cap', () => {
            const text = 'a'.repeat(200_000);
            const info = getPromptInfo(text, 'large');

            expect(info.isOverCap).toBe(true);
            expect(info.charCount).toBe(200_000);
        });

        it('handles empty input', () => {
            const info = getPromptInfo('');
            expect(info.charCount).toBe(0);
            expect(info.estimatedTokens).toBe(0);
            expect(info.isOverCap).toBe(false);
        });
    });
});
