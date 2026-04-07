import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';

import { loadConfig, type ReasoningEffort } from '../config.js';
import { logger } from '../logger.js';

export interface RunCodexSessionOptions {
  prompt: string;
  cwd: string;
  threadId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  systemPrompt?: string;
  images?: string[];
  abortController?: AbortController;
}

export type CodexSessionEvent =
  | { type: 'thread.started'; threadId: string }
  | { type: 'response.completed'; text: string; threadId?: string }
  | { type: 'response.failed'; error: string; threadId?: string }
  | { type: 'response.aborted'; threadId?: string };

type JsonEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'item.completed'; item?: { type?: string; text?: string } }
  | Record<string, unknown>;

const EXECUTABLE_CANDIDATES = [
  join(process.env.USERPROFILE || process.env.HOME || '', '.codex', '.sandbox-bin', 'codex.exe'),
  join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.vscode',
    'extensions',
    'openai.chatgpt-26.325.31654-win32-x64',
    'bin',
    'windows-x86_64',
    'codex.exe',
  ),
];

function decodeDataUri(dataUri: string): { extension: string; bytes: Buffer } {
  const matches = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid data URI image payload.');
  }

  const mediaType = matches[1];
  const base64Data = matches[2];
  const bytes = Buffer.from(base64Data, 'base64');
  const extension = mediaType.split('/')[1] || 'png';

  return { extension, bytes };
}

function createTempImageFiles(images?: string[]): { dir?: string; files: string[] } {
  if (!images || images.length === 0) {
    return { files: [] };
  }

  const dir = mkdtempSync(join(tmpdir(), 'wechat-codex-images-'));
  const files: string[] = [];

  images.forEach((image, index) => {
    const { extension, bytes } = decodeDataUri(image);
    const path = join(dir, `image-${index + 1}.${extension}`);
    writeFileSync(path, bytes);
    files.push(path);
  });

  return { dir, files };
}

function escapePrompt(prompt: string, systemPrompt?: string): string {
  if (!systemPrompt) {
    return prompt;
  }

  return `${systemPrompt}\n\nUser request:\n${prompt}`;
}

function resolveCodexExecutable(): string {
  const configPath = loadConfig().codexExecutablePath;
  if (configPath) {
    return configPath;
  }

  const found = EXECUTABLE_CANDIDATES.find((candidate) => {
    return !!candidate && existsSync(candidate);
  });

  if (!found) {
    throw new Error('Could not find a usable local codex.exe binary.');
  }

  return found;
}

export function resolveCodexExecutablePath(): string {
  return resolveCodexExecutable();
}

function buildCommandArgs(options: RunCodexSessionOptions, imageFiles: string[]): string[] {
  const executableArgs = options.threadId
    ? ['exec', 'resume', options.threadId, '--json', '--skip-git-repo-check']
    : ['exec', '--json', '--skip-git-repo-check'];

  if (!options.threadId) {
    executableArgs.push('-C', options.cwd);
  }

  if (options.model) {
    executableArgs.push('-m', options.model);
  }

  executableArgs.push('--full-auto');
  executableArgs.push('-c', `model_reasoning_effort="${options.reasoningEffort || 'medium'}"`);

  for (const imageFile of imageFiles) {
    executableArgs.push('-i', imageFile);
  }

  executableArgs.push(escapePrompt(options.prompt, options.systemPrompt));
  return executableArgs;
}

export async function runCodexSession(
  options: RunCodexSessionOptions,
  onEvent: (event: CodexSessionEvent) => void,
): Promise<void> {
  const executable = resolveCodexExecutable();
  const tempImages = createTempImageFiles(options.images);
  const args = buildCommandArgs(options, tempImages.files);
  const startedAt = Date.now();

  logger.info('Starting local Codex CLI session', {
    executable: basename(executable),
    threadId: options.threadId,
    cwd: options.cwd,
    model: options.model,
    imageCount: tempImages.files.length,
  });

  try {
    await new Promise<void>((resolve) => {
      const child = spawn(executable, args, {
        cwd: options.cwd,
        windowsHide: true,
      });

      let settled = false;
      let stdoutBuffer = '';
      let stderrBuffer = '';
      let finalText = '';
      let currentThreadId = options.threadId;
      let aborted = false;

      const finish = (event: CodexSessionEvent): void => {
        if (settled) {
          return;
        }

        settled = true;
        onEvent(event);
        resolve();
      };

      const abortHandler = () => {
        aborted = true;
        child.kill();
      };

      options.abortController?.signal.addEventListener('abort', abortHandler, { once: true });

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;

        while (true) {
          const newlineIndex = stdoutBuffer.indexOf('\n');
          if (newlineIndex === -1) {
            break;
          }

          const line = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

          if (!line) {
            continue;
          }

          try {
            const event = JSON.parse(line) as JsonEvent;

            if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
              currentThreadId = event.thread_id;
              onEvent({ type: 'thread.started', threadId: event.thread_id });
              continue;
            }

            const completedItem = (event as {
              type?: string;
              item?: { type?: string; text?: string };
            }).item;

            if (
              event.type === 'item.completed' &&
              completedItem?.type === 'agent_message' &&
              typeof completedItem.text === 'string'
            ) {
              finalText = completedItem.text;
            }
          } catch {
            logger.warn('Failed to parse Codex JSONL line', { line });
          }
        }
      });

      child.stderr.on('data', (chunk: string) => {
        stderrBuffer += chunk;
      });

      child.on('error', (error) => {
        options.abortController?.signal.removeEventListener('abort', abortHandler);
        if (aborted) {
          finish({ type: 'response.aborted', threadId: currentThreadId });
          return;
        }

        finish({
          type: 'response.failed',
          threadId: currentThreadId,
          error: error.message,
        });
      });

      child.on('close', (code) => {
        options.abortController?.signal.removeEventListener('abort', abortHandler);

        logger.info('Local Codex CLI session finished', {
          code,
          durationMs: Date.now() - startedAt,
          threadId: currentThreadId,
          textLength: finalText.trim().length,
          aborted,
        });

        if (aborted) {
          finish({ type: 'response.aborted', threadId: currentThreadId });
          return;
        }

        if (code === 0) {
          finish({
            type: 'response.completed',
            threadId: currentThreadId,
            text: finalText.trim(),
          });
          return;
        }

        finish({
          type: 'response.failed',
          threadId: currentThreadId,
          error: stderrBuffer.trim() || `Codex CLI exited with code ${code}.`,
        });
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Local Codex CLI session failed before launch', { error: message });
    onEvent({
      type: options.abortController?.signal.aborted ? 'response.aborted' : 'response.failed',
      threadId: options.threadId,
      ...(options.abortController?.signal.aborted ? {} : { error: message }),
    } as CodexSessionEvent);
  } finally {
    if (tempImages.dir) {
      rmSync(tempImages.dir, { recursive: true, force: true });
    }
  }
}
