# VPOS Multi-Tenant + Subscription Integration Implementation Guide

## 1) Purpose

This document defines how to:
- turn VPOS into a true multi-tenant SaaS platform,
- connect it with the existing subscription control plane at `D:\projects JS\subscriptionapp`,
- enforce tenant entitlements for business topology and access policy.

This is the implementation companion for [TASKS2.md](d:/vpos/docs/TASKS2.md).

## 2) Target Architecture

### Data plane (VPOS)
- `apps/api` (NestJS + Prisma + PostgreSQL) remains authoritative for:
  - inventory,
  - financial posting,
  - sync conflict decisions.
- `apps/web` and `apps/mobile` remain tenant apps.

### Control plane (subscriptionapp)
- Existing app at `D:\projects JS\subscriptionapp` remains authoritative for:
  - plans,
  - subscription state,
  - billing lifecycle.

### Integration model
- Prefer API + webhook integration.
- Do not share databases directly between VPOS and subscriptionapp.

## 3) Tenant Identity Model

### Canonical mapping
- `subscriptionapp.clientId` -> `vpos.company.externalClientId`

### Mapping contract (source of truth)
- `subscriptionapp` remains control-plane source of truth for tenant lifecycle state (`ACTIVE|PAST_DUE|SUSPENDED|CANCELED`) and plan/tier metadata.
- `VPOS` persists the mapped tenant key at `Company.externalClientId` and uses it as the canonical lookup key for:
  - webhook event application,
  - owner subscription-driven provisioning,
  - entitlement sync reconciliation,
  - cross-system audit correlation.
- Runtime mapping rules:
  - control-plane calls and webhooks identify tenant by `client_id`/`X-Client-Id`,
  - VPOS resolves `Company` by `externalClientId` (case-insensitive handling),
  - JWT continues to carry `company_id` for data-plane request scoping.
- Invariant:
  - exactly one VPOS company per `externalClientId` (`@unique`),
  - no implicit runtime `DEMO` mapping fallback in production paths.

### Required runtime identifiers
- JWT claim in VPOS: `company_id`
- Header for platform/API integrations: `X-Client-Id`

### Constraints
- Every protected VPOS request must resolve tenant from request context.
- All queries and writes must include `companyId` filtering.

## 3.1) Tenancy Strategy

### 1 Tenant = 1 Database (Dedicated DB)
Pros
- Strongest data isolation and tenant trust.
- Easier compliance story for enterprise clients.
- Per-tenant backup/restore and disaster recovery.
- Noisy tenant workload won’t impact others as much.
- Easier tenant offboarding/data export.

Cons
- Higher infra cost (many DBs, more connections).
- More complex operations (provisioning, migrations, monitoring).
- Harder global reporting across all tenants.
- Slower feature rollout because migrations run per tenant DB.
- More moving parts for failover and incident response.

### Shared Database (Current)
Pros
- Cheaper and simpler to run.
- Faster development and deployment.
- Easier global analytics/reporting.
- One migration path.

Cons
- Weaker isolation perception.
- Higher blast radius risk if a bug bypasses tenant filters.
- Harder to satisfy strict enterprise/compliance requirements.

### Best practical approach
- Use hybrid mode:
  1. Start most tenants on `SHARED_DB`.
  2. Move high-value/compliance tenants to `DEDICATED_DB`.
  3. Keep one codebase with tenant DB routing.

## 4) Required Schema Changes (VPOS)

## 4.1 Company linkage
- Add to `Company`:
  - `externalClientId String? @unique`
  - `subscriptionStatus String @default("ACTIVE")`
  - `entitlementUpdatedAt DateTime?`
  - `datastoreMode TenancyDatastoreMode @default(SHARED_DB)` (`SHARED_DB|DEDICATED_DB`)
  - `datastoreRef String?` (connection reference/alias for dedicated routing)
  - `datastoreMigrationState TenancyMigrationState @default(NONE)` (`NONE|PENDING|IN_PROGRESS|COMPLETED|FAILED`)

