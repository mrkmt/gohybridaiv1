/**
 * Test Case Builder
 *
 * Builds structured test cases from scenarios with:
 * - Step-by-step actions with selectors and input data
 * - Auto-generated assertions (visible, contains, equals, count, url, api_response)
 * - Parameterization (data-driven testing with multiple data sets)
 * - Priority and severity classification
 * - Link to parent scenario and Jira ticket
 *
 * @author GoHybrid AI Team
 * @date April 3, 2026
 */

// ============================================================================
// TYPES
// ============================================================================

export type AssertionOperator = 'equals' | 'contains' | 'not_contains' | 'visible' | 'hidden' | 'count' | 'greater_than' | 'less_than' | 'url_matches' | 'api_status' | 'api_contains';

export interface TestCaseAssertion {
    operator: AssertionOperator;
    selector?: string;
    value?: string | number;
    message?: string;  // Custom failure message
}

export interface TestCaseStep {
    stepNumber: number;
    action: string;
    selector?: string;
    inputData?: Record<string, string>;
    waitFor?: {
        selector: string;
        state: 'visible' | 'hidden' | 'attached' | 'detached';
        timeout?: number;
    };
    assertion?: TestCaseAssertion;
    screenshot?: boolean;  // Take screenshot after this step
    annotation?: string;
}

export type TestCasePriority = 'P0-critical' | 'P1-high' | 'P2-medium' | 'P3-low';
export type TestCaseType = 'functional' | 'negative' | 'regression' | 'smoke' | 'performance';
export type TestCaseStatus = 'draft' | 'review' | 'approved' | 'automated' | 'blocked' | 'deprecated';

export interface TestCase {
    id: string;                 // TC-001, TC-002, etc.
    scenarioId: string;         // Parent scenario ID (SC-001)
    ticketId: string;           // Jira ticket
    title: string;
    description: string;
    type: TestCaseType;
    priority: TestCasePriority;
    status: TestCaseStatus;
    module: string;
    preconditions: string[];
    testData?: Record<string, string>;  // Default test data
    parameters?: string[];      // Parameter names for data-driven testing
    dataSets?: Record<string, Record<string, string>>[]; // Multiple data sets
    steps: TestCaseStep[];
    expectedOutcome: string;
    tags: string[];
    estimatedDuration: number;
    createdAt: string;
    updatedAt: string;
}

export interface TestResult {
    testCaseId: string;
    scenarioId: string;
    title: string;
    status: 'PASS' | 'FAIL' | 'SKIP' | 'BLOCKED';
    duration: number;
    error?: string;
    screenshotPath?: string;
    videoPath?: string;
    tracePath?: string;
    /** Jira user story or requirement this test traces back to */
    linkedRequirement?: string;
    stepResults: {
        stepNumber: number;
        action: string;
        status: 'PASS' | 'FAIL' | 'SKIP';
        duration: number;
        error?: string;
        screenshotPath?: string;
    }[];
}

// ============================================================================
// ASSERTION GENERATOR — Auto-generates assertions from step descriptions
// ============================================================================

export class AssertionGenerator {

    /**
     * Auto-generate assertion from step action text
     */
    static generateFromAction(action: string, selector?: string): TestCaseAssertion | null {
        const text = action.toLowerCase();

        // Visibility assertions
        if (text.includes('should be visible') || text.includes('appears') || text.includes('displays')) {
            return { operator: 'visible', selector, message: `Expected element to be visible: ${selector}` };
        }
        if (text.includes('should not be visible') || text.includes('disappears') || text.includes('hidden')) {
            return { operator: 'hidden', selector, message: `Expected element to be hidden: ${selector}` };
        }

        // Text content assertions
        const containsMatch = text.match(/should contain["']?([^"']+)["']?/i);
        if (containsMatch) {
            return { operator: 'contains', selector, value: containsMatch[1], message: `Expected text to contain: ${containsMatch[1]}` };
        }

        const equalsMatch = text.match(/should (?:be|equal)["']?([^"']+)["']?/i);
        if (equalsMatch) {
            return { operator: 'equals', selector, value: equalsMatch[1], message: `Expected text to equal: ${equalsMatch[1]}` };
        }

        // Count assertions
        const countMatch = text.match(/(\d+)\s+(?:rows?|items?|records?)/i);
        if (countMatch) {
            return { operator: 'count', selector, value: parseInt(countMatch[1]), message: `Expected ${countMatch[1]} items` };
        }

        // URL assertions
        if (text.includes('url should') || text.includes('redirect')) {
            const urlMatch = text.match(/url.*?["']?([^"'\s]+)["']?/i);
            return { operator: 'url_matches', selector, value: urlMatch?.[1], message: `Expected URL to match: ${urlMatch?.[1]}` };
        }

        // API assertions
        if (text.includes('api returns') || text.includes('response')) {
            const statusMatch = text.match(/status\s*(\d{3})/i);
            return { operator: 'api_status', value: statusMatch ? parseInt(statusMatch[1]) : 200, message: `Expected API status: ${statusMatch?.[1] || 200}` };
        }

        // Success/error messages
        if (text.includes('success') || text.includes('saved')) {
            return { operator: 'contains', selector: '.alert-success, .toast-success, text="Success"', value: 'Success', message: 'Expected success message' };
        }
        if (text.includes('error') || text.includes('failed') || text.includes('validation')) {
            return { operator: 'contains', selector: '.alert-danger, .text-danger, .ng-invalid', value: '', message: 'Expected error/validation message' };
        }

        return null;
    }

