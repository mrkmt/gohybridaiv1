/**
 * Test Scenario Manager
 *
 * Manages the full lifecycle of test scenarios:
 * - Create scenarios from Jira tickets, AI, or manual input
 * - Validate scenario structure and completeness
 * - Categorize by type (Happy Path, Negative, Edge Case, Regression)
 * - Link scenarios to Jira tickets and modules
 * - Generate Playwright test stubs from scenarios
 *
 * @author GoHybrid AI Team
 * @date April 3, 2026
 */

// ============================================================================
// TYPES
// ============================================================================

export type ScenarioType = 'happy_path' | 'negative' | 'edge_case' | 'regression' | 'performance';
export type ScenarioPriority = 'critical' | 'high' | 'medium' | 'low';
export type ScenarioStatus = 'draft' | 'review' | 'approved' | 'automated' | 'deprecated';

export interface TestStep {
    order: number;
    action: string;
    selector?: string;
    inputData?: Record<string, string>;
    expectedState?: string;
    assertion?: {
        type: 'visible' | 'hidden' | 'contains' | 'equals' | 'count' | 'url' | 'api_response';
        target?: string;
        value?: string | number;
    };
}

export interface TestScenario {
    id: string;                 // SC-001, SC-002, etc.
    ticketId: string;           // Linked Jira ticket (e.g., ATT-16)
    title: string;              // Short description
    description: string;        // Full scenario description
    type: ScenarioType;
    priority: ScenarioPriority;
    status: ScenarioStatus;
    module: string;             // e.g., "Master > Department"
    preconditions: string[];    // What must be true before execution
    steps: TestStep[];
    expectedOutcome: string;    // What should happen if scenario passes
    tags: string[];             // e.g., ["smoke", "department", "crud"]
    estimatedDuration: number;  // Estimated execution time in ms
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    linkedScenarios: string[];  // IDs of related scenarios
}

export interface ScenarioValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    score: number;  // 0-100 quality score
}

export interface ScenarioBatchResult {
    total: number;
    valid: number;
    invalid: number;
    averageScore: number;
    results: ScenarioValidationResult[];
}

// ============================================================================
// SCENARIO BUILDER — Fluent API for creating scenarios
// ============================================================================

export class ScenarioBuilder {
    private scenario: Partial<TestScenario>;
    private steps: TestStep[] = [];
    private preconditions: string[] = [];
    private tags: string[] = [];
    private linkedScenarios: string[] = [];

    constructor(baseId: string, ticketId: string) {
        this.scenario = {
            id: baseId,
            ticketId,
            status: 'draft',
            priority: 'medium',
            type: 'happy_path',
            tags: [],
            estimatedDuration: 30000,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: 'system'
        };
    }

    title(title: string): this {
        this.scenario.title = title;
        return this;
    }

    description(desc: string): this {
        this.scenario.description = desc;
        return this;
    }

    module(module: string): this {
        this.scenario.module = module;
        return this;
    }

    type(type: ScenarioType): this {
        this.scenario.type = type;
        return this;
    }

    priority(priority: ScenarioPriority): this {
        this.scenario.priority = priority;
        return this;
    }

    addTags(...newTags: string[]): this {
        this.tags.push(...newTags);
        return this;
    }

    precondition(precondition: string): this {
        this.preconditions.push(precondition);
        return this;
    }

    step(order: number, action: string, options?: {
        selector?: string;
        inputData?: Record<string, string>;
        expectedState?: string;
        assertion?: TestStep['assertion'];
    }): this {
        this.steps.push({
            order,
            action,
            ...options
        });
        return this;
    }

    expectedOutcome(outcome: string): this {
        this.scenario.expectedOutcome = outcome;
        return this;
    }

    estimatedDuration(ms: number): this {
        this.scenario.estimatedDuration = ms;
        return this;
    }

    linkedTo(...scenarioIds: string[]): this {
        this.linkedScenarios.push(...scenarioIds);
        return this;
    }

