/**
 * TestSpecTargetResolver.ts
 *
 * S4-3 — Post-Zod / pre-compile gate.
 *
 * Walks every action step in a validated `TestSpecification`, resolves the
 * business-level element reference (`field` on fill/selectOption/check/uploadFile,
 * `element` on click) against the module's discovery cache, and enriches the step
 * with `selectorHint` + `selectorAlternatives` in-place (on a cloned spec).
 *
 * If a target cannot be resolved AND the step didn't already carry a usable
 * `selectorHint`, it is collected in `unresolved[]` along with the top-N closest
 * known element names from the cache — the caller (JsonTestGenerationService)
 * uses this list to build a retry prompt for the LLM so generation can re-run
 * with concrete hints, rather than silently shipping a broken compiled script.
 *
 * Pure module: no I/O beyond `DiscoveryCacheService` cache reads, no mutation
 * of the input spec.
 */

import { TestSpecification, TestScenario, ActionStep, AnyStep } from './TestSpecSchema';
import { DiscoveryCacheService } from '../discovery/DiscoveryCacheService';
import { generateElementFallbackSelector } from '../ElementServiceQuery';
import { appLogger } from '../../utils/logger'; // ADDED

// ---------------------------------------------------------------------------
// ... (rest of imports/types)

// ---------------------------------------------------------------------------

export interface UnresolvedTarget {
  scenarioId: string;
  scenarioName: string;
  stepIndex: number;
  stepType: AnyStep['type'];
  /** The business-level name the step tried to reference. */
  target: string;
  /** Top-N closest known element names from the cache (empty if cache cold). */
  suggestions: string[];
  /** One-line human-readable reason for reporting. */
  reason: string;
}

