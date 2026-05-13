/**
 * FailureClassificationService.ts
 * 
 * Classifies test failures into categories to enable smart handling:
 * - SELECTOR_ERROR: Test script issue (auto-retry with fallback selectors)
 * - ASSERTION_FAILURE: Real application bug (report as defect)
 * - TIMEOUT: Could be either (analyze context)
 * - NETWORK_ERROR: Environment issue (skip without marking as bug)
 * - EXECUTION_FAULT: Infrastructure problem (retry or skip)
 */

import { TestResult, StepResult } from './TestExecutionService';
import { TestScenario, ActionStep } from '../generation/TestSpecSchema';
import { selectorEnrichment } from '../skills/SelectorEnrichmentService';

/**
 * Failure categories for test execution results
 */
export enum FailureCategory {
  /** Element not found, selector timeout - likely test script issue */
  SELECTOR_ERROR = 'SELECTOR_ERROR',
  
  /** Expect condition was false - likely real application bug */
  ASSERTION_FAILURE = 'ASSERTION_FAILURE',
  
  /** Operation timed out - could be either script or app issue */
  TIMEOUT = 'TIMEOUT',
  
  /** Network/connection errors - environment issue */
  NETWORK_ERROR = 'NETWORK_ERROR',
  
  /** Infrastructure/script execution problems (SyntaxError, undefined access, etc.) */
  EXECUTION_FAULT = 'EXECUTION_FAULT',

  /**
   * S4-4: Browser-lifecycle timing errors (Target closed, frame detached,
   * Session closed, Protocol error). These are NOT real code faults — they
   * are race conditions that heal well with retry + increased timeout.
   * Split out of EXECUTION_FAULT so self-heal can prioritise them.
   */
  TIMING_FAULT = 'TIMING_FAULT',

  /**
   * S4-4: Selector resolved, but it was captured in a UI state the test never
   * reached (e.g. selector tagged `modal:Add New` used before the Add New
   * button was clicked). Requires test regeneration, not a simple heal.
   */
  STATE_MISMATCH = 'STATE_MISMATCH',

  /** File/system access errors */
  SYSTEM_ERROR = 'SYSTEM_ERROR',

  /** Unknown error - needs manual investigation */
  UNKNOWN = 'UNKNOWN',
}

/**
 * Classification result with confidence score
 */
export interface ClassificationResult {
  /** Primary failure category */
  category: FailureCategory;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Detailed explanation */
  explanation: string;
  
  /** Suggested action */
  suggestedAction: 'retry' | 'skip' | 'report' | 'investigate';
  
  /** Whether this is likely a test script issue vs real defect */
  isScriptIssue: boolean;
  
  /** Fallback selectors to try on retry */
  fallbackSelectors?: string[];
  
  /** Original error message */
  originalError: string;
}

/**
 * Error pattern definitions for classification
 */
