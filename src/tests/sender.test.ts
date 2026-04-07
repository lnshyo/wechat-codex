import test from 'node:test';
import assert from 'node:assert/strict';

import { createSender } from '../wechat/send.js';
import { MessageState, TypingStatus } from '../wechat/types.js';

test('sender prefers native typing when a typing ticket is available', async () => {
  const typingCalls: Array<{ ilink_user_id: string; typing_ticket: string; status: TypingStatus }> = [];
  const sendMessageCalls: unknown[] = [];

  const sender = createSender(
    {
      async sendMessage(body: unknown) {
        sendMessageCalls.push(body);
      },
      async getConfig() {
        return { ret: 0, typing_ticket: 'typing-ticket-1' };
      },
      async sendTyping(body: { ilink_user_id: string; typing_ticket: string; status: TypingStatus }) {
        typingCalls.push(body);
      },
    } as never,
    'bot-account',
  );

  const progress = await sender.startProgress('peer-user', 'ctx-1');
  await sender.refreshProgress(progress);
  await sender.stopProgress(progress);

  assert.equal(progress.mode, 'typing');
  assert.equal(sendMessageCalls.length, 0);
  assert.deepEqual(typingCalls, [
    { ilink_user_id: 'peer-user', typing_ticket: 'typing-ticket-1', status: TypingStatus.START },
    { ilink_user_id: 'peer-user', typing_ticket: 'typing-ticket-1', status: TypingStatus.START },
    { ilink_user_id: 'peer-user', typing_ticket: 'typing-ticket-1', status: TypingStatus.STOP },
  ]);
});

test('sender falls back to generating state when typing is unavailable', async () => {
  const sendMessageCalls: Array<{ msg: { message_state: MessageState; context_token: string } }> = [];

  const sender = createSender(
    {
      async sendMessage(body: { msg: { message_state: MessageState; context_token: string } }) {
        sendMessageCalls.push(body);
      },
      async getConfig() {
        throw new Error('getconfig failed');
      },
      async sendTyping() {
        throw new Error('should not be called');
      },
    } as never,
    'bot-account',
  );

  const progress = await sender.startProgress('peer-user', 'ctx-2');
  await sender.stopProgress(progress);

  assert.equal(progress.mode, 'generating');
  assert.equal(sendMessageCalls.length, 1);
  assert.equal(sendMessageCalls[0].msg.message_state, MessageState.GENERATING);
  assert.equal(sendMessageCalls[0].msg.context_token, 'ctx-2');
});
