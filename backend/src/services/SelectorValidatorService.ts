/**
 * SelectorValidatorService
 *
 * Generates robust, multi-strategy selector chains for UI elements.
 * No hardcoding — strategies are configurable and reusable across
 * test generation, pre-flight validation, and self-healing.
 *
 * Priority order per strategy type:
 *   1. title attribute      → most reliable for icon-only buttons
 *   2. aria-label           → accessibility-compliant
 *   3. Functional classes    → .k-grid-add, .k-button-add, etc. (NOT icon classes like .k-i-plus)
 *   4. data-testid          → if the app uses it
 *   5. Common class patterns → .btn-add, .action-btn, etc.
 *   6. Position-based       → toolbar context + nth-of-type
 */

export interface SelectorCandidate {
    /** The Playwright selector string */
    selector: string;
    /** Strategy used to derive this selector */
    strategy: 'title' | 'aria-label' | 'icon-class' | 'data-testid' | 'class-pattern' | 'position' | 'text';
    /** Confidence score (0-1) — higher = more reliable */
    confidence: number;
    /** Human-readable description of why this selector was chosen */
    rationale?: string;
}

/**
 * Configuration for button intent resolution.
 * Consumers can register custom functional class mappings.
 */
export interface ButtonIntentConfig {
    /** Keywords that map to this intent (case-insensitive) */
    keywords: string[];
    /**
     * DEPRECATED: Kendo icon class suffixes — DO NOT USE for selector generation.
     * Icon classes like .k-i-plus are NOT clickable elements.
     * Use functionalClasses instead.
     */
    kendoIcons?: string[];
    /**
     * Functional classes that identify this intent (e.g., .k-grid-add for "Add").
     * These are the CORRECT selectors to use, NOT icon classes.
     */
    functionalClasses?: string[];
}

/**
 * Registry of known button intent patterns.
 * Extensible — consumers can add custom mappings via registerIntent().
 */
const INTENT_REGISTRY: ButtonIntentConfig[] = [
    {
        keywords: ['add', 'add new', 'new', 'create', 'insert'],
        functionalClasses: ['.k-grid-add', '.k-button-add', 'button:has-text("Add")'],
    },
    {
        keywords: ['save', 'submit', 'confirm', 'ok', 'apply'],
        functionalClasses: ['.k-grid-save', 'button:has-text("Save")', '[type="submit"]'],
    },
    {
        keywords: ['cancel', 'close', 'dismiss', 'exit'],
        functionalClasses: ['.k-grid-cancel', 'button:has-text("Cancel")'],
    },
    {
        keywords: ['edit', 'modify', 'update', 'change', 'pencil'],
        functionalClasses: ['.k-grid-edit', 'button:has-text("Edit")'],
    },
    {
        keywords: ['delete', 'remove', 'trash', 'discard'],
        functionalClasses: ['.k-grid-delete', 'button:has-text("Delete")'],
    },
    {
        keywords: ['search', 'find', 'filter', 'lookup'],
        functionalClasses: ['input[placeholder*="Search" i]', 'button:has-text("Search")'],
    },
    // ... (keep remaining entries but remove kendoIcons)
    {
        keywords: ['refresh', 'reload', 'sync', 'reset'],
        functionalClasses: ['button:has-text("Refresh")'],
    },
    {
        keywords: ['export', 'download', 'save as'],
        functionalClasses: ['.k-grid-excel', 'button:has-text("Export")'],
    },
    {
        keywords: ['import', 'upload', 'load'],
        functionalClasses: ['button:has-text("Import")'],
    },
    {
        keywords: ['print'],
        functionalClasses: ['button:has-text("Print")'],
    },
    {
        keywords: ['settings', 'config', 'configure', 'gear'],
        functionalClasses: ['button:has-text("Settings")'],
    },
    {
        keywords: ['more', 'actions', 'options', 'menu', 'ellipsis'],
        functionalClasses: ['button:has-text("More")'],
    },
    {
        keywords: ['view', 'see', 'eye', 'preview'],
        functionalClasses: ['button:has-text("View")'],
    },
    {
        keywords: ['next'],
        functionalClasses: ['button:has-text("Next")'],
    },
    {
        keywords: ['previous', 'prev', 'back'],
        functionalClasses: ['button:has-text("Previous")'],
    },
];

