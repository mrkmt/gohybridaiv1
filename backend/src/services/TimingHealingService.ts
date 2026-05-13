/**
 * TimingHealingService.ts
 *
 * Provides adaptive wait strategies for timeout-related failures.
 * Instead of blindly increasing timeouts, this service analyzes the failure context
 * and applies the optimal wait strategy based on the type of timeout.
 *
 * Based on industry best practices:
 * - Element visibility timeouts → waitForState('visible') with progressive polling
 * - Navigation timeouts → waitForLoadState('domcontentloaded') then waitForLoadState('networkidle')
 * - Animation/transition timeouts → waitForTimeout with animation detection
 * - Network response timeouts → waitForResponse with extended timeout
 */

import { appLogger } from '../utils/logger';

/**
 * Timeout context analysis result
 */
export interface TimingAnalysis {
  /** Type of timeout detected */
  timeoutType: 'element_wait' | 'navigation' | 'animation' | 'network' | 'generic';

  /** Suggested wait strategy */
  strategy: 'progressive_poll' | 'load_state' | 'animation_wait' | 'network_response' | 'extended_timeout';

  /** Recommended timeout in ms */
  recommendedTimeout: number;

  /** Code snippet for the healed wait */
  codeSnippet?: string;

  /** Explanation of why this strategy was chosen */
  explanation: string;

  /** Confidence in this strategy (0-1) */
  confidence: number;
}

/**
 * Timing Healing Service — analyzes timeout context and suggests adaptive wait strategies
 */
export class TimingHealingService {
  /**
   * Analyze a timeout failure and suggest an adaptive wait strategy
   */
  static analyzeTimeout(
    errorMessage: string,
    stepAction?: string,
    stepSelector?: string
  ): TimingAnalysis | null {
    // Navigation timeout
    if (/navigation.*timeout/i.test(errorMessage) || /page\.goto.*timeout/i.test(errorMessage)) {
      return {
        timeoutType: 'navigation',
        strategy: 'load_state',
        recommendedTimeout: 60000,
        codeSnippet: `await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });\nawait page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});`,
        explanation: 'Navigation timeout — using two-phase load: DOM first, then network idle. This handles slow servers and SPAs that load resources asynchronously.',
        confidence: 0.85,
      };
    }

    // Element visibility/attachment timeout
    if (/waiting for.*to be.*visible/i.test(errorMessage) || /waiting for.*to be.*attached/i.test(errorMessage)) {
      return {
        timeoutType: 'element_wait',
        strategy: 'progressive_poll',
        recommendedTimeout: 30000,
        codeSnippet: `await expect(locator).toBeVisible({ timeout: 30000 });`,
        explanation: 'Element wait timeout — using Playwright\'s built-in auto-wait with progressive polling. This automatically retries until the element is visible, handling animations and lazy loading.',
        confidence: 0.9,
      };
    }

    // Network response timeout
    if (/waitForResponse.*timeout/i.test(errorMessage) || /waiting for.*response/i.test(errorMessage)) {
      return {
        timeoutType: 'network',
        strategy: 'network_response',
        recommendedTimeout: 45000,
        codeSnippet: `const [response] = await Promise.all([\n  page.waitForResponse(res => res.url().includes('${this.extractUrlPattern(errorMessage)}'), { timeout: 45000 }),\n  page.locator('${stepSelector || ''}').click()\n]);`,
        explanation: 'Network response timeout — using waitForResponse with extended timeout. The response may be slow due to server load or network latency.',
        confidence: 0.75,
      };
    }

    // Animation/transition timeout (generic timeout with click/action context)
    if (/timeout.*\d+ms/i.test(errorMessage) && (stepAction?.includes('click') || stepAction?.includes('hover'))) {
      return {
        timeoutType: 'animation',
        strategy: 'animation_wait',
        recommendedTimeout: 15000,
        codeSnippet: `// Animation/transition detected — waiting for UI to stabilize\nawait page.waitForTimeout(500);\nawait locator.click({ timeout: 15000 });`,
        explanation: 'Animation timeout — the element may be transitioning or covered by an animation. Adding a short stabilization wait before retrying.',
        confidence: 0.7,
      };
    }

    // Generic timeout
    if (/timeout/i.test(errorMessage)) {
      return {
        timeoutType: 'generic',
        strategy: 'extended_timeout',
        recommendedTimeout: 45000,
        explanation: 'Generic timeout — increasing timeout as a fallback. This may indicate a slow server, heavy page, or network issue. Consider investigating the application performance.',
        confidence: 0.5,
      };
    }

    return null;
  }

  /**
   * Apply timing healing — re-execute with adaptive wait strategy
   * Returns a code snippet that can be injected into the failing step
   */
  static attemptTimingHealing(
    errorMessage: string,
    stepAction?: string,
    stepSelector?: string
  ): { codeSnippet: string; explanation: string; confidence: number } | null {
    const analysis = this.analyzeTimeout(errorMessage, stepAction, stepSelector);

    if (!analysis) {
      appLogger.info('[TimingHealing] No timing pattern detected in error message');
      return null;
    }

    appLogger.info(`[TimingHealing] Detected ${analysis.timeoutType} timeout — applying ${analysis.strategy} strategy (${analysis.confidence.toFixed(2)})`);
    appLogger.info(`[TimingHealing] ${analysis.explanation}`);

    return {
      codeSnippet: analysis.codeSnippet || `// Increased timeout to ${analysis.recommendedTimeout}ms`,
      explanation: analysis.explanation,
      confidence: analysis.confidence,
    };
  }

  /**
   * Extract URL pattern from error message for network response healing
   */
  private static extractUrlPattern(errorMessage: string): string {
    const urlMatch = errorMessage.match(/https?:\/\/[^\s"'<>]+/);
    return urlMatch ? urlMatch[0] : 'api';
  }
}
