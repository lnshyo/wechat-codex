import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { sameWorkspacePath } from './workspace-path.js';

export interface TranscriptSyncEvent {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export interface LocalCodexSessionRef {
  sessionId: string;
  transcriptPath: string;
  cwd?: string;
  startedAt?: string;
}

function resolveCodexHome(codexHome?: string): string {
  if (codexHome) {
    return codexHome;
  }

  if (process.env.CODEX_HOME) {
    return process.env.CODEX_HOME;
  }

  return join(process.env.USERPROFILE || process.env.HOME || '', '.codex');
}

function collectTranscriptFiles(root: string): string[] {
  const paths: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);

    if (entry.isDirectory()) {
      paths.push(...collectTranscriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      paths.push(fullPath);
    }
  }

  return paths;
}

function readSessionMeta(path: string): LocalCodexSessionRef | undefined {
  const firstLine = readFileSync(path, 'utf8').split(/\r?\n/, 1)[0];
  if (!firstLine) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(firstLine) as {
      timestamp?: string;
      type?: string;
      payload?: { id?: string; cwd?: string; timestamp?: string };
    };

    if (parsed.type !== 'session_meta' || !parsed.payload?.id) {
      return undefined;
    }

    return {
      sessionId: parsed.payload.id,
      transcriptPath: path,
      cwd: parsed.payload.cwd,
      startedAt: parsed.payload.timestamp || parsed.timestamp,
    };
  } catch {
    return undefined;
  }
}

export async function findLatestCodexSessionForCwd(options?: {
  codexHome?: string;
  cwd?: string;
}): Promise<LocalCodexSessionRef | undefined> {
  const sessionsRoot = join(resolveCodexHome(options?.codexHome), 'sessions');

  try {
    const sessions = collectTranscriptFiles(sessionsRoot)
      .map((path) => {
        const meta = readSessionMeta(path);
        if (!meta) {
          return undefined;
        }

        return {
          meta,
          modifiedAtMs: statSync(path).mtimeMs,
        };
      })
      .filter((entry): entry is { meta: LocalCodexSessionRef; modifiedAtMs: number } => Boolean(entry))
      .sort((left, right) => {
        const leftStartedAt = left.meta.startedAt ? Date.parse(left.meta.startedAt) : Number.NaN;
        const rightStartedAt = right.meta.startedAt ? Date.parse(right.meta.startedAt) : Number.NaN;

        if (Number.isFinite(leftStartedAt) && Number.isFinite(rightStartedAt) && rightStartedAt !== leftStartedAt) {
          return rightStartedAt - leftStartedAt;
        }

        if (right.modifiedAtMs !== left.modifiedAtMs) {
          return right.modifiedAtMs - left.modifiedAtMs;
        }

        return right.meta.transcriptPath.localeCompare(left.meta.transcriptPath);
      });

    for (const session of sessions) {
      if (!options?.cwd || sameWorkspacePath(session.meta.cwd, options.cwd)) {
        return session.meta;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function parseSyncEvent(line: string): TranscriptSyncEvent | undefined {
  if (!line.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(line) as {
      timestamp?: string;
      type?: string;
      payload?: {
        type?: string;
        message?: string;
        role?: string;
        phase?: string;
        content?: Array<{ type?: string; text?: string }>;
      };
    };

    if (parsed.type === 'event_msg' && parsed.payload?.type === 'user_message' && parsed.payload.message) {
      return {
        role: 'user',
        text: parsed.payload.message,
        timestamp: parsed.timestamp || new Date(0).toISOString(),
      };
    }

    if (
      parsed.type === 'response_item' &&
      parsed.payload?.type === 'message' &&
      parsed.payload.role === 'assistant' &&
      parsed.payload.phase !== 'commentary'
    ) {
      const text = (parsed.payload.content || [])
        .filter((item) => item.type === 'output_text' && item.text)
        .map((item) => item.text?.trim() || '')
        .filter(Boolean)
        .join('\n');

      if (!text) {
        return undefined;
      }

      return {
        role: 'assistant',
        text,
        timestamp: parsed.timestamp || new Date(0).toISOString(),
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export async function readTranscriptEventsSince(
  transcriptPath: string,
  cursor: number,
): Promise<{ cursor: number; events: TranscriptSyncEvent[] }> {
  try {
    const buffer = readFileSync(transcriptPath);
    const start = cursor > 0 && cursor < buffer.length ? cursor : 0;
    const content = buffer.slice(start).toString('utf8');
    const events = content
      .split(/\r?\n/)
      .map((line) => parseSyncEvent(line))
      .filter((event): event is TranscriptSyncEvent => Boolean(event));

    return {
      cursor: buffer.length,
      events,
    };
  } catch {
    return {
      cursor,
      events: [],
    };
  }
}
