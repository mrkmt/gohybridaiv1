/**
 * Auth Routes
 *
 * /api/auth/login, /register, /me, /users, etc.
 */

import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { requireAuth, requireRoles } from '../../api/middleware/authMiddleware';
import { AuthService } from '../services/shared/AuthService';
import { successResponse, errorResponse, notFoundError, internalError } from '../../api/utils/responseHelpers';

const router = Router();

// Public routes
router.post('/login', AuthController.login);
router.post('/register', requireAuth, requireRoles('admin'), AuthController.register);
router.post('/logout', requireAuth, AuthController.logout);
router.get('/me', requireAuth, AuthController.me);

// Admin-only routes
router.get('/users', requireAuth, requireRoles('admin'), AuthController.listUsers);
router.put('/users/:id/role', requireAuth, requireRoles('admin'), AuthController.updateUserRole);
router.put('/users/:id/active', requireAuth, requireRoles('admin'), AuthController.toggleUserActive);

// API Key Management (authenticated users can manage their own keys)

/**
 * POST /api/auth/api-keys/generate
 * Generate a new API key for the current user.
 * Admin can generate keys for any user via body.userId.
 * Returns the raw key ONCE — store it immediately.
 */
router.post('/api-keys/generate', requireAuth, async (req: any, res) => {
    try {
        const isAdmin = req.user?.role === 'admin';
        const targetUserId = isAdmin && req.body?.userId ? req.body.userId : req.user.id;

        const result = await AuthService.generateApiKey(targetUserId, req.body.displayName);
        if (!result) {
            return notFoundError(res, 'User');
        }

        successResponse(res, {
            keyId: result.keyId,
            apiKey: result.key,
            warning: 'Store this key immediately — it will not be shown again.',
            header: 'Use with: x-api-key: <key>'
        });
    } catch (e: any) {
        internalError(res, e.message);
    }
});

/**
 * GET /api/auth/api-keys
 * List active API keys for the current user.
 */
router.get('/api-keys', requireAuth, async (req: any, res) => {
    try {
        const keys = await AuthService.listApiKeys(req.user.id);
        successResponse(res, { keys });
    } catch (e: any) {
        internalError(res, e.message);
    }
});

/**
 * POST /api/auth/api-keys/:id/revoke
 * Revoke an API key (user can only revoke their own)
 */
router.post('/api-keys/:id/revoke', requireAuth, async (req: any, res) => {
    try {
        const revoked = await AuthService.revokeApiKey(parseInt(req.params.id), req.user.id);
        if (!revoked) {
            return errorResponse(res, 404, 'NOT_FOUND', 'Key not found or not yours');
        }
        successResponse(res, { message: 'API key revoked' });
    } catch (e: any) {
        internalError(res, e.message);
    }
});

export { router as authRouter };
