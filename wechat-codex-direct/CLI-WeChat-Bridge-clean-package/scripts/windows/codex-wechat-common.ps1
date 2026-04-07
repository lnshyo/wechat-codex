Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-ManagedConfig {
  # These values define one workstation's managed Windows deployment profile.
  # The reusable bridge logic lives in src/, while this helper keeps local
  # aliases, task names, and log directories in one place for easy adjustment.
  $repoRealPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
  $repoPath = "C:\Users\jzy22\Desktop\CLI-WeChat-Bridge_repo"
  $workspaceRealPath = [System.IO.Path]::GetFullPath((Join-Path $repoRealPath "..\.."))
  $workspaceAliasPath = "C:\Users\jzy22\Desktop\AGTK_workdir"
  $codexCommand = "C:\Users\jzy22\.codex\.sandbox-bin\codex.exe"
  $channelDataDir = Join-Path $env:USERPROFILE ".claude\channels\wechat"
  $workspaceKey = Get-WorkspaceKey -WorkspacePath $workspaceAliasPath
  $workspaceDir = Join-Path $channelDataDir (Join-Path "workspaces" $workspaceKey)
  $logDir = Join-Path $channelDataDir (Join-Path "autostart" "AGTK")

  return [pscustomobject]@{
    RepoPath = $repoPath
    RepoRealPath = $repoRealPath
    WorkspaceRealPath = $workspaceRealPath
    WorkspaceAliasPath = $workspaceAliasPath
    CodexCommand = $codexCommand
    NodeExe = (Get-Command node -ErrorAction Stop).Source
    ChannelDataDir = $channelDataDir
    WorkspaceKey = $workspaceKey
    WorkspaceDir = $workspaceDir
    EndpointFile = Join-Path $workspaceDir "codex-panel-endpoint.json"
    StateFile = Join-Path $workspaceDir "bridge-state.json"
    BridgeLockFile = Join-Path $channelDataDir "bridge.lock.json"
    BridgeLogFile = Join-Path $channelDataDir "bridge.log"
    LogDir = $logDir
    ManagerLogFile = Join-Path $logDir "manager.log"
    BridgeStdoutLog = Join-Path $logDir "bridge-stdout.log"
    BridgeStderrLog = Join-Path $logDir "bridge-stderr.log"
    CompanionStdoutLog = Join-Path $logDir "companion-stdout.log"
    CompanionStderrLog = Join-Path $logDir "companion-stderr.log"
    TaskName = "CLI-WeChat-Bridge-Codex-AGTK"
  }
}

function Get-WorkspaceKey {
  param(
    [Parameter(Mandatory = $true)]
    [string]$WorkspacePath
  )

  $normalized = [System.IO.Path]::GetFullPath($WorkspacePath)
  $comparable = $normalized.ToLowerInvariant()
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($comparable)
    $hashBytes = $sha256.ComputeHash($bytes)
  } finally {
    $sha256.Dispose()
  }

  $hash = -join ($hashBytes | ForEach-Object { $_.ToString("x2") })
  $label = Split-Path -Leaf $normalized
  $label = [regex]::Replace($label, "[^a-zA-Z0-9._-]+", "-")
  $label = $label.Trim("-")
  if (-not $label) {
    $label = "workspace"
  }
  if ($label.Length -gt 40) {
    $label = $label.Substring(0, 40)
  }

  return "$label-$($hash.Substring(0, 12))"
}

function Ensure-ManagedDirectories {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Config
  )

  foreach ($dir in @($Config.ChannelDataDir, $Config.WorkspaceDir, $Config.LogDir)) {
    if (-not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
  }
}

function Ensure-WorkspaceAlias {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Config
  )

  if (Test-Path -LiteralPath $Config.WorkspaceAliasPath) {
    return
  }

  New-Item -ItemType Junction -Path $Config.WorkspaceAliasPath -Target $Config.WorkspaceRealPath | Out-Null
}

function Ensure-RepoAlias {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Config
  )

  if (Test-Path -LiteralPath $Config.RepoPath) {
    return
  }

  New-Item -ItemType Junction -Path $Config.RepoPath -Target $Config.RepoRealPath | Out-Null
}

function Write-ManagerLog {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Config,
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  Ensure-ManagedDirectories -Config $Config
  $timestamp = (Get-Date).ToString("s")
  Add-Content -LiteralPath $Config.ManagerLogFile -Value "[$timestamp] $Message"
}

function Get-ManagedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("bridge", "companion")]
    [string]$Kind,
    [Parameter(Mandatory = $true)]
    [psobject]$Config
  )

  $needle =
    if ($Kind -eq "bridge") { "src\bridge\wechat-bridge.ts" }
    else { "src\companion\local-companion.ts" }

  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $commandLine = $_.CommandLine
    if (-not $commandLine) {
      return $false
    }

    return (
      $commandLine.Contains($needle) -and
      $commandLine.Contains("--adapter") -and
      $commandLine.Contains("codex") -and
      $commandLine.Contains("--cwd") -and
      $commandLine.Contains($Config.WorkspaceAliasPath)
    )
  }

  return @($processes)
}

function Start-HiddenNodeProcess {
  param(
    [Parameter(Mandatory = $true)]
    [psobject]$Config,
    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList,
    [Parameter(Mandatory = $true)]
    [string]$StdoutLog,
    [Parameter(Mandatory = $true)]
    [string]$StderrLog
  )

  Ensure-ManagedDirectories -Config $Config
  Start-Process -FilePath $Config.NodeExe `
    -ArgumentList $ArgumentList `
    -WorkingDirectory $Config.RepoPath `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog | Out-Null
}

function Wait-ForFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [int]$TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      return $true
    }
    Start-Sleep -Milliseconds 300
  }

  return $false
}

function Stop-ManagedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$Processes
  )

  foreach ($process in $Processes) {
    try {
      Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    } catch {
      # Best effort cleanup.
    }
  }
}
