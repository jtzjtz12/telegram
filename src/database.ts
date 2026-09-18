import fs from 'fs';
import path from 'path';
import { createClient, type Client } from '@libsql/client';
import { config } from './config.js';
import { logger } from './logger.js';
import type { Job, JobStatus } from './types.js';

export type { Job, JobStatus };

class DatabaseService {
  private client: Client | null = null;
  private inMemoryJobs: Map<number, Job> = new Map();
  private nextId = 1;
  private isInitialized = false;

  constructor() {
    this.init().catch((err) => {
      logger.error('Failed to initialize database', err);
    });
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const dbDir = path.dirname(config.databasePath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      this.client = createClient({
        url: `file:${config.databasePath}`,
      });

      // Create jobs table per schema in README
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
          attempts INTEGER NOT NULL DEFAULT 0,
          outgoing_mtproto_message_id INTEGER,
          bot_reply_message_id INTEGER,
          delete_status TEXT DEFAULT 'not_deleted',
          deleted_at TEXT,
          delete_error TEXT
        );
      `);

      // Ensure new columns exist on existing databases
      try {
        await this.client.execute('ALTER TABLE jobs ADD COLUMN deleted_at TEXT');
      } catch {
        // column already exists
      }
      try {
        await this.client.execute('ALTER TABLE jobs ADD COLUMN delete_error TEXT');
      } catch {
        // column already exists
      }

      logger.info(`SQLite database connected at ${config.databasePath}`);
      this.isInitialized = true;

      // Check if table is empty, seed with a couple of starter demo jobs if so
      const countRes = await this.client.execute('SELECT COUNT(*) as count FROM jobs');
      const count = Number(countRes.rows[0]?.count || 0);
      if (count === 0) {
        await this.seedInitialJobs();
      }
    } catch (err) {
      logger.warn('LibSQL client failed to connect to file, using in-memory database store', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.client = null;
      this.isInitialized = true;
      this.seedInMemory();
    }
  }

  private async seedInitialJobs(): Promise<void> {
    const demoJobs = [
      {
        telegram_chat_id: '-1001984729104',
        telegram_message_id: 1042,
        sender_user_id: 'user_48102',
        original_file_id: 'AwACAgIAAxkBAAMCZ58',
        local_file_path: '/tmp/voice_demo_1.ogg',
        status: 'completed' as JobStatus,
        created_at: new Date(Date.now() - 3600000).toISOString(),
        started_at: new Date(Date.now() - 3590000).toISOString(),
        completed_at: new Date(Date.now() - 3570000).toISOString(),
        transcription: 'Привет, подскажи, пожалуйста, во сколько завтра начинается созвон по проекту?',
        error: null,
        transcriber_message_id: 8940,
        attempts: 1,
        outgoing_mtproto_message_id: 8939,
        bot_reply_message_id: 1043,
        delete_status: 'pending',
      },
      {
        telegram_chat_id: '-1001984729104',
        telegram_message_id: 1045,
        sender_user_id: 'user_77391',
        original_file_id: 'AwACAgIAAxkBAAMCZ59',
        local_file_path: '/tmp/voice_demo_2.ogg',
        status: 'pending' as JobStatus,
        created_at: new Date(Date.now() - 120000).toISOString(),
        started_at: null,
        completed_at: null,
        transcription: null,
        error: null,
        transcriber_message_id: null,
        attempts: 0,
        outgoing_mtproto_message_id: null,
        bot_reply_message_id: null,
        delete_status: null,
      },
    ];

    for (const j of demoJobs) {
      if (this.client) {
        await this.client.execute({
          sql: `INSERT INTO jobs (
            telegram_chat_id, telegram_message_id, sender_user_id, original_file_id,
            local_file_path, status, created_at, started_at, completed_at, transcription,
            error, transcriber_message_id, attempts, outgoing_mtproto_message_id,
            bot_reply_message_id, delete_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            j.telegram_chat_id,
            j.telegram_message_id,
            j.sender_user_id,
            j.original_file_id,
            j.local_file_path,
            j.status,
            j.created_at,
            j.started_at,
            j.completed_at,
            j.transcription,
            j.error,
            j.transcriber_message_id,
            j.attempts,
            j.outgoing_mtproto_message_id,
            j.bot_reply_message_id,
            j.delete_status,
          ],
        });
      }
    }
  }

  private seedInMemory(): void {
    const job1: Job = {
      id: 1,
      telegram_chat_id: '-1001984729104',
      telegram_message_id: 1042,
      sender_user_id: 'user_48102',
      original_file_id: 'AwACAgIAAxkBAAMCZ58',
      local_file_path: '/tmp/voice_demo_1.ogg',
      status: 'completed',
      created_at: new Date(Date.now() - 3600000).toISOString(),
      started_at: new Date(Date.now() - 3590000).toISOString(),
      completed_at: new Date(Date.now() - 3570000).toISOString(),
      transcription: 'Привет, подскажи, пожалуйста, во сколько завтра начинается созвон по проекту?',
      error: null,
      transcriber_message_id: 8940,
      attempts: 1,
      outgoing_mtproto_message_id: 8939,
      bot_reply_message_id: 1043,
      delete_status: 'pending',
    };

    const job2: Job = {
      id: 2,
      telegram_chat_id: '-1001984729104',
      telegram_message_id: 1045,
      sender_user_id: 'user_77391',
      original_file_id: 'AwACAgIAAxkBAAMCZ59',
      local_file_path: '/tmp/voice_demo_2.ogg',
      status: 'pending',
      created_at: new Date(Date.now() - 120000).toISOString(),
      started_at: null,
      completed_at: null,
      transcription: null,
      error: null,
      transcriber_message_id: null,
      attempts: 0,
      outgoing_mtproto_message_id: null,
      bot_reply_message_id: null,
      delete_status: null,
    };

    this.inMemoryJobs.set(1, job1);
    this.inMemoryJobs.set(2, job2);
    this.nextId = 3;
  }

  private rowToJob(row: Record<string, unknown>): Job {
    return {
      id: Number(row.id),
      telegram_chat_id: String(row.telegram_chat_id || ''),
      telegram_message_id: Number(row.telegram_message_id || 0),
      sender_user_id: String(row.sender_user_id || ''),
      original_file_id: String(row.original_file_id || ''),
      local_file_path: String(row.local_file_path || ''),
      status: (row.status as JobStatus) || 'pending',
      created_at: String(row.created_at || new Date().toISOString()),
      started_at: row.started_at ? String(row.started_at) : null,
      completed_at: row.completed_at ? String(row.completed_at) : null,
      transcription: row.transcription ? String(row.transcription) : null,
      error: row.error ? String(row.error) : null,
      transcriber_message_id: row.transcriber_message_id != null ? Number(row.transcriber_message_id) : null,
      attempts: Number(row.attempts || 0),
      outgoing_mtproto_message_id: row.outgoing_mtproto_message_id != null ? Number(row.outgoing_mtproto_message_id) : null,
      bot_reply_message_id: row.bot_reply_message_id != null ? Number(row.bot_reply_message_id) : null,
      delete_status: (row.delete_status as Job['delete_status']) || 'not_deleted',
      deleted_at: row.deleted_at ? String(row.deleted_at) : null,
      delete_error: row.delete_error ? String(row.delete_error) : null,
    };
  }

  public async getRecentJobs(limit = 50, status?: string): Promise<Job[]> {
    if (!this.isInitialized) await this.init();

    if (this.client) {
      try {
        let sql = 'SELECT * FROM jobs';
        const args: any[] = [];
        if (status && status !== 'all') {
          sql += ' WHERE status = ?';
          args.push(status);
        }
        sql += ' ORDER BY id DESC LIMIT ?';
        args.push(limit);

        const res = await this.client.execute({ sql, args: args as any });
        return res.rows.map((r) => this.rowToJob(r as Record<string, unknown>));
      } catch (err) {
        logger.error('Error fetching jobs from SQLite', err);
      }
    }

    // In-memory fallback
    const all = Array.from(this.inMemoryJobs.values()).sort((a, b) => b.id - a.id);
    if (status && status !== 'all') {
      return all.filter((j) => j.status === status).slice(0, limit);
    }
    return all.slice(0, limit);
  }

  public async getJobById(id: number): Promise<Job | null> {
    if (!this.isInitialized) await this.init();

    if (this.client) {
      try {
        const res = await this.client.execute({
          sql: 'SELECT * FROM jobs WHERE id = ?',
          args: [id],
        });
        if (res.rows.length > 0) {
          return this.rowToJob(res.rows[0] as Record<string, unknown>);
        }
        return null;
      } catch (err) {
        logger.error(`Error fetching job ${id} from SQLite`, err);
      }
    }

    return this.inMemoryJobs.get(id) || null;
  }

  public async createJob(jobData: Partial<Job>): Promise<Job> {
    if (!this.isInitialized) await this.init();

    const now = new Date().toISOString();
    const newJob: Job = {
      id: 0,
      telegram_chat_id: String(jobData.telegram_chat_id || ''),
      telegram_message_id: Number(jobData.telegram_message_id || 0),
      sender_user_id: String(jobData.sender_user_id || ''),
      original_file_id: String(jobData.original_file_id || ''),
      local_file_path: String(jobData.local_file_path || ''),
      status: jobData.status || 'pending',
      created_at: jobData.created_at || now,
      started_at: jobData.started_at || null,
      completed_at: jobData.completed_at || null,
      transcription: jobData.transcription || null,
      error: jobData.error || null,
      transcriber_message_id: jobData.transcriber_message_id || null,
      attempts: jobData.attempts || 0,
      outgoing_mtproto_message_id: jobData.outgoing_mtproto_message_id || null,
      bot_reply_message_id: jobData.bot_reply_message_id || null,
      delete_status: jobData.delete_status || 'not_deleted',
      deleted_at: jobData.deleted_at || null,
      delete_error: jobData.delete_error || null,
    };

    if (this.client) {
      try {
        const res = await this.client.execute({
          sql: `INSERT INTO jobs (
            telegram_chat_id, telegram_message_id, sender_user_id, original_file_id,
            local_file_path, status, created_at, started_at, completed_at, transcription,
            error, transcriber_message_id, attempts, outgoing_mtproto_message_id,
            bot_reply_message_id, delete_status, deleted_at, delete_error
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          args: [
            newJob.telegram_chat_id,
            newJob.telegram_message_id,
            newJob.sender_user_id,
            newJob.original_file_id,
            newJob.local_file_path,
            newJob.status,
            newJob.created_at,
            newJob.started_at,
            newJob.completed_at,
            newJob.transcription,
            newJob.error,
            newJob.transcriber_message_id,
            newJob.attempts,
            newJob.outgoing_mtproto_message_id,
            newJob.bot_reply_message_id,
            newJob.delete_status,
            newJob.deleted_at,
            newJob.delete_error,
          ] as any,
        });

        if (res.rows.length > 0) {
          const created = this.rowToJob(res.rows[0] as Record<string, unknown>);
          this.inMemoryJobs.set(created.id, created);
          return created;
        }
      } catch (err) {
        logger.error('Error inserting job into SQLite', err);
      }
    }

    newJob.id = this.nextId++;
    this.inMemoryJobs.set(newJob.id, newJob);
    return newJob;
  }

  public async updateJob(id: number, updates: Partial<Job> | Record<string, unknown>): Promise<Job | null> {
    if (!this.isInitialized) await this.init();

    if (this.client) {
      try {
        const keys = Object.keys(updates);
        if (keys.length > 0) {
          const setClause = keys.map((k) => `${k} = ?`).join(', ');
          const values: any[] = keys.map((k) => updates[k as keyof typeof updates]);
          values.push(id);

          await this.client.execute({
            sql: `UPDATE jobs SET ${setClause} WHERE id = ?`,
            args: values as any,
          });

          const updated = await this.getJobById(id);
          if (updated) {
            this.inMemoryJobs.set(id, updated);
            return updated;
          }
        }
      } catch (err) {
        logger.error(`Error updating job ${id} in SQLite`, err);
      }
    }

    const existing = this.inMemoryJobs.get(id);
    if (!existing) return null;

    const merged: Job = { ...existing, ...updates };
    this.inMemoryJobs.set(id, merged);
    return merged;
  }

  public async getStats(): Promise<{ total: number; by_status: Record<JobStatus, number> }> {
    const defaultStats: Record<JobStatus, number> = {
      pending: 0,
      processing: 0,
      waiting_transcription: 0,
      completed: 0,
      failed: 0,
    };

    if (this.client) {
      try {
        const res = await this.client.execute('SELECT status, COUNT(*) as count FROM jobs GROUP BY status');
        let total = 0;
        for (const row of res.rows) {
          const status = String(row.status) as JobStatus;
          const count = Number(row.count || 0);
          if (defaultStats[status] !== undefined) {
            defaultStats[status] = count;
          }
          total += count;
        }
        return { total, by_status: defaultStats };
      } catch (err) {
        logger.error('Error fetching stats from SQLite', err);
      }
    }

    let total = 0;
    for (const job of this.inMemoryJobs.values()) {
      total++;
      if (defaultStats[job.status] !== undefined) {
        defaultStats[job.status]++;
      }
    }
    return { total, by_status: defaultStats };
  }

  public async getFailedJobs(limit = 20): Promise<Job[]> {
    return this.getRecentJobs(limit, 'failed');
  }
}

export const db = new DatabaseService();
