/**
 * Universal Test Template for Manual Recordings
 * 
 * This template is used for ALL form-based tests (Designation, Employee, Team, etc.)
 * Just update the configuration section below.
 * 
 * FLOW:
 * 1. Login using login-helper (Kendo UI workaround included)
 * 2. Navigate to target page via menu
 * 3. Execute CRUD operations from recording
 * 4. Verify each step
 */

import { test, expect, Page } from '@playwright/test';
import { loginAndNavigate } from './login-helper';
import { healedClick, safeFill, waitForAngularStable } from './playwright-self-healing';
import { TESTING_CREDENTIALS } from './test-credentials';
import { generateDesignation } from './test-data-factory';

// ============================================================================
// CONFIGURATION - UPDATE THIS SECTION FOR EACH FORM
// ============================================================================

// Generate unique test data to avoid collisions
const uniqueData = generateDesignation();

const TEST_CONFIG = {
    // Menu name (must match exactly what appears in navigation menu)
    menuName: 'Designation',

    // URL fallback if menu navigation fails
    fallbackUrl: 'https://test.globalhr.com.mm/ook#/app.designation',

    // Test data from factory (unique per run)
    testData: {
        shortCode: uniqueData.ShortCode,
        name: uniqueData.Designation,
        updatedName: `${uniqueData.Designation}_upd`,
        searchQuery: uniqueData.ShortCode.toLowerCase(),
        gradeName: uniqueData.GradeID  // For dropdown selection
    },
    
    // Selectors (from recording - these are stable across tests)
    selectors: {
        addButton: 'button.btn.btn-primary, button:has-text("Add")',
        saveButton: 'button.btn.btn-success:has-text("Save"), button[type="submit"]',
        updateButton: 'button.btn.btn-success:has-text("Update"), button[type="submit"]',
        okButton: 'button.btn.btn-success:has-text("Ok")',
        yesButton: 'button.btn.btn-success:has-text("Yes")',
        searchBox: 'input[placeholder="Search ..."]',
        nameField: 'input[formcontrolname="Designation"], input[name="Designation"]',
        shortCodeField: 'input[formcontrolname="ShortCode"], input[name="Short Code"]',
        gradeDropdown: 'kendo-dropdownlist[formcontrolname="GradeID"]'
    }
};

// ============================================================================
// TEST DEFINITION - NO NEED TO MODIFY BELOW
// ============================================================================

test.describe(`${TEST_CONFIG.menuName} CRUD (Auto-Generated)`, () => {
    const credentials = {
        baseUrl: TESTING_CREDENTIALS.baseUrl,
        apiBaseUrl: TESTING_CREDENTIALS.apiBaseUrl,
        idNumber: TESTING_CREDENTIALS.idNumber,
        username: TESTING_CREDENTIALS.username,
        password: TESTING_CREDENTIALS.password
    };
    
    const NAVIGATION_TIMEOUT = 180000;
    const ELEMENT_TIMEOUT = 90000;

    test.beforeEach(async ({ page }) => {
        console.log('\n' + '='.repeat(70));
        console.log(`BEFORE EACH: Login and Navigate to ${TEST_CONFIG.menuName}`);
        console.log('='.repeat(70));
        
        // Login using login-helper (handles Kendo UI readonly password field)
        await loginAndNavigate(
            page,
            credentials,
            TEST_CONFIG.menuName,
            TEST_CONFIG.fallbackUrl
        );
        
        // Wait for page stability
        await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT });
        await waitForAngularStable(page);
        await page.waitForTimeout(3000);
        
        console.log(`✓ Ready on ${TEST_CONFIG.menuName} page\n`);
    });

    test('should complete full CRUD flow', async ({ page }) => {
        console.log(`Starting ${TEST_CONFIG.menuName} CRUD test...`);
        
        // ========== CREATE ==========
        console.log('\n[CREATE] Step 1: Creating new ' + TEST_CONFIG.menuName + '...');
        
        await testCreate(page, TEST_CONFIG, ELEMENT_TIMEOUT);
        
        // ========== READ ==========
        console.log('\n[READ] Step 2: Verifying in grid...');
        
        await testRead(page, TEST_CONFIG, ELEMENT_TIMEOUT);
        
        // ========== UPDATE ==========
        console.log('\n[UPDATE] Step 3: Updating ' + TEST_CONFIG.menuName + '...');
        
        await testUpdate(page, TEST_CONFIG, ELEMENT_TIMEOUT);
        
        // ========== DELETE ==========
        console.log('\n[DELETE] Step 4: Deleting ' + TEST_CONFIG.menuName + '...');
        
        await testDelete(page, TEST_CONFIG, ELEMENT_TIMEOUT);
        
        // ========== VERIFY DELETION ==========
        console.log('\n[VERIFY] Step 5: Verifying deletion...');
        
        await testVerifyDeletion(page, TEST_CONFIG, ELEMENT_TIMEOUT);
        
        console.log('\n' + '='.repeat(70));
        console.log(`✅ ${TEST_CONFIG.menuName} CRUD test completed successfully!`);
        console.log('='.repeat(70));
    });
});

