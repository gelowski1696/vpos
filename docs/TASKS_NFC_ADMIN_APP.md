# NFC Admin App Tasks

## Goal

Deliver a separate mobile app for NFC/RFID card administration that securely manages card enrollment and lifecycle, integrated with existing VPOS API and tenant security model.

Implementation guide: [NFC_ADMIN_APP_IMPLEMENTATION.md](d:/vpos/docs/NFC_ADMIN_APP_IMPLEMENTATION.md)

## Status Legend

- `[DONE]` completed and validated
- `[IN PROGRESS]` partially implemented
- `[PENDING]` not started
- `[BLOCKED]` waiting on external dependency

---

## A) Discovery and Prerequisites

- `[PENDING]` Confirm target devices expose Android NFC feature.
- `[PENDING]` Confirm all operational cards are NFC-readable (13.56MHz), not only 125kHz prox.
- `[PENDING]` Define final admin roles allowed to manage cards.
- `[PENDING]` Confirm package/app naming and distribution channel for separate admin APK.

Acceptance:

- Device and card compatibility matrix documented in `docs/TESTING.md`.

---

## B) Backend Data and API

- `[DONE]` Add Prisma models/tables:
  - `NfcCard`
  - `NfcCardEvent`
- `[DONE]` Add DB constraints:
  - tenant-scoped UID uniqueness for active bindings.
- `[DONE]` Create NFC admin endpoints:
  - bind
  - edit/reassign
  - deactivate/reactivate
  - revoke
  - list/search
  - audit list
- `[DONE]` Add role guards and tenant guards for all NFC endpoints.
- `[DONE]` Add audit log emission for all card management actions.
- `[DONE]` Add structured API error codes for NFC flows.

Acceptance:

- API typecheck/build pass.
- Endpoint e2e tests for role/tenant enforcement pass.

---

## C) New App Bootstrap (`apps/mobile-nfc-admin`)

- `[DONE]` Create new workspace app scaffold.
- `[DONE]` Configure package id, display name, app icon, env loading.
- `[PENDING]` Add base modules:
  - auth
  - API client
  - local DB
  - outbox/sync
- `[PENDING]` Reuse shared styles/components where practical.

Acceptance:

- App boots on Android and authenticates to API.

---

## D) NFC Native Integration

- `[DONE]` Add Android NFC manifest permission/feature.
- `[DONE]` Build native NFC reader bridge in new app.
- `[DONE]` Add JS NFC service wrapper:
  - availability check
  - start/stop reader
  - tag event callback
- `[DONE]` Add NFC diagnostics screen (UID + tech list + timestamp).

Acceptance:

- Real card tap emits normalized UID in diagnostics screen on target hardware.

---

## E) Card Management UI

- `[DONE]` Build `Card List` screen with search/filter.
- `[DONE]` Build `Enroll Card` flow:
  - choose user
  - tap card
  - confirm bind
- `[DONE]` Build `Card Detail` actions:
  - reassign owner
  - deactivate/reactivate
  - revoke
- `[DONE]` Build `Replace Lost Card` guided flow.
- `[DONE]` Build `Audit Events` screen.

Acceptance:

- Admin can complete end-to-end card lifecycle from app UI.

---

## F) Offline and Sync Behavior

- `[DONE]` Add local persistence for card and event records.
- `[DONE]` Queue management writes to outbox when offline.
- `[DONE]` Add conflict handling (`needs_review`) for duplicate UID or stale ownership.
- `[DONE]` Add sync status badges and retry actions.

Acceptance:

- Enrollment/edit actions survive offline and reconcile correctly after reconnect.

---

## G) Security and Policy Hardening

- `[DONE]` Enforce admin-only access to all NFC management screens.
- `[DONE]` Add tap dedup cooldown in enrollment flow.
- `[DONE]` Add destructive-action confirmations (revoke/reassign).
- `[DONE]` Add explicit tenant/company indicators in UI to avoid wrong-tenant actions.
- `[DONE]` Add audit export endpoint or CSV view (optional).

Acceptance:

- Unauthorized roles blocked.
- All sensitive operations produce auditable events.

---

## H) QA and UAT

- `[PENDING]` Device matrix test:
  - NFC-enabled Android models
  - non-NFC fallback behavior
- `[PENDING]` Functional test matrix:
  - bind, rebind, duplicate bind, revoke, reactivate, reassign
- `[PENDING]` Security tests:
  - role denial
  - tenant mismatch denial
  - inactive owner constraints
- `[PENDING]` Pilot UAT with real branch admin operators.

Acceptance:

- UAT sign-off with no high-severity blockers.

---

## I) Deployment and Operations

- `[PENDING]` Build release APK for `mobile-nfc-admin`.
- `[PENDING]` Define install SOP for admin devices.
- `[PENDING]` Add runbook section for:
  - lost card
  - compromised card
  - card replacement
  - emergency revoke
- `[PENDING]` Add monitoring:
  - card bind count
  - failed operations
  - audit event volume.

Acceptance:

- Production rollout checklist completed and documented.

---

## Milestones

- `M1`: Backend schema + endpoints + guard rails ready.
- `M2`: NFC admin app bootstrapped with diagnostics.
- `M3`: Full card lifecycle UI + sync.
- `M4`: Security hardening + UAT pass.
- `M5`: Production rollout.

---

## Immediate Next 5 Tasks (Execution Starter)

1. `[DONE]` Create `apps/mobile-nfc-admin` scaffold and wire workspace scripts.
2. `[DONE]` Add backend Prisma models + migration for `NfcCard` and `NfcCardEvent`.
3. `[DONE]` Implement `POST /api/nfc/cards/bind` with tenant+role enforcement.
4. `[DONE]` Implement Android NFC bridge + diagnostics screen in new app.
5. `[DONE]` Implement enroll flow (select user -> tap card -> confirm bind).
