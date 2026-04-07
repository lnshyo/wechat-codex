import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { buildInboundDedupKey, createInboundDedupStore } from '../wechat/inbound-dedup.js';
import { MessageType, type WeixinMessage } from '../wechat/types.js';

function buildMessage(overrides: Partial<WeixinMessage> = {}): WeixinMessage {
  return {
    message_id: 123,
    from_user_id: 'user-a',
    to_user_id: 'bot-a',
    seq: 7,
    create_time_ms: 1000,
    message_type: MessageType.USER,
    context_token: 'ctx-1',
    item_list: [],
    ...overrides,
  };
}

test('buildInboundDedupKey prefers message_id when available', () => {
  assert.equal(buildInboundDedupKey(buildMessage({ message_id: 456 })), 'message_id:456');
});

test('buildInboundDedupKey falls back to stable metadata when message_id is missing', () => {
  assert.equal(
    buildInboundDedupKey(
      buildMessage({
        message_id: undefined,
        from_user_id: 'user-x',
        seq: 9,
        create_time_ms: 123456,
        context_token: 'ctx-9',
      }),
    ),
    'fallback|user-x|bot-a|9|123456|1|ctx-9',
  );
});

test('createInboundDedupStore persists seen inbound messages across store reloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wcc-inbound-dedup-'));
  const storePath = join(dir, 'inbound-dedup.json');
  const message = buildMessage({ message_id: 789 });

  const firstStore = createInboundDedupStore(storePath, 4);
  assert.equal(firstStore.hasSeen(message), false);
  assert.equal(firstStore.markSeen(message), true);
  assert.equal(firstStore.hasSeen(message), true);

  const secondStore = createInboundDedupStore(storePath, 4);
  assert.equal(secondStore.hasSeen(message), true);
  assert.equal(secondStore.markSeen(message), false);
});

test('createInboundDedupStore evicts oldest keys when capacity is exceeded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wcc-inbound-dedup-'));
  const storePath = join(dir, 'inbound-dedup.json');
  const store = createInboundDedupStore(storePath, 2);

  const first = buildMessage({ message_id: 1 });
  const second = buildMessage({ message_id: 2 });
  const third = buildMessage({ message_id: 3 });

  assert.equal(store.markSeen(first), true);
  assert.equal(store.markSeen(second), true);
  assert.equal(store.markSeen(third), true);

  const reloaded = createInboundDedupStore(storePath, 2);
  assert.equal(reloaded.hasSeen(first), false);
  assert.equal(reloaded.hasSeen(second), true);
  assert.equal(reloaded.hasSeen(third), true);
});
