import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ItemCatalogHeader,
  ItemCatalogOverviewPanel,
  ItemCatalogCategoryChip,
  ItemCatalogRecordRow,
  ItemDetailModal,
  applyInventoryCatalogPricing,
  getItemDetailCylinderActions
} from '../src/screens/ItemsScreen';

describe('ItemCatalogHeader', () => {
  it('renders a compact management header with branch and location context', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ItemCatalogHeader, {
        branchLabel: 'VMJAM - Desktop',
        locationLabel: 'VMJAM - Desktop Primary',
        categoryLabel: 'All categories',
        countLabel: '24 items'
      })
    );

    expect(markup).toContain('Item Catalog');
    expect(markup).toContain('Branch Inventory Items');
    expect(markup).toContain('VMJAM - Desktop');
    expect(markup).toContain('VMJAM - Desktop Primary');
    expect(markup).toContain('24 items');
    expect(markup).toContain('items-catalog-header--compact');
  });
});

describe('ItemCatalogOverviewPanel', () => {
  it('renders a management shell with item metrics only', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ItemCatalogOverviewPanel, {
        title: 'Item Management',
        subtitle: 'Track branch inventory, stock buckets, and item movement.',
        metrics: [
          { key: 'total', label: 'All Items', value: '24', tone: 'good', icon: 'total' },
          { key: 'ready', label: 'Ready', value: '18', tone: 'good', icon: 'ready' },
          { key: 'low', label: 'Low Stock', value: '3', tone: 'warn', icon: 'low' },
          { key: 'out', label: 'Out Of Stock', value: '2', tone: 'out', icon: 'out' }
        ],
        onRefresh: () => undefined,
        refreshDisabled: false
      })
    );

    expect(markup).toContain('Item Management');
    expect(markup).toContain('Track branch inventory');
    expect(markup).not.toContain('Current item scope');
    expect(markup).toContain('Refresh');
    expect(markup).toContain('Item inventory');
  });
});

describe('ItemCatalogRecordRow', () => {
  it('renders a compact expense-style inventory record row without an open detail link', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ItemCatalogRecordRow, {
        title: 'SKU-001 | Cylinder A',
        meta: 'LPG \u00b7 Cylinder \u00b7 11kg',
        detail: 'Ready to sell',
        badges: [
          { label: 'Full 12', tone: 'full' },
          { label: 'Empty 8', tone: 'empty' },
          { label: 'QOH 20', tone: 'qoh' },
          { label: 'Lended 2', tone: 'neutral' }
        ],
        statusLabel: 'Ready',
        statusTone: 'good',
        typeLabel: 'LPG',
        priceLabel: 'PHP 150.00',
        selected: true,
        sizeError: null,
        onClick: () => undefined
      })
    );

    expect(markup).toContain('SKU-001 | Cylinder A');
    expect(markup).toContain('LPG \u00b7 Cylinder \u00b7 11kg');
    expect(markup).toContain('Ready to sell');
    expect(markup).toContain('Full 12');
    expect(markup).toContain('items-catalog-flow-price-chip');
    expect(markup).not.toContain('items-catalog-price');
    expect(markup).toContain('LPG');
    expect(markup).not.toContain('Open detail');
    expect(markup).toContain('items-catalog-row--compact');
  });

  it('renders refill and non-refill default prices in the item row', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ItemCatalogRecordRow, {
        title: 'SKU-001 | Cylinder A',
        meta: 'LPG \u00b7 Cylinder \u00b7 11kg',
        detail: null,
        badges: [
          { label: 'Full 12', tone: 'full' },
          { label: 'QOH 20', tone: 'qoh' }
        ],
        statusLabel: 'Ready',
        statusTone: 'good',
        typeLabel: 'LPG',
        typeTone: 'lpg',
        priceLabel: 'PHP 150.00',
        refillPriceLabel: 'PHP 50.00',
        nonRefillPriceLabel: 'PHP 150.00',
        selected: false,
        sizeError: null,
        onClick: () => undefined
      } as any)
    );

    expect(markup).toContain('Refill');
    expect(markup).toContain('Non-Refill');
    expect(markup).toContain('PHP 50.00');
    expect(markup).toContain('PHP 150.00');
    expect(markup).toContain('items-catalog-flow-price-row');
    expect(markup).toContain('items-catalog-flow-price-chip');
    expect(markup).not.toContain('items-catalog-price');
  });
});

