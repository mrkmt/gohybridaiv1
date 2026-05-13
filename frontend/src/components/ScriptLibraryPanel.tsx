/**
 * ScriptLibraryPanel
 *
 * Displays the DB-backed Script Library — saved Playwright scripts that
 * passed on first execution and can be reused by Sprint Regression without
 * re-calling the AI.
 *
 * Features:
 *  - Stats bar (total / passing / failing / modules)
 *  - Filterable + paginated table
 *  - Delete button per row
 *  - Expandable script viewer
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Library, CheckCircle2, XCircle, Trash2, RefreshCw, ChevronDown, ChevronUp, Code } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SavedScript {
  id: number;
  ticketId: string;
  scenarioId: string;
  moduleName: string | null;
  script: string;
  selectorHash: string | null;
  status: string;
  runCount: number;
  lastRunAt: string;
  createdAt: string;
}

interface Stats {
  total: number;
  passing: number;
  failing: number;
  modules: string[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ScriptLibraryPanel: React.FC = () => {
  const [stats, setStats]           = useState<Stats>({ total: 0, passing: 0, failing: 0, modules: [] });
  const [scripts, setScripts]       = useState<SavedScript[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(0);
  const [filterModule, setFilterModule] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [expanded, setExpanded]     = useState<Set<number>>(new Set());
  const [loading, setLoading]       = useState(false);
  const [deleting, setDeleting]     = useState<string | null>(null);
  const limit = 10;

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/mcp/scripts/stats`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setStats(json.data ?? { total: 0, passing: 0, failing: 0, modules: [] });
      }
    } catch {}
  }, []);

  const fetchScripts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(page * limit),
        ...(filterModule ? { module: filterModule } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
      });
      const res = await fetch(`${API_URL}/api/mcp/scripts?${params}`, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setScripts(json.data ?? []);
        setTotal(json.meta?.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [page, filterModule, filterStatus]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    fetchScripts();
  }, [fetchScripts]);

  const handleDelete = async (ticketId: string, scenarioId: string) => {
    const key = `${ticketId}/${scenarioId}`;
    if (!window.confirm(`Delete saved script for ${key}?`)) return;
    setDeleting(key);
    try {
      await fetch(`${API_URL}/api/mcp/scripts/${ticketId}/${encodeURIComponent(scenarioId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await fetchStats();
      await fetchScripts();
    } finally {
      setDeleting(null);
    }
  };

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Library size={20} style={{ color: '#7c3aed' }} />
        <h3 style={{ margin: 0, fontSize: '18px' }}>Script Library</h3>
        <span style={{ fontSize: '12px', color: '#9ca3af', marginLeft: 'auto' }}>
          Saved passing scripts — reused by Sprint Regression without AI calls
        </span>
        <button
          onClick={() => { fetchStats(); fetchScripts(); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {[
          { label: 'Total', value: stats.total, color: '#6366f1' },
          { label: 'Passing', value: stats.passing, color: '#10b981', Icon: CheckCircle2 },
          { label: 'Failing', value: stats.failing, color: '#ef4444', Icon: XCircle },
          { label: 'Modules', value: stats.modules.length, color: '#f59e0b' },
        ].map(({ label, value, color, Icon }) => (
          <div key={label} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px', padding: '10px 16px', flex: '1 1 80px', minWidth: '80px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color, marginBottom: '4px' }}>
              {Icon && <Icon size={14} />}
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <select
          value={filterModule}
          onChange={e => { setFilterModule(e.target.value); setPage(0); }}
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', padding: '6px 10px', color: 'inherit', fontSize: '13px' }}
        >
          <option value="">All Modules</option>
          {stats.modules.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => { setFilterStatus(e.target.value); setPage(0); }}
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', padding: '6px 10px', color: 'inherit', fontSize: '13px' }}
        >
          <option value="">All Status</option>
          <option value="PASS">PASS</option>
          <option value="FAIL">FAIL</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af' }}>Loading…</div>
      ) : scripts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px', color: '#6b7280', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
          <Library size={32} style={{ marginBottom: '8px', opacity: 0.4 }} />
          <p style={{ margin: 0 }}>No scripts saved yet. Run a ticket to populate the library.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {scripts.map(s => {
            const key = `${s.ticketId}/${s.scenarioId}`;
            const isExpanded = expanded.has(s.id);
            return (
              <div key={s.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', overflow: 'hidden' }}>
                {/* Row header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px' }}>
                  <span style={{ fontWeight: 600, fontSize: '13px', color: '#a78bfa', minWidth: '80px' }}>{s.ticketId}</span>
                  <span style={{ fontSize: '12px', color: '#9ca3af', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.scenarioId}</span>
                  {s.moduleName && (
                    <span style={{ fontSize: '11px', background: 'rgba(99,102,241,0.15)', color: '#818cf8', borderRadius: '4px', padding: '2px 6px' }}>{s.moduleName}</span>
                  )}
                  <span style={{
                    fontSize: '11px', fontWeight: 600, borderRadius: '4px', padding: '2px 8px',
                    background: s.status === 'PASS' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                    color: s.status === 'PASS' ? '#34d399' : '#f87171',
                  }}>{s.status}</span>
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>×{s.runCount}</span>
                  <button onClick={() => toggleExpand(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px' }}>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button
                    onClick={() => handleDelete(s.ticketId, s.scenarioId)}
                    disabled={deleting === key}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '2px', opacity: deleting === key ? 0.5 : 1 }}
                    title="Delete this script"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Expanded script */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: '#9ca3af', fontSize: '12px' }}>
                      <Code size={12} />
                      <span>Playwright Script — last run {new Date(s.lastRunAt).toLocaleString()}</span>
                    </div>
                    <pre style={{
                      margin: 0, padding: '12px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px',
                      fontSize: '11px', lineHeight: '1.5', overflow: 'auto', maxHeight: '300px',
                      color: '#e2e8f0', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>{s.script}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', alignItems: 'center' }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', color: 'inherit', opacity: page === 0 ? 0.4 : 1 }}>‹</button>
          <span style={{ fontSize: '13px', color: '#9ca3af' }}>Page {page + 1} of {totalPages} ({total} total)</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '4px', padding: '4px 10px', cursor: 'pointer', color: 'inherit', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>›</button>
        </div>
      )}
    </div>
  );
};
