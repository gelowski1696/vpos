param(
  [string]$Root = "",
  [int]$DelayMs = 900
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $Root = (Resolve-Path $Root).Path
}

$outDir = Join-Path $Root "docs\presentation\live\mobile-guided"
if (!(Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

function Ensure-AdbDevice {
  $devices = adb devices | Out-String
  if ($devices -notmatch "(?m)^\S+\s+device\s*$") {
    throw "No adb device connected."
  }
}

function Get-ScreenSize {
  $raw = adb shell wm size | Out-String
  $match = [regex]::Match($raw, "Physical size:\s*(\d+)x(\d+)")
  if (!$match.Success) {
    return @{ Width = 1080; Height = 1920 }
  }
  return @{
    Width = [int]$match.Groups[1].Value
    Height = [int]$match.Groups[2].Value
  }
}

function Capture-Screen([string]$name) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $file = Join-Path $outDir ("$timestamp-$name.png")
  cmd /c "adb exec-out screencap -p > `"$file`""
  return $file
}

function Tap-Coord([int]$x, [int]$y) {
  adb shell input tap $x $y | Out-Null
  Start-Sleep -Milliseconds $DelayMs
}

function Parse-BoundsCenter([string]$bounds) {
  $match = [regex]::Match($bounds, "\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
  if (!$match.Success) {
    return $null
  }
  $x1 = [int]$match.Groups[1].Value
  $y1 = [int]$match.Groups[2].Value
  $x2 = [int]$match.Groups[3].Value
  $y2 = [int]$match.Groups[4].Value
  return @{
    X = [int](($x1 + $x2) / 2)
    Y = [int](($y1 + $y2) / 2)
  }
}

function Get-UiNodes {
  $tempDump = Join-Path $env:TEMP "vpos-ui-dump.xml"
  adb shell uiautomator dump /sdcard/vpos-ui-dump.xml | Out-Null
  adb pull /sdcard/vpos-ui-dump.xml $tempDump | Out-Null
  [xml]$xml = Get-Content $tempDump -Raw
  return $xml.SelectNodes("//node")
}

function Find-NodeByLabels([string[]]$labels) {
  $nodes = Get-UiNodes
  if (!$nodes) {
    return $null
  }

  foreach ($label in $labels) {
    $needle = $label.Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($needle)) {
      continue
    }

    $exact = $nodes | Where-Object {
      $text = ($_."text" | Out-String).Trim().ToLowerInvariant()
      $desc = ($_."content-desc" | Out-String).Trim().ToLowerInvariant()
      $text -eq $needle -or $desc -eq $needle
    } | Select-Object -First 1
    if ($exact) {
      return $exact
    }
  }

  foreach ($label in $labels) {
    $needle = $label.Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($needle)) {
      continue
    }

    $contains = $nodes | Where-Object {
      $text = ($_."text" | Out-String).Trim().ToLowerInvariant()
      $desc = ($_."content-desc" | Out-String).Trim().ToLowerInvariant()
      ($text -like "*$needle*") -or ($desc -like "*$needle*")
    } | Select-Object -First 1
    if ($contains) {
      return $contains
    }
  }

  return $null
}

function Tap-ByLabels([string[]]$labels) {
  $node = Find-NodeByLabels -labels $labels
  if (!$node) {
    return $false
  }
  $center = Parse-BoundsCenter -bounds $node.bounds
  if (!$center) {
    return $false
  }
  adb shell input tap $center.X $center.Y | Out-Null
  Start-Sleep -Milliseconds $DelayMs
  return $true
}

function Swipe-OpenLeftMenu {
  $size = Get-ScreenSize
  $x1 = [int]($size.Width * 0.03)
  $x2 = [int]($size.Width * 0.72)
  $y = [int]($size.Height * 0.45)
  adb shell input swipe $x1 $y $x2 $y 240 | Out-Null
  Start-Sleep -Milliseconds $DelayMs
}

function Open-SideMenu {
  $size = Get-ScreenSize
  # Try common hamburger hotspot first.
  Tap-Coord -x ([int]($size.Width * 0.06)) -y ([int]($size.Height * 0.055))
  $opened = Tap-ByLabels -labels @("Close navigation menu", "Menu", "Navigation")
  if ($opened) {
    # It tapped something interactive, open again explicitly
    Tap-Coord -x ([int]($size.Width * 0.06)) -y ([int]($size.Height * 0.055))
  }
  Swipe-OpenLeftMenu
}

function Tap-BottomTab([int]$index, [int]$count) {
  $size = Get-ScreenSize
  if ($count -le 0) {
    return
  }
  $x = [int](($size.Width / $count) * ($index + 0.5))
  $y = [int]($size.Height * 0.955)
  Tap-Coord -x $x -y $y
}

function Scroll-DrawerDown {
  $size = Get-ScreenSize
  $x = [int]($size.Width * 0.18)
  $y1 = [int]($size.Height * 0.80)
  $y2 = [int]($size.Height * 0.34)
  adb shell input swipe $x $y1 $x $y2 220 | Out-Null
  Start-Sleep -Milliseconds $DelayMs
}

function Tap-SideMenuItem([string]$name, [string[]]$labels) {
  $found = $false
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    $found = Tap-ByLabels -labels $labels
    if ($found) {
      Start-Sleep -Milliseconds $DelayMs
      return $true
    }
    Scroll-DrawerDown
  }
  return $false
}

Ensure-AdbDevice

Write-Host "[VPOS][MOBILE][GUIDED] Starting guided capture..."
Write-Host "[VPOS][MOBILE][GUIDED] Output: $outDir"

$captured = @()

# 1) Current screen
$captured += Capture-Screen -name "00-current"

# 2) Tab captures (with bottom-tab coordinate fallback for reliability)
$tabSteps = @(
  @{ Name = "01-tab-home"; Labels = @("HOME", "DASHBOARD", "Overview"); TabIndex = 0 },
  @{ Name = "02-tab-pos"; Labels = @("POS"); TabIndex = 1 },
  @{ Name = "03-tab-sales-history"; Labels = @("SALES", "Sales History"); TabIndex = 2 },
  @{ Name = "04-tab-transfer-create"; Labels = @("TRANSFER", "Transfer Create"); TabIndex = 3 },
  @{ Name = "05-tab-transfers-history"; Labels = @("TRANSFERS", "Transfers History"); TabIndex = 4 }
)

foreach ($step in $tabSteps) {
  $ok = Tap-ByLabels -labels $step.Labels
  if (-not $ok) {
    Tap-BottomTab -index $step.TabIndex -count 5
    $ok = $true
  }
  $suffix = if ($ok) { "ok" } else { "notfound" }
  $captured += Capture-Screen -name "$($step.Name)-$suffix"
}

# 3) Side menu captures
Open-SideMenu
$captured += Capture-Screen -name "06-side-menu-open"

$menuSteps = @(
  @{ Name = "07-menu-shift"; Labels = @("Shift", "Duty") },
  @{ Name = "08-menu-expense"; Labels = @("Expense", "Petty Cash") },
  @{ Name = "09-menu-items"; Labels = @("Items", "Item Viewing", "Products") },
  @{ Name = "10-menu-customers"; Labels = @("Customers", "Customer Viewing") },
  @{ Name = "11-menu-settings"; Labels = @("Settings") },
  @{ Name = "12-menu-sync-now"; Labels = @("Sync Now", "Sync") },
  @{ Name = "13-menu-download-branch-data"; Labels = @("Download Branch Data", "Download Data") }
)

foreach ($step in $menuSteps) {
  Open-SideMenu
  $ok = Tap-SideMenuItem -name $step.Name -labels $step.Labels
  $suffix = if ($ok) { "ok" } else { "notfound" }
  $captured += Capture-Screen -name "$($step.Name)-$suffix"
}

$reportPath = Join-Path $outDir "guided-capture-report.txt"
$report = @(
  "Guided capture generated at: $(Get-Date -Format s)",
  "Files:"
) + ($captured | ForEach-Object { " - $(Split-Path $_ -Leaf)" })

Set-Content -Path $reportPath -Value $report -Encoding UTF8

Write-Host "[VPOS][MOBILE][GUIDED] Done."
Write-Host "[VPOS][MOBILE][GUIDED] Report: $reportPath"