const ERROR_PATTERNS: {
  category: FailureCategory;
  patterns: RegExp[];
  confidence: number;
  isScriptIssue: boolean;
  suggestedAction: 'retry' | 'skip' | 'report' | 'investigate';
}[] = [
  // SELECTOR_ERRORS - Test script issues
  {
    category: FailureCategory.SELECTOR_ERROR,
    patterns: [
      /locator\.count.*0/i,
      /waiting for locator/i,
      /element.*not found/i,
      /could not find.*element/i,
      /no element matching/i,
      /selector.*did not find/i,
      /element.*visible.*0/i,
      /Timeout.*waitForSelector/i,
      /element.*attached/i,
    ],
    confidence: 0.9,
    isScriptIssue: true,
    suggestedAction: 'retry',
  },
  
  // ASSERTION_FAILURES - Real bugs
  {
    category: FailureCategory.ASSERTION_FAILURE,
    patterns: [
      /expect.*received/i,
      /expected.*to.*but got/i,
      /assertion.*failed/i,
      /expected.*not.*received/i,
      /toContainText.*failed/i,
      /toHaveText.*failed/i,
      /toBeVisible.*failed/i,
      /expect.*toBe.*received/i,
    ],
    confidence: 0.95,
    isScriptIssue: false,
    suggestedAction: 'report',
  },
  
  // NETWORK_ERRORS - Environment issues (some are transient and should be retried)
  {
    category: FailureCategory.NETWORK_ERROR,
    patterns: [
      /ECONNREFUSED/i,
      /ERR_CONNECTION_REFUSED/i,
      /net::ERR_/i,
      /network.*error/i,
      /request.*failed/i,
      /fetch.*failed/i,
      /socket.*hang up/i,
      /connection.*reset/i,
    ],
    confidence: 0.85,
    isScriptIssue: false,
    suggestedAction: 'retry', // Retry transient network errors — they're often temporary
  },

  // 5xx SERVER ERRORS - Should skip (app is broken, retrying won't help)
  {
    category: FailureCategory.NETWORK_ERROR,
    patterns: [
      /5\d{2}/, // 5xx server errors
    ],
    confidence: 0.85,
    isScriptIssue: false,
    suggestedAction: 'skip', // Skip on 5xx — server is broken
  },
  
  // S4-4: TIMING_FAULT — browser-lifecycle race conditions, not real script bugs.
  // These heal well with retry + increased timeout.
  {
    category: FailureCategory.TIMING_FAULT,
    patterns: [
      /Target closed/i,
      /Protocol error/i,
      /Session closed/i,
      /browser has been closed/i,
      /frame was detached/i,
      /execution context was destroyed/i,
    ],
    confidence: 0.8,
    isScriptIssue: false,
    suggestedAction: 'retry',
  },

  // EXECUTION_FAULTS - Genuine script / infrastructure problems (post S4-4 split)
  {
    category: FailureCategory.EXECUTION_FAULT,
    patterns: [
      /Unexpected token/i,
      /SyntaxError/i,
      /Cannot read properties/i,
      /is not a function/i,
      /spawn UNKNOWN/i,
      /EPERM/i,
      /ENOENT/i,
    ],
    confidence: 0.8,
    isScriptIssue: true,
    suggestedAction: 'retry',
  },
  
  // TIMEOUTS - Could be either (categorized by context for smarter healing)
  {
    category: FailureCategory.TIMEOUT,
    patterns: [
      /Timeout.*exceeded/i,
      /Navigation timeout/i,
      /waitFor.*timeout/i,
      /timeout.*\d+ms/i,
      /page\.goto.*timeout/i,
      /waiting for.*to be.*visible/i,
      /waiting for.*to be.*attached/i,
      /call log.*pending/i,
    ],
    confidence: 0.6,
    isScriptIssue: false, // Could be either, default to app issue
    suggestedAction: 'investigate',
  },
  
  // SYSTEM_ERRORS - File/system access
  {
    category: FailureCategory.SYSTEM_ERROR,
    patterns: [
      /ENOENT.*open/i,
      /EACCES/i,
      /permission denied/i,
      /disk.*full/i,
      /out of memory/i,
    ],
    confidence: 0.9,
    isScriptIssue: false,
    suggestedAction: 'skip',
  },
];

/**
 * Failure Classification Service
 */
export class FailureClassificationService {
  /**
   * Classify a test failure
   */
  static classifyFailure(errorMessage: string, stepContext?: {
    action?: string;
    selector?: string;
    stepNumber?: number;
  }): ClassificationResult {
    if (!errorMessage) {
      return {
        category: FailureCategory.UNKNOWN,
        confidence: 0.5,
        explanation: 'No error message provided',
        suggestedAction: 'investigate',
        isScriptIssue: false,
        originalError: '',
      };
    }

    // Check each pattern category
    for (const patternDef of ERROR_PATTERNS) {
      for (const pattern of patternDef.patterns) {
        if (pattern.test(errorMessage)) {
          // Found a match
          const explanation = this.generateExplanation(
            patternDef.category,
            errorMessage,
            stepContext
          );

          // For selector errors, get fallback selectors
          let fallbackSelectors: string[] | undefined;
          if (patternDef.category === FailureCategory.SELECTOR_ERROR && stepContext?.selector) {
            const selectorInfo = selectorEnrichment.getSelectorForElement(stepContext.selector);
            if (selectorInfo) {
              fallbackSelectors = [selectorInfo.selector, ...selectorInfo.fallbacks];
            }
          }

          return {
            category: patternDef.category,
            confidence: patternDef.confidence,
            explanation,
            suggestedAction: patternDef.suggestedAction,
            isScriptIssue: patternDef.isScriptIssue,
            fallbackSelectors,
            originalError: errorMessage,
          };
        }
      }
    }

    // No pattern matched - unknown error
    return {
      category: FailureCategory.UNKNOWN,
      confidence: 0.5,
      explanation: `Error does not match any known pattern: ${errorMessage.substring(0, 100)}...`,
      suggestedAction: 'investigate',
      isScriptIssue: false,
      originalError: errorMessage,
    };
  }

