param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression.FileSystem
$bundle = $PSScriptRoot
$payload = Join-Path $Root 'v1'
$cache = Join-Path $Root 'downloads-v1'
$ready = Join-Path $payload 'ready.json'
New-Item -ItemType Directory -Path $Root,$payload,$cache -Force | Out-Null
# One preparer per user, including across upgrades. An interrupted process releases this lock.
try { $lock = [IO.File]::Open((Join-Path $Root 'prepare.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { exit 0 }

function Payload-Ready {
    if (-not (Test-Path -LiteralPath $ready)) { return $false }
    foreach ($file in @('runtime/python.exe','runtime/python312.zip','runtime/msvcp140.dll',
        'runtime/deps/ctranslate2/_ext.cp312-win_amd64.pyd','worker.py',
        'models/translate-en_zh-1_9/model/model.bin','models/translate-en_zh-1_9/sentencepiece.model',
        'models/translate-zh_en-1_9/model/model.bin','models/translate-zh_en-1_9/sentencepiece.model')) {
        if (-not (Test-Path -LiteralPath (Join-Path $payload $file))) { return $false }
    }
    return $true
}

function Has-Hash([string]$Path, [string]$Hash) {
    return (Test-Path -LiteralPath $Path) -and ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $Hash)
}

function Get-Archive([string]$Name, [string]$Hash, [string]$Url, [string]$Package, [string]$Version) {
    $archive = Join-Path $cache $Name
    if (Has-Hash $archive $Hash) { return $archive }
    $partial = "$archive.partial"
    if (Has-Hash $partial $Hash) {
        Move-Item -LiteralPath $partial -Destination $archive -Force
        return $archive
    }
    if (-not $Url) {
        $metadata = Invoke-RestMethod -Uri "https://pypi.org/pypi/$Package/$Version/json" -TimeoutSec 30
        $wheel = $metadata.urls | Where-Object { $_.filename -eq $Name -and $_.digests.sha256 -eq $Hash } | Select-Object -First 1
        if (-not $wheel) { throw "Pinned wheel unavailable: $Name" }
        $Url = $wheel.url
    }
    $offset = if (Test-Path -LiteralPath $partial) { (Get-Item -LiteralPath $partial).Length } else { 0 }
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 30000
    if ($offset -gt 0) { $request.AddRange([long]$offset) }
    $response = $null
    $inputStream = $null
    $outputStream = $null
    $expectedLength = -1
    try {
        $response = $request.GetResponse()
        $append = $offset -gt 0 -and [int]$response.StatusCode -eq 206
        if ($append -and $response.Headers['Content-Range'] -notmatch "^bytes $offset-") { throw 'Invalid resume range' }
        if ($response.ContentLength -ge 0) { $expectedLength = $response.ContentLength + $(if ($append) { $offset } else { 0 }) }
        $mode = if ($append) { [IO.FileMode]::Append } else { [IO.FileMode]::Create }
        $outputStream = [IO.File]::Open($partial, $mode, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $inputStream = $response.GetResponseStream()
        $inputStream.CopyTo($outputStream, 65536)
    } catch [Net.WebException] {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 416) {
            # A stale/full partial from a changed response must not retry the same range forever.
            Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
        }
        throw
    } finally {
        if ($outputStream) { $outputStream.Dispose() }
        if ($inputStream) { $inputStream.Dispose() }
        if ($response) { $response.Dispose() }
    }
    if ($expectedLength -ge 0 -and (Get-Item -LiteralPath $partial).Length -ne $expectedLength) { throw 'Download interrupted' }
    if (-not (Has-Hash $partial $Hash)) {
        Remove-Item -LiteralPath $partial -Force
        throw "Checksum mismatch: $Name"
    }
    Move-Item -LiteralPath $partial -Destination $archive -Force
    return $archive
}

function Expand-Verified([string]$Archive, [string]$Destination, [string]$Model) {
    $marker = Join-Path $Destination ('.archive-' + [IO.Path]::GetFileName($Archive) + '.ready')
    if (Test-Path -LiteralPath $marker) { return }
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    $base = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\','/')
            if ($Model -and $name -notmatch "^$Model/(model/|sentencepiece\.model$|metadata\.json$|README\.md$)") { continue }
            $target = [IO.Path]::GetFullPath((Join-Path $Destination $name))
            if (-not $target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escapes destination' }
            if (-not $entry.Name) { continue }
            New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        }
    } finally { $zip.Dispose() }
    [IO.File]::WriteAllText($marker, 'complete')
}

try {
    while (-not (Payload-Ready)) {
        try {
            if (Test-Path -LiteralPath $ready) {
                # Repair a previously ready payload if required files were removed.
                foreach ($directory in @('runtime','runtime/deps','models')) {
                    Get-ChildItem -LiteralPath (Join-Path $payload $directory) -Filter '.archive-*.ready' -File -ErrorAction SilentlyContinue |
                        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
                }
            }
            Remove-Item -LiteralPath $ready -Force -ErrorAction SilentlyContinue
            $runtime = Join-Path $payload 'runtime'
            $python = Get-Archive 'python-3.12.10-embed-amd64.zip' '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3' 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
            Expand-Verified $python $runtime
            $wheels = @(
                @('ctranslate2','4.8.2','ctranslate2-4.8.2-cp312-cp312-win_amd64.whl','d94421d565d0de61c032998f737a18942b0f2bef40c0424b1846ec6f67300105'),
                @('sentencepiece','0.2.2','sentencepiece-0.2.2-cp312-cp312-win_amd64.whl','7c6e7bf684dc12145bfa685d3060beaea55139134ba848289bee514ed42e7383'),
                @('numpy','2.5.4','numpy-2.5.4-cp312-cp312-win_amd64.whl','a7b1b6353e36a7e50de2973a38d705c88ee93adcf120673cee7f45a4a3fa223a'),
                @('PyYAML','6.0.3','pyyaml-6.0.3-cp312-cp312-win_amd64.whl','5fcd34e47f6e0b794d17de1b4ff496c00986e1c83f7ab2fb8fcfe9616ff7477b'),
                @('pysbd','0.3.4','pysbd-0.3.4-py3-none-any.whl','cd838939b7b0b185fcf86b0baf6636667dfb6e474743beeff878e9f42e022953')
            )
            foreach ($wheel in $wheels) {
                $archive = Get-Archive $wheel[2] $wheel[3] '' $wheel[0] $wheel[1]
                Expand-Verified $archive (Join-Path $runtime 'deps')
            }
            [IO.File]::WriteAllText((Join-Path $runtime 'python312._pth'), "python312.zip`n.`ndeps`nimport site`n", [Text.Encoding]::ASCII)
            Copy-Item -Path (Join-Path $bundle 'crt/*.dll') -Destination $runtime -Force
            foreach ($model in @(
                @('translate-en_zh-1_9','433e7c4f034d87fbe2353161e05f18646d7999452f801a4e1f0378522b9850ab'),
                @('translate-zh_en-1_9','62e7af5a3a48b530e47b7b3e5c78c2de79073ecd815750d2bf3ab35b4a67da2d')
            )) {
                $archive = Get-Archive "$($model[0]).argosmodel" $model[1] "https://argos-net.com/v1/$($model[0]).argosmodel"
                Expand-Verified $archive (Join-Path $payload 'models') $model[0]
            }
            foreach ($name in @('worker.py','MODEL-LICENSE.txt','NOTICE.md')) {
                Copy-Item -LiteralPath (Join-Path $bundle $name) -Destination $payload -Force
            }
            # Only a complete, verified payload is visible to the translation worker.
            [IO.File]::WriteAllText($ready, '{"version":1}')
        } catch {
            # Stay quiet while offline; preserve partial downloads for the next attempt/start.
            [IO.File]::WriteAllText((Join-Path $Root 'last-error.txt'), $_.Exception.Message)
            Start-Sleep -Seconds 60
        }
    }
} finally { $lock.Dispose() }
