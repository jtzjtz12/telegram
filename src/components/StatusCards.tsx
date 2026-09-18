import React from 'react';
import { Server, Database, Cpu, CheckCircle2, Clock, PlayCircle, AlertTriangle, Layers, Send } from 'lucide-react';
import type { MetricsResponse, JobStatus } from '../types.js';

interface StatusCardsProps {
  data: MetricsResponse;
  selectedStatus: string | null;
  onSelectStatus: (status: JobStatus | null) => void;
}

export function StatusCards({ data, selectedStatus, onSelectStatus }: StatusCardsProps) {
  const { app, database, worker, jobs } = data;

  const statusList: Array<{
    status: JobStatus | null;
    label: string;
    count: number;
    color: string;
    icon: React.ReactNode;
  }> = [
    {
      status: null,
      label: 'All Jobs',
      count: jobs.total,
      color: selectedStatus === null ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700',
      icon: <Layers className="w-4 h-4" />,
    },
    {
      status: 'pending',
      label: 'Pending',
      count: jobs.by_status.pending || 0,
      color: selectedStatus === 'pending' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-700',
      icon: <Clock className="w-4 h-4 text-amber-500" />,
    },
    {
      status: 'processing',
      label: 'Processing',
      count: jobs.by_status.processing || 0,
      color: selectedStatus === 'processing' ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700',
      icon: <PlayCircle className="w-4 h-4 text-blue-500" />,
    },
    {
      status: 'waiting_transcription',
      label: 'Waiting MTProto',
      count: jobs.by_status.waiting_transcription || 0,
      color: selectedStatus === 'waiting_transcription' ? 'border-purple-500 bg-purple-50 text-purple-800' : 'border-slate-200 bg-white text-slate-700',
      icon: <Send className="w-4 h-4 text-purple-500" />,
    },
    {
      status: 'completed',
      label: 'Completed',
      count: jobs.by_status.completed || 0,
      color: selectedStatus === 'completed' ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
    },
    {
      status: 'failed',
      label: 'Failed',
      count: jobs.by_status.failed || 0,
      color: selectedStatus === 'failed' ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-700',
      icon: <AlertTriangle className="w-4 h-4 text-rose-500" />,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Top 3 Core Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Backend App Status */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-semibold text-slate-900 capitalize">{app.status}</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Uptime: {app.uptime} • Node {app.node_version}
            </p>
          </div>
        </div>

        {/* SQLite Database */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-semibold text-slate-900">SQLite Connected</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Total {database.total_jobs} stored records
            </p>
          </div>
        </div>

        {/* Worker & MTProto Pipeline */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${worker.connected ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
              <span className="text-xs font-semibold text-slate-900">
                Worker: {worker.active ? 'Active' : 'Idle'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Bot: @{worker.target_bot || 'speech_transcriber_bot'}
            </p>
          </div>
        </div>
      </div>

      {/* Status Filter Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 sm:gap-3">
        {statusList.map((item) => (
          <button
            key={item.label}
            onClick={() => onSelectStatus(item.status)}
            className={`p-3 rounded-xl border text-left transition flex flex-col justify-between cursor-pointer ${item.color} shadow-2xs hover:shadow-xs`}
          >
            <div className="flex items-center justify-between w-full mb-1">
              <span className="text-xs font-medium">{item.label}</span>
              {item.icon}
            </div>
            <span className="text-xl font-bold tracking-tight">{item.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
