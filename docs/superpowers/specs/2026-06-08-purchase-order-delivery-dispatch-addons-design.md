# Desktop Purchase Order And Delivery Dispatch Add-Ons Design

Date: 2026-06-08

## Goal

Add real offline-first desktop workspaces for the Purchase Order Suite and Delivery Dispatch Suite add-ons, and expose them in a new `Add-ons` sidebar group whenever either suite is enabled for the active branch/tenant context.

This desktop work should let cashiers and supervisors:
- open Purchase Orders and Delivery Dispatch from the desktop shell
- create and manage add-on records offline
- queue add-on mutations for sync when connectivity returns
- review synced records in the same desktop app shell as the rest of VPOS

## Scope

### In scope

- desktop sidebar navigation
- desktop route registration
- desktop screens for:
  - Purchase Orders
  - Delivery Dispatch
- add-on gating from resolved local add-on flags
- offline-first create / update / sync behavior for both workspaces
- POS integration points that already depend on Delivery Dispatch when a delivery sale completes

### Out of scope

- web UI changes
- new add-on entitlement model on the server
- changing how add-on flags are defined server-side
- rebuilding the existing POS checkout flow from scratch
- unrelated redesign work in other desktop modules

## Current State

### Desktop

- `PosScreen` already loads tenant add-ons and uses:
  - `purchase_order_suite`
  - `delivery_dispatch_suite`
- Desktop routing currently includes the standard operational modules but does not yet expose desktop routes for Purchase Orders or Delivery Dispatch.
- The sidebar groups are currently:
  - Operations
  - Inventory & Services
  - System
- Desktop already stores downloaded master data and add-on booleans locally.
- The POS flow already auto-creates delivery dispatch records for delivery sales when the Delivery Dispatch add-on is enabled.

### Server / Sync

- The API already has Purchase Order and Delivery Dispatch modules.
- The sync service already recognizes the core Purchase Order and Delivery Dispatch record entities for create and status transitions.
- That means the desktop implementation can target existing server semantics instead of inventing a separate offline model.

### Web

- Web already has read-only Purchase Orders and Delivery Dispatch admin pages.
- Web is not the target of this feature, but the desktop screens should stay conceptually aligned with the same record shapes.

## Chosen Approach

Build the desktop add-ons as real workspace screens, not placeholders.

Why:
- the user explicitly asked for real screens
- the server already understands the underlying PO and dispatch workflows
- desktop can become the offline-first entry point while web remains review-only

The implementation should follow the existing desktop shell patterns:
- side navigation controls module discovery
- the content area switches by route
- records are listed in compact, high-density management layouts
- mutations are created locally first and then synced through outbox items

## UX Design

### 1. Add-ons Sidebar Group

Add a new sidebar group titled `Add-ons`.

Show the group when either add-on is enabled in the resolved local add-on state for the current branch/tenant context.

The group contains:
- `Purchase Orders`
- `Delivery Dispatch`

Behavior:
- if only one suite is enabled, show only that item
- if neither suite is enabled, hide the group entirely
- if a user opens a direct add-on route while disabled, show a locked / unavailable workspace message instead of a blank screen

Placement:
- place the group after `Inventory & Services`
- keep `System` below it

### 2. Purchase Orders Workspace

Create a desktop Purchase Orders screen that supports the core offline-first lifecycle:
- browse purchase orders
- filter by status
- open a PO detail view
- create a PO offline
- submit, receive, pull out, complete, and cancel from the detail context
- attach files if the existing desktop file flow supports it
- queue all actions for sync

The screen should use the same compact management-shell style as the newer desktop pages:
- header card
- summary cards
- list / detail layout
- status chips
- dense line tables in the detail pane

Primary actions:
- New Purchase Order
- Refresh
- filter by status

Detail view should show:
- PO number
- branch / location / supplier
- status
- notes
- line totals
- receive history
- pullout history
- attachments

### 3. Delivery Dispatch Workspace

Create a desktop Delivery Dispatch screen that supports the core offline-first lifecycle:
- browse delivery dispatch orders
- filter by status, branch, rider, and sale ID
- open a dispatch detail view
- create a delivery dispatch order offline
- assign personnel / rider / helper
- update status through the supported delivery lifecycle
- review event history
- queue all actions for sync

The screen should keep the same compact management-shell style:
- header card
- summary cards
- filter row
- record list
- side detail panel
- status chips

Primary actions:
- New Dispatch
- Refresh
- export / review actions if already supported locally

Detail view should show:
- dispatch ID
- linked sale
- order type
- status
- assigned personnel / rider
- cashier validation info
- event history

### 4. POS Integration

Keep the existing POS Delivery Dispatch behavior intact:
- when a delivery sale is completed and the add-on is enabled, a delivery order should still be created locally and queued for sync

Purchase Orders do not need a new inline POS step for the first pass. They will be managed from the Add-ons sidebar group as a dedicated workspace.

### 5. Disabled State And Guardrails

If the add-on is unavailable:
- hide the sidebar entry
- block direct route access with a friendly unavailable message
- do not show broken actions

If the add-on is enabled but sync has not yet brought local record data down:
- show an empty-state hint rather than an error screen

## Data And Behavior

### Add-on Gate

Use the resolved local add-on flags already downloaded on the desktop device.

The sidebar and route guards should read a single resolved boolean per suite:
- `purchase_order_suite`
- `delivery_dispatch_suite`

The group is visible if either resolved flag is true.

### Desktop Routes

Add desktop route IDs for:
- `purchase-orders`
- `delivery-dispatch`

Each route should map to a dedicated desktop screen and should be reachable from the sidebar.

### Offline-First Mutation Flow

Mutations must be written locally first, then queued for sync using the entity names already recognized by the sync service.

Purchase Order sync actions:
- `purchase_order`
- `purchase_order_submit`
- `purchase_order_receive`
- `purchase_order_pullout`
- `purchase_order_complete`
- `purchase_order_cancel`
- `purchase_order_attachment`

Delivery Dispatch sync actions:
- `delivery_order` create
- `delivery_order_assign` for personnel/rider assignment
- `delivery_order_status_update` for state changes

The create and status transition paths already exist in the server sync layer. If the desktop UI exposes offline assignment in the first pass, that assign action should be added to the sync contract in the same implementation batch so the desktop and server stay aligned.

The desktop screen state should reflect the local record immediately, even if sync is pending.

### Record Lists

Both screens should support:
- search
- status filtering
- detail selection
- pagination for large result sets

Both screens should keep a compact record-card style that matches the other desktop workspaces.

## Error Handling

- If the add-on is not enabled, the route should not crash; it should show a locked or unavailable workspace message.
- If a create/update action fails validation locally, show a toast and keep the form open.
- If sync fails later, keep the local record visible and mark the status as pending / needs retry.
- If a record cannot be loaded, show a friendly empty state rather than a blank pane.

## Testing

Add focused coverage for:
- sidebar group visibility when add-ons are enabled / disabled
- route guarding for the two new add-on routes
- Purchase Orders screen render / empty state / detail state
- Delivery Dispatch screen render / empty state / detail state
- existing POS Delivery Dispatch behavior still creating a dispatch order when enabled

Regression tests should verify that:
- the add-ons group only appears when the resolved add-on flags allow it
- the new desktop routes appear in the navigation set
- the screens remain usable when offline cached data is present

## Notes

This design keeps the implementation aligned with the existing server modules and the current desktop shell, so the feature feels native instead of bolted on.
