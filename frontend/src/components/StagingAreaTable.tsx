import React, { useState, useEffect } from 'react';
import { CheckCircle2, Trash2, ShieldAlert } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface StagingRule {
    id: string;
    Module: string;
    SubModule: string;
    Keywords: string[];
    FormulaRule: string;
    ExpectedUIBehavior: string;
    confidenceScore: number;
}

interface StagingAreaTableProps {
    onActionComplete: () => void;
    showMessage: (msg: string, isError?: boolean) => void;
}

export function StagingAreaTable({ onActionComplete, showMessage }: StagingAreaTableProps) {
    const [stagingRules, setStagingRules] = useState<StagingRule[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchStagingRules();
    }, []);

    const fetchStagingRules = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_URL}/api/kb/staging`);
            const data = await res.json();
            setStagingRules(Array.isArray(data) ? data : []);
            // reset selection when data refreshes
            setSelectedIds(new Set());
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            setSelectedIds(new Set(stagingRules.map(r => r.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectRow = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const handleBulkApprove = async () => {
        if (selectedIds.size === 0) return;
        try {
            setLoading(true);
            const res = await fetch(`${API_URL}/api/kb/staging/approve-bulk`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedIds) })
            });
            const data = await res.json();
            if (res.ok) {
                showMessage(data.message);
                fetchStagingRules();
                onActionComplete();
            } else {
                showMessage(data.error || 'Failed to approve bulk rules', true);
            }
        } catch (err) {
            showMessage('Error during bulk approve', true);
        } finally {
            setLoading(false);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!window.confirm(`Are you sure you want to delete ${selectedIds.size} rules?`)) return;

        try {
            setLoading(true);
            const res = await fetch(`${API_URL}/api/kb/staging/bulk`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedIds) })
            });
            const data = await res.json();
            if (res.ok) {
                showMessage(data.message);
                fetchStagingRules();
            } else {
                showMessage(data.error || 'Failed to delete bulk rules', true);
            }
        } catch (err) {
            showMessage('Error during bulk delete', true);
        } finally {
            setLoading(false);
        }
    };

    if (stagingRules.length === 0) return null;

    const allSelected = stagingRules.length > 0 && selectedIds.size === stagingRules.length;

    return (
        <div className="panel glass" style={{ padding: '0', overflow: 'hidden', marginTop: '2rem', border: '1px solid var(--accent-amber)' }}>
            <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(245, 158, 11, 0.05)' }}>
                <div>
                    <h3 style={{ color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ShieldAlert size={18} /> STAGING AREA (TRIAGE)
                    </h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                        Rules extracted by the LLM with Confidence &lt;= 90%. Review, approve, or delete them before they enter the active matrix.
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        className="btn-primary"
                        style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        disabled={loading || selectedIds.size === 0}
                        onClick={handleBulkApprove}
                    >
                        <CheckCircle2 size={16} /> APPROVE SELECTED ({selectedIds.size})
                    </button>
                    <button
                        className="btn-primary"
                        style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px', background: 'transparent', border: '1px solid var(--accent-rose)', color: 'var(--accent-rose)' }}
                        disabled={loading || selectedIds.size === 0}
                        onClick={handleBulkDelete}
                    >
                        <Trash2 size={16} /> DELETE SELECTED
                    </button>
                </div>
            </div>

            <div className="table-wrapper" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-sidebar)', zIndex: 10 }}>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-glass)' }}>
                            <th style={{ padding: '12px', width: '5%', textAlign: 'center' }}>
                                <input
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={handleSelectAll}
                                    style={{ cursor: 'pointer' }}
                                />
                            </th>
                            <th style={{ padding: '12px', width: '15%' }}>Module</th>
                            <th style={{ padding: '12px', width: '10%' }}>AI Score</th>
                            <th style={{ padding: '12px', width: '25%' }}>Formula / Active Rule</th>
                            <th style={{ padding: '12px', width: '30%' }}>Expected UI Behavior</th>
                        </tr>
                    </thead>
                    <tbody>
                        {stagingRules.map(rule => {
                            const isSelected = selectedIds.has(rule.id);
                            const score = rule.confidenceScore || 0;
                            // Badge color logic
                            let badgeStyle = { background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: '1px solid #ef4444' }; // Red < 70
                            if (score >= 70 && score <= 90) badgeStyle = { background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', border: '1px solid #f59e0b' }; // Yellow

                            return (
                                <tr key={rule.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: isSelected ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                                    <td style={{ padding: '12px', textAlign: 'center', verticalAlign: 'top' }}>
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => handleSelectRow(rule.id)}
                                            style={{ cursor: 'pointer' }}
                                        />
                                    </td>
                                    <td style={{ padding: '12px', verticalAlign: 'top' }}>
                                        <strong style={{ color: 'var(--text-light)', display: 'block' }}>{rule.Module}</strong>
                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{rule.SubModule}</span>
                                    </td>
                                    <td style={{ padding: '12px', verticalAlign: 'top' }}>
                                        <span className="badge" style={{ ...badgeStyle, padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem' }}>
                                            {score}%
                                        </span>
                                    </td>
                                    <td style={{ padding: '12px', verticalAlign: 'top', fontFamily: 'monospace', color: '#10b981' }}>
                                        {rule.FormulaRule}
                                    </td>
                                    <td style={{ padding: '12px', verticalAlign: 'top', color: 'var(--text-light)' }}>
                                        {rule.ExpectedUIBehavior}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
