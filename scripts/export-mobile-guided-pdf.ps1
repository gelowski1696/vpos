param(
  [string]$Root = "",
  [string]$ChromePath = ""
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

$captureDir = Join-Path $Root "docs\presentation\live\mobile-guided"
if (!(Test-Path $captureDir)) {
  throw "Capture directory not found: $captureDir"
}

$images = Get-ChildItem -Path $captureDir -Filter "*.png" | Sort-Object Name
if ($images.Count -eq 0) {
  throw "No PNG files found in $captureDir"
}

$presentationDir = Join-Path $Root "docs\presentation"
$htmlPath = Join-Path $presentationDir "mobile-guided-captures-deck.html"
$pdfPath = Join-Path $captureDir "vpos-mobile-guided-captures.pdf"

$cards = foreach ($img in $images) {
  $rel = "live/mobile-guided/$($img.Name)"
  @"
  <section class="card">
    <div class="meta">$($img.Name)</div>
    <img src="./$rel" alt="$($img.Name)" />
  </section>
"@
}

$html = @"
<!doctype html>
<html><head><meta charset="utf-8" />
<title>VPOS Mobile Guided Captures</title>
<style>
@page { size: A4 portrait; margin: 8mm; }
body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f4f6fb;color:#1f2937}
.wrap{padding:10px}
h1{margin:0 0 12px 0;font-size:28px}
.card{page-break-after:always;border:1px solid #d0d7e2;border-radius:10px;padding:10px;background:#fff}
.card img{width:100%;display:block;border-radius:8px}
.meta{font-size:12px;font-weight:600;color:#4b5563;margin-bottom:8px}
</style></head>
<body><div class="wrap">
  <h1>VPOS Mobile Guided Captures</h1>
  $($cards -join "`n")
</div></body></html>
"@

Set-Content -Path $htmlPath -Value $html -Encoding UTF8

$url = "file:///" + ($htmlPath -replace "\\", "/")
& $ChromePath --headless --disable-gpu --allow-file-access-from-files --no-pdf-header-footer "--print-to-pdf=$pdfPath" "$url" | Out-Null

Write-Host "[VPOS][MOBILE][GUIDED] PDF exported:"
Write-Host "  $pdfPath"
