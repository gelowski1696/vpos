param(
  [string]$DbName = "vpos",
  [string]$DbUser = "vpos",
  [string]$DbPassword = "vpos",
  [string]$DbHost = "localhost",
  [int]$Port = 5432,
  [string]$AdminUser = "postgres",
  [string]$AdminPassword = "",
  [string]$AdminDatabase = "postgres",
  [string]$PsqlPath = "psql",
  [switch]$SkipEnvUpdate
)

$ErrorActionPreference = "Stop"

function Escape-SqlLiteral {
  param([string]$Value)
  return $Value.Replace("'", "''")
}

function Invoke-PsqlQuery {
  param([string]$Query)

  $previousPassword = $env:PGPASSWORD
  if ($AdminPassword -ne "") {
    $env:PGPASSWORD = $AdminPassword
  }

  $output = & $PsqlPath `
    -h $DbHost `
    -p $Port `
    -U $AdminUser `
    -d $AdminDatabase `
    -v "ON_ERROR_STOP=1" `
    -tAc $Query 2>&1
  $exitCode = $LASTEXITCODE

  if ($AdminPassword -ne "") {
    $env:PGPASSWORD = $previousPassword
  }

  if ($exitCode -ne 0) {
    $message = ($output | Out-String).Trim()
    throw "psql failed: $message"
  }

  return ($output | Out-String).Trim()
}

function Resolve-PsqlPath {
  param([string]$RequestedPath)

  $resolved = Get-Command $RequestedPath -ErrorAction SilentlyContinue
  if ($resolved) {
    return $RequestedPath
  }

  $searchRoots = @(
    "C:\Program Files\PostgreSQL",
    "C:\Program Files (x86)\PostgreSQL"
  )

  $candidates = @()
  foreach ($root in $searchRoots) {
    if (Test-Path $root) {
      $candidates += Get-ChildItem $root -Recurse -Filter psql.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
    }
  }

  if ($candidates.Count -gt 0) {
    $preferred = $candidates | Where-Object { $_ -match "\\bin\\psql\.exe$" } | Select-Object -First 1
    if (-not $preferred) {
      $preferred = $candidates | Select-Object -First 1
    }
    return $preferred
  }

  return $null
}

$resolvedPsqlPath = Resolve-PsqlPath $PsqlPath
if (-not $resolvedPsqlPath) {
  throw "psql command not found. Install PostgreSQL client tools, add psql to PATH, or pass -PsqlPath <full_path_to_psql.exe>."
}
$PsqlPath = $resolvedPsqlPath
Write-Host "Using psql at: $PsqlPath"

$dbNameEsc = Escape-SqlLiteral $DbName
$dbUserEsc = Escape-SqlLiteral $DbUser
$dbPasswordEsc = Escape-SqlLiteral $DbPassword

Write-Host "Checking role '$DbUser'..."
$roleExists = Invoke-PsqlQuery "SELECT 1 FROM pg_roles WHERE rolname = '$dbUserEsc';"
if ($roleExists -ne "1") {
  Write-Host "Creating role '$DbUser'..."
  Invoke-PsqlQuery "CREATE ROLE ""$DbUser"" WITH LOGIN PASSWORD '$dbPasswordEsc';" | Out-Null
} else {
  Write-Host "Role '$DbUser' already exists."
}

Write-Host "Ensuring role '$DbUser' has CREATEDB privilege (required by prisma migrate dev)..."
Invoke-PsqlQuery "ALTER ROLE ""$DbUser"" CREATEDB;" | Out-Null

Write-Host "Checking database '$DbName'..."
$dbExists = Invoke-PsqlQuery "SELECT 1 FROM pg_database WHERE datname = '$dbNameEsc';"
if ($dbExists -ne "1") {
  Write-Host "Creating database '$DbName' owned by '$DbUser'..."
  Invoke-PsqlQuery "CREATE DATABASE ""$DbName"" OWNER ""$DbUser"";" | Out-Null
} else {
  Write-Host "Database '$DbName' already exists."
}

Write-Host "Granting privileges..."
Invoke-PsqlQuery "GRANT ALL PRIVILEGES ON DATABASE ""$DbName"" TO ""$DbUser"";" | Out-Null

$databaseUrl = "postgresql://{0}:{1}@{2}:{3}/{4}?schema=public" -f $DbUser, $DbPassword, $DbHost, $Port, $DbName
Write-Host "Database ready."
Write-Host "DATABASE_URL=$databaseUrl"

if (-not $SkipEnvUpdate) {
  $envPath = Join-Path $PSScriptRoot "..\.env"
  if (Test-Path $envPath) {
    $raw = Get-Content $envPath -Raw
    if ($raw -match "(?m)^DATABASE_URL=") {
      $updated = [Regex]::Replace($raw, "(?m)^DATABASE_URL=.*$", "DATABASE_URL=$databaseUrl")
    } else {
      $separator = if ($raw.Length -gt 0 -and -not $raw.EndsWith([Environment]::NewLine)) { [Environment]::NewLine } else { "" }
      $updated = "$raw$separator" + "DATABASE_URL=$databaseUrl" + [Environment]::NewLine
    }
    Set-Content -Path $envPath -Value $updated
    Write-Host "Updated apps/api/.env DATABASE_URL"
  } else {
    Write-Host "apps/api/.env not found; skipped env update."
  }
}

Write-Host "Next steps:"
Write-Host "1) pnpm --filter @vpos/api prisma:generate"
Write-Host "2) pnpm --filter @vpos/api prisma:migrate"
Write-Host "3) pnpm --filter @vpos/api prisma:seed"
