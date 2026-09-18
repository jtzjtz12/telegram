import express, { type Request, type Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { config } from './config.js';
import { logger } from './logger.js';
import { db } from './database.js';
import { healthRouter } from './routes/health.js';
import { statusRouter } from './routes/status.js';
import { jobsRouter } from './routes/jobs.js';
import { webRouter } from './web/index.js';
import { telegramRouter } from './routes/telegram.js';
import { transcriberWorker } from './transcriber/worker.js';

async function seedInitialJobsIfEmpty() {
  try {
    const status = await db.getStatus();
    if (status.totalJobs === 0) {
      logger.info('Database empty, inserting demonstration jobs across statuses...');
      
      await db.createJob({
        telegram_chat_id: '-1001892345678',
        telegram_message_id: 1042,
        sender_user_id: 'user_482910',
        original_file_id: 'AwACAgIAAxkBAAIEM2V8910SampleVoiceOne',
        local_file_path: '/tmp/voice_sample_1.ogg',
        status: 'completed',
        transcription: 'Привет, проверь, пожалуйста, отчет по голосовым сообщениям за прошлую неделю.',
      });

      await db.createJob({
        telegram_chat_id: '-1001892345678',
        telegram_message_id: 1043,
        sender_user_id: 'user_773912',
        original_file_id: 'AwACAgIAAxkBAAIEM2V8911SampleVoiceTwo',
        local_file_path: '/tmp/voice_sample_2.ogg',
        status: 'waiting_transcription',
      });

      await db.createJob({
        telegram_chat_id: '-1001998877665',
        telegram_message_id: 2011,
        sender_user_id: 'user_991234',
        original_file_id: 'AwACAgIAAxkBAAIEM2V8912SampleVoiceThree',
        local_file_path: '/tmp/voice_sample_3.ogg',
        status: 'processing',
      });

      await db.createJob({
        telegram_chat_id: '-1001998877665',
        telegram_message_id: 2012,
        sender_user_id: 'user_334512',
        original_file_id: 'AwACAgIAAxkBAAIEM2V8913SampleVoiceFour',
        local_file_path: '/tmp/voice_sample_4.ogg',
        status: 'pending',
      });

      await db.createJob({
        telegram_chat_id: '-1001998877665',
        telegram_message_id: 2013,
        sender_user_id: 'user_552190',
        original_file_id: 'AwACAgIAAxkBAAIEM2V8914SampleVoiceFive',
        local_file_path: '/tmp/voice_sample_5.ogg',
        status: 'failed',
        error: 'Telegram MTProto timeout: @speech_transcriber_bot response delay > 60s',
      });

      logger.info('Demonstration jobs seeded successfully');
    }
  } catch (err) {
    logger.warn('Seed initial jobs skipped', { err: String(err) });
  }
}

async function startServer() {
  const app = express();
  const PORT = config.port;

  // Initialize SQLite database
  await db.init();
  await seedInitialJobsIfEmpty();

  // Start centralized MTProto transcriber worker
  await transcriberWorker.start();

  // Middleware
  app.use(express.json());

  // Structured HTTP request logger
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (!req.path.startsWith('/@') && !req.path.includes('node_modules')) {
        logger.debug(`${req.method} ${req.path}`, {
          status: res.statusCode,
          duration_ms: duration,
          ip: req.ip,
        });
      }
    });
    next();
  });

  // 1. Healthcheck Route (as requested: GET /health -> {"status":"ok"})
  app.use('/health', healthRouter);
  app.use('/api/health', healthRouter);

  // 2. Status Route (as requested: GET /api/status -> app, db, worker state)
  app.use('/api/status', statusRouter);

  // 3. Jobs Route (as requested: GET /api/jobs -> recent jobs from SQLite)
  app.use('/api/jobs', jobsRouter);

  // 4. Web Admin API Routes
  app.use(webRouter);

  // 5. Telegram Bot API Webhook & Pipeline Testing Routes
  app.use('/api/telegram', telegramRouter);

  // Serve Frontend UI (Vite in dev, static build in production)
  if (config.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start HTTP listener on 0.0.0.0:PORT
  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Telegram Voice Transcriber Server running on http://0.0.0.0:${PORT}`, {
      port: PORT,
      environment: config.nodeEnv,
      database: config.databasePath,
    });
  });

  // Graceful shutdown
  const handleShutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

startServer().catch((err) => {
  logger.error('Fatal server startup error', err);
  process.exit(1);
});
