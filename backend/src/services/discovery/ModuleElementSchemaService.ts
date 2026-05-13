/**
 * ModuleElementSchemaService
 *
 * Phase 2 — UI Contract Layer.
 *
 * Converts a raw Playwright accessibility snapshot (text) into a structured
 * element registry per module, persists it to the DB, and exposes a validation
 * method used by McpTestExecutor to check whether a target element was actually
 * seen during discovery before trying to interact with it.
 *
 * This is the "anti-hallucination" layer:
 *   - AI generates a step targeting "Edit Special Project 20260502"
 *   - Before Playwright executes, we check: was any element with that label seen?
 *   - If not → CODE_FAULT immediately, never a false PASS
 *
 * DOTA 2 analogy: this is the entity registry — the server's authoritative list
 * of every entity (element) that exists in the current game state (page).
 */

import { Pool } from 'pg';
import { appLogger } from '../../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ElementType = 'button' | 'input' | 'grid' | 'dropdown' | 'modal' | 'link' | 'text' | 'checkbox' | 'other';
export type KendoType = 'grid' | 'dropdown' | 'datepicker' | 'numerictextbox' | 'timepicker' | 'upload';

export interface ElementRecord {
  /** Text label visible in the accessibility tree */
  label: string;
  /** Best available selector (aria-label, role+name, placeholder, etc.) */
  selector: string;
  type: ElementType;
  /** Set when the element is a Kendo UI component */
  kendoType?: KendoType;
  /** Route/page where this element was found */
  page: string;
  /** Whether the element was visible (not hidden or disabled) at capture time */
  visible: boolean;
}

export interface ModuleElementSchema {
  moduleId: string;
  capturedAt: Date;
  visitedUrl: string;
  snapshotHash: string;
  /** Key = page route, Value = elements found on that page */
  pages: Record<string, ElementRecord[]>;
}

// ─── Snapshot parser ──────────────────────────────────────────────────────────

/**
 * Parse a Playwright MCP accessibility snapshot (markdown text) into structured
 * element records. The snapshot format looks like:
 *
 *   - button "Add Department" [ref=e123]
 *   - textbox "Search Department" [ref=e124]
 *   - grid "Department List" [ref=e125]
 *   - combobox "Status" [ref=e126]
 *
 * We extract role + label pairs and classify them into ElementRecord types.
 */
