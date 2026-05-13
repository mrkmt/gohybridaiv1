/**
 * LiveExecutionFeed Component
 * 
 * Real-time test execution progress with WebSocket streaming
 * Shows step-by-step progress with status icons and auto-scrolling logs
 * 
 * @author Qwen AI Assistant
 * @date March 29, 2026
 */

import React, { useEffect, useRef, useState } from 'react';

interface StepProgress {
    stepNumber: number;
    action: string;
    status: 'pending' | 'running' | 'pass' | 'fail' | 'healed';
    duration?: number;
    error?: string;
}

interface ExecutionLog {
    timestamp: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
}

interface LiveExecutionFeedProps {
    ticketId: string;
    isRunning: boolean;
    steps: StepProgress[];
    logs: string[];
    onPause?: () => void;
    onResume?: () => void;
    onStop?: () => void;
}

export const LiveExecutionFeed: React.FC<LiveExecutionFeedProps> = ({
    ticketId,
    isRunning,
    steps,
    logs,
    onPause,
    onResume,
    onStop
}) => {
    const logsEndRef = useRef<HTMLDivElement>(null);
    const [activeTab, setActiveTab] = useState<'steps' | 'logs'>('steps');

    // Auto-scroll to bottom of logs
    useEffect(() => {
        if (activeTab === 'logs' && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, activeTab]);

    const getStepIcon = (status: StepProgress['status']) => {
        switch (status) {
            case 'pending': return '⏳';
            case 'running': return '🔄';
            case 'pass': return '✅';
            case 'fail': return '❌';
            case 'healed': return '🔧';
            default: return '⚪';
        }
    };

    const getStepColor = (status: StepProgress['status']) => {
        switch (status) {
            case 'pending': return '#6b7280';
            case 'running': return '#3b82f6';
            case 'pass': return '#10b981';
            case 'fail': return '#ef4444';
            case 'healed': return '#f59e0b';
            default: return '#9ca3af';
        }
    };

    const formatDuration = (ms?: number) => {
        if (!ms) return '';
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };

    const getLogColor = (type: ExecutionLog['type']) => {
        switch (type) {
            case 'info': return '#9ca3af';
            case 'success': return '#10b981';
            case 'warning': return '#f59e0b';
            case 'error': return '#ef4444';
            default: return '#d1d5db';
        }
    };

    // Parse log messages to determine type
    const parseLogType = (message: string): ExecutionLog['type'] => {
        if (message.includes('✅') || message.includes('PASS') || message.includes('Success')) {
            return 'success';
        }
        if (message.includes('❌') || message.includes('FAIL') || message.includes('Error')) {
            return 'error';
        }
        if (message.includes('⚠️') || message.includes('Warning') || message.includes('timeout')) {
            return 'warning';
        }
        return 'info';
    };

    return (
        <div style={{
            background: '#1e1e1e',
            borderRadius: '12px',
            border: '1px solid #374151',
            overflow: 'hidden',
            fontFamily: 'monospace'
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                background: '#2d2d2d',
                borderBottom: '1px solid #374151'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h3 style={{ margin: 0, color: '#f3f4f6', fontSize: '14px' }}>
                        🎬 Live Execution - {ticketId}
                    </h3>
                    {isRunning && (
                        <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '4px 8px',
                            background: 'rgba(59, 130, 246, 0.1)',
                            color: '#60a5fa',
                            borderRadius: '4px',
                            fontSize: '11px'
                        }}>
                            <span className="animate-spin">🔄</span>
                            Running
                        </span>
                    )}
                </div>

                {/* Control Buttons */}
                <div style={{ display: 'flex', gap: '8px' }}>
                    {isRunning && (
                        <>
                            <button
                                onClick={onPause}
                                style={{
                                    padding: '6px 12px',
                                    background: 'rgba(245, 158, 11, 0.1)',
                                    color: '#f59e0b',
                                    border: '1px solid rgba(245, 158, 11, 0.3)',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: 600
                                }}
                            >
                                ⏸️ Pause
                            </button>
                            <button
                                onClick={onResume}
                                style={{
                                    padding: '6px 12px',
                                    background: 'rgba(16, 185, 129, 0.1)',
                                    color: '#10b981',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: 600
                                }}
                            >
                                ▶️ Resume
                            </button>
                            <button
                                onClick={onStop}
                                style={{
                                    padding: '6px 12px',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    color: '#ef4444',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    fontWeight: 600
                                }}
                            >
                                ⏹️ Stop
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div style={{
                display: 'flex',
                borderBottom: '1px solid #374151',
                background: '#252525'
            }}>
                <button
                    onClick={() => setActiveTab('steps')}
                    style={{
                        padding: '10px 20px',
                        background: activeTab === 'steps' ? '#374151' : 'transparent',
                        color: activeTab === 'steps' ? '#f3f4f6' : '#9ca3af',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 600,
                        borderTop: activeTab === 'steps' ? '2px solid #60a5fa' : '2px solid transparent'
                    }}
                >
                    📋 Steps ({steps.length})
                </button>
                <button
                    onClick={() => setActiveTab('logs')}
                    style={{
                        padding: '10px 20px',
                        background: activeTab === 'logs' ? '#374151' : 'transparent',
                        color: activeTab === 'logs' ? '#f3f4f6' : '#9ca3af',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 600,
                        borderTop: activeTab === 'logs' ? '2px solid #60a5fa' : '2px solid transparent'
                    }}
                >
                    📜 Logs ({logs.length})
                </button>
            </div>

            {/* Content */}
            <div style={{
                height: '400px',
                overflowY: 'auto',
                padding: '12px'
            }}>
                {activeTab === 'steps' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {steps.length === 0 ? (
                            <div style={{
                                textAlign: 'center',
                                padding: '40px',
                                color: '#6b7280',
                                fontSize: '13px'
                            }}>
                                No steps yet. Waiting for execution to start...
                            </div>
                        ) : (
                            steps.map((step, index) => (
                                <div
                                    key={index}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        padding: '10px 12px',
                                        background: step.status === 'running' 
                                            ? 'rgba(59, 130, 246, 0.1)' 
                                            : step.status === 'fail'
                                            ? 'rgba(239, 68, 68, 0.1)'
                                            : step.status === 'pass'
                                            ? 'rgba(16, 185, 129, 0.1)'
                                            : 'rgba(255, 255, 255, 0.05)',
                                        borderRadius: '8px',
                                        border: `1px solid ${getStepColor(step.status)}30`
                                    }}
                                >
                                    <span style={{ fontSize: '18px' }}>
                                        {getStepIcon(step.status)}
                                    </span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{
                                            color: '#f3f4f6',
                                            fontSize: '12px',
                                            fontWeight: 600
                                        }}>
                                            Step {step.stepNumber}: {step.action}
                                        </div>
                                        {step.error && (
                                            <div style={{
                                                color: '#ef4444',
                                                fontSize: '11px',
                                                marginTop: '4px'
                                            }}>
                                                {step.error}
                                            </div>
                                        )}
                                    </div>
                                    {step.duration && (
                                        <span style={{
                                            color: getStepColor(step.status),
                                            fontSize: '11px',
                                            fontWeight: 600
                                        }}>
                                            {formatDuration(step.duration)}
                                        </span>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'logs' && (
                    <div style={{
                        background: '#0d0d0d',
                        borderRadius: '8px',
                        padding: '12px',
                        fontFamily: 'Consolas, Monaco, monospace',
                        fontSize: '11px',
                        lineHeight: '1.6',
                        height: '100%',
                        overflowY: 'auto'
                    }}>
                        {logs.length === 0 ? (
                            <div style={{
                                textAlign: 'center',
                                padding: '40px',
                                color: '#6b7280'
                            }}>
                                No logs yet. Waiting for execution to start...
                            </div>
                        ) : (
                            logs.map((log, index) => {
                                const logType = parseLogType(log);
                                return (
                                    <div
                                        key={index}
                                        style={{
                                            color: getLogColor(logType),
                                            borderBottom: '1px solid #1a1a1a',
                                            paddingBottom: '4px',
                                            marginBottom: '4px'
                                        }}
                                    >
                                        <span style={{ opacity: 0.5 }}>
                                            [{new Date().toLocaleTimeString()}]
                                        </span>{' '}
                                        {log}
                                    </div>
                                );
                            })
                        )}
                        <div ref={logsEndRef} />
                    </div>
                )}
            </div>
        </div>
    );
};

export default LiveExecutionFeed;
