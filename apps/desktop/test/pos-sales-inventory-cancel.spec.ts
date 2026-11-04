import type { OutboxItem } from '@vpos/shared-types';
import type { DesktopSalePayload, DesktopSaleRecord } from '../src/db/schema';
import { desktopDb } from '../src/db/sqlite';
import { buildSaleOutboxPayload } from '../src/services/desktop-sale-sync-payload';
import { DesktopStockProjectionService } from '../src/services/desktop-stock-projection.service';

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function makeSaleRecord(input: {
  saleId: string;
  locationId: string;
  productId: string;
  qty: number;
  unitPrice: number;
  flow: 'NON_REFILL' | 'REFILL_EXCHANGE';
}): DesktopSaleRecord {
  const now = '2026-05-25T00:00:00.000Z';
  const subtotal = round2(input.qty * input.unitPrice);
  const payload: DesktopSalePayload = {
    id: input.saleId,
    shiftId: 'shift-1',
    customerId: 'cust-1',
    customerName: 'Test Customer',
    recreatedFromSaleId: null,
    personnelId: 'personnel-1',
    personnelName: 'P1',
    helperId: null,
    helperName: null,
    personnel: [{ userId: 'personnel-1', role: 'DRIVER', name: 'P1' }],
    saleType: 'PICKUP',
    paymentMode: 'FULL',
    paymentMethod: 'CASH',
    hideAmounts: false,
    branchId: 'branch-1',
    branchLabel: 'Main',
    locationId: input.locationId,
    locationLabel: 'Front',
    subtotal,
    discountAmount: 0,
    deliveryFee: 0,
    totalAmount: subtotal,
    paidAmount: subtotal,
    changeAmount: 0,
    creditBalance: 0,
    payments: [{ method: 'CASH', amount: subtotal, referenceNo: null }],
    rewardId: null,
    rewardName: null,
    rewardPointsCost: 0,
    rewardDiscountAmount: 0,
    rewardRedemptionUsed: false,
    notes: null,
    lines: [
      {
        lineId: 'line-1',
        productId: input.productId,
        productName: 'Sample LPG 11kg',
        quantity: input.qty,
        unitPrice: input.unitPrice,
        lineTotal: subtotal,
        cylinderFlow: input.flow
      }
    ],
    createdAt: now
  };

  return {
    id: input.saleId,
    payload,
    syncStatus: 'pending',
    receiptNumber: '20260525-0000001',
    createdAt: now,
    updatedAt: now
  };
}

function makeOutboxItem(
  id: string,
  entity: OutboxItem['entity'],
  action: OutboxItem['action'],
  payload: Record<string, unknown>
): OutboxItem {
  const now = '2026-05-25T00:00:00.000Z';
  return {
    id,
    entity,
    action,
    payload,
    idempotency_key: `idem-${id}`,
    created_at: now,
    updated_at: now,
    status: 'pending',
    retry_count: 0,
    last_error: null
  };
}

function passesFullPaymentRule(payload: Record<string, unknown>): boolean {
  const subtotal = round2(Number(payload.subtotal ?? 0));
  const discountAmount = round2(Number(payload.discount_amount ?? payload.discountAmount ?? 0));
  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  const paymentTotal = round2(
    payments.reduce((sum, row) => {
      const item = row as Record<string, unknown>;
      return sum + Number(item.amount ?? 0);
    }, 0)
  );
  const netTotal = round2(Math.max(0, subtotal - discountAmount));
  return paymentTotal === netTotal;
}

