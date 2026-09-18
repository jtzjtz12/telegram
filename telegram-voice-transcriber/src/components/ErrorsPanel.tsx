import { AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react';
import type { Job, LogItem } from '../types.js';

interface ErrorsPanelProps {
  failedJobs: Job[];
  errorLogs: LogItem[];
  onRefresh: () => void;
  onRetryJob?: (jobId: number) => void;
}

export function ErrorsPanel({ failedJobs, errorLogs, onRefresh, onRetryJob }: ErrorsPanelProps) {
  const hasErrors = failedJobs.length > 0 || errorLogs.length > 0;

  return (
    <div id="errors-panel-container" className="space-y-6">
      {/* Overview status bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            hasErrors ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
          }`}>
            {hasErrors ? <AlertTriangle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {hasErrors ? 'Error Registry & Failed Jobs' : 'No Critical Errors Detected'}
            </h3>
            <p className="text-xs text-slate-500">
              {hasErrors 
                ? `${failedJobs.length} failed jobs in SQLite • ${errorLogs.length} error entries in logger`
                : 'All jobs and internal services are operating cleanly'}
            </p>
          </div>
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Failed Jobs Section */}
        <div id="failed-jobs-card" className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              Failed Voice Jobs ({failedJobs.length})
            </h4>
            <span className="text-[11px] text-slate-400 font-mono">table: jobs WHERE status='failed'</span>
          </div>

          <div className="p-4 divide-y divide-slate-100 overflow-y-auto max-h-96">
            {failedJobs.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No failed jobs recorded in SQLite.</p>
            ) : (
              failedJobs.map((job) => (
                <div key={job.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-slate-900">Job #{job.id}</span>
                    <span className="text-[11px] text-slate-400 font-mono">Chat: {job.telegram_chat_id}</span>
                  </div>
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 font-mono break-all">
                    {job.error || 'Unknown failure occurred during transcription'}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Attempts: {job.attempts} • {new Date(job.created_at).toLocaleString()}</span>
                    <button
                      onClick={async () => {
                        try {
                          await fetch(`/api/jobs/${job.id}/retry`, { method: 'POST' });
                          onRefresh();
                        } catch (err) {
                          console.error(err);
                        }
                      }}
                      className="px-2.5 py-1 rounded bg-slate-900 text-white hover:bg-slate-800 font-sans font-medium text-xs transition cursor-pointer"
                    >
                      Retry Job
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Structured System Error Logs */}
        <div id="system-error-logs-card" className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              Structured Error Logs ({errorLogs.length})
            </h4>
            <span className="text-[11px] text-slate-400 font-mono">logs/app.log</span>
          </div>

          <div className="p-4 divide-y divide-slate-100 overflow-y-auto max-h-96">
            {errorLogs.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No system errors in recent logs.</p>
            ) : (
              errorLogs.map((log, idx) => (
                <div key={idx} className="py-3 first:pt-0 last:pb-0 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 font-bold uppercase tracking-wider">
                      {log.level}
                    </span>
                    <span className="text-slate-400 font-mono">{log.timestamp}</span>
                  </div>
                  <p className="text-xs font-mono text-slate-800 font-medium">{log.message}</p>
                  {log.error && (
                    <div className="p-2 bg-slate-100 text-slate-700 rounded text-[11px] font-mono whitespace-pre-wrap">
                      {log.error}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
