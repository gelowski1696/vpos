# Add-ons Smoke Test Matrix (Web/Mobile/Desktop)

## Purpose
- Provide a single QA runbook for staged tenant rollout of add-ons in `docs/mods/mods.md`.
- Ensure consistent ON/OFF validation across Web, Mobile, and Desktop.
- Confirm default behavior stays working when add-ons are OFF.

## Scope
- Tenant add-ons:
  - `custom_pricing`
  - `customer_category`
  - `item_price_cost_audit`
  - `petty_cash_attachments`
  - `shift_security_controls`
  - `kilo_overview_chart`
  - `receipt_amount_privacy`
  - `purchase_order_suite`
  - `delivery_dispatch_suite`

## Roles used in QA
- Platform Owner: can toggle tenant add-ons.
- Tenant Admin/Owner: full web admin operations.
- Cashier: POS, shift, petty cash, reports access checks.
- Rider (for delivery dispatch suite): assigned-delivery status checks.

## Required test data (minimum)
- 1 active tenant for pilot (`TENANT_PILOT`).
- 1 branch + 1 location.
- 1 supplier.
- 2 products (1 LPG, 1 non-LPG).
- 1 cashier account.
- 1 rider/driver account.
- 2 customers:
  - `Customer A` with no special category.
  - `Customer B` assigned to a customer category (for custom pricing tests).

## Environment pre-check
1. Ensure API + Web containers are healthy.
2. Ensure tenant migrations are up to date.
3. Ensure mobile/desktop clients can sync latest master data.
4. In owner console, confirm all add-on toggles are visible and can be edited.

## Add-on Coverage Matrix

| Add-on | Web | Mobile | Desktop | OFF expected behavior | ON expected behavior |
|---|---|---|---|---|---|
| `custom_pricing` | Yes | Yes (POS pricing resolution) | Yes (POS pricing resolution) | Customer-group scope not available | Customer-group scope/pricing works |
| `customer_category` | Yes | Indirect (pricing/customer sync data) | Indirect (pricing/customer sync data) | Category UI/routes blocked/hidden | Category CRUD + assignment works |
| `item_price_cost_audit` | Yes | No direct UI | No direct UI | Audit endpoint/UI blocked | Item price/cost history visible |
| `petty_cash_attachments` | View/report | Create queue + sync | Create queue + sync | Petty cash still works, attachments ignored | Attachments selectable, synced, viewable |
| `shift_security_controls` | Inventory report access enforcement | Shift close + cashier restrictions via API | Shift close + cashier restrictions via API | Cashier can open inventory reports | Cashier inventory reports blocked, admin allowed |
| `kilo_overview_chart` | Yes | No | No | Kilo chart hidden/blocked | Kilo chart visible and loads |
| `receipt_amount_privacy` | API/audit effect | POS toggle + receipt masking | POS toggle + receipt masking | Hide-amount request ignored (default receipt) | Toggle available, masking enforced, credit/balance blocked |
| `purchase_order_suite` | Yes | No direct UI | No direct UI | PO routes blocked | PO lifecycle works (create to complete) |
| `delivery_dispatch_suite` | Yes | No direct dispatch UI required | No direct dispatch UI required | Dispatch routes blocked | Dispatch lifecycle + CSV + complete validation works |

## Test ID Standard (QA Tracker Ready)

- ID format: `ADDON-W<wave>-<addon_code>-<platform>-<seq>`
- Wave codes:
  - `W0`: baseline all add-ons OFF
  - `W1`: pricing + customer controls
  - `W2`: petty cash + shift security + receipt privacy + audit + kilo
  - `W3`: purchase order + delivery dispatch
- Add-on codes:
  - `CPR` = `custom_pricing`
  - `CCG` = `customer_category`
  - `IPA` = `item_price_cost_audit`
  - `PCA` = `petty_cash_attachments`
  - `SSC` = `shift_security_controls`
  - `KOC` = `kilo_overview_chart`
  - `RAP` = `receipt_amount_privacy`
  - `POS` = `purchase_order_suite`
  - `DDS` = `delivery_dispatch_suite`
- Platform codes:
  - `WEB`, `MOB`, `DESK`, `API`

## QA Tracker Import CSV (Exact Test IDs)

