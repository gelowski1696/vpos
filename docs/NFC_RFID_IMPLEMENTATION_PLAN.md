# NFC/RFID Implementation Plan (Mobile)

## 1) Goal

Add NFC card support to the mobile app for fast staff workflows, starting with:

- Card tap detection and UID capture.
- Card binding to staff accounts.
- Card-based unlock/login (with PIN/password fallback).

The API remains authoritative for account state and permissions. Mobile supports offline-first behavior with safe fallbacks.

---

## 2) Scope and Non-Goals

In scope (initial releases):

- Android NFC integration on handheld devices with NFC hardware.
- Read NFC card UID and map it to a staff/user record.
- Unlock/login assistance via card tap.
- Local audit trail of tap events.

Out of scope (initial releases):

- Payment processing via NFC.
- Full cryptographic smart-card mutual auth in v1.
- iOS support (can be planned later).

---

## 3) Card and Hardware Compatibility

NFC on Android typically supports 13.56MHz tags/cards (ISO14443/ISO15693 families).  
Many "RFID" cards in operations are 125kHz prox cards, which are not readable by phone NFC.

### 3.1 Required validation before coding

1. Confirm device NFC support:
   - `adb shell pm list features | findstr nfc`
   - `adb shell dumpsys nfc`
2. Confirm card frequency/type with vendor:
   - If 13.56MHz (MIFARE/NTAG/etc): proceed with phone NFC.
   - If 125kHz only: require external reader or different cards.

---

## 4) Recommended Delivery Phases

## Phase 0: Discovery and Device Validation

- Verify NFC adapter availability on target devices.
- Verify actual card type and read success on sample cards.
- Document supported card/tag families in testing notes.

## Phase 1: NFC Reader Foundation (No Auth Yet)

- Add Android NFC permissions/features.
- Build native bridge module for reader start/stop and tag callback.
- Expose JS service:
  - `isAvailable()`
  - `startScan()`
  - `stopScan()`
  - `onTagDetected(listener)`
- Add a small debug screen or Settings panel to display:
  - UID
  - Tech list
  - Timestamp

## Phase 2: Card Binding (Admin/Owner-Managed)

- Add local + server model for card bindings.
- Add API endpoint(s) to bind/unbind cards to staff.
- Add mobile UI flow:
  - Select user -> tap card -> confirm bind.
- Block duplicate active binding by UID.

## Phase 3: Card-Based Unlock/Login

- On unlock/login screen, add "Tap card" mode.
- Resolve UID -> user mapping.
- Require account active + role allowed + tenant/branch checks.
- Keep PIN/password fallback.

## Phase 4: Hardening and Audit

- Add tap event logging (success/failure reasons).
- Add lockout/rate-limit rules for repeated failed taps.
- Add replay/cooldown guard to avoid duplicate tap processing.

---

## 5) Technical Architecture

## 5.1 Mobile Layers

1. Native Android NFC bridge:
   - Handles `NfcAdapter`, reader mode, intent parsing, UID extraction.
2. JS NFC service:
   - Normalizes native payload and emits app events.
3. Auth integration:
   - Unlock/login screens consume NFC events.
4. Data layer:
   - Stores card bindings and tap logs locally.
   - Syncs with API when online.

## 5.2 Suggested Code Placement

- Native bridge:
  - `apps/mobile/android/app/src/main/java/.../nfc/`
- JS service:
  - `apps/mobile/src/features/nfc/nfc.service.ts`
  - `apps/mobile/src/features/nfc/nfc.types.ts`
  - `apps/mobile/src/features/nfc/nfc.hooks.ts`
- UI:
  - `apps/mobile/src/app/screens/SettingsScreen.tsx` (debug and bind tools)
  - unlock/login portions in `apps/mobile/App.tsx`

---

## 6) Android Integration Details

## 6.1 Manifest updates

Add:

- `<uses-permission android:name="android.permission.NFC" />`
- `<uses-feature android:name="android.hardware.nfc" android:required="false" />`

Use `required=false` if app must still run on non-NFC devices.

## 6.2 Reader mode strategy

Prefer foreground reader mode while specific screens are active:

- Unlock/Login
- Card Binding
- NFC Debug

Do not keep scanning globally in background.

## 6.3 Tag payload normalization

Normalize at bridge level:

- `uidHex` (uppercase, no separators).
- `techList` (e.g., `NfcA`, `IsoDep`, `MifareClassic`).
- `at` timestamp (ISO string).
- `rawIdBytes` optional (for diagnostics).

---

## 7) Data Model

## 7.1 Local tables (mobile SQLite)

### `nfc_cards_local`

