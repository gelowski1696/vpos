# VPOS Implementation Guide

## 1) Architecture Overview

VPOS is implemented as a pnpm monorepo with clear platform responsibilities:
- `apps/api`: NestJS + Prisma + PostgreSQL (authoritative server).
- `apps/web`: Next.js 14 App Router admin panel (online-only).
- `apps/mobile`: Expo React Native app (offline-first transactional client).
- `packages/shared-types`: shared DTOs, enums, contracts.
- `packages/offline-core`: outbox sync state machine.
- `packages/printing-core`: receipt builder and adapter abstraction.
- `packages/ai-ready`: event contracts and analytics export stub.

Core design rules:
- Server is authoritative for financial and inventory posting.
- Mobile writes local-first, then syncs through outbox.
- Master data is controlled by web admin and propagated by pull sync.
- Hybrid-ready tenancy is enforced with `companyId` in domain models.

## 2) Folder Structure

```txt
apps/
  api/
  web/
  mobile/
packages/
  shared-types/
  offline-core/
  printing-core/
  ai-ready/
  eslint-config/
  tsconfig/
infra/
  compose/
  ci/
docs/
  TASKS.md
  IMPLEMENTATION.md
```

## 3) Prisma Schema Overview

`apps/api/prisma/schema.prisma` includes:
- Org and identity: `Company`, `BrandingConfig`, `Branch`, `Location`, `User`, `Role`, `Permission`, `UserRole`, `SupervisorPin`, `RefreshToken`, `DeviceSession`.
- Master data: `Customer`, `Product`, `CylinderType`, `PriceList`, `PriceRule`, `ExpenseCategory`.
- Inventory/costing: `InventoryBalance`, `InventoryLedger`, `StockTransfer`, `StockTransferLine`, `CostingConfig`.
- Cylinder assets/events: `Cylinder`, `CylinderEvent`, `CylinderBalance`.
- Sales/operations: `Shift`, `ShiftCashEntry`, `ZRead`, `Sale`, `SaleLine`, `Payment`, `DiscountOverrideLog`, `Receipt`, `DeliveryOrder`, `DeliveryAssignment`, `DeliveryStatusEvent`, `PettyCashEntry`, `DepositLiabilityLedger`.
- Sync/audit/AI-ready: `SyncCursor`, `SyncReview`, `IdempotencyKey`, `AuditLog`, `EventSales`, `EventStockMovement`, `EventDeliveryPerformance`, `EventUserBehavior`.

Important constraints and indexes:
- `Cylinder.serial` unique.
- Idempotency key uniqueness per company (`@@unique([companyId, key])`).
- Receipt numbering unique per branch (`@@unique([branchId, receiptNumber])`).
- Composite indexes for update/sync access patterns.

## 4) Sync Protocol Specification

### Push
`POST /api/sync/push`

Request:
- `device_id`
- `last_pull_token` (optional)
- `outbox_items[]`: `id`, `entity`, `action`, `payload`, `idempotency_key`, `created_at`

Response:
- `accepted[]`
- `rejected[]` with `reason` and optional `review_id`

Server behavior:
- Idempotency key already seen -> treated as accepted duplicate.
- Validation failure -> reject and create `SyncReview`.
- Server-authoritative posting rules are enforced per entity:
  - `transfer`: validates source quantities before posting movement.
  - `delivery_order`: validates personnel assignment and status transitions.
  - `petty_cash`: validates open shift and available cash balance for `OUT`.
  - `shift`: validates open/close sequencing and balance snapshots.
  - `cylinder_event`: validates serial state transitions for issue/return/exchange/refill.

### Pull
`GET /api/sync/pull?since=<token>&device_id=<id>`

Response:
- `changes[]`
- `conflicts[]`
- `next_token`

Token behavior:
- `next_token` tracks change stream position.
- Client stores token in local sync state.

### Review Resolution
`POST /api/reviews/:id/resolve`
- Marks review as resolved with resolution payload.

## 5) Offline Architecture (Mobile)

### Local data model
- SQLite schema is defined in `apps/mobile/src/db/schema.ts`.
- Outbox fields:
  - `id`, `entity`, `action`, `payload`, `idempotency_key`, `status`, `retry_count`, `last_error`, `created_at`, `updated_at`.
- Transaction-local stores:
  - `sales_local`, `transfers_local`, `petty_cash_local`, `delivery_orders_local`, `shifts_local`, `shift_cash_entries_local`.
- Sync cache stores:
  - `master_data_local` for pulled admin/master deltas.
  - `sync_reviews_local` for server conflict/review records.
