import { Request, Response } from 'express';
import { VerificationEngine } from '../services/execution/VerificationEngine';
import * as fs from 'fs';
import * as path from 'path';

export class SandboxController {
    /**
     * Handles natural language queries against the hybrid knowledge base.
     * POST /api/knowledge/test-query
     */
    static async handleTestQuery(req: Request, res: Response) {
        const { question } = req.body;

        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        try {
            console.log(`[Sandbox Controller] Received query: "${question}"`);
            const result = await VerificationEngine.query(question);
            return res.json(result);
        } catch (error: any) {
            console.error(`[Sandbox Controller] Query failed:`, error.message);
            return res.status(500).json({ error: error.message });
        }
    }

    /**
     * Fetches randomized templates from the Business Logic Matrix for simulation.
     * GET /api/knowledge/templates
     */
    static async getRandomTemplates(req: Request, res: Response) {
        try {
            const matrixPath = path.join(process.cwd(), 'business-logic-matrix.json');
            if (!fs.existsSync(matrixPath)) {
                return res.json([]);
            }

            const data = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
            if (!Array.isArray(data) || data.length === 0) {
                return res.json([]);
            }

            // Pick 3 random rules
            const shuffled = [...data].sort(() => 0.5 - Math.random());
            const selected = shuffled.slice(0, 3);

            const templates = selected.map(rule => ({
                label: `${rule.Module} Rule`,
                content: `Summary: Verification for ${rule.Module}${rule.SubModule ? ' (' + rule.SubModule + ')' : ''}\nDescription: Ensure the system follows this rule: ${rule.FormulaRule}. The expected UI result is: ${rule.ExpectedUIBehavior}`
            }));

            return res.json(templates);
        } catch (error: any) {
            console.error(`[Sandbox Controller] Failed to fetch templates:`, error.message);
            return res.status(500).json({ error: 'Failed to fetch simulation templates' });
        }
    }
}
