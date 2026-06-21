# Tenant Operational Reset Design

Date: 2026-06-21

## Goal

Add a per-tenant reset action in Tenant Management for platform owners.

The reset should clear operational history for a single tenant while preserving master data and tenant configuration. It is meant for cleanup, fresh-start, and support workflows where the tenant should keep customers, items, branches, locations, users, price lists, and other master records, but lose transactions and inventory movement history.

## Scope

### In scope

- `apps/web/src/app/(admin)/tenants/page.tsx`
- `apps/api/src/modules/entitlements/entitlements.controller.ts`
- `apps/api/src/modules/entitlements/entitlements.service.ts`
- tenant-owner audit logging for the reset action
- web and API test coverage for the new reset flow

### Out of scope

- tenant deletion
- tenant provisioning
- tenant entitlement add-ons
- master-data editing screens
- changes to the existing offline/CLI reset scripts
- any reset flow outside Tenant Management

## Current State

Tenant Management already has:
- a per-tenant action column with buttons for add-ons, override, suspend, reactivate, and delete
- modal patterns for destructive and administrative actions
- owner-only API endpoints under `platform/owner/tenants/:companyId/*`

The API also already has:
- audit logging
- a tenant write-freeze mechanism
- tenant routing that can resolve shared and dedicated databases
- an existing operational reset script that already defines the cleanup order and the kinds of data that should be removed

What is missing is a live, per-tenant owner action in the UI and an API endpoint that performs the same reset safely from the admin console.

## Chosen Approach

Add a new `Reset Data` action in each tenant row, then open a destructive confirmation modal before calling a new owner-only reset endpoint.

Why this approach:
- it keeps the action close to the tenant it affects
- it matches the existing admin-console interaction style
- it avoids adding a separate reset page or an extra maintenance workflow
- it makes the destructive step explicit with typed confirmation and an audit note
- it reuses the existing tenant routing and write-freeze patterns instead of inventing a new maintenance path

The reset will be implemented as a tenant-scoped data cleanup, not a tenant delete. The company row, add-ons, entitlement state, and master data stay intact.

## UX Design

### 1. Tenant Row Action

Add a new danger-styled button in the Tenant Management actions column:
- label: `Reset Data`
- style: visually destructive, similar weight to `Delete`
- placement: alongside the existing row actions

Clicking it should open a reset confirmation modal for the selected tenant.

### 2. Confirmation Modal

The modal should clearly explain what will happen:
- the tenant will keep master data
- operational history will be removed
- the action is tenant-specific and irreversible

The modal should include:
- tenant name and code
- a short warning paragraph
- an optional notes field for the audit trail
- a confirmation input that requires typing the tenant code
- a cancel button and a primary destructive confirm button

The confirm button should stay disabled until the typed confirmation matches the tenant code.

The notes field is optional and should not block submission.

### 3. Post-Action Feedback

After a successful reset:
- close the modal
- refresh the tenant list
- show a success toast
- surface the tenant name in the success message

If the reset fails:
- keep the modal open
- show a clear error message
- preserve the typed notes so the user can retry

## API And Data Behavior

Add a new owner-only endpoint:
- `POST /platform/owner/tenants/:companyId/reset-operational-data`

Request body:
- `confirmation` - required, must match the tenant code
- `reason` - optional audit note

Guardrails:
- platform-owner only
- reject missing or mismatched confirmation
- reject DEMO tenants
- reject platform-control tenants
- reject a self-target reset if the actor is operating inside the same tenant context
- use the existing tenant write-freeze mechanism so new writes are blocked during the reset

Implementation behavior:
- resolve the tenant through the existing tenant router so shared and dedicated tenants are handled consistently
- run the cleanup in a serializable transaction
- delete operational rows in dependency-safe order
- zero out balance-style records that should remain as master state but must be reset to a neutral quantity
- leave master data intact

The reset should match the current operational-reset scope already used by the repository maintenance script:
- sales and related sale data
- inventory ledgers and stock movement events
- shifts and shift-linked operational rows
- customer payments, points, and reward redemptions
- petty cash and attachments
- deliveries and delivery-related operational rows
- lending transactions
- sync cursors and sync review rows
- idempotency keys
- cylinder events and other operational event rows
- inventory balances and cylinder balances reset to zero
- customer deposit and points balances reset to zero
- cylinders neutralized rather than removed, unless a future follow-up explicitly changes that behavior

The endpoint should return a compact summary of deleted rows so the UI can show a useful success result and the audit trail can store the scope of the reset.

## Error Handling

- If the confirmation text does not match the tenant code, reject the request before any destructive work starts.
- If the tenant is not found, return a not-found error.
- If the database or tenant router is unavailable, fail safely and do not partially clear the tenant.
- If the transaction fails midway, let the transaction roll back and clear the write freeze in cleanup logic.
- If the tenant is already write-frozen for another maintenance operation, treat that as a conflict rather than running two destructive operations at once.

## Testing

Add coverage for the new flow on both web and API.

Web tests should prove:
- the row action renders
- the reset modal opens for a selected tenant
- typed confirmation is required before submit
- optional notes can be submitted
- success and error states keep the modal behavior correct

API tests should prove:
- confirmation mismatch is rejected
- prohibited tenants are rejected
- the reset endpoint writes an audit event
- tenant-scoped cleanup removes operational rows and preserves master data
- shared and dedicated tenant routing both work

## Self-Review

- No placeholders remain.
- The scope is limited to Tenant Management and the platform-owner API.
- The action is destructive but guarded by typed confirmation and audit notes.
- The design keeps master data intact and only clears operational history.
- The API uses the existing tenant routing and write-freeze patterns instead of adding a separate maintenance system.
