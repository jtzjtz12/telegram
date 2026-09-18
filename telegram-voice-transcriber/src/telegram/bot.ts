import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { db, type Job } from '../database.js';

export interface TelegramVoiceMessage {
  message_id: number;
  from?: {
    id: number | string;
    first_name?: string;
    username?: string;
  };
  chat: {
    id: number | string;
    type?: string;
    title?: string;
    username?: string;
  };
  date: number;
  voice: {
    file_id: string;
    file_unique_id?: string;
    duration: number;
    mime_type?: string;
    file_size?: number;
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number | string;
      first_name?: string;
      username?: string;
    };
    chat: {
      id: number | string;
      type?: string;
      title?: string;
      username?: string;
    };
    date: number;
    voice?: {
      file_id: string;
      file_unique_id?: string;
      duration: number;
      mime_type?: string;
      file_size?: number;
    };
    text?: string;
  };
}

class TelegramBotService {
  private botToken?: string;
  private downloadsDir: string;

  constructor() {
    this.botToken = config.telegram?.botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.downloadsDir = path.resolve(process.cwd(), 'data', 'downloads');
    this.ensureDownloadsDir();
  }

  private ensureDownloadsDir(): void {
    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir, { recursive: true });
    }
  }

  /**
   * Process incoming Telegram webhook update
   */
  public async handleWebhookUpdate(update: TelegramUpdate): Promise<{
    processed: boolean;
    job?: Job;
    reason?: string;
  }> {
    if (!update.message) {
      return { processed: false, reason: 'No message in update' };
    }

    const msg = update.message;
    if (!msg.voice) {
      return { processed: false, reason: 'Message does not contain voice audio' };
    }

    const voiceMsg: TelegramVoiceMessage = {
      message_id: msg.message_id,
      from: msg.from,
      chat: msg.chat,
      date: msg.date,
      voice: msg.voice,
    };

    const job = await this.receiveVoiceMessage(voiceMsg);
    return { processed: true, job };
  }

  /**
   * Requirement 1: Ingest voice message from Telegram Bot API
   * - Extract metadata: chat_id, message_id, sender user_id, file_id, duration, mime_type, file_size, date
   * - Check duplicate in SQLite (chat_id, message_id)
   * - Download voice file locally
   * - Create SQLite job with status 'pending'
   */
  public async receiveVoiceMessage(msg: TelegramVoiceMessage): Promise<Job> {
    const chatId = String(msg.chat.id);
    const messageId = msg.message_id;
    const senderUserId = String(msg.from?.id || 'unknown');
    const fileId = msg.voice.file_id;
    const duration = msg.voice.duration;
    const mimeType = msg.voice.mime_type || 'audio/ogg';
    const fileSize = msg.voice.file_size || 0;
    const messageDate = new Date(msg.date * 1000).toISOString();

    // Requirement 8: Duplicate protection
    const existingJob = await db.getJobByTelegramMessage(chatId, messageId);
    if (existingJob) {
      logger.warn('[DUPLICATE PREVENTED] Duplicate Telegram voice message ignored', {
        job_id: existingJob.id,
        chat_id: chatId,
        message_id: messageId,
        existing_status: existingJob.status,
      });
      return existingJob;
    }

    logger.info('[JOB CREATED] New voice message received from Telegram', {
      chat_id: chatId,
      message_id: messageId,
      sender_user_id: senderUserId,
      file_id: fileId,
      duration,
      mime_type: mimeType,
      file_size: fileSize,
      message_date: messageDate,
    });

    // Download voice file locally
    const sanitizedChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const localFileName = `voice_${sanitizedChatId}_${messageId}.ogg`;
    const localFilePath = path.join(this.downloadsDir, localFileName);

    await this.downloadVoiceFile(fileId, localFilePath, chatId, messageId);

    // Save job into SQLite with status 'pending'
    const job = await db.createJob({
      telegram_chat_id: chatId,
      telegram_message_id: messageId,
      sender_user_id: senderUserId,
      original_file_id: fileId,
      local_file_path: localFilePath,
      status: 'pending',
    });

    // [JOB CREATED] Diagnostic Log
    logger.info(`[JOB CREATED]\njob_id=${job.id}\nchat_id=${chatId}\nmessage_id=${messageId}`, {
      job_id: job.id,
      chat_id: chatId,
      message_id: messageId,
      local_file_path: localFilePath,
      created_at: job.created_at,
    });

    return job;
  }

  /**
   * Download voice file from Telegram servers or save local audio buffer
   */
  public async downloadVoiceFile(
    fileId: string,
    targetFilePath: string,
    chatId: string,
    messageId: number
  ): Promise<string> {
    const startTime = Date.now();
    logger.info('[VOICE DOWNLOAD] Initiating voice file download', {
      chat_id: chatId,
      message_id: messageId,
      file_id: fileId,
      target_path: targetFilePath,
    });

    this.ensureDownloadsDir();

    if (this.botToken) {
      try {
        // Step 1: Telegram Bot API getFile
        const getFileUrl = `https://api.telegram.org/bot${this.botToken}/getFile?file_id=${fileId}`;
        const getFileRes = await fetch(getFileUrl);
        const getFileData = (await getFileRes.json()) as {
          ok: boolean;
          description?: string;
          result?: { file_path?: string };
        };

        if (!getFileData.ok || !getFileData.result?.file_path) {
          throw new Error(
            `Telegram getFile error: ${getFileData.description || 'file_path not returned'}`
          );
        }

        // Step 2: Download raw binary file
        const downloadUrl = `https://api.telegram.org/file/bot${this.botToken}/${getFileData.result.file_path}`;
        const fileRes = await fetch(downloadUrl);
        if (!fileRes.ok) {
          throw new Error(`Failed to download voice binary: HTTP ${fileRes.status}`);
        }

        const arrayBuffer = await fileRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(targetFilePath, buffer);

        const durationMs = Date.now() - startTime;
        // [VOICE DOWNLOAD] Diagnostic Log
        logger.info(`[VOICE DOWNLOAD]\nlocal_file=${targetFilePath}`, {
          chat_id: chatId,
          message_id: messageId,
          target_path: targetFilePath,
          bytes: buffer.length,
          download_time_ms: durationMs,
        });

        return targetFilePath;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error('[VOICE DOWNLOAD] Failed to download voice file from Telegram', err, {
          chat_id: chatId,
          message_id: messageId,
          file_id: fileId,
        });
        throw new Error(`[VOICE DOWNLOAD] ${errorMsg}`);
      }
    } else {
      // Local/Test environment without active token: write a valid Ogg Opus stub header
      const oggStubHeader = Buffer.from([
        0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x78, 0x56, 0x34, 0x12, 0x00, 0x00, 0x00, 0x00, 0x11, 0x22, 0x33, 0x44, 0x01, 0x13,
        0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x01, 0x38, 0x01, 0x80, 0xbb,
        0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      fs.writeFileSync(targetFilePath, oggStubHeader);

      const durationMs = Date.now() - startTime;
      // [VOICE DOWNLOAD] Diagnostic Log
      logger.info(`[VOICE DOWNLOAD]\nlocal_file=${targetFilePath}`, {
        chat_id: chatId,
        message_id: messageId,
        target_path: targetFilePath,
        bytes: oggStubHeader.length,
        download_time_ms: durationMs,
      });

      return targetFilePath;
    }
  }

  /**
   * Requirement 4 & 5: Publish transcription result back to the original Telegram chat
   * Message format: "Расшифровка аудио #JOB_ID: TEXT"
   * Sent as a reply to the original voice message (reply_parameters & reply_to_message_id)
   */
  public async sendTranscriptionReply(
    jobId: number,
    chatId: string,
    originalMessageId: number,
    transcriptionText: string
  ): Promise<{ message_id: number; sent_at: string }> {
    const formattedText = `Расшифровка аудио #${jobId}: ${transcriptionText}`;
    const sentAt = new Date().toISOString();

    logger.info('[BOT REPLY] Sending transcription reply back to original Telegram chat', {
      job_id: jobId,
      chat_id: chatId,
      reply_to_message_id: originalMessageId,
      text_length: formattedText.length,
      text_preview: formattedText.slice(0, 80),
    });

    if (this.botToken) {
      try {
        const sendMessageUrl = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
        const payload = {
          chat_id: chatId,
          text: formattedText,
          reply_parameters: {
            message_id: originalMessageId,
          },
          reply_to_message_id: originalMessageId,
        };

        const res = await fetch(sendMessageUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = (await res.json()) as {
          ok: boolean;
          description?: string;
          result?: { message_id: number };
        };

        if (!data.ok || !data.result) {
          throw new Error(
            `Telegram Bot API sendMessage failed: ${data.description || 'Unknown error'}`
          );
        }

        const botReplyMsgId = data.result.message_id;
        // [BOT REPLY] Diagnostic Log
        logger.info(`[BOT REPLY]\njob_id=${jobId}\nchat_id=${chatId}\nreply_to_message_id=${originalMessageId}\nbot_message_id=${botReplyMsgId}`, {
          job_id: jobId,
          chat_id: chatId,
          reply_to_message_id: originalMessageId,
          bot_message_id: botReplyMsgId,
          sent_at: sentAt,
        });

        return { message_id: botReplyMsgId, sent_at: sentAt };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error('[BOT REPLY] Failed to send reply to Telegram chat', err, {
          job_id: jobId,
          chat_id: chatId,
          reply_to_message_id: originalMessageId,
        });
        throw new Error(`[BOT REPLY] ${errorMsg}`);
      }
    } else {
      // Test mode / no token configured
      const simulatedReplyMsgId = 50000 + jobId;
      // [BOT REPLY] Diagnostic Log
      logger.info(`[BOT REPLY]\njob_id=${jobId}\nchat_id=${chatId}\nreply_to_message_id=${originalMessageId}\nbot_message_id=${simulatedReplyMsgId}`, {
        job_id: jobId,
        chat_id: chatId,
        reply_to_message_id: originalMessageId,
        bot_message_id: simulatedReplyMsgId,
        sent_at: sentAt,
      });

      return { message_id: simulatedReplyMsgId, sent_at: sentAt };
    }
  }

  /**
   * Delete the original voice message from the chat using Telegram Bot API deleteMessage.
   * STRICT ORDER MANDATE: Must only be called after sendTranscriptionReply succeeds.
   * Never prints bot tokens or credentials in logs.
   */
  public async deleteOriginalVoiceMessage(
    chatId: string,
    messageId: number,
    jobId?: number
  ): Promise<boolean> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (botToken && botToken.trim().length > 0) {
      try {
        const deleteUrl = `https://api.telegram.org/bot${botToken.trim()}/deleteMessage`;
        const res = await fetch(deleteUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
          }),
        });

        const data = (await res.json()) as {
          ok: boolean;
          result?: boolean;
          description?: string;
          error_code?: number;
        };

        if (!data.ok) {
          throw new Error(
            `Telegram Bot API deleteMessage failed (${data.error_code || 400}): ${data.description || 'Unknown error'}`
          );
        }

        return true;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        throw new Error(errorMsg);
      }
    } else {
      // Test / simulation mode: successfully simulated deletion
      return true;
    }
  }
}

export const telegramBot = new TelegramBotService();
