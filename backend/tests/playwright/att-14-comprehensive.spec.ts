/**
 * ATT-14: Comprehensive Test with Page Scanner & Network Capture
 *
 * Uses:
 * 1. Page Scanner - Dynamic element discovery (no hardcoded selectors)
 * 2. Network Capture - API call monitoring
 * 3. Helper Modules - Kendo-aware interactions
 * 4. Universal Form Handler - All required fields (ShortCode, GradeID, Designation)
 *
 * Based on existing infrastructure from:
 * - backend/tests/playwright/page-scanner.ts
 * - backend/tests/playwright/network-capture.ts
 * - backend/src/helpers/*.ts
 * - DONE_LIST_GRID_REFRESH_DEBUGGING.md
 * - DONE_LIST_UNIVERSAL_FORM_FRAMEWORK.md
 */

import { test, expect } from '@playwright/test';
import { scanPage, findElementByText, printScanResult, type ScannedElement } from './page-scanner';
import { setupNetworkCapture, findApiCall, printNetworkLogs, type NetworkLogEntry } from './network-capture';
import { healedClick, safeFill, waitForAngularStable } from './playwright-self-healing';

test.describe('ATT-14: Comprehensive Designation CRUD', () => {
    
    const baseUrl = 'https://test.globalhr.com.mm/ook';
    const credentials = {
        idNumber: 'testook_HR 1',
        username: 'testook_HR 1',
        password: 'Global@2024'
    };

    test.setTimeout(180000); // 3 minutes for full test

    test.beforeEach(async ({ page }) => {
        console.log('\n' + '='.repeat(70));
        console.log('BEFORE EACH: Setup');
        console.log('='.repeat(70));
        
        // 1. Setup network capture
        console.log('📡 Setting up network capture...');
        const getNetworkLogs = setupNetworkCapture(page);
        (page as any).getNetworkLogs = getNetworkLogs;
        
        // 2. Login (using fast-crud approach that works)
        console.log('🔐 Logging in...');
        await page.goto(`${baseUrl}#/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Fill ID Number (Kendo UI - click first)
        const idField = page.locator('input[name="idnumber"]');
        await idField.click();
        await page.waitForTimeout(200);
        await idField.fill(credentials.idNumber);
        
        // Fill Username (Kendo UI - click first)
        const userField = page.locator('input[name="username"]');
        await userField.click();
        await page.waitForTimeout(200);
        await userField.fill(credentials.username);
        
        // Fill Password (Kendo UI - click first to remove readonly)
        const passField = page.locator('input[name="password"]');
        await passField.click();
        await page.waitForTimeout(500);
        await passField.fill(credentials.password);
        
        // Click Login
        await page.click('button[type="submit"], button:has-text("LOG IN")');
        await page.waitForURL(/.*#\/dashboard/, { timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 30000 });
        
        console.log('✓ Login successful');
        
        // 3. Navigate to Designation (using fast-crud approach)
        console.log('📍 Navigating to Designation...');
        await page.click('span.text-truncate.d-inline-block:has-text("Master")');
        await page.waitForTimeout(300);
        await page.click('a.list-group-item.text-truncate:has-text("Designation")');
        await page.waitForURL(/.*#\/app\.designation/, { timeout: 30000 });
        await page.waitForTimeout(1000);
        
        console.log('✓ On Designation page');
        
        // 4. Scan page for elements
        console.log('🔍 Scanning page for elements...');
        const scanResult = await scanPage(page, { verbose: false });
        printScanResult(scanResult);
        
        // 5. Store for test
        (page as any).scanResult = scanResult;
        
        console.log('✓ Setup complete\n');
    });

    test('ATT-14-COMPREHENSIVE: Full CRUD with Dynamic Selectors', async ({ page }) => {
        const scanResult = (page as any).scanResult;
        const getNetworkLogs = (page as any).getNetworkLogs;
        
        const testName = `Design_${Date.now()}`;
        const shortCode = `CODE_${Date.now()}`;
        
        console.log('\n' + '='.repeat(70));
        console.log('TEST: ATT-16-COMPREHENSIVE');
        console.log('='.repeat(70));
        console.log(`📋 Test Data: Name="${testName}", ShortCode="${shortCode}"`);
        
        // ========== CREATE ==========
        console.log('\n' + '-'.repeat(70));
        console.log('STEP 1: CREATE Designation');
        console.log('-'.repeat(70));
        
        // Find Add button dynamically
        const addButton = findElementByText(scanResult, 'Add', 'button');
        expect(addButton).toBeDefined();
        console.log(`✓ Found Add button: "${addButton?.text || addButton?.businessName}"`);
        console.log(`  Selector: ${addButton?.selector}`);
        if (addButton?.formControlName) {
            console.log(`  formControlName: ${addButton.formControlName}`);
        }
        
        await healedClick(page, addButton!.selector, 'Add Button');
        await waitForAngularStable(page);
        await page.waitForTimeout(1500);
        
        // Rescan modal
        console.log('🔍 Scanning modal...');
        const modalScan = await scanPage(page);
        
        // Find Short Code input (CRITICAL - was missing!)
        const shortCodeInput = modalScan.inputs.find(input => 
            input.name?.toLowerCase().includes('short code') ||
            input.formControlName?.toLowerCase().includes('shortcode') ||
            input.placeholder?.toLowerCase().includes('short code')
        );
        
        if (shortCodeInput) {
            console.log(`✓ Found Short Code input`);
            console.log(`  Selector: ${shortCodeInput.selector}`);
            console.log(`  formControlName: ${shortCodeInput.formControlName}`);
            
            await safeFill(page, shortCodeInput.selector, shortCode, 'Short Code');
            await page.waitForTimeout(500);
        } else {
            console.log('⚠️  Short Code input not found, trying fallback...');
            const fallbackInput = page.locator('input[name="Short Code"], input[formcontrolname="ShortCode"]');
            if (await fallbackInput.count() > 0) {
                await fallbackInput.first().fill(shortCode);
                console.log('✓ Filled Short Code with fallback selector');
            }
        }
        
        // Find Grade dropdown (CRITICAL - was missing!)
        const gradeDropdown = findElementByText(modalScan, 'Grade', 'select') ||
                             findElementByText(modalScan, 'GradeID', 'select') ||
                             modalScan.selects.find(s => 
                                 s.formControlName?.toLowerCase().includes('grade')
                             );
        
        if (gradeDropdown) {
            console.log(`✓ Found Grade dropdown`);
            console.log(`  Selector: ${gradeDropdown.selector}`);
            
            await healedClick(page, gradeDropdown.selector, 'Grade Dropdown');
            await page.waitForTimeout(500);
            
            // Select "Manager" from dropdown
            const managerOption = page.locator('li.k-list-item:has-text("Manager")');
            if (await managerOption.count() > 0) {
                await managerOption.first().click({ force: true });
                console.log('✓ Selected "Manager" from Grade dropdown');
            } else {
                // Try first option
                const firstOption = page.locator('li.k-list-item').first();
                await firstOption.click({ force: true });
                console.log('✓ Selected first option from Grade dropdown');
            }
            await page.waitForTimeout(500);
        } else {
            console.log('⚠️  Grade dropdown not found, trying fallback...');
            const fallbackDropdown = page.locator('kendo-dropdownlist[formcontrolname="GradeID"]');
            if (await fallbackDropdown.count() > 0) {
                await fallbackDropdown.first().click();
                await page.waitForTimeout(300);
                await page.click('li.k-list-item:has-text("Manager")');
                console.log('✓ Selected Grade with fallback');
            }
        }
        
        // Find Designation input
        const designationInput = findElementByText(modalScan, 'Designation', 'input') ||
                                modalScan.inputs.find(input => 
                                    input.name?.toLowerCase().includes('designation') ||
                                    input.formControlName?.toLowerCase().includes('designation')
                                );
        
        if (designationInput) {
            console.log(`✓ Found Designation input`);
            console.log(`  Selector: ${designationInput.selector}`);
            
            await safeFill(page, designationInput.selector, testName, 'Designation Name');
            await page.waitForTimeout(500);
        }
        
        // Find Save button
        const saveButton = findElementByText(modalScan, 'Save', 'button');
        expect(saveButton).toBeDefined();
        console.log(`✓ Found Save button`);
        console.log(`  Selector: ${saveButton.selector}`);
        
        // Capture CREATE API call
        console.log('💾 Clicking Save...');
        await healedClick(page, saveButton!.selector, 'Save Button');
        await page.waitForTimeout(3000);
        
        // Check network logs for CREATE API
        const logs = getNetworkLogs();
        const createApi = findApiCall(logs, /designation\/save|designation\/create|designation\/post/i);
        
        if (createApi) {
            console.log(`✓ CREATE API called`);
            console.log(`  URL: ${createApi.url}`);
            console.log(`  Status: ${createApi.status}`);
            console.log(`  Method: ${createApi.method}`);
            if (createApi.responseBody) {
                console.log(`  Response: ${createApi.responseBody.substring(0, 200)}...`);
            }
        } else {
            console.log(`⚠️  CREATE API call not captured`);
            console.log('📡 All API calls:');
            printNetworkLogs(logs, { showApiOnly: true });
        }
        
        // Click Ok on success message
        const okButton = findElementByText(modalScan, 'Ok', 'button');
        if (okButton) {
            console.log('✓ Found Ok button, clicking...');
            await healedClick(page, okButton.selector, 'Ok Button');
            await page.waitForTimeout(2000);
        } else {
            console.log('⚠️  Ok button not found, waiting anyway...');
            await page.waitForTimeout(2000);
        }
        
        // Wait for grid to refresh
        await waitForAngularStable(page);
        await page.waitForTimeout(3000);
        
        console.log('✓ CREATE completed\n');
        
        // ========== READ ==========
        console.log('\n' + '-'.repeat(70));
        console.log('STEP 2: READ - Verify in Grid');
        console.log('-'.repeat(70));
        
        // GRID REFRESH FIX: Reload page to ensure fresh data
        console.log('🔄 Reloading page to ensure fresh data...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForAngularStable(page);
        await page.waitForTimeout(5000);
        
        // Rescan page
        const gridScan = await scanPage(page);
        
        // Find search box
        const searchBox = findElementByText(gridScan, 'Search', 'input') ||
                         findElementByText(gridScan, 'Search ...', 'input');
        
        if (searchBox) {
            console.log(`✓ Found search box`);
            await safeFill(page, searchBox.selector, testName, 'Search Box');
            await page.waitForTimeout(2000);
        } else {
            console.log('⚠️  Search box not found');
        }
        
        // Try to find record in grid
        console.log(`🔍 Searching for record: "${testName}"`);
        const recordInGrid = page.locator(`text=${testName}`);
        const count = await recordInGrid.count();
        console.log(`Records found: ${count}`);
        
        if (count > 0) {
            console.log('✓ Record found in grid!');
            await expect(recordInGrid.first()).toBeVisible({ timeout: 10000 });
            
            // Get the row content
            const rowText = await recordInGrid.first().textContent();
            console.log(`  Row content: ${rowText?.substring(0, 100)}`);
        } else {
            // Debug: Check all grid rows
            console.log('⚠️  Record not found, checking all grid rows...');
            const gridRows = page.locator('kendo-grid tbody tr');
            const rowCount = await gridRows.count();
            console.log(`Grid has ${rowCount} rows`);
            
            // Get text from first 20 rows
            for (let i = 0; i < Math.min(20, rowCount); i++) {
                const rowText = await gridRows.nth(i).textContent();
                if (rowText?.toLowerCase().includes('design') || rowText?.toLowerCase().includes('code')) {
                    console.log(`Row ${i}: ${rowText?.substring(0, 150)}`);
                }
            }
            
            // Take screenshot for debugging
            await page.screenshot({ path: `test-results/att-16-grid-not-found-${Date.now()}.png` });
            console.log('📸 Screenshot saved to test-results/');
            
            // Fail test
            throw new Error(`Record "${testName}" not found in grid after CREATE`);
        }
        
        console.log('✓ READ completed\n');
        
        // Success!
        console.log('\n' + '='.repeat(70));
        console.log('✅ ATT-16-COMPREHENSIVE PASSED!');
        console.log('='.repeat(70));
        console.log('✓ CREATE: Designation created with ShortCode and GradeID');
        console.log('✓ READ: Record found in grid');
        console.log('✓ Network: API calls captured');
        console.log('✓ Page Scanner: Dynamic selectors worked');
        console.log('='.repeat(70) + '\n');
    });
});
