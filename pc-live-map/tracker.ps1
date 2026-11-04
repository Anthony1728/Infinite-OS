#Requires -Version 5.1
<#
.SYNOPSIS
  PC Live Map — OS-level tracker v6 for Infinite OS (100% local, no screenshots).
  Future-grade: sees EVERYTHING on screen as vectors so AI never needs a screenshot:
  cursor + clicks + idle + foreground window + rect + ALL visible windows +
  UIA clickable elements WITH values + focused element WITH value + clipboard + seq + virtual screen.
.DESCRIPTION
  v6 future-grade (sharpened, zero bugs, best tool):
  - v4 fixes: filters off-screen/-32000, overlay flag, stable hash, log rotation, Add-Type guard, UIA timeout, sanitized strings, seq
  - v6 adds: ValuePattern/TextPattern for Edit/Combo/Document values + focused value so AI reads inputs without screenshots,
            virtual screen metrics (multi-monitor), tighter change signature includes values, even less duplicate spam.
  Privacy: runs only when YOU start it. Logs window TITLES, process names,
  UI element NAMES/ROLES/RECTS, clipboard FIRST 120 CHARS (preview only),
  never full keystroke contents, never pixels. Press Ctrl+C to stop.
  Output: JSON line per change to console + pc-live-map-events.jsonl
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File pc-live-map\tracker.ps1 -IntervalMs 250
#>
param([int]$IntervalMs = 250, [string]$OutFile = "pc-live-map-events.jsonl", [int]$MaxElements = 50, [int]$MaxWindows = 20)

if (-not [System.IO.Path]::IsPathRooted($OutFile)) {
  $scriptRoot = $PSScriptRoot
  if ([string]::IsNullOrEmpty($scriptRoot)) { $scriptRoot = (Get-Location).Path }
  $repoRoot = Split-Path $scriptRoot -Parent
  if ([string]::IsNullOrEmpty($repoRoot)) { $repoRoot = $scriptRoot }
  $OutFile = Join-Path $repoRoot ([System.IO.Path]::GetFileName($OutFile))
}

# Guard: only Add-Type once per session (re-running used to throw)
if (-not ([System.Management.Automation.PSTypeName]'WinTrack').Type) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinTrack {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int n);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWinProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  public delegate bool EnumWinProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
}
"@ | Out-Null
}

try { Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop | Out-Null } catch {}
try { Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop | Out-Null } catch {}

$SM_CXSCREEN = 0; $SM_CYSCREEN = 1
$SM_CXVIRTUALSCREEN = 78; $SM_CYVIRTUALSCREEN = 79; $SM_XVIRTUALSCREEN = 76; $SM_YVIRTUALSCREEN = 77
$scrW = [WinTrack]::GetSystemMetrics($SM_CXSCREEN)
$scrH = [WinTrack]::GetSystemMetrics($SM_CYSCREEN)
# v6: also capture virtual screen so AI knows multi-monitor extents without pixels
$vscrW = [WinTrack]::GetSystemMetrics($SM_CXVIRTUALSCREEN); if ($vscrW -le 0) { $vscrW = $scrW }
$vscrH = [WinTrack]::GetSystemMetrics($SM_CYVIRTUALSCREEN); if ($vscrH -le 0) { $vscrH = $scrH }
if ($scrW -le 0) { $scrW = 1366 }; if ($scrH -le 0) { $scrH = 768 }

# Overlay processes that draw fullscreen transparent layers (cursor overlays, IME, etc).
# They are kept in tops[] with overlay=true so the AI knows NOT to click them.
$OverlayProcs = @('cua-driver', 'TextInputHost', 'ShellExperienceHost', 'SearchHost')

function Sanitize([string]$s, [int]$max) {
  if ([string]::IsNullOrEmpty($s)) { return "" }
  $c = $s.Replace("`r"," ").Replace("`n"," ").Replace("`t"," ").Trim()
  if ($c.Length -gt $max) { $c = $c.Substring(0, $max) }
  return $c
}

