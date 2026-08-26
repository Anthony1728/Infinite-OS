# Infinite OS - Bridge extension installer for Windows.
# Copies extensions/infinite-os-bridge to %LOCALAPPDATA%\InfiniteOS\bridge-extension,
# syncs the bridge token, and walks the user through loading it as an unpacked extension.
# Invoked by the browser_extension tool action "prepare_install" as:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\install-extension.ps1

$ErrorActionPreference = 'Stop'

# ── Locate paths ─────────────────────────────────────────────────────────────
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$repoRoot  = Split-Path -Parent $scriptDir
$sourceDir = Join-Path $repoRoot 'extensions\infinite-os-bridge'
$destRoot  = Join-Path $env:LOCALAPPDATA 'InfiniteOS'
$destDir   = Join-Path $destRoot 'bridge-extension'
$tokenDir  = Join-Path $env:USERPROFILE '.infinite-ai'
$tokenPath = Join-Path $tokenDir 'bridge-token'

function Find-BrowserExe {
  param([string[]]$CandidatePaths, [string[]]$RegistryKeys)
  foreach ($p in $CandidatePaths) {
    if ($p -and (Test-Path -LiteralPath $p -PathType Leaf)) { return $p }
  }
  foreach ($k in $RegistryKeys) {
    try {
      $v = (Get-ItemProperty -LiteralPath $k -ErrorAction Stop).'(default)'
      if ($v -and (Test-Path -LiteralPath $v -PathType Leaf)) { return $v }
    } catch {}
  }
  return $null
}

Write-Host ''
Write-Host '=== Infinite OS Bridge extension installer ==='
Write-Host ''

# ── Step 1: verify the extension source folder ───────────────────────────────
if (-not (Test-Path -LiteralPath $sourceDir -PathType Container)) {
  Write-Host "[FAIL] Extension folder not found: $sourceDir"
  exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceDir 'manifest.json') -PathType Leaf)) {
  Write-Host "[FAIL] manifest.json missing in: $sourceDir"
  exit 1
}
Write-Host "[OK] Found extension source folder: $sourceDir"

# ── Step 2: verify Chrome and/or Edge is installed ───────────────────────────
$chromePaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$edgePaths = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$chromeKeys = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe'
)
$edgeKeys = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe'
)

$chromeExe = Find-BrowserExe -CandidatePaths $chromePaths -RegistryKeys $chromeKeys
$edgeExe   = Find-BrowserExe -CandidatePaths $edgePaths -RegistryKeys $edgeKeys

if ($chromeExe) { Write-Host "[OK] Google Chrome found: $chromeExe" }
else            { Write-Host '[--] Google Chrome not detected.' }
if ($edgeExe)   { Write-Host "[OK] Microsoft Edge found: $edgeExe" }
else            { Write-Host '[--] Microsoft Edge not detected.' }

if (-not $chromeExe -and -not $edgeExe) {
  Write-Host '[FAIL] Neither Google Chrome nor Microsoft Edge was found on this machine.'
  Write-Host '       Install Chrome (https://www.google.com/chrome) or Edge, then retry.'
  exit 2
}

# ── Step 3: copy the extension files ─────────────────────────────────────────
try {
  if (Test-Path -LiteralPath $destDir) {
    Remove-Item -LiteralPath $destDir -Recurse -Force
    Write-Host '[OK] Removed previous copy.'
  }
  New-Item -ItemType Directory -Path $destRoot -Force | Out-Null
  Copy-Item -LiteralPath $sourceDir -Destination $destDir -Recurse -Force
} catch {
  Write-Host "[FAIL] Could not copy extension files: $($_.Exception.Message)"
  Write-Host '       Close any program using the destination folder and retry.'
  exit 3
}
if (-not (Test-Path -LiteralPath (Join-Path $destDir 'manifest.json') -PathType Leaf)) {
  Write-Host '[FAIL] Copy incomplete - manifest.json not found in the destination.'
  exit 3
}
Write-Host "[OK] Copied extension to: $destDir"

# ── Step 4: sync or generate the bridge token (same file the app/server uses) ─
try {
  $token = ''
  if (Test-Path -LiteralPath $tokenPath -PathType Leaf) {
    $token = (Get-Content -LiteralPath $tokenPath -Raw -ErrorAction Stop).Trim()
  }
  if (-not $token) {
    # Generate a token matching the Node servers' format (32 random bytes, base64url).
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    New-Item -ItemType Directory -Path $tokenDir -Force | Out-Null
    Set-Content -LiteralPath $tokenPath -Value $token -Encoding ASCII -ErrorAction Stop
    Write-Host "[OK] Generated new bridge token at: $tokenPath"
  } else {
    Write-Host "[OK] Using existing bridge token from: $tokenPath"
  }
  $configJs = "const BRIDGE_CONFIG = { port: 8765, token: `"$token`" };"
  Set-Content -LiteralPath (Join-Path $destDir 'config.js') -Value ($configJs + "`r`n") -Encoding ASCII -ErrorAction Stop
  Write-Host '[OK] Wrote config.js into the installed extension.'
} catch {
  Write-Host "[--] Could not prepare config.js: $($_.Exception.Message)"
  Write-Host '     Infinite OS will re-sync the token automatically when it starts.'
}

# ── Step 5: print manual instructions ─────────────────────────────────────────
Write-Host ''
Write-Host 'Finish installation:'
Write-Host "  1. Copy this folder path:  $destDir"
Write-Host '  2. Open chrome://extensions (or edge://extensions for Edge)'
Write-Host '  3. Turn ON "Developer mode" (toggle in the top-right corner)'
Write-Host '  4. Click "Load unpacked" and select the folder path from step 1'
Write-Host ''

# ── Step 6: best effort - open the extensions page ────────────────────────────
$pageUrl = 'chrome://extensions/'
$browserLabel = 'Chrome'
if (-not $chromeExe -and $edgeExe) { $pageUrl = 'edge://extensions/'; $browserLabel = 'Edge' }
try {
  Start-Process $pageUrl
  Write-Host "[OK] Opened $pageUrl in $browserLabel."
} catch {
  Write-Host "[--] Could not open the page automatically ($($_.Exception.Message))."
  Write-Host "     Open it manually: $pageUrl"
}

Write-Host ''
Write-Host '[DONE] Extension prepared successfully.'
exit 0
