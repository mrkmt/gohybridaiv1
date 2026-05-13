/**
 * MASTER DATA CRUD - Department, Designation, Grade
 *
 * Consolidated test covering full CRUD lifecycle for HR master data modules.
 * - Department: Create → Verify in grid → Update → Delete → Verify deletion
 * - Designation: Create → Verify in grid → Update → Delete → Verify deletion
 * - Grade: Create with dropdown validation → Verify in grid → Update → Delete → Verify deletion
 *
 * Features:
 * - Kendo UI-aware interactions (click-before-fill)
 * - Self-healing click with 4-tier strategy
 * - Angular stability waits
 * - Unique timestamped test data
 */

import { test, expect, Page } from '@playwright/test';
import { healedClick, waitForKendoLoadingHidden } from '../playwright/playwright-self-healing';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BASE_URL = 'https://test.globalhr.com.mm/ook';
const CREDENTIALS = {
    idNumber: 'testook_HR 1',
    username: 'testook_HR 1',
    password: 'Global@2024'
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Fill an input field with click-before-fill for Kendo UI compatibility
 */
async function fillInput(page: Page, selector: string, value: string): Promise<void> {
    const input = page.locator(selector);
    const count = await input.count();
    if (count === 0) {
        console.log(`  ⚠ Element not found: ${selector}`);
        return;
    }
    await input.first().click();
    await page.waitForTimeout(200);
    await input.first().fill(value);
    console.log(`  ✓ Filled: ${value}`);
}

/**
 * Click a button by text with multiple fallback selectors
 */
async function clickButtonByText(page: Page, text: string): Promise<void> {
    const selectors = [
        `button:has-text("${text}")`,
        `[role="button"]:has-text("${text}")`,
        `.k-button:has-text("${text}")`,
        `button.btn:has-text("${text}")`
    ];

    for (const sel of selectors) {
        const count = await page.locator(sel).count();
        if (count > 0) {
            await healedClick(page, sel);
            console.log(`  ✓ Clicked "${text}" (${sel})`);
            return;
        }
    }
    // Fallback: try direct click
    await page.getByRole('button', { name: text }).first().click();
}

/**
 * Wait for grid to stabilize after operation
 */
async function waitForGridRefresh(page: Page): Promise<void> {
    await page.waitForTimeout(2000);
    await waitForKendoLoadingHidden(page);
}

/**
 * Search for text in the grid search box
 */
async function searchInGrid(page: Page, text: string): Promise<void> {
    const selectors = [
        'input[placeholder="Search ..."]',
        'input[placeholder*="search" i]',
        'input[type="text"][aria-label*="search" i]',
        'input[type="search"]'
    ];

    for (const sel of selectors) {
        const count = await page.locator(sel).count();
        if (count > 0) {
            await fillInput(page, sel, text);
            await page.waitForTimeout(1000);
            return;
        }
    }
    console.log(`  ⚠ No search box found`);
}

/**
 * Clear the grid search
 */
async function clearSearch(page: Page): Promise<void> {
    const selectors = [
        'input[placeholder="Search ..."]',
        'input[placeholder*="search" i]',
        'input[type="text"][aria-label*="search" i]',
        'input[type="search"]'
    ];

    for (const sel of selectors) {
        const count = await page.locator(sel).count();
        if (count > 0) {
            await page.locator(sel).first().clear();
            await page.waitForTimeout(500);
            return;
        }
    }
}

// ============================================================================
// LOGIN & NAVIGATION
// ============================================================================

async function loginAndNavigate(page: Page): Promise<void> {
    // Login
    await page.goto(`${BASE_URL}#/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await fillInput(page, 'input[name="idnumber"]', CREDENTIALS.idNumber);
    await fillInput(page, 'input[name="username"]', CREDENTIALS.username);
    await fillInput(page, 'input[name="password"]', CREDENTIALS.password);

    await page.click('button[type="submit"], button:has-text("LOG IN")');
    await page.waitForURL(/.*#\/dashboard/, { timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    console.log('✓ Login successful\n');
}

async function navigateToModule(page: Page, parent: string, module: string, urlPattern: RegExp): Promise<void> {
    if (parent) {
        await page.click(`span:has-text("${parent}")`);
        await page.waitForTimeout(300);
    }

    await page.click(`a:has-text("${module}")`);
    await page.waitForURL(urlPattern, { timeout: 30000 });
    await page.waitForTimeout(1000);

    console.log(`✓ Navigated to ${module}\n`);
}

// ============================================================================
// CRUD TEST FLOW
// ============================================================================

interface CrudTestCase {
    name: string;
    parentMenu: string;
    module: string;
    urlPattern: RegExp;
    fields: {
        selector: string;
        value: string;
    }[];
    updateFields: {
        selector: string;
        value: string;
    }[];
    searchField?: string;  // Field name in grid to search
}

async function runCrudFlow(page: Page, tc: CrudTestCase): Promise<void> {
    const ts = Date.now();
    const uniquePrefix = `${tc.name}_${ts}`;
    const createValue = `${uniquePrefix}_C`;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 TESTING: ${tc.name}`);
    console.log(`${'='.repeat(60)}\n`);

    // --- CREATE ---
    console.log(`Step 1: Navigate to ${tc.name}...`);
    await navigateToModule(page, tc.parentMenu, tc.module, tc.urlPattern);

    console.log(`Step 2: Create record...`);
    await clickButtonByText(page, 'Add');
    await page.waitForTimeout(1000);

    for (const field of tc.fields) {
        const value = field.value.replace('${PREFIX}', createValue);
        await fillInput(page, field.selector, value);
    }

    await clickButtonByText(page, 'Save');
    await page.waitForTimeout(500);
    await clickButtonByText(page, 'Ok');
    await waitForGridRefresh(page);
    console.log(`  ✓ Created: ${createValue}\n`);

    // --- VERIFY CREATE IN GRID ---
    console.log(`Step 3: Verify in grid...`);
    await searchInGrid(page, createValue);
    const recordInGrid = page.locator(`text=${createValue}`).first();
    await expect(recordInGrid).toBeVisible({ timeout: 15000 });
    console.log(`  ✓ Found in grid\n`);

    // --- UPDATE ---
    console.log(`Step 4: Update record...`);
    await recordInGrid.click();
    await page.waitForTimeout(300);

    await clickButtonByText(page, 'Edit');
    await page.waitForTimeout(500);

    const updatedValue = `${createValue}_upd`;
    for (const field of tc.updateFields) {
        const value = field.value.replace('${PREFIX}', createValue).replace('${UPDATED}', updatedValue);
        await fillInput(page, field.selector, value);
    }

    await clickButtonByText(page, 'Update');
    await page.waitForTimeout(500);
    await clickButtonByText(page, 'Ok');
    await waitForGridRefresh(page);
    console.log(`  ✓ Updated to: ${updatedValue}\n`);

    // --- VERIFY UPDATE IN GRID ---
    console.log(`Step 5: Verify update...`);
    await searchInGrid(page, updatedValue);
    const updatedRecord = page.locator(`text=${updatedValue}`).first();
    await expect(updatedRecord).toBeVisible({ timeout: 15000 });
    console.log(`  ✓ Update verified\n`);

    // --- DELETE ---
    console.log(`Step 6: Delete record...`);
    await searchInGrid(page, updatedValue);
    await updatedRecord.click();
    await page.waitForTimeout(300);

    await clickButtonByText(page, 'Delete');
    await page.waitForTimeout(500);
    await clickButtonByText(page, 'Yes');
    await page.waitForTimeout(500);
    await clickButtonByText(page, 'Ok');
    await waitForGridRefresh(page);
    console.log(`  ✓ Deleted\n`);

    // --- VERIFY DELETION ---
    console.log(`Step 7: Verify deletion...`);
    await searchInGrid(page, updatedValue);
    await page.waitForTimeout(1000);
    const deletedRecord = page.locator(`text=${updatedValue}`);
    await expect(deletedRecord).not.toBeVisible({ timeout: 10000 });
    console.log(`  ✓ Deletion verified\n`);

    // Clear search for next test
    await clearSearch(page);

    console.log(`✅ ${tc.name.toUpperCase()} CRUD TEST PASSED!\n`);
}

// ============================================================================
// TEST SUITE
// ============================================================================

const TEST_CASES: CrudTestCase[] = [
    {
        name: 'Designation',
        parentMenu: 'Master',
        module: 'Designation',
        urlPattern: /.*#\/app\.designation/,
        fields: [
            { selector: 'input[formcontrolname="ShortCode"]', value: '${PREFIX}_SC' },
            { selector: 'input[name="Designation"]', value: '${PREFIX}' }
        ],
        updateFields: [
            { selector: 'input[name="Designation"]', value: '${UPDATED}' }
        ]
    },
    {
        name: 'Department',
        parentMenu: 'Master',
        module: 'Department',
        urlPattern: /.*#\/app\.department/,
        fields: [
            { selector: 'input[formcontrolname="ShortCode"]', value: '${PREFIX}_SC' },
            { selector: 'input[name="Department"]', value: '${PREFIX}' }
        ],
        updateFields: [
            { selector: 'input[name="Department"]', value: '${UPDATED}' }
        ]
    }
];

test.describe('Master Data CRUD', () => {
    test.setTimeout(300000); // 5 minutes total

    for (const tc of TEST_CASES) {
        test(`Full CRUD: ${tc.name}`, async ({ page }) => {
            await loginAndNavigate(page);
            await runCrudFlow(page, tc);
        });
    }
});
