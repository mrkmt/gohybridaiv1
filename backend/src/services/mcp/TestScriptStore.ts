/**
 * TestScriptStore
 *
 * DB-backed repository for passing test scripts.
 * Supports two storage formats:
 *   • Legacy: `script TEXT` — compiled Playwright .spec.ts file content
 *   • New:    `steps JSONB` — McpStep[] array for direct MCP replay
 *
 * Scripts that PASS on first execution are saved here so the SmartExecutionRouter
 * can reuse them without calling AI again — skipping the 30–90 s generation
 * phase and reducing Vertex AI cost to $0 on repeat runs.
 *
 * UI-drift detection:
 *   `selector_hash` stores SHA-256 of the accessibility snapshot captured when
 *   the script was generated. Before reuse, hasUiChanged() compares the live
 *   hash to the saved one. A mismatch triggers re-discovery + re-generation.
 */

import { Pool } from 'pg';
import { McpStep, McpStepSchema } from '../../types/mcp.types';
import { appLogger } from '../../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SavedScript {
  id: number;
  ticketId: string;
  scenarioId: string;
  scenarioName: string | null;
  moduleName: string | null;
  /** Compiled .spec.ts text (legacy). Null for McpStep-only rows. */
  script: string | null;
  /** McpStep[] for direct MCP replay. Null for legacy script-only rows. */
  steps: McpStep[] | null;
  /** Hex-encoded SHA-256 prefix of the accessibility snapshot */
  selectorHash: string | null;
  /** "PASS" | "FAIL" */
  status: string;
  runCount: number;
  passCount: number;
  lastRunAt: Date;
  lastPassAt: Date | null;
  createdAt: Date;
}

export interface SaveScriptInput {
  ticketId: string;
  scenarioId: string;
  scenarioName?: string;
  moduleName?: string;
  /** Compiled .spec.ts text — supply for legacy saves */
  script?: string;
  /** McpStep[] — supply for new MCP-based saves (preferred) */
  steps?: McpStep[];
  selectorHash?: string;
  status?: 'PASS' | 'FAIL';
}

