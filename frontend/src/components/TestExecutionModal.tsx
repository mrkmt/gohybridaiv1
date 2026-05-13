/**
 * TestExecutionModal Component
 * 
 * Modal for selecting environment, running tests, and viewing results.
 * Based on Canva design flow with modern React/Tailwind styling.
 */

import React, { useState } from 'react';
import { X, Play, CheckCircle, XCircle, Circle, Download, Paperclip, RotateCcw, Bug, Globe, Shield, Code, User, Zap, Clock, Monitor, Brain, AlertTriangle } from 'lucide-react';
import { TestCase } from '../services/TestCaseGeneratorService';
import { TestResult, TestEnvironment } from '../services/TestExecutionService';

interface TestExecutionModalProps {
    isOpen: boolean;
    ticketId: string;
    testCases: TestCase[];
    environment: TestEnvironment;
    onEnvironmentChange: (env: TestEnvironment) => void;
    onExecute: () => Promise<void>;
    onRerun: () => Promise<void>;
    onUploadAndTransition: (transitionTo: 'Done' | 'Bug Done') => Promise<void>;
    onClose: () => void;
    isExecuting?: boolean;
    progress?: number;
    results?: TestResult[];
    executionLog?: string[];
    syncRequired?: boolean;
    currentJiraData?: { summary: string; description: string; status: string } | null;
    onSync?: () => void;
}

