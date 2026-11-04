# Desktop Signing

Use the normal unsigned MSI build:

```powershell
cd d:\vpos
pnpm --filter @vpos/desktop tauri:build
```

Use the signed MSI build after setting certificate environment variables:

```powershell
cd d:\vpos
$env:VPOS_SIGN_CERT_SHA1="YOUR_CERT_SHA1"
$env:VPOS_SIGN_TIMESTAMP_URL="http://timestamp.digicert.com"
pnpm --filter @vpos/desktop tauri:build:signed
```

Or with a PFX:

```powershell
cd d:\vpos
$env:VPOS_SIGN_PFX_PATH="C:\path\to\certificate.pfx"
$env:VPOS_SIGN_PFX_PASSWORD="YOUR_PASSWORD"
$env:VPOS_SIGN_TIMESTAMP_URL="http://timestamp.digicert.com"
pnpm --filter @vpos/desktop tauri:build:signed
```

Notes:

- `tauri:build:signed` uses [tauri.sign.conf.json](d:/vpos/apps/desktop/src-tauri/tauri.sign.conf.json)
- the signing command is [sign-desktop.ps1](d:/vpos/apps/desktop/scripts/sign-desktop.ps1)
- `signtool.exe` must be available from the Windows SDK or on `PATH`
- signing reduces Windows warnings, but SmartScreen reputation also depends on certificate reputation over time
