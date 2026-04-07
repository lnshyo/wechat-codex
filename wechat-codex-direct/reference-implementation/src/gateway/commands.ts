import type { Session } from '../session.js';
import { renderHealth, renderStatus, renderTaskQueue, renderTokenSummary } from './render.js';
import { splitMessage } from './task-utils.js';
import type { GatewayHealthSnapshot, PeerRuntimeSnapshot, StopPeerResult } from './types.js';

export type GatewayCommandName = 'new' | 'status' | 'token' | 'task' | 'stop' | 'health';

interface SenderLike {
  sendText(toUserId: string, contextToken: string, text: string): Promise<void>;
}

interface RuntimeLike {
  getSession(peerUserId: string): Session;
  getPeerSnapshot(peerUserId: string): PeerRuntimeSnapshot;
  getHealthSnapshot(): GatewayHealthSnapshot;
  stopPeer(peerUserId: string): Promise<StopPeerResult>;
  resetPeer(peerUserId: string): Promise<StopPeerResult>;
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
      const suffix =
        result.stoppedActiveTask || result.clearedQueuedTasks > 0
          ? ` Cleared ${result.stoppedActiveTask ? 'the active task' : 'no active task'} and ${result.clearedQueuedTasks} queued task(s).`
          : '';
      await sendCommandReply(
        options.sender,
        options.fromUserId,
        options.contextToken,
        `Started a new session for this chat. Your next message will begin a fresh Codex thread.${suffix}`,
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
      const text =
        !result.stoppedActiveTask && result.clearedQueuedTasks === 0
          ? 'No active or queued task for this chat.'
          : `Stopped ${result.stoppedActiveTask ? `task #${result.activeTaskId}` : 'no active task'} and cleared ${result.clearedQueuedTasks} queued task(s).`;
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