  /**
   * Classify a test result (full result with all steps)
   */
  static classifyTestResult(result: TestResult): ClassificationResult {
    if (result.status === 'PASS') {
      return {
        category: FailureCategory.UNKNOWN,
        confidence: 1.0,
        explanation: 'Test passed - no failure to classify',
        suggestedAction: 'investigate',
        isScriptIssue: false,
        originalError: '',
      };
    }

    // Find the failing step
    const failingStep = result.steps.find(s => s.status === 'FAIL');
    const stepContext = failingStep ? {
      action: failingStep.action,
      stepNumber: failingStep.stepNumber,
    } : undefined;

    // Classify the error
    const classification = this.classifyFailure(result.errorMessage || '', stepContext);

    // Enhance with additional context
    if (result.isExecutionFault) {
      classification.category = FailureCategory.EXECUTION_FAULT;
      classification.confidence = 0.9;
      classification.isScriptIssue = true;
      classification.suggestedAction = 'retry';
    }

    return classification;
  }

  /**
   * Determine if a test should be retried
   */
  static shouldRetry(classification: ClassificationResult, retryCount: number = 0): boolean {
    if (classification.suggestedAction !== 'retry') {
      return false;
    }

    // Max 2 retries for selector errors, 1 for execution faults
    const maxRetries = classification.category === FailureCategory.SELECTOR_ERROR ? 2 : 1;
    return retryCount < maxRetries;
  }

  /**
   * Determine if a test should be skipped (not counted as failure)
   */
  static shouldSkip(classification: ClassificationResult): boolean {
    return classification.suggestedAction === 'skip';
  }

  /**
   * Determine if a failure should be reported as a bug
   */
  static shouldReportAsBug(classification: ClassificationResult): boolean {
    return classification.suggestedAction === 'report' && !classification.isScriptIssue;
  }

  /**
   * Get retry strategy for a classification
   */
  static getRetryStrategy(classification: ClassificationResult): {
    shouldRetry: boolean;
    maxRetries: number;
    delayMs: number;
    useFallbackSelectors: boolean;
    increaseTimeout: boolean;
  } {
    const baseStrategy = {
      shouldRetry: classification.suggestedAction === 'retry',
      maxRetries: 0,
      delayMs: 1000,
      useFallbackSelectors: false,
      increaseTimeout: false,
    };

    switch (classification.category) {
      case FailureCategory.SELECTOR_ERROR:
        return {
          ...baseStrategy,
          maxRetries: 2,
          delayMs: 2000,
          useFallbackSelectors: true,
          increaseTimeout: false,
        };

      case FailureCategory.EXECUTION_FAULT:
        return {
          ...baseStrategy,
          maxRetries: 1,
          delayMs: 3000,
          useFallbackSelectors: false,
          increaseTimeout: true,
        };

      // S4-4: Timing faults benefit from the same healing as selector errors.
      case FailureCategory.TIMING_FAULT:
        return {
          ...baseStrategy,
          shouldRetry: true,
          maxRetries: 2,
          delayMs: 2000,
          useFallbackSelectors: true,
          increaseTimeout: true,
        };

      // S4-4: State mismatches can't be fixed by retrying — need regeneration.
      case FailureCategory.STATE_MISMATCH:
        return {
          ...baseStrategy,
          shouldRetry: false,
          maxRetries: 0,
          delayMs: 0,
          useFallbackSelectors: false,
          increaseTimeout: false,
        };

      case FailureCategory.TIMEOUT:
        return {
          ...baseStrategy,
          maxRetries: 1,
          delayMs: 2000,
          useFallbackSelectors: false,
          increaseTimeout: true,
        };

      case FailureCategory.NETWORK_ERROR:
        return {
          ...baseStrategy,
          maxRetries: 2, // Retry transient network errors up to 2x
          delayMs: 5000, // Longer initial delay — network recovery takes time
          useFallbackSelectors: false,
          increaseTimeout: true, // Increase timeout in case server is slow
        };

      default:
        return baseStrategy;
    }
  }

