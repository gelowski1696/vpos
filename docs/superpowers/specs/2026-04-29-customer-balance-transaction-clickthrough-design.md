# Customer Balance List And Transaction Click-Through Design

Date: 2026-04-29

## Goal

Improve the `Customers` experience on mobile and desktop so cashiers can:
- quickly see which customers still have outstanding balances
- open a customer and review transaction history
- tap a sale transaction and land in the existing `Sales` detail flow
- use the existing balance payment action from that reused sales flow

This design intentionally reuses current sale-detail and customer-payment behavior instead of introducing a second payment path inside `Customers`.

## Scope

In scope:
- mobile `Customers`
- desktop `Customers`
- `Customers With Balance` section/list
- clickable sale transactions inside customer transaction history
- routing into existing `Sales` detail / payment flow

Out of scope:
- new payment modal inside `Customers`
- duplicate sale-detail UI inside `Customers`
- changes to web
- changing how balances are computed
- editing transactions from `Customers`
- making non-sale transaction rows open anything new

## Current State

### Mobile
- `CustomersViewScreen` already loads customer balances and transaction history.
- `SalesScreen` already supports sale detail and `Record Payment`.
- Customer transaction rows are currently informational only.

### Desktop
- `CustomersScreen` already shows balances and recent customer sales.
- `SalesScreen` already supports sale detail and `Queue Customer Payment`.
- Customer recent sales already have reopen behavior, but they do not consistently act as the primary path for balance follow-up from the customer view.

## Chosen Approach

Use `Customers` as a discovery surface and reuse the existing `Sales` flow for all balance settlement actions.

Why:
- one source of truth for sale detail
- one source of truth for customer payment behavior
- lower risk than duplicating modal logic in `Customers`
- keeps mobile and desktop behavior aligned

## UX Design

### 1. Customers With Balance

Add a visible section for customers whose `balance > 0`.

#### Mobile
- Add a `Customers With Balance` section near the top of the customer screen, below the summary and above the full customer list.
- Each row shows:
  - customer name
  - address if present
  - balance amount
- Tapping the row opens that customer’s existing transaction/detail modal.

#### Desktop
- Add a `Customers With Balance` panel above the full directory list or as a leading panel within the customer workspace.
- Each row shows:
  - customer name
  - address if present
  - balance amount
- Clicking the row focuses/selects that customer in the existing customer detail area.

### 2. Transaction History Click-Through

Only sale transactions become clickable.

#### Mobile
- In the customer transaction history modal, sale rows become tappable.
- Tapping a sale transaction opens the existing `Sales` detail flow for that sale.
- The user can then use the existing `Record Payment` button from `Sales`.

#### Desktop
- In the customer sales/transaction area, sale rows become the primary clickable action.
- Clicking a sale opens the existing `Sales` detail flow for that sale.
- The user can then use the existing customer payment action from `Sales`.

### 3. Non-Sale Transactions

Customer payment rows remain informational.

Reason:
- they do not need a separate drilldown for this feature
- keeping them non-clickable reduces ambiguity
- the goal is to settle outstanding sale balances, not open every transaction type

## Data And Behavior

### Customer With Balance List

Use already-loaded customer options / customer rows and filter by:
- `balance > 0`

No new API is required.

### Transaction Click Mapping

For click-through we need the sale ID already present in transaction history rows.

Rules:
- if transaction type is `sale`, clicking should resolve the sale record by `saleId`
- if the sale exists locally, open it immediately
- if it is only available in cached remote rows, use the same local lookup/normalization path already used by the sales screen where possible

### Payment Action

Do not create new payment logic.

Instead:
- mobile: navigate/open into the same selected sale state used by `SalesScreen`
- desktop: call the same selection/open detail path used by `SalesScreen`

## Integration Design

### Mobile

Likely touch points:
- `apps/mobile/src/app/screens/CustomersViewScreen.tsx`
- `apps/mobile/src/app/screens/SalesScreen.tsx`
- any shared sale-row normalization helper already used by sales browsing

Expected changes:
- derive `customersWithBalance`
- render a top balance list section
- make sale transaction rows pressable
- add an outward callback from `CustomersViewScreen` such as `onOpenSaleFromCustomer?: (saleId: string) => void`
- the app/root screen owner wires that into the existing `Sales` screen selected-sale state

### Desktop

Likely touch points:
- `apps/desktop/src/screens/CustomersScreen.tsx`
- `apps/desktop/src/screens/SalesScreen.tsx`
- parent route/app wiring that already passes `onReopenSale`

Expected changes:
- derive `customersWithBalance`
- render a focused balance list/panel
- make sale rows clickable in customer detail
- expand the existing `onReopenSale`-style integration or add a sibling callback for opening a sale detail directly by sale record

## Error Handling

### If a sale transaction cannot be found
- show a friendly toast/message:
  - mobile: `Sale details are not available on this device yet.`
  - desktop: same wording
- do not crash or leave the user with a dead click

### If customer has balance but no sale rows can be opened
- customer balance list still appears
- only clickable sale transactions should trigger navigation

## Testing Strategy

### Mobile
- customer with balance appears in the top list
- tapping customer opens transaction modal
- tapping sale transaction opens existing sale detail
- existing `Record Payment` still works
- payment row transactions remain non-clickable

### Desktop
- customers with balance panel/list renders correctly
- clicking a balance customer focuses that customer
- clicking a sale row opens existing sale detail
- existing customer payment action still works
- non-sale rows remain informational

## Risks

1. Cross-screen wiring risk
- `Customers` and `Sales` may currently be too isolated
- solution: add a narrow callback instead of duplicating logic

2. Sale lookup inconsistency
- local and remote sale representations may differ
- solution: reuse existing sales normalization/lookups rather than creating new parsing paths

3. UX duplication risk
- avoid a second sale detail modal inside `Customers`
- keep one payment path only

## Acceptance Criteria

- Mobile and desktop both show a `Customers With Balance` section/list.
- Only customers with `balance > 0` appear there.
- Sale transaction rows in customer history are clickable.
- Clicking a sale row opens the existing `Sales` detail behavior.
- Existing payment action is reachable from that reused sales detail flow.
- Non-sale transaction rows remain informational.
- No new payment UI is introduced in `Customers`.
