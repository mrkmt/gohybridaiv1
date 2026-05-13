/**
 * AuditLogService
 *
 * Query and manage the audit_logs table.
 * Provides per-user activity feeds, ticket-level trace, and dashboard stats.
 */

import { DbClient } from './TelemetryService';

export interface AuditLog {
    id: number;
    user_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    details: Record<string, unknown>;
    ip_address: string;
    user_agent: string;
    created_at: string;
}

export interface DashboardStats {
    totalUsers: number;
    activeUsers: number;
    totalSessions: number;
    totalTestCases: number;
    recentActivity: AuditLog[];
}

export class AuditLogService {
    private static pool: DbClient | null = null;

    static setPool(dbPool: DbClient): void {
        this.pool = dbPool;
    }

    static async log(params: {
        userId: string;
        action: string;
        resourceType?: string;
        resourceId?: string;
        details?: Record<string, unknown>;
        ipAddress?: string;
        userAgent?: string;
    }): Promise<void> {
        if (!this.pool) throw new Error('DB pool not set');
        await this.pool.query(
            `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                params.userId,
                params.action,
                params.resourceType || null,
                params.resourceId || null,
                params.details ? JSON.stringify(params.details) : null,
                params.ipAddress || null,
                params.userAgent || null
            ]
        );
    }

    static async getByUser(userId: string, limit = 50, offset = 0): Promise<AuditLog[]> {
        if (!this.pool) throw new Error('DB pool not set');
        const { rows } = await this.pool.query(
            `SELECT id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at
             FROM audit_logs WHERE user_id = $1
             ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
        );
        return rows as AuditLog[];
    }

    static async getByTicket(ticketId: string, limit = 100): Promise<AuditLog[]> {
        if (!this.pool) throw new Error('DB pool not set');
        const { rows } = await this.pool.query(
            `SELECT id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at
             FROM audit_logs WHERE resource_type = 'test_session' AND resource_id = $1
             ORDER BY created_at DESC LIMIT $2`,
            [ticketId, limit]
        );
        return rows as AuditLog[];
    }

    static async getByAction(action: string, limit = 50): Promise<AuditLog[]> {
        if (!this.pool) throw new Error('DB pool not set');
        const { rows } = await this.pool.query(
            `SELECT id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at
             FROM audit_logs WHERE action = $1
             ORDER BY created_at DESC LIMIT $2`,
            [action, limit]
        );
        return rows as AuditLog[];
    }

    static async getRecentActivity(limit = 20): Promise<AuditLog[]> {
        if (!this.pool) throw new Error('DB pool not set');
        const { rows } = await this.pool.query(
            `SELECT id, user_id, action, resource_type, resource_id, details, ip_address, user_agent, created_at
             FROM audit_logs ORDER BY created_at DESC LIMIT $1`,
            [limit]
        );
        return rows as AuditLog[];
    }

    static async getDashboardStats(): Promise<DashboardStats> {
        if (!this.pool) throw new Error('DB pool not set');

        const usersStat = await this.pool.query(
            `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active = true) as active FROM users`
        );
        const sessionsStat = await this.pool.query(
            `SELECT COUNT(*) as total, COALESCE(SUM(jsonb_array_length(test_cases)), 0) as cases FROM test_sessions`
        );
        const recent = await this.getRecentActivity(10);

        return {
            totalUsers: parseInt(usersStat.rows[0].total),
            activeUsers: parseInt(usersStat.rows[0].active),
            totalSessions: parseInt(sessionsStat.rows[0].total),
            totalTestCases: parseInt(sessionsStat.rows[0].cases),
            recentActivity: recent
        };
    }
}
