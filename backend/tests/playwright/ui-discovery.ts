/**
 * UI Discovery & Diagnostic Tool
 * 
 * Scans the page and shows:
 * - All buttons with their text
 * - All input fields with labels
 * - All dropdowns with options
 * - All modal dialogs
 * - Grid data
 * - Takes screenshots
 * 
 * Use this to discover what's ACTUALLY on the page before writing tests
 * 
 * @author GoHybrid AI Team
 * @date April 1, 2026
 */

import { Page } from '@playwright/test';

export interface UIElement {
    type: 'button' | 'input' | 'dropdown' | 'checkbox' | 'radio' | 'link' | 'text' | 'grid';
    text?: string;
    label?: string;
    placeholder?: string;
    selector: string;
    isVisible: boolean;
    isEnabled: boolean;
    attributes: Record<string, string>;
}

export interface UIDiagnosticResult {
    url: string;
    timestamp: string;
    screenshotPath?: string;
    buttons: UIElement[];
    inputs: UIElement[];
    dropdowns: UIElement[];
    modals: UIElement[];
    grids: Array<{
        selector: string;
        rowCount: number;
        headers: string[];
        firstRows: string[];
    }>;
    errors: string[];
}

/**
 * Scan entire page and return all interactive elements
 * 
 * Usage:
 * ```typescript
 * const ui = await scanUI(page);
 * console.log('Buttons:', ui.buttons);
 * console.log('Inputs:', ui.inputs);
 * ```
 */
