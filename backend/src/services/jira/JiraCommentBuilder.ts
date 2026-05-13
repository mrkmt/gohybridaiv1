/**
 * JiraCommentBuilder
 *
 * Builds ADF (Atlassian Document Format) comments for Jira test result posting.
 * Produces Excel-style table format with Pass | Failed | Code Fault columns
 * plus root cause analysis logs explaining WHY failures occurred.
 *
 * This replaces the basic table format in JiraUploadService.buildResultsADF.
 */

import { TestResult, TestExecutionSummary } from '../execution/TestExecutionService';
import { FailureClassificationService, FailureCategory, ClassificationResult } from '../execution/FailureClassificationService';

// ─── Color Palette (Jira-compatible) ────────────────────────────

const COLORS = {
    pass: '#36B37E',       // Jira green
    fail: '#FF5630',       // Jira red
    fault: '#FFAB00',      // Jira yellow/orange
    skip: '#DFE1E6',       // Jira neutral
    passBg: '#E3FCEF',     // Light green background
    failBg: '#FFEBE6',     // Light red background
    faultBg: '#FFF0B3',    // Light yellow background
    skipBg: '#FAFBFC',     // Light gray background
    headerBg: '#091E42',   // Jira dark blue for headers
    headerText: '#FFFFFF',
    bodyText: '#172B4D',
    mutedText: '#6B778C',
};

// ─── Status Label Mapping ───────────────────────────────────────

interface StatusInfo {
    label: string;
    emoji: string;
    color: string;
    bgColor: string;
    category: 'PASS' | 'FAIL' | 'CODE_FAULT' | 'SKIP';
}

function classifyTestResult(result: TestResult): StatusInfo & { classification?: ClassificationResult } {
    const classification = result.status === 'FAIL'
        ? FailureClassificationService.classifyTestResult(result)
        : undefined;

    if (result.status === 'PASS') {
        return { label: 'PASS', emoji: '✅', color: COLORS.pass, bgColor: COLORS.passBg, category: 'PASS' };
    }

    if (result.status === 'FAIL') {
        // Code Fault = EXECUTION_FAULT, SYSTEM_ERROR, SELECTOR_ERROR (script issues)
        if (classification && (
            classification.category === FailureCategory.EXECUTION_FAULT ||
            classification.category === FailureCategory.SYSTEM_ERROR ||
            (classification.category === FailureCategory.SELECTOR_ERROR && classification.confidence > 0.85)
        )) {
            return {
                label: 'CODE FAULT',
                emoji: '⚠️',
                color: COLORS.fault,
                bgColor: COLORS.faultBg,
                category: 'CODE_FAULT',
                classification,
            };
        }
        // Real application defect
        return {
            label: 'FAILED',
            emoji: '❌',
            color: COLORS.fail,
            bgColor: COLORS.failBg,
            category: 'FAIL',
            classification,
        };
    }

    return { label: 'SKIP', emoji: '⏭️', color: COLORS.skip, bgColor: COLORS.skipBg, category: 'SKIP' };
}

// ─── ADF Helpers ────────────────────────────────────────────────

function safeText(val: any, fallback = '(none)'): string {
    if (val === undefined || val === null) return fallback;
    const str = String(val).trim();
    return str.length > 0 ? str : fallback;
}

function adfText(text: string, marks: any[] = []): any {
    return { type: 'text', text: text || '(none)', marks };
}

function adfParagraph(text: string, marks: any[] = []): any {
    return {
        type: 'paragraph',
        content: [adfText(text, marks)]
    };
}

function adfTableCell(text: string, isHeader = false, color?: string): any {
    const cellType = isHeader ? 'tableHeader' : 'tableCell';
    const textMarks: any[] = [];
    if (isHeader) textMarks.push({ type: 'strong' });
    if (color) textMarks.push({ type: 'textColor', attrs: { color } });

    return {
        type: cellType,
        attrs: { colspan: 1, rowspan: 1 },
        content: [{
            type: 'paragraph',
            content: [adfText(text, textMarks)]
        }]
    };
}

function adfHeading(level: number, text: string): any {
    return {
        type: 'heading',
        attrs: { level },
        content: [{ type: 'text', text: text, marks: [{ type: 'strong' }] }]
    };
}

// ─── Root Cause Log Builder ─────────────────────────────────────

