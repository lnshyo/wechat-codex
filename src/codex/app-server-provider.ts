import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { logger } from '../logger.js';
import {
  buildHttpProviderArgs,
  buildMcpIsolationArgs,
  loadConfiguredMcpServers,
  resolveCodexExecutablePath,
  type CodexSessionEvent,
  type RunCodexSessionOptions,
} from './provider.js';

interface RpcResponse {
  id: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface ActiveTurn {
  abortHandler?: () => void;
  abortRequested: boolean;
  finalText: string;
  streamedText: string;
  lastError?: string;
  onEvent: (event: CodexSessionEvent) => void;
  resolve: () => void;
  settled: boolean;
  threadId: string;
  turnId?: string;
}

interface ThreadResponse {
  thread?: { id?: string };
}

interface TurnStartResponse {
  turn?: { id?: string };
}

const REQUEST_TIMEOUT_MS = 60_000;
const INITIALIZE_TIMEOUT_MS = 15_000;

export class AppServerUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppServerUnavailableError';
  }
}

function decodeDataUri(dataUri: string): { extension: string; bytes: Buffer } {
  const matches = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid data URI image payload.');
  }

  const mediaType = matches[1];
  return {
    extension: mediaType.split('/')[1] || 'png',
    bytes: Buffer.from(matches[2], 'base64'),
  };
}

function createTempImageFiles(images?: string[]): { dir?: string; files: string[] } {
  if (!images?.length) {
    return { files: [] };
  }

  const dir = mkdtempSync(join(tmpdir(), 'wechat-codex-app-server-images-'));
  const files = images.map((image, index) => {
    const { extension, bytes } = decodeDataUri(image);
    const path = join(dir, `image-${index + 1}.${extension}`);
    writeFileSync(path, bytes);
    return path;
  });

  return { dir, files };
}

function composePrompt(prompt: string, systemPrompt?: string): string {
  return systemPrompt ? `${systemPrompt}\n\nUser request:\n${prompt}` : prompt;
}

export function buildAppServerCommandArgs(configuredMcpServers: readonly string[] = []): string[] {
  return [
    'app-server',
    '--listen',
    'stdio://',
    '--disable',
    'plugins',
    ...buildMcpIsolationArgs(configuredMcpServers),
    ...buildHttpProviderArgs(),
  ];
}

export function buildThreadStartParams(options: RunCodexSessionOptions): Record<string, unknown> {
  return {
    model: options.model ?? null,
    modelProvider: 'wechat_http',
    serviceTier: 'fast',
    cwd: options.cwd,
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    ephemeral: options.ephemeral ?? false,
    experimentalRawEvents: false,
    persistExtendedHistory: false,
  };
}

export function buildThreadResumeParams(
  threadId: string,
  options: RunCodexSessionOptions,
): Record<string, unknown> {
  return {
    threadId,
    model: options.model ?? null,
    modelProvider: 'wechat_http',
    serviceTier: 'fast',
    cwd: options.cwd,
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    persistExtendedHistory: false,
  };
}

export function buildTurnStartParams(
  threadId: string,
  options: RunCodexSessionOptions,
  imageFiles: readonly string[] = [],
): Record<string, unknown> {
  return {
    threadId,
    input: [
      { type: 'text', text: composePrompt(options.prompt, options.systemPrompt), text_elements: [] },
      ...imageFiles.map((path) => ({ type: 'localImage', path })),
    ],
    cwd: options.cwd,
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
    model: options.model ?? null,
    serviceTier: 'fast',
    effort: options.reasoningEffort ?? 'medium',
  };
}

function getString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

class CodexAppServerClient {
  private activeTurns = new Map<string, ActiveTurn>();
  private child?: ChildProcessWithoutNullStreams;
  private intentionalStop = false;
  private loadedThreads = new Set<string>();
  private nextRequestId = 1;
  private pending = new Map<string, PendingRequest>();
  private readyPromise?: Promise<void>;
  private stderrTail = '';
  private stdoutBuffer = '';

  async warm(): Promise<void> {
    try {
      await this.ensureReady();
    } catch (error) {
      throw new AppServerUnavailableError(
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? { cause: error } : undefined,
      );
    }
  }

