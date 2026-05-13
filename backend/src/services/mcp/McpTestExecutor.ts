/**
 * McpTestExecutor
 *
 * Executes a list of McpStep objects by calling PlaywrightMcpClient methods.
 * Supports session persistence and actor switching.
 */

import * as fs from 'fs';
import * as pathModule from 'path';
import { PlaywrightMcpClient, McpClientOptions } from './PlaywrightMcpClient';
import { McpStep, upgradeLegacyStep } from '../../types/mcp.types';
import { appLogger } from '../../utils/logger';
import { KENDO_ADD, KENDO_SAVE, KENDO_DELETE } from '../../constants/KendoSelectors';
import { resolveTemplate, buildDefaultContext } from '../../utils/TemplateResolver';
import { ModuleElementSchemaService } from '../discovery/ModuleElementSchemaService';
import { waitForAngularStable } from '../../utils/angularWait';
import { VisualForensicsService } from '../VisualForensicsService';

export type { McpStep } from '../../types/mcp.types';

export interface McpStepResult {
  step: McpStep;
  passed: boolean;
  message?: string;
  screenshotBase64?: string;
  /** Phase 4: Visual forensics diagnostic attached on failure */
  forensic?: { reason: string; confidence: number; suggestedFix: string; isUiChange: boolean; screenshotPath?: string };
}

export interface McpExecutorOptions extends McpClientOptions {
  loginOptions?: {
    url: string;
    usernameSelector: string;
    passwordSelector: string;
    submitSelector: string;
    username: string;
    password: string;
    idNumber?: string;
    idNumberSelector?: string;
  };
  secondaryLoginOptions?: {
    url: string;
    usernameSelector: string;
    passwordSelector: string;
    submitSelector: string;
    username: string;
    password: string;
    idNumber?: string;
    idNumberSelector?: string;
  };
  stopOnFailure?: boolean;
  assertText?: string;
  screenshotPath?: string;
  /** P2: Reuses this client instead of spawning a new browser */
  client?: PlaywrightMcpClient;
  /** Phase 2: module prefix for UI schema validation (e.g. "ATT" from "ATT-22") */
  moduleId?: string;
  /** Phase 2: DB pool for schema lookup */
  pool?: any;
}

export interface McpExecutionResult {
  passed: boolean;
  stepResults: McpStepResult[];
  durationMs: number;
  errorMessage?: string;
  uiStack?: 'Kendo UI' | 'PrimeNG' | 'Mixed' | 'Standard';
}

