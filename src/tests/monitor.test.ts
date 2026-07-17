import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPersistentMessageDeduper,
  createWeChatMessageDedupKey,
} from '../wechat/monitor.js';
import { getSyncBufPath } from '../wechat/sync-buf.js';
import { MessageType, type WeixinMessage } from '../wechat/types.js';
import { buildIlinkCommonHeaders, WeChatApi } from '../wechat/api.js';

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

test('sync buffers are isolated by WeChat account', () => {
  const first = getSyncBufPath('first@im.bot');
  const second = getSyncBufPath('second@im.bot');

  assert.notEqual(first, second);
  assert.match(first, /sync-bufs/);
  assert.match(first, /first%40im\.bot\.json$/);
});

test('getUpdates sends the current iLink headers and base_info payload', async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: HeadersInit | undefined;
  let capturedBody = '';

  globalThis.fetch = async (_input, init) => {
    capturedHeaders = init?.headers;
    capturedBody = String(init?.body ?? '');
    return new Response(JSON.stringify({ ret: 0, get_updates_buf: 'next' }), { status: 200 });
  };

  try {
    const api = new WeChatApi('test-token');
    await api.getUpdates();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const headers = new Headers(capturedHeaders);
  assert.equal(headers.get('AuthorizationType'), 'ilink_bot_token');
  assert.equal(headers.get('iLink-App-Id'), 'bot');
  assert.equal(headers.get('iLink-App-ClientVersion'), '256');
  assert.match(Buffer.from(headers.get('X-WECHAT-UIN') ?? '', 'base64').toString('utf8'), /^\d+$/);
  assert.deepEqual(JSON.parse(capturedBody), {
    get_updates_buf: '',
    base_info: {
      channel_version: '0.1.0',
      bot_agent: 'wechat-codex',
    },
  });
});

test('QR login common headers identify the iLink client', () => {
  assert.deepEqual(buildIlinkCommonHeaders(), {
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': '256',
  });
});