describe('desktop POS inventory + cancel + total checks', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deducts inventory for a pending NON-REFILL sale', async () => {
    const sale = makeSaleRecord({
      saleId: 'sale-1',
      locationId: 'loc-1',
      productId: 'item-11kg',
      qty: 5,
      unitPrice: 150,
      flow: 'NON_REFILL'
    });

    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      {
        entity: 'inventory_balance',
        recordId: 'inv-1',
        payload: JSON.stringify({
          productId: 'item-11kg',
          locationId: 'loc-1',
          qtyOnHand: 30,
          qtyFull: 30,
          qtyEmpty: 0
        }),
        updatedAt: '2026-05-24T00:00:00.000Z'
      }
    ]);
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([sale]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      makeOutboxItem('outbox-sale-1', 'sale', 'create', buildSaleOutboxPayload(sale.payload))
    ]);

    const projected = await new DesktopStockProjectionService().loadProjectedInventoryByProduct('loc-1');
    expect(projected.get('item-11kg')).toEqual({
      qtyOnHand: 25,
      qtyFull: 25,
      qtyEmpty: 0
    });
  });

  it('restores inventory when a pending sale cancel exists for the same sale', async () => {
    const sale = makeSaleRecord({
      saleId: 'sale-2',
      locationId: 'loc-1',
      productId: 'item-11kg',
      qty: 5,
      unitPrice: 150,
      flow: 'NON_REFILL'
    });

    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      {
        entity: 'inventory_balance',
        recordId: 'inv-1',
        payload: JSON.stringify({
          productId: 'item-11kg',
          locationId: 'loc-1',
          qtyOnHand: 30,
          qtyFull: 30,
          qtyEmpty: 0
        }),
        updatedAt: '2026-05-24T00:00:00.000Z'
      }
    ]);
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([sale]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      makeOutboxItem('outbox-sale-2', 'sale', 'create', buildSaleOutboxPayload(sale.payload)),
      makeOutboxItem('outbox-cancel-2', 'sale_cancel', 'create', {
        id: 'sale-2',
        sale_id: 'sale-2',
        reason: 'Customer requested cancellation'
      })
    ]);

    const projected = await new DesktopStockProjectionService().loadProjectedInventoryByProduct('loc-1');
    expect(projected.get('item-11kg')).toEqual({
      qtyOnHand: 30,
      qtyFull: 30,
      qtyEmpty: 0
    });
  });

  it('adds stock back for pending return quantity', async () => {
    const sale = makeSaleRecord({
      saleId: 'sale-3',
      locationId: 'loc-1',
      productId: 'item-11kg',
      qty: 10,
      unitPrice: 150,
      flow: 'NON_REFILL'
    });

    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      {
        entity: 'inventory_balance',
        recordId: 'inv-1',
        payload: JSON.stringify({
          productId: 'item-11kg',
          locationId: 'loc-1',
          qtyOnHand: 30,
          qtyFull: 30,
          qtyEmpty: 0
        }),
        updatedAt: '2026-05-24T00:00:00.000Z'
      }
    ]);
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([sale]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      makeOutboxItem('outbox-sale-3', 'sale', 'create', buildSaleOutboxPayload(sale.payload)),
      makeOutboxItem('outbox-return-3', 'sale_return', 'create', {
        id: 'sale-return-3',
        sale_id: 'sale-3',
        reason: 'Damaged seal',
        lines: [
          {
            sale_line_id: 'line-1',
            product_id: 'item-11kg',
            quantity: 4
          }
        ]
      })
    ]);

    const projected = await new DesktopStockProjectionService().loadProjectedInventoryByProduct('loc-1');
    expect(projected.get('item-11kg')).toEqual({
      qtyOnHand: 24,
      qtyFull: 24,
      qtyEmpty: 0
    });
  });

  it('keeps FULL payment and total amount aligned for delivery sale payload', () => {
    const payload: DesktopSalePayload = {
      id: 'sale-total-1',
      shiftId: 'shift-1',
      customerId: 'cust-1',
      customerName: 'Sample Customer',
      recreatedFromSaleId: null,
      personnelId: 'personnel-1',
      personnelName: 'P1',
      helperId: null,
      helperName: null,
      personnel: [{ userId: 'personnel-1', role: 'DRIVER', name: 'P1' }],
      saleType: 'DELIVERY',
      paymentMode: 'FULL',
      paymentMethod: 'E_WALLET',
      hideAmounts: false,
      branchId: 'branch-1',
      branchLabel: 'Main',
      locationId: 'loc-1',
      locationLabel: 'Front',
      subtotal: 750,
      discountAmount: 0,
      deliveryFee: 20,
      totalAmount: 770,
      paidAmount: 770,
      changeAmount: 0,
      creditBalance: 0,
      payments: [{ method: 'E_WALLET', amount: 770, referenceNo: null }],
      rewardId: null,
      rewardName: null,
      rewardPointsCost: 0,
      rewardDiscountAmount: 0,
      rewardRedemptionUsed: false,
      notes: 'Sample delivery checkout',
      lines: [
        {
          lineId: 'line-1',
          productId: 'item-11kg',
          productName: 'Sample LPG 11kg',
          quantity: 5,
          unitPrice: 150,
          lineTotal: 750,
          cylinderFlow: 'NON_REFILL'
        }
      ],
      createdAt: '2026-05-25T00:00:00.000Z'
    };

    const expectedTotal = round2(Math.max(0, payload.subtotal - payload.discountAmount + (payload.deliveryFee ?? 0)));
    expect(payload.totalAmount).toBe(expectedTotal);

    const outboxPayload = buildSaleOutboxPayload(payload);
    expect(passesFullPaymentRule(outboxPayload)).toBe(true);
  });
});
