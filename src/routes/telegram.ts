import { Router, type Request, type Response } from 'express';
import { telegramBot } from '../telegram/bot.js';
import {
  getMTProtoAuthStatus,
  startMTProtoWebAuth,
  submitMTProtoWebCode,
  submitMTProtoWebPassword,
  cancelMTProtoWebAuth,
} from '../telegram/mtproto.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

export const telegramRouter = Router();

/**
 * GET /api/telegram/auth/status
 * Returns current MTProto configuration and authorization state
 */
telegramRouter.get('/auth/status', async (_req: Request, res: Response) => {
  try {
    const status = await getMTProtoAuthStatus();
    res.status(200).json({ success: true, ...status });
  } catch (err) {
    logger.error('Error fetching MTProto auth status', err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get auth status',
    });
  }
});

/**
 * POST /api/telegram/auth/start
 * Requests Telegram login code via MTProto
 */
telegramRouter.post('/auth/start', async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body || {};
    const result = await startMTProtoWebAuth(phoneNumber);
    res.status(200).json(result);
  } catch (err) {
    logger.error('Error starting MTProto auth', err);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to start authorization',
    });
  }
});

/**
 * POST /api/telegram/auth/code
 * Submits the Telegram login code
 */
telegramRouter.post('/auth/code', async (req: Request, res: Response) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Код подтверждения обязателен',
      });
    }
    const result = await submitMTProtoWebCode(code);
    res.status(200).json(result);
  } catch (err) {
    logger.error('Error submitting MTProto code', err);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Invalid verification code',
    });
  }
});

/**
 * POST /api/telegram/auth/password
 * Submits 2FA password if required
 */
telegramRouter.post('/auth/password', async (req: Request, res: Response) => {
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Пароль 2FA обязателен',
      });
    }
    const result = await submitMTProtoWebPassword(password);
    res.status(200).json(result);
  } catch (err) {
    logger.error('Error submitting MTProto 2FA password', err);
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Invalid 2FA password',
    });
  }
});

/**
 * POST /api/telegram/auth/reset
 * Cancels any active authorization state
 */
telegramRouter.post('/auth/reset', async (_req: Request, res: Response) => {
  try {
    cancelMTProtoWebAuth();
    res.status(200).json({ success: true, message: 'Сессия авторизации сброшена' });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to reset auth',
    });
  }
});

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
