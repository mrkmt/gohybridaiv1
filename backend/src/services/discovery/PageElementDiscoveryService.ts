/**
 * PageElementDiscoveryService
 *
 * Navigates to a live page, probes the DOM with Playwright, and returns
 * a structured inventory of all UI elements: buttons, inputs, dropdowns,
 * grids, pagination, tabs, modals, etc.
 *
 * Feeds real selectors into AIBrainEngine so generated scripts use actual
 * page elements instead of guessing from a stale JSON repo.
 */

import { Page, BrowserContext } from 'playwright';
import crypto from 'crypto';
import { ElementRepositoryService, PageElement } from '../ElementRepositoryService';
import { appLogger } from '../../utils/logger';
// S4-2: semantic enrichment (role / required / triggers) runs at the end of
// discoverPage(). DiscoveryEnricher only imports ElementInfo/PageInventory as
// types so there's no runtime circular dependency.
import { enrichInventory } from './DiscoveryEnricher';

// ============================================================================
// TYPES
// ============================================================================

export interface ElementInfo {
    name: string;
    selector: string;
    altSelectors: string[];
    type: string;
    attributes: Record<string, string>;
    section?: string;
    isVisible: boolean;
    isEnabled: boolean;
    /**
     * S4-1: The UI state this element was captured in. Format:
     *   "route:<pathHash>|modal:<title|none>|tab:<index>|dropdown:<open|none>"
     * Downstream consumers (prompt builder, target resolver, self-heal) can use
     * this to avoid offering a selector valid only in a state the test never
     * reaches (e.g. a field inside a modal that never gets opened).
     */
    stateKey?: string;
    /**
     * S4-2: semantic enrichment — populated by DiscoveryEnricher after capture.
     * These tags let the LLM reason about field purpose/ordering without having
     * to infer from the selector.
     */
    /** Whether this field is required (attribute, aria-required, or asterisk near label). */
    required?: boolean;
    /** Role in the form/page. */
    role?: 'submit' | 'cancel' | 'destructive' | 'nav' | 'input' | 'control' | 'search' | 'other';
    /** What clicking/interacting with this element triggers. */
    triggers?: 'modal' | 'dropdown' | 'navigation' | 'submit' | 'none';
}

export interface GridInfo {
    selector: string;
    columns: string[];
    hasToolbar: boolean;
    /** Buttons found inside the grid toolbar (Add, Export, Refresh…) */
    toolbarButtons: string[];
    hasSearch: boolean;
    hasExport: boolean;
    /** True when a Kendo filter row (.k-filter-row) is present */
    hasFilter: boolean;
    /** Column names that have a filter input/dropdown in the filter row */
    filterColumns: string[];
    /** Action buttons found in data rows (Edit, Delete, View…) */
    actionButtons: string[];
    estimatedRowCount: number;
    isKendo: boolean;
}

export interface PaginationInfo {
    selector: string;
    hasPageNumbers: boolean;
    hasPageSizeSelector: boolean;
    hasNextPrev: boolean;
    hasTotalCount: boolean;
}

export interface TabInfo {
    selector: string;
    tabs: string[];
    isKendo: boolean;
    deepElements?: ElementInfo[];
}

export interface ModalInfo {
    selector: string;
    title: string;
    hasCloseButton: boolean;
    /** Input/dropdown/textarea names discovered inside this modal */
    fields: string[];
    /** Action buttons inside the modal (Save, Cancel, Confirm…) */
    actionButtons: string[];
}

/** Top-nav, side-nav, or toolbar menu structure */
export interface MenuInfo {
    selector: string;
    label: string;
    items: string[];
    type: 'topnav' | 'sidenav' | 'toolbar' | 'contextmenu';
}

export interface PageInventory {
    url: string;
    hash: string;
    pageTitle: string;
    discoveredAt: string;
    buttons: ElementInfo[];
    inputs: ElementInfo[];
    dropdowns: ElementInfo[];
    grids: GridInfo[];
    pagination: PaginationInfo | null;
    tabs: TabInfo[];
    modals: ModalInfo[];
    checkboxes: ElementInfo[];
    radios: ElementInfo[];
    menus: MenuInfo[];
    other: ElementInfo[];
    summary: string;
    /**
     * S4-1: The UI state the main discovery pass was captured in. Used as the
     * default stateKey for every element that doesn't carry one explicitly.
     */
    defaultStateKey?: string;
    /**
     * Permission flags: indicate likely missing actions due to user permissions.
     * Checked by upstream consumers to skip generation of unauthorized scenarios.
     */
    permissionFlags?: PermissionFlag[];
}

/** Indicates a likely permission gap for a CRUD action. */
export interface PermissionFlag {
    action: 'ADD' | 'EDIT' | 'DELETE' | 'EXPORT';
    module: string;
    likelyMissing: boolean;
    reason: string;
}

// ---------------------------------------------------------------------------
// S4-1: State key helpers
// ---------------------------------------------------------------------------

/**
 * Build a stable string key describing the UI state an element was captured in.
 * Keep this format flat + human-readable so it survives JSON round-trips and
 * can be grep'd in logs / prompt output.
 */
export function buildStateKey(parts: {
    url?: string;
    modal?: string | null;
    tab?: number | null;
    dropdown?: 'open' | 'none';
}): string {
    const pathHash = (() => {
        if (!parts.url) return 'unknown';
        try {
            return new URL(parts.url).hash || new URL(parts.url).pathname || 'root';
        } catch {
            return 'unknown';
        }
    })();
    const modal = parts.modal && parts.modal.trim().length > 0 ? parts.modal : 'none';
    const tab = typeof parts.tab === 'number' ? String(parts.tab) : '0';
    const dropdown = parts.dropdown || 'none';
    return `route:${pathHash}|modal:${modal}|tab:${tab}|dropdown:${dropdown}`;
}

/** Apply `stateKey` to every element in an array that doesn't already carry one. */
function tagElements(elements: ElementInfo[], stateKey: string): ElementInfo[] {
    if (!elements || !Array.isArray(elements)) return [];
    return elements.map(el => (el.stateKey ? el : { ...el, stateKey }));
}

// ============================================================================
// MAIN DISCOVERY
// ============================================================================

export class PageElementDiscoveryService {

