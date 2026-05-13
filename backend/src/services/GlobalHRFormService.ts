/**
 * GlobalHRFormService
 *
 * Handles all form interaction patterns for GlobalHR Cloud forms.
 * Covers:
 *   - Required field detection and validation
 *   - Text input filling (Kendo floating labels, standard inputs)
 *   - Single dropdown selection (native select, Kendo dropdown, Kendo combobox)
 *   - Multi-selection (checkboxes, multi-select dropdowns)
 *   - Save button state monitoring (disabled → enabled)
 *   - Tab navigation for multi-tab forms
 *   - Form submission with validation feedback
 *
 * All methods are reusable across any module form.
 */

import { Page, Locator } from '@playwright/test';
import { healedClick, waitForAngular, universalFill, kendoStabilizationDelay } from '../../tests/playwright/playwright-self-healing';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FieldInfo {
    /** Business name of the field (e.g., "Short Code", "Name") */
    name: string;
    /** Playwright selector for the field */
    selector: string;
    /** Whether the field is required */
    required: boolean;
    /** Field type */
    type: 'text' | 'number' | 'select' | 'multiselect' | 'checkbox' | 'date' | 'textarea';
    /** Whether the field is currently visible on the form */
    isVisible: boolean;
    /** Whether the field is currently enabled (not disabled) */
    isEnabled: boolean;
    /** Current value (for verification) */
    currentValue?: string;
}

export interface DropdownOption {
    /** Display text of the option */
    text: string;
    /** Value attribute of the option */
    value: string;
    /** Whether this option is currently selected */
    selected: boolean;
}

export interface FormState {
    /** All detected fields in the form */
    fields: FieldInfo[];
    /** Whether the Save/Submit button is enabled */
    canSave: boolean;
    /** Save button selector (if found) */
    saveButtonSelector: string | null;
    /** Current active tab (for multi-tab forms) */
    activeTab: string | null;
    /** Available tabs */
    tabs: string[];
    /** Validation errors visible on the form */
    errors: string[];
}

// ─── Required Field Detection ────────────────────────────────────────────────

/**
 * Detect which fields are required by scanning the form for:
 *   - HTML5 `required` attribute
 *   - Angular `ng-valid`/`ng-invalid` classes
 *   - Kendo validation markers
 *   - Visual indicators (red asterisks, .text-danger)
 */
export async function detectRequiredFields(page: Page, formContainer?: string): Promise<string[]> {
    const container = formContainer || 'form, kendo-dialog, .k-dialog, [role="dialog"]';

    return page.evaluate((container: any) => {
        const required: string[] = [];
        const formEl = document.querySelector(container) || document.body;

        // Method 1: Find required attribute
        formEl.querySelectorAll('[required], [ng-required="true"], [required-field]').forEach((el: any) => {
            const label = findLabel(el as HTMLElement);
            if (label && !required.includes(label)) required.push(label);
        });

        // Method 2: Find Angular invalid fields (ng-invalid + ng-dirty)
        formEl.querySelectorAll('.ng-invalid.ng-dirty, .ng-invalid.ng-touched').forEach((el: any) => {
            const label = findLabel(el as HTMLElement);
            if (label && !required.includes(label)) required.push(label);
        });

        // Method 3: Find visual required indicators (red asterisk next to label)
        formEl.querySelectorAll('label, kendo-floatinglabel').forEach((el: any) => {
            const html = el.innerHTML;
            // Check for red asterisk or required marker
            if (html.includes('text-danger') || html.includes('required') ||
                el.textContent?.includes('*')) {
                const text = (el as HTMLElement).textContent?.replace('*', '').trim();
                if (text && !required.includes(text)) required.push(text);
            }
        });

        return required;
    }, container);
}

function findLabel(el: HTMLElement): string | null {
    // Check aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    // Check floating label text
    const floatingLabel = el.closest('kendo-floatinglabel');
    if (floatingLabel) {
        const labelText = floatingLabel.querySelector('kendo-label')?.getAttribute('text') ||
                          floatingLabel.textContent?.replace(el.textContent || '', '').trim();
        if (labelText) return labelText;
    }

    // Check name/formControlName attributes
    const name = el.getAttribute('name') || el.getAttribute('formcontrolname') || el.getAttribute('formControlName');
    if (name) return name;

    // Check id + label association
    const id = el.getAttribute('id');
    if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) return label.textContent?.trim() || null;
    }

    // Check previous sibling for label
    const prev = el.previousElementSibling;
    if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'KENDO-LABEL')) {
        return prev.textContent?.trim() || null;
    }

    return null;
}