    build(): TestScenario {
        return {
            id: this.scenario.id!,
            ticketId: this.scenario.ticketId!,
            title: this.scenario.title || 'Untitled Scenario',
            description: this.scenario.description || '',
            type: this.scenario.type!,
            priority: this.scenario.priority!,
            status: this.scenario.status!,
            module: this.scenario.module || 'Unknown',
            preconditions: this.preconditions,
            steps: this.steps.sort((a, b) => a.order - b.order),
            expectedOutcome: this.scenario.expectedOutcome || '',
            tags: [...new Set([...(this.scenario.tags || []), ...this.tags])],
            estimatedDuration: this.scenario.estimatedDuration || 30000,
            createdAt: this.scenario.createdAt!,
            updatedAt: new Date().toISOString(),
            createdBy: this.scenario.createdBy || 'system',
            linkedScenarios: this.linkedScenarios
        };
    }
}

// ============================================================================
// SCENARIO VALIDATOR
// ============================================================================

export class ScenarioValidator {

    /**
     * Validate a single scenario for completeness and quality
     */
    static validate(scenario: TestScenario): ScenarioValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Required fields
        if (!scenario.title?.trim()) errors.push('Missing title');
        if (!scenario.description?.trim()) errors.push('Missing description');
        if (!scenario.module?.trim()) errors.push('Missing module');
        if (!scenario.expectedOutcome?.trim()) errors.push('Missing expected outcome');
        if (scenario.steps.length === 0) errors.push('No steps defined');

        // Step validation
        for (let i = 0; i < scenario.steps.length; i++) {
            const step = scenario.steps[i];
            if (!step.action?.trim()) errors.push(`Step ${i + 1}: missing action`);
            if (step.order !== i + 1) warnings.push(`Step ${i + 1}: order mismatch (${step.order})`);
        }

        // Quality checks
        if (scenario.steps.length < 2) warnings.push('Scenario has fewer than 2 steps — may be too simple');
        if (scenario.steps.length > 20) warnings.push(`Scenario has ${scenario.steps.length} steps — consider splitting`);
        if (!scenario.tags?.length) warnings.push('No tags assigned — add tags for filtering');
        if (!scenario.preconditions?.length) warnings.push('No preconditions defined');

        // Type-specific validation
        if (scenario.type === 'negative' && !scenario.description.toLowerCase().includes('error') &&
            !scenario.description.toLowerCase().includes('invalid') &&
            !scenario.description.toLowerCase().includes('fail')) {
            warnings.push('Negative scenario should mention error/invalid/fail in description');
        }

        // Calculate quality score
        let score = 100;
        score -= errors.length * 15;
        score -= warnings.length * 5;
        if (scenario.steps.length >= 3 && scenario.steps.length <= 15) score += 5;
        if (scenario.tags?.length >= 2) score += 3;
        if (scenario.preconditions?.length >= 1) score += 2;
        if (scenario.steps.some(s => s.assertion)) score += 5;
        score = Math.max(0, Math.min(100, score));

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            score
        };
    }

    /**
     * Validate a batch of scenarios
     */
    static validateBatch(scenarios: TestScenario[]): ScenarioBatchResult {
        const results = scenarios.map(s => this.validate(s));
        const valid = results.filter(r => r.valid).length;
        const averageScore = results.length > 0
            ? results.reduce((sum, r) => sum + r.score, 0) / results.length
            : 0;

        return {
            total: scenarios.length,
            valid,
            invalid: scenarios.length - valid,
            averageScore: Math.round(averageScore),
            results
        };
    }
}

// ============================================================================
// SCENARIO MANAGER — Full CRUD + operations
// ============================================================================

export class ScenarioManager {
    private scenarios: Map<string, TestScenario> = new Map();
    private nextId = 1;

    /**
     * Create a scenario
     */
    add(scenario: TestScenario): void {
        if (this.scenarios.has(scenario.id)) {
            throw new Error(`Scenario ${scenario.id} already exists`);
        }
        this.scenarios.set(scenario.id, scenario);
    }

    /**
     * Create scenario using fluent builder
     */
    create(id: string, ticketId: string): ScenarioBuilder {
        const builder = new ScenarioBuilder(id, ticketId);
        return builder;
    }

    /**
     * Get scenario by ID
     */
    get(id: string): TestScenario | undefined {
        return this.scenarios.get(id);
    }

    /**
     * Get all scenarios
     */
    getAll(): TestScenario[] {
        return Array.from(this.scenarios.values());
    }

