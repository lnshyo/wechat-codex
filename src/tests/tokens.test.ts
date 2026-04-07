import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendCompletedTurns,
  createGatewayState,
  createTokenLedger,
  estimatePromptTokens,
  estimateTextTokens,
  normalizeGatewayState,
  syncTokenLedgerRuntime,
} from '../gateway/tokens.js';

test('estimateTextTokens handles mixed-language text conservatively', () => {
  const ascii = estimateTextTokens('hello world');
  const mixed = estimateTextTokens('你好 hello');

  assert.ok(ascii > 0);
  assert.ok(mixed > 0);
  assert.notEqual(ascii, mixed);
});

test('estimatePromptTokens includes image placeholders', () => {
  const textOnly = estimatePromptTokens('Please analyze this', 0);
  const withImage = estimatePromptTokens('Please analyze this', 1);

  assert.ok(withImage > textOnly);
});

test('token ledger tracks committed and pending tokens', () => {
  const base = syncTokenLedgerRuntime(createTokenLedger(1000, 100), 50);
  const appended = appendCompletedTurns(base, 'hello', 20, 'world');

  assert.equal(base.estimatedPendingTokens, 50);
  assert.equal(appended.turns.length, 2);
  assert.ok(appended.estimatedCommittedTokens > base.estimatedCommittedTokens);
});

test('normalizeGatewayState clears stale pending tokens on load', () => {
  const state = createGatewayState(1000, 100);
  const pendingState = {
    ...state,
    tokenLedger: syncTokenLedgerRuntime(state.tokenLedger, 300),
  };

  const normalized = normalizeGatewayState(pendingState, 1000, 100);

  assert.equal(normalized.tokenLedger.estimatedPendingTokens, 0);
  assert.equal(normalized.tokenLedger.estimatedRemainingTokens, 900);
});
