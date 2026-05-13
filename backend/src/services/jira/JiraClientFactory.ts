/**
 * JiraClientFactory
 *
 * Reconstructed 2026-04-25 (original binary-corrupted).
 *
 * Returns a configured Axios instance + project-space keys for a given user.
 * Resolution order: DB (jira_config) → environment variables.
 *
 * Usage:
 *   const bundle = await getJiraClient(userId, pool);
 *   const data   = await bundle.axios.get('/rest/api/3/issue/ATT-15');
 *   const gt     = bundle.spaces.gt;  // e.g. "ATT"
 */

import axios, { AxiosInstance } from 'axios';
import { Pool }                  from 'pg';
import { JiraConfigService }     from '../JiraConfigService';
import { appLogger }             from '../../utils/logger';

export interface JiraClientBundle {
    axios:  AxiosInstance;
    spaces: {
        gt:  string;
        gb?: string;
        gd?: string;
    };
    domain: string;
    email:  string;
}

/**
 * Build and return a Jira Axios client for the given user.
 * Throws if no credentials can be resolved.
 */
export async function getJiraClient(userId: string, pool: Pool): Promise<JiraClientBundle> {
    const creds = await JiraConfigService.resolve(userId, pool);

    if (!creds) {
        throw new Error(
            `No Jira credentials found for user "${userId}". ` +
            'Configure via Settings → Jira or set JIRA_DOMAIN / JIRA_EMAIL / JIRA_API_TOKEN env vars.',
        );
    }

    const { domain, email, apiToken, spaces } = creds;

    // Normalise domain → ensure it has a scheme
    const baseURL = domain.startsWith('http')
        ? domain.replace(/\/$/, '')
        : `https://${domain}`;

    const instance = axios.create({
        baseURL,
        timeout: 30_000,
        headers: {
            'Content-Type': 'application/json',
            Accept:         'application/json',
        },
        auth: { username: email, password: apiToken },
    });

    // Request/response logging (debug level only)
    instance.interceptors.request.use(cfg => {
        appLogger.debug('[JiraClientFactory] Request', { method: cfg.method, url: cfg.url });
        return cfg;
    });

    instance.interceptors.response.use(
        res  => res,
        err  => {
            appLogger.warn('[JiraClientFactory] Request failed', {
                url:    err.config?.url,
                status: err.response?.status,
                msg:    err.message,
            });
            return Promise.reject(err);
        },
    );

    return {
        axios:  instance,
        spaces: { gt: spaces.gt, gb: spaces.gb, gd: spaces.gd },
        domain: baseURL,
        email,
    };
}
