/**
 * TestingExecutionOrchestrator
 *
 * Drives the Zero-Weakness Hybrid MCP execution loop:
 *   1. Load saved McpStep[] from TestScriptStore (zero AI, fast replay)
 *   2. Execute via McpTestExecutor (PlaywrightMcpClient under the hood)
 *   3. On step failure → McpHealingService.classify() → healAction / healAssertion
 *   4. On heal pass  → save healed steps back to TestScriptStore
 *   5. Emit execution:step / execution:log / execution:progress WebSocket events
 *
 * AI cost profile:
 *   First run  : 2 calls (generation) + 0–2 calls (heal only if needed)
 *   Repeat run : 0 calls (TestScriptStore replay)
 */

import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { Pool } from 'pg';
import { JobEvents } from '../../../api/WorkerQueue';
import { TestSessionService } from '../session/TestSessionService';
import { TestScriptStore } from '../mcp/TestScriptStore';
import { McpTestExecutor, McpExecutionResult } from '../mcp/McpTestExecutor';
import { McpHealingService } from '../mcp/McpHealingService';
import { PlaywrightMcpClient } from '../mcp/PlaywrightMcpClient';
import {
  TestExecutionService,
  TestResult,
  StepResult,
} from './TestExecutionService';
import { appLogger } from '../../utils/logger';
import { McpStep } from '../../types/mcp.types';
import { AgenticTestExecutor } from '../mcp/AgenticTestExecutor';
import {
  FailureClassificationService,
  FailureCategory,
  failureTelemetry,
} from './FailureClassificationService';
import { FlakinessTracker } from '../FlakinessTracker';
import { tickHealingTree } from './HealingBehaviorTree';

// ─── Knowledge feedback helpers ───────────────────────────────────────────────
// After a successful heal we persist the learned selector to two places:
//   1. module_skills.known_selectors  — injected into AI prompts for that module
//   2. skill_patterns                 — deduplication-aware pattern store
async function persistHealedSelector(
  pool: Pool,
  moduleName: string,
  element: string,
  healedSelector: string,
): Promise<void> {
  try {
    // 1. Merge into module_skills.known_selectors (JSONB object keyed by element name)
    await pool.query(
      `INSERT INTO module_skills (module_name, known_selectors)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (module_name) DO UPDATE
         SET known_selectors = module_skills.known_selectors || $2::jsonb,
             updated_at      = NOW()`,
      [moduleName, JSON.stringify({ [element]: healedSelector })],
    );

    // 2. Insert into skill_patterns so SmartSkillManager dedup picks it up next time
    const patternId = `heal-${moduleName}-${element}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    await pool.query(
      `INSERT INTO skill_patterns
         (id, type, module, selectors, version, success_rate, change_log, created_at, updated_at)
       VALUES ($1,'recording',$2,$3::jsonb,1,1.0,$4::jsonb,NOW(),NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        patternId,
        moduleName,
        JSON.stringify([healedSelector]),
        JSON.stringify([{ version: 1, date: new Date().toISOString(), change: `Healed: ${element}` }]),
      ],
    );

    appLogger.info(`[Orchestrator] Persisted healed selector for ${moduleName}/${element}: ${healedSelector}`);
  } catch (err: any) {
    appLogger.warn(`[Orchestrator] persistHealedSelector failed: ${err.message}`);
  }
}

// ─── Login options built from env vars ───────────────────────────────────────