## 4.2 Entitlement table
- Add `CompanyEntitlement`:
  - `id`
  - `companyId` (unique FK)
  - `externalClientId`
  - `status` (`ACTIVE|PAST_DUE|SUSPENDED|CANCELED`)
  - `maxBranches Int`
  - `branchMode` (`SINGLE|MULTI`)
  - `inventoryMode` (`STORE_ONLY|STORE_WAREHOUSE`)
  - `allowDelivery Boolean`
  - `allowTransfers Boolean`
  - `allowMobile Boolean`
  - `graceUntil DateTime?`
  - `lastSyncedAt DateTime`
  - `createdAt`, `updatedAt`

## 4.3 Entitlement history
- Add append-only `CompanyEntitlementEvent`:
  - `id`, `companyId`, `eventType`, `payload Json`, `createdAt`

## 4.4 Optional platform settings
- Add `PlatformPolicy` (single row or environment-backed):
  - webhook signature policy,
  - grace defaults,
  - fail-open/fail-closed behavior.

## 5) Required Changes in VPOS Runtime

## 5.1 Request context and tenant resolver
- Replace hardcoded company resolver in [company-context.service.ts](d:/vpos/apps/api/src/common/company-context.service.ts).
- Add middleware/interceptor that resolves:
  1. `company_id` from JWT for user requests.
  2. `X-Client-Id` for system-to-system requests.
- Enforce consistency when both are present.

## 5.2 DB-backed auth and tenant-safe login
- Replace in-memory auth repository behavior with Prisma-backed user lookup.
- Login flow must:
  - resolve tenant first,
  - validate email/password under that tenant only,
  - issue tenant-bound JWT.

## 5.3 Entitlement guard
- Add `EntitlementGuard` or `EntitlementPolicyService` used by:
  - master-data branch/location endpoints,
  - sync push posting,
  - transaction posting (`sales/post`, transfers, delivery operations).

## 5.4 Policy enforcement points
- Branch create/update:
  - enforce `maxBranches`,
  - enforce `branchMode`.
- Location/branch type create/update:
  - block warehouse types under `STORE_ONLY`.
- Feature modules:
  - block delivery/transfers/mobile actions if not entitled.

## 6) Integration with subscriptionapp

## 6.1 Outbound polling gateway (VPOS -> subscriptionapp)
- New service: `SubscriptionGatewayService`.
- Input: `externalClientId`.
- Output: normalized entitlement payload for VPOS.
- Recommended endpoint contract in subscriptionapp:
  - `GET /v1/entitlements/current`
  - headers: `X-Client-Id`, service auth key.

## 6.2 Inbound webhooks (subscriptionapp -> VPOS)
- New VPOS endpoint:
  - `POST /api/platform/webhooks/subscription`
- Must support:
  - HMAC signature verification,
  - idempotency key,
  - replay detection window,
  - event versioning.

## 6.4 Tenant provisioning endpoint (control plane -> VPOS)
- New VPOS endpoint:
  - `POST /api/platform/tenants/provision`
- Intended use:
  - subscription activation or onboarding automation from control plane.
- Security:
  - `x-platform-api-key` validated against `PLATFORM_PROVISION_API_KEY` (required in production).
- Behavior:
  - idempotent upsert of `Company` + `CompanyEntitlement`,
  - template bootstrap (`SINGLE_STORE|STORE_WAREHOUSE|MULTI_BRANCH_STARTER`) for branches/locations,
  - optional admin-user bootstrap (`admin_email`, `admin_password`),
  - audit action emitted (`PLATFORM_TENANT_PROVISION`).

## 6.5 Owner/Super admin endpoints (VPOS platform plane)
- New owner endpoints:
  - `GET /api/platform/owner/tenants`
  - `POST /api/platform/owner/subscriptions/active`
  - `POST /api/platform/owner/tenants/provision-from-subscription`
  - `POST /api/platform/owner/tenants/:companyId/override`
  - `POST /api/platform/owner/tenants/:companyId/suspend`
  - `POST /api/platform/owner/tenants/:companyId/reactivate`
  - `DELETE /api/platform/owner/tenants/:companyId`
- Access control:
  - JWT role required: `platform_owner`.
  - Non-owner users are denied by RBAC.
- Owner actions are audited:
  - `PLATFORM_TENANT_OVERRIDE`
  - `PLATFORM_TENANT_SUSPEND`
  - `PLATFORM_TENANT_REACTIVATE`
