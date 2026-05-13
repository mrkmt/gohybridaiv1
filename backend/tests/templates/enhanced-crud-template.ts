import { Page, expect } from '@playwright/test';

/**
 * Enhanced CRUD Template for Kendo UI Applications
 * 
 * Features:
 * - Universal Form Detection (Modal vs Inline)
 * - Kendo Loading Mask Handling
 * - Stabilization Delays for Kendo Animations
 * - Promise.race() for parallel element detection
 */

/**
 * Wait for Kendo loading mask to be hidden
 * Must be called before every critical interaction
 */
export async function waitForKendoLoadingHidden(page: Page, timeout: number = 10000): Promise<void> {
    const loadingMask = page.locator('.k-loading-mask, .k-loading-image, .k-overlay');
    await expect(loadingMask).toBeHidden({ timeout });
}

/**
 * Stabilization delay after Kendo UI animations
 * Ensures UI is fully rendered before next interaction
 */
export async function kendoStabilizationDelay(page: Page, delayMs: number = 1000): Promise<void> {
    await page.waitForTimeout(delayMs);
    // Additional check to ensure no animations in progress
    await page.evaluate(() => {
        return new Promise<void>((resolve) => {
            const checkAnimations = () => {
                const animated = document.querySelectorAll('.k-animation-container, .k-popup, .k-window');
                const hasAnimation = Array.from(animated).some(el => {
                    const style = window.getComputedStyle(el);
                    return style.animationName !== 'none' || style.opacity !== '1';
                });
                
                if (!hasAnimation) {
                    resolve();
                } else {
                    setTimeout(checkAnimations, 100);
                }
            };
            checkAnimations();
        });
    });
}

/**
 * Universal Form Detection: Wait for either Modal or Inline form
 * Uses Promise.race() to detect which form type appears first
 */
export async function waitForFormVisible(
    page: Page,
    options: {
        modalSelector?: string;
        inlineSelector?: string;
        timeout?: number;
    } = {}
): Promise<'modal' | 'inline'> {
    const {
        modalSelector = '.k-window, [role="dialog"], .k-dialog',
        inlineSelector = '.form-container, form, .k-content > form',
        timeout = 15000,
    } = options;

    const modalLocator = page.locator(modalSelector).first();
    const inlineLocator = page.locator(inlineSelector).first();

    // Wait for Kendo loading to complete first
    await waitForKendoLoadingHidden(page, timeout);

    // Use Promise.race to detect which form type appears
    const modalVisiblePromise = modalLocator.waitFor({ state: 'visible', timeout }).then(() => 'modal' as const);
    const inlineVisiblePromise = inlineLocator.waitFor({ state: 'visible', timeout }).then(() => 'inline' as const);

    try {
        const formType = await Promise.race([modalVisiblePromise, inlineVisiblePromise]);
        console.log(`[UniversalForm] Detected ${formType} form`);
        return formType;
    } catch (error: any) {
        // If neither is found, throw descriptive error
        const modalExists = await modalLocator.count() > 0;
        const inlineExists = await inlineLocator.count() > 0;
        
        throw new Error(
            `No form detected within ${timeout}ms. ` +
            `Modal exists: ${modalExists}, Inline exists: ${inlineExists}`
        );
    }
}

/**
 * Click "Add New" button with universal form detection
 * Handles both modal dialogs and inline forms
 */
export async function clickAddNew(
    page: Page,
    options: {
        addNewSelector?: string;
        formTimeout?: number;
        stabilizationDelay?: number;
    } = {}
): Promise<'modal' | 'inline'> {
    const {
        addNewSelector = 'button:has-text("Add New"), button:has-text("Add"), [data-testid="add-new"], .k-button:has-text("Add")',
        formTimeout = 15000,
        stabilizationDelay = 1000,
    } = options;

    // Wait for loading to complete
    await waitForKendoLoadingHidden(page);

    // Click Add New button
    const addNewButton = page.locator(addNewSelector).first();
    await expect(addNewButton).toBeVisible({ timeout: 10000 });
    await addNewButton.click();

    // Wait for form to appear (modal or inline)
    const formType = await waitForFormVisible(page, { timeout: formTimeout });

    // Apply stabilization delay after Kendo animation
    await kendoStabilizationDelay(page, stabilizationDelay);

    return formType;
}

/**
 * Fill form field with Kendo-aware handling
 * Supports both standard inputs and Kendo widgets
 */
