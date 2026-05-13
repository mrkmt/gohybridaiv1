/**
 * Kendo UI Helper Functions
 * 
 * Robust, attribute-based selectors for Kendo UI components
 * These selectors are stable across UI changes and don't rely on index-based matching
 * 
 * @author Qwen AI Assistant
 * @date March 29, 2026
 */

type Page = any;
type Locator = any;

/**
 * Kendo UI Selector Utilities
 */
export class KendoSelectors {
    /**
     * Get robust selector for Kendo grid column by field name
     */
    static gridCellByField(fieldName: string): string {
        return `[data-field="${fieldName}"], [aria-label*="${fieldName}"], [title*="${fieldName}"]`;
    }

    /**
     * Get robust selector for Kendo dropdown by field name
     */
    static dropdownByField(fieldName: string): string[] {
        return [
            `kendo-dropdownlist[aria-label*="${fieldName}"]`,
            `kendo-combobox[aria-label*="${fieldName}"]`,
            `[role="listbox"][aria-label*="${fieldName}"]`,
            `.k-dropdown-wrap[aria-label*="${fieldName}"]`,
            `.k-select[aria-label*="${fieldName}"]`,
            `[data-field="${fieldName}"] .k-input`,
            `label:has-text("${fieldName}") + .k-dropdown`,
            `label:has-text("${fieldName}") ~ .k-dropdown`
        ];
    }

    /**
     * Get robust selector for Kendo textbox/input by field name
     */
    static inputByField(fieldName: string): string[] {
        return [
            `input[formcontrolname="${fieldName}"]`,
            `kendo-textbox[formcontrolname="${fieldName}"]`,
            `kendo-numerictextbox[formcontrolname="${fieldName}"]`,
            `[aria-label*="${fieldName}"]`,
            `[placeholder*="${fieldName}"]`,
            `input[name="${fieldName}"]`,
            `label:has-text("${fieldName}") + input`,
            `label:has-text("${fieldName}") ~ input`
        ];
    }

    /**
     * Get robust selector for Kendo grid row by text content
     */
    static gridRowByText(text: string): string[] {
        return [
            `kendo-grid tr:has-text("${text}")`,
            `tr.k-master-row:has-text("${text}")`,
            `tr[role="row"]:has-text("${text}")`,
            `tr:has(td:has-text("${text}"))`,
            `.k-grid tbody tr:has-text("${text}")`
        ];
    }

    /**
     * Get robust selector for Kendo button by text
     */
    static buttonByText(text: string): string[] {
        return [
            `button:has-text("${text}")`,
            `a.k-button:has-text("${text}")`,
            `.k-button:has-text("${text}")`,
            `[role="button"]:has-text("${text}")`,
            `button[aria-label*="${text}"]`
        ];
    }
}

/**
 * Kendo UI Action Helpers
 */
export class KendoActions {
    /**
     * Find grid cell by field name with multi-selector fallback
     */
    static async findGridCell(page: Page, fieldName: string): Promise<Locator> {
        const selectors = KendoSelectors.gridCellByField(fieldName).split(', ');
        
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            if (await locator.count() > 0) {
                return locator;
            }
        }
        
