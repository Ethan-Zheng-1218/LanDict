param([string]$Executable='src-tauri/target/release/landict.exe')
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$appPath=[IO.Path]::GetFullPath((Join-Path $projectRoot $Executable))
if (-not (Test-Path -LiteralPath $appPath)) { throw "Application not found: $appPath" }
if (Get-Process -Name landict -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $appPath }) {
    throw 'Close the application at the tested executable path before running the smoke test.'
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LanDictInstanceWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@

function Wait-Until([scriptblock]$Condition, [int]$Seconds=15) {
    $deadline=(Get-Date).AddSeconds($Seconds)
    do {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)
    throw 'Timed out waiting for the expected application state.'
}

$started=[Collections.Generic.List[Diagnostics.Process]]::new()
try {
    $first=Start-Process -FilePath $appPath -WindowStyle Hidden -PassThru
    $started.Add($first)
    Wait-Until {
        $first.Refresh()
        -not $first.HasExited -and $first.MainWindowHandle -ne [IntPtr]::Zero -and $first.MainWindowTitle -eq 'LanDict'
    }
    $handle=$first.MainWindowHandle
    foreach ($state in @('visible','hidden','minimized')) {
        if ($state -eq 'hidden') {
            [LanDictInstanceWindow]::ShowWindowAsync($handle,0) | Out-Null
            Wait-Until { -not [LanDictInstanceWindow]::IsWindowVisible($handle) }
        } elseif ($state -eq 'minimized') {
            [LanDictInstanceWindow]::ShowWindowAsync($handle,6) | Out-Null
            Wait-Until { [LanDictInstanceWindow]::IsIconic($handle) }
        }
        $next=Start-Process -FilePath $appPath -WindowStyle Hidden -PassThru
        $started.Add($next)
        if (-not $next.WaitForExit(10000)) { throw "Second instance stayed running while the first window was $state." }
        if ($next.ExitCode -ne 0) { throw "Second launch exited with code $($next.ExitCode)." }
        Wait-Until {
            [LanDictInstanceWindow]::IsWindowVisible($handle) -and
            -not [LanDictInstanceWindow]::IsIconic($handle) -and
            [LanDictInstanceWindow]::GetForegroundWindow() -eq $handle
        }
        $first.Refresh()
        if ($first.HasExited) { throw 'The original application instance exited.' }
        $running=@(Get-Process -Name landict -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $appPath })
        if ($running.Count -ne 1 -or $running[0].Id -ne $first.Id) { throw 'The original instance was not the only running instance.' }
        Write-Output "PASS: $state window restored and focused; original PID $($first.Id), one instance."
    }
} finally {
    foreach ($process in $started) {
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
        $process.Dispose()
    }
}