    /**
     * Discover all elements on a page.
     * Requires a PageContext that provides an authenticated page instance.
     * The caller is responsible for navigation and login.
     */
    static async discoverPage(
        page: Page,
        options?: {
            pageName?: string;
            section?: string;
            deepScan?: boolean;
        }
    ): Promise<PageInventory> {
        const pageName = options?.pageName || extractPageName(page.url());
        const section = options?.section;
        const deepScan = options?.deepScan ?? false;

        // Register helpers in browser context to avoid ReferenceErrors in evaluate()
        await this.registerBrowserHelpers(page);

        // Wait for Angular to stabilize
        await waitForAngularStable(page);

        const [
            pageTitle,
            buttons,
            inputs,
            dropdowns,
            grids,
            pagination,
            checkboxes,
            radios,
            menus,
        ] = await Promise.all([
            page.title().catch(() => ''),
            this.discoverButtons(page, section),
            this.discoverInputs(page, section),
            this.discoverDropdowns(page, section),
            this.discoverGrids(page),
            this.discoverPagination(page),
            this.discoverCheckboxes(page, section),
            this.discoverRadios(page, section),
            this.discoverMenus(page),
        ]);

        // Deep scan: open tabs and modals to discover hidden elements
        const tabs = await this.discoverTabs(page);
        const modals: ModalInfo[] = [];

        let tabsDeep: TabInfo[] = tabs;
        let modalsDeep: ModalInfo[] = modals;

        if (deepScan) {
            // Try to open each tab and discover its unique elements
            tabsDeep = await this.deepScanTabs(page, tabs);
            modalsDeep = await this.deepScanModals(page);
        }

        // Other elements (links, icons, badges, etc.)
        const other = await this.discoverOther(page, section);

        const summary = this.buildSummary({
            buttons: buttons || [],
            inputs: inputs || [],
            dropdowns: dropdowns || [],
            grids: grids || [],
            pagination,
            tabs: tabsDeep || [],
            modals: modalsDeep || [],
            checkboxes: checkboxes || [],
            radios: radios || [],
            menus: menus || [],
            other: other || [],
        });

        // S4-1: Compute the default state key for this discovery pass and
        // stamp it on every element captured in the main (non-deep) probe.
        // Deep-scan tab elements get their own stateKey inside deepScanTabs().
        const defaultStateKey = buildStateKey({
            url: page.url(),
            modal: 'none',
            tab: 0,
            dropdown: 'none',
        });

        const inventory: PageInventory = {
            url: page.url(),
            hash: crypto.createHash('md5').update(page.url()).digest('hex'),
            pageTitle,
            discoveredAt: new Date().toISOString(),
            buttons: tagElements(buttons || [], defaultStateKey),
            inputs: tagElements(inputs || [], defaultStateKey),
            dropdowns: tagElements(dropdowns || [], defaultStateKey),
            grids: grids || [],
            pagination: pagination || null,
            tabs: tabsDeep || [],
            modals: modalsDeep || [],
            checkboxes: tagElements(checkboxes || [], defaultStateKey),
            radios: tagElements(radios || [], defaultStateKey),
            menus: menus || [],
            other: tagElements(other || [], defaultStateKey),
            summary,
            defaultStateKey,
        };

        // S4-2: stamp semantic tags (required / role / triggers) on every
        // captured element before returning. Pure function, safe to call.

        // Check for permission gaps and set flags
        const permissionFlags: PermissionFlag[] = [];

        for (const grid of grids) {
            if (grid.hasToolbar && !grid.toolbarButtons.some(b => b.toLowerCase().includes('add'))) {
                permissionFlags.push({
                    action: 'ADD',
                    module: pageName,
                    likelyMissing: true,
                    reason: 'Kendo grid toolbar found but no Add button detected. Account may lack Write permission.',
                });
            }

            if (grid.hasToolbar && !grid.toolbarButtons.some(b => b.toLowerCase().includes('edit') || b.toLowerCase().includes('delete'))) {
                permissionFlags.push({
                    action: 'DELETE',
                    module: pageName,
                    likelyMissing: true,
                    reason: 'Grid toolbar found but no Edit/Delete buttons. Account may have read-only access.',
                });
            }
        }

        if (permissionFlags.length > 0) {
            inventory.permissionFlags = permissionFlags;
        }

        return enrichInventory(inventory);
    }

