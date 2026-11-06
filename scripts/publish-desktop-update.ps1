param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version = '0.1.5',

    [string]$Notes = 'Transfer, pricing, sync, cashier identity, and stability improvements.',

    [string]$SshTarget = 'root@vmjamtech.com',

    [string]$ReleaseWorktree = 'D:\vpos-release-0.1.5-clean-2',

    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$MinimumSupportedVersion = '0.1.3',

    [switch]$SkipVpsStackUpdate,

    [switch]$PolicyOnly,

    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($Notes -match '[\r\n]') {
    throw 'Release notes must be a single line.'
}
if ($PolicyOnly -and $SkipVpsStackUpdate) {
    throw 'PolicyOnly cannot be combined with SkipVpsStackUpdate.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$updaterKeyPath = 'C:\Secure\TauriUpdater\vpos-desktop-updater.key'
$composeFile = 'infra/compose/docker-compose.prod.yml'
$tagName = "v$Version"
$askPassExe = $null

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$WorkingDirectory = $repoRoot
    )

    Write-Host "> $FilePath $($Arguments -join ' ')" -ForegroundColor Cyan
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$FilePath failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

function Get-EnvironmentSecret {
    param([Parameter(Mandatory = $true)][string]$Name)

    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = [Environment]::GetEnvironmentVariable($Name, 'User')
    }
    return $value
}

function Set-UpdaterSigningEnvironment {
    $privateKey = Get-EnvironmentSecret -Name 'TAURI_PRIVATE_KEY'
    if ([string]::IsNullOrWhiteSpace($privateKey)) {
        if (-not (Test-Path -LiteralPath $updaterKeyPath -PathType Leaf)) {
            throw "Updater key not found at $updaterKeyPath"
        }
        $privateKey = Get-Content -Raw -LiteralPath $updaterKeyPath
    }
    $env:TAURI_PRIVATE_KEY = $privateKey.Trim()

    $keyPassword = Get-EnvironmentSecret -Name 'tauri_updater_password'
    if ([string]::IsNullOrEmpty($keyPassword)) {
        $keyPassword = Get-EnvironmentSecret -Name 'TAURI_KEY_PASSWORD'
    }
    if ([string]::IsNullOrEmpty($keyPassword)) {
        $securePassword = Read-Host 'Enter the Tauri updater key password' -AsSecureString
        $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        try {
            $keyPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        }
    }
    if ([string]::IsNullOrEmpty($keyPassword)) {
        throw 'The Tauri updater key password is required.'
    }
    $env:TAURI_KEY_PASSWORD = $keyPassword
}

function New-SshAskPassExecutable {
    $askPassDirectory = Join-Path $env:TEMP 'vpos-ssh-askpass'
    New-Item -ItemType Directory -Force -Path $askPassDirectory | Out-Null
    $outputPath = Join-Path $askPassDirectory "askpass-$([Guid]::NewGuid().ToString('N')).exe"
    $source = @'
using System;

public static class VposSshAskPass
{
    [STAThread]
    public static void Main()
    {
        var password = Environment.GetEnvironmentVariable("vps_password", EnvironmentVariableTarget.Process);
        if (String.IsNullOrEmpty(password))
        {
            password = Environment.GetEnvironmentVariable("vps_password", EnvironmentVariableTarget.User);
        }
        Console.Out.Write(password ?? String.Empty);
    }
}
'@
    Add-Type -TypeDefinition $source -OutputAssembly $outputPath -OutputType ConsoleApplication
    return $outputPath
}

function Assert-CleanWorktree {
    param([Parameter(Mandatory = $true)][string]$Path)

    $dirty = @(& git -C $Path status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect release worktree: $Path"
    }
    if ($dirty.Count -eq 1 -and $dirty[0] -match '^ M apps/desktop/src-tauri/Cargo\.toml$') {
        $cargoManifest = Join-Path $Path 'apps\desktop\src-tauri\Cargo.toml'
        $worktreeHash = (& git -C $Path hash-object --no-filters $cargoManifest).Trim()
        $indexHash = (& git -C $Path rev-parse ':apps/desktop/src-tauri/Cargo.toml').Trim()
        if ($LASTEXITCODE -eq 0 -and $worktreeHash -eq $indexHash) {
            Invoke-Checked -FilePath 'git' -Arguments @('-C', $Path, 'restore', '--source=HEAD', '--worktree', '--', 'apps/desktop/src-tauri/Cargo.toml')
            $dirty = @(& git -C $Path status --porcelain)
        }
    }
    if ($dirty) {
        throw "Release worktree is not clean: $Path`n$($dirty -join [Environment]::NewLine)"
    }
}

