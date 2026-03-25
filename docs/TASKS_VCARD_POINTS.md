# V-CARD Points System Tasks (Platform + Tenant Model)

Implementation plan: [VCARD_POINTS_PLATFORM_PLAN.md](d:/vpos/docs/VCARD_POINTS_PLATFORM_PLAN.md)

## Status Legend

- `[DONE]` completed and validated
- `[IN PROGRESS]` partially implemented
- `[PENDING]` not started
- `[BLOCKED]` waiting on dependency

---

## A) Governance and Security Baseline

- `[PENDING]` Finalize role matrix:
  - Platform Owner: card inventory create/edit/remove/move across tenants.
  - Tenant Admin: assign/reassign/revoke customer cards inside tenant.
- `[PENDING]` Define no-login device provisioning policy (pairing + token issue).
- `[PENDING]` Define device token revoke/rotation SOP.
- `[PENDING]` Define audit retention and access policy (platform vs tenant visibility).

Acceptance:

- Role and security policy documented and approved.

---

## B) Backend Schema and Migrations

- `[DONE]` Add `CardInventory` model/table.
- `[DONE]` Add `CustomerCard` model/table.
- `[DONE]` Add `CustomerPointsLedger` model/table.
- `[DONE]` Add `customers.points_balance` cached balance column.
- `[DONE]` Add unique constraints:
  - `(tenant_id, card_uid)` scoped uniqueness
  - `(tenant_id, card_number)` scoped uniqueness
- `[DONE]` Add indexes for search/filter:
  - card status, tenant/branch/location, customer, created_at.

Acceptance:

- Prisma migration deploys cleanly and rollback plan documented.

---

## C) API Foundation

- `[DONE]` Add `GET /api/vcard/topology` (tenant -> branch -> location tree).
- `[DONE]` Add `GET /api/vcard/capabilities` (device/role capabilities).
- `[DONE]` Add owner inventory endpoints:
  - create card
  - edit metadata
  - move allocation (tenant/branch/location)
  - status change (inactive/reactivate/revoke)
  - list/filter
- `[DONE]` Add assignment endpoints:
  - assign card to customer
  - reassign customer
  - unassign
- `[DONE]` Add points endpoints:
  - earn
  - redeem
  - adjust
  - customer ledger list
- `[DONE]` Add audit endpoints:
  - card audit
  - points audit
  - CSV export

Acceptance:

- API typecheck/build pass with endpoint tests.

---

## D) Authorization and Scope Guards

- `[DONE]` Implement platform-owner-only guard for inventory global actions.
- `[DONE]` Implement tenant-admin guard for customer card assignment in tenant scope.
- `[PENDING]` Enforce tenant isolation in all queries and mutations.
- `[PENDING]` Enforce branch/location scope where required by device authorization.
- `[PENDING]` Add structured error codes for denied scope/actions.

Acceptance:

- Role and tenant negative tests pass (403/404 scope-safe behavior).

---

## E) Device Bootstrap (No Login UI)

- `[PENDING]` Remove login screen from `V-CARD`.
- `[PENDING]` Add first-run bootstrap flow:
  - pairing code/device registration
  - token issuance
  - secure token storage
- `[PENDING]` Add token refresh and revocation handling.
- `[PENDING]` Add “device disabled” fail-safe screen.

Acceptance:

- Fresh device can bootstrap and call API without login form.

---

## F) V-CARD Tab UI (VPOS-style)

- `[PENDING]` Add tabs:
  - Home
  - Inventory
  - Assign
  - Customers
  - Points
  - Audit
  - Settings
- `[PENDING]` Home tab:
  - selected scope summary
  - pending sync
  - quick actions
- `[PENDING]` Inventory tab:
  - card list with search/filter/status
  - owner-only create/edit/move/remove actions
- `[PENDING]` Assign tab:
  - select tenant/branch/location
  - select customer
  - tap card + confirm bind
- `[PENDING]` Customers tab:
  - customer list/detail
  - linked card(s)
  - points balance
