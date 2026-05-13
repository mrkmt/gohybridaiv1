import fetch from 'node-fetch';
import { appLogger } from '../src/utils/logger';
import { config } from './config';
import * as fs from 'fs';
import * as path from 'path';

export interface ModelProfile {
    name: string;
    model: string;
    apiBase?: string;
    apiType: 'openai' | 'gemini' | 'cli' | 'vertex';
    apiKey?: string;
    command?: string;
    contextLimit: number;
    maxTokens?: number;
    temperature?: number;
    thinkingBudget?: number;
    description: string;
}

export interface RouterConfig {
    profiles: ModelProfile[];
    assignments: Record<string, string>;
    strategy: {
        fallbackEnabled: boolean;
        fallbackProfile: string;
        fallbackChain: string[];
        maxRetries: number;
        timeoutMs: number;
    };
}

export interface TokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export interface AgentResult {
    response: string;
    profile: string;
    model: string;
    latencyMs: number;
    retries: number;
    usage: TokenUsage;
}

// Roles whose output is deterministic enough to cache.
// REASONING / INVESTIGATOR are excluded — they need fresh analysis each run.
const CACHEABLE_ROLES = new Set(['TEST_GENERATION', 'CODE', 'BUSINESS_LOGIC', 'DOCUMENTATION', 'ANALYST']);
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CACHE_MAX = 40;

interface CacheEntry { response: string; usage: TokenUsage; ts: number; }

export class MultiAgentRouter {
    private static CONFIG_PATH = path.join(__dirname, '..', 'agent_profiles.json');
    private static config: RouterConfig | null = null;
    private static activeGeminiKeyIndex = 0;
    private static promptCache = new Map<string, CacheEntry>();