- Web console:
  - `apps/web` owner page at `/tenants` for tenant health view, subscription-driven tenant provisioning, entitlement overrides, suspend/reactivate controls, and tenant deletion.
  - Add-tenant dialog can load active subscriptions into a dropdown and auto-fill `client_id` from selected subscription.
  - Provision form supports optional `subman_api_key` when SubMan requires tenant-scoped API keys.
  - Provision form supports tenancy metadata inputs:
    - `tenancy_mode` (`SHARED_DB|DEDICATED_DB`)
    - `datastore_ref` (optional dedicated datastore reference)

### 6.5.1 Phase 7.1 metadata payload extensions
- Provision endpoints accept optional:
  - `tenancy_mode`
  - `datastore_ref`
- Owner tenant list response includes:
  - `tenancy_mode`
  - `datastore_ref`
  - `datastore_migration_state`

## 6.6 Owner-only tenant structure controls
- Branch/location/user management endpoints are restricted to `owner` or `platform_owner`.
- `admin` is no longer sufficient for tenant structure/user administration.
- Tenant provisioning now creates owner-capable identities (`owner` role included) for the provided admin account.
- Web admin sidebar hides `Branches`, `Locations`, and `Users` links for non-owner sessions.

## 6.7 Subscriptionapp-driven tenant provisioning
- Owner console supports provisioning from control-plane data by `client_id`.
- New API:
  - `POST /api/platform/owner/tenants/provision-from-subscription`
- Data sources:
  - entitlement fetch: `SUBMAN_ENTITLEMENT_PATH` (default `/v1/subscriptions?status=ACTIVE&limit=20&sortBy=updatedAt&sortOrder=desc`)
  - client profile fetch: `SUBMAN_CLIENT_PROFILE_PATH` (default `/v1/subscriptions?status=ACTIVE&limit=1&sortBy=updatedAt&sortOrder=desc`)
- Deployment target:
  - `SUBMAN_BASE_URL=http://168.231.103.231:3003`
- Behavior:
  - accepts only `ACTIVE` subscriptions for owner-driven tenant provisioning,
  - pulls plan/features/status/grace from subscriptionapp payload,
  - accepts optional `subman_api_key` input in owner provision request and forwards it as gateway auth override,
  - maps to VPOS entitlement and topology template (auto or explicit override),
  - provisions tenant and optional owner login credentials,
  - writes audit action `PLATFORM_TENANT_PROVISION_FROM_SUBSCRIPTION`.

## 6.8 Branding and White-Label Boundaries
- Tenant isolation:
  - branding read/write always resolves through tenant router scope (`companyId`),
  - fallback cache is maintained per tenant (not global), preventing cross-tenant branding bleed during transient DB fallback paths.
- Tier-based branding controls (optional):
  - configure with `VPOS_BRANDING_LIMITS_BY_PLAN_JSON`,
  - policy key = `plan_code` from latest entitlement event context,
  - supported controls:
    - `allowCustomLogos`
    - `allowCustomColors`
    - `allowCustomReceiptFooter`
    - `allowCustomNumberFormats`
    - `maxReceiptFooterLength`
- Enforcement:
  - applied on `PUT /api/branding/config`,
  - blocks only fields that actually changed versus current branding values,
  - returns `403` for disallowed tier features and `400` for max-length violations.

### Suggested webhook payload
```json
{
  "event_id": "evt_01",
  "event_type": "subscription.updated",
  "occurred_at": "2026-02-25T10:00:00.000Z",
  "client_id": "tenant_abc",
  "status": "ACTIVE",
  "plan_code": "PRO_MULTI",
  "features": {
    "max_branches": 10,
    "branch_mode": "MULTI",
    "inventory_mode": "STORE_WAREHOUSE",
    "allow_delivery": true,
    "allow_transfers": true,
    "allow_mobile": true
  },
  "grace_until": null
}
```

