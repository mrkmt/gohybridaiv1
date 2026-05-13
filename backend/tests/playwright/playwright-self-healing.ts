/**
 * Playwright Self-Healing Helpers
 *
 * Shared helper functions used by ALL generated Playwright tests.
 * Provides Angular/Kendo stabilization, healed clicks, and universal fills.
 *
 * These are imported by generated tests via:
 *   import { healedClick, waitForAngular, universalFill, ... } from '../../tests/playwright/playwright-self-healing';
 */

import { Page, Locator } from 'playwright';

function splitSelectorCandidates(selector: string): string[] {
  const s = (selector || '').trim();
  if (!s) return [];

  const out: string[] = [];
  let current = '';

  let inSingle = false;
  let inDouble = false;
  let bracketDepth = 0; // []
  let parenDepth = 0; // ()

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (ch === '\\') {
      current += ch;
      if (i + 1 < s.length) {
        current += s[i + 1];
        i++;
      }
      continue;
    }

    if (!inDouble && ch === '\'') {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble) {
      if (ch === '[') bracketDepth++;
      if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      if (ch === '(') parenDepth++;
      if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);

      if (ch === ',' && bracketDepth === 0 && parenDepth === 0) {
        const trimmed = current.trim();
        if (trimmed) out.push(trimmed);
        current = '';
        continue;
      }
    }

    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed) out.push(trimmed);

  return Array.from(new Set(out));
}

async function tryHealedClickOnLocator(page: Page, locator: Locator, timeout: number, label: string): Promise<void> {
  await waitForAngular(page);
  await waitForKendoLoadingHidden(page, 5000);

  try {
    await retryStep(
      () => locator.waitFor({ state: 'visible', timeout }),
      { maxRetries: 1, backoffMs: 350, label: `waitForVisible: ${label}` },
    );
  } catch {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
    } catch {
      // best-effort
    }
  }

  await retryStep(
    async () => {
      try {
        await locator.click({ timeout });
      } catch {
        await locator.click({ timeout, force: true });
      }
    },
    { maxRetries: 1, backoffMs: 250, label: `click: ${label}` },
  );

  await page.waitForTimeout(250);
  await waitForAngular(page);
}

// ============================================================================
// Step-Level Retry
// ============================================================================

/**
 * Retry an individual Playwright action with configurable retries and backoff.
 *
 * This is the core resilience mechanism — wraps every click, fill, and wait
 * so that transient failures (loading masks, Angular delays, race conditions)
 * are automatically retried before failing the test.
 *
 * @param action - The async action to retry
 * @param options.maxRetries - Number of retries after the first attempt (default: 2)
 * @param options.backoffMs - Delay between retries in ms (default: 500)
 * @param options.label - Descriptive label for logging (default: 'step')
 * @throws The last error if all retries are exhausted
 */
export async function retryStep(
  action: () => Promise<void>,
  options: { maxRetries?: number; backoffMs?: number; label?: string } = {},
): Promise<void> {
  const maxRetries = options.maxRetries ?? 2;
  const backoffMs = options.backoffMs ?? 500;
  const label = options.label ?? 'step';

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await action();
      return; // Success
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw lastError;
}

// ============================================================================
// Angular / Kendo Stabilization
// ============================================================================

/**
 * Wait for Angular application to be ready and Zone.js to be stable.
 *
 * Uses Angular's own Testability API (testability.whenStable) — the ONLY
 * deterministic way to wait for Angular, replacing all arbitrary waitForTimeout().
 *
 * Supports:
 * - Angular 2+ via window.getAllAngularTestabilities()
 * - AngularJS 1.x via window.angular.getTestability()
 * - Non-Angular apps (returns immediately)
 *
 * @param page - Playwright page
 * @param timeoutMs - Max wait time (default: 30 seconds)
 */
export async function waitForAngular(page: Page, timeoutMs: number = 30000): Promise<void> {
  try {
    await page.waitForFunction(() => {
      // Not an Angular app — proceed immediately
      const ngEl = document.querySelector('[ng-version]');
      if (!ngEl) return true;

      // Angular 2+: use Testability API
      const testabilities = (window as any).getAllAngularTestabilities?.();
      if (testabilities && Array.isArray(testabilities)) {
        // All testabilities must be stable
        return testabilities.every((t: any) => t.isStable === true);
      }

      // AngularJS 1.x fallback
      const ng = (window as any).angular;
      if (ng?.getTestability) {
        const rootEl = ng.element(document).injector()?.get?.('$testability');
        if (rootEl) return !rootEl.isPending();
      }

      // Last resort: Zone.js stability
      const zone = (window as any).ngZone;
      if (zone && zone.isStable !== undefined) {
        return zone.isStable === true;
      }

      // Angular element exists but no testability — assume ready
      return document.readyState === 'complete';
    }, { timeout: timeoutMs, polling: 100 });
  } catch {
    // Angular check failed — continue anyway (may be a broken Angular app or non-Angular page)
  }
}

/**
 * Alias for waitForAngular — used by TestExecutionEngine and TestExecutionService.
 */
export async function waitForAngularStable(page: Page, timeout: number = 30000): Promise<void> {
  await waitForAngular(page, timeout);
}

/**
 * Wait for the application to be fully loaded and responsive.
 * Combines Angular stabilization with a short buffer for rendering.
 */
export async function waitForAppReady(page: Page): Promise<void> {
  await waitForAngular(page);
  await page.waitForTimeout(1000); // Increased from 500ms
}

/**
 * Wait for Kendo loading masks to disappear.
 * Handles .k-loading-mask, .loading-overlay, and .spinner-border.
 */
