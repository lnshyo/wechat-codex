import type { Config } from '../config.js';
import type { Session } from '../session.js';
import { splitMessage } from './task-utils.js';
import {
  appendCompletedTurns,
  applyTokenLedgerConfig,
  createGatewayState,
  estimatePromptTokens,
  syncTokenLedgerRuntime,
} from './tokens.js';
import type {
  GatewayHealthSnapshot,
  GatewayTaskExecutionResult,
  GatewayTaskSummary,
  PeerRuntimeSnapshot,
  QueuedTask,
  StopPeerResult,
} from './types.js';

interface SessionStoreLike {
  load(accountId: string, peerUserId: string): Session;
  clear(accountId: string, peerUserId: string): Session;
  update(
    accountId: string,
    peerUserId: string,
    updater: (session: Session) => Session | void,
  ): Session;
}

interface SenderLike {
  sendText(toUserId: string, contextToken: string, text: string): Promise<void>;
}

interface ExecuteTaskOptions {
  accountId: string;
  peerUserId: string;
  task: QueuedTask;
  abortController: AbortController;
  config: Config;
}

interface GatewayRuntimeDeps {
  accountId: string;
  sessionStore: SessionStoreLike;
  sender: SenderLike;
  getConfig(): Config;
  executeTask(options: ExecuteTaskOptions): Promise<GatewayTaskExecutionResult>;
  inspectHealthBase(): Omit<
    GatewayHealthSnapshot,
    'activePeerCount' | 'totalQueuedTasks' | 'lastRuntimeError'
  >;
}

export interface QueueMessageInput {
  peerUserId: string;
  contextToken: string;
  promptText: string;
  preview: string;
  imagePayloads: string[];
  hasImage: boolean;
}

interface ActiveTaskState {
  task: QueuedTask;
  abortController: AbortController;
}

interface PeerRuntimeState {
  nextTaskId: number;
  generation: number;
  queue: QueuedTask[];
  active?: ActiveTaskState;
  draining: boolean;
}

const DEFAULT_MAX_QUEUED_TASKS = 5;

function createPeerRuntimeState(): PeerRuntimeState {
  return {
    nextTaskId: 1,
    generation: 0,
    queue: [],
    draining: false,
  };
}

function buildPeerKey(accountId: string, peerUserId: string): string {
  return `${accountId}::${peerUserId}`;
}

function buildTaskSummary(task: QueuedTask, status: GatewayTaskSummary['status']): GatewayTaskSummary {
  return {
    taskId: task.id,
    preview: task.preview,
    hasImage: task.hasImage,
    status,
    createdAt: task.createdAt,
    finishedAt: new Date().toISOString(),
  };
}