Copy this block directly into your QA tracker CSV import.

```csv
test_id,wave,addon_key,state,platform,role,title,preconditions,steps,expected_result,priority,type
ADDON-W0-CPR-WEB-001,W0,custom_pricing,OFF,WEB,Tenant Admin,Custom pricing scope hidden when OFF,All add-ons OFF for TENANT_PILOT,Open pricing setup and check scope options,Customer-group scope is hidden and unusable,High,Smoke
ADDON-W0-CCG-WEB-001,W0,customer_category,OFF,WEB,Tenant Admin,Customer category UI hidden when OFF,All add-ons OFF for TENANT_PILOT,Open master data menu and attempt customer category route,Category route is hidden or blocked with guard,High,Smoke
ADDON-W0-IPA-WEB-001,W0,item_price_cost_audit,OFF,WEB,Tenant Admin,Price cost audit unavailable when OFF,All add-ons OFF for TENANT_PILOT,Open product detail and try price cost history view,History UI is hidden or blocked,Medium,Smoke
ADDON-W0-PCA-MOB-001,W0,petty_cash_attachments,OFF,MOB,Cashier,Petty cash works without attachment feature,All add-ons OFF and mobile synced,Create petty cash entry with normal fields only,Entry queues and syncs without attachment requirement,High,Smoke
ADDON-W0-SSC-WEB-001,W0,shift_security_controls,OFF,WEB,Cashier,Inventory reports accessible when shift security OFF,All add-ons OFF and cashier account active,Open reports inventory pages,Cashier can access standard inventory reports,Medium,Smoke
ADDON-W0-KOC-WEB-001,W0,kilo_overview_chart,OFF,WEB,Tenant Admin,Kilo chart hidden when OFF,All add-ons OFF for TENANT_PILOT,Open dashboard overview,No kilo overview chart widget is shown,Medium,Smoke
ADDON-W0-RAP-DESK-001,W0,receipt_amount_privacy,OFF,DESK,Cashier,Receipt privacy toggle absent when OFF,All add-ons OFF and desktop synced,Open POS payment section,Hide amount option is not shown,High,Smoke
ADDON-W0-POS-WEB-001,W0,purchase_order_suite,OFF,WEB,Tenant Admin,Purchase order routes blocked when OFF,All add-ons OFF for TENANT_PILOT,Open purchase order page URL,Route is blocked with add-on guard,High,Smoke
ADDON-W0-DDS-WEB-001,W0,delivery_dispatch_suite,OFF,WEB,Tenant Admin,Delivery dispatch routes blocked when OFF,All add-ons OFF for TENANT_PILOT,Open delivery dispatch page URL,Route is blocked with add-on guard,High,Smoke
ADDON-W1-CCG-WEB-001,W1,customer_category,ON,WEB,Tenant Admin,Create customer category and assign customer,Enable customer_category,Create CAT-A and assign Customer B,Category saves and customer assignment persists,High,Smoke
ADDON-W1-CPR-WEB-001,W1,custom_pricing,ON,WEB,Tenant Admin,Create customer-group price rule,Enable custom_pricing and customer_category,Create price list scoped to customer group for one product,Rule saves and appears in pricing list,High,Smoke
ADDON-W1-CPR-MOB-001,W1,custom_pricing,ON,MOB,Cashier,Mobile POS applies customer-group price,Wave 1 add-ons ON and mobile synced,Start sale for Customer A then Customer B for same item,Customer B gets scoped custom price while Customer A keeps default scope price,High,Smoke
ADDON-W1-CPR-DESK-001,W1,custom_pricing,ON,DESK,Cashier,Desktop POS applies customer-group price,Wave 1 add-ons ON and desktop synced,Repeat same item test for Customer A vs Customer B,Desktop price resolution matches expected scoped pricing,High,Smoke
ADDON-W1-CPR-WEB-002,W1,custom_pricing,OFF,WEB,Tenant Admin,Disable custom pricing and verify fallback,Toggle custom_pricing OFF only,Refresh pricing setup and run same sale check,Customer-group pricing no longer applies and fallback scope is used,High,Regression
ADDON-W1-CCG-WEB-002,W1,customer_category,OFF,WEB,Tenant Admin,Disable customer category and verify guard,Toggle customer_category OFF,Attempt category CRUD and assignment access,Category access is hidden or blocked cleanly,Medium,Regression
ADDON-W2-IPA-WEB-001,W2,item_price_cost_audit,ON,WEB,Tenant Admin,Price and cost updates generate audit rows,Enable item_price_cost_audit,Edit product price and cost then open history,Audit rows show old and new values with actor and timestamp,High,Smoke
ADDON-W2-IPA-WEB-002,W2,item_price_cost_audit,OFF,WEB,Tenant Admin,Audit view blocked when disabled,Toggle item_price_cost_audit OFF,Open product history endpoint or UI,Audit endpoint or UI is blocked with add-on guard,Medium,Regression
ADDON-W2-KOC-WEB-001,W2,kilo_overview_chart,ON,WEB,Tenant Admin,Kilo overview chart loads with branch filter,Enable kilo_overview_chart,Open dashboard and switch branch filter,Chart renders and values refresh by branch,Medium,Smoke
ADDON-W2-KOC-WEB-002,W2,kilo_overview_chart,OFF,WEB,Tenant Admin,Kilo overview chart hidden when disabled,Toggle kilo_overview_chart OFF,Reload dashboard,Chart widget is hidden and no chart request is made,Medium,Regression
ADDON-W2-PCA-MOB-001,W2,petty_cash_attachments,ON,MOB,Cashier,Mobile petty cash accepts image attachment,Enable petty_cash_attachments and sync mobile,Create petty cash with one image then sync,Entry syncs and attachment appears in web report,High,Smoke
ADDON-W2-PCA-DESK-001,W2,petty_cash_attachments,ON,DESK,Cashier,Desktop petty cash accepts image attachment,Enable petty_cash_attachments and sync desktop,Create petty cash with one image then sync,Entry syncs and attachment appears in web report,High,Smoke
ADDON-W2-PCA-WEB-001,W2,petty_cash_attachments,ON,WEB,Tenant Admin,Web petty cash report can open attachment,Wave 2 ON data exists,Open petty cash report and click attachment,Attachment opens via view link without error,Medium,Smoke
ADDON-W2-PCA-MOB-002,W2,petty_cash_attachments,OFF,MOB,Cashier,Attachment payload ignored safely when add-on OFF,Toggle petty_cash_attachments OFF and sync mobile,Submit petty cash from mobile including local attachment metadata,Entry still succeeds and attachment is not persisted,High,Regression
ADDON-W2-SSC-WEB-001,W2,shift_security_controls,ON,WEB,Cashier,Cashier inventory report blocked when enabled,Enable shift_security_controls and login as cashier,Open inventory report pages,Access is blocked by menu and API guard,High,Smoke
ADDON-W2-SSC-WEB-002,W2,shift_security_controls,ON,WEB,Tenant Admin,Admin inventory report remains accessible,shift_security_controls ON and admin login,Open inventory report pages,Admin access works normally,High,Smoke
ADDON-W2-SSC-WEB-003,W2,shift_security_controls,OFF,WEB,Cashier,Cashier inventory report restored when disabled,Toggle shift_security_controls OFF,Login as cashier and open inventory report pages,Cashier access returns to default behavior,Medium,Regression
ADDON-W2-RAP-MOB-001,W2,receipt_amount_privacy,ON,MOB,Cashier,Mobile full payment allows masked receipt,Enable receipt_amount_privacy and sync mobile,Run full payment sale with hide amount ON,Receipt and on-screen summary apply masking,High,Smoke
ADDON-W2-RAP-DESK-001,W2,receipt_amount_privacy,ON,DESK,Cashier,Desktop full payment allows masked receipt,Enable receipt_amount_privacy and sync desktop,Run full payment sale with hide amount ON,Receipt and on-screen summary apply masking,High,Smoke
ADDON-W2-RAP-MOB-002,W2,receipt_amount_privacy,ON,MOB,Cashier,Mobile credit sale blocks hide amount,receipt_amount_privacy ON,Create partial or credit sale and attempt hide amount,Hide amount option is blocked for credit or balance flow,High,Smoke
ADDON-W2-RAP-DESK-002,W2,receipt_amount_privacy,OFF,DESK,Cashier,Hide amount request ignored when disabled,Toggle receipt_amount_privacy OFF and sync desktop,Submit sale payload requesting hide amount,Sale succeeds with normal unmasked totals,High,Regression
ADDON-W3-POS-WEB-001,W3,purchase_order_suite,ON,WEB,Tenant Admin,Purchase order lifecycle end to end,Enable purchase_order_suite,Create PO submit partial receive pullout receive remaining complete,PO status transitions correctly through lifecycle,High,Smoke
ADDON-W3-POS-WEB-002,W3,purchase_order_suite,ON,WEB,Tenant Admin,Purchase order attachments policy works,purchase_order_suite ON,Attach files to PO and complete PO with required attachment,Allowed files are accepted and completion enforces attachment rule,Medium,Smoke
ADDON-W3-POS-WEB-003,W3,purchase_order_suite,OFF,WEB,Tenant Admin,Purchase order blocked when disabled,Toggle purchase_order_suite OFF,Open PO routes and APIs,Routes are blocked with add-on guard,High,Regression
ADDON-W3-DDS-WEB-001,W3,delivery_dispatch_suite,ON,WEB,Tenant Admin,Delivery lifecycle strict transitions,Enable delivery_dispatch_suite,Create assign out for delivery delivered complete flow,Only valid transitions are accepted,High,Smoke
ADDON-W3-DDS-WEB-002,W3,delivery_dispatch_suite,ON,WEB,Tenant Admin,Complete status requires cashier validation,delivery_dispatch_suite ON and delivered order ready,Attempt complete without validator then with validator,First attempt blocked and validated attempt succeeds,High,Smoke
ADDON-W3-DDS-WEB-003,W3,delivery_dispatch_suite,ON,WEB,Tenant Admin,Delivery CSV export has expected schema,delivery_dispatch_suite ON with sample deliveries,Export CSV and inspect columns,CSV includes required columns and timestamps,Medium,Smoke
ADDON-W3-DDS-WEB-004,W3,delivery_dispatch_suite,OFF,WEB,Tenant Admin,Delivery dispatch blocked when disabled,Toggle delivery_dispatch_suite OFF,Open dispatch routes and APIs,Routes are blocked with add-on guard,High,Regression
```

