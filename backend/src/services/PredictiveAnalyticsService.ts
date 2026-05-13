import { TestCase } from './generation/TestCaseGeneratorService';
import { TestResult } from './execution/TestExecutionService';
import { FailureClassificationService } from './execution/FailureClassificationService';
import { appLogger } from '../utils/logger';

export interface FlakinessReport {
    module: string;
    totalRuns: number;
    failRate: string;
    flakyRate: string;
    topErrorCategory: string;
}

export interface TrendData {
    date: string;
    passRate: string;
    avgDurationMs: number;
    totalRuns: number;
}

export class PredictiveAnalyticsService {
    /**
     * Log a test execution result to the database for historical analysis.
     */
    static async logExecution(ticketId: string, testCase: TestCase, result: TestResult, moduleName: string): Promise<void> {
        const pool = (global as any).dbPool;
        if (!pool) {
            appLogger.warn('[PredictiveAnalytics] DB Pool not available, skipping log.');
            return;
        }

        try {
            const classification = FailureClassificationService.classifyTestResult(result);
            const isFlaky = (result as any).healed || result.status === 'FAIL' && 
                (classification.category === 'SELECTOR_ERROR' || classification.category === 'TIMEOUT');

            const query = `
                INSERT INTO test_executions (
                    ticket_id, test_case_id, module_name, status, 
                    duration_ms, error_category, error_message, is_flaky
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `;

            const values = [
                ticketId,
                testCase.caseId,
                moduleName || 'Unknown',
                result.status,
                result.duration || 0,
                result.status === 'FAIL' ? classification.category : null,
                result.errorMessage || null,
                isFlaky
            ];

            await pool.query(query, values);
        } catch (err: any) {
            appLogger.error(`[PredictiveAnalytics] Failed to log execution: ${err.message}`);
        }
    }

    /**
     * Get a report on module-level flakiness and failure rates.
     */
    static async getFlakinessReport(): Promise<FlakinessReport[]> {
        const pool = (global as any).dbPool;
        if (!pool) return [];

        const query = `
            SELECT 
                module_name as module,
                COUNT(*) as total_runs,
                ROUND((COUNT(*) FILTER (WHERE status = 'FAIL')::numeric / COUNT(*)) * 100, 1) as fail_rate,
                ROUND((COUNT(*) FILTER (WHERE is_flaky = true)::numeric / COUNT(*)) * 100, 1) as flaky_rate,
                mode() WITHIN GROUP (ORDER BY error_category) as top_error
            FROM test_executions
            GROUP BY module_name
            ORDER BY flaky_rate DESC, fail_rate DESC
        `;

        try {
            const { rows } = await pool.query(query);
            return rows.map((r: any) => ({
                module: r.module,
                totalRuns: parseInt(r.total_runs),
                failRate: r.fail_rate + '%',
                flakyRate: r.flaky_rate + '%',
                topErrorCategory: r.top_error || 'N/A'
            }));
        } catch (err: any) {
            appLogger.error(`[PredictiveAnalytics] Failed to get flakiness report: ${err.message}`);
            return [];
        }
    }

    /**
     * Get trend data over time.
     */
    static async getTrendAnalysis(days: number = 30): Promise<TrendData[]> {
        const pool = (global as any).dbPool;
        if (!pool) return [];

        const query = `
            SELECT 
                DATE(created_at) as date,
                ROUND((COUNT(*) FILTER (WHERE status = 'PASS')::numeric / COUNT(*)) * 100, 1) as pass_rate,
                ROUND(AVG(duration_ms)) as avg_duration,
                COUNT(*) as total_runs
            FROM test_executions
            WHERE created_at > NOW() - interval '${days} days'
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `;

        try {
            const { rows } = await pool.query(query);
            return rows.map((r: any) => ({
                date: r.date.toISOString().split('T')[0],
                passRate: r.pass_rate + '%',
                avgDurationMs: parseInt(r.avg_duration || '0'),
                totalRuns: parseInt(r.total_runs)
            }));
        } catch (err: any) {
            appLogger.error(`[PredictiveAnalytics] Failed to get trend analysis: ${err.message}`);
            return [];
        }
    }
}
