import React, { useState } from 'react';
import { CheckSquare, Square, Play, CheckCircle2, AlertCircle } from 'lucide-react';

interface ActionItem {
    id: string;
    label: string;
    description?: string;
    status?: 'pending' | 'approved' | 'running' | 'completed' | 'failed';
}

interface ActionBlockProps {
    title: string;
    items: ActionItem[];
    onExecute: (selectedIds: string[]) => void;
    onApproveAll?: () => void;
}

export const ActionBlock: React.FC<ActionBlockProps> = ({ 
    title, 
    items: initialItems, 
    onExecute,
    onApproveAll 
}) => {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialItems.map(i => i.id)));
    const [isExecuting, setIsExecuting] = useState(false);

    const toggleItem = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    const handleRun = () => {
        setIsExecuting(true);
        onExecute(Array.from(selectedIds));
    };

    return (
        <div className="bg-[#1e1e1e] border border-[#333] rounded-lg overflow-hidden my-4 shadow-xl max-w-2xl">
            <div className="bg-[#252526] px-4 py-2 border-b border-[#333] flex justify-between items-center">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</span>
                <span className="text-[10px] bg-[#37373d] px-2 py-0.5 rounded text-gray-300">
                    {selectedIds.size} of {initialItems.length} selected
                </span>
            </div>
            
            <div className="p-2 space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
                {initialItems.map((item) => (
                    <div 
                        key={item.id}
                        onClick={() => toggleItem(item.id)}
                        className={`flex items-start gap-3 p-2 rounded cursor-pointer transition-colors ${
                            selectedIds.has(item.id) ? 'bg-[#2a2d2e]' : 'hover:bg-[#252526]'
                        }`}
                    >
                        <div className="mt-0.5">
                            {selectedIds.has(item.id) ? (
                                <CheckSquare size={16} className="text-[#007acc]" />
                            ) : (
                                <Square size={16} className="text-gray-500" />
                            )}
                        </div>
                        <div className="flex-1">
                            <div className="text-sm text-gray-200">{item.label}</div>
                            {item.description && (
                                <div className="text-[11px] text-gray-500 mt-0.5">{item.description}</div>
                            )}
                        </div>
                        {item.status === 'completed' && <CheckCircle2 size={14} className="text-green-500" />}
                        {item.status === 'failed' && <AlertCircle size={14} className="text-red-500" />}
                        {item.status === 'running' && <div className="w-3 h-3 border-2 border-[#007acc] border-t-transparent rounded-full animate-spin" />}
                    </div>
                ))}
            </div>

            <div className="bg-[#252526] p-3 flex gap-2 border-t border-[#333]">
                <button 
                    onClick={handleRun}
                    disabled={selectedIds.size === 0 || isExecuting}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium transition-all ${
                        selectedIds.size === 0 || isExecuting
                            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                            : 'bg-[#007acc] hover:bg-[#118ad4] text-white active:scale-95'
                    }`}
                >
                    <Play size={14} fill="currentColor" />
                    {isExecuting ? 'Starting...' : 'Run Selected'}
                </button>
                
                {onApproveAll && (
                    <button 
                        onClick={() => {
                            setSelectedIds(new Set(initialItems.map(i => i.id)));
                            onApproveAll();
                        }}
                        className="px-3 py-1.5 rounded text-sm font-medium border border-[#333] hover:bg-[#37373d] text-gray-300 transition-colors"
                    >
                        Review All
                    </button>
                )}
            </div>
        </div>
    );
};
