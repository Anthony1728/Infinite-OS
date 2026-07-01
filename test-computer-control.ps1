# Test Computer Control — moves mouse, types text, opens browser

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Write-Host "=== InfiniteAI Computer Control Test ===" -ForegroundColor Cyan

# 1. Get screen dimensions
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Host "Screen: $($screen.Width) x $($screen.Height)" -ForegroundColor Yellow

# 2. Move mouse in a square pattern
Write-Host "Moving mouse in a square..." -ForegroundColor Green
$points = @(
    @{X = 200; Y = 200},
    @{X = 600; Y = 200},
    @{X = 600; Y = 500},
    @{X = 200; Y = 500},
    @{X = 200; Y = 200}
)

foreach ($p in $points) {
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($p.X, $p.Y)
    Start-Sleep -Milliseconds 200
    Write-Host "  Mouse -> ($($p.X), $($p.Y))" -ForegroundColor DarkGray
}

# 3. Double-click at center of screen
$centerX = [Math]::Floor($screen.Width / 2)
$centerY = [Math]::Floor($screen.Height / 2)
Write-Host "Double-clicking at center ($centerX, $centerY)..." -ForegroundColor Green
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($centerX, $centerY)
Start-Sleep -Milliseconds 100

# Mouse down + up for double click using mouse_event
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseCtrl {
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}
"@

# Double click (left down, left up, left down, left up)
[MouseCtrl]::mouse_event(0x0002, 0, 0, 0, 0) # LEFT_DOWN
[MouseCtrl]::mouse_event(0x0004, 0, 0, 0, 0) # LEFT_UP
Start-Sleep -Milliseconds 50
[MouseCtrl]::mouse_event(0x0002, 0, 0, 0, 0) # LEFT_DOWN
[MouseCtrl]::mouse_event(0x0004, 0, 0, 0, 0) # LEFT_UP
Write-Host "  Double-clicked!" -ForegroundColor DarkGray

# 4. Open Chrome and navigate to Google
Write-Host "Opening Chrome -> google.com..." -ForegroundColor Green
Start-Process "chrome.exe" "https://www.google.com"
Start-Sleep -Seconds 3

# 5. Type a search query using SendKeys
Write-Host "Typing search query..." -ForegroundColor Green
[System.Windows.Forms.SendKeys]::SendWait("InfiniteAI computer control test")
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "=== Test Complete! ===" -ForegroundColor Cyan
Write-Host "You should have seen:" -ForegroundColor Yellow
Write-Host "  1. Mouse move in a square pattern" -ForegroundColor White
Write-Host "  2. Double-click at screen center" -ForegroundColor White
Write-Host "  3. Chrome open with Google" -ForegroundColor White
Write-Host "  4. 'InfiniteAI computer control test' typed and searched" -ForegroundColor White
