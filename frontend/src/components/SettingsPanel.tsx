import React from 'react';
import { 
    X, Settings, Zap, Cpu, UserCheck, Shield, Eye, Code, 
    Globe, CheckCircle2, AlertTriangle, Save, Trash2, Plus 
} from 'lucide-react';

interface SettingsPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
    if (!isOpen) return null;

    const C = {
        bg: 'rgba(15, 23, 42, 0.95)',
        card: 'rgba(30, 41, 59, 0.4)',
        border: 'rgba(255, 255, 255, 0.08)',
        accent: '#38bdf8',
        text: '#f8fafc',
        dim: '#94a3b8'
    };

    return (
        <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: '480px',
            background: C.bg, borderLeft: `1px solid ${C.border}`,
            zIndex: 2000, backdropFilter: 'blur(20px)',
            boxShadow: '-20px 0 60px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column',
            animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
            {/* Header */}
            <div style={{ 
                padding: '24px', borderBottom: `1px solid ${C.border}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ padding: 8, background: 'rgba(56, 189, 248, 0.1)', borderRadius: 10 }}>
                        <Settings size={20} color={C.accent} />
                    </div>
                    <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em' }}>SYSTEM SETTINGS</span>
                </div>
                <button 
                    onClick={onClose}
                    style={{ background: 'transparent', border: 'none', color: C.dim, cursor: 'pointer', padding: 8 }}
                >
                    <X size={20} />
                </button>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
                
                {/* AI Agents Module */}
                <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.accent }}>
                        <Cpu size={16} />
                        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Intelligence</span>
                    </div>
                    
                    <div style={{ background: C.card, borderRadius: 20, border: `1px solid ${C.border}`, padding: '20px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {['Reasoning', 'Code', 'Vision'].map((role) => (
                                <div key={role} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: 13, color: C.text }}>{role} Agent</span>
                                    <select style={{ 
                                        background: 'rgba(15, 23, 42, 0.6)', color: C.text, border: `1px solid ${C.border}`, 
                                        borderRadius: 8, padding: '6px 12px', fontSize: 12, outline: 'none' 
                                    }}>
                                        <option>Puter (Gemini 2.0)</option>
                                        <option>Groq (Llama 3.3)</option>
                                        <option>OpenRouter</option>
                                    </select>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Discovery Strategy */}
                <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.accent }}>
                        <Eye size={16} />
                        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Test Discovery</span>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        {[
                            { id: 'ai', label: 'AI-First', icon: Zap, active: true },
                            { id: 'ext', label: 'Extension', icon: Globe, active: false }
                        ].map(opt => (
                            <div key={opt.id} style={{
                                padding: '16px', borderRadius: 16, border: `2px solid ${opt.active ? C.accent : C.border}`,
                                background: opt.active ? 'rgba(56, 189, 248, 0.05)' : C.card,
                                cursor: 'pointer', textAlign: 'center'
                            }}>
                                <opt.icon size={20} color={opt.active ? C.accent : C.dim} style={{ marginBottom: 8 }} />
                                <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.label}</div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Business Logic */}
                <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.accent }}>
                        <Shield size={16} />
                        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Business Memory</span>
                    </div>
                    <div style={{ background: C.card, borderRadius: 20, border: `1px solid ${C.border}`, padding: '20px' }}>
                        <div style={{ fontSize: 12, color: C.dim, marginBottom: 12 }}>Manage global business rules and testing standards.</div>
                        <button style={{ 
                            width: '100%', padding: '10px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', 
                            border: `1px solid ${C.border}`, color: 'white', fontSize: 13, cursor: 'pointer' 
                        }}>
                            Open Memory Vault
                        </button>
                    </div>
                </section>

                {/* Account Vault */}
                <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.accent }}>
                        <UserCheck size={16} />
                        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Test Accounts</span>
                    </div>
                    <div style={{ background: C.card, borderRadius: 20, border: `1px solid ${C.border}`, padding: '20px' }}>
                        <button style={{ 
                            width: '100%', padding: '10px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', 
                            border: `1px solid ${C.border}`, color: 'white', fontSize: 13, cursor: 'pointer' 
                        }}>
                            Manage Login Credentials
                        </button>
                    </div>
                </section>
            </div>

            {/* Footer */}
            <div style={{ padding: '24px', borderTop: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.2)' }}>
                <button 
                    onClick={onClose}
                    style={{ 
                        width: '100%', padding: '14px', borderRadius: 14, background: C.accent, 
                        color: '#000', fontWeight: 700, border: 'none', cursor: 'pointer' 
                    }}
                >
                    Apply Changes
                </button>
            </div>

            <style>{`
                @keyframes slideIn {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
            `}</style>
        </div>
    );
}
