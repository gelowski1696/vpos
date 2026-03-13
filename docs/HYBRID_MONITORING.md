# VPOS Hybrid Tenancy Monitoring (Task 7.5 Start)

## Objective
- Add tenant-mode aware monitoring for mixed fleet (`SHARED_DB` + `DEDICATED_DB`).
- Detect dedicated datastore drift/outage early and fail closed for strict checks.

## API Health Endpoint
- Endpoint: `GET /api/platform/owner/tenants/datastore-health`
- Auth: `platform_owner`
- Optional query:
  - `strict=true|1|yes`
    - Returns `503` when one or more dedicated tenants are unhealthy.

Response shape:
- `checked_at`
- `strict`
- `totals`:
  - `total`
  - `healthy`
  - `unhealthy`
  - `skipped`
  - `dedicated_unhealthy`
- `tenants[]`:
  - `company_id`
  - `client_id`
  - `tenancy_mode`
  - `datastore_ref`
  - `datastore_migration_state`
  - `health` (`HEALTHY|UNHEALTHY|SKIPPED`)
  - `latency_ms`
  - `error`

## Ops Script (DB-side)
- Script: `apps/api/scripts/hybrid-datastore-health.mjs`
- Command:
```powershell
pnpm ops:hybrid:health
```
- Strict mode (non-zero exit if any unhealthy dedicated tenant):
```powershell
pnpm --filter @vpos/api ops:hybrid:health -- --strict
```

Checks performed:
- Dedicated tenant has `datastore_ref`.
- Dedicated tenant mapping is discoverable via:
  - `TenantDatastoreRegistry`, or
  - `VPOS_DEDICATED_DB_URLS_JSON`, or
  - `VPOS_DEDICATED_DB_URL_<REF>`.
- Dedicated tenant migration state is `COMPLETED`.

## Scheduled Alert Job
- Workflow: `.github/workflows/ops-maintenance.yml`
- New job: `hybrid-datastore-health`
- Frequency: daily (same schedule as existing ops jobs).
- Fails workflow when strict check detects unhealthy dedicated tenants.

## Alert Recommendations
- Critical:
  - `dedicated_unhealthy > 0` in strict check.
  - API strict health endpoint returns `503`.
- Warning:
  - `datastore_migration_state != COMPLETED` for any dedicated tenant.
  - Missing datastore mapping for dedicated tenant.
- Attach to incident:
  - health output JSON
  - affected `client_id`/`datastore_ref`
  - recent provisioning/change audit logs
