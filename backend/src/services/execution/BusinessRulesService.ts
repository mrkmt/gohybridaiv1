/**
 * BusinessRulesService
 *
 * PostgreSQL-backed business rules store. Replaces file-based business_logic_matrix.json.
 */

import { DbClient } from '../shared/TelemetryService';

export interface BusinessRule {
    id: string;
    module: string;
    subModule?: string;
    keywords?: string[];
    formulaRule?: string;
    expectedUIBehavior?: string;
    confidenceScore?: number;
    status?: string;
    jiraId?: string;
    createdAt?: string;
    updatedAt?: string;
}

function rowToRule(row: any): BusinessRule {
    return {
        id: row.id,
        module: row.module,
        subModule: row.sub_module,
        keywords: Array.isArray(row.keywords) ? row.keywords : undefined,
        formulaRule: row.formula_rule,
        expectedUIBehavior: row.expected_ui_behavior,
        confidenceScore: row.confidence_score ? Number(row.confidence_score) : undefined,
        status: row.status,
        jiraId: row.jira_id,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    };
}

export class BusinessRulesService {
    private static readonly COLUMNS = 'id, module, sub_module, keywords, formula_rule, expected_ui_behavior, confidence_score, status, jira_id, created_at, updated_at';

    // --- Main business_rules table (active rules) ---

