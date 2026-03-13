# VPOS Testing (Web First)

## Marking Legend
- `[ ]` Not yet tested
- `[x]` Passed
- `[~]` Blocked / needs fix

## Current Baseline
- [x] Workspace build passes (`pnpm -r --if-present build`)
- [ ] API running locally
- [ ] Web running locally

## Start Commands
```bash
# from repo root
pnpm install
pnpm db:create
pnpm --filter @vpos/api prisma:migrate:deploy
pnpm --filter @vpos/api start:dev
pnpm --filter @vpos/web dev
```

Web default URL: `http://localhost:3000`
API expected URL for web: `http://localhost:3001/api`

If your local Postgres uses different admin credentials, run:
```powershell
pnpm --filter @vpos/api db:create -- -AdminUser <postgres_admin_user> -AdminPassword <postgres_admin_password> -DbName vpos -DbUser vpos -DbPassword vpos
```

If `psql` is not on PATH:
```powershell
pnpm --filter @vpos/api db:create -- -PsqlPath "C:\Program Files\PostgreSQL\16\bin\psql.exe"
```

## Fresh Reset (Dedicated Dual-Tenant Seed)
- [x] Run full reset + reseed:
```powershell
pnpm db:reset:fresh
```
- [x] Expected seeded baseline:
  - Owner login: `owner@vpos.local` / `Owner@123`
  - Exactly two tenant/DB profiles in `DEDICATED_DB` mode:
    - `DEMO_STORE`: `STORE_ONLY` (1 branch `MAIN`, 1 location `LOC-MAIN`)
    - `DEMO_WH`: `STORE_WAREHOUSE` (2 branches `MAIN/WH1`, 2 locations `LOC-MAIN/LOC-WH1`)
  - Both tenants include standard LPG master seed (products, cylinder types, customers, price lists, expense category, costing)

## Web Smoke Checklist

### A) Auth and Access
- [ ] Login works with admin credentials (`admin@vpos.local`) without manually entering tenant code
- [ ] Login with non-web roles (cashier/driver/helper) shows clear "Web Admin access required" message
- [ ] Invalid login shows error
- [ ] Protected pages redirect correctly when not authenticated
- [ ] Logout returns to login page

### B) Branding
- [ ] Open `/branding` successfully
- [ ] Save company name/colors/footer text
- [ ] Web preview updates after save
- [ ] Receipt preview (58mm) updates after save

### C) Master Data CRUD
- [ ] Branches: create + edit + list
- [ ] Locations: create + edit + list
- [ ] Users: create + edit + list
- [ ] Customers: create + edit + list
- [ ] Products: create + edit + list
- [ ] Cylinder Types: create + edit + list
- [ ] Price Lists: create + edit + list
- [ ] Costing Setup: open `/costing`, update policy, save, reload persists
- [ ] Expense Categories: create + edit + list
- [ ] Users: safe delete sets user inactive (record remains for audit)
- [ ] Locations: safe delete works only when not linked to branch (`branchId=null`)
- [ ] Branches: safe delete auto-deactivates linked locations
- [ ] Branches/Locations/Users forms no longer show `Active` dropdown
- [ ] Branches/Locations/Users action button shows `Deactivate` for active rows and `Reactivate` for inactive rows

### D) Pricing and Reports
- [ ] Pricing resolve endpoint returns expected precedence output
- [ ] Reports page date-range filters (`Since`/`Until`) refresh KPI cards and tables
- [ ] Reports page branch filter updates branch-scoped sections (sales, margin, x/z read)
- [ ] Reports page loads Sales/COGS/Gross Profit/Deposit Liability KPI cards
- [ ] Reports page loads X-read and Z-read tables
- [ ] Reports page loads inventory movement ledger summary
- [ ] Reports page loads FULL vs EMPTY counts by location
- [ ] Reports page still loads petty cash summary cards
- [ ] Reports page still loads petty cash entry rows
- [ ] Shift filter on reports works
- [ ] Export Overview CSV downloads valid file
- [ ] Export Movement CSV downloads valid file
- [ ] Export Petty Cash CSV downloads valid file
- [ ] Print Report action opens browser print flow
- [ ] Audit Logs page (`/audit-logs`) loads tenant audit stream rows

### E) Role/Permission Checks
- [ ] Cashier cannot access admin-only master data routes (403)
- [ ] Admin can access all current web admin modules

