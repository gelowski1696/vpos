# V-CARD Points System Implementation Plan (Platform + Tenant Model)

## 1) Objective

Build `V-CARD` as an NFC/RFID card management and points app with this operating model:

- No login screen in app UI.
- App loads all tenants, branches, and locations (based on device authorization scope).
- Platform Owner manages card inventory lifecycle across tenants.
- Tenant Admin assigns cards to customers and runs day-to-day customer card actions.
- Cards are used for customer loyalty points (earn/redeem/adjust).

---

## 2) Governance and Role Boundary

## 2.1 Platform Owner scope (global)

Platform owner can:

- create card records (card pool) for any tenant,
- edit card metadata (card number, serial, URL/template fields),
- move card allocation between tenants/branches,
- deactivate/reactivate/revoke cards at platform level,
- view full cross-tenant card and points audit.

Platform owner cannot post customer sales from this app.

## 2.2 Tenant Admin scope (tenant-only)

Tenant admin can:

- view tenant card pool and card status,
- assign card to customer,
- reassign card between customers in same tenant,
- deactivate/reactivate/revoke tenant cards,
- process customer points actions (earn/redeem/manual adjustment per policy),
- view tenant audit and points ledger.

Tenant admin cannot create global card inventory for other tenants.

---

## 3) App Access Model (No Login UI)

No credential form in app. Access is controlled by device registration.

## 3.1 Device bootstrap flow

1. Device is provisioned once by platform owner using a pairing code or admin API.
2. API returns `device_token` + allowed scope (`platform` or specific tenant scopes).
3. App stores token securely.
4. Every request uses `Authorization: Bearer <device_token>`.

## 3.2 Security requirements

- Token must be revocable from backend.
- Token rotation supported.
- Device id and app instance id included in audit.
- Rate limit sensitive endpoints.

---

## 4) Core Functional Requirement

## 4.1 Fetch all tenants + branches + locations

Add scoped tree endpoint:

- `GET /api/vcard/topology`

Returns:

- tenant list
- branches per tenant
- locations per branch
- role capabilities for current device token

---

## 5) Data Model

## 5.1 Card inventory

`CardInventory`

- `id`
- `tenant_id`
- `branch_id` (nullable for unassigned pool)
- `location_id` (nullable)
- `card_uid` (normalized)
- `card_number` (human readable)
- `serial_number`
- `card_url` (optional)
- `status` (`UNASSIGNED|ASSIGNED|INACTIVE|REVOKED`)
- `tag_type` (`NFC|RFID_UID`)
- `writable` (boolean)
- `metadata_json`
- timestamps

## 5.2 Customer card binding

`CustomerCard`

- `id`
- `tenant_id`
- `customer_id`
- `card_inventory_id`
- `assigned_by`
- `assigned_at`
- `unassigned_at` (nullable)
- `status` (`ACTIVE|INACTIVE|REVOKED`)

## 5.3 Points

`CustomerPointsLedger`

- `id`
- `tenant_id`
- `customer_id`
- `card_id` (nullable for manual adjust)
- `txn_type` (`EARN|REDEEM|ADJUST_UP|ADJUST_DOWN|EXPIRE`)
- `points`
- `source_type` (`SALE|MANUAL|SYSTEM`)
- `source_id` (nullable)
- `remarks`
- `created_by`
- `created_at`

`Customer.points_balance` (cached current balance).

---

## 6) Card Content / Recreate Payload

Support rewriting payload for writable NFC cards.

## 6.1 Writable payload fields

- `url`
- `serial_number`
- `card_number`
- `tenant_ref`
- `customer_ref` (token/reference, not full sensitive PII)
- `signature` (backend-signed checksum)

## 6.2 Important rule

For UID-only RFID cards, do not attempt write. Store identity mapping in backend only.

---

## 7) UI/UX Plan (Tab Layout)

Use VPOS-like tab navigation.

