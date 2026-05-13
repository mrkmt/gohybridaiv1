/**
 * SprintRegressionPanel
 *
 * UI for running and monitoring Sprint Regression runs.
 *
 * Features:
 *  - Sprint picker (fetches active sprints from Jira)
 *  - Credential fields for the test user
 *  - "Run Regression" button → POST /api/mcp/sprint/run (202 async)
 *  - Run history table with expandable per-ticket results
 *  - Auto-refresh polling when a run is in progress
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, RefreshCw, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertTriangle, Clock, Zap } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ─── Types ────────────────────────────────────────────────────────────────────

interface JiraSprint {
  id: number | string;
  name: string;
  boardId: number | string;
  state: string;
}

interface SprintRun {
  id: number;
  sprint_id: string;
  sprint_name: string;
  project_key: string;
  total_tickets: number;
  passed: number;
  failed: number;
  skipped: number;
  status: string;
  started_at: string;
  completed_at: string | null;
}

interface TicketResult {
  ticket_id: string;
  ticket_summary: string;
  module_name: string;
  status: string;
  used_saved_script: boolean;
  failure_category: string | null;
  error_message: string | null;
  duration_ms: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusColor = (s: string) => {
  if (s === 'pass' || s === 'done') return '#34d399';
  if (s === 'fail' || s === 'error') return '#f87171';
  if (s === 'running') return '#fbbf24';
  return '#9ca3af';
};

const statusIcon = (s: string) => {
  if (s === 'pass' || s === 'done') return <CheckCircle2 size={14} />;
  if (s === 'fail' || s === 'error') return <XCircle size={14} />;
  if (s === 'running') return <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />;
  return <Clock size={14} />;
};

// ─── Component ────────────────────────────────────────────────────────────────

export const SprintRegressionPanel: React.FC = () => {
  // Form state
  const [sprints, setSprints]           = useState<JiraSprint[]>([]);
  const [selectedSprint, setSelectedSprint] = useState('');
  const [baseUrl, setBaseUrl]           = useState(import.meta.env.VITE_APP_URL || '');
  const [username, setUsername]         = useState('');
  const [password, setPassword]         = useState('');
  const [idNumber, setIdNumber]         = useState('');
  const [concurrency, setConcurrency]   = useState(3);
  const [running, setRunning]           = useState(false);
  const [runError, setRunError]         = useState('');

  // History state
  const [runs, setRuns]                 = useState<SprintRun[]>([]);
  const [expandedRun, setExpandedRun]   = useState<number | null>(null);
  const [runDetail, setRunDetail]       = useState<{ run: SprintRun; results: TicketResult[] } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSprints = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/mcp/sprint/active`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setSprints(json.data ?? []);
        if (json.data?.length > 0 && !selectedSprint) {
          setSelectedSprint(String(json.data[0].id));
        }
      }
    } catch {}
  }, [selectedSprint]);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/mcp/sprint/runs?limit=10`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setRuns(json.data ?? []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchSprints();
    fetchRuns();
  }, [fetchSprints, fetchRuns]);

  // Poll while any run is 'running'
  useEffect(() => {
    const hasActive = runs.some(r => r.status === 'running');
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(fetchRuns, 5000);
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [runs, fetchRuns]);

  const handleRun = async () => {
    if (!selectedSprint || !baseUrl || !username || !password) {
      setRunError('Please fill in sprint, base URL, username, and password.');
      return;
    }
    setRunError('');
    setRunning(true);
    try {
      const res = await fetch(`${API_URL}/api/mcp/sprint/run`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sprintId: selectedSprint,
          baseUrl,
          username,
          password,
          idNumber: idNumber || undefined,
          concurrency,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setRunError(json.error ?? 'Failed to start regression run.');
      } else {
        await fetchRuns();
      }
    } catch (e: any) {
      setRunError(e.message ?? 'Network error');
    } finally {
      setRunning(false);
    }
  };

  const handleExpandRun = async (runId: number) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
      setRunDetail(null);
      return;
    }
    setExpandedRun(runId);
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API_URL}/api/mcp/sprint/runs/${runId}`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setRunDetail(json.data);
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    padding: '8px 12px',
    color: 'inherit',
    fontSize: '13px',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Zap size={20} style={{ color: '#f59e0b' }} />
        <h3 style={{ margin: 0, fontSize: '18px' }}>Sprint Regression</h3>
        <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto' }}>
          Run all tickets in a sprint; reuses saved scripts, posts results to Jira
        </span>
      </div>

      {/* Config form */}
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {/* Sprint picker */}
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>Sprint</label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <select value={selectedSprint} onChange={e => setSelectedSprint(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                <option value="">— Select sprint —</option>
                {sprints.map(s => (
                  <option key={s.id} value={String(s.id)}>{s.name}</option>
                ))}
              </select>
              <button onClick={fetchSprints} style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', color: '#9ca3af' }} title="Refresh sprints">
                <RefreshCw size={13} />
              </button>
            </div>
          </div>

          {/* Base URL */}
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>App Base URL</label>
            <input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://test.example.com/app" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="test@example.com" style={inputStyle} />
          </div>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>ID Number (optional)</label>
            <input type="text" value={idNumber} onChange={e => setIdNumber(e.target.value)} placeholder="EMP-001" style={inputStyle} />
          </div>
          <div style={{ flex: '0 0 100px' }}>
            <label style={{ fontSize: '12px', color: '#9ca3af', display: 'block', marginBottom: '4px' }}>Concurrency</label>
            <input type="number" min={1} max={10} value={concurrency} onChange={e => setConcurrency(Number(e.target.value))} style={inputStyle} />
          </div>
        </div>

        {runError && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', padding: '8px 12px', color: '#f87171', fontSize: '13px', display: 'flex', gap: '6px', alignItems: 'center' }}>
            <AlertTriangle size={14} /> {runError}
          </div>
        )}

        <button
          onClick={handleRun}
          disabled={running}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center',
            background: running ? 'rgba(245,158,11,0.3)' : 'rgba(245,158,11,0.2)',
            border: '1px solid rgba(245,158,11,0.4)',
            borderRadius: '8px', padding: '10px 20px',
            cursor: running ? 'not-allowed' : 'pointer',
            color: '#fbbf24', fontWeight: 600, fontSize: '14px',
          }}
        >
          <Play size={14} />
          {running ? 'Starting…' : 'Run Sprint Regression'}
        </button>
      </div>

      {/* Run history */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <h4 style={{ margin: 0, fontSize: '14px', color: '#9ca3af' }}>Recent Runs</h4>
          <button onClick={fetchRuns} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}><RefreshCw size={12} /></button>
        </div>

        {runs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#6b7280', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
            No regression runs yet. Configure a sprint and click Run.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {runs.map(run => {
              const isExpanded = expandedRun === run.id;
              const passRate = run.total_tickets > 0 ? Math.round((run.passed / run.total_tickets) * 100) : 0;
              return (
                <div key={run.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', overflow: 'hidden' }}>
                  {/* Run row */}
                  <div
                    onClick={() => handleExpandRun(run.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', cursor: 'pointer' }}
                  >
                    <span style={{ color: statusColor(run.status) }}>{statusIcon(run.status)}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>{run.sprint_name}</div>
                      <div style={{ fontSize: '11px', color: '#6b7280' }}>{new Date(run.started_at).toLocaleString()}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', fontSize: '12px' }}>
                      <span style={{ color: '#34d399' }}>✅ {run.passed}</span>
                      <span style={{ color: '#f87171' }}>❌ {run.failed}</span>
                      <span style={{ color: '#9ca3af' }}>⏭ {run.skipped}</span>
                      <span style={{ color: '#fbbf24', fontWeight: 600 }}>{passRate}%</span>
                    </div>
                    <span style={{ color: '#6b7280' }}>{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '12px 14px' }}>
                      {loadingDetail ? (
                        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '12px' }}>Loading…</div>
                      ) : runDetail?.results?.length ? (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                          <thead>
                            <tr style={{ color: '#6b7280' }}>
                              {['Ticket', 'Summary', 'Module', 'Status', 'Source', 'Failure', 'Duration'].map(h => (
                                <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {runDetail.results.map(r => (
                              <tr key={r.ticket_id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                <td style={{ padding: '6px 8px', color: '#a78bfa', fontWeight: 600 }}>{r.ticket_id}</td>
                                <td style={{ padding: '6px 8px', color: '#e5e7eb', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.ticket_summary}>{r.ticket_summary}</td>
                                <td style={{ padding: '6px 8px', color: '#9ca3af' }}>{r.module_name ?? '-'}</td>
                                <td style={{ padding: '6px 8px', color: statusColor(r.status), fontWeight: 600 }}>{r.status.toUpperCase()}</td>
                                <td style={{ padding: '6px 8px', color: r.used_saved_script ? '#34d399' : '#818cf8' }}>{r.used_saved_script ? '♻️ cached' : '🤖 generated'}</td>
                                <td style={{ padding: '6px 8px', color: '#f87171' }}>{r.failure_category ?? '-'}</td>
                                <td style={{ padding: '6px 8px', color: '#6b7280' }}>{r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div style={{ color: '#6b7280', textAlign: 'center', padding: '8px' }}>No results yet (run may still be in progress).</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
