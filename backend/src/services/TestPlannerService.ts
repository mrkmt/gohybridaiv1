/**
 * TestPlannerService.ts
 *
 * Multi-Agent Planner for test execution.
 * Based on industry best practices for AI-assisted test automation:
 * - Planner: Decomposes high-level test intent into executable, sequential steps
 * - Validator: Ensures each step has proper selectors, waits, and assertions
 * - Optimizer: Suggests improvements for reliability and maintainability
 *
 * This service runs BEFORE test execution to catch issues early and
 * generate more resilient test scripts from the start.
 */

import { ActionStep } from './TestSpecSchema';
import { TestCase } from './generation/TestCaseGeneratorService';
import { appLogger } from '../utils/logger';

/**
 * Planning analysis result
 */
export interface PlanningResult {
  /** Whether the test plan is ready for execution */
  isReady: boolean;

  /** Issues found during planning */
  issues: PlanningIssue[];

  /** Optimizations suggested */
  optimizations: PlanningOptimization[];

  /** Improved test case (if optimizations applied) */
  improvedTestCase?: TestCase;

  /** Overall quality score (0-1) */
  qualityScore: number;
}

export interface PlanningIssue {
  /** Issue type */
  type: 'missing_selector' | 'missing_assertion' | 'fragile_selector' | 'missing_wait' | 'ambiguous_step';

  /** Step index where issue was found */
  stepIndex: number;

  /** Description of the issue */
  description: string;

  /** Severity */
  severity: 'error' | 'warning' | 'info';

  /** Suggested fix */
  suggestion?: string;
}

export interface PlanningOptimization {
  /** Optimization type */
  type: 'add_explicit_wait' | 'improve_selector' | 'add_assertion' | 'scope_query' | 'add_retry';

  /** Step index */
  stepIndex: number;

  /** Description */
  description: string;

  /** Code snippet or hint */
  codeSnippet?: string;
}

/**
 * Test Planner Service — validates and optimizes test cases before execution
 */
export class TestPlannerService {
  /**
   * Plan and validate a test case before execution
   */
  static planTestCase(testCase: TestCase): PlanningResult {
    const issues: PlanningIssue[] = [];
    const optimizations: PlanningOptimization[] = [];

    for (let i = 0; i < testCase.steps.length; i++) {
      const step = testCase.steps[i];
      const action = (step.action || '').toLowerCase();

      // 1. Check for missing selectors on interaction steps
      if (this.isInteractionStep(action) && !this.hasSelector(step)) {
        issues.push({
          type: 'missing_selector',
          stepIndex: i,
          description: `Step "${step.action}" is an interaction but has no selector specified.`,
          severity: 'error',
          suggestion: 'Add a selector (getByRole, getByLabel, getByText, or data-testid) to target the element.',
        });
      }

      // 2. Check for fragile selectors (CSS/XPath)
      if (this.hasSelector(step)) {
        const selector = this.extractSelector(step);
        if (selector && this.isFragileSelector(selector)) {
          issues.push({
            type: 'fragile_selector',
            stepIndex: i,
            description: `Step "${step.action}" uses a fragile selector: "${selector}"`,
            severity: 'warning',
            suggestion: this.getSuggestedSelector(action, selector),
          });
          optimizations.push({
            type: 'improve_selector',
            stepIndex: i,
            description: `Replace fragile selector with accessibility-based selector`,
            codeSnippet: this.generateImprovedSelector(action, selector) ?? undefined,
          });
        }
      }

      // 3. Check for missing waits before interactions
      if (this.isInteractionStep(action) && i > 0) {
        const prevStep = testCase.steps[i - 1];
        const prevAction = (prevStep.action || '').toLowerCase();
        if (this.isNavigationStep(prevAction) && !this.hasExplicitWait(step)) {
          optimizations.push({
            type: 'add_explicit_wait',
            stepIndex: i,
            description: `Add explicit wait after navigation step "${prevAction}"`,
            codeSnippet: `await page.waitForLoadState('domcontentloaded');\nawait page.locator('${this.extractSelector(step)}').waitFor({ state: 'visible' });`,
          });
        }
      }

      // 4. Check for missing assertions
      if (this.isAssertionStep(action) && !this.hasAssertionTarget(step)) {
        issues.push({
          type: 'missing_assertion',
          stepIndex: i,
          description: `Step "${step.action}" is an assertion but has no expected value.`,
          severity: 'warning',
          suggestion: 'Add an expected value or condition to assert against.',
        });
      }

      // 5. Check for ambiguous steps
      if (!this.isRecognizedStep(action)) {
        issues.push({
          type: 'ambiguous_step',
          stepIndex: i,
          description: `Step "${step.action}" is not a recognized action pattern.`,
          severity: 'info',
          suggestion: 'Use standard action patterns: click, fill, select, check, navigate, assert, wait.',
        });
      }
    }

    // Calculate quality score
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const qualityScore = Math.max(0, 1 - (errorCount * 0.3) - (warningCount * 0.1));

    const isReady = errorCount === 0;

    return {
      isReady,
      issues,
      optimizations,
      qualityScore,
    };
  }

