import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ACCOUNTS_DIR } from '../constants.js';
import { logger } from '../logger.js';
import { loadJson, saveJson } from '../store.js';

export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';

export interface AccountData {
  botToken: string;
  accountId: string;
  baseUrl: string;
  userId: string;
  createdAt: string;
}

function validateAccountId(accountId: string): void {
  if (!/^[a-zA-Z0-9_.@=-]+$/.test(accountId)) {
    throw new Error(`Invalid accountId: "${accountId}"`);
  }
}

function accountPath(accountId: string): string {
  validateAccountId(accountId);
  return join(ACCOUNTS_DIR, `${accountId}.json`);
}

export function saveAccount(data: AccountData): void {
  saveJson(accountPath(data.accountId), data);
  logger.info('Account saved', { accountId: data.accountId });
}

export function loadAccount(accountId: string): AccountData | null {
  const data = loadJson<AccountData | null>(accountPath(accountId), null);
  if (data) {
    logger.info('Account loaded', { accountId });
  }
  return data;
}

export function loadLatestAccount(): AccountData | null {
  try {
    const files = readdirSync(ACCOUNTS_DIR).filter((file) => file.endsWith('.json'));
    if (files.length === 0) {
      return null;
    }

    let latestFile = files[0];
    let latestMTime = 0;

    for (const file of files) {
      const mtime = statSync(join(ACCOUNTS_DIR, file)).mtimeMs;
      if (mtime > latestMTime) {
        latestMTime = mtime;
        latestFile = file;
      }
    }

    return loadAccount(latestFile.replace(/\.json$/, ''));
  } catch {
    return null;
  }
}
