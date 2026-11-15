param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') { throw 'Windows distribution must be built on Windows.' }
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$outputRoot = (Resolve-Path -LiteralPath $outputRoot).Path

[xml]$manifest = Get-Content -LiteralPath (Join-Path $projectDirectory 'zm5-only\Info.plist') -Raw -Encoding UTF8
$versionNode = $manifest.SelectSingleNode('/plist/dict/key[text()="CFBundleShortVersionString"]/following-sibling::string[1]')
if ($null -eq $versionNode -or $versionNode.InnerText -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version in Info.plist.' }
$version = $versionNode.InnerText
$packageName = "zaomeng-xiyou-v$version-windows-x64"
$packageDirectory = Join-Path $outputRoot $packageName
$archivePath = Join-Path $outputRoot "$packageName.zip"
$checksumPath = Join-Path $outputRoot "$packageName.sha256"

function Assert-OutputChild([string]$TargetPath) {
    $absolute = [IO.Path]::GetFullPath($TargetPath)
    $prefix = $outputRoot.TrimEnd('\') + '\'
    if (-not $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Build target escapes output directory: $absolute"
    }
}

foreach ($target in @($packageDirectory, $archivePath, $checksumPath)) { Assert-OutputChild $target }
if (Test-Path -LiteralPath $packageDirectory) {
    if (-not (Test-Path -LiteralPath (Join-Path $packageDirectory '.zmxy-build'))) {
        throw "Output already exists without the build marker: $packageDirectory"
    }
}

$runtimeDirectory = Join-Path $PSScriptRoot 'node_modules\electron\dist'
$runtimeExecutable = Join-Path $runtimeDirectory 'electron.exe'
if (-not (Test-Path -LiteralPath $runtimeExecutable)) {
    throw 'Electron runtime not installed. Run npm ci in windows first.'
}
$pe = [IO.File]::ReadAllBytes($runtimeExecutable)
$peOffset = [BitConverter]::ToInt32($pe, 0x3c)
if ([BitConverter]::ToUInt16($pe, $peOffset + 4) -ne 0x8664) { throw 'An x64 Electron runtime is required.' }

$appFiles = @('main.cjs', 'preload.cjs', 'core.cjs', 'index.html', 'renderer.js', 'styles.css')
$sharedFiles = @(
    'attack.cjs', 'bridge.cjs', 'auto-manifest.cjs', 'auto-patch.cjs', 'auto-patch-rule.json',
    'patch-zm1-v25928.json', 'patch-v25928.json', 'patch-v261029.json', 'patch-v5880.json',
    'boss-items-zm2.json', 'boss-items-zm3.json', 'zm2-items.json', 'zm3-items.json'
)
foreach ($file in $appFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $file))) { throw "Missing helper file: $file" }
}
foreach ($file in $sharedFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory "zm5-only\$file"))) { throw "Missing shared file: $file" }
}
$lzmaDirectory = Join-Path $PSScriptRoot 'node_modules\lzma'
if (-not (Test-Path -LiteralPath (Join-Path $lzmaDirectory 'src\lzma_worker.js'))) { throw 'lzma dependency not installed. Run npm ci first.' }

$stagingDirectory = Join-Path $outputRoot ('.build-' + [Guid]::NewGuid().ToString('N'))
Assert-OutputChild $stagingDirectory
try {
    New-Item -ItemType Directory -Path $stagingDirectory | Out-Null
    Get-ChildItem -LiteralPath $runtimeDirectory -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $stagingDirectory -Recurse -Force
    }
    Rename-Item -LiteralPath (Join-Path $stagingDirectory 'electron.exe') -NewName 'ZMXYHelper.exe'
    $defaultApplication = Join-Path $stagingDirectory 'resources\default_app.asar'
    if (Test-Path -LiteralPath $defaultApplication) { Remove-Item -LiteralPath $defaultApplication -Force }
    $applicationDirectory = Join-Path $stagingDirectory 'resources\app'
    $sharedDirectory = Join-Path $applicationDirectory 'shared'
    New-Item -ItemType Directory -Path $sharedDirectory -Force | Out-Null
    foreach ($file in $appFiles) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $applicationDirectory
    }
    foreach ($file in $sharedFiles) {
        Copy-Item -LiteralPath (Join-Path $projectDirectory "zm5-only\$file") -Destination $sharedDirectory
    }
    $package = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $runtimePackage = [ordered]@{
        name = $package.name
        version = $version
        description = $package.description
        author = $package.author
        license = $package.license
        main = 'main.cjs'
    }
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $applicationDirectory 'package.json'), ($runtimePackage | ConvertTo-Json), $utf8)
    [IO.File]::WriteAllText((Join-Path $applicationDirectory 'version.json'), (@{ version = $version } | ConvertTo-Json), $utf8)
    $runtimeLzma = Join-Path $applicationDirectory 'node_modules\lzma'
    New-Item -ItemType Directory -Path $runtimeLzma -Force | Out-Null
    foreach ($file in @('index.js', 'package.json', 'LICENSE', 'src')) {
        Copy-Item -LiteralPath (Join-Path $lzmaDirectory $file) -Destination $runtimeLzma -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $projectDirectory 'LICENSE') -Destination (Join-Path $applicationDirectory 'LICENSE')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $stagingDirectory 'WINDOWS-README.md')
    [IO.File]::WriteAllText((Join-Path $stagingDirectory '.zmxy-build'), $version, $utf8)
    $gameFiles = @(Get-ChildItem -LiteralPath $stagingDirectory -Recurse -File -Filter '*.swf')
    if ($gameFiles.Count -ne 0) { throw 'Distribution unexpectedly contains game SWF files.' }
    if (Test-Path -LiteralPath $packageDirectory) { Remove-Item -LiteralPath $packageDirectory -Recurse -Force }
    Move-Item -LiteralPath $stagingDirectory -Destination $packageDirectory
    Compress-Archive -LiteralPath $packageDirectory -DestinationPath $archivePath -CompressionLevel Optimal -Force
    $archiveStream = $null
    $sha256 = $null
    try {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        $archiveStream = [IO.File]::OpenRead($archivePath)
        $hash = [BitConverter]::ToString($sha256.ComputeHash($archiveStream)).Replace('-', '').ToLowerInvariant()
    } finally {
        if ($null -ne $archiveStream) { $archiveStream.Dispose() }
        if ($null -ne $sha256) { $sha256.Dispose() }
    }
    [IO.File]::WriteAllText($checksumPath, "$hash  $packageName.zip`n", $utf8)
    Write-Output "Built: $packageDirectory\ZMXYHelper.exe"
    Write-Output "Archive: $archivePath"
    Write-Output "SHA256: $hash"
} finally {
    if (Test-Path -LiteralPath $stagingDirectory) {
        Assert-OutputChild $stagingDirectory
        Remove-Item -LiteralPath $stagingDirectory -Recurse -Force
    }
}
