/**
 * AuthService
 *
 * User authentication with bcrypt password hashing and JWT tokens.
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../../../api/config';
import { DbClient } from './TelemetryService';
import { randomBytes, createHash } from 'crypto';

export interface User {
    id: string;
    owner_id?: string;
    display_name?: string;
    email?: string;
    role: string;
    is_active: boolean;
    last_login_at?: string;
    created_at?: string;
}

export interface AuthResult {
    user: Omit<User, 'password_hash'>;
    token: string;
}

const JWT_SECRET = config.server.jwtSecret;
const BCRYPT_ROUNDS = 12;

export class AuthService {
    private static pool: DbClient | null = null;

    static setPool(dbPool: DbClient): void {
        this.pool = dbPool;
    }

    /**
     * Register a new user
     */
    static async register(params: {
        id: string;
        email?: string;
        password: string;
        displayName?: string;
        role?: 'admin' | 'manager' | 'tester' | 'viewer';
        ownerId?: string;
    }): Promise<User> {
        if (!this.pool) throw new Error('AuthService: DB pool not set. Call setPool() first.');
        if (!params.password || params.password.length < 6) {
            throw new Error('Password must be at least 6 characters');
        }

        const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);
        const id = params.id;

        await this.pool.query(
            `INSERT INTO users (id, email, password_hash, display_name, role, owner_id, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true)
             ON CONFLICT (id) DO NOTHING`,
            [id, params.email || null, passwordHash, params.displayName || null, params.role || 'tester', params.ownerId || null]
        );

        const newUser = await this.getUserById(id);
        if (!newUser) throw new Error('Failed to create user');
        return newUser;
    }

    /**
     * Login with email (or ID) and password
     */
    static async login(identifier: string, password: string): Promise<AuthResult> {
        if (!this.pool) throw new Error('AuthService: DB pool not set.');

        // If identifier is a valid UUID, use it as id; otherwise treat as email
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
        const column = isUUID ? 'id' : 'email';

        const { rows } = await this.pool.query(
            `SELECT id, owner_id, display_name, email, password_hash, role, is_active, last_login_at
             FROM users WHERE ${column} = $1`,
            [identifier]
        );

        if (rows.length === 0) {
            throw new Error(`Invalid ${column === 'email' ? 'email' : 'user ID'}`);
        }

        const user = rows[0];

        if (!user.is_active) {
            throw new Error('Account is disabled. Contact your administrator.');
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            throw new Error('Invalid password');
        }

        // Update last login time
        await this.pool.query(
            `UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [user.id]
        );

        const token = this.signJwt(user.id, user.email, user.role);

        const { password_hash: _, ...safeUser } = user;
        return {
            user: safeUser as User,
            token
        };
    }

    /**
     * Verify a JWT token and return the user
     */
    static async verifyToken(token: string): Promise<User | null> {
        if (!this.pool) throw new Error('AuthService: DB pool not set.');

        try {
            const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; role: string; email?: string };
            const user = await this.getUserById(decoded.sub);

            if (!user || !user.is_active) return null;
            return user;
        } catch {
            return null;
        }
    }

    /**
     * Sign a JWT
     */
    static signJwt(userId: string, email?: string, role?: string): string {
        return jwt.sign(
            { sub: userId, id: userId, email, role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
    }

    /**
     * Hash a password (for admin user creation)
     */
    static async hashPassword(plain: string): Promise<string> {
        return bcrypt.hash(plain, BCRYPT_ROUNDS);
    }

    /**
     * Check a password against a hash
     */
    static async checkPassword(plain: string, hash: string): Promise<boolean> {
        return bcrypt.compare(plain, hash);
    }

    /**
     * Get user by ID
     */
    static async getUserById(id: string): Promise<User | null> {
        if (!this.pool) throw new Error('AuthService: DB pool not set.');

        const { rows } = await this.pool.query(
            `SELECT id, owner_id, display_name, email, role, is_active, last_login_at, created_at
             FROM users WHERE id = $1`,
            [id]
        );

        return rows.length > 0 ? rows[0] as User : null;
    }

    /**
     * Get user by email
     */
    static async getUserByEmail(email: string): Promise<User | null> {
        if (!this.pool) throw new Error('AuthService: DB pool not set.');

        const { rows } = await this.pool.query(
            `SELECT id, owner_id, display_name, email, role, is_active, last_login_at, created_at
             FROM users WHERE email = $1`,
            [email]
        );

        return rows.length > 0 ? rows[0] as User : null;
    }

    /**
     * List all active users
     */
    static async listUsers(): Promise<User[]> {
        if (!this.pool) throw new Error('AuthService: DB pool not set.');

        const { rows } = await this.pool.query(
            `SELECT id, owner_id, display_name, email, role, is_active, last_login_at, created_at
             FROM users ORDER BY created_at DESC`
        );

        return rows as User[];
    }

    /**
     * Update user role (admin only)
     */
    static async updateUserRole(userId: string, newRole: string): Promise<User> {
        if (!this.pool) throw new Error('AuthService: DB pool not set.');

        const validRoles = ['admin', 'manager', 'tester', 'viewer'];
        if (!validRoles.includes(newRole)) {
            throw new Error(`Invalid role: ${newRole}. Must be one of: ${validRoles.join(', ')}`);
        }

        await this.pool.query(
            `UPDATE users SET role = $1 WHERE id = $2`,
            [newRole, userId]
        );

        const user = await this.getUserById(userId);
        if (!user) throw new Error('User not found');
        return user;
    }

    /**
     * Toggle user active status
     */
    static async toggleUserActive(userId: string, isActive: boolean): Promise<void> {
        if (!this.pool) throw new Error('AuthService: DB pool not set.');

        await this.pool.query(
            `UPDATE users SET is_active = $1 WHERE id = $2`,
            [isActive, userId]
        );
    }

    // ─── API Key Management ───

    /**
     * Generate a new API key for a user.
     * Returns the raw key (only shown once) and stores the hash.
     */
    static async generateApiKey(userId: string, displayName?: string): Promise<{ keyId: number; key: string } | null> {
        if (!this.pool) throw new Error('AuthService: DB pool not set.');

        const user = await this.getUserById(userId);
        if (!user || !user.is_active) return null;

        // Generate a secure random key: ghk_ prefix + 32 bytes hex
        const rawKey = `ghk_${randomBytes(32).toString('hex')}`;
        const keyHash = createHash('sha256').update(rawKey).digest('hex');

        const result = await this.pool.query(
            `INSERT INTO api_keys (user_id, key_hash, display_name)
             VALUES ($1, $2, $3) RETURNING id`,
            [userId, keyHash, displayName || `${user.display_name || user.email || userId}'s key`]
        );

        if (result.rows.length === 0) return null;

        return { keyId: result.rows[0].id, key: rawKey };
    }

    /**
     * Validate an API key and return the associated user.
     * Updates last_used_at on success.
     */
    static async validateApiKey(rawKey: string): Promise<User | null> {
        if (!this.pool) throw new Error('AuthService: DB pool not set.');

        const keyHash = createHash('sha256').update(rawKey).digest('hex');

        const result = await this.pool.query(
            `UPDATE api_keys
             SET last_used_at = CURRENT_TIMESTAMP
             WHERE key_hash = $1 AND active = true
             RETURNING user_id`,
            [keyHash]
        );

        if (result.rows.length === 0) return null;

        return this.getUserById(result.rows[0].user_id);
    }

    /**
     * Revoke an API key
     */
    static async revokeApiKey(keyId: number, userId: string): Promise<boolean> {
        if (!this.pool) throw new Error('AuthService: DB pool not set.');

        const result = await this.pool.query(
            `UPDATE api_keys SET active = false WHERE id = $1 AND user_id = $2 RETURNING id`,
            [keyId, userId]
        );
        return result.rows.length > 0;
    }

    /**
     * List active API keys for a user
     */
    static async listApiKeys(userId: string): Promise<Array<{ id: number; display_name: string; created_at: string; last_used_at: string; active: boolean }>> {
        if (!this.pool) throw new Error('AuthService: DB pool not set.');

        const result = await this.pool.query(
            `SELECT id, display_name, created_at, last_used_at, active
             FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
            [userId]
        );
        return result.rows;
    }
}
