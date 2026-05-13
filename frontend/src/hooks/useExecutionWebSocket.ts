import { useEffect, useRef, useCallback, useState } from 'react';

// S4-5: typed step event shape — mirrors backend ExecutionEventTypes.ts
export type ExecutionEventKind =
  | 'case.start' | 'case.pass' | 'case.fail'
  | 'step.start' | 'step.pass' | 'step.fail'
  | 'artifact'
  | 'heal.start' | 'heal.pass' | 'heal.fail'
  | 'log';

export interface ExecutionStepEvent {
  kind: ExecutionEventKind;
  ticketId: string;
  userId: string;
  caseId?: string;
  stepNumber?: number;
  message: string;
  artifactPath?: string;
  artifactType?: 'screenshot' | 'video' | 'trace' | 'report' | 'zip';
  ts: string;
}

interface WsOptions {
  /** All ticket IDs currently in execution phase — hook subscribes to all of them. */
  ticketIds: string[];
  token: string | null;
  onLog: (ticketId: string, line: string) => void;
  onProgress: (ticketId: string, data: Record<string, unknown>) => void;
  onComplete: (ticketId: string, data: Record<string, unknown>) => void;
  onFailed: (ticketId: string, data: Record<string, unknown>) => void;
  /** S4-5: called for every structured step event (step.start/pass/fail, case.*, artifact, heal.*). */
  onStep?: (ticketId: string, event: ExecutionStepEvent) => void;
}

interface WsState {
  connected: boolean;
  authenticated: boolean;
  reconnectAttempt: number;
}

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined)
  || (import.meta.env.VITE_API_URL as string | undefined)?.replace(/^http/, 'ws')
  || 'ws://localhost:3000';

const MAX_RECONNECT = 5;
const BASE_DELAY_MS = 3000;
const PING_INTERVAL_MS = 30000;

/**
 * Decode JWT exp claim and check if the token is already expired.
 * Uses a 30-second grace window to tolerate small client clock skew.
 */
function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (typeof payload.exp !== 'number') return false;
    return payload.exp < (Date.now() / 1000) - 30;
  } catch {
    return true;
  }
}

