/**
 * Page Scanner / Crawler
 * 
 * Based on the Go-Hybrid Harvester Extension content.js
 * Integrates the existing SmartContentScript scanning logic
 * 
 * Scans the current page and extracts all interactive elements:
 * - Buttons
 * - Input fields (text, password, number, etc.)
 * - Dropdowns/Select boxes
 * - Checkboxes and Radio buttons
 * - Tables and Grids
 * - Links
 * 
 * Returns structured data that can be used for test assertions
 */

import { Page } from '@playwright/test';

export interface ScannedElement {
    type: string;
    subtype?: string;
    id?: string;
    name?: string;
    placeholder?: string;
    label?: string;
    text?: string;
    value?: string;
    isEnabled: boolean;
    isVisible: boolean;
    selector: string;  // Stable selector without dynamic IDs
    ngReflectName?: string;
    formControlName?: string;
    kendoType?: string;
    businessName?: string;
    ariaLabel?: string;
    attributes: Record<string, string>;
}

export interface PageScanResult {
    url: string;
    scannedAt: string;
    title: string;
    elements: ScannedElement[];
    buttons: ScannedElement[];
    inputs: ScannedElement[];
    selects: ScannedElement[];
    tables: ScannedElement[];
    errors: string[];
}

/**
 * Scan full page using the extension's SmartContentScript logic
 * This is injected directly into the browser context
 */
