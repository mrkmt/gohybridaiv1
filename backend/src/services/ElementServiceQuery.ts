/**
 * ElementServiceQuery
 *
 * Queries the ObjectRepositoryService for stable, verified selectors.
 * Falls back to intelligent pattern-based heuristics when the repository
 * has no matching element.
 *
 * Resolution priority chain:
 *   1. Enhanced ObjectRepositoryService (verified selectors)
 *   2. Discovery cache (live-discovered from page scans)
 *   3. VectorSelectorMemory (semantic similarity from past test runs) — D4
 *   4. Markdown selector reference
 *   5. globalhr-selectors.json
 *   6. Module knowledge JSON files
 *   7. Fallback heuristics (Playwright smart locators)
 */

import { ObjectRepositoryService } from './ObjectRepositoryService';
import * as fs from 'fs';
import * as path from 'path';
import { appLogger } from '../utils/logger';
import { KENDO_ADD, KENDO_SAVE, KENDO_DELETE, KENDO_EDIT, containsForbiddenPatterns } from '../constants/KendoSelectors';

const SELECTOR_FILE = path.join(process.cwd(), 'playwright', 'selectors', 'globalhr-selectors.json');
const SELECTOR_MD = path.join(__dirname, '..', '..', 'skills', 'ELEMENT_SELECTORS_REFERENCE.md');

// Parsed markdown selector cache (read once per process)
let mdSelectorCache: Record<string, any> | null = null;
let mdSelectorsLoaded = false;

/**
 * Try to get a verified selector for a business field name.
 * Queries: (1) Enhanced ObjectRepositoryService, (2) DiscoveryCacheService,
 * (3) markdown reference, (4) globalhr-selectors.json, (5) fallback heuristics.
 */
export async function resolveFieldSelector(fieldName: string, module?: string): Promise<string | null> {
    const fieldLower = fieldName.toLowerCase().replace(/\s+/g, ' ').trim();
    const fieldKey = fieldName.toLowerCase().replace(/\s+/g, '-');

    // Priority 1: Enhanced ObjectRepositoryService (returns { primary, fallbacks })
    const repoResult = await ObjectRepositoryService.resolveSelector(fieldName, module);
    if (repoResult) {
        // Combine primary + fallbacks into a single Playwright locator chain
        const combined = [repoResult.primary, ...repoResult.fallbacks].join(', ');
        appLogger.info(`[ElementQuery] Found in ObjectRepositoryService: ${fieldName}`);
        return combined;
    }

    // Priority 2: Check discovery cache
    const { DiscoveryCacheService } = await import('./discovery/DiscoveryCacheService');
    const discovered = DiscoveryCacheService.lookupSelector(fieldName);
    if (discovered) {
        appLogger.info(`[ElementQuery] Found in DiscoveryCacheService: ${fieldName}`);
        return discovered.selector;
    }

    // Priority 3: VectorSelectorMemory (D4) — semantic similarity from past runs
    // When no exact match exists, find the closest known selector by name/action/module
    try {
        const { VectorSelectorMemory } = await import('./VectorSelectorMemory');
        const semanticMatch = VectorSelectorMemory.findBestMatch({
            element: fieldLower,
            action: 'fill',
            module: module || '',
        }, 0.5); // Min score 0.5 for reasonable match
        if (semanticMatch) {
            appLogger.info(
                `[ElementQuery] Found via VectorSelectorMemory (score=${semanticMatch.score.toFixed(2)}): ${fieldName} → ${semanticMatch.selector}`
            );
            return semanticMatch.selector;
        }
    } catch (vecErr: any) {
        appLogger.debug(`[ElementQuery] VectorSelectorMemory check failed: ${vecErr.message}`);
        // Continue to next priority — not critical
    }

    // Priority 4: Query markdown selector reference
    const mdMatch = findInMarkdownReference(fieldName);
    if (mdMatch) {
        appLogger.info(`[ElementQuery] Found in markdown reference: ${fieldName}`);
        return mdMatch;
    }

    // Priority 4: Query globalhr-selectors.json
    const localMatch = resolveFromSelectorsFile(fieldLower, fieldKey);
    if (localMatch) {
        appLogger.info(`[ElementQuery] Found in selectors file: ${fieldName}`);
        return localMatch;
    }

    // Priority 4b: Try module knowledge JSON files for field selectors
    const moduleMatch = resolveFromModuleKnowledge(fieldName, module);
    if (moduleMatch) {
        appLogger.info(`[ElementQuery] Found in module knowledge: ${fieldName}`);
        return moduleMatch;
    }

    // Priority 5: Fallback heuristic — use Playwright smart locators
    const fallback = generateFallbackSelector(fieldName);
    appLogger.info(`[ElementQuery] Using fallback heuristic: ${fieldName}`);
    return fallback;
}

