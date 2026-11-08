import { chromium } from 'playwright-core';

const baseUrl = process.env.VPOS_WEB_URL ?? 'http://localhost:3000';
const outputDir = 'D:/vpos/docs/superpowers/assets/web-ui-redesign';
const executablePath =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const products = [
  {
    id: 'product-lpg-11',
    sku: 'LPG-11KG',
    name: 'Premium LPG Cylinder 11 kg',
    category: 'LPG Cylinders',
    brand: 'VPOS Gas',
    unit: 'cylinder',
    isLpg: true,
    cylinderTypeId: 'cylinder-11',
    standardCost: 1450,
    lowStockAlertQty: 12,
    pickupCommissionRate: 10,
    deliveryCommissionRate: 20,
    isActive: true,
    createdAt: '2026-10-18T08:00:00.000Z',
    updatedAt: '2026-11-03T08:00:00.000Z'
  },
  {
    id: 'product-regulator',
    sku: 'REG-DELUXE',
    name: 'Deluxe Safety Regulator with Extra Long Product Name',
    category: 'Accessories',
    brand: 'SafeFlow',
    unit: 'piece',
    isLpg: false,
    cylinderTypeId: null,
    standardCost: 390,
    lowStockAlertQty: 8,
    pickupCommissionRate: 4,
    deliveryCommissionRate: 6,
    isActive: true,
    createdAt: '2026-10-22T08:00:00.000Z',
    updatedAt: '2026-11-02T08:00:00.000Z'
  },
  {
    id: 'product-hose',
    sku: 'HOSE-150',
    name: 'Reinforced LPG Hose 1.5 m',
    category: 'Accessories',
    brand: 'SafeFlow',
    unit: 'piece',
    isLpg: false,
    cylinderTypeId: null,
    standardCost: 180,
    lowStockAlertQty: 5,
    pickupCommissionRate: 2,
    deliveryCommissionRate: 3,
    isActive: false,
    createdAt: '2026-09-30T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z'
  }
];

