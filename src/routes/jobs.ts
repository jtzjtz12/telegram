import { Router, type Request, type Response } from 'express';
import { db, type JobStatus } from '../database.js';
import { logger } from '../logger.js';
import { transcriberWorker } from '../transcriber/worker.js';

export const jobsRouter = Router();

/**
 * GET /api/jobs
 * Returns recent jobs from SQLite with optional filtering by status and limit
 */
jobsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 200);
    const status = req.query.status as string | undefined;

    const jobs = await db.getRecentJobs(limit, status);
    res.status(200).json({
      success: true,
      count: jobs.length,
      limit,
      status_filter: status || 'all',
      jobs,
    });
  } catch (err) {
    logger.error('Failed to fetch jobs', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to fetch jobs',
    });
  }
});

/**
 * GET /api/jobs/:id
 * Retrieve a specific job by ID
 */
jobsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, error: 'Invalid job ID' });
    }

    const job = await db.getJobById(id);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    res.status(200).json({ success: true, job });
  } catch (err) {
    logger.error(`Failed to fetch job ${req.params.id}`, err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /api/jobs/test
 * Create a sample/test voice job to verify SQLite storage, schema, and admin interface
 */
jobsRouter.post('/test', async (req: Request, res: Response) => {
  try {
    const {
      telegram_chat_id = '-100' + Math.floor(100000000 + Math.random() * 900000000),
      telegram_message_id = Math.floor(1000 + Math.random() * 9000),
      sender_user_id = 'user_' + Math.floor(10000 + Math.random() * 90000),
      original_file_id = 'AwACAgIAAxkBA' + Math.random().toString(36).substring(2, 15),
      local_file_path = `/tmp/voice_${Date.now()}.ogg`,
      status = 'pending',
      transcription = null,
      error = null,
    } = req.body || {};

    const job = await db.createJob({
      telegram_chat_id: String(telegram_chat_id),
      telegram_message_id: Number(telegram_message_id),
      sender_user_id: String(sender_user_id),
      original_file_id: String(original_file_id),
      local_file_path: String(local_file_path),
      status: status as JobStatus,
      transcription: transcription || undefined,
      error: error || undefined,
    });

    res.status(201).json({
      success: true,
      message: 'Test job created in SQLite',
      job,
    });
  } catch (err) {
    logger.error('Failed to create test job', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create job',
    });
  }
});

/**
 * POST /api/jobs/:id/status
 * Updates status of a job (useful for admin testing and pipeline simulation)
 */
jobsRouter.post('/:id/status', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, transcription, error } = req.body as {
      status: JobStatus;
      transcription?: string;
      error?: string;
    };

    const validStatuses: JobStatus[] = ['pending', 'processing', 'waiting_transcription', 'completed', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status provided' });
    }

    const updates: Record<string, unknown> = { status };
    const now = new Date().toISOString();

    if (status === 'processing') {
      updates.started_at = now;
    } else if (status === 'completed') {
      updates.completed_at = now;
      if (transcription) updates.transcription = transcription;
    } else if (status === 'failed') {
      updates.completed_at = now;
      if (error) updates.error = error;
    }

    const updatedJob = await db.updateJob(id, updates);
    if (!updatedJob) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    logger.info(`Job ${id} status updated to ${status}`);
    res.status(200).json({ success: true, job: updatedJob });
  } catch (err) {
    logger.error(`Failed to update job ${req.params.id}`, err);
    res.status(500).json({ success: false, error: 'Failed to update job' });
  }
});

/**
 * POST /api/jobs/:id/retry
 * Resets a failed job back to 'pending' state
 */
jobsRouter.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await db.getJobById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    const updated = await db.updateJob(id, {
      status: 'pending',
      error: null,
      transcription: null,
      started_at: null,
      completed_at: null,
      attempts: existing.attempts + 1,
    });

    logger.info(`Job ${id} re-queued for processing (attempt #${existing.attempts + 1})`);
    res.status(200).json({ success: true, message: `Job ${id} re-queued`, job: updated });
  } catch (err) {
    logger.error(`Failed to retry job ${req.params.id}`, err);
    res.status(500).json({ success: false, error: 'Failed to retry job' });
  }
});

/**
 * POST /api/jobs/:id/process-now
 * Manually dispatches an existing job through the real MTProto transcription pipeline
 */
jobsRouter.post('/:id/process-now', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await transcriberWorker.processJobNow(id);
    res.status(200).json(result);
  } catch (err) {
    logger.error(`Failed to process job ${req.params.id}`, err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Processing failed',
    });
  }
});

