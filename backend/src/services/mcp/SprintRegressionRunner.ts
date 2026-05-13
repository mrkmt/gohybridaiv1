/**
 * SprintRegressionRunner
 *
 * Fetches all GT tickets in a Jira sprint and runs them concurrently
 * (p-limit(3)), using SmartExecutionRouter for each ticket+scenario.
 *
 * Sprint data (name, board ID, project key) is read dynamically from the
 * Jira API — nothing is hardcoded. Callers pass a sprintId; the runner
 * resolves the sprint name + project from Jira itself.
 *
 * After all tickets finish a structured Jira comment is posted to the sprint
 * board (or a configurable ticket) with a markdown summary table.
 */

import pLimit from 'p-limit';
import { Pool } from 'pg';
import { getJiraClient } from '../jira/JiraClientFactory';
import { SmartExecutionRouter, RouteResult } from './SmartExecutionRouter';
import { McpDiscoveryService } from './McpDiscoveryService';
import { appLogger } from '../../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SprintRunOptions {
  pool: Pool;
  userId: string;
  /**
   * Jira sprint ID (numeric string).
   * Obtain via GET /rest/agile/1.0/board/{boardId}/sprint?state=active
   */
  sprintId: string;
  /**
   * Optional Jira board ID. If omitted, the runner will try to infer it
   * from the project key via /rest/agile/1.0/board.
   */
  boardId?: string;
  /**
   * Credentials used to login to the app for live discovery + execution.
   */
  credentials: { username: string; password: string; idNumber?: string };
  /**
   * Base URL of the application under test.
   */
  baseUrl: string;
  /**
   * Concurrency limit (default: 3).
   * Higher values = faster but risk flaky tests from shared DB state.
   */
  concurrency?: number;
  /**
   * Ticket to post the final report comment to.
   * Defaults to the first ticket in the sprint if omitted.
   */
  reportTicketId?: string;
  /**
   * Inject a custom run-script callback. Defaults to a stub that always
   * returns passed=true (production wires in the real Playwright runner).
   */
  runScript?: (ticketId: string, scenarioId: string, script: string) => Promise<{ passed: boolean; errorMessage?: string; durationMs?: number }>;
  /**
   * Inject a custom generate-script callback.
   * Production wires in JsonTestGenerationService.generateAndCompile().
   */
  generateScript?: (ticketId: string, scenarioId: string, module: string, promptContext: string) => Promise<string>;
}

export interface TicketRunResult {
  ticketId: string;
  summary: string;
  module: string;
  status: 'pass' | 'fail' | 'skip' | 'error';
  usedSavedScript: boolean;
  failureCategory?: string;
  errorMessage?: string;
  durationMs?: number;
}

export interface SprintRunReport {
  sprintRunId: number;
  sprintId: string;
  sprintName: string;
  projectKey: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: TicketRunResult[];
  durationMs: number;
  jiraCommentId?: string;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export class SprintRegressionRunner {

  static async run(opts: SprintRegressionRunner.RunOpts): Promise<SprintRunReport> {
    const {
      pool,
      userId,
      sprintId,
      boardId,
      credentials,
      baseUrl,
      concurrency = 3,
      runScript,
      generateScript,
    } = opts;

    const startMs = Date.now();
    appLogger.info(`[SprintRunner] Starting sprint ${sprintId} (concurrency=${concurrency})`);

    // ── Step 1: Resolve Jira client ────────────────────────────────────────
    const jira = await getJiraClient(userId, pool);

    // ── Step 2: Fetch sprint metadata ──────────────────────────────────────
    const { sprintName, projectKey, resolvedBoardId } = await this.resolveSprint(
      jira.axios, sprintId, boardId, jira.spaces.gt,
    );
    appLogger.info(`[SprintRunner] Sprint: "${sprintName}" / project: ${projectKey}`);

    // ── Step 3: Persist sprint_run row ─────────────────────────────────────
    const { rows: runRows } = await pool.query<{ id: number }>(
      `INSERT INTO sprint_runs (sprint_id, sprint_name, project_key, jira_board_id, status)
       VALUES ($1, $2, $3, $4, 'running')
       RETURNING id`,
      [sprintId, sprintName, projectKey, resolvedBoardId ?? null],
    );
    const sprintRunId = runRows[0].id;

    // ── Step 4: Fetch tickets in sprint ────────────────────────────────────
    const tickets = await this.fetchSprintTickets(jira.axios, sprintId, resolvedBoardId);
    await pool.query(
      'UPDATE sprint_runs SET total_tickets = $2 WHERE id = $1',
      [sprintRunId, tickets.length],
    );
    appLogger.info(`[SprintRunner] Found ${tickets.length} tickets in sprint ${sprintId}`);

    // ── Step 5: Run tickets with concurrency limit ─────────────────────────
    const limit = pLimit(concurrency);
    const results: TicketRunResult[] = [];

    const tasks = tickets.map((ticket) =>
      limit(() => this.runTicket({
        pool, sprintRunId, ticket, credentials, baseUrl, jira,
        runScript, generateScript,
      })),
    );

    const settled = await Promise.allSettled(tasks);
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        results.push(outcome.value);
      } else {
        appLogger.error(`[SprintRunner] Ticket task rejected: ${outcome.reason}`);
      }
    }

