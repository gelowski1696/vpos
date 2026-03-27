# Tasks: LPG Item Service Actions

## A. Product Decisions

- [ ] Confirm `Dispose` subtracts empty qty
- [ ] Confirm `Replace` adds empty qty
- [ ] Confirm `Junk` is history only
- [ ] Confirm only LPG products with `cylinderTypeId` are eligible
- [ ] Confirm notes are required or optional per action

## B. Schema

- [ ] Add `LpgItemServiceActionType`
- [ ] Add `LpgItemServiceAction`
- [ ] Add optional self-reference `referenceActionId`
- [ ] Add migration

## C. API

- [ ] Create `LpgItemActionsModule`
- [ ] Create service
- [ ] Create controller
- [ ] Implement `GET /api/lpg-item-actions`
- [ ] Implement `GET /api/lpg-item-actions/summary`
- [ ] Implement `POST /api/lpg-item-actions/dispose`
- [ ] Implement `POST /api/lpg-item-actions/replace`
- [ ] Implement `POST /api/lpg-item-actions/junk`
- [ ] Add audit logging

## D. Stock Rules

- [ ] Resolve `product.cylinderTypeId`
- [ ] Resolve branch from location
- [ ] Update `CylinderBalance.qtyEmpty` on dispose
- [ ] Update `CylinderBalance.qtyEmpty` on replace
- [ ] Keep junk as history-only
- [ ] Block negative empty qty on dispose

## E. Web

- [ ] Remove cylinder service page from nav
- [ ] Add `LPG Item Service` page
- [ ] Add branch/location filters
- [ ] Add LPG product list/search
- [ ] Add current empty qty display
- [ ] Add action modal
- [ ] Add history list
- [ ] Add summary cards

## F. Mobile

- [ ] Remove mobile cylinder service screen from menu
- [ ] Add LPG item service section to `Items`
- [ ] Add centered action modal
- [ ] Add history panel in item detail
- [ ] Update visible empty qty after successful action

## G. Dashboard / Reports

- [ ] Replace cylinder service queries with LPG item action queries
- [ ] Show disposed count
- [ ] Show replaced count
- [ ] Show junked count

## H. Cleanup

- [ ] Remove old cylinder service walkthrough entries
- [ ] Remove old cylinder service route references
- [ ] Remove stale mobile cylinder service files if unused

## I. Validation

- [ ] API typecheck
- [ ] API build
- [ ] Web typecheck
- [ ] Mobile typecheck

## Recommended Order

1. Schema + migration
2. API module
3. Web page
4. Mobile item-detail actions
5. Dashboard/report updates
6. Cleanup of old cylinder-service UI
