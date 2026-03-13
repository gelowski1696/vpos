#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

COMPOSE_FILE="${COMPOSE_FILE:-infra/compose/docker-compose.prod.yml}"
MAX_RETRIES="${MAX_RETRIES:-60}"
PG_CONTAINER="${PG_CONTAINER:-vpos-prod-postgres}"

log() {
  echo "[VPOS][DOCKER] $*"
}

if ! command -v docker >/dev/null 2>&1; then
  log "Docker CLI not found. Install Docker first."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  log "Docker Compose plugin not found."
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  log "Compose file not found: ${COMPOSE_FILE}"
  exit 1
fi

if [[ ! -f apps/api/.env ]]; then
  if [[ -f apps/api/.env.example ]]; then
    cp apps/api/.env.example apps/api/.env
    log "Created apps/api/.env from .env.example"
  else
    log "Missing apps/api/.env and apps/api/.env.example"
    exit 1
  fi
fi

if [[ ! -f apps/web/.env ]]; then
  if [[ -f apps/web/.env.example ]]; then
    cp apps/web/.env.example apps/web/.env
    log "Created apps/web/.env from .env.example"
  else
    log "Missing apps/web/.env and apps/web/.env.example"
    exit 1
  fi
fi

log "Step 1/6: Starting PostgreSQL..."
docker compose -f "${COMPOSE_FILE}" up -d postgres

log "Step 2/6: Waiting for PostgreSQL health..."
healthy="false"
for ((i = 1; i <= MAX_RETRIES; i++)); do
  status="$(docker inspect --format='{{.State.Health.Status}}' "${PG_CONTAINER}" 2>/dev/null || true)"
  if [[ "${status}" == "healthy" ]]; then
    healthy="true"
    break
  fi
  sleep 2
done
if [[ "${healthy}" != "true" ]]; then
  log "PostgreSQL did not become healthy in time (container=${PG_CONTAINER})."
  exit 1
fi

log "Step 3/6: Building API + Web images..."
docker compose -f "${COMPOSE_FILE}" build api web

log "Step 4/6: Running db:reset:owner-only..."
docker compose -f "${COMPOSE_FILE}" run --rm api pnpm --filter @vpos/api db:reset:owner-only

log "Step 5/6: Starting API + Web containers..."
docker compose -f "${COMPOSE_FILE}" up -d api web

log "Step 6/6: Validating containers..."
docker compose -f "${COMPOSE_FILE}" ps

echo
log "Ready (OWNER ONLY)"
if [[ "${COMPOSE_FILE}" == *"prod"* ]]; then
  echo "  Web: http://127.0.0.1:3100 (via Caddy domain)"
  echo "  API: http://127.0.0.1:3101/api (via Caddy /api)"
else
  echo "  Web: http://localhost:3000"
  echo "  API: http://localhost:3001/api"
fi
echo "  Seed owner login: owner@vpos.local / Owner@123"
echo "  Tenant companies: none (owner-only baseline)"
