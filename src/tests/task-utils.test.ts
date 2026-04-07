import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFreshSessionSystemPrompt } from '../gateway/task-utils.js';

test('buildFreshSessionSystemPrompt creates a bootstrap instruction when none exists', () => {
  const prompt = buildFreshSessionSystemPrompt();

  assert.match(prompt, /\[wechat-codex:fresh-session-memory-bootstrap\]/);
  assert.match(prompt, /AGENTS\.md/);
  assert.match(prompt, /startup read order defined in AGENTS\.md/i);
  assert.doesNotMatch(prompt, /USER\.md/);
  assert.doesNotMatch(prompt, /soul\.md/);
});

test('buildFreshSessionSystemPrompt appends bootstrap once to an existing system prompt', () => {
  const basePrompt = 'Always be concise.';
  const withBootstrap = buildFreshSessionSystemPrompt(basePrompt);
  const duplicated = buildFreshSessionSystemPrompt(withBootstrap);

  assert.match(withBootstrap, /Always be concise\./);
  assert.equal(
    (duplicated.match(/\[wechat-codex:fresh-session-memory-bootstrap\]/g) || []).length,
    1,
  );
});
