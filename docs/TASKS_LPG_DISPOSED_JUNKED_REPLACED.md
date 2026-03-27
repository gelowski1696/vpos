# LPG Disposed, Junked, and Replaced Tasks

Superseded note:
This cylinder-serial task list has been superseded by [TASKS_LPG_ITEM_SERVICE_ACTIONS.md](d:/vpos/docs/TASKS_LPG_ITEM_SERVICE_ACTIONS.md).
Use the LPG item service action task list for current implementation work.

Implementation guide: [LPG_DISPOSED_JUNKED_REPLACED_IMPLEMENTATION.md](d:/vpos/docs/LPG_DISPOSED_JUNKED_REPLACED_IMPLEMENTATION.md)

## Goal

Add safe lifecycle handling for LPG cylinders that are:
- junked
- disposed
- replaced

without mixing those flows into generic inventory edits.

## A) Product Decisions

- `[PENDING]` Confirm branch meaning of `JUNKED` vs `DISPOSED`.
- `[PENDING]` Confirm whether `DAMAGED` is separate from `JUNKED`.
- `[PENDING]` Confirm whether only `JUNKED` or `DAMAGED` cylinders can be disposed.
- `[PENDING]` Confirm whether replacement requires linking to customer and/or sale.
- `[PENDING]` Confirm whether cashiers may perform replacement directly.
- `[PENDING]` Confirm whether junk/dispose need supervisor/admin only.
- `[PENDING]` Confirm whether damaged replacement-in cylinders default to `DAMAGED`.
- `[PENDING]` Confirm whether junk uses:
  - status-only exclusion
  - or dedicated junk location

## B) Data Model

- `[PENDING]` Extend `CylinderStatus`:
  - `JUNKED`
  - `DISPOSED`
- `[PENDING]` Extend `CylinderEventType`:
  - `JUNK`
  - `DISPOSE`
  - `REPLACE`
- `[PENDING]` Add `CylinderServiceAction` model.
- `[PENDING]` Add source/replacement cylinder self-relations if needed.
- `[PENDING]` Add optional reason/timestamp fields to `Cylinder`.
- `[PENDING]` Add indexes for:
  - company + actionType + createdAt
  - company + sourceCylinderId
  - company + replacementCylinderId

## C) Prisma and Migration

- `[PENDING]` Update Prisma schema with new statuses and events.
- `[PENDING]` Add `CylinderServiceAction`.
- `[PENDING]` Generate migration.
- `[PENDING]` Regenerate Prisma client.

## D) API Junk Flow

- `[PENDING]` Add endpoint:
  - `POST /api/cylinders/:id/junk`
- `[PENDING]` Validate:
  - cylinder exists
  - cylinder belongs to tenant/company
  - cylinder not already disposed/lost
  - actor has permission
- `[PENDING]` Require reason.
- `[PENDING]` Update cylinder status to `JUNKED`.
- `[PENDING]` Write cylinder event.
- `[PENDING]` Write service action log.

## E) API Dispose Flow

- `[PENDING]` Add endpoint:
  - `POST /api/cylinders/:id/dispose`
- `[PENDING]` Validate:
  - cylinder exists
  - cylinder not already disposed
  - branch policy allows disposal from current status
  - actor has permission
- `[PENDING]` Require reason.
- `[PENDING]` Update cylinder status to `DISPOSED`.
- `[PENDING]` Write cylinder event.
- `[PENDING]` Write service action log.

## F) API Replace Flow

- `[PENDING]` Add endpoint:
  - `POST /api/cylinders/:id/replace`
- `[PENDING]` Validate:
  - source cylinder exists
  - replacement cylinder exists
  - source and replacement differ
  - replacement cylinder is available
  - actor has permission
- `[PENDING]` Accept optional:
  - `customer_id`
  - `sale_id`
  - `reason`
  - `notes`
- `[PENDING]` Mark returned source cylinder appropriately.
- `[PENDING]` Move replacement cylinder out safely.
- `[PENDING]` Write cylinder events for both sides.
- `[PENDING]` Write `CylinderServiceAction`.

## G) Inventory and Balance Rules

- `[PENDING]` Decide whether junk uses status-only exclusion or junk location.
- `[PENDING]` Ensure operational cylinder counts exclude `JUNKED`.
- `[PENDING]` Ensure operational cylinder counts exclude `DISPOSED`.
- `[PENDING]` Ensure replacement updates full/empty location balances safely.
- `[PENDING]` Ensure replacement does not silently alter unrelated sale history.

## H) Mobile UI

- `[PENDING]` Add cylinder detail action menu.
- `[PENDING]` Add `Move to Junk` modal.
- `[PENDING]` Add `Dispose` modal with stronger warning copy.
- `[PENDING]` Add `Replace` flow:
  - select/scan source
  - select/scan replacement
  - reason
  - confirm
- `[PENDING]` Add branch-friendly success/error toasts.
- `[PENDING]` Add status badges for:
  - `DAMAGED`
  - `JUNKED`
  - `DISPOSED`

## I) Web UI

- `[PENDING]` Add cylinder detail actions:
  - `Junk`
  - `Dispose`
  - `Replace`
- `[PENDING]` Add `Junk Queue` page.
- `[PENDING]` Add `Disposal History` page.
- `[PENDING]` Add `Replacement Log` page.
- `[PENDING]` Use non-technical wording for branch users.

## J) Reporting

- `[PENDING]` Add junked cylinder report.
- `[PENDING]` Add disposed cylinder report.
- `[PENDING]` Add replacement log report.
- `[PENDING]` Add branch summary:
  - damaged count
  - junked count
  - disposed count
  - replaced count

## K) Permissions

- `[PENDING]` Decide role permissions for:
  - replace
  - junk
  - dispose
- `[PENDING]` Implement role checks in API.
- `[PENDING]` Hide restricted actions in mobile/web UI.

## L) Testing

- `[PENDING]` Test junk flow from active cylinder.
- `[PENDING]` Test dispose flow from junked/damaged cylinder.
- `[PENDING]` Test replace flow with valid source and replacement.
- `[PENDING]` Test replacement rejects same-cylinder swap.
- `[PENDING]` Test disposed cylinder cannot be reused.
- `[PENDING]` Test junked cylinder is excluded from operational selectors.
- `[PENDING]` Test reporting totals by status.

## Recommended MVP Order

1. add schema foundation
2. implement `Junk`
3. implement `Dispose`
4. implement `Replace`
5. add reporting and permission polish

## Mobile/Web Flow Summary

### Mobile

1. open cylinder detail or scan cylinder
2. choose:
  - `Move to Junk`
  - `Dispose`
  - `Replace`
3. complete required modal inputs
4. confirm
5. show toast and updated status

### Web

1. open cylinder detail page
2. review current status/history
3. choose action:
  - `Junk`
  - `Dispose`
  - `Replace`
4. confirm through dialog
5. review the result in:
  - cylinder detail
  - junk queue
  - disposal history
  - replacement log

## Exact Rule Summary

### Use `Junked` when:
- asset is not operationally usable,
- branch still physically holds it,
- later repair/disposal decision may happen.

### Use `Disposed` when:
- asset is permanently retired,
- no operational reuse should be allowed.

### Use `Replaced` when:
- one cylinder is swapped with another,
- both cylinder ids must be tracked,
- customer/service context matters.
