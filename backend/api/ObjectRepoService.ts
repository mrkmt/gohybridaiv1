import { DbClient } from './app';

export interface UIObject {
    id: string;
    name: string;
    selector_primary: string;
    selector_fallbacks: string[];
    app_profile: string;
    reliability_score: number;
}

export class ObjectRepoService {
    /**
     * Ensures an object exists in the repository. 
     * If selector exists, returns ID. If new, creates it.
     */
    static async ensureObject(pool: DbClient, data: {
        selector: string,
        name?: string,
        appProfile?: string
    }): Promise<string> {
        const { selector, name, appProfile = 'default' } = data;
        const slug = selector.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 50);
        const objectId = `obj-${slug}`;

        // 1. Check if selector already exists
        const existing = await pool.query(
            'SELECT id FROM object_repository WHERE selector_primary = $1 AND app_profile = $2',
            [selector, appProfile]
        );

        if (existing.rows.length > 0) {
            return existing.rows[0].id;
        }

        // 2. Create new object if not found
        const finalName = name || `Auto-${slug}`;
        await pool.query(
            `INSERT INTO object_repository (id, name, selector_primary, app_profile) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
            [objectId, finalName, selector, appProfile]
        );

        console.log(`[ObjectRepo] Auto-discovered new object: ${finalName} (${objectId})`);
        return objectId;
    }

    /**
     * Retrieves an object by ID for playback.
     */
    static async getObject(pool: DbClient, id: string): Promise<UIObject | null> {
        const { rows } = await pool.query('SELECT * FROM object_repository WHERE id = $1', [id]);
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Updates object reliability after a successful/failed playback.
     */
    static async updateReliability(pool: DbClient, id: string, success: boolean): Promise<void> {
        const adjustment = success ? 0.05 : -0.1;
        await pool.query(
            `UPDATE object_repository 
             SET reliability_score = GREATEST(0, LEAST(1.0, reliability_score + $1)), 
                 last_verified_at = CURRENT_TIMESTAMP 
             WHERE id = $2`,
            [adjustment, id]
        );
    }
}
