import { Upload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import type { TestEnvironment } from '../services/TestExecutionService';

interface UploadReportPanelProps {
  environment: TestEnvironment;
  workflowError: { message?: string; hint?: string } | null;
  backendOnline: boolean;
  isUploadingReport: boolean;
  isReportUploaded: boolean;
  onUpload: (transition: string) => void;
  onRetry: () => void;
}

const TRANSITIONS = [
  { label: 'Bug Done', value: 'bug_done', color: 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30' },
  { label: 'Done', value: 'done', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30' },
  { label: 'In Testing', value: 'in_testing', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30 hover:bg-blue-500/30' },
];

export function UploadReportPanel({
  environment,
  workflowError,
  backendOnline,
  isUploadingReport,
  isReportUploaded,
  onUpload,
  onRetry,
}: UploadReportPanelProps) {
  return (
    <div className="bg-gray-900/80 border border-white/10 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-accent-primary" />
          <span className="text-sm font-medium text-white">Upload Report</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${
          environment.stage === 'testing'
            ? 'bg-blue-500/20 text-blue-400'
            : environment.stage === 'uat'
            ? 'bg-amber-500/20 text-amber-400'
            : 'bg-emerald-500/20 text-emerald-400'
        }`}>
          {environment.stage}
        </span>
      </div>

      {/* Workflow Error */}
      {workflowError && (
        <div className="px-4 py-3 bg-red-500/10 border-b border-red-500/20">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
            <div>
              <p className="text-xs text-red-300">{workflowError.message}</p>
              {workflowError.hint && (
                <p className="text-xs text-red-400 mt-1">{workflowError.hint}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {isReportUploaded ? (
          <div className="flex items-center gap-3 py-4 text-emerald-400">
            <CheckCircle className="w-5 h-5" />
            <div>
              <p className="text-sm font-medium">Report uploaded successfully</p>
              <p className="text-xs text-gray-500 mt-0.5">Results have been posted to Jira</p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-3">
              Choose the Jira transition to apply when uploading results:
            </p>
            <div className="flex flex-wrap gap-2">
              {TRANSITIONS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => onUpload(t.value)}
                  disabled={!backendOnline || isUploadingReport}
                  className={`px-3 py-2 text-xs border rounded-lg transition-colors ${t.color} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isUploadingReport ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Uploading...
                    </span>
                  ) : (
                    t.label
                  )}
                </button>
              ))}
            </div>

            {/* Retry */}
            {workflowError && (
              <button
                onClick={onRetry}
                className="mt-3 w-full px-3 py-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors"
              >
                Retry Execution
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
