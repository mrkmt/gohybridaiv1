/**
 * jiraAxios.ts
 *
 * Gemini CLI - Phase 2.5: CircuitBreaker wrapper for Jira API resilience.
 */
import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';
import { appLogger } from './logger';
import { CircuitBreakerRegistry } from './CircuitBreaker';

dotenv.config();

/**
 * Creates a configured Axios instance for Jira REST API v3.
 *
 * Features:
 * - Basic Auth from environment variables (read fresh on each call)
 * - Error interceptor with structured logging
 * - 30-second request timeout
 * - No automatic retry (callers should implement retry with backoff)
 */
export function getJiraAxios(): AxiosInstance {
    const JIRA_DOMAIN = process.env.JIRA_DOMAIN;
    const JIRA_EMAIL = process.env.JIRA_EMAIL;
    const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

    if (!JIRA_DOMAIN || !JIRA_EMAIL || !JIRA_API_TOKEN) {
        appLogger.warn('[jiraAxios] Missing Jira configuration in environment variables');
    }

    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

    const instance = axios.create({
        baseURL: `https://${JIRA_DOMAIN}`,
        timeout: 120000, // 120-second timeout — HTML report uploads can be large
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    });

    // Single error interceptor — logs structured error info
    instance.interceptors.response.use(
        (response) => response,
        (error) => {
            const status = error.response?.status;
            const messages = error.response?.data?.errorMessages;
            const message = Array.isArray(messages) ? messages.join('; ') : (error.message || 'Unknown error');
            const url = error.config?.url || '';
            appLogger.error('[JiraAPI Error]', { status: status || 'NETWORK', method: (error.config?.method || '').toUpperCase(), url, message });
            return Promise.reject(error);
        }
    );

    return instance;
}

// Legacy export — calls getJiraAxios() once at module load.
// New code should use getJiraAxios() directly to get fresh env vars.
export const jiraAxios = getJiraAxios();

// ─── Phase 2.5 P3: CircuitBreaker wrapper ────────────────────────────────────
// Breaker config: 3 failures in 30 s → OPEN, 10 s half-open retry.
// Usage: `await jiraRequest(() => getJiraAxios().get('/rest/api/3/issue/ATT-22'))`
const JIRA_BREAKER_OPTIONS = {
  failureThreshold: 3,
  resetTimeoutMs:   10_000,   // half-open after 10 s
  successTimeoutMs: 30_000,   // reset failure counter after 30 s of quiet
  successThreshold: 1,
};

/**
 * Execute a Jira API call protected by a circuit breaker.
 *
 * When the Jira API has failed 3 times within 30 s the circuit OPENS and
 * subsequent calls throw immediately instead of waiting 120 s for a timeout.
 * This keeps the AI pipeline responsive when Jira is degraded.
 *
 * @example
 *   const issue = await jiraRequest(() => getJiraAxios().get('/rest/api/3/issue/ATT-22'));
 */
export async function jiraRequest<T>(fn: () => Promise<T>): Promise<T> {
  return CircuitBreakerRegistry.get('jira-api', JIRA_BREAKER_OPTIONS).execute(fn);
}
