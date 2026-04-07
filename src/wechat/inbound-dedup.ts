import type { WeixinMessage } from './types.js';
import { loadJson, saveJson } from '../store.js';

interface InboundDedupState {
  recentKeys: string[];
}

export interface InboundDedupStore {
  hasSeen(message: WeixinMessage): boolean;
  markSeen(message: WeixinMessage): boolean;
}

const DEFAULT_MAX_KEYS = 2000;

export function buildInboundDedupKey(message: WeixinMessage): string {
  if (message.message_id !== undefined && message.message_id !== null) {
    return `message_id:${message.message_id}`;
  }

  return [
    'fallback',
    message.from_user_id ?? '',
    message.to_user_id ?? '',
    message.seq ?? '',
    message.create_time_ms ?? '',
    message.message_type ?? '',
    message.context_token ?? '',
  ].join('|');
}

export function createInboundDedupStore(
  filePath: string,
  maxKeys = DEFAULT_MAX_KEYS,
): InboundDedupStore {
  const persisted = loadJson<InboundDedupState>(filePath, { recentKeys: [] });
  const keys = persisted.recentKeys.slice(-maxKeys);
  const keySet = new Set(keys);

  function persist(): void {
    saveJson(filePath, { recentKeys: keys });
  }

  function hasSeen(message: WeixinMessage): boolean {
    return keySet.has(buildInboundDedupKey(message));
  }

  function markSeen(message: WeixinMessage): boolean {
    const key = buildInboundDedupKey(message);
    if (keySet.has(key)) {
      return false;
    }

    keySet.add(key);
    keys.push(key);

    while (keys.length > maxKeys) {
      const oldest = keys.shift();
      if (oldest) {
        keySet.delete(oldest);
      }
    }

    persist();
    return true;
  }

  return {
    hasSeen,
    markSeen,
  };
}
