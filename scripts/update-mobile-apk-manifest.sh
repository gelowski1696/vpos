#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/apps/api/.env"
COMPOSE_FILE="$ROOT_DIR/infra/compose/docker-compose.prod.yml"
DEFAULT_APK_BASE_URL="https://vmjamtech.com/mobile-updates/android"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/update-mobile-apk-manifest.sh --version <semver> [options]

Required:
  --version <semver>           Latest Android version to publish, e.g. 0.1.1

Optional:
  --min-supported <semver>     Minimum supported Android version. Default: same as --version
  --required <true|false>      Whether the update is required. Default: false
  --notes "<text>"             Release notes. Default: Mobile APK release <version>
  --published-at <iso8601>     Published timestamp. Default: current UTC time
  --apk-url <url>              Full APK URL. Default: https://vmjamtech.com/mobile-updates/android/vpos-mobile-<version>.apk
  --skip-restart               Update .env only, do not recreate the API container

Examples:
  bash scripts/update-mobile-apk-manifest.sh --version 0.1.1 --min-supported 0.1.0 --required false --notes "Optional update test"
  bash scripts/update-mobile-apk-manifest.sh --version 0.1.1 --required true --notes "Required update test"
EOF
}

VERSION=""
MIN_SUPPORTED=""
REQUIRED="false"
NOTES=""
PUBLISHED_AT=""
APK_URL=""
SKIP_RESTART="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --min-supported)
      MIN_SUPPORTED="${2:-}"
      shift 2
      ;;
    --required)
      REQUIRED="${2:-}"
      shift 2
      ;;
    --notes)
      NOTES="${2:-}"
      shift 2
      ;;
    --published-at)
      PUBLISHED_AT="${2:-}"
      shift 2
      ;;
    --apk-url)
      APK_URL="${2:-}"
      shift 2
      ;;
    --skip-restart)
      SKIP_RESTART="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "Missing required --version argument." >&2
  usage
  exit 1
fi

if [[ -z "$MIN_SUPPORTED" ]]; then
  MIN_SUPPORTED="$VERSION"
fi

if [[ -z "$NOTES" ]]; then
  NOTES="Mobile APK release $VERSION"
fi

if [[ -z "$PUBLISHED_AT" ]]; then
  PUBLISHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"
fi

if [[ -z "$APK_URL" ]]; then
  APK_URL="$DEFAULT_APK_BASE_URL/vpos-mobile-$VERSION.apk"
fi

mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"

export ENV_FILE VERSION MIN_SUPPORTED REQUIRED NOTES PUBLISHED_AT APK_URL

python3 <<'PY'
import os
from pathlib import Path

env_path = Path(os.environ["ENV_FILE"])
updates = {
    "MOBILE_ANDROID_LATEST_VERSION": os.environ["VERSION"],
    "MOBILE_ANDROID_MIN_SUPPORTED_VERSION": os.environ["MIN_SUPPORTED"],
    "MOBILE_ANDROID_REQUIRED": os.environ["REQUIRED"],
    "MOBILE_ANDROID_APK_URL": os.environ["APK_URL"],
    "MOBILE_ANDROID_NOTES": os.environ["NOTES"],
    "MOBILE_ANDROID_PUBLISHED_AT": os.environ["PUBLISHED_AT"],
}

existing_lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
filtered_lines = []
for line in existing_lines:
    if any(line.startswith(f"{key}=") for key in updates):
        continue
    filtered_lines.append(line)

if filtered_lines and filtered_lines[-1].strip():
    filtered_lines.append("")

for key, value in updates.items():
    filtered_lines.append(f"{key}={value}")

env_path.write_text("\n".join(filtered_lines) + "\n", encoding="utf-8")
PY

echo "Updated $ENV_FILE:"
grep '^MOBILE_ANDROID_' "$ENV_FILE" || true

echo
echo "Checking APK URL:"
curl -I "$APK_URL" || true

if [[ "$SKIP_RESTART" == "true" ]]; then
  echo
  echo "Skipping API restart because --skip-restart was provided."
  exit 0
fi

echo
echo "Recreating API container..."
docker compose -f "$COMPOSE_FILE" up -d --force-recreate api

echo
echo "Live manifest:"
curl "https://vmjamtech.com/api/mobile-updates/latest"
echo
