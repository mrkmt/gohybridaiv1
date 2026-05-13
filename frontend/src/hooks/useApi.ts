import type { JiraTicket, TestScenario, TestCase, TestResult } from '../types';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000';

// Export apiUrl for components
export const apiUrl = BASE;

// Execute timeout for POST /api/testing/:ticketId/execute — configurable
// per deployment. Defaults to 10 minutes.
const EXEC_TIMEOUT_MS = Number(import.meta.env.VITE_EXEC_TIMEOUT_MS) || 600_000;

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

/**
 * Check JWT expiry with a 30-second grace window for client clock skew.
 * Tolerates slight drift so valid tokens aren't rejected prematurely.
 */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (typeof payload.exp !== 'number') return false;
    return payload.exp < (Date.now() / 1000) - 30;
  } catch { return true; }
}

class AuthError extends Error { constructor() { super('AUTH_EXPIRED'); } }
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 30_000
): Promise<T> {
  // P1 FIX: Origin check — only send token to our own API
  const url = new URL(`${BASE}${path}`);
  const baseOrigin = new URL(BASE).origin;
  
  const token = getToken();
  if (!token || isTokenExpired(token)) throw new AuthError();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (url.origin === baseOrigin) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), { ...options, headers, signal: controller.signal });

    if (res.status === 401) throw new AuthError();
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const body = await res.json(); msg = body.error || body.message || msg; } catch { /* */ }
      throw new ApiError(res.status, msg);
    }

    return res.json() as Promise<T>;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new ApiError(408, 'Request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  fetchActiveTickets: (page = 1, limit = 50, query = '') =>
    apiFetch<{ 
      tickets: JiraTicket[], 
      total: number, 
      page: number, 
      limit: number, 
      source: 'live' | 'db' 
    }>(`/api/jira/active-tickets?page=${page}&limit=${limit}&query=${encodeURIComponent(query)}`),

  fetchTicket: (ticketId: string) =>
    apiFetch<{ tickets: JiraTicket[] }>(`/api/testing/chat/mention`, {
      method: 'POST',
      body: JSON.stringify({ message: `Test ${ticketId}` }),
    }),

  startSession: (ticketId: string) =>
    apiFetch<{
      session: { id: string; phase: string; ticketId: string };
      discovery: {
        fresh: boolean;
        discoveredAt?: string;
        age?: string;
        version?: number;
        elementCount?: number;
        sampleSelectors?: { name: string; selector: string; type?: string }[];
      };
    }>(`/api/testing/${ticketId}/start`, {
      method: 'POST',
      body: JSON.stringify({}),
    }, 120_000),

  /**
   * Run LIVE Playwright discovery (heavy, ~15-45s). Call only when /start
   * returns `discovery.fresh === false`. The response carries real verified
   * selectors from the cached inventory it just built.
   */
  runDiscovery: (ticketId: string) =>
    apiFetch<{
      success: boolean;
      discovery: {
        fresh: boolean;
        age: string;
        elementCount: number;
        sampleSelectors: { name: string; selector: string; type?: string }[];
      };
    }>(`/api/testing/${ticketId}/discovery/run`, {
      method: 'POST',
      body: JSON.stringify({}),
    }, 120_000),

  getSession: (ticketId: string) =>
    apiFetch<{ session: Record<string, unknown> }>(`/api/testing/${ticketId}/session`),

  generateScenarios: (ticketId: string) =>
    apiFetch<{ scenarios: TestScenario[] }>(`/api/testing/${ticketId}/scenarios`, {
      method: 'POST',
      body: JSON.stringify({}),
    }, 120_000),

  generateTestCases: (ticketId: string, scenarioIds: string[], customInstructions: string[]) =>
    apiFetch<{ testCases: TestCase[] }>(`/api/testing/${ticketId}/test-cases/generate`, {
      method: 'POST',
      body: JSON.stringify({ scenarioIds, customInstructions }),
    }, 300_000),

  updateTestCase: (ticketId: string, caseId: string, patch: Partial<TestCase>) =>
    apiFetch<{ testCase: TestCase }>(`/api/testing/${ticketId}/test-cases/${caseId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  deleteTestCase: (ticketId: string, caseId: string) =>
    apiFetch<void>(`/api/testing/${ticketId}/test-cases/${caseId}`, { method: 'DELETE' }),

  /** B1: Persist a user-added custom scenario on the backend session. */
  addUserScenario: (ticketId: string, label: string, tag?: string) =>
    apiFetch<{ success: boolean; scenario: Record<string, unknown>; scenarios: TestScenario[] }>(
      `/api/testing/${ticketId}/user-scenarios`,
      { method: 'POST', body: JSON.stringify({ label, tag }) }
    ),

  /** B1: Remove a user-added custom scenario from the backend session. */
  deleteUserScenario: (ticketId: string, id: string) =>
    apiFetch<{ success: boolean; scenarios: TestScenario[] }>(
      `/api/testing/${ticketId}/user-scenarios/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  approveAndExecute: async (ticketId: string, caseIds: string[], environment: Record<string, string>) => {
    // Must approve before execute — backend guards with 409 if this step is skipped.
    await apiFetch<{ success: boolean }>(
      `/api/testing/${ticketId}/test-cases/approve`,
      { method: 'POST', body: JSON.stringify({ testCaseIds: caseIds }) },
    );
    return apiFetch<{ results: TestResult[]; summary: Record<string, unknown> }>(
      `/api/testing/${ticketId}/execute`,
      { method: 'POST', body: JSON.stringify({ testCaseIds: caseIds, environment }) },
      EXEC_TIMEOUT_MS
    );
  },

  retestFailed: (ticketId: string, caseIds: string[], environment: Record<string, string>) =>
    apiFetch<{ results: TestResult[]; summary: Record<string, unknown> }>(
      `/api/testing/${ticketId}/execute/retry`,
      { method: 'POST', body: JSON.stringify({ testCaseIds: caseIds, environment }) },
      EXEC_TIMEOUT_MS
    ),

  uploadToJira: (ticketId: string) =>
    apiFetch<{ success: boolean }>(`/api/testing/${ticketId}/results/upload`, {
      method: 'POST', body: JSON.stringify({}),
    }, 60_000),

  transitionJira: (ticketId: string, targetStatus: string) =>
    apiFetch<{ success: boolean }>(`/api/testing/${ticketId}/jira/transition`, {
      method: 'POST', body: JSON.stringify({ targetStatus }),
    }),

  deleteSession: (ticketId: string) =>
    apiFetch<{ success: boolean }>(`/api/testing/${ticketId}/session`, {
      method: 'DELETE',
    }),

  resetSession: (ticketId: string) =>
    apiFetch<{ success: boolean }>(`/api/testing/${ticketId}/reset`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  uploadTestCasesToJira: (ticketId: string) =>
    apiFetch<{ success: boolean; testCaseCount: number }>(
      `/api/testing/${ticketId}/test-cases/upload`,
      { method: 'POST', body: JSON.stringify({}) },
      30_000
    ),

  checkHealth: () =>
    fetch(`${BASE}/api/health`).then(r => r.ok),
};
