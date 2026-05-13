import * as fs from 'fs';
import * as path from 'path';
import * as mammoth from 'mammoth';
import { v4 as uuidv4 } from 'uuid';
import { LocalAIService } from '../../api/LocalAIService';
import { CliAgentService } from '../../api/CliAgentService';
import { BusinessRulesService, BusinessRule } from '../services/execution/BusinessRulesService';

// Raw AI extraction format (capitalized keys)
interface AIExtractedRule {
    Module: string;
    SubModule: string;
    Keywords: string[];
    FormulaRule: string;
    ExpectedUIBehavior: string;
    confidenceScore?: number;
}

function aiRuleToBusinessRule(raw: AIExtractedRule): BusinessRule {
    return {
        id: uuidv4(),
        module: raw.Module,
        subModule: raw.SubModule,
        keywords: raw.Keywords,
        formulaRule: raw.FormulaRule,
        expectedUIBehavior: raw.ExpectedUIBehavior,
        confidenceScore: raw.confidenceScore,
        status: 'staging',
    };
}

export class DocumentParserService {
    private pool?: any;

    setPool(dbPool: any) {
        this.pool = dbPool;
    }

    /**
     * Parses a .docx document and extracts business rules.
     */
    public async extractBusinessRules(docxPath: string): Promise<void> {
        try {
            const result = await mammoth.extractRawText({ path: docxPath });
            const text = result.value;

            const useCloud = process.env.USE_CLOUD_PARSER === 'true';
            let allExtractedRules: AIExtractedRule[] = [];

            if (useCloud) {
                const prompt = this.getExtractionPrompt(text);

                let success = false;
                let retries = 3;
                while (!success && retries > 0) {
                    try {
                        const aiResponse = await CliAgentService.generateFromCli(prompt, 'gemini');
                        if (!aiResponse) throw new Error("Empty response");
                        allExtractedRules = this.parseAIResponse(aiResponse);
                        success = true;
                    } catch (geminiError: any) {
                        retries--;
                        if (retries === 0) throw new Error(`Cloud extraction failed after 3 attempts: ${geminiError.message}`);
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            } else {
                const chunkSize = 8000;
                const overlap = 1000;
                const chunks: string[] = [];
                for (let i = 0; i < text.length; i += (chunkSize - overlap)) {
                    chunks.push(text.substring(i, i + chunkSize));
                }

                for (let c = 0; c < chunks.length; c++) {
                    const prompt = this.getExtractionPrompt(chunks[c]);
                    let chunkRetries = 2;
                    let chunkSuccess = false;
                    while (!chunkSuccess && chunkRetries >= 0) {
                        try {
                            const aiResponse = await LocalAIService.simpleGenerate(prompt, undefined, { timeoutMs: 240000 });
                            if (!aiResponse) throw new Error("Timed out or empty response");
                            const extracted = this.parseAIResponse(aiResponse);
                            if (Array.isArray(extracted)) {
                                allExtractedRules = [...allExtractedRules, ...extracted];
                            }
                            chunkSuccess = true;
                        } catch (chunkError: any) {
                            chunkRetries--;
                            if (chunkRetries < 0) {
                                // SMART SKIP
                            }
                        }
                    }
                }
            }

            if (allExtractedRules.length === 0) {
                return;
            }

            await this.processExtractedRules(allExtractedRules);
        } catch (error: any) {
            throw error;
        }
    }

    private async processExtractedRules(newRulesRaw: AIExtractedRule[]) {
        const newRules = newRulesRaw.map(aiRuleToBusinessRule);
        const allExisting = this.pool ? await BusinessRulesService.getAll(this.pool) : [];
        const activeToAdd: BusinessRule[] = [];
        const stagingToAdd: BusinessRule[] = [];

        for (const rule of newRules) {
            const isDuplicate = allExisting.some(existing =>
                existing.module.toLowerCase() === rule.module.toLowerCase() &&
                existing.formulaRule?.toLowerCase() === rule.formulaRule?.toLowerCase()
            );

            if (isDuplicate) continue;

            const score = rule.confidenceScore || 0;
            if (score > 90) {
                rule.status = 'active';
                activeToAdd.push(rule);
            } else {
                stagingToAdd.push(rule);
            }
        }

        if (!this.pool) {
            return;
        }

        for (const rule of activeToAdd) {
            await BusinessRulesService.create(this.pool, rule);
        }
        for (const rule of stagingToAdd) {
            await BusinessRulesService.createStagingRule(this.pool, rule);
        }
    }

    private getExtractionPrompt(text: string): string {
        return `
        You are an expert Business Analyst. Extract business rules from the following software documentation text.
        Format your response STRICTLY as a JSON array of objects with the following keys:
        - Module (string, e.g., 'Leave', 'Payroll')
        - SubModule (string)
        - Keywords (array of strings)
        - FormulaRule (string, e.g., 'Taken_Days <= Allowance')
        - ExpectedUIBehavior (string, e.g., 'Show error message')
        - confidenceScore (number between 0 and 100)

        Return ONLY the valid JSON array. NO markdown, NO backticks.
        If there are no rules in the text, return an empty array [].

        Text:
        ${text}
        `;
    }

    private parseAIResponse(response: string): AIExtractedRule[] {
        let clean = response.trim();
        const arrayMatch = clean.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (arrayMatch) {
            clean = arrayMatch[0];
        } else if (clean.includes('[]')) {
            return [];
        } else {
            clean = clean.replace(/```json/g, '').replace(/```/g, '').trim();
        }

        try {
            return JSON.parse(clean);
        } catch (e) {
            return [];
        }
    }
}