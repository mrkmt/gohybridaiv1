/**
 * usePipelineProgress
 *
 * React hook that subscribes to the full pipeline progress events
 * (discovery → generation → compilation → execution → reporting)
 * via the WebSocket connection's `pipeline:progress` channel.
 *
 * Returns the latest progress event, a history of all events, and helpers.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export type PipelinePhase =
  | 'discovery'
  | 'generation'
  | 'compilation'
  | 'execution'
  | 'reporting'
  | 'complete';

export type ProgressStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PipelineProgressEvent {
  ticketId: string;
  phase: PipelinePhase;
  status: ProgressStatus;
  progress: number;
  overallProgress: number;
  detail: string;
  technologyProfile?: {
    primary: string;
    detected: Array<{ technology: string; confidence: number }>;
  };
  elementCount?: number;
  testCaseCount?: number;
  scenarioCount?: number;
  currentTestCaseId?: string;
  currentTestCaseIndex?: number;
  totalTestCases?: number;
  timestamp: string;
}

interface UsePipelineProgressOptions {
  ticketId?: string | null;
  onPhaseChange?: (phase: PipelinePhase, event: PipelineProgressEvent) => void;
  onComplete?: (event: PipelineProgressEvent) => void;
  onFail?: (event: PipelineProgressEvent) => void;
}

export function usePipelineProgress(
  options: UsePipelineProgressOptions = {}
) {
  const { ticketId, onPhaseChange, onComplete, onFail } = options;

  const [currentEvent, setCurrentEvent] = useState<PipelineProgressEvent | null>(null);
  const [history, setHistory] = useState<PipelineProgressEvent[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<PipelinePhase>('discovery');
  const [phaseStatus, setPhaseStatus] = useState<ProgressStatus>('pending');

  const onPhaseChangeRef = useRef(onPhaseChange);
  const onCompleteRef = useRef(onComplete);
  const onFailRef = useRef(onFail);

  useEffect(() => { onPhaseChangeRef.current = onPhaseChange; }, [onPhaseChange]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onFailRef.current = onFail; }, [onFail]);

  const handleMessage = useCallback((event: PipelineProgressEvent) => {
    // Filter by ticketId if specified
    if (ticketId && event.ticketId !== ticketId) return;

    setCurrentEvent(event);
    setOverallProgress(event.overallProgress);
    setCurrentPhase(event.phase);
    setPhaseStatus(event.status);
    setHistory(prev => [...prev, event]);

    // Phase change callback
    if (onPhaseChangeRef.current) {
      onPhaseChangeRef.current(event.phase, event);
    }

    // Completion callbacks
    if (event.status === 'completed' && event.phase === 'complete') {
      if (onCompleteRef.current) onCompleteRef.current(event);
    }
    if (event.status === 'failed') {
      if (onFailRef.current) onFailRef.current(event);
    }
  }, [ticketId]);

  // Listen for pipeline:progress events from the WebSocket
  useEffect(() => {
    // The backend emits pipeline:progress via JobEvents → WebSocket bridge
    // We listen via a custom event on window that the main app dispatches
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<PipelineProgressEvent>;
      if (customEvent.detail) {
        handleMessage(customEvent.detail);
      }
    };
    window.addEventListener('pipeline:progress', handler);
    return () => window.removeEventListener('pipeline:progress', handler);
  }, [handleMessage]);

  // Reset state when ticketId changes
  useEffect(() => {
    setCurrentEvent(null);
    setHistory([]);
    setOverallProgress(0);
    setCurrentPhase('discovery');
    setPhaseStatus('pending');
  }, [ticketId]);

  return {
    currentEvent,
    history,
    overallProgress,
    currentPhase,
    phaseStatus,
    isRunning: phaseStatus === 'running',
    isComplete: currentPhase === 'complete' && phaseStatus === 'completed',
    isFailed: phaseStatus === 'failed',
  };
}
