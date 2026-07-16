import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildFreshSessionSystemPrompt,
  buildSessionSystemPrompt,
  loadFreshSessionMemorySnapshot,
} from '../gateway/task-utils.js';

function createMemoryWorkspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'wechat-codex-memory-'));
  mkdirSync(join(cwd, 'memory'), { recursive: true });
  return cwd;
}

test('buildFreshSessionSystemPrompt creates a bootstrap instruction when none exists', () => {
  const cwd = createMemoryWorkspace();
  writeFileSync(join(cwd, 'USER.md'), 'user-memory', 'utf8');
  const prompt = buildFreshSessionSystemPrompt(undefined, cwd);

  assert.match(prompt, /\[wechat-codex:fresh-session-memory-bootstrap\]/);
  assert.match(prompt, /AGENTS\.md/);
  assert.match(prompt, /<preloaded-startup-memory>/);
  assert.match(prompt, /--- USER\.md ---\nuser-memory/);
  assert.match(prompt, /must not be reread|do not reread/i);
  rmSync(cwd, { recursive: true, force: true });
});

test('buildFreshSessionSystemPrompt appends bootstrap once to an existing system prompt', () => {
  const basePrompt = 'Always be concise.';
  const withBootstrap = buildFreshSessionSystemPrompt(basePrompt);
  const duplicated = buildFreshSessionSystemPrompt(withBootstrap);

  assert.match(withBootstrap, /Always be concise\./);
  assert.equal(
    (duplicated.match(/\[wechat-codex:fresh-session-memory-bootstrap\]/g) || []).length,
    1,
  );
});

test('buildSessionSystemPrompt preloads memory only for fresh sessions', () => {
  const cwd = createMemoryWorkspace();
  writeFileSync(join(cwd, 'USER.md'), 'fresh-only', 'utf8');

  const resumed = buildSessionSystemPrompt('base', cwd, false);
  const fresh = buildSessionSystemPrompt('base', cwd, true);

  assert.equal(resumed, 'base');
  assert.match(fresh ?? '', /fresh-only/);
  assert.match(fresh ?? '', /\[wechat-codex:fresh-session-memory-bootstrap\]/);
  rmSync(cwd, { recursive: true, force: true });
});

test('loadFreshSessionMemorySnapshot preserves order and prefers today over yesterday', () => {
  const cwd = createMemoryWorkspace();
  writeFileSync(join(cwd, 'USER.md'), 'user', 'utf8');
  writeFileSync(join(cwd, 'soul.md'), 'soul', 'utf8');
  writeFileSync(join(cwd, 'SESSION-STATE.md'), 'state', 'utf8');
  writeFileSync(join(cwd, 'memory', '2026-07-16.md'), 'today', 'utf8');
  writeFileSync(join(cwd, 'memory', '2026-07-15.md'), 'yesterday', 'utf8');
  writeFileSync(join(cwd, 'MEMORY.md'), 'durable', 'utf8');

  const snapshot = loadFreshSessionMemorySnapshot(cwd, {
    now: new Date(2026, 6, 16, 12),
  });

  assert.ok(snapshot.indexOf('USER.md') < snapshot.indexOf('soul.md'));
  assert.ok(snapshot.indexOf('soul.md') < snapshot.indexOf('SESSION-STATE.md'));
  assert.ok(snapshot.indexOf('SESSION-STATE.md') < snapshot.indexOf('memory/2026-07-16.md'));
  assert.ok(snapshot.indexOf('memory/2026-07-16.md') < snapshot.indexOf('MEMORY.md'));
  assert.doesNotMatch(snapshot, /2026-07-15|yesterday/);
  rmSync(cwd, { recursive: true, force: true });
});

test('loadFreshSessionMemorySnapshot falls back to yesterday and skips missing files', () => {
  const cwd = createMemoryWorkspace();
  writeFileSync(join(cwd, 'memory', '2026-07-15.md'), 'yesterday-only', 'utf8');

  const snapshot = loadFreshSessionMemorySnapshot(cwd, {
    now: new Date(2026, 6, 16, 12),
  });

  assert.match(snapshot, /memory\/2026-07-15\.md/);
  assert.match(snapshot, /yesterday-only/);
  assert.doesNotMatch(snapshot, /USER\.md/);
  rmSync(cwd, { recursive: true, force: true });
});

test('loadFreshSessionMemorySnapshot falls back to yesterday when today is empty', () => {
  const cwd = createMemoryWorkspace();
  writeFileSync(join(cwd, 'memory', '2026-07-16.md'), '  \n', 'utf8');
  writeFileSync(join(cwd, 'memory', '2026-07-15.md'), 'continued-context', 'utf8');

  const snapshot = loadFreshSessionMemorySnapshot(cwd, {
    now: new Date(2026, 6, 16, 12),
  });

  assert.match(snapshot, /memory\/2026-07-15\.md/);
  assert.match(snapshot, /continued-context/);
  rmSync(cwd, { recursive: true, force: true });
});

test('loadFreshSessionMemorySnapshot enforces per-file and total caps', () => {
  const cwd = createMemoryWorkspace();
  writeFileSync(join(cwd, 'USER.md'), 'u'.repeat(100), 'utf8');
  writeFileSync(join(cwd, 'soul.md'), 's'.repeat(100), 'utf8');

  const perFileCapped = loadFreshSessionMemorySnapshot(cwd, {
    maxFileChars: 10,
    maxTotalChars: 1_000,
  });
  const totalCapped = loadFreshSessionMemorySnapshot(cwd, {
    maxFileChars: 1_000,
    maxTotalChars: 30,
  });

  assert.match(perFileCapped, /u{10}\n\[truncated at per-file limit\]/);
  assert.match(totalCapped, /\[truncated at total snapshot/);
  assert.ok(totalCapped.length <= 30);

  const separatorCapped = loadFreshSessionMemorySnapshot(cwd, {
    maxFileChars: 1_000,
    maxTotalChars: 232,
  });
  assert.match(separatorCapped, /soul\.md/);
  assert.ok(separatorCapped.length <= 232);
  rmSync(cwd, { recursive: true, force: true });
});
