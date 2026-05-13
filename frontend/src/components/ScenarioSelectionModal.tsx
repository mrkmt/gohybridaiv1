import React, { useState } from 'react';
import { X, Check, AlertCircle, Zap, Shield, HelpCircle, Activity, Layout } from 'lucide-react';

interface Scenario {
    id: string;
    title: string;
    description: string;
    type: string;
    selected: boolean;
}

interface ScenarioSelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    ticketId: string;
    summary: string;
    scenarios: Scenario[];
    onConfirm: (selected: Scenario[]) => void;
    isLoading: boolean;
}

const TYPE_ICONS: Record<string, any> = {
    positive: Zap,
    negative: Shield,
    edge_case: HelpCircle,
    ui_validation: Layout,
    workflow: Activity,
    regression: Shield,
};

const TYPE_COLORS: Record<string, string> = {
    positive: '#10b981',
    negative: '#ef4444',
    edge_case: '#f59e0b',
    ui_validation: '#3b82f6',
    workflow: '#8b5cf6',
    regression: '#6366f1',
};

export function ScenarioSelectionModal({
    isOpen,
    onClose,
    ticketId,
    summary,
    scenarios,
    onConfirm,
    isLoading
}: ScenarioSelectionModalProps) {
    const [localScenarios, setLocalScenarios] = useState<Scenario[]>(scenarios);

    // Update local state if props change (initial load)
    React.useEffect(() => {
        setLocalScenarios(scenarios);
    }, [scenarios]);

    if (!isOpen) return null;

    const toggleScenario = (id: string) => {
        setLocalScenarios(prev => prev.map(s => 
            s.id === id ? { ...s, selected: !s.selected } : s
        ));
    };

    const selectedCount = localScenarios.filter(s => s.selected).length;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[#1a1d21]/90 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-blue-500/10 to-purple-500/10">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-[10px] font-bold rounded uppercase tracking-wider">{ticketId}</span>
                            <h2 className="text-xl font-semibold text-white">Select Test Scenarios</h2>
                        </div>
                        <p className="text-sm text-gray-400 line-clamp-1">{summary}</p>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 hover:bg-white/5 rounded-full text-gray-400 hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 flex gap-3 text-sm text-blue-200/80 mb-6">
                        <AlertCircle size={18} className="shrink-0 text-blue-400" />
                        <p>Select the high-level scenarios you want to convert into detailed Playwright test cases. AI will generate step-by-step instructions for each selected item.</p>
                    </div>

                    <div className="grid gap-3">
                        {localScenarios.map((scenario) => {
                            const Icon = TYPE_ICONS[scenario.type] || HelpCircle;
                            const color = TYPE_COLORS[scenario.type] || '#9ca3af';

                            return (
                                <button
                                    key={scenario.id}
                                    onClick={() => toggleScenario(scenario.id)}
                                    className={`w-full text-left p-4 rounded-xl border transition-all duration-200 flex gap-4 ${
                                        scenario.selected 
                                            ? 'bg-blue-500/10 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.1)]' 
                                            : 'bg-white/5 border-white/10 hover:border-white/20'
                                    }`}
                                >
                                    <div 
                                        className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                                        style={{ backgroundColor: `${color}20`, color: color }}
                                    >
                                        <Icon size={20} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between mb-1">
                                            <h4 className="font-medium text-gray-100 truncate">{scenario.title}</h4>
                                            {scenario.selected && <Check size={16} className="text-blue-400" />}
                                        </div>
                                        <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
                                            {scenario.description}
                                        </p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/5 flex items-center justify-between bg-black/20">
                    <div className="text-sm">
                        <span className="text-white font-medium">{selectedCount}</span>
                        <span className="text-gray-400 ml-1">scenarios selected</span>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-5 py-2.5 rounded-xl text-sm font-medium border border-white/10 text-gray-300 hover:bg-white/5 hover:text-white transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            disabled={selectedCount === 0 || isLoading}
                            onClick={() => onConfirm(localScenarios.filter(s => s.selected))}
                            className={`px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                                selectedCount > 0 && !isLoading
                                    ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20'
                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                            }`}
                        >
                            {isLoading ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Zap size={16} />
                                    Generate Detailed Tests
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
