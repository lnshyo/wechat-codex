import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAppServerCommandArgs,
  buildThreadResumeParams,
  buildThreadStartParams,
  buildTurnStartParams,
} from '../codex/app-server-provider.js';

test('buildAppServerCommandArgs starts one stdio server with bridge-only overrides', () => {
  const args = buildAppServerCommandArgs(['node_repl', 'unrelated']);

  assert.deepEqual(args.slice(0, 5), [
    'app-server',
    '--listen',
    'stdio://',
    '--disable',
    'plugins',
  ]);
  assert.ok(args.includes('service_tier="fast"'));
  assert.ok(args.includes('model_provider="wechat_http"'));
  assert.ok(args.includes('mcp_servers.node_repl.enabled=false'));
  assert.ok(!args.includes('mcp_servers.unrelated.enabled=false'));
});

test('thread start and resume use the same full-access authenticated provider settings', () => {
  const options = {
    prompt: 'hello',
    cwd: 'C:/workspace',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'low' as const,
  };

  assert.deepEqual(buildThreadStartParams(options), {
    model: 'gpt-5.6-sol',
    modelProvider: 'wechat_http',
    serviceTier: 'fast',
    cwd: 'C:/workspace',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    ephemeral: false,
    experimentalRawEvents: false,
    persistExtendedHistory: false,
  });
  assert.deepEqual(buildThreadResumeParams('thread-123', options), {
    threadId: 'thread-123',
    model: 'gpt-5.6-sol',
    modelProvider: 'wechat_http',
    serviceTier: 'fast',
    cwd: 'C:/workspace',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    persistExtendedHistory: false,
  });
});

test('turn start keeps the existing prompt contract and forwards local images', () => {
  const params = buildTurnStartParams(
    'thread-123',
    {
      prompt: 'inspect this',
      systemPrompt: 'system rules',
      cwd: 'C:/workspace',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'low',
    },
    ['C:/tmp/image.png'],
  );

  assert.deepEqual(params, {
    threadId: 'thread-123',
    input: [
      {
        type: 'text',
        text: 'system rules\n\nUser request:\ninspect this',
        text_elements: [],
      },
      { type: 'localImage', path: 'C:/tmp/image.png' },
    ],
    cwd: 'C:/workspace',
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'dangerFullAccess' },
    model: 'gpt-5.6-sol',
    serviceTier: 'fast',
    effort: 'low',
  });
});
