import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { LOG_DIR } from './constants.js';

const MAX_LOG_FILES = 30;

function cleanupOldLogs(): void {
  try {
    const files = readdirSync(LOG_DIR)
      .filter((file) => file.startsWith('bridge-') && file.endsWith('.log'))
      .sort();

    while (files.length > MAX_LOG_FILES) {
      const file = files.shift();
      if (file) {
        unlinkSync(join(LOG_DIR, file));
      }
    }
  } catch {
    // Ignore cleanup failures.
  }
}

function ensureLogDir(): void {
  mkdirSync(LOG_DIR, { recursive: true });
  cleanupOldLogs();
}

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(LOG_DIR, `bridge-${date}.log`);
}

export function redact(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (!raw) {
    return '';
  }

  return raw
    .replace(/Bearer\s+[^\s"\\]+/gi, 'Bearer ***')
    .replace(
      /"(?:(?:[\w]+_)?token|secret|password|api_key)"\s*:\s*"[^"]*"/gi,
      (match) => {
        const key = match.match(/"[^"]*"/)?.[0] ?? '"value"';
        return `${key}: "***"`;
      },
    );
}

function writeLogLine(level: string, message: string, data?: unknown): void {
  ensureLogDir();
  const line = [
    new Date().toISOString(),
    level,
    message,
    data === undefined ? '' : redact(data),
  ]
    .filter(Boolean)
    .join(' ');
  appendFileSync(getLogFilePath(), `${line}\n`, 'utf8');
}

export const logger = {
  debug(message: string, data?: unknown): void {
    writeLogLine('DEBUG', message, data);
  },
  info(message: string, data?: unknown): void {
    writeLogLine('INFO', message, data);
  },
  warn(message: string, data?: unknown): void {
    writeLogLine('WARN', message, data);
  },
  error(message: string, data?: unknown): void {
    writeLogLine('ERROR', message, data);
  },
} as const;
