# Build a Chrome-loadable ZIP with correct folder layout (icons/ must stay icons/).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $root "manifest.json"))) {
    $root = Split-Path -Parent $PSScriptRoot
}

$version = (Get-Content (Join-Path $root "manifest.json") -Raw | ConvertFrom-Json).version
$staging = Join-Path $root "dist\package-staging"
$zipPath = Join-Path $root "oneclickproxy-v$version.zip"

$files = @(
    "background.js",
    "manifest.json",
    "popup.css",
    "popup.html",
    "popup.js",
    "LICENSE",
    "README.md",
    "PRIVACY.md",
    "STORE.md"
)

if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Path (Join-Path $staging "icons") -Force | Out-Null

foreach ($file in $files) {
    $src = Join-Path $root $file
    if (-not (Test-Path $src)) {
        throw "Missing required file: $file"
    }
    Copy-Item $src -Destination $staging
}

Copy-Item (Join-Path $root "icons\*") -Destination (Join-Path $staging "icons")

if (Test-Path $zipPath) { Remove-Item -Force $zipPath }

Push-Location $staging
try {
    Compress-Archive -Path * -DestinationPath $zipPath -Force
} finally {
    Pop-Location
}

Remove-Item -Recurse -Force $staging

Write-Host "Created $zipPath"

$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$iconEntry = $zip.Entries | Where-Object { $_.FullName -replace '\\', '/' -eq "icons/icon16.png" }
$zip.Dispose()

if (-not $iconEntry) {
    throw "ZIP layout invalid: icons/icon16.png not found at expected path"
}

Write-Host "Verified icons/icon16.png in archive"