    private static hashPrompt(s: string): string {
        let h = 5381;
        const limit = Math.min(s.length, 3000);
        for (let i = 0; i < limit; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
        return (h >>> 0).toString(16);
    }

    private static cacheGet(role: string, profileName: string, prompt: string): CacheEntry | null {
        if (!CACHEABLE_ROLES.has(role.toUpperCase())) return null;
        const key = `${profileName}:${this.hashPrompt(prompt)}`;
        const hit = this.promptCache.get(key);
        if (!hit) return null;
        if (Date.now() - hit.ts > CACHE_TTL_MS) { this.promptCache.delete(key); return null; }
        return hit;
    }

    private static cacheSet(role: string, profileName: string, prompt: string, value: { response: string; usage: TokenUsage }) {
        if (!CACHEABLE_ROLES.has(role.toUpperCase())) return;
        if (this.promptCache.size >= CACHE_MAX) {
            const oldest = [...this.promptCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
            if (oldest) this.promptCache.delete(oldest[0]);
        }
        const key = `${profileName}:${this.hashPrompt(prompt)}`;
        this.promptCache.set(key, { ...value, ts: Date.now() });
    }

    private static load(): RouterConfig {
        if (this.config) return this.config;
        try {
            const raw = fs.readFileSync(this.CONFIG_PATH, 'utf8');
            this.config = JSON.parse(raw);
            this.applyEnvAssignmentOverrides(this.config!);
            return this.config!;
        } catch (e) {
            appLogger.error('[MultiAgentRouter] Failed to load config, using hardcoded defaults');
            return this.getDefaultConfig();
        }
    }

    public static reload() {
        this.config = null;
        this.load();
    }

    public static setRoleOverride(role: string, profile: string) {}
    public static clearRoleOverrides() {}

    public static getConfig(): RouterConfig {
        return this.load();
    }

    public static getProfileForRole(role: string): ModelProfile | undefined {
        const cfg = this.load();
        const profileName = cfg.assignments[role.toUpperCase()] || cfg.strategy.fallbackProfile;
        return cfg.profiles.find(p => p.name === profileName);
    }

    public static saveConfig(newConfig: RouterConfig) {
        this.config = newConfig;
        fs.writeFileSync(this.CONFIG_PATH, JSON.stringify(newConfig, null, 2));
        this.applyEnvAssignmentOverrides(this.config!);
    }

    private static applyEnvAssignmentOverrides(cfg: RouterConfig) {
        const roles = Object.keys(cfg.assignments);
        for (const role of roles) {
            const envKey = `AI_PROFILE_${role.toUpperCase()}`;
            const value = process.env[envKey];
            if (typeof value === 'string' && value.trim()) {
                cfg.assignments[role.toUpperCase()] = value.trim();
            }
        }
    }

    private static getDefaultConfig(): RouterConfig {
        return {
            profiles: [
                {
                    name: 'vertex-gemini',
                    model: 'gemini-2.5-flash',
                    apiBase: 'asia-southeast1',
                    apiType: 'vertex',
                    apiKey: 'config/vertex-key.json',
                    contextLimit: 1000000,
                    maxTokens: 32768,  // Gemini 2.5 Flash supports up to 65536 output tokens
                    temperature: 0.7,
                    description: 'Primary — Google Cloud Vertex AI (Gemini 2.5 Flash)'
                },
                {
                    name: 'gemini-cli',
                    model: 'gemini-cli',
                    apiType: 'cli',
                    command: 'gemini',
                    contextLimit: 1000000,
                    maxTokens: 32768,
                    description: 'Fallback — local Gemini CLI'
                },
                {
                    name: 'gemini-http',
                    model: 'gemini-1.5-flash',
                    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
                    apiType: 'gemini',
                    apiKey: 'process.env.GEMINI_API_KEY',
                    contextLimit: 1000000,
                    maxTokens: 32768,
                    temperature: 0.7,
                    description: 'Backup — Gemini REST API'
                }
            ],
            assignments: {
                'VISION': 'vertex-gemini',
                'REASONING': 'vertex-gemini',
                'CODE': 'vertex-gemini',
                'TEST_GENERATION': 'vertex-gemini',
                'INVESTIGATOR': 'vertex-gemini',
                'ARCHITECT': 'vertex-gemini',
                'REVIEWER': 'vertex-gemini',
                'QUICK': 'vertex-gemini',
                'ANALYST': 'vertex-gemini',
                'DOCUMENTATION': 'vertex-gemini',
                'BUSINESS_LOGIC': 'vertex-gemini'
            },
            strategy: {
                fallbackEnabled: true,
                fallbackProfile: 'gemini-http',
                fallbackChain: ['vertex-gemini', 'gemini-cli', 'gemini-http'],
                maxRetries: 2,
                timeoutMs: 300000
            }
        };
    }

    private static resolveApiKey(profile: ModelProfile): string | undefined {
        if (!profile.apiKey) return undefined;
        if (profile.apiKey.startsWith('process.env.')) {
            const key = profile.apiKey.replace('process.env.', '');
            return process.env[key];
        }
        return profile.apiKey;
    }

    public static async route(role: string, prompt: string, structured: boolean = false, timeoutMsOverride?: number): Promise<AgentResult> {
        const cfg = this.load();
        const profileName = cfg.assignments[role.toUpperCase()] || cfg.strategy.fallbackProfile;

        // Cache check — skip for structured JSON calls to avoid type coercion issues
        if (!structured) {
            const hit = this.cacheGet(role, profileName, prompt);
            if (hit) {
                appLogger.info(`[MultiAgentRouter] Cache hit for role=${role}`);
                return { response: hit.response, profile: profileName, model: profileName, latencyMs: 0, retries: 0, usage: hit.usage };
            }
        }

        const result = await this.routeWithProfile(profileName, prompt, structured, timeoutMsOverride);

        if (!structured) this.cacheSet(role, profileName, prompt, { response: result.response, usage: result.usage });
        return result;
    }

    public static async routeWithProfile(profileName: string, prompt: string, structured: boolean = false, timeoutMsOverride?: number): Promise<AgentResult> {
        const cfg = this.load();
        const profile = cfg.profiles.find(p => p.name === profileName);
        if (!profile) throw new Error(`Profile not found: ${profileName}`);

        const timeoutMs = timeoutMsOverride || cfg.strategy.timeoutMs;
        const startTime = Date.now();
        let lastError: any = null;

        const chain = [profileName, ...cfg.strategy.fallbackChain.filter(n => n !== profileName)];

        for (const targetProfileName of chain) {
            const targetProfile = cfg.profiles.find(p => p.name === targetProfileName);
            if (!targetProfile) continue;

            for (let attempt = 0; attempt <= cfg.strategy.maxRetries; attempt++) {
                try {
                    let result: { response: string, usage: TokenUsage };
                    if (targetProfile.apiType === 'openai') {
                        result = await this.callOpenAI(targetProfile, prompt, structured, timeoutMs);
                    } else if (targetProfile.apiType === 'vertex') {
                        result = await this.callVertex(targetProfile, prompt, structured, timeoutMs);
                    } else if (targetProfile.apiType === 'gemini') {
                        result = await this.callGemini(targetProfile, prompt, structured, timeoutMs);
                    } else if (targetProfile.apiType === 'cli') {
                        result = await this.callCli(targetProfile, prompt, timeoutMs);
                    } else {
                        throw new Error(`Unsupported apiType: ${targetProfile.apiType}`);
                    }

                    return {
                        response: result.response,
                        profile: targetProfileName,
                        model: targetProfile.model,
                        latencyMs: Date.now() - startTime,
                        retries: attempt,
                        usage: result.usage
                    };
                } catch (err: any) {
                    lastError = err;
                    appLogger.warn(`[MultiAgentRouter] ${targetProfileName} failed (attempt ${attempt}): ${err.message}`);
                }
            }
        }

        throw new Error(`AI Agent failed and no cascade fallback succeeded. Last error: ${lastError?.message}`);
    }

    private static async callOpenAI(profile: ModelProfile, prompt: string, structured: boolean, timeoutMs: number): Promise<{ response: string, usage: TokenUsage }> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const headers: any = { 'Content-Type': 'application/json' };
        const apiKey = this.resolveApiKey(profile);
        if (!apiKey) throw new Error(`Missing API key for ${profile.name}`);
        headers['Authorization'] = `Bearer ${apiKey}`;

        let content: any = prompt;
        try {
            if (prompt.trim().startsWith('[') && prompt.trim().endsWith(']')) {
                const parsed = JSON.parse(prompt);
                if (Array.isArray(parsed)) content = parsed;
            }
        } catch (e) {}

        const res = await fetch(`${profile.apiBase}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: profile.model,
                messages: [{ role: 'user', content }],
                max_tokens: profile.maxTokens || 4096,
                temperature: profile.temperature || 0.0,
                ...(structured ? { response_format: { type: 'json_object' } } : {})
            }),
            signal: controller.signal as any
        }).finally(() => clearTimeout(timer));

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`OpenAI HTTP ${res.status}: ${err.substring(0, 200)}`);
        }

        const data = await res.json() as any;
        return {
            response: data.choices[0].message.content,
            usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
    }

    /**
     * Shell out to a CLI binary (e.g. the `gemini` CLI) and capture stdout.
     * Prompt is streamed on stdin so it isn't clipped by OS argv limits.
     * Token usage is approximated (CLIs don't report it) — just for telemetry.
     */
    private static async callCli(profile: ModelProfile, prompt: string, timeoutMs: number): Promise<{ response: string, usage: TokenUsage }> {
        const child_process = await import('child_process');
        const binary = profile.command || profile.name;
        // `gemini -p -` reads prompt from stdin; other CLIs may differ — keep simple.
        const args = ['-p', '-'];
        return await new Promise((resolve, reject) => {
            const proc = child_process.spawn(binary, args, {
                shell: process.platform === 'win32', // needed for .cmd shims on Windows
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                proc.kill();
                reject(new Error(`${binary} CLI timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            proc.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
            proc.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
            proc.on('error', (err) => { clearTimeout(timer); reject(err); });
            proc.on('close', (code) => {
                clearTimeout(timer);
                if (code !== 0) {
                    return reject(new Error(`${binary} CLI exited ${code}: ${stderr.slice(0, 500)}`));
                }
                const approxPromptTokens = Math.ceil(prompt.length / 4);
                const approxCompletionTokens = Math.ceil(stdout.length / 4);
                resolve({
                    response: stdout.trim(),
                    usage: {
                        prompt_tokens: approxPromptTokens,
                        completion_tokens: approxCompletionTokens,
                        total_tokens: approxPromptTokens + approxCompletionTokens,
                    },
                });
            });

            try {
                proc.stdin.write(prompt);
                proc.stdin.end();
            } catch (err) {
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    private static async callGemini(profile: ModelProfile, prompt: string, structured: boolean, timeoutMs: number): Promise<{ response: string, usage: TokenUsage }> {
        const keys = [config.ai.geminiApiKey, config.ai.geminiApiKey2].filter(Boolean);
        if (keys.length === 0) throw new Error('No Gemini API keys found');

        let lastErr: any;
        for (let i = 0; i < keys.length; i++) {
            const key = keys[(this.activeGeminiKeyIndex + i) % keys.length];
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const modelName = profile.model.startsWith('models/') ? profile.model : `models/${profile.model}`;
                const url = `${profile.apiBase}/${modelName}:generateContent?key=${key}`;

                let contents: any = [{ parts: [{ text: prompt }] }];
                try {
                    if (prompt.trim().startsWith('[') && prompt.trim().endsWith(']')) {
                        const parsed = JSON.parse(prompt);
                        if (Array.isArray(parsed)) {
                            const parts = parsed.map(item => {
                                if (item.type === 'text') return { text: item.text };
                                if (item.type === 'image_url' && item.image_url?.url?.startsWith('data:')) {
                                    const [mimeInfo, base64Data] = item.image_url.url.split(';base64,');
                                    return { inline_data: { mime_type: mimeInfo.split(':')[1] || 'image/png', data: base64Data } };
                                }
                                return null;
                            }).filter(Boolean);
                            contents = [{ parts }];
                        }
                    }
                } catch (e) {}

                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents,
                        generationConfig: {
                            temperature: profile.temperature || 0.7,
                            maxOutputTokens: profile.maxTokens || 32768,
                            ...(structured ? { responseMimeType: 'application/json' } : {})
                        }
                    }),
                    signal: controller.signal as any
                }).finally(() => clearTimeout(timer));

                if (res.status === 429) {
                    this.activeGeminiKeyIndex = (this.activeGeminiKeyIndex + 1) % keys.length;
                    continue;
                }

                if (!res.ok) {
                    const err = await res.text();
                    throw new Error(`Gemini HTTP ${res.status}: ${err.substring(0, 200)}`);
                }

                const data = await res.json() as any;
                
                // Gemini usage metadata is slightly different
                const usage = {
                    prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
                    completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
                    total_tokens: data.usageMetadata?.totalTokenCount || 0
                };

                return {
                    response: data.candidates[0].content.parts[0].text,
                    usage
                };
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr;
    }

    private static resolveApiKeyPath(pPath: string): string {
        if (path.isAbsolute(pPath)) return pPath;
        // Resolve relative to the backend root (parent of api/)
        return path.resolve(__dirname, '..', pPath);
    }

    private static async callVertex(profile: ModelProfile, prompt: string, structured: boolean, timeoutMs: number): Promise<{ response: string, usage: TokenUsage }> {
        const { VertexAI } = await import('@google-cloud/vertexai');
        
        const keyPath = profile.apiKey ? this.resolveApiKeyPath(profile.apiKey) : '';
        
        if (keyPath && fs.existsSync(keyPath)) {
            process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
        } else {
            throw new Error(`Vertex AI credentials not found at ${keyPath} (from config: ${profile.apiKey})`);
        }

        const creds = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        const projectId = creds.project_id;
        const location = profile.apiBase || 'asia-southeast1';

        const vertexAI = new VertexAI({ project: projectId, location: location });
        const generativeModel = vertexAI.getGenerativeModel({
            model: profile.model,
            generationConfig: {
                maxOutputTokens: profile.maxTokens || 32768,
                temperature: profile.temperature || 0.7,
                ...(structured ? { responseMimeType: 'application/json' } : {}),
                ...(profile.thinkingBudget != null ? {
                    thinkingConfig: { thinkingBudget: profile.thinkingBudget, includeThoughts: false }
                } : {})
            }
        });

        let contents: any = [{ role: 'user', parts: [{ text: prompt }] }];
        try {
            if (prompt.trim().startsWith('[') && prompt.trim().endsWith(']')) {
                const parsed = JSON.parse(prompt);
                if (Array.isArray(parsed)) {
                    const parts = parsed.map(item => {
                        if (item.type === 'text') return { text: item.text };
                        if (item.type === 'image_url' && item.image_url?.url?.startsWith('data:')) {
                            const [mimeInfo, base64Data] = item.image_url.url.split(';base64,');
                            return { inlineData: { mimeType: mimeInfo.split(':')[1] || 'image/png', data: base64Data } };
                        }
                        return null;
                    }).filter(Boolean);
                    contents = [{ role: 'user', parts }];
                }
            }
        } catch (e) {}

        const req = { contents };
        
        const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`Vertex AI timed out after ${timeoutMs}ms`)), timeoutMs)
        );

        const responsePromise = generativeModel.generateContent(req);
        const result = await Promise.race([responsePromise, timeoutPromise]);
        
        const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text || '';

        const meta = result.response.usageMetadata;
        const thinkingTokens = (meta as any)?.thoughtsTokenCount || 0;
        
        // candidatesTokenCount logic for thinking models:
        // Some providers include thoughts in candidatesTokenCount, others keep them separate.
        // We assume they are included IF subtraction stays positive.
        const candidatesTokens = meta?.candidatesTokenCount || 0;
        const completionTokens = (candidatesTokens > thinkingTokens) 
            ? (candidatesTokens - thinkingTokens) 
            : candidatesTokens;

        const usage = {
            prompt_tokens: meta?.promptTokenCount || 0,
            completion_tokens: completionTokens,
            total_tokens: meta?.totalTokenCount || 0,
        };

        if (thinkingTokens > 0) {
            appLogger.info(`[Vertex] thinking_tokens=${thinkingTokens} output_tokens=${completionTokens} total=${usage.total_tokens}`);
        }

        return { response: responseText, usage };
    }

    public static async getHealth(): Promise<Record<string, boolean>> {
        const cfg = this.load();
        const health: Record<string, boolean> = {};
        for (const p of cfg.profiles) {
            health[p.name] = !!this.resolveApiKey(p);
        }
        return health;
    }
}
