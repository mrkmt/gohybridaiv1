/**
 * UsageTrackerService — Unit Tests
 *
 * Tests for token usage tracking, per-ticket breakdowns, and usage summaries.
 * Uses a temporary test log file to avoid interfering with production data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { UsageTrackerService } from '../../src/services/UsageTrackerService';

// Override the log path for tests
const TEST_LOG_PATH = path.join(__dirname, '..', '..', 'test-usage-temp.json');

describe('UsageTrackerService', () => {
    beforeEach(() => {
        // Clear any previous test data
        if (fs.existsSync(TEST_LOG_PATH)) {
            fs.unlinkSync(TEST_LOG_PATH);
        }
        // Override the static log path
        (UsageTrackerService as any).logPath = TEST_LOG_PATH;
    });

    afterEach(() => {
        // Clean up test file
        if (fs.existsSync(TEST_LOG_PATH)) {
            fs.unlinkSync(TEST_LOG_PATH);
        }
    });

    // ─── logUsage ─────────────────────────────────────────────────────────────

    describe('logUsage', () => {
        it('logs a single usage entry', async () => {
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'test_generation',
                inputChars: 1000,
                outputChars: 500,
            });

            const logs = JSON.parse(fs.readFileSync(TEST_LOG_PATH, 'utf8'));
            expect(logs.length).toBe(1);
            expect(logs[0].model).toBe('qwen');
            expect(logs[0].taskType).toBe('test_generation');
            expect(logs[0].inputTokens).toBeGreaterThan(0);
            expect(logs[0].outputTokens).toBeGreaterThan(0);
        });

        it('includes optional ticketId and endpoint', async () => {
            await UsageTrackerService.logUsage({
                model: 'gemini',
                taskType: 'chat',
                ticketId: 'AB-27',
                endpoint: '/api/ai/chat',
                inputChars: 200,
                outputChars: 100,
            });

            const logs = JSON.parse(fs.readFileSync(TEST_LOG_PATH, 'utf8'));
            expect(logs[0].ticketId).toBe('AB-27');
            expect(logs[0].endpoint).toBe('/api/ai/chat');
        });

        it('tracks truncation flag', async () => {
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'orchestration',
                inputChars: 200_000,
                outputChars: 5000,
                isTruncated: true,
            });

            const logs = JSON.parse(fs.readFileSync(TEST_LOG_PATH, 'utf8'));
            expect(logs[0].isTruncated).toBe(true);
        });

        it('estimates cost as $0 for local models', async () => {
            await UsageTrackerService.logUsage({
                model: 'qwen2.5-coder:3b',
                taskType: 'test',
                inputChars: 1000,
                outputChars: 500,
            });

            const logs = JSON.parse(fs.readFileSync(TEST_LOG_PATH, 'utf8'));
            // Local models should have zero or near-zero cost
            expect(logs[0].estimatedCost).toBeLessThan(0.001);
        });

        it('estimates non-zero cost for paid models', async () => {
            await UsageTrackerService.logUsage({
                model: 'gemini-1.5-pro',
                taskType: 'reasoning',
                inputChars: 10000,
                outputChars: 5000,
            });

            const logs = JSON.parse(fs.readFileSync(TEST_LOG_PATH, 'utf8'));
            expect(logs[0].estimatedCost).toBeGreaterThan(0);
        });

        it('appends to existing log file', async () => {
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'test',
                inputChars: 100,
                outputChars: 50,
            });
            await UsageTrackerService.logUsage({
                model: 'gemini',
                taskType: 'chat',
                inputChars: 200,
                outputChars: 100,
            });

            const logs = JSON.parse(fs.readFileSync(TEST_LOG_PATH, 'utf8'));
            expect(logs.length).toBe(2);
            expect(logs[0].model).toBe('qwen');
            expect(logs[1].model).toBe('gemini');
        });

        it('keeps only last 5000 entries', async () => {
            // Write 5001 entries (use bulk write for speed)
            const entries = Array.from({ length: 5001 }, (_, i) => ({
                timestamp: '2025-01-01T00:00:00.000Z',
                model: 'test',
                taskType: 'test',
                inputTokens: 10,
                outputTokens: 5,
                inputChars: 40,
                outputChars: 20,
                estimatedCost: 0.00001,
                isTruncated: false,
            }));
            fs.writeFileSync(TEST_LOG_PATH, JSON.stringify(entries, null, 2));

            // Write one more
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'final',
                inputChars: 100,
                outputChars: 50,
            });

            const logs = JSON.parse(fs.readFileSync(TEST_LOG_PATH, 'utf8'));
            expect(logs.length).toBe(5000);
            expect(logs[0].taskType).toBe('test'); // First original entry was dropped
            expect(logs[4999].taskType).toBe('final'); // Last entry is the new one
        });
    });

    // ─── getSummary ───────────────────────────────────────────────────────────

    describe('getSummary', () => {
        it('returns empty summary when no logs exist', () => {
            const summary = UsageTrackerService.getSummary();
            expect(summary.totalTokens).toBe(0);
            expect(summary.totalCost).toBe(0);
            expect(summary.totalCalls).toBe(0);
            expect(Object.keys(summary.byModel).length).toBe(0);
            expect(Object.keys(summary.byTicket).length).toBe(0);
        });

        it('aggregates total tokens and cost', async () => {
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'test',
                inputChars: 4000,
                outputChars: 2000,
            });
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'test',
                inputChars: 4000,
                outputChars: 2000,
            });

            const summary = UsageTrackerService.getSummary();
            expect(summary.totalCalls).toBe(2);
            expect(summary.totalTokens).toBeGreaterThan(0);
        });

        it('breaks down by model', async () => {
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'test',
                inputChars: 1000,
                outputChars: 500,
            });
            await UsageTrackerService.logUsage({
                model: 'gemini',
                taskType: 'chat',
                inputChars: 2000,
                outputChars: 1000,
            });

            const summary = UsageTrackerService.getSummary();
            expect(Object.keys(summary.byModel).length).toBe(2);
            expect(summary.byModel['qwen'].calls).toBe(1);
            expect(summary.byModel['gemini'].calls).toBe(1);
        });

        it('breaks down by ticket', async () => {
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'test',
                ticketId: 'AB-27',
                inputChars: 1000,
                outputChars: 500,
            });
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'test',
                ticketId: 'AB-27',
                inputChars: 2000,
                outputChars: 1000,
            });
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'test',
                ticketId: 'AB-28',
                inputChars: 500,
                outputChars: 200,
            });

            const summary = UsageTrackerService.getSummary();
            expect(Object.keys(summary.byTicket).length).toBe(2);
            expect(summary.byTicket['AB-27'].calls).toBe(2);
            expect(summary.byTicket['AB-28'].calls).toBe(1);
        });

        it('counts truncated calls', async () => {
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'orchestration',
                inputChars: 200_000,
                outputChars: 5000,
                isTruncated: true,
            });
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'test',
                inputChars: 1000,
                outputChars: 500,
                isTruncated: false,
            });

            const summary = UsageTrackerService.getSummary();
            expect(summary.truncatedCalls).toBe(1);
        });
    });

    // ─── getTicketUsage ───────────────────────────────────────────────────────

    describe('getTicketUsage', () => {
        it('returns zero usage for unknown ticket', () => {
            const usage = UsageTrackerService.getTicketUsage('NONEXISTENT');
            expect(usage.tokens).toBe(0);
            expect(usage.cost).toBe(0);
            expect(usage.calls).toBe(0);
        });

        it('returns usage for a specific ticket', async () => {
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'test_generation',
                ticketId: 'AB-27',
                inputChars: 4000,
                outputChars: 2000,
            });
            await UsageTrackerService.logUsage({
                model: 'gemini',
                taskType: 'chat',
                ticketId: 'AB-28',
                inputChars: 200,
                outputChars: 100,
            });

            const usage = UsageTrackerService.getTicketUsage('AB-27');
            expect(usage.calls).toBe(1);
            expect(usage.tokens).toBeGreaterThan(0);
            expect(usage.entries.length).toBe(1);
        });

        it('aggregates multiple calls for same ticket', async () => {
            for (let i = 0; i < 3; i++) {
                await UsageTrackerService.logUsage({
                    model: 'qwen',
                    taskType: 'test_generation',
                    ticketId: 'AB-30',
                    inputChars: 1000,
                    outputChars: 500,
                });
            }

            const usage = UsageTrackerService.getTicketUsage('AB-30');
            expect(usage.calls).toBe(3);
        });
    });

    // ─── clearLogs ────────────────────────────────────────────────────────────

    describe('clearLogs', () => {
        it('removes the log file', async () => {
            await UsageTrackerService.logUsage({
                model: 'qwen',
                taskType: 'test',
                inputChars: 100,
                outputChars: 50,
            });

            expect(fs.existsSync(TEST_LOG_PATH)).toBe(true);

            UsageTrackerService.clearLogs();

            expect(fs.existsSync(TEST_LOG_PATH)).toBe(false);
        });

        it('is safe to call when no log file exists', () => {
            expect(() => UsageTrackerService.clearLogs()).not.toThrow();
        });
    });

    // ─── estimateTokens (static method) ───────────────────────────────────────

    describe('estimateTokens', () => {
        it('returns 0 for zero chars', () => {
            expect(UsageTrackerService.estimateTokens(0)).toBe(0);
        });

        it('uses ~3.5 chars per token ratio', () => {
            const tokens = UsageTrackerService.estimateTokens(3500);
            expect(tokens).toBe(1000); // 3500 / 3.5 = 1000
        });

        it('handles negative input', () => {
            expect(UsageTrackerService.estimateTokens(-100)).toBe(0);
        });
    });
});
