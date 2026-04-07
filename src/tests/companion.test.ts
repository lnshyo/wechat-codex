import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  findBestLocalCodexSessionForCwd,
  findLatestDesktopSessionForCwd,
  normalizeWorkspacePath,
} from '../codex/companion.js';

test('normalizeWorkspacePath treats Windows path variants as the same workspace', () => {
  const normalizedDesktop = normalizeWorkspacePath('\\\\?\\E:\\claude\\CODEXclaw');
  const normalizedConfig = normalizeWorkspacePath('E:/claude/CODEXclaw');

  assert.equal(normalizedDesktop, normalizedConfig);
});

test('findLatestDesktopSessionForCwd prefers the newest Codex Desktop thread for the workspace', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-codex-companion-db-'));
  const dbPath = join(tempDir, 'state_5.sqlite');
  let db: any;

  try {
    const sqlite = await import('node:sqlite');
    db = new sqlite.DatabaseSync(dbPath);

    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        model_provider TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        sandbox_policy TEXT NOT NULL,
        approval_mode TEXT NOT NULL,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        has_user_event INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        git_sha TEXT,
        git_branch TEXT,
        git_origin_url TEXT,
        cli_version TEXT NOT NULL DEFAULT '',
        first_user_message TEXT NOT NULL DEFAULT '',
        agent_nickname TEXT,
        agent_role TEXT,
        memory_mode TEXT NOT NULL DEFAULT 'enabled',
        model TEXT,
        reasoning_effort TEXT,
        agent_path TEXT
      );
    `);

    const insert = db.prepare(`
      INSERT INTO threads (
        id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
        sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version,
        first_user_message, memory_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, '', '', 'enabled')
    `);

    insert.run(
      'desktop-older',
      'C:\\Users\\lin_s\\.codex\\sessions\\2026\\04\\01\\desktop-older.jsonl',
      100,
      200,
      'vscode',
      'openai',
      '\\\\?\\E:\\claude\\CODEXclaw',
      'older desktop thread',
      'danger-full-access',
      'never',
    );
    insert.run(
      'desktop-newer',
      'C:\\Users\\lin_s\\.codex\\sessions\\2026\\04\\02\\desktop-newer.jsonl',
      300,
      400,
      'vscode',
      'openai',
      'E:/claude/CODEXclaw',
      'current desktop thread',
      'danger-full-access',
      'never',
    );
    insert.run(
      'exec-thread',
      'C:\\Users\\lin_s\\.codex\\sessions\\2026\\04\\02\\exec-thread.jsonl',
      500,
      600,
      'exec',
      'openai',
      'E:/claude/CODEXclaw',
      'background exec thread',
      'danger-full-access',
      'never',
    );

    const result = await findLatestDesktopSessionForCwd({
      codexHome: tempDir,
      cwd: 'E:/claude/CODEXclaw',
    });

    assert.equal(result?.sessionId, 'desktop-newer');
    assert.equal(result?.title, 'current desktop thread');
    assert.equal(result?.source, 'vscode');
  } finally {
    db?.close();
    await new Promise((resolve) => setTimeout(resolve, 25));
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('findBestLocalCodexSessionForCwd falls back to transcript scan when no desktop thread matches', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-codex-companion-fallback-'));
  const sessionsRoot = join(tempDir, 'sessions', '2026', '04', '02');
  const transcriptPath = join(sessionsRoot, 'fallback.jsonl');

  try {
    mkdirSync(sessionsRoot, { recursive: true });
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        timestamp: '2026-04-02T05:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'transcript-fallback', cwd: 'E:/claude/CODEXclaw' },
      })}\n`,
      'utf8',
    );

    const result = await findBestLocalCodexSessionForCwd({
      codexHome: tempDir,
      cwd: 'E:/claude/CODEXclaw',
    });

    assert.equal(result?.sessionId, 'transcript-fallback');
    assert.equal(result?.source, 'transcript');
    assert.equal(result?.transcriptPath, transcriptPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
