param(
    [Parameter(Mandatory=$true)][string]$Setup,
    [string]$ProductName='LanDict',
    [string]$BundleIdentifier='com.pudict.desktop',
    [string]$Report='src-tauri/target/installer-preview/verification-release.json',
    [int]$AppLaunchSeconds=12,
    [switch]$SkipFlowC,
    [switch]$SkipAppLaunch,
    [string]$UserDataDirectory
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$installDir=Join-Path $env:LOCALAPPDATA "Programs\$ProductName"
$desktopLink=Join-Path $env:USERPROFILE "Desktop\$ProductName.lnk"
$startMenuLink=Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\$ProductName\$ProductName.lnk"
$uninstallKey="HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$ProductName"
$runKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$userData=if ($UserDataDirectory) { $UserDataDirectory } else { Join-Path $env:LOCALAPPDATA $BundleIdentifier }
$verification=[ordered]@{ setup=$Setup; startedAt=(Get-Date).ToString('s'); steps=@(); failures=@() }

function Add-Step([string]$name,[hashtable]$data) {
    $entry=[ordered]@{ step=$name }
    foreach ($key in $data.Keys) { $entry[$key]=$data[$key] }
    $script:verification['steps'] = @($script:verification['steps']) + $entry
    $entry.GetEnumerator() | ForEach-Object { Write-Output ("{0}: {1}={2}" -f $name,$_.Key,$_.Value) }
}

function Fail([string]$message) { $script:verification['failures'] = @($script:verification['failures']) + $message; Write-Output "FAILURE: $message" }

function Get-RunValue {
    $item=Get-Item -LiteralPath $runKey -ErrorAction SilentlyContinue
    if (-not $item) { return $null }
    if ($item.GetValueNames() -contains $ProductName) { return $item.GetValue($ProductName) }
    return $null
}

function Wait-For([scriptblock]$condition,[int]$timeoutSeconds=90) {
    $deadline=(Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (& $condition) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return [bool](& $condition)
}

function Invoke-Setup([string]$executable,[string[]]$arguments,[int]$timeoutSeconds=300) {
    $process=Start-Process -FilePath $executable -ArgumentList $arguments -PassThru
    if (-not $process.WaitForExit($timeoutSeconds*1000)) { Stop-Process -Id $process.Id -Force; throw "setup timed out: $executable $arguments" }
    return $process.ExitCode
}

function Wait-ForUninstall([int]$timeoutSeconds=180) {
    # NSIS uninstallers copy themselves to %TEMP% and exit immediately.
    $installed=Wait-For { -not (Test-Path -LiteralPath $script:installDir) } $timeoutSeconds
    Get-Process -Name 'Un_A','Au_.exe','uninstall' -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$env:TEMP*" } | ForEach-Object {
        if (-not $_.WaitForExit(60000)) { Stop-Process -Id $_.Id -Force }
    }
    return $installed
}

function Get-InstalledFiles {
    $files=[ordered]@{}
    foreach ($relative in @('landict.exe','dictionaries\stardict.db','dictionaries\landict-oxford.db','dictionaries\landict-cedict.db','uninstall.exe')) {
        $path=Join-Path $installDir $relative
        $files[$relative]=if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).Length } else { $null }
    }
    return $files
}

if (Test-Path -LiteralPath $installDir) { throw "Refusing to run: $installDir already exists before the test" }
if (Get-RunValue) { throw "Refusing to run: HKCU Run entry for $ProductName already exists" }
if (Test-Path -LiteralPath $uninstallKey) { throw "Refusing to run: uninstall registry key for $ProductName already exists" }
$userDataBefore=Test-Path -LiteralPath $userData
Add-Step 'pre-state' @{ installDir=$false; runEntry=$false; userData=$userDataBefore }

