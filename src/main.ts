import { spawnSync } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { loadConfig, saveConfig } from './config.js';
import { DAEMON_LOCK_PATH, DATA_DIR } from './constants.js';
import {
  createLocalCodexTranscriptMirror,
} from './codex/local-sync.js';
import {
  findBestLocalCodexSessionForCwd,
  readTranscriptEventsSince,
} from './codex/companion.js';
import {
  resolveCodexExecutablePath,
  type CodexSessionEvent,
} from './codex/provider.js';
import {
  runConfiguredCodexSession,
  shutdownCodexRuntime,
  warmCodexRuntime,
  type RunConfiguredCodexSessionOptions,
} from './codex/runtime.js';
import { handleGatewayCommand } from './gateway/commands.js';
import { createGatewayRuntime } from './gateway/runtime.js';
import {
  buildFreshSessionSystemPrompt,
  buildPrompt,
  buildSessionSystemPrompt,
  buildTaskPreview,
} from './gateway/task-utils.js';
import { acquireDaemonLock, releaseDaemonLock } from './daemon-lock.js';
import { logger } from './logger.js';
import { createSessionStore } from './session.js';
import {
  getServiceStatus,
  installWindowsService,
  readServiceLogs,
  restartBackgroundService,
  startBackgroundService,
  stopBackgroundService,
  uninstallWindowsService,
} from './service.js';
import { loadLatestAccount, type AccountData } from './wechat/accounts.js';
import { WeChatApi } from './wechat/api.js';
import { startQrLogin, waitForQrScan } from './wechat/login.js';
import {
  extractText,
  getMissingVoiceTranscriptReply,
} from './wechat/media.js';
import {
  archiveWeChatAttachments,
  type ArchivedWeChatAttachment,
} from './wechat/library.js';
import { createMonitor, type MonitorCallbacks } from './wechat/monitor.js';
import { createSender, type ProgressState } from './wechat/send.js';
import { MessageType, type WeixinMessage } from './wechat/types.js';
import type { AttachLocalSessionResult } from './gateway/types.js';

const DEFAULT_CODEX_EXECUTABLE_PATH = 'C:/Users/lin_s/.codex/.sandbox-bin/codex.exe';
const TYPING_START_DELAY_MS = 350;
const TYPING_REFRESH_MS = 8_000;

interface ActiveExecution {
  abortController: AbortController;
  progressState?: ProgressState;
  progressStartTimer?: NodeJS.Timeout;
  progressRefreshTimer?: NodeJS.Timeout;
}

interface CodexRunResult {
  aborted: boolean;
  error?: string;
  text: string;
  threadId?: string;
  threadReset?: boolean;
}

