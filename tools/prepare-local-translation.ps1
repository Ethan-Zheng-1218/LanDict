param([string]$CrtDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$payload = Join-Path $projectRoot 'src-tauri/target/local-translation'
$cache = Join-Path $projectRoot 'src-tauri/target/local-translation-downloads'
$runtime = Join-Path $payload 'runtime'
$models = Join-Path $payload 'models'
$stamp = Join-Path $payload 'prepared-v1.json'
New-Item -ItemType Directory -Path $payload,$cache -Force | Out-Null

function Get-Asset([string]$Url, [string]$Name) {
    $archive = Join-Path $cache $Name
    if (-not (Test-Path -LiteralPath $archive)) {
        Write-Host "Preparing local translation: $Name"
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile "$archive.partial" -TimeoutSec 300
        Move-Item -LiteralPath "$archive.partial" -Destination $archive -Force
    }
    return $archive
}

$requiredFiles = @(
    'runtime/python.exe', 'runtime/python312.zip', 'runtime/msvcp140.dll',
    'runtime/deps/ctranslate2/_ext.cp312-win_amd64.pyd',
    'models/translate-en_zh-1_9/model/model.bin',
    'models/translate-zh_en-1_9/model/model.bin', 'MODEL-LICENSE.txt'
)
$complete = (Test-Path -LiteralPath $stamp)
foreach ($file in $requiredFiles) { if (-not (Test-Path -LiteralPath (Join-Path $payload $file))) { $complete = $false } }
if (-not $complete) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $pythonArchive = Get-Asset 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' 'python-3.12.10-embed-amd64.zip'
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    # Extract through Expand-Archive to support repair of an incomplete preparation.
    Expand-Archive -LiteralPath $pythonArchive -DestinationPath $runtime -Force
    $deps = Join-Path $runtime 'deps'
    New-Item -ItemType Directory -Path $deps -Force | Out-Null
    $versions = [ordered]@{ ctranslate2='4.8.2'; sentencepiece='0.2.2'; numpy='2.5.4'; PyYAML='6.0.3'; pysbd='0.3.4' }
    foreach ($name in $versions.Keys) {
        $info = Invoke-RestMethod -Uri "https://pypi.org/pypi/$name/$($versions[$name])/json" -TimeoutSec 60
        $wheel = $info.urls | Where-Object { $_.filename -match '(cp312-cp312-win_amd64|py3-none-any)\.whl$' } | Select-Object -First 1
        if (-not $wheel) { throw "No Windows x64 Python 3.12 wheel for $name" }
        $archive = Get-Asset $wheel.url $wheel.filename
        # Wheels are ZIPs. Keep their dist-info license directories in the private environment.
        $wheelZip = Join-Path $cache ($wheel.filename + '.zip')
        Copy-Item -LiteralPath $archive -Destination $wheelZip -Force
        Expand-Archive -LiteralPath $wheelZip -DestinationPath $deps -Force
    }
    [IO.File]::WriteAllText((Join-Path $runtime 'python312._pth'), "python312.zip`n.`ndeps`nimport site`n", [Text.Encoding]::ASCII)
    foreach ($direction in @('en_zh','zh_en')) {
        $name = "translate-$direction-1_9"
        $archive = Get-Asset "https://argos-net.com/v1/$name.argosmodel" "$name.argosmodel"
        $modelZip = Join-Path $cache "$name.zip"
        Copy-Item -LiteralPath $archive -Destination $modelZip -Force
        $unpacked = Join-Path $cache "$name-unpacked"
        Expand-Archive -LiteralPath $modelZip -DestinationPath $unpacked -Force
        $target = Join-Path $models $name
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        # Keep original weights/tokenizer/metadata/attribution; exclude unused Stanza models.
        Copy-Item -LiteralPath (Join-Path $unpacked "$name/model") -Destination $target -Recurse -Force
        foreach ($file in @('sentencepiece.model','metadata.json','README.md')) {
            Copy-Item -LiteralPath (Join-Path $unpacked "$name/$file") -Destination $target -Force
        }
    }
    $modelLicense = Get-Asset 'https://creativecommons.org/licenses/by/4.0/legalcode.txt' 'CC-BY-4.0.txt'
    Copy-Item -LiteralPath $modelLicense -Destination (Join-Path $payload 'MODEL-LICENSE.txt') -Force
    if (-not $CrtDirectory) {
        $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
        if (Test-Path -LiteralPath $vswhere) {
            $installations = & $vswhere -products '*' -property installationPath
            foreach ($installation in $installations) {
                $redist = Join-Path $installation 'VC/Redist/MSVC'
                foreach ($version in (Get-ChildItem -LiteralPath $redist -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)) {
                    $candidate = Get-ChildItem -Path (Join-Path $version.FullName 'x64/Microsoft.VC*.CRT/msvcp140.dll') -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($candidate) { $CrtDirectory = $candidate.DirectoryName; break }
                }
                if ($CrtDirectory) { break }
            }
        }
    }
    if (-not $CrtDirectory -or -not (Test-Path -LiteralPath (Join-Path $CrtDirectory 'msvcp140.dll'))) {
        throw 'Supply -CrtDirectory with the licensed Visual Studio x64 redistributable CRT directory. Do not depend on system DLLs at runtime.'
    }
    Copy-Item -Path (Join-Path $CrtDirectory '*.dll') -Destination $runtime -Force
    $versions | ConvertTo-Json | Set-Content -LiteralPath $stamp -Encoding UTF8
}
# Always copy application-owned scripts/notices so source edits are reflected during development.
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'local-translation/worker.py') -Destination (Join-Path $payload 'worker.py') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'local-translation/NOTICE.md') -Destination (Join-Path $payload 'NOTICE.md') -Force
Write-Host 'Offline English/Chinese translation resources ready (no installer built).'
