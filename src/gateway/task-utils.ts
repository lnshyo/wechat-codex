import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const MAX_MESSAGE_LENGTH = 2048;
const FRESH_SESSION_MEMORY_BOOTSTRAP_MARKER = '[wechat-codex:fresh-session-memory-bootstrap]';
export const DEFAULT_MAX_MEMORY_FILE_CHARS = 24_000;
export const DEFAULT_MAX_MEMORY_TOTAL_CHARS = 64_000;

export interface FreshSessionMemoryOptions {
  now?: Date;
  maxFileChars?: number;
  maxTotalChars?: number;
}

export function resolveMemoryRoot(cwd: string): string {
  const localGitPath = join(cwd, '.git');
  try {
    const gitFile = readFileSync(localGitPath, 'utf8').trim();
    const match = /^gitdir:\s*(.+)$/i.exec(gitFile);
    if (!match) {
      return cwd;
    }

    const gitDir = isAbsolute(match[1]) ? match[1] : resolve(cwd, match[1]);
    const commonGitDir = dirname(dirname(gitDir));
    return dirname(commonGitDir);
  } catch {
    return cwd;
  }
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getStartupMemoryPaths(cwd: string, now: Date): Array<{ label: string; path: string }> {
  const memoryRoot = resolveMemoryRoot(cwd);
  const today = formatLocalDate(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = formatLocalDate(yesterdayDate);
  const todayPath = join(memoryRoot, 'memory', `${today}.md`);
  let hasNonEmptyToday = false;
  if (existsSync(todayPath)) {
    try {
      hasNonEmptyToday = readFileSync(todayPath, 'utf8').trim().length > 0;
    } catch {
      hasNonEmptyToday = false;
    }
  }
  const dailyLabel = hasNonEmptyToday ? `memory/${today}.md` : `memory/${yesterday}.md`;

  return [
    'USER.md',
    'soul.md',
    'SESSION-STATE.md',
    dailyLabel,
    'MEMORY.md',
    'memory/CONTEXT.md',
  ].map((label) => ({ label, path: join(memoryRoot, ...label.split('/')) }));
}

export function loadFreshSessionMemorySnapshot(
  cwd: string,
  options: FreshSessionMemoryOptions = {},
): string {
  const now = options.now ?? new Date();
  const maxFileChars = Math.max(1, options.maxFileChars ?? DEFAULT_MAX_MEMORY_FILE_CHARS);
  const maxTotalChars = Math.max(1, options.maxTotalChars ?? DEFAULT_MAX_MEMORY_TOTAL_CHARS);
  const sections: string[] = [];
  let remaining = maxTotalChars;

  for (const file of getStartupMemoryPaths(cwd, now)) {
    if (!existsSync(file.path) || remaining <= 0) {
      continue;
    }

    let content: string;
    try {
      content = readFileSync(file.path, 'utf8');
    } catch {
      continue;
    }

    if (content.length > maxFileChars) {
      content = `${content.slice(0, maxFileChars)}\n[truncated at per-file limit]`;
    }

    const separatorLength = sections.length > 0 ? 2 : 0;
    if (remaining <= separatorLength) {
      remaining = 0;
      break;
    }
    remaining -= separatorLength;

    const section = `--- ${file.label} ---\n${content}`;
    if (section.length <= remaining) {
      sections.push(section);
      remaining -= section.length;
      continue;
    }

    const truncationMarker = '\n[truncated at total snapshot limit]';
    const contentBudget = Math.max(0, remaining - truncationMarker.length);
    sections.push(`${section.slice(0, contentBudget)}${truncationMarker}`.slice(0, remaining));
    remaining = 0;
  }

  return sections.join('\n\n');
}

export function buildPrompt(userText: string, hasImage: boolean): string {
  if (userText.trim()) {
    return userText;
  }

  if (hasImage) {
    return 'Please analyze the attached image.';
  }

  return 'Please respond to the latest WeChat message.';
}

export function buildFreshSessionSystemPrompt(
  systemPrompt?: string,
  cwd: string = process.cwd(),
  memoryOptions: FreshSessionMemoryOptions = {},
): string {
  if (systemPrompt?.includes(FRESH_SESSION_MEMORY_BOOTSTRAP_MARKER)) {
    return systemPrompt;
  }

  const snapshot = loadFreshSessionMemorySnapshot(cwd, memoryOptions);
  const bootstrap = [
    FRESH_SESSION_MEMORY_BOOTSTRAP_MARKER,
    'Fresh session bootstrap:',
    '- AGENTS.md is already discovered by Codex from the working directory.',
    '- The optional startup memory files available at launch are preloaded below in repository order.',
    '- Apply this snapshot before answering. Do not reread these files solely for startup.',
    '- Read a file again only when the current task specifically requires its latest full contents.',
    snapshot ? `<preloaded-startup-memory>\n${snapshot}\n</preloaded-startup-memory>` : '',
  ].filter(Boolean).join('\n');

  return systemPrompt ? `${systemPrompt}\n\n${bootstrap}` : bootstrap;
}

export function buildSessionSystemPrompt(
  systemPrompt: string | undefined,
  cwd: string,
  isFreshSession: boolean,
  memoryOptions: FreshSessionMemoryOptions = {},
): string | undefined {
  return isFreshSession
    ? buildFreshSessionSystemPrompt(systemPrompt, cwd, memoryOptions)
    : systemPrompt;
}

export function buildTaskPreview(userText: string, hasImage: boolean): string {
  const trimmed = userText.replace(/\s+/g, ' ').trim();

  if (!trimmed && hasImage) {
    return '[Image attachment]';
  }

  if (trimmed && hasImage) {
    return `${trimmed} [image]`;
  }

  return trimmed || '[Message]';
}

export function splitMessage(text: string, maxLength: number = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex < maxLength * 0.3) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n+/, '');
  }

  return chunks;
}
