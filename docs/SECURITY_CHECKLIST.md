# VPOS Security Checklist (Task 6.2)

## Purpose
- Close baseline security hardening for multi-tenant + subscription integration.
- Provide an operator checklist that can be validated in CI and during release.

## Checklist
- [x] Webhook signature verification enabled (`SUBMAN_WEBHOOK_SECRET_CURRENT` or legacy `SUBMAN_WEBHOOK_SECRET`).
- [x] Webhook replay-window validation enabled (`SUBMAN_WEBHOOK_REPLAY_WINDOW_SEC`).
- [x] Entitlement sync/webhook updates are auditable (`AuditLog` + entitlement events).
- [x] Tenant mismatch protection enabled in auth guard.
- [x] Protected requests always carry tenant scope (`request.companyId` from JWT when middleware context is absent).
- [x] Runtime hardcoded demo bootstrap disabled by default:
  - `VPOS_ALLOW_DEMO_TENANT_BOOTSTRAP=false`
  - `VPOS_TENANT_CONTEXT_ALLOW_FALLBACK=false`
  - `VPOS_AUTH_TENANT_FALLBACK=false`
- [x] Subscription-ended login lock enforced on API auth (`/auth/login`, `/auth/refresh`).

## Automated Validation
- Command:
```powershell
pnpm ops:security:check
```

- Script:
  - `apps/api/scripts/security-checklist-audit.mjs`

- Strict behavior:
  - exits non-zero when blocking controls are misconfigured.

## Secret Rotation Controls
- Webhook secret rotation:
  - set `SUBMAN_WEBHOOK_SECRET_CURRENT` to active value
  - set `SUBMAN_WEBHOOK_SECRET_NEXT` during rotation window
  - keep both valid temporarily, then remove old secret after cutover
- Datastore key rotation runbook:
```powershell
pnpm ops:datastore-key-rotate:dry-run
pnpm ops:datastore-key-rotate:apply
```

## Release Gate Recommendation
- Include in release pipeline:
  - `pnpm --filter @vpos/api build`
  - `pnpm ops:security:check`
  - `pnpm ops:entitlements:health`
