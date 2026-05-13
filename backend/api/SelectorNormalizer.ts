/**
 * Stage 2: Selector Normalizer
 * Converts dynamic/unstable selectors into stable ones.
 * Pure code logic — NO AI calls.
 *
 * Handles:
 * - Server-side generated IDs (ctl00_ContentPlaceHolder1_xxx)
 * - Angular runtime IDs (ng-xxx, _ngcontent-xxx)
 * - Kendo runtime IDs (k-grid-12345)
 * - Dynamic row indices (ctl03, ctl07)
 */

export interface NormalizedSelector {
    original: string;
    stable: string;
    confidence: number;  // 0-1 how confident this normalization is
    method: string;      // which rule was used
}

// Patterns to strip from selectors (dynamic parts)
const DYNAMIC_PATTERNS: Array<{ regex: RegExp; replacement: string; method: string }> = [
    // ASP.NET server control prefixes: ctl00_ContentPlaceHolder1_xxx → just xxx
    { regex: /^#?ctl\d+_ContentPlaceHolder\d*_/i, replacement: '', method: 'strip-aspnet-prefix' },
    // Dynamic row indices: _ctl03_, _ctl07_ → _ROW_
    { regex: /_ctl\d+_/g, replacement: '_ROW_', method: 'normalize-row-index' },
    // Angular ng attributes: _ngcontent-xxx-c123
    { regex: /_ngcontent-[a-z0-9]+-c\d+/gi, replacement: '', method: 'strip-ng-content' },
    // Angular ng-reflect: ng-reflect-xxx
    { regex: /ng-reflect-[a-z-]+/gi, replacement: '', method: 'strip-ng-reflect' },
    // Kendo unique IDs: k-grid-12345
    { regex: /(k-\w+)-\d+/g, replacement: '$1', method: 'strip-kendo-uid' },
    // Random UUID-like suffixes: _a1b2c3d4
    { regex: /_[a-f0-9]{8,}$/i, replacement: '', method: 'strip-uuid-suffix' },
    // Numeric suffixes on IDs: element123 → element
    { regex: /(\w+?)\d{3,}$/g, replacement: '$1', method: 'strip-numeric-suffix' }
];

// Selector priority: prefer these patterns (higher = better)
const STABLE_SELECTOR_PRIORITY: Array<{ pattern: RegExp; score: number; label: string }> = [
    { pattern: /\[data-role=['"]\w+['"]\]/, score: 0.95, label: 'data-role' },
    { pattern: /\[aria-label=['"].*?['"]\]/, score: 0.90, label: 'aria-label' },
    { pattern: /\[data-testid=['"].*?['"]\]/, score: 0.95, label: 'data-testid' },
    { pattern: /\[name=['"].*?['"]\]/, score: 0.85, label: 'name-attr' },
    { pattern: /\[placeholder=['"].*?['"]\]/, score: 0.80, label: 'placeholder' },
    { pattern: /\[type=['"].*?['"]\]/, score: 0.70, label: 'type-attr' },
    { pattern: /\.[\w-]+(?!.*\d{4})/, score: 0.75, label: 'css-class' },
    { pattern: /#[\w-]+$/, score: 0.60, label: 'id' }, // IDs are less stable in Angular/Kendo
];

export class SelectorNormalizer {

    /**
     * Main entry: normalizes all selectors in a step array.
     */
    static normalizeAll(steps: any[]): any[] {
        return steps.map(step => {
            if (!step.selector) return step;

            const normalized = this.normalize(step.selector);
            return {
                ...step,
                selector: normalized.stable,
                originalSelector: step.selector,
                selectorConfidence: normalized.confidence,
                selectorMethod: normalized.method
            };
        });
    }

    /**
     * Normalize a single selector: strip dynamic parts, score stability.
     */
    static normalize(selector: string): NormalizedSelector {
        let stable = selector;
        let method = 'none';
        let confidence = 0.5;

        // Step 1: Check if already a stable selector
        for (const rule of STABLE_SELECTOR_PRIORITY) {
            if (rule.pattern.test(selector)) {
                return { original: selector, stable: selector, confidence: rule.score, method: rule.label };
            }
        }

        // Step 2: Apply dynamic pattern stripping
        for (const { regex, replacement, method: m } of DYNAMIC_PATTERNS) {
            if (regex.test(stable)) {
                stable = stable.replace(regex, replacement);
                method = m;
            }
        }

        // Step 3: If we stripped something, clean up the result
        if (stable !== selector) {
            // Remove leading/trailing underscores or hashes from cleanup
            stable = stable.replace(/^[#_]+/, '#').replace(/_+$/, '');
            confidence = 0.70;
        }

        // Step 4: Score the result
        for (const rule of STABLE_SELECTOR_PRIORITY) {
            if (rule.pattern.test(stable)) {
                confidence = Math.max(confidence, rule.score);
                break;
            }
        }

        return { original: selector, stable, confidence, method };
    }

    /**
     * Extract unique stable selectors from a list of steps (for form matching).
     */
    static extractUniqueSelectors(steps: any[]): string[] {
        const selectors = new Set<string>();
        for (const step of steps) {
            if (step.selector) {
                selectors.add(step.selector);
            }
        }
        return Array.from(selectors);
    }
}
