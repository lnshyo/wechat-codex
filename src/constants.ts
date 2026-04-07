import { homedir } from 'node:os';
import { join } from 'node:path';

export const DATA_DIR = process.env.WCC_DATA_DIR || join(homedir(), '.wechat-codex');
export const ACCOUNTS_DIR = join(DATA_DIR, 'accounts');
export const SESSIONS_DIR = join(DATA_DIR, 'sessions');
export const LOG_DIR = join(DATA_DIR, 'logs');
export const CONFIG_PATH = join(DATA_DIR, 'config.env');
export const SERVICE_PID_PATH = join(DATA_DIR, 'service.pid.json');
export const DAEMON_LOCK_PATH = join(DATA_DIR, 'daemon.lock.json');
export const SYNC_BUF_PATH = join(DATA_DIR, 'get_updates_buf');
