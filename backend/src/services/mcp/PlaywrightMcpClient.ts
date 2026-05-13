/**
 * PlaywrightMcpClient
 *
 * Spawns @playwright/mcp as a stdio child process and speaks JSON-RPC 2.0 to it.
 * Provides a clean async API for the rest of the backend.
 * 
 * DESIGN GOAL: Match native Gemini CLI/Claude CLI fidelity by using proper 
 * JSON-RPC lifecycle and robust result parsing.
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { appLogger } from '../../utils/logger';

// ─── OS-aware browser check + auto-install ────────────────────────────────────

// Browsers that are installed system-wide (not managed by Playwright cache)
const SYSTEM_BROWSERS = ['chrome', 'msedge'];

async function ensureBrowserInstalled(browser: string): Promise<void> {
  const isWindows = process.platform === 'win32';
  const isLinux   = process.platform === 'linux';

  // System browsers: skip cache check, let MCP find them in PATH
  if (SYSTEM_BROWSERS.includes(browser)) {
    appLogger.info(`[PlaywrightMcp] Using system browser "${browser}" — skipping cache check`);
    return;
  }

  // Where ms-playwright stores browsers
  const playwrightHome =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (isWindows
      ? path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'ms-playwright')
      : path.join(process.env.HOME || '/root', '.cache', 'ms-playwright'));

  // P0: @playwright/mcp remaps 'chromium' → 'chrome-for-testing' channel internally,
  // so we must also check for that directory when browser === 'chromium'.
  const dirsToCheck = browser === 'chromium'
    ? [browser, 'chrome-for-testing', 'mcp-chrome']
    : [browser, 'mcp-chrome'];
  let found = false;
  if (fs.existsSync(playwrightHome)) {
    const dirs = fs.readdirSync(playwrightHome);
    found = dirs.some(d => dirsToCheck.some(check => d.startsWith(check)));
  }

  if (found) {
    appLogger.info(`[PlaywrightMcp] Browser "${browser}" found in ${playwrightHome}`);
    return;
  }

  appLogger.warn(`[PlaywrightMcp] Browser "${browser}" not found — auto-installing via playwright...`);
  try {
    // P0: @playwright/mcp remaps 'chromium' → 'chrome-for-testing' internally,
    // so we must install both to satisfy the MCP's internal lookup.
    const browsersToInstall = browser === 'chromium' ? [browser, 'chrome-for-testing'] : [browser];
    for (const b of browsersToInstall) {
      const installCmd = isLinux
        ? `npx playwright install ${b} --with-deps`
        : `npx playwright install ${b}`;
      execSync(installCmd, { stdio: 'inherit' });
    }
    appLogger.info(`[PlaywrightMcp] Browser "${browser}" installed successfully`);
  } catch (e: any) {
    appLogger.error(`[PlaywrightMcp] Auto-install failed: ${e.message}. Run manually: npx playwright install ${browser}`);
    // Do not throw — let the MCP process try anyway; extractText() will catch the error
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface McpClientOptions {
  headless?: boolean;
  browser?: 'chromium' | 'chrome' | 'firefox' | 'webkit';
  width?: number;
  height?: number;
  env?: Record<string, string>;
}

export interface SnapshotResult {
  text: string;
  url?: string;
}

interface McpContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface NavigateResult {
  title?: string;
  url?: string;
}

export interface ClickResult {
  message: string;
}

export interface FillResult {
  message: string;
}

export interface SelectResult {
  message: string;
}

export interface WaitResult {
  message: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: {
    content?: McpContentBlock[];
    tools?: Array<{ name: string; description?: string }>;
    [key: string]: unknown;
  };
  error?: { code: number; message: string; data?: unknown };
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class PlaywrightMcpClient extends EventEmitter {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buffer = '';
  private closed = false;
  private _lastUrl = '';

  private constructor(proc: ChildProcess) {
    super();
    this.proc = proc;
    this.attachListeners();
  }

  static async create(opts: McpClientOptions = {}): Promise<PlaywrightMcpClient> {
    const { headless = true, browser = 'chromium', width = 1440, height = 900, env = {} } = opts;

    // Verify browser is installed for this OS; auto-install if missing
    await ensureBrowserInstalled(browser);

    const sessionId = Date.now() + '-' + Math.floor(Math.random() * 1000);
    const args = [
      '@playwright/mcp@latest',
      `--browser=${browser}`,
      `--viewport-size=${width},${height}`,
      `--user-data-dir=./.playwright-mcp/profile-${sessionId}`
    ];
    if (headless) args.push('--headless');
    // Ubuntu/Linux headless servers require --no-sandbox (Chromium refuses to run as root otherwise)
    if (process.platform === 'linux') args.push('--no-sandbox');

    appLogger.info('[PlaywrightMcp] Spawning: npx ' + args.join(' '));
    const proc = spawn('npx', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
    });

    const client = new PlaywrightMcpClient(proc);
    await client.initialize();
    return client;
  }

  static async runSession<T>(opts: McpClientOptions, cb: (client: PlaywrightMcpClient) => Promise<T>): Promise<T> {
    const client = await this.create(opts);
    try {
      return await cb(client);
    } finally {
      await client.close();
    }
  }

  /**
   * P1: Proper MCP Lifecycle Handshake.
   */
  private async initialize(): Promise<void> {
    try {
      // 1. initialize
      const initResp = await this.rawCall('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'GoHybridAI', version: '1.2.0' }
      });
      appLogger.info('[PlaywrightMcp] Handshake success: ' + JSON.stringify(initResp.result));

      // 2. initialized notification
      this.send({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      });

      // 3. tools/list
      const toolsResp = await this.rawCall('tools/list', {});
      const tools = ((toolsResp?.result as any)?.tools ?? []).map((t: any) => t.name);
      appLogger.info('[PlaywrightMcp] Available tools: ' + tools.join(', '));
    } catch (err) {
      appLogger.error('[PlaywrightMcp] Handshake failed: ' + (err as Error).message);
      // Fallback for non-compliant servers: try to list tools directly
      try {
        const toolsResp = await this.call('tools/list', {});
        const tools = ((toolsResp?.result as any)?.tools ?? []).map((t: any) => t.name);
        appLogger.info('[PlaywrightMcp] Fallback tools/list success: ' + tools.join(', '));
      } catch (fErr) {}
    }
  }

  /**
   * Fingerprints the current page to detect which UI library is being used.
   */
  public async detectUiStack(): Promise<'Kendo UI' | 'PrimeNG' | 'Mixed' | 'Standard'> {
    try {
      const script = 'async () => {' +
        'const hasKendo = !!document.querySelector(\'[class*="k-"], [data-role*="kendo"]\');' +
        'const hasPrime = !!document.querySelector(\'[class*="p-"], [data-pc-name]\');' +
        'if (hasKendo && hasPrime) return "Mixed";' +
        'if (hasPrime) return "PrimeNG";' +
        'if (hasKendo) return "Kendo UI";' +
        'return "Standard";' +
        '}';
      const result = await this.evaluate(script);
      if (typeof result === 'string') {
        if (result.includes('PrimeNG')) return 'PrimeNG';
        if (result.includes('Kendo UI')) return 'Kendo UI';
        if (result.includes('Mixed')) return 'Mixed';
      }
      return 'Standard';
    } catch (e) {
      return 'Standard';
    }
  }

  // ─── High-level API ────────────────────────────────────────────────────────

  public async title(): Promise<string> {
    const res = await this.evaluate('async () => document.title');
    return String(res || '');
  }

  public url(): string {
    return this._lastUrl;
  }

  public async navigate(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<NavigateResult> {
    const raw = await this.call('browser_navigate', {
      url,
      ...(options?.waitUntil && { waitUntil: options.waitUntil }),
      ...(options?.timeout && { timeout: options.timeout })
    });
    this._lastUrl = url;
    return { title: this.extractText(raw), url };
  }

  public async snapshot(): Promise<SnapshotResult> {
    const raw = await this.call('browser_snapshot', {});
    return { text: this.extractText(raw) };
  }

  public async click(selector: string): Promise<ClickResult> {
    const isRef = this.isRef(selector);
    try {
      // Standard @playwright/mcp 0.0.70+ uses 'target' as the primary locator
      const raw = await this.call('browser_click', { target: selector, element: isRef ? undefined : selector });
      const text = this.extractText(raw);
      const isError = (raw?.result as any)?.isError;
      if (!isError) return { message: text };
      if (isRef) throw new Error(text || 'browser_click failed');
    } catch (err) {
      if (isRef) throw err;
    }
    const msg = await this.evaluateAction(selector, 'click');
    return { message: 'Clicked via evaluate: ' + selector + ' (' + msg + ')' };
  }

  public async fill(selector: string, value: string): Promise<FillResult> {
    const isRef = this.isRef(selector);
    try {
      // Standard @playwright/mcp uses 'target' and 'text'
      const raw = await this.call('browser_type', { target: selector, element: isRef ? undefined : selector, text: value });
      const text = this.extractText(raw);
      const isError = (raw?.result as any)?.isError;
      if (!isError) return { message: text };
      if (isRef) throw new Error(text || 'browser_type failed');
    } catch (err) {
      if (isRef) throw err;
    }
    const msg = await this.evaluateAction(selector, 'fill', value);
    return { message: 'Filled via evaluate: ' + selector + ' (' + msg + ')' };
  }

  public async selectOption(selector: string, value: string): Promise<SelectResult> {
    const isRef = this.isRef(selector);
    try {
      // Standard @playwright/mcp uses 'target' and 'values' (array)
      const raw = await this.call('browser_select_option', { target: selector, element: isRef ? undefined : selector, values: [value] });
      const text = this.extractText(raw);
      const isError = (raw?.result as any)?.isError;
      if (!isError) return { message: text };
      if (isRef) throw new Error(text || 'browser_select_option failed');
    } catch (err) {
      if (isRef) throw err;
    }
    const msg = await this.evaluateAction(selector, 'select', value);
    return { message: 'Selected via evaluate: ' + selector + ' (' + msg + ')' };
  }

  public async checkUiState(selector: string, property: string, expectedValue: string): Promise<boolean> {
    const isMcpRef = /^s\d+$/.test(selector);
    const looksLikeCss = !isMcpRef && (
      selector.startsWith('.') || selector.startsWith('#') || selector.startsWith('[') ||
      selector.includes('>') || /^[a-z][\w-]*\[/.test(selector)
    );

    // For MCP refs and natural-language names use 0.0.70 verify tools first,
    // then fall back to snapshot text search.
    if (isMcpRef || !looksLikeCss) {
      // Try browser_verify_text_visible (0.0.70+)
      if (expectedValue) {
        const visible = await this.verifyTextVisible(expectedValue);
        if (visible) return true;
      }
      // Snapshot text fallback
      try {
        const snapshot = await this.snapshot();
        const lower = snapshot.text.toLowerCase();
        if (expectedValue && lower.includes(expectedValue.toLowerCase())) return true;
        return lower.includes(selector.toLowerCase());
      } catch (e) {
        appLogger.warn(`[PlaywrightMcp] checkUiState snapshot fallback failed for "${selector}": ${(e as Error).message}`);
        throw new Error('Element not found: ' + selector);
      }
    }

    const script = 'async () => {' +
      'const el = document.querySelector(' + JSON.stringify(selector) + ');' +
      'if (!el) return "not_found";' +
      'const style = window.getComputedStyle(el);' +
      'return style[' + JSON.stringify(property) + '];' +
      '}';
    const actualValue = await this.evaluate(script);
    if (actualValue === 'not_found') throw new Error('Element not found: ' + selector);
    return String(actualValue).includes(expectedValue);
  }

  public async waitForText(text: string, timeoutMs = 10000): Promise<WaitResult> {
    const raw = await this.call('browser_wait_for', { text, timeout: timeoutMs });
    return { message: this.extractText(raw) };
  }

  public async screenshot(): Promise<Buffer> {
    // @playwright/mcp >= 0.0.29 renamed browser_screenshot → browser_take_screenshot
    const raw = await this.call('browser_take_screenshot', {});
    const imageBlock = (raw?.result?.content || []).find((c: any) => c.type === 'image');
    return imageBlock?.data ? Buffer.from(imageBlock.data, 'base64') : Buffer.alloc(0);
  }

  /**
   * Generate a stable CSS/role locator for an element ref from the current snapshot.
   * Returns null if the tool is unavailable or the ref can't be resolved.
   *
   * @playwright/mcp 0.0.70+ only.
   * Use this after resolveNameToRef() to get a reusable selector for future script replay.
   */
  public async generateLocator(ref: string): Promise<string | null> {
    try {
      const raw = await this.call('browser_generate_locator', { ref });
      const text = this.extractText(raw);
      return text || null;
    } catch (e) {
      appLogger.warn(`[PlaywrightMcp] browser_generate_locator not available or failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Verify text is visible on the current page (snapshot-based assertion).
   * Returns true if visible, false if not, throws on MCP error.
   *
   * @playwright/mcp 0.0.70+ only.
   */
  public async verifyTextVisible(text: string): Promise<boolean> {
    try {
      const raw = await this.call('browser_verify_text_visible', { text });
      const msg = this.extractText(raw);
      // The tool throws on failure; reaching here means the text was found
      return !msg.toLowerCase().includes('not visible') && !msg.toLowerCase().includes('not found');
    } catch (e) {
      return false;
    }
  }

  /**
   * Verify an element with the given role and accessible name is visible.
   * Returns true if visible, false otherwise.
   *
   * @playwright/mcp 0.0.70+ only.
   */
  public async verifyElementVisible(role: string, accessibleName: string): Promise<boolean> {
    try {
      const raw = await this.call('browser_verify_element_visible', { role, accessibleName });
      const msg = this.extractText(raw);
      return !msg.toLowerCase().includes('not visible') && !msg.toLowerCase().includes('not found');
    } catch (e) {
      return false;
    }
  }

  /**
   * Run a Playwright code snippet directly on the current page.
   * Useful for complex interactions that can't be expressed as single tool calls.
   *
   * @playwright/mcp 0.0.70+ only.
   * @param code Playwright code. Must be a self-contained async function body.
   *             The variable `page` is available in scope.
   */
  public async runCode(code: string): Promise<string> {
    const raw = await this.call('browser_run_code', { code });
    return this.extractText(raw);
  }

  public async login(opts: any): Promise<void> {
    const appBase = opts.url.replace(/\/$/, '');
    const loginUrl = appBase.includes('#') ? appBase : (appBase + '#/login');
    appLogger.info('[PlaywrightMcp] Navigating to login page: ' + loginUrl);
    await this.navigate(loginUrl, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 3000));
    
    const idJson = JSON.stringify(opts.idNumber ?? '');
    const userJson = JSON.stringify(opts.username);
    const passJson = JSON.stringify(opts.password);

    const loginScript = 'async () => {' +
      'const wait = ms => new Promise(r => setTimeout(r, ms));' +
      'const fillAngular = (el, val) => {' +
        'if (!el) return;' +
        'el.focus(); el.value = val;' +
        'el.dispatchEvent(new Event("input", { bubbles: true }));' +
        'el.dispatchEvent(new Event("change", { bubbles: true }));' +
        'el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));' +
      '};' +
      'await wait(1000);' +
      'const idEl = document.querySelector(\'input[name="idnumber"], input#idnumber, input#userName\');' +
      'if (idEl) fillAngular(idEl, ' + idJson + ');' +
      'await wait(500);' +
      'const userEl = document.querySelector(\'input[name="username"], input#userName\');' +
      'if (userEl) fillAngular(userEl, ' + userJson + ');' +
      'await wait(500);' +
      'const passEl = document.querySelector(\'input[name="password"], input#password, input[type="password"]\');' +
      'if (passEl) {' +
        'passEl.removeAttribute("readonly");' +
        'passEl.click();' +
        'await wait(100);' +
        'fillAngular(passEl, ' + passJson + ');' +
      '}' +
      'await wait(800);' +
      'const btn = Array.from(document.querySelectorAll(\'button, input[type="submit"]\'))' +
        '.find(b => /log.?in|sign.?in|submit/i.test((b.textContent || b.value || "")));' +
      'if (btn) btn.click();' +
      'await wait(8000);' + // Increased wait for slow redirect
      'return window.location.href;' +
      '}';
    const finalUrl = await this.evaluate(loginScript);
    // Verify we actually left the login page; treat staying there as a hard failure
    if (typeof finalUrl === 'string' && finalUrl.toLowerCase().includes('login')) {
      throw new Error(`[PlaywrightMcp] Login failed — still on login page after submit: ${finalUrl}`);
    }
    appLogger.info('[PlaywrightMcp] Login succeeded, current URL: ' + (finalUrl ?? 'unknown'));
  }

  public async evaluate(fn: string): Promise<any> {
    const raw = await this.call('browser_evaluate', { function: fn, expression: fn });
    let text = this.extractText(raw);
    
    if (!text) return null;

    try {
      // P0: Detect double-stringification
      if (text.startsWith('"') && text.endsWith('"') && text.length > 1) {
         try {
           const inner = JSON.parse(text);
           if (typeof inner === 'string') text = inner;
           else return inner;
         } catch (e) {}
      }

      // Detect JSON Array/Object
      if (text.startsWith('[') || text.startsWith('{')) {
        return JSON.parse(text);
      }
      
      // Scalar types
      if (text === 'true') return true;
      if (text === 'false') return false;
      if (text === 'null') return null;
      if (!isNaN(Number(text)) && text.trim() !== '') return Number(text);
    } catch (e) {
      appLogger.debug(`[PlaywrightMcp] JSON Parse failed for evaluate result, returning raw text: ${text.substring(0, 100)}`);
    }
    
    return text;
  }

  /**
   * P2: Soft-Reset Logic.
   */
  public async softReset(baseUrl: string): Promise<void> {
    appLogger.info('[PlaywrightMcp] Performing soft-reset to: ' + baseUrl);
    await this.navigate(baseUrl, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2000));
  }

  public async addInitScript(script: string | { content: string }): Promise<void> {
    const content = typeof script === 'string' ? script : script.content;
    await this.evaluate(content);
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await Promise.race([
        this.call('browser_close', {}),
        new Promise(r => setTimeout(r, 3000)),
      ]);
    } catch { }
    this.proc.kill();
  }

  private isRef(selector: string): boolean {
    return /^s\d+$/.test(selector);
  }

  /**
   * Resolve an element name to an MCP ref by taking a fresh snapshot.
   */
  public async resolveNameToRef(targetName: string): Promise<string | null> {
    try {
      const snapshot = await this.snapshot();
      const snapshotText = snapshot.text;
      
      // Enhanced debug logging - show more of the actual format
      const preview = snapshotText.substring(0, 800).replace(/\n/g, '|');
      appLogger.info(`[PlaywrightMcp] Snapshot preview for "${targetName}": ${preview}...`);
      
      // Also log a few sample lines for format analysis
      const sampleLines = snapshotText.split('\n').slice(0, 10).join('\n');
      appLogger.debug(`[PlaywrightMcp] Snapshot sample lines:\n${sampleLines}`);

// More flexible patterns - MCP may output various formats
      const patterns = [
        // Format: "button "Name" [ref=s123]
        new RegExp(`"?${this.escapeRegex(targetName)}"?\\s*\\[ref=(s\\d+)\\]`, 'i'),
        // Format: button "Name" [ref=s123]
        new RegExp(`button\\s+"?${this.escapeRegex(targetName)}"?\\s*\\[ref=(s\\d+)\\]`, 'i'),
        // Format: link "Name" [ref=s123]
        new RegExp(`link\\s+"?${this.escapeRegex(targetName)}"?\\s*\\[ref=(s\\d+)\\]`, 'i'),
        // Format: textbox "Name" [ref=s123]
        new RegExp(`textbox\\s+"?${this.escapeRegex(targetName)}"?\\s*\\[ref=(s\\d+)\\]`, 'i'),
        // Format: combobox "Name" [ref=s123]
        new RegExp(`combobox\\s+"?${this.escapeRegex(targetName)}"?\\s*\\[ref=(s\\d+)\\]`, 'i'),
        // Format: [s123] button "Name" (reversed order)
        new RegExp(`\\[ref=(s\\d+)\\]\\s+button\\s+"?${this.escapeRegex(targetName)}"?`, 'i'),
        // Format: [s123] "Name" (just ref + name, no type)
        new RegExp(`\\[ref=(s\\d+)\\]\\s+"?${this.escapeRegex(targetName)}"?`, 'i'),
        // Format: s123 = Name (alternative notation)
        new RegExp(`(s\\d+)\\s*=\\s*"?${this.escapeRegex(targetName)}"?`, 'i'),
      ];

      for (const pattern of patterns) {
        const match = snapshotText.match(pattern);
        if (match) {
          appLogger.info(`[PlaywrightMcp] Resolved "${targetName}" to ref=${match[1]}`);
          return match[1];
        }
      }

      // Fuzzy match fallback
      const lines = snapshotText.split('\n');
      for (const line of lines) {
        if (line.toLowerCase().includes(targetName.toLowerCase())) {
          const refMatch = line.match(/\[ref=(s\d+)\]/);
          if (refMatch) {
            appLogger.info(`[PlaywrightMcp] Resolved "${targetName}" to ref=${refMatch[1]} (fuzzy)`);
            return refMatch[1];
          }
        }
      }

      // Last resort: Try to find via browser_evaluate with MCP's element finding
      try {
        const searchScript = `async () => {
          const allElements = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"]');
          for (const el of allElements) {
            const text = (el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
            const name = '${targetName.toLowerCase()}';
            if (text.includes(name)) {
              return 'text=' + name;
            }
          }
          return null;
        }`;
        const result = await this.evaluate(searchScript);
        if (result) {
          appLogger.info(`[PlaywrightMcp] Resolved "${targetName}" via evaluate: ${result}`);
        }
      } catch (e) {
        // Ignore - just a last attempt
      }

      appLogger.warn(`[PlaywrightMcp] Could not resolve "${targetName}" to ref.`);
      return null;
    } catch (err) {
      appLogger.warn(`[PlaywrightMcp] Failed to resolve name to ref: ${(err as Error).message}`);
      return null;
    }
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async evaluateAction(selector: string, action: 'click' | 'fill' | 'select', value?: string): Promise<string> {
    const selJson = JSON.stringify(selector);
    const valJson = JSON.stringify(value || '');
    const script = 'async () => {' +
      'const wait = ms => new Promise(r => setTimeout(r, ms));' +
      'let el = null;' +
      'try { el = document.querySelector(' + selJson + '); } catch (e) { }' +
      'const isAria = ' + selJson + '.includes("has-text") || ' + selJson + '.includes("getByRole");' +
      'if (!el && (!' + selJson + '.includes("[") && !' + selJson + '.includes(".") || isAria)) {' +
        'let searchText = ' + selJson + '.toLowerCase().replace(/\\b(button|field|dropdown trigger|option|input)\\b/g, "")' +
          '.replace(/^.*has-text\\("/, "").replace(/"\\)\\s*$/, "").trim();' +
        'if (searchText) {' +
          'const elements = Array.from(document.querySelectorAll("button, a, .k-button, .k-link, input, textarea, select, label, .k-list-item, li, span.k-item, .p-button, .p-select, .p-list-item, .p-dropdown-item"));' +
          'el = elements.find(b => {' +
            'const t = (b.textContent || "").trim().toLowerCase();' +
            'const p = (b.getAttribute("placeholder") || "").toLowerCase();' +
            'const a = (b.getAttribute("aria-label") || "").toLowerCase();' +
            'const title = (b.getAttribute("title") || "").toLowerCase();' +
            'const id = (b.getAttribute("id") || "").toLowerCase();' +
            'const pc = (b.getAttribute("data-pc-name") || "").toLowerCase();' +
            'return t.includes(searchText) || p.includes(searchText) || a.includes(searchText) || title.includes(searchText) || id.includes(searchText) || pc.includes(searchText);' +
          '});' +
        '}' +
      '}' +
      'if (!el) return "not found: " + ' + selJson + ';' +
      'el.scrollIntoView({ block: "center" });' +
      'await wait(100);' +
      'if ("' + action + '" === "click") {' +
        'el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));' +
        'if (typeof el.click === "function") el.click();' +
        'return "clicked";' +
      '}' +
      'if ("' + action + '" === "fill") {' +
        'el.focus(); el.value = ' + valJson + ';' +
        'el.dispatchEvent(new Event("input", { bubbles: true }));' +
        'el.dispatchEvent(new Event("change", { bubbles: true }));' +
        'el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));' +
        'return "filled";' +
      '}' +
      'if ("' + action + '" === "select") {' +
        'el.value = ' + valJson + '; el.dispatchEvent(new Event("change", { bubbles: true }));' +
        'return "selected";' +
      '}' +
      'return "done";' +
      '}';

    const result = await this.evaluate(script);
    const resultStr = String(result);
    if (resultStr.includes('not found:')) throw new Error('Element not found: ' + selector);
    return resultStr.length > 50 ? resultStr.substring(0, 50) + '...' : resultStr;
  }

  /**
   * Performs a raw JSON-RPC call without the tools/call wrapper.
   */
  private rawCall(method: string, params: Record<string, unknown>, timeoutMs = 60000): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('[PlaywrightMcp] Client is closed'));
      const id = this.nextId++;
      
      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`[PlaywrightMcp] Call "${method}" timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pending.set(id, { 
        resolve: (v) => { clearTimeout(timeout); resolve(v); }, 
        reject: (e) => { clearTimeout(timeout); reject(e); } 
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private call(method: string, params: Record<string, unknown>, timeoutMs = 60000): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('[PlaywrightMcp] Client is closed'));
      const id = this.nextId++;

      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`[PlaywrightMcp] Tool call "${method}" timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pending.set(id, { 
        resolve: (v) => { clearTimeout(timeout); resolve(v); }, 
        reject: (e) => { clearTimeout(timeout); reject(e); } 
      });
      this.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: method, arguments: params } });
    });
  }

  private send(payload: any): void {
    if (this.closed) return;
    this.proc.stdin?.write(JSON.stringify(payload) + '\n');
  }

  private attachListeners(): void {
    this.proc.stdout?.on('data', (chunk) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const res: JsonRpcResponse = JSON.parse(line);
          const p = this.pending.get(res.id);
          if (p) {
            this.pending.delete(res.id);
            if (res.error) p.reject(new Error(res.error.message)); else p.resolve(res);
          }
        } catch (e) { }
      }
    });
    this.proc.stderr?.on('data', (chunk) => appLogger.debug('[PlaywrightMcp:stderr] ' + chunk.toString().trim()));
    this.proc.on('exit', (code) => { 
      this.closed = true; 
      appLogger.info('[PlaywrightMcp] Process exited (code=' + code + ')');
      
      // Reject all pending promises
      for (const [id, p] of this.pending.entries()) {
        p.reject(new Error(`[PlaywrightMcp] Client closed (exit code ${code}) while call id ${id} was pending`));
      }
      this.pending.clear();
    });
  }

  private extractText(raw: JsonRpcResponse): string {
    const content = raw?.result?.content || [];
    const textBlock = content.find((c: any) => c.type === 'text');
    let text = textBlock?.text ?? '';

    // NATIVE-LEVEL PARSING: Strip all markdown metadata added by @playwright/mcp
    const resultMatch = text.match(/### Result\s*\n([\s\S]*?)(?=\n###|$)/i);
    if (resultMatch) {
      text = resultMatch[1].trim();
    } else {
      text = text.replace(/^### Result\s*/i, '')
                 .replace(/^### Error\s*/i, '')
                 .split('### Ran Playwright code')[0]
                 .split('### Page')[0];
    }

    text = text.trim();

    // ── Error detection ──────────────────────────────────────────────────────
    // @playwright/mcp sometimes returns isError=false but embeds the 
    // error inside the message text.
    const lowerText = text.toLowerCase();
    if (lowerText.includes('is not installed') || 
        lowerText.includes('browser not found') ||
        lowerText.includes('chromium distribution') ||
        lowerText.includes('npx playwright install')) {
      throw new Error(text);
    }
    // Generic embedded "(Error: ...)" or "Error: ..." inside an otherwise-successful message
    const embeddedError = text.match(/\(Error:\s*[^)]+\)/i) || text.match(/^Error:\s*.+$/im);
    if (embeddedError) {
      throw new Error(embeddedError[0].replace(/^[()]+|[()]+$/g, '').trim());
    }

    return text;
  }
}
