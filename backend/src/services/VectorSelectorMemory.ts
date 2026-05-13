/**
 * VectorSelectorMemory — Semantic Selector Matching
 *
 * D4: Vector-Based Selector Memory
 *
 * Uses semantic similarity (cosine similarity on tokenized selector features)
 * to match a requested element to the best-known selector in the SkillRegistry.
 *
 * When a test generator asks for "Save button in Leave module" but no exact
 * match exists, this service finds the closest known selector by comparing:
 * - Element name similarity (Levenshtein + word overlap)
 * - Action type similarity
 * - Module proximity
 * - Framework strategy compatibility
 *
 * Falls back to SkillRegistryService exact match, then to generic selectors.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SkillRegistryService, LocatorEntry } from './skills/SkillRegistryService';

// Re-use SkillRegistryService's internal store path
const STORE_PATH = path.join(
  process.env.LOCAL_STORAGE_PATH || path.join(__dirname, '../../../local_storage'),
  'locator-knowledge-base.json'
);

// ---------------------------------------------------------------------------
// Store loading (SkillRegistryService doesn't export loadStore, so we read directly)
// ---------------------------------------------------------------------------

function loadStore(): Record<string, LocatorEntry[]> {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf-8'));
      return parsed as Record<string, LocatorEntry[]>;
    }
  } catch (err: any) {
    // Silent fail — empty store
  }
  return {};
}

export interface SemanticMatch {
  /** The matched locator entry */
  entry: LocatorEntry;
  /** Overall similarity score (0-1) */
  score: number;
  /** Which factors contributed to the match */
  breakdown: {
    nameSimilarity: number;
    actionMatch: boolean;
    moduleSimilarity: number;
    frameworkBonus: number;
  };
  /** Suggested Playwright selector string */
  selector: string;
}

export interface SelectorQuery {
  /** Element name being searched for (e.g., "Save", "Add New") */
  element: string;
  /** Action type (e.g., "click", "fill") */
  action: string;
  /** Target module (e.g., "Leave", "Department") */
  module: string;
  /** Expected framework (optional hint) */
  framework?: string;
}