## 7.1 Tabs

- `Home`
- `Inventory`
- `Assign`
- `Customers`
- `Points`
- `Audit`
- `Settings`

## 7.2 Per-tab behavior

- `Home`: scope summary, sync status, quick actions.
- `Inventory`: card list/filter, create/edit/revoke (platform owner), tenant inventory view (tenant admin).
- `Assign`: select tenant/branch/location -> select customer -> tap card -> confirm bind.
- `Customers`: customer detail + assigned card + points balance.
- `Points`: earn/redeem/adjust + policy validation.
- `Audit`: card events + points events with filters/export.
- `Settings`: device scope, API endpoint, diagnostics, clear cache.

---

## 8) API Endpoint Plan

## 8.1 Topology + scope

- `GET /api/vcard/topology`
- `GET /api/vcard/capabilities`

## 8.2 Card inventory (platform owner)

- `POST /api/vcard/inventory/cards`
- `PATCH /api/vcard/inventory/cards/:id`
- `PATCH /api/vcard/inventory/cards/:id/move`
- `PATCH /api/vcard/inventory/cards/:id/status`
- `GET /api/vcard/inventory/cards`

## 8.3 Assignment (tenant admin + platform owner)

- `POST /api/vcard/cards/assign`
- `PATCH /api/vcard/cards/:id/reassign`
- `PATCH /api/vcard/cards/:id/unassign`
- `GET /api/vcard/cards`

## 8.4 Points

- `POST /api/vcard/points/earn`
- `POST /api/vcard/points/redeem`
- `POST /api/vcard/points/adjust`
- `GET /api/vcard/customers/:id/points-ledger`

## 8.5 Audit

- `GET /api/vcard/audit/cards`
- `GET /api/vcard/audit/points`
- `GET /api/vcard/audit/export.csv`

---

## 9) Points Policy Rules

Per-tenant configurable policy:

- earn rate (`peso_to_points_ratio`),
- redeem conversion (`points_to_peso_ratio`),
- min spend to earn,
- max redeem per transaction,
- points expiration window (optional).

Validation:

- no negative balance,
- idempotent operations using request idempotency key,
- strict tenant isolation.

---

## 10) Implementation Phases

## Phase A: Backend foundation

- schema/migrations for inventory, customer-card binding, points ledger.
- owner/admin role guards.
- topology and capabilities endpoints.

## Phase B: App shell conversion

- remove login UI.
- add device bootstrap storage.
- implement tab layout and shared state.

## Phase C: Card inventory + assignment

- platform owner inventory screens/actions.
- tenant admin assignment flow to customer.
- card lifecycle actions + audit.

## Phase D: Points system

- earn/redeem/adjust endpoints.
- customer points balance in customer screens.
- points tab + ledger + filters.

## Phase E: Card payload rewrite

- add writable-tag flow for supported NFC tags.
- payload template editor and write/verify sequence.

## Phase F: Hardening and rollout

- full audit export.
- conflict handling and offline queue sync.
- pilot rollout by tenant.

---

## 11) Acceptance Criteria

1. App starts with no login form and loads authorized topology.
2. Platform owner can create/edit/remove card inventory by tenant/branch.
3. Tenant admin can assign/reassign/revoke cards for customers in own tenant only.
4. Customer points balance updates via earn/redeem/adjust with full ledger trace.
5. Writable card payload supports URL, serial, card number, and customer reference.
6. Every card and points action is auditable with actor, tenant, device, timestamp.

---

## 12) Risks and Controls

1. UID clone risk:
   - control: audit, revoke, optional signed payload, fraud monitoring.
2. No-login misuse risk:
   - control: strong device token provisioning, revoke/rotation, IP/device telemetry.
3. Cross-tenant leakage risk:
   - control: mandatory tenant guard in all read/write endpoints.
4. Points fraud risk:
   - control: idempotency keys, policy checks, approval workflow for large manual adjustments.

