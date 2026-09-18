import { useState } from 'react';
import { AlertTriangle, RefreshCw, Terminal, CheckCircle2, Clock } from 'lucide-react';
import type { Job, LogEntry } from '../types.js';

interface ErrorsPanelProps {
  failedJobs: Job[];
  errorLogs: LogEntry[];
  onRefresh: () => void;
}

export function ErrorsPanel({ failedJobs, errorLogs, onRefresh }: ErrorsPanelProps) {
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const handleRetry = async (jobId: number) => {
    setRetryingId(jobId);
    try {
      await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
      onRefresh();
    } catch (err) {
      console.error('Failed to retry job', err);
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Failed Jobs Section */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Failed Jobs ({failedJobs.length})
            </h3>
          </div>
          <button
            onClick={onRefresh}
            className="p-1 text-slate-400 hover:text-slate-600 rounded transition cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {failedJobs.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
            <p className="text-xs font-medium text-slate-600">No failed jobs recorded!</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              All processed voice messages succeeded or are in queue.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {failedJobs.map((job) => (
              <div key={job.id} className="p-4 hover:bg-slate-50/60 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-900">Job #{job.id}</span>
                    <span className="text-[11px] text-slate-400">•</span>
                    <span className="text-[11px] text-slate-500">Chat {job.telegram_chat_id}</span>
                    <span className="text-[11px] text-slate-400">•</span>
                    <span className="text-[11px] text-slate-500">Msg #{job.telegram_message_id}</span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 text-[10px] font-semibold">
                      Attempts: {job.attempts}
                    </span>
                  </div>
                  <div className="p-2 bg-rose-50/50 rounded-lg border border-rose-100 text-rose-800 font-mono text-[11px]">
                    {job.error || 'Unknown error occurred during processing'}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Created: {new Date(job.created_at).toLocaleTimeString()}
                    </span>
                    {job.completed_at && (
                      <span>Failed: {new Date(job.completed_at).toLocaleTimeString()}</span>
                    )}
                  </div>
                </div>

                <div>
                  <button
                    onClick={() => handleRetry(job.id)}
                    disabled={retryingId === job.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-medium transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${retryingId === job.id ? 'animate-spin' : ''}`} />
                    <span>Retry Job</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Structured Error Logs Section */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-slate-600" />
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Backend Error Logs ({errorLogs.length})
            </h3>
          </div>
        </div>

        {errorLogs.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-xs">
            No system error logs found in memory buffer.
          </div>
        ) : (
          <div className="p-3 bg-slate-900 overflow-x-auto max-h-72 font-mono text-[11px] divide-y divide-slate-800">
            {errorLogs.map((log) => (
              <div key={log.id} className="py-1.5 flex items-start gap-2 text-rose-300">
                <span className="text-slate-500 shrink-0">
                  {log.timestamp.split('T')[1]?.slice(0, 8)}
                </span>
                <span className="px-1 py-0.2 rounded bg-rose-950 text-rose-400 text-[10px] font-bold shrink-0">
                  ERROR
                </span>
                <span className="flex-1 break-all">{log.message}</span>
                {log.meta && Object.keys(log.meta).length > 0 && (
                  <span className="text-slate-400 text-[10px]">
                    {JSON.stringify(log.meta)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