## Rollout Waves

### Wave 0: Baseline (all add-ons OFF)
Goal: verify default tenant operations remain stable.

1. In Owner Tenant Console, turn all listed add-ons OFF for `TENANT_PILOT`.
2. Web Admin:
   - Confirm add-on routes/pages are hidden or blocked.
   - Confirm standard non-add-on flows still work (sales list, reports, products, POS web flows used by team).
3. Mobile Cashier:
   - Sync.
   - Create and post a normal sale.
   - Create petty cash entry without attachments.
4. Desktop Cashier:
   - Sync.
   - Create and post a normal sale.
   - Create petty cash entry without attachments.
5. Pass criteria:
   - No broken core flow due to disabled add-ons.
   - No critical errors in API logs.

### Wave 1: Pricing + Customer controls
Add-ons ON: `customer_category`, `custom_pricing`.

1. Enable `customer_category` and `custom_pricing` for `TENANT_PILOT`.
2. Web Admin steps:
   - Create category `CAT-A`.
   - Assign `Customer B` to `CAT-A`.
   - Create customer-group price list rule for one product.
3. Mobile POS steps:
   - Sync.
   - Start sale for `Customer A`, note price.
   - Start sale for `Customer B`, verify custom price is applied.
4. Desktop POS steps:
   - Repeat same check as mobile for `Customer A` vs `Customer B`.