## 6.3 Mapping rules
- subscriptionapp plan/subscription data is mapped to VPOS entitlement fields.
- This mapping must be deterministic and test-covered.
- Current deterministic plan defaults when explicit `features` are not supplied:
  - `BASIC_SINGLE|STARTER_SINGLE|SINGLE_STORE` -> `maxBranches=1`, `branchMode=SINGLE`, `inventoryMode=STORE_ONLY`, `allowDelivery=false`, `allowTransfers=false`, `allowMobile=true`
  - `PRO_SINGLE_WAREHOUSE|SINGLE_STORE_WAREHOUSE` -> `maxBranches=1`, `branchMode=SINGLE`, `inventoryMode=STORE_WAREHOUSE`, `allowDelivery=true`, `allowTransfers=true`, `allowMobile=true`
  - `PRO_MULTI|MULTI_BRANCH|ENTERPRISE_MULTI` -> `maxBranches=10`, `branchMode=MULTI`, `inventoryMode=STORE_WAREHOUSE`, `allowDelivery=true`, `allowTransfers=true`, `allowMobile=true`

## 7) Entitlement Rules for Requested Scenarios

## 7.1 Single branch only
- `maxBranches = 1`
- `branchMode = SINGLE`
- API rejects second branch creation.

## 7.2 Multiple branches
- `branchMode = MULTI`
- `maxBranches = N`
- API rejects branch count above N.

## 7.3 Store only
- `inventoryMode = STORE_ONLY`
- reject warehouse branch/location types.

## 7.4 Store with warehouse
- `inventoryMode = STORE_WAREHOUSE`
- allow `STORE` + `WAREHOUSE` branch/location types.

## 8) Offline and Sync Behavior Under Subscription States

- `ACTIVE`: normal operation.
- `PAST_DUE`:
  - allow local capture,
  - allow sync during grace window.
- `SUSPENDED`:
  - block new high-risk operations (policy-based),
  - keep read access and conflict resolution.
- `CANCELED`:
  - lock writes after grace,
  - allow data export and settlement flows.

Important: do not discard already-captured offline transactions; reconcile safely on next allowed sync.

## 9) Security Requirements

- Validate `X-Client-Id` on all protected integration endpoints.
- HMAC signature verification for all incoming billing/subscription webhooks.
- Idempotent event processing with durable dedupe keys.
- Audit every entitlement change and override.

## 10) Migration and Rollout Plan

1. Add schema changes and migrations.
2. Introduce tenant resolver and entitlement policy in shadow mode (log-only).
3. Switch auth to DB-backed tenant-safe checks.
4. Enable enforcement for branch/location constraints.
5. Enable webhook ingestion and periodic reconciliation job.
6. Enable full blocking policies for suspended/canceled states.

## 11) Test Strategy

### Backend integration tests
- tenant isolation on all major endpoints,
- cross-tenant access denial,
- entitlement enforcement for all four topology modes,
- webhook signature validation and idempotency,
- downgrade/upgrade transition behavior.

### End-to-end tests
- onboarding flow from active subscription to tenant ready state,
- plan downgrade from multi-branch to single-branch (no data loss, creation blocked),
- store-only plan cannot create warehouse locations.

## 12) Operational Runbook Requirements

- tenant provisioning and re-provisioning,
- manual entitlement override with audit trail,
- webhook outage/fallback behavior,
- stale entitlement cache alert and reconciliation.

## 13) Current Implementation Snapshot

