import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractText,
  getMissingVoiceTranscriptReply,
  MISSING_VOICE_TRANSCRIPT_REPLY,
} from '../wechat/media.js';
import { MessageItemType } from '../wechat/types.js';

test('extractText reads ordinary text messages', () => {
  assert.equal(
    extractText({ type: MessageItemType.TEXT, text_item: { text: 'hello' } }),
    'hello',
  );
});

test('extractText reads the current WeChat voice transcription field', () => {
  assert.equal(
    extractText({ type: MessageItemType.VOICE, voice_item: { text: '语音转写' } }),
    '语音转写',
  );
});

test('extractText retains the legacy voice transcription alias', () => {
  assert.equal(
    extractText({ type: MessageItemType.VOICE, voice_item: { voice_text: '旧字段' } }),
    '旧字段',
  );
});

test('extractText falls back to the legacy alias when the current field is blank', () => {
  assert.equal(
    extractText({
      type: MessageItemType.VOICE,
      voice_item: { text: '   ', voice_text: '兼容转写' },
    }),
    '兼容转写',
  );
});

test('extractText returns empty text when WeChat provides no transcript', () => {
  assert.equal(extractText({ type: MessageItemType.VOICE, voice_item: {} }), '');
});

test('getMissingVoiceTranscriptReply distinguishes untranslated voice from unsupported media', () => {
  assert.equal(
    getMissingVoiceTranscriptReply([{ type: MessageItemType.VOICE, voice_item: {} }]),
    MISSING_VOICE_TRANSCRIPT_REPLY,
  );
  assert.equal(
    getMissingVoiceTranscriptReply([
      { type: MessageItemType.VOICE, voice_item: { text: '已有转写' } },
    ]),
    undefined,
  );
  assert.equal(
    getMissingVoiceTranscriptReply([{ type: MessageItemType.FILE }]),
    undefined,
  );
});
