import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { auditMemoryMarkdownFiles } from '../dist/memory-encoding.js';
import {
  DEFAULT_MAX_MEMORY_FILE_CHARS,
  DEFAULT_MAX_MEMORY_TOTAL_CHARS,
  getStartupMemoryPaths,
  resolveMemoryRoot,
} from '../dist/gateway/task-utils.js';

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

const requestedRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const root = resolveMemoryRoot(requestedRoot);
const report = auditMemoryMarkdownFiles(root);

console.log(`Memory Markdown encoding audit: ${root}`);
console.log('');
console.log(
  `${pad('File', 34)} ${pad('Encoding', 16)} ${pad('BOM', 5)} ${pad('NUL', 5)} ${pad(
    'UTF-8 valid',
    11,
  )} Bytes`,
);

for (const entry of report.files) {
  console.log(
    `${pad(entry.path, 34)} ${pad(entry.encoding, 16)} ${pad(entry.hasBom ? 'yes' : 'no', 5)} ${pad(
      entry.hasNullBytes ? 'yes' : 'no',
      5,
    )} ${pad(entry.isValidUtf8 ? 'yes' : 'no', 11)} ${entry.sizeBytes}`,
  );
}

console.log('');
console.log(`Total files: ${report.summary.totalFiles}`);
console.log(`UTF-8: ${report.summary.utf8Files}`);
console.log(`UTF-8 BOM: ${report.summary.utf8BomFiles}`);
console.log(`UTF-16: ${report.summary.utf16Files}`);
console.log(`Non-UTF8/legacy: ${report.summary.nonUtf8Files}`);
console.log(`Files with BOM: ${report.summary.filesWithBom}`);
console.log(`Files with NUL bytes: ${report.summary.filesWithNullBytes}`);
console.log(`Invalid UTF-8 files: ${report.summary.invalidUtf8Files}`);

const oversizedStartupFiles = [];
const preloadWarningRatio = 0.8;
const nearLimitStartupFiles = [];
let startupTotalChars = 0;
for (const file of getStartupMemoryPaths(root, new Date())) {
  if (!existsSync(file.path)) {
    continue;
  }
  const chars = readFileSync(file.path, 'utf8').length;
  startupTotalChars += chars;
  if (chars > DEFAULT_MAX_MEMORY_FILE_CHARS) {
    oversizedStartupFiles.push({ label: file.label, chars });
  } else if (chars >= DEFAULT_MAX_MEMORY_FILE_CHARS * preloadWarningRatio) {
    nearLimitStartupFiles.push({ label: file.label, chars });
  }
}

console.log('');
console.log(
  `Startup preload budget: ${startupTotalChars}/${DEFAULT_MAX_MEMORY_TOTAL_CHARS} total chars, per-file limit ${DEFAULT_MAX_MEMORY_FILE_CHARS}`,
);
for (const file of oversizedStartupFiles) {
  console.error(
    `Preload budget exceeded: ${file.label} has ${file.chars} chars and will be truncated in fresh-session bootstraps.`,
  );
}
for (const file of nearLimitStartupFiles) {
  console.warn(
    `Preload budget warning: ${file.label} uses ${file.chars}/${DEFAULT_MAX_MEMORY_FILE_CHARS} chars (at least 80%).`,
  );
}
const startupTotalExceeded = startupTotalChars > DEFAULT_MAX_MEMORY_TOTAL_CHARS;
if (startupTotalExceeded) {
  console.error(
    `Preload budget exceeded: startup files total ${startupTotalChars} chars; later files will be truncated or dropped.`,
  );
}
if (
  !startupTotalExceeded &&
  startupTotalChars >= DEFAULT_MAX_MEMORY_TOTAL_CHARS * preloadWarningRatio
) {
  console.warn(
    `Preload budget warning: startup files use ${startupTotalChars}/${DEFAULT_MAX_MEMORY_TOTAL_CHARS} total chars (at least 80%).`,
  );
}

const hasAnomaly =
  report.summary.utf8BomFiles > 0 ||
  report.summary.utf16Files > 0 ||
  report.summary.nonUtf8Files > 0 ||
  report.summary.filesWithNullBytes > 0 ||
  report.summary.invalidUtf8Files > 0 ||
  oversizedStartupFiles.length > 0 ||
  startupTotalExceeded;

if (hasAnomaly) {
  console.error('');
  console.error('Encoding audit found anomalies in the repository memory layer.');
  process.exitCode = 1;
}