    /**
     * Injects all helper functions into the browser context so they are available in evaluate() calls.
     */
    private static async registerBrowserHelpers(page: Page): Promise<void> {
        await page.evaluate(() => {
            // 1. Stable Selector Logic - Production Ready (ARIA/Role First)
            (window as any).getStableSelector = (el: Element) => {
                const tagName = el.tagName.toLowerCase();
                const hasDynamicId = el.id?.startsWith('k-') || el.id?.startsWith('ng-') || el.id?.match(/^[0-9]/);

                // Priority 1: User-defined stable ID (if not auto-generated)
                if (el.id && !hasDynamicId) return `#${el.id}`;

                // Priority 2: Semantic ARIA attributes (Resilient to framework changes)
                const ariaLabel = el.getAttribute('aria-label');
                if (ariaLabel) return `${tagName}[aria-label="${ariaLabel}"]`;

                const testId = el.getAttribute('data-testid') || el.getAttribute('data-qa') || el.getAttribute('data-cy');
                if (testId) return `[data-testid="${testId}"]`;

                // Priority 3: Form Controls (Angular/Kendo common)
                const fcn = el.getAttribute('formControlName') || el.getAttribute('formcontrolname');
                if (fcn) return `${tagName}[formControlName="${fcn}"]`;

                const name = el.getAttribute('name');
                if (name) return `${tagName}[name="${name}"]`;

                // Priority 4: Development-only attributes (Last resort)
                const nrn = el.getAttribute('ng-reflect-name');
                if (nrn) return `${tagName}[ng-reflect-name="${nrn}"]`;

                // Priority 5: Title or Placeholder
                const title = el.getAttribute('title');
                if (title) return `${tagName}[title="${title}"]`;

                const placeholder = (el as HTMLInputElement).placeholder;
                if (placeholder) return `${tagName}[placeholder="${placeholder}"]`;

                return tagName;
            };

            // 2. Parent Component Discovery
            (window as any).findAngularKendoParent = (el: Element) => {
                const kendoSelectors = [
                    'kendo-textbox', 'kendo-numerictextbox', 'kendo-dropdownlist',
                    'kendo-combobox', 'kendo-datepicker', 'kendo-checkbox',
                    'kendo-radiobutton', 'kendo-switch', 'kendo-grid',
                ];
                const angularSelectors = [
                    '[ng-reflect-name]', '[formControlName]', '[formcontrolname]',
                    '[formControl]', '[formcontrol]', '.ng-tns',
                    '.mat-form-field', '.mat-input-element', 'form',
                ];
                const allSelectors = [...kendoSelectors, ...angularSelectors];

                for (const selector of allSelectors) {
                    const parent = el.closest(selector);
                    if (parent) {
                        const isKendo = parent.tagName?.startsWith('KENDO-');
                        return {
                            element: parent,
                            selector,
                            ngReflectName: parent.getAttribute('ng-reflect-name'),
                            formControlName: parent.getAttribute('formControlName') || parent.getAttribute('formcontrolname'),
                            ariaLabel: parent.getAttribute('aria-label'),
                            kendoType: isKendo ? parent.tagName.toLowerCase() : null,
                        };
                    }
                }
                return null;
            };

            // 3. Component Info
            (window as any).getComponentInfo = (el: Element) => {
                const parent = (window as any).findAngularKendoParent(el);
                const tagName = el.tagName.toLowerCase();

                let type = tagName;
                if (parent?.kendoType) {
                    type = parent.kendoType;
                } else if (parent?.ngReflectName || parent?.formControlName) {
                    type = `angular-${tagName}`;
                } else if (tagName === 'INPUT') {
                    type = `input-${(el as HTMLInputElement).type || 'text'}`;
                }

                const businessName = parent?.ngReflectName ||
                    parent?.formControlName ||
                    el.getAttribute('formControlName') ||
                    el.getAttribute('ng-reflect-name') ||
                    el.getAttribute('name') ||
                    el.getAttribute('aria-label') ||
                    (el as HTMLInputElement).placeholder ||
                    (tagName === 'BUTTON' ? (el.textContent?.trim().substring(0, 30) || null) : null) ||
                    '-';

                return {
                    type,
                    selector: (window as any).getStableSelector(el),
                    ngReflectName: parent?.ngReflectName || el.getAttribute('ng-reflect-name'),
                    ariaLabel: parent?.ariaLabel || el.getAttribute('aria-label'),
                    formControlName: parent?.formControlName || el.getAttribute('formControlName') || el.getAttribute('formcontrolname'),
                    kendoType: parent?.kendoType || (el.tagName?.startsWith('KENDO-') ? el.tagName.toLowerCase() : null),
                    name: el.getAttribute('name') || null,
                    businessName,
                };
            };

            // 4. Alt Selectors
            (window as any).buildAltSelectors = (el: Element) => {
                const selectors: string[] = [];
                const tagName = el.tagName.toLowerCase();

                const testId = el.getAttribute('data-testid');
                if (testId) selectors.push(`[data-testid="${testId}"]`);

                const fcn = el.getAttribute('formControlName') || el.getAttribute('formcontrolname');
                if (fcn) selectors.push(`${tagName}[formControlName="${fcn}"]`);

                const name = el.getAttribute('name');
                if (name) selectors.push(`${tagName}[name="${name}"]`);

                const id = el.getAttribute('id');
                if (id && !id.startsWith('k-') && !id.startsWith('ng-')) {
                    selectors.push(`#${id}`);
                }

                return Array.from(new Set(selectors));
            };

            // 5. Attributes
            (window as any).extractAttributes = (el: Element) => {
                const attrs: Record<string, string> = {};
                const wanted = ['id', 'name', 'type', 'placeholder', 'aria-label', 'data-testid', 'data-qa', 'data-role', 'href', 'value', 'formcontrolname', 'formControlName', 'ng-reflect-name', 'role'];
                for (const attr of wanted) {
                    const val = el.getAttribute(attr);
                    if (val) attrs[attr] = val;
                }
                attrs['tag'] = el.tagName.toLowerCase();
                return attrs;
            };

            // 6. Icon Identity — resolves a human-readable name for icon-only
            //    buttons that carry no visible text. Checks in priority order:
            //    aria-label/title → Kendo icon class → FontAwesome class →
            //    Material icon text → SVG data-icon → ancestor tooltip.
            (window as any).getIconIdentity = (el: Element): string => {
                // 1. Explicit accessibility label on the element itself
                const direct = el.getAttribute('aria-label') || el.getAttribute('title');
                if (direct?.trim()) return direct.trim();

                // 1b. Standard Kendo Grid Functional Classes (High Priority)
                if (el.classList.contains('k-grid-add')) return 'Add New';
                if (el.classList.contains('k-grid-save')) return 'Save';
                if (el.classList.contains('k-grid-delete')) return 'Delete';
                if (el.classList.contains('k-grid-cancel')) return 'Cancel';
                if (el.classList.contains('k-grid-excel')) return 'Export to Excel';
                if (el.classList.contains('k-grid-pdf')) return 'Export to PDF';

                // Collect the element and all its descendants for class scanning
                const allNodes: Element[] = [el, ...Array.from(el.querySelectorAll('*'))];

                // 2. Kendo CSS icon class: .k-i-pencil → "pencil"
                for (const node of allNodes) {
                    const kls = Array.from(node.classList || []).find(c => c.startsWith('k-i-'));
                    if (kls) return kls.replace('k-i-', '').replace(/-/g, ' ');
                }

                // 3. Kendo SVG icon: <kendo-svg-icon [icon]="..."> → title child or name attr
                const kendoSvg = el.querySelector('kendo-svg-icon');
                if (kendoSvg) {
                    const svgTitle = kendoSvg.getAttribute('ng-reflect-icon') ||
                        kendoSvg.getAttribute('title') || '';
                    if (svgTitle) return svgTitle.replace(/Icon$/, '').replace(/([A-Z])/g, ' $1').trim();
                }

                // 4. FontAwesome: .fa-pencil → "pencil"
                for (const node of allNodes) {
                    const faClass = Array.from(node.classList || []).find(
                        c => c.startsWith('fa-') && !['fa-fw', 'fa-sm', 'fa-lg', 'fa-xs', 'fa-2x'].includes(c)
                    );
                    if (faClass) return faClass.replace('fa-', '').replace(/-/g, ' ');
                }

                // 5. Material icons: <mat-icon>edit</mat-icon>
                const matIcon = el.querySelector('mat-icon');
                if (matIcon?.textContent?.trim()) return matIcon.textContent.trim();

                // 6. SVG with data-icon attribute
                const svg = el.querySelector('svg[data-icon]');
                if (svg) return svg.getAttribute('data-icon') || '';

                // 7. Walk up DOM tree for a tooltip on a wrapping element
                let ancestor = el.parentElement;
                for (let depth = 0; ancestor && depth < 5; depth++) {
                    const t = ancestor.getAttribute('aria-label') || ancestor.getAttribute('title');
                    if (t?.trim()) return t.trim();
                    ancestor = ancestor.parentElement;
                }

                return '';
            };

            // 7. State
            (window as any).isElementDisabled = (el: Element) => {
                if (el.hasAttribute('disabled')) return true;
                if (el.getAttribute('aria-disabled') === 'true') return true;
                if (el.classList.contains('k-state-disabled') || el.classList.contains('disabled')) return true;
                return false;
            };

            (window as any).getInputType = (el: Element) => {
                if (el.tagName.toLowerCase() === 'textarea') return 'textarea';
                return (el as HTMLInputElement).type || 'text';
            };
        });
    }

