/**
 * AI Validation Middleware — Unit Tests
 *
 * Tests that all AI endpoint validators correctly accept valid payloads
 * and reject invalid ones with proper error messages.
 */

import express from 'express';
import request from 'supertest';
import {
    ChatRequestSchema,
    GenerateTestCasesSchema,
    ExecuteTestsSchema,
    MentionDetectionSchema,
    KnowledgeQuerySchema,
    CrawlerDiscoverySchema,
    RuleExtractionSchema,
    validate,
    validateChat,
    validateGenerateTestCases,
    validateExecuteTests,
} from '../../src/middleware/aiValidation';

// ─── Schema Unit Tests ────────────────────────────────────────────────────────

describe('AI Validation Schemas', () => {
    // ─── ChatRequestSchema ────────────────────────────────────────────────────

    describe('ChatRequestSchema', () => {
        it('accepts valid message', () => {
            const result = ChatRequestSchema.safeParse({ message: 'Hello' });
            expect(result.success).toBe(true);
        });

        it('rejects empty message', () => {
            const result = ChatRequestSchema.safeParse({ message: '' });
            expect(result.success).toBe(false);
        });

        it('rejects missing message', () => {
            const result = ChatRequestSchema.safeParse({});
            expect(result.success).toBe(false);
        });

        it('rejects message over 10K chars', () => {
            const result = ChatRequestSchema.safeParse({ message: 'a'.repeat(10001) });
            expect(result.success).toBe(false);
        });

        it('accepts optional context array', () => {
            const result = ChatRequestSchema.safeParse({
                message: 'Hello',
                context: [
                    { role: 'user', content: 'Hi' },
                    { role: 'assistant', content: 'Hello!' },
                ],
            });
            expect(result.success).toBe(true);
        });

        it('rejects context over 20 messages', () => {
            const context = Array.from({ length: 21 }, () => ({ role: 'user' as const, content: 'a' }));
            const result = ChatRequestSchema.safeParse({ message: 'Hello', context });
            expect(result.success).toBe(false);
        });

        it('rejects invalid role in context', () => {
            const result = ChatRequestSchema.safeParse({
                message: 'Hello',
                context: [{ role: 'invalid', content: 'test' }],
            });
            expect(result.success).toBe(false);
        });

        it('rejects context message over 50K chars', () => {
            const result = ChatRequestSchema.safeParse({
                message: 'Hello',
                context: [{ role: 'user', content: 'a'.repeat(50001) }],
            });
            expect(result.success).toBe(false);
        });
    });

    // ─── GenerateTestCasesSchema ──────────────────────────────────────────────

    describe('GenerateTestCasesSchema', () => {
        it('accepts minimal input (just ticketId)', () => {
            const result = GenerateTestCasesSchema.safeParse({ ticketId: 'AB-27' });
            expect(result.success).toBe(true);
        });

        it('accepts full payload', () => {
            const result = GenerateTestCasesSchema.safeParse({
                ticketId: 'AB-27',
                model: 'qwen',
                refresh: true,
                selectedScenarios: ['SC-001', { id: 'SC-002', name: 'Test' }],
            });
            expect(result.success).toBe(true);
        });

        it('rejects missing ticketId', () => {
            const result = GenerateTestCasesSchema.safeParse({});
            expect(result.success).toBe(false);
        });

        it('rejects ticketId over 50 chars', () => {
            const result = GenerateTestCasesSchema.safeParse({ ticketId: 'a'.repeat(51) });
            expect(result.success).toBe(false);
        });

        it('rejects over 100 scenarios', () => {
            const scenarios = Array.from({ length: 101 }, () => 'SC-001');
            const result = GenerateTestCasesSchema.safeParse({ ticketId: 'AB-27', selectedScenarios: scenarios });
            expect(result.success).toBe(false);
        });
    });

    // ─── ExecuteTestsSchema ───────────────────────────────────────────────────

    describe('ExecuteTestsSchema', () => {
        it('accepts minimal input', () => {
            const result = ExecuteTestsSchema.safeParse({ ticketId: 'AB-27' });
            expect(result.success).toBe(true);
        });

        it('accepts valid parallel config', () => {
            const result = ExecuteTestsSchema.safeParse({
                ticketId: 'AB-27',
                parallel: true,
                maxWorkers: 4,
                timeout: 300000,
            });
            expect(result.success).toBe(true);
        });

        it('rejects maxWorkers over 10', () => {
            const result = ExecuteTestsSchema.safeParse({ ticketId: 'AB-27', maxWorkers: 20 });
            expect(result.success).toBe(false);
        });

        it('rejects timeout under 10 seconds', () => {
            const result = ExecuteTestsSchema.safeParse({ ticketId: 'AB-27', timeout: 5000 });
            expect(result.success).toBe(false);
        });

        it('rejects timeout over 10 minutes', () => {
            const result = ExecuteTestsSchema.safeParse({ ticketId: 'AB-27', timeout: 700000 });
            expect(result.success).toBe(false);
        });
    });

    // ─── MentionDetectionSchema ───────────────────────────────────────────────

    describe('MentionDetectionSchema', () => {
        it('accepts valid message', () => {
            const result = MentionDetectionSchema.safeParse({ message: '@AB-27 start testing' });
            expect(result.success).toBe(true);
        });

        it('rejects empty message', () => {
            const result = MentionDetectionSchema.safeParse({ message: '' });
            expect(result.success).toBe(false);
        });

        it('rejects message over 5K chars', () => {
            const result = MentionDetectionSchema.safeParse({ message: 'a'.repeat(5001) });
            expect(result.success).toBe(false);
        });
    });

    // ─── KnowledgeQuerySchema ─────────────────────────────────────────────────

    describe('KnowledgeQuerySchema', () => {
        it('accepts query only', () => {
            const result = KnowledgeQuerySchema.safeParse({ query: 'How does department work?' });
            expect(result.success).toBe(true);
        });

        it('accepts query with module', () => {
            const result = KnowledgeQuerySchema.safeParse({
                query: 'validation rules',
                module: 'department',
            });
            expect(result.success).toBe(true);
        });

        it('rejects empty query', () => {
            const result = KnowledgeQuerySchema.safeParse({ query: '' });
            expect(result.success).toBe(false);
        });

        it('rejects query over 5K chars', () => {
            const result = KnowledgeQuerySchema.safeParse({ query: 'a'.repeat(5001) });
            expect(result.success).toBe(false);
        });
    });

    // ─── CrawlerDiscoverySchema ──────────────────────────────────────────────

    describe('CrawlerDiscoverySchema', () => {
        it('accepts valid URL and module', () => {
            const result = CrawlerDiscoverySchema.safeParse({
                url: 'https://test.example.com/app',
                module: 'department',
            });
            expect(result.success).toBe(true);
        });

        it('rejects invalid URL', () => {
            const result = CrawlerDiscoverySchema.safeParse({
                url: 'not-a-url',
                module: 'department',
            });
            expect(result.success).toBe(false);
        });

        it('rejects missing module', () => {
            const result = CrawlerDiscoverySchema.safeParse({
                url: 'https://test.example.com',
            });
            expect(result.success).toBe(false);
        });

        it('rejects depth over 10', () => {
            const result = CrawlerDiscoverySchema.safeParse({
                url: 'https://test.example.com',
                module: 'department',
                depth: 20,
            });
            expect(result.success).toBe(false);
        });
    });

    // ─── RuleExtractionSchema ─────────────────────────────────────────────────

    describe('RuleExtractionSchema', () => {
        it('accepts valid input', () => {
            const result = RuleExtractionSchema.safeParse({
                moduleName: 'department',
                documentText: 'Department short code must be max 5 characters.',
            });
            expect(result.success).toBe(true);
        });

        it('rejects empty moduleName', () => {
            const result = RuleExtractionSchema.safeParse({ moduleName: '', documentText: 'test' });
            expect(result.success).toBe(false);
        });

        it('rejects empty documentText', () => {
            const result = RuleExtractionSchema.safeParse({ moduleName: 'department', documentText: '' });
            expect(result.success).toBe(false);
        });

        it('rejects documentText over 100K chars', () => {
            const result = RuleExtractionSchema.safeParse({
                moduleName: 'department',
                documentText: 'a'.repeat(100001),
            });
            expect(result.success).toBe(false);
        });
    });
});

