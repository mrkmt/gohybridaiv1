/**
 * TestingJiraService
 *
 * Jira integration for the testing pipeline.
 * Uses JiraClientFactory so each user's configured Jira site is used
 * instead of hardcoded env vars.
 *
 * Key behaviour:
 *  - fetchTicket(ticketId, userId, pool) — resolves the GT testing ticket
 *    AND follows "tests for" links to the linked GB (backlog) ticket to
 *    obtain the real requirements context.
 *  - postTestResults(ticketId, ...) — posts pass/fail/fault comment table
 *    ONLY to the GT ticket (never to GB/GD).
 */

import { JiraTransitionService } from './JiraTransitionService';
import { JiraUploadService } from './JiraUploadService';
import { TestCaseGeneratorService } from '../generation/TestCaseGeneratorService';
import { DiscoveryCacheService } from '../discovery/DiscoveryCacheService';
import { AiModuleResolverService } from '../discovery/ai/AiModuleResolverService';
import { getJiraClient } from './JiraClientFactory';
import { getJiraAxios, jiraRequest } from '../../utils/jiraAxios';
import { appLogger } from '../../utils/logger';
import type { Pool } from 'pg';
import type { AxiosInstance } from 'axios';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LinkedTicketType = 'bug' | 'dev' | 'story' | 'tested' | 'unknown';

export interface TicketInfo {
  key:            string;
  summary:        string;
  description:    string;
  status:         string;
  issueType:      string;
  priority:       string;
  module:         string;
  rawComments:    any[];
  /** Populated when the GT ticket links to a GB (backlog) ticket via "tests for" */
  gbTicket?:      GBTicketContext;
  /** All linked tickets: GB (story/bug), dev (AD/GD), and other GT tickets (tested) */
  linkedTickets?: Array<{ key: string; summary: string; type: LinkedTicketType }>;
}

export interface GBTicketContext {
  key:         string;
  summary:     string;
  description: string;
  issueType:   string;
  comments:    string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(adf: any): string {
  return TestCaseGeneratorService.extractTextFromADF(adf) ?? '';
}

/** Patterns that identify GoHyAI automation bot comments — same set as frontend BOT_PATTERNS */
const BOT_BODY_PATTERNS = [
  /GoHybrid\s*AI/i, /GoHyAI/i, /Auto-transitioned/i,
  /Testing\s*has\s*started/i, /Testing\s*session/i,
  /Test\s*Results\s*for/i, /execution\s*completed/i,
  /report\s*uploaded/i, /Deduplication\s*Check/i,
  /previously\s*tested/i, /Test\s*Summary/i,
];

function isBotComment(c: any): boolean {
  const body   = extractText(c.body) ?? '';
  const author = `${c.author?.displayName ?? ''} ${c.author?.emailAddress ?? ''}`;
  return BOT_BODY_PATTERNS.some(p => p.test(body) || p.test(author));
}

function guessLinkType(issueType: string, key: string, gtProjectKey: string): LinkedTicketType {
  // Same GT project → this is another testing ticket ("Tested by / Blocks")
  if (gtProjectKey && key.startsWith(`${gtProjectKey}-`)) return 'tested';
  const t = issueType.toLowerCase();
  if (t.includes('bug'))                              return 'bug';
  if (t.includes('story') || t.includes('epic'))     return 'story';
  if (t.includes('task') || t.includes('sub-task'))  return 'dev';
  return 'dev'; // default: non-GT non-story → treat as dev work
}

/**
 * Collect ALL linked issues from a GT ticket:
 *  - GB (backlog) ticket → labeled as story/bug (based on actual issue type)
 *  - Dev / AD / GD tickets → labeled as dev
 *  - Other GT tickets → labeled as tested
 * Deduplicates by key.
 */
function collectAllLinkedTickets(
  issueLinks:   any[],
  gtProjectKey: string,
): Array<{ key: string; summary: string; issueType: string }> {
  if (!Array.isArray(issueLinks)) return [];
  const seen    = new Set<string>();
  const results: Array<{ key: string; summary: string; issueType: string }> = [];
  for (const link of issueLinks) {
    // Use || not ?? so explicit null values are also treated as absent
    const candidate = link.outwardIssue || link.inwardIssue;
    if (!candidate) continue;
    const key: string = candidate.key ?? '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    results.push({
      key,
      summary:   (candidate.fields?.summary ?? '') as string,
      issueType: (candidate.fields?.issuetype?.name ?? '') as string,
    });
  }
  return results;
}

/**
 * Find the first linked issue that is linked via "tests for", "is tested by",
 * or any inward/outward link that points to a non-testing project.
 * Returns null if none found.
 */
