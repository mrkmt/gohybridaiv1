/**
 * SmartRetryService — Real-Time AI Script Patching During Execution
 *
 * D6: Smart-Retry Logic
 *
 * Unlike SelfHealingService which re-diagnoses individual failures,
 * this service performs real-time AI patching of the generated Playwright
 * script itself when structural or systemic issues are detected.
 *
 * Use cases:
 * 1. Wrong navigation target — page.goto() URL changed
 * 2. Wrong API endpoint pattern — waitForResponse() regex outdated
 * 3. Structural step change — UI flow modified (new modal, step removed)
 * 4. Batch selector migration — all selectors for a module need updating
 *
 * Flow:
 * 1. Execution fails with a pattern error (not a one-off selector issue)
 * 2. SmartRetryService analyzes the failure pattern
 * 3. Sends the full script + error + DOM context to AI
 * 4. AI returns a patched script (full replacement, not per-step fix)
 * 5. Patched script is re-executed (max 1 retry to prevent loops)
 *
 * This is heavier than SelfHealingService — it rewrites the entire script
 * structure rather than fixing one broken selector.
 */

import { TestCase } from './generation/TestCaseGeneratorService';
import { TestEnvironment, TestResult } from './execution/TestExecutionService';
import { appLogger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FailurePattern =
  | 'navigation_target_changed'
  | 'api_endpoint_changed'
  | 'structural_flow_change'
  | 'batch_selector_migration'
  | 'authentication_change'
  | 'unknown';

export interface SmartRetryResult {
  /** Whether a patch was generated and applied */
  patched: boolean;
  /** The patched script content */
  patchedScript?: string;
  /** Detected failure pattern */
  pattern: FailurePattern;
  /** AI explanation of what changed */
  analysis: string;
  /** Original error message */
  originalError: string;
}

export interface AiPatchResponse {
  patchedScript: string;
  analysis: string;
  changedSteps: string[];
  confidence: number;
}

// ---------------------------------------------------------------------------
// Pattern Detection
// ---------------------------------------------------------------------------

/**
 * Classify a failure into a known pattern.
 * This is more structural than SelfHealingService's per-selector classification.
 */
function detectFailurePattern(
  errorMessage: string,
  script: string,
  testCase: TestCase
): FailurePattern {
  const errLower = errorMessage.toLowerCase();

  // Navigation target changed — page.goto fails because URL changed
  if (
    errLower.includes('navigation') &&
    (errLower.includes('timeout') || errLower.includes('failed') || errLower.includes('refused')) &&
    script.includes('page.goto')
  ) {
    return 'navigation_target_changed';
  }

  // API endpoint changed — waitForResponse can't match the URL
  if (
    errLower.includes('waiting for response') &&
    errLower.includes('timeout') &&
    script.includes('waitForResponse')
  ) {
    return 'api_endpoint_changed';
  }

  // Structural flow change — element expected but flow changed
  if (
    errLower.includes('not found') ||
    errLower.includes('not visible') ||
    errLower.includes('not attached')
  ) {
    // Check if multiple selectors in the same script are failing
    // (indicates structural change, not one-off selector issue)
    if (errorMessage.split('locator').length > 2 || errorMessage.split('selector').length > 2) {
      return 'structural_flow_change';
    }
    return 'batch_selector_migration';
  }

  // Authentication change — login redirect, 401, etc.
  if (
    errLower.includes('401') ||
    errLower.includes('unauthorized') ||
    errLower.includes('login') ||
    errLower.includes('redirect')
  ) {
    return 'authentication_change';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// AI Patching
// ---------------------------------------------------------------------------

/**
 * Build a prompt for AI to patch the script.
 */
function buildPatchPrompt(
  pattern: FailurePattern,
  script: string,
  testCase: TestCase,
  errorMessage: string,
  domSnapshot?: string
): string {
  const patternDescriptions: Record<FailurePattern, string> = {
    navigation_target_changed:
      'The page.goto() target URL no longer works. The application may have changed its routing or URL structure. Update the navigation to use the correct URL.',
    api_endpoint_changed:
      'A waitForResponse() pattern no longer matches any API calls. The backend endpoint URL may have changed. Update the URL pattern in waitForResponse().',
    structural_flow_change:
      'Multiple elements are not found, suggesting the UI flow has changed (steps added, removed, or reordered). Update the test steps to match the current flow.',
    batch_selector_migration:
      'Multiple selectors are failing. The component structure may have changed (e.g., all form fields migrated from formControlName to data-testid). Update all selectors to match the new pattern.',
    authentication_change:
      'The test encountered an authentication issue. The login flow or auth endpoint may have changed. Update the authentication step in the script.',
    unknown:
      'The test failed with an unclear pattern. Analyze the error and DOM context to fix the script.',
  };

  return `
You are a Playwright test script repair engineer.

A generated test script has failed. DO NOT explain — return ONLY the complete patched script.

## Failure Pattern
${pattern}

## What Changed
${patternDescriptions[pattern]}

## Original Error
${errorMessage}

## Original Test Case Description
${testCase.title}
${testCase.description ? `Details: ${testCase.description}` : ''}

## Original Script
\`\`\`typescript
${script}
\`\`\`
${domSnapshot ? `\n## Current DOM Context\n${domSnapshot.substring(0, 5000)}` : ''}

## Rules
1. Return ONLY the complete, patched TypeScript script — no explanation, no markdown
2. Keep the test logic the same (same test intent)
3. Fix ONLY what needs to change based on the failure pattern
4. Use resilient selectors (getByRole, getByLabel, data-testid)
5. Do NOT use waitForTimeout
6. Include waitForAngularStable() for Angular app navigation
7. The script must be a complete, runnable Playwright test

## Output
Return the full patched script as a TypeScript string.
`;
}

/**
 * Call the AI to get a patched script.
 */
async function requestAiPatch(
  prompt: string,
  aiService: any
): Promise<AiPatchResponse | null> {
  try {
    // Try LocalAIService (Qwen CLI)
    const response = await aiService.simpleGenerate(prompt, {
      maxTokens: 4000,
      temperature: 0.2,
    });

    // Extract code from the response
    const codeMatch = response.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    const patchedScript = codeMatch ? codeMatch[1].trim() : response.trim();

    // Parse changed steps (AI usually lists them)
    const changedStepsMatch = response.match(/changed steps?:?\s*[-*\n]([^\n]+)/i);
    const changedSteps = changedStepsMatch
      ? [changedStepsMatch[1].trim()]
      : ['Script patched based on failure analysis'];

    return {
      patchedScript,
      analysis: response.substring(0, 500),
      changedSteps,
      confidence: 0.7, // AI-generated patch, moderate confidence
    };
  } catch (err: any) {
    appLogger.warn(`[SmartRetry] AI patch failed: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class SmartRetryService {

  /** Max smart retries per execution session to prevent infinite loops */
  private static readonly MAX_SMART_RETRIES = 1;

  /** Counter tracking smart retries per ticket */
  private static smartRetryCounters = new Map<string, number>();

  /**
   * Attempt a smart retry with AI script patching.
   *
   * This is called when SelfHealingService has already failed or when
   * the failure pattern is structural (not a single selector issue).
   *
   * @param testCase - The original test case
   * @param script - The compiled Playwright script that failed
   * @param errorMessage - The error that caused the failure
   * @param environment - Test environment config
   * @param aiService - AI service instance for patching
   * @param domSnapshot - Current DOM snapshot (optional)
   * @returns SmartRetryResult or null if max retries exceeded
   */
  static async attemptSmartRetry(
    testCase: TestCase,
    script: string,
    errorMessage: string,
    environment: TestEnvironment,
    aiService: any,
    domSnapshot?: string
  ): Promise<SmartRetryResult | null> {
    const retryKey = testCase.caseId;
    const currentCount = this.smartRetryCounters.get(retryKey) || 0;

    if (currentCount >= this.MAX_SMART_RETRIES) {
      appLogger.warn(
        `[SmartRetry] Max smart retries (${this.MAX_SMART_RETRIES}) exceeded for ${testCase.caseId}. ` +
        `Aborting to prevent infinite loops.`
      );
      return null;
    }

    this.smartRetryCounters.set(retryKey, currentCount + 1);

    appLogger.info(
      `[SmartRetry] Attempt ${currentCount + 1}/${this.MAX_SMART_RETRIES} for ${testCase.caseId}`
    );

    // Step 1: Detect the failure pattern
    const pattern = detectFailurePattern(errorMessage, script, testCase);
    appLogger.info(`[SmartRetry] Detected pattern: ${pattern}`);

    if (pattern === 'unknown') {
      appLogger.warn('[SmartRetry] No recognizable pattern. Skipping AI patch.');
      return null;
    }

    // Step 2: Build the patch prompt
    const prompt = buildPatchPrompt(pattern, script, testCase, errorMessage, domSnapshot);

    // Step 3: Request AI patch
    const patchResult = await requestAiPatch(prompt, aiService);
    if (!patchResult) {
      return null;
    }

    appLogger.info(
      `[SmartRetry] AI patch generated for ${testCase.caseId} (${pattern}). ` +
      `Changed steps: ${patchResult.changedSteps.join(', ')}`
    );

    return {
      patched: true,
      patchedScript: patchResult.patchedScript,
      pattern,
      analysis: patchResult.analysis,
      originalError: errorMessage,
    };
  }

  /**
   * Reset the smart retry counter for a ticket (call at start of new execution).
   */
  static resetCounters(ticketId: string): void {
    // Clear counters for all test cases in this ticket
    for (const key of this.smartRetryCounters.keys()) {
      if (key.includes(ticketId)) {
        this.smartRetryCounters.delete(key);
      }
    }
  }

  /**
   * Reset all counters (call at start of new session).
   */
  static resetAll(): void {
    this.smartRetryCounters.clear();
  }

  /**
   * Get current retry count for a test case.
   */
  static getRetryCount(testCaseId: string): number {
    return this.smartRetryCounters.get(testCaseId) || 0;
  }

  /**
   * Get statistics about smart retry usage.
   */
  static getStats(): { activeCounters: number; totalRetries: number } {
    let totalRetries = 0;
    for (const count of this.smartRetryCounters.values()) {
      totalRetries += count;
    }
    return {
      activeCounters: this.smartRetryCounters.size,
      totalRetries,
    };
  }
}
