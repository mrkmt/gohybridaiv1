/**
 * SkillRegistryService — Locator Knowledge Database
 *
 * A memory system that logs successful locators used for specific elements.
 * When a test passes, the service saves the (module, element, action) → locator mapping.
 * Next time the AI generates a test for that module, it fetches these high-confidence
 * locators and injects them into the AI's context prompt.
 *
 * Storage: JSON file in local_storage/ (same pattern as FlakinessTracker)
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocatorEntry {
  /** Business element name (e.g., "Save", "Add New", "ShortCode") */
  element: string;
  /** Action type (e.g., "click", "fill", "select") */
  action: string;
  /** The Playwright selector that worked */
  selector: string;
  /** Detected framework (kendo-ui, angular, bootstrap) */
  framework?: string;
  /** Interaction strategy (click, fill, select, grid-action, modal-action) */
  strategyKind?: string;
  /** Number of successful uses */
  successCount: number;
  /** Number of failed uses */
  failureCount: number;
  /** Confidence score: successCount / (successCount + failureCount) */
  confidence: number;
  /** First seen timestamp */
  firstSeen: string;
  /** Last successful use timestamp */
  lastSeen: string;
  /** Ticket IDs that used this locator successfully */
  usedByTickets: string[];
}

export interface ModuleLocatorStore {
  [moduleName: string]: LocatorEntry[];
}

export interface LocatorStats {
  totalEntries: number;
  highConfidence: number;     // confidence >= 0.8
  mediumConfidence: number;   // confidence 0.5-0.79
  lowConfidence: number;      // confidence < 0.5
  modules: string[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const STORE_PATH = path.join(
  process.env.LOCAL_STORAGE_PATH || path.join(__dirname, '../../../local_storage'),
  'locator-knowledge-base.json'
);

const MIN_SUCCESS_COUNT = 2;           // Minimum successful uses before recommending
const HIGH_CONFIDENCE_THRESHOLD = 0.8; // 80%+ success rate
const MAX_ENTRIES_PER_MODULE = 100;    // Cap to prevent unbounded growth
const MAX_TICKETS_PER_ENTRY = 10;      // Cap ticket references

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadStore(): ModuleLocatorStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
    }
  } catch (err: any) {
    console.warn(`[SkillRegistryService] Failed to load store: ${err.message}`);
  }
  return {};
}

