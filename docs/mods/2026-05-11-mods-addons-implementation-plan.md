# MODS Add-ons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the new `mods.md` requests as tenant-level add-ons (toggle ON/OFF), excluding already-existing capabilities.

**Architecture:** Extend the existing tenant add-on framework (`Company` add-on booleans + entitlements API + owner tenant add-on UI) and gate each new module/feature path at API and UI levels. Keep all new modules disabled by default and fail closed when disabled.

**Tech Stack:** Prisma, NestJS API, Next.js Web Admin, React Native Mobile, Tauri Desktop.

---

## Scope Baseline (Excluded Existing)

The following are already implemented and are **not included** in this plan:
- Existing tenant add-ons:
  - `email_features`
  - `email_report`
  - `email_customer_balance`
  - `custom_pricing`
  - `customer_category`
- Existing product behavior already in codebase:
  - Non-LPG vs LPG flow handling
  - Deposit amount support

From `docs/mods/mods.md`, Feature `1` and Feature `2` are treated as already covered and excluded from this new plan.

---

## Add-on Catalog (New)

All below are new add-ons, OFF by default:

1. `item_price_cost_audit`  
   Covers mods Feature 3 (Item Price/Cost Monitoring).

2. `petty_cash_attachments`  
   Covers mods Feature 4 (Petty Cash with Picture Attachment).

3. `shift_security_controls`  
   Covers mods Feature 5 (End Shift security enhancements, discrepancy notification, cashier visibility rules).

4. `kilo_overview_chart`  
   Covers mods Feature 6 (Overview Total Kilo Chart).

5. `receipt_amount_privacy`  
   Covers mods Feature 7 (Per-transaction hide amount/total option in receipt output).

6. `purchase_order_suite`  
   Covers mods Feature 8.1, 8.2, 8.3 as one cohesive add-on.

7. `delivery_dispatch_suite`  
   **Combined add-on** for dependent features: mods Feature 9.x + 10.x (filter/assignment, rider list access, status lifecycle, CSV export, cashier validation complete status).

---

## Clarifications Required Per Feature (Before Build)

### Feature 3: Item Price/Cost Monitoring (`item_price_cost_audit`)
1. Do we need monitoring only in Web Admin, or also viewable in Mobile/Desktop?
2. Should this log every create/update, or only when price/cost value actually changes?
3. Required fields in audit log: old/new price, old/new cost, user, timestamp, reason note?
4. Do we need approval flow for price/cost changes, or audit-only first?

### Feature 4: Petty Cash with Picture Attachment (`petty_cash_attachments`)
1. Maximum attachments per petty cash entry (1 or multiple)?
2. Storage target: DB blob, local file + URL, or object storage (S3-compatible)?
3. Max file size and allowed formats (jpg/png/pdf)?
4. Is attachment required or optional per entry type (`IN`/`OUT`)?

### Feature 5: Enhanced End Shift Security (`shift_security_controls`)
1. Exact formula for `Item Logs Count` (which entities count as item logs)?
2. Discrepancy threshold: any mismatch, or configurable tolerance?
3. Owner notification channels: in-app only, email, both?
4. "Hide inventory reports from cashier": hide menu only or hard API block too? (recommended: both)

### Feature 6: Overview Total Kilo Chart (`kilo_overview_chart`)
1. Kilo source: cylinder type `weightKg`, item master field, or transaction payload?
2. Scope selector needed (`Today/Week/Month`, per branch, per location)?
3. Should chart include both LPG and non-LPG, or LPG only?
4. Which screens: web dashboard only, or also mobile/desktop dashboards?

### Feature 7: Receipt Customization - Hide Amount (`receipt_amount_privacy`)
1. Who can enable hide-amount per transaction (cashier, supervisor, admin)?
2. Should hidden amounts apply to printed receipt only, or also on-screen summary?
3. Audit requirement: store who enabled hide-amount and why?
4. Should this be blocked if payment method is credit/balance (compliance concern)?

### Feature 8: Purchase Order Function (`purchase_order_suite`)
1. Supplier master required now, or free-text supplier first phase?
2. PO statuses required (Draft, Submitted, Partially Received, Completed, Cancelled)?
3. Partial receive behavior: can one PO line be received across multiple events?
4. Pullout behavior: linked to PO only, or also standalone stock-out adjustment?
5. Attachment types for PO (delivery receipt/invoice/photo) and retention policy?

