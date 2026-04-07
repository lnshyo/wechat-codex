import type { GatewaySessionState, TokenLedger, TokenTurn } from './types.js';

export const DEFAULT_SESSION_TOKEN_BUDGET = 120_000;
export const DEFAULT_SESSION_REPLY_RESERVE_TOKENS = 4_096;
export const IMAGE_PLACEHOLDER_TEXT = '[image attachment]';

const DEFAULT_STATUS_UPDATED_AT = new Date(0).toISOString();
const TOKEN_ENVELOPE_OVERHEAD = 8;
const MAX_PREVIEW_LENGTH = 120;

function sanitizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

export function summarizePreview(text: string, fallback: string = '(empty)'): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (!singleLine) {
    return fallback;
  }

  if (singleLine.length <= MAX_PREVIEW_LENGTH) {
    return singleLine;
  }

  return `${singleLine.slice(0, MAX_PREVIEW_LENGTH - 3)}...`;
}

export function estimateTextTokens(text: string): number {
  const bytes = Buffer.byteLength(text, 'utf8');
  const codePoints = Array.from(text).length;
  const baseEstimate = Math.max(Math.ceil(bytes / 4), Math.ceil(codePoints / 2));
  return baseEstimate + TOKEN_ENVELOPE_OVERHEAD;
}

export function estimatePromptTokens(promptText: string, imageCount: number): number {
  const imageEstimate = imageCount > 0 ? estimateTextTokens(IMAGE_PLACEHOLDER_TEXT) * imageCount : 0;
  return estimateTextTokens(promptText) + imageEstimate;
}

export function createTokenLedger(
  budgetTokens: number = DEFAULT_SESSION_TOKEN_BUDGET,
  reservedReplyTokens: number = DEFAULT_SESSION_REPLY_RESERVE_TOKENS,
): TokenLedger {
  const budget = sanitizePositiveInteger(budgetTokens, DEFAULT_SESSION_TOKEN_BUDGET);
  const reserved = sanitizePositiveInteger(
    reservedReplyTokens,
    DEFAULT_SESSION_REPLY_RESERVE_TOKENS,
  );

  return {
    budgetTokens: budget,
    reservedReplyTokens: reserved,
    estimatedCommittedTokens: 0,
    estimatedPendingTokens: 0,
    estimatedRemainingTokens: Math.max(0, budget - reserved),
    turns: [],
  };
}

export function syncTokenLedgerRuntime(ledger: TokenLedger, pendingTokens: number): TokenLedger {
  const committed = sanitizePositiveInteger(ledger.estimatedCommittedTokens, 0);
  const pending = sanitizePositiveInteger(pendingTokens, 0);

  return {
    ...ledger,
    estimatedCommittedTokens: committed,
    estimatedPendingTokens: pending,
    estimatedRemainingTokens: Math.max(
      0,
      ledger.budgetTokens - committed - pending - ledger.reservedReplyTokens,
    ),
  };
}

export function applyTokenLedgerConfig(
  ledger: TokenLedger | undefined,
  budgetTokens: number = DEFAULT_SESSION_TOKEN_BUDGET,
  reservedReplyTokens: number = DEFAULT_SESSION_REPLY_RESERVE_TOKENS,
): TokenLedger {
  const base = ledger ?? createTokenLedger(budgetTokens, reservedReplyTokens);

  return syncTokenLedgerRuntime(
    {
      ...base,
      budgetTokens: sanitizePositiveInteger(base.budgetTokens, budgetTokens),
      reservedReplyTokens: sanitizePositiveInteger(base.reservedReplyTokens, reservedReplyTokens),
      estimatedCommittedTokens: sanitizePositiveInteger(base.estimatedCommittedTokens, 0),
      turns: Array.isArray(base.turns) ? [...base.turns] : [],
    },
    sanitizePositiveInteger(base.estimatedPendingTokens, 0),
  );
}

function buildTurn(role: TokenTurn['role'], preview: string, estimatedTokens: number): TokenTurn {
  return {
    role,
    preview: summarizePreview(preview),
    estimatedTokens: sanitizePositiveInteger(estimatedTokens, 0),
    createdAt: new Date().toISOString(),
  };
}

export function appendCompletedTurns(
  ledger: TokenLedger,
  promptPreview: string,
  promptTokens: number,
  responseText: string,
): TokenLedger {
  const assistantTokens = estimateTextTokens(responseText);

  return syncTokenLedgerRuntime(
    {
      ...ledger,
      turns: [
        ...ledger.turns,
        buildTurn('user', promptPreview, promptTokens),
        buildTurn('assistant', responseText, assistantTokens),
      ],
      estimatedCommittedTokens: ledger.estimatedCommittedTokens + promptTokens + assistantTokens,
    },
    ledger.estimatedPendingTokens,
  );
}

export function createGatewayState(
  budgetTokens: number = DEFAULT_SESSION_TOKEN_BUDGET,
  reservedReplyTokens: number = DEFAULT_SESSION_REPLY_RESERVE_TOKENS,
): GatewaySessionState {
  return {
    tokenLedger: createTokenLedger(budgetTokens, reservedReplyTokens),
    statusUpdatedAt: DEFAULT_STATUS_UPDATED_AT,
  };
}

export function normalizeGatewayState(
  state: GatewaySessionState | undefined,
  budgetTokens: number = DEFAULT_SESSION_TOKEN_BUDGET,
  reservedReplyTokens: number = DEFAULT_SESSION_REPLY_RESERVE_TOKENS,
): GatewaySessionState {
  const base = state ?? createGatewayState(budgetTokens, reservedReplyTokens);

  return {
    lastTaskSummary: base.lastTaskSummary,
    lastError: base.lastError,
    statusUpdatedAt: base.statusUpdatedAt ?? DEFAULT_STATUS_UPDATED_AT,
    tokenLedger: syncTokenLedgerRuntime(
      applyTokenLedgerConfig(base.tokenLedger, budgetTokens, reservedReplyTokens),
      0,
    ),
  };
}