// ─── Field Discovery ─────────────────────────────────────────────────────────

/**
 * Discover all form fields and their properties.
 * Returns structured field info for test generation.
 */
export async function discoverFormFields(page: Page, formContainer?: string): Promise<FieldInfo[]> {
    const container = formContainer || 'form, kendo-dialog, .k-dialog, [role="dialog"]';

    return page.evaluate((container: any) => {
        const fields: Array<{
            name: string;
            selector: string;
            required: boolean;
            type: string;
            isVisible: boolean;
            isEnabled: boolean;
            currentValue?: string;
        }> = [];

        const formEl = document.querySelector(container) || document.body;

        // Find all interactive form elements
        const elements = formEl.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), ' +
            'select, textarea, kendo-dropdownlist, kendo-combobox, kendo-multiselect, ' +
            'kendo-numerictextbox, kendo-datepicker, kendo-floatinglabel'
        );

        for (const el of Array.from(elements)) {
            const htmlEl = el as HTMLElement;
            const style = window.getComputedStyle(htmlEl);

            // Skip hidden elements
            if (style.display === 'none' || style.visibility === 'hidden' ||
                (htmlEl.offsetWidth === 0 && htmlEl.offsetHeight === 0)) {
                continue;
            }

            const tagName = htmlEl.tagName.toLowerCase();
            const type = htmlEl.getAttribute('type') || '';
            const formControlName = htmlEl.getAttribute('formcontrolname') ||
                                    htmlEl.getAttribute('formControlName') || '';
            const name = htmlEl.getAttribute('name') || '';
            const placeholder = htmlEl.getAttribute('placeholder') || '';
            const required = htmlEl.hasAttribute('required') ||
                             htmlEl.getAttribute('ng-required') === 'true' ||
                             htmlEl.classList.contains('ng-invalid');

            // Determine field type
            let fieldType = 'text';
            if (tagName === 'select') fieldType = 'select';
            else if (tagName === 'textarea') fieldType = 'textarea';
            else if (type === 'number' || type === 'numeric') fieldType = 'number';
            else if (type === 'checkbox') fieldType = 'checkbox';
            else if (type === 'date') fieldType = 'date';
            else if (tagName.includes('multiselect')) fieldType = 'multiselect';
            else if (tagName.includes('dropdownlist') || tagName.includes('combobox')) fieldType = 'select';

            // Find the business name
            let fieldName = formControlName || name || placeholder || '';
            const label = findLabel(htmlEl);
            if (label) fieldName = label;

            // Generate selector
            let selector = '';
            if (formControlName) {
                selector = `input[formcontrolname="${formControlName}"], select[formcontrolname="${formControlName}"]`;
            } else if (name) {
                selector = `${tagName}[name="${name}"]`;
            } else if (htmlEl.id) {
                selector = `#${htmlEl.id}`;
            }

            if (!fieldName || !selector) continue;

            fields.push({
                name: fieldName,
                selector,
                required,
                type: fieldType as FieldInfo['type'],
                isVisible: true,
                isEnabled: !htmlEl.hasAttribute('disabled') && !htmlEl.hasAttribute('readonly'),
                currentValue: (htmlEl as HTMLInputElement).value || '',
            });
        }

        return fields as FieldInfo[];
    }, container);
}

// ─── Form State Check ────────────────────────────────────────────────────────

/**
 * Get the current state of a form including:
 *   - All fields and their properties
 *   - Save button enabled/disabled state
 *   - Active tab (for multi-tab forms)
 *   - Visible validation errors
 */
