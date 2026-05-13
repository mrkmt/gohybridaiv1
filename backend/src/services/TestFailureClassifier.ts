/**
 * Test Failure Classifier
 * 
 * Categorizes test failures into distinct types:
 * - SELECTOR_ERROR: Element not found, locator timeout (test script issue)
 * - ASSERTION_FAILURE: Expected condition false (application bug)
 * - NETWORK_ERROR: Connection refused, 5xx responses (environment/infra)
 * - TIMEOUT: Step took too long (could be either)
 * - OTHER: Unknown failures requiring manual investigation
 */

export type FailureCategory =
  | 'SELECTOR_ERROR'
  | 'ASSERTION_FAILURE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'INFRASTRUCTURE'
  | 'OTHER';

export interface FailureClassification {
  category: FailureCategory;
  confidence: number; // 0-1
  reasoning: string;
  isApplicationBug: boolean;
  shouldRetry: boolean;
  suggestedAction: string;
}

/**
 * Classify test failure based on error message and context
 */
export function classifyFailure(
  errorMessage: string,
  stackTrace?: string,
  url?: string,
  httpStatus?: number
): FailureClassification {
  const error = (errorMessage + ' ' + (stackTrace || '')).toLowerCase();

  // SELECTOR_ERROR: Element not found, locator timeout
  const selectorPatterns = [
    /element.*not.*found/i,
    /locator.*timeout/i,
    /timeout.*exceeded.*selector/i,
    /element.*attached/i,
    /element.*visible/i,
    /element.*hidden/i,
    /expect.*toBeVisible.*timeout/i,
    /expect.*toHaveText.*timeout/i,
    /selector.*not.*exist/i,
    /cannot.*find.*element/i,
  ];

  // ASSERTION_FAILURE: Expected condition false
  const assertionPatterns = [
    /expect.*failed/i,
    /assertion.*failed/i,
    /expected.*but.*got/i,
    /toEqual.*failed/i,
    /toContain.*failed/i,
    /toHaveText.*failed/i,
    /expect.*toBe.*false/i,
    /mismatch/i,
  ];

  // NETWORK_ERROR: Connection issues, 5xx responses
  const networkPatterns = [
    /econnrefused/i,
    /enotfound/i,
    /network.*error/i,
    /fetch.*failed/i,
    /request.*failed/i,
    /5\d{2}/, // 5xx status codes
    /gateway.*timeout/i,
    /bad.*gateway/i,
    /service.*unavailable/i,
    /connection.*reset/i,
    /socket.*hang.*up/i,
  ];

  // TIMEOUT: Generic timeout
  const timeoutPatterns = [
    /timeout/i,
    /timed.*out/i,
    /exceeded.*timeout/i,
    /wait.*timeout/i,
  ];

  // INFRASTRUCTURE: AI CLI service offline, config errors, cascade failures
  const infrastructurePatterns = [
    /econnrefused/i,
    /ai service is offline/i,
    /self.healing.*failed/i,
    /service.*unavailable/i,
    /connection.*refused/i,
    /err_connection_refused/i,
    /enotfound/i,
    /eai_again/i,
    /check.*cli/i,
    /missing api key/i,
    /cli.*failed/i,
    /failed to generate via/i,
    /all (cli|ai) models? failed/i,
    /http 401/i,
    /http 403/i,
    /http 429/i,
    /insufficient_quota/i,
    /rate_limit/i,
    /circuit breaker/i,
  ];

  // Score each category
  const scores = {
    SELECTOR_ERROR: selectorPatterns.filter(p => p.test(error)).length,
    ASSERTION_FAILURE: assertionPatterns.filter(p => p.test(error)).length,
    NETWORK_ERROR: networkPatterns.filter(p => p.test(error)).length,
    TIMEOUT: timeoutPatterns.filter(p => p.test(error)).length,
    INFRASTRUCTURE: infrastructurePatterns.filter(p => p.test(error)).length,
    OTHER: 0,
  };

  // HTTP status overrides
  if (httpStatus) {
    if (httpStatus >= 500) scores.NETWORK_ERROR += 3;
    if (httpStatus === 404) scores.SELECTOR_ERROR += 1;
    if (httpStatus === 401 || httpStatus === 403) scores.ASSERTION_FAILURE += 1;
  }

  // URL context
  if (url && (url.includes('api') || url.includes('rest'))) {
    scores.NETWORK_ERROR += 1;
  }

  // Find highest score
  let maxScore = 0;
  let category: FailureCategory = 'OTHER';
  
  for (const [cat, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      category = cat as FailureCategory;
    }
  }

  // If no patterns matched, check for Angular-specific errors
  if (maxScore === 0) {
    if (error.includes('ng05103') || error.includes('angular')) {
      // Angular stability errors are usually timeouts
      category = 'TIMEOUT';
      maxScore = 1;
    } else if (error.includes('playwright') || error.includes('test')) {
      category = 'OTHER';
    }
  }

  // Calculate confidence
  const confidence = Math.min(maxScore / 3, 1.0); // Normalize to 0-1

  // Determine if it's an application bug
  const isApplicationBug = category === 'ASSERTION_FAILURE' ||
    (category === 'NETWORK_ERROR' && httpStatus !== undefined && httpStatus >= 500);

  // Determine if should retry
  const shouldRetry = category === 'SELECTOR_ERROR' ||
    (category === 'TIMEOUT' && confidence < 0.7) ||
    (category === 'NETWORK_ERROR' && httpStatus !== undefined && httpStatus < 500);

  // Suggested action
  const suggestedActions: Record<FailureCategory, string> = {
    SELECTOR_ERROR: 'Update selector or use fallback selector from ElementRepositoryService',
    ASSERTION_FAILURE: 'Investigate application bug - assertion failed as expected',
    NETWORK_ERROR: 'Check server status and network connectivity',
    TIMEOUT: 'Increase timeout or optimize step performance',
    INFRASTRUCTURE: 'AI CLI service is offline. Please check your Gemini CLI / Qwen CLI installation.',
    OTHER: 'Manual investigation required - insufficient pattern match',
  };

  return {
    category,
    confidence,
    reasoning: `Matched ${maxScore} patterns for ${category}`,
    isApplicationBug,
    shouldRetry,
    suggestedAction: suggestedActions[category],
  };
}

/**
 * Format failure classification for Jira comment
 */
export function formatFailureForJira(classification: FailureClassification): string {
  const emoji = {
    SELECTOR_ERROR: '🔧',
    ASSERTION_FAILURE: '🐛',
    NETWORK_ERROR: '🌐',
    TIMEOUT: '⏱️',
    INFRASTRUCTURE: '🤖',
    OTHER: '❓',
  };

  const bugType = classification.isApplicationBug ? 'Application Bug' : 'Test Script Issue';
  const retryAction = classification.shouldRetry ? 'Auto-retry recommended' : 'Manual review required';

  return `
**Failure Classification:** ${emoji[classification.category]} ${classification.category}
- **Type:** ${bugType}
- **Confidence:** ${(classification.confidence * 100).toFixed(0)}%
- **Reasoning:** ${classification.reasoning}
- **Action:** ${retryAction}
- **Suggestion:** ${classification.suggestedAction}
`.trim();
}