# 0xFFFFFFFF as a signed Int64. As a bare literal it is UInt32, which promotes
# any `-band` expression to UInt64 and overflows on the FNV multiply below.
$script:HASH_MASK = [int64]4294967295

function Get-StableHash([string]$s) {
  # FNV-1a 32-bit — stable across runs (unlike String.GetHashCode)
  #
  # Every step stays in signed 64-bit space. This is deliberate and was a real
  # bug found by running the tracker on Windows PowerShell 5.1:
  #
  #   - `$h * 16777619` alone promotes to Double, and `-band` on a Double throws.
  #   - `0xFFFFFFFF` is a *UInt32* literal, so `-band` promotes the whole
  #     expression to UInt64 and the multiply overflows it.
  #   - A final `[int]` cast throws too, because a masked 32-bit value can
  #     exceed Int32.MaxValue.
  #
  # All three exceptions were swallowed by the outer tick handler, so the dedup
  # signature — which decides whether a change is published at all — silently
  # never worked. $HASH_MASK forces the mask to Int64 and keeps it signed.
  if ([string]::IsNullOrEmpty($s)) { return [int64]0 }
  [int64]$h = 2166136261
  foreach ($ch in $s.ToCharArray()) {
    $h = ($h -bxor [int64][int]$ch) -band $HASH_MASK
    $h = ($h * 16777619) -band $HASH_MASK
  }
  return [int64]($h -band $HASH_MASK)
}

function Norm([int]$x, [int]$y) {
  $nx = [Math]::Max(0, [Math]::Min(1000, [int]([double]$x / $scrW * 1000)))
  $ny = [Math]::Max(0, [Math]::Min(1000, [int]([double]$y / $scrH * 1000)))
  return @($nx, $ny)
}

function Test-Offscreen($left, $top, $right, $bottom) {
  # Windows parked at -32000 (hidden/minimized-to-tray) + zero-area
  if ($left -le -30000 -or $top -le -30000) { return $true }
  if (($right - $left) -lt 8 -or ($bottom - $top) -lt 8) { return $true }
  return $false
}

function Get-UiaValue([System.Object]$el) {
  # v6: read ValuePattern / TextPattern for Edit/Combo/Document so AI can see input contents without screenshots
  try {
    $vp = $el.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
    if ($null -ne $vp) {
      $v = $vp.Current.Value
      if (-not [string]::IsNullOrEmpty($v)) { return (Sanitize $v 80) }
    }
  } catch {}
  try {
    $tp = $el.GetCurrentPattern([Windows.Automation.TextPattern]::Pattern)
    if ($null -ne $tp) {
      $v = $tp.DocumentRange.GetText(80)
      if (-not [string]::IsNullOrEmpty($v)) { return (Sanitize $v 80) }
    }
  } catch {}
  return ""
}