function buildRootCauseLog(result: TestResult): string[] {
    const lines: string[] = [];
    const classification = result.status === 'FAIL'
        ? FailureClassificationService.classifyTestResult(result)
        : null;

    if (!classification) return lines;

    // Category label
    const categoryLabel = classification.isScriptIssue
        ? 'Test Script Issue'
        : classification.category === FailureCategory.NETWORK_ERROR
            ? 'Environment Issue'
            : classification.category === FailureCategory.ASSERTION_FAILURE
                ? 'Application Defect'
                : 'Needs Investigation';

    lines.push(`📋 Classification: ${categoryLabel}`);
    lines.push(`📂 Category: ${classification.category}`);
    lines.push(`🎯 Confidence: ${Math.round(classification.confidence * 100)}%`);
    lines.push(`🔧 Suggested Action: ${classification.suggestedAction}`);

    // Explanation
    if (classification.explanation) {
        lines.push(`💡 ${classification.explanation}`);
    }

    // Failed step details
    const failingStep = result.steps?.find(s => s.status === 'FAIL');
    if (failingStep) {
        lines.push('');
        lines.push(`─ Failed Step ─`);
        lines.push(`  Step #${failingStep.stepNumber}: ${safeText(failingStep.action, 'N/A')}`);
        lines.push(`  Expected: ${safeText(failingStep.expectedResult, 'N/A')}`);
        if (result.errorMessage) {
            // Truncate error message for readability
            const err = result.errorMessage.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI codes
            lines.push(`  Error: ${err.length > 300 ? err.substring(0, 300) + '...' : err}`);
        }
    }

    // AI insight if available
    if ((result as any).aiInsight) {
        const ai = (result as any).aiInsight;
        lines.push('');
        lines.push(`─ AI Analysis ─`);
        if (ai.likelyCause) lines.push(`  Likely Cause: ${ai.likelyCause}`);
        if (ai.suggestedFix) lines.push(`  Suggested Fix: ${ai.suggestedFix}`);
    }

    // Selector info for selector errors
    if (classification.category === FailureCategory.SELECTOR_ERROR && classification.fallbackSelectors?.length) {
        lines.push('');
        lines.push(`─ Fallback Selectors (${classification.fallbackSelectors.length} available) ─`);
        classification.fallbackSelectors.slice(0, 3).forEach((sel: string, i: number) => {
            lines.push(`  ${i + 1}. ${sel}`);
        });
    }

    return lines;
}

// ─── ADF Sanitization Middleware ────────────────────────────────

/**
 * Recursively sanitizes an ADF node in-place to ensure Jira compatibility.
 * Strips control characters, enforces max length, and ensures text nodes are not empty.
 */
function sanitizeAdfNode(node: any, depth: number = 0): any {
    if (!node || depth > 20) return node;

    // Handle array of nodes (like 'content' or 'marks')
    if (Array.isArray(node)) {
        node.forEach(child => sanitizeAdfNode(child, depth + 1));
        return node;
    }

    // Handle object nodes
    if (typeof node === 'object') {
        // 1. Sanitize text nodes
        if (node.type === 'text') {
            let text = String(node.text || '').trim();
            
            // Strip unprintable control characters (keep \n, \r, \t)
            // Range: [\x00-\x08\x0B\x0C\x0E-\x1F\x7F]
            text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

            // Ensure non-empty (Jira requirement)
            if (text.length === 0) {
                text = '(empty)';
            }

            // Enforce max length (Jira text node limit is ~32KB, we use 30,000 for safety)
            if (text.length > 30000) {
                text = text.substring(0, 29900) + '... [truncated due to length]';
            }

            node.text = text;
        }

        // 2. Recursively sanitize children/content
        if (node.content && Array.isArray(node.content)) {
            sanitizeAdfNode(node.content, depth + 1);
        }
        
        // 3. Recursively sanitize marks
        if (node.marks && Array.isArray(node.marks)) {
            sanitizeAdfNode(node.marks, depth + 1);
        }
    }

    return node;
}

// ─── Main Comment Builders ──────────────────────────────────────

/**
 * Build the enhanced Excel-style summary table ADF.
 *
 * Columns: Test Case | Status | Result | Duration | Root Cause
 * Where Result = PASS | FAILED | CODE FAULT | SKIP
 */
