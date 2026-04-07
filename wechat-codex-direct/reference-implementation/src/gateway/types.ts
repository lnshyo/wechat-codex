export type TokenTurnRole = 'user' | 'assistant';

export interface TokenTurn {
  role: TokenTurnRole;
  preview: string;
  estimatedTokens: number;
  createdAt: string;
}

export interface TokenLedger {
  budgetTokens: number;
  reservedReplyTokens: number;
  estimatedCommittedTokens: number;
  estimatedPendingTokens: number;
  estimatedRemainingTokens: number;
  turns: TokenTurn[];
}

export type GatewayTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted';

export interface GatewayTaskSummary {
  taskId: string;
  preview: string;
  hasImage: boolean;
  status: GatewayTaskStatus;
  createdAt: string;
  finishedAt: string;
}

export interface GatewaySessionState {
  lastTaskSummary?: GatewayTaskSummary;
  lastError?: string;
  tokenLedger: TokenLedger;
  statusUpdatedAt: string;
}

export interface QueuedTask {
  id: string;
  peerUserId: string;
  contextToken: string;
  promptText: string;
  preview: string;
  imagePayloads: string[];
  hasImage: boolean;
  createdAt: string;
  status: 'queued' | 'running';
  estimatedPromptTokens: number;
  generation: number;
}

export interface GatewayTaskExecutionResult {
  aborted: boolean;
  error?: string;
  text: string;
  threadId?: string;
  threadReset?: boolean;
}

export interface PeerRuntimeSnapshot {
  activeTask?: QueuedTask;
  queuedTasks: QueuedTask[];
}

export interface StopPeerResult {
  stoppedActiveTask: boolean;
  clearedQueuedTasks: number;
  activeTaskId?: string;
}

export interface GatewayHealthSnapshot {
  accountId: string;
  bridgeProcessId: number;
  bridgeStarted: boolean;
  serviceRunning: boolean;
  servicePid?: number;
  serviceStartedAt?: string;
  codexExecutablePath?: string;
  codexExecutableError?: string;
  activePeerCount: number;
  totalQueuedTasks: number;
  lastRuntimeError?: string;
}