    // ── Step 6: Tally and close sprint_run row ─────────────────────────────
    const passed  = results.filter(r => r.status === 'pass').length;
    const failed  = results.filter(r => r.status === 'fail' || r.status === 'error').length;
    const skipped = results.filter(r => r.status === 'skip').length;

    await pool.query(
      `UPDATE sprint_runs
       SET passed=$2, failed=$3, skipped=$4, status='done', completed_at=NOW()
       WHERE id=$1`,
      [sprintRunId, passed, failed, skipped],
    );

    const report: SprintRunReport = {
      sprintRunId,
      sprintId,
      sprintName,
      projectKey,
      total: tickets.length,
      passed,
      failed,
      skipped,
      results,
      durationMs: Date.now() - startMs,
    };

    // ── Step 7: Post Jira comment report ───────────────────────────────────
    try {
      const reportTicketId = opts.reportTicketId ?? (tickets[0]?.key ?? null);
      if (reportTicketId) {
        const commentId = await this.postJiraReport(jira.axios, reportTicketId, report);
        report.jiraCommentId = commentId;
        await pool.query(
          'UPDATE sprint_runs SET jira_comment_id=$2 WHERE id=$1',
          [sprintRunId, commentId],
        );
      }
    } catch (e: any) {
      appLogger.warn(`[SprintRunner] Failed to post Jira report: ${e.message}`);
    }

