Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
  [switch]$NoRestart
)

. (Join-Path $PSScriptRoot "codex-wechat-common.ps1")

$config = Get-ManagedConfig
Ensure-ManagedDirectories -Config $config
Ensure-RepoAlias -Config $config
Ensure-WorkspaceAlias -Config $config

$entryPath = Join-Path $config.RepoPath "src\bridge\codex-current-bind.ts"
$args = @(
  "--no-warnings",
  "--experimental-strip-types",
  $entryPath,
  "--cwd",
  $config.WorkspaceAliasPath,
  "--scripts-dir",
  (Join-Path $config.RepoPath "scripts\windows")
)

if ($NoRestart) {
  $args += "--no-restart"
}

Write-ManagerLog -Config $config -Message "bind_current_thread begin"
& $config.NodeExe @args
if ($LASTEXITCODE -ne 0) {
  throw "bind-current-codex-thread failed with exit code $LASTEXITCODE"
}
Write-ManagerLog -Config $config -Message "bind_current_thread complete"