export async function scanPage(page: Page, options: { verbose?: boolean } = {}): Promise<PageScanResult> {
    const errors: string[] = [];
    
    try {
        // Wait for page to be stable
        await page.waitForLoadState('networkidle').catch(() => {});
        
        // Inject and run the scanner in browser context
        const scanResult = await page.evaluate(() => {
            // This is the same logic from the extension's content.js
            // Adapted to run in Playwright context
            
            const extensionSelectors = [
                '#kmt-qa-recorder-ui',
                '.harvester-indicator',
                '[data-extension-ui]'
            ];

            function isExtensionUI(element: Element): boolean {
                for (const selector of extensionSelectors) {
                    if (element.closest(selector)) return true;
                }
                const id = element.getAttribute('id');
                const className = element.getAttribute('class') || '';
                if (id?.startsWith('k-') || className.includes('harvester')) return true;
                return false;
            }

            function getStableSelector(el: Element): string {
                const hasDynamicId = el.getAttribute('id')?.startsWith('k-');
                
                // Try name attribute first (most stable for forms)
                const name = el.getAttribute('name');
                if (name) {
                    return `${el.tagName.toLowerCase()}[name="${name}"]`;
                }

                // Try Angular formControlName
                const formControlName = el.getAttribute('formControlName') || el.getAttribute('formcontrolname');
                if (formControlName) {
                    return `${el.tagName.toLowerCase()}[formControlName="${formControlName}"]`;
                }

                // Try Angular ng-reflect-name
                const ngReflectName = el.getAttribute('ng-reflect-name');
                if (ngReflectName) {
                    return `${el.tagName.toLowerCase()}[ng-reflect-name="${ngReflectName}"]`;
                }

                // Try stable ID (skip dynamic Kendo IDs)
                const id = el.getAttribute('id');
                if (id && !hasDynamicId) {
                    return `#${id}`;
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

            function getComponentInfo(el: Element) {
                // Find Angular/Kendo parent
                const kendoSelectors = [
                    'kendo-textbox', 'kendo-dropdownlist', 'kendo-combobox', 'kendo-datepicker',
                    'kendo-numerictextbox', 'kendo-grid', 'kendo-treeview', 'kendo-checkbox',
                    'kendo-radiobutton', 'kendo-switch', 'kendo-menu', 'kendo-tabstrip'
                ];

                let kendoParent = null;
                for (const selector of kendoSelectors) {
                    const parent = el.closest(selector);
                    if (parent) {
                        kendoParent = parent;
                        break;
                    }
                }

                const ngReflectName = el.getAttribute('ng-reflect-name');
                const formControlName = el.getAttribute('formControlName') || el.getAttribute('formcontrolname');
                const ariaLabel = el.getAttribute('aria-label');
                const name = el.getAttribute('name');
                const id = el.getAttribute('id');
                const placeholder = el.getAttribute('placeholder');

                // Determine business name
                const businessName = ngReflectName || formControlName || ariaLabel || name || 
                    (el.tagName === 'BUTTON' ? el.textContent?.trim().substring(0, 30) || '-' : '-');

                // Determine type
                const tagName = el.tagName.toLowerCase();
                let type = tagName;
                if (tagName === 'input') {
                    type = `input-${el.getAttribute('type') || 'text'}`;
                }
                if (kendoParent) {
                    type = kendoParent.tagName.toLowerCase();
                }

                // Get attributes
                const attrs: Record<string, string> = {};
                for (let i = 0; i < el.attributes.length; i++) {
                    const attr = el.attributes[i];
                    attrs[attr.name] = attr.value;
                }

                return {
                    type,
                    selector: getStableSelector(el),
                    ngReflectName,
                    formControlName,
                    ariaLabel,
                    kendoType: kendoParent?.tagName.toLowerCase(),
                    businessName,
                    name,
                    id,
                    placeholder,
                    attributes: attrs
                };
            }

            function getElementValue(el: Element): string | null {
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    const type = el.getAttribute('type');
                    if (type === 'password') return '****';
                    return (el as HTMLInputElement).value;
                }
                if (el.tagName === 'SELECT') {
                    const select = el as HTMLSelectElement;
                    return select.options[select.selectedIndex]?.text || select.value;
                }
                return null;
            }

            function isElementVisible(el: Element): boolean {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }

            // Scan all components
            const components: any[] = [];
            const seenElements = new Set<string>();

            const componentSelectors = [
                'kendo-textbox', 'kendo-dropdownlist', 'kendo-combobox', 'kendo-datepicker',
                'kendo-numerictextbox', 'kendo-grid', 'kendo-treeview', 'kendo-checkbox',
                'kendo-radiobutton', 'kendo-switch', 'kendo-menu', 'kendo-tabstrip',
                '[ng-reflect-name]', '[formcontrolname]', '[formControlName]',
                'input:not([type="hidden"])', 'select', 'textarea', 'button', 'a[href]',
                '.mat-form-field', '.mat-input-element'
            ];

            for (const selector of componentSelectors) {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    // Skip extension UI
                    if (isExtensionUI(el)) return;

                    // Skip duplicates
                    const elementId = `${el.tagName}|${el.getAttribute('name')}|${el.getAttribute('id')}|${el.getAttribute('class')?.substring(0, 50)}`;
                    if (seenElements.has(elementId)) return;
                    seenElements.add(elementId);

                    const componentInfo = getComponentInfo(el);

                    // Only include if it has meaningful identifiers
                    const isStandardForm = ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName);
                    if (componentInfo.businessName !== '-' ||
                        componentInfo.ngReflectName ||
                        componentInfo.formControlName ||
                        componentInfo.kendoType ||
                        el.tagName.startsWith('KENDO-') ||
                        isStandardForm) {

                        components.push({
                            type: componentInfo.type,
                            subtype: el.getAttribute('type') || undefined,
                            id: componentInfo.id || undefined,
                            name: componentInfo.name || undefined,
                            placeholder: componentInfo.placeholder || undefined,
                            text: el.textContent?.trim().substring(0, 50) || undefined,
                            value: getElementValue(el) || undefined,
                            isEnabled: !el.hasAttribute('disabled') && !el.hasAttribute('readonly'),
                            isVisible: isElementVisible(el),
                            selector: componentInfo.selector,
                            ngReflectName: componentInfo.ngReflectName || undefined,
                            formControlName: componentInfo.formControlName || undefined,
                            kendoType: componentInfo.kendoType || undefined,
                            businessName: componentInfo.businessName || undefined,
                            ariaLabel: componentInfo.ariaLabel || undefined,
                            attributes: componentInfo.attributes
                        });
                    }
                });
            }

            return components;
        });
        
        // Categorize elements
        const buttons = scanResult.filter(el => el.type.includes('button') || el.type === 'a');
        const inputs = scanResult.filter(el => el.type.startsWith('input-') || el.subtype === 'text' || el.subtype === 'password');
        const selects = scanResult.filter(el => el.type === 'select' || el.kendoType?.includes('dropdown') || el.kendoType?.includes('combobox'));
        const tables = scanResult.filter(el => el.kendoType?.includes('grid') || el.type === 'table');
        
        const result: PageScanResult = {
            url: page.url(),
            scannedAt: new Date().toISOString(),
            title: await page.title(),
            elements: scanResult,
            buttons,
            inputs,
            selects,
            tables,
            errors
        };
        
        if (options.verbose) {
            console.log('\n=== Page Scan Results ===');
            console.log(`URL: ${result.url}`);
            console.log(`Title: ${result.title}`);
            console.log(`Total elements: ${scanResult.length}`);
            console.log(`  - Buttons: ${buttons.length}`);
            console.log(`  - Inputs: ${inputs.length}`);
            console.log(`  - Selects: ${selects.length}`);
            console.log(`  - Tables: ${tables.length}`);
            console.log('========================\n');
        }
        
        return result;
        
    } catch (error: any) {
        errors.push(`Scan failed: ${error.message}`);
        return {
            url: page.url(),
            scannedAt: new Date().toISOString(),
            title: await page.title().catch(() => 'Unknown'),
            elements: [],
            buttons: [],
            inputs: [],
            selects: [],
            tables: [],
            errors
        };
    }
}

