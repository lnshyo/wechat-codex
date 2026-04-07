import { SYNC_BUF_PATH } from '../constants.js';
import { loadJson, saveJson } from '../store.js';

export function loadSyncBuf(): string {
  return loadJson<string>(SYNC_BUF_PATH, '');
}

export function saveSyncBuf(buf: string): void {
  saveJson(SYNC_BUF_PATH, buf);
}