  /**
   * Generate human-readable explanation for classification
   */
  private static generateExplanation(
    category: FailureCategory,
    errorMessage: string,
    stepContext?: { action?: string; selector?: string; stepNumber?: number }
  ): string {
    const stepInfo = stepContext 
      ? `Step ${stepContext.stepNumber || '?'}: "${stepContext.action || '?'}"`
      : '';

    switch (category) {
      case FailureCategory.SELECTOR_ERROR:
        return `${stepInfo ? stepInfo + ' - ' : ''}Element not found. This is likely a test script issue - the selector may be outdated or the element may have changed. Will retry with fallback selectors.`;

      case FailureCategory.ASSERTION_FAILURE:
        return `${stepInfo ? stepInfo + ' - ' : ''}Assertion failed. This indicates a real application defect - the expected condition was not met. Should be reported as a bug.`;

      case FailureCategory.NETWORK_ERROR:
        return `${stepInfo ? stepInfo + ' - ' : ''}Network or server error. This is an environment issue, not a test or application defect. Will be skipped.`;

      case FailureCategory.EXECUTION_FAULT:
        return `${stepInfo ? stepInfo + ' - ' : ''}Test execution infrastructure error. This is a script or environment issue, not a real defect. Will retry with increased timeout.`;

      case FailureCategory.TIMING_FAULT:
        return `${stepInfo ? stepInfo + ' - ' : ''}Browser-lifecycle race condition (target/frame/session closed). Not a real defect — will retry with fallback selectors and longer timeout.`;

      case FailureCategory.STATE_MISMATCH:
        return `${stepInfo ? stepInfo + ' - ' : ''}The step referenced a selector that only exists in a UI state this scenario never reached. The test needs regeneration to add the missing prerequisite action.`;

      case FailureCategory.TIMEOUT:
        return `${stepInfo ? stepInfo + ' - ' : ''}Operation timed out. Could be a slow application, network issue, or test script problem. Requires investigation.`;

      case FailureCategory.SYSTEM_ERROR:
        return `${stepInfo ? stepInfo + ' - ' : ''}System or file access error. This is an environment issue. Will be skipped.`;

      default:
        return `${stepInfo ? stepInfo + ' - ' : ''}Unknown error type. Requires manual investigation.`;
    }
  }

  /**
   * Enhance a test result with classification information
   */
  static enhanceResult(result: TestResult): TestResult & { 
    failureClassification?: ClassificationResult;
    shouldRetry?: boolean;
    shouldSkip?: boolean;
    isRealDefect?: boolean;
  } {
    if (result.status === 'PASS') {
      return {
        ...result,
        shouldRetry: false,
        shouldSkip: false,
        isRealDefect: false,
      };
    }

    const classification = this.classifyTestResult(result);
    const retryStrategy = this.getRetryStrategy(classification);

    return {
      ...result,
      failureClassification: classification,
      shouldRetry: this.shouldRetry(classification),
      shouldSkip: this.shouldSkip(classification),
      isRealDefect: this.shouldReportAsBug(classification),
    };
  }

  /**
   * Get summary statistics for a batch of results
   */
  static getBatchSummary(results: (TestResult & { 
    failureClassification?: ClassificationResult;
    shouldRetry?: boolean;
    shouldSkip?: boolean;
    isRealDefect?: boolean;
  })[]): {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    realDefects: number;
    scriptIssues: number;
    environmentIssues: number;
    needsInvestigation: number;
    passRate: number;
    defectRate: number;
  } {
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const skipped = results.filter(r => r.shouldSkip).length;
    const realDefects = results.filter(r => r.isRealDefect).length;
    const scriptIssues = results.filter(r => r.failureClassification?.isScriptIssue).length;
    const environmentIssues = results.filter(r => 
      r.failureClassification?.category === FailureCategory.NETWORK_ERROR ||
      r.failureClassification?.category === FailureCategory.SYSTEM_ERROR
    ).length;
    const needsInvestigation = results.filter(r => 
      r.failureClassification?.category === FailureCategory.UNKNOWN ||
      r.failureClassification?.category === FailureCategory.TIMEOUT
    ).length;

    return {
      total: results.length,
      passed,
      failed,
      skipped,
      realDefects,
      scriptIssues,
      environmentIssues,
      needsInvestigation,
      passRate: results.length > 0 ? Math.round((passed / results.length) * 100) : 0,
      defectRate: results.length > 0 ? Math.round((realDefects / results.length) * 100) : 0,
    };
  }
}

