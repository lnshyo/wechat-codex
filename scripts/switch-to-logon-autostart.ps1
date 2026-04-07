$ErrorActionPreference = 'Stop'

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-Elevated {
  if (Test-IsAdmin) {
    return
  }

  $args = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $PSCommandPath)
  )
  Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $args | Out-Null
  exit 0
}

function Resolve-NodePath {
  $command = Get-Command node -ErrorAction SilentlyContinue
  $node = $null
  if ($command) {
    $node = $command.Source
  }
  if (-not $node) {
    throw 'Cannot find node.exe in PATH.'
  }
  return $node
}

Ensure-Elevated

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Resolve-NodePath
$serviceName = 'wechat-codex'
$taskName = 'wechat-codex-logon'
$serviceHome = Join-Path $env:USERPROFILE '.wechat-codex\\windows-service'
$entryPath = Join-Path $repoRoot 'dist\\main.js'

if (-not (Test-Path $entryPath)) {
  throw "Build output not found: $entryPath. Run npm run build first."
}

Write-Host 'Removing Windows service...' -ForegroundColor Cyan
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
if ($service) {
  sc.exe stop $serviceName | Out-Host
  Start-Sleep -Seconds 5

  $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
  if ($service -and $service.State -eq 'Running') {
    taskkill /PID $service.ProcessId /T /F | Out-Host
    Start-Sleep -Seconds 2
  }

  sc.exe delete $serviceName | Out-Host
  Start-Sleep -Seconds 2
} else {
  Write-Host "Service not installed: $serviceName"
}

if (Test-Path $serviceHome) {
  Remove-Item $serviceHome -Recurse -Force
}

Write-Host 'Registering user-logon task...' -ForegroundColor Cyan
$action = New-ScheduledTaskAction -Execute $nodePath -Argument 'dist/main.js start' -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start wechat-codex direct background daemon at user logon.' -Force | Out-Null

Write-Host 'Starting background mode now...' -ForegroundColor Cyan
& $nodePath $entryPath service start

Write-Host 'Final status:' -ForegroundColor Cyan
& $nodePath $entryPath service status
