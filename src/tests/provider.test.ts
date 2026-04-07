import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExecutionModeArgs } from '../codex/provider.js';

test('buildExecutionModeArgs enables full-access Codex execution for bridge sessions', () => {
  assert.deepEqual(buildExecutionModeArgs(), [
    '--disable',
    'tui_app_server',
    '--disable',
    'plugins',
    '--dangerously-bypass-approvals-and-sandbox',
  ]);
});
