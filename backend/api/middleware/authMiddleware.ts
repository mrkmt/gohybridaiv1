/**
 * Auth Middleware
 *
 * JWT verification and audit logging for Express routes.
 */

import jwt from 'jsonwebtoken';
import { config } from '../config';
import { DbClient } from '../../src/services/shared/TelemetryService';
import { errorResponse, unauthorizedError, forbiddenError } from '../utils/responseHelpers';

const JWT_SECRET = config.server.jwtSecret;

export interface AuthUser {
    id: string;
    email?: string;
    role: string;
}

declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

/**
 * Verify JWT from Authorization header.
 * Sets req.user if valid. Does NOT reject if missing — use requireAuth for that.
 */
export function optionalAuth(req: any, _res: any, next: any): void {
    const authHeader = req.headers.authorization;
    if (!authHeader) return next();

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
        req.user = decoded;
    } catch {
        // Invalid token — leave req.user undefined
    }
    next();
}

/**
 * Require valid JWT — reject with 401 if missing or invalid.
 */
export function requireAuth(req: any, res: any, next: any): void {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        unauthorizedError(res, 'Authentication required');
        return;
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
        req.user = decoded;
        next();
    } catch (err: any) {
        const code = err.name === 'TokenExpiredError' ? 'AUTH_EXPIRED' : 'AUTH_INVALID';
        errorResponse(res, 401, code, 'Invalid or expired token');
        return;
    }
}

/**
 * Require specific roles. Used after requireAuth.
 */
export function requireRoles(...allowedRoles: string[]) {
    return (req: any, res: any, next: any): void => {
        if (!req.user) {
            unauthorizedError(res, 'Authentication required');
            return;
        }
        if (!allowedRoles.includes(req.user.role)) {
            forbiddenError(res, `Requires role: ${allowedRoles.join(' or ')}`);
            return;
        }
        next();
    };
}

/**
 * Create an audit log middleware factory.
 * Call this after the route handler completes.
 */
export function logAudit(
    pool: DbClient,
    action: string,
    resourceType: string,
    resourceIdFn?: (req: any) => string
) {
    return async (req: any, res: any, next: any): Promise<void> => {
        const originalSend = res.json.bind(res);
        res.json = function (body: any) {
            const userId = req.user?.id || 'anonymous';
            const resourceId = resourceIdFn ? resourceIdFn(req) : undefined;
            pool.query(
                `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    userId,
                    action,
                    resourceType,
                    resourceId || null,
                    JSON.stringify({ status: res.statusCode, success: body?.success }),
                    req.ip || req.connection?.remoteAddress,
                    req.headers['user-agent']
                ]
            ).catch(() => {});

            return originalSend(body);
        };
        next();
    };
}

/**
 * Helper: log an audit entry directly (used by services/controllers).
 */
export async function writeAuditLog(
    pool: DbClient,
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string | undefined,
    details: Record<string, unknown> = {}
): Promise<void> {
    pool.query(
        `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, action, resourceType, resourceId || null, JSON.stringify(details)]
    ).catch(() => {});
}