function saveStore(store: ModuleLocatorStore): void {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err: any) {
    console.error(`[SkillRegistryService] Failed to save store: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Core Service
// ---------------------------------------------------------------------------

export class SkillRegistryService {

  /**
   * Record a successful locator use.
   * Call this after a test passes to log the locators that worked.
   *
   * @param moduleName  Module name (e.g., "Designation", "Department")
   * @param element     Business element name (e.g., "Save", "Add New")
   * @param action      Action type (e.g., "click", "fill", "select")
   * @param selector    The Playwright selector that worked
   * @param ticketId    Ticket ID for tracking
   * @param framework   Detected framework (optional)
   * @param strategyKind Interaction strategy (optional)
   */
  static recordSuccess(
    moduleName: string,
    element: string,
    action: string,
    selector: string,
    ticketId: string,
    framework?: string,
    strategyKind?: string,
  ): void {
    if (!selector || !element) return; // Skip empty entries

    const store = loadStore();
    const entries = store[moduleName] || [];

    // Look for existing entry
    const existing = entries.find(
      e => e.element.toLowerCase() === element.toLowerCase() &&
           e.action.toLowerCase() === action.toLowerCase() &&
           e.selector === selector
    );

    const now = new Date().toISOString();

    if (existing) {
      existing.successCount++;
      existing.lastSeen = now;
      if (!existing.usedByTickets.includes(ticketId)) {
        if (existing.usedByTickets.length >= MAX_TICKETS_PER_ENTRY) {
          existing.usedByTickets.shift(); // Remove oldest
        }
        existing.usedByTickets.push(ticketId);
      }
    } else {
      entries.push({
        element,
        action,
        selector,
        framework,
        strategyKind,
        successCount: 1,
        failureCount: 0,
        confidence: 1.0,
        firstSeen: now,
        lastSeen: now,
        usedByTickets: [ticketId],
      });
    }

    // Cap entries per module
    if (entries.length > MAX_ENTRIES_PER_MODULE) {
      // Remove lowest confidence entries first
      entries.sort((a, b) => a.confidence - b.confidence);
      store[moduleName] = entries.slice(entries.length - MAX_ENTRIES_PER_MODULE);
    } else {
      store[moduleName] = entries;
    }

    saveStore(store);
  }

  /**
   * Record a failed locator use.
   * Call this when a selector fails so confidence can be adjusted.
   */
  static recordFailure(
    moduleName: string,
    element: string,
    action: string,
    selector: string,
  ): void {
    const store = loadStore();
    const entries = store[moduleName] || [];

    const existing = entries.find(
      e => e.element.toLowerCase() === element.toLowerCase() &&
           e.action.toLowerCase() === action.toLowerCase() &&
           e.selector === selector
    );

    if (existing) {
      existing.failureCount++;
      // Recalculate confidence
      const total = existing.successCount + existing.failureCount;
      existing.confidence = total > 0 ? existing.successCount / total : 0;
    }
    // Don't create entries for failures we've never seen succeed

    store[moduleName] = entries;
    saveStore(store);
  }

  /**
   * Get high-confidence locators for a module.
   * Returns only locators with sufficient success count and confidence.
   *
   * @param moduleName       Module to fetch locators for
   * @param minConfidence    Minimum confidence threshold (default: 0.5)
   * @param minSuccessCount  Minimum successful uses (default: MIN_SUCCESS_COUNT)
   * @returns                Array of locator entries sorted by confidence
   */
  static getModuleLocators(
    moduleName: string,
    minConfidence: number = 0.5,
    minSuccessCount: number = MIN_SUCCESS_COUNT,
  ): LocatorEntry[] {
    const store = loadStore();
    const entries = store[moduleName] || [];

    return entries
      .filter(e => e.confidence >= minConfidence && e.successCount >= minSuccessCount)
      .sort((a, b) => b.confidence - a.confidence || b.successCount - a.successCount);
  }

  /**
   * Find the best locator for a specific element + action across all modules.
   * Useful when you don't know the module yet.
   */
  static findBestLocator(
    element: string,
    action: string,
  ): LocatorEntry | null {
    const store = loadStore();
    let best: LocatorEntry | null = null;

    for (const entries of Object.values(store)) {
      for (const entry of entries) {
        if (
          entry.element.toLowerCase() === element.toLowerCase() &&
          entry.action.toLowerCase() === action.toLowerCase() &&
          entry.confidence >= 0.5
        ) {
          if (!best || entry.confidence > best.confidence ||
              (entry.confidence === best.confidence && entry.successCount > best.successCount)) {
            best = entry;
          }
        }
      }
    }

    return best;
  }

  /**
   * Generate a prompt section with high-confidence locators for AI injection.
   * This is the key method used during test generation to provide the AI
   * with proven selectors instead of making it guess.
   */
  static generatePromptContext(moduleName: string): string | null {
    const locators = this.getModuleLocators(moduleName);

    if (locators.length === 0) {
      return null;
    }

    const lines: string[] = [];
    lines.push(`## Known Working Selectors (from successful test runs)`);
    lines.push(`These selectors have been verified to work. Prefer these over generating new ones.`);
    lines.push('');

    // Group by action type
    const grouped: Record<string, LocatorEntry[]> = {};
    for (const loc of locators) {
      const key = `${loc.action} (${loc.framework || 'generic'})`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(loc);
    }

    for (const [group, entries] of Object.entries(grouped)) {
      lines.push(`### ${group}`);
      for (const entry of entries) {
        const confidenceStr = `confidence=${(entry.confidence * 100).toFixed(0)}%`;
        const strategyStr = entry.strategyKind ? `strategy=${entry.strategyKind}` : '';
        lines.push(
          `- "${entry.element}" → \`${entry.selector}\` [${confidenceStr}${strategyStr ? ' ' + strategyStr : ''}]`
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get statistics about the locator knowledge base.
   */
  static getStats(): LocatorStats {
    const store = loadStore();
    let total = 0;
    let high = 0;
    let medium = 0;
    let low = 0;

    for (const entries of Object.values(store)) {
      for (const entry of entries) {
        total++;
        if (entry.confidence >= HIGH_CONFIDENCE_THRESHOLD) high++;
        else if (entry.confidence >= 0.5) medium++;
        else low++;
      }
    }

    return {
      totalEntries: total,
      highConfidence: high,
      mediumConfidence: medium,
      lowConfidence: low,
      modules: Object.keys(store),
    };
  }

  /**
   * Clear all locator data. Useful for testing or reset.
   */
  static clearAll(): void {
    saveStore({});
  }

  /**
   * Clear locators for a specific module.
   */
  static clearModule(moduleName: string): void {
    const store = loadStore();
    delete store[moduleName];
    saveStore(store);
  }

  /**
   * Merge locator data from DiscoveryCacheService into the knowledge base.
   * This bootstraps the knowledge base with discovered selectors even
   * before any tests have run.
   */
  static async bootstrapFromDiscoveryCache(): Promise<number> {
    try {
      const { DiscoveryCacheService } = await import('../discovery/DiscoveryCacheService');
      const store = loadStore();
      let count = 0;

      // Check all cached modules
      const cachedModules = DiscoveryCacheService.listAll();

      for (const { moduleName } of cachedModules) {
        const elementMap = DiscoveryCacheService.getElementSelectorMap(moduleName);
        if (!elementMap || elementMap.size === 0) continue;

        const pageModel = DiscoveryCacheService.getPageModel(moduleName);
        const entries: LocatorEntry[] = [];
        const now = new Date().toISOString();

        for (const [name, selector] of elementMap) {
          // Find strategy/framework from pageModel
          let framework: string | undefined;
          let strategyKind: string | undefined;
          if (pageModel) {
            const el = pageModel.elements.find(e => e.name.toLowerCase() === name.toLowerCase());
            if (el) {
              framework = el.interaction.framework;
              strategyKind = el.interaction.kind;
            }
          }

          // Infer action type from strategy
          let action = 'click';
          if (strategyKind === 'fill' || strategyKind === 'edit-rich-text') action = 'fill';
          else if (strategyKind === 'select') action = 'select';
          else if (strategyKind === 'wait-for') action = 'wait';
          else if (strategyKind === 'assertVisible') action = 'assert';

          entries.push({
            element: name,
            action,
            selector,
            framework,
            strategyKind,
            successCount: 1,  // Bootstrap with 1 success (discovered, not tested)
            failureCount: 0,
            confidence: 0.5,  // Bootstrap entries start at 50% (not yet tested)
            firstSeen: now,
            lastSeen: now,
            usedByTickets: ['discovery-bootstrap'],
          });
          count++;
        }

        // Merge with existing entries (don't overwrite)
        const existing = store[moduleName] || [];
        const existingKeys = new Set(
          existing.map(e => `${e.element}|${e.action}|${e.selector}`)
        );

        for (const entry of entries) {
          const key = `${entry.element}|${entry.action}|${entry.selector}`;
          if (!existingKeys.has(key)) {
            existing.push(entry);
          }
        }

        store[moduleName] = existing;
      }

      saveStore(store);
      console.log(`[SkillRegistryService] Bootstrapped ${count} locator entries from discovery cache`);
      return count;
    } catch (err: any) {
      console.warn(`[SkillRegistryService] Bootstrap from discovery failed: ${err.message}`);
      return 0;
    }
  }
}
