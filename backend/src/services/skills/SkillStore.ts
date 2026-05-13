/**
 * SkillStore
 *
 * Persistent per-module knowledge store backed by the `module_skills` DB table
 * (added in migration v28).
 *
 * Stores:
 *   business_rules   — array of free-text business rules for the module
 *   navigation_path  — ordered array of menu steps to reach the module
 *   known_selectors  — { fieldName: cssSelector } map learned from passing runs
 *   test_patterns    — array of scenario patterns that work reliably
 *
 * Token budget:
 *   getContext() compresses all knowledge into < 500 tokens so it fits
 *   into the AgentOrchestrator prompt without dominating the context.
 *
 * Usage:
 *   const ctx = await SkillStore.getContext('Performance Journal', pool);
 *   // Pass as options.skillContext to JsonTestGenerationService
 *
 *   await SkillStore.recordSuccess('Performance Journal', steps, selectors, pool);
 *   // Called after a passing test run to update known_selectors
 */

import { Pool } from 'pg';
import { McpStep } from '../../types/mcp.types';
import { appLogger } from '../../utils/logger';

export interface ModuleSkills {
    moduleName: string;
    businessRules: string[];
    navigationPath: string[];
    knownSelectors: Record<string, string>;
    testPatterns: string[];
}

export interface SkillStoreStats {
    totalModules: number;
    modulesWithSelectors: number;
    modulesWithRules: number;
}

export class SkillStore {

    // ──────────────────────────────────────────────────────────────────────────
    // Read
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Load all skills for a module, or null if none have been recorded yet.
     */
    static async get(moduleName: string, pool: Pool): Promise<ModuleSkills | null> {
        try {
            const { rows } = await pool.query<{
                business_rules: string[];
                navigation_path: string[];
                known_selectors: Record<string, string>;
                test_patterns: string[];
            }>(
                `SELECT business_rules, navigation_path, known_selectors, test_patterns
                 FROM module_skills WHERE module_name = $1`,
                [moduleName],
            );

            if (rows.length === 0) return null;

            const r = rows[0];
            return {
                moduleName,
                businessRules:   r.business_rules   ?? [],
                navigationPath:  r.navigation_path  ?? [],
                knownSelectors:  r.known_selectors  ?? {},
                testPatterns:    r.test_patterns    ?? [],
            };
        } catch {
            return null;
        }
    }