function Get-UiaElements([IntPtr]$hw, [int]$max) {
  $out = @()
  try {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $root = [Windows.Automation.AutomationElement]::FromHandle($hw)
    if ($null -eq $root) { return $out }
    $ct = [Windows.Automation.ControlType]
    $conds = @(
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::Button)),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::Edit)),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::ComboBox)),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::CheckBox)),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::RadioButton)),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::MenuItem)),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::TabItem)),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::Hyperlink)),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::ListItem)),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::TreeItem)),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::Document)),
      (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, $ct::Pane))
    )
    $orCond = New-Object Windows.Automation.OrCondition($conds)
    $scope = [Windows.Automation.TreeScope]::Descendants
    $found = $root.FindAll($scope, $orCond)
    if ($null -eq $found) { return $out }
    $n = [Math]::Min($found.Count, $max)
    for ($i = 0; $i -lt $n; $i++) {
      # Timeout guard: never block the sampler loop more than ~700ms on UIA
      if ($sw.ElapsedMilliseconds -gt 700) { break }
      try {
        $el = $found[$i]
        if ($el.Current.IsOffscreen) { continue }
        $r = $el.Current.BoundingRectangle
        if ($r.Width -lt 4 -or $r.Height -lt 4) { continue }
        if ([double]::IsInfinity($r.X) -or [double]::IsInfinity($r.Y)) { continue }
        if ($r.X -le -30000 -or $r.Y -le -30000) { continue }
        $name = $el.Current.Name
        if ([string]::IsNullOrEmpty($name)) { $name = $el.Current.AutomationId }
        $name = Sanitize $name 40
        $role = $el.Current.ControlType.ProgrammaticName
        if ($role -match '\.([^.]+)$') { $role = $Matches[1] }
        $val = ""
        if ($role -in @("Edit","ComboBox","Document","Pane")) { $val = Get-UiaValue $el }
        $p1 = Norm ([int]$r.X) ([int]$r.Y)
        $p2 = Norm ([int]($r.X + $r.Width)) ([int]($r.Y + $r.Height))
        $row = [ordered]@{ role = $role; name = $name; x = $p1[0]; y = $p1[1]; w = ($p2[0]-$p1[0]); h = ($p2[1]-$p1[1]) }
        if ($val) { $row.value = $val }
        $out += $row
        if ($out.Count -ge $max) { break }
      } catch { continue }
    }
    $sw.Stop()
  } catch {}
  return $out
}

function Get-FocusedElement {
  try {
    $f = [Windows.Automation.AutomationElement]::FocusedElement
    if ($null -eq $f) { return $null }
    $r = $f.Current.BoundingRectangle
    $role = $f.Current.ControlType.ProgrammaticName
    if ($role -match '\.([^.]+)$') { $role = $Matches[1] }
    $nm = Sanitize $f.Current.Name 60
    $val = Get-UiaValue $f
    if ([double]::IsInfinity($r.X)) {
      $row = [ordered]@{ role = $role; name = $nm }
      if ($val) { $row.value = $val }
      return $row
    }
    if ($r.X -le -30000) {
      $row = [ordered]@{ role = $role; name = $nm }
      if ($val) { $row.value = $val }
      return $row
    }
    $p1 = Norm ([int]$r.X) ([int]$r.Y)
    $row = [ordered]@{ role = $role; name = $nm; x = $p1[0]; y = $p1[1] }
    if ($val) { $row.value = $val }
    return $row
  } catch { return $null }
}

