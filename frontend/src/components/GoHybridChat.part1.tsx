import { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { useExecutionWebSocket } from '../hooks/useExecutionWebSocket';
import { api } from '../hooks/useApi';
import type {
  JiraTicket, TestScenario, TestCase, TestResult, TestResultStatus,
  ExecutionSummary, DiscoveryInfo, PipelinePhase, SidebarSession, ChatMessage,
} from '../types';

// ─── tiny id helper ──────────────────────────────────────────────────────────
let _id = 0;
const uid = () => `m-${++_id}`;

// ─── constants ────────────────────────────────────────────────────────────────
const TICKET_RE = /\b([A-Z]{2,10})-(\d{1,6})\b/gi;
const BOT_PATTERNS = [
  /GoHybrid\s*AI/i, /Auto-transitioned/i, /Testing\s*started/i,
  /Deduplication\s*Check/i, /Testing\s*session\s*aborted/i,
  /previously\s*tested/i, /Test\s*Results\s*for/i,
  /execution\s*completed/i, /Test\s*Summary/i, /report\s*uploaded/i,
];

// ─── status helpers ───────────────────────────────────────────────────────────
const STATUS_DOT: Record<string, string> = {
  'To Do': '#378ADD', 'In Testing': '#EF9F27',
  'Done': '#639922', 'Bug Done': '#639922', 'In Progress': '#EF9F27',
};
const STATUS_BG: Record<string, string> = {
  'To Do': 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'In Testing': 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  'Done': 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  'Bug Done': 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  'In Progress': 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
};
const RESULT_STYLE: Record<string, { bg: string; label: string }> = {
  // Uppercase (legacy backend)
  PASS:       { bg: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',   label: 'PASS' },
  FAIL:       { bg: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',           label: 'FAIL' },
  CODE_FAULT: { bg: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 font-semibold', label: 'CODE FAULT' },
  EXEC_FAULT: { bg: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',   label: 'EXEC FAULT' },
  RUNNING:    { bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',       label: 'RUN' },
  PENDING:    { bg: 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400',       label: '—' },
  // Lowercase (normalised backend)
  pass:       { bg: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',   label: 'PASS' },
  fail:       { bg: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',           label: 'FAIL' },
  code_fault: { bg: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 font-semibold', label: 'CODE FAULT' },
  exec_fault: { bg: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',   label: 'EXEC FAULT' },
  running:    { bg: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',       label: 'RUN' },
  pending:    { bg: 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400',       label: '—' },
};
const TAG_STYLE: Record<string, string> = {
  Happy: 'bg-green-50 text-green-700',
  Negative: 'bg-red-50 text-red-700',
  Edge: 'bg-amber-50 text-amber-700',
  Regression: 'bg-blue-50 text-blue-700',
  Custom: 'bg-purple-50 text-purple-700',
};

// ─── phase stepper ───────────────────────────────────────────────────────────
const PHASES = ['Ticket', 'Discovery', 'Scenarios', 'Cases', 'Run'] as const;
type PhaseLabel = typeof PHASES[number];

const PHASE_MAP: Record<PipelinePhase, PhaseLabel | null> = {
  idle: null, ticket: 'Ticket', discovery: 'Discovery',
  scenarios: 'Scenarios', testcases: 'Cases', execution: 'Run', results: 'Run',
};

function PhaseStepper({ phase }: { phase: PipelinePhase }) {
  const active = PHASE_MAP[phase];
  const ai = active ? PHASES.indexOf(active) : -1;
  return (
    <div className="flex items-center gap-0 px-4 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30">
      {PHASES.map((p, i) => {
        const done = i < ai;
        const cur = i === ai;
        return (
          <div key={p} className="flex items-center">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium shrink-0 ${
              done ? 'bg-green-100 text-green-700' : cur ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
            }`}>
              {done ? '✓' : i + 1}
            </div>
            <span className={`text-[10px] mx-1 ${cur ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-400 dark:text-gray-600'}`}>{p}</span>
            {i < PHASES.length - 1 && <div className="w-4 h-px bg-gray-200 dark:bg-gray-700 mx-1" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── ticket card ─────────────────────────────────────────────────────────────
interface TicketCardProps {
  ticket: JiraTicket;
  onStart: () => void;
  onRetest: () => void;
  onAddScenarios: () => void;
}
function TicketCard({ ticket, onStart, onRetest, onAddScenarios }: TicketCardProps) {
  const statCls = STATUS_BG[ticket.status] || '';
  const isBug = ticket.type === 'Bug';
  const isInTesting = ticket.status === 'In Testing';
  const isTodo = ticket.status === 'To Do';
  const isDone = ticket.status === 'Done' || ticket.status === 'Bug Done';

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-900 w-full max-w-lg">
      <PhaseStepper phase="ticket" />
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${isBug ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
              {ticket.type}
            </span>
            <span className="text-[12px] font-medium text-gray-900 dark:text-white font-mono">{ticket.key}</span>
            {(ticket.iterationCount ?? 0) > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                iter {ticket.iterationCount}
              </span>
            )}
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statCls}`}>{ticket.status}</span>
        </div>

        <p className="text-[13px] font-medium text-gray-900 dark:text-white mb-1.5 leading-snug">{ticket.summary}</p>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
          {ticket.description?.slice(0, 200)}{(ticket.description?.length ?? 0) > 200 ? '...' : ''}
        </p>

        <div className="flex gap-3 flex-wrap mb-3 text-[11px] text-gray-400 dark:text-gray-500">
          <span>Module: <span className="text-gray-600 dark:text-gray-300">{ticket.module}</span></span>
          <span>Priority: <span className="text-gray-600 dark:text-gray-300">{ticket.priority}</span></span>
        </div>

        {/* Linked tickets — chips for Bug / Story / Dev / Tested */}
        {Array.isArray(ticket.linkedTickets) && ticket.linkedTickets.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Linked tickets</p>
            <div className="flex flex-wrap gap-1.5">
              {ticket.linkedTickets.map(lt => {
                const rawDomain = (import.meta.env.VITE_JIRA_DOMAIN as string | undefined) || '';
                // Strip any protocol prefix so we never produce https://https://...
                const jiraDomain = rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
                const url = jiraDomain ? `https://${jiraDomain}/browse/${lt.key}` : null;
                const chipCls =
                  lt.type === 'bug'    ? 'bg-red-50 text-red-700 border-red-100 dark:bg-red-950 dark:text-red-300 dark:border-red-900' :
                  lt.type === 'story'  ? 'bg-purple-50 text-purple-700 border-purple-100 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-900' :
                  lt.type === 'tested' ? 'bg-teal-50 text-teal-700 border-teal-100 dark:bg-teal-950 dark:text-teal-300 dark:border-teal-900' :
                                         'bg-sky-50 text-sky-700 border-sky-100 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-900';
                const label =
                  lt.type === 'bug'    ? 'Bug' :
                  lt.type === 'story'  ? 'Story' :
                  lt.type === 'tested' ? 'Tested' : 'Dev';
                return (
                  <div key={lt.key} className={`flex items-center gap-1 border rounded px-2 py-0.5 text-[10px] ${chipCls}`}>
                    <span className="font-medium opacity-60">{label}</span>
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline">
                        {lt.key}
                      </a>
                    ) : (
                      <span className="font-mono">{lt.key}</span>
                    )}
                    {lt.summary && (
                      <span className="opacity-75 truncate max-w-[160px]" title={lt.summary}>— {lt.summary}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-2 flex-wrap">
          {isTodo && (
            <button onClick={onStart} className="px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[12px] font-medium hover:opacity-85 transition-opacity">
              Start testing
            </button>
          )}
          {isInTesting && (
            <>
              <button onClick={onRetest} className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 text-[12px] font-medium hover:opacity-85 transition-opacity">
                Re-test failed + code faults
              </button>
              <button onClick={onAddScenarios} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                Add scenarios
              </button>
            </>
          )}
          {isDone && (
            <span className="text-[11px] text-gray-400 italic">Testing complete — results logged in Jira</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── discovery card ───────────────────────────────────────────────────────────
function DiscoveryCard({ info, onContinue, onRecrawl }: {
  info: DiscoveryInfo;
  onContinue: () => void;
  onRecrawl: () => void;
}) {
  const isCrawling = info.status === 'crawling';
  const isHit = info.status === 'cache_hit';
  const isComplete = info.status === 'complete';
  const showContinue = isHit || isComplete;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-900 w-full max-w-lg">
      <PhaseStepper phase="discovery" />
      <div className="p-4">
        {isHit && (
          <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2 mb-3 text-[11px] text-green-700 dark:text-green-300">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/><path d="M3.5 6l2 2 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            Cache hit — selectors loaded ({info.cacheAge} ago, {info.elementCount} elements verified)
          </div>
        )}
        {(isCrawling || isComplete) && (
          <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 mb-3 text-[11px] ${isComplete ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-300' : 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-300'}`}>
            {isCrawling ? (
              <svg className="animate-spin shrink-0" width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14" strokeDashoffset="5"/></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/><path d="M3.5 6l2 2 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            )}
            {isCrawling ? info.progressMessage || 'Crawling live UI...' : `Discovery complete — ${info.elementCount} elements catalogued`}
          </div>
        )}

        {isCrawling && typeof info.progress === 'number' && (
          <div className="h-1 bg-gray-100 dark:bg-gray-800 rounded-full mb-3 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${info.progress}%` }} />
          </div>
        )}

        {info.sampleSelectors && info.sampleSelectors.length > 0 && (
          <div className="mb-3 text-[11px] text-gray-500 dark:text-gray-400 space-y-1">
            {info.sampleSelectors.slice(0, 3).map(s => (
              <div key={s.selector || s.name} className="flex items-center gap-2">
                <span className="text-gray-400">{s.name}:</span>
                <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-[10px] text-gray-600 dark:text-gray-300">{s.selector}</code>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {showContinue && (
            <button onClick={onContinue} className="px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[12px] font-medium hover:opacity-85 transition-opacity">
              Generate test scenarios
            </button>
          )}
          <button onClick={onRecrawl} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Re-crawl live UI
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── scenarios card ───────────────────────────────────────────────────────────
interface ScenariosCardProps {
  scenarios: TestScenario[];
  mode: 'fresh' | 'retest' | 'add';
  onToggle: (id: string) => void;
  onAddCustom: (label: string) => void;
  onGenerate: () => void;
  onBack: () => void;
}
function ScenariosCard({ scenarios, mode, onToggle, onAddCustom, onGenerate, onBack }: ScenariosCardProps) {
  const [customInput, setCustomInput] = useState('');
  const selected = scenarios.filter(s => s.selected).length;

  const handleAdd = () => {
    const v = customInput.trim();
    if (!v) return;
    onAddCustom(v);
    setCustomInput('');
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-900 w-full max-w-lg">
      <PhaseStepper phase="scenarios" />
      <div className="p-4">
        {mode === 'retest' && (
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 mb-3 text-[11px] text-amber-700 dark:text-amber-300">
            Showing failed + code fault cases from previous iteration. Self-healing enabled.
          </div>
        )}
        {mode === 'add' && (
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
            Add new scenarios below. Previously selected scenarios are pre-checked.
          </div>
        )}

        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium text-gray-900 dark:text-white">
            {mode === 'retest' ? 'Re-test scope' : 'Select scenarios'}
          </span>
          <span className="text-[11px] text-gray-400">{selected} of {scenarios.length} selected</span>
        </div>

        <div className="space-y-1 mb-3">
          {scenarios.map(sc => (
            <label key={sc.id} className="flex items-start gap-2.5 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <input
                type="checkbox"
                checked={sc.selected}
                onChange={() => onToggle(sc.id)}
                className="mt-0.5 shrink-0 rounded"
              />
              <div className="flex-1 min-w-0">
                <span className="text-[12px] text-gray-800 dark:text-gray-200 leading-snug">{sc.label}</span>
                <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded inline-block ${TAG_STYLE[sc.tag] || ''}`}>{sc.tag}</span>
              </div>
            </label>
          ))}
        </div>

        <div className="flex gap-2 mb-4">
          <input
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Add custom scenario or instruction..."
            className="flex-1 text-[12px] px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:border-gray-400 dark:focus:border-gray-500"
          />
          <button onClick={handleAdd} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shrink-0">
            Add
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onGenerate}
            disabled={selected === 0}
            className="px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[12px] font-medium hover:opacity-85 transition-opacity disabled:opacity-40"
          >
            Generate test cases
          </button>
          <button onClick={onBack} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

export type { TicketCardProps, ScenariosCardProps };
export {
  uid, BOT_PATTERNS, TICKET_RE, STATUS_DOT, RESULT_STYLE, TAG_STYLE,
  PhaseStepper, TicketCard, DiscoveryCard, ScenariosCard,
};
