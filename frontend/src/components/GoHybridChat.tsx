/**
 * GoHybridChat.tsx
 * Main orchestration component for the GoHybridAI wizard-style test pipeline.
 *
 * Architecture:
 *  - Per-session message history — switching tickets preserves each ticket's full timeline
 *  - All action handlers capture targetId at invocation, never read activeId after an await
 *  - WebSocket subscribes to all tickets currently in execution phase, routes by ticketId
 *  - Jira status drives available actions (To Do → start, In Testing → retest, Done → readonly)
 *  - Bot comment filtering prevents AI reading its own previous test results as requirements
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useExecutionWebSocket } from '../hooks/useExecutionWebSocket';
import type { ExecutionStepEvent } from '../hooks/useExecutionWebSocket';
import { api } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import type {
  JiraTicket, TestScenario, TestCase, TestResult, ExecutionSummary,
  DiscoveryInfo, SidebarSession, ChatMessage, PipelinePhase,
} from '../types';
import {
  uid, TICKET_RE, STATUS_DOT,
  TicketCard, DiscoveryCard, ScenariosCard,
} from './GoHybridChat.part1';
import {
  TestCasesCard, ExecutionCard, ResultsCard,
  JiraTransitionPanel, Sidebar,
} from './GoHybridChat.part2';
import { Settings, Monitor, Sparkles, CheckCircle2, RotateCcw } from 'lucide-react';

// ─── per-session state ────────────────────────────────────────────────────────
interface Session {
  ticketId: string;
  ticket: JiraTicket | null;
  phase: PipelinePhase;
  discovery: DiscoveryInfo | null;
  scenarios: TestScenario[];
  testCases: TestCase[];
  executionLogs: string[];
  executionSteps: ExecutionStepEvent[];
  executionProgress: number;
  executionCurrentCase: string;
  results: TestResult[];
  summary: ExecutionSummary | null;
  iterationCount: number;
  // Bug 1 fix: per-session message history and typing indicator
  messages: ChatMessage[];
  isTyping: boolean;
}

const emptySession = (ticketId: string): Session => ({
  ticketId, ticket: null, phase: 'idle',
  discovery: null, scenarios: [], testCases: [],
  executionLogs: [], executionSteps: [], executionProgress: 0, executionCurrentCase: '',
  results: [], summary: null, iterationCount: 0,
  messages: [], isTyping: false,
});

// ─── time formatter ───────────────────────────────────────────────────────────
function formatMsgTime(ts: Date): string {
  try {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return time;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
  } catch { return ''; }
}

function formatSessionDate(ts: Date): string {
  try {
    const d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return `Today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return `Yesterday at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
      ` at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch { return ''; }
}

// ─── message rendering ────────────────────────────────────────────────────────
function UserBubble({ content, timestamp }: { content: string; timestamp?: Date }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%]">
        <div className="bg-blue-50 dark:bg-blue-950 text-blue-800 dark:text-blue-200 text-[12px] px-3 py-2 rounded-xl rounded-br-sm leading-relaxed border border-blue-100 dark:border-blue-900">
          {content}
        </div>
        {timestamp && (
          <div className="text-right text-[10px] text-gray-400 mt-0.5 pr-1 select-none">
            {formatMsgTime(timestamp)}
          </div>
        )}
      </div>
    </div>
  );
}

function renderInlineCode(content: string): React.ReactNode[] {
  return content.split(/`([^`]+)`/g).map((part, i) =>
    i % 2 === 1
      ? <code key={i} className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded text-[11px]">{part}</code>
      : <span key={i}>{part}</span>
  );
}

function AssistantBubble({ content, timestamp }: { content: string; timestamp?: Date }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%]">
        <div className="bg-gray-50 dark:bg-gray-800/80 text-gray-700 dark:text-gray-300 text-[12px] px-3 py-2 rounded-xl rounded-tl-sm leading-relaxed border border-gray-100 dark:border-gray-800">
          {renderInlineCode(content)}
        </div>
        {timestamp && (
          <div className="text-left text-[10px] text-gray-400 mt-0.5 pl-1 select-none">
            {formatMsgTime(timestamp)}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-800 px-3 py-2.5 rounded-xl rounded-tl-sm">
        <div className="flex gap-1 items-center">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────
export default function GoHybridChat() {
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [sidebarList, setSidebarList] = useState<SidebarSession[]>([]);
  const [showVersionSwitcher, setShowVersionSwitcher] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Deduplicates results_card: whichever of WebSocket onComplete / HTTP fallback
  // fires first marks the ticket as done; the second is silently dropped.
  const completedExecutionsRef = useRef<Set<string>>(new Set());
  const token = useMemo(() => localStorage.getItem('auth_token'), []);

  // Bug 1 fix: messages and isTyping come from the active session, not global state
  const activeSession = activeId ? sessions[activeId] : null;
  const messages = activeSession?.messages ?? [];
  const isTyping = activeSession?.isTyping ?? false;

  const { user, logout } = useAuth();

  // scroll to bottom on new messages or typing
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // auto-logout when WS token expires
  useEffect(() => {
    const handleAuthExpired = () => logout();
    window.addEventListener('auth:expired', handleAuthExpired);
    return () => window.removeEventListener('auth:expired', handleAuthExpired);
  }, [logout]);

  // ── session helpers ──────────────────────────────────────────────────────
  const mutateSession = useCallback((id: string, patch: Partial<Session>) => {
    setSessions(prev => {
      if (!prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], ...patch } };
    });
  }, []);

  const updateSidebar = useCallback((sess: Session) => {
    if (!sess.ticket) return;
    setSidebarList(prev => {
      const filtered = prev.filter(s => s.ticketId !== sess.ticketId);
      return [{
        ticketId: sess.ticketId,
        ticketSummary: sess.ticket!.summary,
        status: sess.ticket!.status,
        type: sess.ticket!.type,
        iterationCount: sess.iterationCount,
        lastActive: new Date(),
      }, ...filtered];
    });
  }, []);

  // ── message helpers (Bug 1 + Bug 2 fix: write to session, accept targetId) ──
  const addMsg = useCallback((
    targetId: string,
    role: 'user' | 'assistant',
    content: string,
    payload?: ChatMessage['payload'],
  ) => {
    setSessions(prev => {
      const s = prev[targetId];
      if (!s) return prev;
      return {
        ...prev,
        [targetId]: {
          ...s,
          messages: [...s.messages, { id: uid(), role, content, timestamp: new Date(), payload }],
        },
      };
    });
  }, []);

  // Bug 2 fix: withTyping scoped to a specific session
  // isTyping stays true while fn() executes — finally block clears it even on throw
  const withTyping = useCallback(async (targetId: string, ms: number, fn: () => Promise<void>) => {
    mutateSession(targetId, { isTyping: true });
    await new Promise(r => setTimeout(r, ms));
    try {
      await fn();
    } finally {
      mutateSession(targetId, { isTyping: false });
    }
  }, [mutateSession]);

  // delete a message from session
  const deleteMessage = useCallback((targetId: string, messageId: string) => {
    setSessions(prev => {
      const s = prev[targetId];
      if (!s) return prev;
      return {
        ...prev,
        [targetId]: {
          ...s,
          messages: s.messages.filter(m => m.id !== messageId),
        },
      };
    });
  }, []);

  // ── WebSocket (Bug 4 fix: subscribe to ALL executing tickets) ────────────
  // Collect every ticket currently in execution phase
  // Use a phase-only string key so the array stays reference-stable across
  // log/step/progress renders — only changes when a ticket enters or leaves execution.
  const phaseKey = Object.keys(sessions).sort().map(id => `${id}:${sessions[id]?.phase}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const executingIds = useMemo(
    () => Object.keys(sessions).filter(id => sessions[id].phase === 'execution'),
    [phaseKey],
  );

  useExecutionWebSocket({
    ticketIds: executingIds,
    token,
    onLog: useCallback((ticketId: string, line: string) => {
      setSessions(prev => {
        const s = prev[ticketId];
        if (!s) return prev;
        return { ...prev, [ticketId]: { ...s, executionLogs: [...s.executionLogs.slice(-200), line] } };
      });
    }, []),
    onStep: useCallback((ticketId: string, event: ExecutionStepEvent) => {
      setSessions(prev => {
        const s = prev[ticketId];
        if (!s) return prev;
        return { ...prev, [ticketId]: { ...s, executionSteps: [...s.executionSteps.slice(-59), event] } };
      });
    }, []),
    onProgress: useCallback((ticketId: string, data: Record<string, unknown>) => {
      setSessions(prev => {
        const s = prev[ticketId];
        if (!s) return prev;
        const p = typeof data.overallProgress === 'number' ? data.overallProgress : s.executionProgress;
        const c = typeof data.currentTestCase === 'string' ? data.currentTestCase : s.executionCurrentCase;
        return { ...prev, [ticketId]: { ...s, executionProgress: p, executionCurrentCase: c } };
      });
    }, []),
    onComplete: useCallback((ticketId: string, data: Record<string, unknown>) => {
      // Deduplicate: only the first completion event per run wins (WS and HTTP both fire).
      if (completedExecutionsRef.current.has(ticketId)) return;
      completedExecutionsRef.current.add(ticketId);

      const results = (data.results as TestResult[]) || [];
      const sumRaw = (data.summary as Record<string, unknown>) || {};
      const summary: ExecutionSummary = {
        passed: Number(sumRaw.passed) || 0,
        failed: Number(sumRaw.failed) || 0,
        codeFaults: Number(sumRaw.codeFaults) || 0,
        total: Number(sumRaw.total) || results.length,
        iteration: Number(sumRaw.iteration) || 1,
        duration: String(sumRaw.duration || ''),
      };
      setSessions(prev => {
        const s = prev[ticketId];
        if (!s) return prev;
        return { ...prev, [ticketId]: { ...s, phase: 'results', results, summary, executionProgress: 100 } };
      });
      addMsg(ticketId, 'assistant',
        `Execution complete — ${summary.passed} passed, ${summary.failed} failed, ${summary.codeFaults} code faults.`,
        { type: 'results_card', sessionId: ticketId },
      );
    }, [addMsg]),
    onFailed: useCallback((ticketId: string, data: Record<string, unknown>) => {
      const msg = String(data.error || 'Execution failed unexpectedly.');
      addMsg(ticketId, 'assistant', `Execution error: ${msg}`);
      setSessions(prev => {
        const s = prev[ticketId];
        if (!s) return prev;
        return { ...prev, [ticketId]: { ...s, phase: 'testcases' } };
      });
    }, [addMsg]),
  });

  // ── ticket fetch ─────────────────────────────────────────────────────────
  const handleTicketMention = async (ticketId: string) => {
    const upper = ticketId.toUpperCase();

    // Bug 1 fix: resuming an existing session just switches activeId —
    // the session's own messages array already has the full history.
    if (sessions[upper]) {
      setActiveId(upper);
      return;
    }

    // New ticket: create session, then fetch
    setActiveId(upper);
    setSessions(prev => ({ ...prev, [upper]: emptySession(upper) }));

    addMsg(upper, 'user', `Test ${upper}`);

    await withTyping(upper, 800, async () => {
      try {
        const res = await api.fetchTicket(upper);
        const ticket = res.tickets?.[0];
        if (!ticket) {
          addMsg(upper, 'assistant', `Ticket ${upper} not found in Jira. Check the ticket key and Jira connection.`);
          return;
        }
        mutateSession(upper, { ticket, phase: 'ticket' });
        updateSidebar({ ...emptySession(upper), ticket, iterationCount: ticket.iterationCount ?? 0 });
        addMsg(upper, 'assistant',
          `Fetched ${upper} from Jira. Linked tickets filtered — bot comments excluded from context.`,
          { type: 'ticket_card', sessionId: upper },
        );
      } catch (err) {
        const e = err as Error;
        if (e.message === 'AUTH_EXPIRED') {
          addMsg(upper, 'assistant', 'Session expired — please log in again.');
          return;
        }
        addMsg(upper, 'assistant', `Could not fetch ${upper}: ${e.message}`);
      }
    });
  };

  // ── start testing (Bug 2 fix: targetId captured at invocation) ───────────
  const handleStartTesting = useCallback(async (targetId: string) => {
    const sess = sessions[targetId];
    if (!sess) return;

    addMsg(targetId, 'user', 'Start testing');

    await withTyping(targetId, 600, async () => {
      addMsg(targetId, 'assistant',
        `Transitioning ${targetId} to In Testing on Jira. Checking discovery cache for ${sess.ticket?.module || ''} module...`,
      );
    });

    try {
      const resp = await api.startSession(targetId);
      mutateSession(targetId, { phase: 'discovery' });

      // Read iterationCount from startSession response and patch the ticket.
      const iterationCount = (resp?.session as any)?.iterationCount ?? 0;
      if (iterationCount > 0) {
        setSessions(prev => {
          const s = prev[targetId];
          if (!s?.ticket) return prev;
          return { ...prev, [targetId]: { ...s, ticket: { ...s.ticket!, iterationCount }, iterationCount } };
        });
      }

      // Fetch enriched session so gbContext is populated after startSession.
      api.getSession(targetId).then(sessionResp => {
        const enrichedTicket = (sessionResp?.session as any)?.ticket;
        if (enrichedTicket?.gbContext) {
          mutateSession(targetId, { ticket: enrichedTicket as JiraTicket });
        }
      }).catch(() => { /* non-critical */ });

      const cacheHit = Boolean(resp?.discovery?.fresh);
      const cacheAge = resp?.discovery?.age || 'unknown';
      const elementCount = resp?.discovery?.elementCount ?? 0;

      if (cacheHit) {
        const discovery: DiscoveryInfo = {
          status: 'cache_hit', cacheAge, elementCount,
          sampleSelectors: resp?.discovery?.sampleSelectors || [],
        };
        mutateSession(targetId, { discovery });
        addMsg(targetId, 'assistant',
          `Discovery cache hit — ${elementCount} elements verified (${cacheAge} old).`,
          { type: 'discovery_card', sessionId: targetId },
        );
      } else {
        mutateSession(targetId, {
          discovery: { status: 'crawling', progress: 10, progressMessage: 'Launching browser and logging in...' },
        });
        addMsg(targetId, 'assistant',
          'No cache found — running live UI discovery (15–30 seconds). Logging in and probing real elements...',
          { type: 'discovery_card', sessionId: targetId },
        );

        try {
          const live = await api.runDiscovery(targetId);
          if ((live as any).pending) {
            mutateSession(targetId, { discovery: { status: 'crawling', progress: 80, progressMessage: 'Background discovery still running — check back in 30s.' } });
            addMsg(targetId, 'assistant', 'Discovery is still running in the background. Refresh or wait 30 seconds, then continue.');
          } else {
            mutateSession(targetId, {
              discovery: {
                status: 'cache_hit',
                cacheAge: live.discovery.age,
                elementCount: live.discovery.elementCount,
                sampleSelectors: live.discovery.sampleSelectors,
              },
            });
          }
        } catch (discErr) {
          mutateSession(targetId, { discovery: { status: 'failed' } });
          addMsg(targetId, 'assistant', `Live discovery failed: ${(discErr as Error).message}`);
        }
      }
    } catch (err) {
      addMsg(targetId, 'assistant', `Failed to start session: ${(err as Error).message}`);
    }
  }, [sessions, addMsg, withTyping, mutateSession]);

  // ── generate scenarios ───────────────────────────────────────────────────
  const handleGenerateScenarios = useCallback(async (targetId: string, mode: 'fresh' | 'retest' | 'add') => {
    const sess = sessions[targetId];
    if (!sess) return;

    mutateSession(targetId, { phase: 'scenarios', isTyping: true });
    const label = mode === 'retest'
      ? 'Re-test failed cases — loading scope'
      : 'Analysing ticket, linked tickets, and business rules';
    addMsg(targetId, 'assistant', `${label}. Bot comments from previous runs excluded.`);

    try {
      const res = await api.generateScenarios(targetId);
      mutateSession(targetId, { isTyping: false });

      let scenarios = res.scenarios || [];

      if (mode === 'retest' && sess.results.length > 0) {
        const failedIds = new Set(
          sess.results
            .filter(r => {
              const s = String(r.status).toLowerCase();
              return s === 'fail' || s === 'failed' || s === 'code_fault' || s === 'fault';
            })
            .map(r => r.caseId),
        );
        scenarios = scenarios.map(s => ({ ...s, selected: failedIds.has(s.id) }));
      }

      mutateSession(targetId, { scenarios });
      addMsg(targetId, 'assistant',
        `Generated ${scenarios.length} scenarios. Select which to include.`,
        { type: 'scenarios_card', sessionId: targetId },
      );
    } catch (err) {
      mutateSession(targetId, { isTyping: false, scenarios: [] });
      addMsg(targetId, 'assistant',
        `Scenario generation failed: ${(err as Error).message}. No offline fallback is used here, so the list stays empty until the real backend response succeeds.`,
      );
    }
  }, [sessions, addMsg, mutateSession]);

  // ── generate test cases ──────────────────────────────────────────────────
  const handleGenerateTestCases = useCallback(async (targetId: string) => {
    const sess = sessions[targetId];
    if (!sess) return;

    const selected = sess.scenarios.filter(s => s.selected);
    const custom = sess.scenarios.filter(s => s.source === 'custom').map(s => s.label);

    addMsg(targetId, 'user', `Generate test cases from ${selected.length} selected scenarios`);
    mutateSession(targetId, { phase: 'testcases', isTyping: true });

    try {
      const res = await api.generateTestCases(targetId, selected.map(s => s.id), custom);
      mutateSession(targetId, { isTyping: false });
      const tcs = res.testCases || [];
      const unique = Array.from(new Map(tcs.map(tc => [tc.id, tc])).values());
      mutateSession(targetId, { testCases: unique });
      addMsg(targetId, 'assistant',
        `Compiled ${unique.length} Playwright scripts using verified selectors. Review, edit, or delete before approving.`,
        { type: 'testcases_card', sessionId: targetId },
      );
    } catch (err) {
      mutateSession(targetId, { isTyping: false, testCases: [] });
      addMsg(targetId, 'assistant',
        `Test-case generation failed: ${(err as Error).message}. No mock test cases were injected, so only real backend-generated cases will appear here.`,
      );
    }
  }, [sessions, addMsg, mutateSession]);

  // ── approve and execute ──────────────────────────────────────────────────
  const handleApproveAndRun = useCallback(async (targetId: string) => {
    const sess = sessions[targetId];
    if (!sess) return;

    completedExecutionsRef.current.delete(targetId);
    addMsg(targetId, 'user', 'Approve and run');
    const iter = sess.iterationCount + 1;
    mutateSession(targetId, {
      phase: 'execution',
      executionLogs: [], executionSteps: [], executionProgress: 5,
      executionCurrentCase: 'Starting Playwright...',
      iterationCount: iter,
    });
    addMsg(targetId, 'assistant', 'Playwright execution started. Streaming logs...',
      { type: 'execution_card', sessionId: targetId },
    );

    try {
      const env: Record<string, string> = {
        BASE_URL: import.meta.env.VITE_TEST_BASE_URL || '',
        TEST_USERNAME: import.meta.env.VITE_TEST_USERNAME || '',
        TEST_PASSWORD: import.meta.env.VITE_TEST_PASSWORD || '',
      };
      const uniqueTestCases = Array.from(new Map(sess.testCases.map(tc => [tc.id, tc])).values());
      const res = await api.approveAndExecute(targetId, uniqueTestCases.map(tc => tc.id), env);
      // WebSocket onComplete fires first in most cases; this HTTP response is a fallback.
      // Only apply if response contains actual results (202 async returns empty array).
      if (!completedExecutionsRef.current.has(targetId) && (res.results?.length ?? 0) > 0) {
        completedExecutionsRef.current.add(targetId);
        const results: TestResult[] = res.results || [];
        const sumRaw = (res.summary as Record<string, unknown>) || {};
        const summary: ExecutionSummary = {
          passed: Number(sumRaw.passed) || results.filter(r => r.status === 'PASS').length,
          failed: Number(sumRaw.failed) || results.filter(r => r.status === 'FAIL').length,
          codeFaults: Number(sumRaw.codeFaults) || results.filter(r => r.status === 'CODE_FAULT').length,
          total: results.length, iteration: iter, duration: String(sumRaw.duration || ''),
        };
        mutateSession(targetId, { phase: 'results', results, summary, executionProgress: 100 });
        addMsg(targetId, 'assistant', `Done — ${summary.passed}/${summary.total} passed.`,
          { type: 'results_card', sessionId: targetId },
        );
      }
    } catch (err) {
      const status = (err as any).status;
      if (status === 409) {
        addMsg(targetId, 'assistant', 'Tests already running — results will arrive via WebSocket when complete.');
      } else {
        addMsg(targetId, 'assistant', 'Execution request timed out. Results will arrive via WebSocket when complete.');
      }
    }
  }, [sessions, addMsg, mutateSession]);

  // ── retest failed ────────────────────────────────────────────────────────
  const handleRetestFailed = useCallback(async (targetId: string) => {
    const sess = sessions[targetId];
    if (!sess) return;

    const failedIds = sess.results
      .filter(r => {
        const s = String(r.status || '').toLowerCase();
        return s === 'fail' || s === 'failed' || s === 'code_fault' || s === 'fault';
      })
      .map(r => r.caseId);

    if (failedIds.length === 0) {
      addMsg(targetId, 'assistant', 'No failed or code fault cases found to re-test.');
      return;
    }

    completedExecutionsRef.current.delete(targetId);
    addMsg(targetId, 'user', `Re-test failed + code fault cases (${failedIds.length})`);
    const iter = sess.iterationCount + 1;
    mutateSession(targetId, {
      phase: 'execution',
      executionLogs: [], executionSteps: [], executionProgress: 5,
      executionCurrentCase: 'Starting re-test with self-healing...',
      iterationCount: iter,
    });
    addMsg(targetId, 'assistant',
      `Re-running ${failedIds.length} cases with self-healing enabled.`,
      { type: 'execution_card', sessionId: targetId },
    );

    try {
      await api.retestFailed(targetId, failedIds, {});
    } catch {
      addMsg(targetId, 'assistant', 'Retest request submitted. Results streaming via WebSocket.');
    }
  }, [sessions, addMsg, mutateSession]);

  // ── upload to Jira ───────────────────────────────────────────────────────
  const handleUpload = useCallback(async (targetId: string) => {
    addMsg(targetId, 'user', 'Upload results to Jira');
    mutateSession(targetId, { isTyping: true });
    try {
      await api.uploadToJira(targetId);
      mutateSession(targetId, { isTyping: false });
      addMsg(targetId, 'assistant',
        `Results uploaded to ${targetId}. ADF verification table, screenshots, and video recordings attached.`,
      );
      addMsg(targetId, 'assistant', 'Transition ticket status?',
        { type: 'status_transition', sessionId: targetId },
      );
    } catch {
      mutateSession(targetId, { isTyping: false });
      addMsg(targetId, 'assistant', 'Upload failed — check Jira credentials in settings.');
    }
  }, [addMsg, mutateSession]);

  const handleTransition = useCallback(async (targetId: string, status: string) => {
    addMsg(targetId, 'user', `Mark as ${status}`);
    try {
      await api.transitionJira(targetId, status);
      setSessions(prev => {
        const s = prev[targetId];
        if (!s?.ticket) return prev;
        return { ...prev, [targetId]: { ...s, ticket: { ...s.ticket, status: status as JiraTicket['status'] } } };
      });
      addMsg(targetId, 'assistant', `Ticket transitioned to ${status} on Jira.`);
    } catch {
      addMsg(targetId, 'assistant', `Transition to ${status} failed — may need manual update in Jira.`);
    }
  }, [addMsg]);

  // ── scenario / test case mutations ───────────────────────────────────────
  const toggleScenario = useCallback((targetId: string, scenarioId: string) => {
    setSessions(prev => {
      const s = prev[targetId];
      if (!s) return prev;
      return {
        ...prev,
        [targetId]: {
          ...s,
          scenarios: s.scenarios.map(sc => sc.id === scenarioId ? { ...sc, selected: !sc.selected } : sc),
        },
      };
    });
  }, []);

  const addCustomScenario = useCallback(async (targetId: string, label: string) => {
    const tempId = `custom-${uid()}`;
    const sc: TestScenario = { id: tempId, label, tag: 'Custom', selected: true, source: 'custom' };
    setSessions(prev => {
      const s = prev[targetId];
      if (!s) return prev;
      if (s.scenarios.some(existing => existing.label === label && existing.source === 'custom')) return prev;
      return { ...prev, [targetId]: { ...s, scenarios: [...s.scenarios, sc] } };
    });
    try {
      const result = await api.addUserScenario(targetId, label, 'Custom');
      setSessions(prev => {
        const s = prev[targetId];
        if (!s) return prev;
        const serverScenario = result.scenario as unknown as TestScenario;
        return {
          ...prev,
          [targetId]: {
            ...s,
            scenarios: s.scenarios.map(existing =>
              existing.id === tempId ? { ...existing, id: serverScenario.id } : existing,
            ),
          },
        };
      });
    } catch {
      // Non-fatal — scenario is in local state; generation still works without server id
    }
  }, []);

  const updateTestCase = useCallback((targetId: string, id: string, name: string) => {
    setSessions(prev => {
      const s = prev[targetId];
      if (!s) return prev;
      return { ...prev, [targetId]: { ...s, testCases: s.testCases.map(tc => tc.id === id ? { ...tc, name } : tc) } };
    });
    api.updateTestCase(targetId, id, { name }).catch(() => {});
  }, []);

  const deleteTestCase = useCallback((targetId: string, id: string) => {
    setSessions(prev => {
      const s = prev[targetId];
      if (!s) return prev;
      return { ...prev, [targetId]: { ...s, testCases: s.testCases.filter(tc => tc.id !== id) } };
    });
    api.deleteTestCase(targetId, id).catch(() => {});
  }, []);

  const addTestCase = useCallback((targetId: string, name: string) => {
    const newTc: TestCase = { id: `TC-${uid()}`, name, steps: [], status: 'PENDING', approved: false };
    setSessions(prev => {
      const s = prev[targetId];
      if (!s) return prev;
      return { ...prev, [targetId]: { ...s, testCases: [...s.testCases, newTc] } };
    });
  }, []);

  // ── freeform chat ────────────────────────────────────────────────────────
  const handleFreeformMessage = async (text: string) => {
    const lc = text.toLowerCase();
    const ticketMatch = text.match(TICKET_RE);

    if (ticketMatch) {
      await handleTicketMention(ticketMatch[0]);
      return;
    }

    if (!activeId) {
      return;
    }

    const targetId = activeId;
    mutateSession(targetId, { isTyping: true });
    await new Promise(r => setTimeout(r, 500));
    mutateSession(targetId, { isTyping: false });

    const sess = sessions[targetId];

    if (lc === 'reset' || lc === '/reset' || lc.startsWith('reset session')) {
      await handleReset(targetId);
      return;
    }

    if (lc.includes('why') || lc.includes('fault') || lc.includes('cause')) {
      const lastFault = sess?.results.find(r => r.status === 'CODE_FAULT' || r.status === 'FAIL');
      if (lastFault?.forensicNote) {
        addMsg(targetId, 'assistant', lastFault.forensicNote);
      } else {
        addMsg(targetId, 'assistant', 'No forensic data available yet. Run execution first, then ask about a specific failure.');
      }
    } else if (lc.includes('result') || lc.includes('summary') || lc.includes('pass') || lc.includes('fail')) {
      const s = sess?.summary;
      if (s) {
        addMsg(targetId, 'assistant', `Iteration ${s.iteration}: ${s.passed} passed, ${s.failed} failed, ${s.codeFaults} code faults out of ${s.total} total.`);
      } else {
        addMsg(targetId, 'assistant', 'No results yet. Run the test execution first.');
      }
    } else if (lc.includes('upload') || lc.includes('jira')) {
      await handleUpload(targetId);
    } else if (lc.includes('help') || lc.includes('what can')) {
      addMsg(targetId, 'assistant', 'Type a Jira ticket ID (e.g. <code>ATT-22</code>) to start. You can ask about test results, why a case failed, or say "upload to Jira" after execution.');
    } else {
      addMsg(targetId, 'assistant', 'You can type a Jira ticket ID, ask about results, ask why a test failed, or say "upload to Jira".');
    }
  };

  // ── send handler ─────────────────────────────────────────────────────────
  const handleSend = () => {
    const val = inputValue.trim();
    if (!val) return;
    setInputValue('');
    if (activeId) addMsg(activeId, 'user', val);
    handleFreeformMessage(val);
  };

  // ── switch session (Bug 1 fix: just set activeId, history is per-session) ─
  const switchSession = (id: string) => {
    setActiveId(id);
    // If session has no messages yet (e.g. loaded from sidebar after page refresh),
    // add a single resume card so the user sees the ticket immediately.
    setSessions(prev => {
      const s = prev[id];
      if (!s || s.messages.length > 0) return prev;
      const resumeMsg: ChatMessage = {
        id: uid(), role: 'assistant',
        content: `Resumed session for ${id}.`,
        timestamp: new Date(),
        payload: { type: 'ticket_card', sessionId: id },
      };
      return { ...prev, [id]: { ...s, messages: [resumeMsg] } };
    });
  };

  // ── new chat ─────────────────────────────────────────────────────────────
  const handleNewChat = () => {
    setActiveId(null);
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // ── delete session ───────────────────────────────────────────────────────
  const handleDeleteSession = async (ticketId: string) => {
    try {
      await api.deleteSession(ticketId);
    } catch (err) {
      const e = err as Error;
      if (e.message !== 'AUTH_EXPIRED') {
        console.warn(`[DeleteSession] backend returned: ${e.message}`);
      }
    }
    setSessions(prev => {
      const next = { ...prev };
      delete next[ticketId];
      return next;
    });
    setSidebarList(prev => prev.filter(s => s.ticketId !== ticketId));
    if (activeId === ticketId) {
      setActiveId(null);
    }
  };

  // ── reset session ────────────────────────────────────────────────────────
  const handleReset = useCallback(async (targetId: string) => {
    try {
      await api.resetSession(targetId);
    } catch { /* non-critical — reset local state regardless */ }
    // Backend transitions ticket to "To Do" — mirror that locally so TicketCard
    // shows "Start testing" (isTodo branch) rather than "Re-test" (isInTesting branch).
    setSessions(prev => {
      const s = prev[targetId];
      if (!s) return prev;
      return {
        ...prev,
        [targetId]: {
          ...s,
          phase: 'ticket',
          ticket: s.ticket ? { ...s.ticket, status: 'To Do' as JiraTicket['status'] } : s.ticket,
          scenarios: [], testCases: [], results: [], summary: null,
          executionLogs: [], executionSteps: [], executionProgress: 0, executionCurrentCase: '',
        },
      };
    });
    addMsg(targetId, 'assistant', `Session reset — ticket moved to To Do. Click "Start testing" to begin again.`);
  }, [addMsg, setSessions]);

  // ── render message by payload type (Bug 3 fix: sessId passed to all callbacks) ──
  const renderMessagePayload = (msg: ChatMessage) => {
    if (!msg.payload) return null;
    const sessId = msg.payload.sessionId;
    const sess = sessId ? sessions[sessId] : null;
    if (!sess) return null;

    switch (msg.payload.type) {
      case 'ticket_card':
        return sess.ticket ? (
          <TicketCard
            ticket={sess.ticket}
            onStart={() => handleStartTesting(sessId!)}
            onRetest={() => handleGenerateScenarios(sessId!, 'retest')}
            onAddScenarios={() => handleGenerateScenarios(sessId!, 'add')}
          />
        ) : null;

      case 'discovery_card':
        return sess.discovery ? (
          <DiscoveryCard
            info={sess.discovery}
            onContinue={() => handleGenerateScenarios(sessId!, 'fresh')}
            onRecrawl={async () => {
              mutateSession(sessId!, {
                discovery: { status: 'crawling', progress: 10, progressMessage: 'Launching browser and logging in...' },
              });
              try {
                const live = await api.runDiscovery(sessId!);
                if ((live as any).pending) {
                  mutateSession(sessId!, { discovery: { status: 'crawling', progress: 80, progressMessage: 'Background discovery still running — check back in 30s.' } });
                  addMsg(sessId!, 'assistant', 'Discovery is still running in the background. Wait 30 seconds, then continue.');
                } else {
                  mutateSession(sessId!, {
                    discovery: {
                      status: 'cache_hit',
                      cacheAge: live.discovery.age,
                      elementCount: live.discovery.elementCount,
                      sampleSelectors: live.discovery.sampleSelectors,
                    },
                  });
                }
              } catch (discErr) {
                mutateSession(sessId!, { discovery: { status: 'failed' } });
                addMsg(sessId!, 'assistant', `Live discovery failed: ${(discErr as Error).message}`);
              }
            }}
          />
        ) : null;

      case 'scenarios_card':
        return (
          <ScenariosCard
            scenarios={sess.scenarios}
            mode={sess.results.length > 0 ? 'retest' : 'fresh'}
            onToggle={(id) => toggleScenario(sessId!, id)}
            onAddCustom={(label) => addCustomScenario(sessId!, label)}
            onGenerate={() => handleGenerateTestCases(sessId!)}
            onBack={() => mutateSession(sessId!, { phase: 'discovery' })}
          />
        );

      case 'testcases_card':
        return (
          <TestCasesCard
            testCases={sess.testCases}
            onUpdate={(id, name) => updateTestCase(sessId!, id, name)}
            onDelete={(id) => deleteTestCase(sessId!, id)}
            onAdd={(name) => addTestCase(sessId!, name)}
            onApproveAndRun={() => handleApproveAndRun(sessId!)}
            onBack={() => mutateSession(sessId!, { phase: 'scenarios' })}
            isRunning={sess.phase === 'execution'}
          />
        );

      case 'execution_card':
        return (
          <ExecutionCard
            logs={sess.executionLogs}
            steps={sess.executionSteps}
            progress={sess.executionProgress}
            currentCase={sess.executionCurrentCase}
            iteration={sess.iterationCount}
          />
        );

      case 'results_card':
        return sess.summary ? (
          <ResultsCard
            results={sess.results}
            summary={sess.summary}
            iteration={sess.iterationCount}
            ticketId={sessId}
            hasFailures={sess.results.some(r => {
              const s = String(r.status || '').toLowerCase();
              return s === 'fail' || s === 'failed' || s === 'code_fault' || s === 'fault';
            })}
            onRetest={() => handleRetestFailed(sessId!)}
            onUpload={() => handleUpload(sessId!)}
            onViewReport={() => addMsg(sessId!, 'assistant', 'HTML report and ZIP archive ready. Playwright trace files and screenshots included.')}
          />
        ) : null;

      case 'status_transition':
        return (
          <JiraTransitionPanel
            ticketId={sessId || ''}
            onTransition={(status) => handleTransition(sessId!, status)}
            onKeep={() => addMsg(sessId!, 'assistant', 'Ticket kept in In Testing. Continue testing when ready.')}
          />
        );

      default:
        return null;
    }
  };

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-white dark:bg-gray-950 font-sans text-gray-900 dark:text-white overflow-hidden">
      <Sidebar
        sessions={sidebarList}
        activeId={activeId}
        onSelect={switchSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        onLogout={logout}
        userLabel={user?.email || user?.display_name || user?.id}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* header */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-gray-950 shrink-0">
          <div>
            <span className="text-[13px] font-medium text-gray-900 dark:text-white">
              {activeId ? activeId : 'GoHybridAI'}
            </span>
            {activeSession?.ticket && (
              <span className="ml-2 text-[11px] text-gray-400">
                {activeSession.ticket.summary.slice(0, 48)}{activeSession.ticket.summary.length > 48 ? '...' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {activeSession?.ticket && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: activeSession.ticket.status === 'In Testing' ? '#FAEEDA'
                    : activeSession.ticket.status === 'To Do' ? '#E6F1FB' : '#EAF3DE',
                  color: activeSession.ticket.status === 'In Testing' ? '#854F0B'
                    : activeSession.ticket.status === 'To Do' ? '#0C447C' : '#3B6D11',
                }}
              >
                {activeSession.ticket.status}
              </span>
            )}
            {activeId && activeSession?.phase !== 'idle' && (
              <button
                onClick={() => {
                  if (confirm(`Reset session for ${activeId}? Clears scenarios, test cases, and results.`)) {
                    handleReset(activeId);
                  }
                }}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                title="Reset session"
              >
                <RotateCcw size={16} className="text-gray-500 dark:text-gray-400" />
              </button>
            )}
            <button
              onClick={() => setShowVersionSwitcher(true)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="UI Version Settings"
            >
              <Settings size={16} className="text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* chat timeline */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-12">
              <div className="w-12 h-12 rounded-full border border-gray-200 dark:border-gray-700 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-gray-400">
                  <path d="M10 2a8 8 0 100 16A8 8 0 0010 2z" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              </div>
              <div>
                <p className="text-[13px] font-medium text-gray-700 dark:text-gray-300">Type a Jira ticket to begin</p>
                <p className="text-[12px] text-gray-400 mt-1">e.g. <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-[11px]">ATT-22</code> or <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-[11px]">Test ATT-15</code></p>
              </div>
              <div className="flex gap-2 flex-wrap justify-center">
                {['ATT-22', 'ATT-15', 'ATT-08'].map(t => (
                  <button key={t} onClick={() => { setInputValue(t); inputRef.current?.focus(); }}
                    className="text-[11px] px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 font-mono transition-colors">
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Session start divider — shows when the first message was sent */}
          {messages.length > 0 && messages[0].timestamp && (
            <div className="flex items-center gap-3 my-2 select-none">
              <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
              <span className="text-[10px] text-gray-400 shrink-0">
                {formatSessionDate(messages[0].timestamp)}
              </span>
              <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className="relative">
              {msg.role === 'user' ? (
                <UserBubble content={msg.content} timestamp={msg.timestamp} />
              ) : msg.payload ? (
                <div className="flex justify-start">
                  <div className="w-full max-w-lg relative">
                    {msg.content && <AssistantBubble content={msg.content} timestamp={msg.timestamp} />}
                    <div className="mt-2">
                      {renderMessagePayload(msg)}
                    </div>
                    <button
                      onClick={() => deleteMessage(activeId!, msg.id)}
                      className="absolute top-0 right-0 p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      title="Dismiss"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-gray-400">
                        <path d="M10.5 3.5L3.5 10.5M3.5 3.5l7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ) : (
                <AssistantBubble content={msg.content} timestamp={msg.timestamp} />
              )}
            </div>
          ))}

          {isTyping && <TypingIndicator />}
          <div ref={chatEndRef} />
        </div>

        {/* input bar */}
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 shrink-0">
          <div className="flex gap-2 items-center">
            <input
              ref={inputRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Type a ticket ID or ask anything..."
              className="flex-1 text-[13px] px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:border-gray-400 dark:focus:border-gray-500 transition-colors"
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className="px-4 py-2.5 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[12px] font-medium hover:opacity-85 transition-opacity disabled:opacity-30"
            >
              Send
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 pl-1">
            Enter to send · Ticket IDs auto-detected · WebSocket streams live execution logs
          </p>
        </div>
      </div>

      {/* Version Switcher Modal */}
      {showVersionSwitcher && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowVersionSwitcher(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 max-w-md w-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">UI Version</h3>
              <button
                onClick={() => setShowVersionSwitcher(false)}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-500">
                  <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Switch between UI versions. Your preference is saved.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'v1', label: 'V1 (Current)', desc: 'Stable React build', icon: Monitor },
                { id: 'v2', label: 'V2 (New Design)', desc: 'Prototype with new UI', icon: Sparkles },
              ].map(opt => {
                const isActive = localStorage.getItem('ui-version') === opt.id ||
                  (!localStorage.getItem('ui-version') && opt.id === 'v1');
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      localStorage.setItem('ui-version', opt.id);
                      if (opt.id === 'v2') {
                        window.location.href = '/v2/GoHybrid.html';
                      } else {
                        window.location.href = '/';
                      }
                    }}
                    className={`p-4 rounded-xl border-2 transition-all text-left ${
                      isActive
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <opt.icon size={18} className={isActive ? 'text-blue-500' : 'text-gray-400'} />
                      <span className="font-medium text-sm text-gray-900 dark:text-white">{opt.label}</span>
                      {isActive && <CheckCircle2 size={14} className="text-blue-500 ml-auto" />}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
