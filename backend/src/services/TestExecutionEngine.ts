/**
 * Test Execution Engine
 *
 * Executes test cases with:
 * - Automatic retry with exponential backoff
 * - Parallel execution support (configurable workers)
 * - Step-by-step progress tracking via WebSocket
 * - Screenshot/video/trace capture on failure
 * - Detailed per-step result tracking
 * - Execution timeout management
 *
 * @author GoHybrid AI Team
 * @date April 3, 2026
 */

import { TestCase, TestResult, TestCaseStep } from './TestCaseBuilder';
import { healedClick, safeFill, waitForAngularStable } from '../../tests/playwright/playwright-self-healing';
import { TESTING_CREDENTIALS } from '../../tests/playwright/test-credentials';
import { loginAndNavigate } from '../../tests/playwright/login-helper';
import { SmartSkillManager } from './skills/SmartSkillManager';

type Page = any;
type Browser = any;
type BrowserContext = any;

// ============================================================================
// TYPES
// ============================================================================

export interface ExecutionConfig {
    maxRetries: number;           // Max retries per step (default: 2)
    retryDelayMs: number;         // Base delay between retries (default: 1000)
    stepTimeoutMs: number;        // Timeout per step (default: 60000)
    testTimeoutMs: number;        // Timeout per test case (default: 180000)
    parallelWorkers: number;      // Number of parallel browsers (default: 1)
    screenshotOnFailure: boolean; // Capture screenshot on failure (default: true)
    videoRecording: boolean;      // Record video (default: true)
    traceRecording: boolean;      // Record trace (default: false)
    headless: boolean;            // Run headless (default: true)
    outputDir: string;            // Output directory for artifacts (default: 'test-results')
}

export interface ExecutionProgress {
    testCaseId: string;
    stepNumber: number;
    totalSteps: number;
    stepAction: string;
    status: 'running' | 'retrying' | 'passed' | 'failed' | 'skipped';
    retryCount: number;
    duration: number;
    error?: string;
}

export interface ExecutionSummary {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    blocked: number;
    totalDuration: number;
    results: TestResult[];
    artifacts: {
        screenshots: string[];
        videos: string[];
        traces: string[];
    };
}

export type ProgressCallback = (progress: ExecutionProgress) => void;

// ============================================================================
// STEP EXECUTOR — Executes a single test step
// ============================================================================

class StepExecutor {
    private config: ExecutionConfig;
    private onProgress: ProgressCallback;

    constructor(config: ExecutionConfig, onProgress: ProgressCallback) {
        this.config = config;
        this.onProgress = onProgress;
    }

    /**
     * Execute a single step with retry
     */
    async executeStep(
        page: Page,
        testCase: TestCase,
        step: TestCaseStep,
        testData?: Record<string, string>
    ): Promise<{ status: 'PASS' | 'FAIL' | 'SKIP'; duration: number; error?: string; screenshotPath?: string }> {

        const startTime = Date.now();
        let lastError: string | undefined;

        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            if (attempt > 0) {
                // Exponential backoff
                const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
                this.onProgress({
                    testCaseId: testCase.id,
                    stepNumber: step.stepNumber,
                    totalSteps: testCase.steps.length,
                    stepAction: step.action,
                    status: 'retrying',
                    retryCount: attempt,
                    duration: Date.now() - startTime
                });
                await new Promise(r => setTimeout(r, delay));
            }

            try {
                await this.executeStepAction(page, step, testData);

                // Execute assertion if present
                if (step.assertion) {
                    await this.executeAssertion(page, step.assertion);
                }

                // Take screenshot if requested
                let screenshotPath: string | undefined;
                if (step.screenshot && this.config.screenshotOnFailure) {
                    screenshotPath = `${this.config.outputDir}/${testCase.id}_step${step.stepNumber}_${Date.now()}.png`;
                    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
                }

                return {
                    status: 'PASS',
                    duration: Date.now() - startTime,
                    screenshotPath
                };

            } catch (error: any) {
                lastError = error.message;
                if (attempt === this.config.maxRetries) {
                    // Final attempt failed — capture screenshot
                    let screenshotPath: string | undefined;
                    if (this.config.screenshotOnFailure) {
                        screenshotPath = `${this.config.outputDir}/${testCase.id}_step${step.stepNumber}_FAIL_${Date.now()}.png`;
                        await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
                    }

                    return {
                        status: 'FAIL',
                        duration: Date.now() - startTime,
                        error: lastError,
                        screenshotPath
                    };
                }
            }
        }