export async function scanUI(page: Page, options?: { takeScreenshot?: boolean }): Promise<UIDiagnosticResult> {
    const errors: string[] = [];
    const timestamp = new Date().toISOString();
    let screenshotPath: string | undefined;

    // Take screenshot
    if (options?.takeScreenshot !== false) {
        try {
            screenshotPath = `test-results/ui-scan-${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`📸 Screenshot saved: ${screenshotPath}`);
        } catch (e: any) {
            errors.push(`Screenshot failed: ${e.message}`);
        }
    }

    // Scan page in browser context - ALL helper functions must be inside evaluate
    const scanResult = await page.evaluate(() => {
        // Helper functions MUST be defined inside evaluate for browser context
        function isElementVisible(el: HTMLElement): boolean {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   style.opacity !== '0' &&
                   el.offsetWidth > 0 &&
                   el.offsetHeight > 0;
        }

        function getLabelText(el: Element): string {
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel) return ariaLabel;

            const labelParent = el.closest('label');
            if (labelParent) {
                return labelParent.textContent?.trim() || '';
            }

            const id = el.getAttribute('id');
            if (id) {
                const label = document.querySelector(`label[for="${id}"]`);
                if (label) return label.textContent?.trim() || '';
            }

            return '';
        }

        function getStableSelector(el: Element): string {
            if (el.id && !el.id.startsWith('k-')) {
                return `#${el.id}`;
            }

            const name = el.getAttribute('name');
            if (name) {
                return `${el.tagName.toLowerCase()}[name="${name}"]`;
            }

            const formControlName = el.getAttribute('formControlName');
            if (formControlName) {
                return `${el.tagName.toLowerCase()}[formControlName="${formControlName}"]`;
            }

            const className = el.getAttribute('class');
            if (className) {
                const stableClasses = className.split(' ')
                    .filter(c => c && !c.startsWith('ng-') && !c.startsWith('k-'))
                    .slice(0, 2)
                    .join('.');
                if (stableClasses) {
                    return `${el.tagName.toLowerCase()}.${stableClasses}`;
                }
            }

            return el.tagName.toLowerCase();
        }

        function getElementAttributes(el: Element): Record<string, string> {
            const attrs: Record<string, string> = {};
            for (const attr of Array.from(el.attributes)) {
                if (!attr.name.startsWith('data-k-') && !attr.name.startsWith('ng-')) {
                    attrs[attr.name] = attr.value;
                }
            }
            return attrs;
        }

        // Main scanning logic
        const elements: UIElement[] = [];

        // Scan buttons
        document.querySelectorAll('button, [role="button"], .k-button, .btn').forEach(el => {
            const htmlEl = el as HTMLElement;
            if (isElementVisible(htmlEl)) {
                elements.push({
                    type: 'button',
                    text: el.textContent?.trim() || '',
                    selector: getStableSelector(el),
                    isVisible: true,
                    isEnabled: !el.hasAttribute('disabled'),
                    attributes: getElementAttributes(el)
                });
            }
        });

        // Scan inputs
        document.querySelectorAll('input:not([type="hidden"]), textarea').forEach(el => {
            const htmlEl = el as HTMLElement;
            if (isElementVisible(htmlEl)) {
                const inputEl = el as HTMLInputElement;
                elements.push({
                    type: 'input',
                    text: '',
                    label: getLabelText(el),
                    placeholder: inputEl.placeholder,
                    selector: getStableSelector(el),
                    isVisible: true,
                    isEnabled: !el.hasAttribute('disabled'),
                    attributes: getElementAttributes(el)
                });
            }
        });

        // Scan dropdowns/selects
        document.querySelectorAll('select, kendo-dropdownlist, .k-dropdown, [role="combobox"]').forEach(el => {
            const htmlEl = el as HTMLElement;
            if (isElementVisible(htmlEl)) {
                elements.push({
                    type: 'dropdown',
                    text: el.textContent?.trim() || '',
                    label: getLabelText(el),
                    selector: getStableSelector(el),
                    isVisible: true,
                    isEnabled: !el.hasAttribute('disabled'),
                    attributes: getElementAttributes(el)
                });
            }
        });

        // Scan modals
        document.querySelectorAll('.modal, .k-window, .modal-dialog, [role="dialog"]').forEach(el => {
            const htmlEl = el as HTMLElement;
            if (isElementVisible(htmlEl)) {
                elements.push({
                    type: 'text',
                    text: el.textContent?.trim() || '',
                    selector: getStableSelector(el),
                    isVisible: true,
                    isEnabled: true,
                    attributes: getElementAttributes(el)
                });
            }
        });

        return elements;
    });

    // Scan grids separately
    const grids = await scanGrids(page);

    // Categorize elements
    const buttons = scanResult.filter(e => e.type === 'button');
    const inputs = scanResult.filter(e => e.type === 'input');
    const dropdowns = scanResult.filter(e => e.type === 'dropdown');
    const modals = scanResult.filter(e => e.type === 'text' && e.attributes?.role === 'dialog');

    // Log findings
    console.log('\n' + '='.repeat(60));
    console.log('🔍 UI DISCOVERY RESULTS');
    console.log('='.repeat(60));
    console.log(`URL: ${page.url()}`);
    console.log(`Timestamp: ${timestamp}`);
    console.log(`Buttons found: ${buttons.length}`);
    console.log(`Inputs found: ${inputs.length}`);
    console.log(`Dropdowns found: ${dropdowns.length}`);
    console.log(`Modals found: ${modals.length}`);
    console.log(`Grids found: ${grids.length}`);
    console.log('='.repeat(60));

    // Log buttons
    if (buttons.length > 0) {
        console.log('\n🔘 BUTTONS:');
        buttons.forEach((btn, i) => {
            console.log(`  ${i + 1}. "${btn.text}"`);
            console.log(`     Selector: ${btn.selector}`);
            console.log(`     Enabled: ${btn.isEnabled}`);
        });
    }

    // Log inputs
    if (inputs.length > 0) {
        console.log('\n📝 INPUT FIELDS:');
        inputs.forEach((inp, i) => {
            console.log(`  ${i + 1}. ${inp.label || inp.placeholder || 'Unnamed field'}`);
            console.log(`     Selector: ${inp.selector}`);
            console.log(`     Placeholder: ${inp.placeholder || 'N/A'}`);
            console.log(`     Enabled: ${inp.isEnabled}`);
        });
    }

    // Log dropdowns
    if (dropdowns.length > 0) {
        console.log('\n📋 DROPDOWNS:');
        dropdowns.forEach((dd, i) => {
            console.log(`  ${i + 1}. ${dd.label || dd.text || 'Unnamed dropdown'}`);
            console.log(`     Selector: ${dd.selector}`);
            console.log(`     Enabled: ${dd.isEnabled}`);
        });
    }

    // Log grids
    if (grids.length > 0) {
        console.log('\n📊 GRIDS:');
        grids.forEach((grid, i) => {
            console.log(`  ${i + 1}. Grid with ${grid.rowCount} rows`);
            console.log(`     Selector: ${grid.selector}`);
            console.log(`     Headers: ${grid.headers.join(', ')}`);
            if (grid.firstRows.length > 0) {
                console.log(`     First row: ${grid.firstRows[0]}`);
            }
        });
    }

    console.log('\n' + '='.repeat(60) + '\n');

    return {
        url: page.url(),
        timestamp,
        screenshotPath,
        buttons,
        inputs,
        dropdowns,
        modals,
        grids,
        errors
    };
}

/**
 * Scan Kendo grids and extract data
 */
