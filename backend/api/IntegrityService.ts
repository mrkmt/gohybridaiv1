import fs from 'fs';
import path from 'path';
import { DetectiveDispatcher, IssueType } from './DetectiveDispatcher';
import { LocalAIService } from './LocalAIService';
import { config } from './config';

export interface IntegrityReport {
    verdict: 'GUILTY' | 'CLEAR' | 'STUCK';
    issueType: IssueType;
    explanation: string;
    standardData: any;
    executionData: any;
    policyReference?: string;
}

export class IntegrityService {
    /**
     * The Intelligence Bridge: Compares Admin Standard vs Current Execution vs MD Policy
     */
    static async performForensicAudit(standardId: string, executionId: string, pool: any): Promise<IntegrityReport> {
        console.log(`[Forensic Bridge] Commencing Audit: Standard(${standardId}) vs Execution(${executionId})`);

        // 1. Fetch both recordings from Postgres
        const standardResult = await pool.query('SELECT * FROM recordings WHERE id = $1', [standardId]);
        const executionResult = await pool.query('SELECT * FROM recordings WHERE id = $1', [executionId]);

        if (standardResult.rows.length === 0 || executionResult.rows.length === 0) {
            throw new Error('One or both recordings not found for audit.');
        }

        const standard = standardResult.rows[0];
        const execution = executionResult.rows[0];

        // 2. Identify the likely MD Policy File based on annotations
        const policyFile = this.locatePolicyFile(execution.annotations);
        let policyContent = "No specific policy file found.";
        if (policyFile) {
            try {
                policyContent = fs.readFileSync(path.join(process.cwd(), 'docs', policyFile), 'utf8');
            } catch (e) {
                console.warn(`[Integrity] Could not read policy file: ${policyFile}`);
            }
        }

        // 3. AI Reasoning: Compare API Responses and Logic
        const aiAnalysis = await LocalAIService.suggestRootCause({
            steps: execution.steps,
            error: `Compare this execution against the Admin Standard (${standardId}). 
                    Policy Context: ${policyContent.substring(0, 1000)}`,
            appVersion: execution.app_version,
            annotations: execution.annotations,
            expectedResults: standard.steps // Using Admin steps as the "Ground Truth"
        });

        // 4. Determine Verdict
        let verdict: 'GUILTY' | 'CLEAR' | 'STUCK' = 'CLEAR';
        const lowerResponse = aiAnalysis.response.toLowerCase();
        if (lowerResponse.includes('violation') || lowerResponse.includes('bug') ||
            lowerResponse.includes('mismatch') || lowerResponse.includes('error') ||
            lowerResponse.includes('wrong') || lowerResponse.includes('failure')) {
            verdict = 'GUILTY';
        } else if (lowerResponse.includes('stuck') || lowerResponse.includes('timeout')) {
            verdict = 'STUCK';
        }

        return {
            verdict,
            issueType: (execution.annotations && execution.annotations.length > 0) ? IssueType.POLICY_LEAVE : IssueType.UNKNOWN,
            explanation: aiAnalysis.response,
            standardData: standard.steps,
            executionData: execution.steps,
            policyReference: policyFile ?? undefined
        };
    }

    private static locatePolicyFile(annotations: any[]): string | null {
        const text = JSON.stringify(annotations).toLowerCase();
        if (text.includes('leave') || text.includes('holiday')) return 'ALL_IN_ONE_TESTING_GUIDE.md';
        if (text.includes('security')) return 'SECURITY_ANALYSIS.md';
        return null;
    }
}