        // Should never reach here
        return { status: 'FAIL', duration: Date.now() - startTime, error: lastError };
    }

    /**
     * Execute the actual step action
     */
    private async executeStepAction(page: Page, step: TestCaseStep, testData?: Record<string, string>): Promise<void> {
        const action = step.action.toLowerCase();
        const selector = step.selector;
        const data = testData || step.inputData || {};

        // Navigation
        if (action.includes('navigate') || action.includes('go to')) {
            const url = data.url || data.page || selector;
            if (url) {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.stepTimeoutMs });
                await waitForAngularStable(page);
                return;
            }
        }

        // Click
        if (action.includes('click')) {
            if (selector) {
                await healedClick(page, selector, step.action);
            }
            return;
        }

        // Fill/Input
        if (action.includes('fill') || action.includes('enter') || action.includes('type') || action.includes('input')) {
            if (selector && Object.keys(data).length > 0) {
                const value = data[Object.keys(data)[0]] || Object.values(data)[0];
                if (typeof value === 'string') {
                    const input = page.locator(selector).first();
                    await input.fill(value);
                    return;
                }
            }
        }

        // Select/Dropdown
        if (action.includes('select') && action.includes('dropdown') || action.includes('select from')) {
            if (selector) {
                await healedClick(page, selector, step.action);
                // Select by text if data provided
                const value = Object.values(data)[0];
                if (value) {
                    const option = page.locator(`li:has-text("${value}")`).first();
                    if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
                        await option.click({ force: true });
                    }
                }
            }
            return;
        }

        // Wait
        if (step.waitFor) {
            await page.waitForSelector(step.waitFor.selector, {
                state: step.waitFor.state,
                timeout: step.waitFor.timeout || this.config.stepTimeoutMs
            });
            return;
        }

        // Generic: try healedClick first, then fill
        if (selector) {
            try {
                await healedClick(page, selector, step.action);
            } catch {
                const value = Object.values(data)[0];
                if (value) {
                    await page.locator(selector).first().fill(String(value));
                }
            }
        }
    }

    /**
     * Execute assertion
     */
    private async executeAssertion(page: Page, assertion: { operator: string; selector?: string; value?: string | number }): Promise<void> {
        const { operator, selector, value } = assertion;
        const locator = selector ? page.locator(selector).first() : null;

        switch (operator) {
            case 'visible':
                if (locator) await locator.waitFor({ state: 'visible', timeout: 10000 });
                break;
            case 'hidden':
                if (locator) await locator.waitFor({ state: 'hidden', timeout: 10000 });
                break;
            case 'contains':
                if (locator && value) {
                    await locator.waitFor({ state: 'visible', timeout: 10000 });
                    const text = await locator.textContent();
                    if (!text?.includes(String(value))) {
                        throw new Error(`Expected text to contain "${value}", got "${text?.substring(0, 100)}"`);
                    }
                }
                break;
            case 'equals':
                if (locator && value) {
                    await locator.waitFor({ state: 'visible', timeout: 10000 });
                    const text = await locator.textContent();
                    if (text?.trim() !== String(value)) {
                        throw new Error(`Expected "${value}", got "${text?.trim()}"`);
                    }
                }
                break;
            case 'count':
                if (locator && typeof value === 'number') {
                    const count = await locator.count();
                    if (count < value) {
                        throw new Error(`Expected at least ${value} elements, found ${count}`);
                    }
                }
                break;
            case 'url_matches':
                if (value) {
                    await page.waitForURL(new RegExp(String(value)), { timeout: 10000 });
                }
                break;
        }
    }
}

