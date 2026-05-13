/**
 * JiraConfigController
 *
 * Legacy controller for /api/jira/config endpoints.
 * Delegates to JiraConfigService (DB-backed, per-user).
 *
 * Prefer the new /api/settings/jira endpoints which have full validation
 * and support all project-space keys.
 */
import { Request, Response } from 'express';
import { JiraConfigService } from '../services/JiraConfigService';
import { appLogger } from '../utils/logger';

function resolveUserId(req: Request): string {
  return (req as any).user?.id ?? (req as any).apiKeyUser?.id ?? 'admin';
}

function resolvePool(req: Request): import('pg').Pool | undefined {
  return (req as any).app?.locals?.pool ?? (global as any).dbPool;
}

export class JiraConfigController {
  static async getConfig(req: Request, res: Response): Promise<void> {
    const userId = resolveUserId(req);
    const pool   = resolvePool(req);

    try {
      if (!pool) {
        res.status(503).json({ error: 'Database not available' });
        return;
      }
      const masked = await JiraConfigService.getMasked(userId, pool);
      if (!masked) {
        res.json({ domain: '', email: '', apiToken: '', hasToken: false });
        return;
      }
      res.json(masked);
    } catch (err: any) {
      appLogger.error('[JiraConfigController] getConfig failed', { err: err.message });
      res.status(500).json({ error: 'Failed to fetch Jira configuration' });
    }
  }

  static async saveConfig(req: Request, res: Response): Promise<void> {
    const userId = resolveUserId(req);
    const pool   = resolvePool(req);
    const { baseUrl, domain, email, apiToken, projectKey } = req.body;

    const resolvedDomain = (domain || baseUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

    if (!resolvedDomain || !email) {
      res.status(400).json({ error: 'Domain (or baseUrl) and email are required' });
      return;
    }

    try {
      if (!pool) {
        res.status(503).json({ error: 'Database not available' });
        return;
      }
      await JiraConfigService.save(
        userId,
        {
          domain:       resolvedDomain,
          email,
          apiToken:     apiToken ?? '********',
          gtProjectKey: projectKey ?? '',
        },
        pool,
      );
      res.json({ message: 'Jira configuration saved successfully' });
    } catch (err: any) {
      appLogger.error('[JiraConfigController] saveConfig failed', { err: err.message });
      res.status(500).json({ error: 'Failed to save Jira configuration' });
    }
  }
}
