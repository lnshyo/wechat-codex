Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "codex-wechat-common.ps1")

$config = Get-ManagedConfig
Ensure-ManagedDirectories -Config $config
Ensure-RepoAlias -Config $config
Ensure-WorkspaceAlias -Config $config

$startScript = Join-Path $PSScriptRoot "start-codex-wechat-silent.ps1"
$taskArgument = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
$currentUser = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $taskArgument
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $config.TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Start the managed Codex WeChat bridge and hidden companion at Windows logon." `
  -Force | Out-Null

Write-ManagerLog -Config $config -Message "scheduled task installed"
& $startScript
