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

$htmlPath = Join-Path $Root "docs\presentation\web-admin-casual-presentation.html"
$pdfPath = Join-Path $Root "docs\presentation\live\web-admin\vpos-web-admin-casual-presentation.pdf"

$url = "file:///" + ($htmlPath -replace "\\", "/")
& $ChromePath --headless --disable-gpu --allow-file-access-from-files --no-pdf-header-footer "--print-to-pdf=$pdfPath" "$url" | Out-Null

Write-Host "[VPOS][PRESENTATION] Casual PDF exported:"
Write-Host "  $pdfPath"
