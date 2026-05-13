/**
 * StepValidator - Validate test step quality
 * 
 * Ensures test steps follow best practices:
 * - One action per step
 * - Clear action verbs
 * - Verifiable expected results
 * - No compound steps
 */

import { appLogger } from './logger';

export interface StepValidationResult {
    isValid: boolean;
    warnings: string[];
    errors: string[];
    suggestions: string[];
}

export class StepValidator {
    /**
     * Validate a single test step
     */
    static validateStep(action: string, expectedResult?: string): StepValidationResult {
        const result: StepValidationResult = {
            isValid: true,
            warnings: [],
            errors: [],
            suggestions: []
        };

        // Check for compound steps (CRITICAL)
        if (this.containsCompoundAction(action)) {
            result.errors.push(
                `Compound action detected: "${action}". Split into separate steps (e.g., "Navigate to X" and "Click Y" should be two steps)`
            );
            result.isValid = false;
        }

        // Check for action verb
        if (!this.hasValidActionVerb(action)) {
            result.errors.push(
                `No valid action verb found. Use: Navigate, Click, Fill, Select, Verify, Open, Go to`
            );
            result.isValid = false;
        }

        // Check for vague terms
        const vagueTerms = this.detectVagueTerms(action);
        if (vagueTerms.length > 0) {
            result.warnings.push(
                `Vague terms detected: ${vagueTerms.join(', ')}. Be more specific.`
            );
        }

        // Check expected result
        if (!expectedResult || expectedResult.trim().length === 0) {
            result.warnings.push(
                `Expected result is empty. Every step should have a verifiable outcome.`
            );
        } else if (this.isExpectedResultNotVerifiable(expectedResult)) {
            result.warnings.push(
                `Expected result may not be verifiable: "${expectedResult}". Use observable outcomes.`
            );
        }

        // Check for "and" (common compound indicator)
        if (action.toLowerCase().includes(' and ')) {
            result.suggestions.push(
                `Step contains "and" - consider splitting into multiple steps`
            );
        }

        // Check step length
        if (action.length > 150) {
            result.suggestions.push(
                `Step is very long (${action.length} chars). Consider breaking it into smaller steps.`
            );
        }

        // Check for proper selectors hint
        if (action.includes('button') || action.includes('field') || action.includes('dropdown')) {
            result.suggestions.push(
                `Consider adding selectorHint for better reliability`
            );
        }

        return result;
    }

    /**
     * Check if action contains compound actions
     */
    private static containsCompoundAction(action: string): boolean {
        const lower = action.toLowerCase();
        
        // Check for common compound patterns
        const compoundPatterns = [
            /\band\b/i,  // "Navigate and click"
            /\bthen\b/i,  // "Navigate then click"
            /,\s*and\s*/i,  // "Navigate, and click"
            /navigate.*click/i,  // "Navigate to X and click Y"
            /open.*fill/i,  // "Open form and fill"
            /click.*verify/i,  // "Click and verify"
            /fill.*select/i,  // "Fill field and select"
        ];

        for (const pattern of compoundPatterns) {
            if (pattern.test(lower)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if action has a valid action verb
     */
    private static hasValidActionVerb(action: string): boolean {
        const validVerbs = [
            'navigate', 'go to', 'open', 'visit',  // Navigation
            'click', 'press', 'tap', 'select',  // Click actions
            'fill', 'enter', 'type', 'input', 'set',  // Fill actions
            'verify', 'check', 'assert', 'expect', 'see',  // Verification
            'wait', 'pause', 'sleep',  // Wait actions
            'drag', 'drop', 'hover',  // Mouse actions
            'upload', 'attach',  // File actions
            'download', 'export',  // File operations
        ];

        const lower = action.toLowerCase();
        return validVerbs.some(verb => lower.includes(verb));
    }

    /**
     * Detect vague terms in action
     */
    private static detectVagueTerms(action: string): string[] {
        const vagueTerms: string[] = [];
        const vaguePatterns = [
            { pattern: /\bdo\b/i, term: 'do' },
            { pattern: /\bhandle\b/i, term: 'handle' },
            { pattern: /\bthing\b/i, term: 'thing' },
            { pattern: /\bstuff\b/i, term: 'stuff' },
            { pattern: /\bit\b/i, term: 'it (unclear reference)' },
            { pattern: /\bproperly\b/i, term: 'properly (vague modifier)' },
            { pattern: /\bcorrectly\b/i, term: 'correctly (vague modifier)' },
        ];

        for (const { pattern, term } of vaguePatterns) {
            if (pattern.test(action)) {
                vagueTerms.push(term);
            }
        }

        return vagueTerms;
    }

    /**
     * Check if expected result is verifiable
     */
    private static isExpectedResultNotVerifiable(expectedResult: string): boolean {
        const lower = expectedResult.toLowerCase();
        
        const nonVerifiable = [
            'it works',
            'should work',
            'everything is good',
            'success',
            'done',
            'completed',
        ];

        return nonVerifiable.some(term => lower.includes(term));
    }

    /**
     * Validate entire test case (all steps)
     */
    static validateTestCase(steps: Array<{ action: string; expectedResult?: string }>): StepValidationResult {
        const overallResult: StepValidationResult = {
            isValid: true,
            warnings: [],
            errors: [],
            suggestions: []
        };

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const stepResult = this.validateStep(step.action, step.expectedResult);

            if (!stepResult.isValid) {
                overallResult.isValid = false;
            }

            // Add step number to messages
            overallResult.errors.push(
                ...stepResult.errors.map(msg => `Step ${i + 1}: ${msg}`)
            );
            overallResult.warnings.push(
                ...stepResult.warnings.map(msg => `Step ${i + 1}: ${msg}`)
            );
            overallResult.suggestions.push(
                ...stepResult.suggestions.map(msg => `Step ${i + 1}: ${msg}`)
            );
        }

        // Check for duplicate actions
        const actions = steps.map(s => s.action.toLowerCase());
        const duplicates = actions.filter(
            (action, index) => actions.indexOf(action) !== index
        );
        if (duplicates.length > 0) {
            overallResult.suggestions.push(
                `Duplicate actions detected: ${[...new Set(duplicates)].join(', ')}. Is this intentional?`
            );
        }

        // Check step count
        if (steps.length === 0) {
            overallResult.errors.push('Test case has no steps!');
            overallResult.isValid = false;
        } else if (steps.length > 20) {
            overallResult.suggestions.push(
                `Test case has ${steps.length} steps. Consider breaking into smaller test cases.`
            );
        }

        return overallResult;
    }

    /**
     * Print validation results to console
     */
    static printValidation(result: StepValidationResult, stepNumber?: number): void {
        const prefix = stepNumber ? `Step ${stepNumber}` : 'Test Case';

        if (result.isValid && result.warnings.length === 0) {
            appLogger.info(`${prefix}: Valid`);
            return;
        }

        if (!result.isValid) {
            appLogger.error(`${prefix}: Invalid`);
            result.errors.forEach(err => appLogger.error(`   ERROR: ${err}`));
        }

        if (result.warnings.length > 0) {
            appLogger.warn(`${prefix}: Warnings`);
            result.warnings.forEach(warn => appLogger.warn(`   WARNING: ${warn}`));
        }

        if (result.suggestions.length > 0) {
            appLogger.info(`${prefix}: Suggestions`);
            result.suggestions.forEach(sug => appLogger.info(`   SUGGESTION: ${sug}`));
        }
    }
}
