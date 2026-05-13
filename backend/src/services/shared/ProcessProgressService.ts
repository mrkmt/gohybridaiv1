/**
 * ProcessProgressService
 *
 * Real-time progress tracking for the full test pipeline:
 *   discovery → generation → compilation → execution
 *
 * Emits events via JobEvents for WebSocket broadcast to the frontend.
 * Each phase is tracked with percentage, status, and detail messages.
 */

import { EventEmitter } from 'events';

export type PipelinePhase =
  | 'discovery'
  | 'generation'
  | 'compilation'
  | 'execution'
  | 'reporting'
  | 'complete';

export type ProgressStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface ProcessProgressEvent {
  /** Ticket ID this progress belongs to */
  ticketId: string;
  /** Current phase of the pipeline */
  phase: PipelinePhase;
  /** Status of this phase */
  status: ProgressStatus;
  /** Progress percentage within this phase (0-100) */
  progress: number;
  /** Overall pipeline progress (0-100) */
  overallProgress: number;
  /** Human-readable detail message */
  detail: string;
  /** Technology profile detected (only set during discovery phase) */
  technologyProfile?: {
    primary: string;
    detected: Array<{ technology: string; confidence: number }>;
  };
  /** Element count from discovery (only set during discovery phase) */
  elementCount?: number;
  /** Test case count from generation */
  testCaseCount?: number;
  /** Scenario count from generation */
  scenarioCount?: number;
  /** Current test case being executed */
  currentTestCaseId?: string;
  /** Current test case index during execution */
  currentTestCaseIndex?: number;
  /** Total test cases to execute */
  totalTestCases?: number;
  /** Timestamp */
  timestamp: string;
}

export class ProcessProgressService {
  private static emitters = new Map<string, EventEmitter>();

  /**
   * Get or create an event emitter for a ticket
   */
  static getEmitter(ticketId: string): EventEmitter {
    if (!this.emitters.has(ticketId)) {
      this.emitters.set(ticketId, new EventEmitter());
    }
    return this.emitters.get(ticketId)!;
  }

  /**
   * Clean up emitter for a ticket
   */
  static cleanup(ticketId: string): void {
    const emitter = this.emitters.get(ticketId);
    if (emitter) {
      emitter.removeAllListeners();
      this.emitters.delete(ticketId);
    }
  }

  /**
   * Calculate overall pipeline progress based on phase weights
   */
  private static calculateOverallProgress(
    phase: PipelinePhase,
    phaseProgress: number
  ): number {
    // Phase weights: discovery=15%, generation=25%, compilation=15%, execution=35%, reporting=10%
    const weights: Record<PipelinePhase, number> = {
      discovery: 0.15,
      generation: 0.25,
      compilation: 0.15,
      execution: 0.35,
      reporting: 0.10,
      complete: 1.0,
    };

    const phaseOrder: PipelinePhase[] = ['discovery', 'generation', 'compilation', 'execution', 'reporting', 'complete'];
    const currentPhaseIndex = phaseOrder.indexOf(phase);

    let completedWeight = 0;
    for (let i = 0; i < currentPhaseIndex; i++) {
      completedWeight += weights[phaseOrder[i]] || 0;
    }

    const currentWeight = weights[phase] || 0;
    const currentProgress = (currentWeight * phaseProgress) / 100;

    return Math.min(Math.round((completedWeight + currentProgress) * 100), 100);
  }

  /**
   * Emit a progress event
   */
  static emit(event: ProcessProgressEvent): void {
    const emitter = this.getEmitter(event.ticketId);
    emitter.emit('progress', event);

    // Also emit via JobEvents for broader consumption (WebSocket bridge)
    try {
      const { JobEvents } = require('../../api/WorkerQueue');
      JobEvents.emit('pipeline:progress', event);
    } catch {
      // JobEvents not available
    }
  }

  /**
   * Subscribe to progress events for a ticket
   */
  static subscribe(ticketId: string, callback: (event: ProcessProgressEvent) => void): () => void {
    const emitter = this.getEmitter(ticketId);
    emitter.on('progress', callback);
    return () => emitter.off('progress', callback);
  }

  /**
   * Emit discovery phase progress
   */
  static discoveryProgress(
    ticketId: string,
    detail: string,
    progress: number,
    options?: {
      technologyProfile?: { primary: string; detected: Array<{ technology: string; confidence: number }> };
      elementCount?: number;
      status?: ProgressStatus;
    }
  ): void {
    this.emit({
      ticketId,
      phase: 'discovery',
      status: options?.status || 'running',
      progress,
      overallProgress: this.calculateOverallProgress('discovery', progress),
      detail,
      technologyProfile: options?.technologyProfile,
      elementCount: options?.elementCount,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit generation phase progress
   */
  static generationProgress(
    ticketId: string,
    detail: string,
    progress: number,
    options?: {
      scenarioCount?: number;
      testCaseCount?: number;
      status?: ProgressStatus;
    }
  ): void {
    this.emit({
      ticketId,
      phase: 'generation',
      status: options?.status || 'running',
      progress,
      overallProgress: this.calculateOverallProgress('generation', progress),
      detail,
      scenarioCount: options?.scenarioCount,
      testCaseCount: options?.testCaseCount,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit compilation phase progress
   */
  static compilationProgress(
    ticketId: string,
    detail: string,
    progress: number,
    options?: {
      testCaseCount?: number;
      status?: ProgressStatus;
    }
  ): void {
    this.emit({
      ticketId,
      phase: 'compilation',
      status: options?.status || 'running',
      progress,
      overallProgress: this.calculateOverallProgress('compilation', progress),
      detail,
      testCaseCount: options?.testCaseCount,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit execution phase progress
   */
  static executionProgress(
    ticketId: string,
    detail: string,
    progress: number,
    options?: {
      currentTestCaseId?: string;
      currentTestCaseIndex?: number;
      totalTestCases?: number;
      status?: ProgressStatus;
    }
  ): void {
    this.emit({
      ticketId,
      phase: 'execution',
      status: options?.status || 'running',
      progress,
      overallProgress: this.calculateOverallProgress('execution', progress),
      detail,
      currentTestCaseId: options?.currentTestCaseId,
      currentTestCaseIndex: options?.currentTestCaseIndex,
      totalTestCases: options?.totalTestCases,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit reporting phase progress
   */
  static reportingProgress(
    ticketId: string,
    detail: string,
    progress: number,
    status: ProgressStatus = 'running'
  ): void {
    this.emit({
      ticketId,
      phase: 'reporting',
      status,
      progress,
      overallProgress: this.calculateOverallProgress('reporting', progress),
      detail,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit pipeline completion
   */
  static complete(ticketId: string, detail: string): void {
    this.emit({
      ticketId,
      phase: 'complete',
      status: 'completed',
      progress: 100,
      overallProgress: 100,
      detail,
      timestamp: new Date().toISOString(),
    });
    this.cleanup(ticketId);
  }

  /**
   * Emit pipeline failure
   */
  static failed(ticketId: string, detail: string): void {
    this.emit({
      ticketId,
      phase: 'complete',
      status: 'failed',
      progress: 0,
      overallProgress: 0,
      detail,
      timestamp: new Date().toISOString(),
    });
    this.cleanup(ticketId);
  }
}