// ============================================================================
// TEST EXECUTOR — Executes a full test case
// ============================================================================

export class TestExecutor {
    private config: ExecutionConfig;
    private onProgress: ProgressCallback;
    private stepExecutor: StepExecutor;

    constructor(config: Partial<ExecutionConfig> = {}, onProgress?: ProgressCallback) {
        this.config = {
            maxRetries: config.maxRetries ?? 2,
            retryDelayMs: config.retryDelayMs ?? 1000,
            stepTimeoutMs: config.stepTimeoutMs ?? 60000,
            testTimeoutMs: config.testTimeoutMs ?? 180000,
            parallelWorkers: config.parallelWorkers ?? 1,
            screenshotOnFailure: config.screenshotOnFailure ?? true,
            videoRecording: config.videoRecording ?? true,
            traceRecording: config.traceRecording ?? false,
            headless: config.headless ?? true,
            outputDir: config.outputDir ?? 'test-results'
        };
        this.onProgress = onProgress || (() => {});
        this.stepExecutor = new StepExecutor(this.config, this.onProgress);
    }

    /**
     * Execute a single test case
     */
    async executeTestCase(
        testCase: TestCase,
        options?: {
            baseUrl?: string;
            testData?: Record<string, string>;
            onSkillResult?: (patternId: string, success: boolean) => void;
        }
    ): Promise<TestResult> {
        const result: TestResult = {
            testCaseId: testCase.id,
            scenarioId: testCase.scenarioId,
            title: testCase.title,
            status: 'PASS',
            duration: 0,
            stepResults: []
        };

        const startTime = Date.now();
        let browser: Browser | null = null;
        let context: BrowserContext | null = null;
        let page: Page | null = null;

            try {
                // Launch browser
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { chromium } = require('playwright');
                browser = await chromium.launch({
                    headless: this.config.headless,
                    args: ['--disable-web-security', '--ignore-certificate-errors', '--no-sandbox']
                });

            context = await browser.newContext({
                viewport: { width: 1280, height: 720 },
                recordVideo: this.config.videoRecording ? { dir: `${this.config.outputDir}/videos/` } : undefined,
                recordHar: this.config.traceRecording ? { path: `${this.config.outputDir}/traces/${testCase.id}.har` } : undefined
            });

            page = await context.newPage();

            if (this.config.traceRecording) {
                await context.tracing.start({ screenshots: true, snapshots: true });
            }

            // Navigate to base URL / login
            const baseUrl = options?.baseUrl || TESTING_CREDENTIALS.baseUrl;
            this.onProgress({
                testCaseId: testCase.id,
                stepNumber: 0,
                totalSteps: testCase.steps.length,
                stepAction: 'Login and navigate',
                status: 'running',
                retryCount: 0,
                duration: Date.now() - startTime
            });

            await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Execute each step
            for (const step of testCase.steps) {
                this.onProgress({
                    testCaseId: testCase.id,
                    stepNumber: step.stepNumber,
                    totalSteps: testCase.steps.length,
                    stepAction: step.action,
                    status: 'running',
                    retryCount: 0,
                    duration: Date.now() - startTime
                });

                const stepResult = await this.stepExecutor.executeStep(page, testCase, step, options?.testData);

                result.stepResults.push({
                    stepNumber: step.stepNumber,
                    action: step.action,
                    status: stepResult.status === 'PASS' ? 'PASS' : 'FAIL',
                    duration: stepResult.duration,
                    error: stepResult.error,
                    screenshotPath: stepResult.screenshotPath
                });

                if (stepResult.status === 'FAIL') {
                    result.status = 'FAIL';
                    result.error = stepResult.error;
                    result.screenshotPath = stepResult.screenshotPath;
                    break; // Stop on first failure
                }
            }

            // If all steps passed
            if (result.status === 'PASS') {
                result.status = 'PASS';
            }

        } catch (error: any) {
            result.status = 'BLOCKED';
            result.error = error.message;
        } finally {
            // Save artifacts
            if (page) {
                result.videoPath = await page.video()?.path().catch(() => undefined);
            }
            if (context) {
                if (this.config.traceRecording) {
                    result.tracePath = `${this.config.outputDir}/traces/${testCase.id}.zip`;
                    await context.tracing.stop({ path: result.tracePath }).catch(() => {});
                }
                await context.close();
            }
            if (browser) {
                await browser.close();
            }

            result.duration = Date.now() - startTime;

            // Report skill result for feedback loop
            if (options?.onSkillResult) {
                const passed = result.status === 'PASS';
                options.onSkillResult(result.testCaseId, passed);
            }
        }

        return result;
    }

