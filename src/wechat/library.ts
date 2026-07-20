import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { logger } from '../logger.js';
import { downloadAndDecrypt } from './cdn.js';
import { MessageItemType, type CDNMedia, type MessageItem } from './types.js';

type AttachmentKind = 'archive' | 'audio' | 'document' | 'image' | 'other' | 'video';

export interface ArchivedWeChatAttachment {
  dataUri?: string;
  kind: AttachmentKind;
  originalName?: string;
  path: string;
}

export interface FailedWeChatAttachment {
  itemType: MessageItemType;
  reason: string;
}

export interface ArchiveWeChatAttachmentsResult {
  failures: FailedWeChatAttachment[];
  files: ArchivedWeChatAttachment[];
}

export interface ArchiveWeChatAttachmentsOptions {
  download?: (encryptQueryParam: string, aesKeyBase64: string) => Promise<Buffer>;
  messageId?: number;
  now?: Date;
  workingDirectory: string;
}

const DOCUMENT_EXTENSIONS = new Set([
  '.csv', '.doc', '.docx', '.epub', '.html', '.md', '.mobi', '.odt', '.pdf', '.ppt',
  '.pptx', '.rtf', '.txt', '.xls', '.xlsx',
]);
const VIDEO_EXTENSIONS = new Set(['.avi', '.m4v', '.mkv', '.mov', '.mp4', '.mpeg', '.mpg', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.aac', '.amr', '.flac', '.m4a', '.mp3', '.ogg', '.wav']);
const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.heic', '.jpeg', '.jpg', '.png', '.webp']);
const ARCHIVE_EXTENSIONS = new Set([
  '.7z', '.apk', '.dmg', '.exe', '.gz', '.iso', '.msi', '.rar', '.tar', '.tgz', '.xz', '.zip',
]);
const SENSITIVE_EXTENSIONS = new Set(['.key', '.p12', '.pem', '.pfx']);

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getImageCdnData(item: MessageItem): CDNMedia | undefined {
  const image = item.image_item;
  if (!image) {
    return undefined;
  }

  if (image.cdn_media?.aes_key && image.cdn_media.encrypt_query_param) {
    return image.cdn_media;
  }

  if (image.media?.encrypt_query_param && (image.media.aes_key || image.aeskey)) {
    return {
      aes_key: image.media.aes_key ?? image.aeskey!,
      encrypt_query_param: image.media.encrypt_query_param,
    };
  }

  return undefined;
}

function getCdnData(item: MessageItem): CDNMedia | undefined {
  switch (item.type) {
    case MessageItemType.IMAGE:
      return getImageCdnData(item);
    case MessageItemType.VOICE:
      return item.voice_item?.cdn_media;
    case MessageItemType.FILE:
      return item.file_item?.cdn_media;
    case MessageItemType.VIDEO:
      return item.video_item?.cdn_media;
    default:
      return undefined;
  }
}

function isDownloadableAttachment(item: MessageItem): boolean {
  return item.type === MessageItemType.IMAGE
    || item.type === MessageItemType.VOICE
    || item.type === MessageItemType.FILE
    || item.type === MessageItemType.VIDEO;
}

function detectImageFormat(data: Buffer): { extension: string; mimeType: string } {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: '.png', mimeType: 'image/png' };
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    return { extension: '.jpg', mimeType: 'image/jpeg' };
  }
  if (data.subarray(0, 6).toString('ascii') === 'GIF87a'
      || data.subarray(0, 6).toString('ascii') === 'GIF89a') {
    return { extension: '.gif', mimeType: 'image/gif' };
  }
  if (data.subarray(0, 4).toString('ascii') === 'RIFF'
      && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { extension: '.webp', mimeType: 'image/webp' };
  }
  if (data.subarray(0, 2).toString('ascii') === 'BM') {
    return { extension: '.bmp', mimeType: 'image/bmp' };
  }
  return { extension: '.bin', mimeType: 'application/octet-stream' };
}

function detectVideoExtension(data: Buffer): string {
  if (data.subarray(4, 8).toString('ascii') === 'ftyp') {
    return '.mp4';
  }
  if (data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return '.webm';
  }
  return '.bin';
}

function detectAudioExtension(data: Buffer): string {
  if (data.subarray(0, 3).toString('ascii') === 'ID3'
      || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) {
    return '.mp3';
  }
  if (data.subarray(0, 4).toString('ascii') === 'RIFF'
      && data.subarray(8, 12).toString('ascii') === 'WAVE') {
    return '.wav';
  }
  if (data.subarray(0, 4).toString('ascii') === 'OggS') {
    return '.ogg';
  }
  if (data.subarray(0, 6).toString('ascii') === '#!AMR\n') {
    return '.amr';
  }
  return '.bin';
}

