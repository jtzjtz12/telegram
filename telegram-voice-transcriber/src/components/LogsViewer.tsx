import { useState } from 'react';
import { Terminal, Filter, RefreshCw } from 'lucide-react';
import type { LogItem } from '../types.js';

interface LogsViewerProps {
  logs: LogItem[];
  onRefresh: () => void;
}

export function LogsViewer({ logs, onRefresh }: LogsViewerProps) {
  const [filterLevel, setFilterLevel] = useState<string>('all');

  const filteredLogs = logs.filter((l) => {
    if (filterLevel === 'all') return true;
    return l.level === filterLevel;
  });

  return (
    <div id="logs-viewer-container" className="bg-slate-950 text-slate-200 rounded-xl border border-slate-800 shadow-xl overflow-hidden font-mono text-xs">
      <div className="p-3.5 sm:px-5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-slate-100">Structured Application Logs</span>
          <span className="text-[10px] text-slate-500 font-normal">({filteredLogs.length} events)</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-800 rounded p-0.5 text-[11px]">
            <Filter className="w-3 h-3 text-slate-400 ml-1.5" />
            {['all', 'info', 'warn', 'error'].map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                className={`px-2 py-0.5 rounded capitalize cursor-pointer transition ${
                  filterLevel === lvl ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          <button
            onClick={onRefresh}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition cursor-pointer"
            title="Refresh logs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-2 max-h-[500px] overflow-y-auto font-mono text-[11px] leading-relaxed">
        {filteredLogs.length === 0 ? (
          <p className="text-slate-500 text-center py-8">No log entries matching filter.</p>
        ) : (
          filteredLogs.map((log, i) => {
            const levelColor =
              log.level === 'error'
                ? 'text-rose-400 bg-rose-950/60 border-rose-800'
                : log.level === 'warn'
                ? 'text-amber-400 bg-amber-950/60 border-amber-800'
                : 'text-sky-400 bg-sky-950/60 border-sky-800';

            return (
              <div key={i} className="flex items-start gap-2.5 hover:bg-slate-900/60 p-1.5 rounded transition">
                <span className="text-slate-500 whitespace-nowrap text-[10px]">{log.timestamp.slice(11, 19)}</span>
                <span className={`px-1 py-0.2 rounded uppercase text-[9px] font-bold border ${levelColor}`}>
                  {log.level}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-slate-100">{log.message}</span>
                  {log.context && (
                    <span className="text-slate-400 ml-2 text-[10px]">
                      {JSON.stringify(log.context)}
                    </span>
                  )}
                  {log.error && (
                    <div className="text-rose-300 mt-1 pl-2 border-l border-rose-500/50">
                      {log.error}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
