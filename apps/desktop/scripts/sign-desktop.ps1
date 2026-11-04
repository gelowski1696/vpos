param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$TargetPath
)

$ErrorActionPreference = 'Stop'

function Resolve-SignTool {
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if (Test-Path $kitsRoot) {
        $candidates = Get-ChildItem $kitsRoot -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending
        if ($candidates) {
            return $candidates[0].FullName
        }
    }

    throw 'signtool.exe was not found. Install the Windows SDK / Signing Tools or add signtool.exe to PATH.'
}

if (-not (Test-Path $TargetPath)) {
    throw "Target file not found: $TargetPath"
}

$signTool = Resolve-SignTool
$timestampUrl = if ($env:VPOS_SIGN_TIMESTAMP_URL) { $env:VPOS_SIGN_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' }

$args = @(
    'sign',
    '/fd', 'SHA256',
    '/td', 'SHA256',
    '/tr', $timestampUrl
)

if ($env:VPOS_SIGN_CERT_SHA1) {
    $args += @('/sha1', $env:VPOS_SIGN_CERT_SHA1)
} elseif ($env:VPOS_SIGN_PFX_PATH) {
    if (-not (Test-Path $env:VPOS_SIGN_PFX_PATH)) {
        throw "VPOS_SIGN_PFX_PATH does not exist: $($env:VPOS_SIGN_PFX_PATH)"
    }
    $args += @('/f', $env:VPOS_SIGN_PFX_PATH)
    if ($env:VPOS_SIGN_PFX_PASSWORD) {
        $args += @('/p', $env:VPOS_SIGN_PFX_PASSWORD)
    }
} else {
    throw 'No signing certificate configured. Set VPOS_SIGN_CERT_SHA1 or VPOS_SIGN_PFX_PATH (and optionally VPOS_SIGN_PFX_PASSWORD).'
}

$args += $TargetPath

Write-Host "Signing $TargetPath"
& $signTool @args
if ($LASTEXITCODE -ne 0) {
    throw "signtool.exe failed with exit code $LASTEXITCODE"
}
