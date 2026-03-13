#!/usr/bin/env bash
set -euo pipefail

# VPS convenience wrapper: owner-only setup using production compose.
# Usage:
#   bash scripts/docker-setup-owner-only-vps.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

export COMPOSE_FILE="infra/compose/docker-compose.prod.yml"
export PG_CONTAINER="vpos-prod-postgres"

bash "${SCRIPT_DIR}/docker-setup-owner-only.sh"