- Device runtime config stores:
  - `printer_settings` for per-device printer type and adapter config.

### Local-first write flow
1. Write transaction to local store.
2. Insert outbox item in `pending`.
3. UI reflects saved transaction immediately.

### Sync flow
1. Read pending outbox.
2. Push deterministic batch to server.
3. Apply push results to local transaction rows (`sync_status`) using entity-to-table reconciliation.
4. Pull deltas and apply to local stores via SQLite applier.
5. Preserve unsynced local transactional records on pull merge.

### Offline auth
- Initial login online.
- Cache encrypted session token locally in `auth_session`.
- Require local PIN reauth for offline unlock.
- Refresh token lifecycle is available through HTTP auth transport (`/auth/refresh`) and local session refresh method.
- App-level auth boot flow is wired in `apps/mobile/App.tsx`:
  - Bootstraps SQLite and hydrates local session.
  - If no cached session -> login screen.
  - If cached session and refresh succeeds -> app unlocks directly.
  - If cached session and refresh fails -> PIN unlock screen.
  - Logout clears local session regardless of network availability.

## 6) Pricing and Costing Engine Design

### Pricing precedence
1. Contract price
2. Tier price
3. Branch override
4. Global default

Additional rules:
- Effective date ranges and scheduled price windows.
- Role discount caps.
- Supervisor override logging.

### Costing (Policy-Driven)
- Server-side configurable policy per tenant via `CostingConfig`.
- Current supported methods:
  - `WAC` (weighted average cost per SKU/location)
  - `STANDARD` (product `standardCost`, fallback to WAC)
  - `LAST_PURCHASE` (latest inbound unit cost, fallback to standard/WAC)
  - `MANUAL_OVERRIDE` (allowed only when policy enables manual override)
- Additional policy flags:
  - Negative stock behavior (`BLOCK_POSTING` or `ALLOW_WITH_REVIEW`)
  - Landed-cost inclusion toggles (`freight`, `handling`, `other`)
  - Allocation basis (`PER_QUANTITY` or `PER_WEIGHT`)
  - Rounding scale (2/3/4 decimals)
- API endpoints:
  - `GET /api/master-data/costing-config`
  - `PUT /api/master-data/costing-config`
- Sale posting reads this policy at transaction time and finalizes COGS server-side.
- Mobile may display estimate but never final authority.

### Deposit accounting
- Deposit is liability, not inventory cost.
- Full issue increases liability.
- Empty return decreases liability.

## 7) Cylinder State Management Design

Cylinder tracking uses serial assets plus append-only events.
- Table: `Cylinder` stores current status and location.
- Table: `CylinderEvent` records all lifecycle actions.
- Table: `CylinderBalance` supports full/empty counts by location and cylinder type.

Workflow engine endpoints are available in API:
- `POST /api/cylinders/workflows/issue`
- `POST /api/cylinders/workflows/return`
- `POST /api/cylinders/workflows/refill`
- `POST /api/cylinders/workflows/exchange`
- `GET /api/cylinders/balances`

Supported workflow events:
- Issue full
- Receive empty
- Exchange
- Transfer
- Refill
- Damage
- Loss

## 8) Printer Integration Plan

`packages/printing-core` exposes:
- `printReceipt()`
- `printXRead()`
- `printZRead()`
- `testPrint()`

Adapter order:
1. ESC/POS generic built-in and Bluetooth.
2. iMin native adapter (Expo Dev Client / prebuild).
3. No-op fallback adapter.

Receipt behavior:
- Supports branding header/footer.
- Reprint includes `*** REPRINT ***` marker.

Mobile runtime implementation:
- `apps/mobile/src/features/printer/mobile-printer.service.ts` now supports:
  - device-scoped printer preference persistence (`printer_settings` SQLite table)
  - runtime adapter resolution for `IMIN`, `GENERIC_BUILTIN`, `BLUETOOTH`, and `NONE`
  - native bridge capability checks (`getRuntimeCapabilities`)
  - `runTestPrint`, `printReceiptDocument`, `printXReadSummary`, `printZReadSummary`
- `apps/mobile/App.tsx` now includes a printer setup panel in ready state:
  - select printer type
  - configure transport per type:
    - Bluetooth MAC for `BLUETOOTH`
    - TCP host/port for `GENERIC_BUILTIN`
  - persist setting locally
  - execute offline `testPrint()`
