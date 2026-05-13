/**
 * Structured Logger for GoHybridAI Backend
 *
 * Usage:
 *   import { appLogger } from '../utils/logger';
 *   appLogger.info('Test execution started', { ticketId: 'ATT-15', userId: '...' });
 *   appLogger.error('Execution failed', { ticketId: 'ATT-15', error: '...' });
 *
 * Output format:
 *   {"level":"INFO","ts":"2026-04-05T10:00:00.000Z","msg":"Test execution started","service":"backend","ticketId":"ATT-15"}
 *
 * Works on Windows, Mac, and Linux — pure stdout output.
 */

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
type LogLevel = keyof typeof LEVELS;

const LOG_LEVEL = (process.env.LOG_LEVEL || 'INFO').toUpperCase() as LogLevel;

function formatTs() {
    return new Date().toISOString();
}

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (LEVELS[level] < LEVELS[LOG_LEVEL]) return;

    // Log Sampling — Only 1% of INFO level logs are output in production
    // WARN and ERROR are always logged (100%)
    if (level === 'INFO' && process.env.NODE_ENV === 'production') {
        if (Math.random() > 0.01) return;
    }

    const entry = { level, ts: formatTs(), msg, service: 'gohybridai-backend', ...meta };
    const out = level === 'ERROR' ? process.stderr : process.stdout;
    out.write(JSON.stringify(entry) + '\n');
}

export const appLogger = {
    debug: (msg: string, meta?: Record<string, unknown>) => log('DEBUG', msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) => log('INFO', msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => log('WARN', msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => log('ERROR', msg, meta),
};
