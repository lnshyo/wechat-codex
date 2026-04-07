import assert from 'node:assert/strict';
import test from 'node:test';

import { handleGatewayCommand, parseGatewayCommand } from '../gateway/commands.js';
import type { Session } from '../session.js';

function createSession(): Session {
  return {
    peerUserId: 'alice@im.wechat',
    state: 'idle',
    typingState: 'idle',
    gateway: {
      tokenLedger: {
        budgetTokens: 120000,
        reservedReplyTokens: 4096,
        estimatedCommittedTokens: 10,
        estimatedPendingTokens: 20,
        estimatedRemainingTokens: 119870,
        turns: [],
      },
      statusUpdatedAt: new Date(0).toISOString(),
    },
    updatedAt: new Date(0).toISOString(),
  };
}

test('parseGatewayCommand matches all built-in commands case-insensitively', () => {
  assert.equal(parseGatewayCommand(' /NEW '), 'new');
  assert.equal(parseGatewayCommand('/sync'), 'sync');
  assert.equal(parseGatewayCommand('/unsync'), 'unsync');
  assert.equal(parseGatewayCommand('/status'), 'status');
  assert.equal(parseGatewayCommand('/TOKEN'), 'token');
  assert.equal(parseGatewayCommand('/task'), 'task');
  assert.equal(parseGatewayCommand('/stop'), 'stop');
  assert.equal(parseGatewayCommand('/health'), 'health');
});

test('parseGatewayCommand ignores unknown slash messages', () => {
  assert.equal(parseGatewayCommand('/new please'), undefined);
  assert.equal(parseGatewayCommand('/unknown'), undefined);
  assert.equal(parseGatewayCommand('hello'), undefined);
});

test('handleGatewayCommand resets runtime state for /new', async () => {
  const sentMessages: string[] = [];
  let resetCalls = 0;

  const handled = await handleGatewayCommand({
    userText: '/new',
    fromUserId: 'alice@im.wechat',
    contextToken: 'ctx-1',
    hasImage: false,
    sender: {
      async sendText(_toUserId: string, _contextToken: string, text: string) {
        sentMessages.push(text);
      },
    },
    runtime: {
      getSession() {
        return createSession();
      },
      getPeerSnapshot() {
        return { queuedTasks: [] };
      },
      getHealthSnapshot() {
        return {
          accountId: 'bot-account',
          bridgeProcessId: 1,
          bridgeStarted: true,
          serviceRunning: false,
          activePeerCount: 0,
          totalQueuedTasks: 0,
        };
      },
      async stopPeer() {
        return { stoppedActiveTask: false, clearedQueuedTasks: 0 };
      },
      async resetPeer() {
        resetCalls += 1;
        return { stoppedActiveTask: true, clearedQueuedTasks: 2, activeTaskId: '7' };
      },
      async attachPeerToLatestLocalSession() {
        throw new Error('should not be called');
      },
      async detachPeerLocalSession() {
        throw new Error('should not be called');
      },
    },
  });

  assert.equal(handled, 'new');
  assert.equal(resetCalls, 1);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /\u5df2\u4e3a\u5f53\u524d\u804a\u5929\u5f00\u542f\u65b0\u4f1a\u8bdd/);
  assert.match(sentMessages[0], /\u4e0b\u4e00\u6761\u6d88\u606f\u5c06\u5f00\u542f\u5168\u65b0\u7684 Codex \u7ebf\u7a0b/);
  assert.match(sentMessages[0], /\u5df2\u505c\u6b62\u5f53\u524d\u4efb\u52a1/);
  assert.match(sentMessages[0], /\u5df2\u6e05\u7a7a 2 \u4e2a\u6392\u961f\u4efb\u52a1/);
});

