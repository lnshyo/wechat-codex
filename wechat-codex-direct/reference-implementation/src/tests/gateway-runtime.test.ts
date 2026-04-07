import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createGatewayRuntime } from '../gateway/runtime.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadStoreWithTempDir(tempDir: string, cacheBust: string) {
  const previousDataDir = process.env.WCC_DATA_DIR;
  process.env.WCC_DATA_DIR = tempDir;
  const { createSessionStore } = await import(`../session.js?case=${cacheBust}`);

  return {
    store: createSessionStore(),
    restore() {
      if (previousDataDir === undefined) {
        delete process.env.WCC_DATA_DIR;
      } else {
        process.env.WCC_DATA_DIR = previousDataDir;
      }
    },
  };
}

test('runtime runs queued tasks in FIFO order for one peer', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-codex-runtime-'));
  const cacheBust = `fifo-${Date.now()}`;
  const { store, restore } = await loadStoreWithTempDir(tempDir, cacheBust);
  const sentMessages: string[] = [];
  const startedTasks: string[] = [];
  const resolvers: Array<() => void> = [];

  try {
    const runtime = createGatewayRuntime({
      accountId: 'bot-account',
      sessionStore: store,
      sender: {
        async sendText(_toUserId: string, _contextToken: string, text: string) {
          sentMessages.push(text);
        },
      },
      getConfig: () => ({ workingDirectory: process.cwd(), maxQueuedTasksPerPeer: 5 }),
      executeTask: async ({ task }) => {
        startedTasks.push(task.id);
        await new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
        return {
          aborted: false,
          text: `done ${task.id}`,
        };
      },
      inspectHealthBase: () => ({
        accountId: 'bot-account',
        bridgeProcessId: process.pid,
        bridgeStarted: true,
        serviceRunning: false,
      }),
    });

    await runtime.enqueueMessage({
      peerUserId: 'alice@im.wechat',
      contextToken: 'ctx-1',
      promptText: 'first',
      preview: 'first',
      imagePayloads: [],
      hasImage: false,
    });
    await runtime.enqueueMessage({
      peerUserId: 'alice@im.wechat',
      contextToken: 'ctx-2',
      promptText: 'second',
      preview: 'second',
      imagePayloads: [],
      hasImage: false,
    });
    await runtime.enqueueMessage({
      peerUserId: 'alice@im.wechat',
      contextToken: 'ctx-3',
      promptText: 'third',
      preview: 'third',
      imagePayloads: [],
      hasImage: false,
    });

    assert.deepEqual(startedTasks, ['1']);
    assert.match(sentMessages[0], /Queued task #2 at position 1/);
    assert.match(sentMessages[1], /Queued task #3 at position 2/);

    resolvers.shift()?.();
    await tick();
    assert.deepEqual(startedTasks, ['1', '2']);

    resolvers.shift()?.();
    await tick();
    assert.deepEqual(startedTasks, ['1', '2', '3']);

    resolvers.shift()?.();
    await tick();

    assert.match(sentMessages.join('\n'), /done 1/);
    assert.match(sentMessages.join('\n'), /done 2/);
    assert.match(sentMessages.join('\n'), /done 3/);
    assert.equal(runtime.getPeerSnapshot('alice@im.wechat').queuedTasks.length, 0);
  } finally {
    restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runtime stopPeer aborts the active task and clears queued work', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-codex-runtime-'));
  const cacheBust = `stop-${Date.now()}`;
  const { store, restore } = await loadStoreWithTempDir(tempDir, cacheBust);

  try {
    const runtime = createGatewayRuntime({
      accountId: 'bot-account',
      sessionStore: store,
      sender: {
        async sendText() {
          // no-op
        },
      },
      getConfig: () => ({ workingDirectory: process.cwd(), maxQueuedTasksPerPeer: 5 }),
      executeTask: ({ abortController }) =>
        new Promise((resolve) => {
          abortController.signal.addEventListener(
            'abort',
            () => {
              resolve({
                aborted: true,
                text: '',
              });
            },
            { once: true },
          );
        }),
      inspectHealthBase: () => ({
        accountId: 'bot-account',
        bridgeProcessId: process.pid,
        bridgeStarted: true,
        serviceRunning: false,
      }),
    });

    await runtime.enqueueMessage({
      peerUserId: 'alice@im.wechat',
      contextToken: 'ctx-1',
      promptText: 'first',
      preview: 'first',
      imagePayloads: [],
      hasImage: false,
    });
    await runtime.enqueueMessage({
      peerUserId: 'alice@im.wechat',
      contextToken: 'ctx-2',
      promptText: 'second',
      preview: 'second',
      imagePayloads: [],
      hasImage: false,
    });

    const result = await runtime.stopPeer('alice@im.wechat');
    await tick();

    assert.equal(result.stoppedActiveTask, true);
    assert.equal(result.clearedQueuedTasks, 1);
    assert.equal(runtime.getPeerSnapshot('alice@im.wechat').activeTask, undefined);
    assert.equal(runtime.getPeerSnapshot('alice@im.wechat').queuedTasks.length, 0);
    assert.equal(runtime.getSession('alice@im.wechat').gateway.tokenLedger.estimatedPendingTokens, 0);
  } finally {
    restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('runtime allows different peers to run in parallel', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'wechat-codex-runtime-'));
  const cacheBust = `parallel-${Date.now()}`;
  const { store, restore } = await loadStoreWithTempDir(tempDir, cacheBust);
  const startedPeers: string[] = [];
  const resolvers: Array<() => void> = [];

  try {
    const runtime = createGatewayRuntime({
      accountId: 'bot-account',
      sessionStore: store,
      sender: {
        async sendText() {
          // no-op
        },
      },
      getConfig: () => ({ workingDirectory: process.cwd(), maxQueuedTasksPerPeer: 5 }),
      executeTask: async ({ peerUserId }) => {
        startedPeers.push(peerUserId);
        await new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
        return {
          aborted: false,
          text: `done ${peerUserId}`,
        };
      },
      inspectHealthBase: () => ({
        accountId: 'bot-account',
        bridgeProcessId: process.pid,
        bridgeStarted: true,
        serviceRunning: false,
      }),
    });

    await runtime.enqueueMessage({
      peerUserId: 'alice@im.wechat',
      contextToken: 'ctx-a',
      promptText: 'alpha',
      preview: 'alpha',
      imagePayloads: [],
      hasImage: false,
    });
    await runtime.enqueueMessage({
      peerUserId: 'bob@im.wechat',
      contextToken: 'ctx-b',
      promptText: 'beta',
      preview: 'beta',
      imagePayloads: [],
      hasImage: false,
    });

    assert.deepEqual(startedPeers.sort(), ['alice@im.wechat', 'bob@im.wechat']);
    assert.equal(runtime.getHealthSnapshot().activePeerCount, 2);

    resolvers.forEach((resolve) => resolve());
    await tick();
  } finally {
    restore();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
