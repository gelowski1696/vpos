# Cancel and Recreate Sale Implementation Guide

## 1. Purpose

This document defines the safe correction flow for posted sales where the branch should not edit the saved sale directly.

Goal:
- avoid broad post-save sale editing,
- preserve full audit history,
- let cashiers fix a wrong sale quickly,
- keep inventory, points, rewards, and lending safe,
- define the exact behavior of `Cancel and Recreate Sale`.

Companion task list: [TASKS_CANCEL_AND_RECREATE_SALE.md](d:/vpos/docs/TASKS_CANCEL_AND_RECREATE_SALE.md)

## 2. Core Principle

Do not mutate a posted sale as if it were still a draft.

For correction of a saved sale, prefer:
- cancel the old sale safely,
- copy the commercial details into a new sale draft,
- let the cashier finalize the corrected replacement sale.

This is safer than direct sale editing because it:
- keeps the original transaction intact for audit,
- avoids hidden changes to inventory-driving data,
- produces a clear old-sale/new-sale relationship,
- fits both online and offline branch operations better.

## 3. What "Cancel and Recreate Sale" Means

`Cancel and Recreate Sale` is a guided correction flow with two linked outcomes:

1. the original sale becomes `CANCELLED`, and
2. a new sale draft is created from the original sale's reusable details.

The recreated sale is not the same record.

It must get:
- a new sale id,
- a new receipt flow,
- a new sync lifecycle,
- its own later payments, rewards, and printing events.

The original sale remains visible in history and should clearly show:
- it was cancelled,
- it was recreated,
- which new sale replaced it.

The recreated sale should clearly show:
- it came from an earlier cancelled sale.

## 4. Why This Is Better Than Edit Sale

Direct post-save editing is risky because a saved sale may already have:
- stock effects,
- LPG refill/non-refill effects,
- points earned,
- reward redemption,
- customer settlement state,
- receipt history,
- sync history,
- lending or return dependencies.

Changing a saved sale in place makes the system harder to trust.

`Cancel and Recreate Sale` is easier to reason about:
- the old transaction is reversed cleanly,
- the corrected one is built as a fresh transaction,
- both records remain traceable.

## 5. Recommended Business Rules

### 5.1 When to use Cancel and Recreate

Use it when:
- the whole sale is wrong,
- cashier needs to fix customer, quantity, payment mode, or item mix,
- branch wants a corrected replacement sale instead of partial return handling,
- there is no blocking downstream activity.

### 5.2 When not to use it

Do not use it when:
- only one normal item needs reversal and the rest of the sale is valid:
  - use `Return Item`
- the sale already has open lending:
  - lending-linked sales should be blocked
- the sale already has posted returns:
  - use return/void handling, not recreate
- the sale has later settlement/payment state that should not be silently replaced
- the sale is already cancelled/voided

### 5.3 Recommended block conditions

Block `Cancel and Recreate Sale` if any are true:
- sale already cancelled or voided,
- open lending exists on the sale,
- posted sale returns already exist,
- later customer settlement payments exist,
- non-reversible downstream reconciliation exists,
- sale belongs to another tenant/company,
- actor lacks permission.

## 6. What Should Be Copied

### 6.1 Copy these fields

Copy only reusable commercial details:
- customer
- branch
- location
- sale type
- sale lines
- quantities
- unit prices
- discount amount
- payment mode as an initial suggestion
- personnel/driver/helper references if still relevant
- notes that are part of the order context

### 6.2 Do not copy these fields

Do not copy:
- sale id
- receipt number
- sync status
- created/updated timestamps
- print history
- settlement history
- customer payment history
- loyalty posting history
- reward redemption record ids
- lending records
- return records
- audit actor history

### 6.3 Payment copy rule

Recommended default:
- copy `payment_mode`
- do not copy posted payment transaction history
- for recreated sale, start with a clean payment state derived from the draft/cart flow

This is especially important for:
- `FULL -> PARTIAL` corrections
- `PARTIAL -> FULL` corrections
- wrong payment method corrections

The recreated sale should be finalized normally, not inherit posted payment rows from the original sale.

## 7. Linking Model

Recommended sale-link fields:
- `recreatedFromSaleId` on the new sale
- `recreatedBySaleId` on the old sale
- `recreateReason` on the old sale cancellation event or audit entry

This creates a clean chain:
- old sale -> replacement sale
- replacement sale -> original sale

Recommended rule:
- a sale can be recreated only once by default
- if repeated correction is needed, recreate the newest active replacement, not the historical original again

## 8. Mobile Flow

### 8.1 Entry point

In VPOS mobile:
- `Sales`
- open `Sale Details`
- action: `Cancel and Recreate`

### 8.2 Confirm dialog

Show a clear confirmation dialog:

Title:
- `Cancel and Recreate Sale`

Body:
- this will cancel the current sale,
- a new draft will be created with the same sale details,
- the old sale remains in history,
- sales with open lending cannot be recreated.

Fields:
- required reason

Actions:
- `Continue`
- `Close`

### 8.3 Validation step

