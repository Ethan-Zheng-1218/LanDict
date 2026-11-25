param([switch]$SkipAssets)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$buildDirectory=Join-Path $projectRoot 'src-tauri/target/installer-preview'
$assetsDirectory=Join-Path $buildDirectory 'assets'
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
if (-not $SkipAssets) { & (Join-Path $PSScriptRoot 'prepare-assets.ps1') -OutputDirectory $assetsDirectory }
$requiredAssets=@('paper.png','app-icon.png','brand.png','wordmark.png','check.png','clouds.png','cloud.png','earth.png','earth-core.png','earth-outline.png','complete.png','progress-texture.png','installer.ico')
$requiredAssets+=0..23 | ForEach-Object { "sheep-run-$_.png" }
foreach ($asset in $requiredAssets) { if (-not (Test-Path -LiteralPath (Join-Path $assetsDirectory $asset))) { throw "Prepared installer asset missing: $asset" } }
$compiler=Join-Path $projectRoot '.superpowers/installer-tools/nsis-3.11/nsis-3.11/makensis.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $toolDirectory=Join-Path $projectRoot '.superpowers/installer-tools'
    New-Item -ItemType Directory -Path $toolDirectory -Force | Out-Null
    $archive=Join-Path $toolDirectory 'nsis-3.11.zip'
    Invoke-WebRequest -Uri 'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip' -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA1).Hash -ne 'EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D') { throw 'NSIS archive checksum mismatch' }
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $toolDirectory 'nsis-3.11') -Force
}
$source=Join-Path $projectRoot 'src-tauri/windows/installer-ui/src/lib.rs'
$plugin=Join-Path $buildDirectory 'landict_installer_ui.dll'
& rustc --crate-type cdylib --crate-name landict_installer_ui --target i686-pc-windows-msvc --edition 2021 $source -O -C panic=abort -C target-feature=+crt-static -o $plugin
if ($LASTEXITCODE -ne 0) {throw 'Installer rendering module failed to compile'}
& $compiler '/V2' "/DBUILD_DIR=$buildDirectory" "/DASSET_DIR=$assetsDirectory" "/DPREVIEW_DIR=$buildDirectory\extracted" "/DPAYLOAD_DIR=$projectRoot\data" (Join-Path $projectRoot 'src-tauri/windows/preview.nsi')
if ($LASTEXITCODE -ne 0) {throw 'Native NSIS preview failed to compile'}
Write-Output (Join-Path $buildDirectory 'LanDict-native-preview.exe')
