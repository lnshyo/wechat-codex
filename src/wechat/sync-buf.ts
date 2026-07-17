import { join } from 'node:path';

import { DATA_DIR } from '../constants.js';
import { loadJson, saveJson } from '../store.js';

export function getSyncBufPath(accountId: string): string {
  return join(DATA_DIR, 'sync-bufs', `${encodeURIComponent(accountId)}.json`);
}

export function loadSyncBuf(accountId: string): string {
  return loadJson<string>(getSyncBufPath(accountId), '');
}

export function saveSyncBuf(accountId: string, buf: string): void {
  saveJson(getSyncBufPath(accountId), buf);
}
