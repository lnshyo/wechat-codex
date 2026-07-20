import type { MessageItem } from './types.js';

export const MISSING_VOICE_TRANSCRIPT_REPLY =
  '微信没有为这条语音提供转写文本，请改用文字发送，或在微信生成转写后重试。';

/**
 * Extract text content from a message item.
 * Returns text_item.text or empty string.
 */
export function extractText(item: MessageItem): string {
  if (item.text_item?.text) {
    return item.text_item.text;
  }

  const currentVoiceText = item.voice_item?.text?.trim();
  if (currentVoiceText) {
    return currentVoiceText;
  }

  return item.voice_item?.voice_text?.trim() ?? '';
}

export function getMissingVoiceTranscriptReply(items: MessageItem[]): string | undefined {
  const hasVoiceItem = items.some((item) => Boolean(item.voice_item));
  const hasAnyText = items.some((item) => extractText(item).trim().length > 0);
  return hasVoiceItem && !hasAnyText ? MISSING_VOICE_TRANSCRIPT_REPLY : undefined;
}