export async function waitForKendoLoadingHidden(page: Page, timeoutMs: number = 15000): Promise<void> {
  try {
    const mask = page.locator('.k-loading-mask, .loading-overlay, .spinner-border');
    const count = await mask.count();
    if (count > 0) {
      await mask.first().waitFor({ state: 'hidden', timeout: timeoutMs });
    }
  } catch {
    // No loading mask found or already hidden — proceed
  }
}

/**
 * Post-interaction stabilization delay for Kendo UI.
 * Waits for Angular to re-stabilize and adds a small buffer for detached popups
 * (dropdowns, date pickers, etc.) to clean up.
 */
export async function kendoStabilizationDelay(page: Page): Promise<void> {
  await page.waitForTimeout(300);
  await waitForAngular(page);
  await page.waitForTimeout(200);
}

// ============================================================================
// Click Helpers
// ============================================================================

/**
 * Click with built-in resilience for Angular/Kendo applications.
 *
 * Supports multiple calling conventions:
 *   healedClick(page, selector, { timeout: 30000 })
 *   healedClick(page, selector, 'action description')
 *   healedClick(page, selector)
 *   healedClick(locator)
 *
 * Strategy:
 * 1. Wait for Angular stabilization
 * 2. Wait for loading masks to clear
 * 3. Scroll element into view
 * 4. Click with retry on failure
 */
export async function healedClick(
  pageOrLocator: Page | Locator,
  selectorOrNothing?: string,
  optionsOrDescription?: { timeout?: number } | string,
): Promise<void> {
  const timeout = typeof optionsOrDescription === 'object'
    ? optionsOrDescription?.timeout ?? 30000
    : 30000;

  let page: Page;
  let locator: Locator;

  if (typeof (pageOrLocator as any).locator === 'function' && 'goto' in pageOrLocator) {
    // First param is Page
    page = pageOrLocator as Page;
    if (!selectorOrNothing) {
      throw new Error('healedClick: selector is required when first argument is Page');
    }

    // Support selector fallback chains: "primary, alt1, alt2"
    const candidates = splitSelectorCandidates(selectorOrNothing);
    if (candidates.length <= 1) {
      locator = page.locator(selectorOrNothing).first();
      await tryHealedClickOnLocator(page, locator, timeout, selectorOrNothing);
      return;
    }

    let lastError: any = null;
    for (const candidate of candidates) {
      try {
        locator = page.locator(candidate).first();
        await tryHealedClickOnLocator(page, locator, timeout, candidate);
        return;
      } catch (err: any) {
        lastError = err;
      }
    }

    throw lastError ?? new Error(`healedClick failed for selector chain: ${selectorOrNothing}`);
  } else {
    // First param is Locator
    locator = pageOrLocator as Locator;
    page = (pageOrLocator as Locator).page();
  }

  await tryHealedClickOnLocator(page, locator, timeout, selectorOrNothing || 'locator');
}

// ============================================================================
// Fill / Input Helpers
// ============================================================================

/**
 * Safe fill — fills a field with basic error handling.
 * Waits for the element to be visible and editable before filling.
 */
export async function safeFill(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  const locator = page.locator(selector).first();
  await retryStep(
    async () => {
      await locator.waitFor({ state: 'visible', timeout: 10000 });
      await locator.fill(value);
    },
    { maxRetries: 2, backoffMs: 500, label: `safeFill: ${selector}` },
  );
}

/**
 * Universal fill — works with both standard inputs and Kendo UI components.
 *
 * For Kendo fields:
 * - Clicks the input first to focus (Kendo needs focus for floating labels)
 * - Uses fill() for reliable input
 * - Triggers change event
 * - Runs Kendo stabilization delay
 *
 * For standard inputs:
 * - Direct fill() with slow typing option
 *
 * @param page - Playwright page
 * @param selector - CSS selector for the input
 * @param value - Value to enter
 * @param options - isKendo: use Kendo-specific interaction; slowTyping: type char by char
 */
export async function universalFill(
  page: Page,
  selector: string,
  value: string,
  options?: { isKendo?: boolean; slowTyping?: boolean },
): Promise<void> {
  const isKendo = options?.isKendo ?? false;
  const slowTyping = options?.slowTyping ?? false;

  const candidates = splitSelectorCandidates(selector);
  const chain = candidates.length > 0 ? candidates : [selector];

  let lastError: any = null;

  for (const candidate of chain) {
    const locator = page.locator(candidate).first();

    try {
      await retryStep(
        () => locator.waitFor({ state: 'visible', timeout: 10000 }),
        { maxRetries: 1, backoffMs: 350, label: `waitForVisible: ${candidate}` },
      );

      try {
        await locator.click({ timeout: 3000 });
      } catch {
        // best-effort focus
      }

      await page.waitForTimeout(150);

      await retryStep(
        async () => {
          try {
            if (slowTyping) {
              await locator.pressSequentially(String(value), { delay: 50 });
            } else {
              await locator.fill(String(value));
            }
          } catch {
            await locator.fill(String(value));
          }

          try {
            await locator.evaluate((el: any) => {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            });
          } catch {
            // detached or non-DOM element, ignore
          }
        },
        { maxRetries: 1, backoffMs: 350, label: `fill: ${candidate}` },
      );

      // success
      if (isKendo) {
        await kendoStabilizationDelay(page);
      } else {
        await page.waitForTimeout(200);
      }
      return;
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError ?? new Error(`universalFill failed for selector chain: ${selector}`);

  // Kendo stabilization after fill
  // (handled per-candidate; unreachable)
}

// ============================================================================
// Loading Mask Helpers
// ============================================================================

/**
 * Wait for any Kendo loading mask to disappear before proceeding.
 * Short alias for waitForKendoLoadingHidden.
 */
export async function waitForLoadingMask(page: Page, timeoutMs: number = 15000): Promise<void> {
  await waitForKendoLoadingHidden(page, timeoutMs);
}
