/**
 * SmartExecutionRouter
 *
 * Decision layer that sits between the Sprint Regression runner and the
 * actual test execution / AI generation:
 *
 *   ┌───────────────────────────────────────────────────────┐
 *   │ For each ticket+scenario                              │
 *   │  1. Is there a saved PASS script?                    │
 *   │     YES → run it                                     │
 *   │       PASS again → done (increment run_count)        │
 *   │       FAIL       → classify failure:                 │
 *   │         CODE_FAULT (selector / script bug)           │
 *   │           → mark FAIL, raise to caller               │
 *   │         REAL_FAIL (actual product regression)        │
 *   │           → mark FAIL, raise to caller               │
 *   │         UI_CHANGED (discovery hash mismatch)         │
 *   │           → re-discover + re-generate + re-run       │
 *   │     NO  → generate fresh via JsonTestGenerationService│
 *   │           → run; if PASS save to library             │
 *   └───────────────────────────────────────────────────────┘
 *
 * The router never executes Playwright directly — it delegates to
 * McpTestExecutor (MCP-based, simple action list) or the compiled Playwright
 * script runner depending on which path is taken.
 */

import { Pool } from 'pg';
import { TestScriptStore, SavedScript } from './TestScriptStore';
import { McpDiscoveryService, LiveDiscoveryOptions } from './McpDiscoveryService';
import { appLogger } from '../../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FailureCategory = 'CODE_FAULT' | 'REAL_FAIL' | 'UI_CHANGED' | 'UNKNOWN';

export interface RouteInput {
  pool: Pool;
  ticketId: string;
  scenarioId: string;
  moduleName: string;
  /** The live discovery hash for UI-drift comparison */
  liveHash: string;
  /**
   * Callback that compiles + runs a saved Playwright script.
   * Returns true if the run passed, false if it failed.
   */
  runScript: (script: string) => Promise<RunScriptResult>;
  /**
   * Callback that generates a fresh test spec + script for the scenario.
   * Returns the compiled Playwright script text.
   */
  generateScript: () => Promise<string>;
  /** Optional: only used when re-generating after UI drift */
  rediscoverOptions?: LiveDiscoveryOptions;
}

export interface RunScriptResult {
  passed: boolean;
  /** Raw error message / stack if failed */
  errorMessage?: string;
  /** Duration in ms */
  durationMs?: number;
}

export interface RouteResult {
  status: 'pass' | 'fail' | 'skip' | 'error';
  /** Whether the saved script was reused (vs. AI-generated) */
  usedSavedScript: boolean;
  failureCategory?: FailureCategory;
  errorMessage?: string;
  /** The Playwright script that was ultimately executed */
  script?: string;
  durationMs?: number;
}

// ─── Error pattern heuristics ─────────────────────────────────────────────────

/**
 * Classify a Playwright error message into one of three categories.
 *
 * Heuristics (in priority order):
 *  1. Selector not found / locator strict mode     → CODE_FAULT (script bug)
 *  2. Navigation timeout / net:: error             → REAL_FAIL  (product issue)
 *  3. Expected / assertion failed                  → REAL_FAIL
 *  4. Everything else                              → UNKNOWN
 *
 * Note: UI_CHANGED is detected BEFORE running (via hash comparison) and is
 * not diagnosed from the error message.
 */
function classifyError(errorMessage: string | undefined): FailureCategory {
  if (!errorMessage) return 'UNKNOWN';

  const lower = errorMessage.toLowerCase();

  // Selector / script issues (most common in CI)
  if (
    lower.includes('strict mode violation') ||
    lower.includes('no element matching selector') ||
    lower.includes('locator.click: element is not visible') ||
    lower.includes('locator resolved to') ||
    lower.includes('unexpected token') ||
    lower.includes('typeerror') ||
    lower.includes('referenceerror')
  ) {
    return 'CODE_FAULT';
  }

  // Real product regressions
  if (
    lower.includes('net::err') ||
    lower.includes('navigation timeout') ||
    lower.includes('page.goto') ||
    lower.includes('expect(') ||
    lower.includes('assertion failed') ||
    lower.includes('expected') ||
    lower.includes('received') ||
    lower.includes('404') ||
    lower.includes('500')
  ) {
    return 'REAL_FAIL';
  }

  return 'UNKNOWN';
}

// ─── Router ───────────────────────────────────────────────────────────────────

