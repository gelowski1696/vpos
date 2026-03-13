# VPOS Costing Methods Guide

This guide explains each costing method available in **Costing Setup** (`/costing`) and how it affects server-side COGS.

## Important Rule

- COGS is always finalized on the **server** at posting time.
- Deposit is **not** part of inventory cost (it is posted to liability).
- Mobile may show estimate, but final values come from API posting.

## 1) WAC (Weighted Average Cost)

### What it means
Use the current weighted average unit cost of the product in the posting location.

### How VPOS computes it
- Reads `InventoryBalance.avgCost` for `(location, product)`.
- Line COGS = `quantity sold x avgCost`.

### Best use
- LPG operations with frequent refills/inbound changes.
- You want smooth cost movement over time.

### Pros
- Stable and realistic for continuously replenished stock.
- Reduces sudden margin jumps from one expensive batch.

### Cons
- Not tied to one exact batch.
- Requires clean inbound costing updates.

## 2) STANDARD

### What it means
Use fixed cost per product (`Product.standardCost`) instead of moving average.

### How VPOS computes it
- Reads `Product.standardCost`.
- If missing, falls back to WAC safely.
- Line COGS = `quantity sold x standardCost`.

### Best use
- Businesses with planned costing and periodic cost reviews.
- Teams that want predictable margins month to month.

### Pros
- Very simple to explain to non-technical users.
- Stable and budget-friendly for planning.

### Cons
- Can drift from real purchase/refill cost if not maintained.
- Needs regular cost updates in product master data.

## 3) LAST_PURCHASE

### What it means
Use the latest inbound unit cost for the product at that location.

### How VPOS computes it
- Finds most recent positive inbound movement cost from inventory ledger.
- If none found, falls back to standard cost, then WAC.
- Line COGS = `quantity sold x latest inbound unit cost`.

### Best use
- Fast-moving pricing environments where latest replacement cost matters.

### Pros
- Reflects recent market cost quickly.
- Useful when inbound prices are volatile.

### Cons
- Margin can swing sharply between postings.
- Sensitive to data quality of inbound ledger entries.

## 4) MANUAL_OVERRIDE

### What it means
Allow supervised manual COGS input during posting.

### How VPOS computes it
- Only works when `allowManualOverride = true` in costing setup.
- Uses provided manual total COGS and allocates it across lines.
- If manual value is not provided or disabled, VPOS falls back to policy-safe cost resolution.

### Best use
- Exceptional adjustments approved by supervisor/owner.
- Correction scenarios during reconciliation periods.

### Pros
- Flexible for special cases.
- Useful for controlled correction workflows.

### Cons
- Higher risk if governance is weak.
- Must be audited and permission-controlled.

## Worked Samples

Use one common sale example:
- Product: LPG 11kg
- Quantity sold: `2`
- Selling price per unit: `950.00`
- Sales total: `1,900.00`

### Sample A: WAC
- Current `avgCost` at location = `700.0000`
- COGS = `2 x 700.0000 = 1,400.00`
- Estimated gross margin = `1,900.00 - 1,400.00 = 500.00`

### Sample B: STANDARD
- Product `standardCost` = `720.0000`
- COGS = `2 x 720.0000 = 1,440.00`
- Estimated gross margin = `1,900.00 - 1,440.00 = 460.00`

### Sample C: LAST_PURCHASE
- Latest inbound unit cost in ledger = `735.0000`
- COGS = `2 x 735.0000 = 1,470.00`
- Estimated gross margin = `1,900.00 - 1,470.00 = 430.00`

### Sample D: MANUAL_OVERRIDE
- Manual total COGS entered = `1,500.00`
- Final COGS = `1,500.00` (allocated across lines)
- Estimated gross margin = `1,900.00 - 1,500.00 = 400.00`

### Multi-line Manual Override Allocation Example

If one sale has two lines and manual total COGS = `1,500.00`:
- Line 1 total = `950.00`
- Line 2 total = `950.00`
- Subtotal = `1,900.00`

Proportional allocation:
- Line 1 COGS = `950 / 1900 x 1500 = 750.00`
- Line 2 COGS = `950 / 1900 x 1500 = 750.00`
- Combined COGS = `1,500.00`

### Fallback Samples

- `STANDARD` chosen but `standardCost` is empty:
  - VPOS falls back to WAC (safe fallback).
- `LAST_PURCHASE` chosen but no inbound ledger found:
  - VPOS falls back to `standardCost`, then WAC.

### Negative Stock Policy Sample

Requested sale qty = `3`, available stock = `2`:
- `BLOCK_POSTING` -> posting is rejected.
- `ALLOW_WITH_REVIEW` -> posting can continue but should be reviewed.

### Rounding Scale Sample

Raw unit cost = `700.123456`:
- Scale `2` -> `700.12`
- Scale `3` -> `700.123`
- Scale `4` -> `700.1235`

## Related Costing Setup Options

## Negative Stock Policy
- `BLOCK_POSTING`: rejects posting when stock is insufficient.
- `ALLOW_WITH_REVIEW`: allows posting, but should be monitored/reviewed.

## Rounding Scale
- Allowed: `2`, `3`, or `4` decimals.
- Affects calculated unit-cost precision used during posting.

## Landed Cost Toggles (Inbound-focused)
- Include Freight
- Include Handling
- Include Other Costs

These toggles are part of costing policy and are intended for inbound costing workflows and future landed-cost expansion.

## Allocation Basis
- `PER_QUANTITY`
- `PER_WEIGHT`

Used for landed-cost distribution logic in inbound processing/future enhancements.

## Recommended Default for LPG MVP

- Method: `WAC`
- Negative stock: `BLOCK_POSTING`
- Rounding: `4`
- Manual override: `OFF` (enable only for controlled users)

## Audit and Traceability

- Sales posting writes:
  - `Sale`, `SaleLine`, `Payment`, `Receipt`
  - `InventoryBalance`, `InventoryLedger`
  - `EventSales`, `EventStockMovement`
  - `DepositLiabilityLedger` (for deposit movement)
- Costing policy used during posting is captured in event payload metadata.
