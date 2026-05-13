/**
 * ExecutionEventTypes.ts
 *
 * S4-5: Structured execution event stream.
 *
 * Replaces the raw Playwright stdout wall-of-text with a typed event envelope
 * so the frontend can render a proper step timeline instead of a concatenated
 * log dump. Backward-compatible: `execution:log` still fires for every line;
 * the new `execution:step` event fires ONLY when a line matches a known pattern.
 *
 * Wire format (JSON over WebSocket):
 * {
 *   type: 'execution:step',
 *   payload: ExecutionStepEvent,
 *   timestamp: ISO string
 * }
 */

// ---------------------------------------------------------------------------
// Event kind union
// ---------------------------------------------------------------------------

export type ExecutionEventKind =
  | 'case.start'   // Test-case execution begins
  | 'case.pass'    // Test-case passed
  | 'case.fail'    // Test-case failed
  | 'step.start'   // Individual step begins
  | 'step.pass'    // Individual step passed
  | 'step.fail'    // Individual step failed
  | 'artifact'     // Screenshot / video / trace path emitted
  | 'heal.start'   // Self-heal attempt beginning
  | 'heal.pass'    // Self-heal succeeded
  | 'heal.fail'    // Self-heal failed
  | 'log';         // Raw stdout that didn't match any pattern

// ---------------------------------------------------------------------------
// Event payload
// ---------------------------------------------------------------------------

export interface ExecutionStepEvent {
  kind: ExecutionEventKind;
  ticketId: string;
  userId: string;
  /** Scenario/test-case ID when known. */
  caseId?: string;
  /** 1-based step number when known. */
  stepNumber?: number;
  /** Human-readable message — the log line itself, cleaned up. */
  message: string;
  /** File path for artifact events. */
  artifactPath?: string;
  /** Artifact type — screenshot, video, trace, report. */
  artifactType?: 'screenshot' | 'video' | 'trace' | 'report' | 'zip';
  /** ISO timestamp of the event. */
  ts: string;
}

// ---------------------------------------------------------------------------
// Log line parser
// ---------------------------------------------------------------------------

/** Playwright stdout line patterns → event kind. */
const LINE_PATTERNS: ReadonlyArray<{
  kind: ExecutionEventKind;
  pattern: RegExp;
  extract?: (m: RegExpMatchArray) => Partial<ExecutionStepEvent>;
}> = [
  // Case-level: Playwright "Running N tests" or our wrapper lines
  {
    kind: 'case.start',
    pattern: /running test case[:\s]+(.+)/i,
    extract: (m) => ({ caseId: m[1]?.trim() }),
  },
  {
    kind: 'case.start',
    pattern: /^\s*›?\s*\[TestExecution\]\s+Executing:\s+(.+)/i,
    extract: (m) => ({ message: `Executing: ${m[1]?.trim()}` }),
  },
  // Step start — our generated scripts emit `console.log('Step X: ...')`
  {
    kind: 'step.start',
    pattern: /^\s*Step\s+(\d+):\s+(.+)$/i,
    extract: (m) => ({ stepNumber: parseInt(m[1], 10), message: `Step ${m[1]}: ${m[2]}` }),
  },
  // Step PASSED
  {
    kind: 'step.pass',
    pattern: /step\s+(\d+):\s+(?:PASSED|passed|✓|✔)/i,
    extract: (m) => ({ stepNumber: parseInt(m[1], 10) }),
  },
  // Step FAILED
  {
    kind: 'step.fail',
    pattern: /step\s+(\d+):\s+(?:FAILED|failed|✗|✘)/i,
    extract: (m) => ({ stepNumber: parseInt(m[1], 10) }),
  },
  // Playwright native: "  ✓  test-name (123ms)"
  {
    kind: 'case.pass',
    pattern: /^\s*[✓✔]\s+(.+?)(?:\s+\(\d+ms\))?\s*$/,
    extract: (m) => ({ message: `PASS: ${m[1]?.trim()}` }),
  },
  // Playwright native: "  ×  test-name"
  {
    kind: 'case.fail',
    pattern: /^\s*[✗✘×]\s+(.+?)(?:\s+\(\d+ms\))?\s*$/,
    extract: (m) => ({ message: `FAIL: ${m[1]?.trim()}` }),
  },
  // Self-heal
  {
    kind: 'heal.start',
    pattern: /\[SelfHealing\]\s+(?:Attempt|Starting|Trying)/i,
  },
  {
    kind: 'heal.pass',
    pattern: /\[SelfHealing\]\s+Healed run completed.*PASS/i,
  },
  {
    kind: 'heal.fail',
    pattern: /\[SelfHealing\]\s+(?:Healed run failed|All.*failed|confidence too low)/i,
  },
  // Artifact paths — screenshot/video/trace/HTML report
  {
    kind: 'artifact',
    pattern: /screenshot[:\s]+(.+\.png)/i,
    extract: (m) => ({ artifactPath: m[1]?.trim(), artifactType: 'screenshot' }),
  },
  {
    kind: 'artifact',
    pattern: /video[:\s]+(.+\.webm)/i,
    extract: (m) => ({ artifactPath: m[1]?.trim(), artifactType: 'video' }),
  },
  {
    kind: 'artifact',
    pattern: /trace[:\s]+(.+\.zip)/i,
    extract: (m) => ({ artifactPath: m[1]?.trim(), artifactType: 'trace' }),
  },
  {
    kind: 'artifact',
    pattern: /([\w/\\:\-.]+\.html)\b/,
    extract: (m) => ({ artifactPath: m[1]?.trim(), artifactType: 'report' }),
  },
];

/**
 * Parse a single Playwright stdout line into a typed `ExecutionStepEvent`.
 *
 * Always returns an event — worst case `kind: 'log'` with the raw message.
 * Never throws.
 */
export function parseLogLine(
  line: string,
  ctx: { ticketId: string; userId: string; caseId?: string },
): ExecutionStepEvent {
  const trimmed = (line || '').trimEnd();
  const ts = new Date().toISOString();
  const base: ExecutionStepEvent = {
    kind: 'log',
    ticketId: ctx.ticketId,
    userId: ctx.userId,
    caseId: ctx.caseId,
    message: trimmed,
    ts,
  };

  for (const def of LINE_PATTERNS) {
    const m = trimmed.match(def.pattern);
    if (m) {
      const extra = def.extract ? def.extract(m) : {};
      return {
        ...base,
        kind: def.kind,
        message: extra.message ?? trimmed,
        ...extra,
      };
    }
  }

  return base;
}
