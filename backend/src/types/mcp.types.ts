/**
 * McpStep — Canonical type for @playwright/mcp tool calls.
 *
 * Each member of the discriminated union maps exactly to one `browser_*` tool
 * exposed by the @playwright/mcp server. The `action` field IS the tool name,
 * so MCPReplayExecutor can do:
 *
 *   client.call(step.action, step)   // no extra mapping needed
 *
 * When adding new tools, extend the union AND the McpStepSchema below.
 */

import { z } from 'zod';

// ─── Individual step schemas ─────────────────────────────────────────────────

const McpNavigate = z.object({
  action:  z.literal('browser_navigate'),
  url:     z.string().min(1),
  /** Optional wait-until hint for slow Angular routes */
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
});

const McpClick = z.object({
  action:  z.literal('browser_click'),
  /** Accessible name or CSS selector */
  element: z.string().min(1),
  ref:     z.string().optional(),
});

const McpType = z.object({
  action:  z.literal('browser_type'),
  element: z.string().min(1),
  text:    z.string(),
});

const McpFillForm = z.object({
  action: z.literal('browser_fill_form'),
  fields: z.array(z.object({ name: z.string(), value: z.string() })),
});

const McpSelectOption = z.object({
  action:  z.literal('browser_select_option'),
  element: z.string().min(1),
  option:  z.string(),
});

const McpHover = z.object({
  action:  z.literal('browser_hover'),
  element: z.string().min(1),
});

const McpDrag = z.object({
  action: z.literal('browser_drag'),
  source: z.string().min(1),
  target: z.string().min(1),
});

const McpPressKey = z.object({
  action: z.literal('browser_press_key'),
  key:    z.string().min(1),   // e.g. "Enter", "Tab", "Escape"
});

const McpTakeScreenshot = z.object({
  action:   z.literal('browser_take_screenshot'),
  fileName: z.string().optional(),
});

const McpSnapshot = z.object({
  action: z.literal('browser_snapshot'),
});

const McpEvaluate = z.object({
  action:     z.literal('browser_evaluate'),
  expression: z.string().min(1),
});

const McpRunCode = z.object({
  action: z.literal('browser_run_code'),
  code:   z.string().min(1),
});

const McpWaitFor = z.object({
  action:  z.literal('browser_wait_for'),
  /** Text to wait for, or omit for a plain timeout */
  text:    z.string().optional(),
  timeout: z.number().positive().optional(),
});

const McpHandleDialog = z.object({
  action: z.literal('browser_handle_dialog'),
  accept: z.boolean().optional(),
});

const McpClose = z.object({
  action: z.literal('browser_close'),
});

const McpFileUpload = z.object({
  action:  z.literal('browser_file_upload'),
  element: z.string().min(1),
  files:   z.array(z.string()),
});

const McpCheckUiState = z.object({
  action:   z.literal('browser_check_ui_state'),
  element:  z.string().min(1),
  property: z.string().min(1),
  expected: z.string().min(1),
});

// ─── Combined schema + type ───────────────────────────────────────────────────

export const McpStepSchema = z.discriminatedUnion('action', [
  McpNavigate,
  McpClick,
  McpType,
  McpFillForm,
  McpSelectOption,
  McpHover,
  McpDrag,
  McpPressKey,
  McpTakeScreenshot,
  McpSnapshot,
  McpEvaluate,
  McpRunCode,
  McpWaitFor,
  McpHandleDialog,
  McpClose,
  McpFileUpload,
  McpCheckUiState,
]);

export type McpStep = z.infer<typeof McpStepSchema>;

/** Validate an array of raw steps from AI output. Returns typed steps or null. */
export function parseMcpSteps(raw: unknown[]): McpStep[] | null {
  const result = McpStepSchema.array().safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Map legacy McpTestExecutor action names to new browser_* names.
 * Used when migrating stored scripts from the old format.
 */
export function upgradeLegacyStep(old: { action: string; target?: string; value?: string }): McpStep | null {
  switch (old.action) {
    case 'navigate':
      return { action: 'browser_navigate', url: old.target ?? '' };
    case 'click':
      return { action: 'browser_click', element: old.target ?? '' };
    case 'fill':
      return { action: 'browser_type', element: old.target ?? '', text: old.value ?? '' };
    case 'select':
      return { action: 'browser_select_option', element: old.target ?? '', option: old.value ?? '' };
    case 'wait':
      return { action: 'browser_wait_for', text: old.target ?? undefined, timeout: old.value ? parseInt(old.value) : undefined };
    case 'assert':
    case 'snapshot':
      return { action: 'browser_snapshot' };
    case 'screenshot':
      return { action: 'browser_take_screenshot' };
    default:
      return null;
  }
}