try {
    $vpsPassword = Get-EnvironmentSecret -Name 'vps_password'
    if ([string]::IsNullOrWhiteSpace($vpsPassword)) {
        throw 'Windows user variable vps_password is missing or empty.'
    }
    $env:vps_password = $vpsPassword

    Invoke-Checked -FilePath 'git' -Arguments @('fetch', 'origin', 'main')

    if (-not (Test-Path -LiteralPath $ReleaseWorktree -PathType Container)) {
        Invoke-Checked -FilePath 'git' -Arguments @('worktree', 'add', '--detach', $ReleaseWorktree, 'origin/main')
    }
    Assert-CleanWorktree -Path $ReleaseWorktree
    Invoke-Checked -FilePath 'git' -Arguments @('-C', $ReleaseWorktree, 'checkout', '--detach', 'origin/main')
    Assert-CleanWorktree -Path $ReleaseWorktree

    $headCommit = (& git -C $ReleaseWorktree rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to resolve the release commit.'
    }

    Invoke-Checked -FilePath 'pnpm' -Arguments @('install', '--frozen-lockfile') -WorkingDirectory $ReleaseWorktree
    Invoke-Checked -FilePath 'pnpm' -Arguments @('--filter', '@vpos/desktop', 'version:check') -WorkingDirectory $ReleaseWorktree
    Assert-CleanWorktree -Path $ReleaseWorktree

    $askPassExe = New-SshAskPassExecutable
    $env:SSH_ASKPASS = $askPassExe
    $env:SSH_ASKPASS_REQUIRE = 'force'
    $env:DISPLAY = 'vpos-ssh-askpass'
    $env:GIT_TERMINAL_PROMPT = '0'

    Invoke-Checked -FilePath 'ssh' -Arguments @(
        '-o', 'StrictHostKeyChecking=yes',
        '-o', 'NumberOfPasswordPrompts=1',
        '-o', 'ConnectTimeout=15',
        $SshTarget,
        'printf VPOS_SSH_OK'
    )

    if ($ValidateOnly) {
        Write-Host "Validation passed for VPOS Desktop $Version at commit $headCommit." -ForegroundColor Green
        exit 0
    }

    if (-not $PolicyOnly) {
        Set-UpdaterSigningEnvironment
        $releaseScriptPath = Join-Path $ReleaseWorktree 'apps\desktop\scripts\release-desktop-update.ps1'
        Invoke-Checked -FilePath 'powershell.exe' -Arguments @(
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', $releaseScriptPath,
            '-Version', $Version,
            '-Notes', $Notes,
            '-SshTarget', $SshTarget,
            '-Publish'
        ) -WorkingDirectory $ReleaseWorktree
    }

    if (-not $SkipVpsStackUpdate) {
        $publishedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        $policyLines = @(
            'DESKTOP_WINDOWS_UPDATES_ENABLED=true'
            "DESKTOP_WINDOWS_LATEST_VERSION=$Version"
            "DESKTOP_WINDOWS_MIN_SUPPORTED_VERSION=$MinimumSupportedVersion"
            'DESKTOP_WINDOWS_REQUIRED=false'
            'DESKTOP_WINDOWS_ROLLOUT_PERCENTAGE=100'
            "DESKTOP_WINDOWS_RELEASE_NOTES=$Notes"
            "DESKTOP_WINDOWS_PUBLISHED_AT=$publishedAt"
            'DESKTOP_WINDOWS_SUPPORT_URL=https://vmjamtech.com/support'
        ) -join "`n"
        $policyBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$policyLines`n"))
        $policyBackup = "apps/api/.env.backup-desktop-$Version"
        $remoteTemplate = @'
set -e
cd /opt/vpos
git pull --ff-only origin main
env_file='apps/api/.env'
test -f "$env_file"
cp -p "$env_file" '__POLICY_BACKUP__'
policy_file=$(mktemp)
trap 'rm -f "$policy_file" "$env_file.tmp"' EXIT
printf '%s' '__POLICY_BASE64__' | base64 -d > "$policy_file"
while IFS='=' read -r key value; do
  [ -n "$key" ] || continue
  awk -v key="$key" -v value="$value" 'BEGIN { found=0 } index($0, key "=") == 1 { print key "=" value; found=1; next } { print } END { if (!found) print key "=" value }' "$env_file" > "$env_file.tmp"
  mv "$env_file.tmp" "$env_file"
done < "$policy_file"
docker compose -f __COMPOSE_FILE__ up -d --build
docker compose -f __COMPOSE_FILE__ ps
'@
        $remoteCommand = $remoteTemplate.
            Replace('__POLICY_BACKUP__', $policyBackup).
            Replace('__POLICY_BASE64__', $policyBase64).
            Replace('__COMPOSE_FILE__', $composeFile)
        Invoke-Checked -FilePath 'ssh' -Arguments @(
            '-o', 'StrictHostKeyChecking=yes',
            '-o', 'NumberOfPasswordPrompts=1',
            $SshTarget,
            $remoteCommand
        )
    }

    $manifestUrl = 'https://vmjamtech.com/desktop-updates/latest.json'
    $manifestResponse = Invoke-WebRequest -Uri $manifestUrl -UseBasicParsing
    if ($manifestResponse.StatusCode -ne 200 -or $manifestResponse.Content -notmatch [regex]::Escape($Version)) {
        throw "Published manifest verification failed: $manifestUrl"
    }
    $artifactUrl = "https://vmjamtech.com/desktop-updates/$Version/VPOS%20Desktop_$($Version)_x64_en-US.msi.zip"
    $artifactResponse = Invoke-WebRequest -Uri $artifactUrl -Method Head -UseBasicParsing
    if ($artifactResponse.StatusCode -ne 200) {
        throw "Published artifact verification failed: $artifactUrl"
    }

    if ($PolicyOnly) {
        Write-Host "VPOS Desktop $Version policy and VPS stack were updated from $headCommit." -ForegroundColor Green
    } else {
        $existingTagOutput = & git -C $ReleaseWorktree rev-parse -q --verify "refs/tags/$tagName" 2>$null
        $tagLookupExitCode = $LASTEXITCODE
        $existingTag = if ($existingTagOutput) { ($existingTagOutput | Select-Object -First 1).Trim() } else { '' }
        if ($tagLookupExitCode -eq 0 -and $existingTag) {
            $tagCommit = (& git -C $ReleaseWorktree rev-list -n 1 $tagName).Trim()
            & git -C $ReleaseWorktree merge-base --is-ancestor $tagCommit $headCommit
            if ($LASTEXITCODE -ne 0) {
                throw "Tag $tagName points to $tagCommit, which is not an ancestor of release commit $headCommit."
            }

            $taggedPackageJson = (& git -C $ReleaseWorktree show "${tagCommit}:apps/desktop/package.json" | Out-String)
            if ($LASTEXITCODE -ne 0) {
                throw "Unable to inspect the desktop version at tag $tagName."
            }
            $taggedVersion = ($taggedPackageJson | ConvertFrom-Json).version
            if ($taggedVersion -ne $Version) {
                throw "Tag $tagName contains desktop version $taggedVersion instead of $Version."
            }
        } else {
            Invoke-Checked -FilePath 'git' -Arguments @('-C', $ReleaseWorktree, 'tag', '-a', $tagName, '-m', "VPOS Desktop $Version")
            $tagCommit = $headCommit
        }
        Invoke-Checked -FilePath 'git' -Arguments @('-C', $ReleaseWorktree, 'push', 'origin', $tagName)

        Write-Host "VPOS Desktop $Version was generated and published from $headCommit; tag $tagName identifies release source $tagCommit." -ForegroundColor Green
    }
} finally {
    if ($askPassExe -and (Test-Path -LiteralPath $askPassExe)) {
        Remove-Item -LiteralPath $askPassExe -Force -ErrorAction SilentlyContinue
    }
    $env:vps_password = $null
    $env:TAURI_KEY_PASSWORD = $null
    $env:TAURI_PRIVATE_KEY = $null
    $env:SSH_ASKPASS = $null
    $env:SSH_ASKPASS_REQUIRE = $null
    $env:DISPLAY = $null
    $env:GIT_TERMINAL_PROMPT = $null
}
