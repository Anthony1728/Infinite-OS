Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Bring Chrome to focus first
$chrome = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -First 1
if ($chrome) {
    [System.Windows.Forms.SendKeys]::SendWait("%{TAB}")
    Start-Sleep -Milliseconds 1000
}

# Take screenshot
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('C:\Users\user\Desktop\New folder (2)\screenshot2.png')
$graphics.Dispose()
$bitmap.Dispose()
Write-Output 'Screenshot saved'