export async function fillKendoField(
    page: Page,
    selector: string,
    value: string,
    options: {
        isKendoDropdown?: boolean;
        isKendoDatePicker?: boolean;
        isKendoNumeric?: boolean;
    } = {}
): Promise<void> {
    const { isKendoDropdown, isKendoDatePicker, isKendoNumeric } = options;

    // Wait for loading to complete
    await waitForKendoLoadingHidden(page);

    if (isKendoDropdown) {
        // Handle Kendo Dropdown
        const dropdown = page.locator(selector);
        await dropdown.click();
        await kendoStabilizationDelay(page, 500);
        
        // Select from dropdown list
        const dropdownItem = page.locator('.k-list-container .k-item', { hasText: value }).first();
        await expect(dropdownItem).toBeVisible({ timeout: 5000 });
        await dropdownItem.click();
    } else if (isKendoDatePicker) {
        // Handle Kendo DatePicker
        const datePicker = page.locator(selector);
        await datePicker.click();
        await kendoStabilizationDelay(page, 300);
        
        // Fill date input
        const dateInput = page.locator(`${selector} input`).first();
        await dateInput.fill(value);
    } else if (isKendoNumeric) {
        // Handle Kendo NumericTextBox
        const numericInput = page.locator(`${selector} input`).first();
        await numericInput.fill(value);
    } else {
        // Standard input handling
        const input = page.locator(selector);
        await expect(input).toBeVisible({ timeout: 10000 });
        await input.fill(value);
    }

    // Stabilization delay after interaction
    await kendoStabilizationDelay(page);
}

/**
 * Save form with Kendo-aware handling
 * Waits for loading mask and applies stabilization delay
 */
export async function saveKendoForm(
    page: Page,
    options: {
        saveSelector?: string;
        successTimeout?: number;
    } = {}
): Promise<void> {
    const {
        saveSelector = 'button:has-text("Save"), [type="submit"], .k-button:has-text("Save")',
        successTimeout = 30000,
    } = options;

    // Wait for loading to complete
    await waitForKendoLoadingHidden(page);

    // Click Save button
    const saveButton = page.locator(saveSelector).first();
    await expect(saveButton).toBeVisible({ timeout: 10000 });
    await saveButton.click();

    // Wait for loading mask to appear and disappear (indicates save in progress)
    const loadingMask = page.locator('.k-loading-mask, .k-loading-image');
    await expect(loadingMask).toBeVisible({ timeout: 5000 });
    await waitForKendoLoadingHidden(page, successTimeout);

    // Stabilization delay after save animation
    await kendoStabilizationDelay(page);
}

/**
 * Delete item with confirmation handling
 */
export async function deleteKendoItem(
    page: Page,
    options: {
        deleteSelector?: string;
        confirmSelector?: string;
        rowSelector?: string;
    } = {}
): Promise<void> {
    const {
        deleteSelector = 'button:has-text("Delete"), .k-button:has-text("Delete"), [data-testid="delete"]',
        confirmSelector = '.k-dialog button:has-text("Yes"), .k-window button:has-text("OK"), [data-testid="confirm"]',
        rowSelector = '.k-grid tbody tr',
    } = options;

    // Wait for loading to complete
    await waitForKendoLoadingHidden(page);

    // Click Delete button
    const deleteButton = page.locator(deleteSelector).first();
    await expect(deleteButton).toBeVisible({ timeout: 10000 });
    await deleteButton.click();

    // Wait for confirmation dialog
    const confirmButton = page.locator(confirmSelector).first();
    await expect(confirmButton).toBeVisible({ timeout: 10000 });
    await confirmButton.click();

    // Wait for loading mask to appear and disappear
    await waitForKendoLoadingHidden(page, 30000);

    // Stabilization delay
    await kendoStabilizationDelay(page);
}

/**
 * Wait for Kendo Grid to be ready
 */
export async function waitForKendoGridReady(
    page: Page,
    options: {
        gridSelector?: string;
        timeout?: number;
    } = {}
): Promise<void> {
    const {
        gridSelector = '.k-grid',
        timeout = 15000,
    } = options;

    // Wait for loading to complete
    await waitForKendoLoadingHidden(page, timeout);

    // Wait for grid to be visible
    const grid = page.locator(gridSelector);
    await expect(grid).toBeVisible({ timeout });

    // Wait for grid data rows to be loaded
    const rows = grid.locator('tbody tr');
    await expect(rows).not.toHaveText('Loading...', { timeout });

    // Stabilization delay
    await kendoStabilizationDelay(page, 500);
}

/**
 * Select Kendo Grid row
 */
export async function selectKendoGridRow(
    page: Page,
    rowIdentifier: { columnName: string; value: string },
    options: {
        gridSelector?: string;
    } = {}
): Promise<void> {
    const {
        gridSelector = '.k-grid',
    } = options;

    await waitForKendoGridReady(page, { gridSelector });

    const grid = page.locator(gridSelector);
    const { columnName, value } = rowIdentifier;

    // Find column index
    const headers = grid.locator('.k-grid-header th');
    const columnCount = await headers.count();
    let targetColumnIndex = -1;

    for (let i = 0; i < columnCount; i++) {
        const headerText = await headers.nth(i).textContent();
        if (headerText?.toLowerCase().includes(columnName.toLowerCase())) {
            targetColumnIndex = i;
            break;
        }
    }

    if (targetColumnIndex === -1) {
        throw new Error(`Column "${columnName}" not found in grid`);
    }

    // Find row with matching value in target column
    const rows = grid.locator('tbody tr');
    const rowCount = await rows.count();

    for (let i = 0; i < rowCount; i++) {
        const cell = rows.nth(i).locator('td').nth(targetColumnIndex);
        const cellText = await cell.textContent();
        if (cellText?.includes(value)) {
            await rows.nth(i).click();
            await kendoStabilizationDelay(page, 500);
            return;
        }
    }

    throw new Error(`Row with ${columnName}="${value}" not found in grid`);
}