- Implemented now:
  - Request-scoped tenant context middleware with `X-Client-Id` propagation.
  - Production-safe auth behavior: production runtime requires DB-backed auth/token persistence (memory fallback blocked unless explicitly overridden).
  - Entitlement schema (`CompanyEntitlement`, `CompanyEntitlementEvent`) and persistence.
  - Entitlement enforcement for branch count/store-only topology plus status-based write policy (`ACTIVE|PAST_DUE|SUSPENDED|CANCELED`) on transactional and master-data writes.
  - Webhook ingestion endpoint with optional HMAC verification and dedupe by `externalEventId`.
  - Webhook hardening with replay-window validation and secret rotation support (`CURRENT`/`NEXT`).
  - Tenant provisioning workflow endpoint (`POST /api/platform/tenants/provision`) with idempotent company/default bootstrap and audit logging.
  - Owner/super-admin console implementation:
    - owner APIs for tenant list + override/suspend/reactivate
    - web owner tenant console page (`/tenants`)
    - RBAC hard gate via `platform_owner` role
    - audited owner override lifecycle
    - tenant creation from subscriptionapp details by `client_id`
  - Hybrid dedicated provisioning foundation:
    - dedicated database setup service (create/migrate/seed),
    - tenant migration state transitions (`PENDING|IN_PROGRESS|COMPLETED|FAILED`),
    - dedicated tenancy lifecycle events and enriched owner provisioning audit metadata.
  - Owner-only tenant structure policy:
    - `owner|platform_owner` required for branch/location/user management APIs
    - tenant owner role included during provisioning for delegated tenant administration
    - non-owner web sessions do not see branch/location/user menu entries
  - Subscription gateway with cache + circuit-breaker + stale/local fallback in sync endpoint.
  - Tenant-scoped `AuditLog` write coverage for entitlement sync/webhook, master-data mutations, and transactional posting flows.
  - In-memory transactional modules are tenant-scoped (`sales`, `sync`, `transfers`, `delivery`, `cylinders`, `reports`).
  - Cross-tenant request denial regression test added (`JWT tenant != X-Client-Id tenant`).
  - Plan-code mapping contract tests added for `BASIC_SINGLE` and `PRO_MULTI`.
- Current known gaps:
  - Tenant context fallback removal still in progress for full strict runtime resolution.
  - Operational runbooks/alerts are still pending.

## 14) Runtime Config for Subscription Integration

- `SUBMAN_BASE_URL`
- `SUBMAN_CLIENT_ID` (default suggested: `subman-mobile`; used as `X-Client-Id` header when calling subscriptionapp)
- `SUBMAN_ENTITLEMENT_PATH` (default: `/v1/subscriptions?status=ACTIVE&limit=20&sortBy=updatedAt&sortOrder=desc`)
- `SUBMAN_CLIENT_PROFILE_PATH` (default: `/v1/subscriptions?status=ACTIVE&limit=1&sortBy=updatedAt&sortOrder=desc`)
- `SUBMAN_ACTIVE_SUBSCRIPTIONS_PATH` (default: `/v1/subscriptions?status=ACTIVE&limit=200&sortBy=updatedAt&sortOrder=desc`)
- `SUBMAN_API_KEY` (optional)
- `SUBMAN_BEARER_TOKEN` (optional; use when subscriptionapp is protected by JWT/Bearer instead of API key)
- `SUBMAN_TOKEN_AUTO_REFRESH` (optional; when true, VPOS auto-fetches/refreshes bearer token)
- `SUBMAN_AUTH_LOGIN_PATH` (default: `/v1/auth/login`)
- `SUBMAN_AUTH_EMAIL` (required for auto token refresh)
- `SUBMAN_AUTH_PASSWORD` (required for auto token refresh)
- `SUBMAN_AUTH_EXTRA_JSON` (optional extra JSON merged into auth payload)
- `SUBMAN_TOKEN_TTL_SEC` (fallback token TTL when JWT `exp` is unavailable; default: `840`)
- `SUBMAN_TIMEOUT_MS` (default: `8000`)
- `SUBMAN_WEBHOOK_SECRET` (optional, enables HMAC validation)
- `SUBMAN_WEBHOOK_SECRET_CURRENT` (optional, active secret for rotation)
- `SUBMAN_WEBHOOK_SECRET_NEXT` (optional, next secret accepted during rotation)
- `SUBMAN_WEBHOOK_REPLAY_WINDOW_SEC` (default: `900`)
- `SUBMAN_CACHE_TTL_MS` (default: `60000`)
- `SUBMAN_STALE_TTL_MS` (default: `600000`)
- `SUBMAN_CIRCUIT_FAIL_THRESHOLD` (default: `3`)
- `SUBMAN_CIRCUIT_OPEN_MS` (default: `45000`)
- `PLATFORM_PROVISION_API_KEY` (required in production for `/api/platform/tenants/provision`)
- `VPOS_AUTH_ALLOW_MEMORY_FALLBACK` (default: `false`; keep disabled in production)
- `VPOS_DEDICATED_DB_URLS_JSON` (optional JSON map: `datastoreRef -> postgres URL`)
- `VPOS_DEDICATED_DB_URL_<DATASTORE_REF_SANITIZED>` (optional per-ref URL fallback)
- `VPOS_DATASTORE_ENCRYPTION_KEY` (required in production for DB-backed encrypted datastore registry)
- `VPOS_DEDICATED_DB_BASE_URL` (optional base URL used for automatic dedicated URL derivation)
- `VPOS_DEDICATED_DB_NAME_PREFIX` (default: `vpos_tenant_`)
- `VPOS_DERIVE_DEDICATED_URL_ON_PROVISION` (default: `true`)
- `VPOS_DEDICATED_PROVISION_AUTO` (optional; defaults to enabled outside test runtime)
- `VPOS_DEDICATED_DB_CREATE_DATABASE` (default: `true`)
- `VPOS_DEDICATED_DB_APPLY_MIGRATIONS` (default: `true`)
- `VPOS_DEDICATED_DB_SEED_BOOTSTRAP` (default: `true`)
- `VPOS_DEDICATED_DB_ADMIN_DATABASE` (default: `postgres`)
- `VPOS_DEDICATED_AUTO_MIGRATE_ON_SCHEMA_MISS` (default: `true`; auto-runs migrate deploy when dedicated DB exists without schema)
- `VPOS_DEDICATED_DB_HEALTH_TTL_MS` (default: `15000`)
- `VPOS_DEDICATED_DB_IDLE_TTL_MS` (default: `300000`)

