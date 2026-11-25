param([switch]$SkipAppBuild,[switch]$SkipAssets,[switch]$TestPackage)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$buildDirectory=Join-Path $projectRoot 'src-tauri/target/installer-preview'
$assetsDirectory=Join-Path $buildDirectory 'assets'
$appVersion=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$tauriVersion=(Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json).version
$cargoText=Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri/Cargo.toml') -Raw
$lockText=Get-Content -LiteralPath (Join-Path $projectRoot 'src-tauri/Cargo.lock') -Raw
$cargoVersion=[regex]::Match($cargoText,'(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
$lockVersion=[regex]::Match($lockText,'name = "landict"\r?\nversion = "([^"]+)"').Groups[1].Value
if (-not $appVersion -or @($tauriVersion,$cargoVersion,$lockVersion | Where-Object { $_ -ne $appVersion }).Count) {
    throw 'Release versions differ. Update package.json, Cargo.toml, Cargo.lock and tauri.conf.json together.'
}
$releaseSetup=Join-Path $projectRoot "src-tauri/target/release/bundle/nsis/LanDict_${appVersion}_x64-setup.exe"
if (-not $TestPackage -and (Test-Path -LiteralPath $releaseSetup)) {
    throw "LanDict $appVersion already has an installer. Increment the application version before building a new release."
}
Write-Host "Building LanDict $appVersion (settings read the same package version)."
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
Push-Location $projectRoot
try {
    # A leftover installer from an earlier test keeps the plugin DLL locked; close those first.
    Get-Process -Name 'LanDict*' -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.Path -like '*bundle\nsis\*' -or $_.Path -like '*installer-preview*') { Stop-Process -Id $_.Id -Force }
    }
    if (-not $SkipAssets) { & (Join-Path $PSScriptRoot 'prepare-assets.ps1') -OutputDirectory $assetsDirectory }
    foreach ($asset in @('paper.png','app-icon.png','brand.png','wordmark.png','check.png','clouds.png','cloud.png','earth.png','earth-core.png','earth-outline.png','complete.png','progress-texture.png','installer.ico')+(0..23 | ForEach-Object {"sheep-run-$_.png"})) {
        if (-not (Test-Path -LiteralPath (Join-Path $assetsDirectory $asset))) {throw "Missing native installer asset: $asset"}
    }
    & rustc --crate-type cdylib --crate-name landict_installer_ui --target i686-pc-windows-msvc --edition 2021 (Join-Path $projectRoot 'src-tauri/windows/installer-ui/src/lib.rs') -O -C panic=abort -C target-feature=+crt-static -o (Join-Path $buildDirectory 'landict_installer_ui.dll')
    if ($LASTEXITCODE -ne 0) {throw 'Native installer module failed to compile'}
    & rustc --target i686-pc-windows-msvc --edition 2021 (Join-Path $projectRoot 'src-tauri/windows/installer-cleanup.rs') -O -C panic=abort -C target-feature=+crt-static -o (Join-Path $buildDirectory 'landict-cleanup.exe')
    if ($LASTEXITCODE -ne 0) {throw 'Installer cleanup helper failed to compile'}
    if (-not $SkipAppBuild) {
        & pnpm tauri build --no-bundle
        if ($LASTEXITCODE -ne 0) {throw 'LanDict release application build failed'}
    }
    $config='src-tauri/tauri.installer.conf.json'
    if ($TestPackage) {
        # Same template and release payload; separate product keys and shortcuts for host smoke tests.
        $testConfig=Get-Content -LiteralPath (Join-Path $projectRoot $config) -Raw | ConvertFrom-Json
        $testConfig | Add-Member productName 'LanDict Installer Test'
        $testConfig | Add-Member identifier 'com.pudict.installer-test'
        $testConfig.bundle.windows.nsis.startMenuFolder='LanDict Installer Test'
        $config=Join-Path $buildDirectory 'tauri-test.conf.json'
        $testConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $config -Encoding utf8NoBOM
    }
    $previousBuild=$env:LANDICT_INSTALLER_BUILD
    $env:LANDICT_INSTALLER_BUILD=$buildDirectory
    try {
        & pnpm tauri bundle --bundles nsis --config $config
        if ($LASTEXITCODE -ne 0) {throw 'LanDict NSIS bundling failed'}
    } finally {$env:LANDICT_INSTALLER_BUILD=$previousBuild}
} finally {Pop-Location}
