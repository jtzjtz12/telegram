import { useState, useEffect, useCallback } from 'react';
import {
  Mic,
  Server,
  PlusCircle,
  RefreshCw,
  LogOut,
  Layers,
  AlertTriangle,
  Terminal,
  ExternalLink,
  Code2,
  CheckCircle2,
  Send,
} from 'lucide-react';
import type { MetricsResponse, JobStatus } from './types.js';
import { LoginModal } from './components/LoginModal.js';
import { StatusCards } from './components/StatusCards.js';
import { JobsTable } from './components/JobsTable.js';
import { ErrorsPanel } from './components/ErrorsPanel.js';
import { LogsViewer } from './components/LogsViewer.js';
import { CreateJobModal } from './components/CreateJobModal.js';
import { TelegramAuthCard } from './components/TelegramAuthCard.js';

export default function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('admin_token'));
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'jobs' | 'errors' | 'logs' | 'api' | 'telegram'>('jobs');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(5);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['X-Admin-Token'] = token;
      }

      const res = await fetch('/api/admin/metrics', { headers });

      if (res.status === 401) {
        setToken(null);
        localStorage.removeItem('admin_token');
        return;
      }

      if (!res.ok) {
        throw new Error(`Failed to load metrics (${res.status} ${res.statusText})`);
      }

      const data: MetricsResponse = await res.json();
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error contacting backend');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Auto-refresh timer
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;
    const interval = setInterval(() => {
      fetchMetrics();
    }, autoRefreshInterval * 1000);
    return () => clearInterval(interval);
  }, [autoRefreshInterval, fetchMetrics]);

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    setToken(null);
    setMetrics(null);
  };

  // If unauthenticated, show the auth modal
  if (!token && !metrics) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <LoginModal onLoginSuccess={(newToken) => setToken(newToken)} />
      </div>
    );
  }

  // Filter jobs by selected status if any
  const displayedJobs = metrics?.jobs.recent
    ? statusFilter
      ? metrics.jobs.recent.filter((j) => j.status === statusFilter)
      : metrics.jobs.recent
    : [];

  return (
    <div id="admin-dashboard-root" className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Application Bar */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900 tracking-tight">
                  Telegram Voice Transcriber
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Stage 1 Backend
                </span>
              </div>
              <p className="text-xs text-slate-500">
                SQLite Storage • Structured Logging • Worker Queue
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Auto refresh selector */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 px-2.5 py-1.5 rounded-lg">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              <span>Auto-refresh:</span>
              <select
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                className="bg-transparent font-medium text-slate-800 outline-none cursor-pointer"
              >
                <option value={0}>Off</option>
                <option value={3}>3s</option>
                <option value={5}>5s</option>
                <option value={15}>15s</option>
              </select>
            </div>

            <button
              id="open-create-job-button"
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg shadow-xs transition cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add Test Voice Job</span>
              <span className="sm:hidden">Test Job</span>
            </button>

            <button
              id="header-telegram-auth-link"
              onClick={() => setActiveTab('telegram')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer ${
                activeTab === 'telegram'
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              title="Telegram MTProto Авторизация"
            >
              <Send className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden md:inline">MTProto Вход</span>
            </button>

            <button
              id="admin-logout-button"
              onClick={handleLogout}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center justify-between">
            <span>{error}</span>
            <button onClick={fetchMetrics} className="font-semibold underline cursor-pointer">
              Retry
            </button>
          </div>
        )}

        {metrics && (
          <>
            {/* System Status and Breakdown Cards */}
            <StatusCards
              data={metrics}
              selectedStatus={statusFilter}
              onSelectStatus={(status) => setStatusFilter(status)}
            />

            {/* Navigation Tabs */}
            <div className="border-b border-slate-200 flex items-center gap-1 sm:gap-2">
              <button
                id="tab-recent-jobs-button"
                onClick={() => setActiveTab('jobs')}
                className={`flex items-center gap-2 py-2.5 px-3.5 text-xs font-medium border-b-2 -mb-px transition cursor-pointer ${
                  activeTab === 'jobs'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>Recent Jobs ({metrics.jobs.total})</span>
              </button>

              <button
                id="tab-errors-button"
                onClick={() => setActiveTab('errors')}
                className={`flex items-center gap-2 py-2.5 px-3.5 text-xs font-medium border-b-2 -mb-px transition cursor-pointer ${
                  activeTab === 'errors'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                <span>
                  Errors & Failures{' '}
                  {metrics.errors.failed_jobs.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold">
                      {metrics.errors.failed_jobs.length}
                    </span>
                  )}
                </span>
              </button>

              <button
                id="tab-logs-button"
                onClick={() => setActiveTab('logs')}
                className={`flex items-center gap-2 py-2.5 px-3.5 text-xs font-medium border-b-2 -mb-px transition cursor-pointer ${
                  activeTab === 'logs'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Terminal className="w-4 h-4" />
                <span>Structured Logs</span>
              </button>

              <button
                id="tab-api-button"
                onClick={() => setActiveTab('api')}
                className={`flex items-center gap-2 py-2.5 px-3.5 text-xs font-medium border-b-2 -mb-px transition cursor-pointer ${
                  activeTab === 'api'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Code2 className="w-4 h-4" />
                <span>API Endpoints</span>
              </button>

              <button
                id="tab-telegram-auth-button"
                onClick={() => setActiveTab('telegram')}
                className={`flex items-center gap-2 py-2.5 px-3.5 text-xs font-medium border-b-2 -mb-px transition cursor-pointer ${
                  activeTab === 'telegram'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Send className="w-4 h-4" />
                <span>MTProto Авторизация</span>
              </button>
            </div>

            {/* Tab Views */}
            {activeTab === 'jobs' && (
              <JobsTable
                jobs={displayedJobs}
                loading={loading}
                onRefresh={fetchMetrics}
                onJobUpdated={fetchMetrics}
              />
            )}

            {activeTab === 'errors' && (
              <ErrorsPanel
                failedJobs={metrics.errors.failed_jobs}
                errorLogs={metrics.errors.error_logs}
                onRefresh={fetchMetrics}
              />
            )}

            {activeTab === 'logs' && (
              <LogsViewer logs={metrics.logs} onRefresh={fetchMetrics} />
            )}

            {activeTab === 'api' && (
              <div id="api-endpoints-view" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* GET /health */}
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        GET
                      </span>
                      <a
                        href="/health"
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"
                      >
                        Open <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <code className="text-xs font-bold text-slate-800 block mb-2">/health</code>
                    <p className="text-xs text-slate-500 mb-3">
                      Returns standard healthcheck object: <code className="bg-slate-100 px-1 py-0.5 rounded">{'{"status":"ok"}'}</code>
                    </p>
                    <pre className="bg-slate-900 text-emerald-400 p-2.5 rounded text-[11px] font-mono overflow-x-auto">
                      {'{"status":"ok"}'}
                    </pre>
                  </div>

                  {/* GET /api/status */}
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800">
                        GET
                      </span>
                      <a
                        href="/api/status"
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"
                      >
                        Open <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <code className="text-xs font-bold text-slate-800 block mb-2">/api/status</code>
                    <p className="text-xs text-slate-500 mb-3">
                      Displays state of application, database, and worker queue.
                    </p>
                    <pre className="bg-slate-900 text-sky-400 p-2.5 rounded text-[11px] font-mono overflow-x-auto max-h-32">
                      {JSON.stringify(
                        {
                          app: { status: 'healthy', uptime: '12m' },
                          database: { status: 'connected', total_jobs: metrics.jobs.total },
                          worker: { status: 'idle', active: true },
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>

                  {/* GET /api/jobs */}
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                    <div className="flex items-center justify-between mb-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                        GET
                      </span>
                      <a
                        href="/api/jobs"
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"
                      >
                        Open <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <code className="text-xs font-bold text-slate-800 block mb-2">/api/jobs</code>
                    <p className="text-xs text-slate-500 mb-3">
                      Returns recent jobs from SQLite table. Query params: <code className="bg-slate-100 px-1 rounded">?limit=50&status=pending</code>
                    </p>
                    <pre className="bg-slate-900 text-purple-400 p-2.5 rounded text-[11px] font-mono overflow-x-auto max-h-32">
                      {JSON.stringify(
                        {
                          success: true,
                          count: metrics.jobs.recent.length,
                          status_filter: 'all',
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'telegram' && (
              <TelegramAuthCard onAuthSuccess={fetchMetrics} />
            )}
          </>
        )}
      </main>

      {/* Modal for creating a test job */}
      <CreateJobModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onJobCreated={fetchMetrics}
      />
    </div>
  );
}