- `[IN PROGRESS]` Points tab:
  - earn/redeem/adjust forms
  - policy warnings
- `[PENDING]` Audit tab:
  - card/points events
  - filter + CSV export trigger

Acceptance:

- Tab flows are functional and role-aware on target devices.

---

## G) NFC/RFID Card Data and Rewrite

- `[PENDING]` Detect card capabilities (UID-only vs writable NFC).
- `[PENDING]` Add card payload template support:
  - URL
  - serial number
  - card number
  - customer reference token
- `[PENDING]` Add write + verify sequence for writable tags.
- `[PENDING]` Add fallback mapping for UID-only cards.
- `[PENDING]` Add “recreate card content” action in card detail.

Acceptance:

- Writable tags can be updated and verified; UID-only cards remain backend-mapped.

---

## H) Points Engine and Policy

- `[DONE]` Add per-tenant points policy config:
  - earn ratio
  - redeem ratio
  - min spend
  - max redeem per transaction
  - optional expiry
- `[DONE]` Apply policy checks in API earn/redeem/adjust handlers.
- `[DONE]` Add idempotency key support to points write endpoints.
- `[DONE]` Ensure points balance cache updates atomically with ledger insert.
- `[PENDING]` Add large manual-adjust approval rule (if enabled).

Acceptance:

- Points balance and ledger are consistent under retries and duplicate requests.

---

## I) Offline and Sync

- `[PENDING]` Add outbox queue for assign/reassign/points operations.
- `[PENDING]` Add retry/backoff and `needs_review` conflict state.
- `[PENDING]` Show sync status badges in Inventory/Assign/Points screens.
- `[PENDING]` Add manual retry from failed queue items.

Acceptance:

- Operations created offline sync correctly and preserve audit history.

---

## J) Audit and Monitoring

- `[IN PROGRESS]` Emit audit events for:
  - card create/edit/move/assign/reassign/revoke
  - points earn/redeem/adjust
- `[PENDING]` Include actor, tenant, branch/location, device id, and timestamp.
- `[IN PROGRESS]` Add CSV export endpoint and app trigger button.
- `[PENDING]` Add operational metrics:
  - cards assigned
  - points redeemed
  - failed card ops
  - failed points ops

Acceptance:

- Audit is complete, queryable, and exportable.

---

## K) QA/UAT

- `[PENDING]` Device matrix test (NFC-supported and UID-only cards).
- `[PENDING]` Role matrix test (platform owner vs tenant admin restrictions).
- `[PENDING]` Cross-tenant leakage test.
- `[PENDING]` Points consistency test under network loss/retry.
- `[PENDING]` Pilot run for at least one tenant with real cards.

Acceptance:

- UAT sign-off with no high-severity blockers.

---

## L) Deployment and Runbook

- `[PENDING]` Build release APK for `V-CARD`.
- `[PENDING]` Publish install/update SOP for field devices.
- `[PENDING]` Add runbook:
  - lost card flow
  - revoke and reissue
  - points discrepancy handling
  - emergency device token revoke
- `[PENDING]` Add rollback checklist for schema/API/app changes.

Acceptance:

- Production rollout checklist completed and approved.

---

## Suggested Execution Order (First 10 Tasks)

1. `[PENDING]` Finalize role matrix and device bootstrap policy.
2. `[PENDING]` Implement schema (`CardInventory`, `CustomerCard`, `CustomerPointsLedger`, `customers.points_balance`).
3. `[DONE]` Build topology/capabilities endpoints.
4. `[DONE]` Build platform-owner inventory endpoints and guards.
5. `[DONE]` Build tenant-admin assignment endpoints and guards.
6. `[PENDING]` Remove login UI and implement device bootstrap token flow.
7. `[PENDING]` Convert app to tab UI (Home/Inventory/Assign/Customers/Points/Audit/Settings).
8. `[IN PROGRESS]` Implement points earn/redeem/adjust with policy checks.
9. `[PENDING]` Implement writable card payload write/verify + UID fallback mode.
10. `[PENDING]` Complete QA matrix and pilot rollout.
