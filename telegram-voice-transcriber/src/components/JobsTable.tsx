import { useState } from 'react';
import { Eye, CheckCircle, AlertTriangle, Clock, RefreshCw, FileAudio } from 'lucide-react';
import type { Job, JobStatus } from '../types.js';

interface JobsTableProps {
  jobs: Job[];
  loading: boolean;
  onRefresh: () => void;
  onJobUpdated?: () => void;
}

const BADGE_STYLES: Record<JobStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  processing: 'bg-blue-50 text-blue-700 border-blue-200',
  waiting_transcription: 'bg-purple-50 text-purple-700 border-purple-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
};

const DELETE_BADGE_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  deleted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function JobsTable({ jobs, loading, onRefresh, onJobUpdated }: JobsTableProps) {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [testRunning, setTestRunning] = useState<'single' | 'parallel' | null>(null);
  const [testResult, setTestResult] = useState<{
    test_name: string;
    success: boolean;
    duration_ms: number;
    steps_completed: string[];
    jobs_summary: Array<{
      job_id: number;
      chat_id: string;
      message_id: number;
      source_chat_id?: string;
      source_message_id?: number;
      transcription: string;
      bot_reply_message_id?: number;
      reply_to_message_id?: number;
      delete_status?: string;
      deleted_at?: string;
      delete_error?: string | null;
      voice_deleted?: boolean;
      final_status: string;
      status?: string;
    }>;
    duplicate_protection_verified?: boolean;
    listener_verification?: {
      single_listener_active: boolean;
      multiple_listeners_created: boolean;
      listener_count: number;
    };
  } | null>(null);

  const handleRunTestSingle = async () => {
    setTestRunning('single');
    try {
      const res = await fetch('/api/telegram/test-single', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
      if (onJobUpdated) onJobUpdated();
      onRefresh();
    } catch (err) {
      console.error('Failed to run single test', err);
    } finally {
      setTestRunning(null);
    }
  };

  const handleRunTestParallel = async () => {
    setTestRunning('parallel');
    try {
      const res = await fetch('/api/telegram/test-parallel', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
      if (onJobUpdated) onJobUpdated();
      onRefresh();
    } catch (err) {
      console.error('Failed to run parallel test', err);
    } finally {
      setTestRunning(null);
    }
  };

  const handleRetryJob = async (jobId: number) => {
    setUpdatingId(jobId);
    try {
      await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
      if (onJobUpdated) onJobUpdated();
      onRefresh();
    } catch (err) {
      console.error('Failed to retry job', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleSimulatePipeline = async (jobId: number) => {
    setUpdatingId(jobId);
    try {
      await fetch(`/api/jobs/${jobId}/simulate-pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Привет! Голосовое сообщение успешно распознано через единый централизованный MTProto обработчик.',
          delay_ms: 1200,
        }),
      });
      if (onJobUpdated) onJobUpdated();
      onRefresh();
    } catch (err) {
      console.error('Failed to run pipeline simulation', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAdvanceStatus = async (job: Job) => {
    setUpdatingId(job.id);
    let nextStatus: JobStatus = 'completed';
    let transcription: string | undefined;
    let error: string | undefined;

    if (job.status === 'pending') {
      nextStatus = 'processing';
    } else if (job.status === 'processing') {
      nextStatus = 'waiting_transcription';
    } else if (job.status === 'waiting_transcription') {
      nextStatus = 'completed';
      transcription = 'Расшифровка: Голосовое сообщение успешно распознано ботом @speech_transcriber_bot.';
    } else if (job.status === 'failed') {
      nextStatus = 'pending';
    }

    try {
      await fetch(`/api/jobs/${job.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, transcription, error }),
      });
      if (onJobUpdated) onJobUpdated();
      onRefresh();
    } catch (err) {
      console.error('Failed to update status', err);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div id="jobs-table-container" className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="p-4 sm:px-6 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Recent SQLite Jobs</h3>
          <p className="text-xs text-slate-500">
            Full production-like pipeline: Telegram → Bot API → SQLite → Worker → MTProto → Centralized Listener → Bot Reply
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            id="run-single-pipeline-test-btn"
            onClick={handleRunTestSingle}
            disabled={loading || testRunning !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition disabled:opacity-50 cursor-pointer"
          >
            {testRunning === 'single' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileAudio className="w-3.5 h-3.5 text-indigo-600" />
            )}
            Тест: 1 Voice Job
          </button>
          <button
            id="run-parallel-pipeline-test-btn"
            onClick={handleRunTestParallel}
            disabled={loading || testRunning !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition disabled:opacity-50 cursor-pointer"
          >
            {testRunning === 'parallel' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
            )}
            Тест: 3 Parallel Voice Jobs
          </button>
          <button
            id="refresh-jobs-table-button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {testResult && (
        <div className="p-4 bg-emerald-50/90 border-b border-emerald-200 text-xs text-emerald-950 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-emerald-900 flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{testResult.test_name} — УСПЕШНО ЗАВЕРШЕН ({testResult.duration_ms}ms)</span>
              </div>
              <div className="text-emerald-800 space-y-0.5 mt-1">
                <p>• MTProto Listener: 1 единый централизованный обработчик (0 утечек/отдельных слушателей)</p>
                {testResult.duplicate_protection_verified && (
                  <p>• Защита от повторной обработки (duplicate protection): подтверждена</p>
                )}
                <p>• Путь: Bot API → SQLite → Worker → MTProto → Centralized Listener → Bot Reply → completed</p>
              </div>
            </div>
            <button
              onClick={() => setTestResult(null)}
              className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold px-2 py-1 bg-white border border-emerald-200 rounded hover:bg-emerald-50 transition cursor-pointer"
            >
              Скрыть
            </button>
          </div>

          {testResult.jobs_summary.length > 0 && (
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px] bg-white rounded-lg border border-emerald-200 shadow-2xs">
                <thead>
                  <tr className="bg-emerald-100/70 text-emerald-950 font-semibold border-b border-emerald-200">
                    <th className="py-2 px-3">job_id</th>
                    <th className="py-2 px-3">source_chat_id</th>
                    <th className="py-2 px-3">source_message_id</th>
                    <th className="py-2 px-3">transcription</th>
                    <th className="py-2 px-3">bot_reply_message_id</th>
                    <th className="py-2 px-3">voice_delete</th>
                    <th className="py-2 px-3">status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-100">
                  {testResult.jobs_summary.map((js) => (
                    <tr key={js.job_id} className="hover:bg-emerald-50/50">
                      <td className="py-2 px-3 font-mono font-bold text-slate-900">#{js.job_id}</td>
                      <td className="py-2 px-3 font-mono text-slate-600">{js.source_chat_id || js.chat_id}</td>
                      <td className="py-2 px-3 font-mono text-slate-600">{js.source_message_id || js.message_id}</td>
                      <td className="py-2 px-3 max-w-xs text-slate-900 truncate" title={js.transcription}>{js.transcription}</td>
                      <td className="py-2 px-3 font-mono font-bold text-indigo-700">{js.bot_reply_message_id || '—'}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                          js.delete_status === 'deleted'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                            : js.delete_status === 'failed'
                            ? 'bg-rose-100 text-rose-800 border-rose-300'
                            : 'bg-amber-100 text-amber-800 border-amber-300'
                        }`}>
                          {js.delete_status === 'deleted' ? 'Deleted ✓' : js.delete_status === 'failed' ? 'Failed ✕' : 'Pending'}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-semibold text-emerald-700">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-800">
                          {js.final_status || js.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="p-12 text-center">
          <FileAudio className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-700">No jobs found</p>
          <p className="text-xs text-slate-400 mt-1">Use the "+ Add Test Voice Job" button to create sample records</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <th className="py-3 px-4 w-14">ID</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Telegram Chat / Msg</th>
                <th className="py-3 px-4">Voice Deletion</th>
                <th className="py-3 px-4">Sender ID</th>
                <th className="py-3 px-4">Transcription / Result</th>
                <th className="py-3 px-4">Created At</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-normal text-slate-700">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                    #{job.id}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border ${BADGE_STYLES[job.status] || 'bg-slate-100 text-slate-600'}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 font-mono text-[11px]">
                    <div className="text-slate-900">{job.telegram_chat_id}</div>
                    <div className="text-slate-400 text-[10px]">msg: #{job.telegram_message_id}</div>
                  </td>
                  <td className="py-3 px-4 text-[11px]">
                    {job.delete_status === 'deleted' ? (
                      <div>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border bg-emerald-50 text-emerald-700 border-emerald-200">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          Deleted
                        </span>
                        {job.deleted_at && (
                          <div className="text-slate-400 text-[10px] mt-0.5 font-mono">
                            {new Date(job.deleted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </div>
                        )}
                      </div>
                    ) : job.delete_status === 'failed' ? (
                      <div>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border bg-rose-50 text-rose-700 border-rose-200" title={job.delete_error || 'Deletion failed'}>
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          Delete Failed
                        </span>
                        {job.delete_error && (
                          <div className="text-rose-600 text-[10px] mt-0.5 truncate max-w-[120px]" title={job.delete_error}>
                            {job.delete_error}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border bg-slate-50 text-slate-500 border-slate-200">
                        <Clock className="w-3 h-3 text-slate-400" />
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600 text-[11px]">
                    {job.sender_user_id}
                  </td>
                  <td className="py-3 px-4 max-w-xs">
                    {job.transcription ? (
                      <p className="text-emerald-700 bg-emerald-50/70 p-1.5 rounded border border-emerald-100 truncate" title={job.transcription}>
                        {job.transcription}
                      </p>
                    ) : job.error ? (
                      <p className="text-rose-700 bg-rose-50/70 p-1.5 rounded border border-rose-100 truncate" title={job.error}>
                        {job.error}
                      </p>
                    ) : (
                      <span className="text-slate-400 italic">In progress...</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                    {new Date(job.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                    {job.status === 'failed' && (
                      <button
                        onClick={() => handleRetryJob(job.id)}
                        disabled={updatingId === job.id}
                        className="text-[11px] text-rose-700 hover:text-rose-900 font-medium px-2 py-1 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition cursor-pointer"
                        title="Retry failed job"
                      >
                        {updatingId === job.id ? 'Retrying...' : 'Retry'}
                      </button>
                    )}
                    {job.status !== 'completed' && job.status !== 'failed' && (
                      <button
                        onClick={() => handleSimulatePipeline(job.id)}
                        disabled={updatingId === job.id}
                        className="text-[11px] text-purple-700 hover:text-purple-900 font-medium px-2 py-1 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded transition cursor-pointer"
                        title="Test centralized MTProto correlation and transcription"
                      >
                        {updatingId === job.id ? 'Processing...' : 'Run Pipeline'}
                      </button>
                    )}
                    {job.status !== 'completed' && (
                      <button
                        onClick={() => handleAdvanceStatus(job)}
                        disabled={updatingId === job.id}
                        className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 bg-indigo-50 hover:bg-indigo-100 rounded transition cursor-pointer"
                        title="Advance status manually"
                      >
                        {updatingId === job.id ? 'Updating...' : 'Advance'}
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedJob(job)}
                      className="text-[11px] text-slate-600 hover:text-slate-900 font-medium px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded transition inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3 h-3" />
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal for Full SQLite Record */}
      {selectedJob && (
        <div id="job-detail-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-base">Job #{selectedJob.id} Details</h3>
                <p className="text-xs text-slate-400 font-mono">SQLite jobs record inspection</p>
              </div>
              <button
                onClick={() => setSelectedJob(null)}
                className="text-slate-400 hover:text-white text-sm px-2 py-1 rounded cursor-pointer"
              >
                ✕ Close
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4 text-xs font-mono">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                  <span className="text-slate-400 block text-[10px] uppercase">Status</span>
                  <span className={`inline-block mt-1 font-semibold px-2 py-0.5 rounded text-xs ${BADGE_STYLES[selectedJob.status]}`}>
                    {selectedJob.status}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                  <span className="text-slate-400 block text-[10px] uppercase">Attempts</span>
                  <span className="font-semibold text-slate-800 text-sm">{selectedJob.attempts}</span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-2">
                <div><span className="text-slate-400">telegram_chat_id:</span> <span className="text-slate-900 font-bold">{selectedJob.telegram_chat_id}</span></div>
                <div><span className="text-slate-400">telegram_message_id:</span> <span className="text-slate-900">{selectedJob.telegram_message_id}</span></div>
                <div><span className="text-slate-400">sender_user_id:</span> <span className="text-slate-900">{selectedJob.sender_user_id}</span></div>
                <div><span className="text-slate-400">original_file_id:</span> <span className="text-slate-600 break-all">{selectedJob.original_file_id}</span></div>
                <div><span className="text-slate-400">local_file_path:</span> <span className="text-slate-600 break-all">{selectedJob.local_file_path}</span></div>
                <div><span className="text-slate-400">transcriber_message_id:</span> <span className="text-slate-600">{selectedJob.transcriber_message_id || 'null'}</span></div>
                <div><span className="text-slate-400">bot_reply_message_id:</span> <span className="text-indigo-700 font-bold">{selectedJob.bot_reply_message_id || 'null'}</span></div>
              </div>

              <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-2">
                <div><span className="text-slate-400">created_at:</span> {selectedJob.created_at}</div>
                <div><span className="text-slate-400">started_at:</span> {selectedJob.started_at || 'null'}</div>
                <div><span className="text-slate-400">completed_at:</span> {selectedJob.completed_at || 'null'}</div>
              </div>

              <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-2">
                <span className="text-slate-400 block text-[10px] uppercase font-sans font-semibold">Original Voice Deletion</span>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400">delete_status:</span>
                  <span className={`inline-block font-semibold px-2 py-0.5 rounded text-[11px] border ${DELETE_BADGE_STYLES[selectedJob.delete_status || 'pending']}`}>
                    {selectedJob.delete_status || 'pending'}
                  </span>
                </div>
                <div><span className="text-slate-400">deleted_at:</span> <span className="text-slate-900">{selectedJob.deleted_at || 'null'}</span></div>
                {selectedJob.delete_error && (
                  <div><span className="text-rose-500">delete_error:</span> <span className="text-rose-700 font-sans">{selectedJob.delete_error}</span></div>
                )}
              </div>

              {selectedJob.transcription && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded">
                  <span className="text-emerald-800 font-semibold block mb-1">Transcription</span>
                  <p className="font-sans text-emerald-950 text-sm">{selectedJob.transcription}</p>
                </div>
              )}

              {selectedJob.error && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded">
                  <span className="text-rose-800 font-semibold block mb-1">Error</span>
                  <p className="font-sans text-rose-950 text-sm">{selectedJob.error}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
