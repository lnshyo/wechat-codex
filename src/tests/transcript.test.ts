import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { findLatestCodexSessionForCwd, readTranscriptEventsSince } from '../codex/transcript.js';

test('readTranscriptEventsSince returns local user messages and final assistant replies', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-codex-transcript-'));
  const transcriptPath = join(tempDir, 'session.jsonl');

  try {
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-01T15:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'session-1', cwd: 'E:/claude/CODEXclaw' },
        }),
        JSON.stringify({
          timestamp: '2026-04-01T15:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'local prompt' },
        }),
        JSON.stringify({
          timestamp: '2026-04-01T15:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'commentary',
            content: [{ type: 'output_text', text: 'thinking' }],
          },
        }),
        JSON.stringify({
          timestamp: '2026-04-01T15:00:03.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'final answer' }],
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const result = await readTranscriptEventsSince(transcriptPath, 0);

    assert.equal(result.events.length, 2);
    assert.deepEqual(
      result.events.map((event) => ({ role: event.role, text: event.text })),
      [
        { role: 'user', text: 'local prompt' },
        { role: 'assistant', text: 'final answer' },
      ],
    );
    assert.ok(result.cursor > 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('findLatestCodexSessionForCwd picks the newest matching transcript', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-codex-transcript-index-'));
  const sessionsRoot = join(tempDir, 'sessions', '2026', '04', '01');
  const olderPath = join(sessionsRoot, 'older.jsonl');
  const newerPath = join(sessionsRoot, 'newer.jsonl');

  try {
    mkdirSync(sessionsRoot, { recursive: true });
    writeFileSync(
      olderPath,
      `${JSON.stringify({
        timestamp: '2026-04-01T10:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'session-older', cwd: 'E:/claude/CODEXclaw' },
      })}\n`,
      'utf8',
    );
    writeFileSync(
      newerPath,
      `${JSON.stringify({
        timestamp: '2026-04-01T11:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'session-newer', cwd: 'E:/claude/CODEXclaw' },
      })}\n`,
      'utf8',
    );

    const result = await findLatestCodexSessionForCwd({
      codexHome: tempDir,
      cwd: 'E:/claude/CODEXclaw',
    });

    assert.equal(result?.sessionId, 'session-newer');
    assert.equal(result?.transcriptPath, newerPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