export interface TargetResolutionReport {
  spec: TestSpecification;
  unresolved: UnresolvedTarget[];
  stats: {
    totalSteps: number;
    resolvedFromCache: number;
    alreadyHadHint: number;
    unresolved: number;
    skippedNonElement: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Steps whose `type` references a discoverable element. `goto`, `waitForSelector`,
 * `waitForResponse`, `hover` and `execute` either carry raw selectors or don't
 * need resolution, so they are skipped.
 */
const ELEMENT_STEP_TYPES: ReadonlySet<AnyStep['type']> = new Set([
  'fill',
  'click',
  'selectOption',
  'check',
  'uploadFile',
]);

/**
 * Normalise a name for loose comparison: lowercase, strip non-alphanumerics.
 */
function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Crude similarity: shared-substring length + bonus for prefix match.
 * Good enough to surface "Save" → "Save button", "department" → "Department"
 * without pulling in a Levenshtein dep.
 */
function similarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (nb.includes(na) || na.includes(nb)) {
    return 50 + Math.min(na.length, nb.length);
  }
  let shared = 0;
  for (const ch of new Set(na)) if (nb.includes(ch)) shared++;
  return shared;
}

/**
 * Pull the referenced business name off an action step, or null if this step
 * doesn't reference a discoverable element.
 */
function extractTarget(step: AnyStep): string | null {
  switch (step.type) {
    case 'fill':
    case 'selectOption':
    case 'check':
    case 'uploadFile':
      return step.field || null;
    case 'click':
      return step.element || null;
    default:
      return null;
  }
}

/**
 * True if the step already carries a non-empty, non-placeholder selectorHint.
 * We treat empty-string and `''` placeholders (Zod default on FillStep) as
 * "no hint provided" so resolution can still populate them.
 * We also enforce that the hint actually looks like a CSS selector.
 */
function hasUsableHint(step: AnyStep): boolean {
  const hint = (step as any).selectorHint;
  return typeof hint === 'string' && hint.trim().length > 0 && looksLikeCssSelector(hint);
}

/**
 * True if `target` already looks like a CSS/XPath selector rather than a
 * logical element name.  When the AI generates a CSS selector directly in
 * the `element` or `field` field we treat it as self-resolving — the compiler
 * can use it as-is without a cache lookup.
 *
 * Heuristics:
 *   • Contains `[`  → attribute selector  e.g. input[formControlName="title"]
 *   • Contains `(`  → pseudo-class / combinator  e.g. button:has(.k-i-plus)
 *   • Contains `>`  → child combinator
 *   • Starts with `#` or `.`  → id / class selector
 *   • Contains `::` → pseudo-element
 *
 * Simple names like "title", "Save button", "Add New" will NOT match these.
 */
function looksLikeCssSelector(target: string): boolean {
  const t = target.trim();
  return (
    t.includes('[') ||
    t.includes('(') ||
    t.includes('>') ||
    t.includes('::') ||
    /^[.#]/.test(t) ||
    /^[a-zA-Z0-9_-]+[.#][a-zA-Z0-9_-]+/.test(t)
  );
}

/**
 * Collect all known element names for a module from the discovery cache.
 * Used to suggest close matches for unresolved targets.
 */
function collectKnownNames(moduleName: string): string[] {
  const map = DiscoveryCacheService.getElementSelectorMap(moduleName);
  return Array.from(map.keys());
}

/**
 * Return the top-N candidates most similar to `target`.
 */
function topSuggestions(target: string, known: string[], n = 3): string[] {
  return known
    .map(name => ({ name, score: similarity(target, name) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(x => x.name);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve every element reference in `spec` against the discovery cache for
 * `moduleName`. Returns a cloned spec with `selectorHint` + optional
 * `selectorAlternatives` populated where possible, plus a report of anything
 * that couldn't be resolved.
 *
 * IMPORTANT: this is a non-blocking gate for cases where the cache is cold
 * (empty discovery). When `collectKnownNames` returns zero entries, we treat
 * every target as "cache-miss, not spec-miss" and skip adding it to
 * `unresolved`. This prevents the resolver from becoming a hard block when
 * discovery hasn't run yet — the compiler's own fallback heuristics still apply.
 */
export function resolveSpecTargets(
  spec: TestSpecification,
  moduleName: string,
): TargetResolutionReport {
  const known = collectKnownNames(moduleName);
  const cacheCold = known.length === 0;

  const unresolved: UnresolvedTarget[] = [];
  let totalSteps = 0;
  let resolvedFromCache = 0;
  let alreadyHadHint = 0;
  let skippedNonElement = 0;

  // Deep clone via structuredClone when available, JSON fallback otherwise.
  const cloned: TestSpecification =
    typeof structuredClone === 'function'
      ? structuredClone(spec)
      : JSON.parse(JSON.stringify(spec));

  for (const scenario of cloned.scenarios as TestScenario[]) {
    scenario.steps.forEach((step, index) => {
      totalSteps++;

      if (!ELEMENT_STEP_TYPES.has(step.type)) {
        skippedNonElement++;
        return;
      }

      const target = extractTarget(step);
      if (!target) {
        // Step is element-typed but has no target — that's a spec bug.
        unresolved.push({
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          stepIndex: index,
          stepType: step.type,
          target: '',
          suggestions: [],
          reason: `Step "${step.type}" is missing its element reference (field/element).`,
        });
        return;
      }

      if (hasUsableHint(step)) {
        alreadyHadHint++;
        return;
      }

      // If the AI put a CSS selector directly in target (not a logical name),
      // promote it to selectorHint so the compiler can use it as-is.
      // This happens when the AI generates complex selectors like
      // `button[title*='Add New' i]` instead of a logical name like "Add New".
      if (looksLikeCssSelector(target)) {
        (step as any).selectorHint = target;
        alreadyHadHint++;
        return;
      }

      const definition = DiscoveryCacheService.lookupElementDefinition(target, moduleName);
      if (definition && definition.selector) {
        // Enrich step with resolved selector; compiler will pick these up.
        (step as any).selectorHint = definition.selector;
        if (!(step as any).strategyKind && definition.strategyKind) {
          (step as any).strategyKind = definition.strategyKind;
        }
        if (!(step as any).framework && definition.framework) {
          (step as any).framework = definition.framework;
        }
        // S4-1: record which UI state the element was discovered in so
        // downstream reliability work (S4-4 CODE_FAULT classifier, self-heal)
        // can reason about ordering — e.g. a step tagged `modal:Add New` must
        // come after the "Add New" click in the same scenario.
        if (definition.stateKey) {
          (step as any).stateKey = definition.stateKey;
        }
        resolvedFromCache++;
        return;
      }

      // P0 FINAL PRIORITY: Intelligent Heuristics Fallback
      // If cache missed, try generating a high-reliability fallback selector based on name
      const fallback = generateElementFallbackSelector(target);
      if (fallback) {
        appLogger.info(`[TargetResolver] No cache match for "${target}" — using semantic fallback: ${fallback}`);
        (step as any).selectorHint = fallback;
        resolvedFromCache++;
        return;
      }
      // P0: fallback is null for unknown elements — fall through to cacheCold/unresolved logic
      appLogger.debug(`[TargetResolver] No fallback for "${target}" — will check cacheCold logic`);

      if (cacheCold) {
        // Don't block when discovery cache is empty — defer to compiler fallback.
        skippedNonElement++;
        return;
      }

      unresolved.push({
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        stepIndex: index,
        stepType: step.type,
        target,
        suggestions: topSuggestions(target, known),
        reason: `"${target}" was not found in the discovery cache for module "${moduleName}".`,
      });
    });
  }

  return {
    spec: cloned,
    unresolved,
    stats: {
      totalSteps,
      resolvedFromCache,
      alreadyHadHint,
      unresolved: unresolved.length,
      skippedNonElement,
    },
  };
}

/**
 * Render an LLM-friendly feedback block that can be appended to a retry prompt.
 * Returns empty string if nothing is unresolved.
 */
export function buildRetryHint(report: TargetResolutionReport): string {
  if (report.unresolved.length === 0) return '';

  const lines: string[] = [
    '## Target Resolution Failures',
    '',
    'The following steps referenced elements that do NOT exist in the discovered UI.',
    'Regenerate the affected scenarios using ONLY element names from the suggestions',
    'below, or use a different available element from the discovery context.',
    '',
  ];

  for (const item of report.unresolved) {
    const suggestions =
      item.suggestions.length > 0
        ? item.suggestions.map(s => `"${s}"`).join(', ')
        : '(no close matches — consult discovery context)';
    lines.push(
      `- [${item.scenarioId} step #${item.stepIndex + 1}] ${item.stepType} target="${item.target}"`,
    );
    lines.push(`  reason: ${item.reason}`);
    lines.push(`  try: ${suggestions}`);
  }

  return lines.join('\n');
}
