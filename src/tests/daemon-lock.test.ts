import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  acquireDaemonLock,
  getRunningLockedPid,
  readDaemonLock,
  releaseDaemonLock,
} from '../daemon-lock.js';

test('acquireDaemonLock rejects a second live pid and preserves the first lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wcc-daemon-lock-'));
  const lockPath = join(dir, 'daemon.lock.json');
  const livePids = new Set([111]);

  const first = acquireDaemonLock(lockPath, 111, '2026-04-03T00:00:00.000Z', (pid) =>
    livePids.has(pid),
  );
  assert.deepEqual(first, { acquired: true });
  assert.equal(getRunningLockedPid(lockPath, (pid) => livePids.has(pid)), 111);

  const second = acquireDaemonLock(lockPath, 222, '2026-04-03T00:00:01.000Z', (pid) =>
    livePids.has(pid),
  );
  assert.deepEqual(second, { acquired: false, existingPid: 111 });
  assert.deepEqual(readDaemonLock(lockPath), {
    pid: 111,
    startedAt: '2026-04-03T00:00:00.000Z',
  });
});

test('getRunningLockedPid clears stale lock records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wcc-daemon-lock-'));
  const lockPath = join(dir, 'daemon.lock.json');

  acquireDaemonLock(lockPath, 333, '2026-04-03T00:00:00.000Z', () => true);
  assert.equal(getRunningLockedPid(lockPath, () => false), undefined);
  assert.equal(readDaemonLock(lockPath), null);
});

test('releaseDaemonLock only removes the owning pid lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wcc-daemon-lock-'));
  const lockPath = join(dir, 'daemon.lock.json');

  acquireDaemonLock(lockPath, 444, '2026-04-03T00:00:00.000Z', () => true);
  releaseDaemonLock(lockPath, 999);
  assert.deepEqual(readDaemonLock(lockPath), {
    pid: 444,
    startedAt: '2026-04-03T00:00:00.000Z',
  });

  releaseDaemonLock(lockPath, 444);
  assert.equal(readDaemonLock(lockPath), null);
});