    /**
     * Build a compact token-efficient context string for injection into AI prompts.
     * Returns empty string when no skills exist for the module.
     *
     * Target: ≤ 500 tokens (~400 chars).
     */
    static async getContext(moduleName: string, pool: Pool): Promise<string> {
        const skills = await this.get(moduleName, pool);
        if (!skills) return '';

        const parts: string[] = [`## Module Skills: ${moduleName}`];

        if (skills.navigationPath.length > 0) {
            parts.push(`Navigation: ${skills.navigationPath.join(' → ')}`);
        }

        if (skills.businessRules.length > 0) {
            parts.push('Business rules:');
            skills.businessRules.slice(0, 5).forEach((r, i) => parts.push(`  ${i + 1}. ${r}`));
        }

        if (Object.keys(skills.knownSelectors).length > 0) {
            parts.push('Known selectors:');
            Object.entries(skills.knownSelectors)
                .slice(0, 8)
                .forEach(([field, sel]) => parts.push(`  ${field}: ${sel}`));
        }

        if (skills.testPatterns.length > 0) {
            parts.push(`Proven patterns: ${skills.testPatterns.slice(0, 3).join('; ')}`);
        }

        const context = parts.join('\n');

        // Hard cap at 2 000 chars — prevents runaway skill context from dominating prompt
        return context.length > 2_000 ? context.slice(0, 2_000) + '\n...[truncated]' : context;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Write
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Upsert the entire skill record for a module.
     * Use for admin-level bulk updates (e.g., seeding business rules from a config file).
     */
    static async upsert(moduleName: string, skills: Partial<Omit<ModuleSkills, 'moduleName'>>, pool: Pool): Promise<void> {
        try {
            const existing = await this.get(moduleName, pool);
            const merged: Omit<ModuleSkills, 'moduleName'> = {
                businessRules:  skills.businessRules  ?? existing?.businessRules  ?? [],
                navigationPath: skills.navigationPath ?? existing?.navigationPath ?? [],
                knownSelectors: { ...(existing?.knownSelectors ?? {}), ...(skills.knownSelectors ?? {}) },
                testPatterns:   skills.testPatterns   ?? existing?.testPatterns   ?? [],
            };

            await pool.query(
                `INSERT INTO module_skills
                     (module_name, business_rules, navigation_path, known_selectors, test_patterns, updated_at)
                 VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, NOW())
                 ON CONFLICT (module_name)
                 DO UPDATE SET
                     business_rules  = EXCLUDED.business_rules,
                     navigation_path = EXCLUDED.navigation_path,
                     known_selectors = EXCLUDED.known_selectors,
                     test_patterns   = EXCLUDED.test_patterns,
                     updated_at      = NOW()`,
                [
                    moduleName,
                    JSON.stringify(merged.businessRules),
                    JSON.stringify(merged.navigationPath),
                    JSON.stringify(merged.knownSelectors),
                    JSON.stringify(merged.testPatterns),
                ],
            );
        } catch (err: any) {
            appLogger.error(`[SkillStore] Failed to upsert skills for ${moduleName}: ${err.message}`);
        }
    }

    /**
     * Update known_selectors from a passing test run.
     * Merges new selectors into the existing map — existing entries are preserved.
     *
     * @param moduleName   Module whose selectors to update
     * @param steps        Passing McpStep[] — extracts browser_type/browser_click targets
     * @param extraSelectors  Additional field→selector pairs to merge (from TestSpecTargetResolver)
     * @param pool         DB pool
     */
    static async recordSuccess(
        moduleName: string,
        steps: McpStep[],
        extraSelectors: Record<string, string>,
        pool: Pool,
    ): Promise<void> {
        // Extract targets from McpStep[] — browser_click/browser_type/browser_select_option/browser_hover
        // use the 'element' field (not 'selector') per the McpStep discriminated union.
        const stepSelectors: Record<string, string> = {};
        for (const step of steps) {
            const el = (step as any).element;
            if (typeof el === 'string' && el.length > 0) {
                stepSelectors[el] = el;
            }
        }

        const merged = { ...stepSelectors, ...extraSelectors };
        if (Object.keys(merged).length === 0) return;

        await this.upsert(moduleName, { knownSelectors: merged }, pool);
        appLogger.info(`[SkillStore] Updated ${Object.keys(merged).length} selector(s) for module "${moduleName}"`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Admin / stats
    // ──────────────────────────────────────────────────────────────────────────

    static async list(pool: Pool): Promise<ModuleSkills[]> {
        try {
            const { rows } = await pool.query<{
                module_name: string;
                business_rules: string[];
                navigation_path: string[];
                known_selectors: Record<string, string>;
                test_patterns: string[];
            }>(`SELECT module_name, business_rules, navigation_path, known_selectors, test_patterns
                FROM module_skills ORDER BY module_name`);

            return rows.map(r => ({
                moduleName:     r.module_name,
                businessRules:  r.business_rules  ?? [],
                navigationPath: r.navigation_path ?? [],
                knownSelectors: r.known_selectors ?? {},
                testPatterns:   r.test_patterns   ?? [],
            }));
        } catch {
            return [];
        }
    }

    static async getStats(pool: Pool): Promise<SkillStoreStats> {
        try {
            const { rows } = await pool.query<{
                total: string;
                with_selectors: string;
                with_rules: string;
            }>(
                `SELECT
                     COUNT(*)::text                                              AS total,
                     COUNT(*) FILTER (WHERE known_selectors != '{}')::text      AS with_selectors,
                     COUNT(*) FILTER (WHERE jsonb_array_length(business_rules) > 0)::text AS with_rules
                 FROM module_skills`,
            );

            const r = rows[0];
            return {
                totalModules:         parseInt(r?.total         ?? '0', 10),
                modulesWithSelectors: parseInt(r?.with_selectors ?? '0', 10),
                modulesWithRules:     parseInt(r?.with_rules     ?? '0', 10),
            };
        } catch {
            return { totalModules: 0, modulesWithSelectors: 0, modulesWithRules: 0 };
        }
    }

    static async delete(moduleName: string, pool: Pool): Promise<void> {
        try {
            await pool.query('DELETE FROM module_skills WHERE module_name = $1', [moduleName]);
        } catch (err: any) {
            appLogger.error(`[SkillStore] Failed to delete skills for ${moduleName}: ${err.message}`);
        }
    }
}
