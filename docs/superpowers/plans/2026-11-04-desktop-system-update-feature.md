# VPOS Desktop System Update Feature Plan

**Goal:** Give installed VPOS Desktop stations a secure, understandable, and recoverable way to check, download, install, and verify application updates without replacing local SQLite data or requiring a manual uninstall.

**Recommended approach:** Keep the existing Tauri v1 signed updater and the VPS endpoint at `https://vmjamtech.com/desktop-updates/latest.json`. Complete the feature as a controlled release pipeline: build and sign on a trusted Windows machine, publish immutable versioned artifacts to the VPS, publish `latest.json` last, and let the desktop Settings screen install the verified update.

**Primary platform:** Windows x64 MSI/updater bundle.

**Important boundary:** Application updates replace program files only. Local SQLite data, device setup, outbox records, cached master data, and printer settings must remain outside the installation directory and must survive every update.

## Implementation Status — 2026-11-04

Implemented in the first production-ready increment:

- version consistency command for package, Tauri, and Cargo versions;
- signed release preflight and publication PowerShell command;
- HTTPS manifest hardening, single-artifact validation, signature validation, SHA-256 checksums, and release metadata;
- public desktop update policy API with minimum version, optional/required flag, deterministic rollout percentage, release notes, and support URL;
- explicit desktop updater states and error reporting;
- Settings update safety checks for pending outbox records, active synchronization, and open shifts;
- pending-record sync action and disabled install action until the device is safe;
- persisted last update check information;
- automated API/desktop tests;
- screenshot-based Markdown, HTML, and PDF operator/cashier guide.

Intentionally deferred:

- GitHub Actions release automation remains disabled until two manual releases succeed;
- fleet telemetry and owner version dashboards require a separate privacy/retention decision;
- global required-update transaction gating should be enabled only after the optional update flow is proven on pilot workstations.

---

## 1. Current Repository Baseline

The project already contains a partial update system:

- `apps/desktop/src-tauri/tauri.conf.json`
  - updater enabled;
  - signed update public key configured;
  - manifest endpoint configured as `https://vmjamtech.com/desktop-updates/latest.json`;
  - passive Windows installation enabled.
- `apps/desktop/src/services/desktop-updater.service.ts`
  - reads the installed version;
  - checks for updates;
  - subscribes to update events;
  - installs an available update.
- `apps/desktop/src/screens/SettingsScreen.tsx`
  - exposes Check for Updates and Install Update controls.
- `apps/desktop/scripts/create-update-manifest.mjs`
  - copies the signed updater bundle into a version directory;
  - generates Tauri-compatible `latest.json`.
- `apps/desktop/package.json`
  - contains `tauri:build:ota` and `ota:manifest` commands.
- `docs/DESKTOP_OTA_DEPLOY.md`
  - documents manual VPS publication.
- `apps/desktop/release/ota/`
  - contains example signed `0.1.1` and `0.1.2` artifacts.

This means the feature does not need to be designed from zero. The remaining work is production hardening, release automation, safety checks, testing, and operator documentation.

---

## 2. Target User Experience

### Optional update

1. Desktop starts normally and checks no more than once per configured interval.
2. A non-blocking notification says `Version 0.1.3 is available`.
3. The cashier can continue working or open Settings.
4. Settings shows:
   - installed version;
   - available version;
   - release notes;
   - download/install action;
   - current update state.
5. Before installation, the app checks for an open shift, an active transaction, and pending local writes.
6. The user confirms the update.
7. The app downloads and verifies the signed package, installs it, and restarts.
8. After restart, the app displays `Updated successfully to 0.1.3` and performs a normal sync.

### Required update

Required updates should be exceptional and controlled by a server-side policy, not only by Tauri's `latest.json`.

1. The app reads `minimumSupportedVersion` and `required` from a VPOS API policy endpoint.
2. If the installed version is below the minimum supported version, the app blocks new transactions but still allows:
   - viewing update details;
   - syncing pending records;
   - exporting diagnostics;
   - installing the update;
   - signing out.
3. The app must not force-close while a sale, transfer, expense, or shift-close operation is being saved.

---

## 3. Update Architecture

```text
Trusted Windows release machine
  -> build Windows MSI + updater ZIP
  -> sign updater ZIP with Tauri private key
  -> optionally Authenticode-sign MSI/EXE
  -> generate checksums and latest.json
  -> upload immutable /desktop-updates/<version>/ files
  -> verify public URLs and signatures
  -> upload latest.json last

Installed VPOS Desktop
  -> check VPOS update policy
  -> check Tauri latest.json
  -> show release details
  -> download signed ZIP
  -> verify with embedded public key
  -> install passively
  -> restart and run startup/data checks
```

