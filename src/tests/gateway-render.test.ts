import assert from 'node:assert/strict';
import test from 'node:test';

import { renderHealth, renderStatus, renderTaskQueue, renderTokenSummary } from '../gateway/render.js';
import type { Session } from '../session.js';

function createSession(): Session {
  return {
    peerUserId: 'alice@im.wechat',
    codexThreadId: 'thread-1',
    state: 'processing',
    typingState: 'typing',
    gateway: {
      lastError: '\u7f51\u7edc\u5f02\u5e38',
      lastTaskSummary: {
        taskId: '9',
        preview: 'hello',
        hasImage: false,
        status: 'completed',
        createdAt: '2026-03-31T06:00:00.000Z',
        finishedAt: '2026-03-31T06:01:00.000Z',
      },
      tokenLedger: {
        budgetTokens: 120000,
        reservedReplyTokens: 4096,
        estimatedCommittedTokens: 50,
        estimatedPendingTokens: 20,
        estimatedRemainingTokens: 119930,
        turns: [],
      },
      statusUpdatedAt: '2026-03-31T06:01:00.000Z',
    },
    updatedAt: '2026-03-31T06:01:00.000Z',
  };
}

test('renderStatus returns Chinese labels', () => {
  const text = renderStatus(createSession(), {
    activeTask: {
      id: '10',
      peerUserId: 'alice@im.wechat',
      contextToken: 'ctx-1',
      promptText: 'hi',
      preview: 'hi',
      imagePayloads: [],
      hasImage: false,
      createdAt: '2026-03-31T06:02:00.000Z',
      status: 'running',
      estimatedPromptTokens: 12,
      generation: 0,
    },
    queuedTasks: [],
  });

  assert.match(text, /\u4f1a\u8bdd\u72b6\u6001/);
  assert.match(text, /\u5f53\u524d\u72b6\u6001\uff1a\u5904\u7406\u4e2d/);
  assert.match(text, /\u7ebf\u7a0b\uff1a\u5df2\u4fdd\u5b58/);
  assert.match(text, /\u5f53\u524d\u4efb\u52a1\uff1a#10/);
  assert.match(text, /\u6392\u961f\u4efb\u52a1\uff1a0/);
  assert.match(text, /\u6700\u8fd1\u4efb\u52a1\uff1a#9 \u5df2\u5b8c\u6210/);
  assert.match(text, /\u6700\u8fd1\u9519\u8bef\uff1a\u7f51\u7edc\u5f02\u5e38/);
});

test('renderTokenSummary returns Chinese labels', () => {
  const text = renderTokenSummary(createSession());

  assert.match(text, /\u4f1a\u8bdd Token \u7edf\u8ba1\uff08\u4f30\u7b97\uff09/);
  assert.match(text, /\u9884\u7b97\uff1a120000/);
  assert.match(text, /\u56de\u590d\u9884\u7559\uff1a4096/);
  assert.match(text, /\u5df2\u63d0\u4ea4\uff1a50/);
  assert.match(text, /\u5904\u7406\u4e2d\uff1a20/);
  assert.match(text, /\u5269\u4f59\uff1a119930/);
  assert.match(text, /\u8f6e\u6b21\u6570\uff1a0/);
});

test('renderTaskQueue returns Chinese empty and populated states', () => {
  const empty = renderTaskQueue({ queuedTasks: [] });
  assert.equal(empty, '\u5f53\u524d\u804a\u5929\u6ca1\u6709\u8fd0\u884c\u4e2d\u6216\u6392\u961f\u4e2d\u7684\u4efb\u52a1\u3002');

  const queued = renderTaskQueue({
    activeTask: {
      id: '1',
      peerUserId: 'alice@im.wechat',
      contextToken: 'ctx-1',
      promptText: 'hello',
      preview: 'hello',
      imagePayloads: [],
      hasImage: true,
      createdAt: '2026-03-31T06:02:00.000Z',
      status: 'running',
      estimatedPromptTokens: 12,
      generation: 0,
    },
    queuedTasks: [
      {
        id: '2',
        peerUserId: 'alice@im.wechat',
        contextToken: 'ctx-2',
        promptText: 'world',
        preview: 'world',
        imagePayloads: [],
        hasImage: false,
        createdAt: '2026-03-31T06:03:00.000Z',
        status: 'queued',
        estimatedPromptTokens: 12,
        generation: 0,
      },
    ],
  });

  assert.match(queued, /\u4efb\u52a1\u961f\u5217/);
  assert.match(queued, /\u6267\u884c\u4e2d #1/);
  assert.match(queued, /\+\u56fe\u7247/);
  assert.match(queued, /\u6392\u961f 1 #2/);
});

test('renderHealth returns Chinese labels', () => {
  const text = renderHealth({
    accountId: 'bot-account',
    bridgeProcessId: 1234,
    bridgeStarted: true,
    serviceRunning: true,
    servicePid: 5678,
    serviceStartedAt: '2026-03-31T06:10:00.000Z',
    codexExecutablePath: 'C:/codex.exe',
    activePeerCount: 2,
    totalQueuedTasks: 3,
    lastRuntimeError: '\u8d85\u65f6',
  });

  assert.match(text, /\u6865\u63a5\u5065\u5eb7\u72b6\u6001/);
  assert.match(text, /\u8fdb\u7a0b\uff1a\u8fd0\u884c\u4e2d/);
  assert.match(text, /\u540e\u53f0\u670d\u52a1\uff1a\u8fd0\u884c\u4e2d/);
  assert.match(text, /\u5fae\u4fe1\u8d26\u53f7\uff1abot-account/);
  assert.match(text, /Codex \u53ef\u6267\u884c\u6587\u4ef6\uff1aC:\/codex\.exe/);
  assert.match(text, /\u6d3b\u8dc3\u8054\u7cfb\u4eba\uff1a2/);
  assert.match(text, /\u6392\u961f\u4efb\u52a1\uff1a3/);
  assert.match(text, /\u540e\u53f0\u670d\u52a1\u542f\u52a8\u65f6\u95f4\uff1a2026-03-31T06:10:00.000Z/);
  assert.match(text, /\u6700\u8fd1\u8fd0\u884c\u9519\u8bef\uff1a\u8d85\u65f6/);
});