export async function getFormState(page: Page, formContainer?: string): Promise<FormState> {
    const fields = await discoverFormFields(page, formContainer);
    const requiredFields = await detectRequiredFields(page, formContainer);

    // Update required status from visual detection
    for (const field of fields) {
        if (requiredFields.includes(field.name)) {
            field.required = true;
        }
    }

    // Check Save button state
    const saveButtonSelectors = [
        'button.btn.btn-primary:has-text("Save"), button.btn.btn-success:has-text("Save")',
        'button.btn.btn-primary',
        'button[type="submit"]',
        'kendo-dialog button.btn-primary, .k-dialog button.btn-primary',
    ];

    let saveButtonSelector: string | null = null;
    let canSave = false;

    for (const sel of saveButtonSelectors) {
        try {
            const loc = page.locator(sel).first();
            if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
                saveButtonSelector = sel;
                canSave = !(await loc.isDisabled().catch(() => true));
                break;
            }
        } catch { /* try next */ }
    }

    // Get tabs (for multi-tab forms)
    const tabs: string[] = [];
    let activeTab: string | null = null;
    try {
        const tabElements = page.locator('.k-tabstrip-items .k-item, ul.nav-tabs .nav-item, ul.k-list > li');
        const count = await tabElements.count();
        for (let i = 0; i < count; i++) {
            const text = (await tabElements.nth(i).textContent())?.trim() || '';
            if (text) tabs.push(text);
        }
        // Active tab has .k-state-active or .active class
        const activeEl = page.locator('.k-tabstrip-items .k-state-active, ul.nav-tabs .nav-item.active, ul.k-list > li.k-state-active').first();
        activeTab = await activeEl.textContent().catch(() => null);
    } catch { /* no tabs */ }

    // Get validation errors
    const errors: string[] = [];
    try {
        const errorEls = page.locator('.text-danger, .validation-error, .k-invalid, .ng-invalid .k-label-error, [role="alert"]');
        const count = await errorEls.count();
        for (let i = 0; i < Math.min(count, 10); i++) {
            const text = (await errorEls.nth(i).textContent())?.trim();
            if (text) errors.push(text);
        }
    } catch { /* no errors */ }

    return { fields, canSave, saveButtonSelector, activeTab, tabs, errors };
}

// ─── Text Input Filling ──────────────────────────────────────────────────────

/**
 * Fill a text field using Kendo-aware selectors.
 * Automatically tries floating labels, formControlName, name attributes.
 *
 * @param page - Playwright page
 * @param fieldName - Business name of the field (e.g., "Short Code")
 * @param value - Value to fill
 * @param options - Kendo/slow typing options
 */
export async function fillField(
    page: Page,
    fieldName: string,
    value: string,
    options?: { isKendo?: boolean; slowTyping?: boolean; formControlName?: string }
): Promise<boolean> {
    await waitForAngular(page);
    await page.waitForTimeout(500);

    // Build selector chain
    const fcName = options?.formControlName || fieldName.replace(/\s+/g, '');
    const selectors = [
        // Kendo floating label with field name
        `kendo-floatinglabel:has-text("${fieldName}") input`,
        `kendo-textbox:has-text("${fieldName}") input`,
        // formControlName (most reliable for Angular forms)
        `input[formcontrolname="${fcName}"]`,
        `input[formcontrolname="${fieldName}"]`,
        `input[formControlName="${fcName}"]`,
        // name attribute
        `input[name="${fieldName}"]`,
        `input[name="${fcName}"]`,
        // placeholder
        `input[placeholder*="${fieldName}" i]`,
        // label association
        `label:has-text("${fieldName}") ~ input`,
        `label:has-text("${fieldName}") + input`,
    ];

    const selector = selectors.join(', ');

    try {
        await universalFill(page, selector, value, {
            isKendo: options?.isKendo ?? true,
            slowTyping: options?.slowTyping ?? false,
        });
        await kendoStabilizationDelay(page);
        return true;
    } catch (e) {
        console.warn(`[GlobalHRForm] Could not fill field "${fieldName}": ${(e as Error).message}`);
        return false;
    }
}

// ─── Dropdown Selection ──────────────────────────────────────────────────────

/**
 * Select an option from a dropdown field.
 * Handles: native select, Kendo dropdownlist, Kendo combobox.
 *
 * @param page - Playwright page
 * @param fieldName - Business name of the dropdown field
 * @param optionText - Text of the option to select
 */
