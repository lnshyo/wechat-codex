import { posix, win32 } from 'node:path';

function stripWindowsNamespacePrefix(value: string): string {
  if (value.startsWith('\\\\?\\')) {
    return value.slice(4);
  }

  if (value.startsWith('//?/')) {
    return value.slice(4);
  }

  return value;
}

export function normalizeWorkspacePath(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const stripped = stripWindowsNamespacePrefix(trimmed);
  const looksWindowsPath = /^[a-zA-Z]:/.test(stripped) || stripped.includes('\\');

  if (looksWindowsPath) {
    return win32.normalize(stripped).replace(/\\/g, '/').toLowerCase();
  }

  return posix.normalize(stripped);
}

export function sameWorkspacePath(left?: string, right?: string): boolean {
  const normalizedLeft = normalizeWorkspacePath(left);
  const normalizedRight = normalizeWorkspacePath(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return normalizedLeft === normalizedRight;
}
