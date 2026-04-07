import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { Session } from '../session.js';
import { createLocalCodexTranscriptMirror } from '../codex/local-sync.js';

function createSession(transcriptPath: string): Session {
  return {
    peerUserId: 'alice@im.wechat',
    codexThreadId: 'thread-1',
    latestContextToken: 'ctx-1',
    localSync: {
      enabled: true,
      sessionId: 'session-1',
      transcriptPath,
      transcriptCursor: 0,
    },
    state: 'idle',
    typingState: 'idle',
    gateway: {
      tokenLedger: {
        budgetTokens: 120000,
        reservedReplyTokens: 4096,
        estimatedCommittedTokens: 0,
        estimatedPendingTokens: 0,
        estimatedRemainingTokens: 120000,
        turns: [],
      },
      statusUpdatedAt: new Date(0).toISOString(),
    },
    updatedAt: new Date(0).toISOString(),
  };
}

test('local sync primes existing sessions without replaying historical transcript events', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-codex-local-sync-'));
  const transcriptPath = join(tempDir, 'session.jsonl');
  const sentMessages: string[] = [];
  let session = createSession(transcriptPath);

  try {
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-02T05:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'session-1', cwd: 'E:/claude/CODEXclaw' },
        }),
        JSON.stringify({
          timestamp: '2026-04-02T05:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: 'older prompt' },
        }),
        JSON.stringify({
          timestamp: '2026-04-02T05:00:02.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'older answer' }],
          },
        }),
      ].join('\n'),
      'utf8',
    );

    const mirror = createLocalCodexTranscriptMirror({
      accountId: 'bot-account',
      sessionStore: {
        list() {
          return [session];
        },
        update(_accountId, _peerUserId, updater) {
          session = updater(session) ?? session;
          return session;
        },
      },
      sender: {
        async sendText(_toUserId, _contextToken, text) {
          sentMessages.push(text);
        },
      },
    });

    await mirror.primeExistingSessions();

    assert.equal(sentMessages.length, 0);
    assert.ok((session.localSync?.transcriptCursor || 0) > 0);

    appendFileSync(
      transcriptPath,
      `\n${JSON.stringify({
        timestamp: '2026-04-02T05:01:00.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: 'new prompt' },
      })}\n${JSON.stringify({
        timestamp: '2026-04-02T05:01:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'new answer' }],
        },
      })}`,
      'utf8',
    );

    await mirror.pollOnce();

    assert.deepEqual(sentMessages, ['new answer']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('local sync ignores backfilled historical assistant events older than the saved watermark', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-codex-local-sync-watermark-'));
  const transcriptPath = join(tempDir, 'session.jsonl');
  const sentMessages: string[] = [];
  let session: Session = {
    ...createSession(transcriptPath),
    localSync: {
      ...createSession(transcriptPath).localSync!,
      lastTranscriptEventAt: '2026-04-02T05:10:00.000Z',
    },
  };

  try {
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          timestamp: '2026-04-02T05:00:00.000Z',
          type: 'session_meta',
          payload: { id: 'session-1', cwd: 'E:/claude/CODEXclaw' },
        }),
      ].join('\n'),
      'utf8',
    );

    const mirror = createLocalCodexTranscriptMirror({
      accountId: 'bot-account',
      sessionStore: {
        list() {
          return [session];
        },
        update(_accountId, _peerUserId, updater) {
          session = updater(session) ?? session;
          return session;
        },
      },
      sender: {
        async sendText(_toUserId, _contextToken, text) {
          sentMessages.push(text);
        },
      },
    });

    await mirror.primeExistingSessions();

    appendFileSync(
      transcriptPath,
      `\n${JSON.stringify({
        timestamp: '2026-04-02T05:05:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'older delayed answer' }],
        },
      })}\n${JSON.stringify({
        timestamp: '2026-04-02T05:11:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'fresh answer' }],
        },
      })}`,
      'utf8',
    );

    await mirror.pollOnce();

    assert.deepEqual(sentMessages, ['fresh answer']);
    assert.equal(session.localSync?.lastTranscriptEventAt, '2026-04-02T05:11:00.000Z');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
