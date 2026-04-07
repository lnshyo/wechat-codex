import { WeChatApi } from './api.js';
import { loadSyncBuf, saveSyncBuf } from './sync-buf.js';
import { logger } from '../logger.js';
import type { WeixinMessage } from './types.js';
import { loadJson, saveJson } from '../store.js';
import { DATA_DIR } from '../constants.js';
import { join } from 'node:path';

const SESSION_EXPIRED_ERRCODE = -14;
const SESSION_EXPIRED_PAUSE_MS = 60 * 60 * 1000; // 1 hour
const BACKOFF_THRESHOLD = 3;
const BACKOFF_LONG_MS = 30_000;
const BACKOFF_SHORT_MS = 3_000;
const RECENT_MESSAGE_KEYS_PATH = join(DATA_DIR, 'recent-message-keys.json');
const DEFAULT_MAX_RECENT_MESSAGE_KEYS = 1000;

export interface MonitorCallbacks {
  onMessage: (msg: WeixinMessage) => Promise<void>;
  onSessionExpired: () => void;
}

interface PersistentMessageDeduperOptions {
  loadKeys?: () => string[];
  saveKeys?: (keys: string[]) => void;
  maxEntries?: number;
}

function extractMessageText(message: WeixinMessage): string {
  return (message.item_list ?? [])
    .map((item) => item.text_item?.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
}

export function createWeChatMessageDedupKey(message: WeixinMessage): string | undefined {
  if (message.message_id) {
    return `mid:${message.message_id}`;
  }

  if (!message.from_user_id || !message.create_time_ms) {
    return undefined;
  }

  const text = extractMessageText(message);
  return `fallback:${message.from_user_id}:${message.context_token ?? ''}:${message.create_time_ms}:${text}`;
}

function loadRecentMessageKeys(): string[] {
  return loadJson<string[]>(RECENT_MESSAGE_KEYS_PATH, []);
}

function saveRecentMessageKeys(keys: string[]): void {
  saveJson(RECENT_MESSAGE_KEYS_PATH, keys);
}

export function createPersistentMessageDeduper(options: PersistentMessageDeduperOptions = {}) {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_RECENT_MESSAGE_KEYS;
  const loadKeys = options.loadKeys ?? loadRecentMessageKeys;
  const saveKeys = options.saveKeys ?? saveRecentMessageKeys;
  const recentKeys = loadKeys().slice(-maxEntries);
  const knownKeys = new Set(recentKeys);

  function persist(): void {
    saveKeys([...knownKeys].slice(-maxEntries));
  }

  return {
    shouldProcess(message: WeixinMessage): boolean {
      const key = createWeChatMessageDedupKey(message);
      if (!key) {
        return true;
      }

      if (knownKeys.has(key)) {
        return false;
      }

      knownKeys.add(key);
      if (knownKeys.size > maxEntries) {
        const overflow = knownKeys.size - maxEntries;
        const iter = knownKeys.values();
        for (let i = 0; i < overflow; i++) {
          const value = iter.next().value;
          if (value !== undefined) {
            knownKeys.delete(value);
          }
        }
      }
      persist();
      return true;
    },
  };
}

export function createMonitor(api: WeChatApi, callbacks: MonitorCallbacks) {
  const controller = new AbortController();
  const messageDeduper = createPersistentMessageDeduper();

  async function run(): Promise<void> {
    let consecutiveFailures = 0;

    while (!controller.signal.aborted) {
      try {
        const buf = loadSyncBuf();
        logger.debug('Polling for messages', { hasBuf: buf.length > 0 });

        const resp = await api.getUpdates(buf || undefined);

        if (resp.ret === SESSION_EXPIRED_ERRCODE) {
          logger.warn('Session expired, pausing for 1 hour');
          callbacks.onSessionExpired();
          await sleep(SESSION_EXPIRED_PAUSE_MS, controller.signal);
          consecutiveFailures = 0;
          continue;
        }

        if (resp.ret !== undefined && resp.ret !== 0) {
          logger.warn('getUpdates returned error', { ret: resp.ret, retmsg: resp.retmsg });
        }

        // Save the new sync buffer regardless of ret
        if (resp.get_updates_buf) {
          saveSyncBuf(resp.get_updates_buf);
        }

        // Process messages (with deduplication)
        const messages = resp.msgs ?? [];
        if (messages.length > 0) {
          logger.info('Received messages', { count: messages.length });
          for (const msg of messages) {
            if (!messageDeduper.shouldProcess(msg)) {
              logger.info('Skipped duplicate inbound WeChat message', {
                messageId: msg.message_id,
                fromUserId: msg.from_user_id,
              });
              continue;
            }
            // Fire-and-forget: don't block the polling loop on message processing
            // This allows permission responses (y/n) to be received while a query is running
            callbacks.onMessage(msg).catch((err) => {
              const msg2 = err instanceof Error ? err.message : String(err);
              logger.error('Error processing message', { error: msg2, messageId: msg.message_id });
            });
          }
        }

        consecutiveFailures = 0;
      } catch (err) {
        if (controller.signal.aborted) {
          break;
        }

        consecutiveFailures++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error('Monitor error', { error: errorMsg, consecutiveFailures });

        const backoff = consecutiveFailures >= BACKOFF_THRESHOLD ? BACKOFF_LONG_MS : BACKOFF_SHORT_MS;
        logger.info(`Backing off ${backoff}ms`, { consecutiveFailures });
        await sleep(backoff, controller.signal);
      }
    }

    logger.info('Monitor stopped');
  }

  function stop(): void {
    if (!controller.signal.aborted) {
      logger.info('Stopping monitor...');
      controller.abort();
    }
  }

  return { run, stop };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