// ============================================================================
// CRUD OPERATION FUNCTIONS - REUSABLE ACROSS ALL FORMS
// ============================================================================

async function testCreate(page: Page, config: typeof TEST_CONFIG, timeout: number) {
    const s = config.selectors;
    const d = config.testData;
    
    // Click Add button
    await healedClick(page, s.addButton);
    await page.waitForTimeout(2000);
    
    // Fill Short Code (if field exists)
    const shortCodeInput = page.locator(s.shortCodeField);
    if (await shortCodeInput.count() > 0) {
        await shortCodeInput.first().fill(d.shortCode);
        console.log('  ✓ Filled Short Code');
    }
    
    // Fill Grade/Category dropdown (if exists)
    const gradeDropdown = page.locator(s.gradeDropdown);
    if (await gradeDropdown.count() > 0) {
        await gradeDropdown.first().click();
        await page.waitForTimeout(1000);
        await page.click(`li:has-text("${d.gradeName}")`);
        console.log(`  ✓ Selected Grade: ${d.gradeName}`);
    }
    
    // Fill Name field
    const nameInput = page.locator(s.nameField);
    await nameInput.first().fill(d.name);
    console.log(`  ✓ Filled Name: ${d.name}`);
    
    // Click Save
    await healedClick(page, s.saveButton);
    await page.waitForTimeout(2000);
    
    // Click Ok on success message
    await healedClick(page, s.okButton);
    await page.waitForTimeout(2000);
    
    console.log('  ✓ Created successfully');
}

async function testRead(page: Page, config: typeof TEST_CONFIG, timeout: number) {
    const s = config.selectors;
    const d = config.testData;
    
    // Search for the record
    const searchBox = page.locator(s.searchBox);
    if (await searchBox.count() > 0) {
        await searchBox.first().fill(d.searchQuery);
        await page.waitForTimeout(1000);
        console.log(`  ✓ Searched for: ${d.searchQuery}`);
    }
    
    // Verify record exists in grid
    const gridCell = page.locator(`td:has-text("${d.name}")`);
    await expect(gridCell.first()).toBeVisible({ timeout });
    console.log(`  ✓ Record found in grid: ${d.name}`);
}

async function testUpdate(page: Page, config: typeof TEST_CONFIG, timeout: number) {
    const s = config.selectors;
    const d = config.testData;
    
    // Click edit button (icon in row)
    const editButton = page.locator(`tr td:has-text("${d.name}") .. button.btn, tr td:has-text("${d.name}") .. svg`);
    if (await editButton.count() > 0) {
        await editButton.first().click();
        await page.waitForTimeout(2000);
        console.log('  ✓ Clicked Edit button');
    }
    
    // Update name field
    const nameInput = page.locator(s.nameField);
    await nameInput.first().fill(d.updatedName);
    console.log(`  ✓ Updated Name to: ${d.updatedName}`);
    
    // Click Update
    await healedClick(page, s.updateButton);
    await page.waitForTimeout(2000);
    
    // Click Ok on success message
    await healedClick(page, s.okButton);
    await page.waitForTimeout(2000);
    
    console.log('  ✓ Updated successfully');
}

async function testDelete(page: Page, config: typeof TEST_CONFIG, timeout: number) {
    const s = config.selectors;
    const d = config.testData;
    
    // Search again
    const searchBox = page.locator(s.searchBox);
    if (await searchBox.count() > 0) {
        await searchBox.first().fill(d.searchQuery);
        await page.waitForTimeout(1000);
    }
    
    // Click delete button
    const deleteButton = page.locator(`tr td:has-text("${d.updatedName}") .. button.btn, tr td:has-text("${d.updatedName}") .. svg`);
    if (await deleteButton.count() > 0) {
        await deleteButton.first().click();
        await page.waitForTimeout(2000);
        console.log('  ✓ Clicked Delete button');
    }
    
    // Confirm deletion
    await healedClick(page, s.yesButton);
    await page.waitForTimeout(2000);
    
    // Click Ok on success message
    await healedClick(page, s.okButton);
    await page.waitForTimeout(2000);
    
    console.log('  ✓ Deleted successfully');
}

async function testVerifyDeletion(page: Page, config: typeof TEST_CONFIG, timeout: number) {
    const s = config.selectors;
    const d = config.testData;
    
    // Search again - should not find
    const searchBox = page.locator(s.searchBox);
    if (await searchBox.count() > 0) {
        await searchBox.first().clear();
        await searchBox.first().fill(d.searchQuery);
        await page.waitForTimeout(2000);
    }
    
    // Verify record is deleted
    const deletedCell = page.locator(`td:has-text("${d.updatedName}")`);
    await expect(deletedCell.first()).not.toBeVisible({ timeout });
    console.log(`  ✓ Deletion verified: ${d.updatedName} not found`);
}