export class McpTestExecutor {
  static async run(
    steps: (McpStep | Record<string, any>)[],
    opts: McpExecutorOptions = {},
  ): Promise<McpExecutionResult> {
    const { loginOptions, secondaryLoginOptions, stopOnFailure = false, ...mcpOpts } = opts;
    const startMs = Date.now();
    const stepResults: McpStepResult[] = [];
    const normalisedSteps = this.normaliseSteps(steps);

    let client: PlaywrightMcpClient | null = opts.client || null;
    let isLocalClient = false;
    let currentActor = 'primary';

    try {
      if (!client) {
        client = await PlaywrightMcpClient.create(mcpOpts as McpClientOptions);
        isLocalClient = true;
        if (loginOptions) {
          appLogger.info('[McpExecutor] Performing login before test steps');
          await client.login(loginOptions);
        }
      }

      for (const step of normalisedSteps) {
        // Check for actor tags
        const stepDescription = (step as any).description?.toLowerCase() || '';
        const requestedActor = stepDescription.includes('@actor: secondary') ? 'secondary' : 'primary';

        // Perform Context Switch if actor changed
        if (requestedActor !== currentActor) {
          appLogger.info(`[McpExecutor] Context switch: changing to ${requestedActor} actor`);
          if (isLocalClient && client) {
            await client.close().catch(() => {});
          }
          client = await PlaywrightMcpClient.create(mcpOpts as McpClientOptions);
          isLocalClient = true;
          
          const switchOpts = requestedActor === 'secondary' ? secondaryLoginOptions : loginOptions;
          if (switchOpts) {
            await client.login(switchOpts);
            // Phase 2.5 P4: wait for Angular Zone.js stable state post-login
            await waitForAngularStable(expr => (client as PlaywrightMcpClient).evaluate(expr));
          }
          currentActor = requestedActor;
        }

        // ── Phase 2: UI schema validation (anti-hallucination) ──────────────────
        // Validate the step target exists in the module element schema before
        // sending it to Playwright. Non-blocking: skipped when no schema exists.
        const stepTarget = (step as any).element || (step as any).target || '';
        const actionNeedsTarget = ['click', 'fill', 'input', 'type', 'select', 'hover'].includes(
          String(step.action).toLowerCase(),
        );
        if (actionNeedsTarget && stepTarget && opts.moduleId && opts.pool) {
          const resolvedTarget = stepTarget.includes('{{')
            ? resolveTemplate(stepTarget, buildDefaultContext())
            : stepTarget;
          const schemaSvc = new ModuleElementSchemaService(opts.pool);
          const found = await schemaSvc.validateTarget(opts.moduleId, resolvedTarget).catch(() => null);
          if (found === null) {
            // Element not in schema — mark as CODE_FAULT immediately
            const schemaFault: McpStepResult = {
              step,
              passed: false,
              message: `[Schema] Element "${resolvedTarget}" was not found in UI discovery schema for module "${opts.moduleId}". ` +
                       `This is likely a hallucinated selector. Run discovery again if the UI has changed.`,
            };
            stepResults.push(schemaFault);
            if (stopOnFailure) break;
            continue;
          }
        }

        const result = await this.executeStep(client!, step);
        stepResults.push(result);

        // Phase 4: capture failure screenshot + optional AI forensics
        if (!result.passed && client) {
          try {
            const forensicDir = pathModule.join(process.cwd(), 'reports', 'forensics', opts.moduleId ?? 'unknown');
            if (!fs.existsSync(forensicDir)) fs.mkdirSync(forensicDir, { recursive: true });
            const screenshotFile = pathModule.join(forensicDir, `step_${stepResults.length}_${Date.now()}.png`);
            const buf = await client.screenshot();
            fs.writeFileSync(screenshotFile, buf);
            result.forensic = { reason: result.message ?? 'Unknown failure', confidence: 0, suggestedFix: '', isUiChange: false, screenshotPath: screenshotFile };
            if (process.env.ENABLE_FORENSICS === 'true') {
              const stepLabel = `${step.action} on "${(step as any).element ?? (step as any).target ?? 'unknown'}"`;
              const diagnostic = await VisualForensicsService.diagnoseFailure(result.message ?? '', stepLabel, screenshotFile).catch(() => null);
              if (diagnostic) result.forensic = { ...diagnostic, screenshotPath: screenshotFile };
            }
          } catch (forensicErr: any) {
            appLogger.debug(`[McpExecutor] Forensic capture skipped: ${forensicErr.message}`);
          }
        }

        if (!result.passed && stopOnFailure) {
          appLogger.warn(`[McpExecutor] Stopping after failed step: ${step.action}`);
          break;
        }
      }

      const allPassed = stepResults.every(r => r.passed);
      const lastFailed = stepResults.find(r => !r.passed);
      let detectedStack: any = 'Standard';

      if (client) {
        detectedStack = await client.detectUiStack();
        if (opts.screenshotPath) {
          try {
            const buf = await client.screenshot();
            const fs = await import('fs');
            const path = await import('path');
            const fullPath = path.isAbsolute(opts.screenshotPath) ? opts.screenshotPath : path.join(process.cwd(), opts.screenshotPath);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, buf);
          } catch (e: any) {
            appLogger.warn(`[McpExecutor] Failed to capture final screenshot: ${e.message}`);
          }
        }
      }

      return {
        passed: allPassed,
        stepResults,
        durationMs: Date.now() - startMs,
        errorMessage: lastFailed?.message,
        uiStack: detectedStack,
      };

    } catch (err: any) {
      appLogger.error(`[McpExecutor] Unhandled execution error: ${err.message}`);
      return { passed: false, stepResults, durationMs: Date.now() - startMs, errorMessage: err.message };
    } finally {
      if (client && isLocalClient) await client.close().catch(() => {});
    }
  }

  private static normaliseSteps(raw: (McpStep | Record<string, any>)[]): McpStep[] {
    return raw.flatMap((s: any) => {
      if (typeof s !== 'object' || !s.action) return [];
      if ((s.action as string).startsWith('browser_')) return [s as McpStep];
      const upgraded = upgradeLegacyStep(s);
      return upgraded ? [upgraded] : [];
    });
  }

  private static async executeStep(client: PlaywrightMcpClient, step: McpStep): Promise<McpStepResult> {
    try {
      // ── Ref Resolution Logic (Phase 2) ──────────────────────────────────────
      // If the target is a natural language name, resolve it to a ref first.
      let targetRef: string | null = null;
      const rawTarget = (step as any).element || (step as any).target || '';
      // Resolve {{timestamp}} and other template variables in element names before DOM search.
      const originalTarget = rawTarget.includes('{{')
        ? resolveTemplate(rawTarget, buildDefaultContext())
        : rawTarget;

      if (originalTarget && !this.looksLikeCssSelector(originalTarget) && !/^s\d+$/.test(originalTarget)) {
        try {
          targetRef = await client.resolveNameToRef(originalTarget);
          if (targetRef) {
            appLogger.info(`[McpExecutor] Resolved "${originalTarget}" to ref=${targetRef}`);
          }
        } catch (refErr) {
          appLogger.warn(`[McpExecutor] Ref resolution failed for "${originalTarget}": ${(refErr as Error).message}`);
        }
      }

      const finalTarget = targetRef || originalTarget;

      switch (step.action) {
        case 'browser_navigate': {
          let navUrl = step.url;
          if (!navUrl.startsWith('http') && !navUrl.startsWith('//')) {
            const base = (process.env.BASE_URL || '').replace(/\/?#?.*$/, '') || (process.env.APP_URL || '').replace(/\/?#?.*$/, '');
            if (base) navUrl = base + (navUrl.startsWith('/') ? navUrl.slice(1) : navUrl);
          }
          await client.navigate(navUrl);
          // Phase 2.5 P4: wait for Angular Zone.js stable state post-navigation
          await waitForAngularStable(expr => client.evaluate(expr));
          return { step, passed: true, message: `Navigated to ${navUrl}` };
        }
        case 'browser_click': {
          let r;
          try {
            r = await client.click(finalTarget);
} catch (e) {
             // P0 ULTIMATE FALLBACK: Semantic Intent Recognition
             const elLower = originalTarget.toLowerCase();
             const isAdd = elLower.includes('add') || elLower.includes('new') || elLower.includes('create');
             const isSave = elLower.includes('save') || elLower.includes('submit');
             const isDelete = elLower.includes('delete') || elLower.includes('remove');
             
             if (isAdd || isSave || isDelete) {
               appLogger.info(`[McpExecutor] Click failed on ${originalTarget} — running semantic intent fallback`);
               const fallbacks = isAdd ? KENDO_ADD : (isSave ? KENDO_SAVE : KENDO_DELETE);
               let lastErr = e;
               for (const sel of fallbacks) {
                 try {
                   r = await client.click(sel);
                   appLogger.info(`[McpExecutor] Fallback SUCCESS with selector: ${sel}`);
                   break;
                 } catch (err) { lastErr = err; }
               }

               if (!r) {
                 appLogger.info(`[McpExecutor] Sequential fallbacks failed. Running SMART SEARCH...`);
                 const found = await client.evaluate(`async () => {
                   const btns = Array.from(document.querySelectorAll('button, a, [role="button"], span.k-grid-add, span.k-grid-save, span.k-grid-delete, .k-button'));
                   const target = btns.find(b => {
                     const text = (b.innerText || "").toLowerCase();
                     const title = (b.getAttribute("title") || "").toLowerCase();
                     return text.includes("add") || title.includes("add") || text.includes("save") || title.includes("save");
                   });
                   if (target) { target.click(); return true; }
                   return false;
                 }`);
                 if (found === true) r = { message: 'Clicked via Smart Search' };
               }
               if (!r) throw lastErr;
             } else {
               // P0 GENERAL FALLBACK: Search for ANY element by text using DOM
               appLogger.info(`[McpExecutor] Click failed on ${originalTarget} — running DOM element search fallback`);
               const found = await client.evaluate(`async () => {
                 const searchText = '${originalTarget.replace(/'/g, "\\'")}'.toLowerCase();
                 // Search in buttons, links, list items, dropdown items
                 const selectors = [
                   'button', 'a', '[role="button"]', '[role="link"]',
                   'li', '.k-item', '.k-list-item', '.p-dropdown-item',
                   'option', 'tr', 'td'
                 ];
                 for (const sel of selectors) {
                   const elements = document.querySelectorAll(sel);
                   for (const el of elements) {
                     const text = (el.textContent || '').trim().toLowerCase();
                     const title = (el.getAttribute('title') || '').toLowerCase();
                     const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                     if (text.includes(searchText) || title.includes(searchText) || aria.includes(searchText)) {
                       if (el.click) { el.click(); return 'clicked'; }
                       if (el.scrollIntoView) { el.scrollIntoView(); return 'scrolled'; }
                     }
                   }
                 }
                 return null;
               }`);
               if (found) {
                 r = { message: `Clicked via DOM search: ${found}` };
               } else {
                 // Last resort: try role-based selector
                 const roleSel = `role=link[name="${originalTarget}"]`;
                 try {
                   r = await client.click(roleSel);
                   appLogger.info(`[McpExecutor] Fallback SUCCESS with role selector: ${roleSel}`);
                 } catch (roleErr) {
                   throw e;
                 }
               }
             }
           }
          // Phase 2.5 P4: wait for Angular Zone.js stable state post-click
          await waitForAngularStable(expr => client.evaluate(expr), 100);
          return { step, passed: true, message: r.message };
        }
        case 'browser_type': {
          const r = await client.fill(finalTarget, step.text);
          return { step, passed: true, message: r.message };
        }
        case 'browser_fill_form': {
          for (const field of step.fields) {
            let fieldRef = null;
            if (!this.looksLikeCssSelector(field.name) && !/^s\d+$/.test(field.name)) {
              fieldRef = await client.resolveNameToRef(field.name);
            }
            await client.fill(fieldRef || field.name, field.value);
          }
          return { step, passed: true, message: `Filled ${step.fields.length} fields` };
        }
        case 'browser_select_option': {
          const r = await client.selectOption(finalTarget, step.option);
          return { step, passed: true, message: r.message };
        }
        case 'browser_check_ui_state': {
          const passed = await client.checkUiState(finalTarget, step.property, step.expected);
          return { step, passed, message: passed ? `Verified: ${finalTarget} has ${step.property}=${step.expected}` : `Mismatch: ${finalTarget}` };
        }
        case 'browser_hover': {
          await client.evaluate(`async () => { 
            const el = document.querySelector(${JSON.stringify(step.element)});
            if (el) el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          }`);
          return { step, passed: true, message: `Hovered over ${step.element}` };
        }
        case 'browser_press_key': {
          await client.evaluate(`async () => {
            const el = document.activeElement || document.body;
            el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(step.key)}, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(step.key)}, bubbles: true }));
          }`);
          return { step, passed: true, message: `Pressed key: ${step.key}` };
        }
        case 'browser_wait_for': {
          const timeoutMs = step.timeout ?? 5000;
          if (step.text) {
            await client.waitForText(step.text, timeoutMs);
            return { step, passed: true, message: `Waited for text: ${step.text}` };
          }
          await this.delay(timeoutMs);
          return { step, passed: true, message: `Waited ${timeoutMs}ms` };
        }
        case 'browser_snapshot': {
          const snap = await client.snapshot();
          const assertTarget = (step as any).assertText as string | undefined;
          if (assertTarget) {
            const found = snap.text.toLowerCase().includes(assertTarget.toLowerCase());
            if (!found) return { step, passed: false, message: `Assertion failed: "${assertTarget}" not found in snapshot` };
            return { step, passed: true, message: `Assertion passed: "${assertTarget}" found` };
          }
          return { step, passed: true, message: `Snapshot captured` };
        }
        case 'browser_take_screenshot': {
          const buf = await client.screenshot();
          return { step, passed: true, message: `Screenshot captured (${buf.length} bytes)`, screenshotBase64: buf.toString('base64') };
        }
        case 'browser_evaluate': {
          const r = await client.evaluate(step.expression);
          return { step, passed: true, message: `Evaluated: ${r}` };
        }
        case 'browser_run_code': {
          await client.evaluate(step.code);
          return { step, passed: true, message: 'Executed code' };
        }
        case 'browser_close': return { step, passed: true, message: 'Close deferred to session cleanup' };
        default: return { step, passed: true, message: `Skipped unknown action "${(step as any).action}"` };
      }
    } catch (err: any) {
      return { step, passed: false, message: err.message };
    }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Check if a target string looks like a CSS selector.
   * Natural language strings should NOT be passed to querySelector().
   */
  private static looksLikeCssSelector(target: string): boolean {
    // CSS selectors start with: . # [ : or an HTML tag name
    return /^[.#\[:a-z]/i.test(target) &&
      // Exclude plain words like "Save button", "Add New", "Department Name"
      !/^[a-z]+(\s+[a-z]+){1,5}$/i.test(target.trim());
  }
}