    // -------------------------------------------------------------------
    // DISCOVER: Buttons
    // -------------------------------------------------------------------

    private static async discoverButtons(page: Page, section?: string): Promise<ElementInfo[]> {
        return page.evaluate((sect: string | undefined) => {
            // Exclude elements inside navigation/sidebar/header containers.
            const NAV_SELECTORS = [
                'nav', 'header', '.k-drawer', '.k-drawer-container',
                '[class*="sidebar"]', '[class*="sidenav"]', '[class*="side-nav"]',
                '.topbar', '.top-bar', '.navbar', '.app-header',
                '.k-appbar', 'kendo-appbar',
            ];
            const isInsideNav = (el: Element): boolean =>
                NAV_SELECTORS.some(sel => el.closest(sel) !== null);

            // Include .k-icon-button — these are the pure icon action buttons
            // (Edit, Delete, Filter) that the previous query explicitly excluded.
            // P0: Also catch Kendo toolbar buttons rendered as <span> or <a> with functional classes.
            const elements = document.querySelectorAll(
                'button:not([type="hidden"]), [role="button"]:not(.k-link), ' +
                '.k-button, .k-icon-button, input[type="button"], input[type="submit"], ' +
                'a.k-button, .btn, ' +
                'a.k-grid-add, span.k-grid-add, ' +
                'a.k-grid-save, span.k-grid-save, ' +
                'a.k-grid-delete, span.k-grid-delete'
            );

            return Array.from(elements)
                .filter(el => (el as HTMLElement).offsetParent !== null) // visible only
                .filter(el => !isInsideNav(el))                          // exclude nav chrome
                .slice(0, 150)
                .map(el => {
                    const info = (window as any).getComponentInfo(el);
                    const visibleText = el.textContent?.trim() || '';

                    // For icon-only buttons (no visible text, name not resolved by
                    // getComponentInfo) try the multi-source icon identity resolver.
                    let name = info.businessName;
                    const isIconOnly = !visibleText && (name === '-' || !name);
                    if (isIconOnly) {
                        const iconId = (window as any).getIconIdentity(el);
                        if (iconId) {
                            name = iconId;
                        }
                    }

                    // Skip completely unnamed elements — they are decorative
                    if (!name || name === '-') return null;

                    const isIconButton = isIconOnly ||
                        el.classList.contains('k-icon-button') ||
                        (el.querySelectorAll('i, svg, .k-icon').length > 0 && !visibleText);

                    return {
                        name,
                        selector: info.selector,
                        altSelectors: (window as any).buildAltSelectors(el),
                        type: isIconButton ? 'icon-button' : (info.kendoType || info.type || 'button'),
                        attributes: (window as any).extractAttributes(el),
                        section: sect,
                        isVisible: true,
                        isEnabled: !(window as any).isElementDisabled(el),
                    };
                })
                .filter((el): el is NonNullable<typeof el> => el !== null);
        }, section);
    }

    // -------------------------------------------------------------------
    // DISCOVER: Inputs
    // -------------------------------------------------------------------

    private static async discoverInputs(page: Page, section?: string): Promise<ElementInfo[]> {
        return page.evaluate((sect: string | undefined) => {
            const NAV_SELECTORS = [
                'nav', 'header', '.k-drawer', '.k-drawer-container',
                '[class*="sidebar"]', '[class*="sidenav"]', '[class*="side-nav"]',
                '.topbar', '.top-bar', '.navbar', '.app-header',
                '.k-appbar', 'kendo-appbar',
            ];
            const isInsideNav = (el: Element): boolean =>
                NAV_SELECTORS.some(sel => el.closest(sel) !== null);

            // Native inputs + Kendo components that wrap inputs but are
            // themselves the Angular binding target. Query both; dedup by selector below.
            const elements = document.querySelectorAll(
                'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([type="file"]), ' +
                'textarea, [contenteditable="true"], ' +
                // Kendo UI input components (Angular binding is on the component, not inner <input>)
                'kendo-textbox, kendo-numerictextbox, kendo-datepicker, kendo-timepicker, ' +
                'kendo-multiselect, kendo-autocomplete, kendo-maskedtextbox, ' +
                'kendo-colorpicker, kendo-editor, kendo-textarea'
            );

            const seen = new Set<string>();

            return Array.from(elements)
                .filter(el => !isInsideNav(el))
                .filter(el => {
                    // Skip native inputs that are INSIDE a Kendo component —
                    // the Kendo component itself will be in the list and is more useful.
                    const isInsideKendo = el.closest(
                        'kendo-textbox, kendo-numerictextbox, kendo-datepicker, ' +
                        'kendo-timepicker, kendo-multiselect, kendo-autocomplete, ' +
                        'kendo-maskedtextbox, kendo-colorpicker, kendo-editor, kendo-textarea'
                    );
                    return !(el.tagName.toLowerCase() === 'input' && isInsideKendo);
                })
                .slice(0, 100)
                .map(el => {
                    const info = (window as any).getComponentInfo(el);
                    const selector: string = info.selector;
                    if (seen.has(selector)) return null;
                    seen.add(selector);
                    return {
                        name: info.businessName,
                        selector,
                        altSelectors: (window as any).buildAltSelectors(el),
                        type: info.kendoType || (el.tagName.toLowerCase() === 'textarea' ? 'textarea' : (window as any).getInputType(el)),
                        attributes: (window as any).extractAttributes(el),
                        section: sect,
                        isVisible: (el as HTMLElement).offsetParent !== null,
                        isEnabled: !(window as any).isElementDisabled(el),
                    };
                })
                .filter((el): el is NonNullable<typeof el> => el !== null);
        }, section);
    }

    // -------------------------------------------------------------------
    // DISCOVER: Dropdowns
    // -------------------------------------------------------------------

    private static async discoverDropdowns(page: Page, section?: string): Promise<ElementInfo[]> {
        return page.evaluate((sect: string | undefined) => {
            const elements = document.querySelectorAll(
                'select, .k-dropdown, .k-dropdownlist, .k-combobox, [role="combobox"], ' +
                '[role="listbox"], .k-picker, kendo-dropdownlist, kendo-combobox'
            );
            return Array.from(elements).slice(0, 50).map(el => {
                const info = (window as any).getComponentInfo(el);
                return {
                    name: info.businessName,
                    selector: info.selector,
                    altSelectors: (window as any).buildAltSelectors(el),
                    type: info.kendoType || (el.tagName.toLowerCase() === 'select' ? 'select' : 'kendo-dropdown'),
                    attributes: (window as any).extractAttributes(el),
                    section: sect,
                    isVisible: (el as HTMLElement).offsetParent !== null,
                    isEnabled: !(window as any).isElementDisabled(el),
                };
            });
        }, section);
    }

