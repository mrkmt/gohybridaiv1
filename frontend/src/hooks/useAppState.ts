import { useState, useEffect, useCallback } from 'react';
import { useTestExecutionWebSocket } from './useTestExecutionWebSocket';
import type { TestEnvironment } from '../services/TestExecutionService';

// @ts-ignore
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface AgentAssignment {
    role: string;
    profile: string;
}

export interface ProviderStatus {
    id: string;
    name: string;
    enabled: boolean;
    status: 'online' | 'offline';
}

// Re-export TestEnvironment for consumers that import from here
export type { TestEnvironment };

export function useAppState() {
    // 1. Session & Ticket State
    const [currentTicket, setCurrentTicket] = useState<any>(null);
    const [environment, setEnvironment] = useState<TestEnvironment>({
        stage: 'testing',
        baseUrl: 'https://test.globalhr.com.mm/',
        customerId: 'ook',
        fullUrl: 'https://test.globalhr.com.mm/ook#/login',
        idNumber: 'testook_HR 1',
        username: 'testook_HR 1',
        password: 'Global@2024',
        browser: 'chromium',
        headless: true,
        timeout: 5,
        autoHeal: true,
    });

    // 2. Execution State (via WebSocket)
    const [executionLog, setExecutionLog] = useState<string[]>([]);
    
    const handleWebSocketMessage = useCallback((message: any) => {
        if (message.type === 'execution:log' && message.payload?.log) {
            setExecutionLog(prev => [...prev.slice(-199), message.payload.log]);
        }
    }, []);

    const {
        progress,
        status: executionStatus,
        percentComplete,
        results: executionResults,
        resetProgress
    } = useTestExecutionWebSocket(
        currentTicket?.ticketId || null,
        localStorage.getItem('auth_token'),  // Pass JWT for WS auth handshake
        {
            onMessage: handleWebSocketMessage
        }
    );

    const isExecuting = executionStatus === 'running';

    // 3. System Configuration
    const [agentConfig, setAgentConfig] = useState<any>(null);
    const [providerStatuses, setProviderStatuses] = useState<any[]>([]);
    const [sidebarPosition, setSidebarPosition] = useState<'left' | 'right'>('left');

    const fetchConfig = useCallback(async () => {
        try {
            const [agentRes, providersRes] = await Promise.all([
                fetch(`${API_URL}/api/ai/agent-profiles`),
                fetch(`${API_URL}/api/ai-providers/status`)
            ]);
            if (agentRes.ok) setAgentConfig(await agentRes.json());
            if (providersRes.ok) setProviderStatuses(await providersRes.json());
        } catch (err) {
            console.error('Failed to fetch system config', err);
        }
    }, []);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    const saveAgentAssignment = async (role: string, profile: string) => {
        try {
            await fetch(`${API_URL}/api/ai/agent-profiles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, profile })
            });
            await fetchConfig();
        } catch (err) {
            console.error('Failed to save agent assignment', err);
        }
    };

    return {
        // Ticket/Session
        currentTicket,
        setCurrentTicket,
        environment,
        setEnvironment,
        
        // Execution
        progress,
        executionStatus,
        isExecuting,
        percentComplete,
        executionResults,
        executionLog,
        resetProgress,
        
        // Config
        agentConfig,
        providerStatuses,
        sidebarPosition,
        setSidebarPosition,
        saveAgentAssignment,
        refreshConfig: fetchConfig
    };
}