export async function selectDropdownOption(
    page: Page,
    fieldName: string,
    optionText: string
): Promise<boolean> {
    await waitForAngular(page);
    await page.waitForTimeout(500);

    const fcName = fieldName.replace(/\s+/g, '');

    try {
        // Strategy 1: Native HTML select
        const nativeSelect = page.locator(`select[formcontrolname="${fcName}"], select[name="${fieldName}"], select[name="${fcName}"]`).first();
        if (await nativeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
            await nativeSelect.selectOption({ label: optionText });
            await kendoStabilizationDelay(page);
            console.log(`[GlobalHRForm] ✓ Selected "${optionText}" from native select "${fieldName}"`);
            return true;
        }

        // Strategy 2: Kendo dropdown list (opens detached popup)
        const kendoTrigger = page.locator(
            `kendo-dropdownlist[formcontrolname="${fcName}"], ` +
            `kendo-dropdownlist[name="${fieldName}"], ` +
            `kendo-dropdownlist[formControlName="${fcName}"]`
        ).first();

        if (await kendoTrigger.isVisible({ timeout: 2000 }).catch(() => false)) {
            // Click to open dropdown
            await page.locator(`kendo-dropdownlist[formcontrolname="${fcName}"], kendo-dropdownlist[name="${fieldName}"], kendo-dropdownlist[formControlName="${fcName}"]`).first().click({ timeout: 10000 });
            await page.waitForTimeout(500);

            // Select from detached popup
            const option = page.locator(`.k-popup .k-list-item:has-text("${optionText}"), .k-list .k-list-item:has-text("${optionText}"), [role="option"]:has-text("${optionText}")`).first();
            if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
                await option.click({ timeout: 10000 });
                await kendoStabilizationDelay(page);
                console.log(`[GlobalHRForm] ✓ Selected "${optionText}" from Kendo dropdown "${fieldName}"`);
                return true;
            }
        }

        // Strategy 3: Kendo combobox (allows typing + selecting)
        const kendoCombo = page.locator(
            `kendo-combobox[formcontrolname="${fcName}"], ` +
            `kendo-combobox[name="${fieldName}"]`
        ).first();

        if (await kendoCombo.isVisible({ timeout: 2000 }).catch(() => false)) {
            // Type the option text (combobox allows free text)
            const input = kendoCombo.locator('input').first();
            await input.click();
            await input.fill(optionText);
            await page.waitForTimeout(500);
            await page.keyboard.press('Enter');
            await kendoStabilizationDelay(page);
            console.log(`[GlobalHRForm] ✓ Typed "${optionText}" into Kendo combobox "${fieldName}"`);
            return true;
        }

        console.warn(`[GlobalHRForm] ⚠️ Dropdown "${fieldName}" not found`);
        return false;
    } catch (e) {
        console.warn(`[GlobalHRForm] ⚠️ Could not select from dropdown "${fieldName}": ${(e as Error).message}`);
        return false;
    }
}

// ─── Multi-Select ────────────────────────────────────────────────────────────

/**
 * Select multiple options from a multi-select field.
 * Handles: checkboxes, Kendo multiselect.
 *
 * @param page - Playwright page
 * @param fieldName - Business name of the multi-select field
 * @param optionTexts - Array of option texts to select
 */
export async function selectMultipleOptions(
    page: Page,
    fieldName: string,
    optionTexts: string[]
): Promise<{ selected: string[]; failed: string[] }> {
    const selected: string[] = [];
    const failed: string[] = [];

    for (const optionText of optionTexts) {
        const success = await selectDropdownOption(page, fieldName, optionText);
        if (success) {
            selected.push(optionText);
        } else {
            failed.push(optionText);
        }
    }

    return { selected, failed };
}

// ─── Save Button State Monitoring ────────────────────────────────────────────

/**
 * Check if the Save button is currently enabled.
 * Save button is typically disabled until required fields are filled.
 */
export async function isSaveEnabled(page: Page): Promise<boolean> {
    const selectors = [
        'button.btn.btn-primary:has-text("Save")',
        'button.btn.btn-success:has-text("Save")',
        'button.btn.btn-primary',
        'button[type="submit"]',
    ];

    for (const sel of selectors) {
        try {
            const loc = page.locator(sel).first();
            if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
                const disabled = await loc.isDisabled().catch(() => true);
                return !disabled;
            }
        } catch { /* try next */ }
    }

    return false;
}