export function createGatewayRuntime(deps: GatewayRuntimeDeps) {
  const peerStates = new Map<string, PeerRuntimeState>();
  let lastRuntimeError: string | undefined;

  function getPeerState(peerUserId: string): PeerRuntimeState {
    const peerKey = buildPeerKey(deps.accountId, peerUserId);
    const existing = peerStates.get(peerKey);
    if (existing) {
      return existing;
    }

    const created = createPeerRuntimeState();
    peerStates.set(peerKey, created);
    return created;
  }

  function getVisibleActiveTask(state: PeerRuntimeState): QueuedTask | undefined {
    if (!state.active || state.active.task.generation !== state.generation) {
      return undefined;
    }

    return state.active.task;
  }

  function getVisibleQueue(state: PeerRuntimeState): QueuedTask[] {
    return state.queue.filter((task) => task.generation === state.generation);
  }

  function getPendingTokens(state: PeerRuntimeState): number {
    const active = getVisibleActiveTask(state);
    const activeTokens = active ? active.estimatedPromptTokens : 0;
    const queuedTokens = getVisibleQueue(state).reduce(
      (sum, task) => sum + task.estimatedPromptTokens,
      0,
    );

    return activeTokens + queuedTokens;
  }

  function updatePeerSession(peerUserId: string): Session {
    const state = getPeerState(peerUserId);
    const config = deps.getConfig();

    return deps.sessionStore.update(deps.accountId, peerUserId, (session) => {
      const gateway = session.gateway ?? createGatewayState(
        config.sessionTokenBudget,
        config.sessionReplyReserveTokens,
      );
      const ledger = applyTokenLedgerConfig(
        gateway.tokenLedger,
        config.sessionTokenBudget,
        config.sessionReplyReserveTokens,
      );

      return {
        ...session,
        state: getVisibleActiveTask(state) ? 'processing' : 'idle',
        gateway: {
          ...gateway,
          tokenLedger: syncTokenLedgerRuntime(ledger, getPendingTokens(state)),
          statusUpdatedAt: new Date().toISOString(),
        },
      };
    });
  }

  async function sendLocalText(peerUserId: string, contextToken: string, text: string): Promise<void> {
    for (const chunk of splitMessage(text)) {
      await deps.sender.sendText(peerUserId, contextToken, chunk);
    }
  }

  async function finalizeTask(
    peerUserId: string,
    task: QueuedTask,
    result: GatewayTaskExecutionResult,
  ): Promise<void> {
    const state = getPeerState(peerUserId);
    const isCurrentGeneration = task.generation === state.generation;
    const config = deps.getConfig();
    const pendingWithoutCurrent = getVisibleQueue(state).reduce(
      (sum, queuedTask) => sum + queuedTask.estimatedPromptTokens,
      0,
    );

    if (!isCurrentGeneration) {
      return;
    }

    if (result.threadReset) {
      deps.sessionStore.update(deps.accountId, peerUserId, (session) => {
        const gateway = session.gateway ?? createGatewayState(
          config.sessionTokenBudget,
          config.sessionReplyReserveTokens,
        );

        return {
          ...session,
          gateway: {
            ...gateway,
            tokenLedger: syncTokenLedgerRuntime(
              applyTokenLedgerConfig(
                undefined,
                config.sessionTokenBudget,
                config.sessionReplyReserveTokens,
              ),
              pendingWithoutCurrent,
            ),
            statusUpdatedAt: new Date().toISOString(),
          },
        };
      });
    }

    if (result.aborted) {
      deps.sessionStore.update(deps.accountId, peerUserId, (session) => {
        const gateway = session.gateway ?? createGatewayState(
          config.sessionTokenBudget,
          config.sessionReplyReserveTokens,
        );

        return {
          ...session,
          state: pendingWithoutCurrent > 0 ? 'processing' : 'idle',
          gateway: {
            ...gateway,
            lastTaskSummary: buildTaskSummary(task, 'aborted'),
            tokenLedger: syncTokenLedgerRuntime(
              applyTokenLedgerConfig(
                gateway.tokenLedger,
                config.sessionTokenBudget,
                config.sessionReplyReserveTokens,
              ),
              pendingWithoutCurrent,
            ),
            statusUpdatedAt: new Date().toISOString(),
          },
        };
      });
      return;
    }

    if (result.error) {
      lastRuntimeError = result.error;
      deps.sessionStore.update(deps.accountId, peerUserId, (session) => {
        const gateway = session.gateway ?? createGatewayState(
          config.sessionTokenBudget,
          config.sessionReplyReserveTokens,
        );

        return {
          ...session,
          state: pendingWithoutCurrent > 0 ? 'processing' : 'idle',
          gateway: {
            ...gateway,
            lastTaskSummary: buildTaskSummary(task, 'failed'),
            lastError: result.error,
            tokenLedger: syncTokenLedgerRuntime(
              applyTokenLedgerConfig(
                gateway.tokenLedger,
                config.sessionTokenBudget,
                config.sessionReplyReserveTokens,
              ),
              pendingWithoutCurrent,
            ),
            statusUpdatedAt: new Date().toISOString(),
          },
        };
      });
      await sendLocalText(peerUserId, task.contextToken, 'Request failed. Please try again.');
      return;
    }

    if (!result.text) {
      const emptyContentError = 'Codex did not return any content.';
      lastRuntimeError = emptyContentError;
      deps.sessionStore.update(deps.accountId, peerUserId, (session) => {
        const gateway = session.gateway ?? createGatewayState(
          config.sessionTokenBudget,
          config.sessionReplyReserveTokens,
        );

        return {
          ...session,
          state: pendingWithoutCurrent > 0 ? 'processing' : 'idle',
          gateway: {
            ...gateway,
            lastTaskSummary: buildTaskSummary(task, 'failed'),
            lastError: emptyContentError,
            tokenLedger: syncTokenLedgerRuntime(
              applyTokenLedgerConfig(
                gateway.tokenLedger,
                config.sessionTokenBudget,
                config.sessionReplyReserveTokens,
              ),
              pendingWithoutCurrent,
            ),
            statusUpdatedAt: new Date().toISOString(),
          },
        };
      });
      await sendLocalText(peerUserId, task.contextToken, emptyContentError);
      return;
    }

    await sendLocalText(peerUserId, task.contextToken, result.text);

    deps.sessionStore.update(deps.accountId, peerUserId, (session) => {
      const gateway = session.gateway ?? createGatewayState(
        config.sessionTokenBudget,
        config.sessionReplyReserveTokens,
      );
      const syncedLedger = syncTokenLedgerRuntime(
        applyTokenLedgerConfig(
          gateway.tokenLedger,
          config.sessionTokenBudget,
          config.sessionReplyReserveTokens,
        ),
        pendingWithoutCurrent,
      );

      return {
        ...session,
        state: pendingWithoutCurrent > 0 ? 'processing' : 'idle',
        gateway: {
          ...gateway,
          lastTaskSummary: buildTaskSummary(task, 'completed'),
          lastError: undefined,
          tokenLedger: appendCompletedTurns(
            syncedLedger,
            task.promptText,
            task.estimatedPromptTokens,
            result.text,
          ),
          statusUpdatedAt: new Date().toISOString(),
        },
      };
    });
  }

  async function drainPeerQueue(peerUserId: string): Promise<void> {
    const state = getPeerState(peerUserId);
    if (state.draining) {
      return;
    }

    state.draining = true;

    try {
      while (!state.active && state.queue.length > 0) {
        const nextTask = state.queue.shift();
        if (!nextTask) {
          continue;
        }

        const abortController = new AbortController();
        state.active = {
          task: {
            ...nextTask,
            status: 'running',
          },
          abortController,
        };
        updatePeerSession(peerUserId);

        let result: GatewayTaskExecutionResult;
        try {
          result = await deps.executeTask({
            accountId: deps.accountId,
            peerUserId,
            task: state.active.task,
            abortController,
            config: deps.getConfig(),
          });
        } catch (error) {
          result = {
            aborted: false,
            text: '',
            error: error instanceof Error ? error.message : String(error),
          };
        }

        await finalizeTask(peerUserId, state.active.task, result);
        state.active = undefined;
        updatePeerSession(peerUserId);
      }
    } finally {
      state.draining = false;
    }
  }

  async function enqueueMessage(input: QueueMessageInput): Promise<void> {
    const state = getPeerState(input.peerUserId);
    const hasExecutorInFlight = Boolean(state.active) || state.draining;
    const visibleQueue = getVisibleQueue(state);
    const maxQueuedTasks = deps.getConfig().maxQueuedTasksPerPeer ?? DEFAULT_MAX_QUEUED_TASKS;

    if (visibleQueue.length >= maxQueuedTasks) {
      await sendLocalText(
        input.peerUserId,
        input.contextToken,
        `Task queue is full (${maxQueuedTasks}). Send /task or /stop first.`,
      );
      return;
    }

    const task: QueuedTask = {
      id: String(state.nextTaskId++),
      peerUserId: input.peerUserId,
      contextToken: input.contextToken,
      promptText: input.promptText,
      preview: input.preview,
      imagePayloads: [...input.imagePayloads],
      hasImage: input.hasImage,
      createdAt: new Date().toISOString(),
      status: 'queued',
      estimatedPromptTokens: estimatePromptTokens(input.promptText, input.imagePayloads.length),
      generation: state.generation,
    };

    state.queue.push(task);
    updatePeerSession(input.peerUserId);

    if (hasExecutorInFlight) {
      const queuePosition = getVisibleQueue(state).length;
      await sendLocalText(
        input.peerUserId,
        input.contextToken,
        `Queued task #${task.id} at position ${queuePosition}. Send /task to inspect the queue.`,
      );
    }

    void drainPeerQueue(input.peerUserId);
  }

  async function stopPeer(peerUserId: string): Promise<StopPeerResult> {
    const state = getPeerState(peerUserId);
    const activeTask = getVisibleActiveTask(state);
    const clearedQueuedTasks = getVisibleQueue(state).length;

    state.generation += 1;
    state.queue = [];

    if (state.active) {
      state.active.abortController.abort();
    }

    deps.sessionStore.update(deps.accountId, peerUserId, (session) => {
      const config = deps.getConfig();
      const gateway = session.gateway ?? createGatewayState(
        config.sessionTokenBudget,
        config.sessionReplyReserveTokens,
      );

      return {
        ...session,
        state: 'idle',
        gateway: {
          ...gateway,
          lastTaskSummary: activeTask ? buildTaskSummary(activeTask, 'aborted') : gateway.lastTaskSummary,
          tokenLedger: syncTokenLedgerRuntime(
            applyTokenLedgerConfig(
              gateway.tokenLedger,
              config.sessionTokenBudget,
              config.sessionReplyReserveTokens,
            ),
            0,
          ),
          statusUpdatedAt: new Date().toISOString(),
        },
      };
    });

    return {
      stoppedActiveTask: Boolean(activeTask),
      clearedQueuedTasks,
      activeTaskId: activeTask?.id,
    };
  }

  async function resetPeer(peerUserId: string): Promise<StopPeerResult> {
    const result = await stopPeer(peerUserId);
    deps.sessionStore.clear(deps.accountId, peerUserId);
    return result;
  }

  function getPeerSnapshot(peerUserId: string): PeerRuntimeSnapshot {
    const state = getPeerState(peerUserId);
    return {
      activeTask: getVisibleActiveTask(state),
      queuedTasks: getVisibleQueue(state),
    };
  }

  function getHealthSnapshot(): GatewayHealthSnapshot {
    const activePeerCount = [...peerStates.values()].filter((state) => Boolean(getVisibleActiveTask(state)))
      .length;
    const totalQueuedTasks = [...peerStates.values()].reduce(
      (sum, state) => sum + getVisibleQueue(state).length,
      0,
    );

    return {
      ...deps.inspectHealthBase(),
      activePeerCount,
      totalQueuedTasks,
      lastRuntimeError,
    };
  }

  function getSession(peerUserId: string): Session {
    return updatePeerSession(peerUserId);
  }

  function abortAll(): void {
    for (const state of peerStates.values()) {
      state.generation += 1;
      state.queue = [];
      state.active?.abortController.abort();
    }
  }

  return {
    abortAll,
    enqueueMessage,
    stopPeer,
    resetPeer,
    getPeerSnapshot,
    getHealthSnapshot,
    getSession,
  };
}
