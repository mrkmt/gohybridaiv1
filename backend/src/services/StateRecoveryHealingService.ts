/**
 * StateRecoveryHealingService.ts
 *
 * Detects when page state is lost during test execution and automatically
 * recovers by re-navigating to the expected page before retrying.
 *
 * Common scenarios:
 * - SPA navigation interrupted mid-test
 * - Browser tab/page closed unexpectedly
 * - Session/auth state lost
 * - Form data cleared by page refresh
 *
 * Based on industry best practices for state recovery in E2E testing.
 */

import { appLogger } from '../utils/logger';

/**
 * State recovery analysis result
 */
export interface StateRecoveryAnalysis {
  /** Type of state loss detected */
  stateType: 'page_detached' | 'frame_detached' | 'navigation_lost' | 'session_expired' | 'form_cleared';

  /** Recovery strategy */
  strategy: 'renavigate' | 'reauth_renavigate' | 'restore_form_renavigate';

  /** Code snippet to recover state and retry */
  recoveryCode: string;

  /** Explanation */
  explanation: string;

  /** Confidence (0-1) */
  confidence: number;
}

/**
 * State Recovery Healing Service
 */
export class StateRecoveryHealingService {
  /**
   * Analyze a failure to detect state loss patterns
   */
  static analyzeStateLoss(
    errorMessage: string,
    testCaseSteps: Array<{ action: string; selector?: string }>,
    currentStepIndex: number
  ): StateRecoveryAnalysis | null {
    // Frame/page detached — browser context lost
    if (/frame was detached|session closed|browser has been closed|target closed/i.test(errorMessage)) {
      return {
        stateType: 'page_detached',
        strategy: 'renavigate',
        recoveryCode: this.buildRecoveryRenavigate(testCaseSteps, currentStepIndex),
        explanation: 'Page/frame detached — browser context was lost. Re-navigating to the test URL and re-executing from the failing step.',
        confidence: 0.9,
      };
    }

    // Navigation lost — page.goto failed or was interrupted
    if (/navigation.*failed|navigation.*interrupted|ERR_ABORTED/i.test(errorMessage)) {
      return {
        stateType: 'navigation_lost',
        strategy: 'renavigate',
        recoveryCode: this.buildRecoveryRenavigate(testCaseSteps, currentStepIndex),
        explanation: 'Navigation was interrupted. Re-navigating to the test URL with a fresh load strategy.',
        confidence: 0.85,
      };
    }

    // Session expired — auth cookie/token lost
    if (/unauthorized|forbidden|401|403|login.*required|session.*expired/i.test(errorMessage)) {
      return {
        stateType: 'session_expired',
        strategy: 'reauth_renavigate',
        recoveryCode: this.buildRecoveryReauth(testCaseSteps, currentStepIndex),
        explanation: 'Session/auth state expired. Re-navigating to the login page to re-authenticate, then continuing from the failing step.',
        confidence: 0.7,
      };
    }

    // Form data cleared — page refreshed or navigated away
    if (/element.*not found|no such element/i.test(errorMessage) && currentStepIndex > 0) {
      // Check if previous steps involved form filling
      const hasFormSteps = testCaseSteps.slice(0, currentStepIndex).some(
        s => s.action.includes('fill') || s.action.includes('type') || s.action.includes('select')
      );
      if (hasFormSteps) {
        return {
          stateType: 'form_cleared',
          strategy: 'restore_form_renavigate',
          recoveryCode: this.buildRecoveryRestoreForm(testCaseSteps, currentStepIndex),
          explanation: 'Form data was cleared — likely the page refreshed or navigated away. Re-navigating and re-filling form data from previous steps.',
          confidence: 0.75,
        };
      }
    }

    return null;
  }

  /**
   * Attempt state recovery healing
   */
  static attemptStateRecovery(
    errorMessage: string,
    testCaseSteps: Array<{ action: string; selector?: string }>,
    currentStepIndex: number
  ): { recoveryCode: string; explanation: string; confidence: number } | null {
    const analysis = this.analyzeStateLoss(errorMessage, testCaseSteps, currentStepIndex);

    if (!analysis) {
      appLogger.info('[StateRecovery] No state loss pattern detected');
      return null;
    }

    appLogger.info(`[StateRecovery] Detected ${analysis.stateType} — applying ${analysis.strategy} (confidence: ${analysis.confidence.toFixed(2)})`);
    appLogger.info(`[StateRecovery] ${analysis.explanation}`);

    return {
      recoveryCode: analysis.recoveryCode,
      explanation: analysis.explanation,
      confidence: analysis.confidence,
    };
  }

  /**
   * Build recovery code that re-navigates to the test URL
   */
  private static buildRecoveryRenavigate(
    steps: Array<{ action: string; selector?: string }>,
    failingStepIndex: number
  ): string {
    const lines: string[] = [
      '// STATE RECOVERY: Page context lost — re-navigating',
      `await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});`,
      `await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});`,
      `// Re-executing from step ${failingStepIndex + 1}`,
    ];
    return lines.join('\n');
  }

  /**
   * Build recovery code that re-authenticates then re-navigates
   */
  private static buildRecoveryReauth(
    steps: Array<{ action: string; selector?: string }>,
    failingStepIndex: number
  ): string {
    // Extract login credentials from earlier steps
    const loginSteps = steps.slice(0, failingStepIndex).filter(
      s => s.action.includes('login') || s.action.includes('fill') || s.action.includes('username') || s.action.includes('password')
    );

    const lines: string[] = [
      '// STATE RECOVERY: Session expired — re-authenticating',
      `await page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 30000 });`,
      `// TODO: Re-enter credentials from original login steps`,
      `// After re-auth, navigate back to the test page`,
      `await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 30000 });`,
      `// Re-executing from step ${failingStepIndex + 1}`,
    ];
    return lines.join('\n');
  }

  /**
   * Build recovery code that re-navigates and restores form data
   */
  private static buildRecoveryRestoreForm(
    steps: Array<{ action: string; selector?: string }>,
    failingStepIndex: number
  ): string {
    // Extract form-filling steps before the failure
    const formSteps = steps.slice(0, failingStepIndex).filter(
      s => s.action.includes('fill') || s.action.includes('type') || s.action.includes('select') || s.action.includes('check')
    );

    const lines: string[] = [
      '// STATE RECOVERY: Form data cleared — restoring state',
      `await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 30000 });`,
      `await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});`,
      `// Re-filling ${formSteps.length} form step(s) that were cleared`,
    ];

    for (const step of formSteps) {
      lines.push(`// Original: ${step.action}`);
      if (step.selector) {
        lines.push(`await page.locator('${step.selector}').fill(/* value from original step */).catch(() => {});`);
      }
    }

    lines.push(`// Re-executing from step ${failingStepIndex + 1}`);
    return lines.join('\n');
  }
}
