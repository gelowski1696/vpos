# Mobile APK Deploy

## Goal

Host Android APK files on the VPS and expose a small version manifest through the API so the mobile app can detect optional or required native updates.

The current app build now supports:

- version policy check
- optional/required update prompt
- APK download
- Android installer handoff

Important:

- the Android app must be rebuilt after adding `REQUEST_INSTALL_PACKAGES`
- Android still requires user confirmation to finish installing the APK

## Public Paths

- API manifest:
  - `https://vmjamtech.com/api/mobile-updates/latest`
- APK hosting:
  - `https://vmjamtech.com/mobile-updates/android/...`

## Recommended APK Naming

- `vpos-mobile-0.1.0.apk`
- `vpos-mobile-0.1.1.apk`
- `vpos-mobile-0.1.2.apk`

## VPS Folder Layout

```bash
sudo mkdir -p /var/www/vpos-mobile-updates/android
sudo chown -R $USER:$USER /var/www/vpos-mobile-updates
```

## Caddy Route

Add this block before the main catch-all `handle` for the website in `/etc/caddy/Caddyfile`:

```caddy
handle_path /mobile-updates/* {
  root * /var/www/vpos-mobile-updates
  file_server
}
```

Example site block:

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

  handle_path /mobile-updates/* {
    root * /var/www/vpos-mobile-updates
    file_server
  }

  handle {
    reverse_proxy 127.0.0.1:3100
  }
}
```

Validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo caddy reload --config /etc/caddy/Caddyfile
```

## Upload APK

From the local machine:

```powershell
scp "d:\vpos\apps\mobile\android\app\build\outputs\apk\release\app-release.apk" root@vmjamtech.com:"/var/www/vpos-mobile-updates/android/vpos-mobile-0.1.0.apk"
```

If you rename the output locally first:

```powershell
Copy-Item "d:\vpos\apps\mobile\android\app\build\outputs\apk\release\app-release.apk" "d:\vpos\apps\mobile\android\app\build\outputs\apk\release\vpos-mobile-0.1.0.apk"
scp "d:\vpos\apps\mobile\android\app\build\outputs\apk\release\vpos-mobile-0.1.0.apk" root@vmjamtech.com:"/var/www/vpos-mobile-updates/android/vpos-mobile-0.1.0.apk"
```

## Build Requirement

Because the app now includes Android package-installer support, create a fresh Android build before testing hosted APK updates:

```powershell
cd d:\vpos\apps\mobile
pnpm android
```

or for your release flow:

```powershell
cd d:\vpos\apps\mobile
pnpm apk:release
```

## API Manifest Env Vars

Set these on the API host for the currently published Android build:

```env
MOBILE_ANDROID_LATEST_VERSION=0.1.0
MOBILE_ANDROID_MIN_SUPPORTED_VERSION=0.1.0
MOBILE_ANDROID_REQUIRED=false
MOBILE_ANDROID_APK_URL=https://vmjamtech.com/mobile-updates/android/vpos-mobile-0.1.0.apk
MOBILE_ANDROID_NOTES=Initial hosted APK release
MOBILE_ANDROID_PUBLISHED_AT=2026-04-03T12:00:00.000Z
```

## VPS Release Helper Script

To avoid manually editing `apps/api/.env` on every APK release, use:

```bash
bash scripts/update-mobile-apk-manifest.sh --version 0.1.1 --min-supported 0.1.0 --required false --notes "Optional update test"
```

What it does:

- updates `apps/api/.env`
- replaces existing `MOBILE_ANDROID_*` keys cleanly
- checks the APK URL
- recreates the production API container
- prints the live manifest response

For a required update:

```bash
bash scripts/update-mobile-apk-manifest.sh --version 0.1.1 --min-supported 0.1.1 --required true --notes "Required update test"
```

## API Endpoint Response

`GET /api/mobile-updates/latest`

Example:

```json
{
  "platform": "android",
  "enabled": true,
  "latestVersion": "0.1.0",
  "minimumSupportedVersion": "0.1.0",
  "required": false,
  "apkUrl": "https://vmjamtech.com/mobile-updates/android/vpos-mobile-0.1.0.apk",
  "notes": "Initial hosted APK release",
  "publishedAt": "2026-04-03T12:00:00.000Z"
}
```

## Verify

On the VPS:

```bash
curl -I "https://vmjamtech.com/mobile-updates/android/vpos-mobile-0.1.0.apk"
curl https://vmjamtech.com/api/mobile-updates/latest
```

You want:

- APK URL returns `HTTP 200`
- API manifest returns the latest version and APK URL you configured

## Mobile App Behavior In This Phase

The app can now:

- read installed app version
- call the version manifest endpoint
- determine:
  - up to date
  - optional update
  - required update
- download the latest APK
- open the Android installer
- open Android install settings if unknown-app installs are blocked

Still left for a later hardening pass:

- fully block unsupported versions before continuing into the app shell
- add retry/resume handling for interrupted downloads
