/**
 * ModuleStateGraph
 *
 * Phase 3 — State Graph + Behavior Tree.
 *
 * Builds a Hierarchical State Machine (HSM) graph from a ModuleElementSchema
 * and exposes:
 *   buildFromSchema()  — derive states + transitions from the UI element registry
 *   generatePaths()    — Dijkstra (lowest-cost path first) for happy / rollback / edge
 *   topoSort()         — Kahn's topological sort for cross-module test ordering
 *   save() / load()    — persist graph to module_state_graphs table (migration v31)
 *
 * THEORY.md references:
 *   §2 Graph Theory   — Dijkstra, topological sort, O(E log V)
 *   §4 HSM            — parent/child states, 60% transition reduction vs flat FSM
 *   §5 ECS            — graph nodes are "entities", transitions are "components"
 *
 * DOTA 2 analogy: this is the minimap — it shows every state the page can be in,
 * every door between states, and lets Dijkstra route the cheapest path to the goal.
 */

import { Pool } from 'pg';
import {
  ModuleElementSchema,
  ElementRecord,
} from '../discovery/ModuleElementSchemaService';
import { appLogger } from '../../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StateType = 'page' | 'modal' | 'dialog' | 'tab';
export type WaitStrategy = 'navigation' | 'modal_open' | 'api_response' | 'toast';
export type TransitionType =
  | 'navigate'
  | 'open_modal'
  | 'close_modal'
  | 'submit'
  | 'rollback'
  | 'delete_confirm';

/**
 * A single UI state in the HSM.
 * Parent/child hierarchy: modal states have parentId set to their owning page.
 */
export interface PageState {
  /** Unique identifier — e.g. "ATT/leave-list" or "ATT/leave-list/modal:Add_New" */
  id: string;
  /** URL fragment/pathname where this state lives */
  route: string;
  /** HSM: parent state id (undefined = root page state) */
  parentId?: string;
  /** Element labels that must be visible to confirm we are in this state */
  requiredElements: string[];
  stateType: StateType;
}

/**
 * A directed edge in the graph: an interaction that moves the UI between states.
 */
export interface StateTransition {
  from: string;
  /** Label or selector that triggers this transition */
  triggerSelector: string;
  to: string;
  waitFor: WaitStrategy;
  /** Dijkstra edge weight: 1 = simple nav, 2 = modal/submit, 3 = confirm dialog */
  cost: number;
  transitionType: TransitionType;
}

export interface ModuleStateGraph {
  moduleId: string;
  states: PageState[];
  transitions: StateTransition[];
  /** Entry state id (starting point for all path generation) */
  entry: string;
  /** Terminal state ids (leaf states with no further outbound transitions) */
  terminals: string[];
  /** Module IDs this graph depends on (for topological sort) */
  dependencies: string[];
  capturedAt: Date;
}

export interface StatePath {
  /** Ordered state ids visited along this path */
  states: string[];
  transitions: StateTransition[];
  totalCost: number;
}

// ─── Label classification helpers ────────────────────────────────────────────

function isAddTrigger(label: string): boolean {
  return /\b(add|new|create)\b/i.test(label);
}
function isSaveTrigger(label: string): boolean {
  return /\b(save|submit|update|confirm|apply)\b/i.test(label);
}
function isRollbackTrigger(label: string): boolean {
  return /\b(cancel|back|close|discard|dismiss)\b/i.test(label);
}
function isDeleteTrigger(label: string): boolean {
  return /\b(delete|remove)\b/i.test(label);
}

