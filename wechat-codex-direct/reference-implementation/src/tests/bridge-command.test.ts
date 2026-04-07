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
    },
  });

  assert.equal(handled, 'new');
  assert.equal(resetCalls, 1);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /fresh Codex thread/i);
  assert.match(sentMessages[0], /Cleared the active task and 2 queued task/);
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
    },
  });

  assert.equal(handled, undefined);
});
