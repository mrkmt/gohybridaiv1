import React from 'react';
import {
    Play,
    Zap,
    RotateCcw,
    CheckCircle2,
    Settings,
    HelpCircle,
    Layout,
    Activity,
    Shield,
    X,
    BarChart3,
    Upload,
    Settings2,
    ChevronRight,
    Search,
    AlertCircle,
    Check,
    Plus,
    Clock,
    Globe
} from 'lucide-react';
import { ChatMessage } from './types';

const TYPE_ICONS: Record<string, any> = {
    positive: Zap,
    negative: Shield,
    edge_case: HelpCircle,
    ui_validation: Layout,
    workflow: Activity,
    regression: Shield,
    smoke: Zap,
};

const TYPE_COLORS: Record<string, string> = {
    positive: '#10b981',
    negative: '#ef4444',
    edge_case: '#f59e0b',
    ui_validation: '#3b82f6',
    workflow: '#8b5cf6',
    regression: '#6366f1',
    smoke: '#10b981',
};

import { TestCaseEditorModal } from '../TestCaseEditorModal';

interface ActionBlockProps {
    msg: ChatMessage;
    isLoading: boolean;
    scenarios: any[];
    setScenarios: React.Dispatch<React.SetStateAction<any[]>>;
    userScenarios: any[];
    userScenarioInput: string;
    setUserScenarioInput: (val: string) => void;
    handleAddUserScenario: () => void;
    handleConfirmScenarios: (selected: any[]) => void;
    isGeneratingTestCases: boolean;
    setIsTestCaseModalOpen: (val: boolean) => void;
    handleRunTests: () => void;
    isExecutingTests: boolean;
    handleStopExecution: () => void;
    combinedExecutionLog: string[];
    wsStatus: string;
    executionResults: any[];
    handlePostFailureToJira: () => void;
    isPostingToJira: boolean;
    handleUploadReport: (transitionTo: string) => void;
    isUploadingReport: boolean;
    isReportUploaded: boolean;
    handleStartTesting: (ticketId: string) => void;
    testCases: any[];
    handleApproveTestCases: (cases: any[]) => void;
    handleRetryTests: () => void;
    currentTicket: any;
    environment: any;
    handleSaveTestCases?: (cases: any[]) => Promise<void>;
}

