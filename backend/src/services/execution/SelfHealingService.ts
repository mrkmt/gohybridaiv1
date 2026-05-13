import { TestCase, TestStep } from '../generation/TestCaseGeneratorService';
import { TestEnvironment, TestExecutionService, TestResult } from './TestExecutionService';
import { VisualForensicsService, ForensicDiagnostic } from '../VisualForensicsService';
import { SelectorValidatorService } from './SelectorValidatorService';
import { SAFE_FALLBACK_MAP } from './SafeFallbackMap';
import { appLogger } from '../../utils/logger';
import type { Pool } from 'pg';
import { failureTelemetry } from './FailureClassificationService';

// S4-4: category-aware healing thresholds. Selector / dialog / timing
// categories are the highest-value healing targets and tolerate lower
// diagnostic confidence; everything else keeps the conservative 0.4 bar.
const HEALING_THRESHOLD_BY_CATEGORY: Record<string, number> = {
    SELECTOR_ERROR: 0.25,
    DIALOG_NOT_VISIBLE: 0.25,
    API_TIMEOUT: 0.35,
};
const HEALING_THRESHOLD_DEFAULT = 0.4;

function thresholdFor(category: string | undefined): number {
    if (!category) return HEALING_THRESHOLD_DEFAULT;
    return HEALING_THRESHOLD_BY_CATEGORY[category] ?? HEALING_THRESHOLD_DEFAULT;
}

/** Maximum number of healing attempts per test case + error combination before aborting to prevent infinite loops */
const MAX_HEALING_ATTEMPTS = 3;

/** TTL in milliseconds — healing counters expire after 1 hour to prevent memory leaks */
const HEALING_COUNTER_TTL_MS = 60 * 60 * 1000;

interface HealingCounterEntry {
    count: number;
    createdAt: number;
}

/** In-memory counter tracking healing attempts per test case + error signature (expires after TTL) */
const healingAttemptCounts = new Map<string, HealingCounterEntry>();

/** DB pool for persisting healing counters (survives server restarts) */
let dbPool: Pool | null = null;

/**
 * Set the DB pool for persisting healing counters.
 * Call this during application startup.
 */
export function setDbPool(pool: Pool | null): void {
    dbPool = pool;
}

/**
 * Expire old healing counters to prevent memory leaks.
 * Should be called periodically (e.g., every 10 minutes).
 */
function expireOldCounters(): void {
    const now = Date.now();
    for (const [key, entry] of healingAttemptCounts.entries()) {
        if (now - entry.createdAt > HEALING_COUNTER_TTL_MS) {
            healingAttemptCounts.delete(key);
        }
    }
}

/** Expire old counters every 10 minutes */
let expireInterval: NodeJS.Timeout | null = null;
function startExpiryTimer(): void {
    if (expireInterval) return;
    expireInterval = setInterval(() => {
        expireOldCounters();
    }, 10 * 60 * 1000);
    expireInterval.unref(); // Don't prevent process exit
}

// Start the expiry timer immediately
startExpiryTimer();

export interface OfflineDiagnosticResult {
    /** Failure category for classification */
    category: string;
    /** Confidence in the diagnosis (0-1) */
    confidence: number;
    /** Human-readable explanation of the issue */
    suggestion: string;
    /** Recommended action to fix the test */
    action: string;
    /** New selector to try (if applicable) */
    newSelector?: string;
    /** Code snippet to inject (if applicable) */
    codeSnippet?: string;
}

