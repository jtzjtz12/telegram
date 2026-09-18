import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  databasePath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logFilePath: string;
  adminUsername: string;
  adminPassword?: string;
  transcriber: {
    botUsername: string;
    timeoutSeconds: number;
    pollIntervalMs: number;
  };
  telegram?: {
    botToken?: string;
    apiId?: number;
    apiHash?: string;
    userPhone?: string;
    session?: string;
    sessionString?: string;
  };
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  databasePath: process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'transcriber.db'),
  logLevel: (process.env.LOG_LEVEL as AppConfig['logLevel']) || 'info',
  logFilePath: process.env.LOG_FILE_PATH || path.resolve(process.cwd(), 'logs', 'app.log'),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || undefined,
  transcriber: {
    botUsername: process.env.TRANSCRIBER_BOT_USERNAME || 'speech_transcriber_bot',
    timeoutSeconds: parseInt(process.env.TRANSCRIBER_TIMEOUT_SECONDS || '180', 10),
    pollIntervalMs: parseInt(process.env.TRANSCRIBER_POLL_INTERVAL_MS || '1000', 10),
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    apiId: process.env.TELEGRAM_API_ID ? parseInt(process.env.TELEGRAM_API_ID, 10) : undefined,
    apiHash: process.env.TELEGRAM_API_HASH,
    userPhone: process.env.TELEGRAM_USER_PHONE,
    session: process.env.TELEGRAM_SESSION || process.env.TELEGRAM_SESSION_STRING,
  },
};