    // -------------------------------------------------------------------
    // DISCOVER: Grids
    // -------------------------------------------------------------------

    private static async discoverGrids(page: Page): Promise<GridInfo[]> {
        return page.evaluate(() => {
            const gridElements = document.querySelectorAll(
                '.k-grid, [role="grid"], [role="treegrid"], kendo-grid'
            );

            return Array.from(gridElements).slice(0, 10).map(gridEl => {
                // ── Column headers ──────────────────────────────────────────
                const headerEls = gridEl.querySelectorAll(
                    'thead th .k-column-title, thead th, .k-grid-header .k-header'
                );
                const columns: string[] = Array.from(headerEls)
                    .map(h => h.textContent?.trim() || '')
                    .filter(Boolean);

                // ── Toolbar ─────────────────────────────────────────────────
                const toolbar = gridEl.querySelector('.k-toolbar, .k-grid-toolbar');
                const hasToolbar = !!toolbar;

                const toolbarButtons: string[] = [];
                if (toolbar) {
                    // P0: Also check for buttons with nested icon elements
                    const allButtons = toolbar.querySelectorAll('button, .k-button, [role="button"], a, .k-link');
                    allButtons.forEach(btn => {
                        const text = btn.textContent?.trim() || '';
                        // Check if button has k-grid-* class directly
                        let iconId = (window as any).getIconIdentity(btn);
                        // P0: Also check for nested icon elements (Kendo UI often puts icon inside button)
                        if (!iconId) {
                            const nestedIcon = btn.querySelector('[class*="grid-"], [class*="k-i-"], kendo-svg-icon');
                            if (nestedIcon) iconId = (window as any).getIconIdentity(nestedIcon);
                        }
                        let label = text || (iconId ? `${iconId} (icon)` : '');

                        // P0 EMERGENCY FALLBACK: If still no label, use class name so it's not "Ghosted"
                        if (!label) {
                           const classes = Array.from(btn.classList).filter(c => c.includes('grid-') || c.includes('button-'));
                           if (classes.length > 0) label = `${classes[0]} (icon)`;
                        }

                        if (label && !toolbarButtons.includes(label)) toolbarButtons.push(label);
                    });
                }

                // P0: No longer inject virtual buttons. If Add is missing,
                // a permission flag will be set on the PageInventory instead.

                // ── Search & Export ─────────────────────────────────────────
                const hasSearch = !!(
                    gridEl.querySelector('.k-grid-search') ||
                    gridEl.querySelector('[placeholder*="search" i], [placeholder*="filter" i]')
                );
                const hasExport = !!(
                    gridEl.querySelector('.k-grid-excel, .k-grid-pdf, [class*="excel"], [class*="pdf"]') ||
                    toolbarButtons.some(b => /export/i.test(b))
                );

                // ── Filter row ──────────────────────────────────────────────
                const filterRow = gridEl.querySelector('.k-filter-row');
                const hasFilter = !!filterRow;
                const filterColumns: string[] = [];
                if (filterRow) {
                    const filterCells = filterRow.querySelectorAll('td');
                    filterCells.forEach((cell, idx) => {
                        if (cell.querySelector('input, .k-dropdown, kendo-dropdownlist, select')) {
                            // Map to column name by index position
                            const colName = columns[idx] || `Column ${idx + 1}`;
                            filterColumns.push(colName);
                        }
                    });
                }

                // ── Row-level action buttons ────────────────────────────────
                // Sample first 3 data rows; skip header/filter rows
                const dataRows = Array.from(
                    gridEl.querySelectorAll('tbody > tr:not(.k-detail-row):not(.k-grouping-row)')
                ).slice(0, 3);

                const actionButtons: string[] = [];
                for (const row of dataRows) {
                    row.querySelectorAll('td').forEach(cell => {
                        cell.querySelectorAll('button, .k-button, [role="button"], a.k-link').forEach(btn => {
                            const text = btn.textContent?.trim() || '';
                            const iconId = (window as any).getIconIdentity(btn);
                            const label = text || (iconId ? `${iconId} (icon)` : '');
                            if (label && !actionButtons.includes(label)) actionButtons.push(label);
                        });
                    });
                }

                // ── Row count + Kendo flag ──────────────────────────────────
                const rows = gridEl.querySelectorAll('tbody > tr');
                const estimatedRowCount = rows.length;
                const isKendo =
                    gridEl.classList.contains('k-grid') ||
                    gridEl.tagName.toLowerCase() === 'kendo-grid';

                return {
                    selector: (window as any).getStableSelector(gridEl),
                    columns,
                    hasToolbar,
                    toolbarButtons,
                    hasSearch,
                    hasExport,
                    hasFilter,
                    filterColumns,
                    actionButtons,
                    estimatedRowCount,
                    isKendo,
                };
            });
        });
    }

    // -------------------------------------------------------------------
    // DISCOVER: Pagination
    // -------------------------------------------------------------------

    private static async discoverPagination(page: Page): Promise<PaginationInfo | null> {
        return page.evaluate(() => {
            const pager = document.querySelector('.k-pager-wrap, .k-pager-info, .pagination, [aria-label*="page"]');
            if (!pager) return null;

            const hasPageNumbers = !!pager.querySelector('.k-link[aria-label*="page"], .k-page-num, li > a:not(.k-prev):not(.k-next)');
            const hasPageSizeSelector = !!(pager.querySelector('.k-dropdownlist') || pager.querySelector('[aria-label*="page size"]') || pager.querySelector('select'));
            const hasNextPrev = !!(pager.querySelector('.k-prev, .k-next, [aria-label*="previous"], [aria-label*="next"]') || (pager.textContent || '').match(/(prev|next|first|last)/i));
            const hasTotalCount = !!(pager.querySelector('.k-pager-info, .k-page-sizes-info') || (pager.textContent || '').match(/\d+\s*-\s*\d+\s*of\s*\d+/i));

            return {
                selector: (window as any).getStableSelector(pager),
                hasPageNumbers,
                hasPageSizeSelector,
                hasNextPrev,
                hasTotalCount,
            };
        });
    }

    // -------------------------------------------------------------------
    // DISCOVER: Tabs
    // -------------------------------------------------------------------