export const ActionBlock: React.FC<ActionBlockProps> = ({
    msg,
    isLoading,
    scenarios,
    setScenarios,
    userScenarios,
    userScenarioInput,
    setUserScenarioInput,
    handleAddUserScenario,
    handleConfirmScenarios,
    isGeneratingTestCases,
    setIsTestCaseModalOpen,
    handleRunTests,
    isExecutingTests,
    handleStopExecution,
    combinedExecutionLog,
    wsStatus,
    executionResults,
    handlePostFailureToJira,
    isPostingToJira,
    handleUploadReport,
    isUploadingReport,
    isReportUploaded,
    handleStartTesting,
    testCases,
    handleApproveTestCases,
    handleRetryTests,
    currentTicket,
    environment,
    handleSaveTestCases,
}) => {
    const C = {
        accent: '#8ab4f8',
        border: 'rgba(255,255,255,0.08)',
        text: '#e3e3f0',
        dim: '#9aa0a6',
        bgGlass: 'rgba(15, 23, 42, 0.4)',
    };

    if (!msg.actionBlock) return null;

    const buttonBaseStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        padding: '14px 20px', borderRadius: 16, border: 'none', cursor: 'pointer',
        fontWeight: 800, fontSize: 14, transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        outline: 'none'
    };

    // Determine status from ticket or session
    const statusStr = currentTicket?.status || msg.actionBlock?.ticketStatus || 'To Do';
    const isDone = statusStr.toLowerCase().includes('done') || statusStr.toLowerCase().includes('closed') || statusStr.toLowerCase().includes('resolved');
    const isInTesting = statusStr.toLowerCase().includes('testing') || statusStr.toLowerCase().includes('progress') || currentTicket?.hasSession;

    return (
        <div style={{ marginTop: 12 }}>
            {/* 1. START TESTING */}
            {msg.actionBlock.type === 'start_testing' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {!isDone ? (
                        <button
                            onClick={() => handleStartTesting(msg.actionBlock!.ticketId!)}
                            style={{
                                ...buttonBaseStyle,
                                width: '100%', 
                                background: isInTesting 
                                    ? 'rgba(255,255,255,0.05)' 
                                    : 'linear-gradient(135deg, rgba(138,180,248,0.2), rgba(138,180,248,0.05))',
                                border: `1px solid ${isInTesting ? 'rgba(255,255,255,0.1)' : C.accent}`, 
                                color: isInTesting ? C.text : C.accent,
                                boxShadow: isInTesting ? 'none' : '0 8px 24px rgba(138,180,248,0.1)'
                            }}
                            disabled={isLoading}
                        >
                            {isInTesting ? (
                                <><RotateCcw size={18} /> Re-run Automation Mission</>
                            ) : (
                                <><Zap size={18} fill="currentColor" /> Start Automation Workflow</>
                            )}
                        </button>
                    ) : (
                        <div style={{ 
                            padding: '12px 20px', borderRadius: 16, background: 'rgba(16, 185, 129, 0.05)', 
                            border: '1px solid rgba(16, 185, 129, 0.2)', color: '#10b981', fontSize: 13, 
                            display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600
                        }}>
                            <Check size={18} /> Mission completed in Jira. No actions available.
                        </div>
                    )}
                </div>
            )}

            {/* 2. SCENARIO SELECTION */}
            {msg.actionBlock.type === 'scenarios_selection' && (
                <div style={{
                    marginTop: 16, padding: '24px', borderRadius: 28,
                    border: '1px solid rgba(255,255,255,0.06)', 
                    background: C.bgGlass,
                    backdropFilter: 'blur(16px)',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(138,180,248,0.1)', color: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Search size={18} />
                            </div>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 900, color: '#fff', letterSpacing: '0.02em' }}>PATTERN MATCHING</div>
                                <div style={{ fontSize: 11, color: C.dim }}>Confirm scenarios for automated coverage</div>
                            </div>
                        </div>
                        <div style={{ fontSize: 10, color: C.dim, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.03)', padding: '4px 10px', borderRadius: 20 }}>
                            <Clock size={12} /> {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gap: 12, marginBottom: 24 }}>
                        {(msg.actionBlock.scenarios || []).map((sc: any) => {
                            const Icon = TYPE_ICONS[sc.type] || HelpCircle;
                            const color = TYPE_COLORS[sc.type] || 'var(--text-dim)';
                            const isSelected = scenarios.find(s => s.id === sc.id)?.selected;
                            
                            return (
                                <div
                                    key={sc.id}
                                    onClick={() => {
                                        setScenarios(prev => {
                                            const base = prev.length > 0 ? prev : (msg.actionBlock?.scenarios || []).map((s: any) => ({ ...s, selected: false }));
                                            return base.map(s => s.id === sc.id ? { ...s, selected: !s.selected } : s);
                                        });
                                    }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
                                        borderRadius: 20, border: `1px solid ${isSelected ? C.accent : 'rgba(255,255,255,0.05)'}`,
                                        background: isSelected ? 'rgba(138,180,248,0.1)' : 'rgba(255,255,255,0.02)',
                                        cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                        boxShadow: isSelected ? '0 10px 20px rgba(138,180,248,0.05)' : 'none'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                                    }}
                                >
                                    <div style={{ width: 44, height: 44, borderRadius: 14, background: `${color}15`, color: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `0 4px 12px ${color}10` }}>
                                        <Icon size={22} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 14, fontWeight: 700, color: isSelected ? '#fff' : '#e2e8f0' }}>{sc.title}</div>
                                        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4, lineHeight: 1.4 }}>{sc.description}</div>
                                    </div>
                                    <div style={{ width: 22, height: 22, borderRadius: 8, border: `2.5px solid ${isSelected ? C.accent : 'rgba(255,255,255,0.1)'}`, background: isSelected ? C.accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', boxShadow: isSelected ? `0 0 15px ${C.accent}40` : 'none' }}>
                                        {isSelected && <Check size={14} color="#000" strokeWidth={4} />}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    
                    {/* User Scenarios */}
                    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <div style={{ fontSize: 12, fontWeight: 900, color: C.dim, letterSpacing: '0.05em' }}>YOUR CUSTOM SCENARIOS ({userScenarios.length})</div>
                        </div>
                        
                        {userScenarios.length > 0 && (
                            <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
                                {userScenarios.map((us) => (
                                    <div key={us.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 14, background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.2)', fontSize: 13, animation: 'slide-in 0.3s ease-out' }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#6366f1' }} />
                                        <span style={{ flex: 1, color: '#e2e8f0', fontWeight: 500 }}>{us.description}</span>
                                        <CheckCircle2 size={16} color="#6366f1" />
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
                            <div style={{ flex: 1, position: 'relative' }}>
                                <input
                                    type="text"
                                    value={userScenarioInput}
                                    onChange={(e) => setUserScenarioInput(e.target.value)}
                                    placeholder="Add specialized scenario..."
                                    style={{ width: '100%', padding: '14px 18px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: '#fff', fontSize: 14, outline: 'none', transition: 'all 0.2s' }}
                                    onFocus={(e) => e.currentTarget.style.border = `1px solid ${C.accent}`}
                                    onBlur={(e) => e.currentTarget.style.border = '1px solid rgba(255,255,255,0.1)'}
                                />
                            </div>
                            <button 
                                onClick={handleAddUserScenario} 
                                style={{ 
                                    padding: '0 24px', borderRadius: 16, background: '#6366f1', color: '#fff', 
                                    border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 14,
                                    transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.filter = 'brightness(1.1)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.filter = 'brightness(1)';
                                }}
                            >
                                <Plus size={18} />
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={() => handleConfirmScenarios(scenarios.filter(s => s.selected))}
                        disabled={isGeneratingTestCases || (!scenarios.some(s => s.selected) && userScenarios.length === 0)}
                        style={{
                            ...buttonBaseStyle,
                            width: '100%', background: C.accent,
                            color: '#000', fontSize: 15,
                            boxShadow: '0 12px 30px rgba(138,180,248,0.25)'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 16px 40px rgba(138,180,248,0.35)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 12px 30px rgba(138,180,248,0.25)';
                        }}
                    >
                        {isGeneratingTestCases ? (
                            <><RotateCcw size={20} className="animate-spin" /> Generating Automation...</>
                        ) : (
                            <><Zap size={20} fill="currentColor" /> Build Automation Interface</>
                        )}
                    </button>
                </div>
            )}

            {/* 3. TEST CASES REVIEW */}
            {msg.actionBlock.type === 'test_cases_review' && (
                <TestCaseEditorModal 
                    inline
                    ticketId={currentTicket?.ticketId || msg.actionBlock.ticketId || ''}
                    testCases={testCases.length > 0 ? testCases : (msg.actionBlock.testCases || [])}
                    onSave={handleSaveTestCases || (async () => {})}
                    onApprove={handleApproveTestCases as any}
                    onClose={() => setIsTestCaseModalOpen(false)}
                />
            )}

            {/* 4. EXECUTION PROGRESS */}
            {msg.actionBlock.type === 'execution' && (
                <div style={{ 
                    marginTop: 12, padding: '24px', borderRadius: 28, 
                    border: `1px solid ${C.border}`, 
                    background: 'linear-gradient(165deg, rgba(15, 23, 42, 0.6), rgba(15, 23, 42, 0.3))',
                    boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.6)',
                    backdropFilter: 'blur(20px)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: isExecutingTests ? '#10b981' : '#6366f1', animation: isExecutingTests ? 'pulse 1.5s infinite' : 'none' }} />
                            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '0.05em', color: C.text }}>EXECUTION ENGINE</div>
                        </div>
                        <div style={{ 
                            fontSize: 10, color: C.accent, fontWeight: 900, 
                            padding: '6px 12px', borderRadius: 10, background: 'rgba(138,180,248,0.1)',
                            border: '1px solid rgba(138,180,248,0.15)', display: 'flex', alignItems: 'center', gap: 6
                        }}>
                            <Globe size={12} /> {environment?.stage?.toUpperCase() || 'SANDBOX'}
                        </div>
                    </div>
                    
                    {/* Log area */}
                    <div style={{ 
                        height: 200, overflowY: 'auto', background: 'rgba(2, 6, 23, 0.8)', 
                        borderRadius: 20, padding: '18px', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", 
                        fontSize: 12, color: '#10b981', marginBottom: 24,
                        border: '1px solid rgba(255,255,255,0.05)',
                        boxShadow: 'inset 0 4px 20px rgba(0,0,0,0.4)',
                        lineHeight: 1.6
                    }}>
                        {combinedExecutionLog.length > 0 ? (
                            combinedExecutionLog.map((log, i) => (
                                <div key={i} style={{ marginBottom: 6, display: 'flex', gap: 10, animation: 'fade-in 0.2s ease-out' }}>
                                    <span style={{ color: '#334155', userSelect: 'none', minWidth: 24 }}>{i+1}</span>
                                    <span style={{ whiteSpace: 'pre-wrap' }}>{log}</span>
                                </div>
                            ))
                        ) : (
                            <div style={{ color: '#475569', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 10, height: '100%', justifyContent: 'center' }}>
                                <RotateCcw size={18} className="animate-spin" /> Ready for system trigger...
                            </div>
                        )}
                        {isExecutingTests && wsStatus === 'running' && (
                            <div className="animate-pulse" style={{ color: C.accent, marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.accent }} />
                                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>AI AGENT PROCESSING TARGET...</span>
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', gap: 14 }}>
                        {!isExecutingTests ? (
                            <button 
                                onClick={handleRunTests} 
                                style={{ 
                                    ...buttonBaseStyle,
                                    flex: 1, background: C.accent, 
                                    color: '#000', fontSize: 15,
                                    boxShadow: '0 12px 30px rgba(138, 180, 248, 0.25)'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 16px 40px rgba(138, 180, 248, 0.35)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 12px 30px rgba(138, 180, 248, 0.25)';
                                }}
                            >
                                <Play size={20} fill="currentColor" /> Run All Tests
                            </button>
                        ) : (
                            <button 
                                onClick={handleStopExecution} 
                                style={{ 
                                    ...buttonBaseStyle,
                                    flex: 1, background: '#ef4444', 
                                    color: '#fff', fontSize: 15,
                                    boxShadow: '0 12px 30px rgba(239, 68, 68, 0.25)'
                                }}
                            >
                                <X size={20} /> Stop Execution
                            </button>
                        )}
                        
                        <button 
                            onClick={() => setIsTestCaseModalOpen(true)}
                            style={{ 
                                padding: '14px', borderRadius: 16, background: 'rgba(255,255,255,0.05)', 
                                border: `1px solid ${C.border}`, color: '#fff', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                            title="Execution Settings"
                        >
                            <Settings2 size={20} />
                        </button>
                    </div>
                </div>
            )}

            {/* 5. RESULTS SUMMARY */}
            {msg.actionBlock.type === 'results' && (
                <div style={{ 
                    marginTop: 12, padding: '24px', borderRadius: 28, 
                    border: `1px solid ${C.border}`, background: C.bgGlass,
                    backdropFilter: 'blur(16px)',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(16,185,129,0.1)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <CheckCircle2 size={18} />
                        </div>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 900, color: '#fff', letterSpacing: '0.02em' }}>MISSION COMPLETE</div>
                            <div style={{ fontSize: 11, color: C.dim }}>Forensic automation cycle finished</div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 24 }}>
                        <div style={{ padding: '20px', borderRadius: 20, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <div style={{ fontSize: 11, fontWeight: 900, color: '#10b981', marginBottom: 8, letterSpacing: '0.1em' }}>PASSED</div>
                            <div style={{ fontSize: 36, fontWeight: 900, color: '#fff' }}>{executionResults.filter(r => r.status === 'passed' || r.status === 'PASS').length}</div>
                        </div>
                        <div style={{ padding: '20px', borderRadius: 20, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.1)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <div style={{ fontSize: 11, fontWeight: 900, color: '#ef4444', marginBottom: 8, letterSpacing: '0.1em' }}>FAILED</div>
                            <div style={{ fontSize: 36, fontWeight: 900, color: '#fff' }}>{executionResults.filter(r => r.status === 'failed' || r.status === 'FAIL').length}</div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {executionResults.some(r => r.status === 'failed' || r.status === 'FAIL') && (
                            <button 
                                onClick={handleRetryTests} 
                                style={{ 
                                    ...buttonBaseStyle,
                                    background: 'rgba(138,180,248,0.1)', 
                                    border: `1px solid ${C.accent}`, color: C.accent, fontSize: 14
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(138,180,248,0.15)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(138,180,248,0.1)'}
                            >
                                <RotateCcw size={18} /> Retry Failed Tests
                            </button>
                        )}
                        <button 
                            onClick={() => handleUploadReport('Done')} 
                            disabled={isUploadingReport || isReportUploaded}
                            style={{ 
                                ...buttonBaseStyle,
                                background: '#10b981', border: 'none', 
                                color: '#000', fontSize: 15,
                                boxShadow: '0 12px 30px rgba(16,185,129,0.25)'
                            }}
                            onMouseEnter={(e) => {
                                if (!isUploadingReport && !isReportUploaded) {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 16px 40px rgba(16,185,129,0.35)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 12px 30px rgba(16,185,129,0.25)';
                            }}
                        >
                            {isUploadingReport ? (
                                <><RotateCcw size={20} className="animate-spin" /> Uploading...</>
                            ) : (
                                <><Upload size={20} /> Finalize & Upload to Jira</>
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
