/**
 * Comprehensive Report Generator
 *
 * Generates multi-format test reports:
 * - HTML Dashboard with interactive charts, per-module breakdown
 * - JSON report for machine consumption
 * - Markdown summary for documentation
 * - CSV export for spreadsheet analysis
 *
 * @author GoHybrid AI Team
 * @date April 3, 2026
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestResult, TestCase } from './TestCaseBuilder';
import { TestScenario } from './ScenarioManager';

// ============================================================================
// TYPES
// ============================================================================

export interface ModuleReport {
    moduleName: string;
    ticketId: string;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    blocked: number;
    passRate: number;
    totalDuration: number;
    results: TestResult[];
}

export interface FullReport {
    generatedAt: string;
    ticketId: string;
    title: string;
    summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        blocked: number;
        passRate: number;
        totalDuration: number;
    };
    modules: ModuleReport[];
    results: TestResult[];
    artifacts: {
        screenshots: string[];
        videos: string[];
        traces: string[];
    };
}

// ============================================================================
// REPORT GENERATOR
// ============================================================================

export class ReportGenerator {

    /**
     * Generate full report from test results
     */
    static generate(
        ticketId: string,
        title: string,
        results: TestResult[],
        scenarios: TestScenario[] = [],
        artifacts: { screenshots: string[]; videos: string[]; traces: string[] } = { screenshots: [], videos: [], traces: [] }
    ): FullReport {

        const modules = this.groupByModule(results, scenarios);
        const total = results.length;
        const passed = results.filter(r => r.status === 'PASS').length;
        const failed = results.filter(r => r.status === 'FAIL').length;
        const skipped = results.filter(r => r.status === 'SKIP').length;
        const blocked = results.filter(r => r.status === 'BLOCKED').length;
        const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

        return {
            generatedAt: new Date().toISOString(),
            ticketId,
            title,
            summary: {
                total,
                passed,
                failed,
                skipped,
                blocked,
                passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
                totalDuration
            },
            modules,
            results,
            artifacts
        };
    }

    /**
     * Group results by module
     */
    private static groupByModule(results: TestResult[], scenarios: TestScenario[]): ModuleReport[] {
        const moduleMap = new Map<string, TestResult[]>();

        for (const result of results) {
            // Find scenario to get module name
            const scenario = scenarios.find(s => s.id === result.scenarioId);
            const moduleName = scenario?.module || 'Unknown';

            if (!moduleMap.has(moduleName)) {
                moduleMap.set(moduleName, []);
            }
            moduleMap.get(moduleName)!.push(result);
        }

        const modules: ModuleReport[] = [];
        for (const [moduleName, moduleResults] of moduleMap) {
            const passed = moduleResults.filter(r => r.status === 'PASS').length;
            const failed = moduleResults.filter(r => r.status === 'FAIL').length;
            const skipped = moduleResults.filter(r => r.status === 'SKIP').length;
            const blocked = moduleResults.filter(r => r.status === 'BLOCKED').length;
            const total = moduleResults.length;
            const totalDuration = moduleResults.reduce((sum, r) => sum + r.duration, 0);

            modules.push({
                moduleName,
                ticketId: moduleResults[0]?.testCaseId.split('-').slice(0, 2).join('-') || '',
                total,
                passed,
                failed,
                skipped,
                blocked,
                passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
                totalDuration,
                results: moduleResults
            });
        }

        return modules.sort((a, b) => b.total - a.total);
    }

    // ============================================================================
    // HTML DASHBOARD
    // ============================================================================

    static generateHtmlDashboard(report: FullReport): string {
        const { summary, modules, results, generatedAt, ticketId, title } = report;

        const formatDuration = (ms: number): string => {
            if (ms < 1000) return `${ms}ms`;
            if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
            const mins = Math.floor(ms / 60000);
            const secs = Math.floor((ms % 60000) / 1000);
            return `${mins}m ${secs}s`;
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Report — ${ticketId}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { text-align: center; padding: 30px 0; border-bottom: 1px solid #21262d; margin-bottom: 30px; }
        .header h1 { font-size: 2em; color: #58a6ff; margin-bottom: 10px; }
        .header p { color: #8b949e; }

        /* Summary Cards */
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 30px; }
        .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; text-align: center; }
        .card .number { font-size: 2.5em; font-weight: bold; margin-bottom: 5px; }
        .card .label { color: #8b949e; font-size: 0.9em; }
        .card.pass .number { color: #3fb950; }
        .card.fail .number { color: #f85149; }
        .card.skip .number { color: #d29922; }
        .card.block .number { color: #a371f7; }
        .card.rate .number { color: #58a6ff; }

        /* Pass Rate Bar */
        .rate-bar { width: 100%; height: 12px; background: #21262d; border-radius: 6px; overflow: hidden; margin: 10px 0; }
        .rate-fill { height: 100%; background: linear-gradient(90deg, #f85149 0%, #d29922 50%, #3fb950 100%); border-radius: 6px; transition: width 0.5s; }

        /* Module Table */
        .module-section { margin-bottom: 30px; }
        .module-section h2 { color: #58a6ff; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 1px solid #21262d; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #21262d; }
        th { background: #161b22; color: #8b949e; font-weight: 600; }
        tr:hover { background: #1c2128; }
        .status { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 0.85em; font-weight: 600; }
        .status.pass { background: #238636; color: #fff; }
        .status.fail { background: #da3633; color: #fff; }
        .status.skip { background: #9e6a03; color: #fff; }
        .status.block { background: #6e40c9; color: #fff; }

        /* Test Results */
        .result-detail { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
        .result-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; cursor: pointer; }
        .result-header:hover { background: #1c2128; }
        .result-body { padding: 16px; display: none; }
        .result-body.open { display: block; }
        .step { padding: 8px 0; border-bottom: 1px solid #21262d; }
        .step:last-child { border-bottom: none; }
        .step.pass { border-left: 3px solid #3fb950; padding-left: 12px; }
        .step.fail { border-left: 3px solid #f85149; padding-left: 12px; }
        .error { color: #f85149; font-family: monospace; font-size: 0.9em; background: #1c0d0d; padding: 8px; border-radius: 4px; margin-top: 4px; }

        /* Footer */
        .footer { text-align: center; padding: 20px 0; color: #484f58; font-size: 0.85em; border-top: 1px solid #21262d; margin-top: 30px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧪 Test Report: ${title}</h1>
            <p>Ticket: <strong>${ticketId}</strong> | Generated: ${new Date(generatedAt).toLocaleString()}</p>
        </div>

        <!-- Summary Cards -->
        <div class="summary-grid">
            <div class="card">
                <div class="number">${summary.total}</div>
                <div class="label">Total Tests</div>
            </div>
            <div class="card pass">
                <div class="number">${summary.passed}</div>
                <div class="label">Passed</div>
            </div>
            <div class="card fail">
                <div class="number">${summary.failed}</div>
                <div class="label">Failed</div>
            </div>
            <div class="card skip">
                <div class="number">${summary.skipped}</div>
                <div class="label">Skipped</div>
            </div>
            <div class="card block">
                <div class="number">${summary.blocked}</div>
                <div class="label">Blocked</div>
            </div>
            <div class="card rate">
                <div class="number">${summary.passRate}%</div>
                <div class="label">Pass Rate</div>
                <div class="rate-bar"><div class="rate-fill" style="width: ${summary.passRate}%"></div></div>
            </div>
        </div>

        <div style="text-align: center; margin-bottom: 20px; color: #8b949e;">
            Total Duration: <strong>${formatDuration(summary.totalDuration)}</strong>
        </div>

        <!-- Module Breakdown -->
        <div class="module-section">
            <h2>📊 Module Breakdown</h2>
            <table>
                <thead>
                    <tr>
                        <th>Module</th>
                        <th>Total</th>
                        <th>Passed</th>
                        <th>Failed</th>
                        <th>Pass Rate</th>
                        <th>Duration</th>
                    </tr>
                </thead>
                <tbody>
                    ${modules.map(m => `
                    <tr>
                        <td><strong>${m.moduleName}</strong></td>
                        <td>${m.total}</td>
                        <td style="color: #3fb950">${m.passed}</td>
                        <td style="color: #f85149">${m.failed}</td>
                        <td>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div class="rate-bar" style="width: 100px; margin: 0;"><div class="rate-fill" style="width: ${m.passRate}%"></div></div>
                                <span>${m.passRate}%</span>
                            </div>
                        </td>
                        <td>${formatDuration(m.totalDuration)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>

        <!-- Test Results -->
        <div class="module-section">
            <h2>📋 Test Results (${results.length})</h2>
            ${results.map((r, i) => `
            <div class="result-detail">
                <div class="result-header" onclick="document.getElementById('body-${i}').classList.toggle('open')">
                    <span><strong>${r.testCaseId}</strong>: ${r.title}</span>
                    <span class="status ${r.status.toLowerCase()}">${r.status}</span>
                </div>
                <div id="body-${i}" class="result-body">
                    ${r.error ? `<div class="error">Error: ${r.error}</div>` : ''}
                    <div style="margin-top: 10px;">
                        ${(r.stepResults || []).map(s => `
                        <div class="step ${s.status.toLowerCase()}">
                            <strong>Step ${s.stepNumber}:</strong> ${s.action}
                            <span style="float: right; color: ${s.status === 'PASS' ? '#3fb950' : '#f85149'}">${s.status} (${s.duration}ms)</span>
                            ${s.error ? `<div class="error">${s.error}</div>` : ''}
                        </div>`).join('')}
                    </div>
                    ${r.screenshotPath ? `<div style="margin-top: 12px;"><a href="${r.screenshotPath}" target="_blank" style="color: #58a6ff;">📸 View Screenshot</a></div>` : ''}
                </div>
            </div>`).join('')}
        </div>

        <div class="footer">
            Generated by GoHybrid AI — Test Report Engine
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Save report to all formats
     */
    static saveReport(report: FullReport, outputDir: string = 'test-results'): { html: string; json: string; markdown: string; csv: string } {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const baseName = `test-report-${report.ticketId}-${timestamp}`;

        // HTML
        const htmlContent = this.generateHtmlDashboard(report);
        const htmlPath = path.join(outputDir, `${baseName}.html`);
        fs.writeFileSync(htmlPath, htmlContent);

        // JSON
        const jsonPath = path.join(outputDir, `${baseName}.json`);
        fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

        // Markdown
        const mdContent = this.generateMarkdown(report);
        const mdPath = path.join(outputDir, `${baseName}.md`);
        fs.writeFileSync(mdPath, mdContent);

        // CSV
        const csvContent = this.generateCSV(report);
        const csvPath = path.join(outputDir, `${baseName}.csv`);
        fs.writeFileSync(csvPath, csvContent);

        console.log(`\n📊 Reports saved to ${outputDir}/`);
        console.log(`  🌐 HTML:   ${htmlPath}`);
        console.log(`  📄 JSON:   ${jsonPath}`);
        console.log(`  📝 Markdown: ${mdPath}`);
        console.log(`  📊 CSV:    ${csvPath}`);

        return { html: htmlPath, json: jsonPath, markdown: mdPath, csv: csvPath };
    }

    /**
     * Generate Markdown report
     */
    static generateMarkdown(report: FullReport): string {
        const { summary, modules, results, generatedAt, ticketId, title } = report;
        const formatDuration = (ms: number): string => {
            if (ms < 1000) return `${ms}ms`;
            if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
            return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
        };

        let md = `# Test Report: ${title}\n\n`;
        md += `**Ticket:** ${ticketId} | **Generated:** ${new Date(generatedAt).toLocaleString()}\n\n`;
        md += `## Summary\n\n`;
        md += `| Metric | Value |\n|--------|-------|\n`;
        md += `| Total | ${summary.total} |\n`;
        md += `| ✅ Passed | ${summary.passed} |\n`;
        md += `| ❌ Failed | ${summary.failed} |\n`;
        md += `| ⏭️ Skipped | ${summary.skipped} |\n`;
        md += `| 🚫 Blocked | ${summary.blocked} |\n`;
        md += `| Pass Rate | ${summary.passRate}% |\n`;
        md += `| Duration | ${formatDuration(summary.totalDuration)} |\n\n`;

        md += `## Module Breakdown\n\n`;
        md += `| Module | Total | Passed | Failed | Pass Rate |\n|--------|-------|--------|--------|----------|\n`;
        for (const m of modules) {
            md += `| ${m.moduleName} | ${m.total} | ${m.passed} | ${m.failed} | ${m.passRate}% |\n`;
        }

        md += `\n## Test Results\n\n`;
        for (const r of results) {
            const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : r.status === 'SKIP' ? '⏭️' : '🚫';
            md += `### ${icon} ${r.testCaseId}: ${r.title}\n\n`;
            md += `**Status:** ${r.status} | **Duration:** ${formatDuration(r.duration)}\n\n`;
            if (r.error) md += `**Error:** \`${r.error}\`\n\n`;
            md += `| Step | Action | Status |\n|------|--------|--------|\n`;
            for (const s of r.stepResults) {
                const sIcon = s.status === 'PASS' ? '✅' : '❌';
                md += `| ${s.stepNumber} | ${s.action} | ${sIcon} ${s.status} |\n`;
            }
            md += '\n';
        }

        return md;
    }

    /**
     * Generate CSV report
     */
    static generateCSV(report: FullReport): string {
        const lines: string[] = [];
        lines.push('TestCaseID,ScenarioID,Title,LinkedRequirement,Module,Status,Duration(ms),Error,Steps');

        for (const r of report.results) {
            const stepSummary = (r.stepResults || []).map(s => `Step${s.stepNumber}:${s.status}`).join('; ');
            lines.push([
                `"${r.testCaseId}"`,
                `"${r.scenarioId}"`,
                `"${r.title.replace(/"/g, '""')}"`,
                `"${(r.linkedRequirement || '').replace(/"/g, '""')}"`,
                `"${(r.stepResults || []).length}"`,
                r.status,
                r.duration,
                `"${(r.error || '').replace(/"/g, '""')}"`,
                `"${stepSummary}"`
            ].join(','));
        }

        return lines.join('\n');
    }
}