export function TestExecutionModal({
    isOpen,
    ticketId,
    testCases,
    environment,
    onEnvironmentChange,
    onExecute,
    onRerun,
    onUploadAndTransition,
    onClose,
    isExecuting = false,
    progress = 0,
    results,
    executionLog = [],
    syncRequired,
    currentJiraData,
    onSync
}: TestExecutionModalProps) {
    const [selectedStage, setSelectedStage] = useState<'testing' | 'uat' | 'live'>(environment?.stage || 'testing');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const hasResults = results && results.length > 0;
    const passCount = results?.filter(r => r.status === 'PASS').length || 0;
    const failCount = results?.filter(r => r.status === 'FAIL').length || 0;
    const skipCount = results?.filter(r => r.status === 'SKIPPED').length || 0;
    const passRate = results?.length ? Math.round((passCount / results.length) * 100) : 0;

    const handleStageChange = (stage: 'testing' | 'uat' | 'live') => {
        setSelectedStage(stage);
        const stageUrls: Record<string, string> = {
            testing: 'https://test.globalhr.com.mm',
            uat: 'https://uat.globalhr.com.mm',
            live: 'https://www.globalhr.com.mm'
        };
        onEnvironmentChange({
            ...environment,
            stage,
            baseUrl: stageUrls[stage] || environment.baseUrl
        });
    };

    const handleExecute = async () => {
        await onExecute();
    };

    const handleRerun = async () => {
        await onRerun();
    };

    const handleUploadAndTransition = async (transitionTo: 'Done' | 'Bug Done') => {
        setIsUploading(true);
        setUploadError(null);
        try {
            await onUploadAndTransition(transitionTo);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Upload failed';
            setUploadError(message);
            console.error('Failed to upload results:', error);
        } finally {
            setIsUploading(false);
        }
    };

    const C = {
        bg: '#1a1a2e',
        surface: '#202038',
        input: '#252540',
        border: 'rgba(255,255,255,0.06)',
        borderHover: 'rgba(255,255,255,0.12)',
        text: '#e3e3f0',
        dim: '#7a7a96',
        accent: '#8ab4f8',
        accentSurface: 'rgba(138,180,248,0.1)',
        green: '#10b981',
        red: '#ef4444',
        amber: '#f59e0b'
    };

    if (!isOpen) return null;

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, width: '100%', maxWidth: 1000, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', fontFamily: "'Inter', sans-serif" }}>
                {/* Header */}
                <div style={{ padding: '24px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                    <div>
                        <h3 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: '0 0 4px 0' }}>Test Execution</h3>
                        <p style={{ fontSize: 13, color: C.dim, margin: 0 }}>{ticketId}</p>
                    </div>
                    <button onClick={onClose} disabled={isUploading} style={{ padding: 8, background: 'transparent', border: 'none', color: C.dim, cursor: isUploading ? 'default' : 'pointer', borderRadius: 8, opacity: isUploading ? 0.5 : 1 }}>
                        <X size={20} />
                    </button>
                </div>

                {(isUploading || uploadError) && (
                    <div style={{
                        margin: '0 24px 16px',
                        padding: '12px 16px',
                        borderRadius: 12,
                        border: `1px solid ${uploadError ? 'rgba(239,68,68,0.3)' : 'rgba(138,180,248,0.25)'}`,
                        background: uploadError ? 'rgba(239,68,68,0.08)' : 'rgba(138,180,248,0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        flexShrink: 0
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {isUploading ? <RotateCcw size={16} className="animate-spin" /> : <AlertTriangle size={16} color={C.red} />}
                            <div style={{ fontSize: 13, fontWeight: 600, color: uploadError ? '#fecaca' : '#c7d2fe' }}>
                                {isUploading ? 'Uploading evidence package to Jira…' : 'Upload failed'}
                            </div>
                        </div>
                        {uploadError && (
                            <div style={{ fontSize: 12, color: '#fecaca', opacity: 0.95, textAlign: 'right', maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {uploadError}
                            </div>
                        )}
                    </div>
                )}

                {/* Sync Warning Banner */}
                {syncRequired && (
                    <div style={{ margin: '0 24px 24px', padding: '12px 16px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <AlertTriangle size={20} color="#f59e0b" />
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#f59e0b' }}>Jira Data Mismatch Detected</div>
                                <div style={{ fontSize: 12, color: C.dim }}>Ticket details have been updated on Jira.</div>
                            </div>
                        </div>
                        <button 
                            onClick={onSync}
                            style={{ padding: '6px 14px', background: '#f59e0b', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                            Sync & Refresh
                        </button>
                    </div>
                )}

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: 'rgba(0,0,0,0.1)' }}>
                    {!hasResults ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                            {/* Environment Selection */}
                            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                                <h4 style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12, marginTop: 0 }}>Select Environment</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                                    {[
                                        { id: 'testing', icon: Code, color: C.amber, title: 'Testing Stage', desc: 'Development' },
                                        { id: 'uat', icon: Shield, color: C.accent, title: 'UAT Stage', desc: 'Pre-Production' },
                                        { id: 'live', icon: Globe, color: C.green, title: 'Live Stage', desc: 'Production' }
                                    ].map(stage => {
                                        const isSelected = selectedStage === stage.id;
                                        return (
                                            <div key={stage.id} onClick={() => handleStageChange(stage.id as any)} style={{ padding: 16, borderRadius: 8, border: `2px solid ${isSelected ? stage.color : C.borderHover}`, background: isSelected ? `${stage.color}15` : 'transparent', cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s' }}>
                                                <stage.icon size={24} style={{ margin: '0 auto 8px', color: isSelected ? stage.color : C.dim }} />
                                                <div style={{ fontSize: 14, fontWeight: 500, color: C.text }}>{stage.title}</div>
                                                <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>{stage.desc}</div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Navigation URL Configuration */}
                            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                                <h4 style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12, marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Globe size={14} className="text-blue-400" />
                                    Navigation URL
                                </h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <input
                                        type="text"
                                        value={environment?.fullUrl || environment?.baseUrl || ''}
                                        onChange={(e) => onEnvironmentChange({ ...environment, fullUrl: e.target.value })}
                                        placeholder="https://test.example.com/ook#/login"
                                        style={{ width: '100%', padding: '10px 14px', background: C.input, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, outline: 'none', boxSizing: 'border-box', fontSize: 13, fontFamily: 'monospace' }}
                                    />
                                    <div style={{ fontSize: 11, color: C.dim }}>
                                        Baseline: <span style={{ color: C.accent }}>{environment?.baseUrl}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Configured Credentials Summary (Read-Only from Settings) */}
                            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                    <h4 style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <User size={14} className="text-amber-400" />
                                        Testing Credentials
                                    </h4>
                                    <span style={{ fontSize: 10, color: C.dim, background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 4 }}>From Settings</span>
                                </div>
                                <div style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 8, border: `1px solid ${C.border}` }}>
                                    <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>Password</div>
                                    <div style={{ fontSize: 13, color: '#fff', fontFamily: 'monospace' }}>••••••••</div>
                                    <div style={{ fontSize: 10, color: C.dim, marginTop: 6 }}>Credentials are managed in Settings. ID/Username is auto-filled from configuration.</div>
                                </div>
                            </div>

                            {/* Execution Mode Summary */}
                            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                                <h4 style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12, marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Zap size={14} className="text-purple-400" />
                                    Execution Mode
                                </h4>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    <div style={{ padding: '4px 10px', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 20, fontSize: 11, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Monitor size={10} />
                                        {(environment?.browser || 'chromium').charAt(0).toUpperCase() + (environment?.browser || 'chromium').slice(1)}
                                    </div>
                                    <div style={{ padding: '4px 10px', background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 20, fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Shield size={10} />
                                        {environment?.headless !== false ? 'Headless' : 'Headed'}
                                    </div>
                                    <div style={{ padding: '4px 10px', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 20, fontSize: 11, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Clock size={10} />
                                        {environment?.timeout || 5}m limit
                                    </div>
                                    {environment?.autoHeal !== false && (
                                        <div style={{ padding: '4px 10px', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 20, fontSize: 11, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <Zap size={10} />
                                            AI Heal
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Test Cases Summary */}
                            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                                <h4 style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 12, marginTop: 0 }}>Test Cases to Execute</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 160, overflowY: 'auto' }}>
                                    {testCases.length === 0 ? (
                                        <div className="animate-pulse" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                            {[0, 1, 2, 3].map((k) => (
                                                <div key={k} style={{ height: 14, background: C.input, borderRadius: 6, width: `${84 - k * 10}%` }} />
                                            ))}
                                        </div>
                                    ) : (
                                        testCases.map((tc) => (
                                            <div key={tc.caseId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: tc.isMain ? '#a855f7' : C.accent }} />
                                                <span style={{ color: '#cbd5e1' }}>{tc.caseId}: {tc.title}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                            {/* Execution Progress */}
                            {(isExecuting || progress > 0) && (
                                <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                        <h4 style={{ fontSize: 14, fontWeight: 600, color: C.text, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                            Execution Progress
                                            {isExecuting && <span style={{ padding: '2px 8px', background: 'rgba(239,68,68,0.2)', color: '#ef4444', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>LIVE</span>}
                                        </h4>
                                        <span style={{ fontSize: 12, padding: '4px 12px', background: isExecuting ? 'rgba(138,180,248,0.12)' : 'rgba(16,185,129,0.12)', color: isExecuting ? C.accent : C.green, borderRadius: 12 }}>
                                            {isExecuting ? 'Running...' : 'Complete'}
                                        </span>
                                    </div>
                                    <div style={{ width: '100%', background: C.input, borderRadius: 8, height: 12, marginBottom: 16, overflow: 'hidden' }}>
                                        <div style={{ background: isExecuting ? C.accent : C.green, height: '100%', width: `${progress}%`, transition: 'width 0.5s ease-out' }} />
                                    </div>
                                    <div style={{ background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: 12, maxHeight: 200, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, border: '1px solid rgba(148,163,184,0.2)' }}>
                                        {executionLog.length === 0 && isExecuting ? (
                                            <div className="animate-pulse" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {[0, 1, 2, 3].map((k) => (
                                                    <div key={k} style={{ height: 14, width: `${92 - k * 10}%`, background: 'rgba(148,163,184,0.22)', borderRadius: 4 }} />
                                                ))}
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                {executionLog.map((log, idx) => {
                                                    // Parse log for styling
                                                    const isStep = log.toLowerCase().includes('step') || log.toLowerCase().includes('navigate');
                                                    const isPass = log.includes('✓') || log.toLowerCase().includes('pass');
                                                    const isFail = log.includes('✗') || log.includes('×') || log.toLowerCase().includes('fail') || log.toLowerCase().includes('error');
                                                    const isInfo = log.includes('→') || log.includes('Starting') || log.includes('Environment');
                                                    
                                                    let bgColor = 'transparent';
                                                    let textColor = '#94a3b8';
                                                    let icon = '  ';
                                                    
                                                    if (isPass) {
                                                        bgColor = 'rgba(16,185,129,0.1)';
                                                        textColor = '#4ade80';
                                                        icon = '✓ ';
                                                    } else if (isFail) {
                                                        bgColor = 'rgba(239,68,68,0.1)';
                                                        textColor = '#f87171';
                                                        icon = '✗ ';
                                                    } else if (isStep) {
                                                        bgColor = 'rgba(59,130,246,0.08)';
                                                        textColor = '#60a5fa';
                                                        icon = '→ ';
                                                    } else if (isInfo) {
                                                        textColor = '#94a3b8';
                                                        icon = 'ℹ ';
                                                    }
                                                    
                                                    return (
                                                        <div key={idx} style={{ 
                                                            padding: '6px 8px', 
                                                            borderRadius: 4, 
                                                            background: bgColor,
                                                            color: textColor,
                                                            fontFamily: 'monospace',
                                                            fontSize: 11,
                                                            display: 'flex',
                                                            alignItems: 'flex-start',
                                                            gap: 6
                                                        }}>
                                                            <span style={{ flexShrink: 0, opacity: 0.7 }}>{icon}</span>
                                                            <span style={{ flex: 1, wordBreak: 'break-word' }}>{log}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Results Summary */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                                <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, textAlign: 'center' }}>
                                    <div style={{ fontSize: 24, fontWeight: 700, color: C.text }}>{results?.length || 0}</div>
                                    <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>Total</div>
                                </div>
                                <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
                                    <div style={{ fontSize: 24, fontWeight: 700, color: C.green }}>{passCount}</div>
                                    <div style={{ fontSize: 12, color: 'rgba(16,185,129,0.6)', marginTop: 4 }}>Passed ({passRate}%)</div>
                                </div>
                                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
                                    <div style={{ fontSize: 24, fontWeight: 700, color: C.red }}>{failCount}</div>
                                    <div style={{ fontSize: 12, color: 'rgba(239,68,68,0.6)', marginTop: 4 }}>Failed</div>
                                </div>
                                <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
                                    <div style={{ fontSize: 24, fontWeight: 700, color: C.amber }}>{skipCount}</div>
                                    <div style={{ fontSize: 12, color: 'rgba(245,158,11,0.6)', marginTop: 4 }}>Skipped</div>
                                </div>
                            </div>

                            {/* Detailed Results List (Visual Log) */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 500, overflowY: 'auto' }}>
                                {results?.map((result, idx) => {
                                    const isPass = result.status === 'PASS';
                                    const isFail = result.status === 'FAIL';
                                    return (
                                        <div key={idx} style={{ 
                                            display: 'flex', 
                                            flexDirection: 'column', 
                                            gap: 12, 
                                            padding: 16, 
                                            borderRadius: 12, 
                                            border: `1px solid ${isPass ? 'rgba(16,185,129,0.3)' : isFail ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`, 
                                            background: isPass ? 'rgba(16,185,129,0.05)' : isFail ? 'rgba(239,68,68,0.05)' : 'rgba(245,158,11,0.05)' 
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                    {isPass ? <CheckCircle size={20} color={C.green} /> : isFail ? <XCircle size={20} color={C.red} /> : <Circle size={20} color={C.amber} />}
                                                    <div>
                                                        <div style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{result.testCaseId}: {result.testCaseTitle}</div>
                                                        <div style={{ fontSize: 12, color: C.dim }}>{(result.duration / 1000).toFixed(1)}s • {result.environment} • {result.status}</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Visual Step Log */}
                                            <div style={{ borderLeft: `2px solid ${C.border}`, marginLeft: 9, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                {result.steps?.map((step: any, sIdx: number) => (
                                                    <div key={sIdx} style={{ position: 'relative', fontSize: 13 }}>
                                                        <div style={{ 
                                                            position: 'absolute', 
                                                            left: -27, 
                                                            top: 4, 
                                                            width: 12, 
                                                            height: 12, 
                                                            borderRadius: '50%', 
                                                            background: step.status === 'PASS' ? C.green : C.red,
                                                            border: `2px solid ${C.surface}`,
                                                            boxShadow: `0 0 0 2px ${step.status === 'PASS' ? C.green : C.red}33`
                                                        }} />
                                                        <div style={{ color: C.text, fontWeight: 500 }}>{step.action}</div>
                                                        {step.expectedResult && <div style={{ color: C.dim, fontSize: 11 }}>{step.expectedResult}</div>}
                                                    </div>
                                                ))}
                                            </div>
                                            
                                            {/* AI Root Cause Analysis Analysis */}
                                            {result.status === 'FAIL' && (result as any).aiInsight && (
                                                <div style={{ width: '100%', padding: '12px 16px', background: 'rgba(138, 180, 248, 0.05)', borderRadius: 10, border: `1px solid ${C.accent}44`, boxSizing: 'border-box' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                                        <Brain size={16} style={{ color: C.accent }} />
                                                        <span style={{ fontSize: 12, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Agent AI Root Cause Analysis</span>
                                                        <span style={{ 
                                                            marginLeft: 'auto',
                                                            fontSize: 10, 
                                                            padding: '2px 8px', 
                                                            borderRadius: 12, 
                                                            background: (result as any).aiInsight.classification === 'BUG' ? `${C.red}22` : `${C.amber}22`,
                                                            color: (result as any).aiInsight.classification === 'BUG' ? C.red : C.amber,
                                                            fontWeight: 600,
                                                            border: `1px solid ${(result as any).aiInsight.classification === 'BUG' ? `${C.red}33` : `${C.amber}33`}`
                                                        }}>
                                                            {(result as any).aiInsight.classification === 'BUG' ? 'Application Bug' : 'Script / Selector Issue'}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, marginBottom: 8 }}>
                                                        <span style={{ color: C.dim }}>Summary:</span> {(result as any).aiInsight.summary}
                                                    </div>
                                                    <div style={{ fontSize: 13, color: C.accent, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <div style={{ padding: '4px 8px', background: `${C.accent}22`, borderRadius: 6, fontWeight: 600 }}>Suggested Fix</div>
                                                        <span>{(result as any).aiInsight.suggestedFix}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div style={{ padding: '24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: C.surface }}>
                    <button onClick={onClose} disabled={isUploading} style={{ padding: '8px 16px', background: C.input, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 14, fontWeight: 500, cursor: isUploading ? 'default' : 'pointer', opacity: isUploading ? 0.6 : 1 }}>
                        Close
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {!hasResults ? (
                            <button onClick={handleExecute} disabled={isExecuting} style={{ padding: '8px 24px', background: C.accent, border: 'none', borderRadius: 8, color: C.bg, fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: isExecuting ? 'default' : 'pointer', opacity: isExecuting ? 0.5 : 1 }}>
                                <Play size={16} /> Start Execution
                            </button>
                        ) : isExecuting ? (
                            <div style={{ fontSize: 14, color: C.dim }}>Executing tests...</div>
                        ) : (
                            <>
                                <button onClick={handleRerun} disabled={isUploading} style={{ padding: '8px 16px', background: C.amber, border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: isUploading ? 'default' : 'pointer', opacity: isUploading ? 0.5 : 1 }}>
                                    <RotateCcw size={16} /> Rerun
                                </button>
                                <button onClick={() => handleUploadAndTransition('Bug Done')} disabled={isUploading} style={{ padding: '8px 16px', background: C.red, border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: isUploading ? 'default' : 'pointer', opacity: isUploading ? 0.5 : 1 }}>
                                    {isUploading ? <RotateCcw size={16} className="animate-spin" /> : <Bug size={16} />}
                                    {isUploading ? 'Uploading…' : 'Bug Done'}
                                </button>
                                <button onClick={() => handleUploadAndTransition('Done')} disabled={isUploading} style={{ padding: '8px 16px', background: C.green, border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: isUploading ? 'default' : 'pointer', opacity: isUploading ? 0.5 : 1 }}>
                                    {isUploading ? <RotateCcw size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                                    {isUploading ? 'Uploading…' : 'Done'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
