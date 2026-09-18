import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';
import { db } from '../database.js';
import { logger } from '../logger.js';
import { transcriberWorker } from '../transcriber/worker.js';

export const webRouter = Router();

/**
 * Authentication middleware for web admin routes
 * Supports HTTP Basic Auth and Bearer Token header
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  // If no password is set in .env, log a warning but allow access or require setting it
  if (!config.adminPassword) {
    // In dev mode without password, we can proceed but notify the client
    return next();
  }

  // 1. Check Bearer token (base64 username:password or session token)
  const authHeader = req.headers.authorization;
  if (authHeader) {
    if (authHeader.startsWith('Basic ')) {
      const base64 = authHeader.substring(6);
      const decoded = Buffer.from(base64, 'base64').toString('utf-8');
      const [user, pass] = decoded.split(':');
      if (user === config.adminUsername && pass === config.adminPassword) {
        return next();
      }
    } else if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const expectedToken = Buffer.from(`${config.adminUsername}:${config.adminPassword}`).toString('base64');
      if (token === expectedToken) {
        return next();
      }
    }
  }

  // Check custom header X-Admin-Token
  const customToken = req.headers['x-admin-token'];
  if (customToken) {
    const expectedToken = Buffer.from(`${config.adminUsername}:${config.adminPassword}`).toString('base64');
    if (customToken === expectedToken) {
      return next();
    }
  }

  // Unauthorized
  res.setHeader('WWW-Authenticate', 'Basic realm="Telegram Voice Transcriber Admin"');
  return res.status(401).json({
    success: false,
    error: 'Authentication required. Invalid credentials.',
  });
}

/**
 * POST /api/auth/login
 * Validates admin credentials and returns an authorization token
 */
webRouter.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body || {};

  // If no password is set, provide guidance
  if (!config.adminPassword) {
    return res.status(200).json({
      success: true,
      token: 'dev-open-token',
      username: config.adminUsername,
      warning: 'ADMIN_PASSWORD is not configured in .env; running in open development mode.',
    });
  }

  if (username === config.adminUsername && password === config.adminPassword) {
    const token = Buffer.from(`${config.adminUsername}:${config.adminPassword}`).toString('base64');
    logger.info('Admin logged in successfully', { username });
    return res.status(200).json({
      success: true,
      token,
      username: config.adminUsername,
    });
  }

  logger.warn('Admin login attempt failed', { username });
  return res.status(401).json({
    success: false,
    error: 'Invalid username or password',
  });
});

/**
 * GET /api/auth/verify
 * Verifies if the current token is valid
 */
webRouter.get('/api/auth/verify', requireAdminAuth, (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    authenticated: true,
    username: config.adminUsername,
    hasPasswordConfigured: Boolean(config.adminPassword),
  });
});

/**
 * GET /api/admin/metrics
 * Comprehensive dashboard telemetry: app state, db state, jobs breakdown, errors & logs
 */
webRouter.get('/api/admin/metrics', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const dbStatus = await db.getStatus();
    const recentJobs = await db.getRecentJobs(20);
    const failedJobs = await db.getRecentJobs(20, 'failed');
    const recentLogs = logger.getRecentLogs(30);
    const errorLogs = logger.getErrorLogs(20);

    const mem = process.memoryUsage();
    const uptimeSeconds = Math.floor(process.uptime());

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      app: {
        name: 'Telegram Voice Transcriber',
        status: 'healthy',
        environment: config.nodeEnv,
        uptime_seconds: uptimeSeconds,
        node_version: process.version,
        memory: {
          rss_mb: (mem.rss / 1024 / 1024).toFixed(1),
          heap_used_mb: (mem.heapUsed / 1024 / 1024).toFixed(1),
          heap_total_mb: (mem.heapTotal / 1024 / 1024).toFixed(1),
        },
      },
      database: dbStatus,
      worker: {
        status: 'active',
        description: 'Single persistent MTProto client + Centralized incoming update handler',
        active: true,
        timeout_seconds: config.transcriber.timeoutSeconds,
        poll_interval_ms: config.transcriber.pollIntervalMs,
        target_bot: `@${config.transcriber.botUsername}`,
        diagnostics: transcriberWorker.getDiagnostics(),
      },
      jobs: {
        recent: recentJobs,
        total: dbStatus.totalJobs,
        counts_by_status: dbStatus.countsByStatus,
      },
      errors: {
        failed_jobs: failedJobs,
        error_logs: errorLogs,
      },
      logs: recentLogs,
    });
  } catch (err) {
    logger.error('Failed to aggregate admin metrics', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal Server Error',
    });
  }
});