### 14.1 SubMan token operation modes
- Preferred: `SUBMAN_API_KEY` (long-lived machine credential, no bearer rotation).
- Fallback: bearer token auto-refresh without modifying SubMan:
  - enable `SUBMAN_TOKEN_AUTO_REFRESH=true`
  - provide `SUBMAN_AUTH_EMAIL` + `SUBMAN_AUTH_PASSWORD`
  - VPOS authenticates, caches token, and retries once on `401` with refresh.
- Legacy/manual: static `SUBMAN_BEARER_TOKEN` if auto refresh is disabled.

## 15) Immediate Next Step

Continue with Phase 6.2, Phase 6.3, and Phase 5.1 from [TASKS2.md](d:/vpos/docs/TASKS2.md):
- complete security checklist publication,
- add runbooks + metrics/alerts for entitlement sync backlog and stale cache,
- implement subscription-aware mobile/offline sync policy transitions.

## 16) Phase 7 Hybrid Tenancy Mode Implementation Map (Aligned to TASKS2)

## 16.1 Task 7.1 - Hybrid Tenancy Contract and Tenant Mode Metadata
- Define and persist tenant datastore mode:
  - `SHARED_DB`
  - `DEDICATED_DB`
- Add datastore metadata model:
  - connection reference id (not raw secret),
  - migration/cutover state,
  - audit fields (`updatedBy`, `updatedAt`).
- Deliverable:
  - deterministic runtime lookup contract from tenant -> datastore target.
- Current status (2026-02-25):
  - `Company.datastoreMode`, `Company.datastoreRef`, and `Company.datastoreMigrationState` are implemented in Prisma + migration.
  - Owner provisioning APIs accept tenancy metadata inputs and persist values.
  - Owner tenant list + web owner console display tenancy metadata.
  - Runtime datasource router is in progress (Task 7.2).

## 16.2 Task 7.2 - Runtime DataSource Router and Isolation Guards
- Implement a tenant-aware datasource router in API request flow.
- Route requests to:
  - shared Prisma client (shared tenants),
  - dedicated Prisma client (dedicated tenants).
- Add safety controls:
  - no cross-mode fallback to another tenant datastore,
  - explicit error path for dedicated DB outage,
  - connection cache + health checks.
- Deliverable:
  - mixed-fleet runtime routing with strict tenant isolation guarantees.
