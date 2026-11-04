import {
  DEFAULT_DESKTOP_APP_STATE,
  DesktopDeliveryService,
  DesktopExpenseService,
  DesktopLendingService,
  DesktopLpgItemActionService,
  DesktopPurchaseOrderService,
  DesktopTransferService,
  summarizeDesktopPettyCash,
  type DesktopLendingDetail,
  type DesktopMasterDataRow,
  type DesktopOperationalOutboxInput
} from '@vpos/desktop-core';

class MemoryOperationalRepository {
  rows: DesktopMasterDataRow[] = [];
  outbox: DesktopOperationalOutboxInput[] = [];

  async listMasterData(entity?: string): Promise<DesktopMasterDataRow[]> {
    return this.rows.filter((row) => !entity || row.entity === entity);
  }

  async upsertMasterDataRows(rows: DesktopMasterDataRow[]): Promise<void> {
    for (const row of rows) {
      this.rows = [
        row,
        ...this.rows.filter(
          (current) => current.entity !== row.entity || current.recordId !== row.recordId
        )
      ];
    }
  }

  async enqueueOutboxItem(input: DesktopOperationalOutboxInput): Promise<unknown> {
    this.outbox = [input, ...this.outbox.filter((row) => row.id !== input.id)];
    return input;
  }

  async updateOutboxPayload(id: string, payload: Record<string, unknown>): Promise<void> {
    this.outbox = this.outbox.map((row) => row.id === id ? { ...row, payload } : row);
  }

  async deleteMasterDataRow(entity: string, recordId: string): Promise<void> {
    this.rows = this.rows.filter((row) => row.entity !== entity || row.recordId !== recordId);
  }

  async deleteOutboxItem(id: string): Promise<void> {
    this.outbox = this.outbox.filter((row) => row.id !== id);
  }
}

const policy = { assertCanCreateTransactions: jest.fn(async () => undefined) };

