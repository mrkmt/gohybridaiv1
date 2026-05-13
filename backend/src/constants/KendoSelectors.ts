/**
 * KendoSelectors.ts
 *
 * Single source of truth for Kendo UI selectors.
 * These selectors are frozen — both ElementServiceQuery.ts and McpTestExecutor.ts import from here.
 * Gemini NEVER edits this file directly.
 *
 * FORBIDDEN patterns (will break Kendo UI tests):
 *   - .p-button-success  → PrimeNG selector, wrong framework
 *   - .k-i-plus        → icon sprite class, NOT a clickable element
 *   - .k-i-check       → icon sprite class, NOT a clickable element
 *   - .k-i-trash       → icon sprite class, NOT a clickable element
 *   - span.k-i-*       → same reason, icon not a button
 */

export const KENDO_ADD: string[] = [
    '.k-grid-add',                        // functional class — works on span/a/button
    'a.k-grid-add',
    'span.k-grid-add',
    '.k-button-add',
    'button[title*="Add" i]:not([disabled])',
    'button[aria-label*="Add" i]:not([disabled])',
    'button:has-text("Add New")',
    'button:has-text("Add")',
];

export const KENDO_SAVE: string[] = [
    '.k-grid-save',
    'button.btn.btn-success',
    'button[title*="Save" i]:not([disabled])',
    'button[aria-label*="Save" i]:not([disabled])',
    'button:has-text("Save")',
    '[type="submit"]',
];

export const KENDO_DELETE: string[] = [
    '.k-grid-delete',
    'button[title*="Delete" i]:not([disabled])',
    'button[aria-label*="Delete" i]:not([disabled])',
    'button:has-text("Delete")',
];

export const KENDO_EDIT: string[] = [
    '.k-grid-edit',
    'button[title*="Edit" i]:not([disabled])',
    'button[aria-label*="Edit" i]:not([disabled])',
    'button:has-text("Edit")',
];

/** Helper: check if a selector string contains forbidden patterns */
export function containsForbiddenPatterns(selector: string): boolean {
    const forbidden = ['.p-button-success', '.k-i-plus', '.k-i-check', '.k-i-trash', 'span.k-i-'];
    return forbidden.some(p => selector.includes(p));
}
