# LPG Disposed, Junked, and Replaced Implementation Guide

Superseded note:
This cylinder-serial planning document has been superseded by the item-based LPG service action flow in [LPG_ITEM_SERVICE_ACTIONS_IMPLEMENTATION.md](d:/vpos/docs/LPG_ITEM_SERVICE_ACTIONS_IMPLEMENTATION.md).
Use the item-based flow for current implementation work.

## 1. Purpose

This document defines the safe operational model for LPG cylinders and related assets that are:
- `junked`,
- `disposed`, or
- `replaced`.

Goal:
- separate asset write-off flows from normal sales and transfers,
- keep cylinder history auditable,
- protect full/empty balances from accidental corruption,
- support branch operations without forcing everything into stock adjustment,
- define clear mobile and web flows before implementation.

Companion task list: [TASKS_LPG_DISPOSED_JUNKED_REPLACED.md](d:/vpos/docs/TASKS_LPG_DISPOSED_JUNKED_REPLACED.md)

## 2. Core Principle

Do not treat `junk`, `dispose`, and `replace` as generic inventory edits.

For LPG cylinders, these actions affect:
- physical custody,
- operational availability,
- safety/compliance,
- customer accountability,
- branch asset reporting.

So these flows should be modeled as explicit cylinder lifecycle transactions, not hidden behind simple quantity adjustments.

## 3. Meanings

### 3.1 Junked

`Junked` means the cylinder is removed from normal operational use and moved into a junk, scrap, or quarantine state.

Use it when:
- cylinder is damaged,
- cylinder is unsafe for normal sale/delivery,
- branch wants to hold it for later inspection, repair, or scrap decision,
- asset still physically exists and may still have salvage handling later.

Operational meaning:
- not usable for sale
- not usable for lending
- not transferable as active stock
- still traceable in asset records

### 3.2 Disposed

`Disposed` means the cylinder is permanently removed from active company assets.

Use it when:
- cylinder is condemned,
- cylinder is unsafe beyond recovery,
- branch or owner wants final write-off,
- junked asset is being fully retired.

Operational meaning:
- irreversible in normal branch flow
- should remain in audit history
- should no longer appear in operational cylinder selection

### 3.3 Replaced

`Replaced` means one cylinder is exchanged with another as a corrective service flow.

Use it when:
- customer brings back a defective or damaged cylinder,
- branch issues another cylinder in its place,
- one asset needs to be swapped without treating the whole action as a new sale.

Operational meaning:
- old cylinder comes back into company control
- replacement cylinder goes out
- old cylinder may then become:
  - `DAMAGED`
  - `JUNKED`
  - `DISPOSED`
depending on later branch decision

## 4. Recommended Status Model

Current statuses may already include:
- `FULL`
- `EMPTY`
- `DAMAGED`
- `LOST`

Recommended expanded status model:
- `FULL`
- `EMPTY`
- `DAMAGED`
- `JUNKED`
- `DISPOSED`
- `LOST`

Recommended rule:
- `DAMAGED` is an operational defect state
- `JUNKED` is a non-operational holding state
- `DISPOSED` is final retirement

## 5. Recommended Event Types

If you already have cylinder event types such as:
- `ISSUE`
- `RETURN`
- `EXCHANGE`
- `TRANSFER`
- `REFILL`
- `DAMAGE`
- `LOSS`

Recommended additions:
- `JUNK`
- `DISPOSE`
- `REPLACE_OUT`
- `REPLACE_IN`

Or, if you prefer a single transaction model:
- keep one `REPLACE`
- store both `old_cylinder_id` and `replacement_cylinder_id`

## 6. Business Rules

### 6.1 Junk rules

Allow `Junk` when:
- cylinder exists,
- cylinder belongs to tenant/company,
- cylinder is not already `DISPOSED`,
- cylinder is not already `LOST`,
- actor has permission.

Effect:
- cylinder status becomes `JUNKED`
- cylinder removed from active usable full/empty pool
- cylinder event is written
- branch reason is required

### 6.2 Dispose rules

