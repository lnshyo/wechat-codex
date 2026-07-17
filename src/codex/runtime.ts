import type { CodexProvider } from '../config.js';
import { logger } from '../logger.js';
import {
  AppServerUnavailableError,
  runCodexAppServerSession,
  shutdownCodexAppServer,
  warmCodexAppServer,
} from './app-server-provider.js';
import {
  runCodexSession as runCodexCliSession,
  type CodexSessionEvent,
  type RunCodexSessionOptions,
} from './provider.js';

export interface RunConfiguredCodexSessionOptions extends RunCodexSessionOptions {
  provider?: CodexProvider;
  appServerFallbackToCli?: boolean;
}

export async function runConfiguredCodexSession(
  options: RunConfiguredCodexSessionOptions,
  onEvent: (event: CodexSessionEvent) => void,
): Promise<void> {
  if (options.provider !== 'app-server') {
    await runCodexCliSession(options, onEvent);
    return;
  }

  try {
    await runCodexAppServerSession(options, onEvent);
  } catch (error) {
    if (!(error instanceof AppServerUnavailableError) || options.appServerFallbackToCli === false) {
      onEvent({
        type: options.abortController?.signal.aborted ? 'response.aborted' : 'response.failed',
        threadId: options.threadId,
        ...(options.abortController?.signal.aborted
          ? {}
          : { error: error instanceof Error ? error.message : String(error) }),
      } as CodexSessionEvent);
      return;
    }

    logger.warn('Codex App Server unavailable; falling back to one-shot CLI', {
      threadId: options.threadId,
      error: error.message,
    });
    await runCodexCliSession(options, onEvent);
  }
}

export function shutdownCodexRuntime(): void {
  shutdownCodexAppServer();
}

export async function warmCodexRuntime(
  provider: CodexProvider | undefined,
  fallbackToCli: boolean | undefined,
): Promise<void> {
  if (provider !== 'app-server') {
    return;
  }

  try {
    await warmCodexAppServer();
  } catch (error) {
    if (fallbackToCli === false) {
      throw error;
    }
    logger.warn('Could not warm Codex App Server; CLI fallback remains available', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
