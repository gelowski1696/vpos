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

  it('includes pending petty cash in dashboard, reports, and expected cash', () => {
    const dashboard = source('src/screens/DashboardScreen.tsx');
    const reports = source('src/screens/CashierReportsScreen.tsx');
    const shift = source('src/screens/ShiftScreen.tsx');
    expect(dashboard).toContain('pettyCashNet');
    expect(reports).toContain('Petty Cash Net');
    expect(shift).toContain('+ drawerCashIn - drawerCashOut');
  });
});