  async run(
    options: RunCodexSessionOptions,
    onEvent: (event: CodexSessionEvent) => void,
  ): Promise<void> {
    try {
      await this.ensureReady();
    } catch (error) {
      throw new AppServerUnavailableError(
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? { cause: error } : undefined,
      );
    }

    let threadId = options.threadId;
    try {
      if (!threadId) {
        const response = (await this.request(
          'thread/start',
          buildThreadStartParams(options),
        )) as ThreadResponse;
        threadId = response.thread?.id;
        if (!threadId) {
          throw new Error('Codex App Server returned no thread id.');
        }
        this.loadedThreads.add(threadId);
        onEvent({ type: 'thread.started', threadId });
      } else if (!this.loadedThreads.has(threadId)) {
        const response = (await this.request(
          'thread/resume',
          buildThreadResumeParams(threadId, options),
        )) as ThreadResponse;
        const resumedThreadId = response.thread?.id;
        if (!resumedThreadId) {
          throw new Error('Codex App Server returned no resumed thread id.');
        }
        threadId = resumedThreadId;
        this.loadedThreads.add(threadId);
      }
    } catch (error) {
      onEvent({
        type: options.abortController?.signal.aborted ? 'response.aborted' : 'response.failed',
        threadId,
        ...(options.abortController?.signal.aborted
          ? {}
          : { error: error instanceof Error ? error.message : String(error) }),
      } as CodexSessionEvent);
      return;
    }

    if (options.abortController?.signal.aborted) {
      onEvent({ type: 'response.aborted', threadId });
      return;
    }

    if (this.activeTurns.has(threadId)) {
      onEvent({
        type: 'response.failed',
        threadId,
        error: 'This Codex thread already has an active App Server turn.',
      });
      return;
    }

    const tempImages = createTempImageFiles(options.images);
    let resolveTurn!: () => void;
    const completed = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });
    const active: ActiveTurn = {
      abortRequested: false,
      finalText: '',
      streamedText: '',
      onEvent,
      resolve: resolveTurn,
      settled: false,
      threadId,
    };

    const abortHandler = () => {
      active.abortRequested = true;
      if (active.turnId) {
        void this.request('turn/interrupt', {
          threadId: active.threadId,
          turnId: active.turnId,
        }).catch((error) => {
          logger.warn('Failed to interrupt Codex App Server turn', {
            threadId: active.threadId,
            turnId: active.turnId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    };
    active.abortHandler = abortHandler;
    options.abortController?.signal.addEventListener('abort', abortHandler, { once: true });
    this.activeTurns.set(threadId, active);

    const startedAt = Date.now();
    logger.info('Starting Codex App Server turn', {
      threadId,
      cwd: options.cwd,
      model: options.model,
      imageCount: tempImages.files.length,
    });

    try {
      const response = (await this.request(
        'turn/start',
        buildTurnStartParams(threadId, options, tempImages.files),
      )) as TurnStartResponse;
      active.turnId = response.turn?.id;
      if (!active.turnId) {
        this.finishTurn(active, {
          type: 'response.failed',
          threadId,
          error: 'Codex App Server returned no turn id.',
        });
      } else if (active.abortRequested) {
        abortHandler();
      }
      await completed;
    } catch (error) {
      this.finishTurn(active, {
        type: active.abortRequested ? 'response.aborted' : 'response.failed',
        threadId,
        ...(active.abortRequested
          ? {}
          : { error: error instanceof Error ? error.message : String(error) }),
      } as CodexSessionEvent);
      await completed;
    } finally {
      options.abortController?.signal.removeEventListener('abort', abortHandler);
      if (tempImages.dir) {
        rmSync(tempImages.dir, { recursive: true, force: true });
      }
      logger.info('Codex App Server turn finished', {
        threadId,
        turnId: active.turnId,
        durationMs: Date.now() - startedAt,
        textLength: (active.finalText || active.streamedText).trim().length,
        aborted: active.abortRequested,
      });
    }
  }

  stop(): void {
    this.intentionalStop = true;
    const child = this.child;
    this.child = undefined;
    this.readyPromise = undefined;
    this.loadedThreads.clear();
    if (child && !child.killed) {
      child.kill();
    }
    this.rejectPending(new Error('Codex App Server stopped.'));
    this.failActiveTurns('Codex App Server stopped.');
  }

  private async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.start().catch((error) => {
        this.readyPromise = undefined;
        const child = this.child;
        this.child = undefined;
        if (child && !child.killed) {
          child.kill();
        }
        throw error;
      });
    }
    await this.readyPromise;
  }

  private async start(): Promise<void> {
    this.intentionalStop = false;
    this.stderrTail = '';
    this.stdoutBuffer = '';
    const executable = resolveCodexExecutablePath();
    const args = buildAppServerCommandArgs(loadConfiguredMcpServers());
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.handleStdout(chunk));
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-8_192);
    });
    child.on('error', (error) => this.handleProcessExit(child, error));
    child.on('close', (code) => {
      this.handleProcessExit(
        child,
        new Error(
          `Codex App Server exited with code ${code}.${this.stderrTail.trim() ? ` ${this.stderrTail.trim()}` : ''}`,
        ),
      );
    });

    await this.requestRaw(
      'initialize',
      {
        clientInfo: {
          name: 'wechat_codex',
          title: 'wechat-codex',
          version: '0.1.0',
        },
        capabilities: null,
      },
      INITIALIZE_TIMEOUT_MS,
    );
    this.notify('initialized');
    logger.info('Codex App Server ready', {
      executable: basename(executable),
      pid: child.pid,
    });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return this.requestRaw(method, params, REQUEST_TIMEOUT_MS);
  }

  private requestRaw(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const child = this.child;
    if (!child || child.stdin.destroyed) {
      return Promise.reject(new Error('Codex App Server is not running.'));
    }

    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(String(id), { resolve, reject, timer });

      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`, (error) => {
        if (!error) {
          return;
        }
        const pending = this.pending.get(String(id));
        if (!pending) {
          return;
        }
        clearTimeout(pending.timer);
        this.pending.delete(String(id));
        pending.reject(error);
      });
    });
  }

  private notify(method: string, params?: unknown): void {
    const child = this.child;
    if (!child || child.stdin.destroyed) {
      return;
    }
    child.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`);
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }
      try {
        this.handleMessage(JSON.parse(line) as RpcMessage);
      } catch (error) {
        logger.warn('Failed to parse Codex App Server JSONL line', {
          line,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private handleMessage(message: RpcMessage): void {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(String(message.id));
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(String(message.id));
      if (message.error) {
        pending.reject(
          new Error(
            message.error.message || `Codex App Server error ${message.error.code ?? 'unknown'}.`,
          ),
        );
      } else {
        pending.resolve((message as RpcResponse).result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }

    if (message.method) {
      this.handleNotification(message.method, message.params);
    }
  }

  private handleServerRequest(message: RpcMessage): void {
    const child = this.child;
    if (!child || child.stdin.destroyed || message.id === undefined) {
      return;
    }

    let result: unknown;
    switch (message.method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        result = { decision: 'acceptForSession' };
        break;
      case 'applyPatchApproval':
      case 'execCommandApproval':
        result = { decision: 'approved_for_session' };
        break;
      default:
        child.stdin.write(
          `${JSON.stringify({
            id: message.id,
            error: { code: -32601, message: `Unsupported App Server request: ${message.method}` },
          })}\n`,
        );
        return;
    }
    child.stdin.write(`${JSON.stringify({ id: message.id, result })}\n`);
  }

  private handleNotification(method: string, params: unknown): void {
    const threadId = getString(params, 'threadId');
    if (!threadId) {
      return;
    }
    const active = this.activeTurns.get(threadId);
    if (!active || active.settled) {
      return;
    }

    const turnId = getString(params, 'turnId');
    if (active.turnId && turnId && turnId !== active.turnId) {
      return;
    }

    if (method === 'item/agentMessage/delta') {
      active.streamedText += getString(params, 'delta') ?? '';
      return;
    }

    if (method === 'item/completed') {
      const item =
        params && typeof params === 'object'
          ? (params as Record<string, unknown>).item
          : undefined;
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        if (record.type === 'agentMessage' && typeof record.text === 'string') {
          active.finalText = record.text;
        }
      }
      return;
    }

    if (method === 'error') {
      const error =
        params && typeof params === 'object'
          ? (params as Record<string, unknown>).error
          : undefined;
      active.lastError = getString(error, 'message') ?? active.lastError;
      return;
    }

    if (method !== 'turn/completed') {
      return;
    }

    const turn =
      params && typeof params === 'object'
        ? (params as Record<string, unknown>).turn
        : undefined;
    const status = getString(turn, 'status');
    const turnError =
      turn && typeof turn === 'object' ? (turn as Record<string, unknown>).error : undefined;
    const errorMessage = getString(turnError, 'message') ?? active.lastError;

    if (active.abortRequested || status === 'interrupted') {
      this.finishTurn(active, { type: 'response.aborted', threadId });
    } else if (status === 'completed') {
      this.finishTurn(active, {
        type: 'response.completed',
        threadId,
        text: (active.finalText || active.streamedText).trim(),
      });
    } else {
      this.finishTurn(active, {
        type: 'response.failed',
        threadId,
        error: errorMessage || `Codex App Server turn ended with status ${status || 'unknown'}.`,
      });
    }
  }

  private finishTurn(active: ActiveTurn, event: CodexSessionEvent): void {
    if (active.settled) {
      return;
    }
    active.settled = true;
    this.activeTurns.delete(active.threadId);
    active.onEvent(event);
    active.resolve();
  }

  private handleProcessExit(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) {
      return;
    }
    this.child = undefined;
    this.readyPromise = undefined;
    this.loadedThreads.clear();
    this.rejectPending(error);
    this.failActiveTurns(error.message);
    if (!this.intentionalStop) {
      logger.error('Codex App Server process stopped', { error: error.message });
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private failActiveTurns(error: string): void {
    for (const active of [...this.activeTurns.values()]) {
      this.finishTurn(
        active,
        active.abortRequested
          ? { type: 'response.aborted', threadId: active.threadId }
          : { type: 'response.failed', threadId: active.threadId, error },
      );
    }
  }
}

const sharedClient = new CodexAppServerClient();

export async function runCodexAppServerSession(
  options: RunCodexSessionOptions,
  onEvent: (event: CodexSessionEvent) => void,
): Promise<void> {
  await sharedClient.run(options, onEvent);
}

export async function warmCodexAppServer(): Promise<void> {
  await sharedClient.warm();
}

export function shutdownCodexAppServer(): void {
  sharedClient.stop();
}