export class SmartExecutionRouter {
  /**
   * Route a single scenario to the appropriate execution path and return the
   * final outcome. Updates the script library atomically.
   */
  static async route(input: RouteInput): Promise<RouteResult> {
    const { pool, ticketId, scenarioId, moduleName, liveHash, runScript, generateScript } = input;

    appLogger.info(`[SmartRouter] Routing ${ticketId}/${scenarioId}`);

    // ── Path A: Try saved script ───────────────────────────────────────────
    const saved: SavedScript | null = await TestScriptStore.load(pool, ticketId, scenarioId);

    if (saved?.status === 'PASS') {
      // Check for UI drift before reusing
      const drifted = await TestScriptStore.hasUiChanged(pool, ticketId, scenarioId, liveHash);

      if (!drifted) {
        // Guard: script may be null for McpStep-only rows (DB v27 made it nullable)
        if (!saved.script) {
          appLogger.warn(
            `[SmartRouter] Saved record for ${ticketId}/${scenarioId} has no compiled script — ` +
            `skipping reuse (McpStep-only rows need McpTestExecutor, not runScript callback)`,
          );
          return this.generateAndRun({
            pool, ticketId, scenarioId, moduleName, liveHash, runScript, generateScript,
            usedSavedScript: false,
          });
        }

        appLogger.info(`[SmartRouter] Reusing saved script for ${ticketId}/${scenarioId}`);
        const result = await runScript(saved.script);

        if (result.passed) {
          await TestScriptStore.recordOutcome(pool, { ticketId, scenarioId, status: 'PASS' });
          return {
            status: 'pass',
            usedSavedScript: true,
            script: saved.script,
            durationMs: result.durationMs,
          };
        }

        // Script failed — classify why
        const category = classifyError(result.errorMessage);
        appLogger.warn(
          `[SmartRouter] Saved script failed for ${ticketId}/${scenarioId}: ${category}`,
        );
        await TestScriptStore.recordOutcome(pool, { ticketId, scenarioId, status: 'FAIL' });

        return {
          status: 'fail',
          usedSavedScript: true,
          failureCategory: category,
          errorMessage: result.errorMessage,
          script: saved.script,
          durationMs: result.durationMs,
        };
      }

      // UI has changed — re-discover and re-generate
      appLogger.info(
        `[SmartRouter] UI drift detected for ${ticketId}/${scenarioId} — re-generating`,
      );
      await TestScriptStore.delete(pool, ticketId, scenarioId);
      return this.generateAndRun({
        pool, ticketId, scenarioId, moduleName, liveHash, runScript, generateScript,
        usedSavedScript: false,
        failureCategory: 'UI_CHANGED',
      });
    }

    // ── Path B: No saved script — generate fresh ───────────────────────────
    appLogger.info(`[SmartRouter] No saved script for ${ticketId}/${scenarioId} — generating`);
    return this.generateAndRun({
      pool, ticketId, scenarioId, moduleName, liveHash, runScript, generateScript,
      usedSavedScript: false,
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private static async generateAndRun(opts: {
    pool: Pool;
    ticketId: string;
    scenarioId: string;
    moduleName: string;
    liveHash: string;
    runScript: (script: string) => Promise<RunScriptResult>;
    generateScript: () => Promise<string>;
    usedSavedScript: boolean;
    failureCategory?: FailureCategory;
  }): Promise<RouteResult> {
    const { pool, ticketId, scenarioId, moduleName, liveHash, runScript, generateScript } = opts;

    let script: string;
    try {
      script = await generateScript();
    } catch (genErr: any) {
      appLogger.error(`[SmartRouter] Generation failed for ${ticketId}/${scenarioId}: ${genErr.message}`);
      return {
        status: 'error',
        usedSavedScript: false,
        errorMessage: `Generation failed: ${genErr.message}`,
      };
    }

    const result = await runScript(script);

    if (result.passed) {
      // Save to library for future reuse
      await TestScriptStore.save(pool, {
        ticketId,
        scenarioId,
        moduleName,
        script,
        selectorHash: liveHash,
        status: 'PASS',
      });

      appLogger.info(`[SmartRouter] Generated+ran PASS for ${ticketId}/${scenarioId} — saved to library`);
      return {
        status: 'pass',
        usedSavedScript: false,
        script,
        durationMs: result.durationMs,
      };
    }

    // Failed generation run — save FAIL so we don't endlessly re-generate
    await TestScriptStore.save(pool, {
      ticketId,
      scenarioId,
      moduleName,
      script,
      selectorHash: liveHash,
      status: 'FAIL',
    });

    const category = opts.failureCategory ?? classifyError(result.errorMessage);
    appLogger.warn(`[SmartRouter] Generated script FAILED for ${ticketId}/${scenarioId}: ${category}`);

    return {
      status: 'fail',
      usedSavedScript: false,
      failureCategory: category,
      errorMessage: result.errorMessage,
      script,
      durationMs: result.durationMs,
    };
  }
}