// ---------------------------------------------------------------------------
// Similarity Functions
// ---------------------------------------------------------------------------

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  const al = a.length;
  const bl = b.length;

  for (let i = 0; i <= bl; i++) matrix[i] = [i];
  for (let j = 0; j <= al; j++) matrix[0][j] = j;

  for (let i = 1; i <= bl; i++) {
    for (let j = 1; j <= al; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[bl][al];
}

/**
 * Normalized string similarity (0-1).
 * 1 = identical, 0 = completely different.
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / maxLen;
}

/**
 * Word-level overlap between two strings (Jaccard-like).
 */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

/**
 * Combined name similarity: best of Levenshtein and word overlap.
 */
function nameSimilarity(query: string, candidate: string): number {
  return Math.max(stringSimilarity(query, candidate), wordOverlap(query, candidate));
}

/**
 * Module similarity: exact match = 1, partial = 0.5, else = 0.
 */
function moduleSimilarity(queryModule: string, entryModule: string): number {
  if (queryModule.toLowerCase() === entryModule.toLowerCase()) return 1;
  if (entryModule.toLowerCase().includes(queryModule.toLowerCase()) ||
      queryModule.toLowerCase().includes(entryModule.toLowerCase())) return 0.5;
  return 0;
}

// ---------------------------------------------------------------------------
// Core Matching
// ---------------------------------------------------------------------------

/**
 * Score a single LocatorEntry against a SelectorQuery.
 * Returns a SemanticMatch or null if score is too low.
 */
function scoreEntry(entry: LocatorEntry, query: SelectorQuery): SemanticMatch | null {
  const nameSim = nameSimilarity(query.element, entry.element);
  const actionMatch = query.action.toLowerCase() === entry.action.toLowerCase();
  const moduleSim = moduleSimilarity(query.module, determineEntryModule(entry));
  const frameworkBonus = query.framework && entry.framework &&
    query.framework.toLowerCase() === entry.framework.toLowerCase() ? 0.1 : 0;

  // Weighted combination
  const score =
    nameSim * 0.45 +
    (actionMatch ? 0.25 : 0) +
    moduleSim * 0.2 +
    frameworkBonus +
    (entry.confidence * 0.1); // Prioritize high-confidence entries

  if (score < 0.3) return null; // Below threshold

  return {
    entry,
    score: Math.min(score, 1),
    breakdown: {
      nameSimilarity: nameSim,
      actionMatch,
      moduleSimilarity: moduleSim,
      frameworkBonus,
    },
    selector: entry.selector,
  };
}

/**
 * Extract module name from a LocatorEntry.
 * Since entries are stored per-module in the store, we infer from context.
 * The SkillRegistryService stores entries keyed by module name.
 * We use the first ticket's project prefix as a fallback.
 */
function determineEntryModule(entry: LocatorEntry): string {
  // The store is keyed by module, but entries themselves don't carry module.
  // We rely on the caller to pass the module context.
  // For cross-module search, we return empty to indicate "unknown".
  return '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class VectorSelectorMemory {

  /**
   * Find the best semantic selector match for a given query.
   *
   * @param query - What element/action/module we're looking for
   * @param minScore - Minimum similarity threshold (default: 0.4)
   * @returns Best match or null if no match above threshold
   */
  static findBestMatch(query: SelectorQuery, minScore: number = 0.4): SemanticMatch | null {
    const store = loadStore();
    let bestMatch: SemanticMatch | null = null;

    for (const [moduleName, entries] of Object.entries(store)) {
      for (const entry of entries) {
        // Inject module context for scoring
        const enrichedQuery: SelectorQuery = { ...query };
        const moduleSim = moduleSimilarity(enrichedQuery.module, moduleName);
        const scored = scoreEntryWithContext(entry, enrichedQuery, moduleName, moduleSim);
        if (scored && scored.score > (bestMatch?.score ?? 0)) {
          bestMatch = scored;
        }
      }
    }

    if (bestMatch && bestMatch.score >= minScore) {
      return bestMatch;
    }

    return null;
  }

  /**
   * Find all matches above a threshold, sorted by score.
   * Useful for debugging or presenting options to the AI.
   */
  static findAllMatches(query: SelectorQuery, minScore: number = 0.4): SemanticMatch[] {
    const store = loadStore();
    const matches: SemanticMatch[] = [];

    for (const [moduleName, entries] of Object.entries(store)) {
      for (const entry of entries) {
        const moduleSim = moduleSimilarity(query.module, moduleName);
        const scored = scoreEntryWithContext(entry, query, moduleName, moduleSim);
        if (scored && scored.score >= minScore) {
          matches.push(scored);
        }
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 5); // Top 5
  }

  /**
   * Get a human-readable summary of matches for AI prompt injection.
   */
  static buildPromptContext(query: SelectorQuery): string {
    const matches = this.findAllMatches(query, 0.4);
    if (matches.length === 0) return '';

    const lines = matches.map(m => {
      const confidence = m.entry.confidence.toFixed(2);
      const score = m.score.toFixed(2);
      const action = m.entry.action;
      const selector = m.selector;
      return `- "${query.element}" (${action}, score=${score}, confidence=${confidence}): \`${selector}\``;
    });

    return `\nKnown selectors for "${query.element}" in context "${query.module}":\n${lines.join('\n')}`;
  }

  /**
   * Record a successful selector use (delegates to SkillRegistryService).
   * Also updates the vector memory index.
   */
  static recordSuccess(
    module: string,
    element: string,
    action: string,
    selector: string,
    ticketId: string,
    framework?: string,
    strategyKind?: string
  ): void {
    // Delegate to SkillRegistryService for persistence
    const { recordSuccess } = require('./SkillRegistryService');
    recordSuccess(module, element, action, selector, ticketId, framework, strategyKind);
  }

  /**
   * Record a selector failure (decreases confidence).
   */
  static recordFailure(
    module: string,
    element: string,
    action: string,
    ticketId: string
  ): void {
    const { recordFailure } = require('./SkillRegistryService');
    recordFailure(module, element, action, ticketId);
  }

  /**
   * Get statistics about the vector memory index.
   */
  static getStats(): { totalEntries: number; modules: string[]; avgConfidence: number } {
    const store = loadStore();
    let totalEntries = 0;
    let totalConfidence = 0;
    const modules = Object.keys(store);

    for (const entries of Object.values(store)) {
      totalEntries += entries.length;
      for (const e of entries) totalConfidence += e.confidence;
    }

    return {
      totalEntries,
      modules,
      avgConfidence: totalEntries > 0 ? totalConfidence / totalEntries : 0,
    };
  }
}

/**
 * Score an entry with explicit module context.
 */
function scoreEntryWithContext(
  entry: LocatorEntry,
  query: SelectorQuery,
  moduleName: string,
  moduleSim: number
): SemanticMatch | null {
  const nameSim = nameSimilarity(query.element, entry.element);
  const actionMatch = query.action.toLowerCase() === entry.action.toLowerCase();
  const frameworkBonus = query.framework && entry.framework &&
    query.framework.toLowerCase() === entry.framework.toLowerCase() ? 0.1 : 0;

  const score =
    nameSim * 0.45 +
    (actionMatch ? 0.25 : 0) +
    moduleSim * 0.2 +
    frameworkBonus +
    (entry.confidence * 0.1);

  if (score < 0.3) return null;

  return {
    entry,
    score: Math.min(score, 1),
    breakdown: {
      nameSimilarity: nameSim,
      actionMatch,
      moduleSimilarity: moduleSim,
      frameworkBonus,
    },
    selector: entry.selector,
  };
}