    private static async discoverTabs(page: Page): Promise<TabInfo[]> {
        return page.evaluate(() => {
            const tabContainers = document.querySelectorAll('.k-tabstrip, [role="tablist"], .nav-tabs, kendo-tabstrip, mat-tab-group');
            return Array.from(tabContainers).slice(0, 10).map(tabEl => {
                const tabItems = tabEl.querySelectorAll('[role="tab"], .k-tabstrip-items > li > .k-link, .k-link.k-item, mat-tab-label, .nav-link');
                const tabs: string[] = Array.from(tabItems)
                    .map(t => t.textContent?.trim() || t.getAttribute('aria-label') || '')
                    .filter(Boolean);

                return {
                    selector: (window as any).getStableSelector(tabEl),
                    tabs,
                    isKendo: tabEl.classList.contains('k-tabstrip') || tabEl.tagName.toLowerCase() === 'kendo-tabstrip',
                };
            });
        });
    }

    /**
     * Deep scan: click each tab and discover unique elements that appear.
     */
    private static async deepScanTabs(page: Page, tabs: TabInfo[]): Promise<TabInfo[]> {
        const scanned: TabInfo[] = [];

        for (const tab of tabs) {
            if (tab.tabs.length === 0) {
                scanned.push(tab);
                continue;
            }

            const tabHeaderSelectors = `[role="tab"]`;
            const tabHeaders = await page.locator(tabHeaderSelectors)
                .or(page.locator(`${tab.selector} .k-tabstrip-items .k-item`))
                .or(page.locator(`${tab.selector} .k-link.k-item`))
                .all();

            const enhancedTab = { ...tab, tabs: [...tab.tabs], deepElements: [] as ElementInfo[] };

            for (let i = 0; i < Math.min(tabHeaders.length, tab.tabs.length); i++) {
                try {
                    await tabHeaders[i].click({ force: true, timeout: 3000 });
                    await page.waitForTimeout(500);
                    await waitForAngularStable(page);

                    const contentElements: ElementInfo[] = await page.evaluate(() => {
                        const els = document.querySelectorAll(
                            'input:not([type="hidden"]), button:not([type="hidden"]), select, textarea'
                        );
                        return Array.from(els).filter(el => {
                            const rect = el.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0 && (el as HTMLElement).offsetParent !== null;
                        }).slice(0, 50).map(el => {
                            const info = (window as any).getComponentInfo(el);
                            return {
                                name: info.businessName,
                                selector: info.selector,
                                altSelectors: (window as any).buildAltSelectors(el),
                                type: info.kendoType || el.tagName.toLowerCase(),
                                attributes: (window as any).extractAttributes(el),
                                section: undefined,
                                isVisible: true,
                                isEnabled: !(window as any).isElementDisabled(el),
                            };
                        });
                    });

                    // S4-1: tag deep-scan elements with their tab index so the
                    // downstream consumer knows these are only reachable after
                    // clicking tab[i].
                    const tabStateKey = buildStateKey({
                        url: page.url(),
                        modal: 'none',
                        tab: i,
                        dropdown: 'none',
                    });
                    enhancedTab.deepElements = tagElements(contentElements, tabStateKey);
                } catch {
                    // Tab click failed
                }
            }
            scanned.push(enhancedTab);
        }
        return scanned;
    }

    // -------------------------------------------------------------------
    // DISCOVER: Modals
    // -------------------------------------------------------------------

