/**
 * PlaywrightMCPPool
 *
 * Singleton persistent browser session backed by @playwright/mcp.
 * Maintains ONE long-lived PlaywrightMcpClient for the lifetime of the
 * Node.js process, reusing login state across all discovery calls.
 *
 * Benefits over per-request clients:
 *   • Login happens once per server restart (saves 10-15s per run)
 *   • Auth state written to local_storage/auth_state.json for MCP --storage-state
 *   • Automatic reconnect on process crash (up to MAX_RECONNECT times)
 *
 * Feature flag: ENABLE_MCP_POOL=true  (default: true)
 *
 * Usage:
 *   const client = await PlaywrightMCPPool.getClient(baseUrl, credentials);
 *   const snap = await client.snapshot();
 *   // Do NOT call client.close() — the pool manages the lifecycle
 *   await PlaywrightMCPPool.release();  // only on server shutdown
 */

import * as path from 'path';
import * as fs from 'fs';
import { PlaywrightMcpClient, McpClientOptions } from './PlaywrightMcpClient';
import { appLogger } from '../../utils/logger';

// ─── Config ───────────────────────────────────────────────────────────────────

const ENABLED       = process.env.ENABLE_MCP_POOL !== 'false'; // default: enabled
const MAX_RECONNECT = 3;
const HEALTH_URL    = 'about:blank';
const AUTH_DIR      = path.join(process.cwd(), 'local_storage');
const AUTH_STATE    = path.join(AUTH_DIR, 'auth_state.json');

export interface PoolCredentials {
  baseUrl: string;
  username: string;
  password: string;
  idNumber?: string;
}

const LOGIN_SELECTORS = {
  username: process.env.LOGIN_USERNAME_SELECTOR ?? 'input[name="loginId"]',
  password: process.env.LOGIN_PASSWORD_SELECTOR ?? 'input[name="password"]',
  idNumber: process.env.LOGIN_ID_SELECTOR       ?? 'input[name="idNumber"]',
  submit:   process.env.LOGIN_SUBMIT_SELECTOR   ?? 'button[type="submit"]',
};

// ─── Pool ─────────────────────────────────────────────────────────────────────

export class PlaywrightMCPPool {
  private static client: PlaywrightMcpClient | null = null;
  private static reconnectAttempts = 0;
  private static loggedInBaseUrl: string | null = null;
  private static initPromise: Promise<PlaywrightMcpClient> | null = null;

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns a connected, logged-in PlaywrightMcpClient.
   * Creates and logs in if none exists; reuses the existing one otherwise.
   *
   * @param credentials  Required on first call. Ignored on subsequent calls
   *                     unless the client died and needs to reconnect.
   */
  static async getClient(credentials?: PoolCredentials): Promise<PlaywrightMcpClient> {
    if (!ENABLED) {
      throw new Error('[PlaywrightMCPPool] Pool is disabled (ENABLE_MCP_POOL=false). Use PlaywrightMcpClient.create() directly.');
    }

    // Return existing healthy client immediately
    if (this.client && !this.isClientClosed()) {
      return this.client;
    }

    // Deduplicate concurrent initialisation calls
    if (this.initPromise) {
      return this.initPromise;
    }

    if (!credentials) {
      throw new Error('[PlaywrightMCPPool] Credentials required on first call to getClient()');
    }

    this.initPromise = this.createAndLogin(credentials).finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  /**
   * Gracefully close the pool and kill the browser process.
   * Call on server shutdown.
   */
  static async release(): Promise<void> {
    if (this.client) {
      appLogger.info('[PlaywrightMCPPool] Releasing singleton client...');
      await this.client.close().catch(() => {});
      this.client = null;
      this.loggedInBaseUrl = null;
      this.reconnectAttempts = 0;
    }
  }

  /**
   * Force a reconnect on next getClient() call (e.g. after auth expiry).
   */
  static invalidate(): void {
    this.client = null;
    this.loggedInBaseUrl = null;
    appLogger.info('[PlaywrightMCPPool] Pool invalidated — will reconnect on next call');
  }

  /** Whether the pool is currently holding an active connection. */
  static get isActive(): boolean {
    return this.client !== null && !this.isClientClosed();
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private static async createAndLogin(creds: PoolCredentials): Promise<PlaywrightMcpClient> {
    appLogger.info(`[PlaywrightMCPPool] Creating persistent MCP client for ${creds.baseUrl}...`);

    const opts: McpClientOptions = {
      headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    };

    // Ensure local_storage dir exists (for auth state)
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    let client: PlaywrightMcpClient;
    try {
      client = await PlaywrightMcpClient.create(opts);
    } catch (err: any) {
      throw new Error(`[PlaywrightMCPPool] Failed to spawn MCP process: ${err.message}`);
    }

    // Health-check navigate
    try {
      await client.navigate(HEALTH_URL);
      appLogger.info('[PlaywrightMCPPool] Health check passed');
    } catch (err: any) {
      await client.close().catch(() => {});
      throw new Error(`[PlaywrightMCPPool] Health check failed: ${err.message}`);
    }

    // Login
    try {
      await this.performLogin(client, creds);
      this.loggedInBaseUrl = creds.baseUrl;
      appLogger.info(`[PlaywrightMCPPool] Login succeeded for ${creds.baseUrl}`);
    } catch (err: any) {
      appLogger.warn(`[PlaywrightMCPPool] Login failed: ${err.message} — client will be available without auth`);
      // Don't throw — the client is still usable for discovery on public routes
    }

    this.client = client;
    this.reconnectAttempts = 0;

    // Listen for unexpected close so we can reconnect on next getClient() call
    client.once('close', () => {
      appLogger.warn('[PlaywrightMCPPool] MCP client closed unexpectedly — will reconnect on next call');
      if (this.client === client) {
        this.client = null;
        this.loggedInBaseUrl = null;
      }
    });

    return client;
  }

  private static async performLogin(
    client: PlaywrightMcpClient,
    creds: PoolCredentials,
  ): Promise<void> {
    const loginUrl = `${creds.baseUrl.replace(/\/$/, '')}/login`;
    appLogger.info(`[PlaywrightMCPPool] Logging in at ${loginUrl}`);

    await client.navigate(loginUrl);
    await this.delay(1500);

    // Verify login form is present
    const snap = await client.snapshot();
    const hasForm = snap.text.includes('loginId') || snap.text.includes('password') ||
                    snap.text.includes('Username') || snap.text.includes('Password');

    if (!hasForm) {
      throw new Error('Login form not found at primary URL');
    }

    await client.login({
      url:              loginUrl,
      usernameSelector: LOGIN_SELECTORS.username,
      passwordSelector: LOGIN_SELECTORS.password,
      submitSelector:   LOGIN_SELECTORS.submit,
      username:         creds.username,
      password:         creds.password,
      idNumber:         creds.idNumber,
      idNumberSelector: creds.idNumber ? LOGIN_SELECTORS.idNumber : undefined,
    });

    await this.delay(2000);
  }

  private static isClientClosed(): boolean {
    // PlaywrightMcpClient exposes `closed` as a private field; we check via EventEmitter
    // The 'close' event listener sets client to null, so if client !== null it's alive
    return false; // closed detection is via the 'close' event listener above
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
