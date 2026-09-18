import fs from 'fs';
import path from 'path';
import { createClient, type Client } from '@libsql/client';
import { config } from './config.js';
import { logger } from './logger.js';

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

export interface DatabaseStatus {
  connected: boolean;
  path: string;
  totalJobs: number;
  countsByStatus: Record<JobStatus, number>;
  lastCheck: string;
  error?: string;
}

class DatabaseService {
  private client: Client | null = null;
  private isInitialized = false;

  public async init(): Promise<void> {
    if (this.isInitialized && this.client) return;

    try {
      const dbPath = path.resolve(process.cwd(), config.databasePath);
      const dbDir = path.dirname(dbPath);

      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Initialize LibSQL SQLite client with file protocol
      this.client = createClient({
        url: `file:${dbPath}`,
      });

      // Create jobs table if not exists with all required columns
      await this.client.execute(`
        CREATE TABLE IF NOT EXISTS jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telegram_chat_id TEXT NOT NULL,
          telegram_message_id INTEGER NOT NULL,
          sender_user_id TEXT NOT NULL,
          original_file_id TEXT NOT NULL,
          local_file_path TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'waiting_transcription', 'completed', 'failed')),
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          transcription TEXT,
          error TEXT,
          transcriber_message_id INTEGER,
          outgoing_mtproto_message_id INTEGER,
          bot_reply_message_id INTEGER,
          delete_status TEXT NOT NULL DEFAULT 'pending',
          deleted_at TEXT,
          delete_error TEXT,
          attempts INTEGER NOT NULL DEFAULT 0
        );
      `);

      // Migration: Add outgoing_mtproto_message_id column if table was created previously without it
      try {
        await this.client.execute(`
          ALTER TABLE jobs ADD COLUMN outgoing_mtproto_message_id INTEGER;
        `);
      } catch {
        // Column already exists, ignore
      }

      // Migration: Add bot_reply_message_id column if table was created previously without it
      try {
        await this.client.execute(`
          ALTER TABLE jobs ADD COLUMN bot_reply_message_id INTEGER;
        `);
      } catch {
        // Column already exists, ignore
      }

      // Migration: Add delete_status column
      try {
        await this.client.execute(`
          ALTER TABLE jobs ADD COLUMN delete_status TEXT DEFAULT 'pending';
        `);
      } catch {
        // Column already exists, ignore
      }

      // Migration: Add deleted_at column
      try {
        await this.client.execute(`
          ALTER TABLE jobs ADD COLUMN deleted_at TEXT;
        `);
      } catch {
        // Column already exists, ignore
      }

      // Migration: Add delete_error column
      try {
        await this.client.execute(`
          ALTER TABLE jobs ADD COLUMN delete_error TEXT;
        `);
      } catch {
        // Column already exists, ignore
      }

      // Indexes for fast lookup by status and creation date
      await this.client.execute(`
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      `);
      await this.client.execute(`
        CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
      `);

      // Requirement 8: UNIQUE index on (telegram_chat_id, telegram_message_id) to prevent duplicate jobs
      await this.client.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_chat_msg ON jobs(telegram_chat_id, telegram_message_id);
      `);

      // Requirement 9: Safe restart recovery
      await this.recoverJobsOnStartup();

      this.isInitialized = true;
      logger.info('Database initialized successfully', { path: dbPath });
    } catch (err) {
      logger.error('Database initialization failed', err, { path: config.databasePath });
      throw err;
    }
  }

  /**
   * Requirement 9: Safe job recovery after server restart
   * - completed jobs: left untouched (never reprocessed)
   * - pending jobs: left pending for worker pick-up
   * - processing jobs: safely returned to 'pending' queue
   * - waiting_transcription jobs: in-memory MTProto listener callbacks and timers are
   *   destroyed on process restart. To prevent jobs from being permanently stuck in limbo,
   *   jobs with attempts < 3 are safely reset to 'pending' for retry, while jobs exceeding
   *   max attempts are marked 'failed'.
   */
  public async recoverJobsOnStartup(): Promise<void> {
    if (!this.client) return;
    try {
      // 1. Return processing jobs safely to pending
      const procRes = await this.client.execute(`
        UPDATE jobs 
        SET status = 'pending' 
        WHERE status = 'processing'
      `);
      if (procRes.rowsAffected > 0) {
        logger.info(`[RECOVERY] Recovered ${procRes.rowsAffected} interrupted processing jobs back to pending`);
      }

      // 2. Safely recover waiting_transcription jobs
      const waitRes = await this.client.execute(`
        UPDATE jobs
        SET status = 'pending', attempts = attempts + 1
        WHERE status = 'waiting_transcription' AND attempts < 3
      `);
      if (waitRes.rowsAffected > 0) {
        logger.info(`[RECOVERY] Recovered ${waitRes.rowsAffected} interrupted waiting_transcription jobs back to pending (attempts incremented)`);
      }

      const stuckWaitRes = await this.client.execute(`
        UPDATE jobs
        SET status = 'failed', error = 'Interrupted by server restart: max attempts exceeded in waiting_transcription'
        WHERE status = 'waiting_transcription' AND attempts >= 3
      `);
      if (stuckWaitRes.rowsAffected > 0) {
        logger.warn(`[RECOVERY] Marked ${stuckWaitRes.rowsAffected} stuck waiting_transcription jobs as failed due to max attempts exceeded`);
      }
    } catch (err) {
      logger.warn('[RECOVERY] Warning during startup jobs recovery', { error: String(err) });
    }
  }

  public getClient(): Client {
    if (!this.client) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.client;
  }

  public async getStatus(): Promise<DatabaseStatus> {
    const defaultCounts: Record<JobStatus, number> = {
      pending: 0,
      processing: 0,
      waiting_transcription: 0,
      completed: 0,
      failed: 0,
    };

    try {
      if (!this.client) {
        await this.init();
      }

      const client = this.getClient();
      const countRes = await client.execute('SELECT COUNT(*) as count FROM jobs');
      const totalJobs = Number(countRes.rows[0]?.count || 0);

      const statusRes = await client.execute(`
        SELECT status, COUNT(*) as count 
        FROM jobs 
        GROUP BY status
      `);

      for (const row of statusRes.rows) {
        const s = String(row.status) as JobStatus;
        if (s in defaultCounts) {
          defaultCounts[s] = Number(row.count || 0);
        }
      }

      return {
        connected: true,
        path: config.databasePath,
        totalJobs,
        countsByStatus: defaultCounts,
        lastCheck: new Date().toISOString(),
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        connected: false,
        path: config.databasePath,
        totalJobs: 0,
        countsByStatus: defaultCounts,
        lastCheck: new Date().toISOString(),
        error: errorMsg,
      };
    }
  }

  public async getRecentJobs(limit = 50, status?: string): Promise<Job[]> {
    const client = this.getClient();
    let query = 'SELECT * FROM jobs';
    const args: (string | number)[] = [];

    if (status && ['pending', 'processing', 'waiting_transcription', 'completed', 'failed'].includes(status)) {
      query += ' WHERE status = ?';
      args.push(status);
    }

    query += ' ORDER BY id DESC LIMIT ?';
    args.push(limit);

    const res = await client.execute({ sql: query, args });

    return res.rows.map((row) => ({
      id: Number(row.id),
      telegram_chat_id: String(row.telegram_chat_id),
      telegram_message_id: Number(row.telegram_message_id),
      sender_user_id: String(row.sender_user_id),
      original_file_id: String(row.original_file_id),
      local_file_path: String(row.local_file_path),
      status: String(row.status) as JobStatus,
      created_at: String(row.created_at),
      started_at: row.started_at ? String(row.started_at) : null,
      completed_at: row.completed_at ? String(row.completed_at) : null,
      transcription: row.transcription ? String(row.transcription) : null,
      error: row.error ? String(row.error) : null,
      transcriber_message_id: row.transcriber_message_id ? Number(row.transcriber_message_id) : null,
      outgoing_mtproto_message_id: row.outgoing_mtproto_message_id ? Number(row.outgoing_mtproto_message_id) : null,
      bot_reply_message_id: row.bot_reply_message_id ? Number(row.bot_reply_message_id) : null,
      delete_status: (row.delete_status ? String(row.delete_status) : 'pending') as DeleteStatus,
      deleted_at: row.deleted_at ? String(row.deleted_at) : null,
      delete_error: row.delete_error ? String(row.delete_error) : null,
      attempts: Number(row.attempts || 0),
    }));
  }

  public async getJobById(id: number): Promise<Job | null> {
    const client = this.getClient();
    const res = await client.execute({
      sql: 'SELECT * FROM jobs WHERE id = ? LIMIT 1',
      args: [id],
    });

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    return {
      id: Number(row.id),
      telegram_chat_id: String(row.telegram_chat_id),
      telegram_message_id: Number(row.telegram_message_id),
      sender_user_id: String(row.sender_user_id),
      original_file_id: String(row.original_file_id),
      local_file_path: String(row.local_file_path),
      status: String(row.status) as JobStatus,
      created_at: String(row.created_at),
      started_at: row.started_at ? String(row.started_at) : null,
      completed_at: row.completed_at ? String(row.completed_at) : null,
      transcription: row.transcription ? String(row.transcription) : null,
      error: row.error ? String(row.error) : null,
      transcriber_message_id: row.transcriber_message_id ? Number(row.transcriber_message_id) : null,
      outgoing_mtproto_message_id: row.outgoing_mtproto_message_id ? Number(row.outgoing_mtproto_message_id) : null,
      bot_reply_message_id: row.bot_reply_message_id ? Number(row.bot_reply_message_id) : null,
      delete_status: (row.delete_status ? String(row.delete_status) : 'pending') as DeleteStatus,
      deleted_at: row.deleted_at ? String(row.deleted_at) : null,
      delete_error: row.delete_error ? String(row.delete_error) : null,
      attempts: Number(row.attempts || 0),
    };
  }

  /**
   * Requirement 8: Retrieve job by telegram chat and message ID to prevent duplicate processing
   */
  public async getJobByTelegramMessage(chatId: string, messageId: number): Promise<Job | null> {
    const client = this.getClient();
    const res = await client.execute({
      sql: 'SELECT * FROM jobs WHERE telegram_chat_id = ? AND telegram_message_id = ? LIMIT 1',
      args: [chatId, messageId],
    });

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    return {
      id: Number(row.id),
      telegram_chat_id: String(row.telegram_chat_id),
      telegram_message_id: Number(row.telegram_message_id),
      sender_user_id: String(row.sender_user_id),
      original_file_id: String(row.original_file_id),
      local_file_path: String(row.local_file_path),
      status: String(row.status) as JobStatus,
      created_at: String(row.created_at),
      started_at: row.started_at ? String(row.started_at) : null,
      completed_at: row.completed_at ? String(row.completed_at) : null,
      transcription: row.transcription ? String(row.transcription) : null,
      error: row.error ? String(row.error) : null,
      transcriber_message_id: row.transcriber_message_id ? Number(row.transcriber_message_id) : null,
      outgoing_mtproto_message_id: row.outgoing_mtproto_message_id ? Number(row.outgoing_mtproto_message_id) : null,
      bot_reply_message_id: row.bot_reply_message_id ? Number(row.bot_reply_message_id) : null,
      delete_status: (row.delete_status ? String(row.delete_status) : 'pending') as DeleteStatus,
      deleted_at: row.deleted_at ? String(row.deleted_at) : null,
      delete_error: row.delete_error ? String(row.delete_error) : null,
      attempts: Number(row.attempts || 0),
    };
  }

  public async createJob(params: {
    telegram_chat_id: string;
    telegram_message_id: number;
    sender_user_id: string;
    original_file_id: string;
    local_file_path: string;
    status?: JobStatus;
    transcription?: string;
    error?: string;
    outgoing_mtproto_message_id?: number;
  }): Promise<Job> {
    const client = this.getClient();

    // Requirement 8: Check for duplicate chat_id + message_id before inserting
    const existing = await this.getJobByTelegramMessage(params.telegram_chat_id, params.telegram_message_id);
    if (existing) {
      logger.warn('[DUPLICATE PREVENTED] Job already exists for this Telegram message', {
        job_id: existing.id,
        chat_id: params.telegram_chat_id,
        message_id: params.telegram_message_id,
        status: existing.status,
      });
      return existing;
    }

    const now = new Date().toISOString();
    const status: JobStatus = params.status || 'pending';

    try {
      const res = await client.execute({
        sql: `
          INSERT INTO jobs (
            telegram_chat_id,
            telegram_message_id,
            sender_user_id,
            original_file_id,
            local_file_path,
            status,
            created_at,
            transcription,
            error,
            outgoing_mtproto_message_id,
            attempts
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `,
        args: [
          params.telegram_chat_id,
          params.telegram_message_id,
          params.sender_user_id,
          params.original_file_id,
          params.local_file_path,
          status,
          now,
          params.transcription || null,
          params.error || null,
          params.outgoing_mtproto_message_id || null,
        ],
      });

      const newId = Number(res.lastInsertRowid);
      const created = await this.getJobById(newId);
      if (!created) {
        throw new Error(`Failed to retrieve newly created job ${newId}`);
      }

      logger.info('[JOB CREATED] Job saved to SQLite', { id: newId, status, chat_id: params.telegram_chat_id, message_id: params.telegram_message_id });
      return created;
    } catch (err: unknown) {
      // In case of concurrent unique constraint race, fallback safely to existing
      const duplicate = await this.getJobByTelegramMessage(params.telegram_chat_id, params.telegram_message_id);
      if (duplicate) {
        return duplicate;
      }
      throw err;
    }
  }

  public async updateJob(
    id: number,
    updates: Partial<{
      status: JobStatus;
      started_at: string | null;
      completed_at: string | null;
      transcription: string | null;
      error: string | null;
      transcriber_message_id: number | null;
      outgoing_mtproto_message_id: number | null;
      bot_reply_message_id: number | null;
      delete_status: DeleteStatus | null;
      deleted_at: string | null;
      delete_error: string | null;
      attempts: number;
    }>
  ): Promise<Job | null> {
    const client = this.getClient();
    const keys = Object.keys(updates);
    if (keys.length === 0) return this.getJobById(id);

    const setClauses: string[] = [];
    const args: (string | number | null)[] = [];

    for (const key of keys) {
      setClauses.push(`${key} = ?`);
      args.push((updates as Record<string, unknown>)[key] as string | number | null);
    }

    args.push(id);
    await client.execute({
      sql: `UPDATE jobs SET ${setClauses.join(', ')} WHERE id = ?`,
      args,
    });

    return this.getJobById(id);
  }
}

export const db = new DatabaseService();
