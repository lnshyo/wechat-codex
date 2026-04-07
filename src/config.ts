import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { CONFIG_PATH } from './constants.js';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface Config {
  workingDirectory: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  systemPrompt?: string;
  codexExecutablePath?: string;
  sessionTokenBudget?: number;
  sessionReplyReserveTokens?: number;
  maxQueuedTasksPerPeer?: number;
}

const DEFAULT_CONFIG: Config = {
  workingDirectory: process.cwd(),
  model: 'gpt-5.4',
  reasoningEffort: 'medium',
};

function parseConfigFile(content: string): Config {
  const config: Config = { ...DEFAULT_CONFIG };

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const splitIndex = trimmed.indexOf('=');
    if (splitIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, splitIndex).trim();
    const value = trimmed.slice(splitIndex + 1).trim();

    switch (key) {
      case 'workingDirectory':
        config.workingDirectory = value;
        break;
      case 'model':
        config.model = value;
        break;
      case 'reasoningEffort':
        if (value === 'minimal' || value === 'low' || value === 'medium' || value === 'high') {
          config.reasoningEffort = value;
        }
        break;
      case 'systemPrompt':
        config.systemPrompt = value;
        break;
      case 'codexExecutablePath':
        config.codexExecutablePath = value;
        break;
      case 'sessionTokenBudget': {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          config.sessionTokenBudget = Math.floor(parsed);
        }
        break;
      }
      case 'sessionReplyReserveTokens': {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
          config.sessionReplyReserveTokens = Math.floor(parsed);
        }
        break;
      }
      case 'maxQueuedTasksPerPeer': {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
          config.maxQueuedTasksPerPeer = Math.floor(parsed);
        }
        break;
      }
      default:
        break;
    }
  }

  return config;
}

export function loadConfig(): Config {
  try {
    return parseConfigFile(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });

  const lines = [
    `workingDirectory=${config.workingDirectory}`,
    config.model ? `model=${config.model}` : '',
    config.reasoningEffort ? `reasoningEffort=${config.reasoningEffort}` : '',
    config.systemPrompt ? `systemPrompt=${config.systemPrompt}` : '',
    config.codexExecutablePath ? `codexExecutablePath=${config.codexExecutablePath}` : '',
    config.sessionTokenBudget ? `sessionTokenBudget=${config.sessionTokenBudget}` : '',
    config.sessionReplyReserveTokens !== undefined
      ? `sessionReplyReserveTokens=${config.sessionReplyReserveTokens}`
      : '',
    config.maxQueuedTasksPerPeer ? `maxQueuedTasksPerPeer=${config.maxQueuedTasksPerPeer}` : '',
  ].filter(Boolean);

  writeFileSync(CONFIG_PATH, `${lines.join('\n')}\n`, 'utf8');
  if (process.platform !== 'win32') {
    chmodSync(CONFIG_PATH, 0o600);
  }
}
