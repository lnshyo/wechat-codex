import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('session store isolates Codex thread ids per peer', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-codex-session-'));
  const previousDataDir = process.env.WCC_DATA_DIR;
  process.env.WCC_DATA_DIR = tempDir;

  try {
    const { createSessionStore } = await import(`../session.js?case=${Date.now()}`);
    const store = createSessionStore();

    const alice = store.load('bot-account', 'alice@im.wechat');
    alice.codexThreadId = 'thread-alice';
    alice.latestContextToken = 'ctx-alice';
    alice.localSync = {
      enabled: true,
      sessionId: 'session-alice',
      transcriptPath: 'C:/tmp/session-alice.jsonl',
      transcriptCursor: 42,
    };
    store.save('bot-account', alice);

    const bob = store.load('bot-account', 'bob@im.wechat');
    bob.codexThreadId = 'thread-bob';
    store.save('bot-account', bob);

    const reloadedAlice = store.load('bot-account', 'alice@im.wechat');
    const reloadedBob = store.load('bot-account', 'bob@im.wechat');

    assert.equal(reloadedAlice.codexThreadId, 'thread-alice');
    assert.equal(reloadedAlice.latestContextToken, 'ctx-alice');
    assert.equal(reloadedAlice.localSync?.enabled, true);
    assert.equal(reloadedAlice.localSync?.sessionId, 'session-alice');
    assert.equal(reloadedAlice.localSync?.transcriptCursor, 42);
    assert.equal(reloadedAlice.state, 'idle');
    assert.equal(reloadedAlice.gateway.tokenLedger.estimatedPendingTokens, 0);
    assert.equal(reloadedBob.codexThreadId, 'thread-bob');
    assert.equal(reloadedBob.latestContextToken, undefined);
    assert.equal(reloadedBob.peerUserId, 'bob@im.wechat');
    assert.ok(reloadedBob.gateway.tokenLedger.budgetTokens > 0);
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.WCC_DATA_DIR;
    } else {
      process.env.WCC_DATA_DIR = previousDataDir;
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('session store clear resets only the targeted peer session', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-codex-session-'));
  const previousDataDir = process.env.WCC_DATA_DIR;
  process.env.WCC_DATA_DIR = tempDir;

  try {
    const { createSessionStore } = await import(`../session.js?case=clear-${Date.now()}`);
    const store = createSessionStore();

    const alice = store.load('bot-account', 'alice@im.wechat');
    alice.codexThreadId = 'thread-alice';
    alice.latestContextToken = 'ctx-alice';
    alice.state = 'processing';
    alice.typingState = 'typing';
    store.save('bot-account', alice);

    const bob = store.load('bot-account', 'bob@im.wechat');
    bob.codexThreadId = 'thread-bob';
    bob.latestContextToken = 'ctx-bob';
    store.save('bot-account', bob);

    store.clear('bot-account', 'alice@im.wechat');

    const clearedAlice = store.load('bot-account', 'alice@im.wechat');
    const reloadedBob = store.load('bot-account', 'bob@im.wechat');

    assert.equal(clearedAlice.codexThreadId, undefined);
    assert.equal(clearedAlice.latestContextToken, undefined);
    assert.equal(clearedAlice.localSync, undefined);
    assert.equal(clearedAlice.state, 'idle');
    assert.equal(clearedAlice.typingState, 'idle');
    assert.equal(clearedAlice.gateway.lastError, undefined);
    assert.equal(clearedAlice.gateway.tokenLedger.estimatedCommittedTokens, 0);
    assert.equal(reloadedBob.codexThreadId, 'thread-bob');
    assert.equal(reloadedBob.latestContextToken, 'ctx-bob');
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.WCC_DATA_DIR;
    } else {
      process.env.WCC_DATA_DIR = previousDataDir;
    }

    rmSync(tempDir, { recursive: true, force: true });
  }
});