/**
 * Wait for the Save button to become enabled.
 * Useful after filling required fields — waits until Angular validation passes.
 *
 * @param page - Playwright page
 * @param timeoutMs - Max wait time (default: 10000ms)
 */
export async function waitForSaveEnabled(page: Page, timeoutMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        if (await isSaveEnabled(page)) {
            return true;
        }
        await page.waitForTimeout(500);
        await waitForAngular(page);
    }

    return false;
}

// ─── Tab Navigation ──────────────────────────────────────────────────────────

/**
 * Switch to a specific tab in a multi-tab form.
 * GlobalHR forms often have tabs: Basic Information, Company Policy, etc.
 *
 * @param page - Playwright page
 * @param tabName - Name of the tab to switch to
 */
export async function switchFormTab(page: Page, tabName: string): Promise<boolean> {
    const selectors = [
        `.k-tabstrip-items .k-item:has-text("${tabName}")`,
        `ul.nav-tabs .nav-item:has-text("${tabName}")`,
        `ul.k-list > li:has-text("${tabName}")`,
        `.k-link-text:has-text("${tabName}")`,
        `span.k-link-text:has-text("${tabName}")`,
    ];

    for (const sel of selectors) {
        try {
            const loc = page.locator(sel).first();
            if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
                await loc.click({ timeout: 10000 });
                await page.waitForTimeout(500);
                await waitForAngular(page);
                console.log(`[GlobalHRForm] ✓ Switched to tab: "${tabName}"`);
                return true;
            }
        } catch { /* try next */ }
    }

    console.warn(`[GlobalHRForm] ⚠️ Tab "${tabName}" not found`);
    return false;
}

/**
 * Get all available tab names in a multi-tab form.
 */
export async function getFormTabs(page: Page): Promise<string[]> {
    const tabs: string[] = [];

    try {
        const selectors = [
            '.k-tabstrip-items .k-item',
            'ul.nav-tabs .nav-item',
            'ul.k-list > li',
            '.k-link-text',
        ];

        for (const sel of selectors) {
            const items = page.locator(sel);
            const count = await items.count();
            if (count > 0) {
                for (let i = 0; i < count; i++) {
                    const text = (await items.nth(i).textContent())?.trim();
                    if (text) tabs.push(text);
                }
                break;
            }
        }
    } catch { /* no tabs */ }

    return tabs;
}

// ─── Form Submission ─────────────────────────────────────────────────────────

/**
 * Click Save and wait for the API response and success notification.
 * Handles both dialog-based and inline forms.
 *
 * @param page - Playwright page
 * @param options - API URL pattern to wait for, timeout settings
 */
export async function submitForm(page: Page, options?: {
    apiPattern?: string;
    expectSuccess?: boolean;
    timeout?: number;
}): Promise<{ success: boolean; error?: string }> {
    const apiPattern = options?.apiPattern;
    const expectSuccess = options?.expectSuccess ?? true;
    const timeout = options?.timeout ?? 30000;

    // Wait for Save button to be enabled
    const saveReady = await waitForSaveEnabled(page, 5000);
    if (!saveReady) {
        console.log('[GlobalHRForm] ⚠️ Save button not enabled — attempting click anyway');
    }

    // Click Save
    const saveSelectors = [
        'button.btn.btn-primary:has-text("Save"), button.btn.btn-success:has-text("Save")',
        'button.btn.btn-primary',
        'button[type="submit"]',
        'kendo-dialog button.btn-primary, .k-dialog button.btn-primary',
        'button[title*="Save" i]',
    ];

    let saveClicked = false;
    for (const sel of saveSelectors) {
        try {
            const loc = page.locator(sel).first();
            if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) {
                await healedClick(page, sel, { timeout: 15000 });
                saveClicked = true;
                console.log(`[GlobalHRForm] ✓ Save clicked using: ${sel}`);
                break;
            }
        } catch { /* try next */ }
    }

    if (!saveClicked) {
        return { success: false, error: 'Could not find Save button' };
    }

    // Wait for API response if pattern provided
    if (apiPattern) {
        await page.waitForResponse(
            (response: any) => response.url().includes(apiPattern) && response.status() === 200,
            { timeout }
        ).catch(() => console.log(`[GlobalHRForm] ⚠️ API response not captured for pattern: ${apiPattern}`));
    }

    // Check for success/error notification
    await page.waitForTimeout(1000);
    await waitForAngular(page);

    if (expectSuccess) {
        const successVisible = await page.locator(
            '.k-notification-info, .notification-success, .k-notification.k-success, .alert-success'
        ).first().isVisible({ timeout: 10000 }).catch(() => false);

        if (!successVisible) {
            // Check for errors
            const errors = await detectValidationErrors(page);
            if (errors.length > 0) {
                return { success: false, error: errors.join('; ') };
            }
            // Save may have succeeded without notification (silent save)
            console.log('[GlobalHRForm] ⚠️ No success notification — assuming silent save');
        }
    }

    return { success: true };
}

