import fs from 'fs';
import path from 'path';
import { config } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: string;
  stack?: string;
}

class Logger {
  private logDir: string;
  private logFile: string;
  private recentLogs: LogEntry[] = [];
  private maxInMemoryLogs = 200;
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor() {
    this.logFile = path.resolve(process.cwd(), config.logFilePath);
    this.logDir = path.dirname(this.logFile);
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (err) {
      console.error('[Logger] Failed to create log directory:', err);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const configuredLevel = config.logLevel || 'info';
    return this.levels[level] >= (this.levels[configuredLevel] ?? 1);
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>, err?: unknown): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (meta && Object.keys(meta).length > 0) {
      entry.context = meta;
    }

    if (err instanceof Error) {
      entry.error = err.message;
      entry.stack = err.stack;
    } else if (err) {
      entry.error = String(err);
    }

    // Keep in-memory for admin UI status & error monitoring
    this.recentLogs.unshift(entry);
    if (this.recentLogs.length > this.maxInMemoryLogs) {
      this.recentLogs.pop();
    }

    // Structured JSON line for file logging
    const jsonLine = JSON.stringify(entry);

    // Append to file asynchronously
    try {
      fs.appendFile(this.logFile, jsonLine + '\n', (fsErr) => {
        if (fsErr) {
          console.error('[Logger] File write error:', fsErr);
        }
      });
    } catch (fsErr) {
      console.error('[Logger] File append error:', fsErr);
    }

    // Console output for developer visibility
    const prefix = `[${entry.timestamp}] [${level.toUpperCase()}]`;
    const metaStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const errStr = entry.error ? ` | Error: ${entry.error}` : '';

    if (level === 'error') {
      console.error(`${prefix} ${message}${metaStr}${errStr}`);
      if (entry.stack) console.error(entry.stack);
    } else if (level === 'warn') {
      console.warn(`${prefix} ${message}${metaStr}${errStr}`);
    } else if (level === 'debug') {
      console.debug(`${prefix} ${message}${metaStr}`);
    } else {
      console.log(`${prefix} ${message}${metaStr}`);
    }
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>, err?: unknown): void {
    this.write('warn', message, meta, err);
  }

  public error(message: string, err?: unknown, meta?: Record<string, unknown>): void {
    this.write('error', message, meta, err);
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  public getRecentLogs(limit = 50, level?: LogLevel): LogEntry[] {
    let list = this.recentLogs;
    if (level) {
      list = list.filter((l) => l.level === level);
    }
    return list.slice(0, limit);
  }

  public getErrorLogs(limit = 30): LogEntry[] {
    return this.recentLogs.filter((l) => l.level === 'error').slice(0, limit);
  }
}

export const logger = new Logger();