- Android native bridge implementation:
  - `apps/mobile/android/app/src/main/java/com/vmjamtech/vpos/printer/VposPrinterBridgeModule.kt`
  - `apps/mobile/android/app/src/main/java/com/vmjamtech/vpos/printer/VposPrinterBridgePackage.kt`
  - exposed bridge methods:
    - `getCapabilities`
    - `printImin`
    - `printEscPos`
    - `testPrint`
  - registered in `MainApplication` and enabled for Dev Client runtime.

## 9) Security Model

- JWT access token + refresh token rotation.
- Refresh token reuse rejection.
- Role-based authorization guard.
- Supervisor PIN model and override logs.
- Audit log table for sensitive actions.
- Device session identity for sync context.

## 10) AI-Ready Data Structures

Append-only event tables:
- `EventSales`
- `EventStockMovement`
- `EventDeliveryPerformance`
- `EventUserBehavior`

`packages/ai-ready` provides:
- Fact event contracts.
- Export batch DTO.
- `StubAnalyticsExportService` for future pipeline integration.

## 11) Run Instructions

### Prerequisites
- Node.js 22+
- pnpm 10+
- Docker (for PostgreSQL)

### Setup
1. `pnpm install`
2. `docker compose -f infra/compose/docker-compose.yml up -d`
3. `pnpm --filter @vpos/api prisma:generate`
4. `pnpm --filter @vpos/api prisma:migrate`
5. `pnpm --filter @vpos/api prisma:seed`

### Run apps
- API: `pnpm --filter @vpos/api start:dev`
- Web: `pnpm --filter @vpos/web dev`
- Mobile: `pnpm --filter @vpos/mobile start`

## 12) Testing Strategy

### Backend integration (minimum 10)
Implemented in `apps/api/test/app.e2e-spec.ts`, covering:
- Login success.
- Refresh rotation.
- Refresh reuse rejection.
- RBAC denial/allow checks.
- Sync idempotency.
- Pull token progression.
- Conflict review creation.
- Review resolution.
- Sales posting response behavior.
- Split-payment posting validation.
- Receipt reprint flow behavior.
- Cylinder issue/return/refill/exchange transition validation.
- Sync posting validation for:
  - transfer stock sufficiency
  - delivery assignment and status transitions
  - petty cash open-shift and balance checks
  - cylinder serial state transitions in `/sync/push`
- Transfer endpoint lifecycle validation:
  - approve -> post -> reverse transitions and inventory rollback checks.
- Delivery endpoint audit trail validation:
  - persisted event stream across assign/status transitions and invalid transition rejection.
- Petty cash reporting validation:
  - `/api/reports/petty-cash/summary` date-filtered totals and grouping accuracy.
  - `/api/reports/petty-cash/entries` shift-filtered entry stream accuracy.

### Mobile offline/sync (minimum 10)
Implemented in `apps/mobile/test/offline-sync.spec.ts`, covering:
- Offline enqueue flows.
- Cylinder dual-event enqueue.
- Transfer, delivery, shift, and petty cash queueing.
- App restart state persistence.
- Sync success and rejection state transitions.
- Pull merge safety for unsynced transactions.
- Offline PIN reauth.
- Offline printer test call.

Additional mobile sync/auth validation:
- `apps/mobile/test/mobile-sync-orchestrator.spec.ts`:
  - End-to-end SQLite orchestrator reconciliation for accepted/rejected push rows and pull deltas/conflicts.
- `apps/mobile/test/sqlite-sync-change-applier.spec.ts`:
  - Push status projection to local tables and pull conflict/master-data upserts.
- `apps/mobile/test/http-sync-transport.spec.ts`:
  - HTTP push/pull contract and query/header behavior.
- `apps/mobile/test/local-session-lifecycle.spec.ts`:
  - Persisted session hydration, PIN unlock, refresh rotation, and clear-session behavior.
- `apps/mobile/test/http-auth-transport.spec.ts`:
  - HTTP login/refresh transport behavior.
- `apps/mobile/test/mobile-auth-flow.spec.ts`:
  - App auth lifecycle state machine (bootstrap/login/unlock/logout).
- `apps/mobile/test/offline-pos.spec.ts`:
  - Offline POS cart checkout, split-payment validation, local receipt storage, and reprint marker output.
- `apps/mobile/test/offline-cylinder-workflow.spec.ts`:
  - Offline serial transition validation for issue/return/exchange/refill and location full/empty consistency.
- `apps/mobile/test/mobile-printer.service.spec.ts`:
  - Device-level printer preference persistence and adapter-selection test-print dispatch.

## 13) Current Milestone Status

