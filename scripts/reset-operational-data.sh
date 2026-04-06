#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

docker compose -f infra/compose/docker-compose.prod.yml run --rm api node apps/api/scripts/reset-operational-data.mjs "$@"
