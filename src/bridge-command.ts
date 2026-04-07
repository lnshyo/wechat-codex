export interface ParsedBridgeCommand {
  type: 'new-session';
  replyText: string;
}

interface SessionStoreLike {
  clear(accountId: string, peerUserId: string): void;
}

interface SenderLike {
  sendText(toUserId: string, contextToken: string, text: string): Promise<void>;
}

export interface HandleBridgeCommandOptions {
  accountId: string;
  fromUserId: string;
  contextToken: string;
  userText: string;
  hasImage: boolean;
  sessionStore: SessionStoreLike;
  sender: SenderLike;
}

const NEW_SESSION_REPLY =
  'Started a new session for this chat. Your next message will begin a fresh Codex thread.';

export function parseBridgeCommand(text: string): ParsedBridgeCommand | undefined {
  if (text.trim().toLowerCase() !== '/new') {
    return undefined;
  }

  return {
    type: 'new-session',
    replyText: NEW_SESSION_REPLY,
  };
}

export async function handleBridgeCommand(
  options: HandleBridgeCommandOptions,
): Promise<ParsedBridgeCommand | undefined> {
  if (options.hasImage) {
    return undefined;
  }

  const command = parseBridgeCommand(options.userText);
  if (!command) {
    return undefined;
  }

  options.sessionStore.clear(options.accountId, options.fromUserId);
  await options.sender.sendText(options.fromUserId, options.contextToken, command.replyText);
  return command;
}
