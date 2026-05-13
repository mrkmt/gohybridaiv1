/**
 * DiscoveryEnricher.ts
 *
 * S4-2 — Semantic enrichment pass on a captured PageInventory.
 *
 * Raw discovery produces selectors + state tags (S4-1) but the LLM still has
 * to guess field purpose: which fields are required, which buttons submit vs
 * cancel vs open a modal, which control is the search box. That guesswork
 * produces mis-ordered test steps (required field after submit, click on a
 * "cancel" that actually destroys state, etc.).
 *
 * This module runs deterministic heuristics on already-captured `ElementInfo`
 * records and stamps `required`, `role`, and `triggers` tags on each. It is
 * intentionally pure: no DOM access, no Playwright — operates only on the
 * name + type + attributes already collected by PageElementDiscoveryService.
 *
 * Heuristics lean conservative. When we can't tell, the field stays unset so
 * downstream consumers know the tag is "unknown" rather than "confirmed false".
 */

import { ElementInfo, PageInventory } from './PageElementDiscoveryService';

// ---------------------------------------------------------------------------
// Required-field detection
// ---------------------------------------------------------------------------

/** Attribute names that explicitly mark a field as required. */
const REQUIRED_ATTRS: ReadonlyArray<string> = [
    'required',
    'aria-required',
    'data-required',
    'ng-required',
];

/** True if any `REQUIRED_ATTRS` is present with a truthy value. */
function isRequiredByAttr(attrs: Record<string, string>): boolean {
    if (!attrs) return false;
    for (const key of REQUIRED_ATTRS) {
        const val = attrs[key];
        if (val === undefined) continue;
        if (val === '' || val === 'true' || val === 'required') return true;
    }
    return false;
}

/**
 * Crude label heuristic: a name ending in "*" or containing "(required)" is
 * commonly used to mark required fields in Kendo/Material forms.
 */
function isRequiredByName(name: string): boolean {
    if (!name) return false;
    const trimmed = name.trim();
    return /\*\s*$/.test(trimmed) || /\(required\)/i.test(trimmed);
}

// ---------------------------------------------------------------------------
// Role detection
// ---------------------------------------------------------------------------

const SUBMIT_NAMES = /\b(save|submit|confirm|ok|apply|create|add(\s+new)?|register|continue|send|post)\b/i;
const CANCEL_NAMES = /\b(cancel|close|dismiss|back|abort|discard)\b/i;
const DESTRUCTIVE_NAMES = /\b(delete|remove|clear|reset|destroy|revoke)\b/i;
const NAV_NAMES = /\b(next|previous|prev|home|menu|navigate|goto|open\s+\w+\s+page)\b/i;
const SEARCH_NAMES = /\b(search|find|filter|lookup|query)\b/i;

function inferRole(el: ElementInfo): ElementInfo['role'] {
    const name = el.name || '';
    const type = (el.type || '').toLowerCase();
    const selector = (el.selector || '').toLowerCase();
    const attrType = (el.attributes?.type || '').toLowerCase();

    // Inputs / textareas are always data-entry unless they look like search.
    if (type.includes('input') || type === 'textarea' || type.includes('textbox')) {
        if (SEARCH_NAMES.test(name) || selector.includes('search')) return 'search';
        return 'input';
    }

    // Buttons: classify by name.
    if (type.includes('button') || attrType === 'submit' || attrType === 'button') {
        if (attrType === 'submit') return 'submit';
        if (DESTRUCTIVE_NAMES.test(name)) return 'destructive';
        if (CANCEL_NAMES.test(name)) return 'cancel';
        if (SUBMIT_NAMES.test(name)) return 'submit';
        if (NAV_NAMES.test(name)) return 'nav';
        return 'control';
    }

    // Dropdowns / selects / checkboxes / radios are choice controls.
    if (
        type.includes('dropdown') ||
        type === 'select' ||
        type.includes('combobox') ||
        type.includes('checkbox') ||
        type.includes('radio')
    ) {
        return 'control';
    }

    return 'other';
}

// ---------------------------------------------------------------------------
// Trigger detection
// ---------------------------------------------------------------------------

const MODAL_TRIGGER_NAMES = /\b(add(\s+new)?|create|new|edit|open|view|import|export|upload)\b/i;
const DROPDOWN_TRIGGER_HINTS = /k-dropdown-button|k-combobox|k-dropdownlist|dropdown-toggle/i;

function inferTriggers(el: ElementInfo, role: ElementInfo['role']): ElementInfo['triggers'] {
    const name = el.name || '';
    const type = (el.type || '').toLowerCase();
    const selector = (el.selector || '').toLowerCase();

    // Submit buttons trigger form submission.
    if (role === 'submit') return 'submit';

    // Dropdown-like controls trigger a dropdown when clicked.
    if (
        type.includes('dropdown') ||
        type.includes('combobox') ||
        DROPDOWN_TRIGGER_HINTS.test(selector)
    ) {
        return 'dropdown';
    }

    // Buttons whose name matches modal-trigger keywords are strong candidates.
    if ((type.includes('button') || role === 'control' || role === 'nav') && MODAL_TRIGGER_NAMES.test(name)) {
        // Destructive actions are a sub-case of modal-open (confirm dialogs).
        return 'modal';
    }

    if (role === 'nav') return 'navigation';

    return 'none';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enrich a single element with `required`, `role`, and `triggers` tags.
 * Non-destructive: returns a new object; preserves existing values if already set.
 */
export function enrichElement(el: ElementInfo): ElementInfo {
    const required =
        el.required !== undefined
            ? el.required
            : isRequiredByAttr(el.attributes || {}) || isRequiredByName(el.name);

    const role = el.role ?? inferRole(el);
    const triggers = el.triggers ?? inferTriggers(el, role);

    return { ...el, required, role, triggers };
}

/**
 * Enrich every element in a `PageInventory` in-place (on a shallow-cloned copy).
 * Returns the same inventory shape so it can drop straight into the cache.
 */
export function enrichInventory(inventory: PageInventory): PageInventory {
    const mapArray = (arr: ElementInfo[] | undefined) => {
        if (!arr || !Array.isArray(arr)) return [];
        return arr.map(enrichElement);
    };

    return {
        ...inventory,
        buttons: mapArray(inventory.buttons),
        inputs: mapArray(inventory.inputs),
        dropdowns: mapArray(inventory.dropdowns),
        checkboxes: mapArray(inventory.checkboxes),
        radios: mapArray(inventory.radios),
        other: mapArray(inventory.other),
        tabs: Array.isArray(inventory.tabs) ? inventory.tabs.map(tab => ({
            ...tab,
            deepElements: tab.deepElements ? mapArray(tab.deepElements) : undefined,
        })) : [],
    };
}
