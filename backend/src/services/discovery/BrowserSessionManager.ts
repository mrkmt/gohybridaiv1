/**
 * BrowserSessionManager
 *
 * Persists the authenticated Playwright browser state (cookies + localStorage)
 * to disk so that subsequent discovery runs can skip the login step entirely
 * when the session is still valid.
 *
 * Flow:
 *   1. `tryRestoreContext(browser)` — on discovery start, attempt to load a
 *      previously saved session. Returns a ready BrowserContext if the saved
 *      state exists and is within TTL. Returns null otherwise.
 *
 *   2. `saveContext(context)` — called immediately after a successful fresh
 *      login. Persists cookies + localStorage via Playwright's storageState API.
 *
 *   3. `clearSession()` — called when login fails or session is detected as
 *      expired mid-run so the next run does a clean fresh login.
 *
 * TTL: 8 hours (configurable via DISCOVERY_SESSION_TTL_HOURS env var).
 * This is deliberately shorter than the discovery cache TTL (24 h) so a
 * session is always valid for at least one fresh discovery run within the
 * cache window.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Browser, BrowserContext } from '@playwright/test';
import { appLogger } from '../../utils/logger';

const SESSION_DIR = path.join(
  process.env.LOCAL_STORAGE_PATH
    ? path.resolve(process.env.LOCAL_STORAGE_PATH)
    : path.join(process.cwd(), 'local_storage'),
  'discovery',
);

const SESSION_FILE = path.join(SESSION_DIR, 'browser-session.json');

const SESSION_TTL_MS =
  Number(process.env.DISCOVERY_SESSION_TTL_HOURS || 8) * 60 * 60 * 1000;

export class BrowserSessionManager {
  /**
   * Try to create a browser context from a previously saved authenticated
   * session. Returns null if the session file is missing, expired, or corrupt
   * — caller should fall back to a fresh login.
   */
  static async tryRestoreContext(browser: Browser): Promise<BrowserContext | null> {
    try {
      // Single statSync call inside try/catch — eliminates the TOCTOU race
      // between a separate existsSync + statSync pair on concurrent requests.
      let stats: fs.Stats;
      try {
        stats = fs.statSync(SESSION_FILE);
      } catch {
        appLogger.info('[BrowserSession] No saved session found — will login fresh');
        return null;
      }

      const ageMs = Date.now() - stats.mtimeMs;
      if (ageMs > SESSION_TTL_MS) {
        const ageHrs = (ageMs / 3_600_000).toFixed(1);
        appLogger.info(`[BrowserSession] Saved session expired (${ageHrs}h old) — will login fresh`);
        this.clearSession();
        return null;
      }

      const context = await browser.newContext({
        storageState: SESSION_FILE,
        viewport: { width: 1440, height: 900 },
      });

      const ageMin = Math.round(ageMs / 60_000);
      appLogger.info(`[BrowserSession] Restored authenticated session (${ageMin}m old) — login skipped`);
      return context;
    } catch (err: any) {
      appLogger.warn(`[BrowserSession] Could not restore session: ${err.message} — falling back to fresh login`);
      this.clearSession();
      return null;
    }
  }

  /**
   * Persist the current browser context's authenticated state to disk.
   * Should be called immediately after a successful login.
   */
  static async saveContext(context: BrowserContext): Promise<void> {
    try {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
      await context.storageState({ path: SESSION_FILE });
      appLogger.info('[BrowserSession] Authenticated session saved to disk');
    } catch (err: any) {
      // Non-fatal — next discovery run will just login again
      appLogger.warn(`[BrowserSession] Could not save session state: ${err.message}`);
    }
  }

  /**
   * Delete the saved session file.
   * Call this when login fails or when the app redirects back to /login
   * mid-discovery (session expired server-side).
   */
  static clearSession(): void {
    try {
      if (fs.existsSync(SESSION_FILE)) {
        fs.unlinkSync(SESSION_FILE);
        appLogger.info('[BrowserSession] Saved session cleared');
      }
    } catch {
      // Ignore — file already gone
    }
  }

  /** Returns true if a session file exists and is within TTL. */
  static hasValidSession(): boolean {
    try {
      const stats = fs.statSync(SESSION_FILE);
      return Date.now() - stats.mtimeMs <= SESSION_TTL_MS;
    } catch {
      return false;
    }
  }
}
