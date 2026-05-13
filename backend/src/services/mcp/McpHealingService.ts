/**
 * McpHealingService
 *
 * On-demand AI-powered step healing triggered ONLY when a McpTestExecutor step fails.
 * Normal execution path has zero AI cost — healing is the exception, not the rule.
 *
 * Three heal strategies:
 *   healAction()    — fix wrong selector/element (happy_path + all types)
 *   healAssertion() — adapt expected text OR classify REAL_BUG (negative + edge_case)
 *   extractFieldConstraints() + generateEdgeCaseData() — boundary/invalid data (edge_case)
 *
 * Heal history is written to test_scripts.heal_history so future runs can skip
 * re-healing the same selector.
 */

import { PlaywrightMcpClient } from './PlaywrightMcpClient';
import { McpStep } from '../../types/mcp.types';
import { AiControllerService } from '../shared/AiControllerService';
import { appLogger } from '../../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FailureClass = 'ACTION_FAIL' | 'ASSERTION_FAIL' | 'UNRECOVERABLE';

export type AssertionHealResult =
  | { outcome: 'updated'; step: McpStep }
  | { outcome: 'real_bug'; reason: string }
  | { outcome: 'investigate'; reason: string }
  | null;

export interface FieldConstraint {
  selector: string;
  name: string;
  type: string;           // 'text' | 'number' | 'date' | 'select' | 'checkbox'
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  required: boolean;
  options?: string[];     // for select fields
}

export interface EdgeCaseData {
  field: string;
  variant: 'boundary_max' | 'boundary_min' | 'empty' | 'invalid_pattern' | 'special_chars';
  value: string;
}

export interface HealHistoryEntry {
  step_index: number;
  original: string;       // original selector/element
  healed: string;         // healed selector/element
  healed_at: string;      // ISO timestamp
  success: boolean;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class McpHealingService {

  // ── Failure Classification ────────────────────────────────────────────────

  /**
   * Classify why a step failed so the right healing strategy is applied.
   * ACTION_FAIL  → selector/element not found → healAction()
   * ASSERTION_FAIL → assertText not matched → healAssertion()
   * UNRECOVERABLE → navigation wrong, page crashed → give up, CODE_FAULT
   */
  static classify(step: McpStep, errorMessage: string): FailureClass {
    const err = (errorMessage ?? '').toLowerCase();

    // Navigation failures are unrecoverable — wrong route or redirect loop
    if (step.action === 'browser_navigate') return 'UNRECOVERABLE';

    // Page/frame closed — browser crashed or session expired
    if (err.includes('target page') || err.includes('browser has been closed') ||
        err.includes('page has been closed') || err.includes('frame was detached')) {
      return 'UNRECOVERABLE';
    }

    // Assertion step — expected text not found in snapshot
    if (step.action === 'browser_snapshot' && (step as any).assertText) {
      return 'ASSERTION_FAIL';
    }

    // Everything else: selector timeout, strict mode, element not found
    return 'ACTION_FAIL';
  }

  // ── Action Healing ────────────────────────────────────────────────────────

  /**
   * Heal a failed action step (click/fill/select) by taking a live accessibility
   * snapshot and asking Gemini to return a corrected selector.
   *
   * @param step         The McpStep that failed
   * @param client       Open PlaywrightMcpClient (browser still open)
   * @param moduleSkills Optional module business-rule context string for the prompt
   * @returns            Corrected McpStep or null if unrecoverable
   */
  static async healAction(
    step: McpStep,
    client: PlaywrightMcpClient,
    moduleSkills?: string,
  ): Promise<McpStep | null> {
    let snapshot: { text: string } = { text: '' };
    try {
      snapshot = await client.snapshot();
    } catch {
      appLogger.warn('[McpHealing] Could not take snapshot for healAction — page may be gone');
      return null;
    }

    const skillBlock = moduleSkills
      ? `\nModule business rules / known selectors:\n${moduleSkills.slice(0, 800)}`
      : '';

    const prompt = `You are a Playwright automation expert. A browser step failed and needs a corrected selector.

Failed step:
${JSON.stringify(step, null, 2)}

Error: selector or element not found on the page.
${skillBlock}

Live page accessibility tree (find the correct element here):
${snapshot.text.slice(0, 4000)}

Return ONLY a corrected McpStep as valid JSON — same action, fix only the selector/element/text fields.
If the element genuinely does not exist on this page, return the JSON: null
Do not add explanation. Return JSON only.`;

    try {
      const raw = await AiControllerService.generate('CODE', prompt, true);
      const parsed = JSON.parse(raw.trim());
      if (parsed === null) return null;
      // Basic validation: must have same action
      if (typeof parsed !== 'object' || parsed.action !== step.action) return null;
      appLogger.info(`[McpHealing] healAction success: ${step.action} → ${JSON.stringify(parsed).slice(0, 120)}`);
      return parsed as McpStep;
    } catch (err: any) {
      appLogger.warn(`[McpHealing] healAction AI parse failed: ${err.message}`);
      return null;
    }
  }

  // ── Assertion Healing ─────────────────────────────────────────────────────

  /**
   * Heal a failed assertion (browser_snapshot with assertText).
   *
   * Three outcomes:
   *   'updated'   → similar text found with different wording → update assertion
   *   'real_bug'  → expected error never appeared → application bug confirmed/fixed
   *   'investigate' → unexpected page state, needs human review
   *
   * Used for negative + edge_case scenarios where error messages vary.
   */
  static async healAssertion(
    step: McpStep,
    client: PlaywrightMcpClient,
  ): Promise<AssertionHealResult> {
    const expectedText = (step as any).assertText as string ?? '';

    let snapshot: { text: string } = { text: '' };
    try {
      snapshot = await client.snapshot();
    } catch {
      return null;
    }

    const prompt = `You are a QA analyst reviewing a failed test assertion.

Expected text in assertion: "${expectedText}"

Live page accessibility tree after the test actions were performed:
${snapshot.text.slice(0, 4000)}

Analyse the page state and return a JSON object with one of these outcomes:

{ "outcome": "updated", "foundText": "<exact text visible on page that matches intent>" }
  → use when a similar error/validation message exists but with different wording

{ "outcome": "real_bug", "reason": "<brief explanation>" }
  → use when NO error message appeared at all (expected error never triggered)
  → this means either the bug is fixed or the test precondition is wrong

{ "outcome": "investigate", "reason": "<brief explanation>" }
  → use when the page is in an unexpected state unrelated to the assertion

Return JSON only, no explanation outside the JSON object.`;

    try {
      const raw = await AiControllerService.generate('CODE', prompt, true);
      const parsed = JSON.parse(raw.trim());

      if (parsed.outcome === 'updated' && parsed.foundText) {
        const healedStep: McpStep = { ...step, assertText: parsed.foundText } as any;
        appLogger.info(`[McpHealing] healAssertion: updated assertion text → "${parsed.foundText}"`);
        return { outcome: 'updated', step: healedStep };
      }

      if (parsed.outcome === 'real_bug') {
        appLogger.info(`[McpHealing] healAssertion: REAL_BUG — ${parsed.reason}`);
        return { outcome: 'real_bug', reason: parsed.reason };
      }

      appLogger.info(`[McpHealing] healAssertion: INVESTIGATE — ${parsed.reason}`);
      return { outcome: 'investigate', reason: parsed.reason };

    } catch (err: any) {
      appLogger.warn(`[McpHealing] healAssertion AI parse failed: ${err.message}`);
      return null;
    }
  }

  // ── Edge Case: Field Constraints ──────────────────────────────────────────

  /**
   * Extract field constraints from a live accessibility snapshot.
   * Used before running edge_case scenarios to generate boundary test data.
   */
  static extractFieldConstraints(snapshotText: string): FieldConstraint[] {
    const constraints: FieldConstraint[] = [];

    // Patterns to detect from accessibility tree text
    // e.g. "textbox 'Days' maxlength=3 required" or "spinbutton 'Amount' min=0 max=999"
    const inputPattern = /(?:textbox|spinbutton|combobox|listbox)\s+'([^']+)'([^,\n]*)/gi;
    let match: RegExpExecArray | null;