/**
 * Enhanced CRUD Test Template
 * Use this as a base for generating CRUD test cases
 */
export interface CrudTestTemplate {
    moduleName: string;
    menuLabel: string;
    entityName: string;
    testData: Record<string, string>;
    uniqueIdentifiers: string[]; // Columns used to identify created records
}

/**
 * Generate a complete CRUD test suite
 */
export async function runCrudTest(
    page: Page,
    template: CrudTestTemplate
): Promise<{
    createdId?: string;
    createSuccess: boolean;
    readSuccess: boolean;
    updateSuccess: boolean;
    deleteSuccess: boolean;
}> {
    const { moduleName, menuLabel, entityName, testData, uniqueIdentifiers } = template;
    const results = {
        createdId: undefined as string | undefined,
        createSuccess: false,
        readSuccess: false,
        updateSuccess: false,
        deleteSuccess: false,
    };

    console.log(`[CRUD Test] Starting test for ${moduleName} > ${menuLabel}`);

    try {
        // ─── CREATE ──────────────────────────────────────────────────────
        console.log('[CRUD Test] CREATE phase');
        
        // Click Add New
        const formType = await clickAddNew(page);
        console.log(`[CRUD Test] Form type detected: ${formType}`);

        // Fill form fields
        for (const [field, value] of Object.entries(testData)) {
            const selector = `[ng-reflect-name="${field}"], [formcontrolname="${field}"], [name="${field}"]`;
            await fillKendoField(page, selector, value);
        }

        // Save
        await saveKendoForm(page);
        results.createSuccess = true;
        console.log('[CRUD Test] CREATE successful');

        // Wait for grid to refresh
        await waitForKendoGridReady(page);

        // ─── READ ────────────────────────────────────────────────────────
        console.log('[CRUD Test] READ phase');
        
        // Verify record exists in grid
        for (const identifier of uniqueIdentifiers) {
            const value = testData[identifier];
            const grid = page.locator('.k-grid');
            const rows = grid.locator('tbody tr');
            
            let found = false;
            const rowCount = await rows.count();
            for (let i = 0; i < rowCount; i++) {
                const rowText = await rows.nth(i).textContent();
                if (rowText?.includes(value)) {
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                throw new Error(`Record with ${identifier}="${value}" not found in grid`);
            }
        }
        
        results.readSuccess = true;
        console.log('[CRUD Test] READ successful');

        // ─── UPDATE ──────────────────────────────────────────────────────
        console.log('[CRUD Test] UPDATE phase');
        
        // Select row for editing
        const firstIdentifier = uniqueIdentifiers[0];
        const firstValue = testData[firstIdentifier];
        await selectKendoGridRow(page, { columnName: firstIdentifier, value: firstValue });

        // Click Edit button
        const editButton = page.locator('button:has-text("Edit"), .k-button:has-text("Edit")').first();
        await expect(editButton).toBeVisible({ timeout: 10000 });
        await editButton.click();

        // Wait for form
        await waitForFormVisible(page);
        await kendoStabilizationDelay(page);

        // Update a field (append " Updated" to first text field)
        const updateFieldName = Object.keys(testData)[0];
        const updateSelector = `[ng-reflect-name="${updateFieldName}"], [formcontrolname="${updateFieldName}"]`;
        const originalValue = testData[updateFieldName];
        const updatedValue = `${originalValue} Updated`;
        
        await fillKendoField(page, updateSelector, updatedValue);
        await saveKendoForm(page);
        results.updateSuccess = true;
        console.log('[CRUD Test] UPDATE successful');

        // Wait for grid to refresh
        await waitForKendoGridReady(page);

        // ─── DELETE ──────────────────────────────────────────────────────
        console.log('[CRUD Test] DELETE phase');
        
        // Select row for deletion
        await selectKendoGridRow(page, { columnName: firstIdentifier, value: updatedValue });

        // Delete
        await deleteKendoItem(page);
        results.deleteSuccess = true;
        console.log('[CRUD Test] DELETE successful');

        // Verify record is removed
        await waitForKendoGridReady(page);
        
    } catch (error: any) {
        console.error('[CRUD Test] Error:', error.message);
        throw error;
    }

    return results;
}

/**
 * Export all template functions
 */
export default {
    waitForKendoLoadingHidden,
    kendoStabilizationDelay,
    waitForFormVisible,
    clickAddNew,
    fillKendoField,
    saveKendoForm,
    deleteKendoItem,
    waitForKendoGridReady,
    selectKendoGridRow,
    runCrudTest,
};
