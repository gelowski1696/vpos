import {
  deriveDesktopInventoryMovements,
  desktopItemAvailableQuantity,
  desktopItemStockTone,
  filterDesktopInventoryItems,
  paginateDesktopInventoryItems,
  summarizeDesktopInventoryItems,
  type DesktopCatalogProduct,
  type DesktopMasterDataRow,
  type DesktopSaleRecord
} from '@vpos/desktop-core';
import type { OutboxItem } from '@vpos/shared-types';

function product(id: string, overrides: Partial<DesktopCatalogProduct> = {}): DesktopCatalogProduct {
  return {
    id,
    sku: id.toUpperCase(),
    name: `Item ${id}`,
    category: 'General',
    unit: 'piece',
    unitPrice: 100,
    qtyOnHand: 10,
    qtyFull: 0,
    qtyEmpty: 0,
    isLpg: false,
    ...overrides
  };
}

function outbox(id: string, entity: string, payload: Record<string, unknown>): OutboxItem {
  return {
    id,
    entity,
    action: 'create',
    payload,
    idempotency_key: `idem-${id}`,
    created_at: `2026-10-0${id.length}T08:00:00.000Z`,
    updated_at: `2026-10-0${id.length}T08:00:00.000Z`,
    status: 'pending',
    retry_count: 0,
    last_error: null
  };
}

