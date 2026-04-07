#!/usr/bin/env bun

import path from "node:path";

import {
  createBridgeAdapter,
  resolveDefaultAdapterCommand,
} from "./bridge-adapters.ts";
import { delay } from "./bridge-adapters.shared.ts";
import { touchCodexDesktopThread } from "./codex-desktop-sync.ts";
import { forwardWechatFinalReply } from "./bridge-final-reply.ts";
import { migrateLegacyChannelFiles } from "../wechat/channel-config.ts";
import { BridgeStateStore } from "./bridge-state.ts";
import { reapOrphanedOpencodeProcesses, reapPeerBridgeProcesses } from "./bridge-process-reaper.ts";
import { clearLocalCompanionEndpoint } from "../companion/local-companion-link.ts";
import type {
  ApprovalRequest,
  BridgeAdapter,
  BridgeAdapterKind,
  BridgeEvent,
  BridgeLifecycleMode,
  PendingApproval,
} from "./bridge-types.ts";
import {
  buildWechatInboundPrompt,
  buildOneTimeCode,
  formatApprovalMessage,
  formatPendingApprovalReminder,
  formatDuration,
  formatMirroredUserInputMessage,
  formatSessionSwitchMessage,
  formatStatusReport,
  formatTaskFailedMessage,
  MESSAGE_START_GRACE_MS,
  nowIso,
  OutputBatcher,
  parseLocalCodexControlCommand,
  parseWechatControlCommand,
  truncatePreview,
} from "./bridge-utils.ts";
import {
  classifyWechatTransportError,
  DEFAULT_LONG_POLL_TIMEOUT_MS,
  WeChatTransport,
  describeWechatTransportError,
  type InboundWechatMessage,
} from "../wechat/wechat-transport.ts";
import {
  checkForUpdate,
  formatUpdateMessage,
} from "../utils/version-checker.ts";

type BridgeCliOptions = {
  adapter: BridgeAdapterKind;
  command: string;
  cwd: string;
  profile?: string;
  lifecycle: BridgeLifecycleMode;
  detached: boolean;
};

type ActiveTask = {
  startedAt: number;
  inputPreview: string;
};

type WechatSendContext =
  | "message"
  | "final_reply"
  | "notice"
  | "approval_required"
  | "mirrored_user_input"
  | "session_switched"
  | "thread_switched"
  | "task_failed"
  | "fatal_error"
  | "inbound_error";

type ReplayTrackedWechatContext = "final_reply" | "mirrored_user_input";

type DesktopThreadToucher = (
  threadId?: string | null,
  threadName?: string,
  options?: {
    triggerReason?: string;
  },
) => void;

const POLL_RETRY_BASE_MS = 1_000;
const POLL_RETRY_MAX_MS = 30_000;
const PARENT_PROCESS_POLL_MS = 5_000;

