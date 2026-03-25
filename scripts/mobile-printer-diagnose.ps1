param(
  [string]$Serial = "",
  [int]$LogcatLines = 400
)

$ErrorActionPreference = "Stop"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "=== $Title ===" -ForegroundColor Cyan
}

function Invoke-Adb {
  param(
    [Parameter(Mandatory = $true)][string[]]$Args
  )
  if ($script:AdbPrefix.Count -gt 0) {
    & adb @script:AdbPrefix @Args
  } else {
    & adb @Args
  }
}

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
  throw "adb is not installed or not in PATH."
}

$script:AdbPrefix = @()
if ($Serial.Trim()) {
  $script:AdbPrefix = @("-s", $Serial.Trim())
}

Write-Section "ADB Devices"
& adb devices

$state = (Invoke-Adb -Args @("get-state") 2>$null)
if (-not $state -or $state.Trim() -ne "device") {
  throw "No active adb device found. Connect device and enable USB debugging."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path $PSScriptRoot "..\docs\diagnostics"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$reportPath = Join-Path $outDir "mobile-printer-diagnose-$timestamp.txt"

function Add-Report {
  param([string]$Line)
  Add-Content -Path $reportPath -Value $Line
}

Add-Report "VPOS Mobile Printer Diagnostic"
Add-Report "Timestamp: $(Get-Date -Format s)"
Add-Report "Serial: $Serial"
Add-Report ""

Write-Section "Device Identity"
$manufacturer = (Invoke-Adb -Args @("shell", "getprop", "ro.product.manufacturer")).Trim()
$brand = (Invoke-Adb -Args @("shell", "getprop", "ro.product.brand")).Trim()
$model = (Invoke-Adb -Args @("shell", "getprop", "ro.product.model")).Trim()
$device = (Invoke-Adb -Args @("shell", "getprop", "ro.product.device")).Trim()
$androidVersion = (Invoke-Adb -Args @("shell", "getprop", "ro.build.version.release")).Trim()
$sdkInt = (Invoke-Adb -Args @("shell", "getprop", "ro.build.version.sdk")).Trim()

$identityLines = @(
  "Manufacturer: $manufacturer",
  "Brand: $brand",
  "Model: $model",
  "Device: $device",
  "Android: $androidVersion (SDK $sdkInt)"
)
$identityLines | ForEach-Object { Write-Host $_; Add-Report $_ }

Write-Section "Likely Printer SDK Packages"
$packages = (Invoke-Adb -Args @("shell", "pm", "list", "packages")) -split "`r?`n"
$keywords = @("imin", "sunmi", "urovo", "pax", "wiseasy", "newland", "printer", "woyou", "escpos", "receipt", "reciept", "posmgt", "senraise")
$matched = $packages | Where-Object {
  $line = $_.ToLowerInvariant()
  $keywords | Where-Object { $line.Contains($_) } | Select-Object -First 1
}
if (-not $matched -or $matched.Count -eq 0) {
  $msg = "No obvious printer vendor package found via pm list packages."
  Write-Host $msg -ForegroundColor Yellow
  Add-Report $msg
} else {
  $matched | ForEach-Object { Write-Host $_; Add-Report $_ }
}

Write-Section "VPOS App Package"
$vposPackage = "com.vmjamtech.vpos"
$appPath = (Invoke-Adb -Args @("shell", "pm", "path", $vposPackage) 2>$null)
if (-not $appPath) {
  $msg = "VPOS package not found: $vposPackage"
  Write-Host $msg -ForegroundColor Yellow
  Add-Report $msg
} else {
  Write-Host $appPath
  Add-Report $appPath
}

Write-Section "Recent Printer Logs"
$logPattern = "VposPrinterBridge|\\[VPOS\\]\\[PRINTER\\]|PRINT_IMIN|PRINT_ESCPOS|PRINTER_CAPABILITIES|Unable to print via iMin SDK|Native printer bridge"
$rawLog = Invoke-Adb -Args @("logcat", "-d", "-t", "$LogcatLines")
$filteredLog = $rawLog -split "`r?`n" | Where-Object { $_ -match $logPattern }
if (-not $filteredLog -or $filteredLog.Count -eq 0) {
  $msg = "No printer logs found in last $LogcatLines lines. Run Test Print immediately before running this script."
  Write-Host $msg -ForegroundColor Yellow
  Add-Report $msg
} else {
  $filteredLog | ForEach-Object { Write-Host $_; Add-Report $_ }
}

Write-Section "Suggested Next Profile"
$sdkHint = "UNKNOWN"
if ($matched -match "imin") {
  $sdkHint = "IMIN"
} elseif ($matched -match "sunmi") {
  $sdkHint = "SUNMI"
} elseif ($matched -match "urovo") {
  $sdkHint = "UROVO"
} elseif ($matched -match "pax") {
  $sdkHint = "PAX"
} elseif ($matched -match "wiseasy") {
  $sdkHint = "WISEASY"
} elseif ($matched -match "newland") {
  $sdkHint = "NEWLAND"
} elseif ($matched -match "recieptservice|receiptservice") {
  $sdkHint = "ANDROID_PRINT_SERVICE"
}

$suggestions = @(
  "SDK hint from packages: $sdkHint",
  "1) Built-in only policy is enabled: use Auto Detect Built-in Profile, Save Printer Settings, then Test Print.",
  "2) If sdkHint is ANDROID_PRINT_SERVICE (for example SENRAISE H10), built-in vendor SDK/service integration is required in VposPrinterBridge.",
  "3) If sdkHint is IMIN and hasIminDeviceHint=true, IMIN built-in mode should work.",
  '4) For live logs during test print: adb -s <serial> logcat | Select-String -Pattern "VposPrinterBridge|\[VPOS\]\[PRINTER\]|PRINT_IMIN|PRINT_ESCPOS|PRINTER_CAPABILITIES"'
)
$suggestions | ForEach-Object { Write-Host $_; Add-Report $_ }

Write-Host ""
Write-Host "Saved report: $reportPath" -ForegroundColor Green