const salesRows = [
  { sale_id: 'sale-1', receipt_number: 'R-1001', status: 'ACTIVE', branch_id: 'branch-main', branch_name: 'Main Branch', location_id: 'location-main', location_name: 'Main Store', cashier_name: 'Alex Cruz', customer_name: 'Northwind Retail', customer_code: 'C-100', sale_type: 'PICKUP', subtotal: 5200, discount_amount: 0, total_amount: 5200, returned_total: 0, cogs_amount: 3500, gross_profit: 1700, payment_total: 5200, payment_methods: ['CASH'], posted_at: '2026-11-01T09:00:00.000Z', created_at: '2026-11-01T09:00:00.000Z' },
  { sale_id: 'sale-2', receipt_number: 'R-1002', status: 'ACTIVE', branch_id: 'branch-main', branch_name: 'Main Branch', location_id: 'location-main', location_name: 'Main Store', cashier_name: 'Alex Cruz', customer_name: 'Blue Harbor Foods', customer_code: 'C-200', sale_type: 'DELIVERY', subtotal: 7800, discount_amount: 300, total_amount: 7500, returned_total: 0, cogs_amount: 4800, gross_profit: 2700, payment_total: 5000, payment_methods: ['CARD'], posted_at: '2026-11-02T10:00:00.000Z', created_at: '2026-11-02T10:00:00.000Z' },
  { sale_id: 'sale-3', receipt_number: 'R-1003', status: 'ACTIVE', branch_id: 'branch-north', branch_name: 'North Branch', location_id: 'location-north', location_name: 'North Store', cashier_name: 'Jamie Lim', customer_name: null, customer_code: null, sale_type: 'PICKUP', subtotal: 9100, discount_amount: 0, total_amount: 9100, returned_total: 0, cogs_amount: 5900, gross_profit: 3200, payment_total: 9100, payment_methods: ['E_WALLET'], posted_at: '2026-11-03T11:00:00.000Z', created_at: '2026-11-03T11:00:00.000Z' },
  { sale_id: 'sale-4', receipt_number: 'R-1004', status: 'ACTIVE', branch_id: 'branch-main', branch_name: 'Main Branch', location_id: 'location-main', location_name: 'Main Store', cashier_name: 'Alex Cruz', customer_name: 'Northwind Retail', customer_code: 'C-100', sale_type: 'DELIVERY', subtotal: 12400, discount_amount: 400, total_amount: 12000, returned_total: 0, cogs_amount: 7600, gross_profit: 4400, payment_total: 12000, payment_methods: ['CASH'], posted_at: '2026-11-04T12:00:00.000Z', created_at: '2026-11-04T12:00:00.000Z' }
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function mockPayload(pathname) {
  if (pathname.endsWith('/branding/config')) {
    return { companyName: 'VPOS Operations', primaryColor: '#7047EB', secondaryColor: '#5936CF' };
  }
  if (pathname.endsWith('/master-data/products')) {
    return products;
  }
  if (pathname.endsWith('/platform/entitlements/current')) {
    return { addons: { customer_category: true } };
  }
  if (pathname.endsWith('/master-data/branches')) {
    return [
      { id: 'branch-main', code: 'MAIN', name: 'Main Branch', isActive: true },
      { id: 'branch-north', code: 'NORTH', name: 'North Branch', isActive: true }
    ];
  }
  if (pathname.endsWith('/master-data/locations')) {
    return [
      { id: 'location-main', code: 'MAIN-STORE', name: 'Main Store', branchId: 'branch-main', isActive: true },
      { id: 'location-north', code: 'NORTH-STORE', name: 'North Store', branchId: 'branch-north', isActive: true }
    ];
  }
  if (pathname.endsWith('/reports/sales/summary')) {
    return { sale_count: 4, subtotal: 34500, discount_total: 700, total_sales: 33800, cogs_total: 21800, gross_profit: 12000, gross_margin_pct: 35.5, payments: [{ method: 'CASH', amount: 17200 }, { method: 'CARD', amount: 7500 }, { method: 'E_WALLET', amount: 9100 }], by_sale_type: [{ sale_type: 'PICKUP', sale_count: 2, total_sales: 14300 }, { sale_type: 'DELIVERY', sale_count: 2, total_sales: 19500 }] };
  }
  if (pathname.endsWith('/reports/sales/list')) {
    return { rows: salesRows };
  }
  if (pathname.endsWith('/reports/sales/by-branch')) {
    return { rows: [{ branch_id: 'branch-main', branch_name: 'Main Branch', sale_count: 3, total_sales: 24700, cogs_total: 15900, gross_profit: 8800, gross_margin_pct: 35.6 }, { branch_id: 'branch-north', branch_name: 'North Branch', sale_count: 1, total_sales: 9100, cogs_total: 5900, gross_profit: 3200, gross_margin_pct: 35.2 }] };
  }
  if (pathname.endsWith('/reports/sales/by-sku') || pathname.endsWith('/reports/sales/by-cashier')) {
    return { rows: [] };
  }
  if (pathname.endsWith('/reports/financial/gross-margin')) {
    return { by_branch: [{ branch_id: 'branch-main', branch_name: 'Main Branch', revenue: 24700, gross_profit: 8800 }, { branch_id: 'branch-north', branch_name: 'North Branch', revenue: 9100, gross_profit: 3200 }] };
  }
  if (pathname.endsWith('/reports/inventory/full-empty-by-product')) {
    return { rows: [{ location_id: 'location-main', location_name: 'Main Store', product_id: 'product-lpg-11', item_code: 'LPG-11KG', product_name: 'Premium LPG Cylinder 11 kg', qty_full: 42, qty_empty: 18 }] };
  }
  if (pathname.endsWith('/reports/inventory/movements')) {
    return { rows: [{ id: 'move-1', created_at: '2026-11-04T12:00:00.000Z', movement_type: 'SALE', location_id: 'location-main', location_name: 'Main Store', product_id: 'product-lpg-11', product_sku: 'LPG-11KG', qty_delta: -1, qty_full_delta: -1, qty_empty_delta: 1 }, { id: 'move-2', created_at: '2026-11-03T12:00:00.000Z', movement_type: 'REFILL', location_id: 'location-main', location_name: 'Main Store', product_id: 'product-lpg-11', product_sku: 'LPG-11KG', qty_delta: 8, qty_full_delta: 8, qty_empty_delta: -8 }] };
  }
  if (pathname.endsWith('/reports/sales/xz-read')) {
    return { x_read: [], z_read: [] };
  }
  if (pathname.endsWith('/reports/audit-logs')) {
    return { rows: [] };
  }
  if (pathname.endsWith('/reviews')) {
    return { rows: [] };
  }
  if (pathname.endsWith('/master-data/inventory/opening-stock')) {
    return { rows: [] };
  }
  if (pathname.endsWith('/lpg-item-actions/summary')) {
    return { counts: { dispose: 2, replace: 4, junk: 1 }, qty: { disposed: 2, replaced: 4, junked: 1 } };
  }
  if (pathname.endsWith('/master-data/customers')) {
    return [{ id: 'customer-1', code: 'C-100', name: 'Northwind Retail', type: 'BUSINESS', outstandingBalance: 2500, isActive: true }];
  }
  if (pathname.endsWith('/customer-payments')) {
    return [{ payment_id: 'payment-1', sale_id: 'sale-2', customer_id: 'customer-1', customer_code: 'C-100', customer_name: 'Northwind Retail', method: 'CARD', amount: 2500, reference_no: 'CARD-1', notes: null, posted_at: '2026-11-04T15:00:00.000Z', customer_outstanding_balance: 2500 }];
  }
  if (pathname.endsWith('/cylinders')) {
    return [{ serial: 'CYL-001', typeCode: '11KG', status: 'FULL', locationId: 'location-main', updatedAt: '2026-11-04T12:00:00.000Z' }, { serial: 'CYL-002', typeCode: '11KG', status: 'DAMAGED', locationId: 'location-main', updatedAt: '2026-11-03T12:00:00.000Z' }];
  }
  if (pathname.endsWith('/master-data/product-categories')) {
    return [
      { id: 'category-lpg', name: 'LPG Cylinders', isActive: true },
      { id: 'category-accessories', name: 'Accessories', isActive: true }
    ];
  }
  if (pathname.endsWith('/master-data/product-brands')) {
    return [
      { id: 'brand-vpos', name: 'VPOS Gas', isActive: true },
      { id: 'brand-safe', name: 'SafeFlow', isActive: true }
    ];
  }
  if (pathname.endsWith('/master-data/cylinder-types')) {
    return [{ id: 'cylinder-11', code: '11KG', name: '11 kg Cylinder', isActive: true }];
  }
  if (pathname.includes('/tenant-addons')) {
    return {};
  }
  return [];
}

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));