export class SelectorValidatorService {
    /**
     * Additional intent mappings registered at runtime.
     */
    private static customIntents: ButtonIntentConfig[] = [];

    /**
     * Register a custom button intent mapping at runtime.
     * Useful for app-specific icon patterns.
     *
     * @example
     * SelectorValidatorService.registerIntent({
     *   keywords: ['approve'],
     *   kendoIcons: ['check-circle', 'approved'],
     * });
     */
    static registerIntent(config: ButtonIntentConfig): void {
        this.customIntents.push(config);
    }

    /**
     * Resolve all possible selector strategies for a button intent.
     * Returns candidates sorted by confidence (highest first).
     *
     * @param buttonIntent - Human-readable intent (e.g., "Add New", "Save")
     * @param options - Optional configuration
     * @returns Selector candidates sorted by confidence
     *
     * @example
     * const candidates = SelectorValidatorService.resolveButtonSelector('Add New');
     * // Returns:
     * // [
     * //   { selector: 'button[title="Add New"]', strategy: 'title', confidence: 0.95 },
     * //   { selector: 'button[title*="Add New" i]', strategy: 'title', confidence: 0.90 },
     * //   { selector: 'button:has-text("Add")', strategy: 'text', confidence: 0.35 },
     * //   ...
     * // ]
     */
    static resolveButtonSelector(
        buttonIntent: string,
        options?: {
            /** Include text-based fallback (default: true) */
            includeTextFallback?: boolean;
            /** Maximum number of candidates to return (default: unlimited) */
            maxCandidates?: number;
            /** Override Kendo icon suffixes (bypasses registry lookup) */
            overrideIcons?: string[];
        }
    ): SelectorCandidate[] {
        const includeTextFallback = options?.includeTextFallback ?? true;
        const maxCandidates = options?.maxCandidates;
        const overrideIcons = options?.overrideIcons;

        const candidates: SelectorCandidate[] = [];
        const intent = buttonIntent.trim();
        const intentLower = intent.toLowerCase();

        // Determine functional classes from registry or override
        const functionalClasses = overrideIcons ?? this.resolveFunctionalClasses(intentLower);

        // --- Strategy 1: Exact title attribute ---
        candidates.push({
            selector: `button[title="${intent}"], [title="${intent}"]`,
            strategy: 'title',
            confidence: 0.95,
            rationale: `Exact title attribute "${intent}" — most reliable for icon-only buttons`,
        });

        // --- Strategy 2: Partial title attribute (case-insensitive) ---
        // Extract key words (skip generic words like "new", "the", "a")
        const skipWords = new Set(['the', 'a', 'an', 'new', 'entry', 'record']);
        const keyWords = intent.split(/\s+/).filter(w => !skipWords.has(w.toLowerCase()));
        if (keyWords.length > 0) {
            const partialPattern = keyWords.join('|');
            candidates.push({
                selector: `button[title*="${partialPattern}" i], [title*="${partialPattern}" i]`,
                strategy: 'title',
                confidence: 0.90,
                rationale: `Partial title match for any of: ${keyWords.join(', ')}`,
            });
        }

        // --- Strategy 3: aria-label ---
        candidates.push({
            selector: `button[aria-label="${intent}"], [aria-label="${intent}"]`,
            strategy: 'aria-label',
            confidence: 0.85,
            rationale: `aria-label attribute match — accessibility-compliant`,
        });

        // --- Strategy 4: Functional classes (CORRECT for Kendo UI) ---
        if (functionalClasses.length > 0) {
            candidates.push({
                selector: functionalClasses.join(', '),
                strategy: 'class-pattern',
                confidence: 0.80,
                rationale: `Functional classes: ${functionalClasses.join(', ')}`,
            });
        }

        // --- Strategy 5: data-testid ---
        const testidValue = this.toKebabCase(intent);
        candidates.push({
            selector: `button[data-testid="${testidValue}"], [data-testid="${testidValue}"]`,
            strategy: 'data-testid',
            confidence: 0.75,
            rationale: `data-testid attribute: "${testidValue}"`,
        });

        // --- Strategy 6: Common class patterns ---
        const classPatterns = this.generateClassPatterns(intentLower);
        if (classPatterns.length > 0) {
            candidates.push({
                selector: classPatterns.join(', '),
                strategy: 'class-pattern',
                confidence: 0.60,
                rationale: `Common class patterns for "${intentLower}"`,
            });
        }

        // --- Strategy 7: Position-based (toolbar context) ---
        candidates.push({
            selector: '.k-toolbar button.k-button:first-of-type, .action-bar button:first-of-type, .toolbar button:first-of-type',
            strategy: 'position',
            confidence: 0.40,
            rationale: 'First button in toolbar — last resort',
        });

        // --- Strategy 8: Text-based fallback (if enabled) ---
        if (includeTextFallback) {
            candidates.push({
                selector: `button:has-text("${intent}"), a:has-text("${intent}"), [role="button"]:has-text("${intent}")`,
                strategy: 'text',
                confidence: 0.35,
                rationale: `Text content match — least reliable for icon-only buttons`,
            });
        }

        // Sort by confidence (highest first) and apply max limit
        candidates.sort((a, b) => b.confidence - a.confidence);

        return maxCandidates ? candidates.slice(0, maxCandidates) : candidates;
    }