Allow `Dispose` when:
- cylinder exists,
- cylinder is not already disposed,
- actor has permission,
- branch or admin provides disposal reason.

Recommended safer rule:
- branch can dispose only from:
  - `JUNKED`
  - `DAMAGED`

Effect:
- cylinder status becomes `DISPOSED`
- removed from all operational selectors
- final disposal event written
- audit metadata required

### 6.3 Replace rules

Allow `Replace` when:
- source cylinder exists,
- replacement cylinder exists,
- both belong to tenant/company,
- replacement cylinder is available for issue,
- source cylinder is eligible for return/service handling,
- actor has permission.

Effect:
- old cylinder returns into company control
- replacement cylinder is issued out
- replacement transaction links both cylinder ids
- old cylinder status becomes:
  - `DAMAGED` immediately, or
  - `EMPTY` / `FULL` if branch policy allows inspection-first

Recommended default:
- replaced-in defective cylinder should become `DAMAGED`
- branch can later move it to `JUNKED` or `DISPOSED`

## 7. Operational Inventory Rules

### 7.1 Junked cylinder

Recommended balance behavior:
- active full/empty counts should decrease when junking takes effect
- junked units should move into a separate non-operational bucket

Safe options:

1. status-driven reporting only
- keep cylinder record at same location
- exclude `JUNKED` from operational counts

2. explicit junk location
- move cylinder to a dedicated system location:
  - `LOC-CYL-JUNK`
  - `System Cylinder Junk Holding`

Recommendation:
- use either a dedicated junk location or status-based exclusion consistently
- do not mix both loosely

### 7.2 Disposed cylinder

Recommended behavior:
- cylinder is removed from operational counts permanently
- disposal event is final
- record stays for audit, but not operational usage

### 7.3 Replaced cylinder

Recommended behavior:
- old cylinder returns in
- replacement cylinder goes out
- this should behave more like a service exchange than a fresh retail sale

Important:
- replacement should not silently alter unrelated sale history
- if replacement is tied to a prior sale, keep a reference to that sale or service case

## 8. Proposed Schema

## 8.1 Enum updates

Recommended additions:

```prisma
enum CylinderStatus {
  FULL
  EMPTY
  DAMAGED
  JUNKED
  DISPOSED
  LOST
}

enum CylinderEventType {
  ISSUE
  RETURN
  EXCHANGE
  TRANSFER
  REFILL
  DAMAGE
  LOSS
  JUNK
  DISPOSE
  REPLACE
}
```

## 8.2 Cylinder service transaction

Recommended new model:

```prisma
model CylinderServiceAction {
  id                    String   @id @default(uuid())
  companyId             String
  branchId              String
  locationId            String
  actionType            String
  sourceCylinderId      String?
  replacementCylinderId String?
  customerId            String?
  saleId                String?
  reason                String
  notes                 String?  @db.Text
  createdByUserId       String?
  approvedByUserId      String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  company             Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  branch              Branch    @relation(fields: [branchId], references: [id], onDelete: Restrict)
  location            Location  @relation(fields: [locationId], references: [id], onDelete: Restrict)
  sourceCylinder      Cylinder? @relation("CylinderServiceSource", fields: [sourceCylinderId], references: [id], onDelete: SetNull)
  replacementCylinder Cylinder? @relation("CylinderServiceReplacement", fields: [replacementCylinderId], references: [id], onDelete: SetNull)
  customer            Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull)
  sale                Sale?     @relation(fields: [saleId], references: [id], onDelete: SetNull)
  createdBy           User?     @relation("CylinderServiceCreatedBy", fields: [createdByUserId], references: [id], onDelete: SetNull)
  approvedBy          User?     @relation("CylinderServiceApprovedBy", fields: [approvedByUserId], references: [id], onDelete: SetNull)

  @@index([companyId, actionType, createdAt])
  @@index([companyId, sourceCylinderId, createdAt])
  @@index([companyId, replacementCylinderId, createdAt])
  @@index([companyId, customerId, createdAt])
}
```