function promptUser(question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `,
      (answer) => {
        rl.close();
        resolve(answer.trim() || defaultValue || '');
      },
    );
  });
}

function openFile(filePath: string): void {
  const command =
    process.platform === 'darwin'
      ? { cmd: 'open', args: [filePath] }
      : process.platform === 'win32'
        ? { cmd: 'cmd', args: ['/c', 'start', '', filePath] }
        : { cmd: 'xdg-open', args: [filePath] };

  const result = spawnSync(command.cmd, command.args, { stdio: 'ignore' });
  if (result.error) {
    logger.warn('Failed to open file', {
      filePath,
      error: result.error.message,
    });
  }
}

async function runSetup(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const qrPath = join(DATA_DIR, 'qrcode.png');

  console.log('Starting WeChat setup...\n');

  while (true) {
    const { qrcodeUrl, qrcodeId } = await startQrLogin();
    const isHeadlessLinux =
      process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;

    if (isHeadlessLinux) {
      try {
        const qrcodeTerminal = await import('qrcode-terminal');
        console.log('Scan the QR code below in WeChat:\n');
        qrcodeTerminal.default.generate(qrcodeUrl, { small: true });
        console.log(`\nQR code URL: ${qrcodeUrl}\n`);
      } catch {
        console.log(`Open this QR code URL to complete login:\n${qrcodeUrl}\n`);
      }
    } else {
      const QRCode = await import('qrcode');
      const png = await QRCode.toBuffer(qrcodeUrl, { type: 'png', width: 400, margin: 2 });
      writeFileSync(qrPath, png);
      openFile(qrPath);
      console.log(`Opened QR code image: ${qrPath}\n`);
    }

    console.log('Waiting for QR confirmation...');

    try {
      await waitForQrScan(qrcodeId);
      console.log('WeChat login succeeded.');
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('expired')) {
        console.log('QR code expired. Generating a new one...\n');
        continue;
      }
      throw error;
    }
  }

  try {
    unlinkSync(qrPath);
  } catch {
    logger.warn('Failed to remove QR code image', { qrPath });
  }

  const config = loadConfig();
  config.workingDirectory = await promptUser('Enter default working directory', config.workingDirectory);
  config.codexExecutablePath ||= DEFAULT_CODEX_EXECUTABLE_PATH;
  saveConfig(config);

  console.log('\nSetup complete.');
  console.log('Foreground: npm start');
  console.log('Background: npm run service -- start');
  if (process.platform === 'win32') {
    console.log('Windows Service: npm run service -- install');
  }
}

function extractTextFromItems(items: NonNullable<WeixinMessage['item_list']>): string {
  return items.map((item) => extractText(item)).filter(Boolean).join('\n');
}

function buildAttachmentPrompt(
  userText: string,
  attachments: ArchivedWeChatAttachment[],
  failureCount: number,
): string {
  const hasImage = attachments.some((attachment) => attachment.kind === 'image');
  const hasVideo = attachments.some((attachment) => attachment.kind === 'video');
  const fallback = hasVideo
    ? '请读取并总结收到的视频附件。'
    : attachments.length > 0
      ? '请读取并处理收到的微信附件。'
      : buildPrompt(userText, hasImage);
  const base = userText.trim() || fallback;
  const archived = attachments.length > 0
    ? [
        '微信附件已自动保存到本地资料库：',
        ...attachments.map((attachment) => `- ${attachment.path}`),
      ].join('\n')
    : '';
  const failed = failureCount > 0
    ? `另有 ${failureCount} 个附件未能下载或保存，请在回复中明确告知用户。`
    : '';

  return [base, archived, failed].filter(Boolean).join('\n\n');
}

function buildAttachmentPreview(
  userText: string,
  attachments: ArchivedWeChatAttachment[],
): string {
  const hasImage = attachments.some((attachment) => attachment.kind === 'image');
  if (userText.trim() || hasImage) {
    return buildTaskPreview(userText, hasImage);
  }
  if (attachments.some((attachment) => attachment.kind === 'video')) {
    return '[Video attachment]';
  }
  return attachments.length > 0 ? '[File attachment]' : buildTaskPreview(userText, false);
}

async function stopProgress(
  accountId: string,
  peerUserId: string,
  request: ActiveExecution,
  sender: ReturnType<typeof createSender>,
  sessionStore: ReturnType<typeof createSessionStore>,
): Promise<void> {
  if (request.progressStartTimer) {
    clearTimeout(request.progressStartTimer);
    request.progressStartTimer = undefined;
  }

  if (request.progressRefreshTimer) {
    clearInterval(request.progressRefreshTimer);
    request.progressRefreshTimer = undefined;
  }

  await sender.stopProgress(request.progressState);
  request.progressState = undefined;
  sessionStore.update(accountId, peerUserId, (session) => ({
    ...session,
    typingState: 'idle',
  }));
}

function scheduleProgress(
  accountId: string,
  peerUserId: string,
  request: ActiveExecution,
  toUserId: string,
  contextToken: string,
  sender: ReturnType<typeof createSender>,
  sessionStore: ReturnType<typeof createSessionStore>,
): void {
  request.progressStartTimer = setTimeout(() => {
    if (request.abortController.signal.aborted) {
      return;
    }

    void sender
      .startProgress(toUserId, contextToken)
      .then((progressState) => {
        if (request.abortController.signal.aborted) {
          void sender.stopProgress(progressState);
          return;
        }

        request.progressState = progressState;
        sessionStore.update(accountId, peerUserId, (session) => ({
          ...session,
          typingState: progressState.mode === 'typing' ? 'typing' : 'generating',
        }));

        if (progressState.mode === 'typing') {
          request.progressRefreshTimer = setInterval(() => {
            if (request.abortController.signal.aborted) {
              return;
            }

            void sender.refreshProgress(progressState).catch((error) => {
              logger.warn('Failed to refresh typing state', {
                toUserId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }, TYPING_REFRESH_MS);
        }
      })
      .catch((error) => {
        logger.warn('Failed to schedule progress state', {
          toUserId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, TYPING_START_DELAY_MS);
}

async function executeCodexRun(
  accountId: string,
  peerUserId: string,
  sessionStore: ReturnType<typeof createSessionStore>,
  options: RunConfiguredCodexSessionOptions,
): Promise<CodexRunResult> {
  const runOnce = async (
    runOptions: RunConfiguredCodexSessionOptions,
  ): Promise<CodexRunResult> => {
    let result: CodexRunResult = {
      aborted: false,
      text: '',
      threadId: runOptions.threadId,
      threadReset: false,
    };

    const handleEvent = (event: CodexSessionEvent) => {
      switch (event.type) {
        case 'thread.started':
          sessionStore.update(accountId, peerUserId, (session) => ({
            ...session,
            codexThreadId: event.threadId,
          }));
          result = {
            ...result,
            threadId: event.threadId,
          };
          break;
        case 'response.completed':
          result = {
            aborted: false,
            text: event.text,
            threadId: event.threadId ?? result.threadId,
            threadReset: result.threadReset,
          };
          break;
        case 'response.failed':
          result = {
            aborted: false,
            text: '',
            threadId: event.threadId ?? result.threadId,
            error: event.error,
            threadReset: result.threadReset,
          };
          break;
        case 'response.aborted':
          result = {
            aborted: true,
            text: '',
            threadId: event.threadId ?? result.threadId,
            threadReset: result.threadReset,
          };
          break;
      }
    };

    await runConfiguredCodexSession(runOptions, handleEvent);
    return result;
  };

  const firstResult = await runOnce(options);
  if (!firstResult.error || !options.threadId || firstResult.aborted) {
    return firstResult;
  }

  logger.warn('Retrying Codex run without thread resume', {
    threadId: options.threadId,
    error: firstResult.error,
  });

  sessionStore.update(accountId, peerUserId, (session) => ({
    ...session,
    codexThreadId: undefined,
    latestContextToken: undefined,
    state: 'idle',
    typingState: 'idle',
  }));

  const retried = await runOnce({
    ...options,
    threadId: undefined,
    systemPrompt: buildFreshSessionSystemPrompt(options.systemPrompt, options.cwd),
  });

  return {
    ...retried,
    threadReset: true,
  };
}

async function runGatewayTask(
  accountId: string,
  peerUserId: string,
  task: {
    contextToken: string;
    promptText: string;
    imagePayloads: string[];
  },
  abortController: AbortController,
  sender: ReturnType<typeof createSender>,
  sessionStore: ReturnType<typeof createSessionStore>,
  config: ReturnType<typeof loadConfig>,
  localTranscriptMirror?: ReturnType<typeof createLocalCodexTranscriptMirror>,
): Promise<CodexRunResult> {
  const request: ActiveExecution = { abortController };
  scheduleProgress(accountId, peerUserId, request, peerUserId, task.contextToken, sender, sessionStore);

  sessionStore.update(accountId, peerUserId, (session) => ({
    ...session,
    latestContextToken: task.contextToken,
  }));

  try {
    const currentSession = sessionStore.load(accountId, peerUserId);
    const systemPrompt = buildSessionSystemPrompt(
      config.systemPrompt,
      config.workingDirectory,
      !currentSession.codexThreadId,
    );
    const result = await executeCodexRun(accountId, peerUserId, sessionStore, {
      prompt: task.promptText,
      cwd: config.workingDirectory,
      threadId: currentSession.codexThreadId,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      systemPrompt,
      images: task.imagePayloads.length > 0 ? task.imagePayloads : undefined,
      abortController,
      provider: config.codexProvider,
      appServerFallbackToCli: config.appServerFallbackToCli,
    });

    await stopProgress(accountId, peerUserId, request, sender, sessionStore);

    if (result.threadId) {
      sessionStore.update(accountId, peerUserId, (session) => ({
        ...session,
        codexThreadId: result.threadId,
      }));
    }

    if (currentSession.localSync?.enabled) {
      localTranscriptMirror?.registerBridgeTurn(
        currentSession.localSync.sessionId,
        task.promptText,
        result.text || undefined,
      );
    }

    return result;
  } catch (error) {
    await stopProgress(accountId, peerUserId, request, sender, sessionStore);
    if (abortController.signal.aborted) {
      return {
        aborted: true,
        text: '',
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error('Unexpected task execution error', { peerUserId, error: message });
    return {
      aborted: false,
      text: '',
      error: message,
    };
  }
}

async function handleMessage(
  message: WeixinMessage,
  account: AccountData,
  sender: ReturnType<typeof createSender>,
  sessionStore: ReturnType<typeof createSessionStore>,
  gatewayRuntime: ReturnType<typeof createGatewayRuntime>,
): Promise<void> {
  if (message.message_type !== MessageType.USER) {
    return;
  }

  if (!message.from_user_id || !message.item_list) {
    return;
  }

  const fromUserId = message.from_user_id;
  const contextToken = message.context_token ?? '';
  const userText = extractTextFromItems(message.item_list);
  const missingVoiceTranscriptReply = getMissingVoiceTranscriptReply(message.item_list);
  const config = loadConfig();
  const archived = await archiveWeChatAttachments(message.item_list, {
    workingDirectory: config.workingDirectory,
    messageId: message.message_id,
    now: message.create_time_ms ? new Date(message.create_time_ms) : undefined,
  });
  const imagePayloads = archived.files
    .map((attachment) => attachment.dataUri)
    .filter((payload): payload is string => Boolean(payload));

  if (!userText.trim() && archived.files.length === 0) {
    if (missingVoiceTranscriptReply) {
      logger.warn('Inbound voice message has no WeChat transcription', {
        itemCount: message.item_list.length,
        hasContextToken: Boolean(contextToken),
        hasMessageId: Boolean(message.message_id),
      });
      await sender.sendText(
        fromUserId,
        contextToken,
        missingVoiceTranscriptReply,
      );
      return;
    }

    if (archived.failures.length > 0) {
      await sender.sendText(
        fromUserId,
        contextToken,
        '附件下载或保存失败，请稍后重试。',
      );
      return;
    }

    await sender.sendText(fromUserId, contextToken, '\u6682\u4e0d\u652f\u6301\u8fd9\u79cd\u6d88\u606f\u7c7b\u578b\u3002');
    return;
  }

  const command = await handleGatewayCommand({
    userText,
    fromUserId,
    contextToken,
    sender,
    runtime: gatewayRuntime,
    hasImage: imagePayloads.length > 0,
  });

  if (command) {
    logger.info('Handled gateway command', {
      accountId: account.accountId,
      fromUserId,
      command,
    });
    return;
  }

  await gatewayRuntime.enqueueMessage({
    peerUserId: fromUserId,
    contextToken,
    promptText: buildAttachmentPrompt(userText, archived.files, archived.failures.length),
    preview: buildAttachmentPreview(userText, archived.files),
    imagePayloads,
    hasImage: imagePayloads.length > 0,
  });
}

async function attachPeerToLatestLocalSession(
  accountId: string,
  peerUserId: string,
  sessionStore: ReturnType<typeof createSessionStore>,
  config: ReturnType<typeof loadConfig>,
): Promise<AttachLocalSessionResult> {
  const latest = await findBestLocalCodexSessionForCwd({
    cwd: config.workingDirectory,
  });

  if (!latest) {
    return {
      attached: false,
      error: '\u672a\u627e\u5230\u5f53\u524d\u5de5\u4f5c\u76ee\u5f55\u5bf9\u5e94\u7684\u672c\u5730 Codex \u4f1a\u8bdd\u3002',
    };
  }

  const transcript = await readTranscriptEventsSince(latest.transcriptPath, 0);

  sessionStore.update(accountId, peerUserId, (session) => ({
    ...session,
    codexThreadId: latest.sessionId,
    localSync: {
      enabled: true,
      sessionId: latest.sessionId,
      transcriptPath: latest.transcriptPath,
      transcriptCursor: transcript.cursor,
      transcriptCwd: latest.cwd,
      lastTranscriptEventAt: transcript.events.at(-1)?.timestamp,
    },
  }));

  return {
    attached: true,
    sessionId: latest.sessionId,
    transcriptPath: latest.transcriptPath,
    source: latest.source,
    title: latest.title,
  };
}

function detachPeerLocalSession(
  accountId: string,
  peerUserId: string,
  sessionStore: ReturnType<typeof createSessionStore>,
): boolean {
  const current = sessionStore.load(accountId, peerUserId);
  if (!current.localSync?.enabled) {
    return false;
  }

  sessionStore.update(accountId, peerUserId, (session) => ({
    ...session,
    localSync: undefined,
  }));
  return true;
}

async function runDaemon(): Promise<void> {
  const daemonLock = acquireDaemonLock(
    DAEMON_LOCK_PATH,
    process.pid,
    new Date().toISOString(),
    (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
  );
  if (!daemonLock.acquired) {
    logger.warn('Bridge daemon already running', {
      existingPid: daemonLock.existingPid,
      pid: process.pid,
    });
    console.log(`wechat-codex is already running. PID: ${daemonLock.existingPid}`);
    process.exit(0);
  }

  const account = loadLatestAccount();

  if (!account) {
    console.error('No WeChat account binding found. Run npm run setup first.');
    process.exit(1);
  }

  const startupConfig = loadConfig();
  await warmCodexRuntime(
    startupConfig.codexProvider,
    startupConfig.appServerFallbackToCli,
  );

  const api = new WeChatApi(account.botToken, account.baseUrl);
  const sender = createSender(api, account.accountId);
  const sessionStore = createSessionStore();
  const localTranscriptMirror = createLocalCodexTranscriptMirror({
    accountId: account.accountId,
    sessionStore,
    sender,
  });
  localTranscriptMirror.start();

  const gatewayRuntime = createGatewayRuntime({
    accountId: account.accountId,
    sessionStore,
    sender,
    getConfig: () => loadConfig(),
    executeTask: async ({ accountId, peerUserId, task, abortController, config }) =>
      runGatewayTask(
        accountId,
        peerUserId,
        task,
        abortController,
        sender,
        sessionStore,
        config,
        localTranscriptMirror,
      ),
    attachPeerToLatestLocalSession: async (peerUserId: string) =>
      attachPeerToLatestLocalSession(account.accountId, peerUserId, sessionStore, loadConfig()),
    detachPeerLocalSession: async (peerUserId: string) =>
      detachPeerLocalSession(account.accountId, peerUserId, sessionStore),
    inspectHealthBase: () => {
      const serviceStatus = getServiceStatus();

      try {
        return {
          accountId: account.accountId,
          bridgeProcessId: process.pid,
          bridgeStarted: true,
          serviceRunning: serviceStatus.running,
          servicePid: serviceStatus.pid,
          serviceStartedAt: serviceStatus.startedAt,
          codexExecutablePath: resolveCodexExecutablePath(),
        };
      } catch (error) {
        return {
          accountId: account.accountId,
          bridgeProcessId: process.pid,
          bridgeStarted: true,
          serviceRunning: serviceStatus.running,
          servicePid: serviceStatus.pid,
          serviceStartedAt: serviceStatus.startedAt,
          codexExecutableError: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  const callbacks: MonitorCallbacks = {
    onMessage: async (message) => {
      await handleMessage(message, account, sender, sessionStore, gatewayRuntime);
    },
    onSessionExpired: () => {
      logger.warn('WeChat session expired');
      console.error('WeChat session expired. Run npm run setup to log in again.');
    },
  };

  const monitor = createMonitor(api, account.accountId, callbacks);

  function shutdown(): void {
    logger.info('Shutting down bridge daemon');
    gatewayRuntime.abortAll();
    shutdownCodexRuntime();
    localTranscriptMirror.stop();
    monitor.stop();
    releaseDaemonLock(DAEMON_LOCK_PATH, process.pid);
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Daemon started', { accountId: account.accountId });
  console.log(`wechat-codex started for account: ${account.accountId}`);

  await monitor.run();
}

async function handleServiceCommand(subcommand: string | undefined): Promise<void> {
  const entryFile = fileURLToPath(import.meta.url);

  switch (subcommand || 'status') {
    case 'install':
      console.log(await installWindowsService(entryFile));
      return;
    case 'uninstall':
      console.log(uninstallWindowsService());
      return;
    case 'start':
      console.log(startBackgroundService(entryFile));
      return;
    case 'stop':
      console.log(stopBackgroundService());
      return;
    case 'restart':
      console.log(restartBackgroundService(entryFile));
      return;
    case 'status': {
      const status = getServiceStatus();
      console.log(
        status.running
          ? `Service is running (${status.mode}). PID: ${status.pid ?? 'unknown'}${status.startedAt ? `\nStarted: ${status.startedAt}` : ''}`
          : status.installed
            ? `Service is installed (${status.mode}) but not running.`
            : 'Service is not running.',
      );
      return;
    }
    case 'logs':
      console.log(readServiceLogs());
      return;
    default:
      console.log('Usage: node dist/main.js service <install|uninstall|start|stop|restart|status|logs>');
  }
}

const command = process.argv[2] || 'start';

if (command === 'setup') {
  runSetup().catch((error) => {
    logger.error('Setup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error('setup failed:', error);
    process.exit(1);
  });
} else if (command === 'service') {
  handleServiceCommand(process.argv[3]).catch((error) => {
    logger.error('Service command failed', {
      subcommand: process.argv[3],
      error: error instanceof Error ? error.message : String(error),
    });
    console.error('service command failed:', error);
    process.exit(1);
  });
} else {
  runDaemon().catch((error) => {
    shutdownCodexRuntime();
    logger.error('Daemon failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error('startup failed:', error);
    process.exit(1);
  });
}
