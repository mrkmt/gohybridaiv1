/**
 * JiraCommentBuilder — Unit Tests
 *
 * Tests for ADF comment generation with Pass/Fail/Code Fault classification.
 */

import {
    buildEnhancedResultsADF,
    buildSingleResultEnhancedADF,
    buildFallbackResultsADF,
} from '../../src/services/JiraCommentBuilder';
import { FailureClassificationService, FailureCategory } from '../../src/services/FailureClassificationService';

// Mock TestResult factory
function makeResult(overrides: Partial<any> = {}): any {
    return {
        testCaseId: 'TC-001',
        testCaseTitle: 'Login with valid credentials',
        status: 'PASS',
        duration: 3000,
        steps: [
            { stepNumber: 1, action: 'Enter username', expectedResult: 'Username field accepts input', status: 'PASS' },
            { stepNumber: 2, action: 'Click Login', expectedResult: 'User is redirected to dashboard', status: 'PASS' },
        ],
        errorMessage: null,
        ...overrides,
    };
}

function makeSummary(overrides: Partial<any> = {}): any {
    return {
        total: 5,
        passed: 3,
        failed: 2,
        skipped: 0,
        passRate: 60.0,
        ...overrides,
    };
}

describe('JiraCommentBuilder', () => {
    describe('buildEnhancedResultsADF', () => {
        it('produces valid ADF document structure', () => {
            const adf = buildEnhancedResultsADF([], makeSummary(), 'testing');
            expect(adf.version).toBe(1);
            expect(adf.type).toBe('doc');
            expect(Array.isArray(adf.content)).toBe(true);
        });

        it('includes test execution title and metadata', () => {
            const adf = buildEnhancedResultsADF([], makeSummary(), 'uat');
            const headings = adf.content.filter((n: any) => n.type === 'heading');
            expect(headings.length).toBeGreaterThan(0);
            expect(headings[0].content[0].text).toContain('Test Execution Results');
        });

        it('shows Pass | Failed | Code Fault | Skip stats in summary', () => {
            const adf = buildEnhancedResultsADF([], makeSummary({ passed: 3, failed: 1, skipped: 1 }), 'testing');
            // Stats paragraph should contain the text
            const paragraphs = adf.content.filter((n: any) => n.type === 'paragraph');
            const statsPara = paragraphs[1]; // Second paragraph after title
            const text = statsPara.content.map((c: any) => c.text).join('');
            expect(text).toContain('Pass: 3');
            expect(text).toContain('Skip: 1');
        });

        it('generates a table with 5 columns (Test Case, Status, Result, Duration, Root Cause)', () => {
            const adf = buildEnhancedResultsADF([], makeSummary());
            const tables = adf.content.filter((n: any) => n.type === 'table');
            expect(tables).toHaveLength(1);
            const headerRow = tables[0].content[0];
            expect(headerRow.content).toHaveLength(5);
        });

        it('classifies PASS results correctly', () => {
            const results = [makeResult()];
            const adf = buildEnhancedResultsADF(results, makeSummary({ passed: 1 }));
            const tables = adf.content.filter((n: any) => n.type === 'table');
            const dataRow = tables[0].content[1]; // First data row

            // Status column should show "✅ PASS"
            const statusCell = dataRow.content[1];
            const statusText = statusCell.content[0].content[0].text;
            expect(statusText).toContain('PASS');
        });

        it('classifies FAILED results (real defect) correctly', () => {
            const results = [makeResult({
                status: 'FAIL',
                errorMessage: 'Error: expect(received).toBe(expected). Expected: "dashboard", Received: "error-page"',
            })];
            const adf = buildEnhancedResultsADF(results, makeSummary({ passed: 0, failed: 1 }));
            const tables = adf.content.filter((n: any) => n.type === 'table');
            const dataRow = tables[0].content[1];

            const statusText = dataRow.content[1].content[0].content[0].text;
            expect(statusText).toContain('FAILED');
        });

        it('classifies EXECUTION_FAULT as CODE FAULT', () => {
            const results = [makeResult({
                status: 'FAIL',
                errorMessage: 'TypeError: Cannot read properties of undefined (reading "click")',
                isExecutionFault: true,
            })];
            const adf = buildEnhancedResultsADF(results, makeSummary({ passed: 0, failed: 1 }));
            const tables = adf.content.filter((n: any) => n.type === 'table');
            const dataRow = tables[0].content[1];

            const statusText = dataRow.content[1].content[0].content[0].text;
            expect(statusText).toContain('CODE FAULT');
        });

        it('includes root cause details for failed results', () => {
            const results = [makeResult({
                status: 'FAIL',
                errorMessage: 'Error: expect(received).toBe(expected)',
            })];
            const adf = buildEnhancedResultsADF(results, makeSummary({ passed: 0, failed: 1 }));

            // Should have panel sections for failure details
            const panels = adf.content.filter((n: any) => n.type === 'panel');
            expect(panels.length).toBeGreaterThan(0);
        });

        it('includes Excel report name when provided', () => {
            const adf = buildEnhancedResultsADF([], makeSummary(), 'testing', 'report.xlsx');
            const headings = adf.content.filter((n: any) => n.type === 'heading');
            const lastHeading = headings[headings.length - 1];
            expect(lastHeading.content[0].text).toContain('report.xlsx');
        });

        it('handles mixed results (Pass, Failed, Code Fault)', () => {
            const results = [
                makeResult({ testCaseId: 'TC-01', status: 'PASS' }),
                makeResult({ testCaseId: 'TC-02', status: 'PASS' }),
                makeResult({
                    testCaseId: 'TC-03',
                    status: 'FAIL',
                    errorMessage: 'Error: expect(received).toBe(expected)',
                }),
                makeResult({
                    testCaseId: 'TC-04',
                    status: 'FAIL',
                    errorMessage: 'TypeError: Cannot read properties of undefined',
                    isExecutionFault: true,
                }),
                makeResult({ testCaseId: 'TC-05', status: 'SKIP' }),
            ];

            const adf = buildEnhancedResultsADF(results, makeSummary({ passed: 2, failed: 2, skipped: 1 }));
            const tables = adf.content.filter((n: any) => n.type === 'table');
            expect(tables[0].content).toHaveLength(6); // 1 header + 5 data rows
        });
    });

    describe('buildSingleResultEnhancedADF', () => {
        it('produces valid ADF for a single PASS result', () => {
            const adf = buildSingleResultEnhancedADF(makeResult());
            expect(adf.version).toBe(1);
            expect(adf.type).toBe('doc');
        });

        it('includes PASS status with green color', () => {
            const adf = buildSingleResultEnhancedADF(makeResult());
            const paragraph = adf.content[0];
            const text = paragraph.content.map((c: any) => c.text).join('');
            expect(text).toContain('PASS');
        });

        it('includes root cause panel for FAIL result', () => {
            const adf = buildSingleResultEnhancedADF(makeResult({
                status: 'FAIL',
                errorMessage: 'Error: element not found',
            }));
            const panels = adf.content.filter((n: any) => n.type === 'panel');
            expect(panels.length).toBeGreaterThan(0);
        });

        it('does NOT include root cause panel for PASS result', () => {
            const adf = buildSingleResultEnhancedADF(makeResult());
            const panels = adf.content.filter((n: any) => n.type === 'panel');
            expect(panels.length).toBe(0);
        });
    });

    describe('buildFallbackResultsADF', () => {
        it('produces valid ADF bullet list format', () => {
            const adf = buildFallbackResultsADF([], makeSummary());
            expect(adf.version).toBe(1);
            expect(adf.type).toBe('doc');
            const bulletLists = adf.content.filter((n: any) => n.type === 'bulletList');
            expect(bulletLists.length).toBeGreaterThan(0);
        });

        it('includes Pass | Failed | Code Fault stats', () => {
            const results = [
                makeResult({ testCaseId: 'TC-01', status: 'PASS' }),
                makeResult({ testCaseId: 'TC-02', status: 'PASS' }),
                makeResult({ testCaseId: 'TC-03', status: 'PASS' }),
                makeResult({ testCaseId: 'TC-04', status: 'PASS' }),
                makeResult({ testCaseId: 'TC-05', status: 'FAIL', errorMessage: 'Error: expect(received).toBe(expected)' }),
            ];
            const adf = buildFallbackResultsADF(results, makeSummary({ passed: 4, failed: 1, skipped: 0 }));
            const paragraphs = adf.content.filter((n: any) => n.type === 'paragraph');
            const text = paragraphs.map((p: any) => p.content.map((c: any) => c.text).join('')).join('');
            expect(text).toContain('Pass: 4');
            expect(text).toContain('Failed: 1');
        });
    });
});
