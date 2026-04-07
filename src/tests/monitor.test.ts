import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPersistentMessageDeduper,
  createWeChatMessageDedupKey,
} from '../wechat/monitor.js';
import { MessageType, type WeixinMessage } from '../wechat/types.js';

function buildMessage(overrides: Partial<WeixinMessage> = {}): WeixinMessage {
  return {
    message_id: 101,
    from_user_id: 'user-a',
    to_user_id: 'bot-a',
    create_time_ms: 12345,
    message_type: MessageType.USER,
    context_token: 'ctx-1',
    item_list: [],
    ...overrides,
  };
}

test('createWeChatMessageDedupKey prefers message_id when present', () => {
  assert.equal(createWeChatMessageDedupKey(buildMessage({ message_id: 999 })), 'mid:999');
});

test('createWeChatMessageDedupKey falls back to sender, context, timestamp, and text', () => {
  assert.equal(
    createWeChatMessageDedupKey(
      buildMessage({
        message_id: undefined,
        create_time_ms: 777,
        item_list: [
          {
            type: 1,
            text_item: { text: 'hello' },
          },
        ],
      }),
    ),
    'fallback:user-a:ctx-1:777:hello',
  );
});

test('createPersistentMessageDeduper blocks duplicates after persistence reload', () => {
  let persistedKeys: string[] = [];
  const first = createPersistentMessageDeduper({
    loadKeys: () => persistedKeys,
    saveKeys: (keys) => {
      persistedKeys = [...keys];
    },
    maxEntries: 4,
  });
  const message = buildMessage({ message_id: 555 });

  assert.equal(first.shouldProcess(message), true);
  assert.equal(first.shouldProcess(message), false);

  const second = createPersistentMessageDeduper({
    loadKeys: () => persistedKeys,
    saveKeys: (keys) => {
      persistedKeys = [...keys];
    },
    maxEntries: 4,
  });
  assert.equal(second.shouldProcess(message), false);
});
