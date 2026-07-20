import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test from 'node:test';

import { archiveWeChatAttachments } from '../wechat/library.js';
import { MessageItemType, type MessageItem } from '../wechat/types.js';

function makeFileItem(fileName: string): MessageItem {
  return {
    type: MessageItemType.FILE,
    file_item: {
      cdn_media: { aes_key: 'key', encrypt_query_param: 'query' },
      file_name: fileName,
    },
  };
}

test('archives documents into the knowledge library without changing their extension', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wechat-library-'));
  try {
    const options = {
      workingDirectory: root,
      now: new Date(2026, 6, 20),
      download: async () => Buffer.from('document'),
    };
    const first = await archiveWeChatAttachments([makeFileItem('研究报告.v2.PDF')], options);
    const second = await archiveWeChatAttachments([makeFileItem('研究报告.v2.PDF')], options);

    assert.equal(first.failures.length, 0);
    assert.equal(first.files[0]?.path, join(root, '资料库', '20-知识文档', '其他', '研究报告.v2.PDF'));
    assert.equal(second.files[0]?.path, join(root, '资料库', '20-知识文档', '其他', '研究报告.v2-2.PDF'));
    assert.equal(extname(first.files[0]!.path), '.PDF');
    assert.equal(extname(second.files[0]!.path), '.PDF');
    assert.equal(readFileSync(first.files[0]!.path, 'utf8'), 'document');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('archives videos as immutable originals and gives the local path to the caller', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wechat-library-'));
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('video')]);
  try {
    const result = await archiveWeChatAttachments([
      {
        type: MessageItemType.VIDEO,
        video_item: {
          cdn_media: { aes_key: 'key', encrypt_query_param: 'query' },
        },
      },
    ], {
      workingDirectory: root,
      messageId: 123,
      now: new Date(2026, 6, 20),
      download: async () => mp4,
    });

    assert.equal(result.failures.length, 0);
    assert.equal(
      result.files[0]?.path,
      join(root, '资料库', '30-视频资料', '01-原视频', '2026-07-20-wechat-123-1.mp4'),
    );
    assert.deepEqual(readFileSync(result.files[0]!.path), mp4);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('archives images once and returns a data URI for Codex image input', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wechat-library-'));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('image'),
  ]);
  let downloads = 0;
  try {
    const result = await archiveWeChatAttachments([
      {
        type: MessageItemType.IMAGE,
        image_item: {
          cdn_media: { aes_key: 'key', encrypt_query_param: 'query' },
        },
      },
    ], {
      workingDirectory: root,
      messageId: 456,
      now: new Date(2026, 6, 20),
      download: async () => {
        downloads += 1;
        return png;
      },
    });

    assert.equal(downloads, 1);
    assert.equal(result.files[0]?.path, join(root, '资料库', '00-待分类', '2026-07-20-wechat-456-1.png'));
    assert.equal(result.files[0]?.dataUri, `data:image/png;base64,${png.toString('base64')}`);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('does not persist obvious credential files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wechat-library-'));
  let downloads = 0;
  try {
    const result = await archiveWeChatAttachments([makeFileItem('.env.local')], {
      workingDirectory: root,
      download: async () => {
        downloads += 1;
        return Buffer.from('secret');
      },
    });

    assert.equal(downloads, 0);
    assert.equal(result.files.length, 0);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0]!.reason, /敏感文件/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test('rejects an unsafe original suffix instead of silently changing it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wechat-library-'));
  let downloads = 0;
  try {
    const result = await archiveWeChatAttachments([makeFileItem('报告.pdf.')], {
      workingDirectory: root,
      download: async () => {
        downloads += 1;
        return Buffer.from('document');
      },
    });

    assert.equal(downloads, 0);
    assert.equal(result.files.length, 0);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0]!.reason, /后缀/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
