# Desktop OTA Deploy

This guide publishes `VPOS Desktop` OTA update files to the existing `vmjamtech.com` VPS.

It assumes the current production setup already exists:

- Caddy serves `https://vmjamtech.com`
- `/api/*` proxies to the API
- all other app traffic proxies to the web frontend

Desktop OTA needs 2 hosted files:

- `latest.json`
- the signed updater ZIP bundle for the desktop release

## OTA files produced locally

After running the desktop OTA build flow, the files are here:

- manifest:
  - [latest.json](d:/vpos/apps/desktop/release/ota/latest.json)
- updater bundle:
  - [VPOS Desktop_0.1.1_x64_en-US.msi.zip](d:/vpos/apps/desktop/release/ota/0.1.1/VPOS%20Desktop_0.1.1_x64_en-US.msi.zip)
- updater signature:
  - [VPOS Desktop_0.1.1_x64_en-US.msi.zip.sig](d:/vpos/apps/desktop/release/ota/0.1.1/VPOS%20Desktop_0.1.1_x64_en-US.msi.zip.sig)

The app currently checks:

- `https://vmjamtech.com/desktop-updates/latest.json`

## 1) Prepare VPS directory

SSH into the VPS and create the OTA directory:

```bash
sudo mkdir -p /var/www/vpos-desktop-updates/0.1.1
sudo chown -R $USER:$USER /var/www/vpos-desktop-updates
```

## 2) Upload OTA files from local machine

Run from your local machine:

```powershell
scp "d:\vpos\apps\desktop\release\ota\latest.json" root@vmjamtech.com:/var/www/vpos-desktop-updates/latest.json
scp "d:\vpos\apps\desktop\release\ota\0.1.1\VPOS Desktop_0.1.1_x64_en-US.msi.zip" root@vmjamtech.com:"/var/www/vpos-desktop-updates/0.1.1/VPOS Desktop_0.1.1_x64_en-US.msi.zip"
scp "d:\vpos\apps\desktop\release\ota\0.1.1\VPOS Desktop_0.1.1_x64_en-US.msi.zip.sig" root@vmjamtech.com:"/var/www/vpos-desktop-updates/0.1.1/VPOS Desktop_0.1.1_x64_en-US.msi.zip.sig"
```

If your VPS user is not `root`, replace `root@vmjamtech.com` with your actual SSH user.

## 3) Update Caddy config

Edit `/etc/caddy/Caddyfile` and add the OTA static file handler before the main web `handle`.

Use this structure:

```caddy
vmjamtech.com, www.vmjamtech.com {
  encode zstd gzip

  handle_path /api/* {
    reverse_proxy 127.0.0.1:3101
  }

  handle_path /desktop-updates/* {
    root * /var/www/vpos-desktop-updates
    file_server
  }

  handle {
    reverse_proxy 127.0.0.1:3100
  }
}
```

Reload Caddy:

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
```

## 4) Verify OTA files on VPS

Run on the VPS:

```bash
ls -lah /var/www/vpos-desktop-updates
ls -lah /var/www/vpos-desktop-updates/0.1.1
curl -I https://vmjamtech.com/desktop-updates/latest.json
curl -I "https://vmjamtech.com/desktop-updates/0.1.1/VPOS%20Desktop_0.1.1_x64_en-US.msi.zip"
```

Expected:

- HTTP `200`
- `latest.json` loads
- updater ZIP loads

## 5) Release next OTA version

For the next version:

1. bump desktop version
2. build OTA bundle
3. regenerate `latest.json`
4. upload the new version folder + updated manifest

Example local commands:

```powershell
$env:TAURI_PRIVATE_KEY="C:\Secure\TauriUpdater\vpos-desktop-updater.key"
$env:TAURI_KEY_PASSWORD="<YOUR-PRIVATE-KEY-PASSWORD>"
$env:VPOS_UPDATE_BASE_URL="https://vmjamtech.com/desktop-updates"

cd d:\vpos
pnpm --filter @vpos/desktop tauri:build:ota
pnpm --filter @vpos/desktop ota:manifest -- --notes "VPOS Desktop next OTA release."
```

Recommended production command after the update release tooling is installed:

```powershell
cd d:\vpos
$env:TAURI_PRIVATE_KEY="C:\Secure\TauriUpdater\vpos-desktop-updater.key"
$env:TAURI_KEY_PASSWORD="<YOUR-PRIVATE-KEY-PASSWORD>"
pnpm desktop:version -- 0.1.3
git add apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/Cargo.toml
git commit -m "Release VPOS Desktop 0.1.3"
git push origin main
pnpm desktop:release -- -Version 0.1.3 -Notes "Inventory and stability improvements"
```

Review the output first. Publish only after testing the generated installer:

```powershell
pnpm desktop:release -- -Version 0.1.3 -Notes "Inventory and stability improvements" -Publish
```

Then upload:

- updated `latest.json`
- new version directory contents

## 6) Notes

- Keep the updater private key only on the build machine:
  - `C:\Secure\TauriUpdater\vpos-desktop-updater.key`
- Do not upload the private key to the VPS.
- The `.sig` file is useful for release inspection, but the app reads the signature from `latest.json`.
- The ZIP URL in `latest.json` must match what is publicly hosted.
