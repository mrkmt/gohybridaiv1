import React, { useState, useEffect } from 'react';
import { UserCircle, Shield, Plus, Trash2, Save, Key, UserCheck, Globe, Database, Monitor } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface TestUser {
    id?: string;
    idNumber: string;
    username: string;
    password: string;
    userLevel: 'Admin' | 'HR-Manager' | 'Employee' | 'Supervisor';
    label: string;
    targetEnv: 'testing' | 'uat' | 'live';
    baseUrl: string;
    customerId: string;
    isDefault?: boolean;
}

export default function TestUserManager() {
    const [users, setUsers] = useState<TestUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [editingUser, setEditingUser] = useState<Partial<TestUser>>({
        userLevel: 'Employee',
        idNumber: '',
        username: '',
        password: '',
        label: '',
        targetEnv: 'testing',
        baseUrl: 'https://www.globalhr.app',
        customerId: ''
    });

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_URL}/api/test-users`);
            const data = await res.json();
            setUsers(data);
        } catch (err) {
            console.error('Failed to fetch test users');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!editingUser.idNumber || !editingUser.userLevel) {
            alert('ID Number and User Level are required');
            return;
        }

        try {
            setLoading(true);
            const res = await fetch(`${API_URL}/api/test-users`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editingUser)
            });
            if (res.ok) {
                setEditingUser({ 
                    userLevel: 'Employee', 
                    idNumber: '', 
                    username: '', 
                    password: '', 
                    label: '',
                    targetEnv: 'testing',
                    baseUrl: 'https://www.globalhr.app',
                    customerId: ''
                });
                fetchUsers();
            }
        } catch (err) {
            console.error('Failed to save user');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Delete this test user?')) return;
        try {
            setLoading(true);
            await fetch(`${API_URL}/api/test-users/${id}`, { method: 'DELETE' });
            fetchUsers();
        } catch (err) {
            console.error('Failed to delete user');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="forensic-view">
            <div className="history-header">
                <h2><UserCheck size={20} style={{ marginRight: '8px' }} /> TEST USER MANAGEMENT</h2>
                <p>Manage automation credentials and environment settings for different system roles.</p>
            </div>

            <div className="command-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem', marginTop: '2rem' }}>
                {/* FORM PANEL */}
                <div className="panel glass">
                    <h3>{editingUser.id ? 'EDIT TEST USER' : 'ADD NEW TEST USER'}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '4px' }}>USER LEVEL</label>
                                <select 
                                    className="dashboard-input" 
                                    style={{ width: '100%', background: 'rgba(0,0,0,0.3)', color: 'white' }}
                                    value={editingUser.userLevel}
                                    onChange={e => setEditingUser({...editingUser, userLevel: e.target.value as any})}
                                >
                                    <option value="Admin">System Admin</option>
                                    <option value="HR-Manager">HR Manager</option>
                                    <option value="Employee">Standard Employee</option>
                                    <option value="Supervisor">Supervisor</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '4px' }}>TARGET ENV</label>
                                <select 
                                    className="dashboard-input" 
                                    style={{ width: '100%', background: 'rgba(0,0,0,0.3)', color: 'white' }}
                                    value={editingUser.targetEnv}
                                    onChange={e => setEditingUser({...editingUser, targetEnv: e.target.value as any})}
                                >
                                    <option value="testing">Testing</option>
                                    <option value="uat">UAT</option>
                                    <option value="live">Live</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '4px' }}>LABEL (e.g. "Primary Admin")</label>
                            <input 
                                className="dashboard-input" 
                                style={{ width: '100%' }}
                                value={editingUser.label}
                                onChange={e => setEditingUser({...editingUser, label: e.target.value})}
                            />
                        </div>

                        <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-glass)' }}>
                            <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--accent-primary)', display: 'block', marginBottom: '10px' }}>ENVIRONMENT CONFIG</span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '4px' }}>BASE URL</label>
                                    <input 
                                        className="dashboard-input" 
                                        style={{ width: '100%', fontSize: '0.75rem' }}
                                        value={editingUser.baseUrl}
                                        onChange={e => setEditingUser({...editingUser, baseUrl: e.target.value})}
                                        placeholder="https://www.globalhr.app"
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '4px' }}>TENANT ID / CUSTOMER CODE</label>
                                    <input 
                                        className="dashboard-input" 
                                        style={{ width: '100%', fontSize: '0.75rem' }}
                                        value={editingUser.customerId}
                                        onChange={e => setEditingUser({...editingUser, customerId: e.target.value})}
                                        placeholder="e.g. kmt-tenant"
                                    />
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '4px' }}>ID_CARD (ID NUMBER)</label>
                                <input 
                                    className="dashboard-input" 
                                    style={{ width: '100%' }}
                                    value={editingUser.idNumber}
                                    onChange={e => setEditingUser({...editingUser, idNumber: e.target.value})}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '4px' }}>LOGIN_ID (USERNAME)</label>
                                <input 
                                    className="dashboard-input" 
                                    style={{ width: '100%' }}
                                    value={editingUser.username}
                                    onChange={e => setEditingUser({...editingUser, username: e.target.value})}
                                />
                            </div>
                        </div>
                        
                        <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-dim)', marginBottom: '4px' }}>PASSWORD</label>
                            <input 
                                type="password"
                                className="dashboard-input" 
                                style={{ width: '100%' }}
                                value={editingUser.password}
                                onChange={e => setEditingUser({...editingUser, password: e.target.value})}
                            />
                        </div>
                        
                        <div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--accent-primary)' }}>
                                <input 
                                    type="checkbox" 
                                    checked={editingUser.isDefault}
                                    onChange={e => setEditingUser({...editingUser, isDefault: e.target.checked})}
                                />
                                SET AS DEFAULT FOR THIS ROLE/ENV
                            </label>
                        </div>
                        
                        <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                            <button className="btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={loading}>
                                <Save size={16} /> SAVE TEST USER
                            </button>
                            {editingUser.id && (
                                <button className="btn-secondary" onClick={() => setEditingUser({ 
                                    userLevel: 'Employee', 
                                    idNumber: '', 
                                    username: '', 
                                    password: '', 
                                    label: '',
                                    targetEnv: 'testing',
                                    baseUrl: 'https://www.globalhr.app',
                                    customerId: ''
                                })}>CANCEL</button>
                            )}
                        </div>
                    </div>
                </div>

                {/* LIST PANEL */}
                <div className="panel glass">
                    <h3>ACTIVE CREDENTIAL VAULT</h3>
                    <div className="table-container" style={{ marginTop: '1.5rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-glass)' }}>
                                    <th style={{ padding: '12px' }}>ROLE / ENV</th>
                                    <th style={{ padding: '12px' }}>TENANT / URL</th>
                                    <th style={{ padding: '12px' }}>ID / USERNAME</th>
                                    <th style={{ padding: '12px', textAlign: 'right' }}>ACTIONS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.length === 0 ? (
                                    <tr><td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>No test users configured.</td></tr>
                                ) : (
                                    users.map(u => (
                                        <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '12px' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    <span style={{ 
                                                        padding: '2px 6px', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 'bold', width: 'fit-content',
                                                        background: u.userLevel === 'Admin' ? 'rgba(244,63,94,0.1)' : 'rgba(16,185,129,0.1)',
                                                        color: u.userLevel === 'Admin' ? '#f43f5e' : '#10b981'
                                                    }}>
                                                        {u.userLevel.toUpperCase()}
                                                    </span>
                                                    <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontWeight: 'bold' }}>
                                                        {u.targetEnv?.toUpperCase() || 'N/A'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td style={{ padding: '12px' }}>
                                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>{u.customerId || 'N/A'}</div>
                                                <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.baseUrl || 'N/A'}</div>
                                            </td>
                                            <td style={{ padding: '12px' }}>
                                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>{u.idNumber}</div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{u.username}</div>
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right' }}>
                                                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                    <button className="icon-btn" onClick={() => setEditingUser(u)} title="Edit">
                                                        <Key size={14} />
                                                    </button>
                                                    <button className="icon-btn" style={{ color: 'var(--accent-rose)' }} onClick={() => handleDelete(u.id!)} title="Delete">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