try {
    # Flow A: full install with every option enabled.
    $exit=Invoke-Setup $Setup @('/S','/ACCEPTAGREEMENT=1','/AUTOSTART=1','/KEEPINSTALLER=1','/DESKTOP=1')
    Add-Step 'A-install-exit-code' @{ exitCode=$exit }
    if ($exit -ne 0) { Fail "silent install returned $exit" }

    $files=Get-InstalledFiles
    $runValue=Get-RunValue
    $uninstallEntry=Test-Path -LiteralPath $uninstallKey
    $desktopCreated=Test-Path -LiteralPath $desktopLink
    $startMenuCreated=Test-Path -LiteralPath $startMenuLink
    Add-Step 'A-installed' @{ files=($files.Keys -join ','); missing=(($files.GetEnumerator() | Where-Object { $null -eq $_.Value } | ForEach-Object { $_.Key }) -join ','); uninstallKey=$uninstallEntry; desktopShortcut=$desktopCreated; startMenuShortcut=$startMenuCreated; runEntry=$runValue }
    foreach ($key in $files.Keys) { if ($null -eq $files[$key]) { Fail "missing installed file: $key" } }
    if (-not $uninstallEntry) { Fail 'uninstall registry entry missing' }
    if (-not $desktopCreated) { Fail 'desktop shortcut missing although requested' }
    if (-not $startMenuCreated) { Fail 'start menu shortcut missing' }
    if (-not $runValue -or $runValue -notlike '*landict.exe*') { Fail "autostart Run entry missing or wrong: $runValue" }

    if (-not $SkipAppLaunch) {
        $appProcess=Start-Process -FilePath (Join-Path $installDir 'landict.exe') -PassThru
        Start-Sleep -Seconds $AppLaunchSeconds
        $appProcess.Refresh()
        $appAlive=-not $appProcess.HasExited
        $appWindowTitle=$appProcess.MainWindowTitle
        Add-Step 'A-app-launch' @{ aliveAfterSeconds=$AppLaunchSeconds; running=$appAlive; windowTitle=$appWindowTitle; userDataPresent=(Test-Path -LiteralPath $userData); processId=$appProcess.Id }
        if (-not $appAlive) { Fail "installed app exited early (exit code $($appProcess.ExitCode))" }
        $runningApps=Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq (Join-Path $installDir 'landict.exe') }
        foreach ($app in $runningApps) { Stop-Process -Id $app.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
    } else {
        Add-Step 'A-app-launch' @{ skipped=$true }
    }

    $uninstaller=Join-Path $installDir 'uninstall.exe'
    $uninstallExit=Invoke-Setup $uninstaller @('/S')
    $removed=Wait-ForUninstall
    $runAfter=Get-RunValue
    Add-Step 'A-uninstall' @{ uninstallerExit=$uninstallExit; installDirRemoved=$removed; uninstallKeyRemoved=(-not (Test-Path -LiteralPath $uninstallKey)); desktopShortcutRemoved=(-not (Test-Path -LiteralPath $desktopLink)); startMenuShortcutRemoved=(-not (Test-Path -LiteralPath $startMenuLink)); runEntryAfter=$runAfter; userDataPreserved=(Test-Path -LiteralPath $userData) }
    if (-not $removed) { Fail 'install directory still present after uninstall' }
    if (Test-Path -LiteralPath $uninstallKey) { Fail 'uninstall registry entry still present' }
    if (Test-Path -LiteralPath $desktopLink) { Fail 'desktop shortcut still present after uninstall' }
    if (Test-Path -LiteralPath $startMenuLink) { Fail 'start menu shortcut still present after uninstall' }
    if ($runAfter) { Fail "autostart entry still present after uninstall: $runAfter" }
    if (-not (Test-Path -LiteralPath $userData)) { Fail 'user data directory was removed by uninstall' }

    # Flow B: silent install without accepting the agreement must not install anything.
    $refusedExit=Invoke-Setup $Setup @('/S')
    Add-Step 'B-refused-without-agreement' @{ exitCode=$refusedExit; installDirCreated=(Test-Path -LiteralPath $installDir) }
    if ($refusedExit -eq 0) { Fail 'silent install without the agreement succeeded' }
    if (Test-Path -LiteralPath $installDir) { Fail 'silent install without the agreement created files' }

    if (-not $SkipFlowC) {
        # Flow C: opt out of autostart/desktop shortcut and do not keep the installer.
        $scratch=Join-Path $env:TEMP ("landict-keep-test-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $scratch -Force | Out-Null
        $copy=Join-Path $scratch 'LanDict-setup-copy.exe'
        Copy-Item -LiteralPath $Setup -Destination $copy
        $exitC=Invoke-Setup $copy @('/S','/ACCEPTAGREEMENT=1','/AUTOSTART=0','/KEEPINSTALLER=0','/DESKTOP=0')
        $deleted=Wait-For { -not (Test-Path -LiteralPath $copy) } 60
        Add-Step 'C-options-off' @{ exitCode=$exitC; runEntry=(Get-RunValue); desktopShortcut=(Test-Path -LiteralPath $desktopLink); startMenuShortcut=(Test-Path -LiteralPath $startMenuLink); installerSelfDeleted=$deleted }
        if ($exitC -ne 0) { Fail "installer with all options off returned $exitC" }
        if (Get-RunValue) { Fail 'autostart entry was written although the option was off' }
        if (Test-Path -LiteralPath $desktopLink) { Fail 'desktop shortcut was created although the option was off' }
        if (-not (Test-Path -LiteralPath $startMenuLink)) { Fail 'start menu shortcut missing when only desktop shortcut was declined' }
        if (-not $deleted) { Fail 'installer was not deleted although keep-installer was off' }

        Invoke-Setup (Join-Path $installDir 'uninstall.exe') @('/S') | Out-Null
        $removedC=Wait-ForUninstall
        Add-Step 'C-uninstall' @{ installDirRemoved=$removedC; userDataPreserved=(Test-Path -LiteralPath $userData) }
        if (-not $removedC) { Fail 'install directory still present after the second uninstall' }
        Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }
} finally {
    $verification['finishedAt']=(Get-Date).ToString('s')
    $verification['ok'] = (@($verification['failures']).Count -eq 0)
    $verificationPath=Join-Path $projectRoot $Report
    New-Item -ItemType Directory -Path (Split-Path -Parent $verificationPath) -Force | Out-Null
    $verification | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $verificationPath -Encoding utf8NoBOM
    Write-Output "report=$verificationPath ok=$($verification['ok']) failures=$(@($verification['failures']).Count)"
    if (@($verification['failures']).Count) { $verification['failures'] | ForEach-Object { Write-Output " - $_" } }
}

