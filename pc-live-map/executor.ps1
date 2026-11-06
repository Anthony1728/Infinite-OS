#Requires -Version 5.1
<#
.SYNOPSIS
  PC Live Map — action executor v2 (100% local). Turns AI JSON into real mouse/keyboard.
  The AI never needs screenshots: it reads /api/live (vectors) then POSTs to /api/action.
  This script polls pc-actions.jsonl and executes: click, move, doubleclick, drag,
  scroll, type (via paste), keys (SendKeys), wait, focus.
  Coords are ALWAYS norm 0-1000 on both axes (matches tracker v4 + /api/live).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File pc-live-map\executor.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File pc-live-map\executor.ps1 -DryRun
#>
param([string]$ActionFile = "pc-actions.jsonl", [switch]$DryRun, [int]$MaxPerMin = 40)

if (-not [System.IO.Path]::IsPathRooted($ActionFile)) {
  $scriptRoot = $PSScriptRoot
  if ([string]::IsNullOrEmpty($scriptRoot)) { $scriptRoot = (Get-Location).Path }
  $repoRoot = Split-Path $scriptRoot -Parent
  if ([string]::IsNullOrEmpty($repoRoot)) { $repoRoot = $scriptRoot }
  $ActionFile = Join-Path $repoRoot ([System.IO.Path]::GetFileName($ActionFile))
}

if (-not ([System.Management.Automation.PSTypeName]'MouseAct').Type) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseAct {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, int e);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  public struct POINT { public int x; public int y; }
  public const int LEFTDOWN=0x02, LEFTUP=0x04, RIGHTDOWN=0x08, RIGHTUP=0x10, WHEEL=0x0800;
}
"@ | Out-Null
}

$scrW = [MouseAct]::GetSystemMetrics(0); if ($scrW -le 0) { $scrW = 1366 }
$scrH = [MouseAct]::GetSystemMetrics(1); if ($scrH -le 0) { $scrH = 768 }
$wshell = New-Object -ComObject WScript.Shell

# Results file: every executed action appends {t, id, type, ok, error?, cursor?}
# so the collector can return MECHANICAL verification instead of advising the
# model to "check seq advanced" and hoping it does.
$ResultFile = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($ActionFile), "pc-action-results.jsonl")

function Write-ActResult([string]$id, [string]$type, [bool]$ok, [string]$error, $cursor) {
  try {
    $rec = [ordered]@{ t = (Get-Date).ToString("o"); id = $id; type = $type; ok = $ok }
    if ($error) { $rec.error = $error }
    if ($cursor) { $rec.cursor = $cursor }
    [System.IO.File]::AppendAllText($ResultFile, ($rec | ConvertTo-Json -Compress) + "`n")
  } catch {}
}

# Cursor verification: did the pointer ACTUALLY reach the requested pixel?
# (±2px tolerance). Returns a hashtable with ok/actual.
function Test-CursorAt([int]$wantX, [int]$wantY) {
  $pt = New-Object MouseAct+POINT
  [void][MouseAct]::GetCursorPos([ref]$pt)
  $dx = [Math]::Abs($pt.x - $wantX); $dy = [Math]::Abs($pt.y - $wantY)
  return @{ ok = ($dx -le 2 -and $dy -le 2); x = $pt.x; y = $pt.y }
}

function To-Px([int]$xn, [int]$yn) {
  # Unified norm: 0-1000 on BOTH axes -> physical pixels (v4 contract)
  $x = [Math]::Max(0,[Math]::Min(1000,$xn)) / 1000 * $scrW
  $y = [Math]::Max(0,[Math]::Min(1000,$yn)) / 1000 * $scrH
  return @([int]$x,[int]$y)
}

# Safety: sliding window, MaxPerMin actions (default 40). Floods are skipped, not executed.
$actTimes = New-Object System.Collections.Generic.List[datetime]
function Test-RateOk {
  $now = Get-Date
  while ($actTimes.Count -gt 0 -and ($now - $actTimes[0]).TotalSeconds -gt 60) { $actTimes.RemoveAt(0) }
  if ($actTimes.Count -ge $MaxPerMin) { return $false }
  $actTimes.Add($now)
  return $true
}