    /**
     * Filter scenarios by criteria
     */
    filter(criteria: {
        ticketId?: string;
        module?: string;
        type?: ScenarioType;
        priority?: ScenarioPriority;
        status?: ScenarioStatus;
        tags?: string[];
    }): TestScenario[] {
        return this.getAll().filter(s => {
            if (criteria.ticketId && s.ticketId !== criteria.ticketId) return false;
            if (criteria.module && !s.module.includes(criteria.module)) return false;
            if (criteria.type && s.type !== criteria.type) return false;
            if (criteria.priority && s.priority !== criteria.priority) return false;
            if (criteria.status && s.status !== criteria.status) return false;
            if (criteria.tags?.length && !criteria.tags.some(t => s.tags.includes(t))) return false;
            return true;
        });
    }

    /**
     * Update scenario
     */
    update(id: string, updates: Partial<TestScenario>): boolean {
        const existing = this.scenarios.get(id);
        if (!existing) return false;
        this.scenarios.set(id, { ...existing, ...updates, updatedAt: new Date().toISOString() });
        return true;
    }

    /**
     * Delete scenario
     */
    delete(id: string): boolean {
        return this.scenarios.delete(id);
    }

    /**
     * Get scenarios by priority order
     */
    getByPriority(): TestScenario[] {
        const order: Record<ScenarioPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        return this.getAll().sort((a, b) => order[a.priority] - order[b.priority]);
    }

    /**
     * Get estimated total duration for scenarios
     */
    getEstimatedDuration(scenarioIds: string[]): number {
        return scenarioIds.reduce((sum, id) => {
            const s = this.scenarios.get(id);
            return sum + (s?.estimatedDuration || 0);
        }, 0);
    }

    /**
     * Generate Playwright test stub from scenario
     */
    static generateTestStub(scenario: TestScenario): string {
        const safeTitle = scenario.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 60);

        let testCode = `/**\n * Auto-generated from Scenario: ${scenario.id}\n * Ticket: ${scenario.ticketId}\n * Module: ${scenario.module}\n * Type: ${scenario.type}\n * Priority: ${scenario.priority}\n */\n\n`;
        testCode += `import { test, expect } from '@playwright/test';\n`;
        testCode += `import { loginAndNavigate } from '../login-helper';\n`;
        testCode += `import { healedClick, safeFill, waitForAngularStable } from '../playwright-self-healing';\n`;
        testCode += `import { TESTING_CREDENTIALS } from '../test-credentials';\n\n`;
        testCode += `test.describe('${scenario.id}: ${scenario.title.substring(0, 50)}', () => {\n\n`;

        // Preconditions
        if (scenario.preconditions.length > 0) {
            testCode += `    // Preconditions:\n`;
            for (const pre of scenario.preconditions) {
                testCode += `    // - ${pre}\n`;
            }
            testCode += `\n`;
        }

        testCode += `    test('${safeTitle}', async ({ page }) => {\n`;
        testCode += `        test.setTimeout(${Math.max(scenario.estimatedDuration * 2, 120000)});\n\n`;

