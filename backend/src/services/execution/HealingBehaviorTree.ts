/**
 * HealingBehaviorTree
 *
 * Phase 3 Day 11 — Behavior Tree to replace nested if-else in healing logic.
 *
 * Replaces the manual if-else chain in TestingExecutionOrchestrator.tryHeal()
 * with a composable Behavior Tree. This makes healing strategies declarative,
 * testable, and extensible without touching orchestrator logic.
 *
 * Node types (THEORY.md §4):
 *   Selector  — try children in order, return SUCCEED on first success
 *   Sequence  — run children in order, abort on first FAIL (AND logic)
 *   Condition — evaluate a predicate, return SUCCEED or FAIL
 *   Action    — execute a side-effect, return SUCCEED or FAIL
 *
 * Tree shape (mirrors the TODO.md spec):
 *
 *   Root (Selector)
 *   ├── Sequence [SELECTOR_ERROR or TIMING_FAULT → heal action]
 *   │   ├── Condition: isSelectorOrTimingError
 *   │   └── Action: healAction
 *   ├── Sequence [TIMING_FAULT → retry with wait]
 *   │   ├── Condition: isTimingFault
 *   │   └── Action: retryWithWait
 *   ├── Sequence [ASSERTION_FAILURE → code fault]
 *   │   ├── Condition: isAssertionFailure
 *   │   └── Action: markCodeFault
 *   └── Action: markExecFault (default leaf)
 *
 * Usage:
 *   const result = await HealingBehaviorTree.tick(stepResult, context);
 *   // result.outcome: 'healed' | 'code_fault' | 'exec_fault' | 'retry'
 */

import { McpExecutionResult } from '../mcp/McpTestExecutor';
import { McpHealingService } from '../mcp/McpHealingService';
import { PlaywrightMcpClient } from '../mcp/PlaywrightMcpClient';
import { McpStep } from '../../types/mcp.types';
import {
  FailureClassificationService,
  FailureCategory,
} from './FailureClassificationService';
import { appLogger } from '../../utils/logger';

// ─── Node types ───────────────────────────────────────────────────────────────

export type NodeStatus = 'SUCCEED' | 'FAIL' | 'RUNNING';

export interface BtContext {
  failedStep: McpStep;
  errorMsg: string;
  category: FailureCategory;
  client?: PlaywrightMcpClient;
  moduleName: string;
  /** Set by Action nodes to communicate outcome upward */
  healedStep?: McpStep;
  extraWaitMs?: number;
}

interface BtNode {
  tick(ctx: BtContext): Promise<NodeStatus>;
}

// ─── Core node primitives ─────────────────────────────────────────────────────

class Selector implements BtNode {
  constructor(private readonly children: BtNode[]) {}

  async tick(ctx: BtContext): Promise<NodeStatus> {
    for (const child of this.children) {
      const status = await child.tick(ctx);
      if (status === 'SUCCEED') return 'SUCCEED';
    }
    return 'FAIL';
  }
}

class Sequence implements BtNode {
  constructor(private readonly children: BtNode[]) {}

  async tick(ctx: BtContext): Promise<NodeStatus> {
    for (const child of this.children) {
      const status = await child.tick(ctx);
      if (status !== 'SUCCEED') return 'FAIL';
    }
    return 'SUCCEED';
  }
}

class Condition implements BtNode {
  constructor(
    private readonly predicate: (ctx: BtContext) => boolean,
    private readonly label: string,
  ) {}

  async tick(ctx: BtContext): Promise<NodeStatus> {
    const result = this.predicate(ctx);
    appLogger.debug(`[BehaviorTree] Condition "${this.label}": ${result ? 'SUCCEED' : 'FAIL'}`);
    return result ? 'SUCCEED' : 'FAIL';
  }
}

class Action implements BtNode {
  constructor(
    private readonly fn: (ctx: BtContext) => Promise<NodeStatus>,
    private readonly label: string,
  ) {}

  async tick(ctx: BtContext): Promise<NodeStatus> {
    appLogger.debug(`[BehaviorTree] Action "${this.label}" executing`);
    return this.fn(ctx);
  }
}

// ─── Conditions ───────────────────────────────────────────────────────────────

const isSelectorOrTimingError = new Condition(
  ctx =>
    ctx.category === FailureCategory.SELECTOR_ERROR ||
    ctx.category === FailureCategory.TIMING_FAULT ||
    ctx.category === FailureCategory.EXECUTION_FAULT,
  'isSelectorOrTimingError',
);

const isTimingFault = new Condition(
  ctx => ctx.category === FailureCategory.TIMING_FAULT,
  'isTimingFault',
);

const isAssertionFailure = new Condition(
  ctx => ctx.category === FailureCategory.ASSERTION_FAILURE,
  'isAssertionFailure',
);

const hasClient = new Condition(
  ctx => ctx.client != null,
  'hasClient',
);

