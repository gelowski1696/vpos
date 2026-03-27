# Cancel and Recreate Sale Tasks

Implementation guide: [CANCEL_AND_RECREATE_SALE_IMPLEMENTATION.md](d:/vpos/docs/CANCEL_AND_RECREATE_SALE_IMPLEMENTATION.md)

## Goal

Add a safe `Cancel and Recreate Sale` workflow that:
- cancels the original sale,
- creates a new replacement sale draft,
- preserves audit history,
- blocks unsafe downstream cases like open lending.

## A) Product Decisions

- `[PENDING]` Confirm `Cancel and Recreate Sale` is preferred over broad post-save `Edit Sale`.
- `[PENDING]` Confirm no admin approval is required in phase 1.
- `[PENDING]` Confirm open lending blocks recreate.
- `[PENDING]` Confirm posted returns block recreate.
- `[PENDING]` Confirm later settlement/payment blocks recreate.
- `[PENDING]` Confirm recreated sale copies payment mode only, not posted payment history.
- `[PENDING]` Confirm recreated sale does not auto-carry rewards usage.
- `[PENDING]` Confirm a sale can be recreated only once by default.
- `[PENDING]` Confirm offline recreate is allowed only for safe/local-supported cases.

## B) Data Model

- `[PENDING]` Add linkage fields to sale model:
  - `recreatedFromSaleId`
  - `recreatedBySaleId`
- `[PENDING]` Decide whether `recreateReason` lives on:
  - sale audit event only
  - cancel metadata
  - dedicated recreate event table
- `[PENDING]` Add indexes for:
  - `recreatedFromSaleId`
  - `recreatedBySaleId`
  - company + recreated linkage

## C) Prisma and Migration

- `[PENDING]` Update Prisma schema with recreate linkage fields.
- `[PENDING]` Add self-relations safely on sale model.
- `[PENDING]` Generate migration.
- `[PENDING]` Regenerate Prisma client.

## D) API Endpoint Design

- `[PENDING]` Add endpoint:
  - `POST /api/sales/:id/cancel-and-recreate`
- `[PENDING]` Decide whether preview endpoint is needed later:
  - `POST /api/sales/:id/recreate-preview`
- `[PENDING]` Define request payload:
  - `reason`
  - optional `client_recreated_sale_id`
  - optional local/offline linkage token
- `[PENDING]` Define response payload:
  - original sale summary
  - recreated sale summary
  - recreated line details
  - linkage info

## E) API Validation Rules

- `[PENDING]` Validate sale exists.
- `[PENDING]` Validate sale belongs to tenant/company.
- `[PENDING]` Validate sale is active.
- `[PENDING]` Block if sale already cancelled/voided.
- `[PENDING]` Block if open lending exists.
- `[PENDING]` Block if posted returns exist.
- `[PENDING]` Block if later settlement/payment exists.
- `[PENDING]` Block if actor lacks permission.
- `[PENDING]` Require non-empty recreate reason.

## F) API Transaction Logic

- `[PENDING]` Reuse safe sale-cancel logic inside recreate transaction.
- `[PENDING]` Create new sale record as replacement.
- `[PENDING]` Copy reusable sale commercial data.
- `[PENDING]` Do not copy receipt/print/payment history.
- `[PENDING]` Link old and new sale ids.
- `[PENDING]` Write recreate audit event.
- `[PENDING]` Ensure cancel + recreate are atomic in one transaction.

## G) Inventory, Points, and Rewards

- `[PENDING]` Ensure original sale inventory is reversed through existing cancel logic.
- `[PENDING]` Ensure recreated sale does not post stock until finalized normally.
- `[PENDING]` Ensure earned points from original sale are reversed on cancel.
- `[PENDING]` Ensure recreated sale can earn points normally when finalized.
- `[PENDING]` Ensure reward redemption on original sale is reversed/restored through cancel flow.
- `[PENDING]` Ensure recreated sale starts clean and does not inherit applied reward transactions.