Write-Host ("Action executor v2 running -> {0} (screen {1}x{2}, DryRun={3}, max {4}/min, Ctrl+C to stop)" -f $ActionFile,$scrW,$scrH,$DryRun,$MaxPerMin) -ForegroundColor Cyan
$lastSize = 0
if (Test-Path -LiteralPath $ActionFile) { $lastSize = (Get-Item -LiteralPath $ActionFile).Length }
while ($true) {
  try {
    if (Test-Path -LiteralPath $ActionFile) {
      $len = (Get-Item -LiteralPath $ActionFile).Length
      if ($len -lt $lastSize) { $lastSize = 0 }
      if ($len -gt $lastSize) {
        $fs = [System.IO.File]::Open($ActionFile,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite)
        $fs.Seek($lastSize,[System.IO.SeekOrigin]::Begin) | Out-Null
        $sr = New-Object System.IO.StreamReader($fs)
        while (($line = $sr.ReadLine()) -ne $null) {
          if ([string]::IsNullOrWhiteSpace($line)) { continue }
          try {
            $a = $line | ConvertFrom-Json
            if (-not (Test-RateOk)) { Write-Warning "rate limit: skipping action (>$MaxPerMin/min)"; continue }
            if ($DryRun) { Write-Host ("[dry-run] {0}" -f $line.Substring(0,[Math]::Min(160,$line.Length))) -ForegroundColor DarkGray; continue }
            $actId = ""; try { $actId = [string]$a.id } catch {}
            $actType = ""; try { $actType = [string]$a.type } catch {}
            switch ($a.type) {
              "move" {
                $p = To-Px ([int]$a.x_norm) ([int]$a.y_norm)
                [MouseAct]::SetCursorPos($p[0],$p[1]) | Out-Null
                Start-Sleep -Milliseconds 20
                $v = Test-CursorAt $p[0] $p[1]
                Write-ActResult $actId $actType $v.ok $null @{ x=$v.x; y=$v.y }
                Write-Host ("move -> {0},{1} verified={2}" -f $p[0],$p[1],$v.ok) -ForegroundColor Gray
              }
              "click" {
                $p = To-Px ([int]$a.x_norm) ([int]$a.y_norm)
                [MouseAct]::SetCursorPos($p[0],$p[1]) | Out-Null
                Start-Sleep -Milliseconds 60
                $v = Test-CursorAt $p[0] $p[1]
                if (-not $v.ok) {
                  Write-ActResult $actId $actType $false "cursor did not reach target" @{ x=$v.x; y=$v.y }
                  Write-Warning ("click cursor mismatch: wanted {0},{1} got {2},{3}" -f $p[0],$p[1],$v.x,$v.y)
                  break
                }
                $btn = "left"; try { if ($a.button) { $btn = [string]$a.button } } catch {}
                if ($btn -eq "right") {
                  [MouseAct]::mouse_event([MouseAct]::RIGHTDOWN,0,0,0,0)
                  Start-Sleep -Milliseconds 40
                  [MouseAct]::mouse_event([MouseAct]::RIGHTUP,0,0,0,0)
                } else {
                  [MouseAct]::mouse_event([MouseAct]::LEFTDOWN,0,0,0,0)
                  Start-Sleep -Milliseconds 40
                  [MouseAct]::mouse_event([MouseAct]::LEFTUP,0,0,0,0)
                }
                $via = ""; try { if ($a.via) { $via = " via $($a.via)" } } catch {}
                Write-ActResult $actId $actType $true $null @{ x=$v.x; y=$v.y }
                Write-Host ("click {0} @ {1},{2}{3} verified" -f $btn,$p[0],$p[1],$via) -ForegroundColor Green
              }
              "doubleclick" {
                $p = To-Px ([int]$a.x_norm) ([int]$a.y_norm)
                [MouseAct]::SetCursorPos($p[0],$p[1]) | Out-Null
                Start-Sleep -Milliseconds 40
                $v = Test-CursorAt $p[0] $p[1]
                if (-not $v.ok) {
                  Write-ActResult $actId $actType $false "cursor did not reach target" @{ x=$v.x; y=$v.y }
                  break
                }
                for ($i=0;$i -lt 2;$i++) {
                  [MouseAct]::mouse_event([MouseAct]::LEFTDOWN,0,0,0,0)
                  Start-Sleep -Milliseconds 40
                  [MouseAct]::mouse_event([MouseAct]::LEFTUP,0,0,0,0)
                  Start-Sleep -Milliseconds 80
                }
                Write-ActResult $actId $actType $true $null @{ x=$v.x; y=$v.y }
                Write-Host ("doubleclick @ {0},{1} verified" -f $p[0],$p[1]) -ForegroundColor Green
              }
              "drag" {
                # v2 new: press at (x1,y1), move to (x2,y2), release
                $p1 = To-Px ([int]$a.x1_norm) ([int]$a.y1_norm)
                $p2 = To-Px ([int]$a.x2_norm) ([int]$a.y2_norm)
                [MouseAct]::SetCursorPos($p1[0],$p1[1]) | Out-Null
                Start-Sleep -Milliseconds 80
                [MouseAct]::mouse_event([MouseAct]::LEFTDOWN,0,0,0,0)
                Start-Sleep -Milliseconds 60
                [MouseAct]::SetCursorPos($p2[0],$p2[1]) | Out-Null
                Start-Sleep -Milliseconds 80
                $v = Test-CursorAt $p2[0] $p2[1]
                [MouseAct]::mouse_event([MouseAct]::LEFTUP,0,0,0,0)
                Write-ActResult $actId $actType $v.ok $(if (-not $v.ok) { "drag end cursor mismatch" } else { $null }) @{ x=$v.x; y=$v.y }
                Write-Host ("drag {0},{1} -> {2},{3} verified={4}" -f $p1[0],$p1[1],$p2[0],$p2[1],$v.ok) -ForegroundColor Green
              }
              "scroll" {
                $amt = 120; try { if ($null -ne $a.amount) { $amt = [Math]::Max(-1200,[Math]::Min(1200,[int]$a.amount)) } } catch {}
                [MouseAct]::mouse_event([MouseAct]::WHEEL,0,0,$amt,0)
                Write-ActResult $actId $actType $true $null $null
                Write-Host ("scroll $amt") -ForegroundColor Gray
              }
              "type" {
                $t = [string]$a.text
                if ($t.Length -gt 500) { $t = $t.Substring(0,500) }
                # SendKeys-safe: type via clipboard for reliability, then restore
                $old = $null; try { $old = Get-Clipboard -Raw -ErrorAction Stop } catch {}
                Set-Clipboard -Value $t -ErrorAction Stop
                Start-Sleep -Milliseconds 80
                $wshell.SendKeys("^v")
                Start-Sleep -Milliseconds 120
                try { if ($null -ne $old) { Set-Clipboard -Value $old } } catch {}
                Write-ActResult $actId $actType $true $null $null
                Write-Host ("typed {0} chars" -f $t.Length) -ForegroundColor Green
              }
              "keys" {
                $k = [string]$a.keys
                if ($k.Length -gt 64) { $k = $k.Substring(0,64) }
                $wshell.SendKeys($k)
                Write-ActResult $actId $actType $true $null $null
                Write-Host ("keys {0}" -f $k) -ForegroundColor Yellow
              }
              "wait" {
                $ms = 500; try { if ($null -ne $a.ms) { $ms = [Math]::Max(50,[Math]::Min(10000,[int]$a.ms)) } } catch {}
                Start-Sleep -Milliseconds $ms
                Write-ActResult $actId $actType $true $null $null
                Write-Host ("waited {0}ms" -f $ms) -ForegroundColor DarkGray
              }
              "focus" {
                # v2 new: bring a process window to front by name
                $pn = [string]$a.proc
                try {
                  $ok = $wshell.AppActivate($pn)
                  Write-ActResult $actId $actType ([bool]$ok) $(if (-not $ok) { "AppActivate returned false" } else { $null }) $null
                  Write-Host ("focus {0} -> {1}" -f $pn,$ok) -ForegroundColor Cyan
                } catch {
                  Write-ActResult $actId $actType $false $_.Exception.Message $null
                  Write-Warning ("focus failed: {0}" -f $_.Exception.Message)
                }
              }
              default { Write-Warning ("unknown action type: {0}" -f $a.type) }
            }
          } catch {
            Write-Warning ("bad action line: {0}" -f $_.Exception.Message)
            try { Write-ActResult $actId $actType $false $_.Exception.Message $null } catch {}
          }
        }
        $sr.Close(); $fs.Close()
        $lastSize = $len
      }
    }
  } catch { Write-Warning $_.Exception.Message }
  Start-Sleep -Milliseconds 300
}
