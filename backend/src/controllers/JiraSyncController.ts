import { Request, Response } from 'express';
import * as fs from 'fs';
import { appLogger } from '../utils/logger';
import { getJiraAxios } from '../utils/jiraAxios';
import { BusinessRulesService } from '../services/execution/BusinessRulesService';
import { DbClient } from '../services/shared/TelemetryService';

const ACTIVE_TICKETS_FILE = process.env.ACTIVE_TICKETS_CACHE_FILE;

export class JiraSyncController {
    private static pool: DbClient | null = null;

    static setPool(dbPool: DbClient): void {
        this.pool = dbPool;
    }

    /**
     * Pulls latest 'In Testing' issues from key projects (ATT, MB) and updates active_tickets DB
     * POST /api/jira/sync-active
     * P1 FIX: This is now largely a legacy method, as we use live search. 
     * We keep it as a manual trigger for those who want to seed the DB.
     */
    static async syncActiveTickets(req: Request, res: Response) {
        try {
            const { JiraService } = require('../../api/JiraService');
            const { tickets } = await JiraService.searchTickets('', 0, 100);
            
            appLogger.info(`[JiraSync] Found ${tickets.length} tickets via live search for sync`, { source: 'JiraSync' });

            const jiraDomain = process.env.JIRA_DOMAIN || '';

            if (this.pool) {
                for (const ticket of tickets) {
                    await this.pool.query(
                        `INSERT INTO active_tickets (ticket_id, summary, description, status, priority, url, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6, NOW())
                         ON CONFLICT (ticket_id) DO UPDATE SET
                             summary = EXCLUDED.summary,
                             description = EXCLUDED.description,
                             status = EXCLUDED.status,
                             priority = EXCLUDED.priority,
                             url = EXCLUDED.url,
                             updated_at = NOW()`,
                        [
                            ticket.id,
                            ticket.summary || '',
                            ticket.description || '',
                            ticket.status || 'In Testing',
                            ticket.priority || 'Medium',
                            `https://${jiraDomain}/browse/${ticket.id}`
                        ]
                    );
                }
            }

            if (res && typeof res.status === 'function') {
                res.status(200).json({
                    success: true,
                    message: `Synced ${tickets.length} active tickets to DB.`,
                    count: tickets.length
                });
            }
        } catch (err: any) {
            appLogger.error('[JiraSync] Manual sync failed', { source: 'JiraSync', error: err.message });
            if (res && typeof res.status === 'function') {
                res.status(500).json({ error: 'Failed to sync with Jira', details: err.message });
            }
        }
    }

    /**
     * Handles Jira Webhook for issue status transitions
     * POST /api/jira/webhook
     */
    static async handleWebhook(req: Request, res: Response) {
        try {
            const expectedSecret = process.env.JIRA_WEBHOOK_SECRET;
            if (expectedSecret) {
                const providedSecret = req.headers['x-webhook-secret'] as string || req.query.secret as string;
                if (!providedSecret || providedSecret !== expectedSecret) {
                    appLogger.warn('[JiraSync] Webhook rejected: invalid or missing shared secret');
                    return res.status(401).json({ error: 'Unauthorized: invalid webhook secret' });
                }
            }

            const { issue, changelog } = req.body;

            if (!issue || !issue.key) {
                return res.status(400).json({ error: 'Invalid webhook payload: issue key missing' });
            }

            const jiraId = issue.key;
            const statusChange = changelog?.items?.find((item: any) => item.field === 'status');

            if (!statusChange) {
                appLogger.info(`[JiraSync] No status change detected for ${jiraId}`);
                return res.status(200).json({ message: 'No status change' });
            }

            const newStatus = (statusChange as any).toString || (statusChange as any).to || '';
            if (!newStatus || typeof newStatus !== 'string') {
                appLogger.error(`[JiraSync] Invalid status value for ${jiraId}`, { source: 'JiraSync', statusChange: JSON.stringify(statusChange) });
                return res.status(400).json({ error: 'Invalid status value in changelog' });
            }
            appLogger.info(`[JiraSync] Ticket ${jiraId} transitioned to: ${newStatus}`);

            // Active Tickets Logic — DB primary, file fallback
            try {
                const isDone = newStatus.toLowerCase().includes('done') || newStatus.toLowerCase().includes('closed');

                if (this.pool) {
                    if (isDone) {
                        await this.pool.query(
                            'DELETE FROM active_tickets WHERE ticket_id = $1',
                            [jiraId]
                        );
                        appLogger.info(`[JiraSync] Removed ${jiraId} from active list`, { source: 'JiraSync', jiraId, status: newStatus });
                    } else {
                        const jiraDomain = process.env.JIRA_DOMAIN || '';
                        await this.pool.query(
                            `INSERT INTO active_tickets (ticket_id, summary, description, status, priority, url, updated_at)
                             VALUES ($1, $2, $3, $4, $5, $6, NOW())
                             ON CONFLICT (ticket_id) DO UPDATE SET
                                 summary = EXCLUDED.summary,
                                 status = EXCLUDED.status,
                                 priority = EXCLUDED.priority,
                                 url = EXCLUDED.url,
                                 updated_at = NOW()`,
                            [
                                jiraId,
                                issue.fields?.summary || `Auto-synced ${jiraId}`,
                                issue.fields?.description || '',
                                newStatus,
                                issue.fields?.priority?.name || 'Medium',
                                `https://${jiraDomain}/browse/${jiraId}`
                            ]
                        );
                        appLogger.info(`[JiraSync] Updated active tickets DB for ${jiraId}`);
                    }
                }
            } catch (err: any) {
                appLogger.error('[JiraSync] Failed to update active tickets store', { source: 'JiraSync', error: err.message });
            }

            // Update Business Logic Matrix in PostgreSQL
            let matrixUpdated = false;

            if (this.pool) {
                const result = await this.pool.query(
                    `SELECT id FROM business_rules WHERE jira_id = $1 OR id LIKE $2`,
                    [jiraId, `%${jiraId}%`]
                );

                for (const row of result.rows) {
                    await BusinessRulesService.updateStatus(this.pool, row.id, newStatus);
                    matrixUpdated = true;
                }

                if (matrixUpdated) {
                    appLogger.info(`[JiraSync] Updated status in business_rules table for ${jiraId}`);
                }
            }

            res.status(200).json({
                success: true,
                jiraId,
                newStatus,
                matrixUpdated
            });
        } catch (err: any) {
            appLogger.error('[JiraSync] Webhook processing failed', { source: 'JiraSync', error: err.message });
            res.status(500).json({ error: 'Internal server error', details: err.message });
        }
    }

