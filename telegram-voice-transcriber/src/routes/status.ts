import { Router, type Request, type Response } from 'express';
import { db } from '../database.js';
import { config } from '../config.js';
import { transcriberWorker } from '../transcriber/worker.js';

export const statusRouter = Router();

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/**
 * GET /api/status
 * Shows application, database, and worker states
 */
statusRouter.get('/', async (req: Request, res: Response) => {
  const uptimeSeconds = Math.floor(process.uptime());
  const mem = process.memoryUsage();

  const dbStatus = await db.getStatus();

  const pendingCount = dbStatus.countsByStatus.pending || 0;
  const processingCount = dbStatus.countsByStatus.processing || 0;
  const waitingCount = dbStatus.countsByStatus.waiting_transcription || 0;

  const responseData = {
    app: {
      name: 'telegram-voice-transcriber',
      status: 'healthy',
      uptime_seconds: uptimeSeconds,
      uptime_formatted: formatUptime(uptimeSeconds),
      timestamp: new Date().toISOString(),
      node_version: process.version,
      environment: config.nodeEnv,
      memory: {
        rss_mb: (mem.rss / 1024 / 1024).toFixed(2),
        heap_used_mb: (mem.heapUsed / 1024 / 1024).toFixed(2),
        heap_total_mb: (mem.heapTotal / 1024 / 1024).toFixed(2),
      },
    },
    database: {
      status: dbStatus.connected ? 'connected' : 'disconnected',
      connected: dbStatus.connected,
      engine: 'SQLite (LibSQL)',
      path: dbStatus.path,
      total_jobs: dbStatus.totalJobs,
      counts_by_status: dbStatus.countsByStatus,
      last_check: dbStatus.lastCheck,
      error: dbStatus.error || null,
    },
    worker: {
      status: 'active',
      active: true,
      architecture: 'Single persistent MTProto client + Centralized message handler + Correlation registry',
      centralized_listener: true,
      target_bot: `@${config.transcriber.botUsername}`,
      timeout_seconds: config.transcriber.timeoutSeconds,
      poll_interval_ms: config.transcriber.pollIntervalMs,
      queue_size: pendingCount + processingCount + waitingCount,
      active_jobs: processingCount,
      pending_jobs: pendingCount,
      waiting_transcription_jobs: waitingCount,
      diagnostics: transcriberWorker.getDiagnostics(),
      description: 'Single centralized incoming message handler actively correlates responses with jobs queue.',
    },
  };

  const statusCode = dbStatus.connected ? 200 : 503;
  res.status(statusCode).json(responseData);
});
