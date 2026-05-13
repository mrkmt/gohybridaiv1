/**
 * JiraConfigService
 *
 * Reconstructed 2026-04-25 (original binary-corrupted).
 *
 * DB-backed per-user Jira configuration.
 * Table: jira_config (id, user_id, domain, email, api_token,
 *                     site_name, gt_project_key, gb_project_key, gd_project_key,
 *                     created_at, updated_at)
 */

import { Pool } from 'pg';
import { appLogger } from '../utils/logger';

export interface JiraConfigData {
    domain:       string;   // e.g. "mycompany.atlassian.net"
    email:        string;
    apiToken?:    string;   // optional: raw token (write) or masked (read)
    siteName?:    string;
    gtProjectKey: string;   // Testing (GT) space key
    gbProjectKey?: string;  // Backlog (GB) space key
    gdProjectKey?: string;  // Dev/Design (GD) space key
}

export interface MaskedJiraConfig {
    domain:       string;
    email:        string;
    apiToken:     string;   // always "********"
    hasToken:     boolean;
    siteName?:    string;
    gtProjectKey: string;
    gbProjectKey?: string;
    gdProjectKey?: string;
}

export class JiraConfigService {

    static async getMasked(userId: string, pool: Pool): Promise<MaskedJiraConfig | null> {
        try {
            const res = await pool.query<any>(
                `SELECT domain, email, api_token, site_name,
                        gt_project_key, gb_project_key, gd_project_key
                 FROM jira_config
                 WHERE user_id = $1
                 LIMIT 1`,
                [userId],
            );

            if (res.rows.length === 0) return null;

            const row = res.rows[0];
            return {
                domain:       row.domain       || '',
                email:        row.email        || '',
                apiToken:     '********',
                hasToken:     Boolean(row.api_token),
                siteName:     row.site_name    || undefined,
                gtProjectKey: row.gt_project_key || '',
                gbProjectKey: row.gb_project_key || undefined,
                gdProjectKey: row.gd_project_key || undefined,
            };
        } catch (err: any) {
            appLogger.error('[JiraConfigService] getMasked failed', { userId, err: err.message });
            return null;
        }
    }

    static async getRaw(userId: string, pool: Pool): Promise<(JiraConfigData & { hasToken: boolean }) | null> {
        try {
            const res = await pool.query<any>(
                `SELECT domain, email, api_token, site_name,
                        gt_project_key, gb_project_key, gd_project_key
                 FROM jira_config
                 WHERE user_id = $1
                 LIMIT 1`,
                [userId],
            );

            if (res.rows.length === 0) return null;

            const row = res.rows[0];
            return {
                domain:       row.domain        || '',
                email:        row.email         || '',
                apiToken:     row.api_token     || '',
                hasToken:     Boolean(row.api_token),
                siteName:     row.site_name     || undefined,
                gtProjectKey: row.gt_project_key || '',
                gbProjectKey: row.gb_project_key || undefined,
                gdProjectKey: row.gd_project_key || undefined,
            };
        } catch (err: any) {
            appLogger.error('[JiraConfigService] getRaw failed', { userId, err: err.message });
            return null;
        }
    }

    static async save(userId: string, data: JiraConfigData, pool: Pool): Promise<void> {
        const { domain, email, apiToken, siteName, gtProjectKey, gbProjectKey, gdProjectKey } = data;

        // If caller passes "********", preserve existing token — don't overwrite with the mask.
        const tokenClause = apiToken && apiToken !== '********'
            ? 'api_token = EXCLUDED.api_token,'
            : '';

        await pool.query(
            `INSERT INTO jira_config
                (user_id, domain, email, api_token, site_name, gt_project_key, gb_project_key, gd_project_key, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (user_id) DO UPDATE SET
                domain         = EXCLUDED.domain,
                email          = EXCLUDED.email,
                ${tokenClause}
                site_name      = EXCLUDED.site_name,
                gt_project_key = EXCLUDED.gt_project_key,
                gb_project_key = EXCLUDED.gb_project_key,
                gd_project_key = EXCLUDED.gd_project_key,
                updated_at     = NOW()`,
            [userId, domain, email, apiToken !== '********' ? apiToken : null,
             siteName || null, gtProjectKey || null, gbProjectKey || null, gdProjectKey || null],
        );

        appLogger.info('[JiraConfigService] Config saved', { userId, domain });
    }

    /** Resolve Jira credentials — DB first, then environment variables. */
    static async resolve(userId: string, pool: Pool): Promise<{
        domain: string;
        email: string;
        apiToken: string;
        spaces: { gt: string; gb?: string; gd?: string };
    } | null> {
        const row = await this.getRaw(userId, pool);
        if (row && row.domain && row.email && row.apiToken) {
            return {
                domain:   row.domain,
                email:    row.email,
                apiToken: row.apiToken,
                spaces: {
                    gt: row.gtProjectKey,
                    gb: row.gbProjectKey,
                    gd: row.gdProjectKey,
                },
            };
        }

        // Fallback to environment variables
        const domain   = process.env.JIRA_DOMAIN   || process.env.JIRA_BASE_URL || '';
        const email    = process.env.JIRA_EMAIL    || process.env.JIRA_USER     || '';
        const apiToken = process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN   || '';

        if (!domain || !email || !apiToken) return null;

        return {
            domain,
            email,
            apiToken,
            spaces: {
                gt: process.env.JIRA_GT_PROJECT_KEY || '',
                gb: process.env.JIRA_GB_PROJECT_KEY || undefined,
                gd: process.env.JIRA_GD_PROJECT_KEY || undefined,
            },
        };
    }
}