  /**
   * Apply optimizations to a test case
   */
  static applyOptimizations(testCase: TestCase, optimizations: PlanningOptimization[]): TestCase {
    const improvedSteps = [...testCase.steps];

    for (const opt of optimizations) {
      if (opt.type === 'add_explicit_wait' && opt.codeSnippet) {
        // Inject wait before the step
        const waitStep: ActionStep = {
          stepNumber: opt.stepIndex + 1,
          action: 'wait_for_element_visible',
          expectedResult: 'Element is visible and ready',
          selectorHint: (improvedSteps[opt.stepIndex] as any).selector,
        };
        improvedSteps.splice(opt.stepIndex, 0, waitStep);
      }

      if (opt.type === 'improve_selector' && opt.codeSnippet) {
        // Update the step's custom code with improved selector
        improvedSteps[opt.stepIndex] = {
          ...improvedSteps[opt.stepIndex],
          customCode: opt.codeSnippet,
        };
      }
    }

    return {
      ...testCase,
      steps: improvedSteps,
    };
  }

  // ─── Helper Methods ───

  private static isInteractionStep(action: string): boolean {
    return /^(click|fill|type|select|check|uncheck|hover|drag|drop|press|submit)/i.test(action);
  }

  private static isNavigationStep(action: string): boolean {
    return /^(navigate|goto|go to|visit|open url|redirect)/i.test(action);
  }

  private static isAssertionStep(action: string): boolean {
    return /^(assert|verify|check|expect|should|validate)/i.test(action);
  }

  private static hasSelector(step: ActionStep): boolean {
    return !!(
      (step as any).selector ||
      (step as any).selectorHint ||
      (step as any).targetElement ||
      (step.customCode && /locator\(/.test(step.customCode))
    );
  }

  private static extractSelector(step: ActionStep): string | null {
    if ((step as any).selector) return (step as any).selector;
    if ((step as any).selectorHint) return (step as any).selectorHint;
    if ((step as any).targetElement) return (step as any).targetElement;

    // Extract from custom code
    if (step.customCode) {
      const match = step.customCode.match(/locator\(['"]([^'"]+)['"]\)/);
      if (match) return match[1];
    }
    return null;
  }

  private static isFragileSelector(selector: string): boolean {
    // Fragile: CSS class names, XPath, index-based selectors
    return (
      /^\./i.test(selector) || // .classname
      /^\/\//.test(selector) || // XPath
      /:nth-child\(|:nth-of-type\(|:first-child|:last-child/.test(selector) || // index-based
      /^#[a-zA-Z]/.test(selector) && !/^[#][\w-]+$/.test(selector) || // complex IDs
      /\[class=["'][^"']*["']\]/.test(selector) // class attribute matching
    );
  }

  private static hasExplicitWait(step: ActionStep): boolean {
    return (
      (step.action || '').toLowerCase().includes('wait') ||
      (step.customCode && /waitFor/.test(step.customCode)) ||
      (step.expectedResult && /wait/.test(step.expectedResult.toLowerCase()))
    );
  }

  private static hasAssertionTarget(step: ActionStep): boolean {
    return !!(
      (step as any).expectedValue ||
      (step as any).assertionTarget ||
      (step.customCode && /expect\(|assert\(/.test(step.customCode))
    );
  }

  private static isRecognizedStep(action: string): boolean {
    const recognized = [
      'click', 'fill', 'type', 'select', 'check', 'uncheck', 'hover',
      'navigate', 'goto', 'go to', 'visit', 'open url', 'redirect',
      'assert', 'verify', 'check', 'expect', 'should', 'validate',
      'wait', 'pause', 'delay', 'screenshot', 'scroll',
      'drag', 'drop', 'press', 'submit', 'clear', 'upload',
      'wait_for_element_visible', 'wait_for_load',
    ];
    return recognized.some(r => action.toLowerCase().includes(r.toLowerCase()));
  }

  private static getSuggestedSelector(action: string, currentSelector: string): string {
    if (action.includes('click') || action.includes('submit')) {
      return `Use page.getByRole('button', { name: '...' }) or page.getByText('...')`;
    }
    if (action.includes('fill') || action.includes('type')) {
      return `Use page.getByLabel('...') or page.getByPlaceholder('...')`;
    }
    return `Use accessibility-based selectors (getByRole, getByLabel, getByText) instead of CSS/XPath`;
  }

  private static generateImprovedSelector(action: string, currentSelector: string): string | null {
    // Try to extract meaningful text from the selector
    const textMatch = currentSelector.match(/text=["']([^"']+)["']/i) ||
                      currentSelector.match(/aria-label=["']([^"']+)["']/i);

    if (textMatch) {
      if (action.includes('click')) {
        return `page.getByRole('button', { name: '${textMatch[1]}' }).click()`;
      }
      if (action.includes('fill')) {
        return `page.getByLabel('${textMatch[1]}').fill(value)`;
      }
    }

    return null;
  }
}