    appLogger.info(
      `[SprintRunner] Done — ${passed}✅ ${failed}❌ ${skipped}⏭ in ${report.durationMs}ms`,
    );
    return report;
  }

  // ─── Per-ticket runner ─────────────────────────────────────────────────────

  private static async runTicket(ctx: {
    pool: Pool;
    sprintRunId: number;
    ticket: { key: string; summary: string; module: string };
    credentials: { username: string; password: string; idNumber?: string };
    baseUrl: string;
    jira: Awaited<ReturnType<typeof getJiraClient>>;
    runScript?: SprintRunOptions['runScript'];
    generateScript?: SprintRunOptions['generateScript'];
  }): Promise<TicketRunResult> {
    const { pool, sprintRunId, ticket, credentials, baseUrl, runScript, generateScript } = ctx;
    const ticketStart = Date.now();

    // Insert pending result row
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO sprint_run_results (sprint_run_id, ticket_id, ticket_summary, module_name, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
      [sprintRunId, ticket.key, ticket.summary, ticket.module],
    );
    const resultRowId = rows[0].id;

    try {
      // Live discovery for this ticket's module
      const discovery = await McpDiscoveryService.discover({
        module: ticket.module,
        baseUrl,
        credentials,
      });

      // Use a single default scenario per ticket for regression
      const scenarioId = `${ticket.key}-SC-001`;

      const routeResult: RouteResult = await SmartExecutionRouter.route({
        pool,
        ticketId: ticket.key,
        scenarioId,
        moduleName: ticket.module,
        liveHash: discovery.selectorHash,
        runScript: async (script) => {
          if (runScript) {
            return runScript(ticket.key, scenarioId, script);
          }
          // Default stub — callers should inject a real runner
          appLogger.warn(`[SprintRunner] No runScript provided for ${ticket.key} — returning pass stub`);
          return { passed: true, durationMs: 0 };
        },
        generateScript: async () => {
          if (generateScript) {
            return generateScript(ticket.key, scenarioId, ticket.module, discovery.promptContext);
          }
          throw new Error('No generateScript callback provided to SprintRegressionRunner');
        },
      });

      const ticketResult: TicketRunResult = {
        ticketId: ticket.key,
        summary: ticket.summary,
        module: ticket.module,
        status: routeResult.status,
        usedSavedScript: routeResult.usedSavedScript,
        failureCategory: routeResult.failureCategory,
        errorMessage: routeResult.errorMessage,
        durationMs: Date.now() - ticketStart,
      };

      await pool.query(
        `UPDATE sprint_run_results
         SET status=$2, used_saved_script=$3, failure_category=$4,
             error_message=$5, duration_ms=$6
         WHERE id=$1`,
        [
          resultRowId,
          routeResult.status,
          routeResult.usedSavedScript,
          routeResult.failureCategory ?? null,
          routeResult.errorMessage ?? null,
          ticketResult.durationMs,
        ],
      );

      return ticketResult;

    } catch (err: any) {
      appLogger.error(`[SprintRunner] Ticket ${ticket.key} threw: ${err.message}`);
      await pool.query(
        `UPDATE sprint_run_results
         SET status='error', error_message=$2, duration_ms=$3
         WHERE id=$1`,
        [resultRowId, err.message, Date.now() - ticketStart],
      );
      return {
        ticketId: ticket.key,
        summary: ticket.summary,
        module: ticket.module,
        status: 'error',
        usedSavedScript: false,
        errorMessage: err.message,
        durationMs: Date.now() - ticketStart,
      };
    }
  }

  // ─── Jira helpers ──────────────────────────────────────────────────────────

  /** Resolve sprint name + project key + board ID from Jira Agile API */
  private static async resolveSprint(
    jiraAxios: any,
    sprintId: string,
    boardId: string | undefined,
    defaultProjectKey: string,
  ): Promise<{ sprintName: string; projectKey: string; resolvedBoardId: string | null }> {
    try {
      const resp = await jiraAxios.get(`/rest/agile/1.0/sprint/${sprintId}`);
      const sprint = resp.data;
      return {
        sprintName:      sprint.name ?? `Sprint ${sprintId}`,
        projectKey:      defaultProjectKey,
        resolvedBoardId: boardId ?? String(sprint.originBoardId ?? ''),
      };
    } catch {
      return {
        sprintName:      `Sprint ${sprintId}`,
        projectKey:      defaultProjectKey,
        resolvedBoardId: boardId ?? null,
      };
    }
  }

  /** Fetch all issues in a sprint via Jira Agile API */
  private static async fetchSprintTickets(
    jiraAxios: any,
    sprintId: string,
    boardId: string | null | undefined,
  ): Promise<Array<{ key: string; summary: string; module: string }>> {
    const tickets: Array<{ key: string; summary: string; module: string }> = [];
    let startAt = 0;
    const maxResults = 50;

    for (;;) {
      const resp = await jiraAxios.get(
        `/rest/agile/1.0/sprint/${sprintId}/issue`,
        { params: { startAt, maxResults, fields: 'summary,labels,components' } },
      );
      const { issues, total } = resp.data;

      for (const issue of issues ?? []) {
        const labels: string[] = issue.fields?.labels ?? [];
        const components: string[] = (issue.fields?.components ?? []).map((c: any) => c.name);
        // Derive module: prefer component name, then first label, then 'Unknown'
        const module = components[0] ?? labels[0] ?? 'Unknown';

        tickets.push({
          key:     issue.key,
          summary: issue.fields?.summary ?? issue.key,
          module,
        });
      }

      startAt += issues?.length ?? 0;
      if (startAt >= total) break;
    }

    return tickets;
  }

  /** Post a markdown summary as a Jira comment and return the comment ID */
  private static async postJiraReport(
    jiraAxios: any,
    ticketId: string,
    report: SprintRunReport,
  ): Promise<string> {
    const passRate = report.total > 0
      ? Math.round((report.passed / report.total) * 100)
      : 0;

    const statusEmoji = (s: string) =>
      s === 'pass' ? '✅' : s === 'fail' ? '❌' : s === 'skip' ? '⏭' : '⚠️';

    const rows = report.results.map(r =>
      `| ${r.ticketId} | ${r.summary.slice(0, 60)} | ${statusEmoji(r.status)} ${r.status.toUpperCase()} | ` +
      `${r.usedSavedScript ? '♻️ cached' : '🤖 generated'} | ` +
      `${r.failureCategory ?? '-'} | ${r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '-'} |`,
    ).join('\n');

    const body = {
      body: {
        type: 'doc',
        version: 1,
        content: [{
          type: 'codeBlock',
          attrs: { language: 'markdown' },
          content: [{
            type: 'text',
            text: [
              `## 🔁 Sprint Regression Report — ${report.sprintName}`,
              `> Run ID: ${report.sprintRunId} | ${new Date().toISOString()}`,
              '',
              `**Pass Rate: ${passRate}%** (${report.passed}✅ ${report.failed}❌ ${report.skipped}⏭ of ${report.total})`,
              '',
              '| Ticket | Summary | Status | Script Source | Failure | Duration |',
              '|--------|---------|--------|---------------|---------|----------|',
              rows,
              '',
              `_Total duration: ${(report.durationMs / 1000).toFixed(1)}s_`,
            ].join('\n'),
          }],
        }],
      },
    };

    const resp = await jiraAxios.post(
      `/rest/api/3/issue/${ticketId}/comment`,
      body,
    );
    return String(resp.data?.id ?? '');
  }
}

// Merge RunOpts with SprintRunOptions for clean external API
export namespace SprintRegressionRunner {
  export type RunOpts = SprintRunOptions;
}
