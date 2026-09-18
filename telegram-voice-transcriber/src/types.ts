export type JobStatus =
  | 'pending'
  | 'processing'
  | 'waiting_transcription'
  | 'completed'
  | 'failed';

export type DeleteStatus = 'pending' | 'deleted' | 'failed';

export interface Job {
  id: number;
  telegram_chat_id: string;
  telegram_message_id: number;
  sender_user_id: string;
  original_file_id: string;
  local_file_path: string;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  transcription: string | null;
  error: string | null;
  transcriber_message_id: number | null;
  outgoing_mtproto_message_id?: number | null;
  bot_reply_message_id?: number | null;
  delete_status?: DeleteStatus | null;
  deleted_at?: string | null;
  delete_error?: string | null;
  attempts: number;
}

export interface AppStatusData {
  app: {
    name: string;
    status: string;
    uptime_seconds: number;
    uptime_formatted?: string;
    timestamp: string;
    node_version: string;
    environment: string;
    memory: {
      rss_mb: string;
      heap_used_mb: string;
      heap_total_mb: string;
    };
  };
  database: {
    status: string;
    connected: boolean;
    engine?: string;
    path: string;
    total_jobs: number;
    counts_by_status: Record<JobStatus, number>;
    last_check: string;
    error: string | null;
  };
  worker: {
    status: string;
    active: boolean;
    phase?: string;
    description: string;
    queue_size?: number;
    active_jobs?: number;
    pending_jobs?: number;
    waiting_transcription_jobs?: number;
    speech_transcriber_bot_target?: string;
    target_bot?: string;
    timeout_seconds?: number;
    poll_interval_ms?: number;
    centralized_listener?: boolean;
    diagnostics?: {
      running: boolean;
      connected: boolean;
      centralized_listener_active: boolean;
      active_waiting_jobs_count: number;
      configured_timeout_seconds: number;
      configured_poll_interval_ms: number;
      target_bot: string;
    };
  };
}

export interface LogItem {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
  error?: string;
}

export interface MetricsResponse extends AppStatusData {
  success: boolean;
  jobs: {
    recent: Job[];
    total: number;
    counts_by_status: Record<JobStatus, number>;
  };
  errors: {
    failed_jobs: Job[];
    error_logs: LogItem[];
  };
  logs: LogItem[];
}