- Current status (2026-02-25):
  - Implemented `TenantDatasourceRouterService` with:
    - tenant mode lookup from `Company` metadata,
    - dedicated client cache by `datastoreRef`,
    - health checks, idle eviction, and fail-closed behavior.
  - Request context now carries datastore mode/reference metadata for observability.
  - Added `TenantRoutingPolicyService` for request-bound router enforcement in transactional controllers.
  - Routing applied in:
    - branding reads/writes,
    - master-data branch/location/customer/cylinder-type/product/expense-category/price-list reads/writes,
    - master-data active price resolution getters (`getCustomerById`, `getProductById`, `getActivePriceLists`).
    - transactional/reporting request boundaries (`sales`, `sync`, `transfers`, `delivery`, `cylinders`, `reports`).
  - Mixed-fleet router test coverage added:
    - dedicated fail-closed assertions,
    - shared fallback assertions,
    - shared + dedicated tenant routing assertions in the same test run,
    - transactional endpoint-level mixed-fleet checks and dedicated fail-closed `503` checks,
    - endpoint-specific workflow checks for `transfers`, `delivery`, and `cylinders` on shared + dedicated tenants.
  - Remaining work:
    - extend mixed-fleet assertions into higher-volume and long-running workflow scenarios (soak/perf/regression depth).

## 16.3 Task 7.3 - Owner Provisioning and Mode Selection
- Extend owner tenant provisioning to accept tenancy mode.
- For dedicated mode:
  - create tenant DB,
  - run migrations,
  - seed baseline tenant data.
- Store resulting datastore metadata and audit all actions.
- Deliverable:
  - owner console can provision both shared and dedicated tenants end-to-end.
- Current status (2026-02-25):
  - Added `DedicatedTenantProvisioningService` for dedicated-mode setup:
    - DB create-if-missing,
    - `prisma migrate deploy`,
    - bootstrap seed in dedicated datastore.
  - Provisioning validates `datastore_ref` for `DEDICATED_DB`.
  - Shared company migration state now transitions through:
    - `PENDING`
    - `IN_PROGRESS`
    - `COMPLETED` / `FAILED`
  - Added dedicated tenancy lifecycle events in `CompanyEntitlementEvent`:
    - `TENANCY_MODE_SET` / `TENANCY_MODE_UPDATED`
    - `TENANCY_DEDICATED_PROVISION_STARTED`
    - `TENANCY_DEDICATED_PROVISION_COMPLETED`
    - `TENANCY_DEDICATED_PROVISION_FAILED`
  - Added gated live smoke integration coverage:
    - `apps/api/test/dedicated-live-smoke.e2e-spec.ts`
    - enabled with `VPOS_RUN_LIVE_DEDICATED_SMOKE=true`
    - verifies dedicated provisioning -> tenant login -> tenant transaction without manual DB intervention.
  - Dedicated migration execution now uses Node Prisma entrypoint (`node_modules/prisma/build/index.js`) for cross-platform reliability (including Windows).
  - Added datastore registry automation to remove per-tenant `.env` mapping maintenance:
    - schema: `TenantDatastoreRegistry` (company/ref keyed),
    - URL values encrypted at rest (AES-256-GCM),
    - router resolves registry URL first, env fallback second (with env write-through back into registry),
    - owner provisioning auto-registers dedicated datastore URL mapping.
  - Owner provisioning audit metadata includes tenancy mode, datastore reference, and migration state.
  - Remaining work:
    - add this live smoke into CI nightly/staging pipeline with dedicated DB credentials.

## 16.4 Task 7.4 - Shared <-> Dedicated Tenant Migration Workflow
- Build migration tooling for mode transition:
  - shared -> dedicated (primary),
  - rollback path as needed.
- Include:
  - dry-run validation,
  - per-table row counts/checksums,
  - cutover markers and rollback markers.
- Deliverable:
  - repeatable migration playbook with bounded-downtime cutover.

## 16.5 Task 7.5 - Hybrid Operations, Security, and Monitoring
- Add hybrid-aware observability:
  - routing failures by tenant/mode,
  - dedicated DB health,
  - migration lifecycle telemetry.
- Secure dedicated DB secret lifecycle:
  - secret manager integration pattern,
  - rotation and revocation process.
- Deliverable:
  - production runbooks and alerts for hybrid tenancy incidents.

## 16.6 Task 7.6 - Hybrid Regression Test Matrix
- Add automated integration matrix:
  - shared tenant and dedicated tenant in same deployment,
  - auth/rbac behavior parity,
  - sync/posting/reporting isolation.
- Add migration/cutover regression tests.
- Add load/perf checks for routing and connection churn.
- Deliverable:
  - test suite proving correctness and stability of hybrid mode under mixed-tenant load.
