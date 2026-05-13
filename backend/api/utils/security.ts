import path from 'path';
import crypto from 'crypto';

const PARAM_RE = new RegExp("(\\b(?:token|password|api_key|api-key|apikey|secret|passphrase)\\b)\\s*[:=]\\s*(['\"]?)\\S+?\\2", "gi");
const QUERY_PARAM_RE = /([?&])(?:token|access_token|api_key|api-key|password|secret)=([^&]+)/gi;

export function sanitizePath(baseDir: string, userInput: string): string {
    if (!userInput || typeof userInput !== 'string') {
        throw new Error('Invalid path');
    }

    const normalized = userInput.replace(/\\/g, path.posix.sep);
    if (normalized.includes('\\0') || normalized.includes('..')) {
        throw new Error('Path traversal detected');
    }

    const resolved = path.resolve(baseDir, normalized);
    const normalizedBase = path.resolve(baseDir);

    if (!resolved.startsWith(normalizedBase)) {
        throw new Error('Resolved path escapes base directory');
    }

    return resolved;
}

export function sanitizeRelativePath(baseDir: string, relativePath: string): string {
    const resolved = sanitizePath(baseDir, relativePath);
    return path.relative(baseDir, resolved);
}

export function redactSensitive(value: string): string {
    if (typeof value !== 'string') return value;
    
    let redacted = value.replace(PARAM_RE, (_match, key) => `${key}: ****`);
    redacted = redacted.replace(QUERY_PARAM_RE, '$1$2=****');
    return redacted;
}

export function generateSecureId(): string {
    return crypto.randomBytes(16).toString('hex');
}

export function validateFileName(filename: string): string {
    if (!filename || typeof filename !== 'string') {
        throw new Error('Invalid filename');
    }
    
    // Remove dangerous characters and ensure it's a valid filename
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (sanitized.length === 0 || sanitized === '.' || sanitized === '..') {
        throw new Error('Invalid filename');
    }
    
    return sanitized;
}

export function ensureSafeArgs(args: string[]): void {
    const DENY_LIST = /[;&|]/;
    for (const arg of args) {
        if (DENY_LIST.test(arg)) {
            throw new Error(`Unsafe CLI argument detected: ${arg}`);
        }
    }
}

export function isSafePath(value: string): boolean {
    return /^[a-zA-Z0-9_\-\/\.]+$/i.test(value) && !value.includes('..');
}

export function sanitizeFilename(filename: string): string {
    return path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, '_');
}
