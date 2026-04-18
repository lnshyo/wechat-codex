import path from 'node:path';
import process from 'node:process';

import { auditMemoryMarkdownFiles } from '../dist/memory-encoding.js';

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
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

const hasAnomaly =
  report.summary.utf8BomFiles > 0 ||
  report.summary.utf16Files > 0 ||
  report.summary.nonUtf8Files > 0 ||
  report.summary.filesWithNullBytes > 0 ||
  report.summary.invalidUtf8Files > 0;

if (hasAnomaly) {
  console.error('');
  console.error('Encoding audit found anomalies in the repository memory layer.');
  process.exitCode = 1;
}