export class SelfHealingService {
    /**
     * Attempt to heal a failed test case and re-run it
     * @param testCase - The original test case
     * @param environment - The test environment
     * @param ticketId - The Jira ticket ID
     * @param originalResult - The failed test result
     * @returns The result of the healed run
     */
    static async attemptHealing(
        testCase: TestCase,
        environment: TestEnvironment,
        ticketId: string,
        originalResult: TestResult
    ): Promise<TestResult | null> {
        appLogger.info(`[SelfHealing] Attempting to heal ${testCase.caseId} for ${ticketId}...`);

        // --- Healing loop detection: abort after MAX_HEALING_ATTEMPTS ---
        const errorSignature = (originalResult.errorMessage || 'unknown').substring(0, 100);
        const currentAttempts = await this.getHealingCount(ticketId, testCase.caseId, errorSignature);

        if (currentAttempts >= MAX_HEALING_ATTEMPTS) {
            appLogger.warn(`[SelfHealing] Aborting — exceeded ${MAX_HEALING_ATTEMPTS} healing attempts for ${testCase.caseId}`);
            return null;
        }

        await this.incrementHealingCount(ticketId, testCase.caseId, errorSignature);
        appLogger.info(`[SelfHealing] Healing attempt ${currentAttempts + 1}/${MAX_HEALING_ATTEMPTS} for ${testCase.caseId}`);

        // --- P1 #6: Instant fix via SAFE_FALLBACK_MAP ---
        const failingStepIndex = testCase.steps.findIndex(s => 
            originalResult.steps.some(rs => rs.stepNumber === s.stepNumber && rs.status === 'FAIL')
        );
        const failingStep = failingStepIndex !== -1 ? testCase.steps[failingStepIndex] : null;
        const originalSelector = failingStep?.selectorHint || '';

        if (originalSelector && SAFE_FALLBACK_MAP[originalSelector]) {
            const fallbacks = SAFE_FALLBACK_MAP[originalSelector];
            appLogger.info(`[SelfHealing] SAFE_FALLBACK_MAP hit for "${originalSelector}". Trying ${fallbacks.length} known alternates...`);
            
            for (const fallback of fallbacks) {
                const healedTestCase = { ...testCase };
                healedTestCase.steps = [...testCase.steps];
                healedTestCase.steps[failingStepIndex] = {
                    ...healedTestCase.steps[failingStepIndex],
                    selectorHint: fallback
                };

                const result = await TestExecutionService.executeTestCase(
                    healedTestCase, environment, ticketId, 120000, 
                    `// INSTANT HEAL: Replaced broken selector "${originalSelector}" with known fallback "${fallback}"`
                );

                if (result.status === 'PASS') {
                    appLogger.info(`[SelfHealing] Instant fix succeeded with fallback: ${fallback}`);
                    return result;
                }
            }
            appLogger.info('[SelfHealing] All instant fallbacks failed. Proceeding to AI diagnosis.');
        }

        // 1. Diagnose the failure
        const diagnostic = await VisualForensicsService.diagnoseFailure(
            originalResult.errorMessage || 'Unknown error',
            originalResult.steps.find(s => s.status === 'FAIL')?.action || 'Last step before failure',
            originalResult.screenshotPaths[originalResult.screenshotPaths.length - 1], // Last screenshot taken
            originalResult.domSnapshotPath,
            originalResult.a11ySnapshotPath
        );

        // S4-4: category-aware threshold. Selector-class failures heal at 0.25
        // so we don't throw away a 0.3-confidence selector-miss diagnosis.
        const threshold = thresholdFor((diagnostic as any).category);
        if (diagnostic.confidence < threshold) {
            failureTelemetry.recordHealThresholdDrop();
            appLogger.info(
                `[SelfHealing] Diagnostic confidence ${diagnostic.confidence.toFixed(2)} < threshold ${threshold} ` +
                `(category=${(diagnostic as any).category ?? 'unknown'}). Skipping auto-healing.`,
            );
            return null;
        }

        appLogger.info(`[SelfHealing] Diagnostic found: ${diagnostic.reason}`);
        appLogger.info(`[SelfHealing] Suggested Fix: ${diagnostic.suggestedFix}`);

        // 2. Wrap the suggested fix into a "Healing Hint"
        const healingHint = `
/* 
 * AUTO-HEALING ATTEMPT 
 * Previous Failure: ${diagnostic.reason}
 * Corrective Action: ${diagnostic.suggestedFix}
 */
`;
        
        // 3. Mark the test case as being in a "healed" state and APPLY FIXED SELECTOR
        const healedTestCase = { ...testCase };
        
        // If the diagnostic provided a new selector, update the failing step
        if (diagnostic.newSelector) {
            appLogger.info(`[SelfHealing] Applying new selector to ${testCase.caseId}: ${diagnostic.newSelector}`);
            const failingStepIndex = testCase.steps.findIndex(s => 
                originalResult.steps.some(rs => rs.stepNumber === s.stepNumber && rs.status === 'FAIL')
            );
            
            if (failingStepIndex !== -1) {
                healedTestCase.steps = [...testCase.steps];
                healedTestCase.steps[failingStepIndex] = {
                    ...healedTestCase.steps[failingStepIndex],
                    selectorHint: diagnostic.newSelector || undefined,
                    customCode: diagnostic.suggestedFix // Inject the code snippet directly
                };
            }
        }
        
        // 4. Re-execute with the healing hint
        try {
            appLogger.info('[SelfHealing] Starting healed run...');
            const result = await TestExecutionService.executeTestCase(
                healedTestCase,
                environment,
                ticketId,
                600000, // Double timeout for healed runs 
                healingHint // Passing the hint to the script generator
            );
            
            appLogger.info(`[SelfHealing] Healed run completed with status: ${result.status}`);
            // S4-4: telemetry — count healing attempts and their outcomes so
            // we can tune thresholds from data, not vibes.
            failureTelemetry.recordHealAttempt(result.status === 'PASS');
            return result;
        } catch (err: any) {
            appLogger.error('[SelfHealing] Healed run failed', { error: err.message });
            failureTelemetry.recordHealAttempt(false);
            return null;
        }
    }

