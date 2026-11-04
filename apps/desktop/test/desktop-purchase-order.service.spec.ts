import { desktopDb } from '../src/db/sqlite';
import type { DesktopAppState, DesktopPurchaseOrderRecord } from '../src/db/schema';
import { DesktopPurchaseOrderService } from '../src/services/desktop-purchase-order.service';

function makeAppState(): DesktopAppState {
  return {
    version: 1,
    setupCompleted: true,
    setup: {
      operatorName: 'Cashier One',
      clientId: 'desktop-client-1',
      authEmail: 'cashier@example.com',
      deviceId: 'desktop-vpos',
      branchId: 'branch-1',
      branchLabel: 'Main Branch',
      locationId: 'loc-1',
      locationLabel: 'Warehouse',
      apiBaseUrl: 'https://vmjamtech.com/api',
      printerMode: 'NONE',
      printerName: '',
      printerHost: '',
      printerPort: '9100',
      posDefaultLpgFlow: 'NONE'
    },
    auth: {
      accessToken: null,
      refreshToken: null,
      signedInAt: null,
      userEmail: 'cashier@example.com',
      userFullName: 'Cashier One',
      pinHash: null,
      pinSalt: null
    },
    printerProfiles: [],
    receiptLayout: {
      showHeaderLogoImage: false,
      headerLogoImageDataUrl: '',
      headerLogoPlacement: 'CENTER',
      showHeaderLogoText: true,
      headerLogoText: 'VMJAM LPG',
      showStoreContact: false,
      storeContactInfo: '',
      showStoreAddress: false,
      storeAddress: '',
      showBusinessTin: false,
      businessTin: '',
      showPermitOrInfo: false,
      permitOrInfo: '',
      showTerminalName: false,
      terminalName: '',
      showReceiptNumber: true,
      showSaleId: true,
      showDateTime: true,
      showBranch: true,
      showLocation: true,
      showCashier: true,
      showCashierRole: false,
      cashierRoleLabel: '',
      showOrderType: true,
      showCustomer: true,
      showPersonnel: true,
      showHelper: true,
      showItemCode: false,
      showPaymentMode: true,
      showSubtotal: true,
      showDiscount: true,
      showTotal: true,
      showPaid: true,
      showChange: true,
      showCreditDue: true,
      showFooter: true,
      footerText: 'Thank you for choosing VPOS LPG.',
      topPaddingLines: 2,
      bottomPaddingLines: 3
    },
    walkthrough: {
      completedAt: null,
      dismissedAt: null
    },
    sync: {
      lastSyncedAt: null,
      lastPullToken: null,
      lastSyncStatus: 'idle',
      lastSyncMessage: ''
    }
  };
}

function makePurchaseOrderRecord(
  overrides: Partial<DesktopPurchaseOrderRecord> = {}
): DesktopPurchaseOrderRecord {
  const now = '2026-06-08T09:15:00.000Z';
  const base: DesktopPurchaseOrderRecord = {
    id: 'desk-po-1',
    poNumber: null,
    status: 'DRAFT',
    branchId: 'branch-1',
    branchLabel: 'Main Branch',
    locationId: 'loc-1',
    locationLabel: 'Warehouse',
    supplierId: 'sup-1',
    supplierLabel: 'Acme Gas',
    notes: 'Morning refill allocation',
    createdByUserId: null,
    submittedByUserId: null,
    completedByUserId: null,
    cancelledByUserId: null,
    submittedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    orderedQtyTotal: 12,
    receivedQtyTotal: 0,
    pulledOutQtyTotal: 0,
    attachmentCount: 0,
    syncStatus: 'pending',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    lines: [
      {
        id: 'desk-po-line-1',
        productId: 'prod-1',
        productSku: 'LPG-11',
        productName: 'LPG 11kg',
        orderedQty: 12,
        receivedQty: 0,
        pulledOutQty: 0,
        unitCost: 950,
        notes: null
      }
    ],
    receipts: [],
    pullouts: [],
    attachments: []
  };
  return {
    ...base,
    ...overrides,
    lines: overrides.lines ?? base.lines,
    receipts: overrides.receipts ?? base.receipts,
    pullouts: overrides.pullouts ?? base.pullouts,
    attachments: overrides.attachments ?? base.attachments
  };
}