### Recommended `actionType` values

- `JUNK`
- `DISPOSE`
- `REPLACE`

You may also split this into separate tables later, but one service-action table is enough for MVP.

## 8.3 Optional cylinder flags

If needed, add:

```prisma
model Cylinder {
  // existing fields...
  junkedAt    DateTime?
  disposedAt  DateTime?
  junkReason  String? @db.Text
  disposeReason String? @db.Text
}
```

This is optional if event history is already enough.

## 9. Mobile Flow Screens

## 9.1 Cylinder detail action menu

Recommended actions:
- `Mark Damaged`
- `Move to Junk`
- `Dispose`
- `Replace`

Best mobile entry points:
- cylinder detail screen
- cylinder scan result screen
- service action modal from inventory/cylinder list

## 9.2 Junk flow

Mobile flow:

1. open cylinder detail
2. tap `Move to Junk`
3. modal:
  - cylinder summary
  - current branch/location
  - required reason
  - optional remarks
4. confirm
5. toast:
  - `Cylinder moved to junk`

## 9.3 Dispose flow

Mobile flow:

1. open cylinder detail
2. tap `Dispose`
3. warning modal:
  - this will permanently remove the cylinder from operational use
  - required reason
  - optional remarks
4. confirm
5. toast:
  - `Cylinder disposed`

## 9.4 Replace flow

Mobile flow:

1. open customer or service screen
2. scan/select source cylinder
3. tap `Replace`
4. modal/screen:
  - source cylinder summary
  - optional customer and sale link
  - scan/select replacement cylinder
  - required reason
  - optional remarks
5. confirm
6. toast:
  - `Cylinder replaced`

Recommended validation in UI:
- replacement cylinder must be available
- same cylinder cannot be source and replacement
- source cylinder should not already be disposed

## 10. Web Flow Screens

## 10.1 Cylinder detail drawer/page

Recommended cards:
- current status
- current location
- customer linkage if any
- recent cylinder events
- action buttons:
  - `Junk`
  - `Dispose`
  - `Replace`

## 10.2 Junk queue page

Purpose:
- show all junked cylinders
- allow later actions:
  - review
  - dispose
  - optionally restore if repair flow exists

Recommended columns:
- cylinder id / serial / SKU
- branch
- location
- junked at
- reason
- current status

## 10.3 Disposal history page

Purpose:
- audit all permanently retired cylinders

Recommended columns:
- cylinder id
- disposed at
- branch
- actor
- reason

## 10.4 Replacement log page

Purpose:
- show old-to-new cylinder swaps

Recommended columns:
- replaced at
- source cylinder
- replacement cylinder
- customer
- sale reference
- branch
- actor
- reason

## 11. Permissions

Recommended phase 1:

### Cashier
- can mark damaged
- can request replace if branch policy allows
- should not dispose permanently by default

### Supervisor
- can junk
- can replace
- can dispose if branch policy allows

### Admin / Owner
- full control

### Platform Owner
- not needed for daily branch use

If you want a simpler first rollout, you can skip approval and keep this as:
- cashier: replace only
- supervisor/admin: junk and dispose

## 12. Reporting

Recommended reports:
- active cylinders
- junked cylinders
- disposed cylinders
- replacement log
- damage/junk/disposal counts by branch

Important reporting rule:
- operational inventory reports should exclude:
  - `JUNKED`
  - `DISPOSED`
  - `LOST`

unless explicitly requested in audit reports.

## 13. MVP Recommendation

Best rollout order:

1. `Damaged` + `Junk`
2. `Dispose`
3. `Replace`
4. reporting and approval rules

Why:
- junk/dispose establish safe lifecycle boundaries first
- replacement becomes easier once damaged/junk/dispose states are defined clearly

## 14. Final Recommendation

Use this model:

- `Damaged` = defect state
- `Junked` = out of operations, still held
- `Disposed` = final write-off
- `Replaced` = swap one cylinder for another, with both cylinder ids tracked

Do not collapse these into one generic `adjust stock` feature.
