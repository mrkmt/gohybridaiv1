/**
 * HtmlReportGeneratorService
 * 
 * Professional single-file HTML report generator with:
 * - Modern, clean design (no emojis)
 * - Embedded screenshots (base64)
 * - Embedded videos (base64 or optimized webm)
 * - Interactive charts (Chart.js)
 * - Professional color scheme
 * - All in ONE standalone HTML file
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestCase } from './generation/TestCaseGeneratorService';
import { TestResult } from './execution/TestExecutionService';
import { appLogger } from '../utils/logger';

export class HtmlReportGeneratorService {
    /**
     * Generate professional single-file HTML report
     */
    static async generateReport(
        ticketId: string,
        testCases: TestCase[],
        results: TestResult[],
        environment: string,
        executedAt: Date
    ): Promise<string> {
        const summary = this.calculateSummary(results);
        const chartData = this.prepareChartData(results);
        
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${ticketId} - Test Execution Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>${this.getStyles()}</style>
</head>
<body>
    ${this.generateDashboard(ticketId, summary, executedAt, environment)}
    ${this.generateCharts(chartData)}
    ${this.generateTestCases(results)}
    ${this.generateFooter(executedAt)}
    <script>${this.getScripts()}</script>
</body>
</html>`;

        const filePath = path.join(
            process.cwd(),
            'test-results',
            ticketId,
            `${ticketId}_Report_${Date.now()}.html`
        );

        fs.writeFileSync(filePath, html, 'utf8');
        appLogger.info(`[HtmlReport] Report generated: ${filePath}`);
        
        return filePath;
    }

    /**
     * Calculate execution summary
     */
    private static calculateSummary(results: TestResult[]) {
        const total = results.length;
        const passed = results.filter(r => r.status === 'PASS').length;
        const failed = results.filter(r => r.status === 'FAIL').length;
        const skipped = results.filter(r => r.status === 'SKIPPED').length;
        const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
        const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
        const avgDuration = total > 0 ? Math.round(totalDuration / total) : 0;

        return { total, passed, failed, skipped, passRate, totalDuration, avgDuration };
    }

    /**
     * Prepare chart data
     */
    private static prepareChartData(results: TestResult[]) {
        const statusCount = {
            PASS: results.filter(r => r.status === 'PASS').length,
            FAIL: results.filter(r => r.status === 'FAIL').length,
            SKIPPED: results.filter(r => r.status === 'SKIPPED').length
        };

        const durationData = results.map(r => ({
            name: r.testCaseId,
            duration: Math.round(r.duration / 1000 * 10) / 10
        }));

        return { statusCount, durationData };
    }

    /**
     * Generate dashboard header
     */
    private static generateDashboard(
        ticketId: string,
        summary: any,
        executedAt: Date,
        environment: string
    ): string {
        const statusColor = summary.passRate >= 80 ? 'success' : summary.passRate >= 50 ? 'warning' : 'danger';
        
        return `
<div class="container">
    <header class="main-header">
        <div class="header-top">
            <div>
                <h1>Test Execution Report</h1>
                <p class="subtitle">${ticketId}</p>
            </div>
            <div class="status-badge ${statusColor}">
                <span class="status-label">Pass Rate</span>
                <span class="status-value">${summary.passRate}%</span>
            </div>
        </div>
        <div class="meta-info">
            <div class="meta-item">
                <span class="meta-label">Executed</span>
                <span class="meta-value">${executedAt.toLocaleString('en-US', { timeZone: 'Asia/Yangon', dateStyle: 'medium', timeStyle: 'short' })}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Environment</span>
                <span class="meta-value">${environment}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Total Duration</span>
                <span class="meta-value">${(summary.totalDuration / 1000).toFixed(2)}s</span>
            </div>
        </div>
    </header>

    <!-- KPI Cards -->
    <div class="kpi-grid">
        <div class="kpi-card pass">
            <div class="kpi-value">${summary.passed}</div>
            <div class="kpi-label">Passed</div>
        </div>
        <div class="kpi-card fail">
            <div class="kpi-value">${summary.failed}</div>
            <div class="kpi-label">Failed</div>
        </div>
        <div class="kpi-card skipped">
            <div class="kpi-value">${summary.skipped}</div>
            <div class="kpi-label">Skipped</div>
        </div>
        <div class="kpi-card total">
            <div class="kpi-value">${summary.total}</div>
            <div class="kpi-label">Total</div>
        </div>
        <div class="kpi-card rate ${statusColor}">
            <div class="kpi-value">${summary.passRate}%</div>
            <div class="kpi-label">Pass Rate</div>
        </div>
        <div class="kpi-card avg">
            <div class="kpi-value">${(summary.avgDuration / 1000).toFixed(2)}s</div>
            <div class="kpi-label">Avg Duration</div>
        </div>
    </div>
</div>`;
    }

    /**
     * Generate charts section
     */
    private static generateCharts(chartData: any): string {
        return `
<div class="section charts-section">
    <div class="section-header">
        <h2>Analytics</h2>
    </div>
    <div class="charts-grid">
        <div class="chart-container">
            <h3>Status Distribution</h3>
            <canvas id="statusChart"></canvas>
        </div>
        <div class="chart-container">
            <h3>Test Duration</h3>
            <canvas id="durationChart"></canvas>
        </div>
    </div>
</div>

<script>
    const chartColors = {
        pass: 'rgb(34, 197, 94)',
        fail: 'rgb(239, 68, 68)',
        skipped: 'rgb(107, 114, 128)',
        primary: 'rgb(59, 130, 246)'
    };

    new Chart(document.getElementById('statusChart'), {
        type: 'doughnut',
        data: {
            labels: ['Passed', 'Failed', 'Skipped'],
            datasets: [{
                data: [${chartData.statusCount.PASS}, ${chartData.statusCount.FAIL}, ${chartData.statusCount.SKIPPED}],
                backgroundColor: [chartColors.pass, chartColors.fail, chartColors.skipped],
                borderWidth: 0
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 15, usePointStyle: true }
                }
            }
        }
    });

    new Chart(document.getElementById('durationChart'), {
        type: 'bar',
        data: {
            labels: [${chartData.durationData.map((d: any) => `'${d.name}'`).join(', ')}],
            datasets: [{
                label: 'Duration (seconds)',
                data: [${chartData.durationData.map((d: any) => d.duration).join(', ')}],
                backgroundColor: chartColors.primary,
                borderRadius: 4
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: true,
            plugins: { legend: { display: false } },
            scales: { 
                y: { 
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.05)' }
                },
                x: { grid: { display: false } }
            }
        }
    });
</script>`;
    }

    /**
     * Generate test cases section
     */
    private static generateTestCases(results: TestResult[]): string {
        const passedCount = results.filter(r => r.status === 'PASS').length;
        const failedCount = results.filter(r => r.status === 'FAIL').length;
        const skippedCount = results.filter(r => r.status === 'SKIPPED').length;

        return `
<div class="section test-cases-section">
    <div class="section-header">
        <h2>Test Cases</h2>
        <div class="test-filters">
            <button class="filter-btn active" data-filter="all">All (${results.length})</button>
            <button class="filter-btn pass" data-filter="pass">Passed (${passedCount})</button>
            <button class="filter-btn fail" data-filter="fail">Failed (${failedCount})</button>
            <button class="filter-btn skipped" data-filter="skipped">Skipped (${skippedCount})</button>
        </div>
    </div>
    <div class="test-cases-list">
        ${results.map(result => this.generateTestCase(result)).join('\n')}
    </div>
</div>`;
    }

    /**
     * Generate single test case with embedded media
     */
    private static generateTestCase(result: TestResult): string {
        const statusClass = result.status.toLowerCase();
        
        // Embed screenshots as base64
        const embeddedScreenshots = result.screenshotPaths.map(screenshotPath => {
            try {
                if (fs.existsSync(screenshotPath)) {
                    const imageBuffer = fs.readFileSync(screenshotPath);
                    const base64 = imageBuffer.toString('base64');
                    return `data:image/png;base64,${base64}`;
                }
            } catch (e: any) {
                appLogger.error('Error embedding screenshot', { error: e.message, path: screenshotPath });
            }
            return null;
        }).filter(Boolean);

        // Embed video if exists and is reasonable size
        let embeddedVideo: string | null = null;
        let videoSize = 0;
        if (result.videoPath && fs.existsSync(result.videoPath)) {
            const stats = fs.statSync(result.videoPath);
            videoSize = Math.round(stats.size / (1024 * 1024));
            if (videoSize < 15) { // Embed if < 15MB
                try {
                    const videoBuffer = fs.readFileSync(result.videoPath);
                    const base64 = videoBuffer.toString('base64');
                    embeddedVideo = `data:video/webm;base64,${base64}`;
                } catch (e: any) {
                    appLogger.error('Error embedding video', { error: e.message, path: result.videoPath });
                }
            }
        }

        return `
<div class="test-case ${statusClass}" data-status="${statusClass}">
    <div class="test-case-header" onclick="toggleTestCase(this)">
        <div class="test-case-info">
            <div class="test-case-id">${result.testCaseId}</div>
            <div class="test-case-title">${result.testCaseTitle}</div>
        </div>
        <div class="test-case-meta">
            <span class="status-badge-sm ${statusClass}">${result.status}</span>
            <span class="duration-badge">${(result.duration / 1000).toFixed(2)}s</span>
            <span class="toggle-icon"></span>
        </div>
    </div>
    
    <div class="test-case-body">
        <div class="test-info-grid">
            ${result.linkedRequirement ? `
            <div class="info-item">
                <span class="info-label">Linked Requirement</span>
                <span class="info-value">${result.linkedRequirement}</span>
            </div>` : ''}
            <div class="info-item">
                <span class="info-label">Environment</span>
                <span class="info-value">${result.environment}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Executed</span>
                <span class="info-value">${new Date(result.executedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </div>
            ${result.uiStack ? `
            <div class="info-item">
                <span class="info-label">UI Stack</span>
                <span class="info-value">
                    <span class="stack-badge ${result.uiStack.toLowerCase().replace(' ', '-')}">${result.uiStack}</span>
                </span>
            </div>` : ''}
        </div>

        <!-- Test Steps -->
        ${result.steps && result.steps.length > 0 ? `
        <div class="subsection">
            <div class="subsection-header" onclick="toggleSection(this)">
                <h4>Test Steps (${result.steps.length})</h4>
                <span class="toggle-icon-sm"></span>
            </div>
            <div class="steps-list">
                ${result.steps.map((step, i) => `
                <div class="step ${step.status.toLowerCase()}">
                    <div class="step-header">
                        <span class="step-number">Step ${step.stepNumber || i + 1}</span>
                        <span class="step-status ${step.status.toLowerCase()}">${step.status}</span>
                    </div>
                    <div class="step-content">
                        <div class="step-row">
                            <span class="step-label">Action</span>
                            <span class="step-value">${step.action}</span>
                        </div>
                        <div class="step-row">
                            <span class="step-label">Expected</span>
                            <span class="step-value">${step.expectedResult}</span>
                        </div>
                        ${step.actualResult ? `
                        <div class="step-row">
                            <span class="step-label">Actual</span>
                            <span class="step-value">${step.actualResult}</span>
                        </div>` : ''}
                        ${step.errorMessage ? `
                        <div class="step-row error">
                            <span class="step-label">Error</span>
                            <span class="step-value">${step.errorMessage}</span>
                        </div>` : ''}
                    </div>
                </div>`).join('\n')}
            </div>
        </div>` : ''}

        <!-- Screenshots Gallery -->
        ${embeddedScreenshots.length > 0 ? `
        <div class="subsection">
            <div class="subsection-header" onclick="toggleSection(this)">
                <h4>Screenshots (${embeddedScreenshots.length})</h4>
                <span class="toggle-icon-sm"></span>
            </div>
            <div class="screenshot-gallery">
                ${embeddedScreenshots.map((src, i) => `
                <div class="screenshot-item" onclick="viewImage(this, '${src}')">
                    <img src="${src}" alt="Screenshot ${i + 1}" loading="lazy">
                </div>`).join('\n')}
            </div>
        </div>` : ''}

        <!-- Video Recording -->
        ${result.videoPath ? `
        <div class="subsection">
            <div class="subsection-header" onclick="toggleSection(this)">
                <h4>Video Recording ${videoSize > 0 ? `(${videoSize} MB)` : ''}</h4>
                <span class="toggle-icon-sm"></span>
            </div>
            <div class="video-container">
                ${embeddedVideo 
                    ? `<video controls class="video-player"><source src="${embeddedVideo}" type="video/webm">Your browser does not support video playback.</video>`
                    : `<div class="video-download"><p>Video file is too large to embed (${videoSize} MB)</p><a href="${result.videoPath}" download class="btn btn-secondary">Download Video</a></div>`
                }
            </div>
        </div>` : ''}

        <!-- Analysis -->
        <div class="analysis-section ${statusClass}">
            <h4>Analysis</h4>
            <div class="analysis-content">
                <div class="analysis-row">
                    <span class="analysis-label">Result</span>
                    <span class="analysis-value ${statusClass}">${result.status}</span>
                </div>
                ${result.status === 'FAIL' ? `
                <div class="analysis-row">
                    <span class="analysis-label">Error</span>
                    <span class="analysis-value error">${result.errorMessage || 'Test execution failed'}</span>
                </div>
                ${result.aiInsight ? `
                <div class="analysis-row">
                    <span class="analysis-label">Root Cause</span>
                    <span class="analysis-value">${result.aiInsight.likelyCause}</span>
                </div>` : ''}` : ''}
                <div class="analysis-row">
                    <span class="analysis-label">Recommendation</span>
                    <span class="analysis-value">${result.status === 'PASS' ? 'No action required' : result.status === 'FAIL' ? 'Investigate failed steps and review error details' : 'Test was skipped'}</span>
                </div>
            </div>
        </div>
    </div>
</div>`;
    }

    /**
     * Generate footer
     */
    private static generateFooter(executedAt: Date): string {
        return `
<footer>
    <div class="footer-content">
        <div class="footer-info">
            <p>Generated: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Yangon', dateStyle: 'medium', timeStyle: 'short' })}</p>
            <p>GoHybrid AI Test Automation Platform</p>
        </div>
        <div class="footer-actions">
            <button onclick="window.print()" class="btn btn-primary">Print Report</button>
            <button onclick="saveAsPDF()" class="btn btn-secondary">Save as PDF</button>
        </div>
    </div>
</footer>
</div>`;
    }

    /**
     * Get CSS styles - Modern, professional design
     */
    private static getStyles(): string {
        return `
:root {
    --color-pass: #22c55e;
    --color-fail: #ef4444;
    --color-skipped: #6b7280;
    --color-primary: #3b82f6;
    --color-primary-dark: #2563eb;
    --color-bg: #f8fafc;
    --color-surface: #ffffff;
    --color-text: #1e293b;
    --color-text-muted: #64748b;
    --color-border: #e2e8f0;
    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
    --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
    --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
    --radius: 8px;
    --radius-lg: 12px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: var(--color-text); background: var(--color-bg); }
.container { max-width: 1400px; margin: 0 auto; padding: 24px; }

/* Header */
.main-header { background: var(--color-surface); border-radius: var(--radius-lg); padding: 32px; margin-bottom: 24px; box-shadow: var(--shadow); border: 1px solid var(--color-border); }
.header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; flex-wrap: wrap; gap: 20px; }
.header-top h1 { font-size: 1.75rem; font-weight: 600; color: var(--color-text); margin-bottom: 4px; }
.subtitle { color: var(--color-text-muted); font-size: 0.95rem; font-family: 'SF Mono', Monaco, monospace; }
.status-badge { padding: 12px 20px; border-radius: var(--radius); text-align: center; min-width: 140px; }
.status-badge.success { background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); color: #166534; }
.status-badge.warning { background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); color: #92400e; }
.status-badge.danger { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); color: #991b1b; }
.status-label { display: block; font-size: 0.75rem; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
.status-value { display: block; font-size: 1.75rem; font-weight: 700; }
.meta-info { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; background: var(--color-bg); padding: 20px; border-radius: var(--radius); }
.meta-item { display: flex; flex-direction: column; }
.meta-label { font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
.meta-value { font-size: 1rem; font-weight: 600; color: var(--color-text); }

/* KPI Cards */
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 24px; }
.kpi-card { background: var(--color-surface); padding: 20px; border-radius: var(--radius-lg); box-shadow: var(--shadow); text-align: center; border: 1px solid var(--color-border); transition: all 0.2s; }
.kpi-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
.kpi-value { font-size: 2rem; font-weight: 700; margin-bottom: 4px; }
.kpi-label { font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.kpi-card.pass { border-top: 3px solid var(--color-pass); }
.kpi-card.fail { border-top: 3px solid var(--color-fail); }
.kpi-card.skipped { border-top: 3px solid var(--color-skipped); }
.kpi-card.total { border-top: 3px solid var(--color-primary); }

/* Stack Badges */
.stack-badge { padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
.stack-badge.kendoui { background-color: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
.stack-badge.primeng { background-color: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
.stack-badge.mixed { background-color: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
.stack-badge.standard { background-color: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
.kpi-card.rate { border-top: 3px solid var(--color-pass); }
.kpi-card.rate.success { background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); }
.kpi-card.rate.warning { background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); }
.kpi-card.rate.danger { background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); }
.kpi-card.avg { border-top: 3px solid #8b5cf6; }

/* Sections */
.section { background: var(--color-surface); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 24px; box-shadow: var(--shadow); border: 1px solid var(--color-border); }
.section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 16px; }
.section-header h2 { font-size: 1.25rem; font-weight: 600; color: var(--color-text); }
.section-header h3 { font-size: 1rem; font-weight: 600; color: var(--color-text); margin-bottom: 16px; }

/* Charts */
.charts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
.chart-container { background: var(--color-bg); padding: 20px; border-radius: var(--radius); }
.chart-container h3 { font-size: 0.95rem; font-weight: 600; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }

/* Test Filters */
.test-filters { display: flex; gap: 8px; flex-wrap: wrap; }
.filter-btn { padding: 8px 16px; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); border-radius: var(--radius); cursor: pointer; font-size: 0.875rem; font-weight: 500; transition: all 0.2s; }
.filter-btn:hover { background: var(--color-bg); }
.filter-btn.active { background: var(--color-primary); color: white; border-color: var(--color-primary); }
.filter-btn.pass.active { background: var(--color-pass); border-color: var(--color-pass); }
.filter-btn.fail.active { background: var(--color-fail); border-color: var(--color-fail); }
.filter-btn.skipped.active { background: var(--color-skipped); border-color: var(--color-skipped); }

/* Test Cases */
.test-cases-list { display: flex; flex-direction: column; gap: 12px; }
.test-case { border: 1px solid var(--color-border); border-radius: var(--radius-lg); overflow: hidden; background: var(--color-surface); transition: all 0.3s; }
.test-case:hover { box-shadow: var(--shadow-md); }
.test-case.pass { border-left: 4px solid var(--color-pass); }
.test-case.fail { border-left: 4px solid var(--color-fail); }
.test-case.skipped { border-left: 4px solid var(--color-skipped); }
.test-case-header { padding: 20px; background: var(--color-bg); cursor: pointer; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; transition: background 0.2s; }
.test-case-header:hover { background: #f1f5f9; }
.test-case-info { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.test-case-id { font-family: 'SF Mono', Monaco, monospace; font-size: 0.875rem; color: var(--color-text-muted); font-weight: 500; }
.test-case-title { font-size: 1rem; font-weight: 600; color: var(--color-text); }
.test-case-meta { display: flex; align-items: center; gap: 12px; }
.status-badge-sm { padding: 4px 12px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
.status-badge-sm.pass { background: #dcfce7; color: #166534; }
.status-badge-sm.fail { background: #fee2e2; color: #991b1b; }
.status-badge-sm.skipped { background: #f1f5f9; color: #475569; }
.duration-badge { font-size: 0.875rem; color: var(--color-text-muted); font-family: 'SF Mono', Monaco, monospace; }
.toggle-icon { width: 20px; height: 20px; border: 2px solid var(--color-text-muted); border-left: none; border-top: none; transform: rotate(45deg); transition: transform 0.3s; }
.test-case.expanded .toggle-icon { transform: rotate(225deg); }
.test-case-body { padding: 24px; display: none; }
.test-case.expanded .test-case-body { display: block; }

/* Test Info */
.test-info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--color-border); }
.info-item { display: flex; flex-direction: column; gap: 4px; }
.info-label { font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
.info-value { font-size: 0.95rem; color: var(--color-text); font-weight: 500; }

/* Subsections */
.subsection { margin: 24px 0; }
.subsection-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--color-bg); border-radius: var(--radius); cursor: pointer; transition: background 0.2s; margin-bottom: 12px; }
.subsection-header:hover { background: #f1f5f9; }
.subsection-header h4 { font-size: 0.95rem; font-weight: 600; color: var(--color-text); }
.toggle-icon-sm { width: 16px; height: 16px; border: 2px solid var(--color-text-muted); border-left: none; border-top: none; transform: rotate(45deg); transition: transform 0.3s; }
.subsection-header.collapsed .toggle-icon-sm { transform: rotate(-135deg); }

/* Steps */
.steps-list { display: flex; flex-direction: column; gap: 8px; }
.step { border: 1px solid var(--color-border); border-radius: var(--radius); overflow: hidden; }
.step.pass { border-left: 3px solid var(--color-pass); background: #f0fdf4; }
.step.fail { border-left: 3px solid var(--color-fail); background: #fef2f2; }
.step.skipped { border-left: 3px solid var(--color-skipped); background: #f8fafc; }
.step-header { padding: 12px 16px; background: #f8fafc; display: flex; justify-content: space-between; align-items: center; }
.step-number { font-size: 0.875rem; font-weight: 600; color: var(--color-text); }
.step-status { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; padding: 4px 10px; border-radius: 12px; }
.step-status.pass { background: #dcfce7; color: #166534; }
.step-status.fail { background: #fee2e2; color: #991b1b; }
.step-status.skipped { background: #f1f5f9; color: #475569; }
.step-content { padding: 16px; }
.step-row { display: grid; grid-template-columns: 100px 1fr; gap: 12px; margin: 8px 0; font-size: 0.95rem; }
.step-label { font-weight: 600; color: var(--color-text-muted); }
.step-value { color: var(--color-text); }
.step-row.error .step-value { color: #991b1b; font-family: 'SF Mono', Monaco, monospace; font-size: 0.875rem; }

/* Screenshots */
.screenshot-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.screenshot-item { border-radius: var(--radius); overflow: hidden; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; border: 1px solid var(--color-border); }
.screenshot-item:hover { transform: scale(1.02); box-shadow: var(--shadow-md); }
.screenshot-item img { width: 100%; height: 150px; object-fit: cover; display: block; }

/* Video */
.video-container { background: #000; border-radius: var(--radius); overflow: hidden; }
.video-player { width: 100%; max-height: 500px; display: block; }
.video-download { padding: 40px; text-align: center; color: white; }
.video-download p { margin-bottom: 16px; }

/* Analysis */
.analysis-section { margin-top: 24px; padding: 20px; border-radius: var(--radius); border: 1px solid var(--color-border); }
.analysis-section.pass { background: #f0fdf4; border-left: 4px solid var(--color-pass); }
.analysis-section.fail { background: #fef2f2; border-left: 4px solid var(--color-fail); }
.analysis-section.skipped { background: #f8fafc; border-left: 4px solid var(--color-skipped); }
.analysis-section h4 { font-size: 0.95rem; font-weight: 600; color: var(--color-text); margin-bottom: 16px; }
.analysis-content { display: flex; flex-direction: column; gap: 12px; }
.analysis-row { display: grid; grid-template-columns: 120px 1fr; gap: 16px; font-size: 0.95rem; }
.analysis-label { font-weight: 600; color: var(--color-text-muted); }
.analysis-value { color: var(--color-text); }
.analysis-value.pass { color: var(--color-pass); font-weight: 600; }
.analysis-value.fail { color: var(--color-fail); font-weight: 600; }
.analysis-value.error { color: #991b1b; font-family: 'SF Mono', Monaco, monospace; font-size: 0.875rem; }

/* Footer */
footer { background: var(--color-surface); border-radius: var(--radius-lg); padding: 32px; margin-top: 24px; box-shadow: var(--shadow); border: 1px solid var(--color-border); }
.footer-content { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 20px; }
.footer-info p { color: var(--color-text-muted); font-size: 0.875rem; margin: 4px 0; }
.footer-actions { display: flex; gap: 12px; }
.btn { padding: 10px 20px; border: none; border-radius: var(--radius); cursor: pointer; font-weight: 500; font-size: 0.875rem; transition: all 0.2s; }
.btn-primary { background: var(--color-primary); color: white; }
.btn-primary:hover { background: var(--color-primary-dark); }
.btn-secondary { background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); }
.btn-secondary:hover { background: var(--color-bg); }

/* Modal */
.image-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 1000; display: none; justify-content: center; align-items: center; }
.image-modal.active { display: flex; }
.image-modal img { max-width: 90%; max-height: 90%; border-radius: var(--radius); }
.image-modal-close { position: absolute; top: 20px; right: 20px; color: white; font-size: 2rem; cursor: pointer; background: none; border: none; }

/* Responsive */
@media (max-width: 768px) {
    .container { padding: 16px; }
    .main-header { padding: 20px; }
    .header-top { flex-direction: column; }
    .kpi-grid { grid-template-columns: repeat(2, 1fr); }
    .charts-grid { grid-template-columns: 1fr; }
    .test-case-header { flex-direction: column; align-items: flex-start; }
    .test-case-meta { width: 100%; justify-content: space-between; }
    .step-row { grid-template-columns: 1fr; gap: 4px; }
    .analysis-row { grid-template-columns: 1fr; gap: 4px; }
    .footer-content { flex-direction: column; text-align: center; }
}

/* Print */
@media print {
    .test-filters, .footer-actions, .toggle-icon, .toggle-icon-sm { display: none !important; }
    .test-case.expanded .test-case-body { display: block !important; }
    .test-case-body { display: block !important; }
    body { background: white; }
    .section, .kpi-card { box-shadow: none; border: 1px solid #ddd; }
}
`;
    }

    /**
     * Get JavaScript for interactivity
     */
    private static getScripts(): string {
        return `
function toggleTestCase(header) {
    const testCase = header.parentElement;
    testCase.classList.toggle('expanded');
}

function toggleSection(header) {
    header.classList.toggle('collapsed');
    const content = header.nextElementSibling;
    if (content) {
        content.style.display = content.style.display === 'none' ? 'block' : 'none';
    }
}

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        const filter = this.dataset.filter;
        document.querySelectorAll('.test-case').forEach(tc => {
            if (filter === 'all' || tc.dataset.status === filter) {
                tc.style.display = 'block';
            } else {
                tc.style.display = 'none';
            }
        });
    });
});

function viewImage(element, src) {
    const modal = document.createElement('div');
    modal.className = 'image-modal active';
    modal.innerHTML = '<button class="image-modal-close" onclick="this.parentElement.remove()">&times;</button><img src="' + src + '" onclick="event.stopPropagation()">';
    modal.onclick = () => modal.remove();
    document.body.appendChild(modal);
}

function saveAsPDF() {
    window.print();
}

// Auto-expand first failed test
document.addEventListener('DOMContentLoaded', function() {
    const firstFail = document.querySelector('.test-case.fail');
    if (firstFail) firstFail.classList.add('expanded');
});
`;
    }
}
