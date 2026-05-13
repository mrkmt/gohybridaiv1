/**
 * Per-user API Key Authentication Middleware
 *
 * Replaces the single shared API_KEY with per-user keys stored in the api_keys table.
 * Each key maps to a specific user ID, so sessions are properly isolated.
 *
 * Usage: x-api-key: ghk_abc123... header → resolves to req.user = { id, role }
 */

import { DbClient } from '../../src/services/shared/TelemetryService';
import { errorResponse, unauthorizedError, internalError } from '../utils/responseHelpers';

export interface ApiKeyAuthDeps {
    pool: DbClient;
}

let pool: DbClient | null = null;

export function setApiKeysPool(dbPool: DbClient): void {
    pool = dbPool;
}

/**
 * Validate API key from x-api-key header.
 * If valid, sets req.user from the key's owner.
 * If invalid/missing, sends 401 and returns false.
 */
export async function requireApiKeyAuth(req: any, res: any): Promise<boolean> {
    if (!pool) {
        internalError(res, 'Auth service not initialized');
        return false;
    }

    const provided = req.headers['x-api-key'];
    if (typeof provided !== 'string') {
        unauthorizedError(res, 'Missing API key (x-api-key header)');
        return false;
    }

    try {
        const { AuthService } = await import('../../src/services/AuthService');
        AuthService.setPool(pool);
        const user = await AuthService.validateApiKey(provided);

        if (!user) {
            errorResponse(res, 401, 'API_KEY_INVALID', 'Invalid or revoked API key');
            return false;
        }

        req.user = { id: user.id, email: user.email, role: user.role };
        return true;
    } catch {
        internalError(res, 'API key validation failed');
        return false;
    }
}
