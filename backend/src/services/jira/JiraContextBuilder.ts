/**
 * JiraContextBuilder
 *
 * Fetches a Jira ticket's full context:
 *   - Base ticket: summary, description, issue type, status, labels, components
 *   - Linked tickets (1 level deep): summary, type, status, platform detection
 *   - Attachment metadata (AI summaries added later by AttachmentAnalyzer)
 *
 * Results are cached in `jira_context_cache` (DB, TTL 30 min) to avoid
 * redundant Jira API calls within the same test generation session.
 *
 * Usage:
 *   const ctx = await JiraContextBuilder.build('ATT-15', pool);
 */

import { Pool } from 'pg';
import { getJiraAxios } from '../../utils/jiraAxios';
import {
    JiraTicketContext,
    LinkedTicketSummary,
    AttachmentSummary,
    Platform,
} from '../../types/jira-context.types';
import { appLogger } from '../../utils/logger';

const DONE_STATUSES = new Set(['done', 'closed', 'resolved', 'complete', 'fixed', 'released']);

export class JiraContextBuilder {
    // ──────────────────────────────────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * Build rich context for a ticket, with 30-min DB cache.
     * Falls back to live fetch if cache is missing or expired.
     */
    static async build(ticketId: string, pool: Pool): Promise<JiraTicketContext> {
        const cached = await this.loadFromCache(ticketId, pool);
        if (cached) {
            appLogger.info(`[JiraContextBuilder] Cache hit for ${ticketId}`);
            return cached;
        }

        appLogger.info(`[JiraContextBuilder] Fetching context for ${ticketId} from Jira`);
        const context = await this.fetchFromJira(ticketId);
        await this.saveToCache(ticketId, context, pool);
        return context;
    }

