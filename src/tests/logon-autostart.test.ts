import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const switchScriptPath = join(repoRoot, 'scripts', 'switch-to-logon-autostart.ps1');
const hiddenStartScriptPath = join(repoRoot, 'scripts', 'start-hidden-background.ps1');

function normalizePowerShell(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

test('switch-to-logon-autostart registers the hidden launcher instead of node directly', () => {
  const script = normalizePowerShell(readFileSync(switchScriptPath, 'utf8'));

  assert.match(script, /\$hiddenLauncherPath = Join-Path \$PSScriptRoot 'start-hidden-background\.ps1'/);
  assert.match(script, /\$action = New-ScheduledTaskAction -Execute 'powershell\.exe'/);
  assert.match(script, /-Argument \$taskArguments/);
  assert.doesNotMatch(script, /New-ScheduledTaskAction -Execute \$nodePath -Argument 'dist\/main\.js start'/);
  assert.doesNotMatch(script, /New-ScheduledTaskAction -Execute \$nodePath -Argument 'dist\\main\.js start'/);
});

test('start-hidden-background launches the bridge with a hidden window', () => {
  const script = normalizePowerShell(readFileSync(hiddenStartScriptPath, 'utf8'));

  assert.match(script, /function Resolve-NodePath/);
  assert.match(script, /\$entryPath = Join-Path \$repoRoot 'dist\\main\.js'/);
  assert.match(script, /Start-Process -FilePath \$nodePath/);
  assert.match(script, /-ArgumentList @\(\$entryPath, 'start'\)/);
  assert.match(script, /-WorkingDirectory \$repoRoot/);
  assert.match(script, /-WindowStyle Hidden/);
});
