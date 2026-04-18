import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  auditMemoryMarkdownFiles,
  detectBufferEncoding,
  listMemoryMarkdownFiles,
} from '../memory-encoding.js';

test('detectBufferEncoding identifies UTF-8, UTF-8 BOM, UTF-16 LE, and invalid byte sequences', () => {
  assert.deepEqual(detectBufferEncoding(Buffer.from('hello', 'utf8')), {
    encoding: 'UTF-8',
    hasBom: false,
    hasNullBytes: false,
    isValidUtf8: true,
  });

  assert.deepEqual(detectBufferEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69])), {
    encoding: 'UTF-8 BOM',
    hasBom: true,
    hasNullBytes: false,
    isValidUtf8: true,
  });

  assert.deepEqual(detectBufferEncoding(Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])), {
    encoding: 'UTF-16 LE',
    hasBom: true,
    hasNullBytes: true,
    isValidUtf8: false,
  });

  assert.deepEqual(detectBufferEncoding(Buffer.from([0xc3, 0x28])), {
    encoding: 'Non-UTF8/legacy',
    hasBom: false,
    hasNullBytes: false,
    isValidUtf8: false,
  });
});

test('listMemoryMarkdownFiles scans only the repository memory layer', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'memory-encoding-list-'));

  try {
    mkdirSync(path.join(root, 'memory'), { recursive: true });
    mkdirSync(path.join(root, 'rules'), { recursive: true });
    mkdirSync(path.join(root, 'docs'), { recursive: true });

    writeFileSync(path.join(root, 'AGENTS.md'), '# root');
    writeFileSync(path.join(root, 'USER.md'), '# user');
    writeFileSync(path.join(root, 'memory', '2026-04-17.md'), '# daily');
    writeFileSync(path.join(root, 'rules', 'docs-memory-sync.md'), '# rules');
    writeFileSync(path.join(root, 'docs', 'ignore-me.md'), '# docs');

    const files = listMemoryMarkdownFiles(root);

    assert.deepEqual(files, [
      'AGENTS.md',
      'memory/2026-04-17.md',
      'rules/docs-memory-sync.md',
      'USER.md',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('auditMemoryMarkdownFiles reports file-level details and summary counts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'memory-encoding-audit-'));

  try {
    mkdirSync(path.join(root, 'memory'), { recursive: true });
    mkdirSync(path.join(root, 'rules'), { recursive: true });

    writeFileSync(path.join(root, 'AGENTS.md'), '# plain utf8');
    writeFileSync(path.join(root, 'memory', '2026-04-08.md'), Buffer.from([0xef, 0xbb, 0xbf, 0x23]));
    writeFileSync(path.join(root, 'rules', 'bad.md'), Buffer.from([0xc3, 0x28]));

    const report = auditMemoryMarkdownFiles(root);

    assert.equal(report.files.length, 3);
    assert.deepEqual(report.summary, {
      totalFiles: 3,
      utf8Files: 1,
      utf8BomFiles: 1,
      utf16Files: 0,
      nonUtf8Files: 1,
      filesWithBom: 1,
      filesWithNullBytes: 0,
      invalidUtf8Files: 1,
    });

    assert.deepEqual(
      report.files.map((entry) => ({
        path: entry.path,
        encoding: entry.encoding,
      })),
      [
        { path: 'AGENTS.md', encoding: 'UTF-8' },
        { path: 'memory/2026-04-08.md', encoding: 'UTF-8 BOM' },
        { path: 'rules/bad.md', encoding: 'Non-UTF8/legacy' },
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('memory/2026-04-08.md is normalized to UTF-8 without a BOM marker', () => {
  const file = path.join(process.cwd(), 'memory', '2026-04-08.md');
  const bytes = readFileSync(file);
  assert.notDeepEqual(Array.from(bytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
  assert.deepEqual(detectBufferEncoding(bytes), {
    encoding: 'UTF-8',
    hasBom: false,
    hasNullBytes: false,
    isValidUtf8: true,
  });
});