test('handleGatewayCommand leaves image messages alone', async () => {
  const handled = await handleGatewayCommand({
    userText: '/status',
    fromUserId: 'alice@im.wechat',
    contextToken: 'ctx-2',
    hasImage: true,
    sender: {
      async sendText() {
        throw new Error('should not send');
      },
    },
    runtime: {
      getSession() {
        return createSession();
      },
      getPeerSnapshot() {
        return { queuedTasks: [] };
      },
      getHealthSnapshot() {
        return {
          accountId: 'bot-account',
          bridgeProcessId: 1,
          bridgeStarted: true,
          serviceRunning: false,
          activePeerCount: 0,
          totalQueuedTasks: 0,
        };
      },
      async stopPeer() {
        return { stoppedActiveTask: false, clearedQueuedTasks: 0 };
      },
      async resetPeer() {
        return { stoppedActiveTask: false, clearedQueuedTasks: 0 };
      },
      async attachPeerToLatestLocalSession() {
        throw new Error('should not be called');
      },
      async detachPeerLocalSession() {
        throw new Error('should not be called');
      },
    },
  });

  assert.equal(handled, undefined);
});

test('handleGatewayCommand attaches current chat to the latest local Codex session for /sync', async () => {
  const sentMessages: string[] = [];
  let attachCalls = 0;

  const handled = await handleGatewayCommand({
    userText: '/sync',
    fromUserId: 'alice@im.wechat',
    contextToken: 'ctx-3',
    hasImage: false,
    sender: {
      async sendText(_toUserId: string, _contextToken: string, text: string) {
        sentMessages.push(text);
      },
    },
    runtime: {
      getSession() {
        return createSession();
      },
      getPeerSnapshot() {
        return { queuedTasks: [] };
      },
      getHealthSnapshot() {
        return {
          accountId: 'bot-account',
          bridgeProcessId: 1,
          bridgeStarted: true,
          serviceRunning: false,
          activePeerCount: 0,
          totalQueuedTasks: 0,
        };
      },
      async stopPeer() {
        return { stoppedActiveTask: false, clearedQueuedTasks: 0 };
      },
      async resetPeer() {
        return { stoppedActiveTask: false, clearedQueuedTasks: 0 };
      },
      async attachPeerToLatestLocalSession() {
        attachCalls += 1;
        return {
          attached: true,
          sessionId: 'session-123',
          transcriptPath: 'C:/Users/lin_s/.codex/sessions/2026/04/01/session-123.jsonl',
        };
      },
      async detachPeerLocalSession() {
        throw new Error('should not be called');
      },
    },
  });

  assert.equal(handled, 'sync');
  assert.equal(attachCalls, 1);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /已连接当前聊天到本地 Codex 会话/);
  assert.match(sentMessages[0], /session-123/);
  assert.doesNotMatch(sentMessages[0], /local question/);
  assert.doesNotMatch(sentMessages[0], /local answer/);
});

test('handleGatewayCommand detaches the current chat from local Codex sync for /unsync', async () => {
  const sentMessages: string[] = [];
  let detachCalls = 0;

  const handled = await handleGatewayCommand({
    userText: '/unsync',
    fromUserId: 'alice@im.wechat',
    contextToken: 'ctx-4',
    hasImage: false,
    sender: {
      async sendText(_toUserId: string, _contextToken: string, text: string) {
        sentMessages.push(text);
      },
    },
    runtime: {
      getSession() {
        return createSession();
      },
      getPeerSnapshot() {
        return { queuedTasks: [] };
      },
      getHealthSnapshot() {
        return {
          accountId: 'bot-account',
          bridgeProcessId: 1,
          bridgeStarted: true,
          serviceRunning: false,
          activePeerCount: 0,
          totalQueuedTasks: 0,
        };
      },
      async stopPeer() {
        return { stoppedActiveTask: false, clearedQueuedTasks: 0 };
      },
      async resetPeer() {
        return { stoppedActiveTask: false, clearedQueuedTasks: 0 };
      },
      async attachPeerToLatestLocalSession() {
        throw new Error('should not be called');
      },
      async detachPeerLocalSession() {
        detachCalls += 1;
        return true;
      },
    },
  });

  assert.equal(handled, 'unsync');
  assert.equal(detachCalls, 1);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /已断开当前聊天与本地 Codex 窗口的同步/);
});