async function scanGrids(page: Page): Promise<UIDiagnosticResult['grids']> {
    const grids: UIDiagnosticResult['grids'] = [];

    try {
        const gridCount = await page.locator('kendo-grid').count();
        
        for (let i = 0; i < Math.min(gridCount, 5); i++) {
            const grid = page.locator('kendo-grid').nth(i);
            
            if (await grid.count() > 0) {
                // Get headers
                const headers = await grid.locator('thead th').allTextContents();
                
                // Get row count
                const rowCount = await grid.locator('tbody tr').count();
                
                // Get first 3 rows
                const firstRows: string[] = [];
                for (let row = 0; row < Math.min(3, rowCount); row++) {
                    const rowText = await grid.locator('tbody tr').nth(row).textContent();
                    if (rowText) firstRows.push(rowText.trim());
                }

                grids.push({
                    selector: 'kendo-grid',
                    rowCount,
                    headers: headers.filter(h => h.trim()),
                    firstRows
                });
            }
        }
    } catch (e: any) {
        console.warn('⚠️ Grid scan failed:', e.message);
    }

    return grids;
}

/**
 * Find element by text (button, link, etc.)
 * 
 * Usage:
 * ```typescript
 * const addButton = findByText(ui, 'Add', 'button');
 * if (addButton) {
 *     console.log('Found Add button:', addButton.selector);
 * }
 * ```
 */
export function findByText<T extends UIElement>(
    elements: T[], 
    searchText: string, 
    type?: T['type']
): T | undefined {
    return elements.find(el => {
        if (type && el.type !== type) return false;
        return el.text?.toLowerCase().includes(searchText.toLowerCase());
    });
}

/**
 * Find input by label or placeholder
 */
export function findInput(ui: UIDiagnosticResult, labelText: string): UIElement | undefined {
    return ui.inputs.find(inp => 
        inp.label?.toLowerCase().includes(labelText.toLowerCase()) ||
        inp.placeholder?.toLowerCase().includes(labelText.toLowerCase())
    );
}

/**
 * Find dropdown by label
 */
export function findDropdown(ui: UIDiagnosticResult, labelText: string): UIElement | undefined {
    return ui.dropdowns.find(dd => 
        dd.label?.toLowerCase().includes(labelText.toLowerCase())
    );
}

// Helper functions

function isElementVisible(el: HTMLElement): boolean {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           el.offsetWidth > 0 &&
           el.offsetHeight > 0;
}

function getLabelText(el: Element): string {
    // Try aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    // Try label parent
    const labelParent = el.closest('label');
    if (labelParent) {
        return labelParent.textContent?.trim() || '';
    }

    // Try for attribute
    const id = el.getAttribute('id');
    if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) return label.textContent?.trim() || '';
    }

    return '';
}

function getStableSelector(el: Element): string {
    // Try ID
    if (el.id && !el.id.startsWith('k-')) {
        return `#${el.id}`;
    }

    // Try name attribute
    const name = el.getAttribute('name');
    if (name) {
        return `${el.tagName.toLowerCase()}[name="${name}"]`;
    }

    // Try formControlName
    const formControlName = el.getAttribute('formControlName');
    if (formControlName) {
        return `${el.tagName.toLowerCase()}[formControlName="${formControlName}"]`;
    }

    // Try class + tag
    const className = el.getAttribute('class');
    if (className) {
        const stableClasses = className.split(' ')
            .filter(c => c && !c.startsWith('ng-') && !c.startsWith('k-'))
            .slice(0, 2)
            .join('.');
        if (stableClasses) {
            return `${el.tagName.toLowerCase()}.${stableClasses}`;
        }
    }

    // Fallback to tag
    return el.tagName.toLowerCase();
}

function getElementAttributes(el: Element): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
        if (!attr.name.startsWith('data-k-') && !attr.name.startsWith('ng-')) {
            attrs[attr.name] = attr.value;
        }
    }
    return attrs;
}

/**
 * Quick diagnostic: Scan and save to file
 * 
 * Usage in test:
 * ```typescript
 * test('Debug UI', async ({ page }) => {
 *     await page.goto('https://test.globalhr.com.mm/ook#/app.designation');
 *     await quickDiagnostic(page, 'designation-page');
 * });
 * ```
 */
export async function quickDiagnostic(page: Page, label: string = 'diagnostic'): Promise<void> {
    console.log(`\n🔍 Running quick diagnostic: ${label}...\n`);
    
    const result = await scanUI(page, { takeScreenshot: true });
    
    // Save to file
    const fs = require('fs');
    const path = require('path');
    const outputPath = path.join(process.cwd(), 'test-results', `ui-diagnostic-${label}-${Date.now()}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`💾 Diagnostic saved to: ${outputPath}\n`);
}
