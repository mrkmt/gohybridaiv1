import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config';

function keyGen(req: any): string {
    const ip = req.ip || req.connection?.remoteAddress;
    const key = ipKeyGenerator(ip);
    return key === 'unknownIp' ? 'anonymous' : key;
}

export const generalLimiter = rateLimit({
    windowMs: config.security.rateLimitWindowMs,
    max: config.security.rateLimitMax,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyGen,
});

export const writeLimiter = rateLimit({
    windowMs: config.security.rateLimitWindowMs,
    max: Math.floor(config.security.rateLimitMax / 3),
    message: { error: 'Too many write requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyGen,
});

export const aiLimiter = rateLimit({
    windowMs: config.security.rateLimitWindowMs * 2,
    max: Math.floor(config.security.rateLimitMax / 5),
    message: { error: 'AI rate limit exceeded, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyGen,
});

/**
 * Strict limiter for test execution/starting.
 * Prevents a single user from flooding with concurrent test runs.
 * 1 concurrent execution per user is enforced by DB lock,
 * this limiter prevents abuse: max 5 test starts per minute per IP/user.
 */
export const testingExecutionLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute sliding window
    max: 5, // max 5 executions per user per minute
    message: {
        error: 'Too many test executions. Max 5 per minute.',
        code: 'EXECUTION_RATE_LIMITED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as any).user?.id || keyGen(req),
});
