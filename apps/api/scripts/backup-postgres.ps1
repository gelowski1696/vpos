param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$OutputDir = "./backups",
  [string]$PgDumpPath = "",
  [switch]$SchemaOnly
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  $envPath = Join-Path $PSScriptRoot "..\.env"
  if (Test-Path $envPath) {
    $line = Get-Content -Path $envPath | Where-Object { $_ -match "^DATABASE_URL=" } | Select-Object -First 1
    if ($line) {
      $DatabaseUrl = $line.Substring("DATABASE_URL=".Length).Trim().Trim("'").Trim('"')
    }
  }
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  throw "DATABASE_URL is required. Pass -DatabaseUrl, set DATABASE_URL in environment, or define DATABASE_URL in apps/api/.env."
}

$pgDumpUrl = $DatabaseUrl
if ($DatabaseUrl -match "\?") {
  $parts = $DatabaseUrl.Split("?", 2)
  $base = $parts[0]
  $query = $parts[1]
  $queryParts = $query.Split("&") | Where-Object { $_ -and ($_ -notmatch "^(?i)schema=") }
  if ($queryParts.Count -gt 0) {
    $pgDumpUrl = "$base?$(($queryParts -join "&"))"
  } else {
    $pgDumpUrl = $base
  }
}

$resolvedPgDump = $PgDumpPath
if ([string]::IsNullOrWhiteSpace($resolvedPgDump)) {
  $pgDumpCmd = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($pgDumpCmd) {
    $resolvedPgDump = $pgDumpCmd.Source
  } else {
    $commonPaths = @(
      "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe",
      "C:\Program Files\PostgreSQL\15\bin\pg_dump.exe",
      "C:\Program Files\PostgreSQL\14\bin\pg_dump.exe",
      "C:\Program Files\PostgreSQL\13\bin\pg_dump.exe"
    )
    $detected = $commonPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $detected) {
      throw "pg_dump command not found. Add PostgreSQL client tools to PATH, install PostgreSQL client tools, or pass -PgDumpPath <full_path_to_pg_dump.exe>."
    }
    $resolvedPgDump = $detected
  }
}

if (-not (Test-Path -Path $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$mode = if ($SchemaOnly) { "schema" } else { "full" }
$backupFile = Join-Path $OutputDir "vpos-$mode-$timestamp.dump"

$args = @(
  "--format=custom",
  "--no-owner",
  "--no-privileges",
  "--file", $backupFile
)
if ($SchemaOnly) {
  $args += "--schema-only"
}
$args += $pgDumpUrl

Write-Host "Running backup with pg_dump..."
& $resolvedPgDump @args
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE"
}

Write-Host "Backup completed: $backupFile"