    /**
     * Generate assertions for common CRUD operations
     */
    static generateForCrud(operation: 'create' | 'read' | 'update' | 'delete'): TestCaseAssertion[] {
        switch (operation) {
            case 'create':
                return [
                    { operator: 'contains', selector: '.alert-success, .toast-success', value: 'Success', message: 'Expected success message after create' },
                    { operator: 'visible', selector: 'kendo-grid, .k-grid', message: 'Expected grid to be visible after create' }
                ];
            case 'read':
                return [
                    { operator: 'visible', selector: 'kendo-grid, .k-grid', message: 'Expected grid to be visible' },
                    { operator: 'count', selector: 'kendo-grid tbody tr', message: 'Expected grid rows to exist' }
                ];
            case 'update':
                return [
                    { operator: 'contains', selector: '.alert-success, .toast-success', value: 'Success', message: 'Expected success message after update' }
                ];
            case 'delete':
                return [
                    { operator: 'contains', selector: '.alert-success, .toast-success', value: 'Success', message: 'Expected success message after delete' },
                    { operator: 'hidden', selector: 'tr:has-text("deleted-record")', message: 'Expected deleted record to be hidden' }
                ];
        }
    }
}

// ============================================================================
// TEST CASE BUILDER — Fluent API
// ============================================================================

export class TestCaseBuilder {
    private testCase: Partial<TestCase>;
    private steps: TestCaseStep[] = [];
    private preconditions: string[] = [];
    private tags: string[] = [];
    private dataSets: Record<string, Record<string, string>>[] = [];

