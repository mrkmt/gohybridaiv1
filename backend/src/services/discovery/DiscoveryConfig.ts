import path from 'path';
import { z } from 'zod';
import { config } from '../../../api/config';

export const discoveryModes = ['live-readonly', 'test-create'] as const;
export type DiscoveryMode = typeof discoveryModes[number];

export const LIVE_READONLY_BLOCKED_TERMS = [
    'delete',
    'remove',
    'submit',
    'save',
    'approve',
    'reject',
    'import',
    'post',
    'process',
    'finalize',
] as const;

export const TEST_CREATE_BLOCKED_TERMS = [
    'delete',
    'remove',
    'approve',
    'reject',
    'import',
    'process',
    'finalize',
] as const;

export const discoveryRequestSchema = z.object({
    baseUrl: z.string().url(),
    customerId: z.string().min(1),
    idNumber: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(1),
    aiModel: z.string().min(1),
    deepCrawl: z.boolean().default(false),
    incremental: z.boolean().default(false),
    maxDepth: z.number().optional(),
    mode: z.enum(discoveryModes).default('live-readonly'),
});

export type DiscoveryRequest = z.infer<typeof discoveryRequestSchema>;

export interface DiscoverySafeConfig {
    baseUrl: string;
    customerId: string;
    idNumber: string;
    username: string;
    aiModel: string;
    deepCrawl: boolean;
    incremental: boolean;
    maxDepth: number;
    mode: DiscoveryMode;
}

export function getAllowedDiscoveryModels(): string[] {
    const configured = config.discovery.allowedModels
        .map((model: string) => model.trim())
        .filter(Boolean);

    return [...new Set(configured.length > 0 ? configured : [config.ai.defaultModel, config.ai.fallbackModel].filter(Boolean))] as string[];
}

export function getBlockedTermsForMode(mode: DiscoveryMode): readonly string[] {
    return mode === 'test-create' ? TEST_CREATE_BLOCKED_TERMS : LIVE_READONLY_BLOCKED_TERMS;
}

export function normalizeDiscoveryRequest(input: unknown): DiscoveryRequest {
    const parsed = discoveryRequestSchema.parse(input);
    const allowed = getAllowedDiscoveryModels();

    if (!allowed.includes(parsed.aiModel)) {
        throw new Error(`Unsupported AI model "${parsed.aiModel}". Allowed models: ${allowed.join(', ')}`);
    }

    return {
        ...parsed,
        baseUrl: sanitizeBaseUrl(parsed.baseUrl),
        customerId: parsed.customerId.trim(),
        idNumber: parsed.idNumber.trim(),
        username: parsed.username.trim(),
        password: parsed.password,
        maxDepth: parsed.maxDepth ?? (parsed.deepCrawl ? config.discovery.deepMaxDepth : config.discovery.maxDepth),
    };
}

export function sanitizeBaseUrl(value: string): string {
    return value.trim().replace(/\/+$/, '');
}

export function buildLoginUrl(request: Pick<DiscoveryRequest, 'baseUrl' | 'customerId'>): string {
    const shortcode = request.customerId.replace(/^\/+|\/+$/g, '');
    return `${sanitizeBaseUrl(request.baseUrl)}/${shortcode}#/login`;
}

export function toSafeDiscoveryConfig(request: DiscoveryRequest): DiscoverySafeConfig {
    return {
        baseUrl: request.baseUrl,
        customerId: request.customerId,
        idNumber: request.idNumber,
        username: request.username,
        aiModel: request.aiModel,
        deepCrawl: request.deepCrawl,
        incremental: request.incremental,
        maxDepth: request.maxDepth!, // Assert as non-null since normalize handles it
        mode: request.mode,
    };
}

export function maskSecret(value: string): string {
    if (!value) return '';
    if (value.length <= 2) return '*'.repeat(value.length);
    return `${value[0]}${'*'.repeat(Math.max(2, value.length - 2))}${value[value.length - 1]}`;
}

export function getDiscoveryStorageDir(): string {
    return path.join(config.storage.baseDir, 'discovery');
}
