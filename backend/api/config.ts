import dotenv from 'dotenv';
import os from 'os';
import path from 'path';

dotenv.config();
// Also look for .env in the parent directory if running from api/
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), 'backend', '.env') });

function asInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function asBool(value: string | undefined, fallback: boolean): boolean {
    if (!value) return fallback;
    return value.toLowerCase() === 'true';
}

export const config = {
    server: {
        port: asInt(process.env.PORT, 3000),
        apiKey: process.env.API_KEY || '',
        jwtSecret: process.env.JWT_SECRET || 'gohybridai-dev-secret-change-in-production',
        isProduction: process.env.NODE_ENV === 'production',
    },
    postgres: {
        user: process.env.PG_USER || 'postgres',
        host: process.env.PG_HOST || 'localhost',
        database: process.env.PG_DATABASE || 'ai_testing_platform',
        password: process.env.PG_PASSWORD || 'postgres',
        port: asInt(process.env.PG_PORT, 5432),
        ssl: asBool(process.env.PG_SSL, false),
        max: asInt(process.env.PG_POOL_MAX, 20),
        idleTimeoutMillis: asInt(process.env.PG_IDLE_TIMEOUT_MS, 30000),
        connectionTimeoutMillis: asInt(process.env.PG_CONNECTION_TIMEOUT_MS, 2000),
    },
    ai: {
        // ── OpenRouter (HTTP API) ──
        openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
        openRouterApiKeyChain: [
            process.env.OPENROUTER_API_KEY_2,
            process.env.OPENROUTER_API_KEY_3,
            process.env.OPENROUTER_API_KEY_4,
            process.env.OPENROUTER_API_KEY_5,
            process.env.OPENROUTER_API_KEY_6,
            process.env.OPENROUTER_API_KEY_7,
            process.env.OPENROUTER_API_KEY_8,
        ].filter(Boolean) as string[],
        openRouterBaseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: process.env.DEFAULT_AI_MODEL || 'google/gemini-2.0-flash-exp:free',
        fallbackModel: process.env.FALLBACK_AI_MODEL || 'openai/gpt-oss-120b:free',

        // ── Groq (HTTP API — secondary fallback) ──
        groqApiKey: process.env.GROQ_API_KEY || '',
        groqApiKeyChain: [
            process.env.GROQ_API_KEY_2,
            process.env.GROQ_API_KEY_3,
            process.env.GROQ_API_KEY_4,
            process.env.GROQ_API_KEY_5,
            process.env.GROQ_API_KEY_6,
            process.env.GROQ_API_KEY_7,
            process.env.GROQ_API_KEY_8,
        ].filter(Boolean) as string[],

        // ── Gemini (REST API) ──
        geminiApiKey: process.env.GEMINI_API_KEY || '',
        geminiApiKey2: process.env.GEMINI_API_KEY_2 || '',
        geminiApiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',

        // ── CLI Tools (local commands, not HTTP) ──
        geminiCliCommand: 'gemini',
        qwenCliCommand: 'qwen',
        codexCliCommand: 'codex',
        geminiPath: process.env.GEMINI_PATH || path.join(os.homedir(), '.gemini'),
        qwenPath: process.env.QWEN_PATH || path.join(os.homedir(), '.qwen'),
        codexPath: process.env.CODEX_PATH || path.join(os.homedir(), '.codex'),

        // ── Role Assignments (which tool handles which role) ──
        roleAssignments: {
            ARCHITECT: 'gemini',     // Gemini CLI — analysis & reasoning
            CODER: 'qwen',           // Qwen CLI — code generation
            REVIEWER: 'qwen',        // Qwen CLI — code review
            ANALYST: 'gemini',       // Gemini CLI — analysis
            INVESTIGATOR: 'gemini',  // Gemini CLI — investigation
            TEST_GENERATION: 'gemini', // Gemini CLI — test generation
        },

        // ── Fallback Chain (order of CLI tools to try) ──
        fallbackChain: ['gemini', 'qwen', 'codex'],
        fallbackEnabled: asBool(process.env.ENABLE_AI_FALLBACK, true),
        maxRetries: 2,

        // ── Routing (auto vs manual) ──
        modelPreference: (process.env.AI_MODEL_PREFERENCE || 'auto').toLowerCase(),
        enableAutoRouting: asBool(process.env.ENABLE_AUTO_ROUTING, true),
        timeoutMs: asInt(process.env.AI_TIMEOUT_MS, 60000),
        scriptGenTimeoutMs: asInt(process.env.AI_SCRIPT_GEN_TIMEOUT_MS, 120000),

        // ── Vision & RAG (Multimodal reasoning) ──
        visionModel: process.env.VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct',
        embeddingModel: process.env.EMBEDDING_MODEL || 'models/embedding-001',
        ragSimilarityThreshold: parseFloat(process.env.RAG_THRESHOLD || '0.7'),
        userGuidePath: process.env.USER_GUIDE_PATH || path.join(process.cwd(), '..', 'docs', 'user_guides'),
    },
    discovery: {
        allowCloudFallback: asBool(process.env.DISCOVERY_ALLOW_CLOUD_FALLBACK, true),
        maxPages: asInt(process.env.DISCOVERY_MAX_PAGES, 50),
        deepMaxPages: asInt(process.env.DISCOVERY_DEEP_MAX_PAGES, 150),
        concurrency: asInt(process.env.DISCOVERY_CONCURRENCY, 2),
        timeoutMs: asInt(process.env.DISCOVERY_TIMEOUT_MS, 300000),
        maxDepth: asInt(process.env.DISCOVERY_MAX_DEPTH, 3),
        deepMaxDepth: asInt(process.env.DISCOVERY_DEEP_MAX_DEPTH, 5),
        retryCount: asInt(process.env.DISCOVERY_RETRY_COUNT, 2),
        pageTimeoutMs: asInt(process.env.DISCOVERY_PAGE_TIMEOUT_MS, 60000),
        allowedModels: (process.env.DISCOVERY_ALLOWED_MODELS || '').split(',').filter(Boolean),
        defaultStrategy: process.env.DISCOVERY_DEFAULT_STRATEGY || 'smart',
    },
    security: {
        rateLimitWindowMs: asInt(process.env.RATE_LIMIT_WINDOW_MS, 60000),
        rateLimitMax: asInt(process.env.RATE_LIMIT_MAX, 30),
        corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174,http://localhost:3000,https://app.ourspaceship.site')
            .split(',')
            .map(o => o.trim())
            .filter(Boolean),
    },
    playwright: {
        headless: asBool(process.env.PLAYWRIGHT_HEADLESS, true),
        timeoutMs: asInt(process.env.PLAYWRIGHT_TIMEOUT_MS, 30000),
        viewport: {
            width: asInt(process.env.PLAYWRIGHT_WIDTH, 1280),
            height: asInt(process.env.PLAYWRIGHT_HEIGHT, 720),
        },
    },
    // --- RESTORED MISSING SECTIONS ---
    storage: {
        baseDir: process.env.STORAGE_BASE_DIR || path.join(process.cwd(), 'uploads'),
        publicRoute: '/uploads',
    },
    telegram: {
        enabled: asBool(process.env.ENABLE_TELEGRAM_ALERTS, false),
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
    },
    investigation: {
        cloudMode: (process.env.INVESTIGATION_CLOUD_MODE || 'auto').toLowerCase(),
        cloudProfileName: process.env.INVESTIGATION_CLOUD_PROFILE || 'Cloud Fallback (Gemini)',
        cloudTimeoutMs: asInt(process.env.INVESTIGATION_CLOUD_TIMEOUT_MS, 25000),
        localTimeoutMs: asInt(process.env.INVESTIGATION_LOCAL_TIMEOUT_MS, 180000),
        promptMaxChars: asInt(process.env.INVESTIGATION_PROMPT_MAX_CHARS, 7000),
        maxChecks: asInt(process.env.INVESTIGATION_MAX_CHECKS, 8),
    },
    knowledge: {
        qwenPath: process.env.QWEN_PATH || path.join(os.homedir(), '.qwen'),
        codexPath: process.env.CODEX_PATH || path.join(os.homedir(), '.codex'),
        geminiPath: process.env.GEMINI_PATH || path.join(os.homedir(), '.gemini'),
        preferredPaths: (process.env.KNOWLEDGE_PREFERRED_PATHS || '').split(':').filter(Boolean),
        anythingLlmPath: process.env.KNOWLEDGE_ANYTHINGLLM_PATH || path.join(process.cwd(), 'llms'),
        extraPaths: (process.env.KNOWLEDGE_EXTRA_PATHS || '').split(':').filter(Boolean),
        enabled: asBool(process.env.ENABLE_KNOWLEDGE_BASE, true),
        maxFiles: asInt(process.env.KNOWLEDGE_MAX_FILES, 100),
        maxSnippetChars: asInt(process.env.KNOWLEDGE_MAX_SNIPPET_CHARS, 500)
    },
    jira: {
        // Jira Space Prefixes (Configurable via ENV or eventually UI)
        backlogPrefix: process.env.JIRA_BACKLOG_PREFIX || 'AB',
        testingPrefix: process.env.JIRA_TESTING_PREFIX || 'ATT',
        developmentPrefix: process.env.JIRA_DEV_PREFIX || 'GD',
        domain: process.env.JIRA_DOMAIN || '',
        email: process.env.JIRA_EMAIL || '',
        apiToken: process.env.JIRA_API_TOKEN || '',
    }
};

// ─── VALIDATE CRITICAL CONFIG ───
if (config.server.isProduction && config.server.jwtSecret === 'gohybridai-dev-secret-change-in-production') {
    console.error('\n' + '='.repeat(80));
    console.error('CRITICAL SECURITY ERROR: Default JWT_SECRET is active in PRODUCTION mode.');
    console.error('Please set a strong, unique JWT_SECRET in your .env file.');
    console.error('='.repeat(80) + '\n');
    process.exit(1);
}