// ─── Actions ──────────────────────────────────────────────────────────────────

const retryWithWait = new Action(async (ctx) => {
  const waitMs = 2000;
  ctx.extraWaitMs = waitMs;
  appLogger.info(`[BehaviorTree] TIMING_FAULT: injecting ${waitMs}ms wait before heal`);
  await new Promise(r => setTimeout(r, waitMs));
  return 'SUCCEED'; // wait injected — let the next node attempt the heal
}, 'retryWithWait');

const healAction = new Action(async (ctx) => {
  if (!ctx.client) return 'FAIL';
  try {
    const healed = await McpHealingService.healAction(ctx.failedStep, ctx.client);
    if (healed) {
      ctx.healedStep = healed;
      appLogger.info(`[BehaviorTree] healAction SUCCEED: ${ctx.failedStep.action}`);
      return 'SUCCEED';
    }
    return 'FAIL';
  } catch (err: any) {
    appLogger.warn(`[BehaviorTree] healAction threw: ${err.message}`);
    return 'FAIL';
  }
}, 'healAction');

const markCodeFault = new Action(async (ctx) => {
  appLogger.info(
    `[BehaviorTree] ASSERTION_FAILURE → CODE_FAULT for step "${ctx.failedStep.action}"`,
  );
  // Signal to caller that this is a real bug — do not retry
  ctx.extraWaitMs = -1; // sentinel: code fault, not retriable
  return 'SUCCEED'; // the Sequence succeeds (we classified it correctly)
}, 'markCodeFault');

const markExecFault = new Action(async (ctx) => {
  appLogger.warn(
    `[BehaviorTree] Default leaf: EXEC_FAULT for step "${ctx.failedStep.action}" — no heal strategy`,
  );
  return 'SUCCEED'; // always succeed so Root Selector stops at this leaf
}, 'markExecFault');

// ─── Tree construction ────────────────────────────────────────────────────────

/**
 * Root (Selector)
 * ├── Sequence: [isSelectorOrTimingError] AND [hasClient] AND [healAction]
 * ├── Sequence: [isTimingFault] AND [retryWithWait] AND [hasClient] AND [healAction]
 * ├── Sequence: [isAssertionFailure] AND [markCodeFault]
 * └── Action:  markExecFault
 */
const HEALING_TREE: BtNode = new Selector([
  // Branch 1: Selector/Timing/Exec errors with a live client → try AI heal
  new Sequence([isSelectorOrTimingError, hasClient, healAction]),
  // Branch 2: Timing fault → inject wait, then retry heal
  new Sequence([isTimingFault, retryWithWait, hasClient, healAction]),
  // Branch 3: Assertion failure → mark as code fault (real bug)
  new Sequence([isAssertionFailure, markCodeFault]),
  // Branch 4: Default — exec fault, no heal
  markExecFault,
]);

// ─── Public API ───────────────────────────────────────────────────────────────

export type HealOutcome =
  | { kind: 'healed';     healedStep: McpStep }
  | { kind: 'code_fault'; reason: string }
  | { kind: 'exec_fault'; reason: string }
  | { kind: 'retry';      waitMs: number };

/**
 * Tick the healing behavior tree for a failed step.
 *
 * @param original  The McpExecutionResult containing the failed step
 * @param client    Open PlaywrightMcpClient (may be null if unavailable)
 * @param moduleName  Module name for logging
 */
export async function tickHealingTree(
  original: McpExecutionResult,
  client: PlaywrightMcpClient | null | undefined,
  moduleName: string,
): Promise<HealOutcome> {
  const failedIdx = original.stepResults.findIndex(r => !r.passed);
  if (failedIdx < 0) {
    return { kind: 'exec_fault', reason: 'No failed step found' };
  }

  const failedStep = original.stepResults[failedIdx].step;
  const errorMsg = original.stepResults[failedIdx].message ?? '';

  const classification = FailureClassificationService.classifyFailure(errorMsg, {
    action: failedStep.action,
    selector: (failedStep as any).element || (failedStep as any).target || '',
  });

  const ctx: BtContext = {
    failedStep,
    errorMsg,
    category: classification.category,
    client: client ?? undefined,
    moduleName,
  };

  await HEALING_TREE.tick(ctx);

  // Interpret ctx state after tree execution
  if (ctx.healedStep) {
    return { kind: 'healed', healedStep: ctx.healedStep };
  }
  if (ctx.extraWaitMs === -1) {
    return { kind: 'code_fault', reason: `ASSERTION_FAILURE: ${errorMsg.slice(0, 120)}` };
  }
  if (ctx.extraWaitMs && ctx.extraWaitMs > 0) {
    return { kind: 'retry', waitMs: ctx.extraWaitMs };
  }
  return { kind: 'exec_fault', reason: errorMsg.slice(0, 120) };
}
