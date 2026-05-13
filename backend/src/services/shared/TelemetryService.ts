import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { redactSensitive } from '../../../api/utils/security';

export interface TelemetryLog {
    id: string;
    timestamp: string;
    category: 'INFO' | 'WARN' | 'ERROR' | 'AI' | 'DB' | 'HTTP';
    source: string;
    message: string;
    metadata?: any;
}

export type DbClient = {
    query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>;
};

export class TelemetryService {
    private static logs: TelemetryLog[] = [];
    private static maxSize = 500;
    private static listeners: Set<(log: TelemetryLog) => void> = new Set();
    private static flushInterval: NodeJS.Timeout | null = null;
    private static flushTimer: NodeJS.Timeout | null = null;
    private static dbPool: DbClient | null = null;

    static getPool(): DbClient | null {
        return this.dbPool;
    }

    static initialize(pool?: DbClient): void {
        this.dbPool = pool || null;

        // Start periodic flush worker (every 5 seconds)
        this.flushInterval = setInterval(() => {
            this.flushLogs();
        }, 5000);

        // Handle graceful shutdown
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());

        // Enable console interception (also writes structured JSON to stdout)
        this.interceptConsole();
        try {
            const { Logger } = require('../../api/utils/logger');
            if (Logger && typeof Logger.interceptConsole === 'function') {
                Logger.interceptConsole();
            }
        } catch {
            // Logger module not available or interceptConsole doesn't exist — skip gracefully
        }
    }

    static add(log: Omit<TelemetryLog, 'id' | 'timestamp'>): TelemetryLog {
        const entry: TelemetryLog = {
            ...log,
            id: uuidv4(),
            timestamp: new Date().toISOString()
        };

        this.logs.unshift(entry);
        if (this.logs.length > this.maxSize) {
            this.logs.pop();
        }

        // Notify WebSocket listeners
        this.listeners.forEach(fn => fn(entry));

        // CRITICAL: Immediate persistence for Errors and Warnings
        if (entry.category === 'ERROR' || entry.category === 'WARN') {
            this.flushLogs();
        } else if (this.logs.length % 20 === 0) {
            this.flushLogs();
        }

        return entry;
    }

    private static async flushLogs(): Promise<void> {
        if (this.logs.length === 0) return;

        // Copy logs to flush, but don't clear until persist succeeds
        const logsToFlush = [...this.logs];

        try {
            // Batch write to database
            if (this.dbPool) {
                await this.batchInsertLogs(logsToFlush, this.dbPool);
            }

            // Also write to file for local storage
            await this.persistToFile(logsToFlush);

            // Only clear buffer after successful persistence
            this.logs = [];
        } catch (e) {
            console.error('[Telemetry] Batch flush failed:', e);
            // Logs remain in buffer for retry on next flush cycle
            // Truncate to max size if we accumulated too many
            if (this.logs.length > this.maxSize) {
                this.logs = this.logs.slice(0, this.maxSize);
            }
        }
    }

    private static async batchInsertLogs(logs: TelemetryLog[], pool: DbClient): Promise<void> {
        if (!pool) return;

        const values = logs.map(log => [
            log.id,
            log.timestamp,
            log.category,
            log.source,
            log.message,
            JSON.stringify(log.metadata || {})
        ]);

        const placeholders = values.map((_, i) => 
            `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`
        ).join(', ');

        const query = `
            INSERT INTO telemetry_logs (id, timestamp, category, source, message, metadata)
            VALUES ${placeholders}
            ON CONFLICT (id) DO UPDATE SET
                timestamp = EXCLUDED.timestamp,
                category = EXCLUDED.category,
                source = EXCLUDED.source,
                message = EXCLUDED.message,
                metadata = EXCLUDED.metadata
        `;

        await pool.query(query, values.flat());
    }

    private static async persistToFile(logs: TelemetryLog[]): Promise<void> {
        try {
            const logPath = path.join(process.cwd(), 'local_storage', 'logs', 'telemetry.json');
            const dir = path.dirname(logPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Read existing, merge, and keep last 1000
            let historical: TelemetryLog[] = [];
            try {
                if (fs.existsSync(logPath)) {
                    const raw = fs.readFileSync(logPath, 'utf8');
                    historical = JSON.parse(raw);
                }
            } catch { /* file may not exist yet or invalid JSON */ }

            const merged = [...logs, ...historical].slice(0, 1000);
            fs.writeFileSync(logPath, JSON.stringify(merged, null, 2));
        } catch (e) {
            // Using original console to avoid loop
            process.stdout.write(`[Telemetry] File persistence failed: ${e}\n`);
        }
    }

    static get(limit: number = 100): TelemetryLog[] {
        return this.logs.slice(0, limit);
    }

    static clear(): void {
        this.logs = [];
        try {
            const logPath = path.join(process.cwd(), 'local_storage', 'logs', 'telemetry.json');
            if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
        } catch (e) { }
    }

    static subscribe(fn: (log: TelemetryLog) => void): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    static shutdown(): void {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        
        // Final flush before shutdown
        this.flushLogs().finally(() => {
            process.exit(0);
        });
    }

    static interceptConsole(): void {
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;

        console.log = (...args) => {
            const msg = args.join(' ');
            if (msg.startsWith('[')) {
                const match = msg.match(/\[([^\]]+)\]\s*(.*)/);
                if (match) {
                    this.add({
                        category: 'INFO',
                        source: match[1],
                        message: redactSensitive(match[2])
                    });
                }
            }
            originalLog.apply(console, args);
        };

        console.warn = (...args) => {
            const msg = args.join(' ');
            const match = msg.match(/\[([^\]]+)\]\s*(.*)/);
            if (match) {
                this.add({
                    category: 'WARN',
                    source: match[1],
                    message: redactSensitive(match[2])
                });
            }
            originalWarn.apply(console, args);
        };

        console.error = (...args) => {
            const msg = args.join(' ');
            const match = msg.match(/\[([^\]]+)\]\s*(.*)/);
            if (match) {
                this.add({
                    category: 'ERROR',
                    source: match[1],
                    message: redactSensitive(match[2])
                });
            }
            originalError.apply(console, args);
        };
    }
}
