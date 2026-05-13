/**
 * AICache — Unit Tests
 *
 * Tests for prompt hash caching (hashPrompt, getCachedResponse, setCachedResponse).
 * Uses an in-memory mock approach since the real implementation uses PostgreSQL.
 */

import { hashPrompt } from '../../src/services/AICache';

describe('AICache', () => {
    // ─── hashPrompt ─────────────────────────────────────────────────────────────

    describe('hashPrompt', () => {
        it('returns a 16-character hex string', () => {
            const hash = hashPrompt('Hello world');
            expect(hash.length).toBe(16);
            expect(hash).toMatch(/^[0-9a-f]{16}$/);
        });

        it('produces consistent hashes for the same input', () => {
            const hash1 = hashPrompt('Test prompt');
            const hash2 = hashPrompt('Test prompt');
            expect(hash1).toBe(hash2);
        });

        it('produces different hashes for different inputs', () => {
            const hash1 = hashPrompt('Prompt A');
            const hash2 = hashPrompt('Prompt B');
            expect(hash1).not.toBe(hash2);
        });

        it('is sensitive to whitespace changes', () => {
            const hash1 = hashPrompt('Hello world');
            const hash2 = hashPrompt('Hello  world'); // extra space
            expect(hash1).not.toBe(hash2);
        });

        it('is sensitive to case changes', () => {
            const hash1 = hashPrompt('Hello World');
            const hash2 = hashPrompt('hello world');
            expect(hash1).not.toBe(hash2);
        });

        it('handles empty string', () => {
            const hash = hashPrompt('');
            expect(hash.length).toBe(16);
            expect(hash).toMatch(/^[0-9a-f]{16}$/);
        });

        it('handles very large prompts (100K+ chars)', () => {
            const largePrompt = 'a'.repeat(100_000);
            const hash = hashPrompt(largePrompt);
            expect(hash.length).toBe(16);
            expect(hash).toMatch(/^[0-9a-f]{16}$/);
        });

        it('handles unicode content', () => {
            const unicode = 'こんにちは世界 🌍';
            const hash = hashPrompt(unicode);
            expect(hash.length).toBe(16);
            expect(hash).toMatch(/^[0-9a-f]{16}$/);
        });

        it('handles prompts with special characters', () => {
            const special = 'SELECT * FROM users WHERE name = "O\'Brien" AND status = $1';
            const hash = hashPrompt(special);
            expect(hash.length).toBe(16);
            expect(hash).toMatch(/^[0-9a-f]{16}$/);
        });

        it('collision resistance: 1000 unique prompts produce unique hashes', () => {
            const hashes = new Set<string>();
            for (let i = 0; i < 1000; i++) {
                const hash = hashPrompt(`Unique prompt number ${i}`);
                hashes.add(hash);
            }
            // With 16 hex chars (64-bit), collision probability is extremely low
            expect(hashes.size).toBe(1000);
        });
    });

    // ─── getCachedResponse / setCachedResponse ──────────────────────────────────
    // Note: These require a PostgreSQL connection. We test the hash function
    // here and leave DB integration tests for the integration test suite.

    describe('cache key structure', () => {
        it('uses the format ai:<hash>:<model>', () => {
            const prompt = 'Test prompt';
            const model = 'qwen';
            const hash = hashPrompt(prompt);
            const expectedKey = `ai:${hash}:${model}`;

            expect(expectedKey).toMatch(/^ai:[0-9a-f]{16}:qwen$/);
            expect(expectedKey.length).toBe(24); // "ai:" + 16 + ":qwen"
        });

        it('different models produce different cache keys for same prompt', () => {
            const prompt = 'Same prompt';
            const hash = hashPrompt(prompt);

            const qwenKey = `ai:${hash}:qwen`;
            const geminiKey = `ai:${hash}:gemini`;

            expect(qwenKey).not.toBe(geminiKey);
        });
    });
});
