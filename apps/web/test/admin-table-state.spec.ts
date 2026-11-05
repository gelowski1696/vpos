import {
  buildCsv,
  reconcileSelection,
  togglePageSelection,
  toggleRowSelection
} from '../src/lib/admin-table-state';

describe('admin table selection', () => {
  it('toggles one row without changing other selected rows', () => {
    const selected = new Set(['product-1']);

    expect([...toggleRowSelection(selected, 'product-2')].sort()).toEqual([
      'product-1',
      'product-2'
    ]);
    expect([...toggleRowSelection(new Set(['product-1', 'product-2']), 'product-1')]).toEqual([
      'product-2'
    ]);
  });

  it('selects and clears the current page while preserving other pages', () => {
    const selected = new Set(['off-page']);

    expect([...togglePageSelection(selected, ['page-1', 'page-2'], true)].sort()).toEqual([
      'off-page',
      'page-1',
      'page-2'
    ]);
    expect(
      [...togglePageSelection(new Set(['off-page', 'page-1', 'page-2']), ['page-1', 'page-2'], false)]
    ).toEqual(['off-page']);
  });

  it('drops stale selections after records refresh', () => {
    expect([...reconcileSelection(new Set(['product-1', 'stale']), ['product-1', 'product-2'])]).toEqual([
      'product-1'
    ]);
  });
});

describe('admin table CSV export', () => {
  it('quotes commas and neutralizes spreadsheet formulas', () => {
    const csv = buildCsv(
      [
        { id: 'product-1', name: 'LPG, 11kg', sku: '=HYPERLINK("bad")', active: true },
        { id: 'product-2', name: 'Regulator', sku: '  +100', active: false }
      ],
      [
        { key: 'name', label: 'Product' },
        { key: 'sku', label: 'Item Code' },
        { key: 'active', label: 'Active' }
      ]
    );

    expect(csv).toBe(
      'Product,Item Code,Active\r\n"LPG, 11kg","\'=HYPERLINK(""bad"")",true\r\nRegulator,\'  +100,false'
    );
  });
});
