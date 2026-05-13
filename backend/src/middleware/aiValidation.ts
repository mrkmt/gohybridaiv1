/**
 * AI Endpoint Validation Middleware
 *
 * Validates incoming requests to AI endpoints using Zod schemas.
 * Prevents malformed payloads from reaching expensive AI services.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const ChatRequestSchema = z.object({
    message: z.string().min(1, 'Message is required').max(10000, 'Message too long (max 10,000 chars)'),
    context: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().max(50000),
    })).max(20, 'Context too long (max 20 messages)').optional(),
});

export const GenerateScenariosSchema = z.object({
    ticketId: z.string().min(1).max(50),
    model: z.string().optional(),
});

export const GenerateTestCasesSchema = z.object({
    ticketId: z.string().min(1).max(50),
    model: z.string().optional(),
    refresh: z.boolean().optional(),
    selectedScenarios: z.array(z.union([
        z.string(),
        z.object({ id: z.string(), name: z.string() }).passthrough(),
    ])).max(100, 'Too many scenarios (max 100)').optional(),
});

export const ExecuteTestsSchema = z.object({
    ticketId: z.string().min(1).max(50),
    model: z.string().optional(),
    parallel: z.boolean().optional(),
    maxWorkers: z.number().int().min(1).max(10).optional(),
    timeout: z.number().int().min(10000).max(600000).optional(),
    environment: z.object({
        baseUrl: z.string().url().optional(),
        stage: z.string().optional(),
    }).passthrough().optional(),
});

export const MentionDetectionSchema = z.object({
    message: z.string().min(1).max(5000),
});

export const KnowledgeQuerySchema = z.object({
    query: z.string().min(1).max(5000),
    module: z.string().optional(),
});

export const CrawlerDiscoverySchema = z.object({
    url: z.string().url('Invalid URL').max(2000),
    module: z.string().min(1).max(100),
    depth: z.number().int().min(1).max(10).optional(),
    aiModel: z.string().optional(),
});

export const RuleExtractionSchema = z.object({
    moduleName: z.string().min(1).max(200),
    documentText: z.string().min(1).max(100000),
});

// ─── Validation Middleware Factory ────────────────────────────────────────────

export function validate(schema: z.ZodSchema) {
    return (req: Request, res: Response, next: NextFunction): void => {
        // Merge params (from URL) and body for validation
        const payload = { ...req.params, ...req.body };

        const result = schema.safeParse(payload);
        if (!result.success) {
            res.status(400).json({
                error: 'Validation failed',
                details: result.error.issues.map((e: z.ZodIssue) => ({
                    field: e.path.join('.'),
                    message: e.message,
                })),
            });
            return;
        }

        next();
    };
}

// ─── Pre-built Middleware Instances ───────────────────────────────────────────

export const validateChat = validate(ChatRequestSchema);
export const validateGenerateScenarios = validate(GenerateScenariosSchema);
export const validateGenerateTestCases = validate(GenerateTestCasesSchema);
export const validateExecuteTests = validate(ExecuteTestsSchema);
export const validateMentionDetection = validate(MentionDetectionSchema);
export const validateKnowledgeQuery = validate(KnowledgeQuerySchema);
export const validateCrawlerDiscovery = validate(CrawlerDiscoverySchema);
export const validateRuleExtraction = validate(RuleExtractionSchema);
