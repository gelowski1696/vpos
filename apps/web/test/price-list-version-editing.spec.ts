import { readFileSync } from 'fs';
import { join } from 'path';

describe('price-list version editing', () => {
  const source = readFileSync(join(__dirname, '../src/app/(admin)/price-lists/page.tsx'), 'utf8');

  it('saves item price and cost changes through draft-version rules', () => {
    expect(source).toContain('/versions/${selectedVersionId}/rules');
    expect(source).toContain("selectedVersionDetail?.status !== 'DRAFT'");
    expect(source).toContain('Save Draft Prices');
  });

  it('keeps the regular edit dialog limited to metadata and operational status', () => {
    expect(source).toContain('Published pricing remains unchanged.');
    expect(source).toContain('Only the name, reference code, and operational status will be updated.');
    expect(source).toContain('Version-controlled pricing');
  });

  it('shows the active published prices as read-only in the regular edit dialog', () => {
    expect(source).toContain('Active Published Pricing');
    expect(source).toContain('Read-only. Open Versions to create a draft and change these values.');
    expect(source).toContain('editingPriceList.rules.map((rule)');
  });

  it('shows item codes instead of raw product ids in historical rule snapshots', () => {
    expect(source).toContain('`${item.sku} — ${item.name}`');
    expect(source).toContain('Item Code / Product');
    expect(source).toContain("productLabelById.get(rule.productId) ?? 'Unavailable item'");
    expect(source).toContain('setProducts(productRows);');
  });
});
