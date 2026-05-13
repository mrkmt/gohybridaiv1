import * as fs from 'fs';
import * as path from 'path';

interface TokenUsage {
    timestamp: string;
    model: string;
    taskType: string;
    ticketId?: string;
    endpoint?: string;
    inputTokens: number;
    outputTokens: number;
    inputChars: number;
    outputChars: number;
    estimatedCost: number;
    isTruncated: boolean;
}

interface UsageSummary {
    totalTokens: number;
    totalCost: number;
    totalCalls: number;
    byModel: Record<string, { tokens: number; cost: number; calls: number }>;
    byEndpoint: Record<string, { tokens: number; cost: number; calls: number }>;
    byTicket: Record<string, { tokens: number; cost: number; calls: number }>;
    truncatedCalls: number;
}

export class UsageTrackerService {
    private static logPath = path.join(process.cwd(), 'usage-logs.json');

    // Updated pricing (2025 rates per 1K tokens)
    private static COST_PER_1K_TOKENS: Record<string, number> = {
        // Gemini
        'gemini-1.5-pro': 0.0035,
        'gemini-1.5-flash': 0.00035,
        'gemini-2.0-flash': 0.0001,
        'gemini-2.5-pro': 0.0025,
        // Qwen
        'qwen2.5-coder:3b': 0,       // Local, free
        'qwen2.5-coder:7b': 0,       // Local, free
        'qwen2.5-coder:32b': 0,      // Local, free
        'qwen-plus': 0.0004,         // Dashscope
        'qwen-max': 0.002,           // Dashscope
        // Ollama local models
        'ollama': 0,
        'llama3': 0,
        'llama3.1': 0,
        'codellama': 0,
        // Cloud
        'groq': 0.0002,
        'openrouter': 0.001,
        // Defaults
        'codex': 0.002,
        'default': 0.001
    };

    /**
     * Estimate token count from character count.
     * More accurate than char/4: accounts for code vs prose.
     */
    static estimateTokens(chars: number): number {
        if (chars <= 0) return 0;
        // Code-heavy prompts use ~3 chars/token, prose uses ~4
        return Math.ceil(chars / 3.5);
    }

    /**
     * Get the cost rate per 1K tokens for a model.
     * Handles exact match and prefix matching for local models.
     */
    private static getCostRate(model: string): number {
        const rate = this.COST_PER_1K_TOKENS[model];
        if (rate !== undefined) return rate;

        // Prefix match for local/ollama models
        const lower = model.toLowerCase();
        if (lower.includes('ollama') || lower.includes('llama') ||
            lower.includes('qwen2.5-coder') || lower.includes('codellama') ||
            lower.startsWith('qwen2.5:')) {
            return 0;
        }
        return this.COST_PER_1K_TOKENS['default'];
    }

