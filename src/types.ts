export type JobStatus = 'pending' | 'processing' | 'waiting_transcription' | 'completed' | 'failed';

export interface Job {
  id: number;
  telegram_chat_id: string;
  telegram_message_id: number;
  sender_user_id: string;
  original_file_id: string;
  local_file_path: string;
  status: JobStatus;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  transcription?: string | null;
  error?: string | null;
  transcriber_message_id?: number | null;
  attempts: number;
  outgoing_mtproto_message_id?: number | null;
  bot_reply_message_id?: number | null;
  delete_status?: 'pending' | 'deleted' | 'failed' | null;
  deleted_at?: string | null;
  delete_error?: string | null;
}

export interface AppStatus {
  status: string;
  uptime: string;
  uptime_seconds?: number;
  node_version: string;
  memory?: {
    rss: string;
    heapTotal: string;
    heapUsed: string;
  };
}

export interface DatabaseStatus {
  status: string;
  path: string;
  total_jobs: number;
  by_status: Record<JobStatus, number>;
}

export interface WorkerStatus {
  status: string;
  active: boolean;
  running?: boolean;
  connected?: boolean;
  centralized_listener_active?: boolean;
  active_waiting_jobs_count?: number;
  target_bot?: string;
  waiting_jobs?: Array<{
    job_id: number;
    sent_message_id: number;
    voice_sent_at: string;
    elapsed_sec: number;
    intermediate_messages_received: number;
  }>;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

export interface MetricsResponse {
  app: AppStatus;
  database: DatabaseStatus;
  worker: WorkerStatus;
  jobs: {
    total: number;
    by_status: Record<JobStatus, number>;
    recent: Job[];
  };
  errors: {
    failed_jobs: Job[];
    error_logs: LogEntry[];
  };
  logs: LogEntry[];
}
