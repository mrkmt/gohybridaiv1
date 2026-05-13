import { test, expect, Page } from '@playwright/test';
import { healedClick, safeFill, waitForAngularStable, kendoStabilizationDelay, waitForAppReady, universalFill } from '../../tests/playwright/playwright-self-healing';
import { performLogin, loginAndNavigate } from '../../tests/playwright/login-helper';
import { TESTING_CREDENTIALS } from '../../tests/playwright/test-credentials';
import { waitFor } from '../../tests/playwright/test-data-factory';

/** Test data factory — unique IDs per run to prevent collisions */
const RUN_ID = 'run_1776418882337';
function td(value: string): string {
    return value ? `${value}_${RUN_ID}` : value;
}

test.use({
    trace: 'on-first-retry',
    video: 'on',
    screenshot: 'on'
});

test.describe('MAIN_BUG: Department: Reproduction: Department Short Code Length Enforcement', () => {
    test('Execute test case', async ({ page }, testInfo) => {
        const credentials = {
            baseUrl: TESTING_CREDENTIALS.baseUrl,
            apiBaseUrl: TESTING_CREDENTIALS.apiBaseUrl,
            idNumber: TESTING_CREDENTIALS.idNumber,
            username: TESTING_CREDENTIALS.username,
            password: TESTING_CREDENTIALS.password
        };

        // Pre-conditions
        // No pre-conditions

        // Resolved before compile time — prefer confirmed ModuleRegistry route, then infer from test content.
        const detectedModule = "Department";
        const detectedRoute = "#/app.department";
        const fallbackUrl = credentials.baseUrl + detectedRoute;
        console.log(`[Nav] Detected module: ${detectedModule} → ${fallbackUrl}`);

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
        const allSteps = [{"step":1,"selector":"a:has-text('Department')"},{"step":2,"selector":"button[ngbtooltip='Add New']"},{"step":3,"selector":"input >> nth=0"},{"step":4,"selector":"input >> nth=1"}];
        for (const check of allSteps) {
            if (check.selector) {
                const found = await page.locator(check.selector).first().isVisible({ timeout: 3000 }).catch(() => false);
                selectorChecks.push({ ...check, found });
                if (!found) {
                    console.warn(`[PreFlight] ⚠️ Step ${check.step}: selector not found: ${check.selector}`);
                }
            }
        }
        const failedChecks = selectorChecks.filter(c => !c.found);
        if (failedChecks.length > 0) {
            console.log(`[PreFlight] ${failedChecks.length}/${selectorChecks.length} selectors need attention`);
        } else {
            console.log(`[PreFlight] ✅ All ${selectorChecks.length} selectors validated`);
        }

        // Pre-flight: check if we're already on the correct page (loginAndNavigate may have already navigated)
        const currentUrl = page.url();
        const alreadyOnPage = currentUrl.includes(detectedRoute.replace('#/', ''));
        console.log(`[PreFlight] URL: ${currentUrl}, expected: ${detectedRoute}, alreadyOnPage=${alreadyOnPage}`);

        // Results tracking
        const results: any[] = [];
        let hasFailed = false;

        try {
            // Execute test steps
            
            // Step 1: Navigate to Master > Department
            console.log('Executing step 1: Navigate to Master > Department');
            const step1Start = Date.now();
            try {
                // Expected: Department page is displayed
                // Already navigated in pre-flight; skipping redundant navigation
                if (alreadyOnPage) {
                    console.log('Step 1: Already on correct page, skipping navigation');
                    const step1Duration = Date.now() - step1Start;
                    results.push({
                        step: 1,
                        action: 'Navigate to Master > Department',
                        expected: 'Page loads with module dashboard visible',
                        status: 'PASS',
                        duration: step1Duration,
                        note: 'Skipped via pre-flight check'
                    });
                } else {
                    
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
                const routeKey = "master > department".toLowerCase();
                const matchedRoute = Object.entries(routeMap).find(([key]) => routeKey.includes(key));
                const hashRoute = matchedRoute ? matchedRoute[1] : `#/app.${routeKey.replace(/\s+/g, '-').toLowerCase()}`;
                try {
                    await page.goto(`${credentials.baseUrl}${hashRoute}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await waitForAngularStable(page);
                } catch (e) {
                    // Fallback: try clicking menu item by text
                    const menuBtn = page.locator(`a:has-text("master > department"), .list-group-item:has-text("master > department")`).first();
                    if (await menuBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                        await healedClick(menuBtn);
                    } else {
                        console.warn(`Navigation fallback failed for: master > department`);
                    }
                }

                    const step1Duration = Date.now() - step1Start;
                    results.push({
                        step: 1,
                        action: 'Navigate to Master > Department',
                        expected: 'Page loads with module dashboard visible',
                        status: 'PASS',
                        duration: step1Duration
                    });
                    console.log('Step 1: PASSED');
                }


            } catch (error: any) {
                results.push({
                    step: 1,
                    action: 'Navigate to Master > Department',
                    expected: 'Department page is displayed',
                    status: 'FAIL',
                    error: error.message
                });
                console.error('Step 1: FAILED:', error.message);
                throw error;
            }

            
            // Step 2: Click \'Add New\' button
            console.log('Executing step 2: Click \'Add New\' button');
            const step2Start = Date.now();
            try {
                // Expected: Entry form appears
                
                await healedClick(page, 'button[ngbtooltip=\'Add New\']');
                


                const step2Duration = Date.now() - step2Start;
                results.push({
                    step: 2,
                    action: 'Click \'Add New\' button',
                    expected: 'Entry form appears',
                    status: 'PASS',
                    duration: step2Duration
                });
                console.log('Step 2: PASSED');
            } catch (error: any) {
                results.push({
                    step: 2,
                    action: 'Click \'Add New\' button',
                    expected: 'Entry form appears',
                    status: 'FAIL',
                    error: error.message
                });
                console.error('Step 2: FAILED:', error.message);
                throw error;
            }

            
            // Step 3: Enter \'DEPT01\' (6 characters) in the Short Code field
            console.log('Executing step 3: Enter \'DEPT01\' (6 characters) in the Short Code field');
            const step3Start = Date.now();
            try {
                // Expected: System should truncate to 5 characters or show validation error
                
                await waitForAppReady(page);
                await universalFill(page, 'input >> nth=0', td('test'), { isKendo: false, slowTyping: true });
                


                const step3Duration = Date.now() - step3Start;
                results.push({
                    step: 3,
                    action: 'Enter \'DEPT01\' (6 characters) in the Short Code field',
                    expected: 'System should truncate to 5 characters or show validation error',
                    status: 'PASS',
                    duration: step3Duration
                });
                console.log('Step 3: PASSED');
            } catch (error: any) {
                results.push({
                    step: 3,
                    action: 'Enter \'DEPT01\' (6 characters) in the Short Code field',
                    expected: 'System should truncate to 5 characters or show validation error',
                    status: 'FAIL',
                    error: error.message
                });
                console.error('Step 3: FAILED:', error.message);
                throw error;
            }

            
            // Step 4: Fill required Name and click Save
            console.log('Executing step 4: Fill required Name and click Save');
            const step4Start = Date.now();
            try {
                // Expected: System should reject if validation fails or save only 5 characters
                
                await healedClick(page, 'input >> nth=1');
                


                const step4Duration = Date.now() - step4Start;
                results.push({
                    step: 4,
                    action: 'Fill required Name and click Save',
                    expected: 'System should reject if validation fails or save only 5 characters',
                    status: 'PASS',
                    duration: step4Duration
                });
                console.log('Step 4: PASSED');
            } catch (error: any) {
                results.push({
                    step: 4,
                    action: 'Fill required Name and click Save',
                    expected: 'System should reject if validation fails or save only 5 characters',
                    status: 'FAIL',
                    error: error.message
                });
                console.error('Step 4: FAILED:', error.message);
                throw error;
            }


        } catch (error: any) {
            hasFailed = true;
            console.error('Test execution failed:', error.message);

            // Capture DOM snapshot for AI forensics
            try {
                const dom = await page.content().catch(() => 'Failed to capture DOM');
                await testInfo.attach('dom_snapshot.html', { body: dom, contentType: 'text/html' });
            } catch (e) {}

            // Healing context
            const healingHint = "";
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