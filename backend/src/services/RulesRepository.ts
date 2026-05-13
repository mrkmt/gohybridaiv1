import { DbClient, TelemetryService } from './shared/TelemetryService';

export interface Rule {
    id?: number;
    module_name: string;
    description?: string;
    keywords: string[];
    mandatory_fields: {
        name: string;
        label: string;
        type: string;
        required: boolean;
        selector?: string;
        validation?: string;
    }[];
    navigation_id?: string;
    created_at?: Date;
    updated_at?: Date;
}

export class RulesRepository {
    private static readonly COLUMNS = 'id, module_name, description, keywords, mandatory_fields, navigation_id, created_at, updated_at';

    private static getPool(): DbClient {
        const pool = TelemetryService.getPool();
        if (!pool) throw new Error('[RulesRepository] DB Pool not initialized');
        return pool;
    }

    /**
     * Fetch a rule by exact module name
     */
    static async getRuleByModule(moduleName: string): Promise<Rule | null> {
        const query = `SELECT ${this.COLUMNS} FROM rules WHERE module_name = $1`;
        const { rows } = await this.getPool().query(query, [moduleName]);
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Fetch a rule by searching keywords or partial module name
     */
    static async getRuleByKeyword(keyword: string): Promise<Rule | null> {
        const query = `
            SELECT ${this.COLUMNS} FROM rules 
            WHERE keywords @> $1::jsonb 
               OR module_name ILIKE $2
            LIMIT 1
        `;
        const { rows } = await this.getPool().query(query, [
            JSON.stringify([keyword]), 
            `%${keyword}%`
        ]);
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Create or update a rule
     */
    static async saveRule(rule: Rule): Promise<void> {
        const query = `
            INSERT INTO rules (module_name, description, keywords, mandatory_fields, navigation_id, updated_at)
            VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
            ON CONFLICT (module_name) DO UPDATE SET
                description = EXCLUDED.description,
                keywords = EXCLUDED.keywords,
                mandatory_fields = EXCLUDED.mandatory_fields,
                navigation_id = EXCLUDED.navigation_id,
                updated_at = CURRENT_TIMESTAMP
        `;
        await this.getPool().query(query, [
            rule.module_name,
            rule.description || null,
            JSON.stringify(rule.keywords || []),
            JSON.stringify(rule.mandatory_fields || []),
            rule.navigation_id || null
        ]);
    }

    /**
     * Fetch all available rules
     */
    static async getAllRules(): Promise<Rule[]> {
        const { rows } = await this.getPool().query(`SELECT ${this.COLUMNS} FROM rules ORDER BY module_name ASC`);
        return rows;
    }

    /**
     * Delete a rule by module name
     */
    static async deleteRule(moduleName: string): Promise<void> {
        await this.getPool().query('DELETE FROM rules WHERE module_name = $1', [moduleName]);
    }
}
