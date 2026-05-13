import { useState, useRef } from 'react';
import type { TestCase, TestResult, TestResultStatus, ExecutionSummary } from '../types';
import type { ExecutionStepEvent } from '../hooks/useExecutionWebSocket';
import { PhaseStepper, RESULT_STYLE } from './GoHybridChat.part1';
import { apiUrl } from '../hooks/useApi';

// ─── test cases card ──────────────────────────────────────────────────────────
interface TestCasesCardProps {
  testCases: TestCase[];
  onUpdate: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAdd: (name: string) => void;
  onApproveAndRun: () => void;
  onBack: () => void;
  isRunning?: boolean;
}

export function TestCasesCard({ testCases, onUpdate, onDelete, onAdd, onApproveAndRun, onBack, isRunning = false }: TestCasesCardProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newName, setNewName] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const startEdit = (tc: TestCase) => {
    setEditingId(tc.id);
    setEditValue(tc.name);
  };
  const commitEdit = (id: string) => {
    if (editValue.trim()) onUpdate(id, editValue.trim());
    setEditingId(null);
  };

  const handleAdd = () => {
    const v = newName.trim();
    if (!v) return;
    onAdd(v);
    setNewName('');
  };

  const uniqueCases = Array.from(new Map(testCases.map(tc => [tc.id, tc])).values());

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-900 w-full max-w-lg">
      <PhaseStepper phase="testcases" />
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] font-medium text-gray-900 dark:text-white">{uniqueCases.length} test cases generated</span>
          <span className="text-[11px] text-gray-400">Review, edit or delete before running</span>
        </div>

        <div className="space-y-1.5 mb-3 max-h-96 overflow-y-auto">
          {uniqueCases.map(tc => (
            <div key={tc.id} className="rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 overflow-hidden">
              {/* ── header row ── */}
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-[10px] text-gray-400 font-mono min-w-[48px] shrink-0">{tc.id}</span>

                {editingId === tc.id ? (
                  <input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(tc.id); if (e.key === 'Escape') setEditingId(null); }}
                    className="flex-1 text-[12px] px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 outline-none"
                    autoFocus
                  />
                ) : (
                  <span className="flex-1 text-[12px] text-gray-800 dark:text-gray-200 leading-snug">{tc.name}</span>
                )}

                <div className="flex gap-1 shrink-0">
                  {tc.steps && tc.steps.length > 0 && editingId !== tc.id && (
                    <button
                      onClick={() => setExpandedId(expandedId === tc.id ? null : tc.id)}
                      className="text-[10px] px-2 py-0.5 rounded border border-blue-100 dark:border-blue-900 text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                    >
                      {expandedId === tc.id ? 'hide' : `${tc.steps.length} steps`}
                    </button>
                  )}
                  {editingId === tc.id ? (
                    <>
                      <button onClick={() => commitEdit(tc.id)} className="text-[10px] px-2 py-0.5 rounded border border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-950 transition-colors">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-[10px] px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startEdit(tc)} className="text-[10px] px-2 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">Edit</button>
                      <button onClick={() => onDelete(tc.id)} className="text-[10px] px-2 py-0.5 rounded border border-red-100 dark:border-red-900 text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors">Delete</button>
                    </>
                  )}
                </div>
              </div>

              {/* ── expandable steps ── */}
              {expandedId === tc.id && tc.steps && tc.steps.length > 0 && (
                <div className="px-3 pb-3 pt-1 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900/60">
                  <div className="space-y-2 mt-1">
                    {tc.steps.map((step, idx) => (
                      <div key={step.id || idx} className="flex gap-2">
                        <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-[9px] font-mono text-gray-500">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] text-gray-700 dark:text-gray-300 leading-snug">{step.action}</div>
                          {step.assertValue && (
                            <div className="text-[10px] text-gray-400 dark:text-gray-500 italic mt-0.5">
                              Verify: {step.assertValue}
                            </div>
                          )}
                          {step.element && !step.assertValue && (
                            <div className="text-[10px] text-gray-400 dark:text-gray-500 font-mono mt-0.5 truncate">
                              {step.element}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2 mb-4">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Add new test case..."
            className="flex-1 text-[12px] px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:border-gray-400"
          />
          <button onClick={handleAdd} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 shrink-0 transition-colors">
            Add
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onApproveAndRun}
            disabled={isRunning}
            className={`px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[12px] font-medium transition-opacity ${isRunning ? 'opacity-40 cursor-not-allowed' : 'hover:opacity-85'}`}
          >
            {isRunning ? 'Running...' : 'Approve and run'}
          </button>
          <button onClick={onBack} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── execution card ───────────────────────────────────────────────────────────
interface ExecutionCardProps {
  logs: string[];
  steps: ExecutionStepEvent[];
  progress: number;
  currentCase: string;
  iteration: number;
}

export function ExecutionCard({ logs, steps, progress, currentCase, iteration }: ExecutionCardProps) {
  const logRef = useRef<HTMLDivElement>(null);

  const getLineStyle = (line: string) => {
    if (line.includes('PASSED') || line.includes('✓')) return 'text-green-600 dark:text-green-400';
    if (line.includes('FAILED') || line.includes('✗') || line.includes('Error')) return 'text-red-500 dark:text-red-400';
    if (line.includes('healed') || line.includes('⚠') || line.includes('FAULT')) return 'text-amber-600 dark:text-amber-400';
    return 'text-gray-500 dark:text-gray-400';
  };

  const getStepTone = (kind: ExecutionStepEvent['kind']) => {
    if (kind.endsWith('.fail')) return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900';
    if (kind.endsWith('.pass')) return 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900';
    if (kind.startsWith('heal.')) return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900';
    if (kind === 'artifact') return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900';
    return 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-900 w-full max-w-lg">
      <PhaseStepper phase="execution" />
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] font-medium text-gray-900 dark:text-white">
            Running Playwright tests
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
            iter {iteration}
          </span>
        </div>

        <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full mb-2 overflow-hidden">
          <div className="h-full bg-gray-900 dark:bg-white rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="text-[11px] text-gray-400 mb-3">{currentCase}</div>

        <div className="mb-3 space-y-1.5 max-h-40 overflow-y-auto">
          {steps.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-800 px-3 py-2 text-[11px] text-gray-400">
              Waiting for structured execution events...
            </div>
          ) : (
            steps.slice(-8).map((step, i) => (
              <div key={`${step.ts}-${i}`} className="rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2 bg-gray-50/70 dark:bg-gray-950/60">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${getStepTone(step.kind)}`}>
                    {step.kind}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {step.caseId || currentCase || 'execution'}
                    {typeof step.stepNumber === 'number' ? ` • step ${step.stepNumber}` : ''}
                  </span>
                </div>
                <div className="text-[11px] text-gray-700 dark:text-gray-300 leading-snug">{step.message}</div>
                {step.artifactPath && (
                  <div className="mt-1 text-[10px] text-blue-600 dark:text-blue-400 font-mono break-all">
                    {step.artifactType || 'artifact'}: {step.artifactPath}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div
          ref={logRef}
          className="bg-gray-50 dark:bg-gray-950 rounded-lg p-3 h-28 overflow-y-auto font-mono text-[10px] space-y-0.5"
        >
          {logs.length === 0 ? (
            <span className="text-gray-400">Waiting for Playwright output...</span>
          ) : (
            logs.slice(-60).map((line, i) => (
              <div key={i} className={getLineStyle(line)}>{line}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── results card ─────────────────────────────────────────────────────────────
interface ResultsCardProps {
  results: TestResult[];
  summary: ExecutionSummary;
  iteration: number;
  onRetest: () => void;
  onUpload: () => void;
  onViewReport: () => void;
  hasFailures: boolean;
  ticketId?: string;
}

export function ResultsCard({ results, summary, iteration, onRetest, onUpload, onViewReport, hasFailures, ticketId }: ResultsCardProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-900 w-full max-w-lg">
      <PhaseStepper phase="results" />
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] font-medium text-gray-900 dark:text-white">Execution results</span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">iter {iteration}</span>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          {([['passed', summary.passed, 'text-green-600'], ['failed', summary.failed, 'text-red-500'], ['code faults', summary.codeFaults, 'text-amber-600']] as const).map(([lbl, num, col]) => (
            <div key={lbl} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5 text-center">
              <div className={`text-[22px] font-medium ${col}`}>{num}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{lbl}</div>
            </div>
          ))}
        </div>

        <div className="space-y-1 mb-4 max-h-44 overflow-y-auto">
          {results.map(r => {
            const style = RESULT_STYLE[r.status] || RESULT_STYLE.PENDING;
            const isExpanded = expandedId === r.caseId;
            return (
              <div key={r.caseId}>
                <div 
                  className="flex items-start gap-2.5 py-1.5 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : r.caseId)}
                >
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0 mt-0.5 min-w-[36px] text-center ${style.bg}`}>{style.label}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-gray-800 dark:text-gray-200 leading-snug">
                      {(r as any).caseName || (r as any).testCaseTitle || (r as any).caseId || (r as any).testCaseId || 'Unknown'}
                    </div>
                    {r.forensicNote && (
                      <div className="text-[10px] text-gray-400 mt-0.5 leading-snug">{r.forensicNote}</div>
                    )}
                    {r.screenshotPath && (r.status === 'FAIL' || r.status === 'CODE_FAULT') && ticketId && (
                      <a
                        href={`${apiUrl}/api/testing/${ticketId}/screenshot/${r.caseId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 mt-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
                        onClick={e => e.stopPropagation()}
                      >
                        <span className="text-[10px]">[screenshot]</span>
                      </a>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-400 shrink-0">
                    {typeof r.duration === 'number' ? `${r.duration}ms` : r.duration}
                  </span>
                  {r.steps && r.steps.length > 0 && (
                    <span className="text-[10px] text-gray-400 shrink-0">{isExpanded ? '[-]' : `[${r.steps.length}]`}</span>
                  )}
                </div>
                {isExpanded && r.steps && r.steps.length > 0 && (
                  <div className="ml-8 mt-1 space-y-1 border-l border-gray-200 dark:border-gray-700 pl-2">
                    {r.steps.map(s => (
                      <div key={s.stepNumber} className="flex items-start gap-2 py-1 px-2 rounded bg-gray-50 dark:bg-gray-800/50">
                        <span className="text-[9px] text-gray-500 shrink-0 w-4">{s.stepNumber}.</span>
                        <span className="text-[10px] text-gray-700 dark:text-gray-300 flex-1">{s.action}</span>
                        <span className={`text-[9px] shrink-0 ${s.status === 'PASS' ? 'text-green-600' : 'text-red-500'}`}>{s.status}</span>
                        <span className="text-[9px] text-gray-400 shrink-0">{s.duration}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 flex-wrap">
          {hasFailures && (
            <button onClick={onRetest} className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 text-[12px] font-medium hover:opacity-85 transition-opacity">
              Re-test failed + faults
            </button>
          )}
          <button onClick={onUpload} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Upload to Jira
          </button>
          <button onClick={onViewReport} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            View report
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── jira transition panel ────────────────────────────────────────────────────
interface JiraTransitionProps {
  ticketId: string;
  onTransition: (status: string) => void;
  onKeep: () => void;
}
export function JiraTransitionPanel({ ticketId, onTransition, onKeep }: JiraTransitionProps) {
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-900 w-full max-w-lg">
      <p className="text-[12px] text-gray-600 dark:text-gray-300 mb-3">
        Results uploaded to <span className="font-mono text-blue-600 dark:text-blue-400">{ticketId}</span>. ADF table + screenshots attached. Transition ticket status?
      </p>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => onTransition('Done')} className="px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800 text-[12px] font-medium hover:opacity-85 transition-opacity">
          Mark as Done
        </button>
        <button onClick={() => onTransition('Bug Done')} className="px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800 text-[12px] font-medium hover:opacity-85 transition-opacity">
          Mark as Bug Done
        </button>
        <button onClick={onKeep} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          Keep In Testing
        </button>
      </div>
    </div>
  );
}

// ─── sidebar ──────────────────────────────────────────────────────────────────
import type { SidebarSession } from '../types';
import { STATUS_DOT } from './GoHybridChat.part1';
import { Trash2, Plus, LogOut } from 'lucide-react';

function formatSidebarTime(d: Date): string {
  try {
    const now = new Date();
    const date = d instanceof Date ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

interface SidebarProps {
  sessions: SidebarSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (ticketId: string) => void;
  onLogout: () => void;
  userLabel?: string;
}
export function Sidebar({ sessions, activeId, onSelect, onNewChat, onDeleteSession, onLogout, userLabel }: SidebarProps) {
  return (
    <div className="w-52 min-w-52 border-r border-gray-100 dark:border-gray-800 flex flex-col bg-gray-50/50 dark:bg-gray-900/50">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="text-[13px] font-medium text-gray-900 dark:text-white">GoHybridAI</div>
        <div className="text-[11px] text-gray-400 mt-0.5">Playwright + Jira</div>
      </div>

      {/* New Chat */}
      <div className="px-2 pt-2">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-[12px] font-medium text-gray-800 dark:text-gray-200"
          title="Start a new chat"
        >
          <Plus size={14} /> New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {sessions.length === 0 && (
          <div className="px-2 py-6 text-center text-[11px] text-gray-400">
            No sessions yet. Type a ticket ID (e.g. ATT-22) below to begin.
          </div>
        )}
        {sessions.map(s => {
          const isActive = s.ticketId === activeId;
          return (
            <div
              key={s.ticketId}
              className={`group w-full flex items-start gap-1 rounded-lg transition-colors ${
                isActive
                  ? 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700'
                  : 'hover:bg-white/60 dark:hover:bg-gray-800/60'
              }`}
            >
              <button
                onClick={() => onSelect(s.ticketId)}
                className="flex-1 text-left px-2.5 py-2 min-w-0"
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: STATUS_DOT[s.status] || '#888' }}
                  />
                  <span className="text-[11px] font-medium text-gray-800 dark:text-gray-200">{s.ticketId}</span>
                  <span className="text-[9px] text-gray-400 ml-auto shrink-0">
                    {s.lastActive ? formatSidebarTime(s.lastActive) : ''}
                  </span>
                </div>
                <div className="text-[10px] text-gray-400 truncate pl-3">{s.ticketSummary}</div>
                {(s.iterationCount ?? 0) > 0 && (
                  <div className="pl-3 mt-0.5">
                    <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-400">
                      {s.iterationCount} run{s.iterationCount > 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete session ${s.ticketId}? This clears scenarios, test cases, and results for this ticket.`)) {
                    onDeleteSession(s.ticketId);
                  }
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 mr-1 mt-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                title="Delete session"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {/* User / Logout footer */}
      <div className="border-t border-gray-100 dark:border-gray-800 p-2">
        <div className="px-2 py-1 text-[10px] text-gray-400 truncate">
          {userLabel || 'Signed in'}
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-600 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          title="Log out"
        >
          <LogOut size={12} /> Log out
        </button>
      </div>
    </div>
  );
}