describe('ItemCatalogCategoryChip', () => {
  it('renders an LPG-service style category chip with a count bubble', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ItemCatalogCategoryChip, {
        label: 'LPG',
        count: '12',
        active: true,
        onClick: () => undefined
      })
    );

    expect(markup).toContain('LPG');
    expect(markup).toContain('12');
    expect(markup).toContain('items-catalog-filter-chip');
    expect(markup).toContain('items-catalog-filter-count');
    expect(markup).toContain('active');
  });
});

describe('ItemDetailModal', () => {
  it('renders the tabbed item detail layout without a related actions card', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ItemDetailModal, {
        selected: {
          id: 'item-1',
          sku: 'SKU-001',
          name: 'Cylinder A',
          category: 'LPG',
          unit: 'Cylinder',
          isLpg: true,
          qtyOnHand: 82,
          qtyFull: 65,
          qtyEmpty: 17,
          unitPrice: 50,
          cylinderSizeLabel: '5 kg'
        },
        selectedDetail: {
          itemCode: 'ITEM-001',
          name: 'Cylinder A',
          category: 'LPG',
          brand: 'Brand X',
          unit: 'Cylinder',
          isLpg: true,
          isLendable: false,
          requiresReturn: false,
          requiresDeposit: false,
          defaultDepositAmount: null,
          lendingUnitType: 'cylinder',
          cylinderTypeId: 'cyl-1',
          lowStockAlertQty: 5,
          updatedAt: '2026-06-03T10:00:00.000Z'
        },
        selectedCylinder: {
          id: 'cyl-1',
          code: 'CYL-1',
          name: 'Standard Cylinder',
          sizeKg: 5,
          depositAmount: 1000
        },
        selectedRules: [
          {
            priceListId: 'pl-1',
            priceListName: 'Branch Desktop',
            scope: 'Branch Desktop',
            appliesTo: 'Cylinder A',
            flowMode: 'ANY',
            unitPrice: 50,
            discountCapPct: 5,
            priority: 3
          }
        ],
        selectedLendedQty: 0,
        selectedDisposedQty: 2,
        selectedCylinderSizeError: null,
        locationLabel: 'VMJAM - Desktop Primary',
        onClose: () => undefined,
        onOpenItemHistory: () => undefined,
        onOpenLpgService: () => undefined
      })
    );

    expect(markup).toContain('Item Detail');
    expect(markup).toContain('Overview');
    expect(markup).toContain('Linked Cylinder');
    expect(markup).toContain('Pricing Rules');
    expect(markup).toContain('Open Item History');
    expect(markup).not.toContain('Service History');
    expect(markup).toContain('ITEM-001');
    expect(markup).toContain('Cylinder A');
    expect(markup).toContain('Stock Snapshot');
    expect(markup).toContain('Catalog Information');
    expect(markup).toContain('items-detail-overview-card');
    expect(markup).toContain('items-detail-fact-grid');
    expect(markup).toContain('items-detail-fact-row');
    expect(markup).toContain('items-detail-fact-icon');
    expect(markup).not.toContain('Related actions');
    expect(markup).not.toContain('Open LPG Service');
  });
});

describe('getItemDetailCylinderActions', () => {
  it('does not expose a linked LPG service button', () => {
    const actions = getItemDetailCylinderActions({
      isLpg: true,
      hasCylinderType: true,
      hasCylinder: true,
      onOpenLpgService: () => undefined
    });

    expect(actions).toEqual([]);
  });
});

describe('applyInventoryCatalogPricing', () => {
  it('shows the active branch price in inventory after a price-list version update', () => {
    const [priced] = applyInventoryCatalogPricing({
      catalog: [{
        id: 'item-1',
        sku: 'ITEM-1',
        name: 'Hose',
        category: 'Accessories',
        unit: 'unit',
        isLpg: false,
        qtyOnHand: 10,
        qtyFull: 0,
        qtyEmpty: 0,
        unitPrice: 75
      }],
      priceListRows: [{
        entity: 'price_list',
        recordId: 'branch-price',
        payload: JSON.stringify({
          id: 'branch-price',
          scope: 'BRANCH',
          branchId: 'branch-1',
          startsAt: '2026-01-01T00:00:00.000Z',
          isActive: true,
          rules: [{ productId: 'item-1', flowMode: 'ANY', unitPrice: 95, priority: 1 }]
        }),
        updatedAt: '2026-10-20T00:00:00.000Z'
      }],
      branchId: 'branch-1',
      defaultLpgFlow: 'NONE',
      atIso: '2026-10-20T12:00:00.000Z'
    });

    expect(priced.unitPrice).toBe(95);
  });
});
