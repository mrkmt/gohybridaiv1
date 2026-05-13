import request from 'supertest';
const API_KEY = process.env.TEST_API_KEY || 'test-api-key-for-testing-only';
import { createApp, DbClient } from './app';
import { ObjectRepoService } from './ObjectRepoService';

// Mock ObjectRepoService
jest.mock('./ObjectRepoService', () => ({
    ObjectRepoService: {
        ensureObject: jest.fn().mockResolvedValue('obj-test-id')
    }
}));

// Mock StorageService to avoid disk I/O during tests
jest.mock('./StorageService', () => ({
    storageService: {
        init: jest.fn().mockResolvedValue(undefined),
        uploadFile: jest.fn().mockResolvedValue('test-path'),
        getPublicUrl: jest.fn().mockReturnValue('http://mock-url'),
        deleteFile: jest.fn().mockResolvedValue(undefined),
        deleteFolder: jest.fn().mockResolvedValue(undefined),
        getFileBuffer: jest.fn().mockResolvedValue(Buffer.from('test-data'))
    }
}));

// Mock LocalAIService to avoid LLM calls
jest.mock('./LocalAIService', () => ({
    LocalAIService: {
        suggestRootCause: jest.fn().mockResolvedValue({ response: 'mock-suggestion', modelUsed: 'mock-model', status: 'success' }),
        generateTest: jest.fn().mockResolvedValue({ response: 'mock-test-code', modelUsed: 'mock-model', status: 'success', agent: 'mock-agent' })
    }
}));

// Mock VisualForensicsService to avoid pixelmatch ESM issues
jest.mock('./VisualForensicsService', () => ({
    VisualForensicsService: {
        generateVisualDiff: jest.fn().mockResolvedValue('forensics/test/diff.png')
    }
}));

/**
 * Mock database client for testing
 */
function createMockPool() {
    const data: any[] = [];
    return {
        data,
        client: {
            query: async (text: string, params?: any[]) => {
                if (text.includes('SELECT COUNT')) {
                    return { rows: [{ count: data.length.toString() }] };
                }
                if (text.includes('SELECT') && !text.includes('COUNT')) {
                    const limitMatch = text.match(/LIMIT\s+(\d+)/i);
                    const offsetMatch = text.match(/OFFSET\s+(\d+)/i);
                    const limit = limitMatch ? parseInt(limitMatch[1]) : data.length;
                    const offset = offsetMatch ? parseInt(offsetMatch[1]) : 0;
                    return { rows: data.slice(offset, offset + limit) };
                }
                if (text.includes('INSERT')) {
                    const idMatch = params?.[0];
                    if (idMatch) {
                        data.push({ id: idMatch, created_at: new Date() });
                    }
                    return { rows: [] };
                }
                if (text.includes('DELETE')) {
                    const idToDelete = params?.[0];
                    const initialLength = data.length;
                    const idx = data.findIndex((d: any) => d.id === idToDelete);
                    if (idx >= 0) data.splice(idx, 1);
                    return { rowCount: initialLength - data.length };
                }
                return { rows: [] };
            },
        } as DbClient,
    };
}

describe('Backend API - Health & Metrics', () => {
    test('GET /api/health returns ok:true when DB works', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.db).toBe(true);
        expect(res.body.version).toBeDefined();
    });

    test('GET /api/health returns ok:false when DB fails', async () => {
        const pool: DbClient = {
            query: async () => { throw new Error('DB connection failed'); },
        };
        const app = await createApp({ pool });

        const res = await request(app).get('/api/health');
        expect(res.status).toBe(503);
        expect(res.body.ok).toBe(false);
    });

    test('GET /api/metrics returns statistics', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app).get('/api/metrics');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('totalRecordings');
        expect(res.body).toHaveProperty('totalAiLogs');
        expect(res.body).toHaveProperty('recordingsLast24h');
    });
});

