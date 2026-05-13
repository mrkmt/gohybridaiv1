import { useState, useEffect, useRef, useCallback } from 'react';

interface UseWebSocketOptions {
    url: string;
    onMessage?: (data: any) => void;
    maxRetries?: number;
}

interface WebSocketState {
    isConnected: boolean;
    retryCount: number;
}

/**
 * Custom hook for WebSocket connections with automatic exponential backoff reconnection.
 * Replaces the bare WebSocket usage in App.tsx to prevent silent disconnects.
 */
export function useWebSocket({ url, onMessage, maxRetries = 10 }: UseWebSocketOptions): WebSocketState {
    const [state, setState] = useState<WebSocketState>({ isConnected: false, retryCount: 0 });
    const wsRef = useRef<WebSocket | null>(null);
    const retryCountRef = useRef(0);
    const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onMessageRef = useRef(onMessage);

    // Keep callback ref current without re-triggering effect
    useEffect(() => {
        onMessageRef.current = onMessage;
    }, [onMessage]);

    const connect = useCallback(() => {
        // Clean up any existing connection
        if (wsRef.current) {
            try { wsRef.current.close(); } catch { }
        }

        console.log(`[WS] Connecting to ${url}...`);
        const socket = new WebSocket(url);

        socket.onopen = () => {
            console.log('✅ [WS] Connected');
            retryCountRef.current = 0;
            setState({ isConnected: true, retryCount: 0 });
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onMessageRef.current?.(data);
            } catch (e) {
                console.error('[WS] Parse error', e);
            }
        };

        socket.onclose = (event) => {
            console.log(`[WS] Disconnected (code: ${event.code})`);
            setState(prev => ({ ...prev, isConnected: false }));
            wsRef.current = null;

            // Attempt reconnection with exponential backoff
            if (retryCountRef.current < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
                console.log(`[WS] Reconnecting in ${delay}ms (attempt ${retryCountRef.current + 1}/${maxRetries})`);
                retryCountRef.current += 1;
                setState(prev => ({ ...prev, retryCount: retryCountRef.current }));
                retryTimeoutRef.current = setTimeout(connect, delay);
            } else {
                console.warn('[WS] Max retries reached. Connection abandoned.');
            }
        };

        socket.onerror = (err) => {
            console.error('[WS] Error:', err);
        };

        wsRef.current = socket;
    }, [url, maxRetries]);

    useEffect(() => {
        connect();

        return () => {
            if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
            if (wsRef.current) {
                try { wsRef.current.close(); } catch { }
            }
        };
    }, [connect]);

    return state;
}