describe('DesktopPurchaseOrderService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a local draft purchase order from cached master data and queues a purchase_order create outbox row', async () => {
    const service = new DesktopPurchaseOrderService();
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'supplier') {
        return [
          {
            entity: 'supplier',
            recordId: 'sup-1',
            payload: JSON.stringify({ id: 'sup-1', code: 'SUP-001', name: 'Acme Gas' }),
            updatedAt: '2026-06-08T08:00:00.000Z'
          }
        ];
      }
      if (entity === 'location') {
        return [
          {
            entity: 'location',
            recordId: 'loc-1',
            payload: JSON.stringify({ id: 'loc-1', code: 'LOC-001', name: 'Warehouse', branchId: 'branch-1' }),
            updatedAt: '2026-06-08T08:00:00.000Z'
          }
        ];
      }
      if (entity === 'product') {
        return [
          {
            entity: 'product',
            recordId: 'prod-1',
            payload: JSON.stringify({ id: 'prod-1', sku: 'LPG-11', name: 'LPG 11kg' }),
            updatedAt: '2026-06-08T08:00:00.000Z'
          },
          {
            entity: 'product',
            recordId: 'prod-2',
            payload: JSON.stringify({ id: 'prod-2', sku: 'ACC-REG', name: 'Regulator' }),
            updatedAt: '2026-06-08T08:00:00.000Z'
          }
        ];
      }
      return [];
    });
    const upsertSpy = jest.spyOn(desktopDb, 'upsertMasterDataRows').mockResolvedValue(undefined);
    const enqueueSpy = jest.spyOn(desktopDb, 'enqueueOutboxItem').mockResolvedValue({
      id: 'outbox-1',
      entity: 'purchase_order',
      action: 'create',
      payload: {},
      idempotency_key: 'idem-1',
      created_at: '2026-06-08T09:15:00.000Z',
      updated_at: '2026-06-08T09:15:00.000Z',
      status: 'pending',
      retry_count: 0,
      last_error: null
    });

    const record = await service.createPurchaseOrder(makeAppState(), {
      locationId: 'loc-1',
      supplierId: 'sup-1',
      notes: '  Morning refill allocation  ',
      items: [
        {
          productId: 'prod-1',
          orderedQty: 12,
          unitCost: 950,
          notes: 'First truck'
        },
        {
          productId: 'prod-2',
          orderedQty: 4,
          unitCost: 325
        }
      ]
    });

    expect(record.status).toBe('DRAFT');
    expect(record.syncStatus).toBe('pending');
    expect(record.branchId).toBe('branch-1');
    expect(record.locationLabel).toBe('Warehouse');
    expect(record.supplierLabel).toBe('Acme Gas');
    expect(record.orderedQtyTotal).toBe(16);
    expect(record.receivedQtyTotal).toBe(0);
    expect(record.lines).toEqual([
      expect.objectContaining({
        productId: 'prod-1',
        productSku: 'LPG-11',
        productName: 'LPG 11kg',
        orderedQty: 12,
        receivedQty: 0,
        pulledOutQty: 0,
        unitCost: 950,
        notes: 'First truck'
      }),
      expect.objectContaining({
        productId: 'prod-2',
        productSku: 'ACC-REG',
        productName: 'Regulator',
        orderedQty: 4,
        receivedQty: 0,
        pulledOutQty: 0,
        unitCost: 325,
        notes: null
      })
    ]);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy.mock.calls[0][0][0]).toMatchObject({
      entity: 'desktop_purchase_order',
      recordId: record.id,
      updatedAt: record.updatedAt
    });

    const persisted = JSON.parse(upsertSpy.mock.calls[0][0][0].payload) as DesktopPurchaseOrderRecord;
    expect(persisted).toMatchObject({
      id: record.id,
      status: 'DRAFT',
      branchId: 'branch-1',
      locationId: 'loc-1',
      supplierId: 'sup-1',
      notes: 'Morning refill allocation'
    });

    const queued = enqueueSpy.mock.calls[0][0];
    expect(queued.entity).toBe('purchase_order');
    expect(queued.action).toBe('create');
    expect(queued.payload).toMatchObject({
      id: record.id,
      po_number: null,
      branch_id: 'branch-1',
      location_id: 'loc-1',
      supplier_id: 'sup-1',
      notes: 'Morning refill allocation',
      lines: [
        {
          product_id: 'prod-1',
          ordered_qty: 12,
          unit_cost: 950,
          notes: 'First truck'
        },
        {
          product_id: 'prod-2',
          ordered_qty: 4,
          unit_cost: 325,
          notes: null
        }
      ]
    });
  });

  it('lists purchase orders newest first and returns a single record by id', async () => {
    const service = new DesktopPurchaseOrderService();
    const older = makePurchaseOrderRecord({
      id: 'desk-po-older',
      createdAt: '2026-06-08T08:00:00.000Z',
      updatedAt: '2026-06-08T08:00:00.000Z'
    });
    const newer = makePurchaseOrderRecord({
      id: 'desk-po-newer',
      createdAt: '2026-06-08T10:30:00.000Z',
      updatedAt: '2026-06-08T10:30:00.000Z'
    });
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      {
        entity: 'desktop_purchase_order',
        recordId: older.id,
        payload: JSON.stringify(older),
        updatedAt: older.updatedAt
      },
      {
        entity: 'desktop_purchase_order',
        recordId: newer.id,
        payload: JSON.stringify(newer),
        updatedAt: newer.updatedAt
      },
      {
        entity: 'desktop_purchase_order',
        recordId: 'broken-row',
        payload: '{',
        updatedAt: '2026-06-08T11:00:00.000Z'
      }
    ]);

    const rows = await service.listPurchaseOrders();

    expect(rows.map((row) => row.id)).toEqual(['desk-po-newer', 'desk-po-older']);
    await expect(service.getPurchaseOrder('desk-po-older')).resolves.toMatchObject({
      id: 'desk-po-older',
      supplierLabel: 'Acme Gas'
    });
    await expect(service.getPurchaseOrder('missing-po')).resolves.toBeNull();
  });

  it('updates and deletes an unsynced draft purchase order locally', async () => {
    const service = new DesktopPurchaseOrderService();
    const current = makePurchaseOrderRecord({
      id: 'desk-po-editable',
      supplierId: 'sup-1',
      supplierLabel: 'Acme Gas',
      locationId: 'loc-1',
      locationLabel: 'Warehouse',
      syncStatus: 'pending',
      lines: [
        {
          id: 'desk-po-line-1',
          productId: 'prod-1',
          productSku: 'LPG-11',
          productName: 'LPG 11kg',
          orderedQty: 12,
          receivedQty: 0,
          pulledOutQty: 0,
          unitCost: 950,
          notes: null
        }
      ]
    });

    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'desktop_purchase_order') {
        return [
          {
            entity: 'desktop_purchase_order',
            recordId: current.id,
            payload: JSON.stringify(current),
            updatedAt: current.updatedAt
          }
        ];
      }
      if (entity === 'supplier') {
        return [
          {
            entity: 'supplier',
            recordId: 'sup-1',
            payload: JSON.stringify({ id: 'sup-1', code: 'SUP-001', name: 'Acme Gas' }),
            updatedAt: '2026-06-08T08:00:00.000Z'
          },
          {
            entity: 'supplier',
            recordId: 'sup-2',
            payload: JSON.stringify({ id: 'sup-2', code: 'SUP-002', name: 'Prime Tanks' }),
            updatedAt: '2026-06-08T08:00:00.000Z'
          }
        ];
      }
      if (entity === 'location') {
        return [
          {
            entity: 'location',
            recordId: 'loc-1',
            payload: JSON.stringify({ id: 'loc-1', code: 'LOC-001', name: 'Warehouse', branchId: 'branch-1' }),
            updatedAt: '2026-06-08T08:00:00.000Z'
          }
        ];
      }
      if (entity === 'product') {
        return [
          {
            entity: 'product',
            recordId: 'prod-1',
            payload: JSON.stringify({ id: 'prod-1', sku: 'LPG-11', name: 'LPG 11kg' }),
            updatedAt: '2026-06-08T08:00:00.000Z'
          },
          {
            entity: 'product',
            recordId: 'prod-2',
            payload: JSON.stringify({ id: 'prod-2', sku: 'LPG-22', name: 'LPG 22kg' }),
            updatedAt: '2026-06-08T08:00:00.000Z'
          }
        ];
      }
      return [];
    });

    const upsertSpy = jest.spyOn(desktopDb, 'upsertMasterDataRows').mockResolvedValue(undefined);
    const updateOutboxSpy = jest.spyOn(desktopDb, 'updateOutboxPayload').mockResolvedValue(undefined);
    const deleteRowSpy = jest.spyOn(desktopDb, 'deleteMasterDataRow').mockResolvedValue(undefined);
    const deleteOutboxSpy = jest.spyOn(desktopDb, 'deleteOutboxItem').mockResolvedValue(undefined);

    const updated = await service.updateDraftPurchaseOrder(current.id, makeAppState(), {
      locationId: 'loc-1',
      supplierId: 'sup-2',
      notes: 'Updated allocation',
      items: [
        {
          productId: 'prod-2',
          orderedQty: 6,
          unitCost: 1225,
          notes: 'Second draft'
        }
      ]
    });

    expect(updated.status).toBe('DRAFT');
    expect(updated.supplierId).toBe('sup-2');
    expect(updated.supplierLabel).toBe('Prime Tanks');
    expect(updated.notes).toBe('Updated allocation');
    expect(updated.orderedQtyTotal).toBe(6);
    expect(updated.lines).toEqual([
      expect.objectContaining({
        id: 'desk-po-line-1',
        productId: 'prod-2',
        productSku: 'LPG-22',
        productName: 'LPG 22kg',
        orderedQty: 6,
        unitCost: 1225,
        notes: 'Second draft'
      })
    ]);
    expect(upsertSpy).toHaveBeenCalled();
    expect(updateOutboxSpy).toHaveBeenCalledWith(`outbox-${current.id}`, expect.objectContaining({
      id: current.id,
      supplier_id: 'sup-2',
      notes: 'Updated allocation'
    }));

    await service.deleteDraftPurchaseOrder(current.id);
    expect(deleteRowSpy).toHaveBeenCalledWith('desktop_purchase_order', current.id);
    expect(deleteOutboxSpy).toHaveBeenCalledWith(`outbox-${current.id}`);
  });

  it('supports submit, receive, pullout, complete, cancel, attachment, and sync status updates', async () => {
    const service = new DesktopPurchaseOrderService();
    const upsertSpy = jest.spyOn(desktopDb, 'upsertMasterDataRows').mockResolvedValue(undefined);
    const enqueueSpy = jest.spyOn(desktopDb, 'enqueueOutboxItem').mockResolvedValue({
      id: 'outbox-2',
      entity: 'purchase_order_submit',
      action: 'submit',
      payload: {},
      idempotency_key: 'idem-2',
      created_at: '2026-06-08T09:15:00.000Z',
      updated_at: '2026-06-08T09:15:00.000Z',
      status: 'pending',
      retry_count: 0,
      last_error: null
    });

    let current = makePurchaseOrderRecord({
      status: 'DRAFT',
      orderedQtyTotal: 2,
      lines: [
        {
          id: 'line-1',
          productId: 'prod-1',
          productSku: 'LPG-11',
          productName: 'LPG 11kg',
          orderedQty: 2,
          receivedQty: 0,
          pulledOutQty: 0,
          unitCost: 950,
          notes: null
        }
      ]
    });

    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'desktop_purchase_order') {
        return [
          {
            entity: 'desktop_purchase_order',
            recordId: current.id,
            payload: JSON.stringify(current),
            updatedAt: current.updatedAt
          }
        ];
      }
      return [];
    });

    current = await service.submitPurchaseOrder(current.id, 'user-1');
    expect(current.status).toBe('SUBMITTED');

    current = await service.receivePurchaseOrder(current.id, {
      notes: 'Truck 1',
      receivedByUserId: 'user-1',
      lines: [{ purchaseOrderLineId: 'line-1', quantity: 2, unitCost: 960 }]
    });
    expect(current.status).toBe('PARTIALLY_RECEIVED');
    expect(current.receivedQtyTotal).toBe(2);
    expect(current.lines[0]?.receivedQty).toBe(2);

    current = await service.pulloutPurchaseOrder(current.id, {
      notes: 'Damaged stock',
      pulledOutByUserId: 'user-2',
      lines: [{ purchaseOrderLineId: 'line-1', quantity: 1, unitCost: 960 }]
    });
    expect(current.pulledOutQtyTotal).toBe(1);
    expect(current.lines[0]?.pulledOutQty).toBe(1);

    current = await service.addAttachment(current.id, {
      fileName: 'po-proof.png',
      mimeType: 'image/png',
      sizeBytes: 128,
      dataBase64: 'ZmFrZQ=='
    });
    expect(current.attachmentCount).toBe(1);
    expect(current.attachments).toHaveLength(1);

    current = await service.completePurchaseOrder(current.id, 'user-3');
    expect(current.status).toBe('COMPLETED');

    await service.updatePurchaseOrderSyncStatus(current.id, 'synced');
    expect(upsertSpy).toHaveBeenCalled();

    const cancelRecord = makePurchaseOrderRecord({ id: 'desk-po-cancel', status: 'DRAFT' });
    current = cancelRecord;
    current = await service.cancelPurchaseOrder(cancelRecord.id, 'Duplicate', 'user-4');
    expect(current.status).toBe('CANCELLED');
    expect(current.cancelReason).toBe('Duplicate');

    expect(enqueueSpy.mock.calls.map((call) => call[0].entity)).toEqual(
      expect.arrayContaining([
        'purchase_order_submit',
        'purchase_order_receive',
        'purchase_order_pullout',
        'purchase_order_attachment',
        'purchase_order_complete',
        'purchase_order_cancel'
      ])
    );
  });
});
