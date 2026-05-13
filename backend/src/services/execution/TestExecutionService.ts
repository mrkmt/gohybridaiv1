/**
 * TestExecutionService
 *
 * Executes Playwright test scripts for generated test cases.
 * Handles video recording, screenshots, and result collection.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import { TestCase, TestStep } from "../generation/TestCaseGeneratorService";
import { AIVisualAnalysisService, RCAResult } from "../AIVisualAnalysisService";
import * as ExcelJS from "exceljs";
import AdmZip from "adm-zip";
import { SmartSkillManager } from "../skills/SmartSkillManager";
import { TestDeduplicationService } from "../TestDeduplicationService";
import { FailureClassificationService, FailureCategory, ClassificationResult } from "./FailureClassificationService";
import { selectorEnrichment } from "../skills/SelectorEnrichmentService";
import { classifyFailure, formatFailureForJira } from "../TestFailureClassifier";
import { appLogger } from "../../utils/logger";
import { attemptAgentHealing, isAgentAvailable } from "./PlaywrightAgentService";
import { TestSessionCacheService } from "../session/TestSessionCacheService";
import { ModuleRegistry } from "../shared/ModuleRegistry";
import { SkillRegistryService } from "../skills/SkillRegistryService";
import { PredictiveAnalyticsService } from "../PredictiveAnalyticsService";
import { VisionNavigatorService } from "../../../api/VisionNavigatorService";

export type TestExecutionPlatform = "LOCAL" | "TESTMU";

export interface TestEnvironment {
  stage: "testing" | "uat" | "live";
  baseUrl: string;
  username: string;
  password: string;
  customerId?: string;
  userLevel?: string;
  idNumber?: string;
  fullUrl?: string;
  browser?: "chromium" | "firefox" | "webkit";
  headless?: boolean;
  timeout?: number;
  autoHeal?: boolean;
  platform?: TestExecutionPlatform;
}

export interface StepResult {
  stepNumber: number;
  action: string;
  expectedResult: string;
  actualResult?: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  screenshotPath?: string;
  errorMessage?: string;
  duration: number;
}

export interface TestResult {
  testCaseId: string;
  testCaseTitle: string;
  /** Frontend compatibility aliases — GoHybridChat reads caseName/caseId */
  caseId?: string;
  caseName?: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  duration: number;
  videoPath?: string;
  screenshotPaths: string[];
  domSnapshotPath?: string;
  a11ySnapshotPath?: string;
  errorMessage?: string;
  steps: StepResult[];
  environment: string;
  executedAt: string;
  ticketId: string;
  /** Jira user story or requirement this test traces back to */
  linkedRequirement?: string;
  aiInsight?: RCAResult;
  /** True if the failure was caused by automation infrastructure (script/selector/timeout) rather than a real business logic defect */
  isExecutionFault?: boolean;
  /** Failure classification from TestFailureClassifier (any compatible classification object) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  failureClassification?: any;
  /** The UI Library detected during the run (e.g. Kendo UI, PrimeNG) */
  uiStack?: 'Kendo UI' | 'PrimeNG' | 'Mixed' | 'Standard';
}

export interface ExecutionProgress {
  ticketId: string;
  currentTestCaseId: string;
  totalTestCases: number;
  completedTestCases: number;
  currentStep?: number;
  totalSteps?: number;
  currentAction?: string;
  status: "running" | "completed" | "failed";
  results: TestResult[];
}

export interface TestExecutionSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  faults: number;
  passRate: number;
  totalDuration: number;
}

export class TestExecutionService {
  private static readonly ARTIFACTS_DIR = path.join(
    process.cwd(),
    "test-results",
  );
  private static readonly DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes per test case

  /** In-memory network retry counters (keyed by ticketId:caseId) */
  private static networkRetryCounts = new Map<string, number>();

  /**
   * Broadcast execution progress to all connected clients via WebSocket.
   * Enables live observability during "Real" execution.
   */
  private static broadcastProgress(_progress: ExecutionProgress) {
    // Progress is now broadcast via JobEvents → server.ts WebSocket bridge.
    // Kept as a no-op to preserve the call-site signature.
  }

