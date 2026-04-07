import type { Session } from '../session.js';
import { renderHealth, renderStatus, renderTaskQueue, renderTokenSummary } from './render.js';
import { splitMessage } from './task-utils.js';
import type {
  AttachLocalSessionResult,
  GatewayHealthSnapshot,
  PeerRuntimeSnapshot,
  StopPeerResult,
} from './types.js';

export type GatewayCommandName = 'new' | 'sync' | 'unsync' | 'status' | 'token' | 'task' | 'stop' | 'health';

interface SenderLike {
  sendText(toUserId: string, contextToken: string, text: string): Promise<void>;
}

interface RuntimeLike {
  getSession(peerUserId: string): Session;
  getPeerSnapshot(peerUserId: string): PeerRuntimeSnapshot;
  getHealthSnapshot(): GatewayHealthSnapshot;
  stopPeer(peerUserId: string): Promise<StopPeerResult>;
  resetPeer(peerUserId: string): Promise<StopPeerResult>;
  attachPeerToLatestLocalSession(peerUserId: string): Promise<AttachLocalSessionResult>;
  detachPeerLocalSession(peerUserId: string): Promise<boolean>;
}

export interface HandleGatewayCommandOptions {
  userText: string;
  fromUserId: string;
  contextToken: string;
  sender: SenderLike;
  runtime: RuntimeLike;
  hasImage: boolean;
}

export function parseGatewayCommand(text: string): GatewayCommandName | undefined {
  const normalized = text.trim().toLowerCase();

  switch (normalized) {
    case '/new':
      return 'new';
    case '/status':
      return 'status';
    case '/sync':
      return 'sync';
    case '/unsync':
      return 'unsync';
    case '/token':
      return 'token';
    case '/task':
      return 'task';
    case '/stop':
      return 'stop';
    case '/health':
      return 'health';
    default:
      return undefined;
  }
}

function buildSyncReply(result: AttachLocalSessionResult): string {
  if (!result.attached || !result.sessionId) {
    return result.error || '\u672a\u627e\u5230\u53ef\u8fde\u63a5\u7684\u672c\u5730 Codex \u4f1a\u8bdd\u3002';
  }

  const lines = [
    `\u5df2\u8fde\u63a5\u5f53\u524d\u804a\u5929\u5230\u672c\u5730 Codex \u4f1a\u8bdd\uff1a${result.sessionId}`,
  ];

  if (result.source) {
    lines.push(`\u6765\u6e90\uff1a${result.source === 'vscode' ? 'Codex Desktop' : result.source}`);
  }

  if (result.title) {
    lines.push(`\u6807\u9898\uff1a${result.title}`);
  }

  return lines.join('\n');
}

function buildResetSuffix(result: StopPeerResult): string {
  if (!result.stoppedActiveTask && result.clearedQueuedTasks === 0) {
    return '';
  }

  const parts: string[] = [];

  if (result.stoppedActiveTask) {
    parts.push(`\u5df2\u505c\u6b62\u5f53\u524d\u4efb\u52a1${result.activeTaskId ? ` #${result.activeTaskId}` : ''}`);
  }

  if (result.clearedQueuedTasks > 0) {
    parts.push(`\u5df2\u6e05\u7a7a ${result.clearedQueuedTasks} \u4e2a\u6392\u961f\u4efb\u52a1`);
  }

  return ` ${parts.join('\uff0c')}\u3002`;
}

function buildStopReply(result: StopPeerResult): string {
  if (!result.stoppedActiveTask && result.clearedQueuedTasks === 0) {
    return '\u5f53\u524d\u804a\u5929\u6ca1\u6709\u8fd0\u884c\u4e2d\u6216\u6392\u961f\u4e2d\u7684\u4efb\u52a1\u3002';
  }

  const parts: string[] = [];

  if (result.stoppedActiveTask) {
    parts.push(`\u5df2\u505c\u6b62\u4efb\u52a1 #${result.activeTaskId}`);
  } else {
    parts.push('\u5f53\u524d\u6ca1\u6709\u8fd0\u884c\u4e2d\u7684\u4efb\u52a1');
  }

  parts.push(`\u5df2\u6e05\u7a7a ${result.clearedQueuedTasks} \u4e2a\u6392\u961f\u4efb\u52a1`);
  return `${parts.join('\uff0c')}\u3002`;
}

async function sendCommandReply(
  sender: SenderLike,
  toUserId: string,
  contextToken: string,
  text: string,
): Promise<void> {
  for (const chunk of splitMessage(text)) {
    await sender.sendText(toUserId, contextToken, chunk);
  }
}

export async function handleGatewayCommand(
  options: HandleGatewayCommandOptions,
): Promise<GatewayCommandName | undefined> {
  if (options.hasImage) {
    return undefined;
  }

  const command = parseGatewayCommand(options.userText);
  if (!command) {
    return undefined;
  }

  switch (command) {
    case 'new': {
      const result = await options.runtime.resetPeer(options.fromUserId);
      await sendCommandReply(
        options.sender,
        options.fromUserId,
        options.contextToken,
        `\u5df2\u4e3a\u5f53\u524d\u804a\u5929\u5f00\u542f\u65b0\u4f1a\u8bdd\u3002\u4f60\u7684\u4e0b\u4e00\u6761\u6d88\u606f\u5c06\u5f00\u542f\u5168\u65b0\u7684 Codex \u7ebf\u7a0b\u3002${buildResetSuffix(result)}`,
      );
      return command;
    }
    case 'sync': {
      const result = await options.runtime.attachPeerToLatestLocalSession(options.fromUserId);
      await sendCommandReply(
        options.sender,
        options.fromUserId,
        options.contextToken,
        buildSyncReply(result),
      );
      return command;
    }
    case 'unsync': {
      const detached = await options.runtime.detachPeerLocalSession(options.fromUserId);
      await sendCommandReply(
        options.sender,
        options.fromUserId,
        options.contextToken,
        detached
          ? '\u5df2\u65ad\u5f00\u5f53\u524d\u804a\u5929\u4e0e\u672c\u5730 Codex \u7a97\u53e3\u7684\u540c\u6b65\u3002'
          : '\u5f53\u524d\u804a\u5929\u6ca1\u6709\u8fde\u63a5\u672c\u5730 Codex \u7a97\u53e3\u3002',
      );
      return command;
    }
    case 'status':
      await sendCommandReply(
        options.sender,
        options.fromUserId,
        options.contextToken,
        renderStatus(
          options.runtime.getSession(options.fromUserId),
          options.runtime.getPeerSnapshot(options.fromUserId),
        ),
      );
      return command;
    case 'token':
      await sendCommandReply(
        options.sender,
        options.fromUserId,
        options.contextToken,
        renderTokenSummary(options.runtime.getSession(options.fromUserId)),
      );
      return command;
    case 'task':
      await sendCommandReply(
        options.sender,
        options.fromUserId,
        options.contextToken,
        renderTaskQueue(options.runtime.getPeerSnapshot(options.fromUserId)),
      );
      return command;
    case 'stop': {
      const result = await options.runtime.stopPeer(options.fromUserId);
      const text = buildStopReply(result);
      await sendCommandReply(options.sender, options.fromUserId, options.contextToken, text);
      return command;
    }
    case 'health':
      await sendCommandReply(
        options.sender,
        options.fromUserId,
        options.contextToken,
        renderHealth(options.runtime.getHealthSnapshot()),
      );
      return command;
  }
}
