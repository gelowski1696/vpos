# Docker Local Setup (New PC)

## A) Create Transfer ZIP (on source PC)
Run this from repo root (`D:\vpos`):

```bat
scripts\create-transfer-zip.bat
```

It creates:
- `dist\transfer\vpos-transfer.zip`

Packaging rules:
- excludes all `node_modules`
- excludes `apps/mobile`
- excludes `.git`
- excludes `.env` files

## Prerequisites
- Install Docker Desktop (with Docker Compose plugin).
- Open terminal at repo root: `D:\vpos`.

## B) Setup On New PC (Docker: Postgres + API + Web)
1. Copy and extract `vpos-transfer.zip` to a folder (example `D:\vpos`).
2. Open terminal in extracted folder.
3. Run:

```bat
scripts\docker-setup-fresh.bat
```

What it does:
1. Starts PostgreSQL container.
2. Waits until DB health is `healthy`.
3. Builds API + Web images.
4. Runs `db:reset:fresh` inside API container.
5. Starts API + Web containers.

### Owner-Only Baseline (No Tenants)
If you want clean owner-only setup (no tenant companies), run:

```bat
scripts\docker-setup-owner-only.bat
```

or via pnpm:

```bat
pnpm docker:setup:owner-only
```

This performs fresh reset then deletes all dedicated tenants, keeping only platform owner/control-plane.

## Endpoints
- Web URL: `http://localhost:3000`
- API base URL: `http://localhost:3001/api`
- PostgreSQL: `localhost:5432`
  - user: `vpos`
  - password: `vpos`
  - db: `vpos`

## Seed Login
- Platform owner: `owner@vpos.local`
- Password: `Owner@123`

## Docker Commands
- Owner-only reset (non-Docker local command):

```bat
pnpm db:reset:owner-only
```

- Start services:

```bat
docker compose -f infra/compose/docker-compose.yml up -d postgres api web
```

- Stop services:

```bat
docker compose -f infra/compose/docker-compose.yml down
```

- Stop services + remove DB data:

```bat
docker compose -f infra/compose/docker-compose.yml down -v
```