  /**
   * Ensure artifacts directory exists
   */
  private static ensureArtifactsDir(ticketId: string): string {
    const ticketDir = path.join(this.ARTIFACTS_DIR, ticketId);
    const videoDir = path.join(ticketDir, "videos");
    const screenshotDir = path.join(ticketDir, "screenshots");

    [ticketDir, videoDir, screenshotDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    return ticketDir;
  }

  /**
   * Remove old artifacts (older than 7 days) to save disk space
   */
  private static cleanupOldArtifacts(): void {
    try {
      if (!fs.existsSync(this.ARTIFACTS_DIR)) return;

      const retentionDays = parseInt(process.env.ARTIFACT_RETENTION_DAYS || "7");
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      const tickets = fs.readdirSync(this.ARTIFACTS_DIR, { withFileTypes: true });
      let removedCount = 0;

      for (const ticket of tickets) {
        if (!ticket.isDirectory()) continue;
        
        const ticketPath = path.join(this.ARTIFACTS_DIR, ticket.name);
        const stats = fs.statSync(ticketPath);
        
        if (now - stats.mtimeMs > maxAgeMs) {
          try {
            // Recursive deletion
            fs.rmSync(ticketPath, { recursive: true, force: true });
            removedCount++;
          } catch (err: any) {
            appLogger.warn(`[Cleanup] Failed to remove ${ticket.name}: ${err.message}`);
          }
        }
      }

      if (removedCount > 0) {
        appLogger.info(`[Cleanup] Removed ${removedCount} old artifact directorie(s) (older than ${retentionDays} days)`);
      }
    } catch (err: any) {
      appLogger.error(`[Cleanup] Artifact cleanup failed: ${err.message}`);
    }
  }

  /**
   * Generate Playwright test script from a test case
   */
  static generatePlaywrightScript(
    testCase: TestCase,
    environment: TestEnvironment,
    ticketId: string,
    healingHint?: string,
  ): string {
    const executionTarget = this.resolveExecutionTarget(testCase, ticketId);
    const safeTitle = testCase.title.replace(/[^a-zA-Z0-9]/g, "_");
    const timestamp = Date.now();
    // Unique run ID — appended to test data to prevent collisions between executions
    const runId = `run_${timestamp}`;

    // Compute relative import path from test-results/<ticketId>/ back to tests/playwright/
    // test-results/ATT-16/ -> needs ../../tests/playwright/
    const relImport = '../../tests/playwright';

    return `
import { test, expect, Page } from '@playwright/test';
import { healedClick, safeFill, waitForAngularStable, kendoStabilizationDelay, waitForAppReady, universalFill } from '${relImport}/playwright-self-healing';
import { performLogin, loginAndNavigate } from '${relImport}/login-helper';
import { TESTING_CREDENTIALS } from '${relImport}/test-credentials';
import { waitFor } from '${relImport}/test-data-factory';

/** Test data factory — unique IDs per run to prevent collisions */
const RUN_ID = '${runId}';
function td(value: string): string {
    return value ? \`\${value}_\${RUN_ID}\` : value;
}

test.use({
    trace: 'on-first-retry',
    video: 'on',
    screenshot: 'on'
});

test.describe('${testCase.caseId}: ${testCase.title}', () => {
    test('Execute test case', async ({ page }, testInfo) => {
        const credentials = {
            baseUrl: TESTING_CREDENTIALS.baseUrl,
            apiBaseUrl: TESTING_CREDENTIALS.apiBaseUrl,
            idNumber: TESTING_CREDENTIALS.idNumber,
            username: TESTING_CREDENTIALS.username,
            password: TESTING_CREDENTIALS.password
        };

        // Pre-conditions
        ${testCase.preconditions?.map((p) => `// - ${p}`).join("\n        ") || "// No pre-conditions"}

        // Resolved before compile time — prefer confirmed ModuleRegistry route, then infer from test content.
        const detectedModule = ${JSON.stringify(executionTarget.moduleName)};
        const detectedRoute = ${JSON.stringify(executionTarget.hashRoute)};
        const fallbackUrl = credentials.baseUrl + detectedRoute;
        console.log(\`[Nav] Detected module: \${detectedModule} → \${fallbackUrl}\`);

        // Login and navigate
        console.log('[Test] Logging in and navigating...');
        await loginAndNavigate(
            page,
            credentials,
            detectedModule,
            fallbackUrl
        );
        await waitForAngularStable(page);
        await waitFor(2000);

        // Pre-flight selector validation — fail fast if selectors don't exist
        console.log('[PreFlight] Validating selectors...');
        const selectorChecks: { step: number; selector: string; found: boolean }[] = [];
        const allSteps = ${JSON.stringify(testCase.steps.filter(s => s.selectorHint).map((s, i) => ({ step: testCase.steps.indexOf(s) + 1, selector: s.selectorHint })))};
        for (const check of allSteps) {
            if (check.selector) {
                const found = await page.locator(check.selector).first().isVisible({ timeout: 3000 }).catch(() => false);
                selectorChecks.push({ ...check, found });
                if (!found) {
                    console.warn(\`[PreFlight] ⚠️ Step \${check.step}: selector not found: \${check.selector}\`);
                }
            }
        }
        const failedChecks = selectorChecks.filter(c => !c.found);
        if (failedChecks.length > 0) {
            console.log(\`[PreFlight] \${failedChecks.length}/\${selectorChecks.length} selectors need attention\`);
        } else {
            console.log(\`[PreFlight] ✅ All \${selectorChecks.length} selectors validated\`);
        }

        // Pre-flight: check if we're already on the correct page (loginAndNavigate may have already navigated)
        const currentUrl = page.url();
        const alreadyOnPage = currentUrl.includes(detectedRoute.replace('#/', ''));
        console.log(\`[PreFlight] URL: \${currentUrl}, expected: \${detectedRoute}, alreadyOnPage=\${alreadyOnPage}\`);

        // Results tracking
        const results: any[] = [];
        let hasFailed = false;

        try {
            // Execute test steps
            ${testCase.steps.map((step, index) => this.generateStepCode(step, index, 'detectedRoute', 'alreadyOnPage')).join("\n            ")}

        } catch (error: any) {
            hasFailed = true;
            console.error('Test execution failed:', error.message);

            // Capture DOM snapshot for AI forensics
            try {
                const dom = await page.content().catch(() => 'Failed to capture DOM');
                await testInfo.attach('dom_snapshot.html', { body: dom, contentType: 'text/html' });
            } catch (e) {}

            // Healing context
            const healingHint = ${JSON.stringify(healingHint || "")};
            if (healingHint) {
                console.log('--- HEALING CONTEXT ---');
                console.log(healingHint);
                console.log('--- END HEALING CONTEXT ---');
            }
            throw error;
        }

        // Final assertion
        expect(hasFailed).toBe(false);
    });
});
`.trim();
  }

  /**
   * Generate code for a single test step
   */
  private static generateStepCode(step: TestStep, index: number, skipRouteVar?: string, alreadyOnPageVar?: string): string {
    const stepNum = step.stepNumber || index + 1;
    const actionEsc = step.action.replace(/'/g, "\\'");
    const expectedEsc = step.expectedResult.replace(/'/g, "\\'");

    // For step 1 (navigation), wrap in alreadyOnPage check if pre-flight vars provided
    const isNavigationStep = stepNum === 1 && (step.action.toLowerCase().includes('navigate') || step.action.toLowerCase().includes('go to'));
    let actionCode: string;
    if (isNavigationStep && skipRouteVar && alreadyOnPageVar) {
      actionCode = `// Already navigated in pre-flight; skipping redundant navigation
                if (${alreadyOnPageVar}) {
                    console.log('Step ${stepNum}: Already on correct page, skipping navigation');
                    const step${stepNum}Duration = Date.now() - step${stepNum}Start;
                    results.push({
                        step: ${stepNum},
                        action: '${actionEsc}',
                        expected: 'Page loads with module dashboard visible',
                        status: 'PASS',
                        duration: step${stepNum}Duration,
                        note: 'Skipped via pre-flight check'
                    });
                } else {
                    ${step.customCode ? `// HEALED CUSTOM CODE\n${step.customCode}` : this.generateGenericAction(step)}

                    const step${stepNum}Duration = Date.now() - step${stepNum}Start;
                    results.push({
                        step: ${stepNum},
                        action: '${actionEsc}',
                        expected: 'Page loads with module dashboard visible',
                        status: 'PASS',
                        duration: step${stepNum}Duration
                    });
                    console.log('Step ${stepNum}: PASSED');
                }`;
    } else {
      actionCode = step.customCode
        ? `// HEALED CUSTOM CODE\n${step.customCode}`
        : this.generateGenericAction(step);
    }

    return `
            // Step ${stepNum}: ${actionEsc}
            console.log('Executing step ${stepNum}: ${actionEsc}');
            const step${stepNum}Start = Date.now();
            try {
                // Expected: ${expectedEsc}
                ${actionCode}

${isNavigationStep && skipRouteVar && alreadyOnPageVar ? '' : `
                const step${stepNum}Duration = Date.now() - step${stepNum}Start;
                results.push({
                    step: ${stepNum},
                    action: '${actionEsc}',
                    expected: '${expectedEsc}',
                    status: 'PASS',
                    duration: step${stepNum}Duration
                });
                console.log('Step ${stepNum}: PASSED');`}
            } catch (error: any) {
                results.push({
                    step: ${stepNum},
                    action: '${actionEsc}',
                    expected: '${expectedEsc}',
                    status: 'FAIL',
                    error: error.message
                });
                console.error('Step ${stepNum}: FAILED:', error.message);
                throw error;
            }
`;
  }

  /**
   * Generate generic action code based on step description.
   * Now consumes pageModel interaction strategy data when available.
   */
  private static generateGenericAction(step: TestStep): string {
    const action = step.action.toLowerCase();
    const selector = (step.selectorHint || "").replace(/'/g, "\\'");
    const testData = (step.testData || "").replace(/'/g, "\\'");

    // [BEST PRACTICE #1] ALWAYS prefer selectorHint if available!
    // This allows the AI or Registry to bypass brittle text logic.
    if (selector) {
      if (
        action.includes("click") ||
        action.includes("press") ||
        action.includes("tap")
      ) {
        return `
                await healedClick(page, '${selector}');
                `;
      }
      if (
        action.includes("fill") ||
        action.includes("enter") ||
        action.includes("type") ||
        action.includes("input")
      ) {
        const isKendo = action.includes("kendo") || action.includes("dropdown");
        return `
                await waitForAppReady(page);
                await universalFill(page, '${selector}', td('${testData || "test"}'), { isKendo: ${isKendo}, slowTyping: true });
                `;
      }
      if (action.includes("select") || action.includes("choose")) {
        return `
                await page.locator('${selector}').waitFor({ state: 'visible', timeout: 10000 });
                await page.locator('${selector}').selectOption('${testData}');
                `;
      }
    }

    // [BEST PRACTICE #2] Detect and handle compound steps (e.g., "Navigate and click")
    if (action.includes(" and ")) {
      return this.handleCompoundStep(step, action);
    }

    // Strategy-driven code generation from pageModel
    const strategyKind = step.strategyKind || '';
    const framework = step.framework || '';
    const preWaits = step.preWaits || [];
    const preWaitCode = preWaits.length > 0
      ? preWaits.map((_w: string) => `                await waitForAngularStable(page);`).join('\n')
      : '';

    // Rich text editor strategy — uses td() for unique test data
    if (strategyKind === 'edit-rich-text' || framework === 'tinymce' || framework === 'ckeditor') {
      return `
                // Rich text editor fill [${framework} strategy]
                await waitForAngularStable(page);
                await waitForLoadingMask(page);
                const editorContent = page.locator('${selector}').locator('.ck-content, [contenteditable="true"], iframe').first();
                await editorContent.click();
                await editorContent.fill(td('${testData}'));
                await page.waitForTimeout(500);`;
    }

    // Grid action strategy
    if (strategyKind === 'grid-action') {
      return `
                // Grid action [${framework || 'generic'} strategy]
                await waitForAngularStable(page);
                await waitForLoadingMask(page);
                // Wait for grid data rows, not just container
                await page.locator('${selector} tbody > tr').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
                await healedClick(page, '${selector}');`;
    }

    // Modal action strategy
    if (strategyKind === 'modal-action') {
      return `
                // Modal action [${framework || 'generic'} strategy]
                await waitForAngularStable(page);
                await page.locator('.k-dialog, [role="dialog"], .modal').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
                await page.waitForTimeout(300);
                await healedClick(page, '${selector}');`;
    }

    // Tab navigation strategy
    if (strategyKind === 'navigate-tab') {
      return `
                // Tab navigation [${framework || 'generic'} strategy]
                await waitForAngularStable(page);
                await healedClick(page, '${selector}');
                await page.waitForTimeout(500);
                await waitForAngularStable(page);`;
    }

    // Kendo UI dropdown select strategy
    if ((strategyKind === 'select' || action.includes('select')) && (framework === 'kendo-ui' || action.includes('kendo'))) {
      return `
                // Kendo dropdown select [Kendo strategy]
${preWaitCode ? preWaitCode + '\n' : ''}                await waitForAngularStable(page);
                await waitForLoadingMask(page);
                // Open detached popup
                await page.locator('${selector}').click();
                await page.waitForTimeout(300);
                // Select from overlay
                const kendoOption = page.locator('.k-popup .k-list-item, .k-list .k-list-item, [role="option"]').filter({ hasText: '${testData}' }).first();
                await kendoOption.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
                await kendoOption.click();
                await kendoStabilizationDelay(page);`;
    }

    // Fill/Input actions — uses td() for unique test data
    if (
      action.includes("fill") ||
      action.includes("enter") ||
      action.includes("type") ||
      action.includes("input")
    ) {
      const isKendo = action.includes("kendo") || action.includes("dropdown");
      if (selector) {
        return `
                await waitForAppReady(page);
                await universalFill(page, '${selector}', td('${testData || "test"}'), { isKendo: ${isKendo}, slowTyping: true });
                `;
      } else {
        // Fallback: find field by label text for "enter X" actions without selector
        const labelMatch = action.match(/(?:enter|fill|type)\s+(?:description\s+for\s+the\s+|a\s+|an\s+|the\s+|valid\s+|invalid\s+)?([^(]+)/i);
        const fieldName = labelMatch ? labelMatch[1].trim() : 'input';
        return `
                await waitForAppReady(page);
                // Try finding input by label "${fieldName}"
                try {
                    const labEl = page.locator(\`label:has-text("${fieldName}"), label:has-text("\${'${fieldName}'.toLowerCase()}")\`).first();
                    if (await labEl.count() > 0) {
                        const forAttr = await labEl.getAttribute('for').catch(() => null);
                        if (forAttr) {
                            await page.locator(\`#\${forAttr}\`).fill(td('${testData || fieldName}'));
                        } else {
                            await labEl.locator('..').locator('input:not([type="hidden"]), textarea').first().fill(td('${testData || fieldName}'));
                        }
                    } else {
                        // Generic input fallback
                        await page.locator('input:not([type="hidden"]):visible, textarea:visible').first().fill(td('${testData || fieldName}'));
                    }
                } catch(e) {
                    console.warn("Input fallback failed:", e);
                    throw e;
                }
                `;
      }
    }

    // 1. Selector strategy (Prefer selectorHint, then try common patterns)
    if (selector) {
      // Click actions
      if (
        action.includes("click") ||
        action.includes("press") ||
        action.includes("tap") ||
        action.includes("submit")
      ) {
        return `
                await healedClick(page, '${selector}');
                `;
      }

      // Select from dropdown
      if (action.includes("select") || action.includes("choose")) {
        return `
                await page.locator('${selector}').waitFor({ state: 'visible', timeout: 10000 });
                await page.locator('${selector}').selectOption('${testData}');
                `;
      }
    }

    // 2. Kendo dropdown detection when no selectorHint (SMART FALLBACK)
    if (action.includes("select") || action.includes("choose")) {
      // Try to extract field name from action
      const fieldNameMatch = action.match(/'([^']+)'|"([^"]+)"/);
      const fieldName = fieldNameMatch
        ? fieldNameMatch[1] || fieldNameMatch[2]
        : "";

      if (fieldName) {
        return `
                // Smart Kendo dropdown detection
                const dropdownSelectors = [
                    \`kendo-dropdownlist[aria-label*="${fieldName}"]\`,
                    \`kendo-combobox[aria-label*="${fieldName}"]\`,
                    \`[role="listbox"][aria-label*="${fieldName}"]\`,
                    \`.k-dropdown-wrap[aria-label*="${fieldName}"]\`,
                    \`.k-select[aria-label*="${fieldName}"]\`
                ];
                
                let dropdownFound = false;
                for (const sel of dropdownSelectors) {
                    const dropdown = page.locator(sel).first();
                    if (await dropdown.count() > 0) {
                        await dropdown.click();
                        await page.locator(\`.k-list-item:has-text("${testData}")\`).first().click();
                        dropdownFound = true;
                        break;
                    }
                }
                
                // Fallback: Try by field label
                if (!dropdownFound) {
                    const label = page.locator(\`label:has-text("${fieldName}")\`).first();
                    if (await label.count() > 0) {
                        const forAttr = await label.getAttribute('for');
                        if (forAttr) {
                            const input = page.locator(\`#\${forAttr}\`);
                            if (await input.count() > 0) {
                                await input.fill('${testData}');
                            }
                        }
                    }
                }
                `;
      }
    }

    // 2. Fallback text-based selectors if no selectorHint
    if (action.includes("click") || action.includes("press")) {
      // Try to extract text between quotes or common labels
      const match = action.match(/'([^']+)'|"([^"]+)"/);
      let buttonText = match ? match[1] || match[2] : "";

      // FIX: Normalize button text for GlobalHR
      const buttonMappings: Record<string, string> = {
        "Add New": "Add",
        "Add Designation": "Add",
        "Create New": "Create",
        "Save Changes": "Save",
        "Edit Item": "Edit",
        "Delete Item": "Delete",
        "Cancel": "Cancel",
        "Close": "Close"
      };

      for (const [wrong, correct] of Object.entries(buttonMappings)) {
        buttonText = buttonText.replace(new RegExp(wrong, "g"), correct);
      }

      if (buttonText) {
        // [GLOBALHR SPECIAL] - Specific selectors for common icons
        let enhancedSelector = "";
        if (buttonText.toLowerCase() === 'edit') {
            enhancedSelector = `button[title='Edit'], .k-grid-edit, a[title='Edit'], .fa-edit`;
        } else if (buttonText.toLowerCase() === 'delete') {
            enhancedSelector = `button[title='Delete'], .k-grid-delete, a[title='Delete'], .fa-trash`;
        } else if (buttonText.toLowerCase() === 'cancel') {
            enhancedSelector = `button:has-text("Cancel"), .btn-light:has-text("Cancel"), .k-grid-cancel-command`;
        } else {
            enhancedSelector = `
                button:has-text("${buttonText}"),
                button.btn.btn-primary:has-text("${buttonText}"),
                button.btn.btn-success:has-text("${buttonText}"),
                button.btn.btn-danger:has-text("${buttonText}"),
                .k-button:has-text("${buttonText}"),
                button[kendobutton]:has-text("${buttonText}"),
                a:has-text("${buttonText}")
            `.replace(/\s+/g, " ").trim();
        }

        return `
                const btn = page.locator('${enhancedSelector}').first();
                await healedClick(btn);
                `;
      }
    }

    // 3. File upload
    if (
      action.includes("upload") ||
      action.includes("file") ||
      action.includes("attach") ||
      action.includes("attachment")
    ) {
      const sel = selector || `input[type='file']`;
      return `
                // File upload step
                const fileInput = page.locator('${sel}').first();
                await fileInput.waitFor({ state: 'visible', timeout: 10000 });
                await fileInput.setInput('test-results/test-attachment.png');
                console.log('[Upload] File attached successfully');
                `;
    }

    // 4. Assertions / verifications
    if (
      action.includes("assert") ||
      action.includes("verify") ||
      action.includes("check") ||
      action.includes("should") ||
      action.includes("confirm")
    ) {
      const sel = selector || "body";
      return `
                // Assertion step
                await expect(page.locator('${sel}')).toBeVisible({ timeout: 10000 });
                console.log('[Assert] Element visible: ${sel}');
                `;
    }

    // 5. Navigation
    if (
      action.includes("navigate") ||
      action.includes("go to") ||
      action.includes("open")
    ) {
      const match = action.match(/https?:\/\/[^\s]+/);
      if (match) {
        return `await page.goto('${match[0]}', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000);`;
      } else {
        const nameMatch = action.match(/'([^']+)'|"([^"]+)"/);
        const targetName = nameMatch
          ? nameMatch[1] || nameMatch[2]
          : action.replace(/navigate to|go to|open|the |module/gi, "").trim();
        return `
                // Navigate using hash route pattern
                const routeMap: Record<string, string> = {
                    'designation': '#/app.designation',
                    'department': '#/app.department',
                    'grade': '#/app.grade',
                    'employee': '#/app.employee',
                    'leave': '#/app.leave',
                    'attendance': '#/app.attendance',
                    'payroll': '#/app.payroll',
                    'report': '#/app.reports',
                    'master': '#/app.master',
                    'journal': '#/app.performancejournal',
                    'journal-entry': '#/app.performancejournal',
                    'performance': '#/app.performancejournal',
                    'performancejournal': '#/app.performancejournal',
                    'performance journal': '#/app.performancejournal',
                    'my performance journal': '#/app.performancejournal',
                };
                const routeKey = "${targetName}".toLowerCase();
                const matchedRoute = Object.entries(routeMap).find(([key]) => routeKey.includes(key));
                const hashRoute = matchedRoute ? matchedRoute[1] : \`#/app.\${routeKey.replace(/\\s+/g, '-').toLowerCase()}\`;
                try {
                    await page.goto(\`\${credentials.baseUrl}\${hashRoute}\`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await waitForAngularStable(page);
                } catch (e) {
                    // Fallback: try clicking menu item by text
                    const menuBtn = page.locator(\`a:has-text("${targetName}"), .list-group-item:has-text("${targetName}")\`).first();
                    if (await menuBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                        await healedClick(menuBtn);
                    } else {
                        console.warn(\`Navigation fallback failed for: ${targetName}\`);
                    }
                }`;
      }
    }

    // 6. Default wait/generic
    if (action.includes("wait") || action.includes("pause")) {
      return `await page.waitForTimeout(2000);`;
    }

    // 7. assertVisible / assertText handling (from AI selector enrichment)
    if (action.includes("assertvisible") || action.includes("asserttext")) {
      const match = action.match(/for\s+(.+?)(?:,|\s*expected|)$/);
      if (match) {
        const selectorPart = match[1].trim();
        return `
                // AI-enriched assertion
                await expect(page.locator('${selectorPart.replace(/'/g, "\\'")}')).toBeVisible({ timeout: 10000 });
                `;
      }
    }

    // 8. Verification
    if (
      action.includes("verify") ||
      action.includes("check") ||
      action.includes("see") ||
      action.includes("should")
    ) {
      const match = action.match(/'([^']+)'|"([^"]+)"/);
      const expectedText = match ? match[1] || match[2] : "";
      if (expectedText) {
        const sel = selector || "body";
        return `await expect(page.locator('${sel}')).toContainText('${expectedText.replace(/'/g, "\\'")}');`;
      }
      const sel2 = selector || "body";
      return `await expect(page.locator('${sel2}')).toBeVisible({ timeout: 10000 });`;
    }

    // 9. Login actions (P1 Fix)
    if (action.includes("login")) {
      return `
               console.log('[Test] Performing login step...');
               await performLogin(page, credentials.baseUrl + '#/login', credentials);
               await waitForAngularStable(page);
               `;
    }
    // 6. Unrecognized action — throw so the step fails properly instead of silently passing
    throw new Error(`Unrecognized test step action: '${action}'. Add a handler for this action type in generateGenericAction.`);
  }

  /**
   * [LONG-TERM FIX #1] Handle compound steps by splitting them into multiple actions
   * Example: "Navigate to Master > Designation and click 'Add New'" → Navigate + Click
   */
  private static handleCompoundStep(step: TestStep, action: string): string {
    console.log(`[CompoundStep] Detected compound action: "${step.action}"`);

    // Split by " and " to get individual actions
    const parts = step.action.split(/ and |, then |, then /i);

    if (parts.length < 2) {
      // Not really a compound step, fall through to normal handling
      return this.generateGenericAction(step);
    }

    console.log(
      `[CompoundStep] Splitting into ${parts.length} actions:`,
      parts,
    );

    // Generate code for each part
    const generatedParts: string[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();

      // Create a mini-step for this part
      const miniStep: TestStep = {
        stepNumber: step.stepNumber + i,
        action: part,
        testData: i === parts.length - 1 ? step.testData : "", // Use testData only for last part
        expectedResult: i === parts.length - 1 ? step.expectedResult : "",
        selectorHint: step.selectorHint,
      };

      // Recursively generate code for this part
      // Skip compound detection to avoid infinite recursion
      const partCode = this.generateSimpleAction(miniStep, part.toLowerCase());
      generatedParts.push(partCode);
    }

    // Combine all parts with proper sequencing
    return `
            // [CompoundStep] Split into ${parts.length} actions
            console.log('[CompoundStep] Executing ${parts.length} sub-steps...');
            
            ${generatedParts.join("\n\n            // --- Next sub-step ---\n\n            ")}
            
            console.log('[CompoundStep] All sub-steps completed');
        `;
  }

  /**
   * Simple action generator (no compound detection - avoids infinite recursion)
   */
  private static generateSimpleAction(step: TestStep, action: string): string {
    const selector = (step.selectorHint || "").replace(/'/g, "\\'");
    const testData = (step.testData || "").replace(/'/g, "\\'");

    // Navigation detection
    if (
      action.includes("navigate") ||
      action.includes("go to") ||
      action.includes("open") ||
      action.includes("page")
    ) {
      const nameMatch = action.match(/'([^']+)'|"([^"]+)"/);
      const targetName = nameMatch
        ? nameMatch[1] || nameMatch[2]
        : action
            .replace(/navigate to|go to|open|the |page/gi, "")
            .replace(">", "")
            .trim();

      return `
                // Navigate to ${targetName}
                console.log('[Navigation] Navigating to "${targetName}"...');
                const navSuccess = await smartNavigate("${targetName}");
                if (!navSuccess) {
                    console.warn('[Navigation] Smart navigation failed, trying direct URL');
                    // Fallback: try common URL patterns
                    const urlPatterns = [
                        \`#/app.${targetName.toLowerCase().replace(/\\s+/g, "")}\`,
                        \`#/app/${targetName.toLowerCase().replace(/\\s+/g, "-")}\`
                    ];
                    for (const pattern of urlPatterns) {
                        try {
                            await page.goto(BASE_URL + pattern, { waitUntil: 'domcontentloaded' });
                            await page.waitForTimeout(5000);
                            console.log(\`[Navigation] Navigated to \${pattern}\`);
                            break;
                        } catch (e) {
                            continue;
                        }
                    }
                }
                await page.waitForTimeout(3000); // Wait for page to stabilize
            `;
    }

    // Click detection
    if (
      action.includes("click") ||
      action.includes("press") ||
      action.includes("tap")
    ) {
      const match = action.match(/'([^']+)'|"([^"]+)"/);
      let buttonText = match ? match[1] || match[2] : "";

      // Normalize button text
      const buttonMappings: Record<string, string> = {
        "Add New": "Add",
        "Add Designation": "Add",
        "Create New": "Create",
        "Save Changes": "Save",
        "Edit Item": "Edit",
        "Delete Item": "Delete",
      };

      for (const [wrong, correct] of Object.entries(buttonMappings)) {
        buttonText = buttonText.replace(new RegExp(wrong, "g"), correct);
      }

      if (buttonText) {
        const enhancedSelector = `button:has-text("${buttonText}"), button.btn.btn-primary:has-text("${buttonText}"), button.btn.btn-success:has-text("${buttonText}"), .k-button:has-text("${buttonText}")`;
        return `
                    // Click ${buttonText}
                    const btn = page.locator('${enhancedSelector}');
                    await healedClick(btn);
                `;
      }
    }

    // Fill detection
    if (
      action.includes("fill") ||
      action.includes("enter") ||
      action.includes("type")
    ) {
      const match = action.match(/'([^']+)'|"([^"]+)"/);
      const fieldName = match ? match[1] || match[2] : "field";
      const selector = step.selectorHint || `input[name="${fieldName}"], input[formcontrolname="${fieldName}"]`;
      return `
                // Fill ${fieldName} (using hint: ${step.selectorHint || 'none'})
                await waitForAngularStable(page);
                await page.fill('${selector}', '${testData}');
            `;
    }

    // Default: generic wait
    return `await page.waitForTimeout(1000);`;
  }

  /**
   * Attempts to heal a test failure using Vision AI analysis of the last screenshot.
   * This is the "Visual Reasoning" fallback from the Best Approach research.
   */
  private static async attemptVisionHealing(
    ticketId: string, 
    testCase: TestCase, 
    lastScreenshot: string,
    result: TestResult
  ): Promise<{ patch: string; selector: string; target: string; reason: string } | null> {
    appLogger.info(`[VisionHealing] Attempting visual reasoning for ${testCase.caseId}...`);
    
    try {
        if (!fs.existsSync(lastScreenshot)) {
            appLogger.warn(`[VisionHealing] No screenshot found at ${lastScreenshot}`);
            return null;
        }

        const imageBase64 = fs.readFileSync(lastScreenshot).toString('base64');
        const failingStepResult = result.steps.find(s => s.status === 'FAIL') || result.steps[result.steps.length - 1];
        const failingStep = testCase.steps.find(s => s.stepNumber === failingStepResult.stepNumber) || testCase.steps[testCase.steps.length - 1];
        
        const goal = `Fix the failing step: "${failingStep.action}". Find the correct element on the page to achieve this.`;
        
        const prompt = `
            You are a vision-based self-healing agent.
            FAILING STEP: "${failingStep.action}"
            GOAL: ${goal}
            
            Analyze the attached screenshot and provide a Playwright selector to fix this.
            Respond ONLY with a JSON object: { "healedSelector": "...", "targetName": "...", "reason": "..." }
        `;

        const { CloudAIService } = require('../../api/CloudAIService');
        const aiResponse = await CloudAIService.generateWithGroqVision(prompt, imageBase64).catch(() => 
                           CloudAIService.generateWithImage(prompt, imageBase64));

        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        const data = JSON.parse(jsonMatch ? jsonMatch[0] : aiResponse);

        if (data.healedSelector) {
            appLogger.info(`[VisionHealing] AI found a visual match: ${data.healedSelector}`);
            return {
                patch: `// VISION HEALED: ${data.reason}\nawait page.locator('${data.healedSelector}').click();`,
                selector: data.healedSelector,
                target: data.targetName || failingStep.action,
                reason: data.reason
            };
        }
    } catch (err: any) {
        appLogger.error(`[VisionHealing] Failed: ${err.message}`);
    }
    return null;
  }

  /**
   * Execute a single test case
   */
  static async executeTestCase(
    testCase: TestCase,
    environment: TestEnvironment,
    ticketId: string,
    timeoutMs: number = this.DEFAULT_TIMEOUT,
    healingHint?: string,
    onLog?: (log: string) => void,
    compiledScript?: string | null,
  ): Promise<TestResult> {
    console.log(
      `[TestExecution] Executing ${testCase.caseId} for ${ticketId} locally...`,
    );

    const ticketDir = this.ensureArtifactsDir(ticketId);
    const videoDir = path.join(ticketDir, "videos");
    const screenshotDir = path.join(ticketDir, "screenshots");
    const timestamp = Date.now();
    const safeCaseId = testCase.caseId.replace(/[^a-zA-Z0-9-]/g, "_");
    let tmpConfigPath: string | undefined;

    // Use compiled script from JSONToPlaywrightCompiler if available, otherwise generate
    const scriptContent = compiledScript || this.generatePlaywrightScript(
      testCase,
      environment,
      ticketId,
      healingHint,
    );
    const scriptSource = compiledScript ? 'JSONToPlaywrightCompiler' : 'legacy';
    console.log(`[TestExecution] Script source for ${testCase.caseId}: ${scriptSource}`);

    const scriptPath = path.join(
      ticketDir,
      `${safeCaseId}_${timestamp}.spec.ts`,
    );
    fs.writeFileSync(scriptPath, scriptContent, "utf-8");

    const videoPath = path.join(videoDir, `${safeCaseId}_${timestamp}.webm`);
    const screenshotPath = path.join(
      screenshotDir,
      `${safeCaseId}_${timestamp}`,
    );

    const startTime = Date.now();
    let status: "PASS" | "FAIL" | "SKIPPED" = "SKIPPED";
    let errorMessage: string | undefined;
    let screenshotPaths: string[] = [];

    // Create specific output directory for this test type
    const testOutputDir = path.join(ticketDir, safeCaseId);
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
    }

    try {
      // Compute effective timeout
      // environment.timeout can come from:
      //   - Frontend UI: in minutes (e.g., 3, 5) — values < 1000
      //   - Backend default: in milliseconds (e.g., 300000) — values >= 1000
      //   - Scripts like run-full-ticket.ts: in milliseconds (e.g., 180000)
      // Smart detection: if value < 1000, treat as minutes
      let effectiveTimeout: number;
      if (environment.timeout !== undefined && environment.timeout !== null) {
        effectiveTimeout = environment.timeout < 1000
          ? environment.timeout * 60 * 1000  // Convert minutes to ms
          : environment.timeout;              // Already in ms
      } else {
        effectiveTimeout = timeoutMs;         // Default 300000 (5 min)
      }

      // Cap at 10 minutes max to prevent overflow
      effectiveTimeout = Math.min(effectiveTimeout, 600000);

      // CRITICAL FIX (from March 25-26 working version): Use Node.js to run Playwright CLI directly
      // This avoids Windows path quoting issues with .cmd files when paths contain spaces
      const isWin = process.platform === 'win32';
      
      // Use Node.js executable + Playwright CLI JS instead of playwright.cmd
      const nodeExe = process.execPath; // Path to node.exe
      const pwCli = path.resolve(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js');
      const timeoutVal = Math.min(effectiveTimeout, 120000);

      // Write a unique temporary Playwright config for this test case
      const scriptDir = path.dirname(scriptPath);
      const scriptBasename = path.basename(scriptPath);
      tmpConfigPath = path.join(scriptDir, `_pw_config_${safeCaseId}_${timestamp}.ts`);
      const mainConfigPath = path.resolve(process.cwd(), "playwright.config.ts");
      const normalizedOutputDir = testOutputDir.replace(/\\/g, "/");
      const normalizedJsonReport = path.join(testOutputDir, "results.json").replace(/\\/g, "/");
      const tmpConfigContent = `
import baseConfig from '${mainConfigPath.replace(/\\/g, "/")}';
export default {
    ...baseConfig,
    testDir: '${scriptDir.replace(/\\/g, "/")}',
    testMatch: '${scriptBasename}',
    outputDir: '${normalizedOutputDir}/test-results',
    reporter: [['list'], ['json', { outputFile: '${normalizedJsonReport}' }], ['html', { open: 'never', outputFolder: '${normalizedOutputDir}/html-report' }]],
    use: { ...baseConfig.use, video: 'on', screenshot: 'on', trace: 'on-first-retry', headless: true },
    workers: 1, retries: 1, fullyParallel: false,
};
`;
      fs.writeFileSync(tmpConfigPath, tmpConfigContent, "utf-8");

      const logFile = path.join(testOutputDir, "execution.log");
      try { fs.writeFileSync(logFile, "", "utf-8"); } catch { /* best-effort */ }

      // Build command args
      const pwArgs = [
        'test',
        '--config', tmpConfigPath,
        '--reporter', 'line',
        '--timeout', `${timeoutVal}`,
        '--trace', 'on',
      ];

      console.log(`[TestExecution] Running: ${pwCli} ${pwArgs.join(' ')}`);

      // Stream logs - single source of truth
      // onLog callback (from TestingWorkflowController) handles WebSocket broadcast
      const streamLog = (text: string) => {
        if (logFile) {
          try { fs.appendFileSync(logFile, text); } catch {}
        }
        if (onLog) onLog(text);  // Single emit - callback handles JobEvents
      };

      // Execute Playwright
      let execResult;
      
      if (process.env.USE_DOCKER_EXECUTION === 'true') {
        const { DockerPlaywrightService } = require('./DockerPlaywrightService');
        streamLog(`[TestExecution] Delegating execution to Docker sandbox...\n`);
        try {
          const dockerResult = await DockerPlaywrightService.runTestInSandbox(scriptContent, effectiveTimeout, {
             baseUrl: environment.baseUrl,
             username: environment.username,
             password: environment.password,
             idNumber: environment.idNumber,
             testModule: testCase.caseId,
             testEnv: environment.stage
          });
          streamLog(dockerResult.stdout + '\n' + dockerResult.stderr);
          execResult = { success: true, stdout: dockerResult.stdout, stderr: dockerResult.stderr };
        } catch (err: any) {
          streamLog(`[Docker Error] ${err.message}\n`);
          execResult = { success: false, stdout: '', stderr: err.message };
        }
      } else {
        execResult = await new Promise<{ success: boolean; stdout: string; stderr: string }>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`Command timed out after ${effectiveTimeout}ms`));
          }, effectiveTimeout);

