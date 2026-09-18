import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import type { LogEntry } from './types.js';

class Logger {
  private inMemoryLogs: LogEntry[] = [];
  private maxLogs = 300;
  private logFilePath: string;

  constructor() {
    this.logFilePath = config.logFilePath || path.resolve(process.cwd(), 'logs', 'app.log');
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    try {
      const dir = path.dirname(this.logFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {
      // Ignored if in read-only environment
    }
  }

  private addLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      level,
      message,
      meta,
    };

    this.inMemoryLogs.unshift(entry);
    if (this.inMemoryLogs.length > this.maxLogs) {
      this.inMemoryLogs.pop();
    }

    // Console output
    const time = entry.timestamp.split('T')[1].slice(0, 8);
    const metaStr = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const consoleMsg = `[${time}] [${level.toUpperCase()}] ${message}${metaStr}`;

    switch (level) {
      case 'error':
        console.error(consoleMsg);
        break;
      case 'warn':
        console.warn(consoleMsg);
        break;
      case 'debug':
        if (config.logLevel === 'debug') {
          console.debug(consoleMsg);
        }
        break;
      default:
        console.log(consoleMsg);
    }

    // Append to file if possible
    try {
      this.ensureLogDir();
      fs.appendFileSync(this.logFilePath, JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      // Non-blocking file write failure
    }
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    this.addLog('info', message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    this.addLog('warn', message, meta);
  }

  public error(message: string, err?: unknown, meta?: Record<string, unknown>): void {
    const metaObj = { ...(meta || {}) };
    if (err) {
      if (err instanceof Error) {
        metaObj.error_message = err.message;
        metaObj.error_stack = err.stack;
      } else {
        metaObj.error = String(err);
      }
    }
    this.addLog('error', message, metaObj);
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    this.addLog('debug', message, meta);
  }

  public getRecentLogs(limit = 100, level?: string): LogEntry[] {
    if (level && level !== 'all') {
      return this.inMemoryLogs.filter((l) => l.level === level).slice(0, limit);
    }
    return this.inMemoryLogs.slice(0, limit);
  }

  public getErrorLogs(limit = 50): LogEntry[] {
    return this.inMemoryLogs.filter((l) => l.level === 'error').slice(0, limit);
  }
}

export const logger = new Logger();
