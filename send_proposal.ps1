Add-Type -AssemblyName System.Windows.Forms

$compose = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'Compose Mail' } | Select-Object -First 1
if (-not $compose) {
    Write-Output "NO_COMPOSE_WINDOW"
    Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { "title: $($_.MainWindowTitle)" }
    exit 1
}

Write-Output "Detected: $($compose.MainWindowTitle)"
$code = @"
using System;
using System.Runtime.InteropServices;
public class Win32Focus4 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
try { Add-Type $code } catch {}
[Win32Focus4]::ShowWindow($compose.MainWindowHandle, 9) | Out-Null
Start-Sleep -Milliseconds 500
[Win32Focus4]::SetForegroundWindow($compose.MainWindowHandle) | Out-Null
Start-Sleep -Seconds 10

[System.Windows.Forms.SendKeys]::SendWait("^{ENTER}")
Write-Output "Sent Ctrl+Enter"
Start-Sleep -Seconds 7

Write-Output "Post-send windows:"
Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { "title: $($_.MainWindowTitle)" }
