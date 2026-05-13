/**
 * McpDiscoveryService
 *
 * Replaces the stale-cache Playwright discovery with a LIVE accessibility
 * snapshot captured via PlaywrightMcpClient on each new ticket session.
 *
 * Flow:
 *   1. Spawn PlaywrightMcpClient (headless Chromium)
 *   2. Login to the app (credentials from test_users table or env)
 *   3. Navigate to the module route (from module_route_map or ModuleRegistry)
 *   4. Capture browser_snapshot (structured accessibility tree as markdown)
 *   5. Return the snapshot text + a SHA-256 hash (for UI-drift detection)
 *
 * The snapshot text is injected directly into the AI prompt context instead of
 * the pre-baked DiscoveryCacheService prompts, giving Vertex AI the REAL current
 * UI state rather than a potentially days-old cache.
 */

import * as crypto from 'crypto';
import { PlaywrightMcpClient, McpClientOptions } from './PlaywrightMcpClient';
import { appLogger } from '../../utils/logger';
import { ModuleRegistry } from '../shared/ModuleRegistry';
import { ModuleElementSchemaService } from '../discovery/ModuleElementSchemaService';
import { ModuleStateGraphService } from '../graph/ModuleStateGraph';

// ─── Live-site fallback credentials (from .env) ───────────────────────────────
const LIVE_FALLBACK = {
  baseUrl:  process.env.LIVE_BASE_URL   ?? 'https://www.globalhr.app/userguide',
  idNumber: process.env.LIVE_TEST_IDNUMBER ?? 'GHR-00001',
  username: process.env.LIVE_TEST_USERNAME  ?? 'Peterson',
  password: process.env.LIVE_TEST_PASSWORD  ?? 'Global@2026',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveDiscoveryCredentials {
  username: string;
  password: string;
  idNumber?: string;
}

export interface LiveDiscoveryOptions {
  /** Module name (e.g. "Performance Journal") */
  module: string;
  /** Base URL of the app (e.g. "https://test.globalhr.com.mm/ook") */
  baseUrl: string;
  /** Login credentials */
  credentials: LiveDiscoveryCredentials;
  /**
   * Optional URL suffix to navigate to after login.
   * If omitted, McpDiscoveryService will look up the module_route_map.
   */
  moduleUrl?: string;
  /** Run browser headed (for debugging). Default: headless */
  headed?: boolean;
}

export interface LiveDiscoveryResult {
  /** Raw accessibility snapshot text from Playwright MCP */
  snapshot: string;
  /** SHA-256 of the snapshot (used for UI-drift detection in TestScriptStore) */
  selectorHash: string;
  /** Module name, normalised */
  module: string;
  /** URL that was visited */
  visitedUrl: string;
  /** ISO timestamp */
  capturedAt: string;
  /**
   * Condensed prompt-ready context block.
   * Mirrors the DiscoveryCacheService.getPromptContext() format so it can be
   * injected into the same AI prompt without changing the AI prompt templates.
   */
  promptContext: string;
}

// ─── Login selectors (app-specific defaults, overridable via env) ─────────────

const LOGIN_SELECTORS = {
  username: process.env.LOGIN_USERNAME_SELECTOR ?? 'input[name="loginId"]',
  password: process.env.LOGIN_PASSWORD_SELECTOR ?? 'input[name="password"]',
  idNumber: process.env.LOGIN_ID_SELECTOR       ?? 'input[name="idNumber"]',
  submit:   process.env.LOGIN_SUBMIT_SELECTOR   ?? 'button[type="submit"]',
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class McpDiscoveryService {
  /**
   * Perform a live discovery for a module and return the snapshot + hash.
   *
   * The caller is responsible for nothing — this method handles the full
   * browser lifecycle (open → login → navigate → snapshot → close).
   */
  static async discover(
    opts: LiveDiscoveryOptions,
    pool?: any,
  ): Promise<LiveDiscoveryResult> {
    const startMs = Date.now();
    appLogger.info(`[McpDiscovery] Starting live discovery for module "${opts.module}"`);

    const mcpOpts: McpClientOptions = { headless: !opts.headed };
    let client: PlaywrightMcpClient | null = null;

    try {
      client = await PlaywrightMcpClient.create(mcpOpts);

      // ── Step 1: Login (with live-site fallback) ────────────────────────────
      const loginSucceeded = await this.attemptLogin(client, opts);

      if (!loginSucceeded) {
        throw new Error('[McpDiscovery] Login failed on both primary and live-fallback sites');
      }

      // Wait for post-login navigation
      await this.delay(2000);

      // ── Step 2: Navigate to module ─────────────────────────────────────────
      const moduleUrl = opts.moduleUrl ?? await this.resolveModuleUrl(opts.module, opts.baseUrl);
      appLogger.info(`[McpDiscovery] Navigating to module URL: ${moduleUrl}`);
      await client.navigate(moduleUrl);
      await this.delay(1500);

      // ── Step 3: Capture snapshot ───────────────────────────────────────────
      const snapResult = await client.snapshot();
      const snapshotText = snapResult.text;

      if (!snapshotText || snapshotText.length < 50) {
        throw new Error(`[McpDiscovery] Snapshot is empty or too short (${snapshotText.length} chars). Navigation may have failed.`);
      }

      const selectorHash = crypto.createHash('sha256').update(snapshotText).digest('hex').slice(0, 16);
      const elapsed = Date.now() - startMs;

      appLogger.info(
        `[McpDiscovery] Snapshot captured for "${opts.module}" — ` +
        `${snapshotText.length} chars, hash=${selectorHash}, ${elapsed}ms`,
      );

      const result: LiveDiscoveryResult = {
        snapshot:      snapshotText,
        selectorHash,
        module:        opts.module,
        visitedUrl:    moduleUrl,
        capturedAt:    new Date().toISOString(),
        promptContext: this.buildPromptContext(opts.module, snapshotText),
      };

      // ── Phase 2+3: persist element schema + state graph (fire-and-forget) ─────
      if (pool) {
        const moduleId = ModuleElementSchemaService.moduleIdFromTicket(opts.module) || opts.module.toUpperCase().slice(0, 10);
        new ModuleElementSchemaService(pool)
          .buildAndSave({ moduleId, snapshotText, snapshotHash: selectorHash, visitedUrl: moduleUrl })
          .then(async (schema) => {
            // Phase 3: build + persist state graph from schema
            try {
              const graph = ModuleStateGraphService.buildFromSchema(schema);
              await ModuleStateGraphService.save(pool, graph);
            } catch (graphErr: any) {
              appLogger.warn(`[McpDiscovery] State graph build failed: ${graphErr.message}`);
            }
          })
          .catch((err: any) => appLogger.warn(`[McpDiscovery] Schema save failed: ${err.message}`));
      }

      return result;

    } finally {
      if (client) {
        await client.close().catch(() => {});
      }
    }
  }

  // ─── Login helper (primary → live-site fallback) ──────────────────────────

  /**
   * Attempt login on the primary site. If the login page cannot be reached or
   * the expected fields are not visible (site is down), automatically retry
   * using the live-fallback credentials from LIVE_* env vars.
   *
   * Returns true if login succeeded on either site, false if both failed.
   * When falling back, the `opts.baseUrl` is replaced in the running context
   * so subsequent navigation uses the live URL.
   */
  private static async attemptLogin(
    client: PlaywrightMcpClient,
    opts: LiveDiscoveryOptions,
  ): Promise<boolean> {
    const primaryUrl = `${opts.baseUrl.replace(/\/$/, '')}/login`;
    appLogger.info(`[McpDiscovery] Logging in at ${primaryUrl}`);

    try {
      await client.navigate(primaryUrl);
      await this.delay(2000);

      // Verify the login form fields are present in the snapshot
      const snap = await client.snapshot();
      const snapText = snap?.text ?? '';
      const hasLoginForm =
        snapText.includes('idNumber') ||
        snapText.includes('loginId') ||
        snapText.includes('password') ||
        snapText.includes('ID Number') ||
        snapText.includes('Username') ||
        snapText.includes('Password');

      if (!hasLoginForm) {
        throw new Error('Login form fields not found on primary site');
      }

      await client.login({
        url: primaryUrl,
        usernameSelector: LOGIN_SELECTORS.username,
        passwordSelector: LOGIN_SELECTORS.password,
        submitSelector:   LOGIN_SELECTORS.submit,
        username:         opts.credentials.username,
        password:         opts.credentials.password,
        idNumber:         opts.credentials.idNumber,
        idNumberSelector: opts.credentials.idNumber ? LOGIN_SELECTORS.idNumber : undefined,
      });

      appLogger.info('[McpDiscovery] Primary site login succeeded');
      return true;
    } catch (primaryErr: any) {
      appLogger.warn(
        `[McpDiscovery] Primary login failed (${primaryErr.message}) — ` +
        `retrying with live-fallback: ${LIVE_FALLBACK.baseUrl}`,
      );

      try {
        const fallbackLoginUrl = `${LIVE_FALLBACK.baseUrl.replace(/\/$/, '')}/#/login`;
        await client.navigate(fallbackLoginUrl);
        await this.delay(2000);

        await client.login({
          url:              fallbackLoginUrl,
          usernameSelector: LOGIN_SELECTORS.username,
          passwordSelector: LOGIN_SELECTORS.password,
          submitSelector:   LOGIN_SELECTORS.submit,
          username:         LIVE_FALLBACK.username,
          password:         LIVE_FALLBACK.password,
          idNumber:         LIVE_FALLBACK.idNumber,
          idNumberSelector: LOGIN_SELECTORS.idNumber,
        });

        // Override baseUrl on the options object so downstream navigation uses live URL
        (opts as any).baseUrl = LIVE_FALLBACK.baseUrl;
        appLogger.info('[McpDiscovery] Live-fallback login succeeded');
        return true;
      } catch (fallbackErr: any) {
        appLogger.error(`[McpDiscovery] Live-fallback login also failed: ${fallbackErr.message}`);
        return false;
      }
    }
  }

  // ─── Prompt context builder ────────────────────────────────────────────────

  /**
   * Converts the raw accessibility snapshot into a prompt-ready context block
   * that matches the shape of DiscoveryCacheService.getPromptContext() output.
   * This allows both live and cached discoveries to be injected identically.
   */
  static buildPromptContext(module: string, snapshot: string): string {
    const lines = [
      `## Live UI Snapshot — ${module}`,
      `> Captured ${new Date().toISOString()} via Playwright accessibility snapshot.`,
      `> This reflects the REAL current state of the UI — use this exclusively for selectors.`,
      '',
      '### Accessibility Snapshot (structured)',
      '```',
      snapshot.slice(0, 40000), // Increased to 40k chars for complex UIs
      snapshot.length > 40000 ? `\n... [truncated ${snapshot.length - 40000} chars]` : '',
      '```',
    ];
    return lines.join('\n');
  }

  // ─── Module URL resolution ─────────────────────────────────────────────────

  /**
   * Look up the route for a module from ModuleRegistry or module_route_map.
   * Falls back to base URL if no route is found.
   */
  private static async resolveModuleUrl(module: string, baseUrl: string): Promise<string> {
    try {
      // Look up confirmed module info which may contain a uiRoute
      const confirmed = ModuleRegistry.getAllConfirmed();
      const match = confirmed.find(
        (m) => m.moduleName?.toLowerCase() === module.toLowerCase(),
      );
      if (match?.uiRoute) {
        const route = match.uiRoute;
        return `${baseUrl.replace(/\/$/, '')}${route.startsWith('/') ? route : '/' + route}`;
      }
    } catch {
      // ModuleRegistry lookup failed — fall through to base URL
    }

    appLogger.warn(`[McpDiscovery] No route found for module "${module}" — using base URL`);
    return baseUrl;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private static delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
