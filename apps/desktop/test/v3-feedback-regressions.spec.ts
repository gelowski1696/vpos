import { readFileSync } from 'fs';
import { join } from 'path';

function source(relativePath: string): string {
  return readFileSync(join(__dirname, '..', relativePath), 'utf8');
}

describe('V3 desktop feedback regressions', () => {
  it('does not expose personnel salary rate in the POS picker', () => {
    const page = source('src/screens/PosScreen.tsx');
    expect(page).not.toContain('<span>Rate</span>');
    expect(page).not.toContain('meta.rate');
  });

  it('shows QOH-only stock context for non-LPG products', () => {
    const pos = source('src/screens/PosScreen.tsx');
    const items = source('src/screens/ItemsScreen.tsx');
    expect(pos).toContain('compactShowsCylinderStock ? "Full" : "QOH"');
    expect(items).toContain('if (product.isLpg)');
    expect(items).toContain('badges.push({ label: `Lended');
  });

  it('renders LPG full and empty quantities without decimal places', () => {
    const pos = source('src/screens/PosScreen.tsx');
    const items = source('src/screens/ItemsScreen.tsx');
    expect(pos).toContain('function formatCylinderStockQuantity');
    expect(pos).toContain('maximumFractionDigits: 0');
    expect(items).toContain('function formatCylinderQty');
    expect(items).toContain('Full ${formatCylinderQty(product.qtyFull)}');
    expect(items).toContain('Empty ${formatCylinderQty(product.qtyEmpty)}');
  });

  it('renders non-LPG QOH without decimal places', () => {
    const pos = source('src/screens/PosScreen.tsx');
    expect(pos).toContain('function formatStockQuantity');
    expect(pos).toContain('maximumFractionDigits: 0');
    expect(pos).not.toContain('return Number.isFinite(value) ? value.toFixed(2) : "0.00";');
  });

  it('shows the authenticated cashier and keeps sync errors separate from connectivity', () => {
    const topBar = source('src/components/layout/TopBar.tsx');
    expect(topBar).toContain('state.auth.userFullName?.trim()');
    expect(topBar).toContain('state.auth.userEmail?.trim()');
    expect(topBar).toContain('const statusHealthy = isNetworkOnline;');
    expect(topBar).not.toContain('CONNECTIVITY_ERROR_PATTERN');
  });

  it('allows large initial sync reconciliation to finish without weakening request timeouts', () => {
    const sync = source('../../packages/desktop-core/src/sync-service.ts');
    const auth = source('../../packages/desktop-core/src/auth-service.ts');
    expect(sync).toContain('const DEFAULT_SYNC_TIMEOUT_MS = 300_000;');
    expect(auth).toContain('const DEFAULT_FETCH_TIMEOUT_MS = 30_000;');
  });

  it('requires a full sign-out before the desktop window can close', () => {
    const app = source('src/app/App.tsx');
    expect(app).toContain('appWindow.onCloseRequested');
    expect(app).toContain('Use Full Sign Out before closing VPOS.');
    expect(app).toContain('event.preventDefault()');
  });

  it('includes pending petty cash in dashboard, reports, and expected cash', () => {
    const dashboard = source('src/screens/DashboardScreen.tsx');
    const reports = source('src/screens/CashierReportsScreen.tsx');
    const shift = source('src/screens/ShiftScreen.tsx');
    expect(dashboard).toContain('pettyCashNet');
    expect(reports).toContain('Petty Cash Net');
    expect(shift).toContain('+ drawerCashIn - drawerCashOut');
  });
});