        throw new Error(`Grid cell not found for field: ${fieldName}`);
    }

    /**
     * Find dropdown by field name with multi-selector fallback
     */
    static async findDropdown(page: Page, fieldName: string): Promise<Locator> {
        const selectors = KendoSelectors.dropdownByField(fieldName);
        
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            if (await locator.count() > 0) {
                return locator;
            }
        }
        
        throw new Error(`Dropdown not found for field: ${fieldName}`);
    }

    /**
     * Find input by field name with multi-selector fallback
     */
    static async findInput(page: Page, fieldName: string): Promise<Locator> {
        const selectors = KendoSelectors.inputByField(fieldName);
        
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            if (await locator.count() > 0) {
                return locator;
            }
        }
        
        throw new Error(`Input not found for field: ${fieldName}`);
    }

    /**
     * Find grid row by text with multi-selector fallback
     */
    static async findGridRow(page: Page, text: string): Promise<Locator> {
        const selectors = KendoSelectors.gridRowByText(text);
        
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            if (await locator.count() > 0) {
                return locator;
            }
        }
        
        throw new Error(`Grid row not found with text: ${text}`);
    }

    /**
     * Find button by text with multi-selector fallback
     */
    static async findButton(page: Page, text: string): Promise<Locator> {
        const selectors = KendoSelectors.buttonByText(text);
        
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            if (await locator.count() > 0) {
                return locator;
            }
        }
        
        throw new Error(`Button not found with text: ${text}`);
    }

    /**
     * Select from Kendo dropdown with robust detection
     */
    static async selectFromDropdown(
        page: Page,
        fieldName: string,
        value: string
    ): Promise<boolean> {
        const dropdownSelectors = KendoSelectors.dropdownByField(fieldName);

        for (const selector of dropdownSelectors) {
            const dropdown = page.locator(selector).first();
            if (await dropdown.count() > 0) {
                try {
                    await dropdown.selectOption(value);
                    return true;
                } catch {
                    await dropdown.click();
                    const listItem = page.locator(`.k-list-item:has-text("${value}")`).first();
                    await listItem.waitFor({ state: 'visible', timeout: 10000 });
                    await listItem.click();
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Fill input with retry logic for Angular rendering
     */
    static async fillInput(
        page: Page,
        fieldName: string,
        value: string,
        maxRetries: number = 3
    ): Promise<boolean> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const input = await this.findInput(page, fieldName);
                await input.waitFor({ state: 'visible', timeout: 10000 });
                await input.fill(value);
                return true;
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    throw error;
                }
                await page.waitForSelector('body', { timeout: 3000 });
            }
        }
        return false;
    }

    /**
     * Click button with retry logic for Angular stability
     */
    static async clickButton(
        page: Page,
        buttonText: string,
        maxRetries: number = 3
    ): Promise<boolean> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const button = await this.findButton(page, buttonText);
                await button.waitFor({ state: 'visible', timeout: 10000 });

                const isEnabled = await button.isEnabled();
                if (!isEnabled) {
                    throw new Error('Button is disabled');
                }

                await button.click();
                return true;
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    throw error;
                }
                await page.waitForSelector('body', { timeout: 3000 });
            }
        }
        return false;
    }
}

/**
 * Wait for Angular stability using multiple signals
 * Supports both AngularJS (v1.x) and Angular (v2+)
 */
export async function waitForAngularStable(page: Page, timeout: number = 15000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        try {
            const isStable = await page.evaluate(() => {
                // 1. Angular 2+: check for ng-version on any element (proves Angular loaded)
                const ngVersionEl = document.querySelector('[ng-version]');
                if (ngVersionEl) {
                    // Angular 2+ with Zone.js: check pending macrotasks
                    const ng = (window as any).ng;
                    if (ng) {
                        try {
                            const injector = ng.getComponent(ngVersionEl)?.injector;
                            if (injector) {
                                const ngZone = injector.get?.(ng.NgZone);
                                if (ngZone && ngZone.isStable !== undefined) {
                                    return ngZone.isStable === true;
                                }
                            }
                        } catch { /* injector not ready yet */ }
                    }
                    // Zone.js check: no pending requests
                    const pendingTasks = (window as any).__zone_symbol__performanceEntries?.length;
                    return true; // Angular is loaded, proceed
                }

                // 2. AngularJS (v1.x): check $injector
                const el = document.querySelector('[ng-app]') || document.body;
                const $injector = (window as any).angular?.element(el)?.injector();
                if ($injector) {
                    const $rootScope = $injector.get('$rootScope');
                    return $rootScope.$$phase === null && !$rootScope.$$digesting;
                }

                // 3. Not an Angular app — treat as stable
                return true;
            });

            if (isStable) {
                return;
            }
        } catch {
            // Keep trying until timeout
        }

        await page.waitForTimeout(200); // Polling interval
    }

    // Timeout reached — log once and proceed
}

/**
 * Wait for form to render after Add button click
 */
export async function waitForFormRendered(
    page: Page,
    timeout: number = 15000
): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        // Check for modal form
        const modal = page.locator('.modal.show, .k-window-active');
        if (await modal.count() > 0 && await modal.first().isVisible().catch(() => false)) {
            return true;
        }

        // Check for inline form (formcontrolname inputs visible)
        const inputs = page.locator('input[formcontrolname]:visible, kendo-textbox:visible');
        if (await inputs.count() > 0) {
            return true;
        }

        await page.waitForSelector('body', { timeout: 1000 });
    }

    return false;
}