Before proceeding:
- check sale is active,
- check no open lending,
- check no return conflict,
- check no settlement conflict,
- check actor permission,
- check source sale exists locally or from API.

### 8.4 Execution step

Recommended mobile behavior:

1. request recreate from API when online
2. if offline:
- queue a `sale_cancel`
- create a local recreated draft immediately
- store a local linkage marker so sync can reconcile later

### 8.5 Result

After success:
- old sale shows `Cancelled`
- POS opens with copied draft details
- cashier lands in cart/payment flow ready to correct and finalize

### 8.6 Important mobile UX rule

Do not silently recreate in the background.

Always:
- confirm the action,
- tell the cashier the original sale will be cancelled,
- open the new draft immediately after success.

## 9. API Flow

### 9.1 Recommended endpoint design

Recommended first implementation:
- `POST /api/sales/:id/cancel-and-recreate`

Request body:
- `reason`
- optional `client_recreated_sale_id` for offline/local mobile coordination

Response:
- cancelled original sale summary
- recreated sale summary
- copied line details
- linkage ids

Alternative split design if needed later:
- `POST /api/sales/:id/recreate-preview`
- `POST /api/sales/:id/cancel-and-recreate`

But for branch speed, one transactional endpoint is the better default.

### 9.2 Transaction behavior

The endpoint should do all of this in one transaction:

1. load original sale
2. validate recreate eligibility
3. cancel original sale using the existing cancel rules
4. create new sale record
5. copy reusable sale details
6. write recreate linkage fields
7. write audit event
8. return both records

### 9.3 Safety behavior

If cancellation fails:
- do not create recreated sale

If recreated sale creation fails:
- do not leave the original half-cancelled without the replacement

This should be atomic.

## 10. Offline Behavior

### 10.1 Recommended offline support

Offline support is useful, but should be constrained.

Recommended offline rule:
- allow local `Cancel and Recreate` only when the sale is still local/pending or when local data is sufficient to build the replacement draft safely

When offline:
- create local replacement sale draft
- queue original `sale_cancel`
- queue recreated sale as a normal new sale
- store a local linkage token so sync can later resolve old/new relationship

### 10.2 Offline sync reconciliation

On sync:

1. original sale must sync/cancel correctly
2. recreated sale posts as a new sale
3. API should preserve the relationship using:
- original sale id
- client linkage token
- recreated local sale id if provided

### 10.3 Offline restrictions

Block offline `Cancel and Recreate` if:
- open lending is known locally,
- return history already exists locally,
- the sale has complex downstream state not safely represented offline.

## 11. Inventory, Points, Rewards, and Lending Rules

### 11.1 Inventory

The original sale cancellation should reverse inventory exactly as normal cancel does.

The recreated sale should post fresh inventory effects only when it is finalized.

Do not carry over old stock movements.

### 11.2 Points

If the original sale already earned points:
- cancel should reverse those points

The recreated sale should earn points only when it is finalized normally.

### 11.3 Rewards

If the original sale used rewards:
- cancel should restore/reverse according to existing sale cancel rules

The recreated sale should not inherit applied reward transactions automatically unless explicitly chosen again in the new sale flow.

### 11.4 Lending

Open lending blocks recreate.

Reason:
- the original sale already created downstream physical-asset accountability,
- recreating would make ownership and reversal ambiguous.

## 12. Reporting and Audit

Reports should clearly show:
- original sale as cancelled,
- recreated replacement sale as active/new,
- linkage between them.

Recommended audit/event wording:
- `SALE_CANCELLED_FOR_RECREATE`
- `SALE_RECREATED_FROM_SOURCE`

User-facing wording should stay simple:
- `Cancelled and Recreated`
- `Replacement Sale`
- `Recreated From`

## 13. Permissions

Recommended phase 1 permissions:

### Cashier
- can use `Cancel and Recreate` if branch policy allows cashier cancellation

### Supervisor
- can use it

### Admin / Owner
- full control

### Platform Owner
- not required for daily branch operation

No admin approval is required in the first phase if branch policy is intentionally simple.

## 14. Recommended MVP Scope

Implement first:

1. `Cancel and Recreate` endpoint
2. sale linkage fields
3. mobile `Sales Details` action
4. open POS/cart with recreated draft
5. show old/new sale relationship in sale detail

Do later:

1. web `Cancel and Recreate` action
2. recreate preview mode
3. approval workflow
4. advanced offline conflict resolution

## 15. Concrete Example

Original sale:
- Customer A
- 2 items
- wrong payment mode
- no lending
- no returns

Cashier flow:

1. open original sale
2. tap `Cancel and Recreate`
3. enter reason: `Wrong payment setup`
4. confirm
5. system cancels original sale
6. system opens new draft with same customer/items
7. cashier changes payment setup
8. cashier finalizes new sale

Result:
- old sale remains cancelled in history
- new corrected sale becomes the valid operational transaction

## 16. Final Recommendation

For posted-sale correction, prefer:
- `Return Item` for partial normal-item correction
- `Cancel Sale` for full reversal
- `Cancel and Recreate Sale` when the whole sale is wrong but should be rebuilt quickly

Do not implement broad post-save `Edit Sale` before this flow.