export function parseSnapshot(
  snapshotText: string,
  pageRoute: string,
): ElementRecord[] {
  const elements: ElementRecord[] = [];
  const seen = new Set<string>(); // deduplicate by label+type

  const lines = snapshotText.split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('-')) continue;

    // Match: - <role> "<label>" [optional attributes]
    // Also match: - <role> <label> (no quotes)
    const withQuotes = line.match(/^-\s+(\w[\w\s]*?)\s+"([^"]+)"/);
    const noQuotes   = line.match(/^-\s+(\w+)\s+([A-Z][a-zA-Z0-9\s\-_]+?)(?:\s+\[|$)/);
    const match = withQuotes || noQuotes;
    if (!match) continue;

    const role  = match[1].toLowerCase().trim();
    const label = match[2].trim();
    if (!label || label.length < 2) continue;

    const key = `${role}::${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { type, kendoType } = classifyRole(role, label, line);
    const selector = buildSelector(role, label);

    elements.push({
      label,
      selector,
      type,
      kendoType,
      page: pageRoute,
      visible: !line.includes('hidden') && !line.includes('disabled'),
    });
  }

  return elements;
}

function classifyRole(
  role: string,
  label: string,
  rawLine: string,
): { type: ElementType; kendoType?: KendoType } {
  // Kendo UI detection — these appear as generic roles but have kendo context
  const lowerLabel = label.toLowerCase();
  const lowerLine  = rawLine.toLowerCase();

  if (role === 'grid' || lowerLine.includes('kendo-grid') || lowerLine.includes('k-grid')) {
    return { type: 'grid', kendoType: 'grid' };
  }
  if (
    role === 'combobox' || role === 'listbox' ||
    lowerLine.includes('k-dropdown') || lowerLine.includes('kendo-dropdownlist') ||
    lowerLine.includes('kendo-combobox')
  ) {
    return { type: 'dropdown', kendoType: 'dropdown' };
  }
  if (lowerLine.includes('kendo-datepicker') || lowerLine.includes('k-datepicker')) {
    return { type: 'input', kendoType: 'datepicker' };
  }
  if (lowerLine.includes('kendo-timepicker') || lowerLine.includes('k-timepicker')) {
    return { type: 'input', kendoType: 'timepicker' };
  }
  if (lowerLine.includes('kendo-numerictextbox') || lowerLine.includes('k-numerictextbox')) {
    return { type: 'input', kendoType: 'numerictextbox' };
  }
  if (lowerLine.includes('kendo-upload') || lowerLine.includes('k-upload')) {
    return { type: 'input', kendoType: 'upload' };
  }

  // Standard roles
  switch (role) {
    case 'button':     return { type: 'button' };
    case 'link':       return { type: 'link' };
    case 'textbox':
    case 'input':
    case 'searchbox':  return { type: 'input' };
    case 'checkbox':   return { type: 'checkbox' };
    case 'dialog':
    case 'alertdialog':
    case 'modal':      return { type: 'modal' };
    default:           return { type: 'other' };
  }
}

function buildSelector(role: string, label: string): string {
  switch (role) {
    case 'button':  return `button:has-text("${label}")`;
    case 'link':    return `a:has-text("${label}")`;
    case 'textbox':
    case 'input':   return `input[placeholder*="${label}"], [aria-label*="${label}"]`;
    case 'combobox':
    case 'listbox': return `[aria-label*="${label}"], .k-dropdown:has-text("${label}")`;
    default:        return `[aria-label*="${label}"]`;
  }
}

// ─── Inline selector confidence scorer ───────────────────────────────────────
// Phase 2.5 Priority 2: lightweight heuristic — no external dependencies.
// Mirrors the formula in THEORY.md §2 (ElementConfidenceScorer), simplified
// to work directly from an ElementRecord.selector string.
//
// Thresholds used by validateTarget():
//   >= 0.5  → allow, no warning
//   [0.35, 0.5) → allow, but log low-confidence warning
//   < 0.35  → treat as not-found (CODE_FAULT — likely hallucinated)

function scoreSelector(selector: string): number {
  if (!selector) return 0.3;
  const s = selector.toLowerCase();

  // Stable attribute anchors (data-testid, aria-label, formControlName) → high confidence
  if (s.includes('data-testid') || s.includes('[aria-label=') || s.includes('formcontrolname')) {
    return 0.85;
  }
  // Role + name selectors (Playwright accessibility) → good confidence
  if (s.includes('role=') || (s.startsWith('[aria-label') && s.includes('*='))) {
    return 0.75;
  }
  // Text-based selectors (:has-text, a:has-text) → moderate (text can change)
  if (s.includes(':has-text(')) {
    return 0.65;
  }
  // Input with placeholder → moderate
  if (s.includes('input[placeholder') || s.includes('[placeholder')) {
    return 0.60;
  }
  // Pure class selector → low stability
  if (/^\.[a-z]/.test(s) && !s.includes('[')) {
    return 0.38;
  }
  // Default: unknown shape
  return 0.55;
}

// ─── Trigram helpers ──────────────────────────────────────────────────────────

// Splits a string into overlapping 3-char substrings for O(1) approximate lookup.
// E.g. "save" → ["sav", "ave"]
function getTrigrams(s: string): string[] {
  const clean = s.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const grams: string[] = [];
  for (let i = 0; i <= clean.length - 3; i++) {
    grams.push(clean.slice(i, i + 3));
  }
  return grams;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ModuleElementSchemaService {
  // Keyed by moduleId → Map<trigram, ElementRecord[]>
  private static readonly trigramCache = new Map<string, Map<string, ElementRecord[]>>();

  constructor(private readonly pool: Pool) {}

  /**
   * Build and cache the trigram index for a module's schema.
   * No-op if the index already exists for this moduleId.
   */
  private static buildTrigramIndex(
    moduleId: string,
    schema: ModuleElementSchema,
  ): void {
    if (ModuleElementSchemaService.trigramCache.has(moduleId)) return;

    const index = new Map<string, ElementRecord[]>();
    for (const elements of Object.values(schema.pages)) {
      for (const el of elements) {
        for (const gram of getTrigrams(el.label)) {
          const bucket = index.get(gram);
          if (bucket) {
            bucket.push(el);
          } else {
            index.set(gram, [el]);
          }
        }
      }
    }
    ModuleElementSchemaService.trigramCache.set(moduleId, index);
  }

  /**
   * Build a ModuleElementSchema from a LiveDiscoveryResult snapshot and persist it.
   * Called by McpDiscoveryService after every successful discovery crawl.
   */
  async buildAndSave(opts: {
    moduleId: string;
    snapshotText: string;
    snapshotHash: string;
    visitedUrl: string;
  }): Promise<ModuleElementSchema> {
    const route = this.extractRoute(opts.visitedUrl);
    const elements = parseSnapshot(opts.snapshotText, route);

    const schema: ModuleElementSchema = {
      moduleId:    opts.moduleId,
      capturedAt:  new Date(),
      visitedUrl:  opts.visitedUrl,
      snapshotHash: opts.snapshotHash,
      pages: { [route]: elements },
    };

    await this.save(schema);

    appLogger.info(
      `[ModuleElementSchema] Saved schema for "${opts.moduleId}" — ` +
      `${elements.length} elements on ${route}`,
    );

    return schema;
  }

  /**
   * Persist schema to DB (upsert by moduleId).
   * Also invalidates the in-memory trigram cache so the next validateTarget()
   * call rebuilds it from the freshly saved data.
   */
  async save(schema: ModuleElementSchema): Promise<void> {
    await this.pool.query(
      `INSERT INTO module_element_schemas
         (module_id, captured_at, visited_url, snapshot_hash, pages)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (module_id)
       DO UPDATE SET
         captured_at   = EXCLUDED.captured_at,
         visited_url   = EXCLUDED.visited_url,
         snapshot_hash = EXCLUDED.snapshot_hash,
         pages         = EXCLUDED.pages`,
      [
        schema.moduleId,
        schema.capturedAt,
        schema.visitedUrl,
        schema.snapshotHash,
        JSON.stringify(schema.pages),
      ],
    );
    ModuleElementSchemaService.trigramCache.delete(schema.moduleId);
  }

  /**
   * Load the latest schema for a module.
   * Returns null if no schema has been captured yet.
   */
  async get(moduleId: string): Promise<ModuleElementSchema | null> {
    const { rows } = await this.pool.query(
      `SELECT module_id, captured_at, visited_url, snapshot_hash, pages
         FROM module_element_schemas
        WHERE module_id = $1`,
      [moduleId],
    );
    if (!rows[0]) return null;

    const row = rows[0];
    return {
      moduleId:     row.module_id,
      capturedAt:   new Date(row.captured_at),
      visitedUrl:   row.visited_url,
      snapshotHash: row.snapshot_hash,
      pages:        typeof row.pages === 'string' ? JSON.parse(row.pages) : row.pages,
    };
  }

  /**
   * Validate whether a target label/text was seen in the most recent schema
   * for the given module. Used by McpTestExecutor before each step.
   *
   * Returns the matching ElementRecord if found, null if not in schema.
   * A null result means the step should be treated as CODE_FAULT, not retried.
   */
  async validateTarget(
    moduleId: string,
    targetLabel: string,
  ): Promise<ElementRecord | null> {
    const schema = await this.get(moduleId).catch(() => null);
    if (!schema) {
      // No schema yet — schema not captured, allow execution (don't block)
      appLogger.warn(`[ModuleElementSchema] No schema for "${moduleId}" — skipping validation`);
      return { label: targetLabel, selector: '', type: 'other', page: '', visible: true };
    }

    const lowerTarget = targetLabel.toLowerCase().trim();

    // Build trigram index on first access for this moduleId.
    ModuleElementSchemaService.buildTrigramIndex(moduleId, schema);
    const index = ModuleElementSchemaService.trigramCache.get(moduleId)!;

    // Collect candidate elements via trigram lookup (union of all matching buckets).
    const targetGrams = getTrigrams(lowerTarget);
    let candidates: ElementRecord[];
    if (targetGrams.length > 0) {
      const seen = new Set<ElementRecord>();
      for (const gram of targetGrams) {
        const bucket = index.get(gram);
        if (bucket) {
          for (const el of bucket) seen.add(el);
        }
      }
      candidates = Array.from(seen);
    } else {
      candidates = [];
    }

    // Defensive fallback: if trigram gives no candidates, scan all elements.
    if (candidates.length === 0) {
      candidates = Object.values(schema.pages).flat();
    }

    for (const el of candidates) {
      // Exact or partial label match (e.g. "Edit Special Project 20260502" matches "Edit Special Project")
      if (
        el.label.toLowerCase() === lowerTarget ||
        el.label.toLowerCase().includes(lowerTarget) ||
        lowerTarget.includes(el.label.toLowerCase())
      ) {
        // Phase 2.5 P2: confidence gate — score the selector quality
        const confidence = scoreSelector(el.selector);
        if (confidence < 0.35) {
          // Hallucinated or dangerously unstable selector — treat as not-found
          appLogger.warn(
            `[ModuleElementSchema] Target "${targetLabel}" found in schema but confidence ` +
            `${confidence.toFixed(2)} < 0.35 — treating as CODE_FAULT for module "${moduleId}"`,
          );
          return null;
        }
        if (confidence < 0.5) {
          appLogger.warn(
            `[ModuleElementSchema] Target "${targetLabel}" — low confidence selector ` +
            `(${confidence.toFixed(2)}). Consider improving discovery for module "${moduleId}".`,
          );
        }
        return el;
      }
    }

    appLogger.warn(
      `[ModuleElementSchema] Target "${targetLabel}" not found in schema for "${moduleId}" ` +
      `(schema captured ${schema.capturedAt.toISOString()})`,
    );
    return null;
  }

  /**
   * Derive moduleId from a Jira ticket ID prefix.
   * "ATT-22" → "ATT", "GHR-1234" → "GHR"
   */
  static moduleIdFromTicket(ticketId: string): string {
    return ticketId.split('-')[0].toUpperCase();
  }

  private extractRoute(url: string): string {
    try {
      const u = new URL(url);
      return u.hash ? u.hash.replace(/^#/, '') : u.pathname;
    } catch {
      return url;
    }
  }
}
