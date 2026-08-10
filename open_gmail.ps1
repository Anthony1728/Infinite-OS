Add-Type -AssemblyName System.Windows.Forms

# Focus Chrome
$chrome = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -First 1
if ($chrome) {
    [System.Windows.Forms.SendKeys]::SendWait("^l")
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait("https://mail.google.com")
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Write-Output "Navigating to Gmail..."
} else {
    Write-Output "Chrome not found"
}
