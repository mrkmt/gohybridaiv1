import { test, expect } from '@playwright/test';
import { healedClick, safeFill, waitForAngularStable } from './playwright-self-healing';
import { generateDesignation } from './test-data-factory';

test.describe('ATT-13: Designation Management CRUD', () => {
    // Generate unique test data per run
    const uniqueData = generateDesignation();
    test.beforeEach(async ({ page }) => {
        // Use environment variables for login
        const baseUrl = process.env.BASE_URL || 'https://test.globalhr.com.mm/ook';
        await page.goto(`${baseUrl}#/dashboard`);
        
        // Handle login if needed (assuming session is already active or handled by global setup)
        // If not, we'd add login steps here.
    });

    test('ATT_13_001: Create new designation with valid data', async ({ page }) => {
        console.log('Starting ATT_13_001...');

        // 1. Direct Navigation to Designation Menu (Golden Flow)
        await page.goto(`${process.env.BASE_URL || 'https://test.globalhr.com.mm/ook'}#/app.designation`);
        await waitForAngularStable(page);

        // 2. Click 'Add' button
        await healedClick(page, 'button:has-text("Add"), .k-button:has-text("Add")');
        await waitForAngularStable(page);

        // 3. Fill Designation Name (unique per run)
        await safeFill(page, 'input[formcontrolname="designationName"], input[name="name"]', uniqueData.Designation);

        // 4. Fill Description
        await safeFill(page, 'textarea[formcontrolname="description"], textarea[name="description"]', 'Auto Generated Description');

        // 5. Click Save (4-tier click will handle the Angular/Kendo 'Save' button)
        await healedClick(page, 'button:has-text("Save"), .k-button:has-text("Save"), button[type="submit"]');

        // 6. Verify Success
        await expect(page.locator('text=Saved Successfully, text=Success')).toBeVisible({ timeout: 15000 });
        console.log(`✅ ATT_13_001 Passed: Created ${uniqueData.Designation}`);
    });

    test('ATT_13_002: Create designation without required name field', async ({ page }) => {
        await page.goto(`${process.env.BASE_URL || 'https://test.globalhr.com.mm/ook'}#/app.designation`);
        await healedClick(page, 'button:has-text("Add")');

        // Fill ShortCode but skip Name (to trigger validation)
        await safeFill(page, 'input[formcontrolname="ShortCode"], input[name="Short Code"]', uniqueData.ShortCode);

        // Click Save without filling Name
        await healedClick(page, 'button:has-text("Save")');

        // Should show validation error
        await expect(page.locator('.text-danger, .k-invalid-msg, .ng-invalid')).toBeVisible({ timeout: 10000 });
        console.log('✅ ATT_13_002 Passed: Validation triggered for missing Name field');
    });
});
