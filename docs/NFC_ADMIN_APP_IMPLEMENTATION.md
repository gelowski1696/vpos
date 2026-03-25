# NFC Admin App Implementation Guide

## 1) Purpose

This document defines how to build a separate Android app for NFC/RFID card administration:

- enroll card to user,
- reassign/edit card ownership,
- deactivate/reactivate/revoke cards,
- view card/audit records,
- sync all writes to existing VPOS API.

This app is admin-only and separate from POS operations, reducing risk and keeping POS workflow clean.

Companion task list: [TASKS_NFC_ADMIN_APP.md](d:/vpos/docs/TASKS_NFC_ADMIN_APP.md)

---

## 2) Product Boundary

## 2.1 In scope

- New app in monorepo (suggested path: `apps/mobile-nfc-admin`).
- Admin authentication against VPOS API.
- NFC UID capture and card binding management.
- Tenant-scoped card management with full audit trail.

## 2.2 Out of scope (v1)

- POS sales/payment via NFC.
- iOS support.
- Cryptographic smart-card mutual authentication (future hardening phase).

---

## 3) Target Architecture

## 3.1 App architecture

- New React Native + Expo Dev Client app (same stack pattern as `apps/mobile`).
- Native Android NFC bridge module inside new app’s android project.
- Offline-capable local cache + outbox for management operations.

## 3.2 API architecture

The app uses existing API host (`apps/api`) and new NFC admin endpoints:

- `POST /api/nfc/cards/bind`
- `PATCH /api/nfc/cards/:id`
- `POST /api/nfc/cards/:id/revoke`
- `GET /api/nfc/cards`
- `GET /api/nfc/audit`

All endpoints must be tenant-aware and role-guarded.

---

## 4) Security Model

## 4.1 Roles

Allow only `platform_owner` / `owner` / authorized admin roles.

Deny NFC admin operations for cashier/driver/helper roles.

## 4.2 Trust model

- UID is treated as an identifier, not full proof of identity.
- Every bind/resolve action must verify:
  - tenant scope,
  - user active status,
  - role/permission policy.

## 4.3 Required controls

- Per-tenant UID uniqueness for active cards.
- Lost card revoke flow.
- Full audit entries for bind/reassign/revoke/reactivate.
- Optional rate-limit on repeated failed card actions.

---

## 5) Data Contract

## 5.1 Server tables (proposed)

### `NfcCard`

- `id`
- `companyId`
- `uid` (normalized uppercase hex)
- `ownerType` (`USER`)
- `ownerId`
- `status` (`ACTIVE|INACTIVE|REVOKED`)
- `assignedAt`
- `revokedAt`
- `createdAt`, `updatedAt`

Unique constraints:

- `(companyId, uid)` unique for active lifecycle path.

### `NfcCardEvent` (append-only)

- `id`
- `companyId`
- `cardId`
- `eventType` (`BIND|REASSIGN|DEACTIVATE|REACTIVATE|REVOKE`)
- `actorUserId`
- `payload` (JSON)
- `createdAt`

## 5.2 Mobile local tables (proposed)

- `nfc_cards_local`
- `nfc_card_events_local`
- outbox records for pending operations.

---

## 6) UX Flows

## 6.1 Login

- Admin signs in to tenant.
- Guard non-admin roles immediately.

## 6.2 Enroll card

1. Select user.
2. Tap card.
3. Show UID + preview details.
4. Confirm bind.
5. Show success and audit ID.

## 6.3 Reassign card

1. Search card by UID or current owner.
2. Select new owner.
3. Confirm reassignment with warning.
4. Save + audit.

## 6.4 Revoke/replace

- Revoke card instantly.
- Optional “replace flow”: revoke old + bind new in one sequence.

## 6.5 Audit view

- Filter by date, actor, event type, owner.
- Show immutable event timeline.

---

## 7) NFC Technical Integration

## 7.1 Manifest requirements

- `android.permission.NFC`
- `android.hardware.nfc` feature (`required=false` if optional install support needed)

## 7.2 Reader mode

Enable NFC scan only in dedicated screens:

- Enroll
- Replace
- NFC diagnostics

Stop scan on unmount/background.

## 7.3 Payload normalization

Return consistent object:

- `uidHex`
- `techList`
- `timestamp`

---

## 8) App Module Structure (Suggested)

- `apps/mobile-nfc-admin/src/features/auth`
- `apps/mobile-nfc-admin/src/features/nfc`
- `apps/mobile-nfc-admin/src/features/cards`
- `apps/mobile-nfc-admin/src/features/audit`
- `apps/mobile-nfc-admin/src/features/sync`
- `apps/mobile-nfc-admin/src/db`
- `apps/mobile-nfc-admin/src/outbox`

Android native bridge:

- `apps/mobile-nfc-admin/android/app/src/main/java/.../nfc/*`

---

## 9) API Integration Requirements

## 9.1 Request headers/context

- Use same auth token model as existing mobile/web.
- Include tenant context expected by API guard.

## 9.2 Error contract

API should return machine-readable errors:

- `NFC_UID_ALREADY_BOUND`
- `NFC_CARD_NOT_FOUND`
- `NFC_OWNER_INACTIVE`
- `NFC_ROLE_FORBIDDEN`
- `NFC_TENANT_MISMATCH`

---

## 10) Deployment Model

## 10.1 Build/release

- Separate APK and package id from POS app.
- Distinct app icon/name (“VPOS NFC Admin”).

## 10.2 Device policy

- Install on supervisor/admin devices only.
- Not required on cashier POS devices.

---

## 11) Testing Strategy

## 11.1 Functional

- Enroll valid card to active user.
- Duplicate UID bind blocked.
- Reassign/revoke flows.
- Audit row generation for every management action.

## 11.2 Security

- Non-admin cannot open protected modules.
- Cross-tenant operation denied.
- Inactive user cannot be active card owner.

## 11.3 Device

- NFC available and unavailable devices.
- Supported tag families.
- Fast repeated tap deduplication.

---

## 12) Rollout Plan

1. Internal sandbox rollout.
2. Pilot branch admins.
3. Full production with SOP/training.
4. Optional hardening phase: secure-card cryptographic challenge.

---

## 13) Risks and Mitigation

1. Card type mismatch (125kHz vs 13.56MHz).
   - Mitigation: validate hardware/card inventory before build.
2. UID clone risk.
   - Mitigation: admin-only enrollment + audit + revoke + (future) cryptographic card support.
3. API misuse.
   - Mitigation: strict role guards + tenant-scoped unique constraints + audit.
4. Operational errors during reassignment.
   - Mitigation: explicit confirmation UX + replace wizard + event history.

