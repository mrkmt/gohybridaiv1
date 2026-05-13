/**
 * PipelineProgressView
 *
 * Displays real-time progress across the full test pipeline:
 *   discovery → generation → compilation → execution → reporting
 *
 * Shows a phase timeline, current phase detail, and overall progress bar.
 */

import React from 'react';
import { PipelineProgressEvent, PipelinePhase, ProgressStatus } from '../hooks/usePipelineProgress';

interface PipelineProgressViewProps {
  currentEvent: PipelineProgressEvent | null;
  overallProgress: number;
  currentPhase: PipelinePhase;
  phaseStatus: ProgressStatus;
  history: PipelineProgressEvent[];
}

const PHASE_ORDER: PipelinePhase[] = ['discovery', 'generation', 'compilation', 'execution', 'reporting', 'complete'];
const PHASE_LABELS: Record<PipelinePhase, string> = {
  discovery: '🔍 Discovery',
  generation: '🧠 Generation',
  compilation: '🔧 Compilation',
  execution: '▶️ Execution',
  reporting: '📊 Reporting',
  complete: '✅ Complete',
};

const PHASE_COLORS: Record<ProgressStatus, string> = {
  pending: 'text-gray-400',
  running: 'text-blue-500',
  completed: 'text-green-500',
  failed: 'text-red-500',
  skipped: 'text-gray-500',
};

const PHASE_BG: Record<ProgressStatus, string> = {
  pending: 'bg-gray-200 dark:bg-gray-700',
  running: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  skipped: 'bg-gray-400',
};

export const PipelineProgressView: React.FC<PipelineProgressViewProps> = ({
  currentEvent,
  overallProgress,
  currentPhase,
  phaseStatus,
  history,
}) => {
  const currentPhaseIndex = PHASE_ORDER.indexOf(currentPhase);
  const completedPhases = PHASE_ORDER.filter((_, i) => i < currentPhaseIndex);
  const isRunning = phaseStatus === 'running';

  // Get technology profile from history
  const techProfileEvent = [...history].reverse().find(e => e.technologyProfile);
  const techProfile = techProfileEvent?.technologyProfile;

  return (
    <div className="w-full space-y-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Pipeline Progress
        </h3>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300 rounded-full">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              Running
            </span>
          )}
          {phaseStatus === 'completed' && (
            <span className="px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-300 rounded-full">
              Complete
            </span>
          )}
          {phaseStatus === 'failed' && (
            <span className="px-2 py-0.5 text-xs font-medium text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-300 rounded-full">
              Failed
            </span>
          )}
        </div>
      </div>

      {/* Overall Progress Bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Overall Progress</span>
          <span>{overallProgress}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${PHASE_BG[phaseStatus]}`}
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* Phase Timeline */}
      <div className="flex items-center gap-1">
        {PHASE_ORDER.filter(p => p !== 'complete').map((phase, index) => {
          const isActive = phase === currentPhase && isRunning;
          const isCompleted = completedPhases.includes(phase) || (phase === currentPhase && phaseStatus === 'completed');
          const isSkipped = !isCompleted && !isActive && PHASE_ORDER.indexOf(phase) < currentPhaseIndex;
          const status: ProgressStatus = isCompleted ? 'completed' : isActive ? 'running' : isSkipped ? 'skipped' : 'pending';

          return (
            <React.Fragment key={phase}>
              <div className="flex flex-col items-center flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  status === 'completed' ? 'bg-green-500 text-white' :
                  status === 'running' ? 'bg-blue-500 text-white animate-pulse' :
                  status === 'skipped' ? 'bg-gray-400 text-white' :
                  'bg-gray-200 dark:bg-gray-700 text-gray-400'
                }`}>
                  {status === 'completed' ? '✓' : index + 1}
                </div>
                <span className={`text-[10px] mt-1 ${
                  status === 'completed' ? 'text-green-600 dark:text-green-400' :
                  status === 'running' ? 'text-blue-600 dark:text-blue-400 font-medium' :
                  'text-gray-400'
                }`}>
                  {PHASE_LABELS[phase].split(' ')[1]}
                </span>
              </div>
              {index < 4 && (
                <div className={`flex-1 h-0.5 ${
                  isCompleted || isSkipped ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                }`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Current Phase Detail */}
      {currentEvent && (
        <div className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-md">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-sm font-medium ${PHASE_COLORS[phaseStatus]}`}>
              {PHASE_LABELS[currentPhase]}
            </span>
            <span className="text-xs text-gray-500">
              {currentEvent.progress}%
            </span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {currentEvent.detail}
          </p>

          {/* Technology Profile (shown after discovery) */}
          {techProfile && (
            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
              <span className="text-[10px] font-medium text-gray-500 uppercase">Detected Technologies</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {techProfile.detected.slice(0, 4).map(tech => (
                  <span
                    key={tech.technology}
                    className={`inline-flex items-center px-1.5 py-0.5 text-[10px] rounded ${
                      tech.technology === techProfile.primary
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                  >
                    {tech.technology} {Math.round(tech.confidence * 100)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Element/Test Counts */}
          {(currentEvent.elementCount || currentEvent.testCaseCount || currentEvent.scenarioCount) && (
            <div className="flex gap-3 mt-2">
              {currentEvent.elementCount !== undefined && (
                <span className="text-[10px] text-gray-500">
                  📦 {currentEvent.elementCount} elements
                </span>
              )}
              {currentEvent.scenarioCount !== undefined && (
                <span className="text-[10px] text-gray-500">
                  📋 {currentEvent.scenarioCount} scenarios
                </span>
              )}
              {currentEvent.testCaseCount !== undefined && (
                <span className="text-[10px] text-gray-500">
                  🧪 {currentEvent.testCaseCount} test cases
                </span>
              )}
              {currentEvent.totalTestCases !== undefined && (
                <span className="text-[10px] text-gray-500">
                  ▶️ {currentEvent.currentTestCaseIndex !== undefined ? `${currentEvent.currentTestCaseIndex + 1}/${currentEvent.totalTestCases}` : currentEvent.totalTestCases} tests
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
