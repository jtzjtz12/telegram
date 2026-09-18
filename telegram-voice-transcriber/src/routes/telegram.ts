import { Router, type Request, type Response } from 'express';
import { telegramBot } from '../telegram/bot.js';
import { PipelineTestRunner } from '../transcriber/test-pipeline.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

export const telegramRouter = Router();

/**
 * GET /api/telegram/info
 * Returns status of Telegram Bot API integration (safe, no secrets)
 */
telegramRouter.get('/info', (_req: Request, res: Response) => {
  res.status(200).json({
    bot_username: config.transcriber.botUsername,
    bot_token_configured: Boolean(config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN),
    mode: (config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN) ? 'production_live' : 'production_simulated',
    transcriber_timeout_seconds: config.transcriber.timeoutSeconds,
  });
});

/**
 * POST /api/telegram/webhook
 * Incoming webhook from Telegram Bot API for voice messages
 */
telegramRouter.post('/webhook', async (req: Request, res: Response) => {
  try {
    const update = req.body;
    const result = await telegramBot.handleWebhookUpdate(update);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    logger.error('Telegram webhook processing error', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Webhook error',
    });
  }
});

/**
 * POST /api/telegram/test-single
 * Runs the single voice message pipeline test
 */
telegramRouter.post('/test-single', async (_req: Request, res: Response) => {
  try {
    const result = await PipelineTestRunner.runSingleVoicePipelineTest();
    res.status(200).json(result);
  } catch (err) {
    logger.error('Single voice pipeline test error', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Test error',
    });
  }
});

/**
 * POST /api/telegram/test-parallel
 * Runs the 3 simultaneous voice messages pipeline test
 */
telegramRouter.post('/test-parallel', async (_req: Request, res: Response) => {
  try {
    const result = await PipelineTestRunner.runThreeParallelVoicePipelineTest();
    res.status(200).json(result);
  } catch (err) {
    logger.error('Parallel voice pipeline test error', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Test error',
    });
  }
});