    /**
     * GET /api/jira/active-tickets
     * P1 FIX: Support live search with pagination.
     */
    static async getActiveTickets(req: Request, res: Response) {
        const query = (req.query.query as string) || '';
        const page = parseInt(req.query.page as string || '1');
        const limit = parseInt(req.query.limit as string || '50');
        const startAt = (page - 1) * limit;

        try {
            const { JiraService } = require('../../api/JiraService');
            const { tickets, total } = await JiraService.searchTickets(query, startAt, limit);
            
            // If live search returns results, use them as primary source of truth
            if (tickets.length > 0 || query) {
                return res.status(200).json({
                    tickets,
                    total,
                    page,
                    limit,
                    source: 'live'
                });
            }

            // Fallback: Read from DB if no live results (e.g. Jira down or rate limited)
            if (this.pool) {
                const { rows } = await this.pool.query(
                    'SELECT * FROM active_tickets ORDER BY updated_at DESC LIMIT $1 OFFSET $2',
                    [limit, startAt]
                );
                const countRes = await this.pool.query('SELECT COUNT(*) FROM active_tickets');
                
                return res.status(200).json({
                    tickets: rows.map(r => ({
                        id: r.ticket_id,
                        summary: r.summary,
                        status: r.status,
                        priority: r.priority,
                        url: r.url,
                        updatedAt: r.updated_at
                    })),
                    total: parseInt(countRes.rows[0].count),
                    page,
                    limit,
                    source: 'db'
                });
            } else {
                res.status(200).json({ tickets: [], total: 0, page, limit });
            }
        } catch (err: any) {
            appLogger.error('[JiraSync] Failed to fetch active tickets', { error: err.message });
            res.status(500).json({ error: 'Failed to read active tickets' });
        }
    }

    /**
     * DELETE /api/jira/active-tickets/:id
     */
    static async removeActiveTicket(req: Request, res: Response) {
        try {
            const id = req.params.id;
            if (this.pool) {
                await this.pool.query(
                    'DELETE FROM active_tickets WHERE ticket_id = $1',
                    [id]
                );
            }
            res.status(200).json({ success: true, message: 'Ticket removed from active list' });
        } catch (err: any) {
            res.status(500).json({ error: 'Failed to delete active ticket' });
        }
    }

    /**
     * Public helper to upsert a ticket
     */
    static upsertActiveTicket(ticket: any) {
        if (!this.pool) {
            appLogger.warn('[JiraSync] DB pool not set, skipping upsertActiveTicket');
            return;
        }

        const mappedTicket = {
            id: ticket.id || ticket.key || ticket.ticketId,
            summary: ticket.summary || '',
            description: ticket.description || '',
            status: ticket.status || 'Unknown',
            priority: ticket.priority || 'Medium',
            url: ticket.url || `https://${process.env.JIRA_DOMAIN}/browse/${ticket.id || ticket.key || ticket.ticketId}`,
        };

        this.pool.query(
            `INSERT INTO active_tickets (ticket_id, summary, description, status, priority, url, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (ticket_id) DO UPDATE SET
                 summary = EXCLUDED.summary,
                 description = EXCLUDED.description,
                 status = EXCLUDED.status,
                 priority = EXCLUDED.priority,
                 url = EXCLUDED.url,
                 updated_at = NOW()`,
            [
                mappedTicket.id,
                mappedTicket.summary,
                mappedTicket.description,
                mappedTicket.status,
                mappedTicket.priority,
                mappedTicket.url
            ]
        ).then(() => {
            appLogger.info(`[JiraSync] Upserted ticket ${mappedTicket.id} to active list via on-demand sync.`);
        }).catch(err => {
            appLogger.error('[JiraSync] Failed to upsert ticket', { source: 'JiraSync', error: (err as Error).message });
        });
    }
}
