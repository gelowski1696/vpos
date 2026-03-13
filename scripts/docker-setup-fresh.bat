@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."

set "COMPOSE_FILE=infra\compose\docker-compose.yml"
set "MAX_RETRIES=60"

where docker >nul 2>nul
if errorlevel 1 (
  echo [VPOS][DOCKER] Docker CLI not found. Install Docker Desktop first.
  exit /b 1
)

docker compose version >nul 2>nul
if errorlevel 1 (
  echo [VPOS][DOCKER] Docker Compose plugin not found. Update Docker Desktop.
  exit /b 1
)

if not exist "apps\api\.env" (
  if exist "apps\api\.env.example" (
    copy /Y "apps\api\.env.example" "apps\api\.env" >nul
    echo [VPOS][DOCKER] Created apps\api\.env from .env.example.
  ) else (
    echo [VPOS][DOCKER] Missing apps\api\.env and apps\api\.env.example.
    exit /b 1
  )
)

echo [VPOS][DOCKER] Step 1/6: Starting PostgreSQL...
docker compose -f "%COMPOSE_FILE%" up -d postgres
if errorlevel 1 goto :fail

echo [VPOS][DOCKER] Step 2/6: Waiting for PostgreSQL health...
docker compose -f "%COMPOSE_FILE%" up -d --wait --wait-timeout 120 postgres >nul 2>nul
if errorlevel 1 (
  echo [VPOS][DOCKER] compose --wait not available or failed. Falling back to manual health probe...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ok=$false; for($i=0;$i -lt %MAX_RETRIES%;$i++){ try { $s = docker inspect --format='{{.State.Health.Status}}' vpos-postgres 2>$null; if($s -eq 'healthy'){ $ok=$true; break } } catch {}; Start-Sleep -Seconds 2 }; if($ok){ exit 0 } else { exit 1 }"
  if errorlevel 1 (
    echo [VPOS][DOCKER] PostgreSQL did not become healthy in time.
    goto :fail
  )
)

echo [VPOS][DOCKER] Step 3/6: Building API + Web images...
docker compose -f "%COMPOSE_FILE%" build api web
if errorlevel 1 goto :fail

echo [VPOS][DOCKER] Step 4/6: Running db:reset:fresh...
docker compose -f "%COMPOSE_FILE%" run --rm api pnpm --filter @vpos/api db:reset:fresh
if errorlevel 1 goto :fail

echo [VPOS][DOCKER] Step 5/6: Starting API + Web containers...
docker compose -f "%COMPOSE_FILE%" up -d api web
if errorlevel 1 goto :fail

echo [VPOS][DOCKER] Step 6/6: Validating containers...
docker compose -f "%COMPOSE_FILE%" ps

echo.
echo [VPOS][DOCKER] Ready:
echo   Web: http://localhost:3000
echo   API: http://localhost:3001/api
echo   Postgres: localhost:5432 (user=vpos, password=vpos, db=vpos)
echo.
echo [VPOS][DOCKER] Seed owner login: owner@vpos.local / Owner@123
popd
exit /b 0

:fail
echo [VPOS][DOCKER] Setup failed.
popd
exit /b 1
