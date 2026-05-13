/**
 * Stage 1: Event Deduplicator
 * Removes duplicate/noisy DOM events from harvester recordings.
 * Pure code logic — NO AI calls.
 *
 * Patterns cleaned:
 * - focus→input→input→blur → single fill()
 * - click→click→click (same element) → single click
 * - mouseover/mouseenter/mouseleave → removed
 * - scroll events → removed
 * - Kendo dropdown open→select→close → single select()
 */

export interface RawStep {
    type: string;
    selector?: string;
    value?: string;
    url?: string;
    timestamp?: number;
    [key: string]: any;
}

export interface CleanStep extends RawStep {
    action: string;        // normalized action name
    deduplicated: boolean; // was this merged from multiple events?
    originalCount?: number;
}

// Events that are pure noise and should always be removed
const NOISE_EVENTS = new Set([
    'mouseover', 'mouseenter', 'mouseleave', 'mouseout', 'mousemove',
    'pointerover', 'pointerenter', 'pointerleave', 'pointerout', 'pointermove',
    'scroll', 'wheel', 'resize', 'touchmove',
    'animationstart', 'animationend', 'transitionend',
    'beforeunload', 'unload'
]);

// Events that form a "fill" sequence
const FILL_SEQUENCE = new Set(['focus', 'focusin', 'input', 'keydown', 'keyup', 'keypress', 'blur', 'focusout', 'change']);

export class EventDeduplicator {

    /**
     * Main entry: takes raw harvester steps, returns cleaned steps.
     */
    static deduplicate(steps: RawStep[]): CleanStep[] {
        if (!steps || !Array.isArray(steps) || steps.length === 0) return [];

        // Step 1: Remove noise events
        let filtered = steps.filter(s => !NOISE_EVENTS.has(s.type));

        // Step 2: Merge fill sequences (focus→input→input→blur on same element)
        filtered = this.mergeFillSequences(filtered);

        // Step 3: Deduplicate consecutive clicks on same element
        filtered = this.deduplicateClicks(filtered);

        // Step 4: Merge Kendo dropdown sequences
        filtered = this.mergeKendoDropdown(filtered);

        // Step 5: Advanced Normalization (Inference & Final Pass)
        filtered = this.advancedNormalization(filtered);

        console.log(`[EventDeduplicator] ${steps.length} raw → ${filtered.length} clean (removed ${steps.length - filtered.length})`);

        return filtered as CleanStep[];
    }

    /**
     * Advanced normalization logic:
     * 1. Infer initial 'goto' if missing.
     * 2. Remove adjacent duplicates (same action, selector, and value).
     */
    private static advancedNormalization(steps: any[]): any[] {
        if (steps.length === 0) return [];

        // 1. Infer start URL if first step isn't a navigation
        const firstType = String(steps[0].type || steps[0].action || '').toLowerCase();
        if (!['goto', 'navigate'].includes(firstType)) {
            // Try to find a URL in early steps
            for (let i = 0; i < Math.min(steps.length, 5); i++) {
                const urlCandidate = steps[i].url || (typeof steps[i].value === 'string' && steps[i].value.startsWith('http') ? steps[i].value : null);
                if (urlCandidate) {
                    steps.unshift({
                        type: 'goto',
                        action: 'goto',
                        selector: urlCandidate,
                        value: null,
                        deduplicated: true,
                        timestamp: steps[0].timestamp - 1000
                    });
                    break;
                }
            }
        }

        // 2. Final pass: remove adjacent exact duplicates
        const deduped: any[] = [];
        for (const s of steps) {
            if (deduped.length > 0) {
                const prev = deduped[deduped.length - 1];
                if (prev.action === s.action && 
                    prev.selector === s.selector && 
                    prev.value === s.value &&
                    s.action !== 'click' // Keep sequential clicks if they weren't merged earlier
                ) {
                    continue;
                }
            }
            deduped.push(s);
        }

        return deduped;
    }

    /**
     * Merge focus→input→input→blur sequences into a single fill action.
     */
    private static mergeFillSequences(steps: RawStep[]): any[] {
        const result: any[] = [];
        let i = 0;

        while (i < steps.length) {
            // Check if this starts a fill sequence (focus on an input element)
            if (FILL_SEQUENCE.has(steps[i].type) && steps[i].selector) {
                const targetSelector = steps[i].selector;
                let lastValue = steps[i].value || '';
                let seqCount = 1;
                let j = i + 1;

                // Consume all consecutive fill events on the same element
                while (j < steps.length &&
                    FILL_SEQUENCE.has(steps[j].type) &&
                    steps[j].selector === targetSelector) {
                    if (steps[j].value) lastValue = steps[j].value ?? lastValue;
                    seqCount++;
                    j++;
                }

                if (seqCount > 1) {
                    // Merge into single fill action
                    result.push({
                        type: 'fill',
                        action: 'fill',
                        selector: targetSelector,
                        value: lastValue,
                        deduplicated: true,
                        originalCount: seqCount,
                        timestamp: steps[i].timestamp
                    });
                    i = j;
                    continue;
                }
            }

            result.push({ ...steps[i], action: steps[i].type, deduplicated: false });
            i++;
        }

        return result;
    }

    /**
     * Remove consecutive clicks on the exact same element (user double/triple clicking).
     */
    private static deduplicateClicks(steps: any[]): any[] {
        const result: any[] = [];

        for (let i = 0; i < steps.length; i++) {
            if (steps[i].type === 'click' || steps[i].action === 'click') {
                let clickCount = 1;
                let j = i + 1;

                while (j < steps.length &&
                    (steps[j].type === 'click' || steps[j].action === 'click') &&
                    steps[j].selector === steps[i].selector) {
                    clickCount++;
                    j++;
                }

                result.push({
                    ...steps[i],
                    action: clickCount > 2 ? 'tripleClick' : clickCount > 1 ? 'dblclick' : 'click',
                    deduplicated: clickCount > 1,
                    originalCount: clickCount > 1 ? clickCount : undefined
                });
                i = j - 1;
            } else {
                result.push(steps[i]);
            }
        }

        return result;
    }

    /**
     * Merge Kendo UI dropdown open→scroll→select→close into single select action.
     */
    private static mergeKendoDropdown(steps: any[]): any[] {
        const result: any[] = [];

        for (let i = 0; i < steps.length; i++) {
            // Detect Kendo dropdown open (click on .k-dropdown or [data-role=dropdownlist])
            if (steps[i].action === 'click' &&
                steps[i].selector &&
                (steps[i].selector.includes('k-dropdown') ||
                    steps[i].selector.includes('k-select') ||
                    steps[i].selector.includes('data-role'))) {

                // Look ahead for the list item selection
                let selectedValue = '';
                let j = i + 1;
                while (j < steps.length && j < i + 5) {
                    if (steps[j].action === 'click' &&
                        steps[j].selector &&
                        (steps[j].selector.includes('k-list') ||
                            steps[j].selector.includes('k-item'))) {
                        selectedValue = steps[j].value || steps[j].text || '';
                        j++;
                        break;
                    }
                    j++;
                }

                if (selectedValue) {
                    result.push({
                        type: 'select',
                        action: 'select',
                        selector: steps[i].selector,
                        value: selectedValue,
                        deduplicated: true,
                        originalCount: j - i,
                        timestamp: steps[i].timestamp
                    });
                    i = j - 1;
                    continue;
                }
            }

            result.push(steps[i]);
        }

        return result;
    }
}
