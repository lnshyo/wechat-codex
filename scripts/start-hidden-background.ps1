$ErrorActionPreference = 'Stop'

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

$repoRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Resolve-NodePath
$entryPath = Join-Path $repoRoot 'dist\main.js'

if (-not (Test-Path $entryPath)) {
  throw "Build output not found: $entryPath. Run npm run build first."
}

Start-Process -FilePath $nodePath `
  -ArgumentList @($entryPath, 'start') `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden
