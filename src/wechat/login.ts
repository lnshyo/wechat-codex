import type { AccountData } from './accounts.js';
import { DEFAULT_BASE_URL, saveAccount } from './accounts.js';
import { logger } from '../logger.js';

const QR_CODE_URL = `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`;
const QR_STATUS_URL = `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status`;
const POLL_INTERVAL_MS = 3_000;

interface QrCodeResponse {
  ret: number;
  qrcode?: string;
  qrcode_img_content?: string;
}

interface QrStatusResponse {
  ret: number;
  status: string;
  retmsg?: string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startQrLogin(): Promise<{ qrcodeUrl: string; qrcodeId: string }> {
  logger.info('Requesting QR code');

  const response = await fetch(QR_CODE_URL);
  if (!response.ok) {
    throw new Error(`Failed to get QR code: HTTP ${response.status}`);
  }

  const data = (await response.json()) as QrCodeResponse;
  if (data.ret !== 0 || !data.qrcode || !data.qrcode_img_content) {
    throw new Error(`Failed to get QR code (ret=${data.ret})`);
  }

  logger.info('QR code obtained', { qrcodeId: data.qrcode });

  return {
    qrcodeUrl: data.qrcode_img_content,
    qrcodeId: data.qrcode,
  };
}

export async function waitForQrScan(qrcodeId: string): Promise<AccountData> {
  let currentQrcodeId = qrcodeId;

  while (true) {
    const url = `${QR_STATUS_URL}?qrcode=${encodeURIComponent(currentQrcodeId)}`;

    logger.debug('Polling QR status', { qrcodeId: currentQrcodeId });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let response: Response;

    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (error: any) {
      clearTimeout(timer);
      if (error.name === 'AbortError' || error.code === 'ETIMEDOUT') {
        logger.info('QR poll timed out, retrying');
        continue;
      }
      throw error;
    }

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`Failed to check QR status: HTTP ${response.status}`);
    }

    const data = (await response.json()) as QrStatusResponse;
    logger.debug('QR status response', { status: data.status });

    switch (data.status) {
      case 'wait':
      case 'scaned':
        break;
      case 'confirmed': {
        if (!data.bot_token || !data.ilink_bot_id || !data.ilink_user_id) {
          throw new Error('QR confirmed but response is missing required fields.');
        }

        const accountData: AccountData = {
          botToken: data.bot_token,
          accountId: data.ilink_bot_id,
          baseUrl: data.baseurl || DEFAULT_BASE_URL,
          userId: data.ilink_user_id,
          createdAt: new Date().toISOString(),
        };

        saveAccount(accountData);
        logger.info('QR login successful', { accountId: accountData.accountId });
        return accountData;
      }
      case 'expired':
        logger.info('QR code expired');
        throw new Error('QR code expired');
      default: {
        const status = data.status ?? '';
        logger.warn('Unknown QR status', { status, retmsg: data.retmsg });

        if (
          status &&
          (status.includes('not_support') ||
            status.includes('version') ||
            status.includes('forbid') ||
            status.includes('reject') ||
            status.includes('cancel'))
        ) {
          throw new Error(`扫码失败: ${data.retmsg || status}`);
        }

        if (data.retmsg) {
          throw new Error(`扫码失败: ${data.retmsg}`);
        }
        break;
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }
}
