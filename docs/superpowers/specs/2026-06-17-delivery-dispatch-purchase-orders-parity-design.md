# Delivery Dispatch Purchase Orders Parity Design

Date: 2026-06-17

## Goal

Make the desktop Delivery Dispatch screen follow the same UI and UX pattern as the desktop Purchase Orders screen.

The dispatch workspace should feel like the same product family:
- same dense management-shell layout
- same summary/filter/list/detail hierarchy
- same modal shell and close affordance
- same button treatment and spacing
- same pagination pattern with page buttons and page size control

## Scope

### In scope

- `apps/desktop/src/screens/DeliveryDispatchScreen.tsx`
- delivery dispatch list presentation
- delivery dispatch detail presentation
- delivery dispatch pagination controls
- delivery dispatch modal shell and buttons
- visual alignment with the Purchase Orders desktop workspace

### Out of scope

- purchase order behavior changes
- API changes
- database schema changes
- new delivery dispatch creation flows
- new assignment flows
- status lifecycle changes
- web UI changes

## Current State

Delivery Dispatch already has working data loading, filtering, status advancement, and detail inspection.

The current screen differs from Purchase Orders in the following ways:
- it uses a lighter list row style instead of the purchase-order card pattern
- it opens a right-side drawer instead of a modal detail shell
- it has a smaller action footer and simpler button hierarchy
- its pagination is basic and does not match the purchase-order pager pattern

Purchase Orders already establishes the target pattern:
- summary card with context and metrics
- filter card with search and chips
- dense record cards
- full modal detail shell
- footer action buttons
- page count controls and page-size selector

## Chosen Approach

Refactor Delivery Dispatch to reuse the same workspace structure as Purchase Orders, while keeping delivery-specific content and status behavior.

Why this approach:
- it gives the user the same working rhythm across both add-on screens
- it reduces cognitive switching between similar desktop workspaces
- it preserves the existing dispatch data model and status transitions
- it avoids unnecessary backend or schema work

## UX Design

### 1. Header And Summary

Use a top shell card that mirrors the Purchase Orders page:
- title: `Delivery Dispatch`
- short context line showing branch and location when available
- summary metrics for the four effective dispatch states

The summary area should feel like the purchase-order metric strip, not a generic dashboard row.

### 2. Filters

Keep the current search and status filtering, but present them with the same spacing and chip style used on Purchase Orders.

The filter section should include:
- search by customer, receipt number, or driver
- status chips for `All`, `Pending`, `In Transit`, `Delivered`, and `Completed`

If the current delivery screen already exposes row counts, keep them, but align their styling to the purchase-order chip treatment.

### 3. Record List

Render dispatch rows as dense cards that mirror the purchase-order record cards:
- left-side icon or status marker
- primary title line
- secondary metadata line
- status pill
- summary metadata
- right-aligned row action button

The row action should behave like Purchase Orders:
- clicking the main row area opens the detail view
- the secondary button should be a `View Details`-style affordance
- the quick status action should remain visible and use the same button weight and spacing as the purchase-order action button

### 4. Pagination

Replace the basic previous/next footer with the same pagination pattern used in Purchase Orders:
- show the current range and total record count
- render numbered page buttons
- include previous/next buttons
- include page size selection

The page size options should remain compact and management-friendly, matching the purchase-order density.

### 5. Detail Modal

Replace the current drawer with a modal detail shell that matches Purchase Orders:
- use `desktop-modal-backdrop`
- use `desktop-modal-card` with the detail variant
- use a desktop modal header with a close icon button
- use a modal body with structured sections
- use a footer for the primary action

The detail modal should show:
- dispatch ID and linked sale
- customer and driver context
- current status
- last updated time
- notes
- item summary

The modal footer should keep the existing status-advance action when a next state exists.
When the dispatch is complete, show a completed indicator instead of an active button.

### 6. Buttons

Use the same button language as Purchase Orders:
- `primary-btn` for the main action
- `secondary-btn` for secondary actions
- `mini-btn` for compact controls
- `modal-close-icon-btn` for the close affordance

The goal is not to add new button variants. The goal is to make the dispatch page feel like it belongs beside Purchase Orders.

## Data And Behavior

The screen should continue to use the existing local desktop data sources:
- `desktopDb.listSales()`
- `desktopDeliveryService.listDispatchStatuses()`

The delivery status flow should remain unchanged:
- `PENDING` -> `TRANSIT`
- `TRANSIT` -> `DELIVERED`
- `DELIVERED` -> `COMPLETED`
- `COMPLETED` stays terminal

Search, filter, and pagination should continue to run against the current in-memory rows.

No new network or persistence behavior is required for this UI parity change.

## Error Handling

- If data loading fails, show the existing toast error and keep the screen usable.
- If the filtered list is empty, show a friendly empty state instead of a blank section.
- If a status update fails, keep the modal open and preserve the selected record.
- If the detail view cannot be resolved, fall back to the list state rather than breaking the workspace.

## Testing

Add or update desktop render coverage so the Delivery Dispatch screen proves the new parity behavior:
- header and summary copy render
- filter chips render
- record cards render
- pagination footer renders with page controls
- modal shell renders with the purchase-order-style close button and footer action
- terminal empty state still renders
- the existing status-advance action is still visible and wired

Regression coverage should focus on behavior that matters to the user:
- the list still paginates
- the modal still opens from a row
- the status action still advances the selected dispatch

## Self-Review

- No placeholders remain.
- The scope is limited to the Delivery Dispatch desktop UI.
- The design does not introduce unsupported backend or schema work.
- The modal, buttons, and pager are explicitly aligned to the Purchase Orders pattern.
- The existing dispatch lifecycle is preserved.
