import { readFileSync } from 'fs';
import { join } from 'path';

function source(relativePath: string): string {
  return readFileSync(join(__dirname, '..', relativePath), 'utf8');
}

describe('V3 feedback regressions', () => {
  it('limits opening average cost to two decimal places', () => {
    const page = source('src/app/(admin)/inventory-opening/page.tsx');
    expect(page).toContain('Average cost can have at most 2 decimal places.');
    expect(page).toContain('avgCost: Number(parsedCost.toFixed(2))');
    expect(page).toContain('step="0.01"');
  });

  it('sorts inactive price lists last and exposes a direct operational status control', () => {
    const page = source('src/app/(admin)/price-lists/page.tsx');
    expect(page).toContain('function priceListStatusRank');
    expect(page).toContain('priceListStatusRank(left) - priceListStatusRank(right)');
    expect(page).toContain('updateOperationalStatus(row, event.target.value');
  });

  it('surfaces item history and detailed expense remarks', () => {
    const products = source('src/app/(admin)/products/page.tsx');
    const reports = source('src/app/(admin)/reports/page.tsx');
    expect(products).toContain("{ id: 'movements', label: 'Item History' }");
    expect(products).toContain("label: 'Item History'");
    expect(reports).toContain('Description / Remarks');
    expect(reports).toContain('pettyNoteParts(row.notes)');
  });
});