function log(message: string): void {
  process.stderr.write(`[wechat-bridge] ${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`[wechat-bridge] ERROR: ${message}\n`);
}

function computePollRetryDelayMs(consecutiveFailures: number): number {
  const normalizedFailures = Math.max(1, consecutiveFailures);
  const exponent = Math.min(normalizedFailures - 1, 5);
  return Math.min(POLL_RETRY_MAX_MS, POLL_RETRY_BASE_MS * 2 ** exponent);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function formatUserFacingBridgeFatalError(message: string): string {
  return `桥接错误：${message.replace(/\s+Recent app-server log:.*$/s, "").trim()}`;
}

export function shouldForwardBridgeEventToWechat(
  adapter: BridgeAdapterKind,
  eventType: BridgeEvent["type"],
): boolean {
  if (adapter === "codex") {
    switch (eventType) {
      case "stdout":
      case "stderr":
        return false;
      default:
        return true;
    }
  }

  if (adapter !== "opencode") {
    return true;
  }

  switch (eventType) {
    case "stdout":
    case "stderr":
    case "notice":
    case "mirrored_user_input":
    case "thread_switched":
      return false;
    default:
      return true;
  }
}

export function formatUserFacingInboundError(params: {
  adapter: BridgeAdapterKind;
  cwd?: string;
  errorText: string;
  isUserFacingShellRejection: boolean;
}): string {
  const { adapter, cwd, errorText, isUserFacingShellRejection } = params;
  if (isUserFacingShellRejection) {
    return errorText;
  }

  if (
    adapter === "opencode" &&
    /opencode companion is not connected/i.test(errorText)
  ) {
    return cwd
      ? `当前桥接工作区的 OpenCode companion 未连接：\n${cwd}\n请在该目录运行 "wechat-opencode" 重新连接当前本地终端；如果要切换项目，请先运行 "wechat-bridge-opencode"，再在目标项目中运行 "wechat-opencode"。`
      : 'OpenCode companion 未连接。请先在当前目录运行 "wechat-opencode" 重新连接，然后再重试。';
  }

  return `桥接错误：${errorText}`;
}

export function formatWechatSendFailureLogEntry(params: {
  context: WechatSendContext;
  recipientId: string;
  error: unknown;
}): string {
  return `wechat_send_failed: context=${params.context} recipient=${params.recipientId} error=${truncatePreview(describeWechatTransportError(params.error), 400)}`;
}

function hasForwardedTurnEvent(
  stateStore: BridgeStateStore,
  context: ReplayTrackedWechatContext,
  turnId?: string,
): boolean {
  const normalizedTurnId = typeof turnId === "string" ? turnId.trim() : "";
  if (!normalizedTurnId) {
    return false;
  }

  const store = stateStore as BridgeStateStore & {
    hasForwardedTurnEvent?: (context: ReplayTrackedWechatContext, turnId: string) => boolean;
  };
  return store.hasForwardedTurnEvent?.(context, normalizedTurnId) ?? false;
}

function rememberForwardedTurnEvent(
  stateStore: BridgeStateStore,
  context: ReplayTrackedWechatContext,
  turnId?: string,
): void {
  const normalizedTurnId = typeof turnId === "string" ? turnId.trim() : "";
  if (!normalizedTurnId) {
    return;
  }

  const store = stateStore as BridgeStateStore & {
    rememberForwardedTurnEvent?: (
      context: ReplayTrackedWechatContext,
      turnId: string,
    ) => void;
  };
  store.rememberForwardedTurnEvent?.(context, normalizedTurnId);
}

function getSharedSessionId(
  state: Pick<BridgeAdapter["getState"] extends () => infer T ? T : never, "sharedSessionId" | "sharedThreadId"> |
    Pick<BridgeStateStore["getState"] extends () => infer T ? T : never, "sharedSessionId" | "sharedThreadId">,
): string | undefined {
  return state.sharedSessionId ?? state.sharedThreadId;
}

function getBoundSessionId(
  state: Pick<BridgeStateStore["getState"] extends () => infer T ? T : never, "boundSessionId" | "boundThreadId">,
): string | undefined {
  return state.boundSessionId ?? state.boundThreadId;
}

function getCurrentAdapterSessionId(
  state: ReturnType<BridgeAdapter["getState"]>,
): string | undefined {
  return state.sharedSessionId ?? state.sharedThreadId ?? state.activeRuntimeSessionId;
}

export function getCodexPinnedSessionIdForRoute(params: {
  bridgeState: ReturnType<BridgeStateStore["getState"]>;
  adapterState: ReturnType<BridgeAdapter["getState"]>;
}): string | null {
  if (params.bridgeState.adapter !== "codex") {
    return null;
  }

  if (params.bridgeState.routeMode === "bound") {
    return getBoundSessionId(params.bridgeState) ?? null;
  }

  if (params.bridgeState.routeMode === "independent") {
    if (params.bridgeState.routeIndependentOnce) {
      return null;
    }

    return (
      getCurrentAdapterSessionId(params.adapterState) ??
      getSharedSessionId(params.bridgeState) ??
      null
    );
  }

  return null;
}

export function getCodexDesktopThreadToTouch(params: {
  adapterKind: BridgeAdapterKind;
  bridgeState: ReturnType<BridgeStateStore["getState"]>;
  adapterState: ReturnType<BridgeAdapter["getState"]>;
  candidateThreadId?: string | null;
}): string | null {
  if (params.adapterKind !== "codex") {
    return null;
  }

  if (params.bridgeState.routeMode !== "bound") {
    return null;
  }

  const boundSessionId = getBoundSessionId(params.bridgeState) ?? null;
  const candidateThreadId =
    typeof params.candidateThreadId === "string"
      ? params.candidateThreadId.trim()
      : "";

  if (candidateThreadId) {
    if (boundSessionId && candidateThreadId !== boundSessionId) {
      return boundSessionId;
    }

    return candidateThreadId;
  }

  return (
    boundSessionId ??
    getCurrentAdapterSessionId(params.adapterState) ??
    getSharedSessionId(params.bridgeState) ??
    null
  );
}

function maybeTouchCodexDesktopThread(params: {
  adapter: BridgeAdapter;
  options: Pick<BridgeCliOptions, "adapter">;
  stateStore: BridgeStateStore;
  candidateThreadId?: string | null;
  triggerReason?: string;
  touchDesktopThread?: DesktopThreadToucher;
}): void {
  const threadId = getCodexDesktopThreadToTouch({
    adapterKind: params.options.adapter,
    bridgeState: params.stateStore.getState(),
    adapterState: params.adapter.getState(),
    candidateThreadId: params.candidateThreadId,
  });

  if (!threadId) {
    return;
  }

  (params.touchDesktopThread ?? touchCodexDesktopThread)(threadId, undefined, {
    triggerReason: params.triggerReason,
  });
}

async function syncCodexPinnedSessionForRoute(
  stateStore: BridgeStateStore,
  adapter: BridgeAdapter,
): Promise<void> {
  const state = stateStore.getState();
  if (state.adapter !== "codex" || !adapter.setPinnedSession) {
    return;
  }

  const pinnedSessionId = getCodexPinnedSessionIdForRoute({
    bridgeState: state,
    adapterState: adapter.getState(),
  });
  await adapter.setPinnedSession(pinnedSessionId);
}

export async function bindCurrentCodexThread(params: {
  adapter: BridgeAdapter;
  stateStore: BridgeStateStore;
  queueWechatMessage: (
    senderId: string,
    text: string,
    context?: WechatSendContext,
  ) => Promise<void>;
  senderId: string;
  touchDesktopThread?: DesktopThreadToucher;
}): Promise<string | null> {
  const currentSessionId =
    getCurrentAdapterSessionId(params.adapter.getState()) ??
    getSharedSessionId(params.stateStore.getState());

  if (!currentSessionId) {
    await params.queueWechatMessage(
      params.senderId,
      "当前 Codex 线程还不可用，暂时无法完成绑定。",
      "notice",
    );
    return null;
  }

  params.stateStore.switchRouteToBound();
  params.stateStore.lockBoundSession(currentSessionId);
  await syncCodexPinnedSessionForRoute(params.stateStore, params.adapter);
  maybeTouchCodexDesktopThread({
    adapter: params.adapter,
    options: { adapter: "codex" },
    stateStore: params.stateStore,
    candidateThreadId: currentSessionId,
    triggerReason: "bind_current_thread",
    touchDesktopThread: params.touchDesktopThread,
  });
  params.stateStore.appendLog(`bound_thread_locked: ${currentSessionId}`);
  await params.queueWechatMessage(
    params.senderId,
    `已把当前 Codex 线程绑定为主线程：${currentSessionId.slice(0, 12)}`,
    "notice",
  );
  return currentSessionId;
}

function shouldAutoConfirmApproval(adapter: BridgeAdapterKind): boolean {
  return adapter === "codex";
}

export async function restoreBoundCodexRouteAfterTemporaryTurn(params: {
  activeTask: ActiveTask | null;
  adapter: BridgeAdapter;
  stateStore: BridgeStateStore;
  queueWechatMessage: (
    senderId: string,
    text: string,
    context?: WechatSendContext,
  ) => Promise<void>;
  senderId: string;
  touchDesktopThread?: DesktopThreadToucher;
}): Promise<void> {
  if (!params.activeTask) {
    return;
  }

  const routeState = params.stateStore.getState();
  if (
    routeState.adapter !== "codex" ||
    routeState.routeMode !== "independent" ||
    !routeState.routeIndependentOnce
  ) {
    return;
  }

  params.stateStore.completeIndependentOnce();
  await syncCodexPinnedSessionForRoute(params.stateStore, params.adapter);
}

export function shouldWatchParentProcess(options: {
  startupParentPid: number;
  attachedToTerminal: boolean;
  lifecycle: BridgeLifecycleMode;
  detached: boolean;
}): boolean {
  if (options.detached) {
    return false;
  }

  return (
    options.startupParentPid > 1 &&
    (options.attachedToTerminal || options.lifecycle === "companion_bound")
  );
}

function toPendingApproval(request: ApprovalRequest | PendingApproval): PendingApproval {
  if (typeof (request as PendingApproval).code === "string") {
    return request as PendingApproval;
  }

  return {
    ...request,
    code: buildOneTimeCode(),
    createdAt: nowIso(),
  };
}

export function parseCliArgs(argv: string[]): BridgeCliOptions {
  let adapter: BridgeAdapterKind | null = null;
  let commandOverride: string | undefined;
  let cwd = process.cwd();
  let profile: string | undefined;
  let lifecycle: BridgeLifecycleMode = "persistent";
  let detached = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case "--adapter":
        if (!next || !["codex", "claude", "opencode", "shell"].includes(next)) {
          throw new Error(`Invalid adapter: ${next ?? "(missing)"}`);
        }
        adapter = next as BridgeAdapterKind;
        i += 1;
        break;
      case "--cmd":
        if (!next) {
          throw new Error("--cmd requires a value");
        }
        commandOverride = next;
        i += 1;
        break;
      case "--cwd":
        if (!next) {
          throw new Error("--cwd requires a value");
        }
        cwd = path.resolve(next);
        i += 1;
        break;
      case "--profile":
        if (!next) {
          throw new Error("--profile requires a value");
        }
        profile = next;
        i += 1;
        break;
      case "--lifecycle":
        if (!next || !["persistent", "companion_bound"].includes(next)) {
          throw new Error(`Invalid lifecycle: ${next ?? "(missing)"}`);
        }
        lifecycle = next as BridgeLifecycleMode;
        i += 1;
        break;
      case "--shutdown-on-parent-exit":
        lifecycle = "companion_bound";
        break;
      case "--detached":
        detached = true;
        break;
      case "--help":
      case "-h":
        printUsageAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!adapter) {
    throw new Error("Missing required --adapter <codex|claude|opencode|shell>");
  }

  const defaultCommand = resolveDefaultAdapterCommand(adapter);
  return {
    adapter,
    command: commandOverride ?? defaultCommand,
    cwd,
    profile,
    lifecycle,
    detached,
  };
}

function printUsageAndExit(): never {
  process.stdout.write(
    [
      "Usage: wechat-bridge --adapter <codex|claude|opencode|shell> [--cmd <executable>] [--cwd <path>] [--profile <name-or-path>] [--lifecycle <persistent|companion_bound>]",
      "",
      "Examples:",
      "  wechat-bridge-codex",
      "  wechat-bridge-claude --cwd ~/work/my-project",
      "  wechat-bridge-opencode --cwd ~/work/my-project",
      "  wechat-bridge-shell --cmd pwsh   # headless shell executor for non-interactive commands/scripts",
      "  wechat-bridge-shell --cmd bash   # headless shell executor for non-interactive commands/scripts",
      "  wechat-bridge-codex --lifecycle companion_bound",
      "  wechat-bridge-codex --detached   # stay alive after the launcher process exits",
      "  bun run bridge:codex            # repo-local development entrypoint",
      "  bun run bridge:opencode          # repo-local development entrypoint",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

async function main(): Promise<void> {
  migrateLegacyChannelFiles(log);

  // 非阻塞地检查更新（不影响启动速度）
  setTimeout(async () => {
    try {
      const versionInfo = await checkForUpdate();
      if (versionInfo?.hasUpdate) {
        log(formatUpdateMessage(versionInfo));
      }
    } catch (error) {
      // 静默失败，不影响正常使用
    }
  }, 3000); // 延迟3秒，确保不影响启动

  const options = parseCliArgs(process.argv.slice(2));
  const transport = new WeChatTransport({ log, logError });

  const credentials = transport.getCredentials();
  if (!credentials) {
    throw new Error('No saved WeChat credentials found. Run "bun run setup" first.');
  }
  if (!credentials.userId) {
    throw new Error('Saved WeChat credentials are missing userId. Run "bun run setup" again.');
  }

  const stateStore = new BridgeStateStore({
    ...options,
    authorizedUserId: credentials.userId,
  });
  const reapedPeerPids = await reapPeerBridgeProcesses({
    logger: (message) => stateStore.appendLog(message),
  });
  if (reapedPeerPids.length > 0) {
    log(`Reaped ${reapedPeerPids.length} stale bridge process(es): ${reapedPeerPids.join(", ")}`);
  }

  if (options.adapter === "opencode") {
    const reapedOpencodePids = await reapOrphanedOpencodeProcesses({
      logger: (message) => stateStore.appendLog(message),
    });
    if (reapedOpencodePids.length > 0) {
      log(`Reaped ${reapedOpencodePids.length} orphaned opencode process(es): ${reapedOpencodePids.join(", ")}`);
    }
  }

  let lockRehydratedLogged = false;
  const ensureRuntimeOwnership = (): boolean => {
    const ownership = stateStore.verifyRuntimeOwnership();
    if (!ownership.ok) {
      if (ownership.reason === "superseded") {
        requestShutdown(
          `Bridge instance ${stateStore.getState().instanceId} was superseded by ${ownership.activeInstanceId}. Stopping duplicate bridge.`,
        );
        return false;
      }

      requestShutdown(
        `Bridge instance ${stateStore.getState().instanceId} lost the global lock to pid=${ownership.activePid} (${ownership.activeInstanceId}). Stopping duplicate bridge.`,
      );
      return false;
    }

    if (ownership.rehydratedLock && !lockRehydratedLogged) {
      lockRehydratedLogged = true;
      stateStore.appendLog(
        `lock_rehydrated: pid=${process.pid} instanceId=${stateStore.getState().instanceId} adapter=${options.adapter} cwd=${options.cwd}`,
      );
    }

    return true;
  };

  // Clear any stale endpoint left by a previous bridge for this workspace.
  // This prevents `wechat-*` companions from reconnecting to a dead bridge
  // while the new runtime is still starting up.
  clearLocalCompanionEndpoint(options.cwd);
  stateStore.appendLog(`Cleared stale companion endpoint for ${options.cwd} before adapter start.`);

  const adapter = createBridgeAdapter({
    kind: options.adapter,
    command: options.command,
    cwd: options.cwd,
    profile: options.profile,
    lifecycle: options.lifecycle,
    initialSharedSessionId:
      stateStore.getState().sharedSessionId ?? stateStore.getState().sharedThreadId,
    initialResumeConversationId: stateStore.getState().resumeConversationId,
    initialTranscriptPath: stateStore.getState().transcriptPath,
  });
  let textSendChain = Promise.resolve();
  let attachmentSendChain = Promise.resolve();
  let activeTask: ActiveTask | null = null;
  let lastOutputAt = 0;
  let lastHeartbeatAt = 0;
  let consecutivePollFailures = 0;

  const queueWechatTextAction = <T>(action: () => Promise<T>) => {
    const run = textSendChain.then(action);
    textSendChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const queueWechatAttachmentAction = <T>(action: () => Promise<T>) => {
    const run = attachmentSendChain.then(action);
    attachmentSendChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const queueWechatMessage = (
    senderId: string,
    text: string,
    context: WechatSendContext = "message",
  ) => {
    return queueWechatTextAction(async () => {
      await transport.sendText(senderId, text);
      if (context !== "message") {
        stateStore.appendLog(
          `wechat_text_sent: context=${context} recipient=${senderId} preview=${truncatePreview(text, 240)}`,
        );
      }
    }).catch((err) => {
      logError(`Failed to send WeChat ${context}: ${describeWechatTransportError(err)}`);
      stateStore.appendLog(
        formatWechatSendFailureLogEntry({
          context,
          recipientId: senderId,
          error: err,
        }),
      );
    });
  };

  const outputBatcher = new OutputBatcher(async (text) => {
    await queueWechatMessage(stateStore.getState().authorizedUserId, text);
  });
  const startupParentPid = process.ppid;
  const attachedToTerminal = Boolean(
    process.stdin.isTTY || process.stdout.isTTY || process.stderr.isTTY,
  );
  let shutdownPromise: Promise<void> | null = null;
  let requestedExitCode = 0;
  let stdinDetached = false;
  const parentWatchTimer =
    shouldWatchParentProcess({
      startupParentPid,
      attachedToTerminal,
      lifecycle: options.lifecycle,
      detached: options.detached,
    })
      ? setInterval(() => {
          if (shutdownPromise || isPidAlive(startupParentPid)) {
            return;
          }
          log(`Parent process ${startupParentPid} exited. Stopping bridge.`);
          void shutdown(0);
        }, PARENT_PROCESS_POLL_MS)
      : null;
  parentWatchTimer?.unref();

  const cleanup = async () => {
    if (parentWatchTimer) {
      clearInterval(parentWatchTimer);
    }
    try {
      await outputBatcher.flushNow();
    } catch {
      // Best effort flush.
    }
    try {
      await textSendChain;
      await attachmentSendChain;
    } catch {
      // Best effort flush.
    }
    try {
      await adapter.dispose();
    } catch {
      // Best effort shutdown.
    }
    stateStore.releaseLock();
  };

  const shutdown = async (exitCode = 0): Promise<void> => {
    requestedExitCode = exitCode;
    if (!shutdownPromise) {
      shutdownPromise = cleanup().catch((error) => {
        logError(`Shutdown cleanup failed: ${describeWechatTransportError(error)}`);
      });
    }
    await shutdownPromise;
  };

  const requestShutdown = (message: string, exitCode = 0) => {
    if (shutdownPromise) {
      return;
    }
    log(message);
    void shutdown(exitCode).finally(() => process.exit(requestedExitCode));
  };

  process.once("SIGINT", () => {
    requestShutdown("Received SIGINT. Stopping bridge.");
  });
  process.once("SIGTERM", () => {
    requestShutdown("Received SIGTERM. Stopping bridge.");
  });
  process.once("SIGHUP", () => {
    requestShutdown("Terminal session closed. Stopping bridge.");
  });
  if (process.platform === "win32") {
    process.once("SIGBREAK", () => {
      requestShutdown("Received SIGBREAK. Stopping bridge.");
    });
  }
  if (attachedToTerminal) {
    process.stdin.on("close", () => {
      if (stdinDetached) {
        return;
      }
      stdinDetached = true;
      requestShutdown("Standard input closed. Stopping bridge.");
    });
    process.stdin.on("end", () => {
      if (stdinDetached) {
        return;
      }
      stdinDetached = true;
      requestShutdown("Standard input ended. Stopping bridge.");
    });
  }
  process.on("exit", () => {
    if (parentWatchTimer) {
      clearInterval(parentWatchTimer);
    }
    stateStore.releaseLock();
  });

  try {
    wireAdapterEvents({
      adapter,
      options,
      transport,
      stateStore,
      outputBatcher,
      queueWechatAttachmentAction,
      queueWechatMessage,
      getActiveTask: () => activeTask,
      clearActiveTask: () => {
        activeTask = null;
        lastHeartbeatAt = 0;
      },
      updateLastOutputAt: () => {
        lastOutputAt = Date.now();
      },
      syncSharedSessionState: () => {
        syncSharedSessionState(stateStore, adapter);
      },
      requestShutdown,
    });

    await adapter.start();
    if (!ensureRuntimeOwnership()) {
      return;
    }
    syncSharedSessionState(stateStore, adapter);
    await syncCodexPinnedSessionForRoute(stateStore, adapter);
    maybeTouchCodexDesktopThread({
      adapter,
      options,
      stateStore,
      triggerReason: "startup_restore",
    });
    stateStore.appendLog(
      `Bridge started with adapter=${options.adapter} command=${options.command} cwd=${options.cwd}`,
    );

    log(`WeChat bridge is ready for adapter "${options.adapter}".`);
    log(`Working directory: ${options.cwd}`);
    if (options.profile) {
      log(`Profile: ${options.profile}`);
    }
    log(`Authorized WeChat user: ${credentials.userId}`);
    if (options.adapter === "codex") {
      log(
        'Start the visible Codex panel in a second terminal with: wechat-codex',
      );
    } else if (options.adapter === "opencode") {
      log(
        'Start the visible OpenCode companion in a second terminal with: wechat-opencode',
      );
    } else if (options.adapter === "claude") {
      log(
        'Start the visible Claude companion in a second terminal with: wechat-claude',
      );
    } else if (options.adapter === "shell") {
      log(
        "Shell mode runs as a headless remote executor for non-interactive commands and scripts.",
      );
    }

    while (true) {
      if (!ensureRuntimeOwnership()) {
        break;
      }

      let pollResult: Awaited<ReturnType<WeChatTransport["pollMessages"]>>;
      try {
        pollResult = await transport.pollMessages({
          timeoutMs: DEFAULT_LONG_POLL_TIMEOUT_MS,
          minCreatedAtMs: stateStore.getState().bridgeStartedAtMs - MESSAGE_START_GRACE_MS,
        });
      } catch (err) {
        const classification = classifyWechatTransportError(err);
        if (!classification.retryable) {
          throw err;
        }

        consecutivePollFailures += 1;
        const delayMs = computePollRetryDelayMs(consecutivePollFailures);
        const errorText = describeWechatTransportError(err);
        const statusDetails =
          typeof classification.statusCode === "number"
            ? ` status=${classification.statusCode}`
            : "";
        logError(
          `WeChat long poll failed (${classification.kind}${statusDetails}, attempt ${consecutivePollFailures}). Retrying in ${formatDuration(delayMs)}. ${errorText}`,
        );
        stateStore.appendLog(
          `poll_retry: kind=${classification.kind}${statusDetails} attempt=${consecutivePollFailures} delay_ms=${delayMs} error=${truncatePreview(errorText, 400)}`,
        );
        await delay(delayMs);
        continue;
      }

      if (!ensureRuntimeOwnership()) {
        break;
      }

      if (consecutivePollFailures > 0) {
        const recoveredFailures = consecutivePollFailures;
        consecutivePollFailures = 0;
        log(`WeChat long poll recovered after ${recoveredFailures} transient error(s).`);
        stateStore.appendLog(`poll_recovered: failures=${recoveredFailures}`);
      }

      if (pollResult.ignoredBacklogCount > 0) {
        stateStore.incrementIgnoredBacklog(pollResult.ignoredBacklogCount);
        stateStore.appendLog(
          `ignored_startup_backlog: count=${pollResult.ignoredBacklogCount}`,
        );
      }

      for (const message of pollResult.messages) {
        if (!ensureRuntimeOwnership()) {
          break;
        }

        stateStore.touchActivity(message.createdAt);
        let nextTask: ActiveTask | null = null;
        try {
          nextTask = await handleInboundMessage({
            message,
            options,
            stateStore,
            adapter,
            queueWechatMessage,
            outputBatcher,
          });
        } catch (err) {
          const errorText = err instanceof Error ? err.message : String(err);
          const isUserFacingShellRejection =
            err instanceof Error && err.name === "ShellCommandRejectedError";
          logError(errorText);
          stateStore.appendLog(
            `${isUserFacingShellRejection ? "inbound_rejected" : "inbound_error"}: ${errorText}`,
          );
          await queueWechatMessage(
            message.senderId,
            formatUserFacingInboundError({
              adapter: options.adapter,
              cwd: options.cwd,
              errorText,
              isUserFacingShellRejection,
            }),
            "inbound_error",
          );
        }
        if (nextTask) {
          activeTask = nextTask;
          lastHeartbeatAt = 0;
        }
        syncSharedSessionState(stateStore, adapter);
      }

      const adapterState = adapter.getState();
      const lastSignalAt = Math.max(lastHeartbeatAt, lastOutputAt || activeTask?.startedAt || 0);

      if (
        activeTask &&
        options.adapter === "shell" &&
        adapterState.status === "busy" &&
        Date.now() - lastSignalAt >= 30_000
      ) {
        lastHeartbeatAt = Date.now();
        await queueWechatMessage(
          stateStore.getState().authorizedUserId,
          `${options.adapter} is still running. Waiting for more output...`,
        );
      }
    }
  } finally {
    await shutdown(requestedExitCode);
  }
}

function syncSharedSessionState(
  stateStore: BridgeStateStore,
  adapter: BridgeAdapter,
): void {
  const persistedState = stateStore.getState();
  const persistedSessionId = getSharedSessionId(persistedState);
  const adapterState = adapter.getState();
  const adapterSessionId = getSharedSessionId(adapterState);

  if (adapterSessionId && adapterSessionId !== persistedSessionId) {
    stateStore.setSharedSessionId(adapterSessionId);
  } else if (!adapterSessionId && persistedSessionId) {
    stateStore.clearSharedSessionId();
  }

  if (persistedState.adapter !== "claude") {
    return;
  }

  if (
    adapterState.resumeConversationId !== persistedState.resumeConversationId ||
    adapterState.transcriptPath !== persistedState.transcriptPath
  ) {
    if (adapterState.resumeConversationId || adapterState.transcriptPath) {
      stateStore.setClaudeResumeState(
        adapterState.resumeConversationId,
        adapterState.transcriptPath,
      );
    } else {
      stateStore.clearClaudeResumeState();
    }
  }
}

export function wireAdapterEvents(params: {
  adapter: BridgeAdapter;
  options: BridgeCliOptions;
  transport: WeChatTransport;
  stateStore: BridgeStateStore;
  outputBatcher: OutputBatcher;
  queueWechatAttachmentAction: <T>(action: () => Promise<T>) => Promise<T>;
  queueWechatMessage: (
    senderId: string,
    text: string,
    context?: WechatSendContext,
  ) => Promise<void>;
  getActiveTask: () => ActiveTask | null;
  clearActiveTask: () => void;
  updateLastOutputAt: () => void;
  syncSharedSessionState: () => void;
  requestShutdown: (message: string, exitCode?: number) => void;
  touchDesktopThread?: DesktopThreadToucher;
}): void {
  const {
    adapter,
    options,
    transport,
    stateStore,
    outputBatcher,
    queueWechatAttachmentAction,
    queueWechatMessage,
    getActiveTask,
    clearActiveTask,
    updateLastOutputAt,
    syncSharedSessionState,
    requestShutdown,
    touchDesktopThread,
  } = params;
  const interceptedLocalControlTurnIds = new Set<string>();
  const normalizeTurnId = (turnId?: string): string =>
    typeof turnId === "string" ? turnId.trim() : "";

  adapter.setEventSink((event) => {
    syncSharedSessionState();
    const adapterState = adapter.getState();
    const bridgeState = stateStore.getState();
    if (bridgeState.pendingConfirmation && !adapterState.pendingApproval) {
      stateStore.clearPendingConfirmation();
    }
    const authorizedUserId = stateStore.getState().authorizedUserId;

    switch (event.type) {
      case "stdout":
      case "stderr":
        updateLastOutputAt();
        if (shouldForwardBridgeEventToWechat(options.adapter, event.type)) {
          outputBatcher.push(event.text);
        }
        break;
      case "final_reply":
        if (options.adapter === "codex") {
          const turnId = normalizeTurnId(event.turnId);
          if (turnId && interceptedLocalControlTurnIds.delete(turnId)) {
            stateStore.appendLog(
              `suppressed_intercepted_local_command_turn: context=final_reply turnId=${turnId}`,
            );
            break;
          }
        }
        if (
          options.adapter === "codex" &&
          hasForwardedTurnEvent(stateStore, "final_reply", event.turnId)
        ) {
          stateStore.appendLog(
            `suppressed_duplicate_turn_event: context=final_reply turnId=${event.turnId}`,
          );
          break;
        }
        void outputBatcher.flushNow().then(async () => {
          stateStore.appendLog(
            `final_reply_received: preview=${truncatePreview(event.text, 240)}`,
          );
          await forwardWechatFinalReply({
            adapter: options.adapter,
            rawText: event.text,
            sender: {
              sendText: (text) =>
                queueWechatMessage(authorizedUserId, text, "final_reply"),
              sendImage: (imagePath) =>
                queueWechatAttachmentAction(() =>
                  transport.sendImage(imagePath, { recipientId: authorizedUserId }),
                ),
              sendFile: (filePath) =>
                queueWechatAttachmentAction(() =>
                  transport.sendFile(filePath, { recipientId: authorizedUserId }),
                ),
              sendVoice: (voicePath) =>
                queueWechatAttachmentAction(() =>
                  transport.sendVoice(voicePath, authorizedUserId),
                ),
              sendVideo: (videoPath) =>
                queueWechatAttachmentAction(() =>
                  transport.sendVideo(videoPath, { recipientId: authorizedUserId }),
                ),
            },
          });
          rememberForwardedTurnEvent(stateStore, "final_reply", event.turnId);
        });
        break;
      case "status":
        if (event.message) {
          log(`${event.status}: ${event.message}`);
          stateStore.appendLog(`${event.status}: ${event.message}`);
        }
        break;
      case "notice":
        updateLastOutputAt();
        stateStore.appendLog(`${event.level}_notice: ${truncatePreview(event.text)}`);
        if (shouldForwardBridgeEventToWechat(options.adapter, event.type)) {
          void outputBatcher.flushNow().then(async () => {
            await queueWechatMessage(authorizedUserId, event.text, "notice");
          });
        }
        break;
      case "approval_required":
        void outputBatcher.flushNow().then(async () => {
          const pending = toPendingApproval(event.request);
          if (shouldAutoConfirmApproval(options.adapter)) {
            stateStore.appendLog(
              `approval_auto_confirming: ${pending.commandPreview}`,
            );
            const confirmed = await adapter.resolveApproval("confirm");
            if (confirmed) {
              stateStore.clearPendingConfirmation();
              stateStore.appendLog(
                `approval_auto_confirmed: ${pending.commandPreview}`,
              );
              return;
            }
            stateStore.appendLog(
              `approval_auto_confirm_failed: ${pending.commandPreview}`,
            );
          }
          stateStore.setPendingConfirmation(pending);
          stateStore.appendLog(
            `Approval requested (${pending.source}): ${pending.commandPreview}`,
          );
          await queueWechatMessage(
            authorizedUserId,
            formatApprovalMessage(pending, adapterState),
            "approval_required",
          );
        });
        break;
      case "mirrored_user_input":
        if (
          options.adapter === "codex" &&
          parseLocalCodexControlCommand(event.text)?.type === "bind_thread"
        ) {
          const interceptedTurnId = normalizeTurnId(event.turnId);
          if (interceptedTurnId) {
            interceptedLocalControlTurnIds.add(interceptedTurnId);
          }
          stateStore.appendLog(
            `local_bind_command: ${truncatePreview(event.text)}`,
          );
          void outputBatcher.flushNow().then(async () => {
            try {
              const interrupted = await adapter.interrupt();
              stateStore.appendLog(
                `local_bind_command_interrupt: turnId=${interceptedTurnId || "(unknown)"} interrupted=${interrupted ? "yes" : "no"}`,
              );
            } catch (error) {
              stateStore.appendLog(
                `local_bind_command_interrupt_failed: turnId=${interceptedTurnId || "(unknown)"} error=${truncatePreview(error instanceof Error ? error.message : String(error), 240)}`,
              );
            }
            await bindCurrentCodexThread({
              adapter,
              stateStore,
              queueWechatMessage,
              senderId: authorizedUserId,
              touchDesktopThread,
            });
          });
          break;
        }

        if (
          options.adapter === "codex" &&
          typeof event.turnId === "string" &&
          event.turnId.trim() &&
          !hasForwardedTurnEvent(stateStore, "mirrored_user_input", event.turnId) &&
          hasForwardedTurnEvent(stateStore, "final_reply", event.turnId)
        ) {
          stateStore.appendLog(
            `suppressed_replayed_wechat_turn_input: turnId=${event.turnId}`,
          );
          break;
        }

        if (
          options.adapter === "codex" &&
          hasForwardedTurnEvent(stateStore, "mirrored_user_input", event.turnId)
        ) {
          stateStore.appendLog(
            `suppressed_duplicate_turn_event: context=mirrored_user_input turnId=${event.turnId}`,
          );
          break;
        }

        stateStore.appendLog(`mirrored_local_input: ${truncatePreview(event.text)}`);
        if (shouldForwardBridgeEventToWechat(options.adapter, event.type)) {
          void outputBatcher.flushNow().then(async () => {
            await queueWechatMessage(
              authorizedUserId,
              formatMirroredUserInputMessage(options.adapter, event.text),
              "mirrored_user_input",
            );
            rememberForwardedTurnEvent(
              stateStore,
              "mirrored_user_input",
              event.turnId,
            );
          });
        }
        break;
      case "session_switched":
        stateStore.setSharedSessionId?.(event.sessionId);
        stateStore.appendLog(
          `session_switched: ${event.sessionId} source=${event.source} reason=${event.reason}`,
        );
        void syncCodexPinnedSessionForRoute(stateStore, adapter);
        if (shouldForwardBridgeEventToWechat(options.adapter, event.type)) {
          void outputBatcher.flushNow().then(async () => {
            await queueWechatMessage(
              authorizedUserId,
              formatSessionSwitchMessage({
                adapter: options.adapter,
                sessionId: event.sessionId,
                source: event.source,
                reason: event.reason,
              }),
              "session_switched",
            );
          });
        }
        break;
      case "thread_switched":
        stateStore.setSharedSessionId?.(event.threadId);
        stateStore.appendLog(
          `thread_switched: ${event.threadId} source=${event.source} reason=${event.reason}`,
        );
        void syncCodexPinnedSessionForRoute(stateStore, adapter);
        maybeTouchCodexDesktopThread({
          adapter,
          options,
          stateStore,
          candidateThreadId: event.threadId,
          triggerReason: `thread_switched:${event.reason}`,
          touchDesktopThread,
        });
        if (shouldForwardBridgeEventToWechat(options.adapter, event.type)) {
          void outputBatcher.flushNow().then(async () => {
            await queueWechatMessage(
              authorizedUserId,
              formatSessionSwitchMessage({
                adapter: options.adapter,
                sessionId: event.threadId,
                source: event.source,
                reason: event.reason,
              }),
              "thread_switched",
            );
          });
        }
        break;
      case "task_complete":
        void outputBatcher.flushNow().then(async () => {
          const activeTask = getActiveTask();
          stateStore.clearPendingConfirmation();
          if (options.adapter === "shell") {
            const summary = buildCompletionSummary({
              adapter: options.adapter,
              activeTask,
              exitCode: event.exitCode,
              recentOutput: outputBatcher.getRecentSummary(),
            });
            await queueWechatMessage(authorizedUserId, summary);
          }
          await restoreBoundCodexRouteAfterTemporaryTurn({
            activeTask,
            adapter,
            stateStore,
            queueWechatMessage,
            senderId: authorizedUserId,
            touchDesktopThread,
          });
          clearActiveTask();
        });
        break;
      case "task_failed":
        void outputBatcher.flushNow().then(async () => {
          const activeTask = getActiveTask();
          stateStore.clearPendingConfirmation();
          await restoreBoundCodexRouteAfterTemporaryTurn({
            activeTask,
            adapter,
            stateStore,
            queueWechatMessage,
            senderId: authorizedUserId,
          });
          clearActiveTask();
          await queueWechatMessage(
            authorizedUserId,
            formatTaskFailedMessage(options.adapter, event.message),
            "task_failed",
          );
        });
        break;
      case "fatal_error":
        logError(event.message);
        stateStore.appendLog(`fatal_error: ${event.message}`);
        stateStore.clearPendingConfirmation();
        clearActiveTask();
        void outputBatcher.flushNow().then(async () => {
          await queueWechatMessage(
            authorizedUserId,
            formatUserFacingBridgeFatalError(event.message),
            "fatal_error",
          );
        });
        break;
      case "shutdown_requested":
        stateStore.appendLog(`shutdown_requested: ${event.reason}`);
        requestShutdown(event.message, event.exitCode ?? 0);
        break;
    }
  });
}

function buildCompletionSummary(params: {
  adapter: BridgeAdapterKind;
  activeTask: ActiveTask | null;
  exitCode?: number;
  recentOutput: string;
}): string {
  const lines = [`${params.adapter} task complete.`];
  if (params.activeTask) {
    lines.push(
      `duration: ${formatDuration(Date.now() - params.activeTask.startedAt)}`,
    );
    lines.push(`input: ${params.activeTask.inputPreview}`);
  }
  if (typeof params.exitCode === "number") {
    lines.push(`exit_code: ${params.exitCode}`);
  }
  lines.push(`recent_output:\n${params.recentOutput}`);
  return lines.join("\n");
}

export async function handleInboundMessage(params: {
  message: InboundWechatMessage;
  options: BridgeCliOptions;
  stateStore: BridgeStateStore;
  adapter: BridgeAdapter;
  queueWechatMessage: (
    senderId: string,
    text: string,
    context?: WechatSendContext,
  ) => Promise<void>;
  outputBatcher: OutputBatcher;
  touchDesktopThread?: DesktopThreadToucher;
}): Promise<ActiveTask | null> {
  const {
    message,
    options,
    stateStore,
    adapter,
    queueWechatMessage,
    outputBatcher,
    touchDesktopThread,
  } = params;
  const state = stateStore.getState();
  const systemCommand = parseWechatControlCommand(message.text, {
    adapter: options.adapter,
    hasPendingConfirmation: Boolean(state.pendingConfirmation),
  });

  if (message.senderId !== state.authorizedUserId) {
    await queueWechatMessage(
      message.senderId,
      "未授权。当前桥接只接受已绑定微信主人的消息。",
    );
    return null;
  }

  switch (systemCommand?.type) {
    case "status":
      await queueWechatMessage(
        message.senderId,
        formatStatusReport(stateStore.getState(), adapter.getState()),
      );
      return null;
    case "probe_01":
      await queueWechatMessage(
        message.senderId,
        "收到。测试探针：`01-ACK`",
      );
      return null;
    case "route_independent": {
      if (options.adapter !== "codex") {
        await queueWechatMessage(
          message.senderId,
          "只有 Codex 模式支持 /new 或 /2。",
        );
        return null;
      }

      stateStore.switchRouteToIndependent();
      await syncCodexPinnedSessionForRoute(stateStore, adapter);
      await queueWechatMessage(
        message.senderId,
        "已准备切到临时 Codex 线程。下一条消息会进入一个新的独立线程，并会一直停留在该线程，直到你发送 /1 返回主线程。",
      );
      return null;
    }
    case "route_bound": {
      if (options.adapter !== "codex") {
        await queueWechatMessage(
          message.senderId,
          "只有 Codex 模式支持 /bound 或 /1。",
        );
        return null;
      }

      const boundSessionId = getBoundSessionId(state);
      if (!boundSessionId) {
        await queueWechatMessage(
          message.senderId,
          "当前还没有绑定主线程。",
        );
        return null;
      }

      const currentSessionId = getSharedSessionId(adapter.getState());
      if (currentSessionId !== boundSessionId) {
        await adapter.resumeSession(boundSessionId);
        stateStore.setSharedSessionId?.(boundSessionId);
      }

      stateStore.switchRouteToBound();
      await syncCodexPinnedSessionForRoute(stateStore, adapter);
      maybeTouchCodexDesktopThread({
        adapter,
        options,
        stateStore,
        candidateThreadId: boundSessionId,
        triggerReason: "route_bound_command",
        touchDesktopThread,
      });
      await queueWechatMessage(
        message.senderId,
        currentSessionId === boundSessionId
          ? "当前已经在主线程。"
          : "已切回主线程。",
      );
      return null;
    }
    case "resume": {
      if (options.adapter === "codex") {
        await queueWechatMessage(
          message.senderId,
          'Codex 模式下微信侧不支持 /resume。请直接在本地 "wechat-codex" 里使用 /resume，微信会跟随当前本地线程。',
        );
        return null;
      }
      if (options.adapter === "claude") {
        await queueWechatMessage(
          message.senderId,
          'Claude 模式下微信侧不支持 /resume。请直接在本地 "wechat-claude" 里使用 /resume，微信会跟随当前本地会话。',
        );
        return null;
      }
      if (options.adapter === "opencode") {
        await queueWechatMessage(
          message.senderId,
          'OpenCode 模式下微信侧不支持 /resume。请直接在本地 "wechat-opencode" 里使用 /resume，微信会跟随当前本地会话。',
        );
        return null;
      }

      await queueWechatMessage(
        message.senderId,
        `${options.adapter} 模式下不支持 /resume。`,
      );
      return null;
    }
    case "stop": {
      const interrupted = await adapter.interrupt();
      await queueWechatMessage(
        message.senderId,
        interrupted
          ? "已向当前任务发送中断信号。"
          : "当前没有可中断的运行中任务。",
      );
      return null;
    }
    case "reset":
      await outputBatcher.flushNow();
      outputBatcher.clear();
      stateStore.clearPendingConfirmation();
      stateStore.clearSharedSessionId({ clearBound: true });
      await syncCodexPinnedSessionForRoute(stateStore, adapter);
      await adapter.reset();
      stateStore.appendLog("Worker reset by owner.");
      await queueWechatMessage(message.senderId, "工作会话已重置。");
      return null;
    case "confirm": {
      const pending = state.pendingConfirmation;
      if (!pending) {
        await queueWechatMessage(message.senderId, "当前没有待处理的审批请求。");
        return null;
      }
      if (options.adapter !== "claude" && pending.code !== systemCommand.code) {
        await queueWechatMessage(message.senderId, "确认码不匹配。");
        return null;
      }
      const confirmed = await adapter.resolveApproval("confirm");
      if (!confirmed) {
        await queueWechatMessage(
          message.senderId,
          "当前任务无法处理这次审批请求。",
        );
        return null;
      }
      stateStore.clearPendingConfirmation();
      stateStore.appendLog(`Approval confirmed: ${pending.commandPreview}`);
      await queueWechatMessage(message.senderId, "已批准，继续执行。");
      return {
        startedAt: Date.now(),
        inputPreview: pending.commandPreview,
      };
    }
    case "deny": {
      const pending = state.pendingConfirmation;
      if (!pending) {
        await queueWechatMessage(message.senderId, "当前没有待处理的审批请求。");
        return null;
      }
      const denied = await adapter.resolveApproval("deny");
      if (!denied) {
        await queueWechatMessage(
          message.senderId,
          "当前任务无法正常拒绝这次审批请求。",
        );
        return null;
      }
      stateStore.clearPendingConfirmation();
      stateStore.appendLog(`Approval denied: ${pending.commandPreview}`);
      await queueWechatMessage(message.senderId, "已拒绝该审批请求。");
      return null;
    }
  }

  if (state.pendingConfirmation) {
    await queueWechatMessage(
      message.senderId,
      formatPendingApprovalReminder(state.pendingConfirmation, adapter.getState()),
    );
    return null;
  }

  const adapterState = adapter.getState();
  if (adapterState.status === "busy") {
    if (
      (options.adapter === "codex" || options.adapter === "opencode") &&
      adapterState.activeTurnOrigin === "local"
    ) {
      await queueWechatMessage(
        message.senderId,
        `${
          options.adapter === "opencode" ? "OpenCode" : "Codex"
        } 当前正在处理本地终端里的任务，请等待完成或发送 /stop。`,
      );
      return null;
    }

    if (options.adapter !== "codex") {
      await queueWechatMessage(
        message.senderId,
        `${options.adapter} 仍在处理中，请等待当前回复结束或发送 /stop。`,
      );
      return null;
    }
  }

  const activeTask = {
    startedAt: Date.now(),
    inputPreview: truncatePreview(message.text, 180),
  };
  await syncCodexPinnedSessionForRoute(stateStore, adapter);
  if (options.adapter === "codex" && state.routeMode === "bound") {
    const boundSessionId = getBoundSessionId(state);
    const currentSessionId = getCurrentAdapterSessionId(adapter.getState());
    if (boundSessionId && currentSessionId !== boundSessionId) {
      await adapter.resumeSession(boundSessionId);
      stateStore.setSharedSessionId?.(boundSessionId);
      stateStore.appendLog(
        `route_restore_before_inbound: resumed bound session ${boundSessionId}`,
      );
    }
  }
  const sendOptions =
    options.adapter === "codex" &&
    state.routeMode === "independent" &&
    state.routeIndependentOnce
      ? { freshSession: true }
      : undefined;
  stateStore.appendLog(
    `Forwarded input to ${options.adapter}${sendOptions?.freshSession ? " (fresh_session)" : ""}: ${truncatePreview(message.text)}`,
  );
  try {
    await adapter.sendInput(buildWechatInboundPrompt(message.text), sendOptions);
    if (sendOptions?.freshSession) {
      stateStore.completeIndependentOnce();
      await syncCodexPinnedSessionForRoute(stateStore, adapter);
      stateStore.appendLog("independent_route_armed_flag_consumed");
    }
  } catch (error) {
    const errorText = error instanceof Error ? error.message : String(error);
    if (
      options.adapter === "codex" &&
      /local codex panel is still working/i.test(errorText)
    ) {
      await queueWechatMessage(
        message.senderId,
        "Codex 当前正在处理本地终端里的任务，请等待完成或发送 /stop。",
      );
      return null;
    }
    if (
      options.adapter === "codex" &&
      /codex is still working\. wait for the current reply or use \/stop\./i.test(errorText)
    ) {
      await queueWechatMessage(
        message.senderId,
        "Codex 仍在处理中，请等待当前回复结束或发送 /stop。",
      );
      return null;
    }
    throw error;
  }
  maybeTouchCodexDesktopThread({
    adapter,
    options,
    stateStore,
    triggerReason: "post_inbound_send",
    touchDesktopThread,
  });
  return activeTask;
}

const isDirectRun = Boolean((import.meta as ImportMeta & { main?: boolean }).main);
if (isDirectRun) {
  main().catch((err) => {
    logError(describeWechatTransportError(err));
    process.exit(1);
  });
}
