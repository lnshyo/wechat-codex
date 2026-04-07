import { rmSync } from 'node:fs';

import { loadJson, saveJson } from './store.js';

export interface DaemonLockRecord {
  pid: number;
  startedAt: string;
}

export interface AcquireDaemonLockResult {
  acquired: boolean;
  existingPid?: number;
}

export function readDaemonLock(lockPath: string): DaemonLockRecord | null {
  const record = loadJson<DaemonLockRecord | null>(lockPath, null);
  if (!record || !Number.isInteger(record.pid) || record.pid <= 0 || !record.startedAt) {
    return null;
  }

  return record;
}

export function getRunningLockedPid(
  lockPath: string,
  isProcessRunning: (pid: number) => boolean,
): number | undefined {
  const record = readDaemonLock(lockPath);
  if (!record) {
    return undefined;
  }

  if (!isProcessRunning(record.pid)) {
    removeDaemonLock(lockPath);
    return undefined;
  }

  return record.pid;
}

export function acquireDaemonLock(
  lockPath: string,
  pid: number,
  startedAt: string,
  isProcessRunning: (pid: number) => boolean,
): AcquireDaemonLockResult {
  const runningPid = getRunningLockedPid(lockPath, isProcessRunning);
  if (runningPid && runningPid !== pid) {
    return {
      acquired: false,
      existingPid: runningPid,
    };
  }

  saveJson(lockPath, {
    pid,
    startedAt,
  } satisfies DaemonLockRecord);

  return { acquired: true };
}

export function releaseDaemonLock(lockPath: string, pid: number): void {
  const record = readDaemonLock(lockPath);
  if (!record || record.pid !== pid) {
    return;
  }

  removeDaemonLock(lockPath);
}

function removeDaemonLock(lockPath: string): void {
  try {
    rmSync(lockPath, { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}
