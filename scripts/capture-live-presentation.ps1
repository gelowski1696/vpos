param(
  [string]$BaseUrl = "https://vmjamtech.com",
  [string]$ChromePath = "",
  [string]$Root = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $Root = (Resolve-Path $Root).Path
}

$presentationDir = Join-Path $Root "docs\presentation"
$liveDir = Join-Path $presentationDir "live"
if (!(Test-Path $liveDir)) {
  New-Item -ItemType Directory -Path $liveDir | Out-Null
}

if ([string]::IsNullOrWhiteSpace($ChromePath)) {
  $candidates = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      $ChromePath = $candidate
      break
    }
  }
}

if ([string]::IsNullOrWhiteSpace($ChromePath) -or !(Test-Path $ChromePath)) {
  throw "Chrome/Edge not found. Pass -ChromePath explicitly."
}

function To-FileUrl([string]$path) {
  return "file:///" + ($path -replace "\\", "/")
}

function Capture-Web([string]$url, [string]$png) {
  & $ChromePath --headless --disable-gpu --window-size=1920,1080 "--screenshot=$png" "$url" | Out-Null
}

function Capture-Mobile([string]$png) {
  $devices = adb devices | Out-String
  if ($devices -notmatch "(?m)^\S+\s+device\s*$") {
    throw "No adb device connected."
  }
  cmd /c "adb exec-out screencap -p > `"$png`""
}

function Export-Pdf([string]$inputHtml, [string]$outputPdf) {
  $url = To-FileUrl $inputHtml
  & $ChromePath --headless --disable-gpu --allow-file-access-from-files --no-pdf-header-footer "--print-to-pdf=$outputPdf" "$url" | Out-Null
}

$landingPng = Join-Path $liveDir "web-landing-live.png"
$loginPng = Join-Path $liveDir "web-login-live.png"
$mobilePng = Join-Path $liveDir "mobile-live-current.png"

Write-Host "[VPOS][LIVE] Capturing web landing..."
Capture-Web "$BaseUrl/" $landingPng
Write-Host "[VPOS][LIVE] Capturing web login..."
Capture-Web "$BaseUrl/login" $loginPng
Write-Host "[VPOS][LIVE] Capturing current phone screen via adb..."
Capture-Mobile $mobilePng

$deckHtml = Join-Path $presentationDir "live-captures-deck.html"
$deckPdf = Join-Path $liveDir "vpos-live-captures-deck.pdf"
Write-Host "[VPOS][LIVE] Exporting PDF deck..."
Export-Pdf $deckHtml $deckPdf

Write-Host "[VPOS][LIVE] Complete."
Write-Host "[VPOS][LIVE] Output: $liveDir"
