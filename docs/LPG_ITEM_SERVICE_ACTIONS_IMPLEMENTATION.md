# LPG Item Service Actions Implementation

## Goal

Track LPG item service actions at the **item/location stock level**, not at the cylinder serial level.

This feature applies only to LPG products that are linked to a `cylinderTypeId`.

## Business Rules

### Scope

- Applies to **LPG items only**
- Does **not** use individual cylinder serials
- Uses the product's linked `cylinderTypeId` and location `qtyEmpty`

### Actions

#### Dispose

- Decreases the location's `empty qty`
- Requires:
  - `product`
  - `location`
  - `qty`
  - `reason`
- Optional:
  - `notes`
- Stock effect:
  - `qtyEmpty = qtyEmpty - qty`

#### Replace

- Adds back to the location's `empty qty`
- Used when a previously disposed or defective LPG item is returned/replaced into empty stock
- Requires:
  - `product`
  - `location`
  - `qty`
  - `reason`
- Optional:
  - `notes`
  - `referenceActionId`
- Stock effect:
  - `qtyEmpty = qtyEmpty + qty`

#### Junk

- History only
- No stock movement
- Requires:
  - `product`
  - `location`
  - `qty`
  - `reason`
- Optional:
  - `notes`
  - `referenceActionId`

### Notes

- `Dispose` is not treated as a permanent final state in this model
- A disposed quantity can later be followed by:
  - `Replace`
  - `Junk`
- Every action must preserve remarks/history

## Data Model

### New table

`LpgItemServiceAction`

- `id`
- `companyId`
- `branchId`
- `locationId`
- `productId`
- `actionType`
- `qty`
- `reason`
- `notes`
- `referenceActionId` optional
- `createdByUserId` optional
- `createdAt`
- `updatedAt`

### Enum

`LpgItemServiceActionType`

- `DISPOSE`
- `REPLACE`
- `JUNK`

## Stock Logic

This feature updates LPG empty stock through `CylinderBalance`, using:

- `locationId`
- `product.cylinderTypeId`

### Stock rules

- `DISPOSE`: subtract empty qty
- `REPLACE`: add empty qty
- `JUNK`: no qty change

### Validation

- product must exist
- product must be `isLpg = true`
- product must have `cylinderTypeId`
- location must exist
- qty must be positive
- `DISPOSE` cannot reduce empty qty below zero

## API

### Endpoints

- `GET /api/lpg-item-actions`
- `GET /api/lpg-item-actions/summary`
- `POST /api/lpg-item-actions/dispose`
- `POST /api/lpg-item-actions/replace`
- `POST /api/lpg-item-actions/junk`

### Filters

- `branch_id`
- `location_id`
- `product_id`
- `action_type`
- `since`
- `until`
- `limit`

## Web Flow

### New module

`LPG Item Service`

### Screen layout

1. Branch filter
2. Location filter
3. LPG item search/list
4. Current empty qty
5. Action buttons:
   - `Dispose`
   - `Replace`
   - `Junk`
6. Recent action history
7. Small summary cards:
   - disposed
   - replaced
   - junked

## Mobile Flow

### Entry point

Use the existing `Items` module.

### Item detail

For LPG items with a selected location:

1. Show current `FULL / EMPTY / QOH`
2. Show action buttons:
   - `Record Dispose`
   - `Record Replace`
   - `Record Junk`
3. Open centered modal
4. Require:
   - qty
   - reason
5. Optional notes
6. Save action
7. Refresh history
8. Update visible empty qty immediately on-device after successful save

## Reporting

Dashboard and Reports should use `LpgItemServiceAction` instead of cylinder service actions.

Recommended counts:

- disposed count
- replaced count
- junked count

## Migration Strategy

### Remove user-facing cylinder service flow

- remove web `Cylinders` action page from nav
- remove mobile `Cylinders` screen from menu
- stop using cylinder service history in dashboard/reports

### Replace with LPG item service flow

- new API module
- new web page
- item detail actions in mobile

## Out of Scope For This Slice

- serial-cylinder disposal workflow
- repairs
- approval workflow
- offline queue for LPG item service actions