describe('desktop item projections', () => {
  it('filters, sorts, paginates, and summarizes regular and LPG stock', () => {
    const products = [
      product('water', { name: 'Water', category: 'Drinks', qtyOnHand: 8, unitPrice: 30 }),
      product('lpg-low', { name: 'LPG 11kg', category: 'LPG', isLpg: true, qtyOnHand: 12, qtyFull: 2, qtyEmpty: 10, unitPrice: 900, cylinderSizeLabel: '11 kg' }),
      product('lpg-out', { name: 'LPG 22kg', category: 'LPG', isLpg: true, qtyOnHand: 4, qtyFull: 0, qtyEmpty: 4, unitPrice: 1500, cylinderSizeLabel: '22 kg' }),
      product('oil', { name: 'Engine Oil', qtyOnHand: 0, unitPrice: 250 })
    ];

    expect(desktopItemAvailableQuantity(products[1])).toBe(2);
    expect(desktopItemStockTone(products[1])).toBe('LOW');
    expect(desktopItemStockTone(products[2])).toBe('OUT');
    expect(filterDesktopInventoryItems(products, {
      search: '11 kg', category: 'ALL', stock: 'ALL', type: 'LPG', sort: 'PRICE_DESC'
    }).map((row) => row.id)).toEqual(['lpg-low']);
    expect(filterDesktopInventoryItems(products, {
      search: '', category: 'ALL', stock: 'OUT', type: 'REGULAR', sort: 'NAME_ASC'
    }).map((row) => row.id)).toEqual(['oil']);
    expect(filterDesktopInventoryItems(products, {
      search: '', category: 'ALL', stock: 'ALL', type: 'ALL', sort: 'STOCK_ASC'
    }).map((row) => row.id)).toEqual(['lpg-out', 'oil', 'lpg-low', 'water']);
    expect(paginateDesktopInventoryItems(products, 99, 3)).toMatchObject({ page: 2, totalPages: 2, items: [{ id: 'oil' }] });
    expect(summarizeDesktopInventoryItems(products)).toEqual({ total: 4, ready: 1, low: 1, out: 2, lpg: 2, regular: 2 });
  });

  it('derives sale, return, transfer, lending, LPG action, and purchase receipt ledger rows', () => {
    const timestamp = '2026-10-01T08:00:00.000Z';
    const sale: DesktopSaleRecord = {
      id: 'sale-1', receiptNumber: 'R-1', syncStatus: 'pending', createdAt: timestamp, updatedAt: timestamp,
      payload: {
        id: 'sale-1', customerId: 'c1', customerName: 'Customer', saleType: 'PICKUP', paymentMethod: 'CASH',
        branchLabel: 'Branch', locationId: 'loc-1', locationLabel: 'Store', subtotal: 100, discountAmount: 0,
        totalAmount: 100, notes: null, lines: [{ lineId: 'line-1', productId: 'p1', productName: 'Cylinder', quantity: 2, unitPrice: 50, lineTotal: 100, cylinderFlow: 'NON_REFILL' }], createdAt: timestamp
      }
    };
    const masterData: DesktopMasterDataRow[] = [{
      entity: 'desktop_purchase_order', recordId: 'po-1', updatedAt: timestamp,
      payload: JSON.stringify({ id: 'po-1', locationId: 'loc-1', lines: [{ id: 'po-line-1', productId: 'p1', isLpg: true }] })
    }];
    const outboxRows: OutboxItem[] = [
      outbox('sale', 'sale', { id: 'sale-1', locationId: 'loc-1', receiptNumber: 'R-1', lines: sale.payload.lines }),
      outbox('return', 'sale_return', { id: 'return-1', sale_id: 'sale-1', reason: 'Returned', lines: [{ sale_line_id: 'line-1', product_id: 'p1', quantity: 1 }] }),
      outbox('transfer', 'transfer', { id: 'transfer-1', transfer_mode: 'INTER_STORE_TRANSFER', source_location_id: 'loc-1', destination_location_id: 'loc-2', lines: [{ product_id: 'p1', qty_full: 1, qty_empty: 2 }] }),
      outbox('lend', 'lending', { id: 'lend-1', location_id: 'loc-1', lines: [{ product_id: 'p1', quantity_open: 2 }] }),
      outbox('lendreturn', 'lending_return', { id: 'lend-return-1', location_id: 'loc-1', lines: [{ product_id: 'p1', returned_qty: 1 }] }),
      outbox('lpg', 'lpg_item_action', { id: 'lpg-1', action_type: 'DISPOSE', location_id: 'loc-1', product_id: 'p1', qty: 1, reason: 'Damaged' }),
      outbox('po', 'purchase_order_delivery', { id: 'po-delivery-1', purchase_order_id: 'po-1', receive_lines: [{ purchase_order_line_id: 'po-line-1', quantity: 5 }], pullout_lines: [{ purchase_order_line_id: 'po-line-1', quantity: 1 }] })
    ];

    const movements = deriveDesktopInventoryMovements({
      productId: 'p1', locationId: 'loc-1', locationLabel: 'Store', sales: [sale], outboxItems: outboxRows, masterData
    });

    expect(new Set(movements.map((row) => row.sourceType))).toEqual(new Set([
      'SALE', 'SALE_RETURN', 'TRANSFER', 'LENDING', 'LENDING_RETURN', 'LPG_ITEM_ACTION', 'PURCHASE_ORDER'
    ]));
    expect(movements.find((row) => row.sourceType === 'SALE')).toMatchObject({ qtyOnHandDelta: -2, qtyFullDelta: -2, qtyEmptyDelta: 0 });
    expect(movements.find((row) => row.sourceType === 'SALE_RETURN')).toMatchObject({ qtyOnHandDelta: 1, qtyFullDelta: 1 });
    expect(movements.find((row) => row.sourceType === 'TRANSFER')).toMatchObject({ qtyOnHandDelta: -3, qtyFullDelta: -1, qtyEmptyDelta: -2 });
    expect(movements.find((row) => row.sourceType === 'PURCHASE_ORDER')).toMatchObject({ qtyOnHandDelta: 4, qtyFullDelta: 5, qtyEmptyDelta: -1 });
    expect(movements.every((row) => row.status === 'PENDING' && row.locationLabel === 'Store')).toBe(true);
  });

  it('keeps standard PO receive and pull-out history after the outbox is synchronized', () => {
    const timestamp = '2026-10-01T08:00:00.000Z';
    const masterData: DesktopMasterDataRow[] = [{
      entity: 'desktop_purchase_order',
      recordId: 'po-1',
      updatedAt: timestamp,
      payload: JSON.stringify({
        id: 'po-1',
        locationId: 'loc-1',
        locationLabel: 'Store',
        syncStatus: 'synced',
        lines: [{ id: 'po-line-1', productId: 'p1', isLpg: true }],
        receipts: [{ id: 'receipt-1', locationId: 'loc-1', locationLabel: 'Store', createdAt: timestamp, notes: 'Supplier receipt', lines: [{ purchaseOrderLineId: 'po-line-1', productId: 'p1', quantity: 4 }] }],
        pullouts: [{ id: 'pullout-1', locationId: 'loc-1', locationLabel: 'Store', createdAt: '2026-10-02T08:00:00.000Z', notes: 'Returned empties', lines: [{ purchaseOrderLineId: 'po-line-1', productId: 'p1', quantity: 2 }] }],
        deliveries: []
      })
    }];

    const movements = deriveDesktopInventoryMovements({
      productId: 'p1', locationId: 'loc-1', locationLabel: 'Store', sales: [], outboxItems: [], masterData
    });

    expect(movements).toHaveLength(2);
    expect(movements.find((row) => row.movementType === 'Purchase receipt')).toMatchObject({
      sourceType: 'PURCHASE_ORDER', status: 'SYNCED', qtyOnHandDelta: 4, qtyFullDelta: 4, qtyEmptyDelta: 0
    });
    expect(movements.find((row) => row.movementType === 'Purchase pull-out')).toMatchObject({
      sourceType: 'PURCHASE_ORDER', status: 'SYNCED', qtyOnHandDelta: -2, qtyFullDelta: 0, qtyEmptyDelta: -2
    });
  });
});
