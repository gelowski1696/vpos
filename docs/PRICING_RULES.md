# VPOS Pricing Rules Guide

This guide explains how pricing works in VPOS so non-technical users can set prices confidently.

## Pricing Resolution Order (Highest to Lowest)

When VPOS computes a selling price, it checks rules in this order:

1. Contract price (customer-specific)
2. Tier price (customer tier, e.g. Premium)
3. Branch override price
4. Global default price

If multiple eligible rules exist, VPOS uses the one with the best precedence and valid effectivity.

## Core Terms

## Price List
A container of pricing rules (example: `Global Default`, `Main Branch Override`).

## Price Rule
A product price entry inside a price list.

## Scope
Where the price applies:
- `GLOBAL`: all branches/customers
- `BRANCH`: one branch
- `TIER`: one customer tier
- `CONTRACT`: one specific customer

## Effectivity
Date range when a price is active:
- `startsAt` = when it starts
- `endsAt` = optional end date

A rule is valid only if current posting/request date is within the window.

## Priority (Inside Matching Rules)
Lower number = higher priority.
Example:
- `1` beats `2`
- `2` beats `3`

Use this to break ties within same scope/time context.

## Discount Cap
Maximum discount allowed for that rule (usually role-controlled).
Example:
- Price = 950
- Discount cap = 5%
- Max discount = 47.50

## How Price is Chosen (Simple Flow)

1. Identify product, branch, customer, request date.
2. Filter active rules by effectivity.
3. Apply precedence (Contract -> Tier -> Branch -> Global).
4. If multiple remain, use best priority.
5. Return final unit price + discount cap policy.

## Common Setup Patterns

## Pattern A: Basic Retail
- Maintain global prices only.
- Add branch overrides only where needed.

## Pattern B: Dealer Tiering
- Keep global baseline.
- Add tier lists for premium/reseller tiers.

## Pattern C: Contract Accounts
- Keep global/tier for normal users.
- Add contract pricing for named business customers.

## Best Practices

- Always keep a global default for each product.
- Use branch overrides only for local differences.
- Use tier pricing for segments, contract pricing for special accounts.
- Set future schedules in advance (new `startsAt`).
- Avoid overlapping duplicate rules with same scope/product/date.
- Review discount caps by role and supervisor policy.

## Quick Example

For `LPG 11kg`:
- Global = 950
- Branch Main = 940
- Tier Premium = 920
- Contract Customer ABC = 900

Result:
- Walk-in at Main branch -> 940 (branch beats global)
- Premium customer at Main -> 920 (tier beats branch)
- Contract customer ABC -> 900 (contract beats tier/branch/global)

## Related Endpoints

- `POST /api/pricing/resolve`
- Master data price list CRUD:
  - `GET /api/master-data/price-lists`
  - `POST /api/master-data/price-lists`
  - `PUT /api/master-data/price-lists/:id`
