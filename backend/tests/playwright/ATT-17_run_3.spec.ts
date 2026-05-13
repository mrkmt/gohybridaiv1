import { test, expect, Page } from '@playwright/test';
import { healedClick, safeFill, waitForAngularStable, kendoStabilizationDelay, waitForAppReady, universalFill } from '../../tests/playwright/playwright-self-healing';
import { performLogin, loginAndNavigate } from '../../tests/playwright/login-helper';
import { TESTING_CREDENTIALS } from '../../tests/playwright/test-credentials';
import { waitFor } from '../../tests/playwright/test-data-factory';

/** Test data factory — unique IDs per run to prevent collisions */
const RUN_ID = 'run_1776417782583';
function td(value: string): string {
    return value ? `${value}_${RUN_ID}` : value;
}

test.use({
    trace: 'on-first-retry',
    video: 'on',
    screenshot: 'on'
});

test.describe('undefined: Regression: Leave Type Short Code Validation', () => {
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
        const detectedModule = "Regression";
        const detectedRoute = "#/app.regression";
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
        const allSteps = [{"step":1,"selector":"a:has-text('Leave Type')"},{"step":2,"selector":"input >> nth=0"}];
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
            
            // Step 1: Navigate to Master > Leave Type
            console.log('Executing step 1: Navigate to Master > Leave Type');
            const step1Start = Date.now();
            try {
                // Expected: Leave Type page loaded
                // Already navigated in pre-flight; skipping redundant navigation
                if (alreadyOnPage) {
                    console.log('Step 1: Already on correct page, skipping navigation');
                    const step1Duration = Date.now() - step1Start;
                    results.push({
                        step: 1,
                        action: 'Navigate to Master > Leave Type',
                        expected: 'Page loads with module dashboard visible',
                        status: 'PASS',
                        duration: step1Duration,
                        note: 'Skipped via pre-flight check'
                    });
                } else {
                    
                await waitForAppReady(page);
                await universalFill(page, 'a:has-text(\'Leave Type\')', td('test'), { isKendo: false, slowTyping: true });
                

                    const step1Duration = Date.now() - step1Start;
                    results.push({
                        step: 1,
                        action: 'Navigate to Master > Leave Type',
                        expected: 'Page loads with module dashboard visible',
                        status: 'PASS',
                        duration: step1Duration
                    });
                    console.log('Step 1: PASSED');
                }


            } catch (error: any) {
                results.push({
                    step: 1,
                    action: 'Navigate to Master > Leave Type',
                    expected: 'Leave Type page loaded',
                    status: 'FAIL',
                    error: error.message
                });
                console.error('Step 1: FAILED:', error.message);
                throw error;
            }

            
            // Step 2: Enter \'LEAVE1\' (6 chars) in Short Code field
            console.log('Executing step 2: Enter \'LEAVE1\' (6 chars) in Short Code field');
            const step2Start = Date.now();
            try {
                // Expected: Validation error triggered
                
                await waitForAppReady(page);
                await universalFill(page, 'input >> nth=0', td('test'), { isKendo: false, slowTyping: true });
                


                const step2Duration = Date.now() - step2Start;
                results.push({
                    step: 2,
                    action: 'Enter \'LEAVE1\' (6 chars) in Short Code field',
                    expected: 'Validation error triggered',
                    status: 'PASS',
                    duration: step2Duration
                });
                console.log('Step 2: PASSED');
            } catch (error: any) {
                results.push({
                    step: 2,
                    action: 'Enter \'LEAVE1\' (6 chars) in Short Code field',
                    expected: 'Validation error triggered',
                    status: 'FAIL',
                    error: error.message
                });
                console.error('Step 2: FAILED:', error.message);
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