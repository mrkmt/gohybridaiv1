import { DiscoveryCacheService } from './DiscoveryCacheService';
import { AiModuleResolverService } from './ai/AiModuleResolverService';
import { findRouteByModule, deriveRoute } from './ModuleRouteRegistry';
import { appLogger } from '../../utils/logger';

/**
 * Sample selector surfaced to the UI so the user sees real verified selectors
 * rather than hardcoded placeholders.
 */
export interface SampleSelector {
  name: string;
  selector: string;
  type?: string;
}

/**
 * Thin service that wraps DiscoveryCacheService and, on cache miss, drives a
 * live Playwright discovery via `scripts/discover-page`. The live call is
 * heavyweight (~15-30s, launches a headless browser) so callers should treat
 * it as long-running.
 */
export class TestingDiscoveryService {
  /**
   * Module names currently being refreshed in the background.
   * Static so deduplication works across multiple controller instances
   * (one per request) — without this, concurrent /start requests would
   * each spawn their own browser probe for the same module.
   */
  private static readonly inProgress = new Set<string>();

  /**
   * Check if discovery cache is fresh for a module.
   * Returns real sample selectors pulled from the cached inventory when fresh.
   */
  async checkCache(moduleName: string): Promise<{
    fresh: boolean;
    discoveredAt?: string;
    age?: string;
    version?: number;
    elementCount?: number;
    sampleSelectors?: SampleSelector[];
  }> {
    const status = DiscoveryCacheService.getStatus(moduleName);
    if (!status.fresh) return { fresh: false };

    return {
      ...status,
      sampleSelectors: this.buildSampleSelectors(moduleName, 6),
    };
  }

  /**
   * Fire a LIVE discovery in the background without blocking the caller.
   *
   * Designed for auto-triggering from POST /start when the cache is stale:
   * the controller fires this and immediately returns the /start response.
   * The browser probe runs asynchronously and populates the cache so that
   * the subsequent /scenarios and /test-cases calls benefit from fresh selectors.
   *
   * Deduplication: if a background refresh is already running for the same
   * module (e.g. two users open the same ticket simultaneously) the second
   * call is silently dropped — only one browser probe runs at a time per module.
   */
  runLiveBackground(moduleName: string): void {
    const canonical = DiscoveryCacheService.normalizeModuleName(moduleName);
    // Skip discovery for sentinel values that indicate a bad/unresolvable module name.
    if (!canonical || canonical === 'General' || canonical === 'unknown') return;

    if (TestingDiscoveryService.inProgress.has(canonical)) {
      appLogger.info(`[Discovery] Background refresh already running for "${canonical}" — skipping duplicate`);
      return;
    }

    TestingDiscoveryService.inProgress.add(canonical);
    appLogger.info(`[Discovery] Auto-triggered background discovery for "${canonical}"`);

    // Call _runLiveInternal directly — runLiveBackground already owns the inProgress
    // lock, so calling runLive() here would trigger runLive()'s deadlock guard
    // (inProgress.has returns true) and enter a 60-second wait instead of running.
    this._runLiveInternal(canonical)
      .then(() => appLogger.info(`[Discovery] Background discovery complete for "${canonical}"`))
      .catch(err => appLogger.warn(`[Discovery] Background discovery failed for "${canonical}": ${err.message}`))
      .finally(() => TestingDiscoveryService.inProgress.delete(canonical));
  }

  /**
   * Build a small selection of the most useful selectors from the cached
   * inventory: up to N buttons + inputs, preferring items with a clear name.
   * Returns an empty array if no cache exists.
   */
  private buildSampleSelectors(moduleName: string, limit: number): SampleSelector[] {
    const cache = DiscoveryCacheService.get(moduleName);
    if (!cache) return [];

    const samples: SampleSelector[] = [];
    const pushUnique = (item: SampleSelector) => {
      if (samples.length >= limit) return;
      if (samples.some(s => s.selector === item.selector)) return;
      if (!item.name || !item.selector) return;
      samples.push(item);
    };

    // Prefer high-signal buttons first (Add, Save, Search, etc.).
    const priorityOrder = ['add', 'save', 'search', 'edit', 'delete', 'submit'];
    const sortedButtons = [...cache.inventory.buttons].sort((a, b) => {
      const score = (btn: { name: string }) => {
        const idx = priorityOrder.findIndex(k => btn.name.toLowerCase().includes(k));
        return idx === -1 ? 999 : idx;
      };
      return score(a) - score(b);
    });

    for (const btn of sortedButtons) {
      pushUnique({ name: btn.name, selector: btn.selector, type: 'button' });
    }
    for (const inp of cache.inventory.inputs) {
      pushUnique({ name: inp.name, selector: inp.selector, type: 'input' });
    }
    for (const dd of cache.inventory.dropdowns) {
      pushUnique({ name: dd.name, selector: dd.selector, type: 'dropdown' });
    }
    return samples;
  }