await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url());
  await route.fulfill({
    body: JSON.stringify(mockPayload(url.pathname)),
    contentType: 'application/json',
    status: 200
  });
});

const payload = Buffer.from(
  JSON.stringify({ roles: ['admin'], company_id: 'demo-company', must_change_password: false })
).toString('base64url');
const token = `eyJhbGciOiJub25lIn0.${payload}.signature`;
await page.addInitScript((accessToken) => {
  window.localStorage.setItem('vpos_admin_access_token', accessToken);
  window.localStorage.setItem('vpos_admin_refresh_token', 'mock-refresh');
  window.localStorage.setItem('vpos_web_admin_walkthrough_v1_done', '1');
  window.localStorage.setItem('vpos_web_admin_walkthrough_route_products', '1');
  window.localStorage.setItem('vpos_web_admin_walkthrough_route_dashboard', '1');
  window.localStorage.setItem('vpos_web_admin_walkthrough_route_sales-list', '1');
  window.localStorage.setItem('vpos_web_admin_walkthrough_route_audit-logs', '1');
  window.localStorage.setItem('vpos_web_admin_walkthrough_route_reports', '1');
  window.localStorage.setItem('vpos_admin_theme', 'light');
}, token);

await page.goto(`${baseUrl}/products`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Products', exact: true }).waitFor();
await page.getByText('Premium LPG Cylinder 11 kg', { exact: true }).first().waitFor();

const workspace = page.locator('[data-admin-workspace]');
assert((await workspace.count()) === 1, 'Admin workspace marker is missing.');
assert((await page.getByText('Total products', { exact: true }).count()) === 1, 'Product summary is missing.');
assert((await page.getByText('3', { exact: true }).count()) > 0, 'Product total did not render.');

const firstSelection = page.getByRole('checkbox', { name: 'Select Premium LPG Cylinder 11 kg' }).first();
await firstSelection.check();
await page.getByText('1 selected', { exact: true }).waitFor();
assert((await page.getByRole('dialog').count()) === 0, 'Selecting a row opened its detail dialog.');

await page.getByRole('button', { name: 'Inactive', exact: true }).click();
await page.getByText('Reinforced LPG Hose 1.5 m', { exact: true }).first().waitFor();
assert((await page.getByText('Premium LPG Cylinder 11 kg', { exact: true }).count()) === 0, 'Status filter did not update rows.');
await page.getByRole('button', { name: 'All', exact: true }).click();

const addProduct = page.getByRole('button', { name: 'Add product', exact: true }).first();
await addProduct.click();
const editor = page.getByRole('dialog', { name: /Add Products Record/ });
await editor.waitFor();
assert(await editor.evaluate((node) => node.contains(document.activeElement)), 'Editor focus was not contained.');
await page.keyboard.press('Escape');
await editor.waitFor({ state: 'detached' });
assert(await addProduct.evaluate((node) => node === document.activeElement), 'Focus did not return to Add product.');

await page.screenshot({ path: `${outputDir}/products-desktop.png` });
await page.getByRole('button', { name: 'Import Excel', exact: true }).click();
const importDialog = page.getByRole('dialog', { name: 'Products Import Wizard' });
await importDialog.waitFor();
await page.waitForTimeout(240);
assert(
  (await importDialog.evaluate((node) => window.getComputedStyle(node).borderRadius)) !== '0px',
  'Import dialog did not receive the modern surface treatment.'
);
await page.screenshot({ path: `${outputDir}/products-import-modal.png` });
await page.getByRole('button', { name: 'Close Products import wizard' }).click();
await importDialog.waitFor({ state: 'detached' });
await page.getByRole('button', { name: 'Switch to dark mode' }).click();
assert(await page.locator('html').evaluate((node) => node.classList.contains('dark')), 'Dark mode did not activate.');
await page.waitForTimeout(250);
const darkRowBackground = await page.locator('tbody tr').first().evaluate(
  (node) => window.getComputedStyle(node).backgroundColor
);
const darkSurface = await workspace.evaluate((node) =>
  window.getComputedStyle(node).getPropertyValue('--admin-surface').trim()
);
assert(darkRowBackground === 'rgb(29, 29, 34)', `Dark table row surface is incorrect: ${darkRowBackground}; token ${darkSurface}.`);
await page.screenshot({ path: `${outputDir}/products-dark.png` });

await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Open navigation' }).click();
await page.getByRole('complementary', { name: 'Mobile navigation' }).waitFor();
await page.screenshot({ path: `${outputDir}/products-mobile.png` });
await page.getByRole('button', { name: 'Close navigation' }).last().click();

await page.setViewportSize({ width: 1280, height: 800 });
await page.evaluate(() => window.localStorage.setItem('vpos_admin_theme', 'light'));
await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Dashboard Overview & Insights' }).waitFor();
const dashboardSalesChart = page.getByRole('img', { name: 'Net sales trend chart' });
await dashboardSalesChart.waitFor();
await page.getByRole('img', { name: 'Performance comparison chart' }).waitFor();
await page.waitForTimeout(1800);
await page.screenshot({ path: `${outputDir}/dashboard-desktop.png` });
await dashboardSalesChart.locator('xpath=ancestor::article[1]').screenshot({ path: `${outputDir}/dashboard-sales-chart.png` });
await page.goto(`${baseUrl}/reports`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Reports Center' }).waitFor();
await page.getByRole('heading', { name: 'Performance at a glance' }).waitFor();
assert((await page.getByRole('img').count()) >= 3, 'Reports analytics charts did not render.');
await page.waitForTimeout(1800);
await page.screenshot({ path: `${outputDir}/reports-desktop.png` });
await page.goto(`${baseUrl}/sales-list`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Sales List', exact: true }).waitFor();
await page.goto(`${baseUrl}/audit-logs`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Audit Logs', exact: true }).waitFor();

await page.goto(`${baseUrl}/customer-categories`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Customer Categories', exact: true }).waitFor();
const addCategory = page.getByRole('button', { name: 'Add Category', exact: true });
await addCategory.click();
const categoryDialog = page.getByRole('dialog', { name: 'Add Customer Category' });
await categoryDialog.waitFor();
assert(await categoryDialog.evaluate((node) => node.contains(document.activeElement)), 'Custom dialog focus was not contained.');
await page.keyboard.press('Escape');
await categoryDialog.waitFor({ state: 'detached' });
assert(await addCategory.evaluate((node) => node === document.activeElement), 'Custom dialog did not restore focus.');

await page.evaluate(() => window.localStorage.clear());
await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
assert((await page.locator('[data-admin-workspace]').count()) === 0, 'Admin styles leaked onto login.');
await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
const authCanvas = await page.locator('main').evaluate((node) => window.getComputedStyle(node).backgroundColor);
assert(authCanvas === 'rgb(245, 244, 247)', `Authentication canvas is incorrect: ${authCanvas}.`);
await page.waitForTimeout(240);
await page.screenshot({ path: `${outputDir}/login-public.png` });

await page.goto(`${baseUrl}/missing-ui-consistency-check`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Page not found', exact: true }).waitFor();
assert((await page.locator('[data-public-error]').count()) === 1, 'Not-found page missed the reconstructed public surface.');

const mustChangePayload = Buffer.from(
  JSON.stringify({ roles: ['admin'], company_id: 'demo-company', must_change_password: true })
).toString('base64url');
const mustChangeToken = `eyJhbGciOiJub25lIn0.${mustChangePayload}.signature`;
await page.addInitScript((accessToken) => {
  window.localStorage.setItem('vpos_admin_access_token', accessToken);
  window.localStorage.setItem('vpos_admin_refresh_token', 'mock-refresh');
}, mustChangeToken);
await page.goto(`${baseUrl}/change-password`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Set a new password', exact: true }).waitFor();
await page.waitForTimeout(240);
await page.screenshot({ path: `${outputDir}/change-password-public.png` });

assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(' | ')}`);
await browser.close();
process.stdout.write(
  JSON.stringify({
    checks: ['shell', 'summaries', 'selection', 'filters', 'dialog-focus', 'modern-modal', 'dark-mode', 'mobile-drawer', 'dashboard-charts', 'reports-charts', 'custom-pages', 'public-css-scope', 'auth-pages'],
    screenshots: 9,
    authCanvas,
    darkRowBackground,
    darkSurface
  })
);
