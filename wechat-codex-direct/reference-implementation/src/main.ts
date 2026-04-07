import { spawnSync } from 'node:child_process';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { loadConfig, saveConfig } from './config.js';
import { DATA_DIR } from './constants.js';
import {
  runCodexSession,
  resolveCodexExecutablePath,
  type CodexSessionEvent,
  type RunCodexSessionOptions,
} from './codex/provider.js';
import { handleGatewayCommand } from './gateway/commands.js';
import { createGatewayRuntime } from './gateway/runtime.js';
import { buildPrompt, buildTaskPreview } from './gateway/task-utils.js';
import { logger } from './logger.js';
import { createSessionStore } from './session.js';
import {
  getServiceStatus,
  readServiceLogs,
  restartBackgroundService,
  startBackgroundService,
  stopBackgroundService,
} from './service.js';
import { loadLatestAccount, type AccountData } from './wechat/accounts.js';
import { WeChatApi } from './wechat/api.js';
import { startQrLogin, waitForQrScan } from './wechat/login.js';
import { downloadImage, extractFirstImageUrl, extractText } from './wechat/media.js';
import { createMonitor, type MonitorCallbacks } from './wechat/monitor.js';
import { createSender, type ProgressState } from './wechat/send.js';
import { MessageType, type WeixinMessage } from './wechat/types.js';

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
}

function extractTextFromItems(items: NonNullable<WeixinMessage['item_list']>): string {
  return items.map((item) => extractText(item)).filter(Boolean).join('\n');
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
  options: RunCodexSessionOptions,
): Promise<CodexRunResult> {
  const runOnce = async (runOptions: RunCodexSessionOptions): Promise<CodexRunResult> => {
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

    await runCodexSession(runOptions, handleEvent);
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
): Promise<CodexRunResult> {
  const request: ActiveExecution = { abortController };
  scheduleProgress(accountId, peerUserId, request, peerUserId, task.contextToken, sender, sessionStore);

  sessionStore.update(accountId, peerUserId, (session) => ({
    ...session,
    latestContextToken: task.contextToken,
  }));

  try {
    const currentSession = sessionStore.load(accountId, peerUserId);
    const result = await executeCodexRun(accountId, peerUserId, sessionStore, {
      prompt: task.promptText,
      cwd: config.workingDirectory,
      threadId: currentSession.codexThreadId,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      systemPrompt: config.systemPrompt,
      images: task.imagePayloads.length > 0 ? task.imagePayloads : undefined,
      abortController,
    });

    await stopProgress(accountId, peerUserId, request, sender, sessionStore);

    if (result.threadId) {
      sessionStore.update(accountId, peerUserId, (session) => ({
        ...session,
        codexThreadId: result.threadId,
      }));
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
  const imageItem = extractFirstImageUrl(message.item_list);

  if (!userText && !imageItem) {
    await sender.sendText(fromUserId, contextToken, 'Unsupported message type.');
    return;
  }

  const command = await handleGatewayCommand({
    userText,
    fromUserId,
    contextToken,
    sender,
    runtime: gatewayRuntime,
    hasImage: Boolean(imageItem),
  });

  if (command) {
    logger.info('Handled gateway command', {
      accountId: account.accountId,
      fromUserId,
      command,
    });
    return;
  }

  let imagePayloads: string[] = [];
  if (imageItem) {
    try {
      const imagePayload = await downloadImage(imageItem);
      if (!imagePayload) {
        await sender.sendText(fromUserId, contextToken, 'Failed to download the image attachment.');
        return;
      }

      imagePayloads = [imagePayload];
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      logger.error('Failed to download inbound image', { fromUserId, error: messageText });
      await sender.sendText(fromUserId, contextToken, 'Failed to download the image attachment.');
      return;
    }
  }

  await gatewayRuntime.enqueueMessage({
    peerUserId: fromUserId,
    contextToken,
    promptText: buildPrompt(userText, imagePayloads.length > 0),
    preview: buildTaskPreview(userText, imagePayloads.length > 0),
    imagePayloads,
    hasImage: imagePayloads.length > 0,
  });
}

async function runDaemon(): Promise<void> {
  const account = loadLatestAccount();

  if (!account) {
    console.error('No WeChat account binding found. Run npm run setup first.');
    process.exit(1);
  }

  const api = new WeChatApi(account.botToken, account.baseUrl);
  const sender = createSender(api, account.accountId);
  const sessionStore = createSessionStore();

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
      ),
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

  const monitor = createMonitor(api, callbacks);

  function shutdown(): void {
    logger.info('Shutting down bridge daemon');
    gatewayRuntime.abortAll();
    monitor.stop();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Daemon started', { accountId: account.accountId });
  console.log(`wechat-codex started for account: ${account.accountId}`);

  await monitor.run();
}

function handleServiceCommand(subcommand: string | undefined): void {
  const entryFile = fileURLToPath(import.meta.url);

  switch (subcommand || 'status') {
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
          ? `Service is running. PID: ${status.pid}\nStarted: ${status.startedAt}`
          : 'Service is not running.',
      );
      return;
    }
    case 'logs':
      console.log(readServiceLogs());
      return;
    default:
      console.log('Usage: node dist/main.js service <start|stop|restart|status|logs>');
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
  handleServiceCommand(process.argv[3]);
} else {
  runDaemon().catch((error) => {
    logger.error('Daemon failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    console.error('startup failed:', error);
    process.exit(1);
  });
}