export function buildEnhancedResultsADF(
    results: TestResult[],
    summary: TestExecutionSummary,
    environment?: string,
    excelReportName?: string,
    artifacts?: { zipUploaded?: boolean; htmlReportUploaded?: boolean; excelUploaded?: boolean }
): any {
    const timestamp = new Date().toLocaleString();

    // Calculate fault stats
    const faultCount = results.filter(r => {
        if (r.status !== 'FAIL') return false;
        const c = FailureClassificationService.classifyTestResult(r);
        return c.category === FailureCategory.EXECUTION_FAULT ||
               c.category === FailureCategory.SYSTEM_ERROR ||
               (c.category === FailureCategory.SELECTOR_ERROR && c.confidence > 0.85);
    }).length;
    const realFailCount = results.filter(r => r.status === 'FAIL').length - faultCount;

    const content: any[] = [
        // Title
        adfHeading(2, '🧪 Test Execution Results'),

        // Metadata line
        adfParagraph(`Executed: ${timestamp} | Environment: ${environment || 'testing'}`),

        // Stats bar with color coding
        {
            type: 'paragraph',
            content: [
                adfText(`✅ Pass: ${summary.passed}`, [{ type: 'strong' }, { type: 'textColor', attrs: { color: COLORS.pass } }]),
                adfText(' | '),
                adfText(`❌ Failed: ${realFailCount}`, [{ type: 'strong' }, { type: 'textColor', attrs: { color: COLORS.fail } }]),
                adfText(' | '),
                adfText(`⚠️ Code Fault: ${faultCount}`, [{ type: 'strong' }, { type: 'textColor', attrs: { color: COLORS.fault } }]),
                adfText(' | '),
                adfText(`⏭️ Skip: ${summary.skipped}`, [{ type: 'strong' }, { type: 'textColor', attrs: { color: COLORS.skip } }]),
                adfText(' | '),
                adfText(`Pass Rate: ${summary.passRate.toFixed(1)}%`, [{ type: 'strong' }]),
            ]
        },

        // ─── Summary Table ───
        {
            type: 'table',
            attrs: { layout: 'fixed-width' },
            content: [
                // Header row
                {
                    type: 'tableRow',
                    content: [
                        adfTableCell('Test Case', true, COLORS.headerText),
                        adfTableCell('Status', true, COLORS.headerText),
                        adfTableCell('Result', true, COLORS.headerText),
                        adfTableCell('Duration', true, COLORS.headerText),
                        adfTableCell('Root Cause', true, COLORS.headerText),
                    ]
                },
                // Data rows
                ...results.map(r => {
                    const info = classifyTestResult(r);
                    const errorSnippet = r.status === 'FAIL' && r.errorMessage
                        ? r.errorMessage.replace(/\x1b\[[0-9;]*m/g, '').substring(0, 80)
                        : '-';

                    return {
                        type: 'tableRow',
                        content: [
                            // Test Case
                            adfTableCell(`${r.testCaseId}: ${safeText(r.testCaseTitle).substring(0, 40)}`),
                            // Status (color-coded)
                            adfTableCell(
                                `${info.emoji} ${info.label}`,
                                false,
                                info.color
                            ),
                            // Result (PASS | FAILED | CODE FAULT | SKIP)
                            adfTableCell(
                                info.category === 'PASS' ? '✅ PASS' :
                                info.category === 'FAIL' ? '❌ FAILED' :
                                info.category === 'CODE_FAULT' ? '⚠️ CODE FAULT' :
                                '⏭️ SKIP',
                                false,
                                info.color
                            ),
                            // Duration
                            adfTableCell(`${(r.duration / 1000).toFixed(1)}s`),
                            // Root Cause (abbreviated)
                            adfTableCell(
                                info.category === 'PASS' ? '-' :
                                info.classification?.explanation?.substring(0, 100) || errorSnippet || '-'
                            ),
                        ]
                    };
                }),
            ]
        },
    ];

    // ─── Failure Detail Sections ───
    const failedResults = results.filter(r => r.status === 'FAIL');
    for (const r of failedResults) {
        const info = classifyTestResult(r);
        const rootCauseLines = buildRootCauseLog(r);

        // Section heading
        content.push({
            type: 'heading',
            attrs: { level: 4 },
            content: [{
                type: 'text',
                text: `${info.emoji} ${r.testCaseId}: ${safeText(r.testCaseTitle)}`,
                marks: [{ type: 'strong' }, { type: 'textColor', attrs: { color: info.color } }]
            }]
        });

        // Root cause panel
        content.push({
            type: 'panel',
            attrs: { panelType: info.category === 'CODE_FAULT' ? 'warning' : 'info' },
            content: rootCauseLines.map(line => adfParagraph(line))
        });
    }

    // ─── Footer — only mention artifacts that were actually uploaded ───
    const uploadedArtifacts: string[] = [];
    if (artifacts?.zipUploaded) uploadedArtifacts.push('ZIP bundle');
    if (artifacts?.htmlReportUploaded) uploadedArtifacts.push('HTML Report');
    if (artifacts?.excelUploaded) uploadedArtifacts.push('Excel Report');

    if (uploadedArtifacts.length > 0) {
        content.push(
            adfParagraph(`📎 Attached: ${uploadedArtifacts.join(', ')}.`)
        );
    } else {
        content.push(
            adfParagraph('⚠️ Artifact upload failed — no files are attached.')
        );
    }

    if (excelReportName) {
        content.push(adfHeading(4, `📊 Attached: ${excelReportName}`));
    }

    const adfDoc = {
        version: 1,
        type: 'doc',
        content,
    };

    // Apply sanitization middleware before returning
    return sanitizeAdfNode(adfDoc);
}

/**
 * Build a simple single-result ADF comment (for per-test-case comments).
 */
export function buildSingleResultEnhancedADF(result: TestResult, environment?: string): any {
    const info = classifyTestResult(result);
    const timestamp = new Date().toLocaleString();

    const content: any[] = [
        {
            type: 'paragraph',
            content: [
                adfText(`${info.emoji} ${info.label}`, [{ type: 'strong' }, { type: 'textColor', attrs: { color: info.color } }]),
                adfText(' | '),
                adfText(`${result.testCaseId}: ${safeText(result.testCaseTitle)}`, [{ type: 'strong' }]),
                adfText(` | ${(result.duration / 1000).toFixed(1)}s | Env: ${environment || 'N/A'}`)
            ]
        }
    ];

    // Add root cause analysis for failures
    if (result.status === 'FAIL') {
        const rootCauseLines = buildRootCauseLog(result);
        content.push({
            type: 'panel',
            attrs: { panelType: info.category === 'CODE_FAULT' ? 'warning' : 'info' },
            content: rootCauseLines.map(line => adfParagraph(line))
        });
    }

    const adfDoc = {
        version: 1,
        type: 'doc',
        content,
    };

    return sanitizeAdfNode(adfDoc);
}

/**
 * Build a simple summary paragraph ADF (fallback when tables are rejected).
 */
export function buildFallbackResultsADF(
    results: TestResult[],
    summary: TestExecutionSummary,
    environment?: string
): any {
    const faultCount = results.filter(r => {
        if (r.status !== 'FAIL') return false;
        const c = FailureClassificationService.classifyTestResult(r);
        return c.category === FailureCategory.EXECUTION_FAULT || c.category === FailureCategory.SYSTEM_ERROR;
    }).length;
    const realFailCount = results.filter(r => r.status === 'FAIL').length - faultCount;

    const adfDoc = {
        version: 1,
        type: 'doc',
        content: [
            adfHeading(3, 'Test Execution Summary'),
            {
                type: 'paragraph',
                content: [
                    adfText(`Environment: ${environment || 'testing'}`),
                ]
            },
            {
                type: 'paragraph',
                content: [
                    adfText(`✅ Pass: ${summary.passed}`, [{ type: 'strong' }, { type: 'textColor', attrs: { color: COLORS.pass } }]),
                    adfText(' | '),
                    adfText(`❌ Failed: ${realFailCount}`, [{ type: 'strong' }, { type: 'textColor', attrs: { color: COLORS.fail } }]),
                    adfText(' | '),
                    adfText(`⚠️ Code Fault: ${faultCount}`, [{ type: 'strong' }, { type: 'textColor', attrs: { color: COLORS.fault } }]),
                    adfText(' | '),
                    adfText(`⏭️ Skip: ${summary.skipped}`, [{ type: 'strong' }]),
                ]
            },
            {
                type: 'bulletList',
                content: results.map(r => {
                    const info = classifyTestResult(r);
                    return {
                        type: 'listItem',
                        content: [{
                            type: 'paragraph',
                            content: [
                                adfText(`${info.emoji} ${info.label} `, [{ type: 'textColor', attrs: { color: info.color } }]),
                                adfText(`${r.testCaseId}: ${safeText(r.testCaseTitle)}`),
                                ...(r.status === 'FAIL' && r.errorMessage ? [
                                    adfText(` (${r.errorMessage.replace(/\x1b\[[0-9;]*m/g, '').substring(0, 80)})`)
                                ] : []),
                            ]
                        }]
                    };
                })
            }
        ]
    };

    return sanitizeAdfNode(adfDoc);
}