// ─── Express Middleware Integration Tests ─────────────────────────────────────

describe('AI Validation Middleware (Express)', () => {
    let app: express.Application;

    beforeEach(() => {
        app = express();
        app.use(express.json());

        // Test route using validateChat
        app.post('/test/chat', validateChat, (req, res) => {
            res.json({ success: true, message: req.body.message });
        });

        // Test route using validateGenerateTestCases
        app.post('/test/generate', validateGenerateTestCases, (req, res) => {
            res.json({ success: true, ticketId: req.body.ticketId });
        });

        // Test route using validateExecuteTests
        app.post('/test/execute', validateExecuteTests, (req, res) => {
            res.json({ success: true, ticketId: req.body.ticketId });
        });
    });

    describe('/test/chat', () => {
        it('accepts valid payload', async () => {
            const res = await request(app)
                .post('/test/chat')
                .send({ message: 'Hello' });
            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Hello');
        });

        it('rejects missing message', async () => {
            const res = await request(app)
                .post('/test/chat')
                .send({});
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Validation failed');
            expect(res.body.details).toBeDefined();
        });

        it('rejects oversized message', async () => {
            const res = await request(app)
                .post('/test/chat')
                .send({ message: 'a'.repeat(10001) });
            expect(res.status).toBe(400);
        });
    });

    describe('/test/generate', () => {
        it('accepts valid payload', async () => {
            const res = await request(app)
                .post('/test/generate')
                .send({ ticketId: 'AB-27' });
            expect(res.status).toBe(200);
        });

        it('rejects missing ticketId', async () => {
            const res = await request(app)
                .post('/test/generate')
                .send({});
            expect(res.status).toBe(400);
        });
    });

    describe('/test/execute', () => {
        it('accepts valid payload', async () => {
            const res = await request(app)
                .post('/test/execute')
                .send({ ticketId: 'AB-27' });
            expect(res.status).toBe(200);
        });

        it('rejects invalid maxWorkers', async () => {
            const res = await request(app)
                .post('/test/execute')
                .send({ ticketId: 'AB-27', maxWorkers: 100 });
            expect(res.status).toBe(400);
        });
    });
});