### F) Owner Console (Phase 4.2)
- [ ] Login works for platform owner (`owner@vpos.local` / `Owner@123`)
- [ ] `/tenants` loads tenant health list (status, topology, counts)
- [ ] Add tenant from subscription (`client_id`) succeeds from `/tenants`
- [ ] Non-owner user cannot access owner endpoints (403)
- [ ] Suspend tenant from `/tenants` then posting is blocked
- [ ] Reactivate tenant then posting works again
- [ ] Override entitlement from `/tenants` is reflected and audited
- [ ] Delete tenant from `/tenants` removes it from tenant list and writes `PLATFORM_TENANT_DELETE` audit log
- [ ] For `DEDICATED_DB` tenant delete, dedicated tenant database is dropped (unless `VPOS_DEDICATED_DB_DROP_ON_TENANT_DELETE=false`)
- [ ] Provision-from-subscription blocks duplicates: second create with same `client_id` returns `409` until tenant is deleted

### G) Owner-Only Structure Controls (Phase 4.3)
- [ ] Non-owner login does not see `Branches`, `Locations`, and `Users` in sidebar
- [ ] Non-owner API call to `/master-data/branches|locations|users` returns 403
- [ ] Owner login can access and manage `Branches`, `Locations`, and `Users`

### H) Dedicated Tenant Live Smoke (Phase 7.3)
- [ ] Shared DB migration is up to date:
```powershell
pnpm --filter @vpos/api prisma:migrate:deploy
```
- [ ] Run dedicated live smoke (real dedicated DB URL mapping + auto provisioning):
```powershell
$env:VPOS_RUN_LIVE_DEDICATED_SMOKE='true'
pnpm --filter @vpos/api test -- --runInBand dedicated-live-smoke.e2e-spec.ts
Remove-Item Env:VPOS_RUN_LIVE_DEDICATED_SMOKE
```
- [ ] Expected result:
  - `PASS test/dedicated-live-smoke.e2e-spec.ts`
  - provisioning returns `datastore_migration_state = COMPLETED`
  - tenant owner login succeeds
  - tenant branch read + sale post succeed

### I) Datastore Registry Automation (No Manual .env Per Tenant)
- [ ] Apply latest API migrations:
```powershell
pnpm --filter @vpos/api prisma:migrate:deploy
```
- [ ] Ensure `VPOS_DATASTORE_ENCRYPTION_KEY` is set (required for production; optional fallback in local dev)
- [ ] Provision a new `DEDICATED_DB` tenant without adding `VPOS_DEDICATED_DB_URLS_JSON` entry manually
- [ ] Confirm branch/location reads work for that tenant after restart
- [ ] Confirm no `Dedicated datastore URL is not configured` error for newly provisioned dedicated tenant

### J) SubMan Bearer Auto-Refresh (No Manual Token Rotation)
- [ ] Set SubMan auth envs in `apps/api/.env`:
  - `SUBMAN_TOKEN_AUTO_REFRESH=true`
  - `SUBMAN_AUTH_LOGIN_PATH=/v1/auth/login` (adjust if your SubMan path differs)
  - `SUBMAN_AUTH_EMAIL=<service account email>`
  - `SUBMAN_AUTH_PASSWORD=<service account password>`
- [ ] Keep `SUBMAN_API_KEY` empty for this test to force bearer mode
- [ ] Restart API and run:
```powershell
pnpm --filter @vpos/api test -- --runInBand subman-token.e2e-spec.ts subscription-gateway-auth.e2e-spec.ts
```
- [ ] Expected:
  - token service caches token and avoids re-login on each request
  - gateway retries once on `401` using refreshed token

### K) Reset Seeded Dedicated Tenants (Local)
- [ ] Run cleanup for seeded dedicated smoke tenants:
```powershell
pnpm tenants:cleanup:seeded
```
- [ ] Optional dry-run first:
```powershell
pnpm tenants:cleanup:seeded -- --dry-run
```
- [ ] Expected:
  - seeded `tenant-ded-live-*` smoke tenants removed from owner console
  - matching dedicated smoke databases dropped locally

### L) Milestone 6.3 Operations Baseline
- [x] Run retention dry-run:
```powershell
pnpm ops:retention:dry-run
```
- [x] Run backup script:
```powershell
pnpm ops:backup
```
- [x] Verify runbook file exists and reviewed:
  - `docs/OPERATIONS_RUNBOOK.md`
