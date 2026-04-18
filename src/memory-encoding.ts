import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export type DetectedEncoding = 'UTF-8' | 'UTF-8 BOM' | 'UTF-16 LE' | 'UTF-16 BE' | 'Non-UTF8/legacy';

export interface EncodingDetails {
  encoding: DetectedEncoding;
  hasBom: boolean;
  hasNullBytes: boolean;
  isValidUtf8: boolean;
}

export interface AuditedMemoryMarkdownFile extends EncodingDetails {
  path: string;
  sizeBytes: number;
}

export interface MemoryEncodingAuditSummary {
  totalFiles: number;
  utf8Files: number;
  utf8BomFiles: number;
  utf16Files: number;
  nonUtf8Files: number;
  filesWithBom: number;
  filesWithNullBytes: number;
  invalidUtf8Files: number;
}

export interface MemoryEncodingAuditReport {
  files: AuditedMemoryMarkdownFile[];
  summary: MemoryEncodingAuditSummary;
}

const ROOT_MEMORY_FILES = ['AGENTS.md', 'USER.md', 'soul.md', 'SESSION-STATE.md', 'MEMORY.md'] as const;
const MEMORY_DIRECTORIES = ['memory', 'rules'] as const;

function isValidUtf8(buffer: Buffer, start = 0): boolean {
  let index = start;
  while (index < buffer.length) {
    const byte = buffer[index];

    if (byte <= 0x7f) {
      index += 1;
      continue;
    }

    if (byte >= 0xc2 && byte <= 0xdf) {
      if (index + 1 >= buffer.length) return false;
      if ((buffer[index + 1] & 0xc0) !== 0x80) return false;
      index += 2;
      continue;
    }

    if (byte === 0xe0) {
      if (index + 2 >= buffer.length) return false;
      const b1 = buffer[index + 1];
      const b2 = buffer[index + 2];
      if (b1 < 0xa0 || b1 > 0xbf || (b2 & 0xc0) !== 0x80) return false;
      index += 3;
      continue;
    }

    if ((byte >= 0xe1 && byte <= 0xec) || (byte >= 0xee && byte <= 0xef)) {
      if (index + 2 >= buffer.length) return false;
      const b1 = buffer[index + 1];
      const b2 = buffer[index + 2];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return false;
      index += 3;
      continue;
    }

    if (byte === 0xed) {
      if (index + 2 >= buffer.length) return false;
      const b1 = buffer[index + 1];
      const b2 = buffer[index + 2];
      if (b1 < 0x80 || b1 > 0x9f || (b2 & 0xc0) !== 0x80) return false;
      index += 3;
      continue;
    }

    if (byte === 0xf0) {
      if (index + 3 >= buffer.length) return false;
      const b1 = buffer[index + 1];
      const b2 = buffer[index + 2];
      const b3 = buffer[index + 3];
      if (b1 < 0x90 || b1 > 0xbf || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return false;
      index += 4;
      continue;
    }

    if (byte >= 0xf1 && byte <= 0xf3) {
      if (index + 3 >= buffer.length) return false;
      const b1 = buffer[index + 1];
      const b2 = buffer[index + 2];
      const b3 = buffer[index + 3];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return false;
      index += 4;
      continue;
    }

    if (byte === 0xf4) {
      if (index + 3 >= buffer.length) return false;
      const b1 = buffer[index + 1];
      const b2 = buffer[index + 2];
      const b3 = buffer[index + 3];
      if (b1 < 0x80 || b1 > 0x8f || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return false;
      index += 4;
      continue;
    }

    return false;
  }

  return true;
}

export function detectBufferEncoding(buffer: Buffer): EncodingDetails {
  const hasUtf8Bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const hasUtf16LeBom = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
  const hasUtf16BeBom = buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff;
  const hasNullBytes = buffer.includes(0x00);

  if (hasUtf8Bom) {
    return {
      encoding: 'UTF-8 BOM',
      hasBom: true,
      hasNullBytes,
      isValidUtf8: isValidUtf8(buffer, 3),
    };
  }

  if (hasUtf16LeBom) {
    return {
      encoding: 'UTF-16 LE',
      hasBom: true,
      hasNullBytes,
      isValidUtf8: false,
    };
  }

  if (hasUtf16BeBom) {
    return {
      encoding: 'UTF-16 BE',
      hasBom: true,
      hasNullBytes,
      isValidUtf8: false,
    };
  }

  const validUtf8 = isValidUtf8(buffer);
  return {
    encoding: validUtf8 ? 'UTF-8' : 'Non-UTF8/legacy',
    hasBom: false,
    hasNullBytes,
    isValidUtf8: validUtf8,
  };
}

function walkMarkdownFiles(root: string, relativeDirectory: string): string[] {
  const directory = path.join(root, relativeDirectory);
  const entries = readdirSync(directory, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const fullPath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(root, relativePath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      results.push(relativePath);
    }
  }

  return results;
}

export function listMemoryMarkdownFiles(root: string): string[] {
  const files: string[] = [];

  for (const file of ROOT_MEMORY_FILES) {
    const fullPath = path.join(root, file);
    try {
      if (statSync(fullPath).isFile()) {
        files.push(file);
      }
    } catch {
      // Optional memory files are skipped when absent.
    }
  }

  for (const directory of MEMORY_DIRECTORIES) {
    const fullPath = path.join(root, directory);
    try {
      if (statSync(fullPath).isDirectory()) {
        files.push(...walkMarkdownFiles(root, directory));
      }
    } catch {
      // Optional memory directories are skipped when absent.
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export function auditMemoryMarkdownFiles(root: string): MemoryEncodingAuditReport {
  const files = listMemoryMarkdownFiles(root).map((relativePath) => {
    const fullPath = path.join(root, relativePath);
    const buffer = readFileSync(fullPath);
    const details = detectBufferEncoding(buffer);
    return {
      path: relativePath,
      sizeBytes: buffer.length,
      ...details,
    };
  });

  const summary: MemoryEncodingAuditSummary = {
    totalFiles: files.length,
    utf8Files: files.filter((entry) => entry.encoding === 'UTF-8').length,
    utf8BomFiles: files.filter((entry) => entry.encoding === 'UTF-8 BOM').length,
    utf16Files: files.filter(
      (entry) => entry.encoding === 'UTF-16 LE' || entry.encoding === 'UTF-16 BE',
    ).length,
    nonUtf8Files: files.filter((entry) => entry.encoding === 'Non-UTF8/legacy').length,
    filesWithBom: files.filter((entry) => entry.hasBom).length,
    filesWithNullBytes: files.filter((entry) => entry.hasNullBytes).length,
    invalidUtf8Files: files.filter((entry) => !entry.isValidUtf8).length,
  };

  return { files, summary };
}