interface LoginOptions {
  url: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  username: string;
  password: string;
  idNumber?: string;
  idNumberSelector?: string;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class TestingExecutionOrchestrator {
  constructor(
    private readonly sessions: TestSessionService,
    private readonly pool?: Pool,
  ) {}

  /**
   * Execute test cases with real-time feedback.
   *
   * @param emitComplete - whether this call should itself emit the terminal
   *   `execution:complete` event. The retry path sets this to `false` so the
   *   controller can emit a MERGED (passed + retried) result set instead of
   *   the partial retry-only set.
   */
  async execute(
    session: any,
    testCaseIds: string[] | undefined,
    environment: any,
    userId: string,
    emitComplete = true,
  ) {
    const { ticketId, testCases } = session;

    // Session lock — prevents parallel executions for the same ticket
    const locked = await this.sessions.acquireLock(ticketId, userId);
    if (!locked) {
      const err = new Error('Execution already in progress for this ticket');
      (err as any).statusCode = 409;
      (err as any).code = 'EXECUTION_LOCK_ACTIVE';
      throw err;
    }

    try {
      const iter = session.iterationCount + 1;
      await this.sessions.update(ticketId, userId, {
        phase: 'executing',
        iterationCount: iter,
      });

      const casesToRun = testCaseIds
        ? testCases.filter(
            (tc: any) =>
              testCaseIds.includes(tc.caseId) || testCaseIds.includes(tc.id),
          )
        : testCases;

      const moduleName = session.ticket?.module || session.module || ticketId.split('-')[0] || ticketId;

      const results = await this.runWithMcp(
        casesToRun,
        environment,
        ticketId,
        userId,
        moduleName,
        iter,
        session.ticket?.description,
      );

      const summary = TestExecutionService.getExecutionSummary(results);

      // ── REPORT GENERATION ──
      if (emitComplete) {
        try {
          appLogger.info(`[Orchestrator] Generating reports for ${ticketId}...`);
          const envName = 'MCP-PLAYWRIGHT';
          await TestExecutionService.generateHtmlReport(ticketId, casesToRun, results, envName);
          await TestExecutionService.generateExcelReport(ticketId, results, summary, envName);
          appLogger.info(`[Orchestrator] Reports generated successfully for ${ticketId}`);
        } catch (err: any) {
          appLogger.warn(`[Orchestrator] Failed to generate reports for ${ticketId}: ${err.message}`);
        }
      }

      const artifactsPath = emitComplete
        ? await this.buildArtifactsZip(ticketId).catch((err) => {
            appLogger.warn(
              `[Orchestrator] Failed to build artifacts ZIP for ${ticketId}: ${err.message}`,
            );
            return undefined;
          })
        : undefined;

      await this.sessions.update(ticketId, userId, {
        results: emitComplete ? results : session.results,
        summary: emitComplete ? summary : session.summary,
        phase: 'completed',
        executionLock: false,
        ...(artifactsPath ? { artifactsPath } : {}),
      });

      if (emitComplete) {
        JobEvents.emit('execution:complete', {
          ticketId,
          userId,
          results,
          summary,
        });
      }
      return { results, summary };
    } catch (err) {
      await this.sessions.update(ticketId, userId, {
        phase: 'failed',
        executionLock: false,
      });
      throw err;
    }
  }

  /**
   * Retry only failed/faulty cases. Does NOT emit `execution:complete` —
   * the controller merges passed + retried results and emits the final event.
   */
  async retryFailed(
    session: any,
    failedIds: string[],
    environment: any,
    userId: string,
  ) {
    const result = await this.execute(
      session,
      failedIds,
      environment,
      userId,
      false,
    );

    const passedResults = session.results.filter((r: any) => {
      const s = r.status.toLowerCase();
      return s === 'pass' || s === 'passed';
    });
    const mergedResults = [...passedResults, ...result.results];
    const mergedSummary =
      TestExecutionService.getExecutionSummary(mergedResults);

    const artifactsPath = await this.buildArtifactsZip(
      session.ticketId,
    ).catch((err) => {
      appLogger.warn(
        `[Orchestrator] Failed to rebuild artifacts ZIP for ${session.ticketId}: ${err.message}`,
      );
      return undefined;
    });

    await this.sessions.update(session.ticketId, userId, {
      results: mergedResults,
      summary: mergedSummary,
      ...(artifactsPath ? { artifactsPath } : {}),
    });

    JobEvents.emit('execution:complete', {
      ticketId: session.ticketId,
      userId,
      results: mergedResults,
      summary: mergedSummary,
    });

    return { results: mergedResults, summary: mergedSummary };
  }

  // ─── MCP execution loop ───────────────────────────────────────────────────

  private async runWithMcp(
    testCases: any[],
    environment: any,
    ticketId: string,
    userId: string,
    moduleName: string,
    iteration?: number,
    ticketDescription?: string,
  ): Promise<TestResult[]> {
    const results: TestResult[] = [];
    const loginOptions = this.buildLoginOptions(environment);
    const secondaryLoginOptions = this.buildSecondaryLoginOptions(environment);

    // Ensure directory exists for artifacts (screenshots, etc)
    const ticketDir = path.join(process.cwd(), 'test-results', ticketId);
    const screenshotDir = path.join(ticketDir, 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // P2: Initialize persistent client for batch run
    let persistentClient: PlaywrightMcpClient | undefined;
    let loginSkipped = false;

    try {
      persistentClient = await PlaywrightMcpClient.create({});
      if (loginOptions) {
        appLogger.info('[Orchestrator] Batch run: performing single login');
        try {
          await persistentClient.login(loginOptions);
        } catch (loginErr: any) {
          appLogger.warn(`[Orchestrator] Login failed: ${loginErr.message} — will retry per test case via agentic mode`);
          loginSkipped = true;
        }
      }

      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        const tcId = tc.caseId || tc.id;
        const tcName = tc.name || tc.title || tcId;
        const scenarioId = this.extractScenarioId(tcId, ticketId);

        // Progress event — let frontend show spinner
        JobEvents.emit('execution:progress', {
          ticketId,
          userId,
          currentTestCaseId: tcId,
          totalTestCases: testCases.length,
          completedTestCases: i,
          status: 'running',
          results,
        });

        const startMs = Date.now();
        let steps: McpStep[] = [];

        // Load saved steps
        if (this.pool) {
          try {
            const saved = await TestScriptStore.load(
              this.pool,
              ticketId,
              scenarioId,
            );
            if (saved?.steps?.length) {
              steps = saved.steps;
              appLogger.info(
                `[Orchestrator] Replaying ${steps.length} saved steps for ${ticketId}/${scenarioId}`,
              );
            } else {
              appLogger.info(
                `[Orchestrator] No saved steps for ${scenarioId} — will run empty (generate phase must have saved them)`,
              );
            }
          } catch (err: any) {
            appLogger.warn(
              `[Orchestrator] TestScriptStore.load failed for ${scenarioId}: ${err.message}`,
            );
          }
        }

        // ── ARTIFACT PATHS ──
        const tcScreenshotPath = path.join(screenshotDir, `${tcId}_final.png`);

        // ── AGENTIC FALLBACK — no saved steps OR login was skipped ────────
        // When TestScriptStore has no steps yet, run AgenticTestExecutor instead
        // of blindly calling McpTestExecutor with an empty array (which would
        // always return passed=true due to [].every() === true).
        // If login was skipped (failed), force agentic mode so it can "see"
        // the login page and adapt (snapshots → AI decides → executes).
        // After a successful agentic run the resulting replaySteps are saved to
        // TestScriptStore so the NEXT run skips AI and replays directly.
        if (steps.length === 0 || loginSkipped) {
          appLogger.info(`[Orchestrator] No steps for ${scenarioId} — switching to AGENTIC mode`);

          const goalDescription = tc.description || tc.name || tc.title || tcId;
          const agenticResult = await AgenticTestExecutor.run(
            persistentClient!,
            {
              description: goalDescription,
              maxSteps: 20,
              timeoutMs: 180_000,
            },
            {
              ticketDescription,
              moduleName,
              credentials: loginOptions
                ? { username: loginOptions.username, password: loginOptions.password }
                : undefined,
            },
          );

          // Convert agentic result → McpExecutionResult shape
          const agenticStepResults = agenticResult.steps.map((s) => ({
            step: { action: s.action, element: s.element, selector: s.selector } as McpStep,
            passed: s.passed,
            message: s.message ?? '',
          }));

          const mcpFromAgentic: McpExecutionResult = {
            passed: agenticResult.passed,
            stepResults: agenticStepResults,
            durationMs: agenticResult.durationMs,
            errorMessage: agenticResult.errorMessage,
          };

          // Save replaySteps so next run skips AI entirely
          if (agenticResult.passed && agenticResult.replaySteps?.length && this.pool) {
            try {
              await TestScriptStore.save(this.pool, {
                ticketId,
                scenarioId,
                steps: agenticResult.replaySteps,
                status: 'PASS',
              });
              appLogger.info(
                `[Orchestrator] Saved ${agenticResult.replaySteps.length} agentic replay steps for ${scenarioId}`,
              );
            } catch (err: any) {
              appLogger.warn(`[Orchestrator] Failed to save agentic replay steps: ${err.message}`);
            }
          }

          // Emit per-step events then map result — skip the rest of this iteration
          for (const sr of mcpFromAgentic.stepResults) {
            JobEvents.emit('execution:step', {
              kind: sr.passed ? 'step_pass' : 'step_fail',
              ticketId,
              userId,
              testCaseId: tcId,
              action: sr.step.action,
              message: sr.message,
            });
          }

          const statusLabel = mcpFromAgentic.passed ? 'PASS' : 'FAIL';
          const uniqueTcName = iteration !== undefined ? `${tcName} (Iter ${iteration})` : tcName;
          JobEvents.emit('execution:log', {
            ticketId,
            userId,
            log: `[AGENTIC][${statusLabel}] ${uniqueTcName} — ${mcpFromAgentic.durationMs}ms`,
          });

          results.push(this.mapToTestResult(mcpFromAgentic, tc, ticketId, environment, startMs, iteration, i));

          // Soft-reset between cases
          if (i < testCases.length - 1 && persistentClient) {
            const effectiveBaseUrl = environment.config?.baseUrl || environment.baseUrl || process.env.BASE_URL || '';
            const moduleBaseUrl = effectiveBaseUrl + (moduleName ? `#/app.${moduleName.toLowerCase().replace(/\s+/g, '')}` : '');
            await persistentClient.softReset(moduleBaseUrl).catch((e: Error) => {
              appLogger.warn(`[Orchestrator] Soft-reset failed: ${e.message}`);
            });
          }

          continue; // skip replay path below
        }
        // ─────────────────────────────────────────────────────────────────────

        // Run via MCP (Passing persistent client)
        let mcpResult = await McpTestExecutor.run(steps, {
          client: persistentClient,
          secondaryLoginOptions,
          stopOnFailure: false,
          screenshotPath: tcScreenshotPath,
        });

        // Soft-reset between cases if not the last case
        if (i < testCases.length - 1 && persistentClient) {
          const effectiveBaseUrl = environment.config?.baseUrl || environment.baseUrl || process.env.BASE_URL || '';
          const moduleBaseUrl = effectiveBaseUrl + (moduleName ? `#/app.${moduleName.toLowerCase().replace(/\s+/g, '')}` : '');
          await persistentClient.softReset(moduleBaseUrl).catch(e => {
            appLogger.warn(`[Orchestrator] Soft-reset failed: ${e.message}`);
          });
        }

      // Heal on failure when we have steps to heal
      if (!mcpResult.passed && steps.length > 0) {
        mcpResult = await this.tryHeal(
          mcpResult,
          steps,
          loginOptions,
          secondaryLoginOptions,
          ticketId,
          scenarioId,
          moduleName,
        );
      }

      // ── AGENTIC FALLBACK ON FAILURE (W2.2) ──────────────────────────────────
      // If healing also failed AND the failure is an infrastructure fault
      // (selector/element not found — not a real app bug), run AgenticTestExecutor
      // as a last resort. It takes a fresh snapshot, reasons about the page, and
      // attempts the goal with full AI visibility. On success the learned steps
      // replace the broken saved steps in TestScriptStore.
      if (!mcpResult.passed && mcpResult.stepResults.length > 0) {
        const isInfraFault = (mcpResult.errorMessage ?? '').toLowerCase().match(
          /element not found|not found|timeout|cannot find|no element|locator/
        );
        if (isInfraFault) {
          appLogger.info(
            `[Orchestrator] Healing failed — falling back to AGENTIC mode for ${scenarioId}`,
          );
          const goalDescription = tc.description || tc.name || tc.title || tcId;
          const agenticResult = await AgenticTestExecutor.run(
            persistentClient!,
            { description: goalDescription, maxSteps: 20, timeoutMs: 180_000 },
            { ticketDescription, moduleName,
              credentials: loginOptions
                ? { username: loginOptions.username, password: loginOptions.password }
                : undefined },
          );

          if (agenticResult.passed) {
            appLogger.info(`[Orchestrator] Agentic fallback PASSED for ${scenarioId}`);
            // Replace broken steps with agentic-learned steps
            if (agenticResult.replaySteps?.length && this.pool) {
              try {
                await TestScriptStore.save(this.pool, {
                  ticketId, scenarioId,
                  steps: agenticResult.replaySteps,
                  status: 'PASS',
                });
              } catch (err: any) {
                appLogger.warn(`[Orchestrator] Failed to save agentic fallback steps: ${err.message}`);
              }
            }
            mcpResult = {
              passed: true,
              stepResults: agenticResult.steps.map((s) => ({
                step: { action: s.action, element: s.element, selector: s.selector } as any,
                passed: s.passed,
                message: s.message ?? '',
              })),
              durationMs: agenticResult.durationMs,
              errorMessage: undefined,
            };
          } else {
            appLogger.warn(
              `[Orchestrator] Agentic fallback also failed for ${scenarioId}: ${agenticResult.errorMessage}`,
            );
          }
        }
      }
      // ─────────────────────────────────────────────────────────────────────────

      // ── ARTIFACT CAPTURE REMOVED (now handled inside McpTestExecutor) ──

      // Emit per-step events
      for (const sr of mcpResult.stepResults) {
        JobEvents.emit('execution:step', {
          kind: sr.passed ? 'step_pass' : 'step_fail',
          ticketId,
          userId,
          testCaseId: tcId,
          action: sr.step.action,
          message: sr.message,
        });
      }

      // Legacy log line (backward compat)
      const statusLabel = mcpResult.passed ? 'PASS' : 'FAIL';
      const uniqueTcName = iteration !== undefined ? `${tcName} (Iter ${iteration})` : tcName;
      JobEvents.emit('execution:log', {
        ticketId,
        userId,
        log: `[${statusLabel}] ${uniqueTcName} — ${mcpResult.durationMs}ms`,
      });

      // Map to TestResult shape the rest of the system expects
      const testResult = this.mapToTestResult(
        mcpResult,
        tc,
        ticketId,
        environment,
        startMs,
        iteration,
        i,
      );

      results.push(testResult);

      // Phase 2.5 P5: FlakinessTracker — record outcome for flakiness detection
      try {
        FlakinessTracker.getInstance().recordExecution({
          testCaseId: tcId,
          ticketId,
          status: (testResult.status === 'PASS' ? 'PASS' : 'FAIL') as 'PASS' | 'FAIL',
          errorMessage: testResult.errorMessage,
          timestamp: new Date().toISOString(),
          healingAttempted: !mcpResult.passed,
          healingSucceeded: !mcpResult.passed && testResult.status === 'PASS',
        });
      } catch (fErr: any) {
        appLogger.warn(`[Orchestrator] FlakinessTracker.recordExecution failed: ${fErr.message}`);
      }

      // Persist outcome to TestScriptStore
      if (this.pool) {
        try {
          if (mcpResult.passed) {
            await TestScriptStore.save(this.pool, {
              ticketId,
              scenarioId,
              steps,
              status: 'PASS',
            });
          } else {
            await TestScriptStore.recordOutcome(this.pool, {
              ticketId,
              scenarioId,
              status: 'FAIL',
            });
          }
        } catch (err: any) {
          appLogger.warn(
            `[Orchestrator] TestScriptStore persist failed for ${scenarioId}: ${err.message}`,
          );
        }
      }
    }
    } catch (err: any) {
      appLogger.error(`[Orchestrator] Batch execution error: ${err.message}`);
    } finally {
      if (persistentClient) {
        await persistentClient.close().catch(() => {});
      }
    }

    return results;
  }

  // ─── Healing ──────────────────────────────────────────────────────────────

  /**
   * Open a fresh browser, replay up to the failed step, then ask
   * McpHealingService to fix the selector or adapt the assertion.
   * Returns a new McpExecutionResult — either healed (passed=true) or the
   * original result if healing could not recover.
   */
  private async tryHeal(
    original: McpExecutionResult,
    steps: McpStep[],
    loginOptions: LoginOptions | undefined,
    secondaryLoginOptions: LoginOptions | undefined,
    ticketId: string,
    scenarioId: string,
    moduleName: string,
  ): Promise<McpExecutionResult> {
    const failedIdx = original.stepResults.findIndex((r) => !r.passed);
    if (failedIdx < 0) return original;

    const failedStep = original.stepResults[failedIdx].step;
    const errorMsg = original.stepResults[failedIdx].message ?? '';

    // ── Phase 2.5 P1: FailureClassificationService routing ───────────────────
    // Classify first with the richer service before the simpler McpHealingService
    // classify(). This prevents wasting heal attempts on unfixable failures.
    const richClassification = FailureClassificationService.classifyFailure(errorMsg, {
      action: failedStep.action,
      selector: (failedStep as any).element || (failedStep as any).target || '',
    });
    failureTelemetry.record(richClassification.category);
    appLogger.info(
      `[Orchestrator] Failure category: ${richClassification.category} ` +
      `(confidence ${richClassification.confidence.toFixed(2)}) for ${scenarioId}`,
    );

    // ASSERTION_FAILURE → real app bug, no heal — report as defect
    if (richClassification.category === FailureCategory.ASSERTION_FAILURE) {
      appLogger.info(`[Orchestrator] ASSERTION_FAILURE — skipping heal for ${scenarioId} (real bug path)`);
      return {
        ...original,
        errorMessage: `REAL_BUG: ${errorMsg}`,
      };
    }

    // NETWORK_ERROR → environment/infra problem — no heal, not a real bug
    if (richClassification.category === FailureCategory.NETWORK_ERROR) {
      appLogger.warn(`[Orchestrator] NETWORK_ERROR — skipping heal for ${scenarioId} (environment issue)`);
      return original;
    }

    // TIMING_FAULT → browser-lifecycle race — add extra wait before heal attempt
    if (richClassification.category === FailureCategory.TIMING_FAULT) {
      appLogger.info(`[Orchestrator] TIMING_FAULT — waiting 2 s before heal for ${scenarioId}`);
      await new Promise(r => setTimeout(r, 2000));
    }
    // ─────────────────────────────────────────────────────────────────────────

    const failureClass = McpHealingService.classify(failedStep, errorMsg);

    if (failureClass === 'UNRECOVERABLE') {
      appLogger.warn(
        `[Orchestrator] UNRECOVERABLE failure for ${scenarioId}: ${errorMsg.slice(0, 120)}`,
      );
      return original;
    }

    appLogger.info(
      `[Orchestrator] Healing ${failureClass} — step ${failedIdx} of ${scenarioId}`,
    );

    let client: PlaywrightMcpClient | null = null;
    try {
      client = await PlaywrightMcpClient.create({});

      // Figure out which actor was active at the failed step
      let currentActor = 'primary';
      for (let i = 0; i <= failedIdx; i++) {
        const desc = (steps[i] as any).description?.toLowerCase() || '';
        if (desc.includes('@actor: secondary')) {
          currentActor = 'secondary';
        } else if (desc.includes('@actor: primary')) {
          currentActor = 'primary';
        }
      }

      const activeLoginOptions = currentActor === 'secondary' ? secondaryLoginOptions : loginOptions;
      if (activeLoginOptions) {
        await client.login(activeLoginOptions);
        await new Promise((r) => setTimeout(r, 1500));
      }

      // Replay passing steps to reach the failed page state
      for (let j = 0; j < failedIdx; j++) {
        await this.replayStepBest(client, steps[j]);
      }

      if (failureClass === 'ACTION_FAIL') {
        // ── Phase 3 Day 11: HealingBehaviorTree drives action heal ─────────────
        // Tree: SELECTOR_ERROR/TIMING_FAULT → healAction, EXEC_FAULT → markFault
        const healOutcome = await tickHealingTree(original, client, moduleName);

        if (healOutcome.kind === 'healed') {
          const healedStep = healOutcome.healedStep;
          const healedSteps = steps.map((s, idx) =>
            idx === failedIdx ? healedStep : s,
          );
          await client.close().catch(() => {});
          client = null;

          const healResult = await McpTestExecutor.run(healedSteps, {
            loginOptions,
            secondaryLoginOptions,
          });

          if (healResult.passed) {
            appLogger.info(`[Orchestrator] ACTION_FAIL heal succeeded for ${scenarioId}`);
            if (this.pool) {
              await TestScriptStore.save(this.pool, {
                ticketId,
                scenarioId,
                steps: healedSteps,
                status: 'PASS',
              }).catch((e: any) =>
                appLogger.warn(`[Orchestrator] Failed to persist healed steps: ${e.message}`),
              );

              // Phase G: knowledge feedback — persist healed selector to module_skills
              const originalElement = (failedStep as any).element ?? (failedStep as any).text ?? (failedStep as any).url ?? '';
              const healedElement = (healedStep as any).element ?? (healedStep as any).url ?? '';
              if (originalElement && healedElement && originalElement !== healedElement) {
                await persistHealedSelector(this.pool, moduleName, originalElement, healedElement);
              }
            }
          }
          return healResult;
        }
        // code_fault / exec_fault / retry → fall through to return original
      } else if (failureClass === 'ASSERTION_FAIL') {
        const assertResult = await McpHealingService.healAssertion(
          failedStep,
          client,
        );

        if (assertResult?.outcome === 'updated') {
          const healedSteps = steps.map((s, idx) =>
            idx === failedIdx ? assertResult.step : s,
          );
          await client.close().catch(() => {});
          client = null;

          const healResult = await McpTestExecutor.run(healedSteps, {
            loginOptions,
          });

          if (healResult.passed && this.pool) {
            await TestScriptStore.save(this.pool, {
              ticketId,
              scenarioId,
              steps: healedSteps,
              status: 'PASS',
            }).catch((e: any) =>
              appLogger.warn(
                `[Orchestrator] Failed to persist healed assertion steps: ${e.message}`,
              ),
            );
          }
          return healResult;
        }

        if (assertResult?.outcome === 'real_bug') {
          appLogger.info(
            `[Orchestrator] REAL_BUG confirmed for ${scenarioId}: ${assertResult.reason}`,
          );
          return {
            ...original,
            errorMessage: `REAL_BUG: ${assertResult.reason}`,
          };
        }
      }
    } catch (err: any) {
      appLogger.warn(
        `[Orchestrator] Healing threw for ${scenarioId}: ${err.message}`,
      );
    } finally {
      if (client) await client.close().catch(() => {});
    }

    return original;
  }

  /**
   * Best-effort step replay during heal — skip unknown actions silently.
   */
  private async replayStepBest(
    client: PlaywrightMcpClient,
    step: McpStep,
  ): Promise<void> {
    try {
      switch (step.action) {
        case 'browser_navigate':
          await client.navigate(step.url);
          break;
        case 'browser_click':
          await client.click(step.element);
          break;
        case 'browser_type':
          await client.fill(step.element, step.text);
          break;
        case 'browser_fill_form':
          for (const f of step.fields) await client.fill(f.name, f.value);
          break;
        case 'browser_select_option':
          await client.selectOption(step.element, step.option);
          break;
        case 'browser_wait_for':
          if (step.text) await client.waitForText(step.text, step.timeout || 5000);
          else await new Promise(r => setTimeout(r, step.timeout || 2000));
          break;
        default:
          break; // unsupported during replay — skip
      }
    } catch {
      // Non-fatal: keep replaying remaining steps
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Build login options from environment variables.
   * Returns undefined if no credentials are configured — McpTestExecutor
   * will skip the login phase and start from the first step directly.
   */
  private buildLoginOptions(environment: any): LoginOptions | undefined {
    const baseUrl =
      process.env.BASE_URL ||
      process.env.APP_URL ||
      environment?.baseUrl ||
      'http://localhost:4200';
    const username = process.env.TEST_USERNAME || environment?.username;
    const password = process.env.TEST_PASSWORD || environment?.password;
    const idNumber = process.env.TEST_IDNUMBER || environment?.idNumber;

    if (!username || !password) {
      appLogger.warn(
        '[Orchestrator] TEST_USERNAME / TEST_PASSWORD not set — login step will be skipped',
      );
      return undefined;
    }

    return {
      url:              baseUrl,
      // Single specific selectors — multi-selector strings fail in browser_fill
      usernameSelector: process.env.USERNAME_SELECTOR  || 'input[name="username"]',
      passwordSelector: process.env.PASSWORD_SELECTOR  || 'input[name="password"]',
      submitSelector:   process.env.SUBMIT_SELECTOR    || 'button[type="submit"]',
      username,
      password,
      ...(idNumber
        ? {
            idNumber,
            idNumberSelector: process.env.IDNUMBER_SELECTOR || 'input[name="idnumber"]',
          }
        : {}),
    };
  }

  /**
   * Build login options for a secondary user from environment variables.
   * Useful for Data Isolation or Multi-Tenant test scenarios.
   */
  private buildSecondaryLoginOptions(environment: any): LoginOptions | undefined {
    const baseUrl =
      process.env.BASE_URL ||
      process.env.APP_URL ||
      environment?.baseUrl ||
      'http://localhost:4200';
    const username = process.env.TEST_USERNAME_SECONDARY || environment?.secondaryUsername;
    const password = process.env.TEST_PASSWORD_SECONDARY || environment?.secondaryPassword;
    const idNumber = process.env.TEST_IDNUMBER_SECONDARY || environment?.secondaryIdNumber;

    if (!username || !password) {
      return undefined;
    }

    return {
      url:              baseUrl,
      usernameSelector: process.env.USERNAME_SELECTOR  || 'input[name="username"]',
      passwordSelector: process.env.PASSWORD_SELECTOR  || 'input[name="password"]',
      submitSelector:   process.env.SUBMIT_SELECTOR    || 'button[type="submit"]',
      username,
      password,
      ...(idNumber
        ? {
            idNumber,
            idNumberSelector: process.env.IDNUMBER_SELECTOR || 'input[name="idnumber"]',
          }
        : {}),
    };
  }

  /**
   * Extract the short scenario ID from a compound caseId.
   * caseId format: "${ticketId}-${scenarioId}" e.g. "TEST-123-SC-001"
   */
  private extractScenarioId(caseId: string, ticketId: string): string {
    const prefix = ticketId + '-';
    return caseId.startsWith(prefix) ? caseId.slice(prefix.length) : caseId;
  }

  /**
   * Map McpExecutionResult → TestResult (shape expected by the rest of the system).
   */
  private mapToTestResult(
    mcpResult: McpExecutionResult,
    tc: any,
    ticketId: string,
    environment: any,
    startMs: number,
    iteration?: number,
    caseIndex?: number,
  ): TestResult {
    const tcId = tc.caseId || tc.id;
    const screenshotRelPath = path.join(process.cwd(), 'test-results', ticketId, 'screenshots', `${tcId}_final.png`);
    
    // Add unique suffix to handle multiple iterations of the same scenario
    const uniqueSuffix = iteration !== undefined ? ` (Iter ${iteration})` : '';
    const uniqueIdSuffix = iteration !== undefined ? `_I${iteration}` : '';

    const steps: any[] = mcpResult.stepResults.map((sr, i) => ({
      stepNumber:    i + 1,
      action:        sr.step.action,
      expectedResult: 'Step completes without error',
      actualResult:  sr.message,
      status:        sr.passed ? 'PASS' : 'FAIL',
      errorMessage:  sr.passed ? undefined : sr.message,
      duration:      0,
    }));

    const isRealBug = (mcpResult.errorMessage ?? '').startsWith('REAL_BUG:');

    // P4 FIX: Automated RCA Classification
    let rcaCategory: 'ASSERTION_FAILURE' | 'UI_TIMEOUT' | 'ACTION_FAIL' | undefined;
    if (!mcpResult.passed) {
      const msg = (mcpResult.errorMessage ?? '').toLowerCase();
      if (msg.includes('assertion failed') || msg.includes('does not contain')) {
        rcaCategory = 'ASSERTION_FAILURE'; // Real Bug (Application didn't show expected result)
      } else if (msg.includes('element not found') || msg.includes('timeout')) {
        rcaCategory = 'UI_TIMEOUT';        // Automation Flake or UI Change
      } else {
        rcaCategory = 'ACTION_FAIL';
      }
    }

    const durationMs = Date.now() - startMs;
    return {
      testCaseId:    `${tcId}${uniqueIdSuffix}`,
      testCaseTitle: `${tc.name || tc.title || tcId}${uniqueSuffix}`,
      // Frontend (GoHybridChat.part2.tsx) reads caseName/caseId — keep both shapes
      caseId:        `${tcId}${uniqueIdSuffix}`,
      caseName:      `${tc.name || tc.title || tcId}${uniqueSuffix}`,
      status:        mcpResult.passed ? 'PASS' : 'FAIL',
      duration:      durationMs,
      errorMessage:  mcpResult.errorMessage,
      steps,
      environment:   'MCP-PLAYWRIGHT',
      executedAt:    new Date().toISOString(),
      ticketId,
      screenshotPaths: [screenshotRelPath],
      // isExecutionFault=true means automation infra failed (selector/timeout),
      // not a real application bug — suppresses false Jira bug reports
      isExecutionFault: rcaCategory === 'UI_TIMEOUT' || rcaCategory === 'ACTION_FAIL',
      failureClassification: rcaCategory ? { category: rcaCategory } : undefined,
      uiStack: mcpResult.uiStack,
    };
  }

  // ─── Artifacts ZIP ────────────────────────────────────────────────────────

  /**
   * Zip the per-ticket test-results directory (videos, screenshots, traces,
   * HTML report, etc.) so JiraUploadService.completeWorkflow can attach it.
   *
   * Returns the ZIP path on success, or throws if the source directory is
   * missing / archiver fails. Callers treat failures as non-fatal.
   */
  private async buildArtifactsZip(ticketId: string): Promise<string> {
    const sourceDir = path.join(process.cwd(), 'test-results', ticketId);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Artifacts directory not found: ${sourceDir}`);
    }

    const outDir = path.join(
      process.cwd(),
      'local_storage',
      'test-artifacts',
      ticketId,
    );
    fs.mkdirSync(outDir, { recursive: true });

    const zipPath = path.join(
      outDir,
      `${ticketId}_artifacts_${Date.now()}.zip`,
    );

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });

    appLogger.info(`[Orchestrator] Built artifacts ZIP: ${zipPath}`);
    return zipPath;
  }
}