function normalizeStateId(moduleId: string, route: string): string {
  // Route may be like "/attendance/leave" or "#/app.attendance/leave"
  const cleaned = route
    .replace(/^#\//, '')
    .replace(/^\//, '')
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9_\-]/g, '')
    .slice(0, 40) || 'root';
  return `${moduleId}/${cleaned}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ModuleStateGraphService {
  // ── Build ──────────────────────────────────────────────────────────────────

  /**
   * Derive a ModuleStateGraph from a ModuleElementSchema.
   *
   * Derivation rules:
   *   - One root PageState per visited URL/route in schema.pages
   *   - Buttons with Add/New/Create labels → modal child state + open_modal transition
   *   - Save/Submit inside modal context → submit transition back to parent
   *   - Cancel/Close → rollback transition
   *   - Delete buttons → dialog child state (cost 3) + close_modal back
   *   - Grid/text/input elements → requiredElements confirming page identity
   */
  static buildFromSchema(schema: ModuleElementSchema): ModuleStateGraph {
    const states: PageState[] = [];
    const transitions: StateTransition[] = [];
    const stateMap = new Map<string, PageState>();

    // ── Step 1: create one root PageState per page ───────────────────────────
    for (const [route, elements] of Object.entries(schema.pages)) {
      const stateId = normalizeStateId(schema.moduleId, route);
      if (stateMap.has(stateId)) continue;

      const confirming = elements
        .filter(e => (e.type === 'grid' || e.type === 'text') && e.visible)
        .map(e => e.label)
        .slice(0, 4);

      const state: PageState = {
        id: stateId,
        route,
        stateType: 'page',
        requiredElements: confirming,
      };
      states.push(state);
      stateMap.set(stateId, state);
    }

    // ── Step 2: derive transitions from button/link labels ───────────────────
    for (const [route, elements] of Object.entries(schema.pages)) {
      const parentId = normalizeStateId(schema.moduleId, route);

      for (const el of elements) {
        if (el.type !== 'button' && el.type !== 'link') continue;
        if (!el.visible) continue;

        const lbl = el.label.toLowerCase();

        if (isAddTrigger(lbl)) {
          // Open a modal child state
          const modalId = `${parentId}/modal:${el.label.replace(/\s+/g, '_').slice(0, 30)}`;
          if (!stateMap.has(modalId)) {
            const modalState: PageState = {
              id: modalId,
              route,
              parentId,
              stateType: 'modal',
              requiredElements: [el.label],
            };
            states.push(modalState);
            stateMap.set(modalId, modalState);

            // Transition: page → modal
            transitions.push({
              from: parentId,
              triggerSelector: el.label,
              to: modalId,
              waitFor: 'modal_open',
              cost: 2,
              transitionType: 'open_modal',
            });

            // Auto-wire common modal close transitions
            this.wireModalCloseTransitions(
              modalId,
              parentId,
              elements,
              transitions,
            );
          }
        } else if (isDeleteTrigger(lbl)) {
          // Delete leads to a confirm dialog child state
          const dialogId = `${parentId}/dialog:confirm_delete`;
          if (!stateMap.has(dialogId)) {
            const dlg: PageState = {
              id: dialogId,
              route,
              parentId,
              stateType: 'dialog',
              requiredElements: [el.label],
            };
            states.push(dlg);
            stateMap.set(dialogId, dlg);

            transitions.push({
              from: parentId,
              triggerSelector: el.label,
              to: dialogId,
              waitFor: 'modal_open',
              cost: 3,
              transitionType: 'delete_confirm',
            });

            // Confirm → api_response → back to page
            transitions.push({
              from: dialogId,
              triggerSelector: 'Confirm',
              to: parentId,
              waitFor: 'api_response',
              cost: 2,
              transitionType: 'submit',
            });
            transitions.push({
              from: dialogId,
              triggerSelector: 'Cancel',
              to: parentId,
              waitFor: 'toast',
              cost: 1,
              transitionType: 'rollback',
            });
          }
        } else if (el.type === 'link' && el.label.length > 1) {
          // Navigation link — simple navigate transition to same or other page
          // We don't know the target route from label alone; mark cost 1 tentatively
          const targetId = parentId; // same module, treat as in-page nav for now
          if (parentId !== targetId) {
            transitions.push({
              from: parentId,
              triggerSelector: el.label,
              to: targetId,
              waitFor: 'navigation',
              cost: 1,
              transitionType: 'navigate',
            });
          }
        }
      }
    }

    const allStateIds = new Set(states.map(s => s.id));
    const entry = states.find(s => s.stateType === 'page')?.id
      ?? `${schema.moduleId}/root`;

    // Terminals = states with no outbound transitions (or only rollback ones)
    const hasNonRollbackOut = new Set(
      transitions.filter(t => t.transitionType !== 'rollback').map(t => t.from),
    );
    const terminals = states
      .filter(s => !hasNonRollbackOut.has(s.id))
      .map(s => s.id);

    appLogger.info(
      `[ModuleStateGraph] Built graph for "${schema.moduleId}": ` +
      `${states.length} states, ${transitions.length} transitions`,
    );

    return {
      moduleId: schema.moduleId,
      states,
      transitions,
      entry,
      terminals,
      dependencies: [],
      capturedAt: new Date(),
    };
  }

  /**
   * Auto-wire Save/Submit and Cancel/Close transitions for a newly created modal.
   * Scans all elements on the same page for save/rollback-labeled buttons.
   */
  private static wireModalCloseTransitions(
    modalId: string,
    parentId: string,
    elements: ElementRecord[],
    transitions: StateTransition[],
  ): void {
    let hasSave = false;
    let hasCancel = false;

    for (const el of elements) {
      if (el.type !== 'button') continue;
      const lbl = el.label.toLowerCase();

      if (!hasSave && isSaveTrigger(lbl)) {
        transitions.push({
          from: modalId,
          triggerSelector: el.label,
          to: parentId,
          waitFor: 'api_response',
          cost: 2,
          transitionType: 'submit',
        });
        hasSave = true;
      }
      if (!hasCancel && isRollbackTrigger(lbl)) {
        transitions.push({
          from: modalId,
          triggerSelector: el.label,
          to: parentId,
          waitFor: 'toast',
          cost: 1,
          transitionType: 'rollback',
        });
        hasCancel = true;
      }
      if (hasSave && hasCancel) break;
    }

    // Default save transition if no save button found
    if (!hasSave) {
      transitions.push({
        from: modalId,
        triggerSelector: 'Save',
        to: parentId,
        waitFor: 'api_response',
        cost: 2,
        transitionType: 'submit',
      });
    }
  }

  // ── Dijkstra path generation ───────────────────────────────────────────────

  /**
   * Generate test paths from the graph entry state.
   *
   * Strategies:
   *   'happy'    — cheapest path from entry to each terminal (CRUD happy flow)
   *   'rollback' — paths that include Cancel/Back transitions (negative flow)
   *   'edge'     — paths through high-cost transitions (modal → fill → submit)
   */
  static generatePaths(
    graph: ModuleStateGraph,
    strategy: 'happy' | 'rollback' | 'edge',
  ): StatePath[] {
    const paths: StatePath[] = [];

    if (strategy === 'happy') {
      for (const terminal of graph.terminals) {
        if (terminal === graph.entry) continue;
        const path = this.dijkstra(graph, graph.entry, terminal);
        if (path) paths.push(path);
      }
    } else if (strategy === 'rollback') {
      const rollbacks = graph.transitions.filter(
        t => t.transitionType === 'rollback',
      );
      for (const rt of rollbacks) {
        const toTrigger = this.dijkstra(graph, graph.entry, rt.from);
        if (toTrigger) {
          paths.push({
            states: [...toTrigger.states, rt.to],
            transitions: [...toTrigger.transitions, rt],
            totalCost: toTrigger.totalCost + rt.cost,
          });
        }
      }
    } else if (strategy === 'edge') {
      const edgeTriggers = graph.transitions.filter(t => t.cost >= 2);
      for (const et of edgeTriggers) {
        const toTrigger = this.dijkstra(graph, graph.entry, et.from);
        if (toTrigger) {
          paths.push({
            states: [...toTrigger.states, et.to],
            transitions: [...toTrigger.transitions, et],
            totalCost: toTrigger.totalCost + et.cost,
          });
        }
      }
    }

    // Cheapest paths first — testers run the most likely flows before edge cases
    return paths.sort((a, b) => a.totalCost - b.totalCost);
  }

  /**
   * Dijkstra shortest-path search on the state graph.
   * O(E log V) using a simple priority-queue sorted array.
   */
  static dijkstra(
    graph: ModuleStateGraph,
    from: string,
    to: string,
  ): StatePath | null {
    if (from === to) {
      return { states: [from], transitions: [], totalCost: 0 };
    }

    // Build adjacency map
    const adj = new Map<string, StateTransition[]>();
    for (const s of graph.states) adj.set(s.id, []);
    for (const t of graph.transitions) {
      adj.get(t.from)?.push(t);
    }

    const dist = new Map<string, number>();
    const prev = new Map<string, StateTransition>();
    const queue: [number, string][] = []; // [cost, stateId]

    for (const s of graph.states) dist.set(s.id, Infinity);
    dist.set(from, 0);
    queue.push([0, from]);

    const visited = new Set<string>();

    while (queue.length > 0) {
      // Pop minimum cost (sort ascending, shift = O(n) — acceptable for small graphs)
      queue.sort((a, b) => a[0] - b[0]);
      const [currentCost, current] = queue.shift()!;

      if (visited.has(current)) continue;
      visited.add(current);
      if (current === to) break;

      for (const t of (adj.get(current) ?? [])) {
        const newCost = currentCost + t.cost;
        if (newCost < (dist.get(t.to) ?? Infinity)) {
          dist.set(t.to, newCost);
          prev.set(t.to, t);
          queue.push([newCost, t.to]);
        }
      }
    }

    if (!prev.has(to)) return null;

    // Reconstruct path
    const orderedTransitions: StateTransition[] = [];
    let current = to;
    while (current !== from) {
      const t = prev.get(current);
      if (!t) return null;
      orderedTransitions.unshift(t);
      current = t.from;
    }

    return {
      states: [from, ...orderedTransitions.map(t => t.to)],
      transitions: orderedTransitions,
      totalCost: dist.get(to) ?? 0,
    };
  }

  // ── Topological sort (cross-module test ordering) ──────────────────────────

  /**
   * Kahn's algorithm — sorts module graphs so that dependencies run first.
   *
   * Example: ATT depends on HR (needs employee records) → HR graph runs first.
   * Set graph.dependencies = ['HR'] on the ATT graph to express this.
   */
  static topoSort(graphs: ModuleStateGraph[]): ModuleStateGraph[] {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>(); // dep → dependents

    for (const g of graphs) {
      if (!inDegree.has(g.moduleId)) inDegree.set(g.moduleId, 0);
      if (!adjList.has(g.moduleId)) adjList.set(g.moduleId, []);

      for (const dep of g.dependencies) {
        if (!adjList.has(dep)) adjList.set(dep, []);
        adjList.get(dep)!.push(g.moduleId);
        inDegree.set(g.moduleId, (inDegree.get(g.moduleId) ?? 0) + 1);
      }
    }

    const graphById = new Map(graphs.map(g => [g.moduleId, g]));
    const result: ModuleStateGraph[] = [];
    const queue = [...inDegree.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const g = graphById.get(current);
      if (g) result.push(g);

      for (const dependent of (adjList.get(current) ?? [])) {
        const newDeg = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) queue.push(dependent);
      }
    }

    // Safety net: append any graphs not reachable (cycles or unknown deps)
    for (const g of graphs) {
      if (!result.find(r => r.moduleId === g.moduleId)) {
        appLogger.warn(
          `[ModuleStateGraph] topoSort: "${g.moduleId}" not reachable — cycle or unknown dep`,
        );
        result.push(g);
      }
    }

    return result;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  static async save(pool: Pool, graph: ModuleStateGraph): Promise<void> {
    await pool.query(
      `INSERT INTO module_state_graphs
         (module_id, captured_at, states, transitions, entry, terminals, dependencies)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (module_id)
       DO UPDATE SET
         captured_at  = EXCLUDED.captured_at,
         states       = EXCLUDED.states,
         transitions  = EXCLUDED.transitions,
         entry        = EXCLUDED.entry,
         terminals    = EXCLUDED.terminals,
         dependencies = EXCLUDED.dependencies`,
      [
        graph.moduleId,
        graph.capturedAt,
        JSON.stringify(graph.states),
        JSON.stringify(graph.transitions),
        graph.entry,
        JSON.stringify(graph.terminals),
        JSON.stringify(graph.dependencies),
      ],
    );

    appLogger.info(
      `[ModuleStateGraph] Saved graph for "${graph.moduleId}": ` +
      `${graph.states.length} states, ${graph.transitions.length} transitions`,
    );
  }

  static async load(
    pool: Pool,
    moduleId: string,
  ): Promise<ModuleStateGraph | null> {
    const { rows } = await pool.query(
      `SELECT module_id, captured_at, states, transitions, entry, terminals, dependencies
         FROM module_state_graphs
        WHERE module_id = $1`,
      [moduleId],
    );

    if (!rows[0]) return null;
    const row = rows[0];

    return {
      moduleId:     row.module_id,
      capturedAt:   new Date(row.captured_at),
      states:       typeof row.states      === 'string' ? JSON.parse(row.states)      : row.states,
      transitions:  typeof row.transitions === 'string' ? JSON.parse(row.transitions) : row.transitions,
      entry:        row.entry,
      terminals:    typeof row.terminals    === 'string' ? JSON.parse(row.terminals)   : row.terminals,
      dependencies: typeof row.dependencies === 'string' ? JSON.parse(row.dependencies) : row.dependencies,
    };
  }

  // ── Coverage metric (Phase 4 preview) ─────────────────────────────────────

  /**
   * Compute |VisitedTransitions| / |TotalTransitions| coverage ratio.
   * `visitedTransitions` is built at runtime by recording which transitions
   * actually fired during a test run.
   */
  static coverageRatio(
    graph: ModuleStateGraph,
    visitedTransitions: Set<string>,
  ): number {
    if (graph.transitions.length === 0) return 1;
    const key = (t: StateTransition) => `${t.from}→${t.to}:${t.triggerSelector}`;
    const visited = graph.transitions.filter(t => visitedTransitions.has(key(t)));
    return visited.length / graph.transitions.length;
  }
}
