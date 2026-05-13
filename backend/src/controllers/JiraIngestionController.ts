import { Request, Response } from 'express';
import multer from 'multer';
import csvParser from 'csv-parser';
import * as fs from 'fs';
import * as path from 'path';
import { appLogger } from '../utils/logger';
import { AIBrainEngine, JiraIssue } from '../engine/AIBrainEngine';
import { JiraService } from '../../api/JiraService';
import { BusinessRule, BusinessRulesService } from '../services/execution/BusinessRulesService';
import { DbClient } from '../services/shared/TelemetryService';

// Multer config for CSV uploads
const upload = multer({ dest: 'uploads/' });

export class JiraIngestionController {
    private static pool: DbClient | null = null;

    public static setPool(dbPool: DbClient): void {
        this.pool = dbPool;
    }

    public static get uploadMiddleware() {
        return upload.single('file');
    }

    private static parseCSV(filePath: string): Promise<JiraIssue[]> {
        return new Promise((resolve, reject) => {
            const issues: JiraIssue[] = [];
            fs.createReadStream(filePath)
                .pipe(csvParser())
                .on('data', (row) => {
                    issues.push({
                        issueType: row['Issue Type'] || row['IssueType'] || '',
                        summary: row['Summary'] || '',
                        description: row['Description'] || '',
                        comments: row['Comments'] || ''
                    });
                })
                .on('end', () => resolve(issues))
                .on('error', reject);
        });
    }

    public static async uploadCSV(req: Request, res: Response): Promise<void> {
        if (!req.file) {
            res.status(400).json({ error: 'No CSV file uploaded' });
            return;
        }

        try {
            const issues = await this.parseCSV(req.file.path);
            appLogger.info('[JiraIngestion] Processing issues for rule extraction', { source: 'JiraIngestion', count: issues.length });

            if (!this.pool) {
                throw new Error('Database pool not initialized');
            }

            const brainEngine = new AIBrainEngine(this.pool);
            const newRules: BusinessRule[] = [];

            for (const issue of issues) {
                const rule = await (brainEngine as any).extractRuleFromIssue?.(issue);
                if (rule && rule.formulaRule) {
                    newRules.push({
                        id: `JIRA-UI-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                        module: rule.module || 'Unknown',
                        subModule: rule.subModule,
                        keywords: rule.keywords,
                        formulaRule: rule.formulaRule,
                        expectedUIBehavior: rule.expectedUIBehavior,
                        confidenceScore: rule.confidenceScore || 0.95,
                    });
                }
            }

            for (const rule of newRules) {
                await BusinessRulesService.create(this.pool, rule);
            }

            // Clean up uploaded file
            if (fs.existsSync(req.file!.path)) fs.unlinkSync(req.file!.path);

            res.status(200).json({
                message: `Successfully extracted ${newRules.length} rules from ${issues.length} Jira tickets.`,
                rulesExtracted: newRules.length
            });
        } catch (error: any) {
            appLogger.error('[JiraIngestionController] AI Brain Engine failed', { source: 'JiraIngestionController', error: error.message });
            if (fs.existsSync(req.file!.path)) fs.unlinkSync(req.file!.path);
            res.status(500).json({ error: error.message });
        }
    }

    public static async importFromApi(req: Request, res: Response): Promise<void> {
        const { id } = req.params;
        if (!id) {
            res.status(400).json({ error: 'Jira Ticket ID is required' });
            return;
        }

        try {
            appLogger.info('[JiraIngestion] Importing ticket via API', { source: 'JiraIngestion', ticketId: id });

            // 1. Fetch from Jira
            const issue = await JiraService.fetchTicket(id);

            if (!this.pool) {
                throw new Error('Database pool not initialized');
            }

            // 2. Extract rules
            const brainEngine = new AIBrainEngine(this.pool);
            const rule = await brainEngine.extractRuleFromIssue(issue);

            if (!rule || !rule.formulaRule) {
                res.status(422).json({ error: 'AI failed to extract structured rules from this ticket.' });
                return;
            }

            // 3. Save to PostgreSQL
            const newRule: BusinessRule = {
                id: `JIRA-API-${id}-${Date.now()}`,
                module: rule.module || 'Unknown',
                subModule: rule.subModule,
                keywords: rule.keywords,
                formulaRule: rule.formulaRule,
                expectedUIBehavior: rule.expectedUIBehavior,
                confidenceScore: rule.confidenceScore ?? 0.98,
                jiraId: id,
                status: rule.status,
            };

            await BusinessRulesService.create(this.pool, newRule);

            res.status(200).json({
                message: `Successfully imported and extracted rules for ${id}`,
                rule: newRule
            });
        } catch (error: any) {
            appLogger.error('[JiraIngestionController] Import failed', { source: 'JiraIngestionController', error: error.message });
            res.status(500).json({ error: error.message });
        }
    }
}
