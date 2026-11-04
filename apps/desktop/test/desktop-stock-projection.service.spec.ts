import { desktopDb } from '../src/db/sqlite';
import { DesktopStockProjectionService as CoreDesktopStockProjectionService } from '@vpos/desktop-core';

class DesktopStockProjectionService extends CoreDesktopStockProjectionService {
  constructor() {
    super(desktopDb);
  }
}

describe('DesktopStockProjectionService non-refill flow normalization', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('applies NON-REFILL sale lines as LPG non-refill stock movement', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockResolvedValue([
      {
        entity: 'inventory_balance',
        recordId: 'inv-1',
        payload: JSON.stringify({
          productId: 'product-1',
          locationId: 'loc-1',
          qtyOnHand: 10,
          qtyFull: 10,
          qtyEmpty: 0
        }),
        updatedAt: '2026-05-24T00:00:00.000Z'
      }
    ]);
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      {
        id: 'outbox-1',
        entity: 'sale',
        action: 'create',
        payload: {
          locationId: 'loc-1',
          lines: [
            {
              productId: 'product-1',
              quantity: 2,
              cylinderFlow: 'NON-REFILL'
            }
          ]
        },
        idempotency_key: 'idem-1',
        created_at: '2026-05-24T01:00:00.000Z',
        updated_at: '2026-05-24T01:00:00.000Z',
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ]);

    const service = new DesktopStockProjectionService();
    const projected = await service.loadProjectedInventoryByProduct('loc-1');

    expect(projected.get('product-1')).toEqual({
      qtyOnHand: 8,
      qtyFull: 8,
      qtyEmpty: 0
    });
  });

  it('keeps confirmed supplier restock-out transfer movement after the outbox row has synced', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'inventory_balance') {
        return [
          {
            entity: 'inventory_balance',
            recordId: 'loc-1:product-1',
            payload: JSON.stringify({
              productId: 'product-1',
              locationId: 'loc-1',
              qtyOnHand: 201,
              qtyFull: 101,
              qtyEmpty: 100
            }),
            updatedAt: '2026-09-11T00:00:00.000Z'
          }
        ];
      }
      if (entity === 'desktop_transfer') {
        return [
          {
            entity: 'desktop_transfer',
            recordId: 'transfer-1',
            payload: JSON.stringify({
              id: 'transfer-1',
              sourceLocationId: 'loc-1',
              sourceLocationLabel: 'Store',
              destinationLocationId: 'loc-1',
              destinationLocationLabel: 'Supplier-1 (Supplier)',
              shiftId: 'shift-1',
              transferMode: 'SUPPLIER_RESTOCK_OUT',
              supplierId: 'supplier-1',
              supplierName: 'Supplier-1',
              notes: null,
              lines: [
                {
                  productId: 'product-1',
                  productName: 'Item A',
                  qtyFull: 1,
                  qtyEmpty: 0
                }
              ],
              movementStatus: 'confirmed',
              syncStatus: 'synced',
              lastError: null,
              receivedStatus: 'received',
              receivedAt: '2026-09-11T01:00:00.000Z',
              receivedBy: 'Cashier',
              receivedNotes: null,
              createdAt: '2026-09-11T00:30:00.000Z',
              updatedAt: '2026-09-11T01:00:00.000Z'
            }),
            updatedAt: '2026-09-11T01:00:00.000Z'
          }
        ];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);

    const service = new DesktopStockProjectionService();
    const projected = await service.loadProjectedInventoryByProduct('loc-1');

    expect(projected.get('product-1')).toEqual({
      qtyOnHand: 200,
      qtyFull: 100,
      qtyEmpty: 100
    });
  });

  it('does not double-count a confirmed transfer while its outbox row is still active', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'inventory_balance') {
        return [
          {
            entity: 'inventory_balance',
            recordId: 'loc-1:product-1',
            payload: JSON.stringify({
              productId: 'product-1',
              locationId: 'loc-1',
              qtyOnHand: 201,
              qtyFull: 101,
              qtyEmpty: 100
            }),
            updatedAt: '2026-09-11T00:00:00.000Z'
          }
        ];
      }
      if (entity === 'desktop_transfer') {
        return [
          {
            entity: 'desktop_transfer',
            recordId: 'transfer-1',
            payload: JSON.stringify({
              id: 'transfer-1',
              sourceLocationId: 'loc-1',
              sourceLocationLabel: 'Store',
              destinationLocationId: 'loc-1',
              destinationLocationLabel: 'Supplier-1 (Supplier)',
              shiftId: 'shift-1',
              transferMode: 'SUPPLIER_RESTOCK_OUT',
              lines: [{ productId: 'product-1', productName: 'Item A', qtyFull: 1, qtyEmpty: 0 }],
              movementStatus: 'confirmed',
              syncStatus: 'pending',
              createdAt: '2026-09-11T00:30:00.000Z',
              updatedAt: '2026-09-11T00:30:00.000Z'
            }),
            updatedAt: '2026-09-11T00:30:00.000Z'
          }
        ];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([
      {
        id: 'outbox-transfer-1',
        entity: 'transfer',
        action: 'create',
        payload: {
          id: 'transfer-1',
          source_location_id: 'loc-1',
          destination_location_id: 'loc-1',
          transfer_mode: 'SUPPLIER_RESTOCK_OUT',
          lines: [{ productId: 'product-1', qtyFull: 1, qtyEmpty: 0 }]
        },
        idempotency_key: 'desktop-transfer:transfer-1',
        created_at: '2026-09-11T00:30:00.000Z',
        updated_at: '2026-09-11T00:30:00.000Z',
        status: 'pending',
        retry_count: 0,
        last_error: null
      }
    ]);

    const service = new DesktopStockProjectionService();
    const projected = await service.loadProjectedInventoryByProduct('loc-1');

    expect(projected.get('product-1')).toEqual({
      qtyOnHand: 200,
      qtyFull: 100,
      qtyEmpty: 100
    });
  });

  it('keeps confirmed CREATE movement after sync when the create quantity was entered as full', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'inventory_balance') {
        return [
          {
            entity: 'inventory_balance',
            recordId: 'loc-1:product-1',
            payload: JSON.stringify({
              productId: 'product-1',
              locationId: 'loc-1',
              qtyOnHand: 200,
              qtyFull: 100,
              qtyEmpty: 100
            }),
            updatedAt: '2026-09-12T00:00:00.000Z'
          }
        ];
      }
      if (entity === 'desktop_transfer') {
        return [
          {
            entity: 'desktop_transfer',
            recordId: 'transfer-create-1',
            payload: JSON.stringify({
              id: 'transfer-create-1',
              sourceLocationId: 'loc-1',
              sourceLocationLabel: 'Store',
              destinationLocationId: 'loc-1',
              destinationLocationLabel: 'Store',
              shiftId: 'shift-1',
              transferMode: 'CREATE',
              lines: [{ productId: 'product-1', productName: 'Item A', qtyFull: 1, qtyEmpty: 0 }],
              movementStatus: 'confirmed',
              syncStatus: 'synced',
              createdAt: '2026-09-12T00:30:00.000Z',
              updatedAt: '2026-09-12T00:30:00.000Z'
            }),
            updatedAt: '2026-09-12T00:30:00.000Z'
          }
        ];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);

    const service = new DesktopStockProjectionService();
    const projected = await service.loadProjectedInventoryByProduct('loc-1');

    expect(projected.get('product-1')).toEqual({
      qtyOnHand: 201,
      qtyFull: 101,
      qtyEmpty: 100
    });
  });

  it('keeps confirmed USED movement after sync as full-only consumption', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'inventory_balance') {
        return [
          {
            entity: 'inventory_balance',
            recordId: 'loc-1:product-1',
            payload: JSON.stringify({
              productId: 'product-1',
              locationId: 'loc-1',
              qtyOnHand: 200,
              qtyFull: 100,
              qtyEmpty: 100
            }),
            updatedAt: '2026-09-12T00:00:00.000Z'
          }
        ];
      }
      if (entity === 'desktop_transfer') {
        return [
          {
            entity: 'desktop_transfer',
            recordId: 'transfer-used-1',
            payload: JSON.stringify({
              id: 'transfer-used-1',
              sourceLocationId: 'loc-1',
              sourceLocationLabel: 'Store',
              destinationLocationId: 'loc-1',
              destinationLocationLabel: 'Store',
              shiftId: 'shift-1',
              transferMode: 'USED',
              lines: [{ productId: 'product-1', productName: 'Item A', qtyFull: 1, qtyEmpty: 0 }],
              movementStatus: 'confirmed',
              syncStatus: 'synced',
              createdAt: '2026-09-12T00:30:00.000Z',
              updatedAt: '2026-09-12T00:30:00.000Z'
            }),
            updatedAt: '2026-09-12T00:30:00.000Z'
          }
        ];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);

    const service = new DesktopStockProjectionService();
    const projected = await service.loadProjectedInventoryByProduct('loc-1');

    expect(projected.get('product-1')).toEqual({
      qtyOnHand: 199,
      qtyFull: 99,
      qtyEmpty: 100
    });
  });

  it('applies confirmed CREATE as full in and empty out when both buckets are entered', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'inventory_balance') {
        return [
          {
            entity: 'inventory_balance',
            recordId: 'loc-1:product-1',
            payload: JSON.stringify({
              productId: 'product-1',
              locationId: 'loc-1',
              qtyOnHand: 200,
              qtyFull: 100,
              qtyEmpty: 100
            }),
            updatedAt: '2026-09-12T00:00:00.000Z'
          }
        ];
      }
      if (entity === 'desktop_transfer') {
        return [
          {
            entity: 'desktop_transfer',
            recordId: 'transfer-create-2',
            payload: JSON.stringify({
              id: 'transfer-create-2',
              sourceLocationId: 'loc-1',
              sourceLocationLabel: 'Store',
              destinationLocationId: 'loc-1',
              destinationLocationLabel: 'Store',
              shiftId: 'shift-1',
              transferMode: 'CREATE',
              lines: [{ productId: 'product-1', productName: 'Item A', qtyFull: 1, qtyEmpty: 1 }],
              movementStatus: 'confirmed',
              syncStatus: 'synced',
              createdAt: '2026-09-12T00:30:00.000Z',
              updatedAt: '2026-09-12T00:30:00.000Z'
            }),
            updatedAt: '2026-09-12T00:30:00.000Z'
          }
        ];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);

    const service = new DesktopStockProjectionService();
    const projected = await service.loadProjectedInventoryByProduct('loc-1');

    expect(projected.get('product-1')).toEqual({
      qtyOnHand: 200,
      qtyFull: 101,
      qtyEmpty: 99
    });
  });

  it('applies confirmed USED as full out and empty in when both buckets are entered', async () => {
    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'inventory_balance') {
        return [
          {
            entity: 'inventory_balance',
            recordId: 'loc-1:product-1',
            payload: JSON.stringify({
              productId: 'product-1',
              locationId: 'loc-1',
              qtyOnHand: 200,
              qtyFull: 100,
              qtyEmpty: 100
            }),
            updatedAt: '2026-09-12T00:00:00.000Z'
          }
        ];
      }
      if (entity === 'desktop_transfer') {
        return [
          {
            entity: 'desktop_transfer',
            recordId: 'transfer-used-2',
            payload: JSON.stringify({
              id: 'transfer-used-2',
              sourceLocationId: 'loc-1',
              sourceLocationLabel: 'Store',
              destinationLocationId: 'loc-1',
              destinationLocationLabel: 'Store',
              shiftId: 'shift-1',
              transferMode: 'USED',
              lines: [{ productId: 'product-1', productName: 'Item A', qtyFull: 1, qtyEmpty: 1 }],
              movementStatus: 'confirmed',
              syncStatus: 'synced',
              createdAt: '2026-09-12T00:30:00.000Z',
              updatedAt: '2026-09-12T00:30:00.000Z'
            }),
            updatedAt: '2026-09-12T00:30:00.000Z'
          }
        ];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);

    const service = new DesktopStockProjectionService();
    const projected = await service.loadProjectedInventoryByProduct('loc-1');

    expect(projected.get('product-1')).toEqual({
      qtyOnHand: 200,
      qtyFull: 99,
      qtyEmpty: 101
    });
  });

  it('does not double-count a synced restock-in transfer after branch data download', async () => {
    const syncedTransfer = {
      id: 'transfer-restock-in-1',
      sourceLocationId: 'loc-1',
      sourceLocationLabel: 'Supplier-1 (Supplier)',
      destinationLocationId: 'loc-1',
      destinationLocationLabel: 'Store',
      shiftId: 'shift-1',
      transferMode: 'SUPPLIER_RESTOCK_IN',
      supplierId: 'supplier-1',
      supplierName: 'Supplier-1',
      notes: null,
      lines: [{ productId: 'product-1', productName: 'Item A', qtyFull: 1, qtyEmpty: 1 }],
      movementStatus: 'confirmed',
      syncStatus: 'synced',
      lastError: null,
      receivedStatus: 'received',
      receivedAt: '2026-09-12T00:30:00.000Z',
      receivedBy: 'Cashier',
      receivedNotes: null,
      createdAt: '2026-09-12T00:30:00.000Z',
      updatedAt: '2026-09-12T00:30:00.000Z'
    };

    jest.spyOn(desktopDb, 'listMasterData').mockImplementation(async (entity?: string) => {
      if (entity === 'inventory_balance') {
        return [
          {
            entity: 'inventory_balance',
            recordId: 'loc-1:product-1',
            payload: JSON.stringify({
              productId: 'product-1',
              locationId: 'loc-1',
              qtyOnHand: 2,
              qtyFull: 1,
              qtyEmpty: 1
            }),
            updatedAt: '2026-09-12T01:00:00.000Z'
          }
        ];
      }
      if (entity === 'desktop_transfer') {
        return [
          {
            entity: 'desktop_transfer',
            recordId: syncedTransfer.id,
            payload: JSON.stringify(syncedTransfer),
            updatedAt: syncedTransfer.updatedAt
          }
        ];
      }
      if (entity === 'remote_transfer') {
        return [
          {
            entity: 'remote_transfer',
            recordId: syncedTransfer.id,
            payload: JSON.stringify(syncedTransfer),
            updatedAt: syncedTransfer.updatedAt
          }
        ];
      }
      return [];
    });
    jest.spyOn(desktopDb, 'listSales').mockResolvedValue([]);
    jest.spyOn(desktopDb, 'listOutboxItems').mockResolvedValue([]);

    const service = new DesktopStockProjectionService();
    const projected = await service.loadProjectedInventoryByProduct('loc-1');

    expect(projected.get('product-1')).toEqual({
      qtyOnHand: 2,
      qtyFull: 1,
      qtyEmpty: 1
    });
  });
});
