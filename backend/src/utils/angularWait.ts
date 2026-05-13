/**
 * angularWait.ts — Zone.js stable wait utility
 *
 * Phase 2.5 Priority 4: replaces hardcoded delay() calls after navigation/login
 * with Angular's own testability API so the executor waits exactly as long as
 * Angular needs, not a fixed 1500–2000 ms guess.
 *
 * Theory (THEORY.md §3): Angular Zone.js patches async primitives and exposes
 * `getAllAngularTestabilities()` on window. Calling `whenStable()` on each
 * testability resolves only after all pending macro/micro tasks have drained —
 * precisely the condition we need before clicking or asserting.
 *
 * Falls back to a short fixed delay when:
 *   - The page is not an Angular app (React, plain HTML, etc.)
 *   - Zone.js is not loaded yet (early in navigation)
 *   - The evaluate call fails (browser closed, frame detached)
 */

import { appLogger } from './logger';

const ANGULAR_STABLE_EXPR = `async () => {
  try {
    const testabilities = typeof window !== 'undefined' && window.getAllAngularTestabilities
      ? window.getAllAngularTestabilities()
      : [];
    if (!testabilities || testabilities.length === 0) {
      await new Promise(r => setTimeout(r, 150));
      return;
    }
    await Promise.all(
      testabilities.map(t => new Promise(resolve => t.whenStable(resolve)))
    );
  } catch (_e) {
    // Zone.js not present — silent fall-through
  }
}`;

/**
 * Wait for Angular's Zone.js to reach a stable state.
 *
 * @param evaluateFn  A function that evaluates a JS expression string in the
 *                    live browser page (i.e. `PlaywrightMcpClient.evaluate`
 *                    bound to the current client instance).
 * @param fallbackMs  Fixed delay used when Angular is not detected (default 200ms).
 * @param timeoutMs   Maximum time to wait for Angular stability (default 5000ms).
 */
export async function waitForAngularStable(
  evaluateFn: (expr: string) => Promise<any>,
  fallbackMs = 200,
  timeoutMs = 5000,
): Promise<void> {
  try {
    // Phase 2.5: added race timeout to prevent hanging on pages with infinite timers/Zone.js polling
    const waitPromise = evaluateFn(ANGULAR_STABLE_EXPR);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`[angularWait] Timed out after ${timeoutMs}ms`)), timeoutMs)
    );

    await Promise.race([waitPromise, timeoutPromise]);
    appLogger.debug('[angularWait] Zone.js stable wait completed');
  } catch (err: any) {
    // evaluate threw or timed out — browser closed, Angular absent, or slow — use fallback
    appLogger.debug(`[angularWait] Stable wait failed/timed out: ${err.message}. Using fallback delay.`);
    await new Promise(r => setTimeout(r, fallbackMs));
  }
}
