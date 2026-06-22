# POS Settings Controls Design

Date: 2026-06-22

## Goal

Add a new `POS Settings` control system that lets an admin manage tenant-wide POS access from the web admin.

The first version should behave like a lightweight operational RBAC layer for POS, but without introducing per-role permissions yet. Admin-managed settings should hard-restrict selected POS modules on desktop, remain enforced offline after sync, and stay clearly separated from subscription add-ons.

## Scope

### In scope

- `apps/web/src/app/(admin)` new `POS Settings` management page
- `apps/web/src/components/admin-shell.tsx` navigation entry and visibility rules
- `apps/api/src/modules/entitlements` or a sibling tenant-policy module for tenant-wide POS control read and update endpoints
- desktop master-data refresh and local cache of the POS control policy
- desktop route and screen enforcement for blocked POS modules
- audit logging for admin updates to POS settings
- web, API, and desktop test coverage for the new policy flow

### Out of scope

- per-role POS permissions
- cashier-by-cashier access overrides
- mobile app enforcement
- action-level restrictions such as discount override, void sale, or reprint receipt
- replacing or removing the current tenant add-on system
- changing subscription licensing behavior

## Current State

The codebase already has several patterns this design should reuse:

- tenant add-ons are managed from Tenant Management in web
- web navigation already hides add-on-dependent routes in `apps/web/src/components/admin-shell.tsx`
- the API already returns tenant add-ons from `/platform/entitlements/current`
- desktop branch-data refresh already downloads tenant add-ons and stores them locally as `tenant_addons`
- desktop app boot and route composition already read cached tenant add-on flags to decide which add-on screens are available
- some sensitive report access already uses tenant-aware API enforcement, such as inventory report restrictions tied to `shift_security_controls`

What is missing is a dedicated operational control policy for POS itself. Right now:

- add-ons answer whether a licensed feature exists for the tenant
- roles answer who can enter broad parts of the web admin
- desktop POS does not have a dedicated tenant-wide operational policy that can disable selected modules while staying offline-first

## Chosen Approach

Add a dedicated tenant-wide `POS Settings` policy object instead of extending add-ons for operational controls.

Why this approach:

- it keeps subscription entitlement separate from day-to-day branch operations
- it matches the current admin-control model where tenant-wide settings are managed centrally in web
- it avoids overloading add-ons with too many meanings
- it scales cleanly into future action-level controls without forcing a full RBAC matrix now
- it fits the current desktop offline sync pattern because the policy can be cached like tenant add-ons

This policy is tenant-wide and hard-enforced. A blocked module should not only disappear from menus, it should also be denied if a route or screen is reached directly.

## Control Model

The first release should support tenant-wide boolean controls for selected desktop POS modules.

Core cashier flow should remain outside the toggle set in v1:

- `POS` stays always enabled
- `Sales` stays always enabled

Initial toggle set:

- `Reports`
- `Inventory Reports`
- `Customers`
- `Items`
- `Transfer`
- `Lending`
- `Expense`
- `Shift`
- `Settings`
- `Purchase Orders`
- `Delivery Dispatch`

Interpretation rules:

- `Transfer` covers both transfer creation and transfer history
- `Inventory Reports` covers inventory count and inventory-heavy report views, not all reporting
- `Settings` means desktop workstation and device settings, not web admin settings
- `Purchase Orders` and `Delivery Dispatch` should only matter when the related add-on is enabled

Suggested future controls, but not part of v1:

- discount override
- price override
- void or cancel sale
- reprint receipt
- hold or recall queue order
- manual sync now
- view cost or margin
- inventory opening edit
- local reset or maintenance actions

## UX Design

### 1. Web Entry Point

Add a new web admin page:

- route: `/pos-settings`
- section: existing admin shell `Settings` group
- audience: `admin`, `owner`, and `platform_owner`

The page should feel like an operational control board, not a licensing screen.

### 2. Settings Layout

Use a compact settings layout with grouped toggle rows or cards.

Recommended groups:

- `Operations`: Transfer, Lending, Shift, Settings
- `Inventory`: Items, Inventory Reports, Purchase Orders, Delivery Dispatch
- `Financial`: Reports, Expense
- `Customer Access`: Customers

Each control should show:

- module name
- short description
- enabled or disabled state
- add-on dependency note when relevant

The page should also show:

- last updated timestamp
- last updated by, when available
- unsaved changes state
- save and reset actions

### 3. Save Behavior

Saving should:

- persist all toggles in one request
- accept an optional admin note for audit logging
- show success and error toast feedback
- keep the page state if the save fails

The admin note should be optional, but available on every save.

### 4. Desktop UX

When a module is disabled by POS Settings:

- remove it from the sidebar or route picker when possible
- block direct screen access if reached indirectly
- show a clear message such as `Disabled by admin POS settings`

The blocked state should explain that:

- the module is disabled for this tenant
- branch data refresh may be required if the setting was just changed

The UI should not fail with empty lists, missing data errors, or broken routing.

### 5. Shift Safety Rule

`Shift` control needs one special rule:

- if the Shift module is disabled while a branch already has an active shift, the app must still allow the minimum close-out path needed to end that shift safely

