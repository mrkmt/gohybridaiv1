/**
 * ExecutionProgressDashboard Component
 * 
 * Real-time dashboard showing test execution progress with live updates.
 * Displays progress bar, test case status, and execution logs.
 */

import React, { useRef, useEffect } from 'react';
import {
    Play,
    CheckCircle2,
    XCircle,
    Circle,
    Activity,
    Clock,
    TrendingUp,
    AlertTriangle,
    Terminal,
    Pause,
    StopCircle
} from 'lucide-react';
import { ExecutionProgress, TestResult } from '../hooks/useTestExecutionWebSocket';
import { usePipelineProgress, PipelineProgressEvent } from '../hooks/usePipelineProgress';
import { PipelineProgressView } from './PipelineProgressView';

interface ExecutionProgressDashboardProps {
    progress: ExecutionProgress | null;
    percentComplete: number;
    isExecuting: boolean;
    logs: string[];
    onPause?: () => void;
    onStop?: () => void;
}

export function ExecutionProgressDashboard({
    progress,
    percentComplete,
    isExecuting,
    logs,
    onPause,
    onStop
}: ExecutionProgressDashboardProps) {
    const logsEndRef = useRef<HTMLDivElement>(null);

    // Subscribe to full pipeline progress (discovery → generation → compilation → execution)
    const pipeline = usePipelineProgress({
        ticketId: progress?.ticketId || null,
    });

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    if (!progress && !pipeline.isRunning) {
        return (
            <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
                <div className="text-center text-slate-400">
                    <Activity size={48} className="mx-auto mb-4 opacity-50" />
                    <p>No execution in progress</p>
                </div>
            </div>
        );
    }

    // When pipeline is running but execution progress not yet available, show pipeline-only view
    if (!progress) {
        return (
            <div className="space-y-4">
                <PipelineProgressView
                    currentEvent={pipeline.currentEvent}
                    overallProgress={pipeline.overallProgress}
                    currentPhase={pipeline.currentPhase}
                    phaseStatus={pipeline.phaseStatus}
                    history={pipeline.history}
                />
                <div className="text-center text-slate-400 text-sm py-4">
                    Execution details will appear once test cases start running...
                </div>
            </div>
        );
    }

    // From here, progress is non-null (both null cases handled above)
    const p = progress;

    const stats = {
        total: p.totalTestCases,
        completed: p.completedTestCases,
        remaining: p.totalTestCases - p.completedTestCases,
        passed: p.results?.filter(r => r.status === 'PASS').length || 0,
        failed: p.results?.filter(r => r.status === 'FAIL').length || 0,
        skipped: p.results?.filter(r => r.status === 'SKIPPED').length || 0
    };

    const passRate = stats.completed > 0 
        ? Math.round((stats.passed / stats.completed) * 100) 
        : 0;

    return (
        <div className="space-y-4">
            {/* Full Pipeline Progress (discovery → generation → compilation → execution) */}
            {pipeline.currentEvent && (
                <PipelineProgressView
                    currentEvent={pipeline.currentEvent}
                    overallProgress={pipeline.overallProgress}
                    currentPhase={pipeline.currentPhase}
                    phaseStatus={pipeline.phaseStatus}
                    history={pipeline.history}
                />
            )}

            {/* Header Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <Clock size={14} className="text-blue-400" />
                        <span className="text-xs text-slate-400">Status</span>
                    </div>
                    <div className="text-sm font-semibold text-white capitalize">
                        {p.status}
                    </div>
                </div>

                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <TrendingUp size={14} className="text-green-400" />
                        <span className="text-xs text-slate-400">Pass Rate</span>
                    </div>
                    <div className={`text-sm font-bold ${passRate >= 80 ? 'text-green-400' : passRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {passRate}%
                    </div>
                </div>

                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 size={14} className="text-green-400" />
                        <span className="text-xs text-slate-400">Passed</span>
                    </div>
                    <div className="text-sm font-bold text-green-400">
                        {stats.passed}
                    </div>
                </div>

                <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                        <XCircle size={14} className="text-red-400" />
                        <span className="text-xs text-slate-400">Failed</span>
                    </div>
                    <div className="text-sm font-bold text-red-400">
                        {stats.failed}
                    </div>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-white">Overall Progress</span>
                    <span className="text-sm font-mono text-blue-400">{percentComplete}%</span>
                </div>
                <div className="w-full bg-slate-700 h-3 rounded-full overflow-hidden">
                    <div 
                        className="bg-gradient-to-r from-blue-500 to-green-500 h-full transition-all duration-300"
                        style={{ width: `${percentComplete}%` }}
                    />
                </div>
                <div className="flex justify-between mt-2 text-xs text-slate-400">
                    <span>{stats.completed} of {stats.total} completed</span>
                    <span>{stats.remaining} remaining</span>
                </div>
            </div>

            {/* Current Test Case */}
            {p.currentTestCaseId && (
                <div className="bg-blue-900/20 border border-blue-700 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-blue-500/20 rounded-lg">
                            <Play size={16} className="text-blue-400" />
                        </div>
                        <div className="flex-1">
                            <div className="text-xs text-blue-400 font-medium mb-1">
                                Currently Executing
                            </div>
                            <div className="text-sm font-semibold text-white">
                                {p.currentTestCaseId}
                            </div>
                            {p.currentStep && p.totalSteps && (
                                <div className="text-xs text-slate-400 mt-1">
                                    Step {p.currentStep} of {p.totalSteps}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Test Results Summary */}
            {p.results && p.results.length > 0 && (
                <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                    <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                        <Activity size={14} className="text-slate-400" />
                        Test Results
                    </h4>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {p.results.map((result, idx) => (
                            <div
                                key={idx}
                                className={`flex items-center justify-between p-2 rounded-lg border ${
                                    result.status === 'PASS'
                                        ? 'bg-green-900/10 border-green-700/50'
                                        : result.status === 'FAIL'
                                        ? 'bg-red-900/10 border-red-700/50'
                                        : 'bg-slate-700/30 border-slate-600/50'
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    {result.status === 'PASS' ? (
                                        <CheckCircle2 size={14} className="text-green-400" />
                                    ) : result.status === 'FAIL' ? (
                                        <XCircle size={14} className="text-red-400" />
                                    ) : (
                                        <Circle size={14} className="text-slate-400" />
                                    )}
                                    <span className="text-xs font-medium text-white">{result.testCaseId}</span>
                                </div>
                                <div className="text-xs text-slate-400">
                                    {(result.duration / 1000).toFixed(1)}s
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Execution Logs */}
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
                <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    <Terminal size={14} className="text-slate-400" />
                    Execution Logs
                </h4>
                <div className="bg-black/50 rounded-lg p-3 font-mono text-xs max-h-64 overflow-y-auto">
                    {logs.length > 0 ? (
                        logs.map((log, idx) => (
                            <div key={idx} className="mb-1 text-slate-300">
                                <span className="text-slate-500">[{new Date().toLocaleTimeString()}]</span>{' '}
                                {log}
                            </div>
                        ))
                    ) : (
                        <div className="text-slate-500 italic">Waiting for logs...</div>
                    )}
                    <div ref={logsEndRef} />
                </div>
            </div>

            {/* Controls */}
            {(isExecuting || p.status === 'running') && (
                <div className="flex gap-2">
                    {onPause && (
                        <button
                            onClick={onPause}
                            className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors text-sm font-medium flex items-center justify-center gap-2"
                        >
                            <Pause size={16} /> Pause
                        </button>
                    )}
                    {onStop && (
                        <button
                            onClick={onStop}
                            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors text-sm font-medium flex items-center justify-center gap-2"
                        >
                            <StopCircle size={16} /> Stop
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