// ---------------------------------------------------------------------------
// S4-4: State-aware classification + rolling telemetry
// ---------------------------------------------------------------------------

/**
 * Derive a STATE_MISMATCH when the failing step's stateKey references a UI
 * state that no earlier step in the scenario reached. Pure function — returns
 * a new ClassificationResult or null to signal "defer to base classifier".
 */
export function classifyFailureWithState(
  baseClassification: ClassificationResult,
  failingStepStateKey: string | undefined,
  priorStepStateKeys: ReadonlyArray<string | undefined>,
): ClassificationResult {
  if (!failingStepStateKey) return baseClassification;
  // stateKey format: "route:...|modal:<name|none>|tab:<i>|dropdown:<open|none>"
  // We flag a mismatch when the failing step requires modal/tab/dropdown state
  // that no prior step's key claimed to enter.
  const requiresNonDefault =
    failingStepStateKey.includes('|modal:') && !failingStepStateKey.includes('|modal:none') ||
    failingStepStateKey.includes('|tab:') && !failingStepStateKey.includes('|tab:0') ||
    failingStepStateKey.includes('|dropdown:open');
  if (!requiresNonDefault) return baseClassification;

  const reachable = priorStepStateKeys.some(key => key === failingStepStateKey);
  if (reachable) return baseClassification;

  // Only override when the base error is selector- or timeout-shaped. Real
  // assertion failures / network errors are reported as-is.
  const overridable =
    baseClassification.category === FailureCategory.SELECTOR_ERROR ||
    baseClassification.category === FailureCategory.TIMEOUT ||
    baseClassification.category === FailureCategory.UNKNOWN;
  if (!overridable) return baseClassification;

  return {
    ...baseClassification,
    category: FailureCategory.STATE_MISMATCH,
    confidence: Math.max(baseClassification.confidence, 0.8),
    isScriptIssue: true,
    suggestedAction: 'investigate',
    explanation:
      `Step's stateKey (${failingStepStateKey}) was never reached by earlier steps. ` +
      `Likely missing prerequisite (e.g. "Add New" click before filling modal fields).`,
  };
}

/**
 * Rolling in-memory counters for classification and healing outcomes.
 * Exposed via /api/health by the server layer. Zero external deps.
 */
class RollingFailureTelemetry {
  private counts: Record<FailureCategory, number> = {
    [FailureCategory.SELECTOR_ERROR]: 0,
    [FailureCategory.ASSERTION_FAILURE]: 0,
    [FailureCategory.NETWORK_ERROR]: 0,
    [FailureCategory.TIMEOUT]: 0,
    [FailureCategory.EXECUTION_FAULT]: 0,
    [FailureCategory.TIMING_FAULT]: 0,
    [FailureCategory.STATE_MISMATCH]: 0,
    [FailureCategory.SYSTEM_ERROR]: 0,
    [FailureCategory.UNKNOWN]: 0,
  };
  private healAttempts = 0;
  private healSuccesses = 0;
  private healThresholdDrops = 0;

  record(category: FailureCategory): void {
    this.counts[category] = (this.counts[category] || 0) + 1;
  }

  recordHealAttempt(success: boolean): void {
    this.healAttempts++;
    if (success) this.healSuccesses++;
  }

  recordHealThresholdDrop(): void {
    this.healThresholdDrops++;
  }

  snapshot() {
    return {
      categoryCounts: { ...this.counts },
      heal: {
        attempts: this.healAttempts,
        successes: this.healSuccesses,
        thresholdDrops: this.healThresholdDrops,
        successRate:
          this.healAttempts > 0 ? Math.round((this.healSuccesses / this.healAttempts) * 100) : 0,
      },
    };
  }

  reset(): void {
    (Object.keys(this.counts) as FailureCategory[]).forEach(k => (this.counts[k] = 0));
    this.healAttempts = 0;
    this.healSuccesses = 0;
    this.healThresholdDrops = 0;
  }
}

export const failureTelemetry = new RollingFailureTelemetry();

// Export for easy access
export const failureClassification = FailureClassificationService;