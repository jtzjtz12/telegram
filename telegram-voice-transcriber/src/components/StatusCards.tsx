import { Server, Database, Cpu, Clock, HardDrive, AlertCircle } from 'lucide-react';
import type { AppStatusData, JobStatus } from '../types.js';

interface StatusCardsProps {
  data: AppStatusData;
  selectedStatus: string | null;
  onSelectStatus: (status: string | null) => void;
}

const STATUS_CONFIG: Record<JobStatus, { label: string; bg: string; text: string; border: string; desc: string }> = {
  pending: {
    label: 'Pending',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    desc: 'Queued voice messages',
  },
  processing: {
    label: 'Processing',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    desc: 'Downloading / preparing',
  },
  waiting_transcription: {
    label: 'Waiting Transcription',
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
    desc: 'Sent to @speech_transcriber_bot',
  },
  completed: {
    label: 'Completed',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    desc: 'Transcribed & delivered',
  },
  failed: {
    label: 'Failed',
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    desc: 'Errors & timeouts',
  },
};

export function StatusCards({ data, selectedStatus, onSelectStatus }: StatusCardsProps) {
  const counts = data.database.counts_by_status || {
    pending: 0,
    processing: 0,
    waiting_transcription: 0,
    completed: 0,
    failed: 0,
  };

  return (
    <div id="status-overview-section" className="space-y-6">
      {/* Three Core Subsystem Health Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 1. App State */}
        <div id="app-state-card" className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Application State</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Healthy
              </span>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                <Server className="w-5 h-5" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">Express + TypeScript</p>
                <p className="text-xs text-slate-500">Node {data.app.node_version} • {data.app.environment}</p>
              </div>
            </div>
          </div>
          <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-400 block">Uptime</span>
              <span className="font-mono font-medium text-slate-700 flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                {data.app.uptime_formatted || `${data.app.uptime_seconds}s`}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">RAM (Heap / RSS)</span>
              <span className="font-mono font-medium text-slate-700">
                {data.app.memory.heap_used_mb}M / {data.app.memory.rss_mb}M
              </span>
            </div>
          </div>
        </div>

        {/* 2. Database State */}
        <div id="db-state-card" className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">SQLite Database</span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                data.database.connected 
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                  : 'bg-rose-50 text-rose-700 border border-rose-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${data.database.connected ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                {data.database.connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-sky-50 border border-sky-100 flex items-center justify-center text-sky-600">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">SQLite File Storage</p>
                <p className="text-xs font-mono text-slate-500 truncate max-w-[210px]">{data.database.path}</p>
              </div>
            </div>
          </div>
          <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-400 block">Total Records</span>
              <span className="font-mono font-medium text-slate-700 flex items-center gap-1">
                <HardDrive className="w-3 h-3 text-slate-400" />
                {data.database.total_jobs} jobs
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Table</span>
              <span className="font-mono font-medium text-slate-700">jobs (14 cols)</span>
            </div>
          </div>
        </div>

        {/* 3. Worker State */}
        <div id="worker-state-card" className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">MTProto Transcriber</span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Centralized Listener
              </span>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">Single Client Worker</p>
                <p className="text-xs font-mono text-slate-500">{data.worker.target_bot || '@speech_transcriber_bot'}</p>
              </div>
            </div>
          </div>
          <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-400 block">Timeout</span>
              <span className="font-mono font-medium text-slate-700">
                {data.worker.timeout_seconds || 180}s ({data.worker.poll_interval_ms || 1000}ms poll)
              </span>
            </div>
            <div>
              <span className="text-slate-400 block">Correlation</span>
              <span className="font-mono font-medium text-slate-700">FIFO + reply_to</span>
            </div>
          </div>
        </div>
      </div>

      {/* Breakdown by Status (Interactive Filter Cards) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
            Jobs by Status (Click to filter)
          </h3>
          {selectedStatus && (
            <button
              onClick={() => onSelectStatus(null)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium cursor-pointer"
            >
              Clear filter (Show all)
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {(Object.keys(STATUS_CONFIG) as JobStatus[]).map((status) => {
            const cfg = STATUS_CONFIG[status];
            const count = counts[status] || 0;
            const isSelected = selectedStatus === status;

            return (
              <button
                key={status}
                id={`filter-status-${status}-button`}
                onClick={() => onSelectStatus(isSelected ? null : status)}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? `${cfg.bg} ${cfg.border} ring-2 ring-indigo-500/30 shadow-sm`
                    : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
                    {cfg.label}
                  </span>
                  <span className="text-lg font-bold font-mono text-slate-900">{count}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 truncate">{cfg.desc}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