- [x] Verify ops scheduler workflow exists:
  - `.github/workflows/ops-maintenance.yml`
- [x] Run combined maintenance runner:
```powershell
pnpm ops:maintenance
```

### M) Mobile Native Printer (Milestone 4.3)
- [ ] Install/update dependencies:
```powershell
pnpm install
```
- [ ] Build and install Android Dev Client (required for native printer bridge):
```powershell
cd apps/mobile/android
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:installDebug
```
- [ ] If Gradle complains about missing env at compile time, set:
```powershell
$env:NODE_ENV='development'
```
- [ ] Open mobile app -> login -> Printer Setup.
- [ ] Confirm capability labels:
  - `Native Bridge: Available`
  - `iMin SDK: Detected` (on iMin devices with SDK/runtime support)
- [ ] For Bluetooth ESC/POS:
  - Select `Bluetooth ESC/POS`
  - Enter `Bluetooth MAC`
  - Tap printer type button to save
  - Tap `Test Print`
- [ ] For Generic Built-in/TCP ESC/POS:
  - Select `Generic Built-in`
  - Enter `TCP Host` and `TCP Port` (default `9100`)
    - Host accepts `192.168.x.x` or `192.168.x.x:9100`
  - Tap `Save Printer Settings`
  - Tap `Test Print`
- [ ] For iMin:
  - Select `iMin Built-in`
  - Tap `Save Printer Settings`
  - Tap `Test Print`
- [ ] Expected:
  - Test print returns success message in app.
  - Printer outputs receipt lines with alignment/emphasis.
  - No crash when switching among `IMIN`, `GENERIC_BUILTIN`, `BLUETOOTH`, `NONE`.

### N) Mobile UX Tabs + Toasts
- [ ] Login screen shows helper text under Email/Password/PIN fields.
- [ ] Unlock screen shows helper text under PIN field.
- [ ] READY state shows module tabs:

### O) Customer Pay-Later Settlement (API + Web + Mobile)
- [ ] Create a sale with `payment_mode=PARTIAL` (or credit) from mobile POS and sync successfully.
- [ ] Verify customer outstanding balance increases in web `/customers` (Outstanding Balance column).
- [ ] Open web `/customer-payments` and post a settlement payment for the same customer.
- [ ] Verify payment appears in customer payment history table.
- [ ] Verify customer outstanding balance decreases after posting payment.
- [ ] Mobile: open `Customers` module, queue an offline customer payment, sync, and verify status changes to synced.
- [ ] Verify synced mobile customer payment appears in web `/customer-payments` history.
  - `POS`, `DELIVERY`, `TRANSFERS`, `SHIFT`, `SETTINGS`
- [ ] Switching tabs updates visible module card correctly.
- [ ] SETTINGS tab shows printer setup and logout button.
- [ ] Toast appears on:
  - successful login/unlock/logout
  - printer save success/failure
  - test print success/failure

### O) Mobile Real Feature Screens (Persisted Local)
- [ ] POS tab:
  - add product(s) to cart
  - update quantity (+/-)
  - queue offline sale successfully
  - verify row exists in `sales_local` and outbox count increases
- [ ] Delivery tab:
  - create offline delivery order (required fields)
  - verify order appears in recent delivery list
  - verify row exists in `delivery_orders_local`
- [ ] Transfers tab:
  - create transfer with FULL/EMPTY qty
  - verify transfer appears in recent transfer list
  - verify row exists in `transfers_local`
- [ ] Shift tab:
  - queue open shift
  - queue close shift for active shift
  - queue shift cash entry
  - verify rows exist in `shifts_local` and `shift_cash_entries_local`
- [ ] Sync card pending count updates after each local queue action

## Test Notes Log
- Date: 2026-03-01
- Tester: Codex
- Environment: local dev (`D:\vpos`)
- Notes:
  - `pnpm ops:retention:dry-run` passed (all candidate counts currently `0`).
  - `pnpm ops:backup` passed and created backup dump files under `apps/api/backups`.
  - `pnpm ops:maintenance` passed and wrote log file under `apps/api/ops-logs`.

## Exit Criteria (Web-First)
- [ ] All items in A-D are marked `[x]`
- [ ] No blocker in section E
- [ ] Any failed item has a linked fix task in `docs/TASKS.md`
