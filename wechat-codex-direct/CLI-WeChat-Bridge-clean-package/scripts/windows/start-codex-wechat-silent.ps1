Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "codex-wechat-common.ps1")

$config = Get-ManagedConfig
Ensure-ManagedDirectories -Config $config
Ensure-RepoAlias -Config $config
Ensure-WorkspaceAlias -Config $config

Start-Sleep -Seconds 12

Write-ManagerLog -Config $config -Message "silent_start begin"

$bridgeArgs = @(
  "--no-warnings",
  "--experimental-strip-types",
  "src\bridge\wechat-bridge.ts",
  "--adapter",
  "codex",
  "--cmd",
  $config.CodexCommand,
  "--cwd",
  $config.WorkspaceAliasPath,
  "--lifecycle",
  "persistent",
  "--detached"
)

$companionArgs = @(
  "--no-warnings",
  "--experimental-strip-types",
  "src\companion\local-companion.ts",
  "--adapter",
  "codex",
  "--cwd",
  $config.WorkspaceAliasPath,
  "--headless"
)

$bridgeProcesses = Get-ManagedProcess -Kind "bridge" -Config $config
if (@($bridgeProcesses).Count -eq 0) {
  if (Test-Path -LiteralPath $config.EndpointFile) {
    Remove-Item -LiteralPath $config.EndpointFile -Force -ErrorAction SilentlyContinue
  }
  Write-ManagerLog -Config $config -Message "starting hidden bridge"
  Start-HiddenNodeProcess `
    -Config $config `
    -ArgumentList $bridgeArgs `
    -StdoutLog $config.BridgeStdoutLog `
    -StderrLog $config.BridgeStderrLog
} else {
  Write-ManagerLog -Config $config -Message "bridge already running"
}

if (-not (Wait-ForFile -Path $config.EndpointFile -TimeoutSeconds 20)) {
  Write-ManagerLog -Config $config -Message "endpoint file did not appear in time"
  exit 1
}

$companionProcesses = Get-ManagedProcess -Kind "companion" -Config $config
if (@($companionProcesses).Count -eq 0) {
  Write-ManagerLog -Config $config -Message "starting hidden companion"
  Start-HiddenNodeProcess `
    -Config $config `
    -ArgumentList $companionArgs `
    -StdoutLog $config.CompanionStdoutLog `
    -StderrLog $config.CompanionStderrLog
} else {
  Write-ManagerLog -Config $config -Message "companion already running"
}

Write-ManagerLog -Config $config -Message "silent_start complete"
