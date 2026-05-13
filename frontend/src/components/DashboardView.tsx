import React, { useState, useEffect, useRef } from 'react';
import { 
  BarChart3, 
  Play, 
  CheckCircle2, 
  Clock, 
  Activity, 
  Terminal as TerminalIcon, 
  ChevronDown, 
  ChevronUp,
  Search, 
  Filter, 
  Layers, 
  Zap, 
  RotateCcw
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import { ExecutionProgress, TestResult as WsTestResult } from '../hooks/useTestExecutionWebSocket';

interface DashboardViewProps {
  progress: ExecutionProgress | null;
  percentComplete: number;
  isExecuting: boolean;
  logs: string[];
  results: WsTestResult[];
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  progress,
  percentComplete,
  isExecuting,
  logs: realLogs,
  results: realResults
}) => {
    const [isTerminalOpen, setIsTerminalOpen] = useState(true);
    const terminalEndRef = useRef<HTMLDivElement>(null);

    // Destructure to acknowledge props
    const _unused = { progress, percentComplete, isExecuting };

    // Filter and map real results to the dashboard's display format if needed
    // For now we'll use a mix of real results if available, otherwise fallback to mocks for demonstration
    const displayResults = realResults.length > 0 ? realResults.map(r => ({
        id: r.testCaseId,
        name: r.testCaseTitle || r.testCaseId,
        status: r.status as 'PASS' | 'FAIL' | 'RUNNING' | 'PENDING',
        duration: (r.duration / 1000).toFixed(1) + 's',
        timestamp: 'recent'
    })) : [];

    useEffect(() => {
        if (isTerminalOpen) {
            terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [realLogs, isTerminalOpen]);

    return (
        <div className="flex h-full flex-col relative bg-[#0a0a14]">
            {/* Header Content */}
            <div className="px-10 py-8 border-b border-white/5 bg-slate-900/10">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-600/10 rounded-lg">
                            <BarChart3 className="h-5 w-5 text-indigo-400" />
                        </div>
                        <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">Execution Discovery Center</h1>
                    </div>
                    <div className="flex items-center gap-3">
                         <div className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-bold text-white transition-all cursor-pointer shadow-lg shadow-indigo-900/20">
                            <Play className="h-3.5 w-3.5 fill-current" />
                            Launch Batch Discovery
                         </div>
                         <div className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700 cursor-pointer transition-all">
                            <RotateCcw className="h-4 w-4 text-slate-400" />
                         </div>
                    </div>
                </div>

                {/* Performance Stats Dashboard */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[
                        { label: 'Total Tests', val: realResults.length.toString(), icon: Layers, color: 'blue' },
                        { label: 'Avg Success', val: '94.2%', icon: CheckCircle2, color: 'emerald' },
                        { label: 'Avg Speed', val: '14.5s', icon: Clock, color: 'amber' },
                        { label: 'Self Healing', val: '12', icon: Zap, color: 'indigo' }
                    ].map((s: any) => (
                        <div key={s.label} className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 ring-1 ring-inset ring-white/5">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">{s.label}</span>
                                <s.icon className={cn("h-3.5 w-3.5", `text-${s.color}-400`)} />
                            </div>
                            <div className="text-xl font-bold text-white">{s.val}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Results Grid Area */}
            <div className="flex-1 overflow-y-auto p-10 custom-scrollbar pb-32">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                        <Activity className="h-4 w-4 text-blue-500" />
                        Recent Discovery Cycles
                    </h3>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
                            <input type="text" placeholder="Filter jobs..." className="h-8 bg-slate-900/50 border border-slate-800 rounded-lg pl-8 pr-3 text-[11px] font-medium focus:ring-1 focus:ring-blue-500 outline-none w-48" />
                        </div>
                        <div className="h-8 w-8 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-lg cursor-pointer hover:bg-slate-800">
                           <Filter className="h-3.5 w-3.5 text-slate-400" />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
                    {displayResults.map((r: any) => (
                        <div key={r.id} className="group p-5 rounded-2xl bg-slate-900/20 border border-slate-800 hover:border-slate-700/50 transition-all duration-300">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex-1 min-w-0 pr-4">
                                    <div className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.1em] mb-1">{r.id} Cycle</div>
                                    <div className="text-sm font-bold text-slate-100 truncate">{r.name}</div>
                                </div>
                                <div className={cn(
                                    "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ring-1 ring-inset",
                                    r.status === 'PASS' ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20" :
                                    r.status === 'FAIL' ? "bg-red-500/10 text-red-400 ring-red-500/20" :
                                    r.status === 'RUNNING' ? "bg-blue-500/10 text-blue-400 ring-blue-500/30 animate-pulse" :
                                    "bg-slate-800 text-slate-500 ring-slate-700"
                                )}>
                                    {r.status}
                                </div>
                            </div>
                            
                            <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 border-t border-white/5 pt-4">
                                <div className="flex items-center gap-1.5">
                                    <Clock className="h-3 w-3" />
                                    {r.timestamp}
                                </div>
                                <div className="font-mono text-slate-400">{r.duration}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Live Terminal Overlay Component */}
            <div className="fixed bottom-0 right-0 left-0 lg:left-20 transition-all duration-500 z-50 overflow-hidden">
                <div className={cn(
                    "mx-6 mb-6 rounded-2xl bg-black border border-slate-800 shadow-2xl transition-all duration-500 flex flex-col",
                    isTerminalOpen ? "h-64" : "h-12"
                )}>
                    {/* Terminal Header */}
                    <div 
                        onClick={() => setIsTerminalOpen(!isTerminalOpen)}
                        className="h-12 flex items-center justify-between px-5 bg-slate-950 border-b border-slate-800 cursor-pointer select-none rounded-t-2xl"
                    >
                        <div className="flex items-center gap-3">
                            <TerminalIcon className="h-4 w-4 text-emerald-500" />
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Diagnostic Logic Logs (WS)</span>
                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        </div>
                        <div className="flex items-center gap-4 text-slate-500">
                             <span className="text-[10px] font-mono tracking-tighter">CONNECTED TO :3000</span>
                             {isTerminalOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                        </div>
                    </div>

                    {/* Terminal Logs */}
                    {isTerminalOpen && (
                        <div className="flex-1 overflow-y-auto p-5 font-mono text-[11px] leading-relaxed custom-scrollbar bg-black/80 backdrop-blur-sm">
                            {realLogs.map((log: string, i: number) => {
                                const isEngine = log.includes('[Engine]');
                                const isError = log.includes('error') || log.includes('FAIL');
                                return (
                                    <div key={i} className={cn(
                                        "mb-1",
                                        isEngine ? "text-indigo-400" : 
                                        isError ? "text-red-400" :
                                        "text-slate-400"
                                    )}>
                                        {log}
                                    </div>
                                );
                            })}
                            <div className="flex items-center gap-2 mt-2 text-emerald-500 opacity-60">
                                <span className="font-bold">&gt;</span>
                                <span className="h-3 w-1.5 bg-emerald-500 animate-[blink_1s_step-end_infinite]" />
                            </div>
                            <div ref={terminalEndRef} />
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes blink { 50% { opacity: 0; } }
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
            `}</style>
        </div>
    );
};