5. OFF regression check:
   - Turn `custom_pricing` OFF only.
   - Verify customer-group price scope disappears and default/other scope pricing is used.
6. Pass criteria:
   - Price resolution parity across web/mobile/desktop.
   - No stale customer-group pricing when `custom_pricing` OFF.

### Wave 2: Cashier controls + petty cash + receipt privacy
Add-ons ON: `petty_cash_attachments`, `shift_security_controls`, `receipt_amount_privacy`, `item_price_cost_audit`, `kilo_overview_chart`.

1. Enable listed add-ons.
2. Web Admin steps:
   - Products: edit item price/cost and verify audit records appear.
   - Dashboard: verify kilo chart loads.
3. Mobile petty cash steps:
   - Add petty cash with 1 image attachment and sync.
   - Verify entry appears in web reports with attachment link.
4. Desktop petty cash steps:
   - Repeat petty cash attachment create and sync.
5. Shift security steps:
   - Login as cashier, attempt inventory report endpoint/page and verify blocked.
   - Login as admin, verify inventory reports still accessible.
6. Receipt privacy steps (mobile and desktop):
   - Full-payment sale: enable hide amount, verify receipt masking.
   - Partial/credit sale: verify hide amount not allowed.
7. OFF fallback checks:
   - Turn `petty_cash_attachments` OFF and submit petty cash with attachment payload path (mobile/desktop): entry should still succeed without persisted attachment.
   - Turn `receipt_amount_privacy` OFF and submit sale with hide flag: sale should succeed with normal receipt amounts.