    private static async discoverModals(page: Page): Promise<ModalInfo[]> {
        return page.evaluate(() => {
            const modalElements = document.querySelectorAll(
                '.k-window, [role="dialog"], .modal, kendo-window, .k-dialog'
            );
            return Array.from(modalElements).slice(0, 20).map(modal => {
                // Title
                const title =
                    modal.querySelector('.k-window-title, .k-dialog-title, [role="dialog"] h2, .modal-title')
                        ?.textContent?.trim() || '';

                // Close button
                const hasCloseButton = !!(modal.querySelector(
                    '.k-window-action .k-i-x, .k-dialog-close, [class*="close"], [aria-label*="close" i]'
                ));

                // Fields inside the modal (inputs, dropdowns, textareas)
                const fieldEls = modal.querySelectorAll(
                    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), ' +
                    'textarea, select, kendo-dropdownlist, kendo-combobox, kendo-datepicker'
                );
                const fields: string[] = [];
                fieldEls.forEach(f => {
                    const info = (window as any).getComponentInfo(f);
                    const name = info.businessName;
                    if (name && name !== '-' && !fields.includes(name)) fields.push(name);
                });

                // Action buttons inside the modal (Save, Cancel, Confirm, Delete…)
                const btnEls = modal.querySelectorAll('button, .k-button, [role="button"]');
                const actionButtons: string[] = [];
                btnEls.forEach(btn => {
                    const text = btn.textContent?.trim() || '';
                    const iconId = (window as any).getIconIdentity(btn);
                    const label = text || (iconId ? `${iconId} (icon)` : '');
                    if (label && !actionButtons.includes(label)) actionButtons.push(label);
                });

                return {
                    selector: (window as any).getStableSelector(modal),
                    title,
                    hasCloseButton,
                    fields,
                    actionButtons,
                };
            });
        });
    }

    /**
     * Deep scan: click Add/Create/New buttons, capture modal fields, close modal.
     *
     * Strategy:
     *   1. Find buttons whose visible text contains "add", "create", "new", "add entry", etc.
     *   2. Click each (up to 3 to avoid excessive time).
     *   3. Wait for a Kendo Window / dialog to appear.
     *   4. Run full field capture inside the open modal.
     *   5. Close via Escape → close button → Cancel button (in order).
     *   6. Verify the modal is gone before moving to the next trigger button.
     */
    private static async deepScanModals(page: Page): Promise<ModalInfo[]> {
        // Capture any modals that are already open on the page
        const discoveredModals = await this.discoverModals(page);
        const seenTitles = new Set(discoveredModals.map(m => m.title));

        const MODAL_SELECTOR = '.k-window, [role="dialog"], .k-dialog, kendo-window, kendo-dialog';
        const TRIGGER_KEYWORDS = ['add', 'create', 'new', 'add entry', 'add new'];

        // Collect trigger buttons — limit to first 3 to bound scan time
        const allButtons = await page.locator('button, .k-button, [role="button"]').all();
        const triggers: { locator: typeof allButtons[0]; text: string }[] = [];
        for (const btn of allButtons) {
            if (triggers.length >= 3) break;
            const text = (await btn.textContent().catch(() => '') || '').toLowerCase().trim();
            if (TRIGGER_KEYWORDS.some(kw => text.includes(kw))) {
                triggers.push({ locator: btn, text });
            }
        }

        for (const { locator: btn, text: btnText } of triggers) {
            try {
                const beforeCount = await page.locator(MODAL_SELECTOR).count();
                const beforeUrl = page.url();

                await btn.click({ timeout: 4_000, force: true });
                // Give Angular + Kendo animation time to complete
                await page.waitForTimeout(1_200);

                const afterCount = await page.locator(MODAL_SELECTOR).count();

                if (afterCount > beforeCount) {
                    // New modal appeared — capture it in full
                    const newModals = await page.evaluate((modalSel: string) => {
                        const els = document.querySelectorAll(modalSel);
                        return Array.from(els).slice(0, 5).map(modal => {
                            const title =
                                modal.querySelector('.k-window-title, .k-dialog-title, [role="dialog"] h2, .modal-title')
                                    ?.textContent?.trim() || '';

                            const hasCloseButton = !!(modal.querySelector(
                                '.k-window-action .k-i-x, .k-dialog-close, [aria-label*="close" i], .k-window-action button'
                            ));

                            // Full field capture inside the open modal
                            const fieldEls = modal.querySelectorAll(
                                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), ' +
                                'textarea, select, ' +
                                'kendo-dropdownlist, kendo-combobox, kendo-datepicker, kendo-timepicker, ' +
                                'kendo-numerictextbox, kendo-textbox, kendo-multiselect, kendo-autocomplete'
                            );

                            const fields: string[] = [];
                            const fieldSelectors: Record<string, string> = {};
                            fieldEls.forEach(f => {
                                const info = (window as any).getComponentInfo(f);
                                const name: string = info.businessName;
                                const selector: string = info.selector;
                                if (name && name !== '-' && !fields.includes(name)) {
                                    fields.push(name);
                                    fieldSelectors[name] = selector;
                                }
                            });

                            const btnEls = modal.querySelectorAll('button, .k-button, [role="button"]');
                            const actionButtons: string[] = [];
                            btnEls.forEach(b => {
                                const t = b.textContent?.trim() || '';
                                const iconId = (window as any).getIconIdentity(b);
                                const label = t || (iconId ? `${iconId} (icon)` : '');
                                if (label && !actionButtons.includes(label)) actionButtons.push(label);
                            });

                            return {
                                selector: (window as any).getStableSelector(modal),
                                title,
                                hasCloseButton,
                                fields,
                                actionButtons,
                                // Attach field selectors as extra data for AI prompt context
                                _fieldSelectors: fieldSelectors,
                            };
                        });
                    }, MODAL_SELECTOR);

                    for (const nm of newModals) {
                        if (nm.fields.length > 0 && !seenTitles.has(nm.title)) {
                            seenTitles.add(nm.title);
                            discoveredModals.push(nm as ModalInfo);
                        }
                    }

                    // ── Close the modal ───────────────────────────────────────
                    // 1. Try Escape key first (non-destructive)
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(500);

                    const afterEscapeCount = await page.locator(MODAL_SELECTOR).count();
                    if (afterEscapeCount >= afterCount) {
                        // Escape didn't close it — try the X/close button
                        const closeBtn = page.locator(
                            '.k-window-action button, .k-dialog-close, [aria-label*="close" i]'
                        ).first();
                        await closeBtn.click({ timeout: 3_000, force: true }).catch(async () => {
                            // Last resort: click Cancel inside modal
                            const cancelBtn = page.locator(
                                `${MODAL_SELECTOR} button:has-text("Cancel"), ` +
                                `${MODAL_SELECTOR} button:has-text("Close")`
                            ).first();
                            await cancelBtn.click({ timeout: 3_000, force: true }).catch(() => {});
                        });
                        await page.waitForTimeout(500);
                    }

                    // If URL changed (navigated away), go back
                    if (page.url() !== beforeUrl) {
                        await page.goBack({ waitUntil: 'commit', timeout: 10_000 });
                        await waitForAngularStable(page);
                    }
                }
            } catch (err: any) {
                appLogger.debug(`[PageDiscovery] deepScanModals: button "${btnText}" failed: ${err.message}`);
            }
        }

        return discoveredModals;
    }

    // -------------------------------------------------------------------
    // DISCOVER: Menus (top-nav, side-nav, Kendo menu, toolbar menus)
    // -------------------------------------------------------------------

    private static async discoverMenus(page: Page): Promise<MenuInfo[]> {
        return page.evaluate(() => {
            const containers = document.querySelectorAll(
                '.k-menu, [role="menubar"], [role="navigation"], ' +
                'nav, .k-toolbar:not(.k-grid-toolbar), kendo-menu'
            );

            return Array.from(containers).slice(0, 8).map(menuEl => {
                const itemEls = menuEl.querySelectorAll(
                    '[role="menuitem"], .k-item > .k-link, .k-menu-item > .k-link, ' +
                    'li > a:not(.k-button), .nav-item > a, .nav-link'
                );
                const items: string[] = Array.from(itemEls)
                    .map(i => i.textContent?.trim() || i.getAttribute('aria-label') || '')
                    .filter(Boolean)
                    .filter((v, i, arr) => arr.indexOf(v) === i) // deduplicate
                    .slice(0, 30);

                // Classify type
                const isSide = !!(menuEl.closest('.sidebar, .side-nav, [class*="sidebar"], [class*="sidenav"]'));
                const isTop = !!(menuEl.closest('header, [class*="header"], [class*="topbar"]') || menuEl.tagName === 'NAV');
                const isContext = menuEl.getAttribute('role') === 'menu';
                const type: 'sidenav' | 'topnav' | 'toolbar' | 'contextmenu' =
                    isSide ? 'sidenav' : isContext ? 'contextmenu' : isTop ? 'topnav' : 'toolbar';

                const label =
                    menuEl.getAttribute('aria-label') ||
                    menuEl.getAttribute('id') ||
                    type;

                return {
                    selector: (window as any).getStableSelector(menuEl),
                    label,
                    items,
                    type,
                };
            }).filter(m => m.items.length > 0); // skip empty nav containers
        });
    }

    // -------------------------------------------------------------------
    // DISCOVER: Checkboxes
    // -------------------------------------------------------------------

    private static async discoverCheckboxes(page: Page, section?: string): Promise<ElementInfo[]> {
        return page.evaluate((sect: string | undefined) => {
            const elements = document.querySelectorAll('input[type="checkbox"], .k-checkbox:not(input), [role="checkbox"]');
            return Array.from(elements).slice(0, 50).map(el => {
                const info = (window as any).getComponentInfo(el);
                return {
                    name: info.businessName,
                    selector: info.selector,
                    altSelectors: (window as any).buildAltSelectors(el),
                    type: 'checkbox',
                    attributes: (window as any).extractAttributes(el),
                    section: sect,
                    isVisible: (el as HTMLElement).offsetParent !== null,
                    isEnabled: !(window as any).isElementDisabled(el),
                };
            });
        }, section);
    }

    // -------------------------------------------------------------------
    // DISCOVER: Radio buttons
    // -------------------------------------------------------------------

    private static async discoverRadios(page: Page, section?: string): Promise<ElementInfo[]> {
        return page.evaluate((sect: string | undefined) => {
            const elements = document.querySelectorAll('input[type="radio"], .k-radio:not(input), [role="radio"]');
            return Array.from(elements).slice(0, 50).map(el => {
                const info = (window as any).getComponentInfo(el);
                return {
                    name: info.businessName,
                    selector: info.selector,
                    altSelectors: (window as any).buildAltSelectors(el),
                    type: 'radio',
                    attributes: (window as any).extractAttributes(el),
                    section: sect,
                    isVisible: (el as HTMLElement).offsetParent !== null,
                    isEnabled: !(window as any).isElementDisabled(el),
                };
            });
        }, section);
    }

    // -------------------------------------------------------------------
    // DISCOVER: Other elements
    // -------------------------------------------------------------------

    private static async discoverOther(page: Page, section?: string): Promise<ElementInfo[]> {
        return page.evaluate((sect: string | undefined) => {
            const elements = document.querySelectorAll('a:not(.k-button):not([role="button"]), .k-badge, .k-icon:not(button *)');
            return Array.from(elements).slice(0, 50).map(el => {
                const info = (window as any).getComponentInfo(el);
                return {
                    name: info.businessName,
                    selector: info.selector,
                    altSelectors: (window as any).buildAltSelectors(el),
                    type: info.kendoType || el.tagName.toLowerCase(),
                    attributes: (window as any).extractAttributes(el),
                    section: sect,
                    isVisible: (el as HTMLElement).offsetParent !== null,
                    isEnabled: true,
                };
            });
        }, section);
    }

    // -------------------------------------------------------------------
    // SAVE TO REPOSITORY
    // -------------------------------------------------------------------

    static async saveToRepository(
        inventory: PageInventory,
        options?: { relatedModule?: string; businessLogicHint?: string }
    ): Promise<{ saved: number; updated: number }> {
        const { relatedModule, businessLogicHint } = options || {};
        const allElements: Omit<PageElement, 'id' | 'discoveredAt'>[] = [];
        let saved = 0;

        const addToRepo = (info: ElementInfo, type: string) => {
            allElements.push({
                page: inventory.pageTitle || inventory.url,
                section: info.section,
                elementName: info.name,
                selector: info.selector,
                altSelectors: info.altSelectors,
                type: type as PageElement['type'],
                confidence: 0.85,
                businessLogicHint,
                relatedModule,
                status: 'suggested',
                lastVerifiedAt: new Date().toISOString(),
            });
        };

        for (const btn of inventory.buttons) addToRepo(btn, 'button');
        for (const input of inventory.inputs) addToRepo(input, 'input');
        for (const dropdown of inventory.dropdowns) addToRepo(dropdown, 'select');
        for (const cb of inventory.checkboxes) addToRepo(cb, 'other');
        for (const radio of inventory.radios) addToRepo(radio, 'other');
        for (const other of inventory.other) addToRepo(other, 'other');

        if (allElements.length > 0) {
            try {
                await ElementRepositoryService.addElements(allElements);
                saved = allElements.length;
            } catch (err: any) {
                console.warn(`[PageDiscovery] Failed to save: ${err.message}`);
            }
        }
        return { saved, updated: 0 };
    }

    private static buildSummary(data: {
        buttons: ElementInfo[];
        inputs: ElementInfo[];
        dropdowns: ElementInfo[];
        grids: GridInfo[];
        pagination: PaginationInfo | null;
        tabs: TabInfo[];
        modals: ModalInfo[];
        checkboxes: ElementInfo[];
        radios: ElementInfo[];
        menus: MenuInfo[];
        other: ElementInfo[];
    }): string {
        const parts: string[] = [];
        const add = (label: string, arr: unknown[]) => {
            if (arr.length > 0) parts.push(`${label}: ${arr.length}`);
        };

        add('Buttons', data.buttons);
        add('Inputs', data.inputs);
        add('Dropdowns', data.dropdowns);
        add('Checkboxes', data.checkboxes);
        add('Radios', data.radios);
        add('Grids', data.grids);
        add('Tabs', data.tabs);
        add('Modals', data.modals);
        add('Menus', data.menus || []);
        if (data.pagination) parts.push('Pagination: yes');

        // Surface grid richness
        for (const g of (data.grids || [])) {
            if (g.toolbarButtons && g.toolbarButtons.length) parts.push(`Grid toolbar: [${g.toolbarButtons.join(', ')}]`);
            if (g.actionButtons && g.actionButtons.length) parts.push(`Grid row actions: [${g.actionButtons.join(', ')}]`);
            if (g.filterColumns && g.filterColumns.length) parts.push(`Grid filters: [${g.filterColumns.join(', ')}]`);
        }

        // Surface modal contents
        for (const m of (data.modals || [])) {
            if (m.title) {
                const detail = [
                    (m.fields && m.fields.length) ? `fields: ${m.fields.join(', ')}` : '',
                    (m.actionButtons && m.actionButtons.length) ? `actions: ${m.actionButtons.join(', ')}` : '',
                ].filter(Boolean).join('; ');
                if (detail) parts.push(`Modal "${m.title}": ${detail}`);
            }
        }

        return parts.length > 0 ? parts.join(' | ') : 'No elements discovered';
    }
}

// ============================================================================
// HELPERS
// ============================================================================

function extractPageName(url: string): string {
    try {
        const u = new URL(url);
        if (u.hash && u.hash.length > 1) return u.hash.replace(/^#\//, '').split('/')[0].replace(/[.=]/g, ' ');
        if (u.pathname !== '/') return u.pathname.split('/')[1].replace(/[.=]/g, ' ');
        return 'Home';
    } catch { return url.slice(0, 50); }
}

async function waitForAngularStable(page: Page, timeoutMs: number = 10000): Promise<void> {
    try {
        await page.evaluate(async (timeout: number) => {
            const checkForLoading = () => !document.querySelector('.k-loading-mask, .loading-overlay, .spinner-border');
            if (checkForLoading()) return;
            await new Promise<void>((resolve) => {
                const observer = new MutationObserver(() => { if (checkForLoading()) { observer.disconnect(); resolve(); } });
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(() => { observer.disconnect(); resolve(); }, 5000);
            });
        }, timeoutMs);
    } catch { await page.waitForTimeout(2000); }
}
