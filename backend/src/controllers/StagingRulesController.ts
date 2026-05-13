import { Request, Response } from 'express';
import { appLogger } from '../utils/logger';
import { BusinessRulesService, BusinessRule } from '../services/execution/BusinessRulesService';
import { v4 as uuidv4 } from 'uuid';

export class StagingRulesController {
    static async getStagingRules(req: Request, res: Response, pool: any) {
        try {
            const rules = await BusinessRulesService.getStagingRules(pool);
            res.json(rules);
        } catch (error: any) {
            appLogger.error('[StagingRulesController] get error', { source: 'StagingRulesController', error: error.message });
            res.status(500).json({ error: 'Failed to read staging rules' });
        }
    }

    static async approveBulk(req: Request, res: Response, pool: any) {
        try {
            const { ids } = req.body;
            if (!Array.isArray(ids)) {
                return res.status(400).json({ error: 'Invalid request: ids array required' });
            }

            let approvedCount = 0;
            for (const id of ids) {
                const stagingRule = await BusinessRulesService.findStagingRule(pool, id);
                if (!stagingRule) continue;
                approvedCount++;

                await pool.query(`
                    INSERT INTO business_rules (id, module, sub_module, keywords, formula_rule, expected_ui_behavior, confidence_score, status, jira_id, created_at, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', $8, $9, $10)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    id, stagingRule.module, stagingRule.subModule ?? null,
                    stagingRule.keywords, stagingRule.formulaRule, stagingRule.expectedUIBehavior,
                    stagingRule.confidenceScore, stagingRule.jiraId,
                    new Date().toISOString(), new Date().toISOString()
                ]);

                await BusinessRulesService.deleteStagingRule(pool, id);

            }

            res.json({ message: `Approved ${approvedCount} rules.`, approvedCount });
        } catch (error: any) {
            appLogger.error('[StagingRulesController] approveBulk error', { source: 'StagingRulesController', error: error.message });
            res.status(500).json({ error: 'Failed to approve bulk rules' });
        }
    }

    static async deleteBulk(req: Request, res: Response, pool: any) {
        try {
            const { ids } = req.body;
            if (!Array.isArray(ids)) {
                return res.status(400).json({ error: 'Invalid request: ids array required' });
            }

            let deletedCount = 0;
            for (const id of ids) {
                const result = await BusinessRulesService.deleteStagingRule(pool, id);
                deletedCount++;
            }

            res.json({ message: `Deleted ${deletedCount} rules.`, deletedCount });
        } catch (error: any) {
            appLogger.error('[StagingRulesController] deleteBulk error', { source: 'StagingRulesController', error: error.message });
            res.status(500).json({ error: 'Failed to delete bulk rules' });
        }
    }
}