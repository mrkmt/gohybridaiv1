/**
 * ScenarioSelection Component
 * 
 * Interactive test scenario selection
 * AI generates proposed scenarios, user selects which to automate
 * 
 * @author Qwen AI Assistant
 * @date March 29, 2026
 */

import React, { useState } from 'react';

export interface TestScenario {
    id: string;
    title: string;
    description: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    tags: string[];
    steps: string[];
}

interface ScenarioSelectionProps {
    scenarios: TestScenario[];
    isLoading: boolean;
    onComplete: (selectedScenarioIds: string[]) => void;
    onCancel: () => void;
}

export const ScenarioSelection: React.FC<ScenarioSelectionProps> = ({
    scenarios,
    isLoading,
    onComplete,
    onCancel
}) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const toggleScenario = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    const selectAll = () => {
        setSelectedIds(new Set(scenarios.map(s => s.id)));
    };

    const selectNone = () => {
        setSelectedIds(new Set());
    };

    const handleComplete = () => {
        onComplete(Array.from(selectedIds));
    };

    const getPriorityColor = (priority: TestScenario['priority']) => {
        switch (priority) {
            case 'HIGH': return 'bg-rose-900/40 text-rose-400 border-rose-700/50';
            case 'MEDIUM': return 'bg-amber-900/40 text-amber-400 border-amber-700/50';
            case 'LOW': return 'bg-slate-800 text-slate-400 border-slate-700';
        }
    };

    if (isLoading) {
        return (
            <div className="bg-slate-900 rounded-2xl border border-slate-700 p-8">
                <div className="text-center space-y-4">
                    <div className="animate-spin text-4xl">🔄</div>
                    <h3 className="text-lg font-semibold text-white">
                        AI is analyzing requirements...
                    </h3>
                    <p className="text-slate-400 text-sm">
                        Generating test scenarios from Jira ticket
                    </p>
                </div>
            </div>
        );
    }

    if (scenarios.length === 0) {
        return (
            <div className="bg-slate-900 rounded-2xl border border-slate-700 p-8">
                <div className="text-center space-y-4">
                    <div className="text-4xl">❓</div>
                    <h3 className="text-lg font-semibold text-white">
                        No scenarios generated
                    </h3>
                    <p className="text-slate-400 text-sm">
                        The AI couldn't generate test scenarios from this ticket
                    </p>
                    <button
                        onClick={onCancel}
                        className="px-6 py-2 bg-slate-800 text-slate-300 rounded-lg 
                                 font-semibold hover:bg-slate-700 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-white/5 overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="px-6 py-5 border-b border-white/5 bg-white/5">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-3">
                            <span className="p-2 bg-blue-500/10 rounded-lg text-blue-400">📋</span>
                            Select Test Scenarios
                        </h2>
                        <p className="text-slate-400 text-sm mt-1 ml-11">
                            {selectedIds.size} of {scenarios.length} selected for automation
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={selectAll}
                            className="btn btn-secondary px-4 py-2 text-xs"
                        >
                            Select All
                        </button>
                        <button
                            onClick={selectNone}
                            className="btn btn-secondary px-4 py-2 text-xs"
                        >
                            Deselect
                        </button>
                    </div>
                </div>
            </div>

            {/* Scenarios List */}
            <div className="max-h-[500px] overflow-y-auto p-6 space-y-4 custom-scrollbar">
                {scenarios.map((scenario) => {
                    const isSelected = selectedIds.has(scenario.id);
                    return (
                        <div
                            key={scenario.id}
                            onClick={() => toggleScenario(scenario.id)}
                            className={`group relative p-5 rounded-2xl border-2 cursor-pointer transition-all duration-300 ${
                                isSelected 
                                    ? 'bg-blue-500/10 border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.1)]' 
                                    : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10'
                            }`}
                        >
                            <div className="flex items-start gap-4">
                                {/* Checkbox Animation */}
                                <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-300 ${
                                    isSelected 
                                        ? 'bg-blue-500 border-blue-500 scale-110 shadow-lg shadow-blue-500/20' 
                                        : 'border-white/20 group-hover:border-white/40'
                                }`}>
                                    {isSelected && (
                                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M10 3L4.5 8.5L2 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    )}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <h3 className="font-bold text-white text-lg tracking-tight">
                                            {scenario.title}
                                        </h3>
                                        <span className={`
                                            px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border
                                            ${getPriorityColor(scenario.priority)}
                                        `}>
                                            {scenario.priority}
                                        </span>
                                    </div>
                                    <p className="text-slate-400 text-sm leading-relaxed mb-4 opacity-80 group-hover:opacity-100 transition-opacity">
                                        {scenario.description}
                                    </p>

                                    {/* Tags */}
                                    {scenario.tags.length > 0 && (
                                        <div className="flex flex-wrap gap-2">
                                            {scenario.tags.map((tag, index) => (
                                                <span
                                                    key={index}
                                                    className="px-2.5 py-1 bg-white/5 text-slate-300 border border-white/5
                                                             rounded-lg text-[11px] font-medium"
                                                >
                                                    #{tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div className="px-8 py-6 border-t border-white/5 bg-white/5">
                <div className="flex gap-4">
                    <button
                        onClick={onCancel}
                        className="btn btn-secondary flex-1 py-4"
                    >
                        Maybe Later
                    </button>
                    <button
                        onClick={handleComplete}
                        disabled={selectedIds.size === 0}
                        className={`btn btn-primary flex-1 py-4 text-lg ${
                            selectedIds.size === 0 ? 'opacity-50 grayscale cursor-not-allowed' : ''
                        }`}
                    >
                        ✨ Automate {selectedIds.size} Scenario{selectedIds.size !== 1 ? 's' : ''}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ScenarioSelection;