The policy should block ordinary shift browsing and opening new shifts, but it should not strand an in-progress workstation in a state where the user cannot close the shift.

## API And Data Model

Add a dedicated POS policy record scoped by tenant.

Recommended shape:

```ts
type PosControlPolicy = {
  companyId: string;
  reportsEnabled: boolean;
  inventoryReportsEnabled: boolean;
  customersEnabled: boolean;
  itemsEnabled: boolean;
  transferEnabled: boolean;
  lendingEnabled: boolean;
  expenseEnabled: boolean;
  shiftEnabled: boolean;
  settingsEnabled: boolean;
  purchaseOrdersEnabled: boolean;
  deliveryDispatchEnabled: boolean;
  updatedAt: string;
  updatedBy: string | null;
};
```

Recommended API surface:

- `GET /platform/pos-settings/current`
- `POST /platform/pos-settings/current`
- `POST /platform/owner/tenants/:companyId/pos-settings`

Behavior:

- current tenant read endpoint should return the effective policy for the authenticated tenant
- current tenant update endpoint should allow `admin`, `owner`, and `platform_owner` to manage the authenticated tenant's POS policy from the web admin
- owner update endpoint should allow `platform_owner` to manage any tenant centrally when needed

Default behavior:

- all toggles default to `true` for existing tenants so no module is unexpectedly blocked after rollout

Audit behavior:

- every update should write an audit event
- store the previous and next policy values
- store the optional admin note

## Add-On And Policy Interaction

Add-ons and POS Settings must not compete with each other.

Use this resolution order:

1. subscription and add-ons decide whether a module is available for this tenant at all
2. POS Settings decide whether the available module is operationally enabled on desktop

Examples:

- if `delivery_dispatch_suite` is disabled, Delivery Dispatch is unavailable regardless of POS Settings
- if `delivery_dispatch_suite` is enabled but `deliveryDispatchEnabled` is false, desktop must still block Delivery Dispatch
- if `purchase_order_suite` is disabled, Purchase Orders stay hidden even if the POS policy says enabled

This preserves the existing subscription model while adding an operational control layer above it.

## Desktop Offline Enforcement

Desktop should cache the current POS policy during branch-data refresh, using the same offline-first pattern already used for `tenant_addons`.

Recommended flow:

1. branch-data refresh calls the POS settings read endpoint
2. the policy payload is saved locally as a master-data entity such as `pos_control_policy`
3. app boot loads the cached policy
4. route composition and screen guards use the cached policy even when offline

Recommended desktop behavior:

- hide disabled routes from the sidebar
- prevent route activation for disabled modules
- guard screen render paths in case route selection is forced
- refresh the cached policy again whenever branch data is refreshed or quick setup completes

Offline rule:

- if the device is offline, continue enforcing the last successfully synced policy

Fallback rule:

- if no policy has ever been synced for an existing tenant, use the all-enabled default

## Web Authorization

The web page should follow the existing broad admin authorization model.

Recommended access:

- `admin`
- `owner`
- `platform_owner`

Non-admin users should not see the page in navigation and should not be able to update the policy directly through the API.

## Error Handling

- If the POS settings read endpoint fails in web, show a clear retry state and do not render misleading defaults as saved state.
- If save fails, keep local toggle changes in place and show a useful error.
- If desktop cannot refresh the latest policy, continue enforcing the last cached policy instead of clearing restrictions.
- If desktop has no cached policy yet, fall back to all-enabled defaults and mark the state as not yet synced.
- If a disabled module is reached directly, render a blocked-state message instead of crashing or redirect-looping.
- If the Shift module is disabled while an active shift exists, preserve the close-shift path.

## Rollout Plan

Recommended implementation order:

1. add API storage, read endpoint, update endpoint, and audit logging
2. add the web `POS Settings` page and navigation entry
3. add desktop sync download and local cache
4. add desktop route filtering and screen guards
5. add shift-specific safety behavior
6. add tests across API, web, and desktop

This rollout keeps the policy visible and testable in each layer before enforcement becomes stricter on desktop.

## Testing

### Web tests

- page renders for authorized admin roles
- unauthorized users do not see the navigation entry
- toggles load current policy state
- add-on-dependent modules show the right helper text
- save submits the expected payload
- failed save preserves the local draft

### API tests

- current tenant endpoint returns the default all-enabled policy when no record exists
- update endpoint persists all toggles
- update endpoint writes an audit event
- unauthorized roles cannot update the policy
- add-on-independent policy fields remain stable when unrelated entitlement data changes

### Desktop tests

- cached policy loads from local master data
- disabled routes are removed from visible navigation
- forced access to a blocked route renders a blocked state
- add-on plus policy combination resolves correctly
- offline app continues enforcing the last cached policy
- shift-disabled scenario still allows safe close-out of an active shift

## Self-Review

- The design stays tenant-wide and does not drift into per-role RBAC.
- The design separates licensed availability from operational access.
- The desktop behavior stays offline-first by caching the policy locally.
- Core cashier flow is protected by leaving `POS` and `Sales` outside the first toggle set.
- Shift close-out safety is explicitly called out to avoid trapping active workstations.
