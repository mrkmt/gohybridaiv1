import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

export interface ReportData {
    id: string;
    title: string;
    description: string;
    generatedAt: string;
    reportType: string;
    data: any;
    userId?: string;
}

export interface ReportFilter {
    startDate?: string;
    endDate?: string;
    reportType?: string;
    userId?: string;
}

export interface TestCaseResult {
    caseId: string;
    title: string;
    status: 'passed' | 'failed' | 'error';
    hasVideo: boolean;
    screenshotPath?: string;
    videoPath?: string;
    duration?: number;
    errorMessage?: string;
}

export class ReportingService {
    /**
     * Formats multiple test case results into a Jira Cloud compatible ADF (Atlassian Document Format).
     * This ensures rich tables render correctly in modern Jira environments.
     */
    static generateJiraVerificationMatrix(jiraId: string, results: TestCaseResult[], tokens?: { total: number }): any {
        const tableRows: any[] = [
            {
                type: 'tableRow',
                content: [
                    { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Case ID', marks: [{ type: 'strong' }] }] }] },
                    { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test Scenario', marks: [{ type: 'strong' }] }] }] },
                    { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Result', marks: [{ type: 'strong' }] }] }] },
                    { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Duration', marks: [{ type: 'strong' }] }] }] },
                    { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Artifacts', marks: [{ type: 'strong' }] }] }] }
                ]
            }
        ];

        for (const res of results) {
            const statusColor = res.status === 'passed' ? '#36B37E' : '#FF5630';
            const statusIcon = res.status === 'passed' ? '✔' : '✖';
            const artifacts = [];
            if (res.hasVideo) artifacts.push('🎥 Video');
            if (res.screenshotPath) artifacts.push('📸 Screenshot');

            tableRows.push({
                type: 'tableRow',
                content: [
                    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: res.caseId }] }] },
                    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: res.title }] }] },
                    { 
                        type: 'tableCell', 
                        content: [{ 
                            type: 'paragraph', 
                            content: [
                                { type: 'text', text: `${statusIcon} ${res.status.toUpperCase()}`, marks: [{ type: 'textColor', attrs: { color: statusColor } }, { type: 'strong' }] }
                            ] 
                        }] 
                    },
                    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: res.duration ? `${(res.duration / 1000).toFixed(1)}s` : 'N/A' }] }] },
                    { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: artifacts.join(', ') || 'None' }] }] }
                ]
            });

            // Add error message row if failed
            if (res.status !== 'passed' && res.errorMessage) {
                tableRows.push({
                    type: 'tableRow',
                    content: [
                        { type: 'tableCell', attrs: { colSpan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Error Details', marks: [{ type: 'strong' }] }] }] },
                        { type: 'tableCell', attrs: { colSpan: 4 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: res.errorMessage, marks: [{ type: 'textColor', attrs: { color: '#FF5630' } }] }] }] }
                    ]
                });
            }
        }

        const adf: any = {
            version: 1,
            type: 'doc',
            content: [
                {
                    type: 'heading',
                    attrs: { level: 3 },
                    content: [{ type: 'text', text: `Go-Hybrid AI: Verification Results for ${jiraId}` }]
                },
                {
                    type: 'table',
                    attrs: { isNumberColumnEnabled: false, layout: 'default' },
                    content: tableRows
                }
            ]
        };

        // Analysis block
        const mainFailure = results.find(r => r.caseId === 'MAIN_BUG' && r.status !== 'passed');
        let analysisText = '';
        if (mainFailure) {
            analysisText = 'Analysis: Main bug reproduction confirmed. High-priority fix recommended.';
        } else if (results.every(r => r.status === 'passed')) {
            analysisText = 'Analysis: All verification cases passed. System behavior is within expected bounds.';
        }

        if (analysisText) {
            adf.content.push({
                type: 'paragraph',
                content: [{ type: 'text', text: analysisText, marks: [{ type: 'strong' }] }]
            });
        }

        if (tokens) {
            adf.content.push({
                type: 'paragraph',
                content: [{ type: 'text', text: `Analysis Cost: ${tokens.total} tokens (AI Cache Active)`, marks: [{ type: 'em' }] }]
            });
        }

        return adf;
    }
    private static REPORTS_DIR = path.join(process.cwd(), 'reports');
    
    constructor(private pool: any) { // Changed to 'any' to match DbClient interface
        // Ensure reports directory exists
        if (!fs.existsSync(ReportingService.REPORTS_DIR)) {
            fs.mkdirSync(ReportingService.REPORTS_DIR, { recursive: true });
        }
    }

    /**
     * Generates a comprehensive test report based on recordings and execution data.
     */
    async generateTestReport(filter: ReportFilter): Promise<ReportData> {
        const id = uuidv4();
        const reportTitle = `Test Execution Report - ${new Date().toISOString()}`;
        
        // Fetch data from database based on filters
        const queryParts = ['SELECT * FROM recordings'];
        const queryParams: any[] = [];
        let paramIndex = 1;
        
        const conditions: string[] = [];
        if (filter.startDate) {
            conditions.push(`created_at >= $${paramIndex}`);
            queryParams.push(filter.startDate);
            paramIndex++;
        }
        
        if (filter.endDate) {
            conditions.push(`created_at <= $${paramIndex}`);
            queryParams.push(filter.endDate);
            paramIndex++;
        }
        
        if (conditions.length > 0) {
            queryParts.push('WHERE', conditions.join(' AND '));
        }
        
        queryParts.push('ORDER BY created_at DESC');
        
        const result = await this.pool.query(queryParts.join(' '), queryParams);
        
        const reportData = {
            summary: {
                totalTests: result.rows.length,
                passedTests: result.rows.filter((r: any) => !this.containsError(r)).length,
                failedTests: result.rows.filter((r: any) => this.containsError(r)).length,
                dateRange: {
                    from: filter.startDate || 'Beginning of time',
                    to: filter.endDate || 'Present'
                }
            },
            testResults: result.rows.map((row: any) => ({
                id: row.id,
                sessionId: row.session_id,
                appVersion: row.app_version,
                createdAt: row.created_at,
                hasErrors: this.containsError(row),
                environment: row.environment
            }))
        };
        
        const report: ReportData = {
            id,
            title: reportTitle,
            description: 'Comprehensive test execution report with pass/fail statistics',
            generatedAt: new Date().toISOString(),
            reportType: 'test-execution',
            data: reportData,
            userId: filter.userId
        };
        
        // Save report to filesystem
        await this.saveReportToFile(report);
        
        return report;
    }

    /**
     * Generates an AI analysis report for test failures.
     */
    async generateAIAnalysisReport(recordingIds: string[]): Promise<ReportData> {
        const id = uuidv4();
        const reportTitle = `AI Analysis Report - ${new Date().toISOString()}`;
        
        // Fetch specific recordings
        const placeholders = recordingIds.map((_, i) => `$${i + 1}`).join(', ');
        const query = `SELECT * FROM recordings WHERE id IN (${placeholders})`;
        const result = await this.pool.query(query, recordingIds);
        
        // For now, we'll return basic analysis - in a real implementation, this would call AI services
        const aiAnalysis = result.rows.map((row: any) => {
            return {
                id: row.id,
                analysis: this.performBasicAnalysis(row),
                suggestions: this.generateSuggestions(row)
            };
        });
        
        const report: ReportData = {
            id,
            title: reportTitle,
            description: 'AI-powered analysis of test failures with suggestions',
            generatedAt: new Date().toISOString(),
            reportType: 'ai-analysis',
            data: {
                analyzedRecordings: aiAnalysis,
                totalRecordings: recordingIds.length
            }
        };
        
        // Save report to filesystem
        await this.saveReportToFile(report);
        
        return report;
    }

    /**
     * Saves a report to the filesystem.
     */
    private async saveReportToFile(report: ReportData): Promise<void> {
        const fileName = `${report.id}_${report.title.replace(/\s+/g, '_').substring(0, 50)}.json`;
        const filePath = path.join(ReportingService.REPORTS_DIR, fileName);
        
        await fs.promises.writeFile(filePath, JSON.stringify(report, null, 2));
    }

    /**
     * Lists all available reports.
     */
    async listReports(): Promise<ReportData[]> {
        const files = await fs.promises.readdir(ReportingService.REPORTS_DIR);
        const reports: ReportData[] = [];
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const filePath = path.join(ReportingService.REPORTS_DIR, file);
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    const report = JSON.parse(content) as ReportData;
                    reports.push(report);
                } catch (err) {
                    console.error(`Error reading report file ${file}:`, err);
                }
            }
        }
        
        return reports.sort((a, b) => 
            new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
        );
    }

    /**
     * Gets a specific report by ID.
     */
    async getReportById(id: string): Promise<ReportData | null> {
        const reports = await this.listReports();
        return reports.find(report => report.id === id) || null;
    }

    /**
     * Performs basic analysis on a recording.
     */
    private performBasicAnalysis(row: any): string {
        if (this.containsError(row)) {
            return 'Test failed due to assertion error or unexpected behavior';
        }
        return 'Test passed successfully';
    }

    /**
     * Generates basic suggestions based on recording data.
     */
    private generateSuggestions(row: any): string[] {
        const suggestions: string[] = [];
        
        if (this.containsError(row)) {
            suggestions.push('Review test steps for potential race conditions');
            suggestions.push('Consider adding more explicit waits');
            suggestions.push('Verify test data integrity');
        } else {
            suggestions.push('Test executed successfully');
            suggestions.push('Consider adding more assertions for better coverage');
        }
        
        return suggestions;
    }

    /**
     * Checks if a recording contains errors.
     */
    private containsError(row: any): boolean {
        // In a real implementation, this would check for actual error indicators
        // For now, we'll just check if there are any error-related keywords in the steps
        if (!row.steps) return false;
        
        return row.steps.some((step: any) => {
            if (typeof step === 'object' && step.action) {
                return step.action.toLowerCase().includes('error') || 
                       step.action.toLowerCase().includes('fail') ||
                       (step.result && step.result.toLowerCase().includes('error'));
            }
            return false;
        });
    }
}