### Feature 9 + 10: Delivery Flow (`delivery_dispatch_suite`) - Combined Add-on
1. Rider access method priority: QR deep-link only, web login only, or both?
2. Do riders have restricted roles per tenant/branch?
3. Delivery status transitions: keep strict flow (`CREATED -> ASSIGNED -> OUT_FOR_DELIVERY -> DELIVERED -> COMPLETE`)?
4. "Complete requires cashier validation": does this lock payment reconciliation until validated?
5. CSV export schema: required columns and timezone format?
6. Should failed/returned deliveries re-open queue or mark terminal?

---

## Clarification Answer Log

Use this section to answer before implementation.  
Format: `F<feature>-Q<no>: <answer>`.

### Feature 3 (`item_price_cost_audit`)
- `F3-Q1`: Monitoring surfaces (Web only / Web+Mobile+Desktop): **Web only**
- `F3-Q2`: Log scope (all updates / only value changes): **All updates**
- `F3-Q3`: Required fields in audit record: **`company_id`, `item_id`, `sku_snapshot`, `name_snapshot`, `old_price`, `new_price`, `old_cost`, `new_cost`, `change_reason` (optional), `changed_by_user_id`, `changed_by_role`, `source_channel` (web/mobile/desktop/api), `request_id` (optional), `created_at`**
- `F3-Q4`: Approval flow needed now? (yes/no): **No, audit-only first**

### Feature 4 (`petty_cash_attachments`)
- `F4-Q1`: Max attachments per petty cash entry: **3**
- `F4-Q2`: Storage target (DB blob / file URL / object storage): **Local file + URL**
- `F4-Q3`: Allowed formats + max size: **Image formats only, max 5 MB each**
- `F4-Q4`: Attachment required or optional: **Optional**

### Feature 5 (`shift_security_controls`)
- `F5-Q1`: Item logs count formula: **Count distinct inventory movement rows within shift window (`shift_opened_at` to `shift_closed_at` or now), same tenant + branch, where any of `qty_delta`, `qty_full_delta`, `qty_empty_delta` is non-zero; exclude replay/system-only rows**
- `F5-Q2`: Discrepancy threshold rule: **Configurable tolerance**
- `F5-Q3`: Owner notification channel(s): **Both (in-app + email)**
- `F5-Q4`: Cashier inventory report restriction level: **Both (hide menu + hard API block)**

### Feature 6 (`kilo_overview_chart`)
- `F6-Q1`: Kilo source: **Item master field**
- `F6-Q2`: Required filters/scope: **Per branch**
- `F6-Q3`: Coverage (LPG only / LPG+non-LPG): **LPG + non-LPG**
- `F6-Q4`: Target screens (web/mobile/desktop): **Web dashboard only**

### Feature 7 (`receipt_amount_privacy`)
- `F7-Q1`: Allowed role(s) to enable hide-amount: **Cashier, Supervisor, Admin**
- `F7-Q2`: Masking scope (print only / print+on-screen): **Print + on-screen summary**
- `F7-Q3`: Audit requirement: **Yes**
- `F7-Q4`: Credit/balance restriction: **Yes, block hide-amount for credit/balance**

### Feature 8 (`purchase_order_suite`)
- `F8-Q1`: Supplier model (master / free-text): **Supplier master required**
- `F8-Q2`: Required PO statuses: **`DRAFT`, `SUBMITTED`, `PARTIALLY_RECEIVED`, `COMPLETED`, `CANCELLED`**
- `F8-Q3`: Partial receiving rules: **One PO line can be received across multiple events**
- `F8-Q4`: Pullout scope (PO-linked / standalone allowed): **PO-linked only**
- `F8-Q5`: Attachment policy: **Allowed: `jpg`, `jpeg`, `png`, `webp`, `pdf`; max `5 MB` each; max `5` files per PO; optional in `DRAFT/SUBMITTED`; require at least `1` attachment before `COMPLETED`; retain for `7 years`**

