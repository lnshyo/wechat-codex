import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  findLatestCodexSessionForCwd,
  readTranscriptEventsSince,
  type LocalCodexSessionRef,
} from './transcript.js';
import { normalizeWorkspacePath, sameWorkspacePath } from './workspace-path.js';

export type LocalCodexSessionSource = 'vscode' | 'exec' | 'transcript';

export interface CompanionSessionRef extends LocalCodexSessionRef {
  source: LocalCodexSessionSource;
  title?: string;
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

export async function findLatestDesktopSessionForCwd(options?: {
  codexHome?: string;
  cwd?: string;
}): Promise<CompanionSessionRef | undefined> {
  const dbPath = join(resolveCodexHome(options?.codexHome), 'state_5.sqlite');
  const normalizedTargetCwd = normalizeWorkspacePath(options?.cwd);
  let db: DatabaseSync | undefined;

  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db
      .prepare(
        `
          SELECT id, rollout_path, cwd, title, source, updated_at
          FROM threads
          WHERE archived = 0 AND source = 'vscode'
          ORDER BY updated_at DESC
        `,
      )
      .all() as Array<{
      id: string;
      rollout_path: string;
      cwd: string;
      title: string;
      source: 'vscode';
      updated_at: number;
    }>;

    for (const row of rows) {
      if (normalizedTargetCwd && !sameWorkspacePath(row.cwd, normalizedTargetCwd)) {
        continue;
      }

      return {
        sessionId: row.id,
        transcriptPath: row.rollout_path,
        cwd: row.cwd,
        title: row.title,
        source: row.source,
        startedAt: Number.isFinite(row.updated_at)
          ? new Date(row.updated_at * 1000).toISOString()
          : undefined,
      };
    }

    return undefined;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

export async function findBestLocalCodexSessionForCwd(options?: {
  codexHome?: string;
  cwd?: string;
}): Promise<CompanionSessionRef | undefined> {
  const desktop = await findLatestDesktopSessionForCwd(options);
  if (desktop) {
    return desktop;
  }

  const transcript = await findLatestCodexSessionForCwd(options);
  if (!transcript) {
    return undefined;
  }

  return {
    ...transcript,
    source: 'transcript',
  };
}

export { normalizeWorkspacePath } from './workspace-path.js';
export { readTranscriptEventsSince } from './transcript.js';
