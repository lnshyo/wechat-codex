Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "codex-wechat-common.ps1")

$config = Get-ManagedConfig
Ensure-ManagedDirectories -Config $config

Write-ManagerLog -Config $config -Message "silent_stop begin"

$companionProcesses = Get-ManagedProcess -Kind "companion" -Config $config
if (@($companionProcesses).Count -gt 0) {
  Write-ManagerLog -Config $config -Message "stopping companion process(es): $(@($companionProcesses | ForEach-Object { $_.ProcessId }) -join ',')"
  Stop-ManagedProcess -Processes $companionProcesses
}

Start-Sleep -Seconds 1

$bridgeProcesses = Get-ManagedProcess -Kind "bridge" -Config $config
if (@($bridgeProcesses).Count -gt 0) {
  Write-ManagerLog -Config $config -Message "stopping bridge process(es): $(@($bridgeProcesses | ForEach-Object { $_.ProcessId }) -join ',')"
  Stop-ManagedProcess -Processes $bridgeProcesses
}

if (Test-Path -LiteralPath $config.EndpointFile) {
  Remove-Item -LiteralPath $config.EndpointFile -Force -ErrorAction SilentlyContinue
}

Write-ManagerLog -Config $config -Message "silent_stop complete"
