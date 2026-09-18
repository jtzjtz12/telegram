import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { db, type Job, type JobStatus } from '../database.js';
import { telegramBot } from '../telegram/bot.js';
import { mtprotoService, type TranscriberBotIncomingMessage } from '../telegram/mtproto.js';

export interface IncomingBotMessage {
  id: number;
  date: Date;
  senderUsername: string;
  senderId?: string | number;
  text: string;
  replyToMsgId?: number;
}

export interface WaitingCorrelation {
  jobId: number;
  sentVoiceMessageId: number;
  voiceSentAt: Date;
  telegramChatId: string;
  telegramMessageId: number;
  timeoutTimer: NodeJS.Timeout;
  statusHistory: Array<{
    timestamp: string;
    messageId: number;
    text: string;
    isIntermediate: boolean;
  }>;
  resolve: (transcription: string) => void;
  reject: (error: Error) => void;
}

export class TranscriberWorkerService {
  private static instance: TranscriberWorkerService;

  // Single persistent client state
  private isRunning = false;
  private isConnected = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private isProcessingQueue = false;

  // Single centralized incoming message listener state
  private hasRegisteredListener = false;

  // Centralized correlation registry
  private waitingBySentMsgId = new Map<number, WaitingCorrelation>();
  private waitingByJobId = new Map<number, WaitingCorrelation>();
  private waitingFifoQueue: WaitingCorrelation[] = [];

  // Completed/timed out job IDs (to detect late responses)
  private recentlyCompletedJobIds = new Map<number, { completedAt: number; reason: string }>();

  private constructor() {
    // Singleton pattern ensures exactly ONE instance exists in the application
  }

  public static getInstance(): TranscriberWorkerService {
    if (!TranscriberWorkerService.instance) {
      TranscriberWorkerService.instance = new TranscriberWorkerService();
    }
    return TranscriberWorkerService.instance;
  }

  /**
   * Initializes the persistent MTProto client and binds the SINGLE centralized update listener.
   * Never creates per-job listeners.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('[TranscriberWorker] Starting centralized MTProto worker service', {
      bot_target: config.transcriber.botUsername,
      timeout_seconds: config.transcriber.timeoutSeconds,
      poll_interval_ms: config.transcriber.pollIntervalMs,
    });

    // 1. Connect MTProto client and ensure centralized bot handler is active
    try {
      const isAuth = await mtprotoService.connect();
      this.isConnected = isAuth;
      if (isAuth) {
        logger.info('[TranscriberWorker] MTProto client connected and authorized');
        await mtprotoService.ensureCentralizedBotHandler();
      } else {
        logger.warn('[TranscriberWorker] MTProto client connected but not authorized yet');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('[TranscriberWorker] Failed to connect MTProto client on start', { error: errMsg });
    }

    // 2. Attach single centralized incoming listener
    this.registerCentralizedListener();

    // 3. Start periodic queue processor
    this.startQueuePolling();
  }

  /**
   * Registers exactly ONE listener for incoming Telegram updates from @speech_transcriber_bot.
   * This guarantees that multiple jobs DO NOT spawn multiple listeners.
   */
  private registerCentralizedListener(): void {
    if (this.hasRegisteredListener) {
      logger.warn('[TranscriberWorker] Centralized listener already registered. Skipping duplicate listener registration.');
      return;
    }

    this.hasRegisteredListener = true;

    // Connect to the centralized MTProto bot message dispatcher
    mtprotoService.addBotMessageListener(async (incoming: TranscriberBotIncomingMessage) => {
      await this.handleIncomingMessage({
        id: incoming.id,
        date: new Date(incoming.date * 1000),
        senderUsername: config.transcriber.botUsername,
        senderId: incoming.senderId,
        text: incoming.text,
        replyToMsgId: incoming.replyToMsgId,
      });
    });

    logger.info('[TranscriberWorker] Single centralized MTProto incoming message handler registered successfully');
  }

