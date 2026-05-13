import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { appLogger } from '../utils/logger';
import { TestCase } from './generation/TestCaseGeneratorService';

export interface RCAResult {
    summary: string;
    likelyCause: string;
    suggestedFix: string;
    isScriptIssue: boolean;
}

export class AIVisualAnalysisService {
    private static readonly OLLAMA_URL = process.env.OLLAMA_GENERATE_URL || 'http://localhost:11434/api/generate';
    private static readonly VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava:7b'; // Or moondream, etc.

    /**
     * Analyze a test failure using the screenshot and error log.
     */
    static async analyzeFailure(
        screenshotPath: string,
        testCase: TestCase,
        errorLog: string
    ): Promise<RCAResult> {
        appLogger.info(`[AIVisualAnalysis] Analyzing failure for ${testCase.caseId}`);

        if (!fs.existsSync(screenshotPath)) {
            appLogger.warn(`[AIVisualAnalysis] Screenshot not found: ${screenshotPath}`);
            return this.getFallbackRCA(errorLog);
        }

        try {
            const screenshotBase64 = fs.readFileSync(screenshotPath).toString('base64');
            
            const prompt = `
            You are an expert QA Automation Engineer. I have a failed test case and a screenshot of the page at the moment of failure.
            
            Test Case: "${testCase.title}"
            Error Log: "${errorLog.substring(0, 1000)}"
            
            Based on the screenshot and the error, please provide a Root Cause Analysis (RCA).
            Respond in JSON format with the following fields:
            - summary: A brief summary of what you see on the screen.
            - likelyCause: What is the most probable reason for the failure? (e.g. element hidden, page timeout, wrong data)
            - suggestedFix: How can the test or the application be fixed?
            - isScriptIssue: Boolean, true if it looks like a test script/selector issue, false if it looks like an application bug.
            
            Only return the JSON object.
            `;

            const response = await axios.post(this.OLLAMA_URL, {
                model: this.VISION_MODEL,
                prompt: prompt,
                images: [screenshotBase64],
                stream: false,
                format: 'json'
            }, { timeout: 60000 });

            const result = JSON.parse((response.data as any).response);
            return {
                summary: result.summary || "Unable to summarize screenshot.",
                likelyCause: result.likelyCause || "Undetermined.",
                suggestedFix: result.suggestedFix || "No fix suggested.",
                isScriptIssue: result.isScriptIssue ?? true
            };

        } catch (error: any) {
            appLogger.error(`[AIVisualAnalysis] Analysis failed: ${error.message}`);
            return this.getFallbackRCA(errorLog);
        }
    }

    private static getFallbackRCA(errorLog: string): RCAResult {
        return {
            summary: "Screenshot analysis unavailable.",
            likelyCause: errorLog.includes('Timeout') ? 'Execution timed out.' : 'An error occurred during execution.',
            suggestedFix: "Check logs for detailed stack trace.",
            isScriptIssue: true
        };
    }
}
