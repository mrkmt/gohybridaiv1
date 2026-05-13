/**
 * TestVersionService
 * 
 * Manages test script version history for audit trail and rollback
 * Stores versions in PostgreSQL with artifact metadata
 * 
 * @author Qwen AI Assistant
 * @date March 29, 2026
 */

import { Pool } from 'pg';

export interface TestVersion {
    id: number;
    ticketId: string;
    caseId: string;
    version: number;
    scriptContent: string;
    artifacts: {
        screenshots?: string[];
        videos?: string[];
        traces?: string[];
    };
    status: 'PASS' | 'FAIL' | 'HEALED';
    baselineScreenshot?: string;
    executionTimeMs?: number;
    errorMessage?: string;
    createdAt: Date;
}

export interface VisualBaseline {
    id: number;
    ticketId: string;
    caseId: string;
    stepNumber: number;
    baselinePath: string;
    baselineHash: string;
    createdAt: Date;
    updatedAt: Date;
}

export class TestVersionService {
    private static pool: Pool;
    private static readonly COLUMNS = 'id, ticket_id, case_id, version, script_content, artifacts, status, baseline_screenshot, execution_time_ms, error_message, created_at';
    private static readonly BASELINE_COLUMNS = 'id, ticket_id, case_id, step_number, baseline_path, baseline_hash, created_at, updated_at';

    private static getPool(): Pool {
        if (!this.pool) {
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL
            });
        }
        return this.pool;
    }

    /**
     * Save a new test version
     */
    static async saveVersion(params: {
        ticketId: string;
        caseId: string;
        scriptContent: string;
        artifacts: TestVersion['artifacts'];
        status: TestVersion['status'];
        baselineScreenshot?: string;
        executionTimeMs?: number;
        errorMessage?: string;
    }): Promise<TestVersion> {
        const client = await this.getPool().connect();
        
        try {
            await client.query('BEGIN');

            // Get the latest version number
            const versionResult = await client.query(
                `SELECT COALESCE(MAX(version), 0) as max_version 
                 FROM test_versions 
                 WHERE ticket_id = $1 AND case_id = $2`,
                [params.ticketId, params.caseId]
            );

            const nextVersion = (versionResult.rows[0].max_version as number) + 1;

            // Insert new version
            const result = await client.query(
                `INSERT INTO test_versions (
                    ticket_id, case_id, version, script_content, 
                    artifacts, status, baseline_screenshot, 
                    execution_time_ms, error_message
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING ${this.COLUMNS}`,
                [
                    params.ticketId,
                    params.caseId,
                    nextVersion,
                    params.scriptContent,
                    JSON.stringify(params.artifacts),
                    params.status,
                    params.baselineScreenshot,
                    params.executionTimeMs,
                    params.errorMessage
                ]
            );

            await client.query('COMMIT');

            return this.mapRowToVersion(result.rows[0]);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Get version history for a test case
     */
    static async getVersionHistory(
        ticketId: string,
        caseId: string
    ): Promise<TestVersion[]> {
        const result = await this.getPool().query(
            `SELECT ${this.COLUMNS} FROM test_versions 
             WHERE ticket_id = $1 AND case_id = $2 
             ORDER BY version DESC`,
            [ticketId, caseId]
        );

        return result.rows.map((row) => this.mapRowToVersion(row));
    }

    /**
     * Get a specific version
     */
    static async getVersion(
        ticketId: string,
        caseId: string,
        version: number
    ): Promise<TestVersion | null> {
        const result = await this.getPool().query(
            `SELECT ${this.COLUMNS} FROM test_versions 
             WHERE ticket_id = $1 AND case_id = $2 AND version = $3`,
            [ticketId, caseId, version]
        );

        if (result.rows.length === 0) return null;
        return this.mapRowToVersion(result.rows[0]);
    }

    /**
     * Get the latest passing version for baseline
     */
    static async getLatestBaseline(
        ticketId: string,
        caseId: string
    ): Promise<TestVersion | null> {
        const result = await this.getPool().query(
            `SELECT ${this.COLUMNS} FROM test_versions 
             WHERE ticket_id = $1 AND case_id = $2 AND status = 'PASS'
             ORDER BY version DESC 
             LIMIT 1`,
            [ticketId, caseId]
        );

        if (result.rows.length === 0) return null;
        return this.mapRowToVersion(result.rows[0]);
    }

    /**
     * Save visual baseline screenshot
     */
    static async saveVisualBaseline(params: {
        ticketId: string;
        caseId: string;
        stepNumber: number;
        baselinePath: string;
        baselineHash: string;
    }): Promise<VisualBaseline> {
        const result = await this.getPool().query(
            `INSERT INTO visual_baselines (
                ticket_id, case_id, step_number, 
                baseline_path, baseline_hash
            ) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (ticket_id, case_id, step_number) 
            DO UPDATE SET 
                baseline_path = EXCLUDED.baseline_path,
                baseline_hash = EXCLUDED.baseline_hash,
                updated_at = NOW()
            RETURNING ${this.BASELINE_COLUMNS}`,
            [
                params.ticketId,
                params.caseId,
                params.stepNumber,
                params.baselinePath,
                params.baselineHash
            ]
        );

        return this.mapRowToBaseline(result.rows[0]);
    }

    /**
     * Get visual baseline for a step
     */
    static async getVisualBaseline(
        ticketId: string,
        caseId: string,
        stepNumber: number
    ): Promise<VisualBaseline | null> {
        const result = await this.getPool().query(
            `SELECT ${this.BASELINE_COLUMNS} FROM visual_baselines 
             WHERE ticket_id = $1 AND case_id = $2 AND step_number = $3`,
            [ticketId, caseId, stepNumber]
        );

        if (result.rows.length === 0) return null;
        return this.mapRowToBaseline(result.rows[0]);
    }

    /**
     * Delete old versions (cleanup)
     */
    static async deleteOldVersions(
        ticketId: string,
        caseId: string,
        keepLast: number = 10
    ): Promise<number> {
        const result = await this.getPool().query(
            `DELETE FROM test_versions 
             WHERE ticket_id = $1 AND case_id = $2 
             AND version NOT IN (
                 SELECT version FROM test_versions 
                 WHERE ticket_id = $1 AND case_id = $2 
                 ORDER BY version DESC 
                 LIMIT $3
             )`,
            [ticketId, caseId, keepLast]
        );

        return result.rowCount || 0;
    }

    private static mapRowToVersion(row: any): TestVersion {
        return {
            id: row.id,
            ticketId: row.ticket_id,
            caseId: row.case_id,
            version: row.version,
            scriptContent: row.script_content,
            artifacts: row.artifacts || {},
            status: row.status,
            baselineScreenshot: row.baseline_screenshot,
            executionTimeMs: row.execution_time_ms,
            errorMessage: row.error_message,
            createdAt: new Date(row.created_at)
        };
    }

    private static mapRowToBaseline(row: any): VisualBaseline {
        return {
            id: row.id,
            ticketId: row.ticket_id,
            caseId: row.case_id,
            stepNumber: row.step_number,
            baselinePath: row.baseline_path,
            baselineHash: row.baseline_hash,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        };
    }
}

export default TestVersionService;
