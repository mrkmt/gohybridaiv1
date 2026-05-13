/**
 * useTestExecutionWebSocket - Enhanced Version
 * 
 * Custom hook for real-time test execution progress updates via WebSocket
 * with automatic reconnection, exponential backoff, and connection health monitoring.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface ExecutionProgress {
    ticketId: string;
    currentTestCaseId: string;
    totalTestCases: number;
    completedTestCases: number;
    currentStep?: number;
    totalSteps?: number;
    status: 'running' | 'completed' | 'failed';
    results: TestResult[];
}

export interface TestResult {
    testCaseId: string;
    testCaseTitle: string;
    status: 'PASS' | 'FAIL' | 'SKIPPED';
    duration: number;
    errorMessage?: string;
    steps: StepResult[];
}

export interface StepResult {
    stepNumber: number;
    action: string;
    expectedResult: string;
    status: 'PASS' | 'FAIL';
    errorMessage?: string;
}

export interface WebSocketMessage {
    type: 'execution:started' | 'execution:progress' | 'execution:complete' | 'execution:failed' | 'execution:log' | 'TELEMETRY_LOG' | 'pong' | 'pipeline:progress';
    payload: any;
    timestamp: string;
}

export interface ConnectionStats {
    connected: boolean;
    reconnectCount: number;
    lastReconnectTime?: number;
    connectionDuration: number;
    messageCount: number;
}

interface UseWebSocketOptions {
    autoReconnect?: boolean;
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onMessage?: (message: WebSocketMessage) => void;
}

export function useTestExecutionWebSocket(
    ticketId: string | null,
    authToken?: string | null,
    options: UseWebSocketOptions = {}
) {
    const {
        autoReconnect = true,
        maxReconnectAttempts = 5,
        reconnectDelay = 3000,
        onConnect,
        onDisconnect,
        onMessage
    } = options;

    const onConnectRef = useRef(onConnect);
    const onDisconnectRef = useRef(onDisconnect);
    const onMessageRef = useRef(onMessage);

    // Keep refs current to avoid stale closures without triggering re-connects
    useEffect(() => { onConnectRef.current = onConnect; }, [onConnect]);
    useEffect(() => { onDisconnectRef.current = onDisconnect; }, [onDisconnect]);
    useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

    const [connected, setConnected] = useState(false);
    const [progress, setProgress] = useState<ExecutionProgress | null>(null);
    const [messages, setMessages] = useState<WebSocketMessage[]>([]);
    const [logs, setLogs] = useState<string[]>([]); // Separate logs array
    const [lastLog, setLastLog] = useState<any>(null); // NEW: Track the single last log for visual preview
    const [stats, setStats] = useState<ConnectionStats>({
        connected: false,
        reconnectCount: 0,
        connectionDuration: 0,
        messageCount: 0
    });

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const connectionStartTimeRef = useRef<number>(0);
    const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    const WS_URL = API_URL.replace('http', 'ws') + '/ws';

    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
        }

        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        setConnected(false);
        setStats(prev => ({ ...prev, connected: false }));
        onDisconnectRef.current?.();
    }, []);

    const connect = useCallback(() => {
        if (!ticketId) return;

        // Prevent multiple simultaneous connections
        if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
            console.log('[WebSocket] Connection already active or in progress, skipping...');
            return;
        }

        try {
            console.log(`[WebSocket] Connecting to ${WS_URL}...`);
            wsRef.current = new WebSocket(WS_URL);

            wsRef.current.onopen = () => {
                console.log('[WebSocket] Connected successfully');
                setConnected(true);
                connectionStartTimeRef.current = Date.now();
                reconnectAttemptsRef.current = 0;

                setStats(prev => ({
                    ...prev,
                    connected: true,
                    reconnectCount: reconnectAttemptsRef.current,
                    connectionDuration: 0
                }));

                // STEP 1: Auth handshake (backend requires { type: 'auth', token: '...' } first)
                if (authToken) {
                    wsRef.current?.send(JSON.stringify({
                        type: 'auth',
                        token: authToken
                    }));

                    // Wait for auth response before subscribing
                    const authHandler = (e: MessageEvent) => {
                        try {
                            const data = JSON.parse(e.data);
                            if (data.type === 'auth_ok') {
                                console.log('[WebSocket] Authenticated as:', data.userId);
                                // STEP 2: Subscribe to ticket channel
                                wsRef.current?.send(JSON.stringify({
                                    type: 'subscribe',
                                    channel: `execution:${ticketId}`
                                }));
                                // Start ping
                                pingIntervalRef.current = setInterval(() => {
                                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                                        wsRef.current.send(JSON.stringify({ type: 'ping' }));
                                    }
                                }, 30000);
                                onConnectRef.current?.();
                            } else if (data.type === 'auth_failed' || data.type === 'error') {
                                console.error('[WebSocket] Auth failed:', data);
                                wsRef.current?.close(1008, 'Auth failed');
                            }
                        } catch (authErr) {
                            console.error('[WebSocket] Auth response parse error:', authErr);
                        }
                    };
                    wsRef.current!.addEventListener('message', authHandler, { once: true });
                } else {
                    // No auth token — try subscribing anyway (dev mode fallback)
                    console.warn('[WebSocket] No auth token provided, subscribing without auth (dev mode)');
                    wsRef.current?.send(JSON.stringify({
                        type: 'subscribe',
                        channel: `execution:${ticketId}`
                    }));
                    pingIntervalRef.current = setInterval(() => {
                        if (wsRef.current?.readyState === WebSocket.OPEN) {
                            wsRef.current.send(JSON.stringify({ type: 'ping' }));
                        }
                    }, 30000);
                    onConnectRef.current?.();
                }
            };

            wsRef.current.onmessage = (event) => {
                try {
                    const message: WebSocketMessage = JSON.parse(event.data);

                    // Ignore non-execution messages (keepalive, telemetry, live steps)
                    if ((message as any).type === 'pong') return;

                    // Handle pipeline:progress events
                    if ((message as any).type === 'pipeline:progress') {
                        window.dispatchEvent(new CustomEvent('pipeline:progress', {
                            detail: message.payload,
                        }));
                        setStats(prev => ({ ...prev, messageCount: prev.messageCount + 1 }));
                        return;
                    }

                    // Support both ticket-specific execution messages and global telemetry/logs
                    const isExecutionMsg = message.type?.startsWith('execution:');
                    const isTelemetryMsg = message.type === 'TELEMETRY_LOG';

                    if (!isExecutionMsg && !isTelemetryMsg) return;

                    // Handle different message types
                    if (message.type === 'execution:log' || isTelemetryMsg) {
                        // Extract log text from various formats
                        const payload = message.payload as any;
                        const logText = typeof payload === 'string' ? payload : (payload?.log || payload?.message || JSON.stringify(payload) || '');
                        const safeLogText = String(logText);
                        
                        console.log('[WebSocket] Processing log:', safeLogText.substring(0, 50));
                        
                        setLogs(prev => {
                            const newLogs = [...prev, `[${new Date().toLocaleTimeString()}] ${safeLogText}`];
                            return newLogs.slice(-3000);
                        });
                        
                        setLastLog(payload); // Update the single last log

                        setMessages(prev => {
                            const newMessages = [...prev, message];
                            return newMessages.slice(-100);
                        });
                        onMessageRef.current?.(message);
                    } else if (isExecutionMsg) {
                        // Progress/State messages
                        setProgress(message.payload);
                        setLastLog(message.payload); // Also update here for progress
                        setMessages(prev => {
                            const newMessages = [...prev, message];
                            return newMessages.slice(-100);
                        });
                        onMessageRef.current?.(message);
                    }

                    setStats(prev => ({
                        ...prev,
                        messageCount: prev.messageCount + 1
                    }));
                } catch (error) {
                    console.error('[WebSocket] Failed to parse message:', error);
                }
            };

            wsRef.current.onclose = () => {
                console.log('[WebSocket] Connection closed');
                setConnected(false);

                const duration = Date.now() - connectionStartTimeRef.current;
                setStats(prev => ({
                    ...prev,
                    connected: false,
                    connectionDuration: duration
                }));

                // Attempt reconnection with exponential backoff
                if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
                    const delay = reconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
                    reconnectAttemptsRef.current++;

                    console.log(`[WebSocket] Reconnecting in ${delay}ms...`);

                    reconnectTimeoutRef.current = setTimeout(() => {
                        if (ticketId) connect();
                    }, delay);

                    setStats(prev => ({
                        ...prev,
                        reconnectCount: reconnectAttemptsRef.current,
                        lastReconnectTime: Date.now()
                    }));
                }

                onDisconnectRef.current?.();
            };

            wsRef.current.onerror = (error) => {
                console.error('[WebSocket] Error occurred:', error);
            };
        } catch (error) {
            console.error('[WebSocket] Failed to create connection:', error);
            if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
                reconnectAttemptsRef.current++;
                reconnectTimeoutRef.current = setTimeout(() => connect(), reconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1));
            }
        }
    }, [ticketId, authToken, WS_URL, autoReconnect, maxReconnectAttempts, reconnectDelay]);

    const sendMessage = useCallback((data: any) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(data));
        } else {
            console.warn('[WebSocket] Cannot send - not connected');
        }
    }, []);

    // Stable ref for connect to avoid dependency cycles
    const connectRef = useRef(connect);
    connectRef.current = connect;
    const disconnectRef = useRef(disconnect);
    disconnectRef.current = disconnect;

    useEffect(() => {
        if (ticketId) {
            connectRef.current();
        }

        return () => {
            disconnectRef.current();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ticketId, authToken]);

    // Update connection duration periodically
    useEffect(() => {
        const interval = setInterval(() => {
            if (connected && connectionStartTimeRef.current) {
                const duration = Date.now() - connectionStartTimeRef.current;
                setStats(prev => ({ ...prev, connectionDuration: duration }));
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [connected]);

    const resetProgress = useCallback(() => {
        setProgress(null);
        setMessages([]);
        setLogs([]);
    }, []);

    const manualReconnect = useCallback(() => {
        disconnect();
        reconnectAttemptsRef.current = 0;
        setTimeout(() => connect(), 500);
    }, [connect, disconnect]);

    return {
        connected,
        progress,
        messages,
        logs, // Return logs separately
        stats,
        currentTestCase: progress?.currentTestCaseId,
        completedCount: progress?.completedTestCases || 0,
        totalCount: progress?.totalTestCases || 0,
        percentComplete: progress && progress.totalTestCases > 0
            ? Math.round((progress.completedTestCases / progress.totalTestCases) * 100)
            : 0,
        status: progress?.status || 'idle',
        results: progress?.results || [],
        lastLog,
        sendMessage,
        resetProgress,
        manualReconnect
    };
}
