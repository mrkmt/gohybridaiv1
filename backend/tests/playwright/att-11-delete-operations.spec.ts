/**
 * ATT-11: Designation Delete Operations Test
 *
 * Tests the complete delete workflow for Designation management:
 * 1. Create a test designation
 * 2. Update the designation
 * 3. Delete the designation
 * 4. Verify deletion
 *
 * @author Qwen AI Assistant
 * @date March 29, 2026
 */

import { test, expect, Page } from '@playwright/test';
import { TESTING_CREDENTIALS } from './test-credentials';
import { generateDesignation } from './test-data-factory';

// Test configuration
const BASE_URL = TESTING_CREDENTIALS.baseUrl;
const USERNAME = TESTING_CREDENTIALS.username;
const PASSWORD = TESTING_CREDENTIALS.password;
const ID_NUMBER = TESTING_CREDENTIALS.idNumber;

// Generate unique test data using factory (avoids collisions)
const uniqueDesignation = generateDesignation();
const testDesignationName = uniqueDesignation.Designation;
const updatedDesignationName = `${uniqueDesignation.Designation}_Updated`;

test.describe('ATT-11: Designation Delete Operations', () => {
    let page: Page;

    test.beforeAll(async ({ browser }) => {
        page = await browser.newPage();
        console.log(`[ATT-11] Starting test with designation: ${testDesignationName}`);
    });

    test.afterAll(async () => {
        await page.close();
        console.log('[ATT-11] Test completed');
    });

    test('ATT-11.1: Navigate to Designation page', async () => {
        console.log('[Step 1] Navigating to Designation page...');
        
        await page.goto(BASE_URL);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        // Navigate to Designation module
        await page.click('a:has-text("Master"), .menu-item:has-text("Master")');
        await page.waitForTimeout(1000);
        
        await page.click('a:has-text("Designation"), .k-link:has-text("Designation")');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        // Verify we're on the Designation page
        const pageTitle = await page.textContent('h1, .page-title, .module-title');
        expect(pageTitle?.toLowerCase()).toContain('designation');
        
        console.log('[Step 1] ✅ Successfully navigated to Designation page');
    });

    test('ATT-11.2: Create test designation', async () => {
        console.log('[Step 2] Creating test designation...');
        
        // Click Add New button
        const addBtn = page.locator('button:has-text("Add New"), button:has-text("Create"), .btn-primary:has-text("New")').first();
        await addBtn.click();
        await page.waitForTimeout(2000);

        // Wait for form to render
        await page.waitForSelector('input[formcontrolname], kendo-textbox', { timeout: 5000 });

        // Fill designation name
        const nameInput = page.locator('input[formcontrolname="DesignationName"], input[name="DesignationName"], #DesignationName').first();
        await nameInput.fill(testDesignationName);

        // Fill short code
        const shortCodeInput = page.locator('input[formcontrolname="ShortCode"], input[name="ShortCode"]').first();
        await shortCodeInput.fill(`DT${timestamp.toString().slice(-6)}`);

        // Wait for Angular form validation
        try {
            await page.waitForFunction(() => {
                const btn = document.querySelector('button[type="submit"], .modal-footer button.btn-success') as HTMLButtonElement;
                return btn && !btn.disabled;
            }, { timeout: 5000 });
            console.log('[Step 2] ✅ Form validation complete');
        } catch (e) {
            console.log('[Step 2] ⚠️ Form validation timeout, attempting save anyway...');
        }

        // Click Save
        const saveBtn = page.locator('.modal-footer button.btn-success, button:has-text("Save"), button:has-text("Submit")').first();
        
        // Retry loop for disabled button
        let clickAttempts = 0;
        while (clickAttempts < 3) {
            if (await saveBtn.isEnabled()) break;
            clickAttempts++;
            await page.waitForTimeout(1000 * clickAttempts);
        }
        
        await saveBtn.click();
        await page.waitForTimeout(3000);

        // Verify success message
        const successVisible = await page.isVisible('.toast-success, .alert-success, .k-notification-success, div:has-text("Success")');
        expect(successVisible).toBe(true);

        console.log(`[Step 2] ✅ Created designation: ${testDesignationName}`);
    });

    test('ATT-11.3: Update the designation', async () => {
        console.log('[Step 3] Updating designation...');
        
        // Filter by designation name
        const filterInput = page.locator('input[placeholder*="Filter"], .k-textbox[placeholder*="Search"]').first();
        await filterInput.fill(testDesignationName);
        await page.waitForTimeout(1000);

        // Find and click edit button
        const row = page.locator('kendo-grid tbody tr').filter({ hasText: testDesignationName }).first();
        const editBtn = row.locator('button.btn, a.btn, .btn-edit, [title="Edit"]').first();
        await editBtn.click();
        await page.waitForTimeout(2000);

        // Wait for form
        await page.waitForSelector('input[formcontrolname], kendo-textbox', { timeout: 5000 });

        // Clear and update designation name
        const nameInput = page.locator('input[formcontrolname="DesignationName"]').first();
        await nameInput.clear();
        await nameInput.fill(updatedDesignationName);

        // Wait for validation
        try {
            await page.waitForFunction(() => {
                const btn = document.querySelector('button[type="submit"], .modal-footer button.btn-success') as HTMLButtonElement;
                return btn && !btn.disabled;
            }, { timeout: 5000 });
        } catch (e) {
            console.log('[Step 3] ⚠️ Form validation timeout');
        }

        // Click Save
        const saveBtn = page.locator('.modal-footer button.btn-success, button:has-text("Save")').first();
        if (await saveBtn.isEnabled()) {
            await saveBtn.click();
            await page.waitForTimeout(3000);
        }

        // Verify success
        const successVisible = await page.isVisible('.toast-success, .alert-success, div:has-text("Success")');
        expect(successVisible).toBe(true);

        console.log(`[Step 3] ✅ Updated designation to: ${updatedDesignationName}`);
    });

    test('ATT-11.4: Delete the designation', async () => {
        console.log('[Step 4] Deleting designation...');
        
        // Filter by updated name
        const filterInput = page.locator('input[placeholder*="Filter"], .k-textbox[placeholder*="Search"]').first();
        await filterInput.clear();
        await filterInput.fill(updatedDesignationName);
        await page.waitForTimeout(1000);

        // Find and click delete button
        const row = page.locator('kendo-grid tbody tr').filter({ hasText: updatedDesignationName }).first();
        const deleteBtn = row.locator('button.btn-danger, button:has-text("Delete"), [title="Delete"]').first();
        await deleteBtn.click();
        await page.waitForTimeout(1000);

        // Confirm deletion
        const confirmBtn = page.locator('button:has-text("Yes"), button:has-text("OK"), button:has-text("Confirm")').first();
        await confirmBtn.click();
        await page.waitForTimeout(3000);

        // Verify success message
        const successVisible = await page.isVisible('.toast-success, .alert-success, div:has-text("deleted")');
        expect(successVisible).toBe(true);

        console.log(`[Step 4] ✅ Deleted designation: ${updatedDesignationName}`);
    });

    test('ATT-11.5: Verify deletion from grid', async () => {
        console.log('[Step 5] Verifying deletion...');
        
        // Clear filter
        const filterInput = page.locator('input[placeholder*="Filter"], .k-textbox[placeholder*="Search"]').first();
        await filterInput.clear();
        await page.waitForTimeout(500);

        // Search for the deleted designation
        await filterInput.fill(updatedDesignationName);
        await page.waitForTimeout(1000);

        // Verify no results found
        const grid = page.locator('kendo-grid tbody');
        const rowCount = await grid.locator('tr').count();
        
        // Should have 0 rows (or only "no records" message)
        expect(rowCount).toBeLessThanOrEqual(1);

        // Alternative: Check for "no records" message
        const noRecordsVisible = await page.isVisible('text="No records found", text="No data", .k-grid-no-records');
        
        if (!noRecordsVisible) {
            // Double-check by trying to find the specific text
            const rowWithText = page.locator(`tr:has-text("${updatedDesignationName}")`);
            const exists = await rowWithText.count() > 0;
            expect(exists).toBe(false);
        }

        console.log('[Step 5] ✅ Verified designation was deleted');
    });
});
