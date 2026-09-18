import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface MTProtoConfig {
  apiId: number;
  apiHash: string;
  userPhone?: string;
  sessionString?: string;
  targetBot: string;
}

export interface TranscriberBotIncomingMessage {
  id: number;
  date: number;
  text: string;
  replyToMsgId?: number;
  senderId?: string;
  raw: Api.Message;
}

export type TranscriberMessageListener = (
  message: TranscriberBotIncomingMessage
) => void | Promise<void>;

export interface AuthCallbacks {
  phoneNumber?: () => Promise<string>;
  phoneCode?: (isCodeViaApp?: boolean) => Promise<string>;
  password?: (hint?: string) => Promise<string>;
  onError?: (err: Error) => void;
}

export interface MTProtoAuthStatus {
  isConfigured: boolean;
  apiId: number;
  hasApiHash: boolean;
  hasPhoneNumber: boolean;
  isAuthorized: boolean;
  hasSession: boolean;
  targetBot: string;
  pendingStep: 'idle' | 'waiting_code' | 'waiting_password';
  isCodeViaApp?: boolean;
}

interface PendingWebAuth {
  phoneNumber: string;
  phoneCodeHash: string;
  isCodeViaApp?: boolean;
  step: 'waiting_code' | 'waiting_password';
  startedAt: number;
}

class MTProtoTelegramService {
  private client: TelegramClient | null = null;
  private session: StringSession | null = null;
  private listeners: Set<TranscriberMessageListener> = new Set();
  private isHandlerRegistered = false;
  private targetBotEntity: Api.TypeUser | null = null;
  private pendingAuth: PendingWebAuth | null = null;

  /**
   * Retrieves active configuration from environment variables / config.
   */
  public getConfig(): MTProtoConfig {
    const rawApiId = process.env.TELEGRAM_API_ID || config.telegram?.apiId;
    const apiId = typeof rawApiId === 'number' ? rawApiId : parseInt(String(rawApiId || '0'), 10);
    const apiHash = process.env.TELEGRAM_API_HASH || config.telegram?.apiHash || '';
    const userPhone = process.env.TELEGRAM_USER_PHONE || config.telegram?.userPhone || '';
    const sessionString =
      process.env.TELEGRAM_SESSION ||
      config.telegram?.session ||
      config.telegram?.sessionString ||
      '';
    const targetBot = config.transcriber.botUsername || 'speech_transcriber_bot';

    return {
      apiId,
      apiHash,
      userPhone,
      sessionString,
      targetBot,
    };
  }

  /**
   * Initializes or returns the current TelegramClient instance.
   */
  public getClient(): TelegramClient {
    if (this.client) {
      return this.client;
    }

    const { apiId, apiHash, sessionString } = this.getConfig();

    if (!apiId || !apiHash) {
      throw new Error(
        'TELEGRAM_API_ID and TELEGRAM_API_HASH must be provided in environment variables'
      );
    }

    this.session = new StringSession(sessionString || '');
    this.client = new TelegramClient(this.session, apiId, apiHash, {
      connectionRetries: 5,
    });

    return this.client;
  }

  /**
   * Connects to Telegram MTProto and initializes event handlers.
   * Returns true if user is already authorized, false otherwise.
   */
  public async connect(): Promise<boolean> {
    const client = this.getClient();

    if (!client.connected) {
      logger.info('Connecting to Telegram MTProto network...');
      await client.connect();
    }

    const isAuthorized = await client.checkAuthorization();

    if (isAuthorized) {
      logger.info('Telegram MTProto client successfully authorized as regular user account');
      await this.ensureCentralizedBotHandler();
    } else {
      logger.warn(
        'Telegram MTProto client connected but not yet authorized. Run user authorization.'
      );
    }

    return isAuthorized;
  }

  /**
   * Saves the current session as a StringSession string.
   */
  public saveSession(): string {
    if (!this.client || !this.session) {
      throw new Error('Telegram client is not initialized');
    }
    const sessionString = this.client.session.save() as unknown as string;
    return sessionString;
  }

