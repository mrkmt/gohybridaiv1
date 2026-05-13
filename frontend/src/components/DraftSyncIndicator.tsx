/**
 * DraftSyncIndicator Component
 * 
 * Shows the sync status of test case drafts with the backend.
 * Provides visual feedback for offline drafts and auto-save status.
 */

import React, { useState, useEffect } from 'react';
import { 
    Cloud, 
    CloudOff, 
    CheckCircle2, 
    AlertCircle, 
    RotateCcw,
    Save,
    Clock
} from 'lucide-react';

interface DraftSyncIndicatorProps {
    ticketId: string;
    autoSaveEnabled?: boolean;
    onSync?: () => Promise<void>;
    onRestore?: () => Promise<void>;
}

interface SyncStatus {
    status: 'synced' | 'syncing' | 'unsynced' | 'offline' | 'error';
    lastSyncTime?: number;
    hasLocalDraft: boolean;
    hasServerDraft: boolean;
    message: string;
}

export function DraftSyncIndicator({
    ticketId,
    autoSaveEnabled = true,
    onSync,
    onRestore
}: DraftSyncIndicatorProps) {
    const [status, setStatus] = useState<SyncStatus>({
        status: 'syncing',
        hasLocalDraft: false,
        hasServerDraft: false,
        message: 'Checking sync status...'
    });

    const [isRestoring, setIsRestoring] = useState(false);

    useEffect(() => {
        checkSyncStatus();
        
        // Periodic status check
        const interval = setInterval(checkSyncStatus, 30000); // Every 30 seconds
        return () => clearInterval(interval);
    }, [ticketId]);

    const checkSyncStatus = async () => {
        try {
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
            
            // Check local storage for draft
            const localDraftKey = `draft_${ticketId}`;
            const hasLocal = localStorage.getItem(localDraftKey) !== null;
            
            // Check server for an existing session draft (backend stores sessions server-side)
            let hasServer = false;
            let lastSyncTime: number | undefined = undefined;

            const res = await fetch(`${API_URL}/api/testing/${ticketId}/session`);
            if (res.ok) {
                const data = await res.json();
                const serverSession = data?.session;
                hasServer = Boolean(serverSession);
                const ts = serverSession?.lastSavedAt || serverSession?.updatedAt;
                lastSyncTime = ts ? Date.parse(ts) : undefined;
            } else if (res.status !== 404) {
                throw new Error(`Server draft check failed: HTTP ${res.status}`);
            }
            
            let syncStatus: SyncStatus['status'] = 'synced';
            let message = '';
            
            if (!navigator.onLine) {
                syncStatus = 'offline';
                message = 'Working offline - changes saved locally';
            } else if (hasLocal && !hasServer) {
                syncStatus = 'unsynced';
                message = 'Unsynced changes pending';
            } else if (lastSyncTime && Date.now() - lastSyncTime < 60000) {
                syncStatus = 'synced';
                message = `Synced ${formatTimeAgo(lastSyncTime)}`;
            } else {
                syncStatus = 'synced';
                message = hasServer ? 'Draft saved on server' : 'No draft';
            }
            
            setStatus({
                status: syncStatus,
                lastSyncTime,
                hasLocalDraft: hasLocal,
                hasServerDraft: hasServer,
                message
            });
        } catch (error) {
            setStatus(prev => ({
                ...prev,
                status: 'error',
                message: 'Sync unavailable'
            }));
        }
    };

    const handleManualSync = async () => {
        if (!onSync) return;
        
        setStatus(prev => ({ ...prev, status: 'syncing', message: 'Syncing...' }));
        try {
            await onSync();
            await checkSyncStatus();
        } catch (error) {
            setStatus(prev => ({
                ...prev,
                status: 'error',
                message: 'Sync failed'
            }));
        }
    };

    const handleRestore = async () => {
        if (!onRestore) return;
        
        setIsRestoring(true);
        try {
            await onRestore();
            await checkSyncStatus();
        } catch (error) {
            console.error('Restore failed:', error);
        } finally {
            setIsRestoring(false);
        }
    };

    const getStatusIcon = () => {
        switch (status.status) {
            case 'synced':
                return <CheckCircle2 size={16} className="text-green-400" />;
            case 'syncing':
                return <RotateCcw size={16} className="text-blue-400 animate-spin" />;
            case 'unsynced':
                return <CloudOff size={16} className="text-amber-400" />;
            case 'offline':
                return <CloudOff size={16} className="text-slate-400" />;
            case 'error':
                return <AlertCircle size={16} className="text-red-400" />;
        }
    };

    const getStatusColor = () => {
        switch (status.status) {
            case 'synced':
                return 'bg-green-900/20 border-green-700';
            case 'syncing':
                return 'bg-blue-900/20 border-blue-700';
            case 'unsynced':
                return 'bg-amber-900/20 border-amber-700';
            case 'offline':
                return 'bg-slate-900/20 border-slate-700';
            case 'error':
                return 'bg-red-900/20 border-red-700';
        }
    };

    return (
        <div className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="text-xs text-slate-300">{status.message}</span>
            
            {/* Actions */}
            <div className="flex items-center gap-1 ml-2">
                {status.status === 'unsynced' && (
                    <button
                        onClick={handleManualSync}
                        className="p-1 hover:bg-slate-700 rounded transition-colors"
                        title="Sync now"
                    >
                        <Cloud size={12} className="text-amber-400" />
                    </button>
                )}
                
                {status.hasServerDraft && (
                    <button
                        onClick={handleRestore}
                        disabled={isRestoring}
                        className="p-1 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
                        title="Restore draft"
                    >
                        <RotateCcw size={12} className={`text-blue-400 ${isRestoring ? 'animate-spin' : ''}`} />
                    </button>
                )}
                
                {autoSaveEnabled && (
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Save size={10} />
                        <span>Auto-save on</span>
                    </div>
                )}
            </div>
        </div>
    );
}

function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}
