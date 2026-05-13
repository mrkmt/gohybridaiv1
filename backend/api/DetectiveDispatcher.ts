import { AgentOrchestrator, AgentType } from './AgentOrchestrator';

export enum IssueType {
    HEARTBEAT = 'heartbeat',   
    POLICY_LEAVE = 'policy_leave', 
    POLICY_ATTENDANCE = 'policy_attendance', 
    POLICY_PAYROLL = 'policy_payroll', 
    VISUAL = 'visual',         
    EXTERNAL_API = 'external_api',
    EXTERNAL_PERF = 'external_perf',
    UNKNOWN = 'unknown'
}

export interface DetectiveReport {
    sessionId: string;
    issueType: IssueType;
    evidence: {
        manualSnapshot?: string;
        automationSnapshot?: string;
        networkLogs?: any[];
        annotations?: any[];
    };
    verdict?: string;
}

export class DetectiveDispatcher {
    /**
     * Ingests results from external tools (Postman, JMeter, Selenium)
     */
    static async ingestExternal(toolName: string, payload: any, pool: any): Promise<string> {
        console.log(`[Detective] Ingesting Foreign Intelligence from: ${toolName.toUpperCase()}`);

        const id = require('uuid').v4();
        let issueType = IssueType.UNKNOWN;

        if (toolName === 'postman') issueType = IssueType.EXTERNAL_API;
        if (toolName === 'jmeter') issueType = IssueType.EXTERNAL_PERF;

        await pool.query(
            `INSERT INTO recordings (id, session_id, app_version, steps, annotations, user_id) 
             VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
            [id, `external_${toolName}_${Date.now()}`, 'external-v1', JSON.stringify(payload), JSON.stringify([{note: `Imported from ${toolName}`}]), 'public']
        );

        return id;
    }

    /**
     * Analyzes annotations and metadata to dispatch the right skill agents.
     */
    static async analyzeAndDispatch(recording: any, autoResult: any): Promise<DetectiveReport> {
        const annotations = recording.annotations || [];
        const issueType = this.detectIssueType(annotations, recording.steps);
        
        const report: DetectiveReport = {
            sessionId: recording.session_id,
            issueType,
            evidence: {
                manualSnapshot: recording.manual_snapshot_url,
                automationSnapshot: autoResult.screenshot_url,
                networkLogs: recording.network_requests,
                annotations: annotations
            }
        };

        console.log(`[Detective] Investigating Session: ${report.sessionId} | Type: ${issueType.toUpperCase()}`);

        const aiAnalysis = await AgentOrchestrator.executeRootCauseAnalysis(
            `Issue Type: ${issueType}. HR System Forensic Analysis required.`,
            recording.steps,
            annotations,
            recording.expected_results
        );

        const network = recording.network_requests || [];
        const slowCalls = network.filter((req: any) => (req.duration || 0) > 3000);
        if (slowCalls.length > 0) {
            report.verdict = (report.verdict || '') + `\n\n[PERFORMANCE ALERT]: ${slowCalls.length} requests exceeded 3s.`;
        }

        report.verdict = aiAnalysis.cloudVerdict || aiAnalysis.response;
        return report;
    }

    private static detectIssueType(annotations: any[], steps: any[]): IssueType {
        const text = JSON.stringify(annotations).toLowerCase();
        let hasStuckStep = false;
        for (let i = 1; i < steps.length; i++) {
            const gap = (steps[i].timestamp || 0) - (steps[i-1].timestamp || 0);
            if (gap > 10000) { hasStuckStep = true; break; }
        }

        if (text.includes('leave') || text.includes('holiday')) return IssueType.POLICY_LEAVE;
        if (text.includes('attendance') || text.includes('check-in')) return IssueType.POLICY_ATTENDANCE;
        if (text.includes('payroll') || text.includes('salary')) return IssueType.POLICY_PAYROLL;
        if (text.includes('color') || text.includes('button')) return IssueType.VISUAL;
        if (text.includes('slow') || text.includes('stuck') || hasStuckStep) return IssueType.HEARTBEAT;

        return IssueType.UNKNOWN;
    }

    static crossExamine(apiResponse: any, expected: any): boolean {
        const keys = Object.keys(expected);
        for (const key of keys) {
            if (apiResponse[key] !== expected[key]) return false;
        }
        return true;
    }
}
