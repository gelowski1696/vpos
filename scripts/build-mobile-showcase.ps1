param(
  [string]$SourceImage = "",
  [string]$Title = "VPOS Mobile Overview",
  [string]$Subtitle = "Modern cashier-friendly interface",
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

$showcaseDir = Join-Path $Root "docs\presentation\live\mobile-guided"
if (!(Test-Path $showcaseDir)) {
  New-Item -ItemType Directory -Path $showcaseDir | Out-Null
}

if ([string]::IsNullOrWhiteSpace($SourceImage)) {
  $candidate = Get-ChildItem -Path $showcaseDir -Filter "*01-tab-home*.png" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $candidate) {
    $candidate = Get-ChildItem -Path $showcaseDir -Filter "*.png" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  }
  if (-not $candidate) {
    throw "No source mobile image found in $showcaseDir"
  }
  $SourceImage = $candidate.FullName
} else {
  $SourceImage = (Resolve-Path $SourceImage).Path
}

if (!(Test-Path $SourceImage)) {
  throw "Source image not found: $SourceImage"
}

$htmlPath = Join-Path $showcaseDir "mobile-showcase.html"
$pngPath = Join-Path $showcaseDir "mobile-showcase.png"
$pdfPath = Join-Path $showcaseDir "mobile-showcase.pdf"

$baseUri = New-Object System.Uri(($showcaseDir.TrimEnd('\') + '\'))
$fileUri = New-Object System.Uri($SourceImage)
$relativeImage = $baseUri.MakeRelativeUri($fileUri).ToString()

$html = @"
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mobile Showcase</title>
    <style>
      :root {
        --bg: #0c1118;
        --panel: #131b27;
        --text: #e9f0f8;
        --muted: #a9b8ca;
        --accent: #5ca9ff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        background: radial-gradient(circle at 20% 10%, #1a2433 0%, var(--bg) 58%);
        color: var(--text);
      }
      .wrap {
        width: 1366px;
        height: 768px;
        margin: 0 auto;
        padding: 28px 32px;
        display: grid;
        grid-template-columns: 430px 1fr;
        gap: 36px;
        align-items: center;
      }
      .phone-shell {
        width: 390px;
        margin: 0 auto;
        border-radius: 48px;
        padding: 14px;
        background: linear-gradient(160deg, #222a36, #090d14);
        box-shadow: 0 28px 60px rgba(0, 0, 0, 0.48), inset 0 0 0 1px rgba(255,255,255,0.08);
      }
      .phone-bezel {
        border-radius: 38px;
        background: #05080d;
        padding: 12px;
      }
      .screen {
        border-radius: 30px;
        overflow: hidden;
        background: #000;
      }
      .screen img {
        display: block;
        width: 100%;
      }
      .content {
        border: 1px solid rgba(92,169,255,0.28);
        background: linear-gradient(155deg, rgba(92,169,255,0.12), rgba(19,27,39,0.82));
        border-radius: 20px;
        padding: 28px;
      }
      .badge {
        display: inline-block;
        color: var(--accent);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        font-size: 11px;
        font-weight: 700;
        margin-bottom: 8px;
      }
      h1 {
        margin: 0;
        font-size: 34px;
        line-height: 1.15;
      }
      p {
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 16px;
        line-height: 1.5;
      }
      .kpis {
        margin-top: 18px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .kpi {
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 12px;
        padding: 10px 12px;
        background: rgba(0,0,0,0.18);
      }
      .kpi b {
        display: block;
        color: #ffffff;
        font-size: 13px;
      }
      .kpi span {
        color: var(--muted);
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="phone-shell">
        <div class="phone-bezel">
          <div class="screen">
            <img src="./$relativeImage" alt="VPOS Mobile Screen" />
          </div>
        </div>
      </section>
      <section class="content">
        <span class="badge">VPOS MOBILE EXPERIENCE</span>
        <h1>$Title</h1>
        <p>$Subtitle</p>
        <div class="kpis">
          <div class="kpi"><b>Cashier-ready UX</b><span>Simple navigation and fast actions</span></div>
          <div class="kpi"><b>Offline-first</b><span>Queue and sync when network returns</span></div>
          <div class="kpi"><b>Operations visibility</b><span>Sales, transfers, and duty in one app</span></div>
          <div class="kpi"><b>Presentation-ready</b><span>Polished mobile app showcase</span></div>
        </div>
      </section>
    </main>
  </body>
</html>
"@

Set-Content -Path $htmlPath -Value $html -Encoding UTF8

$url = "file:///" + ($htmlPath -replace "\\", "/")
& $ChromePath --headless --disable-gpu --allow-file-access-from-files --window-size=1366,768 "--screenshot=$pngPath" "$url" | Out-Null
& $ChromePath --headless --disable-gpu --allow-file-access-from-files --no-pdf-header-footer "--print-to-pdf=$pdfPath" "$url" | Out-Null

Write-Host "[VPOS][MOBILE][SHOWCASE] Source image: $SourceImage"
Write-Host "[VPOS][MOBILE][SHOWCASE] HTML: $htmlPath"
Write-Host "[VPOS][MOBILE][SHOWCASE] PNG:  $pngPath"
Write-Host "[VPOS][MOBILE][SHOWCASE] PDF:  $pdfPath"