/**
 * Parse ELEMENT_SELECTORS_REFERENCE.md into a structured selector map.
 * Reads the markdown file once, caches the result.
 * Returns a flat map: elementName → selector
 */
export function parseElementSelectorsMarkdown(): Record<string, string> {
    if (mdSelectorsLoaded) return mdSelectorCache || {};

    mdSelectorsLoaded = true;

    if (!fs.existsSync(SELECTOR_MD)) {
        appLogger.warn(`[ElementQuery] Markdown selector reference not found: ${SELECTOR_MD}`);
        return {};
    }

    try {
        const content = fs.readFileSync(SELECTOR_MD, 'utf-8');
        const result: Record<string, string> = {};

        // Match table rows with business names and selectors
        // Pattern: | Element Name | `selector` | ...
        const tableRowRegex = /^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/gm;

        let match;
        while ((match = tableRowRegex.exec(content)) !== null) {
            const name = match[1].trim();
            const selector = match[2].trim();

            // Skip non-element rows (headers, empty names, etc.)
            if (name && name !== '---' && !name.startsWith('#') && selector && selector.length > 0) {
                result[name] = selector;
            }
        }

        // Also extract selectors from code blocks (Common Patterns section)
        const codeBlockRegex = /```(?:typescript)?\s*\n(.*?)```/gs;
        const codeBlockMatch = /page\.locator\(['"`]([^'"`]+)['"`](?:,\s*\{[^}]*\})?\)/g;

        let codeMatch;
        while ((codeMatch = codeBlockRegex.exec(content)) !== null) {
            const code = codeMatch[1];
            let locMatch;
            while ((locMatch = codeBlockMatch.exec(code)) !== null) {
                // Extract the selector and use it as a fallback
                const selector = locMatch[1];
                // Look for a preceding comment or nearby text for the element name
                const contextBefore = code.substring(Math.max(0, locMatch.index - 200), locMatch.index);
                const nameMatch = contextBefore.match(/\/\/\s*(.+?)\s*$/m);
                if (nameMatch) {
                    const elemName = nameMatch[1].trim();
                    if (elemName && !elemName.startsWith('page.') && !elemName.includes('(')) {
                        result[elemName] = selector;
                    }
                }
            }
        }

        mdSelectorCache = result;
        appLogger.info(`[ElementQuery] Parsed ${Object.keys(result).length} selectors from markdown reference`);
        return result;
    } catch (err: any) {
        appLogger.warn(`[ElementQuery] Failed to parse markdown selector reference: ${err.message}`);
        return {};
    }
}

/**
 * Query the markdown selector reference for a specific element.
 * Uses fuzzy matching similar to DiscoveryCacheService.
 */
export function findInMarkdownReference(elementName: string): string | null {
    const parsed = parseElementSelectorsMarkdown();
    if (Object.keys(parsed).length === 0) return null;

    const normalizedTarget = elementName.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

    for (const [name, selector] of Object.entries(parsed)) {
        const normalizedName = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

        // Exact match
        if (normalizedName === normalizedTarget) return selector;

        // Partial match
        if (normalizedName.includes(normalizedTarget) || normalizedTarget.includes(normalizedName)) {
            return selector;
        }

        // Space-insensitive match (e.g., "ShortCode" vs "Short Code")
        const noSpacesTarget = normalizedTarget.replace(/\s+/g, '');
        const noSpacesName = normalizedName.replace(/\s+/g, '');
        if (noSpacesName === noSpacesTarget || noSpacesName.includes(noSpacesTarget) || noSpacesTarget.includes(noSpacesName)) {
            return selector;
        }
    }

    return null;
}

/**
 * Try to get a verified selector for a business element name (buttons, etc.)
 * Now queries enhanced ObjectRepositoryService as first priority.
 */
export async function resolveElementSelector(elementName: string, module?: string): Promise<string | null> {
    const elementLower = elementName.toLowerCase().trim();

    // Priority 1: Enhanced ObjectRepositoryService
    const repoResult = await ObjectRepositoryService.resolveSelector(elementName, module);
    if (repoResult) {
        const combined = [repoResult.primary, ...repoResult.fallbacks].join(', ');
        appLogger.info(`[ElementQuery] Found in ObjectRepositoryService: ${elementName}`);
        return combined;
    }

    // Priority 2: Check discovery cache
    const { DiscoveryCacheService } = await import('./discovery/DiscoveryCacheService');
    const discovered = DiscoveryCacheService.lookupSelector(elementName);
    if (discovered) {
        appLogger.info(`[ElementQuery] Found in DiscoveryCacheService: ${elementName}`);
        return discovered.selector;
    }

    // Priority 3: VectorSelectorMemory (D4) — semantic similarity from past runs
    try {
        const { VectorSelectorMemory } = await import('./VectorSelectorMemory');
        const semanticMatch = VectorSelectorMemory.findBestMatch({
            element: elementLower,
            action: 'click',
            module: module || '',
        }, 0.5);
        if (semanticMatch) {
            appLogger.info(
                `[ElementQuery] Found via VectorSelectorMemory (score=${semanticMatch.score.toFixed(2)}): ${elementName} → ${semanticMatch.selector}`
            );
            return semanticMatch.selector;
        }
    } catch (vecErr: any) {
        appLogger.debug(`[ElementQuery] VectorSelectorMemory check failed: ${vecErr.message}`);
    }

    // Priority 4: Query markdown selector reference
    const mdMatch = findInMarkdownReference(elementName);
    if (mdMatch) {
        appLogger.info(`[ElementQuery] Found in markdown reference: ${elementName}`);
        return mdMatch;
    }

    // Priority 4: Query globalhr-selectors.json
    const elementKey = elementName.toLowerCase().replace(/\s+/g, '-');
    const fileMatch = resolveFromSelectorsFile(elementLower, elementKey);
    if (fileMatch) {
        appLogger.info(`[ElementQuery] Found in selectors file: ${elementName}`);
        return fileMatch;
    }

    // Priority 4b: Try module knowledge JSON files for button/element selectors
    const moduleMatch = resolveElementFromModuleKnowledge(elementName, module);
    if (moduleMatch) {
        appLogger.info(`[ElementQuery] Found in module knowledge: ${elementName}`);
        return moduleMatch;
    }

    // Priority 5: Fallback heuristic — use Playwright smart locators
    const fallback = generateElementFallbackSelector(elementName);
    appLogger.info(`[ElementQuery] Using fallback heuristic: ${elementName}`);
    return fallback;
}

// ─── Module Knowledge Fallback ───────────────────────────────────

/**
 * Try to resolve a field selector from module knowledge JSON files.
 * Looks in skills/GlobalHR/forms/{module}.json for field definitions.
 */
function resolveFromModuleKnowledge(fieldName: string, module?: string): string | null {
    if (!module) return null;

    const skillsDir = path.join(process.cwd(), 'backend', 'skills', 'GlobalHR', 'forms');
    if (!fs.existsSync(skillsDir)) return null;

    const moduleFile = path.join(skillsDir, `${module}.json`);
    if (!fs.existsSync(moduleFile)) return null;

    try {
        const knowledge = JSON.parse(fs.readFileSync(moduleFile, 'utf8'));
        const fieldLower = fieldName.toLowerCase();

        // Search fields by name
        const fields = knowledge.fields || [];
        for (const f of fields) {
            const nameLower = (f.name || '').toLowerCase();
            if (nameLower === fieldLower || nameLower.includes(fieldLower) || fieldLower.includes(nameLower)) {
                // Generate a Playwright smart locator from the field name
                const cleanName = f.name;
                return `getByLabel('${cleanName}'), label:has-text("${cleanName}"):below input, input[name*="${f.id || f.name}"]`;
            }
        }

        // Check form actions for button-like fields
        const actions = knowledge.actions || {};
        for (const [actionName, actionDef] of Object.entries(actions)) {
            const def = actionDef as Record<string, string>;
            const trigger = (def.trigger || actionName).toLowerCase();
            if (trigger.includes(fieldLower) || fieldLower.includes(trigger)) {
                return `getByRole('button', { name: '${def.submitButton || def.cancelButton || actionName}' }), button:has-text("${def.submitButton || def.cancelButton || actionName}")`;
            }
        }
    } catch { /* file unreadable */ }

    return null;
}

/**
 * Try to resolve an element (button/icon) selector from module knowledge JSON files.
 */
function resolveElementFromModuleKnowledge(elementName: string, module?: string): string | null {
    if (!module) return null;

    const skillsDir = path.join(process.cwd(), 'backend', 'skills', 'GlobalHR', 'forms');
    if (!fs.existsSync(skillsDir)) return null;

    const elementLower = elementName.toLowerCase();

    // Scan all module knowledge files
    const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.json'));
    const targetModule = module ? files.find(f => f.replace('.json', '') === module) : null;
    const searchFiles = targetModule ? [targetModule] : files;

    for (const file of searchFiles) {
        try {
            const knowledge = JSON.parse(fs.readFileSync(path.join(skillsDir, file), 'utf8'));
            const actions = knowledge.actions || {};

            for (const [actionName, actionDef] of Object.entries(actions)) {
                const def = actionDef as Record<string, string>;
                const submitBtn = def.submitButton || '';
                const cancelBtn = def.cancelButton || '';
                const trigger = def.trigger || '';

                if (
                    submitBtn.toLowerCase().includes(elementLower) ||
                    elementLower.includes(submitBtn.toLowerCase()) ||
                    cancelBtn.toLowerCase().includes(elementLower) ||
                    elementLower.includes(cancelBtn.toLowerCase()) ||
                    trigger.toLowerCase().includes(elementLower)
                ) {
                    const btnText = submitBtn || cancelBtn || actionName;
                    return `getByRole('button', { name: '${btnText}' }), button[title*="${btnText}"], button:has-text("${btnText}")`;
                }
            }
        } catch { /* unreadable */ }
    }

    return null;
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Search globalhr-selectors.json by traversing its nested structure
 */
function resolveFromSelectorsFile(fieldLower: string, fieldKey: string): string | null {
    try {
        if (!fs.existsSync(SELECTOR_FILE)) return null;

        const selectors = JSON.parse(fs.readFileSync(SELECTOR_FILE, 'utf8'));
        const modules = selectors.modules || selectors;

        for (const [moduleName, moduleData] of Object.entries(modules as Record<string, any>)) {
            const fields = (moduleData as any).fields || {};
            for (const [fieldName, selectorOrObj] of Object.entries(fields)) {
                const matchKey = fieldName.toLowerCase();
                if (matchKey === fieldLower || matchKey === fieldKey || matchKey.includes(fieldLower) || fieldLower.includes(matchKey)) {
                    if (typeof selectorOrObj === 'string') return selectorOrObj;
                    if (selectorOrObj && typeof selectorOrObj === 'object' && 'selector' in selectorOrObj && selectorOrObj.selector) {
                        return String(selectorOrObj.selector);
                    }
                }
            }
        }
    } catch {
        // File unreadable
    }

    return null;
}

/**
 * Intelligent fallback: generate a plausible selector when no verified source exists
 */
export function generateFallbackSelector(fieldName: string): string {
    const fieldLower = fieldName.toLowerCase().replace(/\s+/g, '-');
    const fieldClean = fieldName.toLowerCase().replace(/\s+/g, ' ');

    return `label:has-text("${fieldClean}"):below + input, [data-testid="${fieldLower}"], [name="${fieldLower}"], #${fieldLower}`;
}

/**
 * Intelligent fallback for element (button, link, etc.)
 * Uses KENDO_* constants from single source of truth.
 *
 * P0: Returns null for unknown elements (e.g., "Title", "Category", "Attachment")
 * so the caller can report them as unresolved instead of silently using weak selectors.
 */
export function generateElementFallbackSelector(elementName: string): string | null {
    const elementLower = elementName.toLowerCase();

    // Use centralized Kendo selectors (single source of truth)
    if (elementLower.includes('add') || elementLower.includes('create') || elementLower.includes('new') || elementLower.includes('plus')) {
        return KENDO_ADD.join(', ');
    }

    // P0 DEPARTMENT SPECIFIC MAPPINGS
    if (elementLower.includes('department name') || (elementLower.includes('name') && elementLower.includes('dept'))) {
        return 'input[formcontrolname="name"], input[formcontrolname="departmentName"], [aria-label*="Name" i]';
    }
    if (elementLower.includes('short code') || elementLower.includes('code')) {
        return 'input[formcontrolname="shortCode"], input[formcontrolname="code"], [aria-label*="Code" i]';
    }

    if (elementLower.includes('save') || elementLower.includes('submit')) {
        return KENDO_SAVE.join(', ');
    }

    if (elementLower.includes('delete') || elementLower.includes('remove')) {
        return KENDO_DELETE.join(', ');
    }

    if (elementLower.includes('edit') || elementLower.includes('modify')) {
        return KENDO_EDIT.join(', ');
    }

    // P0: Unknown element — return null so TestSpecTargetResolver reports it as unresolved
    // instead of generating weak generic selectors like button:has-text("title")
    return null;
}