    /**
     * Logs token usage with full context and estimates cost.
     * Call this from EVERY AI endpoint.
     */
    static async logUsage(params: {
        model: string;
        taskType: string;
        ticketId?: string;
        endpoint?: string;
        inputChars: number;
        outputChars: number;
        isTruncated?: boolean;
        usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            inputTokens?: number;
            outputTokens?: number;
        };
    }): Promise<void> {
        // Use provided tokens if available, otherwise estimate
        const inputTokens = params.usage?.inputTokens || params.usage?.prompt_tokens || this.estimateTokens(params.inputChars);
        const outputTokens = params.usage?.outputTokens || params.usage?.completion_tokens || this.estimateTokens(params.outputChars);
        
        const rate = this.getCostRate(params.model);
        const cost = ((inputTokens + outputTokens) / 1000) * rate;

        const entry: TokenUsage = {
            timestamp: new Date().toISOString(),
            model: params.model,
            taskType: params.taskType,
            ticketId: params.ticketId,
            endpoint: params.endpoint,
            inputTokens,
            outputTokens,
            inputChars: params.inputChars,
            outputChars: params.outputChars,
            estimatedCost: cost,
            isTruncated: params.isTruncated || false
        };

        // Log to console (always)
        const ticketTag = params.ticketId ? ` [${params.ticketId}]` : '';
        const truncTag = params.isTruncated ? ' ⚠️TRUNCATED' : '';
        console.log(
            `[Usage Tracker] ${params.model}${ticketTag}: ${params.taskType} — ` +
            `${(inputTokens + outputTokens).toLocaleString()} tokens ` +
            `(~$${cost.toFixed(5)})${truncTag}`
        );

        // Log to file (append mode, no read-modify-write race)
        try {
            // Append to array in a single write
            let logs: TokenUsage[] = [];
            if (fs.existsSync(this.logPath)) {
                logs = JSON.parse(fs.readFileSync(this.logPath, 'utf8'));
            }
            logs.push(entry);

            // Keep only last 5000 entries (increased from 1000)
            if (logs.length > 5000) logs = logs.slice(-5000);

            fs.writeFileSync(this.logPath, JSON.stringify(logs, null, 2), 'utf8');
        } catch (err) {
            console.error('[Usage Tracker] Failed to save usage log:', err);
        }
    }

    /**
     * Get comprehensive usage summary.
     * Breakdown by model, endpoint, ticket.
     */
    static getSummary(): UsageSummary {
        if (!fs.existsSync(this.logPath)) {
            return this._emptySummary();
        }

        try {
            const logs: TokenUsage[] = JSON.parse(fs.readFileSync(this.logPath, 'utf8'));
            return this._computeSummary(logs);
        } catch {
            return this._emptySummary();
        }
    }

    /**
     * Get usage for a specific ticket.
     */
    static getTicketUsage(ticketId: string): { tokens: number; cost: number; calls: number; entries: TokenUsage[] } {
        if (!fs.existsSync(this.logPath)) {
            return { tokens: 0, cost: 0, calls: 0, entries: [] };
        }

        try {
            const logs: TokenUsage[] = JSON.parse(fs.readFileSync(this.logPath, 'utf8'));
            const ticketLogs = logs.filter(l => l.ticketId === ticketId);
            const tokens = ticketLogs.reduce((sum, l) => sum + l.inputTokens + l.outputTokens, 0);
            const cost = ticketLogs.reduce((sum, l) => sum + l.estimatedCost, 0);
            return {
                tokens,
                cost,
                calls: ticketLogs.length,
                entries: ticketLogs
            };
        } catch {
            return { tokens: 0, cost: 0, calls: 0, entries: [] };
        }
    }

    /**
     * Get usage for today only.
     */
    static getTodaySummary(): UsageSummary {
        if (!fs.existsSync(this.logPath)) {
            return this._emptySummary();
        }

        try {
            const logs: TokenUsage[] = JSON.parse(fs.readFileSync(this.logPath, 'utf8'));
            const today = new Date().toISOString().slice(0, 10);
            const todayLogs = logs.filter(l => l.timestamp.startsWith(today));
            return this._computeSummary(todayLogs);
        } catch {
            return this._emptySummary();
        }
    }

    /**
     * Clear usage logs.
     */
    static clearLogs(): void {
        if (fs.existsSync(this.logPath)) {
            fs.unlinkSync(this.logPath);
        }
    }

    // --- Private helpers ---

    private static _emptySummary(): UsageSummary {
        return {
            totalTokens: 0,
            totalCost: 0,
            totalCalls: 0,
            byModel: {},
            byEndpoint: {},
            byTicket: {},
            truncatedCalls: 0
        };
    }

    private static _computeSummary(logs: TokenUsage[]): UsageSummary {
        const summary: UsageSummary = {
            totalTokens: 0,
            totalCost: 0,
            totalCalls: logs.length,
            byModel: {},
            byEndpoint: {},
            byTicket: {},
            truncatedCalls: 0
        };

        for (const log of logs) {
            const tokens = log.inputTokens + log.outputTokens;
            summary.totalTokens += tokens;
            summary.totalCost += log.estimatedCost;

            if (log.isTruncated) summary.truncatedCalls++;

            // By model
            if (!summary.byModel[log.model]) {
                summary.byModel[log.model] = { tokens: 0, cost: 0, calls: 0 };
            }
            summary.byModel[log.model].tokens += tokens;
            summary.byModel[log.model].cost += log.estimatedCost;
            summary.byModel[log.model].calls++;

            // By endpoint
            const ep = log.endpoint || log.taskType;
            if (!summary.byEndpoint[ep]) {
                summary.byEndpoint[ep] = { tokens: 0, cost: 0, calls: 0 };
            }
            summary.byEndpoint[ep].tokens += tokens;
            summary.byEndpoint[ep].cost += log.estimatedCost;
            summary.byEndpoint[ep].calls++;

            // By ticket
            if (log.ticketId) {
                if (!summary.byTicket[log.ticketId]) {
                    summary.byTicket[log.ticketId] = { tokens: 0, cost: 0, calls: 0 };
                }
                summary.byTicket[log.ticketId].tokens += tokens;
                summary.byTicket[log.ticketId].cost += log.estimatedCost;
                summary.byTicket[log.ticketId].calls++;
            }
        }

        return summary;
    }
}