          // Use node.exe to run Playwright CLI - avoids Windows path quoting issues
          const child = spawn(nodeExe, [pwCli, ...pwArgs], {
            windowsHide: true,
            cwd: process.cwd(),
            env: { ...process.env, PW_VIDEO_OUTPUT_DIR: path.dirname(videoPath), NODE_OPTIONS: '--max-old-space-size=4096' },
          });

          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); streamLog(d.toString()); });
          child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); streamLog(d.toString()); });
          child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ success: code === 0, stdout, stderr });
          });
          child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });
      }

      status = execResult.success ? "PASS" : "FAIL";
      if (!execResult.success) {
        errorMessage = execResult.stderr;
      }

      // Collect screenshots
      if (fs.existsSync(screenshotDir)) {
        screenshotPaths = fs
          .readdirSync(screenshotDir)
          .filter(
            (f) =>
              f.startsWith(safeCaseId) &&
              (f.endsWith(".png") || f.endsWith(".jpg")),
          )
          .map((f) => path.join(screenshotDir, f));
      }
    } catch (error: any) {
      status = "FAIL";
      errorMessage = error.message;
      console.error(
        `[TestExecution] ${testCase.caseId} failed:`,
        error.message,
      );
    }

    // Trigger AI Visual Analysis on failure
    let aiInsight: RCAResult | undefined;
    if (status === "FAIL" && screenshotPaths.length > 0) {
      try {
        const lastScreenshot = screenshotPaths[screenshotPaths.length - 1];
        aiInsight = await AIVisualAnalysisService.analyzeFailure(
          lastScreenshot,
          testCase,
          errorMessage || "Unknown error",
        );
      } catch (e: any) {
        console.warn(`[TestExecution] AI Visual Analysis failed:`, e.message);
      }
    }

    const duration = Date.now() - startTime;

    // Find video file
    let actualVideoPath: string | undefined;
    if (fs.existsSync(videoDir)) {
      const videoFiles = fs
        .readdirSync(videoDir)
        .filter((f) => f.startsWith(safeCaseId) && f.endsWith(".webm"));
      if (videoFiles.length > 0) {
        actualVideoPath = path.join(videoDir, videoFiles[0]);
      }
    }

    // Clean up test script after execution
    try {
      fs.unlinkSync(scriptPath);
    } catch (e) {
      console.warn(`[TestExecution] Failed to cleanup script ${scriptPath}: ${(e as Error).message}`);
    }

    // Clean up temp Playwright config
    try {
      if (tmpConfigPath && fs.existsSync(tmpConfigPath)) {
        fs.unlinkSync(tmpConfigPath);
      }
    } catch (e) {
      console.warn(`[TestExecution] Failed to cleanup config ${tmpConfigPath}: ${(e as Error).message}`);
    }

    // Check for DOM & A11y snapshots captured during failure (robust discovery)
    let domSnapshotPath: string | undefined;
    let a11ySnapshotPath: string | undefined;
    try {
      if (fs.existsSync(testOutputDir)) {
        const findFile = (
          dir: string,
          targetName: string,
        ): string | undefined => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              const result = findFile(fullPath, targetName);
              if (result) return result;
            } else if (entry.name === targetName) {
              return fullPath;
            }
          }
          return undefined;
        };
        domSnapshotPath = findFile(testOutputDir, "dom_snapshot.html");
        a11ySnapshotPath = findFile(testOutputDir, "a11y_snapshot.json");
      }
    } catch (e) {
      console.error(`[TestExecution] Failed to discover artifacts:`, e);
    }

    // Detect Execution Fault: infrastructure/script failures vs real business defects
    const executionFaultPatterns = [
      'locator.count', 'Unexpected token', 'Target closed', 'Navigation timeout',
      'net::ERR_', 'Protocol error', 'Session closed', 'browser has been closed',
      'waiting for locator', 'Timeout exceeded', 'page.goto: ', 'frame was detached',
      'Cannot read properties of', 'is not a function', 'ECONNREFUSED',
      'ERR_CONNECTION_REFUSED', 'spawn UNKNOWN', 'EPERM', 'ENOENT'
    ];

    // Detect AI infrastructure failures (CLI model errors, missing config, etc.)
    const aiOfflinePatterns = [
      'ECONNREFUSED', 'ERR_CONNECTION_REFUSED',
      'AI service is offline', 'self-healing',
      'Missing API key',
      'Failed to generate via', 'All CLI models failed',
      'All AI models failed', 'HTTP 401', 'HTTP 403', 'HTTP 429',
      'insufficient_quota', 'rate_limit',
      'Circuit breaker OPEN'
    ];

    const isAIOffline = status === 'FAIL' && errorMessage
      ? aiOfflinePatterns.some(p => errorMessage!.includes(p))
      : false;

    const isExecutionFault = status === 'FAIL' && errorMessage
      ? executionFaultPatterns.some(p => errorMessage!.includes(p))
      : false;

    if (isAIOffline) {
      console.warn(`[TestExecution] ⚠️ AI SERVICE OFFLINE detected (CLI models). Skipping self-healing.`);
      errorMessage = `AI service is offline. Please check your Gemini CLI / Qwen CLI installation.`;
    }

    if (isExecutionFault) {
      console.warn(`[TestExecution] ⚠️ ${testCase.caseId} EXECUTION FAULT detected (not a real defect)`);
    }

    // Classify the failure using TestFailureClassifier
    let failureClassification = status === 'FAIL' && errorMessage
      ? classifyFailure(errorMessage, errorMessage)
      : null;

    // Override to INFRASTRUCTURE if AI service is offline
    if (isAIOffline) {
      failureClassification = {
        category: 'INFRASTRUCTURE' as any,
        confidence: 1.0,
        reasoning: 'AI CLI service is offline or misconfigured',
        isApplicationBug: false,
        shouldRetry: false,
        suggestedAction: 'check_cli_installation',
      };
    }

    const testResult: TestResult = {
      testCaseId: testCase.caseId,
      testCaseTitle: testCase.title,
      status,
      duration,
      videoPath: actualVideoPath,
      screenshotPaths,
      domSnapshotPath,
      a11ySnapshotPath,
      errorMessage,
      linkedRequirement: testCase.linkedRequirement,
      steps: testCase.steps.map((s, i) => ({
        stepNumber: s.stepNumber || i + 1,
        action: s.action,
        expectedResult: s.expectedResult,
        status: status === "PASS" ? "PASS" : "FAIL",
        errorMessage: status === "FAIL" ? errorMessage : undefined,
        duration: Math.floor(duration / testCase.steps.length),
      })),
      environment: environment.stage,
      executedAt: new Date().toISOString(),
      ticketId,
      aiInsight,
      isExecutionFault,
      failureClassification: failureClassification || undefined,
    };

    console.log(
      `[TestExecution] ${testCase.caseId} completed: ${status} (${duration}ms)`,
    );
    return testResult;
  }

  /**
   * Run command with custom options
   */
  private static runCommand(
    command: string,
    args: string[],
    options: {
      timeoutMs: number;
      videoPath: string;
      screenshotPath: string;
      logFile?: string;
      ticketId?: string;
      testCaseId?: string;
      onLog?: (log: string) => void;
    },
  ): Promise<{ success: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      console.log(
        `[TestExecution] Spawning process: ${command} ${args.join(" ")}`,
      );
      const child = spawn(command, args, {
        shell: true, // Use shell to handle paths with spaces
        windowsHide: true,
        cwd: process.cwd(),
        env: {
          ...process.env,
          PW_VIDEO_OUTPUT_DIR: path.dirname(options.videoPath),
          NODE_OPTIONS: '--max-old-space-size=4096',
        },
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const logStream = (() => {
        if (!options.logFile) return null;
        try {
          fs.mkdirSync(path.dirname(options.logFile), { recursive: true });
          return fs.createWriteStream(options.logFile, { flags: "a" });
        } catch {
          return null;
        }
      })();

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        if (logStream) logStream.end();
        reject(new Error(`Command timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);

      child.stdout.on("data", (data) => {
        const output = data.toString();
        stdout += output;
        if (logStream) logStream.write(output);
        process.stdout.write(output);

        // Stream to WebSocket if callback provided
        if (options.onLog && options.ticketId) {
          options.onLog(output);
          // Also emit via JobEvents for WebSocket
          try {
            const { JobEvents } = require("../../api/WorkerQueue");
            JobEvents.emit("execution:log", {
              type: "execution:log",
              payload: {
                ticketId: options.ticketId,
                testCaseId: options.testCaseId,
                log: output,
                timestamp: new Date().toISOString(),
              },
            });
          } catch (e) {
            // JobEvents not available, skip
          }
        }
      });
      child.stderr.on("data", (data) => {
        const output = data.toString();
        stderr += output;
        if (logStream) logStream.write(output);
        process.stderr.write(output);

        // Stream errors to WebSocket too
        if (options.onLog && options.ticketId) {
          options.onLog(output);
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        if (logStream) logStream.end();
        reject(err);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) return;
        if (logStream) logStream.end();

        resolve({
          success: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });
    });
  }

  /**
   * Strip origin from absolute URLs — helper for generated scripts.
   * Converts "https://test.globalhr.com.mm/ook#/app.designation" → "/ook#/app.designation"
   */
  private static stripOriginFromUrl(url: string): { stripped: string; wasAbsolute: boolean } {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { stripped: url, wasAbsolute: false };
    }
    try {
      const urlObj = new URL(url);
      const relativePath = urlObj.pathname + urlObj.search + urlObj.hash;
      return { stripped: relativePath || '/', wasAbsolute: true };
    } catch {
      return { stripped: url, wasAbsolute: false };
    }
  }

  /**
   * Execute all test cases for a ticket with configurable concurrency
   * Supports both sequential (concurrency=1) and parallel execution with chunking.
   * Also supports idempotent execution — skipping already-passed tests via skipPassed flag.
   */
  static async executeAllTestCases(
    testCases: TestCase[],
    environment: TestEnvironment,
    ticketId: string,
    userId: string,
    onProgress?: (progress: ExecutionProgress) => void,
    onLog?: (log: string) => void,
    autoHeal: boolean = true,
    concurrency: number = parseInt(process.env.PARALLEL_WORKERS || '1'),
    skipPassed: boolean = false,
    existingResults?: TestResult[],
    compiledScripts?: Record<string, string>, // testCaseId → script content
    generatePageObjects: boolean = false, // --- P1 #8: optional POM generation ---
  ): Promise<TestResult[]> {
    // P1 FIX: Cleanup old artifacts to save space
    this.cleanupOldArtifacts();

    const results: TestResult[] = existingResults ? [...existingResults] : [];
    const total = testCases.length;
    let completed = results.length; // Count already-passed tests

    // --- P1 #8: Generate Page Object Models before execution ---
    if (generatePageObjects && testCases.length > 0) {
      try {
        const { PageObjectGenerator } = await import('../PageObjectGenerator');
        const moduleName = this.resolveModuleName(testCases[0], ticketId);
        const pomFiles = PageObjectGenerator.generateFromTestCases(testCases, moduleName);
        const savedPaths = PageObjectGenerator.savePomFiles(pomFiles);
        console.log(`[TestExecution] Generated ${pomFiles.length} Page Object Model(s): ${savedPaths.join(', ')}`);
      } catch (err: any) {
        console.warn(`[TestExecution] POM generation failed: ${err.message}`);
      }
    }

    // --- P2 #10: Check for duplicate test cases across tickets ---
    if (testCases.length > 0) {
      try {
        const dedupResult = TestDeduplicationService.checkForDuplicates(testCases, ticketId);
        if (dedupResult.duplicateCount > 0) {
          console.log(`[TestExecution] Deduplication: ${dedupResult.duplicateCount} potential duplicate(s) found across tickets`);
          for (const rec of dedupResult.recommendations) {
            console.log(`[TestExecution]   → ${rec}`);
          }
        }
      } catch (err: any) {
        console.warn(`[TestExecution] Deduplication check failed: ${err.message}`);
      }
    }

    const executionMode = concurrency > 1 ? 'PARALLEL' : 'SEQUENTIAL';
    console.log(
      `[TestExecution] Starting ${executionMode} execution for ${ticketId} (workers: ${concurrency}, skipPassed: ${skipPassed})`,
    );

    // Emit initial progress
    if (onProgress) {
      onProgress({
        ticketId,
        currentTestCaseId: "",
        totalTestCases: total,
        completedTestCases: completed,
        status: "running",
        results: [...results],
      });
    }

    // Healing cache: skip duplicate AI diagnosis calls for identical errors
    const healingCache = new Map<string, any>();

    // Build set of already-passed test case IDs (idempotent execution)
    const passedIds = new Set(
      results.filter(r => r.status === 'PASS').map(r => r.testCaseId)
    );

    // Filter out already-passed tests if skipPassed is true
    const remainingCases = skipPassed
      ? testCases.filter(tc => !passedIds.has(tc.caseId))
      : testCases;

    // Log skipped tests
    if (skipPassed) {
      const skippedTests = testCases.filter(tc => passedIds.has(tc.caseId));
      for (const tc of skippedTests) {
        console.log(`[TestExecution] Skipping already-passed test: ${tc.caseId}`);
      }
    }

    if (remainingCases.length === 0) {
      console.log(`[TestExecution] All ${total} tests already passed. Nothing to run.`);
      return results;
    }

    if (concurrency > 1) {
      // PARALLEL EXECUTION: Split into chunks
      const chunkSize = Math.ceil(remainingCases.length / concurrency);
      const chunks: TestCase[][] = [];
      for (let i = 0; i < remainingCases.length; i += chunkSize) {
        chunks.push(remainingCases.slice(i, i + chunkSize));
      }

      console.log(`[TestExecution] Split ${remainingCases.length} tests into ${chunks.length} chunks`);

      // Process chunks in parallel
      const chunkPromises = chunks.map((chunk, chunkIndex) =>
        this.runTestChunk(chunk, chunkIndex, environment, ticketId, userId, onProgress, onLog, autoHeal, healingCache, results, total, compiledScripts)
      );

      // Wait for all chunks to complete
      const chunkResults = await Promise.all(chunkPromises);

      // Merge results (avoid duplicates by testCaseId)
      const mergedMap = new Map(results.map(r => [r.testCaseId, r]));
      for (const chunkResult of chunkResults.flat()) {
        mergedMap.set(chunkResult.testCaseId, chunkResult);
      }

      // Final progress
      if (onProgress) {
        onProgress({
          ticketId,
          currentTestCaseId: "",
          totalTestCases: total,
          completedTestCases: total,
          status: "completed",
          results: Array.from(mergedMap.values()),
        });
      }
      return Array.from(mergedMap.values());
    } else {
      // SEQUENTIAL EXECUTION — check abort before each test
      for (let i = 0; i < remainingCases.length; i++) {
        if (TestSessionCacheService.isExecutionAborted(ticketId, userId)) {
          console.log(`[TestExecution] Abort detected — stopping at ${remainingCases[i]?.caseId}, keeping ${results.length} results`);
          if (onProgress) {
            onProgress({
              ticketId,
              currentTestCaseId: "",
              totalTestCases: total,
              completedTestCases: results.length,
              status: "failed",
              results: [...results],
            });
          }
          return results;
        }

        const testCase = remainingCases[i];

        let result = await this.runSingleTest(
          testCase, environment, ticketId, onProgress, onLog, autoHeal,
          healingCache, results, total, completed, compiledScripts
        );
        results.push(result);
        completed++;

        // Emit progress after each test case
        if (onProgress) {
          onProgress({
            ticketId,
            currentTestCaseId: testCase.caseId,
            totalTestCases: total,
            completedTestCases: completed,
            status: "running",
            results: [...results],
          });
        }

        // 2-second cool-down between sequential tests (skip on abort)
        if (i < remainingCases.length - 1) {
          if (TestSessionCacheService.isExecutionAborted(ticketId, userId)) continue;
          console.log(`[TestExecution] Cool-down 2s before next test...`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      // Final progress
      if (onProgress) {
        onProgress({
          ticketId,
          currentTestCaseId: "",
          totalTestCases: total,
          completedTestCases: completed,
          status: "completed",
          results: [...results],
        });
      }
      return results;
    }
  }

  /**
   * Run a single test with healing, skill saving, and progress tracking
   * Wrapped in try/catch to prevent post-test operations from killing the entire suite
   */
  private static async runSingleTest(
    testCase: TestCase,
    environment: TestEnvironment,
    ticketId: string,
    onProgress: ((progress: ExecutionProgress) => void) | undefined,
    onLog: ((log: string) => void) | undefined,
    autoHeal: boolean,
    healingCache: Map<string, any>,
    results: TestResult[],
    total: number,
    completed: number,
    compiledScripts?: Record<string, string>,
  ): Promise<TestResult> {
    const compiledScript = compiledScripts?.[testCase.caseId];

    // MULTI-AGENT PLANNER: Validate and optimize test case before execution
    let plannedTestCase = testCase;
    try {
      const { TestPlannerService } = await import("../TestPlannerService");
      const planningResult = TestPlannerService.planTestCase(testCase);

      if (planningResult.optimizations.length > 0) {
        appLogger.info(`[TestPlanner] ${testCase.caseId}: ${planningResult.optimizations.length} optimization(s) applied (quality: ${(planningResult.qualityScore * 100).toFixed(0)}%)`);
        for (const opt of planningResult.optimizations) {
          appLogger.info(`[TestPlanner]   → Step ${opt.stepIndex + 1}: ${opt.description}`);
        }
        plannedTestCase = TestPlannerService.applyOptimizations(testCase, planningResult.optimizations);
      }

      if (!planningResult.isReady) {
        const errors = planningResult.issues.filter((i: any) => i.severity === 'error');
        appLogger.warn(`[TestPlanner] ${testCase.caseId}: ${errors.length} critical issue(s) found:`);
        for (const issue of errors) {
          appLogger.warn(`[TestPlanner]   → Step ${issue.stepIndex + 1}: ${issue.description}`);
        }
        // Continue anyway — the execution will likely fail and be classified
      }
    } catch (plannerErr) {
      console.error(`[TestPlanner] Planning failed for ${testCase.caseId}:`, plannerErr);
      // Continue with original test case if planner fails
    }

    // Execute the actual test — this is the only operation that should throw
    let result: TestResult = await this.executeTestCase(
      plannedTestCase, environment, ticketId, undefined, undefined, onLog, compiledScript,
    );

    // Post-test operations wrapped in try/catch to prevent cascade failures
    // 1. Auto-healing
    try {
      result = await this.attemptHealingIfNeeded(
        result, testCase, environment, ticketId, autoHeal, healingCache, onProgress, onLog, total, completed
      );
    } catch (healingError) {
      console.error(`[TestExecution] Healing failed for ${testCase.caseId}:`, healingError);
      // Don't let healing failure affect the test result — already has status
    }

    // 2. Save skill pattern
    try {
      await this.saveSkillPattern(result, testCase, ticketId);
    } catch (saveError) {
      console.error(`[TestExecution] Failed to save skill pattern for ${testCase.caseId}:`, saveError);
      // Non-critical — skill saving shouldn't block test results
    }

    // 3. Log to analytics DB
    try {
      const moduleName = this.resolveModuleName(testCase, ticketId);
      await PredictiveAnalyticsService.logExecution(ticketId, testCase, result, moduleName);
    } catch (logError) {
      console.error(`[TestExecution] Failed to log analytics for ${testCase.caseId}:`, logError);
      // Non-critical — analytics logging shouldn't block test results
    }

    return result;
  }

  /**
   * Run a chunk of tests sequentially within a parallel worker
   */
  private static async runTestChunk(
    testCases: TestCase[],
    chunkIndex: number,
    environment: TestEnvironment,
    ticketId: string,
    userId: string,
    onProgress: ((progress: ExecutionProgress) => void) | undefined,
    onLog: ((log: string) => void) | undefined,
    autoHeal: boolean,
    healingCache: Map<string, any>,
    results: TestResult[],
    total: number,
    compiledScripts?: Record<string, string>,
  ): Promise<TestResult[]> {
    const chunkResults: TestResult[] = [];
    console.log(`[TestExecution] Chunk ${chunkIndex + 1}: Running ${testCases.length} tests`);

    for (let i = 0; i < testCases.length; i++) {
      if (TestSessionCacheService.isExecutionAborted(ticketId, userId)) {
        console.log(`[TestExecution] Chunk ${chunkIndex + 1}: abort detected before ${testCases[i]?.caseId}`);
        break;
      }

      const testCase = testCases[i];
      const completed = results.length + chunkResults.length;

      console.log(`[TestExecution] Chunk ${chunkIndex + 1} - Test ${i + 1}/${testCases.length}: ${testCase.caseId}`);

      const result = await this.runSingleTest(
        testCase, environment, ticketId, onProgress, onLog, autoHeal,
        healingCache, results, total, completed, compiledScripts
      );
      chunkResults.push(result);

      // Emit progress after each test case in chunk
      if (onProgress) {
        onProgress({
          ticketId,
          currentTestCaseId: testCase.caseId,
          totalTestCases: total,
          completedTestCases: results.length + chunkResults.length,
          status: "running",
          results: [...results, ...chunkResults],
        });
      }

      if (TestSessionCacheService.isExecutionAborted(ticketId, userId)) {
        console.log(`[TestExecution] Chunk ${chunkIndex + 1}: abort detected after ${testCase.caseId}`);
        break;
      }
    }

    return chunkResults;
  }

  /**
   * Attempt self-healing if test failed and autoHeal is enabled
   */
  private static async attemptHealingIfNeeded(
    result: TestResult,
    testCase: TestCase,
    environment: TestEnvironment,
    ticketId: string,
    autoHeal: boolean,
    healingCache: Map<string, any>,
    onProgress: ((progress: ExecutionProgress) => void) | undefined,
    onLog: ((log: string) => void) | undefined,
    total: number,
    completed: number,
  ): Promise<TestResult> {
    const fc = (result as any).failureClassification;
    const isInfrastructureFailure = fc && (fc as any).category === 'INFRASTRUCTURE';

    if (result.status === "FAIL" && autoHeal && !isInfrastructureFailure) {
      try {
        const fc2 = (result as any).failureClassification as { category?: string; suggestedAction?: string } | null;
        const isNetworkError = fc2 && fc2.category === 'NETWORK_ERROR';
        const shouldRetryNetwork = fc2 && fc2.suggestedAction === 'retry';

        // Network error retry — simple re-execution with increased timeout (no selector healing needed)
        if (isNetworkError && shouldRetryNetwork) {
          const maxNetworkRetries = 2;
          const retryKey = `${ticketId}:${testCase.caseId}`;
          const currentRetries = this.networkRetryCounts.get(retryKey) || 0;

          if (currentRetries < maxNetworkRetries) {
            this.networkRetryCounts.set(retryKey, currentRetries + 1);
            const backoffMs = 5000 * Math.pow(2, currentRetries); // 5s, 10s exponential backoff
            console.log(`[TestExecution] Network error retry ${currentRetries + 1}/${maxNetworkRetries} for ${testCase.caseId} (waiting ${backoffMs}ms)...`);

            if (onProgress) {
              onProgress({
                ticketId,
                currentTestCaseId: testCase.caseId,
                totalTestCases: total,
                completedTestCases: completed,
                currentAction: `Network error — retrying ${testCase.caseId} (${currentRetries + 1}/${maxNetworkRetries})...`,
                status: "running",
                results: [],
              });
            }

            await new Promise(r => setTimeout(r, backoffMs));

            const retryResult = await this.executeTestCase(
              testCase, environment, ticketId, this.DEFAULT_TIMEOUT * 2,
              `// NETWORK RETRY: Re-executing with 2x timeout after ${currentRetries + 1} attempt(s)`,
              undefined, undefined,
            );

            if (retryResult.status === 'PASS') {
              console.log(`[TestExecution] Network retry succeeded for ${testCase.caseId}`);
              return retryResult;
            }

            // Retry also failed — continue to normal healing flow
            result = retryResult;
          } else {
            console.log(`[TestExecution] Network retries exhausted for ${testCase.caseId}`);
          }
        }

        const errorKey = (result.errorMessage || "").substring(0, 200);

        // TIMING HEALING: Before regular healing, try adaptive wait strategy for timeouts
        const fc3 = (result as any).failureClassification as { category?: string } | null;
        if (fc3 && fc3.category === 'TIMEOUT') {
          try {
            const { TimingHealingService } = await import("../TimingHealingService");
            const failingStep = result.steps.find(s => s.status === 'FAIL');
            const timingHeal = TimingHealingService.attemptTimingHealing(
              result.errorMessage || '',
              failingStep?.action,
            );

            if (timingHeal && timingHeal.confidence >= 0.7 && timingHeal.codeSnippet) {
              console.log(`[TimingHealing] Applying adaptive wait for ${testCase.caseId}: ${timingHeal.explanation}`);

              if (onProgress) {
                onProgress({
                  ticketId,
                  currentTestCaseId: testCase.caseId,
                  totalTestCases: total,
                  completedTestCases: completed,
                  currentAction: `Applying adaptive wait for ${testCase.caseId}...`,
                  status: "running",
                  results: [],
                });
              }

              // Inject the timing healing code into the failing step
              const timingTestCase = { ...testCase };
              const failingStepIdx = timingTestCase.steps.findIndex(s =>
                result.steps.some(rs => rs.stepNumber === s.stepNumber && rs.status === 'FAIL')
              );
              if (failingStepIdx !== -1) {
                timingTestCase.steps = [...timingTestCase.steps];
                timingTestCase.steps[failingStepIdx] = {
                  ...timingTestCase.steps[failingStepIdx],
                  customCode: timingHeal.codeSnippet,
                };
                const timingResult = await this.executeTestCase(
                  timingTestCase, environment, ticketId, undefined, undefined, undefined, undefined,
                );
                if (timingResult.status === 'PASS') {
                  console.log(`[TimingHealing] Timing healing succeeded for ${testCase.caseId}`);
                  return timingResult;
                }
                // Timing healing also failed — continue to regular healing
                result = timingResult;
              }
            }
          } catch (timingErr) {
            console.error(`[TimingHealing] Failed for ${testCase.caseId}:`, timingErr);
          }
        }

        // STATE RECOVERY HEALING: Detect page state loss and recover before regular healing
        const fc4 = (result as any).failureClassification as { category?: string } | null;
        if (fc4 && (fc4.category === 'EXECUTION_FAULT' || fc4.category === 'TIMEOUT')) {
          try {
            const { StateRecoveryHealingService } = await import("../StateRecoveryHealingService");
            const failingStep = result.steps.find(s => s.status === 'FAIL');
            const failingStepIdx = testCase.steps.findIndex(s =>
              result.steps.some(rs => rs.stepNumber === s.stepNumber && rs.status === 'FAIL')
            );
            const stateRecovery = StateRecoveryHealingService.attemptStateRecovery(
              result.errorMessage || '',
              testCase.steps.map(s => ({ action: s.action, selector: (s as any).selector })),
              failingStepIdx >= 0 ? failingStepIdx : 0,
            );

            if (stateRecovery && stateRecovery.confidence >= 0.7 && stateRecovery.recoveryCode) {
              console.log(`[StateRecovery] Applying state recovery for ${testCase.caseId}: ${stateRecovery.explanation}`);

              if (onProgress) {
                onProgress({
                  ticketId,
                  currentTestCaseId: testCase.caseId,
                  totalTestCases: total,
                  completedTestCases: completed,
                  currentAction: `Recovering page state for ${testCase.caseId}...`,
                  status: "running",
                  results: [],
                });
              }

              const stateTestCase = { ...testCase };
              if (failingStepIdx !== -1) {
                stateTestCase.steps = [...stateTestCase.steps];
                stateTestCase.steps[failingStepIdx] = {
                  ...stateTestCase.steps[failingStepIdx],
                  customCode: stateRecovery.recoveryCode,
                };
                const stateResult = await this.executeTestCase(
                  stateTestCase, environment, ticketId, undefined, undefined, undefined, undefined,
                );
                if (stateResult.status === 'PASS') {
                  console.log(`[StateRecovery] State recovery succeeded for ${testCase.caseId}`);
                  return stateResult;
                }
                result = stateResult;
              }
            }
          } catch (stateErr) {
            console.error(`[StateRecovery] Failed for ${testCase.caseId}:`, stateErr);
          }
        }

        if (healingCache.has(errorKey)) {
          console.log(
            `[SelfHealing] Skipping duplicate diagnosis for ${testCase.caseId} (same error as previous). Reusing cached fix.`,
          );
        } else {
          const { SelfHealingService } = await import("./SelfHealingService");

          if (onProgress) {
            onProgress({
              ticketId,
              currentTestCaseId: testCase.caseId,
              totalTestCases: total,
              completedTestCases: completed,
              currentAction: `Analyzing failure for ${testCase.caseId}...`,
              status: "running",
              results: [],
            });
          }

          const healedResult = await SelfHealingService.attemptHealing(
            testCase, environment, ticketId, result,
          );
          healingCache.set(errorKey, healedResult);

          // FIX I-004: Offline diagnostic fallback when AI is rate-limited/unavailable
          if (!healedResult || healedResult.status !== "PASS") {
            const offlineDiag = SelfHealingService.runOfflineDiagnostic(result, testCase);
            if (offlineDiag && offlineDiag.confidence >= 0.7) {
              console.log(`[SelfHealing] Offline diagnostic: ${offlineDiag.category} (${offlineDiag.confidence.toFixed(2)}) — ${offlineDiag.suggestion}`);

              // If the offline diag suggests a new selector, try re-running with it
              if (offlineDiag.action === 'replace_with_icon_aware_selector' && offlineDiag.codeSnippet) {
                // Re-execute the test with the offline-suggested selector
                // We inject the codeSnippet as customCode on the failing step
                const offlineTestCase = { ...testCase };
                const failingStepIdx = offlineTestCase.steps.findIndex(s =>
                  result.steps.some(rs => rs.stepNumber === s.stepNumber && rs.status === 'FAIL')
                );
                if (failingStepIdx !== -1) {
                  offlineTestCase.steps = [...offlineTestCase.steps];
                  offlineTestCase.steps[failingStepIdx] = {
                    ...offlineTestCase.steps[failingStepIdx],
                    customCode: offlineDiag.codeSnippet,
                  };
                  const offlineResult = await TestExecutionService.executeTestCase(
                    offlineTestCase, environment, ticketId, 600000,
                    `// OFFLINE HEALING: ${offlineDiag.category}\n// ${offlineDiag.suggestion}\n`
                  );
                  if (offlineResult.status === 'PASS') {
                    console.log(`[SelfHealing] Offline healing succeeded for ${testCase.caseId}`);
                    result = offlineResult;
                  } else {
                    console.log(`[SelfHealing] Offline healing also failed for ${testCase.caseId}`);
                  }
                }
              }
            }
          }

          if (healedResult && healedResult.status === "PASS") {
            result = healedResult;
          } else {
            // Agent-enhanced self-healing fallback
            if (isAgentAvailable()) {
              console.log(
                `[SelfHealing] Normal healing failed for ${testCase.caseId}, trying agent-assisted healing...`,
              );
              if (onProgress) {
                onProgress({
                  ticketId,
                  currentTestCaseId: testCase.caseId,
                  totalTestCases: total,
                  completedTestCases: completed,
                  currentAction: `Agent-assisted healing for ${testCase.caseId}...`,
                  status: "running",
                  results: [],
                });
              }
              const agentResult = await attemptAgentHealing({
                testCaseId: testCase.caseId,
                testCaseTitle: testCase.title,
                stepAction: result.steps[result.steps.length - 1]?.action || "",
                stepExpected: result.steps[result.steps.length - 1]?.expectedResult || "",
                errorMessage: result.errorMessage || "",
                domSnapshot: result.domSnapshotPath
                  ? fs.readFileSync(result.domSnapshotPath, 'utf-8')
                  : undefined,
              });
              if (agentResult?.success && agentResult.customCode) {
                console.log(
                  `[PlaywrightAgent] Agent suggested fix (confidence: ${agentResult.confidence}): ${agentResult.explanation}`,
                );
                const healedTestCase = { ...testCase };
                const lastFailedStep =
                  healedTestCase.steps[result.steps.length - 1]?.stepNumber - 1 || 0;
                if (healedTestCase.steps[lastFailedStep]) {
                  healedTestCase.steps[lastFailedStep] = {
                    ...healedTestCase.steps[lastFailedStep],
                    customCode: agentResult.customCode,
                  };
                }
                const agentRetryResult = await this.executeTestCase(
                  healedTestCase,
                  environment,
                  ticketId,
                  undefined,
                  JSON.stringify(agentResult),
                  undefined,
                );
                if (agentRetryResult.status === "PASS") {
                  console.log(
                    `[PlaywrightAgent] Agent-fix worked! ${testCase.caseId} passed.`,
                  );
                  result = agentRetryResult;
                } else {
                  console.log(
                    `[SelfHealing] ${testCase.caseId} is a Hard Failure. Agent-fix did not resolve.`,
                  );
                }
              } else {
                console.log(
                  `[SelfHealing] ${testCase.caseId} is a Hard Failure. Agent could not suggest a fix.`,
                );
              }
            } else {
              console.log(
                `[SelfHealing] ${testCase.caseId} is a Hard Failure. Healing could not resolve the issue.`,
              );
            }
          }
        }

        // D6: SmartRetry — if SelfHealingService + agent healing all failed,
        // try full-script AI patching for structural failures (navigation change,
        // API endpoint change, flow change, batch selector migration)
        if (result.status === "FAIL" && autoHeal) {
          try {
            const { SmartRetryService } = await import('../SmartRetryService');
            const domSnapshot = result.domSnapshotPath
              ? fs.readFileSync(result.domSnapshotPath, 'utf-8')
              : undefined;

            // Get the compiled script for this test case
            const compiledScript = (result as any).compiledScript;
            if (compiledScript) {
              const smartResult = await SmartRetryService.attemptSmartRetry(
                testCase,
                compiledScript,
                result.errorMessage || '',
                environment,
                { simpleGenerate: async (prompt: string) => {
                  // Use LocalAIService for the AI patch
                  try {
                    const { LocalAIService } = await import('../../../api/LocalAIService');
                    return await LocalAIService.simpleGenerate(prompt);
                  } catch {
                    return '';
                  }
                }},
                domSnapshot
              );

              if (smartResult && smartResult.patched && smartResult.patchedScript) {
                console.log(
                  `[SmartRetry] Patched script for ${testCase.caseId} (pattern: ${smartResult.pattern}). Re-executing...`
                );
                if (onProgress) {
                  onProgress({
                    ticketId,
                    currentTestCaseId: testCase.caseId,
                    totalTestCases: total,
                    completedTestCases: completed,
                    currentAction: `Smart-retry with AI-patched script for ${testCase.caseId}...`,
                    status: "running",
                    results: [],
                  });
                }
                const smartRetryResult = await TestExecutionService.executeTestCase(
                  { ...testCase }, environment, ticketId, 600000,
                  smartResult.patchedScript
                );
                if (smartRetryResult.status === "PASS") {
                  console.log(`[SmartRetry] Smart-retry succeeded for ${testCase.caseId}`);
                  result = smartRetryResult;
                } else {
                  console.log(
                    `[SmartRetry] Smart-retry also failed for ${testCase.caseId}: ${smartRetryResult.errorMessage?.substring(0, 120)}`
                  );
                }
              }
            }
          } catch (smartErr: any) {
            console.warn(`[SmartRetry] SmartRetryService failed: ${smartErr.message}`);
            // Not critical — continue with failed result
          }
        }

        // VISION HEALING FALLBACK (Level 3 - Visual Reasoning)
        // If DOM-based healing and structural AI patching both failed, 
        // try to "SEE" the element using Vision AI.
        if (result.status === 'FAIL' && autoHeal) {
            const lastScreenshot = result.screenshotPaths[result.screenshotPaths.length - 1];
            if (lastScreenshot) {
                appLogger.info(`[VisionHealing] Final attempt for ${testCase.caseId} using Visual Reasoning...`);
                const visionResultData = await this.attemptVisionHealing(ticketId, testCase, lastScreenshot, result);

                if (visionResultData && visionResultData.patch) {
                    appLogger.info(`[TestExecution] Vision AI provided a visual fix for ${testCase.caseId}. Retrying...`);
                    const visionResult = await this.executeTestCase(
                        testCase, environment, ticketId, 600000, visionResultData.patch, onLog
                    );                    
                    if (visionResult.status === 'PASS') {
                        appLogger.info(`[TestExecution] ✅ Vision healing succeeded for ${testCase.caseId}. PERSISTING KNOWLEDGE...`);
                        
                        // CLOSED-LOOP LEARNING: Save the successful selector back to ObjectRepository
                        try {
                            const { ObjectRepositoryService } = await import('../ObjectRepositoryService');
                            await ObjectRepositoryService.addElements([{
                                page: testCase.steps[testCase.steps.length - 1].action.split(' ')[0] || 'dynamic-page',
                                elementName: visionResultData.target,
                                selector: visionResultData.selector,
                                type: 'other',
                                status: 'pending_verification',
                                confidence: 0.9,
                                businessLogicHint: `Healed via Vision for ticket ${ticketId}`,
                                relatedModule: (testCase as any).moduleName
                            }]);
                            appLogger.info(`[ClosedLoop] Successfully updated ObjectRepository with healed selector: ${visionResultData.selector}`);
                        } catch (repoErr: any) {
                            appLogger.warn(`[ClosedLoop] Failed to persist knowledge: ${repoErr.message}`);
                        }
                        
                        result = visionResult;
                    }
                }
            }
        }
      } catch (e) {
        console.error("Healing failed", e);
      }
    }
    return result;
  }

  /**
   * Save skill pattern for successful tests + update skill confidence on failure.
   * This wires execution results back into the skill system for continuous learning.
   */
  private static async saveSkillPattern(result: TestResult, testCase: TestCase, ticketId: string) {
    const success = result.status === "PASS";
    const moduleName = this.resolveModuleName(testCase, ticketId);

    // --- B5: Record locator usage in knowledge base ---
    try {
      for (const step of testCase.steps) {
        const action = (step.action || '').toLowerCase();
        const selector = (step as any).selectorHint || '';
        const framework = (step as any).framework || '';
        const strategyKind = (step as any).strategyKind || '';
        const elementName = (step as any).element || (step as any).field || step.action || 'unknown';

        if (selector) {
          if (success) {
            // Determine action type
            let locatorAction = 'click';
            if (action.includes('fill') || action.includes('enter') || action.includes('type')) locatorAction = 'fill';
            else if (action.includes('select')) locatorAction = 'select';
            else if (action.includes('wait')) locatorAction = 'wait';
            else if (action.includes('assert') || action.includes('verify')) locatorAction = 'assert';
            else if (action.includes('click') || action.includes('press')) locatorAction = 'click';

            SkillRegistryService.recordSuccess(
              moduleName,
              elementName,
              locatorAction,
              selector,
              ticketId,
              framework || undefined,
              strategyKind || undefined,
            );
          } else {
            // Record failure for this step
            const fc = result.failureClassification;
            const isSelectorError = fc && (fc as any).category === 'SELECTOR_ERROR';
            if (isSelectorError) {
              SkillRegistryService.recordFailure(
                moduleName,
                elementName,
                'click',
                selector,
              );
            }
          }
        }
      }
    } catch (locErr: any) {
      console.warn(`[TestExecution] Locator tracking failed: ${locErr.message}`);
    }

    // --- P1 #7: Record execution for flakiness tracking ---
    try {
      const { recordTestExecution } = await import('../FlakinessTracker');
      recordTestExecution(testCase.caseId, ticketId, success ? 'PASS' : 'FAIL', {
        errorMessage: result.errorMessage,
        healingAttempted: result.steps.some(s => (s as any).healed),
        healingSucceeded: success && result.steps.some(s => (s as any).healed),
      });
    } catch (err: any) {
      console.warn(`[TestExecution] Flakiness tracking failed: ${err.message}`);
    }

    try {
      // Always save/update the skill pattern (deduplication handled by SmartSkillManager)
      const saveResult = await SmartSkillManager.savePattern({
        type: "workflow",
        module: moduleName,
        workflow: testCase.steps,
        successRate: success ? 1.0 : 0,
      });

      console.log(
        `[SmartSkill] Pattern ${saveResult.status} (id: ${saveResult.patternId || 'n/a'}) for ${testCase.caseId} (${testCase.title})`,
      );

      // Also record in the failure case for learning
      if (!success && result.failureClassification) {
        const fc = result.failureClassification;
        try {
          // Log failure pattern for future reference
          await SmartSkillManager.savePattern({
            type: "jira",
            module: moduleName,
            issueType: "bug",
            workflow: testCase.steps,
            checklist: [{
              errorType: fc.reasoning || "Unknown",
              errorMessage: result.errorMessage?.substring(0, 300),
              classification: fc.category || "Unknown",
              isApplicationBug: fc.isApplicationBug,
            }],
            successRate: 0.5,
          });
        } catch {
          // Non-blocking
        }
      }
    } catch (skillErr) {
      console.error("[SmartSkill] Failed to save pattern:", skillErr);
    }
  }

  /**
   * Extract module name from test case title.
   * Titles are like "Department: Validation - Short Code Empty" → returns "Department"
   */
  private static extractModuleName(title: string): string {
    const colonIdx = title.indexOf(':');
    if (colonIdx > 0) return title.substring(0, colonIdx).trim();
    // Fallback: first word of title
    const firstWord = title.split(' ')[0];
    return firstWord || 'unknown';
  }

  private static resolveExecutionTarget(testCase: TestCase, ticketId: string): { moduleName: string; hashRoute: string } {
    const registryModule = ModuleRegistry.resolve(ticketId);
    const moduleName = registryModule?.moduleName || this.resolveModuleName(testCase, ticketId);
    const route = registryModule?.uiRoute || this.guessModuleRoute(moduleName);
    const hashRoute = route.startsWith('/#') ? route.slice(1) : route;

    return {
      moduleName,
      hashRoute: hashRoute.startsWith('#/') ? hashRoute : '#/app.department',
    };
  }

  private static resolveModuleName(testCase: TestCase, ticketId: string): string {
    const registryModule = ModuleRegistry.resolve(ticketId);
    if (registryModule?.moduleName) return registryModule.moduleName;

    const corpus = [
      testCase.title,
      testCase.description || '',
      ...(testCase.tags || []),
      testCase.caseId,
    ].join(' ').toLowerCase();

    const similar = ModuleRegistry.findSimilar(corpus)
      .sort((a, b) => Number(b.confirmed) - Number(a.confirmed));

    if (similar.length > 0) {
      return similar[0].moduleName;
    }

    return this.extractModuleName(testCase.title);
  }

  private static guessModuleRoute(moduleName: string): string {
    const normalized = moduleName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .trim();

    return normalized ? `#/app.${normalized}` : '#/app.department';
  }

  /**
   * Generate HTML report for test execution
   */
  static async generateHtmlReport(
    ticketId: string,
    testCases: TestCase[],
    results: TestResult[],
    environment: string,
  ): Promise<string> {
    try {
      const { HtmlReportGeneratorService } =
        await import("../HtmlReportGeneratorService");

      const reportPath = await HtmlReportGeneratorService.generateReport(
        ticketId,
        testCases,
        results,
        environment,
        new Date(),
      );

      console.log(`[TestExecution] ✅ HTML report generated: ${reportPath}`);
      return reportPath;
    } catch (error: any) {
      console.error(
        `[TestExecution] ❌ HTML report generation failed: ${error.message}`,
      );
      return "";
    }
  }

  private static createErrorResult(
    tc: TestCase,
    ticketId: string,
    stage: string,
    error: string,
  ): TestResult {
    return {
      testCaseId: tc.caseId,
      testCaseTitle: tc.title,
      status: "FAIL",
      duration: 0,
      screenshotPaths: [],
      errorMessage: error,
      linkedRequirement: tc.linkedRequirement,
      steps: [],
      environment: stage,
      executedAt: new Date().toISOString(),
      ticketId,
    };
  }

  /**
   * Get execution summary for a test session
   */
  static getExecutionSummary(results: TestResult[]): TestExecutionSummary {
    const total = results.length;
    const passed = results.filter((r) => r.status === "PASS").length;
    const skipped = results.filter((r) => r.status === "SKIPPED").length;
    const faults = results.filter((r) => r.status === "FAIL" && r.isExecutionFault === true).length;
    const failed = results.filter((r) => r.status === "FAIL" && r.isExecutionFault !== true).length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    return {
      total,
      passed,
      failed,
      skipped,
      faults,
      passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
      totalDuration,
    };
  }

  /**
   * Package all artifacts (HTML report, XLSX, Videos, Screenshots) into a ZIP
   */
  static async createZipArchive(
    ticketId: string,
    results: TestResult[],
    summary?: TestExecutionSummary,
    environment?: string,
  ): Promise<string> {
    const ticketDir = this.ensureArtifactsDir(ticketId);
    const zipPath = path.join(
      this.ARTIFACTS_DIR,
      `${ticketId}_Artifacts_${Date.now()}.zip`,
    );

    const zip = new AdmZip();

    // 1. Add Excel Report
    try {
      const excelPath = await this.generateExcelReport(ticketId, results, summary, environment);
      zip.addLocalFile(excelPath);
    } catch (e) {
      console.error(`[TestExecution] Failed to add Excel report to ZIP:`, e);
    }

    // 2. Add Screenshots
    const screenshotDir = path.join(ticketDir, "screenshots");
    if (fs.existsSync(screenshotDir)) {
      const files = fs.readdirSync(screenshotDir);
      if (files.length > 0) {
        zip.addLocalFolder(screenshotDir, "screenshots");
      }
    }

    // 3. Add Videos
    const videoDir = path.join(ticketDir, "videos");
    if (fs.existsSync(videoDir)) {
      const files = fs.readdirSync(videoDir);
      if (files.length > 0) {
        zip.addLocalFolder(videoDir, "videos");
      }
    }

    // 4. Add HTML Report (if exists in ticket dir)
    const htmlFiles = fs
      .readdirSync(ticketDir)
      .filter((f) => f.endsWith(".html"));
    htmlFiles.forEach((f) => {
      zip.addLocalFile(path.join(ticketDir, f));
    });

    // Write ZIP
    zip.writeZip(zipPath);
    console.log(`[TestExecution] Artifacts ZIP created: ${zipPath}`);
    return zipPath;
  }

  /**
   * Generate a detailed Excel report for a test session (3-sheet format like ATT-13 successful run)
   */
  static async generateExcelReport(
    ticketId: string,
    results: TestResult[],
    summary?: TestExecutionSummary,
    environment?: string,
  ): Promise<string> {
    const ticketDir = this.ensureArtifactsDir(ticketId);
    const excelPath = path.join(
      ticketDir,
      `TestReport_${ticketId}_${Date.now()}.xlsx`,
    );

    const workbook = new ExcelJS.Workbook();

    // Styles
    const headerStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, color: { argb: "FFFFFFFF" } },
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4472C4" },
      },
      alignment: { horizontal: "center" },
    };

    const titleStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, size: 14, color: { argb: "FF4472C4" } },
      alignment: { horizontal: "left" },
    };

    // ========================================
    // Sheet 1: Execution Summary
    // ========================================
    const summarySheet = workbook.addWorksheet("Execution Summary", {
      properties: { tabColor: { argb: "FF4472C4" } },
    });

    // Title
    const titleRow = summarySheet.addRow([`Test Execution Report: ${ticketId}`]);
    titleRow.getCell(1).style = titleStyle;
    summarySheet.addRow([]);

    // Calculate summary if not provided
    const execSummary = summary || this.getExecutionSummary(results);

    // Metadata rows
    const summaryRows = [
      ["Ticket ID", ticketId],
      ["Environment", environment || "N/A"],
      ["Execution Date", new Date().toLocaleString()],
      ["Total Tests", execSummary.total],
      ["Passed", execSummary.passed],
      ["Failed", execSummary.failed],
      ["Skipped", execSummary.skipped],
      ["Pass Rate", `${execSummary.passRate.toFixed(1)}%`],
      ["Total Duration", `${(execSummary.totalDuration / 1000).toFixed(2)}s`],
    ];

    summaryRows.forEach(([key, value]) => {
      const row = summarySheet.addRow([key, value]);
      row.getCell(1).font = { bold: true };
    });

    // Column widths
    summarySheet.getColumn(1).width = 20;
    summarySheet.getColumn(2).width = 30;

    // ========================================
    // Sheet 2: Detailed Results
    // ========================================
    const detailSheet = workbook.addWorksheet("Detailed Results", {
      properties: { tabColor: { argb: "FF00B050" } },
    });

    detailSheet.columns = [
      { header: "Case ID", key: "id", width: 15 },
      { header: "Title", key: "title", width: 50 },
      { header: "Status", key: "status", width: 12 },
      { header: "Duration (ms)", key: "duration", width: 15 },
      { header: "Executed At", key: "executedAt", width: 25 },
      { header: "Error", key: "error", width: 50 },
    ];

    // Header Style
    detailSheet.getRow(1).eachCell((cell) => {
      cell.style = headerStyle;
    });

    // Data
    results.forEach((res) => {
      const row = detailSheet.addRow({
        id: res.testCaseId,
        title: res.testCaseTitle,
        status: res.status,
        duration: res.duration,
        executedAt: res.executedAt,
        error: res.errorMessage || "None",
      });

      // Conditional coloring for Status
      const statusCell = row.getCell("status");
      if (res.status === "PASS") {
        statusCell.font = { color: { argb: "FF00B050" }, bold: true };
      } else if (res.status === "FAIL") {
        statusCell.font = { color: { argb: "FFFF0000" }, bold: true };
      } else if (res.status === "SKIPPED") {
        statusCell.font = { color: { argb: "FFFFC000" }, bold: true };
      }
    });

    // ========================================
    // Sheet 3: Step Breakdown
    // ========================================
    const stepSheet = workbook.addWorksheet("Step Breakdown", {
      properties: { tabColor: { argb: "FFFFC000" } },
    });

    stepSheet.columns = [
      { header: "Case ID", key: "caseId", width: 15 },
      { header: "Step #", key: "stepNum", width: 10 },
      { header: "Action", key: "action", width: 50 },
      { header: "Verify", key: "verify", width: 40 },
      { header: "Expected Result", key: "expected", width: 40 },
      { header: "Actual Result", key: "actual", width: 40 },
      { header: "Status", key: "status", width: 12 },
      { header: "Screenshot", key: "screenshot", width: 15 },
    ];

    // Header Style
    stepSheet.getRow(1).eachCell((cell) => {
      cell.style = headerStyle;
    });

    // Step-level data
    results.forEach((res) => {
      res.steps.forEach((step) => {
        const row = stepSheet.addRow({
          caseId: res.testCaseId,
          stepNum: step.stepNumber,
          action: step.action,
          verify: step.expectedResult,
          expected: step.expectedResult,
          actual: step.actualResult || `Success: ${step.action}`,
          status: step.status,
          screenshot: step.screenshotPath ? "Yes" : "N/A",
        });

        // Color code status
        const statusCell = row.getCell("status");
        if (step.status === "PASS") {
          statusCell.font = { color: { argb: "FF00B050" }, bold: true };
        } else if (step.status === "FAIL") {
          statusCell.font = { color: { argb: "FFFF0000" }, bold: true };
        } else if (step.status === "SKIPPED") {
          statusCell.font = { color: { argb: "FFFFC000" }, bold: true };
        }
      });
    });

    // Write file
    await workbook.xlsx.writeFile(excelPath);
    console.log(`[TestExecution] Excel report generated: ${excelPath}`);
    return excelPath;
  }
}
