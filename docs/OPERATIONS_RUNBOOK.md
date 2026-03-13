# VPOS Operations Runbook (Milestone 6.3 Start)

## Scope
- Retention controls for audit/event data.
- PostgreSQL backup and restore baseline.
- Staging verification checklist.
- Initial incident handling runbook.

## 1) Retention Controls

Target retention:
- Audit and operational event records: **7 years** minimum.
- Applies to:
  - `AuditLog`
  - `EventSales`
  - `EventStockMovement`
  - `EventDeliveryPerformance`
  - `EventUserBehavior`
  - `CompanyEntitlementEvent`
  - `SyncReview`

Script:
- Dry-run:
```powershell
pnpm ops:retention:dry-run
```
- Apply:
```powershell
pnpm ops:retention:apply
```
- Optional single-tenant run:
```powershell
pnpm --filter @vpos/api ops:retention:dry-run -- --company-id <company_uuid>
pnpm --filter @vpos/api ops:retention:apply -- --company-id <company_uuid>
```

Notes:
- Always run dry-run first and archive output JSON in ops logs.
- Run apply only during approved maintenance windows.

## 2) Backup Baseline

Script:
```powershell
pnpm ops:backup
```

Optional parameters:
```powershell
pnpm --filter @vpos/api ops:backup -- -DatabaseUrl "<postgres_url>" -OutputDir ".\\backups"
pnpm --filter @vpos/api ops:backup -- -SchemaOnly
pnpm --filter @vpos/api ops:backup -- -PgDumpPath "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe"
```

Backup policy baseline:
- Full logical backup: daily.
- Schema-only backup: before every production migration.
- Keep at least:
  - Daily backups for 30 days.
  - Monthly backups for 12 months.

## 3) Restore Drill (Staging)

1. Provision clean Postgres target DB.
2. Restore latest `.dump` using `pg_restore`.
3. Start API against restored DB.
4. Run smoke checks:
   - login
   - master data list endpoints
   - sale post
   - reports summary
5. Record RTO and issues in ops log.

Suggested command template:
```powershell
pg_restore --no-owner --no-privileges --clean --if-exists -d "<target_database_url>" ".\\backups\\<backup_file>.dump"
```

## 4) Incident Playbooks (Initial)

### API or DB degradation
1. Confirm app/API health endpoint and DB connectivity.
2. Pause non-critical maintenance jobs.
3. Capture latest logs and failing query samples.
4. If data-risk condition is detected, trigger immediate backup.
5. Escalate with:
   - impact window
   - affected tenants
   - last known good timestamp

### Retention job failure
1. Keep system online (retention is non-blocking).
2. Save dry-run output and error logs.
3. Re-run in dry mode with narrow scope (`--company-id`) for diagnosis.
4. Fix issue and retry in next maintenance window.

### Tenant provisioning failure (subscription -> tenant)
1. Check latest owner provisioning audit entries:
   - `PLATFORM_TENANT_PROVISION`
   - `PLATFORM_TENANT_PROVISION_FROM_SUBSCRIPTION`
2. Validate control-plane access (`SUBMAN_BASE_URL`, API key/token, client id).
3. Re-run provisioning for the same `client_id` (flow is idempotent).
4. If dedicated mode was selected, verify datastore health:
```powershell
pnpm ops:hybrid:health
```
5. Escalate with:
   - `client_id`
   - requested tenancy mode
   - failing step (gateway, migration, seeding, routing)

### Billing/subscription outage
1. Run entitlement health check:
```powershell
pnpm ops:entitlements:health
```
2. Confirm whether failures are gateway auth/network vs stale cache only.
3. If control-plane outage persists, keep platform in safe mode:
   - do not force-activate unknown tenants
   - use owner override only with explicit incident record.
4. Recover by re-running tenant sync:
```powershell
POST /api/platform/entitlements/sync
```

### Webhook backlog / webhook delivery incident
1. Verify webhook signature config:
   - `SUBMAN_WEBHOOK_SECRET_CURRENT`
   - `SUBMAN_WEBHOOK_SECRET_NEXT` (rotation windows)
2. Check replay window config (`SUBMAN_WEBHOOK_REPLAY_WINDOW_SEC`).
3. Review webhook endpoint error rate and audit trail.
4. Trigger manual entitlement sync for affected tenants to backfill state.
5. Keep audit note with window, affected clients, and reconciliation timestamp.

### Emergency entitlement override
1. Owner uses:
   - suspend: `POST /api/platform/owner/tenants/:companyId/suspend`
   - reactivate: `POST /api/platform/owner/tenants/:companyId/reactivate`
   - full override: `POST /api/platform/owner/tenants/:companyId/override`
2. Always include incident reason in override payload.
3. Confirm audit event exists after action.
4. Set explicit rollback/review time and owner approver in incident notes.

## 5) Staging Verification Checklist
- [ ] Backup script executes successfully.
- [ ] Retention dry-run returns JSON summary.
- [ ] Retention apply deletes only expected historical rows.
- [ ] Restore drill succeeds and smoke checks pass.
- [ ] Ops evidence stored (logs + timestamps + operator).

## 6) Next Hardening Steps
- Add immutable/offsite backup replication.
- Add retention policy table/config in DB (instead of script defaults).
- Add monitoring alerts for backup/retention failures and stale last-success timestamps.

## 7) Automation (Implemented)

GitHub Actions workflow:
- File: `.github/workflows/ops-maintenance.yml`
- Schedule: daily at `02:30 UTC`
- Jobs:
  - retention dry-run
  - backup
  - retention apply (manual, or scheduled only when repo variable enables it)

Required repository configuration:
- Secret: `OPS_DATABASE_URL`
- Optional repo variable: `OPS_RETENTION_AUTO_APPLY=true` (to allow scheduled apply)

Manual dispatch options:
- `run_backup`
- `run_retention_dry_run`
- `run_retention_apply`
- `retention_years`

## 8) Local Maintenance Runner (Implemented)

Script:
```powershell
pnpm ops:maintenance
```

Behavior:
- Runs retention dry-run.
- Optionally applies retention when `-ApplyRetention` is passed.
- Runs PostgreSQL backup.
- Writes log file under `apps/api/ops-logs`.

Examples:
```powershell
pnpm --filter @vpos/api ops:maintenance
pnpm --filter @vpos/api ops:maintenance -- -ApplyRetention -RetentionYears 7
```

## 9) Hybrid Tenancy Monitoring (Started)

Commands:
```powershell
pnpm ops:hybrid:health
pnpm --filter @vpos/api ops:hybrid:health -- --strict
```

References:
- `docs/HYBRID_MONITORING.md`
- `docs/HYBRID_INCIDENT_PLAYBOOK.md`
- `docs/HYBRID_SECURITY_CHECKLIST.md`

Notes:
- Strict mode returns non-zero exit when dedicated tenant health is degraded.
- Daily GitHub ops workflow now includes hybrid datastore strict health check.

## 10) Datastore Key Rotation (Started)

Commands:
```powershell
pnpm ops:datastore-key-rotate:dry-run
pnpm ops:datastore-key-rotate:apply
```

Notes:
- Use `VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT` + `VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS` during rotation windows.
- Run apply only in approved maintenance windows.

## 11) Security and Entitlement Alert Wiring (Implemented)

Security checklist command:
```powershell
pnpm ops:security:check
```

Entitlement health alert command:
```powershell
pnpm ops:entitlements:health
```

References:
- `docs/SECURITY_CHECKLIST.md`
- `docs/ENTITLEMENT_MONITORING.md`