    static async getPaginated(pool: DbClient, limit: number, offset: number): Promise<BusinessRule[]> {
        const { rows } = await pool.query(
            `SELECT ${this.COLUMNS} FROM business_rules ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return rows.map(rowToRule);
    }

    static async getCount(pool: DbClient): Promise<number> {
        const { rows } = await pool.query('SELECT COUNT(*) FROM business_rules');
        return parseInt(rows[0].count);
    }

    static async getAll(pool: DbClient): Promise<BusinessRule[]> {
        const { rows } = await pool.query(
            `SELECT ${this.COLUMNS} FROM business_rules ORDER BY created_at DESC`
        );
        return rows.map(rowToRule);
    }

    static async findById(pool: DbClient, id: string): Promise<BusinessRule | null> {
        const { rows } = await pool.query(
            `SELECT ${this.COLUMNS} FROM business_rules WHERE id = $1`,
            [id]
        );
        return rows.length > 0 ? rowToRule(rows[0]) : null;
    }

    static async create(pool: DbClient, rule: Omit<BusinessRule, 'createdAt' | 'updatedAt'>): Promise<void> {
        await pool.query(
            `INSERT INTO business_rules (id, module, sub_module, keywords, formula_rule, expected_ui_behavior, confidence_score, status, jira_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (id) DO UPDATE SET
                 module = EXCLUDED.module,
                 sub_module = EXCLUDED.sub_module,
                 keywords = EXCLUDED.keywords,
                 formula_rule = EXCLUDED.formula_rule,
                 expected_ui_behavior = EXCLUDED.expected_ui_behavior,
                 confidence_score = EXCLUDED.confidence_score,
                 status = EXCLUDED.status,
                 updated_at = NOW()`,
            [
                rule.id,
                rule.module,
                rule.subModule ?? null,
                rule.keywords ?? null,
                rule.formulaRule ?? null,
                rule.expectedUIBehavior ?? null,
                rule.confidenceScore ?? null,
                rule.status ?? null,
                rule.jiraId ?? null,
            ]
        );
    }

    static async updateStatus(pool: DbClient, id: string, status: string): Promise<void> {
        await pool.query(
            'UPDATE business_rules SET status = $1, updated_at = NOW() WHERE id = $2',
            [status, id]
        );
    }

    static async searchByKeywords(pool: DbClient, keywords: string[]): Promise<BusinessRule[]> {
        if (!keywords || keywords.length === 0) return [];

        // Find rules where at least one keyword overlaps
        const { rows } = await pool.query(
            `SELECT * FROM business_rules
             WHERE keywords && $1
             ORDER BY confidence_score DESC
             LIMIT 5`,
            [keywords]
        );
        return rows.map(rowToRule);
    }

    static async searchByText(pool: DbClient, text: string): Promise<BusinessRule[]> {
        if (!text || text.trim().length === 0) return [];

        // Text search against module, formula_rule, expected_ui_behavior
        const searchPattern = `%${text}%`;
        const { rows } = await pool.query(
            `SELECT * FROM business_rules
             WHERE module ILIKE $1
                OR formula_rule ILIKE $1
                OR expected_ui_behavior ILIKE $1
             ORDER BY confidence_score DESC
             LIMIT 10`,
            [searchPattern]
        );
        return rows.map(rowToRule);
    }

    // --- Staging rules (staging table) ---

    static async getStagingRules(pool: DbClient): Promise<BusinessRule[]> {
        const { rows } = await pool.query(
            'SELECT * FROM staging_rules ORDER BY created_at DESC'
        );
        return rows.map(rowToRule);
    }

    static async findStagingRule(pool: DbClient, id: string): Promise<BusinessRule | null> {
        const { rows } = await pool.query(
            'SELECT * FROM staging_rules WHERE id = $1',
            [id]
        );
        return rows.length > 0 ? rowToRule(rows[0]) : null;
    }

    static async createStagingRule(pool: DbClient, rule: Omit<BusinessRule, 'createdAt' | 'updatedAt'>): Promise<void> {
        await pool.query(
            `INSERT INTO staging_rules (id, module, sub_module, keywords, formula_rule, expected_ui_behavior, confidence_score, status, jira_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'staging', $9)`,
            [
                rule.id,
                rule.module,
                rule.subModule ?? null,
                rule.keywords ?? null,
                rule.formulaRule ?? null,
                rule.expectedUIBehavior ?? null,
                rule.confidenceScore ?? null,
            ]
        );
    }

    static async deleteStagingRule(pool: DbClient, id: string): Promise<void> {
        await pool.query(
            'DELETE FROM staging_rules WHERE id = $1',
            [id]
        );
    }

    static async searchByModule(pool: DbClient, module: string): Promise<BusinessRule[]> {
        const searchPattern = `%${module}%`;
        const { rows } = await pool.query(
            `SELECT * FROM staging_rules
             WHERE module ILIKE $1
             ORDER BY created_at DESC`,
            [searchPattern]
        );
        return rows.map(rowToRule);
    }

    /**
     * Update confidence scores based on test results.
     * Passing tests that exercise a rule increase confidence; failing tests decrease it.
     * Simple formula: pass => +2, fail => -5, clamped to [0, 100].
     */
    static async updateConfidenceFromTestResults(
        pool: DbClient,
        module: string,
        summary: {
            total: number;
            passed: number;
            failed: number;
        }
    ): Promise<{ updatedRules: number }> {
        if (summary.total === 0) return { updatedRules: 0 };

        // Find all rules for this module
        const searchPattern = `%${module}%`;
        const { rows } = await pool.query(
            `SELECT * FROM business_rules
             WHERE module ILIKE $1`,
            [searchPattern]
        );

        const passRate = summary.total > 0 ? summary.passed / summary.total : 0;
        const netConfidenceDelta = Math.round((passRate - 0.5) * 10); // [-50, +50]

        if (rows.length === 0) return { updatedRules: 0 };

        let updatedCount = 0;
        for (const row of rows) {
            const current = row.confidence_score ? Number(row.confidence_score) : 50;

            // Per-rule: pass-heavy test run increases confidence modestly
            const passBoost = Math.round(passRate * 5);     // +0..+5 based on pass rate
            const failPenalty = summary.failed > 0 ? -3 : 0;
            const newScore = Math.max(0, Math.min(100, current + passBoost + failPenalty));

            if (Math.abs(newScore - current) >= 1) {
                await pool.query(
                    `UPDATE business_rules
                     SET confidence_score = $1, updated_at = NOW()
                     WHERE id = $2 AND confidence_score IS DISTINCT FROM $1`,
                    [newScore, row.id]
                );
                updatedCount++;
            }
        }

        return { updatedRules: updatedCount };
    }
}