- `id` TEXT PK
- `uid` TEXT UNIQUE (normalized UID)
- `owner_type` TEXT (`USER`)
- `owner_id` TEXT
- `status` TEXT (`active`, `inactive`)
- `created_at` TEXT
- `updated_at` TEXT
- `sync_status` TEXT (`pending`, `synced`, `failed`, `needs_review`)

### `nfc_tap_events_local`

- `id` TEXT PK
- `uid` TEXT
- `context` TEXT (`unlock`, `login`, `bind`, `debug`)
- `result` TEXT (`matched`, `not_found`, `inactive_user`, `denied`, `error`)
- `message` TEXT NULL
- `created_at` TEXT
- `sync_status` TEXT

## 7.2 Server model

Equivalent canonical tables with tenant/branch scope and audit fields.

---

## 8) API Contract (Proposed)

## 8.1 Card binding endpoints

- `POST /nfc/cards/bind`
- `POST /nfc/cards/unbind`
- `GET /nfc/cards?owner_id=...`

Rules:

- UID must be unique among active bindings.
- Only authorized roles can bind/unbind.
- Write audit log for every change.

## 8.2 Tap resolution endpoint (optional)

- `POST /nfc/cards/resolve`
  - Input: UID, device_id, tenant context.
  - Output: mapped user summary if allowed.

Useful when local cache is stale and network is available.

---

## 9) Security Model

## 9.1 Minimum secure baseline

- Never grant privileged access on UID alone without account checks.
- On tap:
  - Verify mapped user exists and is active.
  - Verify role permits requested operation.
  - Verify tenant/branch context validity.
- Enforce short cooldown per UID (for duplicate taps).

## 9.2 Hardening recommendations

- Add failed-tap throttling and temporary lockout.
- Log every authentication attempt and decision reason.
- Plan migration to secure-card cryptographic challenge for high-security deployments.

---

## 10) UX Flows

## 10.1 Unlock screen

- Show "Tap RFID/NFC card" action.
- While waiting: visible scan state + cancel.
- On success: proceed to READY.
- On failure: clear reason + fallback to PIN.

## 10.2 Login screen

- Optional "Tap card to identify account".
- After account resolution:
  - Either continue with PIN.
  - Or full tap-login if policy allows.

## 10.3 Card binding flow

1. Select user.
2. Tap card.
3. Confirm binding and status.
4. Show success and audit entry reference.

---

## 11) Offline Behavior

- Card lookup should work offline using local synced bindings.
- Binding changes queue to outbox when offline.
- Sync conflict policy:
  - Duplicate UID or revoked user -> `needs_review`.
- Keep fallback auth methods always available.

---

## 12) Testing Plan

## 12.1 Device tests

- NFC available/unavailable devices.
- Multiple card types (supported and unsupported).
- Rapid repeated taps.
- Screen transitions while scan active.

## 12.2 Functional tests

- Bind new card.
- Re-bind existing UID (reject).
- Unbind/rebind flow.
- Unlock success/failure reasons.
- Offline unlock with synced data.

## 12.3 Security tests

- Inactive user card tap denied.
- Wrong-tenant mapping denied.
- Rate-limit behavior on repeated failed taps.

---

## 13) Rollout Plan

## Stage A (Internal)

- Enable NFC debug screen only.
- Validate hardware and card compatibility in production-like devices.

## Stage B (Pilot)

- Enable bind + unlock for selected branches/users.
- Monitor tap success rate and failure reasons.

## Stage C (General)

- Enable for all supported Android devices.
- Keep PIN/password fallback mandatory.

---

## 14) Implementation Checklist

- [ ] Validate card frequency/type with vendor.
- [ ] Add Android manifest NFC entries.
- [ ] Build native NFC bridge.
- [ ] Build JS NFC service and event handling.
- [ ] Add local tables (`nfc_cards_local`, `nfc_tap_events_local`).
- [ ] Add bind/unbind API endpoints and audit logging.
- [ ] Add unlock/login tap flows with fallback.
- [ ] Add offline queue + sync conflict handling.
- [ ] Add diagnostics in Settings.
- [ ] Complete device, functional, and security tests.
- [ ] Pilot rollout and metrics review.

---

## 15) Risks and Mitigations

1. Wrong card type (125kHz) blocks feature.
   - Mitigation: confirm card specs before implementation.
2. UID clone risk.
   - Mitigation: account checks, rate limit, audit, later crypto cards.
3. Device-specific NFC behavior differences.
   - Mitigation: pilot on each hardware model before broad rollout.
4. Offline stale bindings.
   - Mitigation: sync freshness indicator and fallback auth paths.