Milestone 1 is implemented at scaffold level:
- Monorepo initialized.
- API auth + sync skeleton implemented.
- Prisma domain schema drafted.
- Seed data script added.
- Backend integration tests added.
- Mobile offline core and test suite added.

Milestone 2 implementation has started and is currently available:
- API modules:
  - `GET/POST/PUT /master-data/branches`
  - `GET/POST/PUT /master-data/locations`
  - `GET/POST/PUT /master-data/users`
  - `GET/POST/PUT /master-data/customers`
  - `GET/POST/PUT /master-data/products`
  - `GET/POST/PUT /master-data/cylinder-types`
  - `GET/POST/PUT /master-data/expense-categories`
  - `GET/POST/PUT /master-data/price-lists`
  - `GET/PUT /branding/config`
- Persistence behavior:
  - Master-data service now supports Prisma-backed persistence for core admin entities (branches, locations, customers, products, cylinder types, expense categories, price lists) when DB is available.
  - Branding config now supports Prisma-backed persistence when DB is available.
  - Fallback mode remains active for local/test contexts without a DB connection.
- Pricing resolver now enforces precedence from active master price lists.
- Web admin now includes:
  - `/login` authentication page.
  - Authenticated admin shell navigation.
  - CRUD screens wired to master-data endpoints.
  - Branding editor with web and 58mm receipt preview.

Milestone 3 implementation has progressed with persisted mobile sync primitives:
- `apps/mobile/src/db/sqlite.ts`:
  - Database bootstrap (`outbox`, `sync_state`, `auth_session`) and initialization helpers.
  - Backward-compatible auth-session column upgrade path (`pin_salt`).
- `apps/mobile/src/outbox/sqlite-outbox.repository.ts`:
  - SQLite implementation of outbox repository methods for enqueue, pending reads, status updates, and retry handling.
- `apps/mobile/src/features/sync/mobile-sync-orchestrator.ts`:
  - Sync engine orchestration with persisted `last_pull_token` management in local DB.
  - Push-result projection and pull-delta application to SQLite local stores.
- `apps/mobile/src/features/sync/sqlite-sync-change-applier.ts`:
  - Entity-aware reconciliation for push results.
  - Pull-merge rules that preserve unsynced local transactional rows.
  - Local persistence of server conflict/review rows.
- `apps/mobile/src/features/sync/http-sync.transport.ts`:
  - Production HTTP transport implementation for `/sync/push` and `/sync/pull`.
- `apps/mobile/src/features/auth/local-session.service.ts`:
  - SQLite-backed cached session hydration and PIN verification.
  - Local refresh-token rotation handler via transport contract.
- `apps/mobile/src/features/auth/http-auth.transport.ts`:
  - HTTP login/refresh/logout transport for auth lifecycle endpoints.
- `apps/mobile/src/features/auth/mobile-auth-flow.ts`:
  - Mobile auth state flow for bootstrap, login, PIN unlock, refresh, and logout.
- `apps/mobile/App.tsx`:
  - App-level login/unlock/ready UI wiring against local session and auth transport.
- `apps/mobile/src/services/offline-transaction.service.ts`:
  - SQLite-backed local-first transaction writes for:
    - Offline POS sales
    - Offline transfers
    - Offline petty cash entries
    - Offline delivery orders with multi-personnel assignments
    - Offline shift open/close actions
    - Offline shift cash entries
  - Each local transaction writes both:
    - a local transaction table record (`sales_local`, `transfers_local`, `petty_cash_local`, `delivery_orders_local`, `shifts_local`, `shift_cash_entries_local`)
    - an outbox queue record for sync push.
- `apps/mobile/src/db/schema.ts`:
  - Added transaction-local tables and indexes:
    - `sales_local`
    - `transfers_local`
    - `petty_cash_local`
    - `delivery_orders_local`
    - `shifts_local`
    - `shift_cash_entries_local`
    - `receipts_local`
    - `cylinders_local`
    - `cylinder_events_local`

Milestone 4 implementation has started with POS and cylinder workflows:
- API:
  - `apps/api/src/modules/sales/sales.service.ts`
    - Split-payment validation on posting.
    - Receipt number generation and receipt document payload.
    - Reprint endpoint flow (`POST /api/sales/:saleId/reprint`) with reprint marker state.
  - `apps/api/src/modules/cylinders/*`
    - Serial workflow transitions for issue/return/exchange/refill.
    - Full/empty balance computation by location.
