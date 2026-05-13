import { Request, Response } from 'express';
import { z } from 'zod';
import * as path from 'path';
import { config } from '../config';
import { errorResponse, unauthorizedError, forbiddenError, internalError } from './responseHelpers';

// Zod validation schemas
export const RecordingSchema = z.object({
    sessionId: z.string().optional(),
    module: z.string().default('default'),
    isAdmin: z.boolean().default(false),
    appVersion: z.string().optional(),
    environment: z.string().optional(),
    steps: z.array(z.unknown()).min(1, 'Steps array cannot be empty'),
    networkRequests: z.array(z.unknown()).optional(),
    annotations: z.array(z.unknown()).optional(),
    expectedResults: z.record(z.string(), z.unknown()).optional(),
    jiraId: z.string().optional(),
    testUrl: z.string().optional(),
    userId: z.string().optional(),
});

export const TriageSchema = z.object({
    error: z.string().min(1, 'Error message is required'),
});

export const AiLogSchema = z.object({
    model: z.string().optional(),
    prompt: z.string().min(1, 'Prompt is required'),
    response: z.string().min(1, 'Response is required'),
});

export const SearchQuerySchema = z.object({
    q: z.string().min(1, 'Search query is required'),
});

// Helper functions
export function parseLimit(value: unknown, fallback: number): number {
    if (typeof value !== 'string') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(500, Math.floor(n)));
}

export function parsePage(value: unknown, fallback: number): number {
    if (typeof value !== 'string') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.floor(n));
}

export function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function requireApiKey(req: Request, res: Response): boolean {
    const provided = req.headers['x-api-key'];
    if (typeof provided === 'string' && config.server.apiKey && provided === config.server.apiKey) return true;
    unauthorizedError(res, 'Missing or invalid API key');
    return false;
}

/**
 * Webhook verification for Jira endpoints.
 * Verifies HMAC-SHA256 signature against shared secret in JIRA_WEBHOOK_SECRET env var.
 */
export function verifyWebhookSignature(req: Request, res: Response): boolean {
    const secret = process.env.JIRA_WEBHOOK_SECRET;
    if (!secret) {
        // Development mode - skip verification if no secret configured
        return true;
    }
    const signature = req.headers['x-jira-signature'] as string | undefined;
    if (!signature) {
        unauthorizedError(res, 'Missing webhook signature');
        return false;
    }
    try {
        const crypto = require('crypto');
        const payload = JSON.stringify(req.body);
        const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        if (signature === expected) return true;
        console.warn('[Webhook] Invalid signature received');
        forbiddenError(res, 'Invalid webhook signature');
        return false;
    } catch {
        internalError(res, 'Signature verification failed');
        return false;
    }
}

export function isSafeTestScriptPath(value: string): boolean {
    return /^[a-zA-Z0-9_\-\/\.]+\.spec\.ts$/.test(value) && !value.includes('..');
}

export function sanitizeFilename(filename: string): string {
    return path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, '_');
}

export const ASSET_COLUMN_MAP: Record<string, string> = {
    'screenshot': 'screenshot_url',
    'video': 'video_url',
    'manual': 'manual_snapshot_url',
};

// ============================================================
// Validation schemas for all POST endpoints
// ============================================================

// Jira endpoints
export const JiraTicketIdSchema = z.object({
    ticketId: z.string().regex(/^[A-Z]+-\d+$/, 'Invalid Jira ticket ID format (e.g., ATT-15)'),
});

export const JiraConfigSchema = z.object({
    url: z.string().url().optional(),
    projectKey: z.string().optional(),
    webhookUrl: z.string().url().optional(),
    username: z.string().optional(),
    apiToken: z.string().optional(),
}).refine(data => Object.values(data).some(Boolean), {
    message: 'At least one config field must be provided',
});

export const JiraImportSchema = z.object({
    jiraId: z.string().optional(),
});

export const JiraSyncActiveSchema = z.object({
    includeAll: z.boolean().optional(),
});

export const JiraWebhookTestSchema = z.object({
    type: z.enum(['direct', 'cross-project']).optional(),
    issueKey: z.string().optional(),
    status: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional(),
});