    /**
     * Offline diagnostic fallback — rule-based failure analysis when all
     * AI models are rate-limited or unavailable.
     *
     * This method examines the error message and DOM snapshot to classify
     * the failure and suggest a fix without needing any AI API calls.
     *
     * @param result - The failed test result
     * @param testCase - The original test case
     * @returns Diagnostic result or null if no pattern matched
     */
    static runOfflineDiagnostic(
        result: TestResult,
        testCase: TestCase
    ): OfflineDiagnosticResult | null {
        const errorMessage = result.errorMessage || '';
        const failingStep = result.steps.find(s => s.status === 'FAIL');
        const failingStepAction = failingStep?.action || 'Unknown step';

        appLogger.info('[SelfHealing] Running offline diagnostic...', {
            error: errorMessage.slice(0, 200),
            failingStep: failingStepAction,
        });

        // --- Pattern 1: Element not found / locator timeout ---
        if (errorMessage.includes('locator') && errorMessage.includes('Timeout')) {
            // Extract the selector from the error message if possible
            const selectorMatch = errorMessage.match(/locator\('([^']+)'\)/);
            const originalSelector = selectorMatch ? selectorMatch[1] : '';

            // Check if this is a text-based button selector
            if (SelectorValidatorService.needsIconFallback(originalSelector)) {
                // Extract button text/intent from the has-text pattern
                const textMatch = originalSelector.match(/has-text\(["'](.+?)["']\)/);
                if (textMatch) {
                    const buttonIntent = textMatch[1];
                    const robustSelector = SelectorValidatorService.buildButtonSelectorChain(buttonIntent);

                    return {
                        category: 'ICON_ONLY_BUTTON',
                        confidence: 0.90,
                        suggestion: `Element "${buttonIntent}" is an icon-only button with no text content. The selector "${originalSelector}" uses has-text() which cannot match. Switch to a multi-strategy selector that checks title, aria-label, and Kendo icon classes.`,
                        action: 'replace_with_icon_aware_selector',
                        newSelector: robustSelector,
                        codeSnippet: `await healedClick(page, '${robustSelector.replace(/'/g, "\\'")}', { timeout: 30000 });`,
                    };
                }
            }

            // Generic element not found
            return {
                category: 'SELECTOR_NOT_FOUND',
                confidence: 0.75,
                suggestion: `Element selector did not match any visible element. This could be caused by: (1) page not fully loaded, (2) selector is outdated due to UI changes, (3) element hidden behind a modal or overlay. The failing step was: "${failingStepAction}".`,
                action: 'verify_page_load_and_retry',
            };
        }

        // --- Pattern 2: Network error ---
        if (errorMessage.includes('net::ERR_')) {
            const errCode = errorMessage.match(/net::(ERR_[A-Z_]+)/)?.[1] || 'UNKNOWN';
            return {
                category: 'INFRASTRUCTURE',
                confidence: 0.95,
                suggestion: `Network error detected: ${errCode}. Check connectivity and target URL. The server may be unreachable or rejecting the connection.`,
                action: 'retry_after_delay',
            };
        }

        // --- Pattern 3: Navigation failed ---
        if (errorMessage.includes('page.goto')) {
            const urlMatch = errorMessage.match(/page\.goto\('([^']+)'\)/);
            return {
                category: 'NAVIGATION',
                confidence: 0.90,
                suggestion: `Page navigation failed. URL: ${urlMatch ? urlMatch[1] : 'unknown'}. Check if the URL is correct and the server is running.`,
                action: 'retry_navigation',
            };
        }

        // --- Pattern 4: Element covered / intercepted ---
        if (errorMessage.includes('intercept') || errorMessage.includes('covered') || errorMessage.includes('clickable at this point')) {
            return {
                category: 'ELEMENT_COVERED',
                confidence: 0.80,
                suggestion: 'Element is covered by a loading mask, modal overlay, or another UI element. Wait for loading to complete or dismiss overlays before interacting.',
                action: 'wait_for_loading_mask',
            };
        }

        // --- Pattern 5: Dialog/form not visible ---
        if (errorMessage.includes('visible') && (errorMessage.includes('dialog') || errorMessage.includes('modal') || errorMessage.includes('form'))) {
            return {
                category: 'DIALOG_NOT_VISIBLE',
                confidence: 0.75,
                suggestion: 'Dialog, modal, or form did not appear within the timeout. Check if the prerequisite action (e.g., clicking "Add New") completed successfully.',
                action: 'wait_for_dialog',
            };
        }

        // --- Pattern 6: API response timeout ---
        if (errorMessage.includes('waitForResponse') && errorMessage.includes('Timeout')) {
            return {
                category: 'API_TIMEOUT',
                confidence: 0.85,
                suggestion: 'Expected API response did not arrive within the timeout. The endpoint may be slow, returning a different status code, or the URL pattern may not match the actual request.',
                action: 'extend_api_timeout_or_fix_pattern',
            };
        }

        // --- Pattern 7: Assertion failure (test logic issue, not selector) ---
        if (errorMessage.includes('expect') || errorMessage.includes('AssertionError')) {
            return {
                category: 'ASSERTION_FAILURE',
                confidence: 0.90,
                suggestion: 'Test assertion failed — the element or value did not match expectations. This is a test logic issue, not a selector problem. Review the expected value vs actual value.',
                action: 'review_assertion',
            };
        }

        // --- Unknown pattern — cannot diagnose offline ---
        appLogger.info('[SelfHealing] Offline diagnostic could not classify this failure.', {
            error: errorMessage.slice(0, 200),
        });
        return null;
    }

    /**
     * Get healing count from DB (with in-memory fallback)
     */
    private static async getHealingCount(ticketId: string, caseId: string, errorSignature: string): Promise<number> {
        // Try DB first
        if (dbPool) {
            try {
                const result = await dbPool.query(
                    `SELECT count FROM healing_counters 
                     WHERE ticket_id = $1 AND case_id = $2 AND error_signature = $3 
                     AND expires_at > NOW() 
                     LIMIT 1`,
                    [ticketId, caseId, errorSignature]
                );
                if (result.rows.length > 0) {
                    return result.rows[0].count;
                }
            } catch (err) {
                appLogger.warn(`[SelfHealing] DB read failed, using in-memory: ${err}`);
            }
        }

        // Fallback to in-memory
        const attemptKey = `${ticketId}:${caseId}:${errorSignature}`;
        return healingAttemptCounts.get(attemptKey)?.count || 0;
    }

    /**
     * Increment healing count in both DB and in-memory
     */
    private static async incrementHealingCount(ticketId: string, caseId: string, errorSignature: string): Promise<void> {
        // Update in-memory
        const attemptKey = `${ticketId}:${caseId}:${errorSignature}`;
        const existing = healingAttemptCounts.get(attemptKey);
        healingAttemptCounts.set(attemptKey, {
            count: (existing?.count || 0) + 1,
            createdAt: existing?.createdAt || Date.now(),
        });

        // Update DB
        if (dbPool) {
            try {
                await dbPool.query(
                    `INSERT INTO healing_counters (ticket_id, case_id, error_signature, count, expires_at)
                     VALUES ($1, $2, $3, 1, NOW() + INTERVAL '1 hour')
                     ON CONFLICT (ticket_id, case_id, error_signature)
                     DO UPDATE SET count = healing_counters.count + 1, 
                                   updated_at = NOW(),
                                   expires_at = NOW() + INTERVAL '1 hour'`,
                    [ticketId, caseId, errorSignature]
                );
            } catch (err) {
                appLogger.warn(`[SelfHealing] DB write failed: ${err}`);
            }
        }
    }

    /**
     * Reset healing attempt counters for a specific test case.
     * Call this at the start of a new execution session.
     */
    static async resetHealingCounter(ticketId: string, testCaseId: string): Promise<void> {
        // Delete from DB
        if (dbPool) {
            try {
                await dbPool.query(
                    `DELETE FROM healing_counters WHERE ticket_id = $1 AND case_id = $2`,
                    [ticketId, testCaseId]
                );
            } catch (err) {
                appLogger.warn(`[SelfHealing] DB reset failed: ${err}`);
            }
        }

        // Delete from in-memory
        const prefix = `${ticketId}:${testCaseId}:`;
        for (const key of healingAttemptCounts.keys()) {
            if (key.startsWith(prefix)) {
                healingAttemptCounts.delete(key);
            }
        }
    }

    /**
     * Reset all healing counters (useful for test cleanup or session reset).
     */
    static async resetAllHealingCounters(): Promise<void> {
        // Clear DB
        if (dbPool) {
            try {
                await dbPool.query(`DELETE FROM healing_counters`);
            } catch (err) {
                appLogger.warn(`[SelfHealing] DB clear failed: ${err}`);
            }
        }

        // Clear in-memory
        healingAttemptCounts.clear();
        appLogger.info('[SelfHealing] All healing counters reset.');
    }
}