export interface RecordOutcomeInput {
  ticketId: string;
  scenarioId: string;
  status: 'PASS' | 'FAIL';
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class TestScriptStore {
  /**
   * Save or update a script.
   *
   * Accepts either `script` (legacy compiled text), `steps` (McpStep[]), or both.
   * At least one must be provided. Steps are Zod-validated before insert.
   */
  static async save(pool: Pool, input: SaveScriptInput): Promise<void> {
    const {
      ticketId,
      scenarioId,
      scenarioName  = null,
      moduleName    = null,
      script        = null,
      steps         = null,
      selectorHash  = null,
      status        = 'PASS',
    } = input;

    if (!script && !steps) {
      appLogger.warn(`[TestScriptStore] save() called with neither script nor steps — skipping`);
      return;
    }

    // Validate steps if provided
    let stepsJson: string | null = null;
    if (steps) {
      const validation = McpStepSchema.array().safeParse(steps);
      if (!validation.success) {
        appLogger.error(
          `[TestScriptStore] Invalid McpStep[] for ${ticketId}/${scenarioId} — steps not saved. ` +
          `Errors: ${JSON.stringify(validation.error.flatten().fieldErrors)}`,
        );
        // Still proceed if script is also provided
        if (!script) return;
      } else {
        stepsJson = JSON.stringify(validation.data);
      }
    }

    const isPass = status === 'PASS';

    await pool.query(
      `INSERT INTO test_scripts
         (ticket_id, scenario_id, scenario_name, module_name, script, steps,
          selector_hash, status, run_count, pass_count, last_run_at, last_pass_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, NOW(), $10)
       ON CONFLICT (ticket_id, scenario_id)
       DO UPDATE SET
         scenario_name = COALESCE(EXCLUDED.scenario_name, test_scripts.scenario_name),
         module_name   = COALESCE(EXCLUDED.module_name,   test_scripts.module_name),
         script        = COALESCE(EXCLUDED.script,        test_scripts.script),
         steps         = COALESCE(EXCLUDED.steps,         test_scripts.steps),
         selector_hash = COALESCE(EXCLUDED.selector_hash, test_scripts.selector_hash),
         status        = EXCLUDED.status,
         run_count     = test_scripts.run_count + 1,
         pass_count    = test_scripts.pass_count + EXCLUDED.pass_count,
         last_run_at   = NOW(),
         last_pass_at  = CASE WHEN EXCLUDED.status = 'PASS' THEN NOW() ELSE test_scripts.last_pass_at END`,
      [
        ticketId, scenarioId, scenarioName, moduleName,
        script, stepsJson,
        selectorHash, status,
        isPass ? 1 : 0,        // pass_count delta
        isPass ? new Date() : null, // last_pass_at — pg driver converts Date to TIMESTAMPTZ
      ],
    );

    appLogger.info(
      `[TestScriptStore] Saved ${steps ? 'McpStep[]' : 'script'} for ` +
      `${ticketId}/${scenarioId} (status=${status}, hash=${selectorHash ?? 'none'})`,
    );
  }

  /**
   * Load a saved script by ticket + scenario.
   * Returns null if no script has been saved yet.
   */
  static async load(
    pool: Pool,
    ticketId: string,
    scenarioId: string,
  ): Promise<SavedScript | null> {
    const { rows } = await pool.query(
      `SELECT
         id,
         ticket_id     AS "ticketId",
         scenario_id   AS "scenarioId",
         scenario_name AS "scenarioName",
         module_name   AS "moduleName",
         script,
         steps,
         selector_hash AS "selectorHash",
         status,
         run_count     AS "runCount",
         pass_count    AS "passCount",
         last_run_at   AS "lastRunAt",
         last_pass_at  AS "lastPassAt",
         created_at    AS "createdAt"
       FROM test_scripts
       WHERE ticket_id = $1 AND scenario_id = $2
       LIMIT 1`,
      [ticketId, scenarioId],
    );
    if (!rows[0]) return null;
    return this.mapRow(rows[0]);
  }

  /**
   * Load all saved scripts for a ticket (all scenarios).
   */
  static async loadAllForTicket(pool: Pool, ticketId: string): Promise<SavedScript[]> {
    const { rows } = await pool.query(
      `SELECT
         id, ticket_id AS "ticketId", scenario_id AS "scenarioId",
         scenario_name AS "scenarioName", module_name AS "moduleName",
         script, steps, selector_hash AS "selectorHash",
         status, run_count AS "runCount", pass_count AS "passCount",
         last_run_at AS "lastRunAt", last_pass_at AS "lastPassAt",
         created_at AS "createdAt"
       FROM test_scripts
       WHERE ticket_id = $1
       ORDER BY scenario_id`,
      [ticketId],
    );
    return rows.map(r => this.mapRow(r));
  }

  /**
   * Load all saved PASS scripts for a module (for sprint regression).
   */
  static async loadPassingForModule(pool: Pool, moduleName: string): Promise<SavedScript[]> {
    const { rows } = await pool.query(
      `SELECT
         id, ticket_id AS "ticketId", scenario_id AS "scenarioId",
         scenario_name AS "scenarioName", module_name AS "moduleName",
         script, steps, selector_hash AS "selectorHash",
         status, run_count AS "runCount", pass_count AS "passCount",
         last_run_at AS "lastRunAt", last_pass_at AS "lastPassAt",
         created_at AS "createdAt"
       FROM test_scripts
       WHERE module_name = $1 AND status = 'PASS'
       ORDER BY last_run_at DESC`,
      [moduleName],
    );
    return rows.map(r => this.mapRow(r));
  }

  /**
   * Update the status of an existing script after re-execution.
   * Increments run_count and refreshes last_run_at / last_pass_at.
   */
  static async recordOutcome(pool: Pool, input: RecordOutcomeInput): Promise<void> {
    const { ticketId, scenarioId, status } = input;

    // Explicit ::text casts prevent PostgreSQL "inconsistent types deduced for
    // parameter $3" when the same placeholder is used in CASE conditions and SET.
    const isPass = status === 'PASS';
    const { rowCount } = await pool.query(
      `UPDATE test_scripts
       SET status       = $3::text,
           run_count    = run_count + 1,
           pass_count   = pass_count + $4::int,
           last_run_at  = NOW(),
           last_pass_at = CASE WHEN $4::int = 1 THEN NOW() ELSE last_pass_at END
       WHERE ticket_id = $1 AND scenario_id = $2`,
      [ticketId, scenarioId, status, isPass ? 1 : 0],
    );

    if (!rowCount) {
      appLogger.warn(`[TestScriptStore] recordOutcome: no row found for ${ticketId}/${scenarioId}`);
      return;
    }

    appLogger.info(`[TestScriptStore] Outcome recorded for ${ticketId}/${scenarioId}: ${status}`);
  }

  /**
   * Detect UI drift.
   * Returns true if the live snapshot hash differs from the saved one.
   * Returns false if no saved script exists, or hashes match.
   */
  static async hasUiChanged(
    pool: Pool,
    ticketId: string,
    scenarioId: string,
    liveHash: string,
  ): Promise<boolean> {
    const saved = await this.load(pool, ticketId, scenarioId);
    if (!saved || !saved.selectorHash) return false;
    const changed = saved.selectorHash !== liveHash;
    if (changed) {
      appLogger.info(
        `[TestScriptStore] UI drift detected for ${ticketId}/${scenarioId}: ` +
        `saved=${saved.selectorHash} live=${liveHash}`,
      );
    }
    return changed;
  }

  /**
   * Delete a script (e.g. when re-generation succeeds after UI drift).
   */
  static async delete(pool: Pool, ticketId: string, scenarioId: string): Promise<void> {
    await pool.query(
      'DELETE FROM test_scripts WHERE ticket_id = $1 AND scenario_id = $2',
      [ticketId, scenarioId],
    );
    appLogger.info(`[TestScriptStore] Deleted script for ${ticketId}/${scenarioId}`);
  }

  /**
   * Summary stats for the Script Library UI panel.
   */
  static async getStats(pool: Pool): Promise<{
    total: number;
    passing: number;
    failing: number;
    withMcpSteps: number;
    modules: string[];
  }> {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int                                                   AS total,
        SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END)::int          AS passing,
        SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END)::int          AS failing,
        SUM(CASE WHEN steps IS NOT NULL THEN 1 ELSE 0 END)::int        AS "withMcpSteps",
        ARRAY_AGG(DISTINCT module_name) FILTER (WHERE module_name IS NOT NULL) AS modules
      FROM test_scripts
    `);
    const row = rows[0] ?? {};
    return {
      total:        row.total        ?? 0,
      passing:      row.passing      ?? 0,
      failing:      row.failing      ?? 0,
      withMcpSteps: row.withMcpSteps ?? 0,
      modules:      row.modules      ?? [],
    };
  }

  /**
   * Paginated list for the Script Library UI panel.
   */
  static async list(
    pool: Pool,
    opts: { limit?: number; offset?: number; module?: string; status?: string } = {},
  ): Promise<{ rows: SavedScript[]; total: number }> {
    const { limit = 20, offset = 0, module: mod, status } = opts;

    const where: string[] = [];
    const params: unknown[] = [];

    if (mod) {
      params.push(mod);
      where.push(`module_name = $${params.length}`);
    }
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [countRes, rowsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM test_scripts ${whereClause}`, params),
      pool.query(
        `SELECT
           id, ticket_id AS "ticketId", scenario_id AS "scenarioId",
           scenario_name AS "scenarioName", module_name AS "moduleName",
           script, steps, selector_hash AS "selectorHash",
           status, run_count AS "runCount", pass_count AS "passCount",
           last_run_at AS "lastRunAt", last_pass_at AS "lastPassAt",
           created_at AS "createdAt"
         FROM test_scripts ${whereClause}
         ORDER BY last_run_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);

    return {
      rows:  rowsRes.rows.map(r => this.mapRow(r)),
      total: countRes.rows[0]?.total ?? 0,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private static mapRow(row: any): SavedScript {
    // Parse steps from JSONB (pg returns it as parsed object already)
    let steps: McpStep[] | null = null;
    if (row.steps) {
      const raw = typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps;
      const parsed = McpStepSchema.array().safeParse(raw);
      steps = parsed.success ? parsed.data : null;
      if (!parsed.success) {
        appLogger.warn(`[TestScriptStore] Stored steps for ${row.ticketId}/${row.scenarioId} failed Zod validation — returning null`);
      }
    }

    return {
      id:           row.id,
      ticketId:     row.ticketId,
      scenarioId:   row.scenarioId,
      scenarioName: row.scenarioName ?? null,
      moduleName:   row.moduleName   ?? null,
      script:       row.script       ?? null,
      steps,
      selectorHash: row.selectorHash ?? null,
      status:       row.status,
      runCount:     row.runCount     ?? 0,
      passCount:    row.passCount    ?? 0,
      lastRunAt:    row.lastRunAt,
      lastPassAt:   row.lastPassAt   ?? null,
      createdAt:    row.createdAt,
    };
  }
}
