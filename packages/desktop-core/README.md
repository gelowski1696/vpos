# VPOS Desktop Core

Framework-neutral contracts and pure transformations shared by both VPOS desktop frontends.

The initial extraction includes:

- desktop persisted-state, sale, inventory, transfer, lending, purchasing, and delivery contracts;
- default state and receipt-layout values;
- persisted-state and legacy-sale normalization;
- canonical sale outbox payload construction.
- settings/setup/sync/receipt/walkthrough state transitions behind `DesktopStateRepository`.
- projected local inventory calculations behind `DesktopStockProjectionRepository`.
- cashier startup/offline-unlock/sign-out decisions behind session auth, settings, and subscription
  ports;
- subscription grace and workstation access decisions behind `DesktopSubscriptionPolicyRepository`.
- authentication transport, token refresh/retry, logout, enrollment, timeout handling, and API error
  mapping behind injected settings, subscription-policy, and fetch ports.
- queue push/pull synchronization, timeout handling, server-result reconciliation, and linked-record
  status updates behind repository, authentication, subscription, and operational service ports.
- sale persistence, cancellation, returns, customer balance settlements, lending guards, inventory
  restoration, and outbox creation behind repository, authentication, settings, and policy ports.
- shift opening/closing, cashier identity, cash adjustments, inventory snapshots, sync status, and
  outbox creation behind repository, inventory-snapshot, and subscription-policy ports.
- expense, transfer, purchase-order, delivery/dispatch, lending-return, and LPG action workflows
  behind shared operational repository, transaction-policy, shift, and cached-detail ports.

`apps/desktop/src/db` and the React service paths keep compatibility adapters while Angular composes
the framework-neutral implementations directly.

Build the package before consuming its runtime exports:

```powershell
pnpm --filter @vpos/desktop-core build
```

Both desktop applications run this build automatically from their development, production-build,
typecheck, and relevant test scripts.
