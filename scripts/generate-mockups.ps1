param(
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
$outputDir = Join-Path $presentationDir "output"

if (!(Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
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
  $normalized = $path -replace "\\", "/"
  return "file:///$normalized"
}

function Export-Screenshot([string]$inputHtml, [string]$outputPng) {
  $url = To-FileUrl $inputHtml
  & $ChromePath --headless --disable-gpu --allow-file-access-from-files --window-size=1366,768 "--screenshot=$outputPng" "$url" | Out-Null
}

function Export-Pdf([string]$inputHtml, [string]$outputPdf) {
  $url = To-FileUrl $inputHtml
  & $ChromePath --headless --disable-gpu --allow-file-access-from-files --no-pdf-header-footer "--print-to-pdf=$outputPdf" "$url" | Out-Null
}

$webDashboardHtml = Join-Path $presentationDir "web-dashboard-mockup.html"
$webReportsHtml = Join-Path $presentationDir "web-reports-mockup.html"
$mobilePosHtml = Join-Path $presentationDir "mobile-pos-mockup.html"
$deckHtml = Join-Path $presentationDir "mockups-deck.html"

Export-Screenshot $webDashboardHtml (Join-Path $outputDir "web-dashboard-mockup.png")
Export-Screenshot $webReportsHtml (Join-Path $outputDir "web-reports-mockup.png")
Export-Screenshot $mobilePosHtml (Join-Path $outputDir "mobile-pos-mockup.png")
Export-Screenshot $deckHtml (Join-Path $outputDir "deck-cover.png")
Export-Pdf $deckHtml (Join-Path $outputDir "vpos-mockups-deck.pdf")

Write-Host "[VPOS][MOCKUPS] Export complete."
Write-Host "[VPOS][MOCKUPS] Output folder: $outputDir"
