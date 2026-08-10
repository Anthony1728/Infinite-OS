Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Click on Chrome icon in taskbar (it appears to be around x=355, y=767 based on taskbar)
[System.Windows.Forms.SendKeys]::SendWait("%{TAB}")
Start-Sleep -Milliseconds 500

# Take screenshot
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('C:\Users\user\Desktop\New folder (2)\screenshot3.png')
$graphics.Dispose()
$bitmap.Dispose()
Write-Output 'Screenshot saved'