    /**
     * Generate a robust selector chain for a button that tries all strategies
     * in a single Playwright locator chain.
     *
     * This is the format used in generated test code — one locator that
     * tries multiple strategies until one matches.
     *
     * @param buttonIntent - Human-readable intent
     * @returns Combined selector string (comma-separated, Playwright-compatible)
     *
     * @example
     * const selector = SelectorValidatorService.buildButtonSelectorChain('Add New');
     * // Returns:
     * // 'button[title="Add New"], [title="Add New"], button[title*="Add" i], ...'
     */
    static buildButtonSelectorChain(buttonIntent: string): string {
        const candidates = this.resolveButtonSelector(buttonIntent, {
            includeTextFallback: true,
            maxCandidates: 5, // Top 5 strategies
        });

        return candidates.map(c => c.selector).join(', ');
    }

    /**
     * Resolve functional classes from the intent registry.
     * Checks both built-in and custom intents.
     *
     * @param intentLower - Lowercase button intent
     * @returns Array of functional classes (e.g., ['.k-grid-add', 'button:has-text("Add")'])
     */
    private static resolveFunctionalClasses(intentLower: string): string[] {
        const allIntents = [...INTENT_REGISTRY, ...this.customIntents];
        
        for (const config of allIntents) {
            for (const keyword of config.keywords) {
                if (intentLower.includes(keyword) || keyword.includes(intentLower)) {
                    return config.functionalClasses ? [...config.functionalClasses] : [];
                }
            }
        }
        
        return [];
    }

    /**
     * Generate common class patterns for a button intent.
     *
     * @param intentLower - Lowercase button intent
     * @returns Array of CSS class selectors
     */
    private static generateClassPatterns(intentLower: string): string[] {
        const patterns: string[] = [];

        // Extract meaningful words (skip generic)
        const skipWords = new Set(['the', 'a', 'an', 'new', 'entry', 'record']);
        const words = intentLower.split(/\s+/).filter(w => !skipWords.has(w));

        for (const word of words) {
            // Common class naming patterns
            patterns.push(`.btn-${word}`);
            patterns.push(`.button-${word}`);
            patterns.push(`.${word}-btn`);
            patterns.push(`.${word}-button`);
            patterns.push(`.k-button-${word}`);
            patterns.push(`.action-${word}`);
            patterns.push(`.toolbar-${word}`);
            patterns.push(`[class*="${word}"]`);
        }

        return [...new Set(patterns)]; // Deduplicate
    }