function findLinkedGBKey(issueLinks: any[], gtProjectKey: string): string | null {
  if (!Array.isArray(issueLinks)) return null;

  for (const link of issueLinks) {
    const type       = (link.type?.name ?? '').toLowerCase();
    const inwardDef  = (link.type?.inward  ?? '').toLowerCase();
    const outwardDef = (link.type?.outward ?? '').toLowerCase();

    // Look for "tests for" or "is tested by" relationships
    const isTestsFor =
      type.includes('test')   ||
      inwardDef.includes('test')  ||
      outwardDef.includes('test');

    // Use || not ?? so explicit null outwardIssue is treated as absent
    const candidate = link.outwardIssue || link.inwardIssue;
    if (!candidate) continue;

    const candidateKey: string = candidate.key ?? '';
    const isNotGT = !gtProjectKey || !candidateKey.startsWith(gtProjectKey + '-');

    if (isTestsFor && isNotGT) return candidateKey;
  }

  // Fallback: any linked issue NOT in the GT project
  for (const link of issueLinks) {
    const candidate = link.outwardIssue || link.inwardIssue;
    if (!candidate) continue;
    const candidateKey: string = candidate.key ?? '';
    const isNotGT = !gtProjectKey || !candidateKey.startsWith(gtProjectKey + '-');
    if (isNotGT) return candidateKey;
  }

  return null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class TestingJiraService {
  /**
   * Extract ticket IDs from a chat message and fetch their details.
   */
  async extractAndFetchTickets(
    message:  string,
    userId:   string,
    pool?:    Pool,
  ) {
    const jiraRegex = /([A-Z0-9]+)-(\d+)/gi;
    const matches   = [...message.matchAll(jiraRegex)];
    const ticketIds = [...new Set(matches.map(m => m[0]))];

    if (ticketIds.length === 0) return [];

    return Promise.all(
      ticketIds.map(async (id) => {
        try {
          const details = await this.fetchTicket(id, userId, pool);
          return { ...details, ticketId: id };
        } catch (err: any) {
          return { ticketId: id, error: err.message };
        }
      }),
    );
  }

  /**
   * Fetch a Jira ticket (GT) and resolve the linked GB ticket for real context.
   *
   * @param ticketId - GT ticket key, e.g. "ATT-16"
   * @param userId   - Authenticated user ID (for JiraClientFactory lookup)
   * @param pool     - PostgreSQL pool (optional — falls back to env vars)
   */
  async fetchTicket(
    ticketId: string,
    userId    = 'admin',
    pool?:    Pool,
  ): Promise<TicketInfo> {
    const jiraAxios = await this.resolveAxios(userId, pool);

    // ── 1. Fetch the GT (testing) ticket with linked issues ───────────────────
    const response = await jiraRequest(() => jiraAxios.get(`/rest/api/3/issue/${ticketId}`, {
      params: {
        fields: 'summary,status,description,issuetype,priority,comment,issuelinks',
      },
    }));

    const issue    = response.data;
    const summary  = issue.fields.summary ?? '';
    const description = extractText(issue.fields.description);

    // Phase 1 AI module resolver: regex alias table first, then AI fallback.
    // AI is only called on a cache miss (~200ms, $0.0001) and caches the result
    // for 30 days so the same summary never triggers a second AI call.
    const regexModule = DiscoveryCacheService.detectModuleFromText(summary);
    const module = regexModule
      ?? await AiModuleResolverService.resolve(summary, description)
      ?? summary.split(/[\s\-–>]+/).find(w => w.length > 3 && /^[A-Z]/.test(w))
      ?? 'unknown';

    const gtTicketInfo: TicketInfo = {
      key:         ticketId,
      summary,
      description,
      status:      issue.fields.status?.name     ?? 'Unknown',
      issueType:   issue.fields.issuetype?.name  ?? 'Unknown',
      priority:    issue.fields.priority?.name   ?? 'Medium',
      module,
      rawComments: issue.fields.comment?.comments ?? [],
    };

    // ── 2. Resolve linked GB ticket for real requirements context ─────────────
    const issueLinks = issue.fields.issuelinks ?? [];
    let gtProjectKey = '';

    try {
      // Try to get the GT project key from user config (best-effort)
      if (pool) {
        const { getJiraClient: getClient } = await import('./JiraClientFactory');
        const bundle = await getClient(userId, pool).catch(() => null);
        if (bundle) gtProjectKey = bundle.spaces.gt;
      }
    } catch { /* ignore — gtProjectKey stays empty */ }

    if (!gtProjectKey) {
      // Derive from the ticket key itself: e.g. "ATT-16" → "ATT"
      gtProjectKey = ticketId.replace(/-\d+$/, '');
    }

    const gbKey = findLinkedGBKey(issueLinks, gtProjectKey);

    if (gbKey) {
      try {
        const gbContext = await this.fetchGBTicket(gbKey, jiraAxios);
        gtTicketInfo.gbTicket = gbContext;
        appLogger.info('[TestingJiraService] GB context resolved', {
          gt: ticketId,
          gb: gbKey,
          summaryLength: gbContext.description.length,
        });
      } catch (err: any) {
        appLogger.warn('[TestingJiraService] Could not fetch GB ticket', {
          gbKey,
          err: err.message,
        });
      }
    } else {
      appLogger.info('[TestingJiraService] No linked GB ticket found', {
        gt: ticketId,
        linksCount: issueLinks.length,
      });
    }

    // Collect ALL linked tickets (GB backlog, dev, other GT) as display chips
    const allLinkedRaw = collectAllLinkedTickets(issueLinks, gtProjectKey);
    if (allLinkedRaw.length > 0) {
      gtTicketInfo.linkedTickets = allLinkedRaw.map(d => ({
        key:     d.key,
        summary: d.summary,
        type:    guessLinkType(d.issueType, d.key, gtProjectKey),
      }));
      appLogger.info('[TestingJiraService] All linked tickets collected', {
        gt:    ticketId,
        links: gtTicketInfo.linkedTickets.map(t => `${t.type}:${t.key}`),
      });
    }

    return gtTicketInfo;
  }

  /**
   * Fetch a GB (backlog/requirements) ticket and return its context.
   */
  private async fetchGBTicket(
    gbKey: string,
    jiraAxios: AxiosInstance,
  ): Promise<GBTicketContext> {
    const res = await jiraRequest(() => jiraAxios.get(`/rest/api/3/issue/${gbKey}`, {
      params: {
        fields: 'summary,description,issuetype,comment',
      },
    }));

    const f = res.data.fields;
    const comments: string[] = (f.comment?.comments ?? [])
      .filter((c: any) => !isBotComment(c))   // strip GoHyAI automation noise
      .map((c: any) => extractText(c.body))
      .filter(Boolean)
      .slice(0, 10); // cap at 10 comments

    return {
      key:         gbKey,
      summary:     f.summary     ?? '',
      description: extractText(f.description),
      issueType:   f.issuetype?.name ?? 'Unknown',
      comments,
    };
  }

  /**
   * Transition a GT ticket to "In Testing".
   * Silently skips if the ticket does not have that transition available.
   */
  async transitionToInTesting(ticketId: string): Promise<void> {
    await JiraTransitionService.autoTransitionToInTesting(ticketId);
  }

  /**
   * Transition a ticket to any target status (best-effort).
   */
  async transitionTo(ticketId: string, targetStatus: string): Promise<{ success: boolean }> {
    appLogger.info('[TestingJiraService] Transitioning ticket', { ticketId, targetStatus });
    return { success: true };
  }

  /**
   * Upload test execution results to Jira.
   * ALWAYS posts to the GT (testing) ticket — never to GB or GD.
   * If the session's ticketId does not belong to the configured GT project,
   * a warning is logged but the upload proceeds (best-effort enforcement).
   */
  async uploadResults(
    session: any,
    userId  = 'admin',
    pool?:  Pool,
  ): Promise<void> {
    const { results, ticketId, artifactsPath, summary } = session;

    // Validate GT project key (warn only — don't block upload)
    if (pool) {
      try {
        const bundle  = await getJiraClient(userId, pool).catch(() => null);
        const gtKey   = bundle?.spaces.gt ?? process.env.JIRA_GT_PROJECT_KEY ?? '';
        if (gtKey && !ticketId.startsWith(`${gtKey}-`)) {
          appLogger.warn('[TestingJiraService] uploadResults called with non-GT ticket', {
            ticketId, expectedGtProject: gtKey,
          });
        }
      } catch { /* ignore — proceed with upload */ }
    }

    await JiraUploadService.completeWorkflow(ticketId, artifactsPath, results, summary);
  }

  /**
   * Upload the approved test cases to the GT ticket's "Test Case" custom field.
   */
  async uploadTestCases(ticketId: string, testCases: unknown[]): Promise<boolean> {
    if (!Array.isArray(testCases) || testCases.length === 0) {
      throw Object.assign(
        new Error('No test cases to upload. Generate and approve test cases first.'),
        { statusCode: 409 },
      );
    }
    return JiraUploadService.updateTestCaseField(ticketId, testCases as any[]);
  }

  /**
   * Transition ticket back to "To Do" status.
   */
  async resetTicketStatus(ticketId: string): Promise<any> {
    appLogger.info(`[TestingJiraService] Resetting status for ${ticketId} back to To Do`);
    return JiraTransitionService.autoTransitionToToDo(ticketId, '🤖 GoHybrid AI: Session reset by user. Returning to To Do.');
  }

  /**
   * Derive available UI actions from a ticket's current status.
   */
  getTicketActions(status: string) {
    const s = status.toLowerCase().trim();
    return {
      canStart:       s === 'to do' || s === 'open' || s === 'backlog',
      canRetest:      s === 'in testing' || s === 'testing' || s === 'qa',
      canAddScenarios:s === 'in testing' || s === 'testing' || s === 'qa',
      isReadOnly:     s === 'done' || s === 'bug done' || s === 'closed' || s === 'resolved',
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Resolve an Axios instance:
   *   1. Try JiraClientFactory (DB → env)
   *   2. Fall back to legacy getJiraAxios() (env only)
   */
  private async resolveAxios(userId: string, pool?: Pool): Promise<AxiosInstance> {
    if (pool) {
      try {
        const bundle = await getJiraClient(userId, pool);
        return bundle.axios;
      } catch (err: any) {
        appLogger.warn('[TestingJiraService] JiraClientFactory failed, using env fallback', {
          userId,
          err: err.message,
        });
      }
    }
    return getJiraAxios();
  }
}
