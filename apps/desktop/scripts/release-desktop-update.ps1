param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$Notes,

    [string]$BaseUrl = 'https://vmjamtech.com/desktop-updates',
    [string]$SshTarget = 'root@vmjamtech.com',
    [string]$RemoteRoot = '/var/www/vpos-desktop-updates',
    [switch]$Publish,
    [switch]$AllowDirty
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$desktopRoot = Join-Path $repoRoot 'apps\desktop'
$releaseRoot = Join-Path $desktopRoot 'release\ota'
$versionRoot = Join-Path $releaseRoot $Version
$manifestPath = Join-Path $releaseRoot 'latest.json'

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments)
    Write-Host "> $FilePath $($Arguments -join ' ')" -ForegroundColor Cyan
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

Push-Location $repoRoot
try {
    if (-not $AllowDirty) {
        $dirty = & git status --porcelain
        if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect Git working tree.' }
        if ($dirty) {
            throw 'The Git working tree is not clean. Commit the release source first, or pass -AllowDirty only for a non-production test build.'
        }
    }

    if (-not $env:TAURI_PRIVATE_KEY) {
        throw 'TAURI_PRIVATE_KEY is required. Keep it on the trusted release machine or in protected CI secrets.'
    }
    if (-not $BaseUrl.StartsWith('https://')) {
        throw 'BaseUrl must use HTTPS.'
    }

    $packageVersion = (Get-Content -Raw -LiteralPath (Join-Path $desktopRoot 'package.json') | ConvertFrom-Json).version
    if ($packageVersion -ne $Version) {
        throw "Requested release $Version does not match the committed desktop version $packageVersion. Run 'pnpm desktop:version -- $Version', review, commit, and rerun the release command."
    }
    Invoke-Checked 'pnpm' @('--filter', '@vpos/desktop', 'release:check')
    Invoke-Checked 'pnpm' @('--filter', '@vpos/desktop', 'tauri:build:ota')

    $env:VPOS_UPDATE_BASE_URL = $BaseUrl
    Invoke-Checked 'pnpm' @('--filter', '@vpos/desktop', 'ota:manifest', '--', '--version', $Version, '--notes', $Notes, '--base-url', $BaseUrl)

    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Manifest not found: $manifestPath" }
    if (-not (Test-Path -LiteralPath $versionRoot)) { throw "Version output not found: $versionRoot" }
    $zip = Get-ChildItem -LiteralPath $versionRoot -Filter '*.msi.zip' -File
    $sig = Get-ChildItem -LiteralPath $versionRoot -Filter '*.msi.zip.sig' -File
    if ($zip.Count -ne 1 -or $sig.Count -ne 1) {
        throw 'Release output must contain exactly one updater ZIP and one updater signature.'
    }

    Write-Host "Release $Version passed local validation." -ForegroundColor Green
    Write-Host "Artifact: $($zip.FullName)"
    Write-Host "Manifest: $manifestPath"

    if (-not $Publish) {
        Write-Host 'Publication was not requested. Review the files, then rerun with -Publish.' -ForegroundColor Yellow
        exit 0
    }

    $remoteVersionRoot = "$RemoteRoot/$Version"
    Invoke-Checked 'ssh' @($SshTarget, "mkdir -p '$remoteVersionRoot'")
    foreach ($file in Get-ChildItem -LiteralPath $versionRoot -File) {
        Invoke-Checked 'scp' @($file.FullName, "${SshTarget}:$remoteVersionRoot/$($file.Name)")
    }

    $encodedArtifact = [System.Uri]::EscapeDataString($zip.Name).Replace('%2F', '/')
    $artifactUrl = "$BaseUrl/$Version/$encodedArtifact"
    $artifactResponse = Invoke-WebRequest -Uri $artifactUrl -Method Head -UseBasicParsing
    if ($artifactResponse.StatusCode -ne 200) { throw "Published artifact verification failed: $artifactUrl" }

    $remoteTempManifest = "$RemoteRoot/latest.json.$Version.tmp"
    Invoke-Checked 'scp' @($manifestPath, "${SshTarget}:$remoteTempManifest")
    Invoke-Checked 'ssh' @($SshTarget, "mv '$remoteTempManifest' '$RemoteRoot/latest.json'")

    $manifestResponse = Invoke-WebRequest -Uri "$BaseUrl/latest.json" -UseBasicParsing
    if ($manifestResponse.StatusCode -ne 200 -or $manifestResponse.Content -notmatch [regex]::Escape($Version)) {
        throw 'Live manifest verification failed after publication.'
    }

    Write-Host "VPOS Desktop $Version is published." -ForegroundColor Green
    Write-Host "Rollback/forward-fix note: allowDowngrades is false; publish a newer patch version to revert application behavior."
} finally {
    Pop-Location
}
