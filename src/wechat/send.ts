import { WeChatApi } from './api.js';
import {
  MessageItemType,
  MessageType,
  MessageState,
  TypingStatus,
  type MessageItem,
  type OutboundMessage,
} from './types.js';
import { logger } from '../logger.js';

export type ProgressState =
  | { mode: 'typing'; toUserId: string; typingTicket: string }
  | { mode: 'generating'; toUserId: string; contextToken: string };

export function createSender(api: WeChatApi, botAccountId: string) {
  let clientCounter = 0;

  function generateClientId(): string {
    return `wcc-${Date.now()}-${++clientCounter}`;
  }

  async function sendMessage(
    toUserId: string,
    contextToken: string,
    text: string,
    messageState: MessageState,
  ): Promise<void> {
    const clientId = generateClientId();
    const items: MessageItem[] = [
      {
        type: MessageItemType.TEXT,
        text_item: { text },
      },
    ];

    const msg: OutboundMessage = {
      from_user_id: botAccountId,
      to_user_id: toUserId,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: messageState,
      context_token: contextToken,
      item_list: items,
    };

    logger.info('Sending text message', { toUserId, clientId, textLength: text.length, messageState });
    await api.sendMessage({ msg });
    logger.info('Text message sent', { toUserId, clientId });
  }

  async function sendText(toUserId: string, contextToken: string, text: string): Promise<void> {
    await sendMessage(toUserId, contextToken, text, MessageState.FINISH);
  }

  async function sendGenerating(toUserId: string, contextToken: string): Promise<void> {
    await sendMessage(toUserId, contextToken, '', MessageState.GENERATING);
  }

  async function startProgress(toUserId: string, contextToken: string): Promise<ProgressState> {
    try {
      const config = await api.getConfig(toUserId, contextToken);
      if (config.ret === 0 && config.typing_ticket) {
        await api.sendTyping({
          ilink_user_id: toUserId,
          typing_ticket: config.typing_ticket,
          status: TypingStatus.START,
        });
        logger.info('Typing started', { toUserId });
        return {
          mode: 'typing',
          toUserId,
          typingTicket: config.typing_ticket,
        };
      }

      logger.warn('Typing ticket unavailable, falling back to generating state', {
        toUserId,
        ret: config.ret,
        retmsg: config.retmsg,
      });
    } catch (error) {
      logger.warn('Failed to start typing, falling back to generating state', {
        toUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await sendGenerating(toUserId, contextToken);
    return {
      mode: 'generating',
      toUserId,
      contextToken,
    };
  }

  async function refreshProgress(progress: ProgressState): Promise<void> {
    if (progress.mode !== 'typing') {
      return;
    }

    await api.sendTyping({
      ilink_user_id: progress.toUserId,
      typing_ticket: progress.typingTicket,
      status: TypingStatus.START,
    });
  }

  async function stopProgress(progress: ProgressState | undefined): Promise<void> {
    if (!progress || progress.mode !== 'typing') {
      return;
    }

    try {
      await api.sendTyping({
        ilink_user_id: progress.toUserId,
        typing_ticket: progress.typingTicket,
        status: TypingStatus.STOP,
      });
      logger.info('Typing stopped', { toUserId: progress.toUserId });
    } catch (error) {
      logger.warn('Failed to stop typing', {
        toUserId: progress.toUserId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { sendText, sendGenerating, startProgress, refreshProgress, stopProgress };
}
