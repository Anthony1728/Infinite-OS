# Infinite OS Bridge v2.0 ??? install helper.
# Generates a random local token, writes the extension config.js, builds icons
# if missing, and prints instructions for loading the extension in Chrome/Edge.

$ErrorActionPreference = 'Stop'
$root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$extDir = Join-Path $root 'extensions\infinite-os-bridge'
$infiniteDir = Join-Path $env:USERPROFILE '.infinite-ai'
$extInstallDir = Join-Path $infiniteDir 'extensions\infinite-os-bridge'
$tokenFile = Join-Path $infiniteDir 'bridge-token'

New-Item -ItemType Directory -Force -Path $infiniteDir | Out-Null

# 1. Token (reuse existing if present so a re-run does not break the server)
$token = ''
if (Test-Path $tokenFile) {
  $token = (Get-Content $tokenFile -Raw).Trim()
}
if (-not $token) {
  $token = -join ((48..57) + (97..122) + (65..90) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
  Set-Content -Path $tokenFile -Value $token -NoNewline -Encoding ascii
}
Write-Host "Bridge token: $($token.Substring(0,6))... (stored in $tokenFile)" -ForegroundColor Cyan

# 2. Ensure source icons exist (so the source dir is loadable and manifest icons resolve)
$sourceIconDir = Join-Path $extDir 'icons'
Add-Type -AssemblyName System.Drawing
function New-BridgeIcons([string]$iconDir) {
  New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
  foreach ($size in 16, 32, 48, 128) {
    $iconPath = Join-Path $iconDir "icon$size.png"
    if (Test-Path $iconPath) { continue }
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size

    # Background gradient (indigo -> purple)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
      $rect,
      [System.Drawing.Color]::FromArgb(99, 102, 241),
      [System.Drawing.Color]::FromArgb(139, 92, 246),
      135)
    $g.FillEllipse($brush, 0, 0, $size - 1, $size - 1)

    # Infinity symbol
    $fontSize = [Math]::Max($size * 0.55, 8)
    $font = New-Object System.Drawing.Font('Segoe UI Symbol', $fontSize, [System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = 'Center'
    $sf.LineAlignment = 'Center'
    $g.DrawString([char]0x221E, $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 0, $size, $size), $sf)

    $bmp.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Host "Created icon: $iconPath" -ForegroundColor DarkGray
  }
}
New-BridgeIcons -iconDir $sourceIconDir

# 3. Sync extension files to the stable install location
New-Item -ItemType Directory -Force -Path $extInstallDir | Out-Null
Get-ChildItem -Path $extDir -Recurse -File | Where-Object { $_.Name -notin @('config.js', 'config.example.js') } | ForEach-Object {
  $rel = $_.FullName.Substring($extDir.Length).TrimStart('\')
  $dest = Join-Path $extInstallDir $rel
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
  Copy-Item -Path $_.FullName -Destination $dest -Force
}

# 4. Write config.js with the token
$config = "const BRIDGE_CONFIG = { port: 8765, token: `"$token`" };`n"
Set-Content -Path (Join-Path $extInstallDir 'config.js') -Value $config -Encoding ascii
Write-Host "Wrote config.js -> $extInstallDir" -ForegroundColor Green

# 4b. Build icons in the install dir only if any are still missing
$installIconDir = Join-Path $extInstallDir 'icons'
New-BridgeIcons -iconDir $installIconDir

Write-Host ''
Write-Host '=== Infinite OS Bridge v2.0 ===' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Extension ready! Install it in Chrome or Edge:' -ForegroundColor Green
Write-Host ''
Write-Host '  Chrome:' -ForegroundColor Yellow
Write-Host '    1. Open chrome://extensions'
Write-Host '    2. Enable "Developer mode" (top right)'
Write-Host "    3. Click "Load unpacked" and select: $extInstallDir"
Write-Host ''
Write-Host '  Edge:' -ForegroundColor Yellow
Write-Host '    1. Open edge://extensions'
Write-Host '    2. Enable "Developer mode" (left sidebar)'
Write-Host "    3. Click "Load unpacked" and select: $extInstallDir"
Write-Host ''
Write-Host '  The extension will auto-connect when Infinite OS starts.' -ForegroundColor DarkGray
Write-Host ''
