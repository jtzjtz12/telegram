import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { config } from './config.js';
import { logger } from './logger.js';
import { db } from './database.js';
import { jobsRouter } from './routes/jobs.js';
import { telegramRouter } from './routes/telegram.js';
import { transcriberWorker } from './transcriber/worker.js';
import { telegramBot } from './telegram/bot.js';
import type { MetricsResponse } from './types.js';

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON request body parser
  app.use(express.json());

  // Request logger middleware
  app.use((req, res, next) => {
    if (!req.path.startsWith('/@') && !req.path.includes('.')) {
      logger.debug(`${req.method} ${req.path}`);
    }
    next();
  });

  // Healthcheck endpoint
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // System status endpoint
  app.get('/api/status', async (_req, res) => {
    try {
      const stats = await db.getStats();
      const mem = process.memoryUsage();
      const uptimeSec = process.uptime();

      res.status(200).json({
        app: {
          status: 'healthy',
          uptime: formatUptime(uptimeSec),
          uptime_seconds: Math.floor(uptimeSec),
          node_version: process.version,
          memory: {
            rss: formatBytes(mem.rss),
            heapTotal: formatBytes(mem.heapTotal),
            heapUsed: formatBytes(mem.heapUsed),
          },
        },
        database: {
          status: 'connected',
          path: config.databasePath,
          total_jobs: stats.total,
          by_status: stats.by_status,
        },
        worker: transcriberWorker.getDiagnostics(),
      });
    } catch (err) {
      logger.error('Failed to get system status', err);
      res.status(500).json({ error: 'Failed to retrieve status' });
    }
  });

  // Admin login endpoint
  app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body || {};
    const expectedUser = config.adminUsername || 'admin';
    const expectedPass = config.adminPassword;

    const userMatches = String(username || '').trim().toLowerCase() === expectedUser.toLowerCase();
    const passMatches = !expectedPass || String(password || '') === expectedPass;

    if (userMatches && passMatches) {
      const token = 'admin_' + crypto.randomBytes(16).toString('hex');
      return res.status(200).json({
        success: true,
        token,
        username: expectedUser,
      });
    }

    res.status(401).json({
      success: false,
      error: 'Invalid username or password',
    });
  });

  // Metrics endpoint for admin dashboard
  app.get('/api/admin/metrics', async (_req, res) => {
    try {
      const stats = await db.getStats();
      const recent = await db.getRecentJobs(50);
      const failed = await db.getFailedJobs(20);
      const logs = logger.getRecentLogs(100);
      const errorLogs = logger.getErrorLogs(50);
      const mem = process.memoryUsage();
      const uptimeSec = process.uptime();
      const workerDiag = transcriberWorker.getDiagnostics();

      const response: MetricsResponse = {
        app: {
          status: 'healthy',
          uptime: formatUptime(uptimeSec),
          uptime_seconds: Math.floor(uptimeSec),
          node_version: process.version,
          memory: {
            rss: formatBytes(mem.rss),
            heapTotal: formatBytes(mem.heapTotal),
            heapUsed: formatBytes(mem.heapUsed),
          },
        },
        database: {
          status: 'connected',
          path: config.databasePath,
          total_jobs: stats.total,
          by_status: stats.by_status,
        },
        worker: {
          status: workerDiag.running ? 'running' : 'idle',
          active: workerDiag.running,
          running: workerDiag.running,
          connected: workerDiag.connected,
          centralized_listener_active: workerDiag.centralized_listener_active,
          active_waiting_jobs_count: workerDiag.active_waiting_jobs_count,
          target_bot: workerDiag.target_bot,
          waiting_jobs: workerDiag.waiting_jobs,
        },
        jobs: {
          total: stats.total,
          by_status: stats.by_status,
          recent,
        },
        errors: {
          failed_jobs: failed,
          error_logs: errorLogs,
        },
        logs,
      };

      res.status(200).json(response);
    } catch (err) {
      logger.error('Failed to load admin metrics', err);
      res.status(500).json({ error: 'Failed to retrieve metrics' });
    }
  });

  // Sub-routers
  app.use('/api/jobs', jobsRouter);
  app.use('/api/telegram', telegramRouter);

  // Initialize and start background worker gracefully
  transcriberWorker.start().catch((err) => {
    logger.warn('Transcriber worker started with limitations (credentials may be needed for live MTProto)', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Start Telegram Bot API polling
  telegramBot.startPolling().catch((err) => {
    logger.warn('Telegram Bot polling failed to start', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Integrate Vite for SPA development or serve static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on port ${PORT} (0.0.0.0:${PORT})`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
