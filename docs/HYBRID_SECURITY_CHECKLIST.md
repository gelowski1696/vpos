# Hybrid Security Checklist (Task 7.5)

## 1) Secret Rotation (Datastore Registry Encryption)

Checklist:
- [x] Dedicated datastore URLs are encrypted at rest (`AES-256-GCM`).
- [x] Key version is stored per record (`keyVersion`).
- [x] Runtime supports current + previous key decrypt window:
  - `VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT`
  - `VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT_VERSION`
  - `VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS`
  - `VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS_VERSION`
- [x] Lazy re-encryption occurs on successful read when old key version is detected.
- [x] Rotation tooling exists:
  - dry-run: `pnpm ops:datastore-key-rotate:dry-run`
  - apply: `pnpm ops:datastore-key-rotate:apply`

Rotation runbook:
1. Set new current key/version and keep old key as previous.
2. Run dry-run and verify rotatable count.
3. Run apply in maintenance window.
4. Verify `dry-run` now reports `already_current` for all rows.
5. Remove previous key after rollback window.

## 2) Access-Boundary Controls

Checklist:
- [x] Owner console endpoints require `platform_owner`.
- [x] Non-owner users are denied owner-console routes (403).
- [x] Tenant mismatch protections are active (`token tenant` + `X-Client-Id` consistency).
- [x] Dedicated routing fails closed (`503`) on unavailable dedicated datastore.
- [x] Owner strict health endpoint fails closed when dedicated tenants are unhealthy.

Verification commands:
```powershell
pnpm --filter @vpos/api test -- --runInBand owner-console-hybrid.e2e-spec.ts
pnpm --filter @vpos/api test -- --runInBand transactional-router.e2e-spec.ts
```

## 3) Operational Security Checks

Checklist:
- [x] Daily hybrid health check automation in CI (`ops-maintenance.yml`).
- [x] Incident playbook for routing/schema/mapping failures.
- [x] Monitoring output includes tenant-mode context (`SHARED_DB|DEDICATED_DB`).

Operational commands:
```powershell
pnpm ops:hybrid:health
pnpm --filter @vpos/api ops:hybrid:health -- --strict
```
