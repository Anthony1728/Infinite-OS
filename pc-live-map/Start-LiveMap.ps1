#Requires -Version 5.1
<#
.SYNOPSIS
  PC Live Map - one-click launcher (Infinite OS tool v5).
  Starts eyes (tracker) + bridge (collector) + hands (executor) + opens the UI.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File pc-live-map\Start-LiveMap.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File pc-live-map\Start-LiveMap.ps1 -NoExecutor
#>
param([switch]$NoExecutor, [switch]$NoBrowser, [int]$Port = 3799)

$ErrorActionPreference = 'Continue'
$toolDir = $PSScriptRoot
if ([string]::IsNullOrEmpty($toolDir)) { $toolDir = (Get-Location).Path }
$root = Split-Path $toolDir -Parent
if ([string]::IsNullOrEmpty($root)) { $root = $toolDir }

function Test-PortOpen([int]$p) {
  try {
    $c = New-Object Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(400)
    $c.Close()
    return $ok
  } catch { return $false }
}

Write-Host '== PC Live Map v6 - starting (eyes + bridge + hands) [future-grade] ==' -ForegroundColor Cyan

# 1 - bridge (collector-server.js) if port closed
if (Test-PortOpen $Port) {
  Write-Host ("bridge already live on :{0} (skipping node start)" -f $Port) -ForegroundColor Yellow
} else {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $node) { Write-Warning 'node not found - open pc-live-map.html directly (browser-only mode).' }
  else {
    $collector = Join-Path $toolDir 'collector-server.js'
    Write-Host ("starting bridge: node {0} (PORT={1})" -f $collector, $Port) -ForegroundColor Green
    $env:PORT = "$Port"
    Start-Process -FilePath $node.Source -ArgumentList "`"$collector`"" -WorkingDirectory $root -WindowStyle Minimized
    Start-Sleep -Milliseconds 1200
    if (Test-PortOpen $Port) { Write-Host ("bridge OK -> http://localhost:{0}" -f $Port) -ForegroundColor Green }
    else { Write-Warning ("bridge did not open :{0} - check node output." -f $Port) }
  }
}

# 2 - eyes (tracker.ps1) - always a fresh window so Ctrl+C stops it cleanly
$tracker = Join-Path $toolDir 'tracker.ps1'
Write-Host 'starting eyes (tracker.ps1 v4)...' -ForegroundColor Green
Start-Process -FilePath 'powershell' -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$tracker`"", '-IntervalMs', '250') -WorkingDirectory $root

# 3 - hands (executor.ps1)
if (-not $NoExecutor) {
  $exec = Join-Path $toolDir 'executor.ps1'
  Write-Host 'starting hands (executor.ps1 v2)...' -ForegroundColor Green
  Start-Process -FilePath 'powershell' -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$exec`"") -WorkingDirectory $root
} else { Write-Host 'hands skipped (-NoExecutor).' -ForegroundColor DarkGray }

# 4 - open UI (collector URL preferred so SSE + actions work; fallback to file)
Start-Sleep -Milliseconds 600
$url = "http://localhost:$Port/"
if (-not $NoBrowser) {
  try { Start-Process $url } catch {
    $html = Join-Path $root 'pc-live-map.html'
    if (Test-Path -LiteralPath $html) { Start-Process $html }
  }
}

Write-Host ''
Write-Host 'Agent entry: GET http://localhost:3799/api/agent  (or /api/live)' -ForegroundColor Cyan
Write-Host 'Docs: pc-live-map/AGENT.md + infinite-tool.json + ai-schema.json' -ForegroundColor DarkGray
Write-Host 'Stop: close the tracker/executor windows (Ctrl+C) - bridge stops when node exits.' -ForegroundColor DarkGray
