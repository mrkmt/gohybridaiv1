/**
 * TestSpecQualityScorer.ts
 *
 * Scoring engine for AI-generated test specifications.
 * Evaluates step atomicity, assertion coverage, edge case coverage,
 * and business rule completeness before execution.
 */

import { TestSpecification, TestScenario, ActionStep } from './TestSpecSchema';

export interface QualityScore {
  overall: number;        // 0–100 weighted composite
  stepAtomicity: number;  // 0–100: are steps self-contained and meaningful?
  assertionCoverage: number; // 0–100: does each scenario have assertions?
  edgeCaseCoverage: number; // 0–100: are negative/boundary paths tested?
  selectorQuality: number;  // 0–100: are selectors specific enough?
  businessRuleCoverage: number; // 0–100: are business rules validated?
  warnings: string[];     // Human-readable quality warnings
  verdict: 'PASS' | 'WARN' | 'FAIL';
}

const WEIGHTS = {
  stepAtomicity: 0.20,
  assertionCoverage: 0.25,
  edgeCaseCoverage: 0.20,
  selectorQuality: 0.15,
  businessRuleCoverage: 0.20,
};

/**
 * Evaluate the quality of a test specification.
 */
export function scoreTestSpecification(spec: TestSpecification): QualityScore {
  if (!spec.scenarios || spec.scenarios.length === 0) {
    return {
      overall: 0,
      stepAtomicity: 0,
      assertionCoverage: 0,
      edgeCaseCoverage: 0,
      selectorQuality: 0,
      businessRuleCoverage: 0,
      warnings: ['No scenarios generated'],
      verdict: 'FAIL',
    };
  }

  const stepAtomicity = scoreStepAtomicity(spec);
  const assertionCoverage = scoreAssertionCoverage(spec);
  const edgeCaseCoverage = scoreEdgeCaseCoverage(spec);
  const selectorQuality = scoreSelectorQuality(spec);
  const businessRuleCoverage = scoreBusinessRuleCoverage(spec);

  const overall = Math.round(
    stepAtomicity * WEIGHTS.stepAtomicity +
    assertionCoverage * WEIGHTS.assertionCoverage +
    edgeCaseCoverage * WEIGHTS.edgeCaseCoverage +
    selectorQuality * WEIGHTS.selectorQuality +
    businessRuleCoverage * WEIGHTS.businessRuleCoverage
  );

  const warnings: string[] = [];

  if (stepAtomicity < 60) warnings.push('Many steps lack business-readable descriptions or are compound actions');
  if (assertionCoverage < 60) warnings.push('Scenarios missing assertions — tests may pass without meaningful verification');
  if (edgeCaseCoverage < 40) warnings.push('No negative/edge case scenarios — only happy path tested');
  if (selectorQuality < 50) warnings.push('Selectors rely on generic patterns — may break on UI changes');
  if (businessRuleCoverage < 60) warnings.push('Business rules not directly validated by any scenario');

  const verdict: QualityScore['verdict'] =
    overall >= 70 ? 'PASS' :
    overall >= 40 ? 'WARN' : 'FAIL';

  return {
    overall,
    stepAtomicity,
    assertionCoverage,
    edgeCaseCoverage,
    selectorQuality,
    businessRuleCoverage,
    warnings,
    verdict,
  };
}

/**
 * Step Atomicity: Each step should be a single action (not compound),
 * and should have a business-readable description.
 */
function scoreStepAtomicity(spec: TestSpecification): number {
  if (!spec.scenarios.length) return 0;

  let totalSteps = 0;
  let goodSteps = 0;

  for (const scenario of spec.scenarios) {
    for (const step of scenario.steps || []) {
      totalSteps++;
      const s = step as any;

      // Penalty for compound "and" actions (should be split into separate steps)
      const actionText = (s.description || s.action || '').toLowerCase();
      const isCompound = /\band\b|\bthen\b|\band also\b/.test(actionText);
      if (isCompound) continue;

      // Steps with descriptions are better
      if (s.description && s.description.trim().length > 5) {
        goodSteps += 1;
      } else if (s.type && s.type.length > 0) {
        // Has a valid type even without description
        goodSteps += 0.6;
      }
    }
  }

  if (totalSteps === 0) return 0;
  return Math.min(100, Math.round((goodSteps / totalSteps) * 100));
}

/**
 * Assertion Coverage: Every scenario should have at least one assertion.
 * Bonus: Multiple assertions covering different concerns.
 */
function scoreAssertionCoverage(spec: TestSpecification): number {
  if (!spec.scenarios.length) return 0;

  let score = 0;

  for (const scenario of spec.scenarios) {
    const assertions = scenario.assertions || [];
    if (assertions.length === 0) {
      // Scenario with no assertions at all
      continue;
    }

    // Base score: scenario has assertions
    score += 50 / spec.scenarios.length;

    // Bonus: diverse assertion types
    const types = new Set(assertions.map((a: any) => a.type));
    if (types.size >= 2) score += 20 / spec.scenarios.length;
    if (assertions.length >= 3) score += 15 / spec.scenarios.length;
    if (types.has('assertText') && types.has('assertVisible')) score += 15 / spec.scenarios.length;
  }

  return Math.min(100, Math.round(score));
}

/**
 * Edge Case Coverage: Does the spec test more than just the happy path?
 * Looks for scenarios labeled as negative, edge, boundary, error, etc.
 */
function scoreEdgeCaseCoverage(spec: TestSpecification): number {
  if (!spec.scenarios.length) return 0;

  const edgeCaseKeywords = ['boundary', 'edge', 'negative', 'invalid', 'error',
    'empty', 'null', 'limit', 'max', 'min', 'duplicate', 'missing',
    'unauthorized', 'permission', 'concurrent', 'race', 'timeout',
    'alternative', 'negative'];

  const happyPathKeywords = ['happy', 'positive', 'success', 'valid', 'normal', 'typical'];

  let happyPaths = 0;
  let edgePaths = 0;

  for (const scenario of spec.scenarios) {
    const label = `${scenario.name} ${(scenario.tags || []).join(' ')} ${(scenario.preconditions || []).join(' ')}`.toLowerCase();

    if (edgeCaseKeywords.some(kw => label.includes(kw))) {
      edgePaths++;
    } else if (happyPathKeywords.some(kw => label.includes(kw))) {
      happyPaths++;
    } else {
      // Unknown: check if scenario primarily involves validation/error steps
      const hasNegativeAssertion = scenario.assertions?.some((a: any) =>
        a.type === 'assertText' && /\bnot\b|\bempty\b|\berror\b|\bfail\b/i.test(a.expected || '')
      );
      if (hasNegativeAssertion) {
        edgePaths++;
      } else {
        happyPaths++;
      }
    }
  }

  const total = happyPaths + edgePaths;
  if (total === 0) return 0;

  // Ideal: at least 30% edge cases of total scenarios
  const ratio = edgePaths / total;
  if (ratio >= 0.4) return 100;
  if (ratio >= 0.3) return 80;
  if (ratio >= 0.2) return 60;
  if (ratio >= 0.1) return 40;
  return 20;
}

/**
 * Selector Quality: Are selectors specific enough, or generic/dynamic?
 * Penalizes fragile selectors like .k-button-primary, dynamic k-grid IDs.
 * Rewards getByRole, data-testid, aria-label, stable class names.
 */
function scoreSelectorQuality(spec: TestSpecification): number {
  const allSteps: ActionStep[] = [];
  for (const sc of spec.scenarios) {
    for (const step of sc.steps || []) {
      allSteps.push(step as ActionStep);
    }
    for (const assertion of sc.assertions || []) {
      if ('selector' in assertion) allSteps.push(assertion as any);
    }
  }

  if (allSteps.length === 0) return 50; // neutral when no selectors

  let goodSelectors = 0;
  let totalSelectors = 0;

  const fragilePatterns = [
    /k-grid-\w+/,          // dynamic Kendo grid IDs
    /k-button-solid-primary/, // generic Kendo button class
    /\.mat-\w+-\d+/,       // dynamic Angular Material IDs
    /#__next/,             // React generated IDs
    /\[ng-reflect-/,       // Angular debug attributes
  ];

  const robustPatterns = [
    /\[data-testid=/,      // test ID
    /\[aria-label=/,       // accessibility label
    /getByRole/,           // Playwright accessibility query
    /getByLabelText/,
    /getByPlaceholder/,
    /getByText/,
  ];

  for (const step of allSteps) {
    const s = step as any;
    const selector = s.selector || s.selectorHint || '';
    if (!selector) continue;
    totalSelectors++;

    if (fragilePatterns.some(p => p.test(selector))) {
      // Fragile selector — no points
    } else if (robustPatterns.some(p => p.test(selector))) {
      goodSelectors += 1;
    } else if (selector.includes('input[name=') || selector.includes('form.')) {
      goodSelectors += 0.7; // reasonable but not ideal
    } else if (selector.startsWith('.') || selector.startsWith('#')) {
      goodSelectors += 0.5; // class/id based, could break
    } else {
      goodSelectors += 0.6; // other reasonable patterns
    }
  }

  if (totalSelectors === 0) return 50;
  return Math.min(100, Math.round((goodSelectors / totalSelectors) * 100));
}

/**
 * Business Rule Coverage: Check if scenarios reference or validate
 * business logic from the module's skill files.
 */
function scoreBusinessRuleCoverage(spec: TestSpecification): number {
  if (!spec.scenarios.length) return 0;

  const allText = spec.scenarios
    .map((sc: any) => `${sc.name} ${(sc.tags || []).join(' ')} ${(sc.preconditions || []).join(' ')}
      ${(sc.steps || []).map((s: any) => `${s.description || ''} ${s.action || ''} ${s.field || ''}`).join(' ')}
      ${(sc.assertions || []).map((a: any) => `${a.expected || ''}`).join(' ')}
    `).join(' ').toLowerCase();

  // Simple heuristic: does the test reference business-relevant terms?
  // A good test mentions the module's domain concepts (not just "click" and "fill")
  const hasBusinessContext =
    /[a-z]+(formula|rule|policy|validation|limit|max|min|allowance|threshold|condition|calculation)/i.test(allText) ||
    (allText.length > 200 && spec.scenarios.length >= 2);

  // Scenarios with multiple steps tend to cover more business logic
  const avgSteps = spec.scenarios.reduce((sum: any, sc: any) => sum + (sc.steps?.length || 0), 0) / spec.scenarios.length;

  let score = 0;
  if (hasBusinessContext) score += 40;
  if (avgSteps >= 4) score += 30;
  else if (avgSteps >= 2) score += 15;
  if (spec.scenarios.length >= 3) score += 30;
  else if (spec.scenarios.length >= 2) score += 20;
  else score += 10;

  return Math.min(100, score);
}
