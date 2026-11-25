param(
    [Parameter(Mandatory=$true)][string]$Executable,
    [Parameter(Mandatory=$true)][string]$Output,
    [string[]]$Arguments=@(),
    [int]$DelaySeconds=6,
    [switch]$KeepRunning,
    [string]$ClickIds='',
    [int]$WaitAfterClickSeconds=0,
    [int]$RecaptureAfterSeconds=0
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace Native -Name Window -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hWnd, int id);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string windowName);
[DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
Add-Type -Namespace Native -Name Controls -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWnd, EnumProc callback, IntPtr param);
[DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hWnd);
public delegate bool EnumProc(IntPtr hWnd, IntPtr param);
public static IntPtr FindById(IntPtr root, int id) {
  IntPtr found = IntPtr.Zero;
  EnumChildWindows(root, delegate(IntPtr h, IntPtr p) { if (GetDlgCtrlID(h) == id) { found = h; return false; } return true; }, IntPtr.Zero);
  return found;
}
'@

$process=Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru
$handle=[IntPtr]::Zero
for ($attempt=0; $attempt -lt ($DelaySeconds*4); $attempt++) {
    Start-Sleep -Milliseconds 250
    $process.Refresh()
    if ($process.HasExited) { throw "Installer exited before a window appeared (exit $($process.ExitCode))" }
    if ($process.MainWindowHandle -ne [IntPtr]::Zero) { $handle=$process.MainWindowHandle; break }
}
if ($handle -eq [IntPtr]::Zero) { throw 'Installer window handle was not found' }

[Native.Window]::ShowWindow($handle, 5) | Out-Null
[Native.Window]::SetForegroundWindow($handle) | Out-Null
# Keep the whole window inside the primary screen so the capture is not clipped.
[Native.Window]::SetWindowPos($handle, [IntPtr]::Zero, 60, 40, 0, 0, 0x0001 -bor 0x0004) | Out-Null
# Temporarily float above other windows; Windows blocks focus stealing, so Z-order is raised instead.
[Native.Window]::SetWindowPos($handle, [IntPtr](-1), 60, 40, 0, 0, 0x0001 -bor 0x0002 -bor 0x0004) | Out-Null
Start-Sleep -Milliseconds 1200

$clickTargets=@($ClickIds -split '[,;\s]+' | Where-Object { $_ } | ForEach-Object { [int]$_ })
if ($clickTargets.Count -gt 0) {
    # The drawn controls live under the artwork child window, so search the whole dialog by id.
    foreach ($id in $clickTargets) {
        $control=[Native.Controls]::FindById($handle, $id)
        if ($control -eq [IntPtr]::Zero) { throw "Control $id not found" }
        [Native.Window]::SendMessage($control, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
        Start-Sleep -Milliseconds 900
    }
}
if ($WaitAfterClickSeconds -gt 0) { Start-Sleep -Seconds $WaitAfterClickSeconds }
if ($RecaptureAfterSeconds -gt 0) { Start-Sleep -Seconds $RecaptureAfterSeconds }
# Raise it again: anything may have come to the front while the installer was working.
[Native.Window]::ShowWindow($handle, 5) | Out-Null
[Native.Window]::SetForegroundWindow($handle) | Out-Null
[Native.Window]::SetWindowPos($handle, [IntPtr](-1), 60, 40, 0, 0, 0x0001 -bor 0x0002 -bor 0x0004) | Out-Null
Start-Sleep -Milliseconds 900

$rect=New-Object Native.Window+RECT
if (-not [Native.Window]::GetWindowRect($handle, [ref]$rect)) { throw 'GetWindowRect failed' }
$width=$rect.Right-$rect.Left
$height=$rect.Bottom-$rect.Top
$directory=Split-Path -Parent $Output
if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
$bitmap=New-Object System.Drawing.Bitmap($width, $height)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
# Ask the window to render itself: this also works while another topmost app covers it.
$hdc=$graphics.GetHdc()
$rendered=[Native.Window]::PrintWindow($handle, $hdc, 2)
$graphics.ReleaseHdc($hdc)
if (-not $rendered) { $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height))) }
$bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

[Native.Window]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 0x0001 -bor 0x0002 -bor 0x0004) | Out-Null

if (-not $KeepRunning -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
Write-Output "captured=$Output size=${width}x${height} at=${($rect.Left)},${($rect.Top)}"