/**
 * Find element by text or partial match
 */
export function findElementByText(result: PageScanResult, searchText: string, type?: string): ScannedElement | undefined {
    const search = searchText.toLowerCase();
    return result.elements.find(el => {
        if (type && el.type !== type) return false;
        const text = (el.text || '').toLowerCase();
        const businessName = (el.businessName || '').toLowerCase();
        const placeholder = (el.placeholder || '').toLowerCase();
        const name = (el.name || '').toLowerCase();
        const ngReflect = (el.ngReflectName || '').toLowerCase();
        const formControl = (el.formControlName || '').toLowerCase();
        
        return text.includes(search) || 
               businessName.includes(search) || 
               placeholder.includes(search) || 
               name.includes(search) ||
               ngReflect.includes(search) ||
               formControl.includes(search);
    });
}

/**
 * Get element selector by description
 */
export function getSelector(result: PageScanResult, description: string): string | undefined {
    const element = findElementByText(result, description);
    return element?.selector;
}

/**
 * Print scan results in readable format
 */
export function printScanResult(result: PageScanResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('PAGE SCAN RESULTS');
    console.log('='.repeat(60));
    console.log(`URL: ${result.url}`);
    console.log(`Title: ${result.title}`);
    console.log(`Scanned at: ${result.scannedAt}`);
    
    if (result.buttons.length > 0) {
        console.log('\n📌 BUTTONS:');
        result.buttons.forEach((btn, i) => {
            console.log(`  ${i + 1}. "${btn.text || btn.businessName}" - Selector: ${btn.selector}`);
        });
    }
    
    if (result.inputs.length > 0) {
        console.log('\n📝 INPUTS:');
        result.inputs.forEach((input, i) => {
            console.log(`  ${i + 1}. ${input.subtype || input.type} "${input.name || input.businessName}" - Selector: ${input.selector}`);
        });
    }
    
    if (result.tables.length > 0) {
        console.log('\n📊 TABLES/GRIDS:');
        result.tables.forEach((table, i) => {
            console.log(`  ${i + 1}. ${table.kendoComponent || table.type} - Selector: ${table.selector}`);
        });
    }
    
    console.log('\n' + '='.repeat(60) + '\n');
}