8. Pass criteria:
   - Guarded features enforce ON/OFF behavior correctly.
   - Fallback behavior works with no flow break.

### Wave 3: Purchase Order + Delivery Dispatch
Add-ons ON: `purchase_order_suite`, `delivery_dispatch_suite`.

1. Enable listed add-ons.
2. Purchase order web steps:
   - Create PO with supplier + line.
   - Submit PO.
   - Receive partial quantity.
   - Pullout quantity.
   - Receive remaining quantity.
   - Add attachment.
   - Complete PO.
3. Delivery dispatch web steps:
   - Create delivery order.
   - Assign rider.
   - Move to `OUT_FOR_DELIVERY`.
   - Move to `DELIVERED`.
   - Attempt `COMPLETE` without cashier validator (expect blocked).
   - Complete with cashier validator (expect success).
   - Export CSV and verify file/content columns.
4. OFF regression checks:
   - Turn `purchase_order_suite` OFF and verify PO routes are blocked.
   - Turn `delivery_dispatch_suite` OFF and verify web dispatch routes are blocked.
   - Verify default offline delivery sync flow remains functional for standard local flow handling.
5. Pass criteria:
   - End-to-end lifecycle successful for both suites when ON.
   - Proper blocking when OFF.

## Step-by-step tester script (per platform)

### Web tester script
1. Login to Owner Console.
2. Toggle add-ons per current wave.
3. Login to tenant web admin.
4. Execute wave-specific module checks.
5. Capture:
   - Screenshot before action.
   - Screenshot after action.
   - API response or toast message for failed guard checks.
6. Record result as `PASS`/`FAIL` with timestamp.

### Mobile tester script
1. Login as cashier.
2. Sync master data first.
3. Execute wave-specific mobile checks (pricing, petty cash, receipt privacy).
4. If behavior is guarded by add-on OFF:
   - verify no crash
   - verify default fallback behavior
5. Capture:
   - Screen recording or screenshots
   - relevant logs if needed
6. Record result as `PASS`/`FAIL` with notes.

### Desktop tester script
1. Login as cashier/admin (as needed).
2. Sync master data first.
3. Execute wave-specific desktop checks (pricing, petty cash, receipt privacy).
4. Validate OFF fallback behavior.
5. Capture:
   - screenshot/video
   - API sync result if flow depends on sync
6. Record result as `PASS`/`FAIL` with notes.

## Evidence template (copy per test case)
- Test ID:
- Wave:
- Add-on(s):
- Platform:
- User role:
- Preconditions:
- Steps executed:
- Expected:
- Actual:
- Result (`PASS`/`FAIL`):
- Screenshot/log links:
- Defect ticket (if fail):

## Exit criteria per wave
- 0 blocker defects.
- No data integrity regression (inventory/sales/PO/delivery/petty cash).
- ON/OFF guard checks validated for all add-ons in that wave.
- Evidence captured for each platform touched by wave scope.

## Scripted Recheck (18 Previously Failed IDs)

Run date: 2026-05-18  
Execution mode: scripted (`web + adb mobile + desktop`), plus targeted API e2e for ON/OFF guards.

### Commands executed

