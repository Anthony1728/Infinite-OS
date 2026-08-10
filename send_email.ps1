Add-Type -AssemblyName System.Windows.Forms

# Focus Chrome
$chrome = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -First 1
if ($chrome) {
    [System.Windows.Forms.SendKeys]::SendWait("^l")
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait("https://mail.google.com/mail/?view=cm&fs=1&to=terrellleematthews8627@gmail.com&su=Hello+from+Infinite+AI&body=Hi%2C%0A%0AThis+is+Infinite+AI+speaking.+I+wanted+to+reach+out+and+say+hello.+Hope+you+are+doing+well!%0A%0ABest+regards%2C%0AInfinite+AI")
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Write-Output "Navigated to Gmail compose"
} else {
    Write-Output "Chrome not found"
}