### Feature 9+10 (`delivery_dispatch_suite`)
- `F9-Q1`: Rider access method (QR / web / both): **Both**
- `F9-Q2`: Rider role restriction details: **Rider role can only access assigned deliveries for own user ID, same tenant + branch; allowed actions: status update + delivery notes/proof; forbidden: sale edits, payment edits, reassignment, and marking `COMPLETE`**
- `F9-Q3`: Status transition policy: **Yes, keep strict transition policy**
- `F9-Q4`: Complete-status cashier validation behavior: **Yes, cashier validation required before complete**
- `F9-Q5`: CSV schema + timezone: **Columns: `delivery_id`, `sale_id`, `receipt_no`, `customer_name`, `customer_address`, `rider_name`, `branch_name`, `status`, `assigned_at_utc`, `out_for_delivery_at_utc`, `delivered_at_utc`, `completed_at_utc`, `cashier_validated_by`, `notes`; timezone: include UTC ISO columns and computed local-time columns using branch timezone; fallback timezone `UTC`**
- `F9-Q6`: Failed/returned handling: **Re-open queue**

### Finalized by Safe Defaults
- Remaining TBD values were resolved with conservative defaults to keep implementation safe, auditable, and backward-compatible.

---

## Implementation Plan Tasks

### Task 1: Extend Add-on Schema, DTOs, and Owner Add-on UI

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_mods_addons_flags/migration.sql`
- Modify: `apps/api/src/modules/entitlements/entitlements.service.ts`
- Modify: `apps/api/src/modules/entitlements/entitlements.controller.ts`
- Modify: `apps/web/src/app/(admin)/tenants/page.tsx`

- [x] Add new `Company` boolean fields for 7 add-ons (default `false`).
- [x] Wire fields into add-on mapping methods (`defaultTenantAddons`, map, update input resolver).
- [x] Extend owner add-on update API payload/response.
- [x] Add new checkbox controls in Owner Tenant Console add-on modal.
- [x] Add audit metadata on add-on toggle changes.

### Task 2: Shared Add-on Guard Pattern for API + UI

**Files:**
- Modify: `apps/api/src/modules/entitlements/entitlements.service.ts`
- Modify: `apps/api/src/modules/master-data/master-data.service.ts`
- Modify: `apps/web/src/components/admin-shell.tsx` (if menu hiding is required)
- Modify: relevant module screens (web/mobile/desktop) as each add-on is wired

- [x] Add reusable helper for `isAddonEnabled(companyId, addonKey)`.
- [x] Add reusable guard helper `enforceAddonPolicy(addonKey, companyId, label)`.
- [x] Define fail-closed behavior: API returns `403` when disabled.
- [x] Define UI behavior: hide entry points and show "Add-on not enabled" guard screens where needed.

### Task 3: Feature 3 - Item Price/Cost Monitoring

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_item_price_cost_audit/migration.sql`
- Modify: `apps/api/src/modules/master-data/master-data.service.ts`
- Modify: `apps/api/src/modules/master-data/master-data.controller.ts`
- Modify: `apps/web/src/app/(admin)/products/page.tsx`

- [x] Add `ItemPriceCostAudit` table (item, old/new values, actor, source, timestamp).
- [x] Log audit row on item create/update when price/cost changes.
- [x] Gate access behind `item_price_cost_audit`.
- [x] Add web UI section/history table for item price/cost changes.

### Task 4: Feature 4 - Petty Cash Picture Attachment

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_petty_cash_attachments/migration.sql`
- Modify: `apps/api/src/modules/sync/sync.service.ts`
- Modify: `apps/api/src/modules/reports/reports.service.ts`
- Modify: `apps/mobile/src/app/screens/ExpenseScreen.tsx`
- Modify: `apps/desktop/src/screens/ExpenseScreen.tsx`
- Modify: `apps/web/src/app/(admin)/reports/page.tsx` (if attachment preview/reporting needed)

- [x] Add petty-cash attachment entity schema + retention metadata.
- [x] Extend offline payload and sync posting for attachment references.
- [x] Add upload/select UI in mobile/desktop petty cash entry flow.
- [x] Gate create/view by `petty_cash_attachments`.

### Task 5: Feature 5 - Enhanced End Shift Security

**Files:**
- Modify: `apps/api/src/modules/reports/reports.service.ts`
- Modify: `apps/api/src/modules/sync/sync.service.ts`
- Modify: `apps/mobile/src/app/screens/ShiftScreen.tsx`
- Modify: `apps/desktop/src/screens/ShiftScreen.tsx`
- Modify: `apps/web/src/app/(admin)/reports/page.tsx`

- [x] Add item-log counting in end-shift summary dataset.
- [x] Add discrepancy detection rule (cash + item logs).
- [x] Trigger owner notification event payload on mismatch.
- [x] Add cashier report visibility gating behind `shift_security_controls`.

### Task 6: Feature 6 - Overview Total Kilo Chart

**Files:**
- Modify: `apps/api/src/modules/reports/reports.service.ts`
- Modify: `apps/api/src/modules/reports/reports.controller.ts`
- Modify: `apps/web/src/app/(admin)/reports/page.tsx` and/or dashboard page

- [x] Add API endpoint/query for kilo totals by date range.
- [x] Add web dashboard chart widget and per-branch filters.
- [x] Gate chart fetch/render by `kilo_overview_chart`.

### Task 7: Feature 7 - Receipt Amount Privacy

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_receipt_amount_privacy/migration.sql`
- Modify: `apps/api/src/modules/sales/sales.service.ts`
- Modify: `apps/api/src/modules/printing/*` (receipt formatter path)
- Modify: `apps/mobile/src/app/screens/PosScreen.tsx`
- Modify: `apps/desktop/src/screens/PosScreen.tsx`

