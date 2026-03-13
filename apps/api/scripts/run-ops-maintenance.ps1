param(
  [switch]$ApplyRetention,
  [int]$RetentionYears = 7,
  [string]$LogDir = "./ops-logs"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -Path $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $LogDir "ops-maintenance-$timestamp.log"

function Write-Log($message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  Add-Content -Path $logFile -Value $line
}

Write-Log "Starting retention dry-run"
node ./scripts/retention-maintenance.mjs --years $RetentionYears | Tee-Object -FilePath $logFile -Append

if ($ApplyRetention) {
  Write-Log "Applying retention policy"
  node ./scripts/retention-maintenance.mjs --years $RetentionYears --apply | Tee-Object -FilePath $logFile -Append
}

Write-Log "Starting backup"
powershell -ExecutionPolicy Bypass -File ./scripts/backup-postgres.ps1 | Tee-Object -FilePath $logFile -Append

Write-Log "Maintenance run complete"
Write-Host "Log file: $logFile"