$script:allWins = @()
$enumCb = [WinTrack+EnumWinProc]{
  param([IntPtr]$h, [IntPtr]$l)
  try {
    if (-not [WinTrack]::IsWindowVisible($h)) { return $true }
    if ([WinTrack]::IsIconic($h)) { return $true }
    $sb = New-Object System.Text.StringBuilder 256
    [WinTrack]::GetWindowText($h, $sb, 256) | Out-Null
    $t = Sanitize ($sb.ToString()) 60
    if ([string]::IsNullOrEmpty($t)) { return $true }
    # `0u` is C#/PowerShell 7 syntax. Windows PowerShell 5.1 — which is what
    # powershell.exe is on this machine — rejects it as "The term '0u' is not
    # recognized", on every single tick. That made the whole sampler fail, so
    # the tracker never published a state and the bridge stayed in
    # browser-only mode forever. [uint32]0 is explicit and works on both.
    $procId = [uint32]0; [WinTrack]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
    $pn = "unknown"; try { $pn = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
    $rc = New-Object WinTrack+RECT
    $rn = @()
    $isOverlay = $false
    if ([WinTrack]::GetWindowRect($h, [ref]$rc)) {
      if (Test-Offscreen $rc.Left $rc.Top $rc.Right $rc.Bottom) { return $true }
      $a = Norm $rc.Left $rc.Top; $b = Norm $rc.Right $rc.Bottom
      $rn = @($a[0], $a[1], $b[0], $b[1])
      # fullscreen transparent layer? mark it so AI ignores for clicks
      $fw = $rc.Right - $rc.Left; $fh = $rc.Bottom - $rc.Top
      if ($fw -ge ($scrW - 4) -and $fh -ge ($scrH - 4) -and ($OverlayProcs -contains $pn)) { $isOverlay = $true }
    }
    $zoom = $false; try { $zoom = [WinTrack]::IsZoomed($h) } catch {}
    $row = [ordered]@{ proc = $pn; title = $t; pid = [int]$procId; rect_norm = $rn; max = $zoom }
    if ($isOverlay) { $row.overlay = $true }
    $script:allWins += $row
  } catch {}
  return $true
}

function Get-AllWindows([int]$max) {
  $script:allWins = @()
  try { [WinTrack]::EnumWindows($enumCb, [IntPtr]::Zero) | Out-Null } catch {}
  # Foreground window first is handled by caller; here sort overlays last
  $sorted = @($script:allWins | Sort-Object { if ($_.overlay) { 1 } else { 0 } })
  if ($sorted.Count -gt $max) { return $sorted[0..($max-1)] }
  return $sorted
}

function Get-IdleMs {
  try {
    $li = New-Object WinTrack+LASTINPUTINFO
    $li.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($li)
    if ([WinTrack]::GetLastInputInfo([ref]$li)) {
      $tick = [Environment]::TickCount
      $idle = $tick - [int]$li.dwTime
      if ($idle -lt 0) { $idle += [uint32]::MaxValue + 1 }
      return [Math]::Max(0, $idle)
    }
  } catch {}
  return 0
}

function Get-ClipboardPreview {
  try {
    $c = Get-Clipboard -Raw -ErrorAction Stop
    if ([string]::IsNullOrEmpty($c)) { return @{ text = ""; hash = 0 } }
    $s = Sanitize $c 120
    return @{ text = $s; hash = (Get-StableHash $s) }
  } catch { return @{ text = ""; hash = 0 } }
}

function Rotate-LogIfNeeded([string]$path) {
  try {
    if (Test-Path -LiteralPath $path) {
      $len = (Get-Item -LiteralPath $path).Length
      if ($len -gt 5MB) {
        $bak = "$path.bak"
        Move-Item -LiteralPath $path -Destination $bak -Force -ErrorAction Stop
        Write-Host "rotated log ($([math]::Round($len/1MB,1)) MB) -> $bak" -ForegroundColor Yellow
      }
    }
  } catch {}
}

Write-Host "PC Live Map tracker v6 running every ${IntervalMs}ms -> $OutFile (screen ${scrW}x${scrH} virtual ${vscrW}x${vscrH}, UIA up to $MaxElements incl. values, wins up to $MaxWindows, Ctrl+C to stop)" -ForegroundColor Green
$lastSig = ""
$lastHwnd = [IntPtr]::Zero
$cachedElements = @()
$cachedWins = @()
$tick = 0
$seq = 0
$droppedSlow = 0
$clickL = 0; $clickR = 0
$prevL = $false; $prevR = $false
$lastClipHash = 0
$VK_LBUTTON = 0x01; $VK_RBUTTON = 0x02
$uiaSlowSkip = 0
# --- change tracking -------------------------------------------------------
# The snapshot tells the AI what the screen looks like now. This tells it what
# HAPPENED since it last looked, which is the difference between a photo and a
# video. Without it the AI re-reads 50 elements every turn to work out whether
# anything moved - slow, expensive, and often wrong, because "unchanged" and
# "changed and changed back" look identical in a snapshot.
$prevFocusKey = ""
$prevWinKey = ""
$prevFocusSig = ""
$prevClickL = 0; $prevClickR = 0
$prevX = -1; $prevY = -1
$lastClipHashSeen = 0
# Cursor jitter under this many pixels is noise (a shaky hand, a trackpad), not
# intent. Reporting every pixel would flood the timeline with nothing.
$CURSOR_MOVE_PX = 12
$pendingChg = @()
while ($true) {
  $loopSw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $tick++
    $pt = New-Object WinTrack+POINT
    [WinTrack]::GetCursorPos([ref]$pt) | Out-Null
    $hw = [WinTrack]::GetForegroundWindow()
    $sb = New-Object System.Text.StringBuilder 512
    [WinTrack]::GetWindowText($hw, $sb, 512) | Out-Null
    # Same 5.1 fix as above — see the note at the first occurrence.
    $procId = [uint32]0; [WinTrack]::GetWindowThreadProcessId($hw, [ref]$procId) | Out-Null
    $pname = ""
    $exePath = ""
    try { $pr = Get-Process -Id $procId -ErrorAction Stop; $pname = $pr.ProcessName; try { $exePath = $pr.Path } catch {} } catch { $pname = "unknown" }
    $title = Sanitize ($sb.ToString()) 80

    $rc = New-Object WinTrack+RECT
    $hasRect = [WinTrack]::GetWindowRect($hw, [ref]$rc)
    $rectNorm = @()
    if ($hasRect) {
      if (-not (Test-Offscreen $rc.Left $rc.Top $rc.Right $rc.Bottom)) {
        $a = Norm $rc.Left $rc.Top; $b = Norm $rc.Right $rc.Bottom
        $rectNorm = @($a[0], $a[1], $b[0], $b[1])
      }
    }
    $isMax = $false; try { $isMax = [WinTrack]::IsZoomed($hw) } catch {}

    $lDown = (([WinTrack]::GetAsyncKeyState($VK_LBUTTON) -band 0x8000) -ne 0)
    $rDown = (([WinTrack]::GetAsyncKeyState($VK_RBUTTON) -band 0x8000) -ne 0)
    if ($lDown -and -not $prevL) { $clickL++ }
    if ($rDown -and -not $prevR) { $clickR++ }
    $prevL = $lDown; $prevR = $rDown

    $idleMs = Get-IdleMs

    if ($uiaSlowSkip -gt 0) { $uiaSlowSkip-- }
    elseif ($hw -ne $lastHwnd -or ($tick % 4 -eq 0)) {
      $uSw = [System.Diagnostics.Stopwatch]::StartNew()
      $cachedElements = Get-UiaElements $hw $MaxElements
      $uSw.Stop()
      $lastHwnd = $hw
      # If UIA took >900ms, skip next 3 UIA cycles to keep the loop at 4Hz
      if ($uSw.ElapsedMilliseconds -gt 900) { $uiaSlowSkip = 3; $droppedSlow++ }
    }
    if (($tick % 8 -eq 1) -or ($cachedWins.Count -eq 0)) {
      $cachedWins = Get-AllWindows $MaxWindows
    }
    $focused = $null
    if ($tick % 4 -eq 0) { $focused = Get-FocusedElement }

    $clip = @{ text = ""; hash = $lastClipHash }
    if ($tick % 8 -eq 0) { $clip = Get-ClipboardPreview; $lastClipHash = $clip.hash }

    # ---- what changed since the last emitted sample ----
    # Only recorded on a real transition. A repeated identical value is not an
    # event, and reporting it would make the AI believe the user is doing
    # something continuously when they are not.
    $chg = @()
    $focusKey = "$pname|$title"
    if ($seq -gt 0) {
      if ($focusKey -ne $prevFocusKey) {
        if ($prevFocusKey -ne "") {
          $chg += "focus: $prevFocusKey -> $focusKey"
        } else {
          $chg += "focus: $focusKey"
        }
      }
      # A click is worth reporting on its own, with the position, so the AI
      # knows where the user pressed rather than only that a counter went up.
      if ($clickL -gt $prevClickL) { $chg += "click_left at $($pt.X),$($pt.Y) in $pname" }
      if ($clickR -gt $prevClickR) { $chg += "click_right at $($pt.X),$($pt.Y) in $pname" }
      if ($prevX -ge 0) {
        $dx = [Math]::Abs($pt.X - $prevX); $dy = [Math]::Abs($pt.Y - $prevY)
        if ($dx -ge $CURSOR_MOVE_PX -or $dy -ge $CURSOR_MOVE_PX) {
          $chg += "cursor_moved to $($pt.X),$($pt.Y)"
        }
      }
      if ($clip.hash -ne 0 -and $clip.hash -ne $lastClipHashSeen) {
        $chg += "clipboard_changed"
      }
      if ($null -ne $focused) {
        $fsig = "$($focused.role):$($focused.name):$($focused.value)"
        if ($fsig -ne $prevFocusSig) { $chg += "focused_element: $fsig" }
        $prevFocusSig = $fsig
      } else {
        $prevFocusSig = ""
      }
      # Windows opening and closing is the clearest "what changed on my
      # computer" signal there is.
      $winKey = (($cachedWins | ForEach-Object { "$($_.proc):$($_.title)" }) -join "|")
      if ($winKey -ne $prevWinKey) {
        if ($prevWinKey -ne "" -and $cachedWins.Count -gt 0) { $chg += "windows_changed: $($cachedWins.Count) open" }
        $prevWinKey = $winKey
      }
    }
    $lastClipHashSeen = $clip.hash
    $prevFocusKey = $focusKey
    $prevClickL = $clickL; $prevClickR = $clickR
    $prevX = $pt.X; $prevY = $pt.Y
    $pendingChg = $chg

     $cm = Norm $pt.X $pt.Y
     $seq++
     $ev = [ordered]@{
       t       = (Get-Date).ToString("o")
       v       = 6
       seq     = $seq
       x       = $pt.X; y = $pt.Y
       xn      = $cm[0]; yn = $cm[1]
       screen  = [ordered]@{ w = $scrW; h = $scrH }
       vscreen = [ordered]@{ w = $vscrW; h = $vscrH }
       win     = $title; proc = $pname; pid = [int]$procId
       exe     = (Sanitize $exePath 120); max = $isMax
       rect_norm = $rectNorm
       idle_ms = [int]$idleMs
       clicks  = [ordered]@{ left = $clickL; right = $clickR }
       tops    = @($cachedWins)
       elements = @($cachedElements)
       focused = $focused
       clip    = $clip.text
       chg     = @($pendingChg)
       slow_skips = $droppedSlow
       msg     = "cursor $($pt.X),$($pt.Y) idle ${idleMs}ms in $pname :: $title [L$clickL R$clickR, $($cachedElements.Count) ui, $($cachedWins.Count) wins]"
     }
     $line = ($ev | ConvertTo-Json -Compress -Depth 6)
     $sigParts = @("$($pt.X),$($pt.Y)", $pname, $title, "$($cachedElements.Count)", "L$clickL R$clickR", "$([int]($idleMs/2000))", "$($clip.hash)")
     if ($cachedElements.Count -gt 0) { $sigParts += [string](Get-StableHash (($cachedElements | ForEach-Object { "$($_.role):$($_.name):$($_.value):$($_.x),$($_.y)" }) -join ";")) }
     if ($null -ne $focused) { $sigParts += "f $($focused.role):$($focused.name):$($focused.value)" }
     $sig = $sigParts -join "|"
    if ($sig -ne $lastSig) {
      $line
      Rotate-LogIfNeeded $OutFile
      Add-Content -LiteralPath $OutFile -Value $line -Encoding UTF8
      $lastSig = $sig
    }
  } catch { Write-Warning $_.Exception.Message }
  $loopSw.Stop()
  $wait = $IntervalMs - [int]$loopSw.ElapsedMilliseconds
  if ($wait -gt 10) { Start-Sleep -Milliseconds $wait } else { Start-Sleep -Milliseconds 10 }
}
