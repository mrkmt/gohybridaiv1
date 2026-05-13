import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { appLogger } from '../utils/logger';
import { BusinessRulesService, BusinessRule } from '../services/execution/BusinessRulesService';
import { successResponse, errorResponse, internalError } from '../../api/utils/responseHelpers';
import { parseLimit, parsePage } from '../../api/utils/requestUtils';

export interface KBBusinessRule extends BusinessRule {
    confidenceScore: number;
    status: string;
}

export class KBController {
    static async getRules(req: Request, res: Response, pool: any) {
        try {
            const limit = parseLimit(req.query.limit, 50);
            const page = parsePage(req.query.page, 1);
            const offset = (page - 1) * limit;

            const [rules, total] = await Promise.all([
                BusinessRulesService.getPaginated(pool, limit, offset),
                BusinessRulesService.getCount(pool)
            ]);

            return successResponse(res, rules, {
                meta: {
                    total,
                    page,
                    limit,
                    hasMore: offset + rules.length < total
                }
            });
        } catch (error: any) {
            appLogger.error('[KBController] get error', { source: 'KBController', error: error.message });
            return internalError(res, 'Failed to fetch business rules');
        }
    }

    static async addRule(req: Request, res: Response, pool: any) {
        try {
            const { Module, SubModule, Keywords, FormulaRule, ExpectedUIBehavior } = req.body;

            if (!Module || !FormulaRule || !ExpectedUIBehavior) {
                return res.status(400).json({ error: 'Module, FormulaRule, and ExpectedUIBehavior are required.' });
            }

            const newRule: Omit<BusinessRule, 'createdAt' | 'updatedAt'> = {
                id: uuidv4(),
                module: Module,
                subModule: SubModule || '',
                keywords: Array.isArray(Keywords) ? Keywords : (typeof Keywords === 'string' ? Keywords.split(',') : []),
                formulaRule: FormulaRule,
                expectedUIBehavior: ExpectedUIBehavior,
                confidenceScore: 0.90,
                status: 'active',
            };

            await BusinessRulesService.create(pool, newRule);

            const created = await BusinessRulesService.findById(pool, newRule.id);
            res.status(201).json(created);
        } catch (error: any) {
            appLogger.error('[KBController] addRule failed', { source: 'KBController', error: error.message });
            res.status(500).json({ error: 'Failed to add rule' });
        }
    }

    static async updateRule(req: Request, res: Response, pool: any) {
        try {
            const { id } = req.params;
            const updates = req.body;

            const existing = await BusinessRulesService.findById(pool, id);
            if (!existing) {
                return res.status(404).json({ error: 'Rule not found' });
            }

            // Normalize Keywords if it came as a comma-separated string from UI
            if (typeof updates.Keywords === 'string') {
                updates.keywords = updates.Keywords.split(',').map((s: string) => s.trim());
            } else if (Array.isArray(updates.Keywords)) {
                updates.keywords = updates.Keywords;
            }

            const merged: Omit<BusinessRule, 'createdAt' | 'updatedAt'> = {
                ...existing,
                ...updates,
                module: updates.Module || updates.module || existing.module,
                subModule: updates.SubModule ?? updates.subModule ?? existing.subModule,
                keywords: updates.keywords ?? existing.keywords,
                formulaRule: updates.FormulaRule ?? updates.formulaRule ?? existing.formulaRule,
                expectedUIBehavior: updates.ExpectedUIBehavior ?? updates.expectedUIBehavior ?? existing.expectedUIBehavior,
                confidenceScore: updates.confidenceScore ?? existing.confidenceScore,
                status: updates.status ?? existing.status,
                jiraId: updates.jiraId ?? existing.jiraId,
            };

            await BusinessRulesService.create(pool, merged);

            const updated = await BusinessRulesService.findById(pool, id);
            res.json(updated);
        } catch (error: any) {
            appLogger.error('[KBController] updateRule failed', { source: 'KBController', error: error.message });
            res.status(500).json({ error: 'Failed to update rule' });
        }
    }

    static async deleteRule(req: Request, res: Response, pool: any) {
        try {
            const { id } = req.params;

            const existing = await BusinessRulesService.findById(pool, id);
            if (!existing) {
                return res.status(404).json({ error: 'Rule not found' });
            }

            await pool.query('DELETE FROM business_rules WHERE id = $1', [id]);
            res.json({ message: 'Rule deleted successfully', id });
        } catch (error: any) {
            appLogger.error('[KBController] deleteRule failed', { source: 'KBController', error: error.message });
            res.status(500).json({ error: 'Failed to delete rule' });
        }
    }

    /**
     * Updates rule confidence based on test results.
     */
    static async learnFromTestResult(
        targetId: string,
        status: 'passed' | 'failed',
        failedTests: any[] = [],
        pool: any
    ) {
        if (!targetId || !pool) return;

        appLogger.info('[ClosedLoop] Learning from result', { source: 'ClosedLoop', targetId, status });

        const isTechnicalFailure = failedTests.some(test =>
            test.error?.includes('Timeout') ||
            test.error?.includes('healedClick') ||
            test.error?.includes('healedFill') ||
            test.error?.includes('locator')
        );

        const isAssertionFailure = failedTests.some(test =>
            test.error?.includes('expect') ||
            test.error?.includes('AssertionError') ||
            test.error?.includes('toBe')
        );

        const rules = await BusinessRulesService.searchByText(pool, targetId);

        const { rows: jiraMatches } = await pool.query(
            'SELECT * FROM business_rules WHERE jira_id = $1',
            [targetId]
        );
        const allRules = [...new Map([...rules, ...jiraMatches].map((r: any) => [r.id, r])).values()];

        let hasChanges = false;
        for (const rule of allRules) {
            const currentScore = rule.confidenceScore ?? 0.90;

            if (status === 'passed') {
                const newScore = Math.min(1.0, currentScore + 0.02);
                await pool.query(
                    'UPDATE business_rules SET confidence_score = $1, status = $2, updated_at = NOW() WHERE id = $3',
                    [parseFloat(newScore.toFixed(3)), 'VERIFIED', rule.id]
                );
                hasChanges = true;
            } else {
                if (isTechnicalFailure && !isAssertionFailure) {
                    await pool.query(
                        'UPDATE business_rules SET status = $1, updated_at = NOW() WHERE id = $2',
                        ['TECH_REVIEW_NEEDED', rule.id]
                    );
                    hasChanges = true;
                } else {
                    const newScore = Math.max(0.5, currentScore - 0.1);
                    await pool.query(
                        'UPDATE business_rules SET confidence_score = $1, status = $2, updated_at = NOW() WHERE id = $3',
                        [parseFloat(newScore.toFixed(3)), 'UNDER_REVIEW', rule.id]
                    );
                    hasChanges = true;
                }
            }
        }

        if (hasChanges) {
            appLogger.info('[ClosedLoop] Knowledge Brain updated', { source: 'ClosedLoop', targetId });
        }
    }
}