  /**
   * Run a LIVE discovery against the target app — logs in, navigates, probes
   * the DOM, and persists the inventory into the cache. Returns the same
   * shape as checkCache() so callers can treat it uniformly.
   *
   * This is heavyweight. Callers should:
   *   - Only invoke on cache miss
   *   - Expect 15-45s latency (Playwright boot + login + probe)
   *   - Handle failures (e.g. test-site down, bad credentials) with a UI error
   */
  async runLive(moduleName: string): Promise<{
    fresh: boolean;
    age: string;
    elementCount: number;
    sampleSelectors: SampleSelector[];
    /** true when background discovery was still running when we stopped waiting */
    pending?: boolean;
  }> {
    const canonical = DiscoveryCacheService.normalizeModuleName(moduleName);

    // Deduplication: if a foreground or background discovery is already running
    // for this module, wait for it to finish and return the cached result rather
    // than launching a second Playwright browser session.
    if (TestingDiscoveryService.inProgress.has(canonical)) {
      appLogger.info(`[Discovery] Discovery already in progress for "${canonical}" — waiting for result`);
      let timedOut = false;
      await new Promise<void>(resolve => {
        const interval = setInterval(() => {
          if (!TestingDiscoveryService.inProgress.has(canonical)) {
            clearInterval(interval);
            resolve();
          }
        }, 1000);
        // .unref() prevents this interval from keeping the Node.js event loop alive
        // in test environments (fixes Jest hanging after test suite completes).
        (interval as any).unref?.();
        setTimeout(() => { clearInterval(interval); timedOut = true; resolve(); }, 120_000); // max wait 2 min
      });

      // If background is STILL running after the wait, return pending — do not
      // report elementCount: 0 which would incorrectly trigger DISCOVERY_FAIL.
      if (timedOut && TestingDiscoveryService.inProgress.has(canonical)) {
        appLogger.warn(`[Discovery] Still waiting for background discovery of "${canonical}" — returning pending`);
        return { fresh: false, age: 'pending', elementCount: 0, sampleSelectors: [], pending: true };
      }

      const status = DiscoveryCacheService.getStatus(canonical);
      return {
        fresh: true,
        age: status.age || '0m',
        elementCount: status.elementCount || 0,
        sampleSelectors: this.buildSampleSelectors(canonical, 6),
      };
    }

    TestingDiscoveryService.inProgress.add(canonical);

    try {
      return await this._runLiveInternal(canonical);
    } finally {
      TestingDiscoveryService.inProgress.delete(canonical);
    }
  }

  private async _runLiveInternal(canonical: string): Promise<{
    fresh: boolean;
    age: string;
    elementCount: number;
    sampleSelectors: SampleSelector[];
  }> {
    const { discoverSinglePage } = await import('../../../scripts/discover-page');

    // ── Route resolution (Phase 1 AI integration) ────────────────────────────
    // 1. Check ModuleRouteRegistry (fast, O(n) scan).
    // 2. If miss, ask AI to re-interpret the module name against known modules.
    //    This handles cases where ticket module was set incorrectly (e.g. "Testing"
    //    when the real module is "Leave Balance Report").
    // 3. Last resort: derive route from name string — warns clearly.
    let resolvedCanonical = canonical;
    let hashRoute = findRouteByModule(canonical);

    if (!hashRoute) {
      appLogger.warn(`[Discovery] No MODULE_ROUTES entry for "${canonical}" — attempting AI re-resolution`);
      const aiCanonical = await AiModuleResolverService.resolve(canonical);
      if (aiCanonical && aiCanonical !== canonical) {
        const aiRoute = findRouteByModule(aiCanonical);
        if (aiRoute) {
          appLogger.info(`[Discovery] AI re-resolved "${canonical}" → "${aiCanonical}" (${aiRoute})`);
          resolvedCanonical = aiCanonical;
          hashRoute = aiRoute;
        }
      }
    }

    if (!hashRoute) {
      hashRoute = deriveRoute(resolvedCanonical);
      appLogger.warn(
        `[Discovery] Could not resolve route for "${resolvedCanonical}" — using derived route "${hashRoute}". ` +
        `Add the correct entry to ModuleRouteRegistry.ts for reliable mapping.`,
      );
    }

    appLogger.info(`[Discovery] Running LIVE discovery: module="${resolvedCanonical}" route="${hashRoute}"`);
    const inventory = await discoverSinglePage(hashRoute, resolvedCanonical, {
      deepScan: true,   // V2: click Add/Edit buttons to discover modal fields
      headless: true,
    });
    if (!inventory) {
      throw Object.assign(
        new Error(`Discovery returned empty inventory for ${resolvedCanonical}`),
        { statusCode: 502 }
      );
    }

    // Persist under the RESOLVED canonical name so future lookups hit the cache.
    // Also persist under the original canonical if different (alias support).
    DiscoveryCacheService.save(inventory, hashRoute, undefined, resolvedCanonical);
    if (resolvedCanonical !== canonical) {
      DiscoveryCacheService.save(inventory, hashRoute, undefined, canonical);
    }

    const status = DiscoveryCacheService.getStatus(resolvedCanonical);
    return {
      fresh: true,
      age: status.age || '0m',
      elementCount: status.elementCount || 0,
      sampleSelectors: this.buildSampleSelectors(resolvedCanonical, 6),
    };
  }
}