// ─── Validation Error Detection ──────────────────────────────────────────────

/**
 * Detect all visible validation errors on the form.
 */
export async function detectValidationErrors(page: Page, formContainer?: string): Promise<string[]> {
    const container = formContainer || 'form, kendo-dialog, .k-dialog, [role="dialog"], body';
    const errors: string[] = [];

    try {
        const errorSelectors = [
            '.text-danger',
            '.validation-error',
            '.k-invalid',
            '.ng-invalid .k-label-error',
            '[role="alert"]',
            '.k-notification-error',
            '.alert-danger',
            'span.text-danger',
        ];

        for (const sel of errorSelectors) {
            const els = page.locator(`${container} ${sel}`);
            const count = await els.count();
            for (let i = 0; i < count; i++) {
                const text = (await els.nth(i).textContent())?.trim();
                if (text && text.length > 0 && text.length < 200 && !errors.includes(text)) {
                    errors.push(text);
                }
            }
        }
    } catch { /* no errors */ }

    return errors;
}

// ─── Complete Form Fill Helper ───────────────────────────────────────────────

/**
 * Fill an entire form with provided field values.
 * Auto-detects field types and uses appropriate fill strategy.
 *
 * @param page - Playwright page
 * @param fieldValues - Map of field name → value
 * @param options - Form options
 */
export async function fillForm(
    page: Page,
    fieldValues: Record<string, string>,
    options?: {
        /** Wait for Save button to enable after filling */
        waitForSave?: boolean;
        /** Kendo mode for all fields */
        isKendo?: boolean;
        /** Switch to this tab first */
        tab?: string;
    }
): Promise<{ filled: string[]; failed: string[]; errors: string[] }> {
    const filled: string[] = [];
    const failed: string[] = [];

    // Switch to tab if specified
    if (options?.tab) {
        await switchFormTab(page, options.tab);
    }

    // Discover form fields
    const fields = await discoverFormFields(page);

    for (const [fieldName, value] of Object.entries(fieldValues)) {
        // Find matching field
        const matchedField = fields.find(f =>
            f.name.toLowerCase().includes(fieldName.toLowerCase()) ||
            fieldName.toLowerCase().includes(f.name.toLowerCase())
        );

        let success = false;

        if (matchedField) {
            switch (matchedField.type) {
                case 'select':
                    success = await selectDropdownOption(page, fieldName, value);
                    break;
                case 'multiselect':
                    const multiResult = await selectMultipleOptions(page, fieldName, value.split(','));
                    success = multiResult.selected.length > 0;
                    break;
                default:
                    success = await fillField(page, fieldName, value, {
                        isKendo: options?.isKendo ?? true,
                    });
            }
        } else {
            // Try generic fill
            success = await fillField(page, fieldName, value, {
                isKendo: options?.isKendo ?? true,
            });
        }

        if (success) {
            filled.push(fieldName);
        } else {
            failed.push(fieldName);
        }
    }

    // Wait for Save button to enable
    if (options?.waitForSave) {
        await waitForSaveEnabled(page, 10000);
    }

    // Check for errors
    const errors = await detectValidationErrors(page);

    return { filled, failed, errors };
}