export function useExecutionWebSocket(opts: WsOptions) {
  const [state, setState] = useState<WsState>({ connected: false, authenticated: false, reconnectAttempt: 0 });
  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Track which ticketIds we have already subscribed to avoid duplicate subscribes.
  const subscribedRef = useRef<Set<string>>(new Set());

  // Keep callbacks in refs so the WS message handler always sees fresh versions
  // without needing to be re-created on every render.
  const onLogRef = useRef(opts.onLog);
  const onProgressRef = useRef(opts.onProgress);
  const onCompleteRef = useRef(opts.onComplete);
  const onFailedRef = useRef(opts.onFailed);
  const onStepRef = useRef(opts.onStep);
  onLogRef.current = opts.onLog;
  onProgressRef.current = opts.onProgress;
  onCompleteRef.current = opts.onComplete;
  onFailedRef.current = opts.onFailed;
  onStepRef.current = opts.onStep;

  // Keep latest ticketIds in a ref so the WS onmessage closure always sees them.
  const ticketIdsRef = useRef(opts.ticketIds);
  ticketIdsRef.current = opts.ticketIds;

  const clearPing = () => {
    if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
  };
  const clearReconnect = () => {
    if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
  };

  /** Subscribe to a single ticketId channel on an open, authenticated socket. */
  const subscribeOne = useCallback((ws: WebSocket, id: string) => {
    if (subscribedRef.current.has(id)) return;
    subscribedRef.current.add(id);
    ws.send(JSON.stringify({ type: 'subscribe', channel: `execution:${id}` }));
  }, []);

  const connect = useCallback(() => {
    if (!opts.token) return;
    // Prevent a duplicate socket when one is already open or mid-handshake.
    const rs = wsRef.current?.readyState;
    if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return;

    if (isTokenExpired(opts.token)) {
      setState(s => ({ ...s, connected: false, authenticated: false }));
      try { window.dispatchEvent(new CustomEvent('auth:expired')); } catch { /* ignore */ }
      return;
    }

    subscribedRef.current = new Set();
    const ws = new WebSocket(`${WS_URL}/ws`);
    // wsLocal lets stale onclose/onmessage handlers detect they've been superseded
    // by a newer socket created by cleanup → re-effect or an explicit reconnect.
    const wsLocal = ws;
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current || wsRef.current !== wsLocal) return;
      ws.send(JSON.stringify({ type: 'auth', token: opts.token }));
    };

    ws.onmessage = (evt) => {
      if (!mountedRef.current || wsRef.current !== wsLocal) return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(evt.data as string); } catch { return; }

      const type = msg.type as string;

      if (type === 'auth_ok') {
        setState(s => ({ ...s, authenticated: true, connected: true, reconnectAttempt: 0 }));
        // Subscribe to all currently executing tickets.
        for (const id of ticketIdsRef.current) subscribeOne(ws, id);
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, PING_INTERVAL_MS);
        return;
      }

      if (type === 'auth_fail') {
        setState(s => ({ ...s, reconnectAttempt: MAX_RECONNECT }));
        try { window.dispatchEvent(new CustomEvent('auth:expired')); } catch { /* ignore */ }
        ws.close();
        return;
      }
      if (type === 'pong') return;

      const payload = (msg.payload as Record<string, unknown>) || {};
      // Route every event by the ticketId embedded in the payload (or msg root).
      const ticketId = (payload.ticketId as string) || (msg.ticketId as string) || '';

      if (type === 'execution:log' || type === 'TELEMETRY_LOG') {
        const line = (payload.log as string) || (msg.message as string) || '';
        if (line) onLogRef.current(ticketId, line);
      } else if (type === 'execution:step') {
        // S4-5: structured step event — route to onStep if provided,
        // otherwise fall back to onLog so nothing is silently lost.
        const stepEvent = payload as unknown as ExecutionStepEvent;
        if (onStepRef.current) {
          onStepRef.current(ticketId, stepEvent);
        } else {
          onLogRef.current(ticketId, stepEvent.message || '');
        }
      } else if (type === 'execution:progress' || type === 'pipeline:progress') {
        onProgressRef.current(ticketId, payload);
      } else if (type === 'execution:complete') {
        onCompleteRef.current(ticketId, payload);
      } else if (type === 'execution:failed') {
        onFailedRef.current(ticketId, payload);
      }
    };

    ws.onclose = () => {
      // Ignore close events from superseded sockets (replaced by a newer connection).
      if (wsRef.current !== wsLocal) return;
      if (!mountedRef.current) return;
      clearPing();
      subscribedRef.current = new Set();
      setState(s => {
        if (s.reconnectAttempt < MAX_RECONNECT) {
          const delay = BASE_DELAY_MS * Math.pow(2, s.reconnectAttempt);
          reconnectRef.current = setTimeout(connect, delay);
          return { ...s, connected: false, authenticated: false, reconnectAttempt: s.reconnectAttempt + 1 };
        }
        return { ...s, connected: false, authenticated: false };
      });
    };

    ws.onerror = () => { ws.close(); };
  }, [opts.token, subscribeOne]);

  // Initial connect / reconnect on token change.
  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearPing();
      clearReconnect();
      wsRef.current?.close();
    };
  }, [connect]);

  // When new ticket IDs enter the executing set, subscribe to them immediately
  // if the socket is already open and authenticated.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !state.authenticated) return;
    for (const id of opts.ticketIds) subscribeOne(ws, id);
  }, [opts.ticketIds, state.authenticated, subscribeOne]);

  const disconnect = useCallback(() => {
    clearPing();
    clearReconnect();
    wsRef.current?.close();
    setState({ connected: false, authenticated: false, reconnectAttempt: 0 });
  }, []);

  return { ...state, disconnect };
}
