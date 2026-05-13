import { test, expect, Page } from '@playwright/test';
import { loginAndNavigate } from './playwright/login-helper';
import { healedClick, waitForAngularStable, universalFill } from './playwright/playwright-self-healing';
import { TestDataService } from '../src/services/TestDataService';
import { TESTING_CREDENTIALS } from './playwright/test-credentials';

// Wait for Kendo loading masks
async function waitForLoadingMask(page: Page, timeoutMs: number = 15000): Promise<void> {
  try {
    const mask = page.locator('.k-loading-mask, .loading-overlay, .spinner-border');
    if (await mask.count() > 0) {
      await mask.first().waitFor({ state: 'hidden', timeout: timeoutMs });
    }
  } catch { /* no-op */ }
}

test.use({
  baseURL: TESTING_CREDENTIALS.baseUrl,
  viewport: { width: 1280, height: 720 },
  actionTimeout: 30000,
  navigationTimeout: 30000,
});

test.describe('ATT-22: Department Short Code Validation Repro', () => {
  test('Verify Short Code is required', async ({ page }) => {
    test.setTimeout(180000);
    const testData = new TestDataService(page);
    
    console.log('[Test] Logging in and navigating to Department...');
    try {
        await loginAndNavigate(
            page,
            TESTING_CREDENTIALS,
            'Department',
            TESTING_CREDENTIALS.baseUrl + '#/app.department'
        );
    } catch (e) {
        console.warn('Navigation failed, trying direct page.goto as fallback');
        await page.goto(TESTING_CREDENTIALS.baseUrl + '#/app.department', { waitUntil: 'networkidle' });
    }
    
    await waitForAngularStable(page);
    await page.waitForTimeout(5000);

    console.log('Clicking Add New');
    const addNewBtn = page.locator('button[ngbtooltip="Add New"], button:has-text("Add New"), a:has-text("Add New"), .k-button:has-text("Add New")');
    await expect(addNewBtn.first()).toBeVisible({ timeout: 20000 });
    await healedClick(page, addNewBtn.first());
    await waitForLoadingMask(page);

    console.log('Leaving Short Code empty and filling Name');
    const nameInput = page.locator('input[formcontrolname="Name"], input[name="Name"], #Name, [placeholder*="Name" i]');
    await expect(nameInput.first()).toBeVisible();
    await universalFill(page, nameInput.first(), testData.uniqueName('ReproDept'), { slowTyping: true });

    console.log('Clicking Save');
    const saveBtn = page.locator('button[type="submit"], button:has-text("Save"), a:has-text("Save"), .k-button-solid-primary:has-text("Save")');
    await healedClick(page, saveBtn.first());

    console.log('Verifying validation message for Short Code');
    const validationMessage = page.locator('.text-danger, .validation-message, [nz-form-explain], .ant-form-item-explain, .k-invalid-msg, .ng-invalid');
    
    // Check if the bug is reproduced (expect failing to find validation)
    await expect(validationMessage.first()).toBeVisible({ timeout: 10000 });
    const text = await validationMessage.first().textContent();
    console.log(`Validation text found: ${text}`);
    expect(text?.toLowerCase()).toMatch(/required|short code/);
  });
});