- Mobile:
  - `apps/mobile/src/features/pos/offline-pos.service.ts`
    - Offline cart/search/barcode/favorites behavior.
    - Offline checkout to local sales + outbox and local receipt persistence.
    - Reprint flow with local reprint tracking and outbox audit enqueue.
  - `apps/mobile/src/features/cylinders/offline-cylinder-workflow.service.ts`
    - Local serial transition prechecks and queued cylinder events for sync.
  - `apps/mobile/src/features/printer/mobile-printer.service.ts`
    - Runtime adapter selection and device-level printer preference persistence.
    - Offline printer diagnostics via `runTestPrint()`.
  - `apps/mobile/App.tsx`
    - Printer setup UI (type select + test print) wired into ready-state operations.

Milestone 5 implementation is complete for transfer, delivery, and petty cash reportability:
- `apps/api/src/modules/sync/sync.service.ts`:
  - Authoritative in-memory posting rules and validation states for:
    - inventory transfer movements
    - delivery order lifecycle transitions
    - shift lifecycle and petty cash balance checks
    - cylinder serial transitions in sync events
  - Validation failures generate `SyncReview` records and reject push rows.
- `apps/api/src/modules/transfers/*`:
  - Transfer lifecycle endpoints:
    - `POST /api/transfers`
    - `POST /api/transfers/:id/approve`
    - `POST /api/transfers/:id/post`
    - `POST /api/transfers/:id/reverse`
  - Server-authoritative stock movement checks at posting and reversal time.
  - Inventory snapshot endpoint for verification:
    - `GET /api/transfers/inventory/snapshot?location_id=<id>&product_id=<id>`
- `apps/api/src/modules/delivery/*`:
  - Delivery order lifecycle endpoints:
    - `POST /api/delivery/orders`
    - `POST /api/delivery/orders/:id/assign`
    - `POST /api/delivery/orders/:id/status`
    - `GET /api/delivery/orders/:id/events`
  - Append-only delivery status event persistence for audit trail retrieval.
- `apps/api/src/modules/reports/*`:
  - Online reporting endpoints:
    - `GET /api/reports/petty-cash/summary`
    - `GET /api/reports/petty-cash/entries`
    - `GET /api/reports/sales/summary`
    - `GET /api/reports/sales/by-sku`
    - `GET /api/reports/sales/by-branch`
    - `GET /api/reports/sales/by-cashier`
    - `GET /api/reports/sales/xz-read`
    - `GET /api/reports/inventory/movements`
    - `GET /api/reports/inventory/full-empty`
    - `GET /api/reports/financial/gross-margin`
    - `GET /api/reports/financial/deposit-liability`
    - `GET /api/reports/audit-logs`
  - Report data is tenant-routed and DB-backed in runtime DB mode, with fallback behavior preserved for non-DB test/local fallback execution.
- `apps/web/src/app/(admin)/reports/page.tsx`:
  - Online dashboard for sales KPIs, X-read/Z-read, movement ledger, full-vs-empty cylinder counts, and petty cash summaries.
- `apps/web/src/app/(admin)/audit-logs/page.tsx`:
  - Read-only audit timeline table backed by `GET /api/reports/audit-logs`.

Next implementation focus:
- Remove fallback-only in-memory paths once DB-first local/staging runtime is mandated.
- Perform physical device certification matrix for printer routes (iMin built-in, Bluetooth ESC/POS, TCP ESC/POS) and finalize production printer profiles.
- Implement full web role/permission management and protected route middleware.
- Add export/print actions and date-range presets for reports/audit UX.

## 14) Milestone 6.3 Operational Hardening (Started)

Initial operational hardening artifacts are now in place:
- `docs/OPERATIONS_RUNBOOK.md`
  - 7-year retention baseline
  - backup/restore baseline steps
  - initial incident playbooks
  - staging verification checklist
- `apps/api/scripts/retention-maintenance.mjs`
  - dry-run/apply retention maintenance for audit/event operational tables
  - optional tenant-scoped execution (`--company-id`)
- `apps/api/scripts/backup-postgres.ps1`
  - logical PostgreSQL backup via `pg_dump` (`full` and `schema-only`)
- `apps/api/scripts/run-ops-maintenance.ps1`
  - combined retention + backup local maintenance runner with log capture
- `.github/workflows/ops-maintenance.yml`
  - scheduled ops automation for retention dry-run and backup
  - manual dispatch for retention apply

Workspace scripts:
- `pnpm ops:backup`
- `pnpm ops:retention:dry-run`
- `pnpm ops:retention:apply`
- `pnpm ops:maintenance`