### Hosted files

```text
/var/www/vpos-desktop-updates/
  latest.json
  policy.json                         # optional first phase; API endpoint preferred later
  0.1.3/
    VPOS Desktop_0.1.3_x64_en-US.msi.zip
    VPOS Desktop_0.1.3_x64_en-US.msi.zip.sig
    SHA256SUMS.txt
    release-notes.md
```

Version directories are immutable. Only `latest.json` and the update policy may change after a release.

---

## 4. Versioning Rules

Use semantic versions: `MAJOR.MINOR.PATCH`.

- Patch: bug fixes and compatible UI/business-rule changes.
- Minor: additive features or compatible local database migrations.
- Major: breaking storage, authentication, or operating-system requirements.

The following versions must always match before a release:

- `apps/desktop/package.json`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/Cargo.toml`

Create a script that updates and validates all three files in one command. The build must fail when they disagree.

Recommended command:

```powershell
pnpm desktop:version -- 0.1.3
```

---

## 5. Security Requirements

- Keep the Tauri updater private key only on the trusted Windows release machine or in protected CI secrets.
- Never place the private key, its password, PFX certificate, or PFX password in Git, the VPS, release artifacts, logs, or documentation.
- The public key remains embedded in `tauri.conf.json`.
- Publish updates only over HTTPS.
- Verify the updater signature and SHA-256 checksum before publishing `latest.json`.
- Keep previous signed releases on the VPS for rollback.
- Restrict write access to `/var/www/vpos-desktop-updates` to the deployment account.
- Record release author, commit SHA, version, checksum, publication time, and release notes.
- Replace any real-looking password currently present in update documentation with a placeholder. If it was ever used as a real key password, rotate it before the next release.
- Authenticode-sign the Windows installer for production distribution. The Tauri updater signature protects update integrity, while Authenticode reduces Windows publisher warnings.

---

## 6. Implementation Phases

## Phase 1: Stabilize the Existing Manual Updater

- [ ] Add a single version consistency script.
  - Create `apps/desktop/scripts/set-desktop-version.mjs`.
  - Update package, Tauri, and Cargo versions together.
  - Add a check-only mode used by tests and release builds.
- [ ] Add release preflight validation.
  - Verify a clean release worktree or explicitly recorded commit SHA.
  - Run desktop-core build, desktop typecheck, tests, web-assets build, and Tauri bundle build.
  - Confirm the target version is greater than the published version.
- [ ] Harden `create-update-manifest.mjs`.
  - Fail when multiple matching ZIP artifacts exist.
  - Validate that signature text is non-empty.
  - Generate `SHA256SUMS.txt`.
  - Include the Git commit SHA in local release metadata.
  - Refuse an HTTP base URL.
- [ ] Remove committed binary OTA artifacts from normal source-control flow.
  - Keep generated files in a release/output directory ignored by Git.
  - Store release artifacts on the VPS and/or GitHub Releases.
- [ ] Sanitize update documentation so it contains no usable passwords or private-key locations that should remain private.

Files:

- Modify `apps/desktop/package.json`.
- Create `apps/desktop/scripts/set-desktop-version.mjs`.
- Modify `apps/desktop/scripts/create-update-manifest.mjs`.
- Modify `.gitignore`.
- Modify `docs/DESKTOP_OTA_DEPLOY.md`.
- Add tests under `apps/desktop/test/desktop-update-release.spec.ts`.

Acceptance criteria:

- One command changes all desktop version sources.
- A mismatched version fails before bundling.
- A release produces a signed ZIP, `.sig`, checksum file, release metadata, and `latest.json`.
- No private signing material is present in Git or on the VPS.

## Phase 2: Improve Desktop Update State and Safety

- [ ] Replace the current silent updater error fallback with an explicit result.
  - Distinguish unsupported preview, offline, HTTP failure, invalid manifest, invalid signature, and no-update states.
- [ ] Add a typed update state machine.
  - `idle`
  - `checking`
  - `available`
  - `downloading`
  - `installing`
  - `restart_required`
  - `current`
  - `failed`
- [ ] Show download/install progress when the Tauri event provides it.
- [ ] Add install guards.
  - Block installation during an active sale/payment submission.
  - Warn when the shift is open.
  - Attempt sync before installation when online.
  - Clearly show the pending outbox count.
  - Permit the operator to defer an optional update.
- [ ] Persist update status locally.
  - last check time;
  - last offered version;
  - deferred-until time;
  - version before restart;
  - last update error.
- [ ] On first launch after a version change, show release notes and confirm local database startup succeeded.
- [ ] Do not delete or recreate the SQLite database during an application update.

Files:

- Modify `apps/desktop/src/services/desktop-updater.service.ts`.
- Modify `apps/desktop/src/screens/SettingsScreen.tsx`.
- Modify `apps/desktop/src/app/App.tsx` for optional startup checks/notification.
- Extend desktop settings/local state storage only with additive fields.
- Add `apps/desktop/test/desktop-updater.service.spec.ts`.
- Add/update Settings layout tests.

Acceptance criteria:

- All update states are visible and actionable.
- Network errors do not appear as `up to date`.
- The app never begins installation while a transaction write is active.
- Local data survives update from the previous production version.

## Phase 3: Add Server-Controlled Update Policy

Tauri's manifest answers whether a newer signed package exists. A VPOS policy endpoint should separately answer whether an update is optional or required.

Recommended endpoint:

```http
GET /api/desktop-updates/policy?platform=windows&arch=x86_64&version=0.1.2
```

Recommended response:

```json
{
  "latestVersion": "0.1.3",
  "minimumSupportedVersion": "0.1.1",
  "required": false,
  "rolloutPercentage": 100,
  "releaseNotes": "Inventory and stability improvements.",
  "publishedAt": "2026-11-04T08:00:00.000Z",
  "supportUrl": "https://vmjamtech.com/support"
}
```

- [ ] Implement a public, read-only API policy endpoint with strict response validation.
- [ ] Add environment-backed policy configuration for the first release.
- [ ] Later move policy to an owner-controlled database record with an audit trail.
- [ ] Add deterministic staged rollout using a stable device identifier hash.
- [ ] Never expose signing secrets through this endpoint.
- [ ] Cache policy briefly but fail safely when the API is unavailable.
- [ ] For a required update, allow pending data synchronization before blocking transaction creation.

Files:

- Create an API desktop-update policy module or add it to an appropriate platform module.
- Add API environment schema fields.
- Add API integration tests.
- Modify `desktop-updater.service.ts` to combine policy and Tauri manifest results.

Acceptance criteria:

- Operators can publish an optional update without forcing every station immediately.
- Unsupported versions are prevented from creating new transactions.
- Offline stations can still open long enough to protect and sync local data when connectivity returns.

## Phase 4: Build a Safe Release Command

Create a PowerShell release orchestrator for the trusted Windows build machine.

Recommended command:

```powershell
pnpm desktop:release -- --version 0.1.3 --notes "Inventory and stability improvements"
```

The command should:

1. Validate the requested semantic version.
2. Confirm version sources match.
3. Capture the Git commit SHA.
4. Run required typechecks and tests.
5. Build desktop assets.
6. Build the Tauri MSI/updater bundle.
7. Sign the updater package.
8. Optionally Authenticode-sign the installer.
9. Generate checksums, metadata, and `latest.json` in a temporary release directory.
10. Stop before publication unless `--publish` is explicitly passed.
11. Upload the version folder first.
12. Verify every public URL.
13. Upload `latest.json` last using an atomic replacement.
14. Print rollback commands and the published version.

Files:

- Create `apps/desktop/scripts/release-desktop-update.ps1`.
- Add root/package scripts for `desktop:version`, `desktop:release`, and `desktop:release:check`.
- Update `docs/DESKTOP_OTA_DEPLOY.md` with the one-command flow and manual fallback.

Acceptance criteria:

- A failed upload cannot advertise a missing package.
- Re-running publication for the same immutable version is rejected unless the artifacts have identical checksums.
- The operator receives a concise final release report.

## Phase 5: Optional GitHub Actions Automation

Do this only after the manual release process has produced at least two successful production updates.

- [ ] Add a Windows workflow triggered manually with `workflow_dispatch`.
- [ ] Require version, release notes, rollout percentage, and required/optional choice as inputs.
- [ ] Store the updater private key/password and code-signing credentials only in protected GitHub secrets.
- [ ] Build and test on a pinned Windows runner/toolchain.
- [ ] Upload artifacts for approval before VPS publication.
- [ ] Protect the production publish job with a GitHub environment approval.
- [ ] Publish the version directory, verify it, then atomically replace `latest.json`.
- [ ] Do not re-enable unrelated scheduled workflows merely to support desktop releases.

Suggested workflow:

- `.github/workflows/desktop-release.yml`

Acceptance criteria:

- Workflow is manual, auditable, and approval-gated.
- Secrets are masked and unavailable to pull-request jobs.
- A failed build or verification step cannot change the live manifest.

## Phase 6: Rollout, Monitoring, and Rollback

- [ ] Maintain at least the last three signed updater versions.
- [ ] Begin production rollout at a small device percentage or selected test branch.
- [ ] Observe update success, startup failures, sync health, and support reports before expanding rollout.
- [ ] Record anonymous operational update events where policy permits:
  - check succeeded/failed;
  - update offered;
  - download started;
  - install started;
  - first launch on new version;
  - rollback/support recovery used.
- [ ] Never include sales, customer, credential, or private tenant data in update telemetry.
- [ ] Add an owner/admin view or log query for installed desktop versions by last-sync device metadata.

Rollback rules:

- If the new release has not been installed widely, point `latest.json` back to the previous known-good signed version only if Tauri downgrade policy and version comparison permit it.
- Because the current bundle sets `allowDowngrades: false`, the safer production rollback is normally a new patch version containing the revert, for example `0.1.4`, not republishing `0.1.2` over `0.1.3`.
- Database migrations must be additive and backward-tolerant. Do not drop local columns/tables in an updater release.
- Keep a standalone MSI for emergency manual recovery.

---

## 7. Required Tests

### Automated

- Version sources match.
- Manifest selects exactly one artifact for the requested version.
- Manifest URL is HTTPS and correctly URL-encoded.
- Empty/missing signature is rejected.
- Generated SHA-256 checksum matches the artifact.
- Installed version equal to latest reports `current`.
- Older installed version reports `available`.
- Network failure reports `failed/offline`, not `current`.
- Invalid manifest/signature surfaces a safe error.
- Optional update can be deferred.
- Required update blocks new transactions only after protecting pending local data.
- Update installation is blocked during active transaction submission.
- Update state survives app restart.

### Manual release matrix

Test at minimum:

| Scenario | Expected result |
| --- | --- |
| `0.1.2` to `0.1.3`, online, no open shift | Install and restart successfully |
| Open shift with no pending writes | Warning and explicit confirmation/defer behavior |
| Pending outbox records | Sync attempt and visible pending count before install |
| Offline update check | Non-destructive offline error; POS remains usable for optional update |
| Corrupted ZIP | Signature/check verification prevents installation |
| Manifest references missing ZIP | Publication preflight fails; manifest is not promoted |
| App restarted after update | Version and success message are correct; SQLite data remains |
| Required version policy | New transactions blocked, sync/update recovery still available |
| Printer and branch settings after update | Settings remain unchanged |

---

## 8. Release Checklist

- [ ] Version bumped consistently in all three files.
- [ ] Release notes approved.
- [ ] Desktop typecheck passes.
- [ ] Desktop focused and full tests reviewed.
- [ ] Tauri MSI/updater build passes.
- [ ] MSI is code-signed for production.
- [ ] Updater ZIP signature exists and verifies.
- [ ] SHA-256 checksum recorded.
- [ ] Upgrade tested from the current production version on a non-production workstation.
- [ ] SQLite data, setup, printer configuration, open records, and outbox verified after upgrade.
- [ ] Version folder uploaded and publicly reachable.
- [ ] `latest.json` uploaded last.
- [ ] Update check succeeds from an installed desktop build.
- [ ] Previous known-good version remains available.
- [ ] Rollback/forward-fix command prepared.
- [ ] Release commit/tag and artifact metadata recorded.

---

## 9. Recommended Delivery Order

1. Secure keys and sanitize documentation.
2. Add version consistency and release preflight scripts.
3. Harden manifest/checksum generation.
4. Improve updater error states and install guards in the desktop UI.
5. Prove manual update from the current production version to one test patch version.
6. Add server-controlled optional/required policy and staged rollout.
7. Run two successful manual production releases.
8. Add an approval-gated GitHub Actions release workflow.
9. Add version monitoring and operational telemetry.

## Definition of Done

The feature is complete when a cashier station can safely discover and install a signed update; the operator can publish it with one repeatable command; incomplete artifacts cannot become live; local data survives the update; optional and required policies behave correctly; and a documented forward-fix/rollback path has been tested.