  /**
   * Centralized incoming message dispatcher.
   * All updates from @speech_transcriber_bot arrive here and are correlated.
   */
  public async handleIncomingMessage(msg: IncomingBotMessage): Promise<boolean> {
    const receivedAt = new Date();
    const cleanText = (msg.text || '').trim();

    // Verify sender matches configured bot
    const botUser = config.transcriber.botUsername.replace('@', '').toLowerCase();
    const sender = (msg.senderUsername || '').replace('@', '').toLowerCase();
    if (sender && sender !== botUser) {
      // Message is not from speech_transcriber_bot
      return false;
    }

    // Determine message type (intermediate status vs final transcription)
    const isIntermediate = this.isIntermediateStatus(cleanText);
    const responseType = isIntermediate ? 'intermediate_status' : 'final_transcription';

    logger.info(`[MTProto INCOMING] Received update from @${config.transcriber.botUsername}`, {
      incoming_message_id: msg.id,
      sender_username: msg.senderUsername,
      reply_to_msg_id: msg.replyToMsgId || null,
      response_type: responseType,
      text_preview: cleanText.slice(0, 80),
      received_at: receivedAt.toISOString(),
    });

    // 1. Correlation Strategy
    // Strategy A: By reply_to_msg_id (if the bot replied directly to our sent voice message)
    let correlation: WaitingCorrelation | undefined;
    let matchStrategy = 'none';

    if (msg.replyToMsgId && this.waitingBySentMsgId.has(msg.replyToMsgId)) {
      correlation = this.waitingBySentMsgId.get(msg.replyToMsgId);
      matchStrategy = 'reply_to_msg_id';
    }

    // Strategy B: If no reply_to_msg_id, correlate with the oldest job in FIFO queue
    // (Bots in 1-on-1 chats often reply sequentially without the reply_to header)
    if (!correlation && this.waitingFifoQueue.length > 0) {
      correlation = this.waitingFifoQueue[0];
      matchStrategy = 'fifo_queue_order';
    }

    // If no active correlation found, check if this is a late response after timeout
    if (!correlation) {
      const isLateResponse = this.recentlyCompletedJobIds.size > 0;
      logger.warn('[MTProto INCOMING] Received message from @speech_transcriber_bot with no active waiting job (listener healthy, no crash)', {
        received_at: receivedAt.toISOString(),
        incoming_message_id: msg.id,
        reply_to_msg_id: msg.replyToMsgId || null,
        response_type: responseType,
        text_preview: cleanText.slice(0, 80),
        reason: isLateResponse ? 'Late response after timeout or completed job' : 'Unsolicited bot message',
      });
      return false;
    }

    // Calculate elapsed waiting duration
    const waitTimeMs = receivedAt.getTime() - correlation.voiceSentAt.getTime();
    const waitTimeSec = Number((waitTimeMs / 1000).toFixed(2));

    // [MTProto INCOMING] Diagnostic Log
    logger.info(`[MTProto INCOMING]\njob_id=${correlation.jobId}\nincoming_message_id=${msg.id}`, {
      job_id: correlation.jobId,
      incoming_message_id: msg.id,
      outgoing_message_id: correlation.sentVoiceMessageId,
      telegram_message_id: correlation.telegramMessageId,
      match_strategy: matchStrategy,
      wait_time_sec: waitTimeSec,
      response_type: responseType,
    });

    // Record in correlation status history
    correlation.statusHistory.push({
      timestamp: receivedAt.toISOString(),
      messageId: msg.id,
      text: cleanText,
      isIntermediate,
    });

    // 2. Handle based on response type
    if (isIntermediate) {
      // [MTProto WAIT] Diagnostic Log
      logger.info('[MTProto WAIT] Intermediate progress received, job continues waiting', {
        job_id: correlation.jobId,
        outgoing_message_id: correlation.sentVoiceMessageId,
        incoming_message_id: msg.id,
        elapsed_sec: waitTimeSec,
        intermediate_status: cleanText,
        timeout_seconds: config.transcriber.timeoutSeconds,
      });

      await db.updateJob(correlation.jobId, {
        status: 'waiting_transcription',
        transcription: `[Статус @speech_transcriber_bot]: ${cleanText}`,
      });
      return true;
    }

    // 3. Final transcription message received!
    // Clean up correlation timers and registry
    this.removeCorrelation(correlation.jobId);
    this.recentlyCompletedJobIds.set(correlation.jobId, {
      completedAt: Date.now(),
      reason: 'completed',
    });

    // [TRANSCRIPTION RECEIVED] Diagnostic Log
    logger.info(`[TRANSCRIPTION RECEIVED]\njob_id=${correlation.jobId}\ntext=${cleanText}`, {
      job_id: correlation.jobId,
      chat_id: correlation.telegramChatId,
      message_id: correlation.telegramMessageId,
      outgoing_message_id: correlation.sentVoiceMessageId,
      transcriber_message_id: msg.id,
      wait_seconds: waitTimeSec,
      transcription_preview: cleanText.slice(0, 80),
    });

    // Save interim transcription in SQLite
    await db.updateJob(correlation.jobId, {
      transcription: cleanText,
      transcriber_message_id: msg.id,
    });

    // Step 1: Publish result back to original chat via Bot API as a reply
    let replyResult: { message_id: number; sent_at: string };
    try {
      replyResult = await telegramBot.sendTranscriptionReply(
        correlation.jobId,
        correlation.telegramChatId,
        correlation.telegramMessageId,
        cleanText
      );

      // [BOT REPLY SUCCESS] Structured Log
      logger.info(`[BOT REPLY SUCCESS]\njob_id=${correlation.jobId}\nbot_message_id=${replyResult.message_id}`, {
        job_id: correlation.jobId,
        chat_id: correlation.telegramChatId,
        reply_to_message_id: correlation.telegramMessageId,
        outgoing_mtproto_message_id: correlation.sentVoiceMessageId,
        voice_sent_at: correlation.voiceSentAt.toISOString(),
        response_received: true,
        wait_time_seconds: waitTimeSec,
        final_text: cleanText,
        bot_reply_message_id: replyResult.message_id,
        sent_at: replyResult.sent_at,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await db.updateJob(correlation.jobId, {
        status: 'failed',
        error: `Bot API reply failed: ${errorMsg}`,
        completed_at: new Date().toISOString(),
      });

      logger.error('[JOB FAILED] Job failed to publish transcription reply back to Telegram chat', err, {
        job_id: correlation.jobId,
        chat_id: correlation.telegramChatId,
        message_id: correlation.telegramMessageId,
        outgoing_mtproto_message_id: correlation.sentVoiceMessageId,
        error: errorMsg,
      });

      correlation.reject(new Error(`[JOB FAILED] ${errorMsg}`));
      return false;
    }

    // Step 2: Complete the job in SQLite (original voice deletion deferred to subsequent stage per requirement)
    await db.updateJob(correlation.jobId, {
      status: 'completed',
      transcription: cleanText,
      bot_reply_message_id: replyResult.message_id,
      completed_at: receivedAt.toISOString(),
      transcriber_message_id: msg.id,
      delete_status: 'pending',
    });

    // [JOB COMPLETE] Structured Log with all required metrics
    logger.info(`[JOB COMPLETE]\njob_id=${correlation.jobId}`, {
      job_id: correlation.jobId,
      chat_id: correlation.telegramChatId,
      message_id: correlation.telegramMessageId,
      outgoing_mtproto_message_id: correlation.sentVoiceMessageId,
      incoming_message_id: msg.id,
      voice_sent_at: correlation.voiceSentAt.toISOString(),
      response_received: true,
      wait_time_seconds: waitTimeSec,
      final_text: cleanText,
      bot_reply_message_id: replyResult.message_id,
      completed_at: receivedAt.toISOString(),
    });

    correlation.resolve(cleanText);
    return true;
  }

  /**
   * Checks whether the message from @speech_transcriber_bot is an intermediate progress indicator.
   */
  public isIntermediateStatus(text: string): boolean {
    if (!text) return true;
    const lower = text.toLowerCase().trim();

    const intermediatePatterns = [
      'распознаю',
      'обрабатываю',
      'обработка',
      'загрузка',
      'подождите',
      'секунду',
      'processing',
      'transcribing',
      'converting',
      'audio received',
      'working on it',
      '⏳',
      '🎙',
      '...',
    ];

    // If text is short and contains intermediate status keywords
    if (lower.length < 80) {
      for (const pattern of intermediatePatterns) {
        if (lower.includes(pattern)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Sends voice file to @speech_transcriber_bot via live MTProto and registers the job
   * in the centralized correlation registry with the real Telegram outgoing message ID.
   */
  public async sendVoiceAndAwaitTranscription(job: Job): Promise<string> {
    const jobId = job.id;

    // Check if voice file exists on disk
    if (!job.local_file_path || !fs.existsSync(job.local_file_path)) {
      const errMsg = `Voice file not found at local path: ${job.local_file_path || 'null'}`;
      logger.error('[JOB FAILED] Voice file not found locally on disk', undefined, {
        job_id: jobId,
        chat_id: job.telegram_chat_id,
        message_id: job.telegram_message_id,
        local_file_path: job.local_file_path,
        error: errMsg,
      });
      await db.updateJob(jobId, {
        status: 'failed',
        error: errMsg,
        attempts: job.attempts + 1,
        completed_at: new Date().toISOString(),
      });
      throw new Error(errMsg);
    }

    // Check MTProto connection & authorization
    const client = mtprotoService.getClient();
    if (!client.connected) {
      await client.connect();
    }
    const isAuthorized = await client.checkAuthorization();
    if (!isAuthorized) {
      const errMsg = 'MTProto client is not authorized. Please complete authorization via Web UI.';
      logger.error('[JOB FAILED] MTProto client not authorized', undefined, {
        job_id: jobId,
        chat_id: job.telegram_chat_id,
        message_id: job.telegram_message_id,
        error: errMsg,
      });
      await db.updateJob(jobId, {
        status: 'failed',
        error: errMsg,
        attempts: job.attempts + 1,
        completed_at: new Date().toISOString(),
      });
      throw new Error(errMsg);
    }

    // Ensure centralized incoming handler is listening for responses
    await mtprotoService.ensureCentralizedBotHandler();

    const voiceSentAt = new Date();
    logger.info('[MTProto SEND START] Sending real voice file to @speech_transcriber_bot via MTProto', {
      job_id: jobId,
      chat_id: job.telegram_chat_id,
      message_id: job.telegram_message_id,
      local_file_path: job.local_file_path,
      voice_sent_at: voiceSentAt.toISOString(),
      target_bot: `@${config.transcriber.botUsername}`,
    });

    // Real send via MTProto client to @speech_transcriber_bot
    const sentMessage = await mtprotoService.sendAudioToTranscriberBot(job.local_file_path);
    const sentVoiceMessageId = sentMessage.id;

    // [MTProto SEND] Diagnostic Log with REAL outgoing message ID
    logger.info(`[MTProto SEND]\njob_id=${jobId}\noutgoing_message_id=${sentVoiceMessageId}`, {
      job_id: jobId,
      chat_id: job.telegram_chat_id,
      message_id: job.telegram_message_id,
      outgoing_message_id: sentVoiceMessageId,
      voice_sent_at: voiceSentAt.toISOString(),
      target_bot: `@${config.transcriber.botUsername}`,
      timeout_seconds: config.transcriber.timeoutSeconds,
    });

    // Update SQLite status to waiting_transcription with real outgoing MTProto message ID
    await db.updateJob(jobId, {
      status: 'waiting_transcription',
      outgoing_mtproto_message_id: sentVoiceMessageId,
      started_at: voiceSentAt.toISOString(),
    });

    return new Promise<string>((resolve, reject) => {
      // Centralized timeout handler
      const timeoutMs = config.transcriber.timeoutSeconds * 1000;
      const timeoutTimer = setTimeout(async () => {
        this.handleJobTimeout(jobId, sentVoiceMessageId, voiceSentAt, reject);
      }, timeoutMs);

      const correlation: WaitingCorrelation = {
        jobId,
        sentVoiceMessageId,
        voiceSentAt,
        telegramChatId: job.telegram_chat_id,
        telegramMessageId: job.telegram_message_id,
        timeoutTimer,
        statusHistory: [],
        resolve,
        reject,
      };

      // Register in correlation indexes synchronously
      this.waitingBySentMsgId.set(sentVoiceMessageId, correlation);
      this.waitingByJobId.set(jobId, correlation);
      this.waitingFifoQueue.push(correlation);

      // [MTProto WAIT] Structured Log
      logger.info('[MTProto WAIT] Waiting for transcription from @speech_transcriber_bot', {
        job_id: jobId,
        chat_id: job.telegram_chat_id,
        message_id: job.telegram_message_id,
        outgoing_message_id: sentVoiceMessageId,
        voice_sent_at: voiceSentAt.toISOString(),
        timeout_seconds: config.transcriber.timeoutSeconds,
      });
    });
  }

  /**
   * Handles timeout when @speech_transcriber_bot fails to respond within TRANSCRIBER_TIMEOUT_SECONDS.
   */
  private async handleJobTimeout(
    jobId: number,
    sentVoiceMessageId: number,
    voiceSentAt: Date,
    reject: (err: Error) => void
  ): Promise<void> {
    const elapsedMs = Date.now() - voiceSentAt.getTime();
    const timeoutSec = config.transcriber.timeoutSeconds;
    const correlation = this.waitingByJobId.get(jobId);

    // Clean up from correlation registry immediately to prevent state leaks
    this.removeCorrelation(jobId);
    this.recentlyCompletedJobIds.set(jobId, { completedAt: Date.now(), reason: 'timeout' });

    const timeoutErrorMsg = `Telegram MTProto timeout: @${config.transcriber.botUsername} response delay > ${timeoutSec}s`;

    logger.error('[MTProto TIMEOUT] Job timed out waiting for response from @speech_transcriber_bot (centralized listener remains active)', undefined, {
      job_id: jobId,
      outgoing_message_id: sentVoiceMessageId,
      voice_sent_at: voiceSentAt.toISOString(),
      timeout_seconds: timeoutSec,
      elapsed_ms: elapsedMs,
      status_history_entries: correlation ? correlation.statusHistory.length : 0,
      error: timeoutErrorMsg,
    });

    // Mark job failed in SQLite
    const existingJob = await db.getJobById(jobId);
    await db.updateJob(jobId, {
      status: 'failed',
      error: timeoutErrorMsg,
      attempts: (existingJob?.attempts || 0) + 1,
      completed_at: new Date().toISOString(),
    });

    // [JOB FAILED] Structured Log
    logger.error('[JOB FAILED] Job failed due to MTProto response timeout', undefined, {
      job_id: jobId,
      outgoing_message_id: sentVoiceMessageId,
      error: timeoutErrorMsg,
    });

    reject(new Error(timeoutErrorMsg));
  }

  /**
   * Removes correlation from all maps and queues safely.
   */
  private removeCorrelation(jobId: number): void {
    const corr = this.waitingByJobId.get(jobId);
    if (!corr) return;

    clearTimeout(corr.timeoutTimer);
    this.waitingByJobId.delete(jobId);
    this.waitingBySentMsgId.delete(corr.sentVoiceMessageId);

    const qIdx = this.waitingFifoQueue.findIndex((c) => c.jobId === jobId);
    if (qIdx !== -1) {
      this.waitingFifoQueue.splice(qIdx, 1);
    }
  }

  /**
   * Starts periodic polling of the SQLite database for pending jobs.
   */
  private startQueuePolling(): void {
    const intervalMs = config.transcriber.pollIntervalMs || 1000;

    this.pollTimer = setInterval(async () => {
      if (this.isProcessingQueue) return;
      this.isProcessingQueue = true;

      try {
        await this.processPendingQueue();
      } catch (err) {
        logger.error('[TranscriberWorker] Error in queue processing cycle', err);
      } finally {
        this.isProcessingQueue = false;
      }
    }, intervalMs);
  }

  /**
   * Processes pending jobs in the SQLite queue with sequential order
   */
  private async processPendingQueue(): Promise<void> {
    // Only fetch 1 job at a time to prevent concurrency collisions with @speech_transcriber_bot
    if (this.waitingFifoQueue.length > 0) {
      // Already waiting for response from @speech_transcriber_bot
      return;
    }

    const pendingJobs = await db.getRecentJobs(1, 'pending');
    if (pendingJobs.length === 0) return;

    const job = pendingJobs[0];
    if (job.status !== 'pending') return;

    // Requirement 2: Set status to 'processing' before MTProto dispatch
    await db.updateJob(job.id, {
      status: 'processing',
      started_at: new Date().toISOString(),
    });

    logger.info('[JOB PROCESSING] Worker picked up pending voice job', {
      job_id: job.id,
      chat_id: job.telegram_chat_id,
      message_id: job.telegram_message_id,
      local_file_path: job.local_file_path,
      attempts: job.attempts,
    });

    try {
      await this.sendVoiceAndAwaitTranscription(job);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await db.updateJob(job.id, {
        status: 'failed',
        error: errMsg,
        attempts: job.attempts + 1,
        completed_at: new Date().toISOString(),
      });
      logger.error('[JOB FAILED] Worker failed during job processing', err, {
        job_id: job.id,
        chat_id: job.telegram_chat_id,
        message_id: job.telegram_message_id,
      });
    }
  }

  /**
   * Manually dispatches an existing job through the real MTProto pipeline.
   */
  public async processJobNow(jobId: number): Promise<{ success: boolean; message: string }> {
    const job = await db.getJobById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    await db.updateJob(job.id, {
      status: 'processing',
      started_at: new Date().toISOString(),
    });

    // Execute through live MTProto client in background
    this.sendVoiceAndAwaitTranscription(job).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[TranscriberWorker] Job ${jobId} execution failed`, err);
    });

    return {
      success: true,
      message: `Job ${jobId} dispatched to @${config.transcriber.botUsername} via live MTProto client`,
    };
  }

  /**
   * Diagnostic inspection of current worker state
   */
  public getDiagnostics() {
    return {
      running: this.isRunning,
      connected: this.isConnected,
      centralized_listener_active: this.hasRegisteredListener,
      active_waiting_jobs_count: this.waitingFifoQueue.length,
      waiting_jobs: this.waitingFifoQueue.map((c) => ({
        job_id: c.jobId,
        sent_message_id: c.sentVoiceMessageId,
        voice_sent_at: c.voiceSentAt.toISOString(),
        elapsed_sec: Number(((Date.now() - c.voiceSentAt.getTime()) / 1000).toFixed(1)),
        intermediate_messages_received: c.statusHistory.length,
      })),
      configured_timeout_seconds: config.transcriber.timeoutSeconds,
      configured_poll_interval_ms: config.transcriber.pollIntervalMs,
      target_bot: config.transcriber.botUsername,
    };
  }
}

export const transcriberWorker = TranscriberWorkerService.getInstance();
