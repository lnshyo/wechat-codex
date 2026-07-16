import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommandArgs,
  buildExecutionModeArgs,
  buildHttpProviderArgs,
  buildMcpIsolationArgs,
  buildSpawnOptions,
} from '../codex/provider.js';

test('buildExecutionModeArgs enables full-access Codex execution for bridge sessions', () => {
  assert.deepEqual(buildExecutionModeArgs(), [
    '--disable',
    'tui_app_server',
    '--disable',
    'plugins',
    '--dangerously-bypass-approvals-and-sandbox',
  ]);
});

test('buildSpawnOptions closes stdin so Codex exec can exit after one response', () => {
  assert.deepEqual(buildSpawnOptions('E:/claude/CODEXclaw'), {
    cwd: 'E:/claude/CODEXclaw',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
});

test('buildHttpProviderArgs forces bridge-owned Codex calls onto authenticated HTTPS', () => {
  const args = buildHttpProviderArgs();

  assert.deepEqual(args, [
    '-c',
    'model_provider="wechat_http"',
    '-c',
    'model_providers.wechat_http.name="OpenAI HTTPS"',
    '-c',
    'model_providers.wechat_http.base_url="https://chatgpt.com/backend-api/codex"',
    '-c',
    'model_providers.wechat_http.wire_api="responses"',
    '-c',
    'model_providers.wechat_http.requires_openai_auth=true',
    '-c',
    'model_providers.wechat_http.supports_websockets=false',
  ]);
});

test('buildMcpIsolationArgs disables unrelated MCP only for bridge-owned children', () => {
  const args = buildMcpIsolationArgs();

  assert.deepEqual(args, [
    '-c',
    'mcp_servers.context7.enabled=false',
    '-c',
    'mcp_servers.exa.enabled=false',
    '-c',
    'mcp_servers.node_repl.enabled=false',
    '-c',
    'mcp_servers.omx_code_intel.enabled=false',
    '-c',
    'mcp_servers.omx_memory.enabled=false',
    '-c',
    'mcp_servers.omx_state.enabled=false',
    '-c',
    'mcp_servers.omx_trace.enabled=false',
    '-c',
    'mcp_servers.omx_wiki.enabled=false',
    '-c',
    'mcp_servers.openaiDeveloperDocs.enabled=false',
  ]);
});

test('buildCommandArgs wires HTTPS provider into fresh and resumed runs with prompt last', () => {
  const fresh = buildCommandArgs({ prompt: 'fresh prompt', cwd: 'E:/repo' });
  const resumed = buildCommandArgs({
    prompt: 'resume prompt',
    cwd: 'E:/repo',
    threadId: 'thread-123',
  });

  for (const args of [fresh, resumed]) {
    assert.ok(args.includes('model_provider="wechat_http"'));
    assert.ok(args.includes('model_providers.wechat_http.supports_websockets=false'));
    assert.ok(args.includes('mcp_servers.context7.enabled=false'));
    assert.ok(args.includes('mcp_servers.openaiDeveloperDocs.enabled=false'));
  }
  assert.deepEqual(fresh.slice(0, 3), ['exec', '--json', '--skip-git-repo-check']);
  assert.deepEqual(resumed.slice(0, 4), ['exec', 'resume', 'thread-123', '--json']);
  assert.equal(fresh.at(-1), 'fresh prompt');
  assert.equal(resumed.at(-1), 'resume prompt');
});