    /**
     * Invalidate the cached context for a ticket (call after ticket update webhooks).
     */
    static async invalidate(ticketId: string, pool: Pool): Promise<void> {
        try {
            await pool.query('DELETE FROM jira_context_cache WHERE ticket_id = $1', [ticketId]);
        } catch {
            // Non-critical
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Platform detection (also used by TicketClassifier)
    // ──────────────────────────────────────────────────────────────────────────

    static detectPlatform(labels: string[], components: string[], summary: string): Platform {
        const text = [...labels, ...components, summary].join(' ').toLowerCase();
        const isWeb    = /\bweb\b|\bui\b|\bfrontend\b|\bangular\b|\breact\b/.test(text);
        const isMobile = /\bmobile\b|\bandroid\b|\bios\b|\bflutter\b|\bapp\b/.test(text);
        const isApi    = /\bapi\b|\bbackend\b|\brest\b|\bendpoint\b/.test(text);

        if ((isWeb || !isMobile) && isMobile) return 'mixed';   // web + mobile
        if (isWeb && isApi) return 'web';                        // web + api → still web scope
        if (isMobile) return 'mobile';
        if (isApi) return 'api';
        return 'web'; // default
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private — Jira fetch
    // ──────────────────────────────────────────────────────────────────────────

    private static async fetchFromJira(ticketId: string): Promise<JiraTicketContext> {
        const jiraAxios = getJiraAxios();

        const response = await jiraAxios.get(`/rest/api/3/issue/${ticketId}`, {
            params: {
                fields: 'summary,description,issuetype,status,labels,components,issuelinks,attachment',
            },
        });

        const fields = response.data.fields;

        const description = this.extractText(fields.description);
        const labels: string[] = (fields.labels || []) as string[];
        const components: string[] = (fields.components || []).map((c: any) => String(c.name || ''));

        const attachments: AttachmentSummary[] = (fields.attachment || []).map((att: any): AttachmentSummary => ({
            filename: att.filename || '',
            mimeType: att.mimeType || 'application/octet-stream',
            size: att.size || 0,
            url: att.content || att.self || '',
        }));

        // Fetch linked tickets in parallel (1 level deep)
        const linkedTickets = await this.fetchLinkedTickets(fields.issuelinks || []);

        return {
            ticketId,
            summary: fields.summary || '',
            description,
            issueType: fields.issuetype?.name || 'Unknown',
            status: fields.status?.name || 'Unknown',
            labels,
            components,
            linkedTickets,
            attachments,
            cachedAt: new Date().toISOString(),
        };
    }

    private static async fetchLinkedTickets(issueLinks: any[]): Promise<LinkedTicketSummary[]> {
        const jiraAxios = getJiraAxios();

        const fetches = issueLinks
            .filter(link => link.inwardIssue || link.outwardIssue)
            .map(async (link): Promise<LinkedTicketSummary | null> => {
                const issue = link.outwardIssue || link.inwardIssue;
                if (!issue?.key) return null;

                try {
                    const resp = await jiraAxios.get(`/rest/api/3/issue/${issue.key}`, {
                        params: { fields: 'summary,issuetype,status,labels,components' },
                    });
                    const f = resp.data.fields;
                    const lbls: string[] = (f.labels || []) as string[];
                    const comps: string[] = (f.components || []).map((c: any) => String(c.name || ''));
                    const platform = this.detectPlatform(lbls, comps, f.summary || '');
                    const statusName = String(f.status?.name || 'Unknown');

                    return {
                        key: issue.key,
                        summary: String(f.summary || ''),
                        issueType: String(f.issuetype?.name || 'Unknown'),
                        status: statusName,
                        platform,
                        isComplete: DONE_STATUSES.has(statusName.toLowerCase()),
                    };
                } catch {
                    // Return minimal info if detail fetch fails
                    const statusName = String(issue.fields?.status?.name || 'Unknown');
                    return {
                        key: issue.key,
                        summary: String(issue.fields?.summary || ''),
                        issueType: String(issue.fields?.issuetype?.name || 'Unknown'),
                        status: statusName,
                        isComplete: DONE_STATUSES.has(statusName.toLowerCase()),
                    };
                }
            });

        const settled = await Promise.allSettled(fetches);
        return settled
            .filter((r): r is PromiseFulfilledResult<LinkedTicketSummary> =>
                r.status === 'fulfilled' && r.value !== null)
            .map(r => r.value);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private — ADF text extraction
    // ──────────────────────────────────────────────────────────────────────────

    private static extractText(adf: any): string {
        if (!adf) return '';
        if (typeof adf === 'string') return adf;

        const parts: string[] = [];
        const walk = (node: any): void => {
            if (!node) return;
            if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text);
            if (Array.isArray(node.content)) node.content.forEach(walk);
        };
        walk(adf);
        return parts.join(' ');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Private — DB cache
    // ──────────────────────────────────────────────────────────────────────────

    private static async loadFromCache(ticketId: string, pool: Pool): Promise<JiraTicketContext | null> {
        try {
            const { rows } = await pool.query<{ context: JiraTicketContext }>(
                `SELECT context FROM jira_context_cache
                 WHERE ticket_id = $1 AND expires_at > NOW()`,
                [ticketId],
            );
            return rows.length > 0 ? rows[0].context : null;
        } catch {
            // Table may not exist before migration v28 — treat as cache miss
            return null;
        }
    }

    private static async saveToCache(ticketId: string, context: JiraTicketContext, pool: Pool): Promise<void> {
        try {
            await pool.query(
                `INSERT INTO jira_context_cache (ticket_id, context, expires_at)
                 VALUES ($1, $2::jsonb, NOW() + INTERVAL '30 minutes')
                 ON CONFLICT (ticket_id)
                 DO UPDATE SET
                     context    = EXCLUDED.context,
                     expires_at = EXCLUDED.expires_at,
                     cached_at  = NOW()`,
                [ticketId, JSON.stringify(context)],
            );
        } catch {
            // Non-critical — a cache miss on the next request is acceptable
        }
    }
}