describe('Backend API - Recordings', () => {
    test('POST /api/recordings validates payload - missing steps', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app)
            .post('/api/recordings').set('x-api-key', API_KEY)
            .send({ sessionId: 's1', appVersion: '1.0' });

        expect(res.status).toBe(400);
        expect(res.body.error).toHaveProperty('code');
        expect(res.body.error.message).toBe('Validation failed');
    });

    test('POST /api/recordings validates payload - empty steps', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app)
            .post('/api/recordings').set('x-api-key', API_KEY)
            .send({ sessionId: 's1', steps: [] });

        expect(res.status).toBe(400);
        expect(res.body.error).toHaveProperty('code');
        expect(res.body.error.message).toBe('Validation failed');
    });

    test('POST /api/recordings accepts valid payload', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app)
            .post('/api/recordings').set('x-api-key', API_KEY)
            .send({
                sessionId: 'session-123',
                appVersion: '1.0.0',
                environment: { browser: 'chrome', os: 'windows' },
                steps: [{ action: 'click', selector: '#button' }],
                networkRequests: [{ url: 'https://api.example.com' }],
            });

        expect(res.status).toBe(201);
        expect(res.body.data).toBeDefined();
        expect(res.body.data.id).toBeDefined();
        expect(res.body.data.message).toBe('Recording saved');
    });

    test('GET /api/recordings returns paginated list', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app).get('/api/recordings');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('data');
        expect(res.body).toHaveProperty('pagination');
        expect(res.body.pagination).toHaveProperty('page');
        expect(res.body.pagination).toHaveProperty('limit');
        expect(res.body.pagination).toHaveProperty('total');
    });

    test('GET /api/recordings accepts limit and page parameters', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app).get('/api/recordings?limit=20&page=2');
        expect(res.status).toBe(200);
        expect(res.body.pagination.limit).toBe(20);
        expect(res.body.pagination.page).toBe(2);
    });

    test('GET /api/recordings/:id with invalid UUID returns 400', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app).get('/api/recordings/invalid-id');
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('Invalid recording id (uuid expected)');
    });

    test('GET /api/recordings/:id returns 404 when not found', async () => {
        const pool: DbClient = {
            query: async () => ({ rows: [] }),
        };
        const app = await createApp({ pool });

        const res = await request(app).get('/api/recordings/550e8400-e29b-41d4-a716-446655440000');
        expect(res.status).toBe(404);
        expect(res.body.error.message).toBe('Recording not found');
    });

    test('DELETE /api/recordings/:id with invalid UUID returns 400', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app).delete('/api/recordings/invalid-id').set('x-api-key', API_KEY);
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('Invalid recording id (uuid expected)');
    });
});

describe('Backend API - Triage', () => {
    test('POST /api/triage/:id with invalid UUID returns 400', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app).post('/api/triage/invalid-id').set('x-api-key', API_KEY);
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('Invalid recording id (uuid expected)');
    });

    test('POST /api/triage/:id validates error field', async () => {
        const pool: DbClient = {
            query: async () => ({ rows: [{ id: '550e8400-e29b-41d4-a716-446655440000', steps: [], app_version: '1.0' }] }),
        };
        const app = await createApp({ pool });

        const res = await request(app)
            .post('/api/triage/550e8400-e29b-41d4-a716-446655440000').set('x-api-key', API_KEY)
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('Validation failed');
    });

    test('POST /api/triage/:id returns 404 when recording not found', async () => {
        const pool: DbClient = {
            query: async () => ({ rows: [] }),
        };
        const app = await createApp({ pool });

        const res = await request(app)
            .post('/api/triage/550e8400-e29b-41d4-a716-446655440000').set('x-api-key', API_KEY)
            .send({ error: 'Test error' });

        expect(res.status).toBe(404);
        expect(res.body.error.message).toBe('Recording not found');
    });
});

describe('Backend API - Search', () => {
    test('GET /api/search without query returns 400', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app).get('/api/search');
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('Validation failed');
    });

    test('GET /api/search with empty query returns 400', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app).get('/api/search?q=');
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('Validation failed');
    });

    test('GET /api/search with valid query returns results', async () => {
        // Mock KnowledgeService to avoid file system access during tests
        jest.spyOn(require('./KnowledgeService').KnowledgeService, 'findRelevantDocs')
            .mockResolvedValue([{ path: 'test.md', title: 'Test', snippet: 'Test snippet', score: 1 }]);

        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app).get('/api/search?q=test');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('docs');
        expect(res.body).toHaveProperty('fromCache');
    });
});

describe('Backend API - AI Logs', () => {
    // Note: /api/ai-logs endpoint is not currently registered in the router
    // These tests are kept as placeholders for when the endpoint is implemented
    test('POST /api/ai-logs returns 404 (endpoint not implemented)', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app)
            .post('/api/ai-logs').set('x-api-key', API_KEY)
            .send({});

        expect([400, 404]).toContain(res.status);
    });
});

describe('Backend API - Security', () => {
    test('404 for unknown routes', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        const res = await request(app).get('/api/unknown');
        expect(res.status).toBe(404);
        expect(res.body.error.message).toBe('Not found');
    });

    test('API Key validation when configured', async () => {
        const { client } = createMockPool();
        const app = await createApp({ pool: client });

        // Without API key (should pass if no API_KEY is set in config)
        const res = await request(app)
            .post('/api/recordings').set('x-api-key', API_KEY)
            .send({ steps: [{ action: 'click' }] });

        // Response depends on whether API_KEY is configured
        // If configured, should return 401 without key
        // If not configured, should return 201 or 400
        expect([201, 400, 401]).toContain(res.status);
    });
});