    /**
     * Convert a string to kebab-case for data-testid compatibility.
     *
     * @param str - Input string
     * @returns Kebab-case string
     */
    private static toKebabCase(str: string): string {
        return str
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .replace(/[\s_]+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .toLowerCase();
    }

    /**
     * Generate a selector chain for form fields.
     * Similar to resolveButtonSelector but for inputs, textareas, selects.
     *
     * @param fieldName - Human-readable field name (e.g., "Short Code", "Name")
     * @param fieldType - Expected input type (default: 'text')
     * @returns Selector candidates sorted by confidence
     */
    static resolveFieldSelector(
        fieldName: string,
        fieldType: 'text' | 'email' | 'password' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' = 'text'
    ): SelectorCandidate[] {
        const candidates: SelectorCandidate[] = [];
        const name = fieldName.trim();
        const nameLower = name.toLowerCase();
        const nameKebab = this.toKebabCase(name);
        const nameCamel = nameLower.replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase());

        // --- Strategy 1: name attribute ---
        candidates.push({
            selector: `input[name="${nameLower}"], textarea[name="${nameLower}"], select[name="${nameLower}"]`,
            strategy: 'title',
            confidence: 0.95,
            rationale: `name attribute match`,
        });

        // --- Strategy 2: formControlName (Angular) ---
        candidates.push({
            selector: `input[formcontrolname="${nameCamel}"], input[formControlName="${nameCamel}"], textarea[formcontrolname="${nameCamel}"], select[formcontrolname="${nameCamel}"]`,
            strategy: 'title',
            confidence: 0.90,
            rationale: `Angular formControlName attribute`,
        });

        // --- Strategy 3: ng-reflect-name (Angular debug) ---
        candidates.push({
            selector: `[ng-reflect-name="${nameLower}"]`,
            strategy: 'title',
            confidence: 0.85,
            rationale: `Angular ng-reflect-name attribute`,
        });

        // --- Strategy 4: id attribute ---
        candidates.push({
            selector: `#${nameKebab}, #${nameCamel}, #${nameLower.replace(/\s+/g, '')}`,
            strategy: 'title',
            confidence: 0.80,
            rationale: `ID attribute match`,
        });

        // --- Strategy 5: placeholder text ---
        candidates.push({
            selector: `input[placeholder*="${name}" i], textarea[placeholder*="${name}" i]`,
            strategy: 'text',
            confidence: 0.70,
            rationale: `Placeholder text partial match`,
        });

        // --- Strategy 6: Label association ---
        candidates.push({
            selector: `label:has-text("${name}") ~ input, label:has-text("${name}") ~ textarea, label:has-text("${name}") ~ select`,
            strategy: 'text',
            confidence: 0.65,
            rationale: `Associated via sibling label element`,
        });

        // --- Strategy 7: aria-label ---
        candidates.push({
            selector: `[aria-label="${name}"], [aria-label*="${name}" i]`,
            strategy: 'aria-label',
            confidence: 0.60,
            rationale: `aria-label attribute match`,
        });

        // --- Strategy 8: data-testid ---
        candidates.push({
            selector: `[data-testid="${nameKebab}"], [data-testid="${nameCamel}"]`,
            strategy: 'data-testid',
            confidence: 0.55,
            rationale: `data-testid attribute`,
        });

        return candidates.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Generate a single combined selector chain for a field.
     *
     * @param fieldName - Human-readable field name
     * @param fieldType - Expected input type
     * @returns Comma-separated Playwright-compatible selector
     */
    static buildFieldSelectorChain(fieldName: string, fieldType?: 'text' | 'email' | 'password' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date'): string {
        const candidates = this.resolveFieldSelector(fieldName, fieldType);
        const topCandidates = candidates.slice(0, 5);
        return topCandidates.map(c => c.selector).join(', ');
    }

    /**
     * Determine if a selector string is likely a text-based selector
     * that would fail on icon-only elements.
     *
     * @param selector - Playwright selector string
     * @returns true if this selector relies on text content
     */
    static isTextBasedSelector(selector: string): boolean {
        return selector.includes('has-text') ||
               selector.includes('getByText') ||
               selector.includes(':text') ||
               (selector.includes(':has(') && selector.includes('text='));
    }

    /**
     * Determine if a selector string targets a button element.
     *
     * @param selector - Playwright selector string
     * @returns true if this selector targets a button
     */
    static isButtonSelector(selector: string): boolean {
        return selector.includes('button') ||
               selector.includes('[role="button"]') ||
               selector.includes('.btn') ||
               selector.includes('.k-button');
    }

    /**
     * Determine if a text-based button selector needs icon-aware fallbacks.
     *
     * @param selector - Playwright selector string
     * @returns true if this selector will fail on icon-only buttons
     */
    static needsIconFallback(selector: string): boolean {
        return this.isButtonSelector(selector) && this.isTextBasedSelector(selector);
    }
}
