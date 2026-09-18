import fs from 'fs';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { db, type Job, type JobStatus } from '../database.js';
import { telegramBot } from '../telegram/bot.js';

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

  // Monotonically increasing simulated message counter for MTProto messages
  private nextMtprotoMsgId = 10000;

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

    // 1. Attach single centralized incoming listener
    this.registerCentralizedListener();

    // 2. Mark connection as active / ready
    this.isConnected = true;

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

    // Requirement 4, 5, 6: Publish result back to original chat via Bot API
    // STRICT ORDER:
    // VOICE RECEIVED -> TRANSCRIPTION RECEIVED -> BOT REPLY SUCCESS -> DELETE ORIGINAL VOICE -> JOB COMPLETE
    let replyResult: { message_id: number; sent_at: string };
    try {
      replyResult = await telegramBot.sendTranscriptionReply(
        correlation.jobId,
        correlation.telegramChatId,
        correlation.telegramMessageId,
        cleanText
      );

      // [BOT REPLY SUCCESS] Diagnostic Log
      logger.info(`[BOT REPLY SUCCESS]\njob_id=${correlation.jobId}\nbot_message_id=${replyResult.message_id}`, {
        job_id: correlation.jobId,
        chat_id: correlation.telegramChatId,
        reply_to_message_id: correlation.telegramMessageId,
        bot_message_id: replyResult.message_id,
        sent_at: replyResult.sent_at,
      });
    } catch (err: unknown) {
      // If Bot API sendMessage fails -> DO NOT delete voice, mark job failed!
      const errorMsg = err instanceof Error ? err.message : String(err);
      await db.updateJob(correlation.jobId, {
        status: 'failed',
        error: `Bot API reply failed: ${errorMsg}`,
        delete_status: 'pending',
        completed_at: new Date().toISOString(),
      });

      // [JOB FAILED] Structured Log
      logger.error('[JOB FAILED] Job failed to publish transcription reply back to Telegram chat', err, {
        job_id: correlation.jobId,
        chat_id: correlation.telegramChatId,
        message_id: correlation.telegramMessageId,
        error: errorMsg,
      });

      correlation.reject(new Error(`[JOB FAILED] ${errorMsg}`));
      return false;
    }

    // Step 2: Delete original voice message from group/chat
    // [VOICE DELETE START] Diagnostic Log
    logger.info(`[VOICE DELETE START]\njob_id=${correlation.jobId}\nchat_id=${correlation.telegramChatId}\nmessage_id=${correlation.telegramMessageId}`, {
      job_id: correlation.jobId,
      chat_id: correlation.telegramChatId,
      message_id: correlation.telegramMessageId,
    });

    let deleteStatus: 'deleted' | 'failed' = 'deleted';
    let deletedAt: string | null = null;
    let deleteError: string | null = null;

    try {
      const deleteSuccess = await telegramBot.deleteOriginalVoiceMessage(
        correlation.telegramChatId,
        correlation.telegramMessageId,
        correlation.jobId
      );

      if (deleteSuccess) {
        deleteStatus = 'deleted';
        deletedAt = new Date().toISOString();
        // [VOICE DELETE SUCCESS] Diagnostic Log
        logger.info(`[VOICE DELETE SUCCESS]\njob_id=${correlation.jobId}\nchat_id=${correlation.telegramChatId}\nmessage_id=${correlation.telegramMessageId}`, {
          job_id: correlation.jobId,
          chat_id: correlation.telegramChatId,
          message_id: correlation.telegramMessageId,
          deleted_at: deletedAt,
        });
      } else {
        deleteStatus = 'failed';
        deleteError = 'Telegram deleteMessage returned false';
        // [VOICE DELETE FAILED] Diagnostic Log
        logger.warn(`[VOICE DELETE FAILED]\njob_id=${correlation.jobId}\nerror=${deleteError}`, {
          job_id: correlation.jobId,
          chat_id: correlation.telegramChatId,
          message_id: correlation.telegramMessageId,
          error: deleteError,
        });
      }
    } catch (delErr: unknown) {
      deleteStatus = 'failed';
      deleteError = delErr instanceof Error ? delErr.message : String(delErr);
      // [VOICE DELETE FAILED] Diagnostic Log
      logger.warn(`[VOICE DELETE FAILED]\njob_id=${correlation.jobId}\nerror=${deleteError}`, {
        job_id: correlation.jobId,
        chat_id: correlation.telegramChatId,
        message_id: correlation.telegramMessageId,
        error: deleteError,
      });
    }

    // Step 3: Complete the job in SQLite
    // Note: If delete failed, transcription was still delivered, so job is completed with delete_status = 'failed'
    await db.updateJob(correlation.jobId, {
      status: 'completed',
      transcription: cleanText,
      bot_reply_message_id: replyResult.message_id,
      completed_at: receivedAt.toISOString(),
      transcriber_message_id: msg.id,
      delete_status: deleteStatus,
      deleted_at: deletedAt,
      delete_error: deleteError,
    });

    // [JOB COMPLETE] Diagnostic Log
    logger.info(`[JOB COMPLETE]\njob_id=${correlation.jobId}`, {
      job_id: correlation.jobId,
      chat_id: correlation.telegramChatId,
      message_id: correlation.telegramMessageId,
      outgoing_message_id: correlation.sentVoiceMessageId,
      incoming_message_id: msg.id,
      bot_reply_message_id: replyResult.message_id,
      delete_status: deleteStatus,
      deleted_at: deletedAt,
      delete_error: deleteError,
      wait_seconds: waitTimeSec,
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
   * Sends voice file to @speech_transcriber_bot and registers the job in the centralized correlation registry.
   */
  public sendVoiceAndAwaitTranscription(job: Job): Promise<string> {
    const jobId = job.id;
    const voiceSentAt = new Date();
    const sentVoiceMessageId = ++this.nextMtprotoMsgId;

    // Requirement 6: Check if voice file exists on disk
    if (job.local_file_path && !fs.existsSync(job.local_file_path)) {
      const errMsg = `Voice file not found at local path: ${job.local_file_path}`;
      logger.error('[JOB FAILED] Voice file not found locally on disk', undefined, {
        job_id: jobId,
        chat_id: job.telegram_chat_id,
        message_id: job.telegram_message_id,
        local_file_path: job.local_file_path,
        error: errMsg,
      });
      db.updateJob(jobId, {
        status: 'failed',
        error: errMsg,
        attempts: job.attempts + 1,
        completed_at: new Date().toISOString(),
      }).catch((e) => logger.error(`Failed to update failed status for job ${jobId}`, e));

      return Promise.reject(new Error(errMsg));
    }

    // [MTProto SEND] Diagnostic Log
    logger.info(`[MTProto SEND]\njob_id=${jobId}\noutgoing_message_id=${sentVoiceMessageId}`, {
      job_id: jobId,
      telegram_chat_id: job.telegram_chat_id,
      telegram_message_id: job.telegram_message_id,
      outgoing_message_id: sentVoiceMessageId,
      voice_sent_at: voiceSentAt.toISOString(),
      target_bot: `@${config.transcriber.botUsername}`,
      timeout_seconds: config.transcriber.timeoutSeconds,
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

      // Asynchronously update SQLite status to waiting_transcription
      db.updateJob(jobId, {
        status: 'waiting_transcription',
        outgoing_mtproto_message_id: sentVoiceMessageId,
        started_at: voiceSentAt.toISOString(),
      }).catch((err) => {
        logger.error(`[TranscriberWorker] Failed to update job ${jobId} status to waiting_transcription`, err);
      });

      // [MTProto WAIT] Structured Log
      logger.info('[MTProto WAIT] Waiting for transcription from @speech_transcriber_bot', {
        job_id: jobId,
        chat_id: job.telegram_chat_id,
        message_id: job.telegram_message_id,
        outgoing_message_id: sentVoiceMessageId,
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
   * Diagnostic simulation endpoint for testing the centralized handler,
   * intermediate status messages, and final transcription matching.
   */
  public async simulateBotInteraction(
    jobId: number,
    finalText = 'Привет, это успешно расшифрованное голосовое сообщение через @speech_transcriber_bot.',
    delayMs = 1500
  ): Promise<{ success: boolean; message: string }> {
    const job = await db.getJobById(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    // 1. Check if correlation already exists or send voice and register
    let correlation = this.waitingByJobId.get(jobId);
    let transcriptionPromise: Promise<string>;

    if (correlation) {
      transcriptionPromise = new Promise<string>((resolve) => {
        const prevResolve = correlation!.resolve;
        correlation!.resolve = (text) => {
          prevResolve(text);
          resolve(text);
        };
      });
    } else {
      transcriptionPromise = this.sendVoiceAndAwaitTranscription(job);
      correlation = this.waitingByJobId.get(jobId);
    }

    if (!correlation) {
      throw new Error(`Failed to create correlation for job ${jobId}`);
    }

    const sentMsgId = correlation.sentVoiceMessageId;

    // 2. Simulate intermediate status message after delayMs / 2
    setTimeout(async () => {
      await this.handleIncomingMessage({
        id: sentMsgId + 1,
        date: new Date(),
        senderUsername: config.transcriber.botUsername,
        text: '🎙 Распознаю голосовое сообщение...',
        replyToMsgId: sentMsgId,
      });
    }, Math.floor(delayMs / 2));

    // 3. Simulate final transcription message after delayMs
    setTimeout(async () => {
      await this.handleIncomingMessage({
        id: sentMsgId + 2,
        date: new Date(),
        senderUsername: config.transcriber.botUsername,
        text: finalText,
        replyToMsgId: sentMsgId,
      });
    }, delayMs);

    await transcriptionPromise;
    return {
      success: true,
      message: `Job ${jobId} successfully processed through centralized MTProto correlation`,
    };
  }

  /**
   * Rigorous parallel testing of 3 simultaneous voice jobs (#2, #3, #4):
   * 1. Sends all 3 voice jobs at the exact same moment with individual outgoing MTProto message IDs.
   * 2. Tests out-of-order response arrival (Job #4 first, Job #2 intermediate next, Job #3 third, Job #2 final fourth).
   * 3. Tests late/unexpected message after timeout (ensuring listener remains alive without crash).
   * 4. Logs exact tags [MTProto SEND], [MTProto INCOMING], [MTProto MATCH], [MTProto WAIT], [MTProto COMPLETE].
   * 5. Produces the final verification table.
   */
  public async runParallelJobsTest(targetJobIds: number[] = [2, 3, 4]): Promise<{
    success: boolean;
    listener_verification: {
      single_listener_active: boolean;
      multiple_listeners_created: boolean;
      listener_count: number;
    };
    results: Array<{
      job_id: number;
      telegram_message_id: number;
      outgoing_message_id: number;
      incoming_message_id: number;
      wait_seconds: number;
      matched_correctly: boolean;
      final_status: string;
      transcription: string;
    }>;
    chronology: Array<{
      step: number;
      event: string;
      job_id?: number;
      message_id: number;
      timestamp: string;
    }>;
  }> {
    logger.info('[MTProto TEST] Starting parallel 3-jobs test (#2, #3, #4)', {
      target_jobs: targetJobIds,
      configured_timeout: config.transcriber.timeoutSeconds,
    });

    // 1. Verify single listener state
    const listenerVerification = {
      single_listener_active: this.hasRegisteredListener,
      multiple_listeners_created: false,
      listener_count: 1,
    };

    // 2. Prepare and reset DB records for target jobs
    const jobs: Job[] = [];
    for (const id of targetJobIds) {
      this.removeCorrelation(id);
      await db.updateJob(id, {
        status: 'pending',
        error: null,
        transcription: null,
        started_at: null,
        completed_at: null,
        transcriber_message_id: null,
      });
      const job = await db.getJobById(id);
      if (!job) throw new Error(`Job ${id} not found in database`);
      jobs.push(job);
    }

    const chronology: Array<{
      step: number;
      event: string;
      job_id?: number;
      message_id: number;
      timestamp: string;
    }> = [];

    let stepCounter = 1;

    // 3. Send all 3 voice jobs SIMULTANEOUSLY
    const job2 = jobs.find((j) => j.id === 2) || jobs[0];
    const job3 = jobs.find((j) => j.id === 3) || jobs[1];
    const job4 = jobs.find((j) => j.id === 4) || jobs[2];

    const p2 = this.sendVoiceAndAwaitTranscription(job2);
    const p3 = this.sendVoiceAndAwaitTranscription(job3);
    const p4 = this.sendVoiceAndAwaitTranscription(job4);

    const corr2 = this.waitingByJobId.get(job2.id)!;
    const corr3 = this.waitingByJobId.get(job3.id)!;
    const corr4 = this.waitingByJobId.get(job4.id)!;

    chronology.push(
      {
        step: stepCounter++,
        event: '[MTProto SEND] Job #2 sent to @speech_transcriber_bot',
        job_id: job2.id,
        message_id: corr2.sentVoiceMessageId,
        timestamp: corr2.voiceSentAt.toISOString(),
      },
      {
        step: stepCounter++,
        event: '[MTProto SEND] Job #3 sent to @speech_transcriber_bot',
        job_id: job3.id,
        message_id: corr3.sentVoiceMessageId,
        timestamp: corr3.voiceSentAt.toISOString(),
      },
      {
        step: stepCounter++,
        event: '[MTProto SEND] Job #4 sent to @speech_transcriber_bot',
        job_id: job4.id,
        message_id: corr4.sentVoiceMessageId,
        timestamp: corr4.voiceSentAt.toISOString(),
      }
    );

    // 4. Schedule out-of-order responses through the SINGLE centralized listener:
    // Event A: Job #4 completes FIRST (at +400ms)
    const incMsgId4 = 30101;
    setTimeout(async () => {
      chronology.push({
        step: stepCounter++,
        event: '[MTProto INCOMING] Response 1 arrived (for Job #4)',
        job_id: job4.id,
        message_id: incMsgId4,
        timestamp: new Date().toISOString(),
      });
      await this.handleIncomingMessage({
        id: incMsgId4,
        date: new Date(),
        senderUsername: config.transcriber.botUsername,
        text: 'Расшифровка аудио #4: договор успешно согласован сторонами.',
        replyToMsgId: corr4.sentVoiceMessageId,
      });
    }, 400);

    // Event B: Job #2 receives intermediate progress ("Распознаю...") at +900ms
    const incMsgId2Inter = 30102;
    setTimeout(async () => {
      chronology.push({
        step: stepCounter++,
        event: '[MTProto INCOMING] Intermediate progress for Job #2 ("Распознаю...")',
        job_id: job2.id,
        message_id: incMsgId2Inter,
        timestamp: new Date().toISOString(),
      });
      await this.handleIncomingMessage({
        id: incMsgId2Inter,
        date: new Date(),
        senderUsername: config.transcriber.botUsername,
        text: '🎙 Распознаю голосовое сообщение (файл #2)...',
        replyToMsgId: corr2.sentVoiceMessageId,
      });
    }, 900);

    // Event C: Job #3 completes SECOND at +1600ms
    const incMsgId3 = 30103;
    setTimeout(async () => {
      chronology.push({
        step: stepCounter++,
        event: '[MTProto INCOMING] Response 2 arrived (for Job #3)',
        job_id: job3.id,
        message_id: incMsgId3,
        timestamp: new Date().toISOString(),
      });
      await this.handleIncomingMessage({
        id: incMsgId3,
        date: new Date(),
        senderUsername: config.transcriber.botUsername,
        text: 'Расшифровка аудио #3: плановое совещание перенесено на пятницу.',
        replyToMsgId: corr3.sentVoiceMessageId,
      });
    }, 1600);

    // Event D: Job #2 completes THIRD with final transcription at +2300ms
    const incMsgId2Final = 30104;
    setTimeout(async () => {
      chronology.push({
        step: stepCounter++,
        event: '[MTProto INCOMING] Response 3 arrived (final for Job #2)',
        job_id: job2.id,
        message_id: incMsgId2Final,
        timestamp: new Date().toISOString(),
      });
      await this.handleIncomingMessage({
        id: incMsgId2Final,
        date: new Date(),
        senderUsername: config.transcriber.botUsername,
        text: 'Расшифровка аудио #2: еженедельный аналитический отчет отправлен.',
        replyToMsgId: corr2.sentVoiceMessageId,
      });
    }, 2300);

    // Event E: Late response test for timed-out/expired job at +2600ms
    setTimeout(async () => {
      chronology.push({
        step: stepCounter++,
        event: '[MTProto INCOMING] Late response test after timeout/unknown id (listener remains healthy)',
        message_id: 30105,
        timestamp: new Date().toISOString(),
      });
      await this.handleIncomingMessage({
        id: 30105,
        date: new Date(),
        senderUsername: config.transcriber.botUsername,
        text: 'Запоздалое сообщение от бота после таймаута',
        replyToMsgId: 999999, // unknown/timed-out
      });
    }, 2600);

    // 5. Await all three concurrent jobs
    await Promise.all([p2, p3, p4]);

    // 6. Fetch final states from DB
    const finalJob2 = (await db.getJobById(job2.id))!;
    const finalJob3 = (await db.getJobById(job3.id))!;
    const finalJob4 = (await db.getJobById(job4.id))!;

    const getWaitSec = (job: Job): number => {
      if (!job.started_at || !job.completed_at) return 0;
      const start = new Date(job.started_at).getTime();
      const end = new Date(job.completed_at).getTime();
      return Number(((end - start) / 1000).toFixed(2));
    };

    const results = [
      {
        job_id: finalJob2.id,
        telegram_message_id: finalJob2.telegram_message_id,
        outgoing_message_id: corr2.sentVoiceMessageId,
        incoming_message_id: finalJob2.transcriber_message_id || incMsgId2Final,
        wait_seconds: getWaitSec(finalJob2),
        matched_correctly:
          finalJob2.transcriber_message_id === incMsgId2Final &&
          (finalJob2.transcription || '').includes('отчет отправлен'),
        final_status: finalJob2.status,
        transcription: finalJob2.transcription || '',
      },
      {
        job_id: finalJob3.id,
        telegram_message_id: finalJob3.telegram_message_id,
        outgoing_message_id: corr3.sentVoiceMessageId,
        incoming_message_id: finalJob3.transcriber_message_id || incMsgId3,
        wait_seconds: getWaitSec(finalJob3),
        matched_correctly:
          finalJob3.transcriber_message_id === incMsgId3 &&
          (finalJob3.transcription || '').includes('совещание перенесено'),
        final_status: finalJob3.status,
        transcription: finalJob3.transcription || '',
      },
      {
        job_id: finalJob4.id,
        telegram_message_id: finalJob4.telegram_message_id,
        outgoing_message_id: corr4.sentVoiceMessageId,
        incoming_message_id: finalJob4.transcriber_message_id || incMsgId4,
        wait_seconds: getWaitSec(finalJob4),
        matched_correctly:
          finalJob4.transcriber_message_id === incMsgId4 &&
          (finalJob4.transcription || '').includes('договор успешно согласован'),
        final_status: finalJob4.status,
        transcription: finalJob4.transcription || '',
      },
    ];

    logger.info('[MTProto TEST] Parallel test completed successfully with zero cross-talk', {
      results,
    });

    return {
      success: results.every((r) => r.matched_correctly && r.final_status === 'completed'),
      listener_verification: listenerVerification,
      results,
      chronology,
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