describe('shared operational services', () => {
  beforeEach(() => policy.assertCanCreateTransactions.mockClear());

  it('persists and queues expense, transfer, delivery, and LPG actions through ports', async () => {
    const repository = new MemoryOperationalRepository();
    const state = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        branchId: 'branch-1',
        branchLabel: 'Main Branch'
      }
    };
    const expense = new DesktopExpenseService({
      repository,
      shift: { listShifts: async () => [{ id: 'shift-1', status: 'OPEN' } as never] },
      subscriptionPolicy: policy
    });
    const transfer = new DesktopTransferService({ repository, subscriptionPolicy: policy });
    const delivery = new DesktopDeliveryService({ repository, subscriptionPolicy: policy });
    const lpg = new DesktopLpgItemActionService({ repository, subscriptionPolicy: policy });

    await expense.createExpense(state, {
      shiftId: 'shift-1', categoryCode: 'MEALS', direction: 'OUT', amount: 125, notes: 'Team meal'
    });
    const draft = await transfer.createTransfer(state, {
      sourceLocationId: 'loc-1', sourceLocationLabel: 'Store',
      destinationLocationId: 'loc-2', destinationLocationLabel: 'Warehouse',
      shiftId: 'shift-1', transferMode: 'INTER_STORE_TRANSFER',
      lines: [{ productId: 'prod-1', productName: 'LPG 11kg', qtyFull: 2, qtyEmpty: 0 }]
    });
    await transfer.confirmTransfer(draft.id);
    await delivery.createDeliveryOrder({
      branchId: 'branch-1', sourceLocationId: 'loc-1', customerId: 'customer-1',
      orderType: 'DELIVERY', personnel: []
    });
    await lpg.createAction(state, {
      actionType: 'DISPOSE', productId: 'prod-1', productSku: 'LPG-11', productName: 'LPG 11kg',
      branchId: 'branch-1', branchLabel: 'Main Branch', locationId: 'loc-1', locationLabel: 'Store',
      quantity: 1, maximumQuantity: 2, reason: 'Failed inspection'
    });

    expect(repository.outbox.map((row) => row.entity)).toEqual(
      expect.arrayContaining(['petty_cash', 'transfer', 'delivery_order', 'lpg_item_action'])
    );
    expect(policy.assertCanCreateTransactions.mock.calls.map(([operation]) => operation)).toEqual(
      expect.arrayContaining(['petty_cash', 'transfer', 'delivery_order', 'lpg_item_action'])
    );
  });

  it('requires petty-cash descriptions and summarizes pending local cash movement', async () => {
    const repository = new MemoryOperationalRepository();
    const expense = new DesktopExpenseService({
      repository,
      shift: { listShifts: async () => [{ id: 'shift-1', status: 'OPEN' } as never] },
      subscriptionPolicy: policy
    });

    await expect(expense.createExpense(DEFAULT_DESKTOP_APP_STATE, {
      shiftId: 'shift-1', categoryCode: 'SUPPLIES', direction: 'OUT', amount: 50, notes: '   '
    })).rejects.toThrow('Description is required.');

    await expense.createExpense(DEFAULT_DESKTOP_APP_STATE, {
      shiftId: 'shift-1', categoryCode: 'SUPPLIES', direction: 'OUT', amount: 50, notes: 'Cleaning supplies'
    });
    await expense.createExpense(DEFAULT_DESKTOP_APP_STATE, {
      shiftId: 'shift-1', categoryCode: 'FLOAT', direction: 'IN', amount: 100, notes: 'Additional cash float'
    });

    const summary = summarizeDesktopPettyCash(await expense.listExpenses(), { shiftId: 'shift-1' });
    expect(summary).toMatchObject({ totalIn: 100, totalOut: 50, net: 50 });
    expect(summary.entries).toHaveLength(2);
  });

  it('creates a purchase-order draft using cached operational records', async () => {
    const repository = new MemoryOperationalRepository();
    const updatedAt = '2026-10-08T00:00:00.000Z';
    repository.rows = [
      { entity: 'location', recordId: 'loc-1', payload: JSON.stringify({ id: 'loc-1', name: 'Store', branchId: 'branch-1' }), updatedAt },
      { entity: 'supplier', recordId: 'supplier-1', payload: JSON.stringify({ id: 'supplier-1', name: 'Supplier One' }), updatedAt },
      { entity: 'product', recordId: 'prod-1', payload: JSON.stringify({ id: 'prod-1', sku: 'P-001', name: 'LPG 11kg', isLpg: true }), updatedAt }
    ];
    const service = new DesktopPurchaseOrderService({ repository, subscriptionPolicy: policy });
    const state = {
      ...DEFAULT_DESKTOP_APP_STATE,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        branchId: 'branch-1',
        branchLabel: 'Main Branch'
      }
    };

    const result = await service.createPurchaseOrder(state, {
      locationId: 'loc-1', supplierId: 'supplier-1',
      items: [{ productId: 'prod-1', orderedQty: 10, unitCost: 825 }]
    });

    expect(result).toMatchObject({ status: 'DRAFT', orderedQtyTotal: 10, supplierLabel: 'Supplier One' });
    expect(repository.outbox[0]).toMatchObject({ entity: 'purchase_order', action: 'create' });
  });

  it('queues lending returns and updates the cached detail through ports', async () => {
    const repository = new MemoryOperationalRepository();
    const now = '2026-10-08T00:00:00.000Z';
    const detail = {
      lending_id: 'lend-1', company_id: 'company-1', branch_id: 'branch-1', branch_name: 'Main',
      location_id: 'loc-1', location_name: 'Store', customer_id: 'customer-1', customer_code: 'C-1',
      customer_name: 'Customer', sale_id: 'sale-1', status: 'OPEN', due_at: null, remarks: null,
      settlement_type: 'NONE', settlement_amount: null, created_by_user_id: null, created_by_name: null,
      approved_by_user_id: null, approved_by_name: null, opened_at: now, closed_at: null,
      cancelled_at: null, created_at: now, updated_at: now, line_count: 1,
      total_quantity_lent: 2, total_quantity_returned: 0,
      lines: [{ lending_line_id: 'line-1', source_sale_line_id: 'sale-line-1', product_id: 'prod-1',
        product_sku: 'P-1', product_name: 'LPG', quantity_lent: 2, quantity_returned: 0,
        quantity_open: 2, deposit_amount: null, remarks: null, created_at: now, updated_at: now }],
      returns: []
    } as DesktopLendingDetail;
    const service = new DesktopLendingService({
      repository,
      cache: { loadCachedLendingDetail: async () => detail },
      subscriptionPolicy: policy
    });

    const result = await service.queueOfflineReturn(DEFAULT_DESKTOP_APP_STATE, detail, {
      remarks: 'One returned',
      lines: [{ lending_line_id: 'line-1', returned_qty: 1, condition: 'GOOD' }]
    });

    expect(result).toMatchObject({ status: 'PARTIALLY_RETURNED', total_quantity_returned: 1 });
    expect(repository.outbox[0]).toMatchObject({ entity: 'lending_return', action: 'create' });
  });
});