    /**
     * Execute multiple test cases (sequential by default, parallel if workers > 1)
     */
    async executeMultiple(
        testCases: TestCase[],
        options?: {
            baseUrl?: string;
            testData?: Record<string, Record<string, string>>;
            onSkillResult?: (patternId: string, success: boolean) => void;
        }
    ): Promise<ExecutionSummary> {
        const results: TestResult[] = [];
        const screenshots: string[] = [];
        const videos: string[] = [];
        const traces: string[] = [];

        if (this.config.parallelWorkers > 1) {
            // Parallel execution
            const chunks: TestCase[][] = [];
            for (let i = 0; i < testCases.length; i += this.config.parallelWorkers) {
                chunks.push(testCases.slice(i, i + this.config.parallelWorkers));
            }

            for (const chunk of chunks) {
                const chunkResults = await Promise.all(
                    chunk.map(tc => this.executeTestCase(tc, {
                        baseUrl: options?.baseUrl,
                        testData: options?.testData?.[tc.id],
                        onSkillResult: options?.onSkillResult
                    }))
                );
                results.push(...chunkResults);
            }
        } else {
            // Sequential execution
            for (const tc of testCases) {
                const result = await this.executeTestCase(tc, {
                    baseUrl: options?.baseUrl,
                    testData: options?.testData?.[tc.id],
                    onSkillResult: options?.onSkillResult
                });
                results.push(result);

                // Collect artifact paths
                if (result.screenshotPath) screenshots.push(result.screenshotPath);
                if (result.videoPath) videos.push(result.videoPath);
                if (result.tracePath) traces.push(result.tracePath);
                for (const sr of result.stepResults) {
                    if (sr.screenshotPath) screenshots.push(sr.screenshotPath);
                }
            }
        }

        return {
            total: testCases.length,
            passed: results.filter(r => r.status === 'PASS').length,
            failed: results.filter(r => r.status === 'FAIL').length,
            skipped: results.filter(r => r.status === 'SKIP').length,
            blocked: results.filter(r => r.status === 'BLOCKED').length,
            totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
            results,
            artifacts: { screenshots, videos, traces }
        };
    }

    /**
     * Execute multiple test cases with automatic skill success rate reporting.
     * This wires execution results back to SmartSkillManager to update skill confidence.
     */
    async executeWithSkillFeedback(
        testCases: TestCase[],
        options?: {
            baseUrl?: string;
            testData?: Record<string, Record<string, string>>;
        }
    ): Promise<ExecutionSummary> {
        const skillIdMap = new Map<string, string>();
        for (const tc of testCases) {
            skillIdMap.set(tc.id, tc.id);
        }

        const onSkillResult = (patternId: string, success: boolean) => {
            SmartSkillManager.updateSuccessRate(patternId, success).catch(() => {});
        };

        return this.executeMultiple(testCases, {
            baseUrl: options?.baseUrl,
            testData: options?.testData,
            onSkillResult
        });
    }
}