  /**
   * Persists the given session string to .env or a custom file.
   */
  public saveSessionToEnvFile(sessionString: string, envPath = '.env'): void {
    const fullPath = path.resolve(process.cwd(), envPath);
    let content = '';

    if (fs.existsSync(fullPath)) {
      content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('TELEGRAM_SESSION=')) {
        content = content.replace(/TELEGRAM_SESSION=.*/g, `TELEGRAM_SESSION=${sessionString}`);
      } else {
        content += `\nTELEGRAM_SESSION=${sessionString}\n`;
      }
    } else {
      content = `TELEGRAM_SESSION=${sessionString}\n`;
    }

    fs.writeFileSync(fullPath, content, 'utf8');
    logger.info(`Saved TELEGRAM_SESSION to ${envPath}`);
  }

  /**
   * Authorizes the user account via GramJS interactive or callback-based flow.
   * Generates and returns a valid StringSession.
   */
  public async authorizeUser(callbacks?: AuthCallbacks): Promise<string> {
    const client = this.getClient();
    const { userPhone } = this.getConfig();

    if (!client.connected) {
      await client.connect();
    }

    // Default console-based interactive prompts if no callbacks supplied
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask = (query: string): Promise<string> =>
      new Promise((resolve) => rl.question(query, resolve));

    try {
      await client.start({
        phoneNumber: async () => {
          if (callbacks?.phoneNumber) return callbacks.phoneNumber();
          if (userPhone) return userPhone;
          return await ask('Enter your phone number (international format, e.g. +1234567890): ');
        },
        password: async (hint?: string) => {
          if (callbacks?.password) return callbacks.password(hint);
          return await ask('Enter your 2FA password (leave empty if not enabled): ');
        },
        phoneCode: async (isCodeViaApp?: boolean) => {
          if (callbacks?.phoneCode) return callbacks.phoneCode(isCodeViaApp);
          return await ask('Enter the login code you received from Telegram: ');
        },
        onError:
          callbacks?.onError ||
          ((err: Error) => {
            logger.error('MTProto authorization error', { error: err.message });
          }),
      });

      const sessionString = this.saveSession();
      logger.info('User authorization successful! StringSession generated.');

      await this.ensureCentralizedBotHandler();
      return sessionString;
    } finally {
      rl.close();
    }
  }

  /**
   * Retrieves current MTProto authentication and connection status for the Web UI.
   */
  public async getAuthStatus(): Promise<MTProtoAuthStatus> {
    const cfg = this.getConfig();
    const isConfigured = Boolean(cfg.apiId && cfg.apiHash);
    let isAuthorized = false;

    if (isConfigured) {
      try {
        const client = this.getClient();
        if (!client.connected) {
          await client.connect();
        }
        isAuthorized = await client.checkAuthorization();
      } catch (err) {
        logger.debug('Auth status check error', { error: String(err) });
      }
    }

    const session = cfg.sessionString || (this.client ? this.saveSession() : '');
    const hasSession = Boolean(session && session.trim().length > 10);

    return {
      isConfigured,
      apiId: cfg.apiId,
      hasApiHash: Boolean(cfg.apiHash),
      hasPhoneNumber: Boolean(this.pendingAuth?.phoneNumber || cfg.userPhone),
      isAuthorized,
      hasSession,
      targetBot: cfg.targetBot,
      pendingStep: this.pendingAuth?.step || (isAuthorized ? 'idle' : 'idle'),
      isCodeViaApp: this.pendingAuth?.isCodeViaApp,
    };
  }

  /**
   * Initiates the Web Auth flow by sending a verification code to the specified or configured phone.
   */
  public async startWebAuth(customPhone?: string): Promise<{
    success: boolean;
    step: 'waiting_code' | 'already_authorized';
    phoneNumberConfigured: boolean;
    phoneNumber?: string;
    isCodeViaApp?: boolean;
    message: string;
  }> {
    const cfg = this.getConfig();
    if (!cfg.apiId || !cfg.apiHash) {
      throw new Error(
        'TELEGRAM_API_ID и TELEGRAM_API_HASH не настроены. Добавьте их в .env'
      );
    }

    const phone = (customPhone || cfg.userPhone || '').trim();
    if (!phone) {
      throw new Error(
        'Номер телефона не указан. Введите номер в международном формате (например, +380951456705).'
      );
    }

    const client = this.getClient();
    if (!client.connected) {
      await client.connect();
    }

    const isAlreadyAuth = await client.checkAuthorization();
    if (isAlreadyAuth) {
      const sessionString = this.saveSession();
      this.saveSessionToEnvFile(sessionString);
      process.env.TELEGRAM_SESSION = sessionString;
      if (config.telegram) {
        config.telegram.session = sessionString;
      }
      return {
        success: true,
        step: 'already_authorized',
        phoneNumberConfigured: true,
        message: 'Telegram MTProto клиент уже авторизован.',
      };
    }

    logger.info('Sending Telegram MTProto login code to user account...');
    const sendResult = await client.sendCode(
      {
        apiId: cfg.apiId,
        apiHash: cfg.apiHash,
      },
      phone
    );

    const isCodeViaApp = Boolean(sendResult.isCodeViaApp);

    this.pendingAuth = {
      phoneNumber: phone,
      phoneCodeHash: sendResult.phoneCodeHash,
      isCodeViaApp,
      step: 'waiting_code',
      startedAt: Date.now(),
    };

    const channelText = isCodeViaApp ? 'в приложение Telegram' : 'по SMS';

    return {
      success: true,
      step: 'waiting_code',
      phoneNumberConfigured: true,
      isCodeViaApp,
      message: `Код подтверждения отправлен ${channelText}. Введите полученный код ниже.`,
    };
  }

  /**
   * Submits the confirmation code received from Telegram.
   */
  public async submitWebCode(code: string): Promise<{
    success: boolean;
    step: 'completed' | 'waiting_password';
    sessionString?: string;
    message: string;
  }> {
    if (!this.pendingAuth || !this.pendingAuth.phoneCodeHash) {
      throw new Error('Сессия авторизации не найдена. Пожалуйста, сначала нажмите «Начать авторизацию».');
    }

    const cleanCode = code.trim();
    if (!cleanCode) {
      throw new Error('Введите полученный код подтверждения из Telegram');
    }

    const client = this.getClient();

    try {
      logger.info('Submitting Telegram login code via MTProto SignIn...');
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: this.pendingAuth.phoneNumber,
          phoneCodeHash: this.pendingAuth.phoneCodeHash,
          phoneCode: cleanCode,
        })
      );

      logger.info('Telegram MTProto SignIn successful!');
      const sessionString = this.saveSession();
      this.saveSessionToEnvFile(sessionString);
      process.env.TELEGRAM_SESSION = sessionString;
      if (config.telegram) {
        config.telegram.session = sessionString;
      }

      this.pendingAuth = null;
      await this.ensureCentralizedBotHandler();

      return {
        success: true,
        step: 'completed',
        sessionString,
        message: 'MTProto клиент успешно авторизован! StringSession сохранён в TELEGRAM_SESSION.',
      };
    } catch (err: unknown) {
      const errorObj = err as { errorMessage?: string; message?: string };
      const errorMessage = errorObj?.errorMessage || errorObj?.message || '';

      logger.warn('Error during Telegram MTProto SignIn', { errorMessage });

      if (errorMessage === 'SESSION_PASSWORD_NEEDED') {
        if (this.pendingAuth) {
          this.pendingAuth.step = 'waiting_password';
        }
        return {
          success: true,
          step: 'waiting_password',
          message: 'Аккаунт защищён паролем двухфакторной аутентификации (2FA). Пожалуйста, введите ваш 2FA-пароль.',
        };
      }

      if (errorMessage === 'PHONE_CODE_INVALID') {
        throw new Error('Введён неверный код подтверждения. Проверьте код и попробуйте снова.');
      }
      if (errorMessage === 'PHONE_CODE_EXPIRED') {
        this.pendingAuth = null;
        throw new Error('Срок действия кода подтверждения истёк. Нажмите «Начать авторизацию» снова.');
      }

      throw new Error(errorMessage || 'Ошибка подтверждения кода Telegram');
    }
  }

  /**
   * Submits the 2FA password if required.
   */
  public async submitWebPassword(password: string): Promise<{
    success: boolean;
    step: 'completed';
    sessionString: string;
    message: string;
  }> {
    if (!this.pendingAuth || this.pendingAuth.step !== 'waiting_password') {
      throw new Error('Ввод 2FA-пароля сейчас не требуется.');
    }

    if (!password) {
      throw new Error('Введите ваш пароль двухфакторной аутентификации (2FA)');
    }

    const client = this.getClient();
    const cfg = this.getConfig();

    try {
      logger.info('Submitting Telegram 2FA password via MTProto...');
      await client.signInWithPassword(
        {
          apiId: cfg.apiId,
          apiHash: cfg.apiHash,
        },
        {
          password: async () => password,
          onError: (err: Error) => {
            logger.warn('GramJS 2FA error', { err: err.message });
          },
        }
      );

      logger.info('Telegram MTProto 2FA authentication successful!');
      const sessionString = this.saveSession();
      this.saveSessionToEnvFile(sessionString);
      process.env.TELEGRAM_SESSION = sessionString;
      if (config.telegram) {
        config.telegram.session = sessionString;
      }

      this.pendingAuth = null;
      await this.ensureCentralizedBotHandler();

      return {
        success: true,
        step: 'completed',
        sessionString,
        message: '2FA-пароль подтверждён! MTProto клиент успешно авторизован, StringSession сохранён в TELEGRAM_SESSION.',
      };
    } catch (err: unknown) {
      const errorObj = err as { errorMessage?: string; message?: string };
      const errorMessage = errorObj?.errorMessage || errorObj?.message || '';

      logger.error('Error verifying 2FA password', { errorMessage });

      if (errorMessage === 'PASSWORD_HASH_INVALID') {
        throw new Error('Неверный пароль двухфакторной аутентификации (2FA). Попробуйте снова.');
      }

      throw new Error(errorMessage || 'Ошибка проверки 2FA-пароля');
    }
  }

  /**
   * Resets active Web Auth state.
   */
  public cancelWebAuth(): void {
    this.pendingAuth = null;
  }

  /**
   * Centralized incoming message handler for @speech_transcriber_bot.
   * Listens for incoming responses from the bot, normalizes them, and notifies subscribers.
   */
  public async ensureCentralizedBotHandler(): Promise<void> {
    if (this.isHandlerRegistered || !this.client) {
      return;
    }

    const { targetBot } = this.getConfig();
    const cleanBotUsername = targetBot.replace(/^@/, '').toLowerCase();

    // Cache target bot entity proactively if possible
    try {
      const entity = await this.client.getEntity(cleanBotUsername);
      if (entity && 'id' in entity) {
        this.targetBotEntity = entity as Api.TypeUser;
      }
    } catch {
      // Ignore entity lookup errors during initialization
    }

    // Register centralized NewMessage event handler
    this.client.addEventHandler(async (event: NewMessageEvent) => {
      const message = event.message;
      if (!message || message.out) return;

      try {
        const targetBotId = this.targetBotEntity && 'id' in this.targetBotEntity ? String(this.targetBotEntity.id) : null;
        const msgSenderId = message.senderId ? String(message.senderId) : null;
        const msgPeerId = message.peerId && 'userId' in message.peerId ? String((message.peerId as unknown as { userId: unknown }).userId) : null;

        let isFromTargetBot = false;
        if (targetBotId && (msgSenderId === targetBotId || msgPeerId === targetBotId)) {
          isFromTargetBot = true;
        } else {
          // Resolve sender fallback
          const sender = await message.getSender().catch(() => null);
          if (sender && 'username' in sender && sender.username?.toLowerCase() === cleanBotUsername) {
            isFromTargetBot = true;
            if (!this.targetBotEntity && 'id' in sender) {
              this.targetBotEntity = sender as Api.TypeUser;
            }
          } else if (sender && 'id' in sender && targetBotId && String(sender.id) === targetBotId) {
            isFromTargetBot = true;
          }
        }

        if (!isFromTargetBot) {
          return;
        }

        const normalized: TranscriberBotIncomingMessage = {
          id: message.id,
          date: message.date,
          text: message.text || message.message || '',
          replyToMsgId: message.replyTo?.replyToMsgId,
          senderId: msgSenderId || (targetBotId || undefined),
          raw: message,
        };

        logger.info('Received incoming response from @' + cleanBotUsername, {
          messageId: normalized.id,
          replyToMsgId: normalized.replyToMsgId,
          textLength: normalized.text.length,
          preview: normalized.text.slice(0, 100),
        });

        // Dispatch to all registered listeners
        for (const listener of this.listeners) {
          try {
            await listener(normalized);
          } catch (listenerError) {
            logger.error('Error in transcriber message listener', {
              error: listenerError instanceof Error ? listenerError.message : String(listenerError),
            });
          }
        }
      } catch (err) {
        logger.error('Error handling incoming bot message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, new NewMessage({ incoming: true }));

    this.isHandlerRegistered = true;
    logger.info(`Centralized MTProto message handler active for @${cleanBotUsername}`);
  }

  /**
   * Registers a listener for messages from @speech_transcriber_bot.
   * Returns an unsubscribe function.
   */
  public addBotMessageListener(listener: TranscriberMessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Sends a local audio file as a voice message to @speech_transcriber_bot.
   *
   * @param localFilePath Path to the audio file on the local filesystem.
   * @param caption Optional text caption.
   * @returns Sent message object with message ID.
   */
  public async sendAudioToTranscriberBot(
    localFilePath: string,
    caption?: string
  ): Promise<Api.Message> {
    const client = this.getClient();
    const { targetBot } = this.getConfig();

    if (!fs.existsSync(localFilePath)) {
      throw new Error(`Audio file not found at path: ${localFilePath}`);
    }

    const stat = fs.statSync(localFilePath);
    if (stat.size === 0) {
      throw new Error(`Audio file at ${localFilePath} is empty (0 bytes)`);
    }

    if (!client.connected) {
      await client.connect();
    }

    const isAuthorized = await client.checkAuthorization();
    if (!isAuthorized) {
      throw new Error('Cannot send audio file: MTProto user account is not authorized');
    }

    const cleanBotUsername = targetBot.replace(/^@/, '');
    logger.info(`Sending voice file to @${cleanBotUsername} via MTProto`, {
      filePath: localFilePath,
      fileSizeBytes: stat.size,
    });

    const target = this.targetBotEntity || cleanBotUsername;
    const sentMessage = await client.sendFile(target, {
      file: localFilePath,
      voiceNote: true,
      caption: caption || undefined,
    });

    logger.info(`Voice file sent successfully to @${cleanBotUsername}`, {
      sentMessageId: sentMessage.id,
      date: sentMessage.date,
    });

    return sentMessage;
  }

  /**
   * Disconnects the TelegramClient cleanly.
   */
  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
      this.isHandlerRegistered = false;
      logger.info('MTProto client disconnected');
    }
  }
}

// Export singleton instance and helper functions
export const mtprotoService = new MTProtoTelegramService();

export const connectMTProto = () => mtprotoService.connect();
export const authorizeMTProtoUser = (callbacks?: AuthCallbacks) =>
  mtprotoService.authorizeUser(callbacks);
export const saveMTProtoSession = () => mtprotoService.saveSession();
export const getMTProtoAuthStatus = () => mtprotoService.getAuthStatus();
export const startMTProtoWebAuth = (phone?: string) => mtprotoService.startWebAuth(phone);
export const submitMTProtoWebCode = (code: string) => mtprotoService.submitWebCode(code);
export const submitMTProtoWebPassword = (password: string) =>
  mtprotoService.submitWebPassword(password);
export const cancelMTProtoWebAuth = () => mtprotoService.cancelWebAuth();
export const sendAudioToTranscriberBot = (localFilePath: string, caption?: string) =>
  mtprotoService.sendAudioToTranscriberBot(localFilePath, caption);
export const addTranscriberMessageListener = (listener: TranscriberMessageListener) =>
  mtprotoService.addBotMessageListener(listener);