```powershell
pnpm --filter @vpos/web test -- --runInBand test/price-list-addons.spec.ts
pnpm --filter @vpos/mobile test -- --runInBand test/tenant-addons.spec.ts
pnpm --filter @vpos/desktop test -- --runInBand test/desktop-master-data-addons.spec.ts
pnpm --filter @vpos/api test -- --runInBand app.e2e-spec.ts -t "integrated add-on guards|delivery dispatch completion validation|default receipt behavior|petty cash create working|default offline delivery sync flow|purchase_order_suite ON/OFF"
$env:VPOS_TEST_USE_DB='true'; pnpm --filter @vpos/api test -- --runInBand app.e2e-spec.ts -t "purchase_order_suite ON/OFF"
```

ADB runtime artifacts:
- `tmp_vpos_runtime_pass2.json`
- `tmp_addon_ui_attachment_toggle_check.json`

Desktop/mobile ON/OFF attachment modal artifacts:
- `tmp_desktop_on_result.json`
- `tmp_desktop_off_result.json`
- `tmp_vpos_on_modal.xml`
- `tmp_vpos_off_modal.xml`

### Updated strict status

| Test ID | Updated Result | Evidence |
|---|---|---|
| `ADDON-W0-CPR-WEB-001` | `PASS` | Web scope filtering + test (`apps/web/src/app/(admin)/price-lists/page.tsx`, `apps/web/test/price-list-addons.spec.ts`) |
| `ADDON-W0-CCG-WEB-001` | `PASS` | Add-on route guard wiring (`apps/web/src/components/admin-shell.tsx`) + API guard in e2e test 72 |
| `ADDON-W0-IPA-WEB-001` | `PASS` | `price-cost-audit` endpoint guarded (`apps/api/src/modules/master-data/master-data.service.ts`) + e2e test 72 |
| `ADDON-W0-KOC-WEB-001` | `PASS` | Dashboard kilo widget conditional (`apps/web/src/app/(admin)/dashboard/page.tsx`) + e2e test 72 |
| `ADDON-W0-RAP-DESK-001` | `PASS` | Desktop toggle rendered only when add-on enabled (`apps/desktop/src/screens/PosScreen.tsx`) + API fallback e2e test 74 |
| `ADDON-W0-POS-WEB-001` | `PASS` | Route/add-on guard wiring (`apps/web/src/components/admin-shell.tsx`) + DB runtime e2e test 77 |
| `ADDON-W0-DDS-WEB-001` | `PASS` | Route/add-on guard wiring (`apps/web/src/components/admin-shell.tsx`) + e2e tests 72/73 |
| `ADDON-W1-CPR-WEB-002` | `PASS` | 4-step fallback when add-on OFF verified in web test (`apps/web/test/price-list-addons.spec.ts`) |
| `ADDON-W1-CCG-WEB-002` | `PASS` | Customer category route guard + API OFF blocking in e2e test 72 |
| `ADDON-W2-IPA-WEB-002` | `PASS` | Audit endpoint OFF blocking verified in e2e test 72 |
| `ADDON-W2-KOC-WEB-002` | `PASS` | Kilo endpoint OFF blocking in e2e test 72 and web widget gating |
| `ADDON-W2-PCA-MOB-001` | `PASS` | Mobile ON modal shows `Attachments (Optional)` + `Add Photo` (`tmp_addon_ui_attachment_toggle_check.json`) |
| `ADDON-W2-PCA-DESK-001` | `PASS` | Desktop ON modal flags true for attachment controls (`tmp_desktop_on_result.json`) |
| `ADDON-W2-PCA-MOB-002` | `PASS` | Mobile OFF modal hides `Add Photo`, shows disabled message (`tmp_addon_ui_attachment_toggle_check.json`) + e2e test 75 |
| `ADDON-W2-SSC-WEB-003` | `PASS` | OFF behavior restored (cashier inventory report allowed) verified in e2e test 72 |
| `ADDON-W2-RAP-DESK-002` | `PASS` | Hide-amount request ignored when add-on OFF verified in e2e test 74 |
| `ADDON-W3-POS-WEB-003` | `PASS` | PO routes/actions blocked when OFF + lifecycle ON verified in DB runtime e2e test 77 |
| `ADDON-W3-DDS-WEB-004` | `PASS` | Delivery dispatch blocked when OFF verified in e2e test 72 |

Recheck summary for the targeted set: **18 / 18 PASS**.
