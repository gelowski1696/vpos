param(
  [int]$Count = 8,
  [int]$IntervalSeconds = 5,
  [string]$Root = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $Root = (Resolve-Path $Root).Path
}

$outDir = Join-Path $Root "docs\presentation\live\mobile-sequence"
if (!(Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

$devices = adb devices | Out-String
if ($devices -notmatch "(?m)^\S+\s+device\s*$") {
  throw "No adb device connected."
}

Write-Host "[VPOS][MOBILE] Starting sequence capture..."
Write-Host "[VPOS][MOBILE] Navigate your app screens now."

for ($i = 1; $i -le $Count; $i++) {
  $file = Join-Path $outDir ("mobile-step-" + $i.ToString("00") + ".png")
  cmd /c "adb exec-out screencap -p > `"$file`""
  Write-Host "[VPOS][MOBILE] Captured $file"
  if ($i -lt $Count) {
    Start-Sleep -Seconds $IntervalSeconds
  }
}

Write-Host "[VPOS][MOBILE] Done. Output: $outDir"
