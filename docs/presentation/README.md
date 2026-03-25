# VPOS Mockups and Presentation Export

This folder includes ready-to-present mockup pages for:
- Web Dashboard
- Web Reports
- Mobile POS
- Combined deck (multi-slide HTML)

## Export PNG + PDF

From repo root (`d:\vpos`):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-mockups.ps1
```

Output files:
- `docs/presentation/output/web-dashboard-mockup.png`
- `docs/presentation/output/web-reports-mockup.png`
- `docs/presentation/output/mobile-pos-mockup.png`
- `docs/presentation/output/deck-cover.png`
- `docs/presentation/output/vpos-mockups-deck.pdf`

## Live capture pack (web + current mobile screen via ADB)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\capture-live-presentation.ps1 -BaseUrl "https://vmjamtech.com"
```

Live output files:
- `docs/presentation/live/web-landing-live.png`
- `docs/presentation/live/web-login-live.png`
- `docs/presentation/live/mobile-live-current.png`
- `docs/presentation/live/vpos-live-captures-deck.pdf`

## Capture multiple mobile screens while navigating

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\capture-mobile-sequence.ps1 -Count 10 -IntervalSeconds 4
```

Output folder:
- `docs/presentation/live/mobile-sequence`

## Optional: use Edge path explicitly

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-mockups.ps1 -ChromePath "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
```
