import { useRef, useEffect } from 'react';
import { Terminal, Play, Square, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import type { TestEnvironment } from '../services/TestExecutionService';

interface ExecutionPanelProps {
  environment: TestEnvironment;
  testCases: any[];
  syncRequired: boolean;
  workflowError: { message?: string; hint?: string } | null;
  wsStatus: string;
  isExecutingTests: boolean;
  combinedExecutionLog: string[];
  wsProgress: { phase?: string; progress?: number; message?: string } | null;
  onEditTestCases: () => void;
  onEditEnv: () => void;
  onSync: () => void;
  onStopExecution: () => void;
  onGenerateTestCases?: () => void;
}

const WS_STATUS_COLORS: Record<string, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  disconnected: 'bg-red-500',
  idle: 'bg-gray-500',
};

export function ExecutionPanel({
  environment,
  testCases,
  syncRequired,
  workflowError,
  wsStatus,
  isExecutingTests,
  combinedExecutionLog,
  wsProgress,
  onEditTestCases,
  onEditEnv,
  onSync,
  onStopExecution,
  onGenerateTestCases,
}: ExecutionPanelProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [combinedExecutionLog]);

  const progressPercent = wsProgress?.progress ?? 0;
  const phaseLabel = wsProgress?.phase ?? 'Execution';

  return (
    <div className="bg-gray-900/80 border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4 text-accent-primary" />
          <span className="text-sm font-medium text-white">Test Execution</span>
          <span
            className={`w-2 h-2 rounded-full ${WS_STATUS_COLORS[wsStatus] || 'bg-gray-500'}`}
            title={`WebSocket: ${wsStatus}`}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onEditTestCases}
            className="px-2.5 py-1 text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded transition-colors"
          >
            Edit Test Cases
          </button>
          <button
            onClick={onEditEnv}
            className="px-2.5 py-1 text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded transition-colors"
          >
            Edit Env
          </button>
        </div>
      </div>

      {/* Environment Info */}
      <div className="px-4 py-2 bg-white/5 flex items-center gap-4 text-xs text-gray-400">
        <span>Stage: <span className="text-white capitalize">{environment.stage}</span></span>
        <span>Browser: <span className="text-white capitalize">{environment.browser}</span></span>
        <span>Cases: <span className="text-white">{testCases.length}</span></span>
      </div>

      {/* Sync Required Warning */}
      {syncRequired && (
        <div className="px-4 py-2 bg-amber-500/10 border-y border-amber-500/20 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs text-amber-300">Jira sync required</span>
          <button
            onClick={onSync}
            className="ml-auto px-2 py-0.5 text-xs bg-amber-500/20 text-amber-300 rounded hover:bg-amber-500/30 transition-colors"
          >
            Sync Now
          </button>
        </div>
      )}

      {/* Workflow Error */}
      {workflowError && (
        <div className="px-4 py-2 bg-red-500/10 border-y border-red-500/20">
          <p className="text-xs text-red-300">{workflowError.message}</p>
          {workflowError.hint && (
            <p className="text-xs text-red-400 mt-1">{workflowError.hint}</p>
          )}
        </div>
      )}

      {/* Progress Bar */}
      {(isExecutingTests || wsProgress) && (
        <div className="px-4 py-2 bg-white/5">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>{phaseLabel}</span>
            <span>{Math.round(progressPercent)}%</span>
          </div>
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-primary transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(progressPercent, 100)}%` }}
            />
          </div>
          {wsProgress?.message && (
            <p className="text-xs text-gray-500 mt-1">{wsProgress.message}</p>
          )}
        </div>
      )}

      {/* Execution Log Terminal */}
      <div className="p-4 bg-black/40 font-mono text-xs max-h-64 overflow-y-auto">
        {combinedExecutionLog.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-gray-600">
            {isExecutingTests ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Initializing execution...</span>
              </div>
            ) : (
              <span>Ready to execute</span>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            {combinedExecutionLog.map((line, i) => (
              <div
                key={i}
                className={`${
                  line.includes('FAIL') || line.includes('ERROR')
                    ? 'text-red-400'
                    : line.includes('PASS') || line.includes('SUCCESS')
                    ? 'text-emerald-400'
                    : line.includes('WARN')
                    ? 'text-amber-400'
                    : 'text-gray-300'
                }`}
              >
                <span className="text-gray-600 mr-2">{String(i + 1).padStart(3, '0')}</span>
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* Execution Controls */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-white/10 bg-white/5">
        {!isExecutingTests ? (
          <button
            onClick={onGenerateTestCases}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary text-white rounded-lg hover:bg-accent-primary/80 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Run Tests
          </button>
        ) : (
          <button
            onClick={onStopExecution}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            Stop Execution
          </button>
        )}

        {wsStatus === 'connected' && (
          <span className="text-xs text-emerald-400 flex items-center gap-1">
            <CheckCircle className="w-3 h-3" />
            Live
          </span>
        )}
      </div>
    </div>
  );
}
