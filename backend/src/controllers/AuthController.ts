/**
 * AuthController
 *
 * Handles login, registration, profile, and user management.
 */

import { Request, Response } from 'express';
import { AuthService } from '../services/shared/AuthService';
import { v4 as uuidv4 } from 'uuid';
import { DbClient } from '../services/shared/TelemetryService';

export class AuthController {
    /**
     * POST /api/auth/login
     */
    static async login(req: Request, res: Response): Promise<void> {
        try {
            const { identifier, password } = req.body;

            if (!identifier || !password) {
                res.status(400).json({ error: 'identifier and password are required' });
                return;
            }

            const result = await AuthService.login(identifier, password);

            res.json({
                success: true,
                token: result.token,
                user: result.user
            });
        } catch (error: any) {
            const status = error.message.includes('Invalid') || error.message.includes('disabled')
                ? 401
                : 500;
            res.status(status).json({ error: error.message });
        }
    }

    /**
     * POST /api/auth/register
     */
    static async register(req: Request, res: Response): Promise<void> {
        try {
            const { id, email, password, displayName, role } = req.body;
            const userId = id || uuidv4();

            const user = await AuthService.register({
                id: userId,
                email,
                password,
                displayName,
                role: role || 'tester'
            });

            res.status(201).json({
                success: true,
                user: {
                    id: user.id,
                    email: user.email,
                    display_name: user.display_name,
                    role: user.role,
                    is_active: user.is_active
                }
            });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * POST /api/auth/logout
     * (Client-side token removal is sufficient for JWT; this is a no-op server-side)
     */
    static async logout(_req: Request, res: Response): Promise<void> {
        res.json({ success: true, message: 'Logged out successfully. Remove token from client.' });
    }

    /**
     * GET /api/auth/me
     */
    static async me(req: Request, res: Response): Promise<void> {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }

            const user = await AuthService.getUserById(userId);
            if (!user) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            res.json({ success: true, user });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * GET /api/auth/users (admin only)
     */
    static async listUsers(_req: Request, res: Response): Promise<void> {
        try {
            const users = await AuthService.listUsers();
            res.json({ success: true, users });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * PUT /api/auth/users/:id/role (admin only)
     */
    static async updateUserRole(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { role } = req.body;

            if (!role) {
                res.status(400).json({ error: 'role is required' });
                return;
            }

            const user = await AuthService.updateUserRole(id, role);
            res.json({ success: true, user });
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    /**
     * PUT /api/auth/users/:id/active (admin only)
     */
    static async toggleUserActive(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const { is_active } = req.body;

            if (typeof is_active !== 'boolean') {
                res.status(400).json({ error: 'is_active (boolean) is required' });
                return;
            }

            await AuthService.toggleUserActive(id, is_active);
            res.json({ success: true, message: `User ${is_active ? 'activated' : 'disabled'}` });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}