    constructor(id: string, scenarioId: string, ticketId: string) {
        this.testCase = {
            id,
            scenarioId,
            ticketId,
            status: 'draft',
            priority: 'P2-medium',
            type: 'functional',
            tags: [],
            estimatedDuration: 30000,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    title(title: string): this {
        this.testCase.title = title;
        return this;
    }

    description(desc: string): this {
        this.testCase.description = desc;
        return this;
    }

    module(module: string): this {
        this.testCase.module = module;
        return this;
    }

    type(type: TestCaseType): this {
        this.testCase.type = type;
        return this;
    }

    priority(priority: TestCasePriority): this {
        this.testCase.priority = priority;
        return this;
    }

    testData(data: Record<string, string>): this {
        this.testCase.testData = data;
        return this;
    }

    parameters(...params: string[]): this {
        this.testCase.parameters = params;
        return this;
    }

    /**
     * Add a data set for parameterized testing
     */
    addDataSet(name: string, data: Record<string, string>): this {
        this.dataSets.push({ [name]: data });
        return this;
    }

    precondition(precondition: string): this {
        this.preconditions.push(precondition);
        return this;
    }

    addTags(...newTags: string[]): this {
        this.tags.push(...newTags);
        return this;
    }

    /**
     * Add a step with optional auto-generated assertion
     */
    step(stepNumber: number, action: string, options?: {
        selector?: string;
        inputData?: Record<string, string>;
        waitFor?: TestCaseStep['waitFor'];
        assertion?: TestCaseAssertion;
        autoAssert?: boolean;  // Auto-generate assertion from action text
        screenshot?: boolean;
        annotation?: string;
    }): this {
        const step: TestCaseStep = {
            stepNumber,
            action
        };

        if (options?.selector) step.selector = options.selector;
        if (options?.inputData) step.inputData = options.inputData;
        if (options?.waitFor) step.waitFor = options.waitFor;
        if (options?.screenshot) step.screenshot = options.screenshot;
        if (options?.annotation) step.annotation = options.annotation;

        // Auto-generate assertion
        if (options?.autoAssert) {
            step.assertion = AssertionGenerator.generateFromAction(action, options.selector) || undefined;
        }

        // Override with explicit assertion
        if (options?.assertion) step.assertion = options.assertion;

        this.steps.push(step);
        return this;
    }

    /**
     * Add CRUD assertion block
     */
    crudAssertions(operation: 'create' | 'read' | 'update' | 'delete'): this {
        const assertions = AssertionGenerator.generateForCrud(operation);
        // Add assertions as steps at the end
        for (const assertion of assertions) {
            this.steps.push({
                stepNumber: this.steps.length + 1,
                action: `Verify: ${assertion.operator} ${assertion.value || ''}`,
                selector: assertion.selector,
                assertion
            });
        }
        return this;
    }

    expectedOutcome(outcome: string): this {
        this.testCase.expectedOutcome = outcome;
        return this;
    }

    estimatedDuration(ms: number): this {
        this.testCase.estimatedDuration = ms;
        return this;
    }

    build(): TestCase {
        return {
            id: this.testCase.id!,
            scenarioId: this.testCase.scenarioId!,
            ticketId: this.testCase.ticketId!,
            title: this.testCase.title || 'Untitled Test Case',
            description: this.testCase.description || '',
            type: this.testCase.type!,
            priority: this.testCase.priority!,
            status: this.testCase.status!,
            module: this.testCase.module || 'Unknown',
            preconditions: this.preconditions,
            testData: this.testCase.testData,
            parameters: this.testCase.parameters,
            dataSets: this.dataSets.length > 0 ? this.dataSets : undefined,
            steps: this.steps.sort((a, b) => a.stepNumber - b.stepNumber),
            expectedOutcome: this.testCase.expectedOutcome || '',
            tags: [...new Set([...(this.testCase.tags || []), ...this.tags])],
            estimatedDuration: this.testCase.estimatedDuration || 30000,
            createdAt: this.testCase.createdAt!,
            updatedAt: new Date().toISOString()
        };
    }
}

// ============================================================================
// TEST CASE VALIDATOR
// ============================================================================

export class TestCaseValidator {
    static validate(tc: TestCase): { valid: boolean; errors: string[]; warnings: string[] } {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!tc.title?.trim()) errors.push('Missing title');
        if (!tc.module?.trim()) errors.push('Missing module');
        if (tc.steps.length === 0) errors.push('No steps defined');
        if (!tc.expectedOutcome?.trim()) errors.push('Missing expected outcome');

        for (let i = 0; i < tc.steps.length; i++) {
            const step = tc.steps[i];
            if (!step.action?.trim()) errors.push(`Step ${step.stepNumber}: missing action`);
            if (step.stepNumber !== i + 1) warnings.push(`Step ${step.stepNumber}: numbering gap`);
        }

        if (tc.dataSets?.length && !tc.parameters?.length) {
            warnings.push('Data sets defined but no parameters declared');
        }

        return { valid: errors.length === 0, errors, warnings };
    }
}

// ============================================================================
// ISTQB TEST DESIGN UTILITIES
// ============================================================================

/**
 * ISTQB-compliant test data generation using Boundary Value Analysis
 * For a given number range [min, max], generates: min, min+1, mid, max-1, max, max+1
 */
export function generateBoundaryValues(
    min: number,
    max: number,
    validRange?: { min: number; max: number }
): number[] {
    const values = new Set<number>();

    if (validRange) {
        // Valid boundaries
        values.add(validRange.min);
        values.add(validRange.min + 1);
        values.add(Math.floor((validRange.min + validRange.max) / 2));
        values.add(validRange.max - 1);
        values.add(validRange.max);
        // Invalid boundaries (just outside)
        values.add(validRange.min - 1);
        values.add(validRange.max + 1);
    }

    // Fallback to full range if no validRange specified
    if (!validRange) {
        values.add(min);
        values.add(min + 1);
        values.add(Math.floor((min + max) / 2));
        values.add(max - 1);
        values.add(max);
    }

    return [...values].sort((a, b) => a - b);
}

/**
 * ISTQB Equivalence Partitioning: generate representative values
 * Returns one value from each partition (valid, below minimum, above maximum)
 */
export function generateEquivalenceValues(
    min: number,
    max: number
): { valid: number; belowMin: number; aboveMax: number } {
    return {
        valid: Math.floor((min + max) / 2),
        belowMin: min - 1,
        aboveMax: max + 1
    };
}

/**
 * ISTQB State Transition: generate test steps for a state machine workflow
 * Validates transitions: valid transitions pass, invalid transitions fail
 */
export function generateStateTransitionSteps(
    initialState: string,
    transitions: Array<{ from: string; to: string; valid: boolean; action: string; selector?: string }>
): TestCaseStep[] {
    const steps: TestCaseStep[] = [];
    let currentState = initialState;
    let stepNum = 1;

    for (const transition of transitions) {
        steps.push({
            stepNumber: stepNum,
            action: `${transition.action} (transition: ${transition.from} -> ${transition.to})`
        });

        if (transition.selector) {
            steps[stepNum - 1].selector = transition.selector;
        }

        // Add assertion to verify state change
        steps.push({
            stepNumber: stepNum + 1,
            action: transition.valid
                ? `Verify transition to "${transition.to}" succeeded`
                : `Verify transition from "${transition.from}" is blocked`,
            assertion: transition.valid
                ? { operator: 'visible', message: `Expected state: ${transition.to}` }
                : { operator: 'hidden', message: `Expected state "${transition.to}" should NOT appear` }
        });

        stepNum += 2;
        if (transition.valid) {
            currentState = transition.to;
        }
    }

    return steps;
}