// Testing workflow endpoints
export const StartTestingSchema = z.object({
    autoTransition: z.boolean().optional().default(true),
});

export const GenerateTestCasesSchema = z.object({
    model: z.string().optional(),
    refresh: z.boolean().optional().default(false),
    selectedScenarios: z.array(z.union([z.string(), z.object({ id: z.string() })])).optional(),
});

export const GenerateScenariosSchema = z.object({});

export const SaveTestCaseSchema = z.object({
    testCase: z.object({
        caseId: z.string(),
        title: z.string(),
        steps: z.array(z.object({
            stepNumber: z.number(),
            action: z.string(),
            expectedResult: z.string(),
            selectorHint: z.string().optional(),
        })).optional().default([]),
    }),
    action: z.enum(['add', 'update', 'delete']).optional().default('add'),
});

export const ExecuteTestsSchema = z.object({
    environment: z.object({
        stage: z.string().optional(),
        baseUrl: z.string().url().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        idNumber: z.string().optional(),
        customerId: z.string().optional(),
        platform: z.string().optional(),
    }).optional(),
    testCaseIds: z.array(z.string()).optional(),
});

export const UploadResultsSchema = z.object({
    postComment: z.boolean().optional().default(true),
    uploadAttachment: z.boolean().optional().default(true),
    transitionTo: z.enum(['Done', 'Bug Done']).optional(),
    environment: z.string().optional(),
});

// Phase 2 / Pipeline
export const PipelineProcessSchema = z.object({
    steps: z.array(z.any()).min(1, 'Steps array is required'),
    ticketText: z.string().optional(),
    recordingUrl: z.string().optional(),
    menuNames: z.array(z.string()).optional(),
});

// Test execution (API level)
export const ExecuteTestSchema = z.object({
    testScript: z.string().regex(/^[a-zA-Z0-9_\-\/\.]+\.spec\.ts$/, 'Invalid test script path'),
    moduleName: z.string().min(1, 'moduleName is required'),
    targetRuleId: z.string().optional(),
    environment: z.string().optional(),
    baseUrl: z.string().url().optional(),
    customerId: z.string().optional(),
    credentials: z.object({
        idNumber: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
    }).optional(),
});

// Investigation
export const InvestigateSchema = z.object({
    jiraId: z.string().min(1, 'jiraId is required'),
    jiraData: z.record(z.string(), z.unknown()),
});

export const InvestigateReviseSchema = z.object({
    jiraId: z.string().min(1, 'jiraId is required'),
    humanInput: z.string().min(1, 'humanInput is required'),
    approvedChecklist: z.array(z.any()).optional(),
    targetEnv: z.string().optional(),
});

// Chat mention
export const ChatMentionSchema = z.object({
    message: z.string().min(1, 'Message is required'),
});

// Draft
export const SaveDraftSchema = z.object({
    jiraId: z.string(),
    data: z.unknown(),
});

// Test user
export const TestUserSchema = z.object({
    id: z.string().optional(),
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
    idNumber: z.string().min(1, 'ID number is required'),
    description: z.string().optional(),
});

// AI provider
export const AgentProfileReloadSchema = z.object({}).optional();

// Knowledge test query
export const KnowledgeTestQuerySchema = z.object({
    query: z.string(),
});

// Usage endpoints
export const CacheInvalidateSchema = z.object({
    jiraId: z.string().min(1, 'jiraId is required'),
});

// Custom skills / MCP
export const CustomPathsSchema = z.object({
    paths: z.array(z.string().min(1)).min(1, 'At least one path is required'),
});

export const McpConfigureSchema = z.object({
    servers: z.array(z.object({
        name: z.string(),
        url: z.string().optional(),
        command: z.string().optional(),
        cmd: z.string().optional(),
        args: z.array(z.string()).optional(),
    })).min(1, 'At least one server is required'),
}).passthrough();

// Test session management
export const DeleteSessionSchema = z.object({
    ticketId: z.string().regex(/^[A-Z]+-\d+$/, 'Invalid ticket ID format'),
});

// Object repository alternatives
export const ObjectRepoAlternativesSchema = z.object({
    name: z.string().optional(),
    originalSelector: z.string().optional(),
});
