import React, { useState, useEffect } from 'react';
import { Brain, Upload, Trash2, Edit2, CheckCircle2, X, Bug, AlertCircle } from 'lucide-react';
import { StagingAreaTable } from './StagingAreaTable';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface BusinessRule {
    id: string;
    Module: string;
    SubModule: string;
    Keywords: string[];
    FormulaRule: string;
    ExpectedUIBehavior: string;
    status?: string;
    confidenceScore?: number;
    jiraId?: string;
}

export function KnowledgeBaseSettings() {
    const [rules, setRules] = useState<BusinessRule[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Form State
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        Module: '',
        SubModule: '',
        Keywords: '',
        FormulaRule: '',
        ExpectedUIBehavior: ''
    });

    useEffect(() => {
        fetchRules();
    }, []);

    const fetchRules = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_URL}/api/kb/rules`);
            const data = await res.json();
            setRules(Array.isArray(data) ? data : []);
        } catch (err) {
            setError('Failed to fetch rules');
        } finally {
            setLoading(false);
        }
    };

    const showMessage = (msg: string, isError = false) => {
        if (isError) {
            setError(msg);
            setTimeout(() => setError(null), 5000);
        } else {
            setSuccess(msg);
            setTimeout(() => setSuccess(null), 5000);
        }
    };

    const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const uploadData = new FormData();
        uploadData.append('file', file);

        try {
            setLoading(true);
            showMessage('Uploading and extracting rules from Document... This may take a minute.');
            const res = await fetch(`${API_URL}/api/kb/extract`, {
                method: 'POST',
                body: uploadData
            });
            const data = await res.json();

            if (res.ok) {
                showMessage('Knowledge Base extraction complete. Matrix updated!');
                fetchRules();
            } else {
                showMessage(data.error || 'Failed to extract rules', true);
            }
        } catch (err) {
            showMessage('Error uploading document.', true);
        } finally {
            setLoading(false);
        }
    };

    const handleJiraUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const uploadData = new FormData();
        uploadData.append('file', file);

        try {
            setLoading(true);
            showMessage('Processing Jira Functional CSV. This involves deep AI analysis of test cases...');
            const res = await fetch(`${API_URL}/api/jira/ingest`, {
                method: 'POST',
                body: uploadData
            });
            const data = await res.json();

            if (res.ok) {
                showMessage(`Successfully processed Jira tickets. Check the Staging Area or Matrix below!`);
                fetchRules();
            } else {
                showMessage(data.error || 'Failed to process Jira file', true);
            }
        } catch (err) {
            showMessage('Error uploading Jira CSV.', true);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveRule = async () => {
        if (!formData.Module || !formData.FormulaRule || !formData.ExpectedUIBehavior) {
            showMessage('Module, Formula, and Expected Behavior are required.', true);
            return;
        }

        try {
            setLoading(true);
            const url = editingId ? `${API_URL}/api/kb/rules/${editingId}` : `${API_URL}/api/kb/rules`;
            const method = editingId ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                showMessage(editingId ? 'Rule updated successfully' : 'Rule added successfully');
                setEditingId(null);
                setFormData({ Module: '', SubModule: '', Keywords: '', FormulaRule: '', ExpectedUIBehavior: '' });
                fetchRules();
            } else {
                const data = await res.json();
                showMessage(data.error || 'Failed to save rule', true);
            }
        } catch (err) {
            showMessage('Error saving rule.', true);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteRule = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this rule?')) return;
        try {
            const res = await fetch(`${API_URL}/api/kb/rules/${id}`, { method: 'DELETE' });
            if (res.ok) {
                showMessage('Rule deleted');
                fetchRules();
            } else {
                showMessage('Failed to delete rule', true);
            }
        } catch (err) {
            showMessage('Error deleting rule', true);
        }
    };

    const startEdit = (rule: BusinessRule) => {
        setEditingId(rule.id);
        setFormData({
            Module: rule.Module,
            SubModule: rule.SubModule || '',
            Keywords: Array.isArray(rule.Keywords) ? rule.Keywords.join(', ') : rule.Keywords,
            FormulaRule: rule.FormulaRule,
            ExpectedUIBehavior: rule.ExpectedUIBehavior
        });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setFormData({ Module: '', SubModule: '', Keywords: '', FormulaRule: '', ExpectedUIBehavior: '' });
    };

    return (
        <div className="kb-settings-container">
            {error && (
                <div className="status-alert error" style={{ background: 'rgba(244, 63, 94, 0.1)', color: '#f43f5e', padding: '10px', borderRadius: '8px', marginBottom: '1rem', border: '1px solid #f43f5e' }}>
                    {error}
                </div>
            )}
            {success && (
                <div className="status-alert success" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '10px', borderRadius: '8px', marginBottom: '1rem', border: '1px solid #22c55e' }}>
                    {success}
                </div>
            )}

            {/* CLARIFICATION SECTION */}
            <div className="panel glass" style={{ marginBottom: '2rem' }}>
                <h3><Brain size={18} style={{ marginRight: '8px', verticalAlign: 'middle' }} /> AI MEMORY ARCHITECTURE</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginBottom: '1rem' }}>
                    Go-Hybrid AI utilizes a dual-memory architecture for testing intelligence:
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                        <h4 style={{ color: 'var(--accent-primary)', marginBottom: '0.5rem' }}>1. Semantic Memory (RAG)</h4>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                            Deep textual embeddings of general company documents, guidelines, and ISTQB standards. Used by the AI for open-ended "how-to" analysis and general knowledge retrieval. (Managed via 'Ingest Knowledge' below).
                        </p>
                    </div>
                    <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', border: '1px solid #10b981' }}>
                        <h4 style={{ color: '#10b981', marginBottom: '0.5rem' }}>2. Business Logic Matrix (FSM)</h4>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-light)' }}>
                            A highly structured, active decision matrix. The AIBrainEngine requires precise formulas to map Jira Tickets to exact Expected Behaviors and generate Playwright assertions. (Managed in the table below).
                        </p>
                    </div>
                </div>
            </div>

            {/* UPLOAD PORTAL */}
            <div className="panel glass" style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2rem' }}>
                <div style={{ flex: 1 }}>
                    <h3>AUTO-EXTRACT RULES FROM DOCUMENTS</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        Train your AI by uploading legacy documentation or Jira exports.
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                    {/* DOCX Upload */}
                    <div className="upload-btn-wrapper" style={{ position: 'relative', overflow: 'hidden', display: 'inline-block' }}>
                        <button className="btn-primary" style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-sidebar)', border: '1px solid var(--border-glass)' }} disabled={loading}>
                            <Upload size={18} /> {loading ? '...' : '.DOCX GUIDE'}
                        </button>
                        <input
                            type="file"
                            accept=".docx"
                            style={{ fontSize: '100px', position: 'absolute', left: 0, top: 0, opacity: 0, cursor: 'pointer' }}
                            onChange={handleDocumentUpload}
                            disabled={loading}
                        />
                    </div>

                    {/* Jira CSV Upload */}
                    <div className="upload-btn-wrapper" style={{ position: 'relative', overflow: 'hidden', display: 'inline-block' }}>
                        <button className="btn-primary" style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '8px' }} disabled={loading}>
                            <Upload size={18} /> {loading ? 'PROCESSING...' : 'JIRA CSV (FUNCTIONAL)'}
                        </button>
                        <input
                            type="file"
                            accept=".csv"
                            style={{ fontSize: '100px', position: 'absolute', left: 0, top: 0, opacity: 0, cursor: 'pointer' }}
                            onChange={handleJiraUpload}
                            disabled={loading}
                        />
                    </div>
                </div>
            </div>

            {/* STAGING AREA */}
            <StagingAreaTable onActionComplete={fetchRules} showMessage={showMessage} />

            {/* RULE MANAGEMENT */}
            <div className="panel glass" style={{ padding: '0', overflow: 'hidden' }}>
                <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-glass)' }}>
                    <h3>BUSINESS LOGIC MATRIX (RULES ENGINE)</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        These active rules dictate how the AI Playwright Generator reacts to specific Jira scenarios.
                    </p>
                </div>

                {/* MANUAL FORM */}
                <div style={{ padding: '1.5rem', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--border-glass)' }}>
                    <h4 style={{ marginBottom: '1rem', color: 'var(--accent-primary)', fontSize: '0.85rem' }}>
                        {editingId ? 'EDIT RULE' : 'MANUAL RULE TRAINING'}
                    </h4>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <input placeholder="Module (e.g., Leave)" className="dashboard-input" value={formData.Module} onChange={e => setFormData({ ...formData, Module: e.target.value })} style={{ flex: 1, minWidth: '150px' }} />
                        <input placeholder="SubModule (e.g., Entitlement)" className="dashboard-input" value={formData.SubModule} onChange={e => setFormData({ ...formData, SubModule: e.target.value })} style={{ flex: 1, minWidth: '150px' }} />
                        <input placeholder="Keywords (comma separated)" className="dashboard-input" value={formData.Keywords} onChange={e => setFormData({ ...formData, Keywords: e.target.value })} style={{ flex: 2, minWidth: '200px' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                        <input placeholder="Formula / Rule (e.g., Taken_Days <= Allowance)" className="dashboard-input" value={formData.FormulaRule} onChange={e => setFormData({ ...formData, FormulaRule: e.target.value })} style={{ flex: 1, minWidth: '250px' }} />
                        <input placeholder="Expected UI Behavior (e.g., Show error 'Exceeded')" className="dashboard-input" value={formData.ExpectedUIBehavior} onChange={e => setFormData({ ...formData, ExpectedUIBehavior: e.target.value })} style={{ flex: 1, minWidth: '250px' }} />
                    </div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                        <button className="btn-primary" onClick={handleSaveRule} disabled={loading}>
                            <CheckCircle2 size={16} style={{ marginRight: '6px', verticalAlign: 'text-bottom' }} />
                            {editingId ? 'UPDATE RULE' : 'ADD NEW RULE'}
                        </button>
                        {editingId && (
                            <button className="btn-secondary" onClick={cancelEdit}>CANCEL EDIT</button>
                        )}
                    </div>
                </div>

                {/* DATA GRID */}
                <div className="table-wrapper" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-sidebar)', zIndex: 10 }}>
                            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-glass)' }}>
                                <th style={{ padding: '12px', width: '15%' }}>Module</th>
                                <th style={{ padding: '12px', width: '15%' }}>Keywords</th>
                                <th style={{ padding: '12px', width: '25%' }}>Formula / Active Rule</th>
                                <th style={{ padding: '12px', width: '20%' }}>Expected UI Behavior</th>
                                <th style={{ padding: '12px', width: '15%' }}>Confidence & Status</th>
                                <th style={{ padding: '12px', width: '10%', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rules.length === 0 ? (
                                <tr>
                                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>
                                        No business logic rules found. Train the AI via File Upload or using the form above.
                                    </td>
                                </tr>
                            ) : (
                                rules.map(rule => (
                                    <tr key={rule.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <td style={{ padding: '12px', verticalAlign: 'top' }}>
                                            <strong style={{ color: 'var(--text-light)', display: 'block' }}>{rule.Module}</strong>
                                            <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{rule.SubModule}</span>
                                            {rule.jiraId && <div style={{ fontSize: '0.65rem', color: 'var(--accent-primary)', marginTop: '4px' }}>Ref: {rule.jiraId}</div>}
                                        </td>
                                        <td style={{ padding: '12px', verticalAlign: 'top', color: 'var(--accent-primary)', fontSize: '0.75rem' }}>
                                            {Array.isArray(rule.Keywords) ? rule.Keywords.join(', ') : rule.Keywords}
                                        </td>
                                        <td style={{ padding: '12px', verticalAlign: 'top', fontFamily: 'monospace', color: '#10b981' }}>
                                            {rule.FormulaRule}
                                        </td>
                                        <td style={{ padding: '12px', verticalAlign: 'top', color: 'var(--text-light)' }}>
                                            {rule.ExpectedUIBehavior}
                                        </td>
                                        <td style={{ padding: '12px', verticalAlign: 'top' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {rule.status ? (
                                                    <span style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        padding: '6px 12px',
                                                        borderRadius: '20px',
                                                        fontSize: '0.7rem',
                                                        fontWeight: 'bold',
                                                        width: 'fit-content',
                                                        // GOLDEN COLORS (March 26)
                                                        background: 
                                                            rule.status.toUpperCase().includes('BUG_DONE') || rule.status.toUpperCase() === 'BUG DONE' ? 'rgba(245, 158, 11, 0.2)' :
                                                            rule.status.toUpperCase().includes('DONE') ? 'rgba(16, 185, 129, 0.2)' :
                                                            rule.status.toLowerCase().includes('verified') ? 'rgba(59, 130, 246, 0.2)' :
                                                            rule.status.toLowerCase().includes('review') ? 'rgba(244, 63, 94, 0.2)' : 'rgba(255,255,255,0.1)',
                                                        color: 
                                                            rule.status.toUpperCase().includes('BUG_DONE') || rule.status.toUpperCase() === 'BUG DONE' ? '#f59e0b' :
                                                            rule.status.toUpperCase().includes('DONE') ? '#10b981' :
                                                            rule.status.toLowerCase().includes('verified') ? '#3b82f6' :
                                                            rule.status.toLowerCase().includes('review') ? '#f43f5e' : 'var(--text-dim)',
                                                        border: `1px solid ${
                                                            rule.status.toUpperCase().includes('BUG_DONE') || rule.status.toUpperCase() === 'BUG DONE' ? '#f59e0b' :
                                                            rule.status.toUpperCase().includes('DONE') ? '#10b981' :
                                                            rule.status.toLowerCase().includes('verified') ? '#3b82f6' :
                                                            rule.status.toLowerCase().includes('review') ? '#f43f5e' : 'rgba(255,255,255,0.2)'
                                                        }`,
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.05em'
                                                    }}>
                                                        {rule.status.toUpperCase().includes('BUG') ? <Bug size={12} /> : 
                                                         rule.status.toUpperCase().includes('DONE') ? <CheckCircle2 size={12} /> : 
                                                         <Brain size={12} />}
                                                        {rule.status.toUpperCase()}
                                                    </span>
                                                ) : (
                                                    <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>NEW DRAFT</span>
                                                )}
                                                
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <div style={{ width: '40px', height: '2px', background: 'rgba(255,255,255,0.1)', borderRadius: '1px', overflow: 'hidden' }}>
                                                        <div style={{ 
                                                            width: `${(rule.confidenceScore || 0.9) * 100}%`, 
                                                            height: '100%', 
                                                            background: 'var(--accent-primary)',
                                                            opacity: 0.6
                                                        }}></div>
                                                    </div>
                                                    <span style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>
                                                        {Math.round((rule.confidenceScore || 0.9) * 100)}% Conf.
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: '12px', verticalAlign: 'top', textAlign: 'right' }}>
                                            <button className="icon-btn" onClick={() => startEdit(rule)} style={{ marginRight: '8px' }} title="Edit"><Edit2 size={16} /></button>
                                            <button className="icon-btn" onClick={() => handleDeleteRule(rule.id)} style={{ color: 'var(--accent-rose)' }} title="Delete"><Trash2 size={16} /></button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
}