## H) Lending and Return Safety

- `[PENDING]` Block recreate when open lending exists.
- `[PENDING]` Block recreate when posted sale returns exist.
- `[PENDING]` Show clear branch-friendly error messages for both cases.

## I) Mobile UI

- `[PENDING]` Add `Cancel and Recreate` button in `Sales > Sale Details`.
- `[PENDING]` Add centered confirmation modal.
- `[PENDING]` Add required reason input.
- `[PENDING]` Show clear explanation:
  - old sale will be cancelled
  - new draft will be created
  - lending-linked sales cannot be recreated
- `[PENDING]` After success, navigate cashier into POS with recreated draft loaded.
- `[PENDING]` Show original/replacement sale linkage in `Sales Details`.
- `[PENDING]` Show branch-friendly badges:
  - `Replacement Sale`
  - `Recreated From`

## J) Mobile Offline Support

- `[PENDING]` Decide safe offline eligibility rules.
- `[PENDING]` Add local linkage token support.
- `[PENDING]` Queue original `sale_cancel` outbox safely.
- `[PENDING]` Create local recreated sale draft immediately.
- `[PENDING]` Ensure sync can reconcile old/new relationship later.
- `[PENDING]` Block offline recreate for known unsafe cases:
  - open lending
  - existing return history
  - unknown downstream state

## K) Web UI

- `[PENDING]` Add web sale-detail visibility for recreated linkage.
- `[PENDING]` Add optional phase-2 `Cancel and Recreate` action in web.
- `[PENDING]` Show old/new sale relationship in sales list/detail.
- `[PENDING]` Use non-technical labels for branch users.

## L) Reporting and Audit

- `[PENDING]` Show original sale as cancelled in reporting.
- `[PENDING]` Show replacement sale as new active sale.
- `[PENDING]` Link both records in audit/history.
- `[PENDING]` Add clear event labels:
  - `SALE_CANCELLED_FOR_RECREATE`
  - `SALE_RECREATED_FROM_SOURCE`

## M) Testing

- `[PENDING]` Test successful cancel-and-recreate with normal item sale.
- `[PENDING]` Test block when open lending exists.
- `[PENDING]` Test block when posted return exists.
- `[PENDING]` Test block when later settlement exists.
- `[PENDING]` Test original sale points are reversed.
- `[PENDING]` Test recreated sale starts without old payment history.
- `[PENDING]` Test recreated sale does not inherit lending/return records.
- `[PENDING]` Test offline queue/reconciliation if phase-1 offline support is included.

## Recommended MVP Order

1. Sale linkage schema fields
2. `POST /api/sales/:id/cancel-and-recreate`
3. mobile `Sales Details` action + confirm modal
4. open POS with recreated draft loaded
5. sale history/linkage visibility in mobile/web

## Concrete Mobile/API Flow

### Mobile

1. cashier opens `Sales`
2. cashier opens `Sale Details`
3. cashier taps `Cancel and Recreate`
4. app shows confirm modal with required reason
5. app validates sale is eligible
6. app sends `POST /api/sales/:id/cancel-and-recreate`
7. API cancels original sale and creates replacement sale
8. mobile receives recreated sale payload
9. app opens POS/cart using recreated sale draft
10. cashier adjusts details and finalizes the corrected sale

### API

1. load source sale
2. validate tenant, status, permission, and block conditions
3. run existing cancel logic on original sale
4. create replacement sale
5. copy reusable commercial details
6. link old and new sale ids
7. write audit event
8. return both sale records in one response

## Exact Rule Summary

Use `Cancel and Recreate Sale` when:
- the whole sale is wrong,
- branch needs a corrected replacement,
- there is no open lending or posted return conflict.

Do not use it when:
- only one normal item needs reversal:
  - use `Return Item`
- the sale has open lending:
  - block recreate
- the sale has posted returns or later settlement that make replacement unsafe.
