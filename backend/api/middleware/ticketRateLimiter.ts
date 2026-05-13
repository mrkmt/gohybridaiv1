import { Request, Response, NextFunction } from 'express';

interface ActiveSession {
    lockedAt: number;
    expiresAt: number;
    ticketId: string;
    sessionId: string;
}

const activeSessions = new Map<string, ActiveSession>();
const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 min max session lock
const CLEANUP_INTERVAL = 5 * 60 * 1000; // cleanup every 5 min

// Periodic cleanup of stale locks
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of activeSessions) {
        if (now > session.expiresAt) {
            activeSessions.delete(key);
        }
    }
}, CLEANUP_INTERVAL);

function extractTicketId(req: Request): string | null {
    // Try route param, query param, or body
    return (req.params.ticketId
        || req.params.ticketKey
        || req.query.ticketId as string
        || req.query.jiraId as string
        || req.body.ticketId
        || req.body.jiraId
        || req.params.id || null);
}

export function ticketRateLimiter(req: Request, res: Response, next: NextFunction) {
    const ticketId = extractTicketId(req);
    if (!ticketId) return next(); // skip if no ticket context

    const sessionId = (req.headers['x-session-id'] as string) || req.ip || 'anonymous';
    const now = Date.now();
    const lockKey = ticketId;

    const existing = activeSessions.get(lockKey);

    if (existing) {
        // Lock expired? Reclaim it
        if (now > existing.expiresAt) {
            activeSessions.delete(lockKey);
        } else if (existing.sessionId !== sessionId) {
            // Another session holds the lock
            res.status(429).json({
                error: 'Ticket is currently being processed by another session',
                retryAfter: Math.ceil((existing.expiresAt - now) / 1000),
                ticketId
            });
            return;
        }
    }

    // Acquire lock
    activeSessions.set(lockKey, {
        lockedAt: now,
        expiresAt: now + LOCK_TIMEOUT_MS,
        ticketId,
        sessionId
    });

    // Release lock when response finishes
    res.on('finish', () => {
        // Check if this specific request still holds the lock
        const current = activeSessions.get(lockKey);
        if (current?.sessionId === sessionId) {
            activeSessions.delete(lockKey);
        }
    });

    // Also release on error
    res.on('close', () => {
        const current = activeSessions.get(lockKey);
        if (current?.sessionId === sessionId && res.statusCode >= 400) {
            activeSessions.delete(lockKey);
        }
    });

    next();
}
