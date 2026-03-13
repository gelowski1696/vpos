# VPOS Production Deploy (GitHub -> Ubuntu VPS -> Docker + Caddy)

This guide deploys:
- `web` on `127.0.0.1:3100`
- `api` on `127.0.0.1:3101`
- `postgres` in Docker volume
- Caddy serves `https://vmjamtech.com` and proxies `/api/*` to API

## 1) Push code to GitHub

From local repo:

```bash
git add .
git commit -m "chore: production docker deploy setup"
git push origin main
```

## 2) DNS (Hostinger)

Create/verify A records:
- `@` -> `168.231.103.231`
- `www` -> `168.231.103.231` (optional)

Wait for DNS to propagate.

## 3) Prepare VPS

Install Docker + Compose plugin if missing.

```bash
docker --version
docker compose version
```

Clone repo:

```bash
sudo mkdir -p /opt
cd /opt
sudo git clone https://github.com/gelowski1696/vpos.git
sudo chown -R $USER:$USER /opt/vpos
cd /opt/vpos
```

## 4) Create production env files

Do not commit secrets. Keep real values only on VPS.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Edit `apps/api/.env` (minimum required for production):

- `DATABASE_URL` can remain; compose overrides it to Docker postgres.
- set strong `JWT_ACCESS_SECRET`
- set strong `JWT_REFRESH_SECRET`
- set `CORS_ORIGINS=https://vmjamtech.com,https://www.vmjamtech.com`
- set your SubMan values (`SUBMAN_BASE_URL`, `SUBMAN_CLIENT_ID`, `SUBMAN_API_KEY` or `SUBMAN_BEARER_TOKEN`)
- set `VPOS_DATASTORE_ENCRYPTION_KEY` to a strong random value

Edit `apps/web/.env`:

```env
NEXT_PUBLIC_API_URL=https://vmjamtech.com/api
NEXT_PUBLIC_CLIENT_ID=DEMO
```

## 5) Build and run production stack

```bash
cd /opt/vpos
docker compose -f infra/compose/docker-compose.prod.yml up -d --build
```

Check:

```bash
docker ps
docker logs -f vpos-prod-api
docker logs -f vpos-prod-web
```

## 6) Initialize/reset database (optional)

For owner-only baseline:

```bash
docker exec -it vpos-prod-api pnpm --filter @vpos/api db:reset:owner-only
```

For full fresh seed:

```bash
docker exec -it vpos-prod-api pnpm --filter @vpos/api db:reset:fresh
```

## 7) Configure Caddy

Add to your Caddyfile:

```caddy
vmjamtech.com, www.vmjamtech.com {
  encode zstd gzip

  handle_path /api/* {
    reverse_proxy 127.0.0.1:3101
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

## 8) Firewall

Open only:
- `22` (SSH)
- `80` (HTTP)
- `443` (HTTPS)

Do not expose `3100`/`3101` publicly.

## 9) Update deployment after new push

```bash
cd /opt/vpos
git pull origin main
docker compose -f infra/compose/docker-compose.prod.yml up -d --build
```

## 10) Useful commands

Restart stack:

```bash
docker compose -f infra/compose/docker-compose.prod.yml restart
```

Stop stack:

```bash
docker compose -f infra/compose/docker-compose.prod.yml down
```

Stop stack + delete DB volume (danger, wipes data):

```bash
docker compose -f infra/compose/docker-compose.prod.yml down -v
```