        // Steps
        for (const step of scenario.steps) {
            testCode += `        // Step ${step.order}: ${step.action}\n`;
            if (step.selector) {
                testCode += `        // Selector: ${step.selector}\n`;
            }
            if (step.inputData) {
                for (const [field, value] of Object.entries(step.inputData)) {
                    testCode += `        // Input: ${field} = "${value}"\n`;
                }
            }

            // Generate actual step implementation instead of TODO
            if (step.selector && step.inputData) {
                // Fill/interact step with selector and data
                for (const [field, value] of Object.entries(step.inputData)) {
                    testCode += `        await page.locator('${step.selector}').fill('${value}');\n`;
                }
            } else if (step.selector) {
                // Click/interact step with selector
                testCode += `        await healedClick(page, '${step.selector}');\n`;
            } else if (step.assertion) {
                // Assertion step
                switch (step.assertion.type) {
                    case 'visible':
                        testCode += `        await expect(page.locator('${step.assertion.target || 'body'}')).toBeVisible();\n`;
                        break;
                    case 'hidden':
                        testCode += `        await expect(page.locator('${step.assertion.target || 'body'}')).toBeHidden();\n`;
                        break;
                    case 'contains':
                        testCode += `        await expect(page.locator('${step.assertion.target || 'body'}')).toContainText('${step.assertion.value}');\n`;
                        break;
                    case 'equals':
                        testCode += `        await expect(page.locator('${step.assertion.target || 'body'}')).toHaveText('${step.assertion.value}');\n`;
                        break;
                    case 'count':
                        testCode += `        await expect(page.locator('${step.assertion.target || 'body'}')).toHaveCount(${step.assertion.value || 0});\n`;
                        break;
                    case 'url':
                        testCode += `        await expect(page).toHaveURL(new RegExp('${step.assertion.value || ''}'));\n`;
                        break;
                    default:
                        testCode += `        // Unsupported assertion type: ${step.assertion.type}\n`;
                        testCode += `        console.warn('Assertion not auto-generated: ${step.assertion.type}');\n`;
                }
            } else {
                // Generic step — use action-based heuristic
                const actionLower = step.action.toLowerCase();
                if (actionLower.includes('click') || actionLower.includes('press') || actionLower.includes('tap')) {
                    const match = step.action.match(/["']([^"']+)["']/);
                    const btnText = match ? match[1] : 'Unknown';
                    testCode += `        await page.getByRole('button', { name: /${btnText}/i }).click();\n`;
                } else if (actionLower.includes('fill') || actionLower.includes('enter') || actionLower.includes('type')) {
                    const match = step.action.match(/["']([^"']+)["']/);
                    const fillValue = match ? match[1] : '';
                    testCode += `        await page.pause(); // UNIMPLEMENTED: Fill "${fillValue}" — add selector to step ${step.order}\n`;
                } else if (actionLower.includes('wait') || actionLower.includes('pause')) {
                    testCode += `        await page.waitForTimeout(2000);\n`;
                } else if (actionLower.includes('navigate') || actionLower.includes('go to')) {
                    const match = step.action.match(/(https?:\/\/[^\s]+)/);
                    if (match) {
                        testCode += `        await page.goto('${match[1]}');\n`;
                    } else {
                        testCode += `        await page.pause(); // UNIMPLEMENTED: Navigate — add target URL to step ${step.order}\n`;
                    }
                } else {
                    // Fallback: pause for manual review with context
                    testCode += `        await page.pause(); // REVIEW: Step ${step.order} — ${step.action.replace(/'/g, "\\'")}\n`;
                }
            }
            testCode += `\n`;
        }

        // Expected outcome
        testCode += `        // Expected: ${scenario.expectedOutcome}\n`;
        testCode += `        console.log('Scenario ${scenario.id} completed');\n`;
        testCode += `    });\n});\n`;

        return testCode;
    }

    /**
     * Export scenarios as JSON
     */
    exportJSON(): string {
        return JSON.stringify(Array.from(this.scenarios.values()), null, 2);
    }

    /**
     * Import scenarios from JSON
     */
    importJSON(json: string): number {
        const scenarios = JSON.parse(json) as TestScenario[];
        let count = 0;
        for (const s of scenarios) {
            this.scenarios.set(s.id, s);
            count++;
        }
        return count;
    }

    /**
     * Get summary statistics
     */
    getSummary(): {
        total: number;
        byType: Record<ScenarioType, number>;
        byPriority: Record<ScenarioPriority, number>;
        byStatus: Record<ScenarioStatus, number>;
        averageScore: number;
    } {
        const scenarios = this.getAll();
        const validationResults = scenarios.map(s => ScenarioValidator.validate(s));
        const averageScore = validationResults.length > 0
            ? validationResults.reduce((sum, r) => sum + r.score, 0) / validationResults.length
            : 0;

        const byType: Record<ScenarioType, number> = { happy_path: 0, negative: 0, edge_case: 0, regression: 0, performance: 0 };
        const byPriority: Record<ScenarioPriority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
        const byStatus: Record<ScenarioStatus, number> = { draft: 0, review: 0, approved: 0, automated: 0, deprecated: 0 };

        for (const s of scenarios) {
            byType[s.type] = (byType[s.type] || 0) + 1;
            byPriority[s.priority] = (byPriority[s.priority] || 0) + 1;
            byStatus[s.status] = (byStatus[s.status] || 0) + 1;
        }

        return {
            total: scenarios.length,
            byType,
            byPriority,
            byStatus,
            averageScore: Math.round(averageScore)
        };
    }
}