function sanitizeOriginalFilename(fileName: string): string {
  const leaf = basename(fileName.replaceAll('\\', '/'));
  const originalExtension = extname(leaf);
  const sanitized = leaf
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!sanitized) {
    throw new Error('附件文件名为空，无法在不猜测后缀的情况下自动落库');
  }
  if (extname(sanitized) !== originalExtension) {
    throw new Error('附件后缀包含当前文件系统不支持的字符，已拒绝自动改写后缀');
  }
  return sanitized;
}

function isSensitiveFilename(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower === '.env'
    || lower.startsWith('.env.')
    || SENSITIVE_EXTENSIONS.has(extname(lower));
}

function classifyFilename(fileName: string): AttachmentKind {
  const extension = extname(fileName).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (ARCHIVE_EXTENSIONS.has(extension)) return 'archive';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  return 'other';
}

function getTargetSegments(kind: AttachmentKind): string[] {
  switch (kind) {
    case 'video':
      return ['30-视频资料', '01-原视频'];
    case 'document':
      return ['20-知识文档', '其他'];
    case 'archive':
      return ['50-工具与安装包'];
    case 'image':
    case 'audio':
    case 'other':
      return ['00-待分类'];
  }
}

function generatedFilename(
  kind: AttachmentKind,
  data: Buffer,
  messageId: number | undefined,
  index: number,
  now: Date,
): { fileName: string; mimeType?: string } {
  const prefix = `${formatLocalDate(now)}-wechat-${messageId ?? now.getTime()}-${index + 1}`;
  if (kind === 'image') {
    const format = detectImageFormat(data);
    return { fileName: `${prefix}${format.extension}`, mimeType: format.mimeType };
  }
  if (kind === 'video') {
    return { fileName: `${prefix}${detectVideoExtension(data)}` };
  }
  if (kind === 'audio') {
    return { fileName: `${prefix}${detectAudioExtension(data)}` };
  }
  return { fileName: `${prefix}.bin` };
}

function writeWithoutOverwrite(directory: string, fileName: string, data: Buffer): string {
  mkdirSync(directory, { recursive: true });
  const extension = extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;

  for (let attempt = 1; ; attempt += 1) {
    const candidateName = attempt === 1 ? fileName : `${stem}-${attempt}${extension}`;
    const candidatePath = join(directory, candidateName);
    if (existsSync(candidatePath)) {
      continue;
    }

    try {
      writeFileSync(candidatePath, data, { flag: 'wx' });
      return candidatePath;
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (code === 'EEXIST') {
        continue;
      }
      throw error;
    }
  }
}

export async function archiveWeChatAttachments(
  items: MessageItem[],
  options: ArchiveWeChatAttachmentsOptions,
): Promise<ArchiveWeChatAttachmentsResult> {
  const download = options.download ?? downloadAndDecrypt;
  const now = options.now ?? new Date();
  const files: ArchivedWeChatAttachment[] = [];
  const failures: FailedWeChatAttachment[] = [];
  const attachmentItems = items.filter(isDownloadableAttachment);

  for (const [index, item] of attachmentItems.entries()) {
    try {
      const cdn = getCdnData(item);
      if (!cdn?.aes_key || !cdn.encrypt_query_param) {
        throw new Error('附件缺少可用的 CDN 下载信息');
      }

      const originalName = item.file_item?.file_name
        ? sanitizeOriginalFilename(item.file_item.file_name)
        : undefined;
      if (originalName && isSensitiveFilename(originalName)) {
        throw new Error('出于凭证安全规则，敏感文件不会自动落库');
      }

      const data = await download(cdn.encrypt_query_param, cdn.aes_key);
      const kind = item.type === MessageItemType.IMAGE
        ? 'image'
        : item.type === MessageItemType.VIDEO
          ? 'video'
          : item.type === MessageItemType.VOICE
            ? 'audio'
            : classifyFilename(originalName ?? '');
      const generated = originalName
        ? { fileName: originalName, mimeType: undefined }
        : generatedFilename(kind, data, options.messageId, index, now);
      const targetDirectory = join(
        options.workingDirectory,
        '资料库',
        ...getTargetSegments(kind),
      );
      const savedPath = writeWithoutOverwrite(targetDirectory, generated.fileName, data);
      const dataUri = kind === 'image'
        ? `data:${generated.mimeType ?? detectImageFormat(data).mimeType};base64,${data.toString('base64')}`
        : undefined;

      files.push({
        dataUri,
        kind,
        originalName,
        path: savedPath,
      });
      logger.info('Inbound WeChat attachment archived', {
        itemType: item.type,
        kind,
        path: savedPath,
        size: data.length,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push({ itemType: item.type, reason });
      logger.warn('Failed to archive inbound WeChat attachment', {
        itemType: item.type,
        reason,
      });
    }
  }

  return { failures, files };
}