- [ ] Add per-transaction flag to hide amounts.
- [ ] Add POS toggle (conditional on add-on enabled).
- [ ] Apply masking in print payload/renderer and on-screen payment summary.
- [ ] Add audit metadata for masked receipts.

### Task 8: Feature 8 - Purchase Order Suite

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_purchase_order_suite/migration.sql`
- Create/Modify: `apps/api/src/modules/purchase-orders/*` (new module)
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/web/src/components/admin-shell.tsx`
- Create/Modify: `apps/web/src/app/(admin)/purchase-orders/page.tsx`
- Optional later: `apps/mobile/src/app/screens/*`, `apps/desktop/src/screens/*`

- [ ] Create PO entities (header, lines, receipts/partials, pullout, attachments).
- [ ] Implement PO create/list/detail/receive/pullout APIs.
- [ ] Apply stock movements with complete audit chain.
- [ ] Gate all PO routes/UI behind `purchase_order_suite`.

### Task 9: Feature 9 + 10 - Delivery Dispatch Suite (Combined Add-on)

**Files:**
- Modify: `apps/api/src/modules/delivery/delivery.service.ts`
- Modify: `apps/api/src/modules/delivery/delivery.controller.ts`
- Modify: `apps/api/src/modules/sync/sync.service.ts`
- Modify: `apps/web/src/app/(admin)/sales-list/page.tsx`
- Modify: `apps/web/src/app/(admin)/reports/page.tsx`
- Create/Modify: rider access page(s) under `apps/web/src/app/*`

- [ ] Add tenant-gated delivery assignment/filtering UI and APIs.
- [ ] Add rider-specific delivery list access flow (QR/web).
- [ ] Add CSV export endpoint and UI action.
- [ ] Enforce transition rules including cashier validation for final completion.
- [ ] Gate all delivery suite features behind `delivery_dispatch_suite`.

### Task 10: Tests, Rollout, and Migration Safety

**Files:**
- Modify: `apps/api/test/app.e2e-spec.ts`
- Create/Modify: feature-focused tests per new module
- Modify: `docs/` rollout docs

- [ ] Add tests for ON/OFF behavior for each add-on (403 when off, success when on).
- [ ] Add migration + rollback notes for each schema change.
- [ ] Add tenant rollout checklist (pilot tenant, staged enablement, observability).
- [ ] Add production smoke checklist for web/mobile/desktop paths touched by each enabled add-on.

---

## Delivery Sequence (Recommended)

1. Task 1 + Task 2 (framework first)
2. Task 9 (`delivery_dispatch_suite`) because it bundles dependent features
3. Task 8 (`purchase_order_suite`)
4. Task 3, Task 4, Task 5, Task 6, Task 7
5. Task 10 hardening/tests/docs

---

## Acceptance Criteria

- Every new mods feature in scope is controlled by a tenant add-on flag.
- Disabled add-ons are hidden/blocked consistently (UI + API).
- Existing capabilities remain unchanged for tenants with add-ons OFF.
- Owner Tenant Console can toggle all new add-ons with audit trail.
- Combined dependency bundle exists: `delivery_dispatch_suite` for features 9+10.
