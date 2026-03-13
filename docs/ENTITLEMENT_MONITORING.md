# VPOS Entitlement Monitoring and Alerts (Task 6.3)

## Goal
- Detect entitlement integration failures early.
- Alert when tenant entitlement cache is stale.

## Health Command
```powershell
pnpm ops:entitlements:health
```

Equivalent API package command:
```powershell
pnpm --filter @vpos/api ops:entitlements:health -- --strict
```

Script:
- `apps/api/scripts/entitlement-sync-health.mjs`

## What It Checks
- Stale entitlement cache:
  - `CompanyEntitlement.lastSyncedAt` older than threshold.
- Integration failures:
  - recent `AuditLog` actions:
    - `PLATFORM_ENTITLEMENT_SYNC_FAILED`
    - `PLATFORM_ENTITLEMENT_WEBHOOK_FAILED`

## Thresholds
- `OPS_ENTITLEMENT_STALE_MINUTES` (default `120`)
- `OPS_ENTITLEMENT_SYNC_FAILURE_LOOKBACK_MINUTES` (default `60`)
- `OPS_ENTITLEMENT_SYNC_FAILURE_THRESHOLD` (default `1`)

CLI overrides:
```powershell
pnpm --filter @vpos/api ops:entitlements:health -- --strict --stale-minutes 90 --failure-lookback-minutes 30 --failure-threshold 1
```

## CI / Scheduled Alerts
- Wired into `.github/workflows/ops-maintenance.yml`:
  - `security-checklist` job
  - `entitlement-sync-health` job
- Strict mode exits non-zero when:
  - stale entitlement rows exist, or
  - recent sync failures reach threshold.

## Incident Triage
1. Check failing tenants from health output.
2. Run manual sync:
```powershell
POST /api/platform/entitlements/sync
```
3. Verify SubMan connectivity/credentials (`SUBMAN_*` env values).
4. Review webhook traffic and signature secrets.
5. If needed, apply owner override while incident is ongoing.
