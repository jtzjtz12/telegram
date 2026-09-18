import { useState } from 'react';
import { Terminal, RefreshCw, Filter, Search, Copy, Check } from 'lucide-react';
import type { LogEntry } from '../types.js';

interface LogsViewerProps {
  logs: LogEntry[];
  onRefresh: () => void;
}

export function LogsViewer({ logs, onRefresh }: LogsViewerProps) {
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);

  const filteredLogs = logs.filter((log) => {
    if (levelFilter !== 'all' && log.level !== levelFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        log.message.toLowerCase().includes(q) ||
        (log.meta && JSON.stringify(log.meta).toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleCopyLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message} ${l.meta ? JSON.stringify(l.meta) : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const LEVEL_COLORS: Record<string, string> = {
    info: 'text-sky-400 bg-sky-950/60 border-sky-800',
    warn: 'text-amber-400 bg-amber-950/60 border-amber-800',
    error: 'text-rose-400 bg-rose-950/60 border-rose-800',
    debug: 'text-slate-400 bg-slate-800/60 border-slate-700',
  };

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden shadow-lg">
      {/* Controls Bar */}
      <div className="p-3 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-mono font-bold text-slate-200">
            Console & Structured File Logs
          </span>
          <span className="text-[11px] text-slate-500 font-mono">
            ({filteredLogs.length} entries)
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Search box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-2 py-1 text-[11px] bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500 w-36 sm:w-48 font-mono"
            />
          </div>

          {/* Level Filter */}
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="px-2 py-1 text-[11px] bg-slate-900 border border-slate-800 rounded-lg text-slate-200 outline-none font-mono cursor-pointer"
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>

          {/* Copy Button */}
          <button
            onClick={handleCopyLogs}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition cursor-pointer"
            title="Copy Logs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Refresh Button */}
          <button
            onClick={onRefresh}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Log Feed */}
      <div className="p-3 font-mono text-[11px] max-h-[500px] overflow-y-auto space-y-1.5 divide-y divide-slate-800/40">
        {filteredLogs.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No logs matching filter criteria.
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="pt-1.5 first:pt-0 flex items-start gap-2 hover:bg-slate-800/30 px-1.5 py-0.5 rounded transition">
              <span className="text-slate-500 shrink-0 select-none">
                {log.timestamp.split('T')[1]?.slice(0, 8)}
              </span>

              <span
                className={`px-1.5 py-0.2 rounded border text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                  LEVEL_COLORS[log.level] || 'text-slate-400 bg-slate-800 border-slate-700'
                }`}
              >
                {log.level}
              </span>

              <div className="flex-1 break-all">
                <span className="text-slate-200">{log.message}</span>
                {log.meta && Object.keys(log.meta).length > 0 && (
                  <pre className="mt-0.5 text-[10px] text-slate-400 bg-slate-950/80 p-1 rounded overflow-x-auto">
                    {JSON.stringify(log.meta, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