    while ((match = inputPattern.exec(snapshotText)) !== null) {
      const name = match[1];
      const attrs = match[2];

      const constraint: FieldConstraint = {
        selector: `[aria-label="${name}"], input[name="${name.toLowerCase()}"]`,
        name,
        type: match[0].toLowerCase().startsWith('spin') ? 'number' : 'text',
        required: attrs.includes('required'),
      };

      const maxLen = /maxlength[=:\s]+(\d+)/i.exec(attrs);
      if (maxLen) constraint.maxLength = parseInt(maxLen[1], 10);

      const min = /\bmin[=:\s]+(\d+)/i.exec(attrs);
      if (min) constraint.min = parseInt(min[1], 10);

      const max = /\bmax[=:\s]+(\d+)/i.exec(attrs);
      if (max) constraint.max = parseInt(max[1], 10);

      const pattern = /pattern[=:\s]+"([^"]+)"/i.exec(attrs);
      if (pattern) constraint.pattern = pattern[1];

      constraints.push(constraint);
    }

    return constraints;
  }

  /**
   * Generate boundary / invalid test data for each field constraint.
   * Used to inject into McpStep.text before running edge_case scenarios.
   */
  static generateEdgeCaseData(constraints: FieldConstraint[]): EdgeCaseData[] {
    const data: EdgeCaseData[] = [];

    for (const c of constraints) {
      // Empty (required field left blank)
      if (c.required) {
        data.push({ field: c.name, variant: 'empty', value: '' });
      }

      // Boundary: max+1 for text length
      if (c.maxLength) {
        data.push({
          field: c.name,
          variant: 'boundary_max',
          value: 'A'.repeat(c.maxLength + 1),
        });
      }

      // Boundary: numeric overflow
      if (c.type === 'number' && c.max !== undefined) {
        data.push({
          field: c.name,
          variant: 'boundary_max',
          value: String(c.max + 1),
        });
      }

      // Pattern violation
      if (c.pattern) {
        // If pattern is [A-Z]+ (letters only) → supply digits
        const violatesLetterOnly = /^\[A-Z\]\+?$/.test(c.pattern) || /^\[a-zA-Z\]\+?$/.test(c.pattern);
        if (violatesLetterOnly) {
          data.push({ field: c.name, variant: 'invalid_pattern', value: '12345' });
        }
      }

      // Special characters
      data.push({ field: c.name, variant: 'special_chars', value: '<script>alert(1)</script>' });
    }

    return data;
  }
}
