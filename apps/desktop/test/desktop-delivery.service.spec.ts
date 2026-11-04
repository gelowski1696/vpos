import { desktopDb } from '../src/db/sqlite';
import { DesktopDeliveryService } from '../src/services/desktop-delivery.service';

describe('DesktopDeliveryService parity', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('queues pickup or delivery orders with mobile-aligned personnel roles', async () => {
    const service = new DesktopDeliveryService();
    const upsertSpy = jest.spyOn(desktopDb, 'upsertMasterDataRows').mockResolvedValue(undefined);
    const enqueueSpy = jest.spyOn(desktopDb, 'enqueueOutboxItem').mockResolvedValue({
      id: 'outbox-1',
      entity: 'delivery_order',
      action: 'create',
      payload: {},
      idempotency_key: 'idem-1',
      created_at: '2026-05-21T00:00:00.000Z',
      updated_at: '2026-05-21T00:00:00.000Z',
      status: 'pending',
      retry_count: 0,
      last_error: null
    });

    const record = await service.createDeliveryOrder({
      branchId: 'branch-1',
      sourceLocationId: 'loc-1',
      customerId: 'cust-1',
      customerName: 'Customer One',
      saleId: 'sale-1',
      orderType: 'PICKUP',
      personnel: [
        { userId: 'user-loader', role: 'LOADER', name: 'Loader One' },
        { userId: 'user-other', role: 'OTHER', name: 'Other One' }
      ],
      notes: 'Pickup counter'
    });

    expect(record.orderType).toBe('PICKUP');
    expect(record.personnel.map((entry) => entry.role)).toEqual(['LOADER', 'OTHER']);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    const queued = enqueueSpy.mock.calls[0][0];
    expect(queued.entity).toBe('delivery_order');
    expect(queued.action).toBe('create');
    expect(queued.payload).toMatchObject({
      branch_id: 'branch-1',
      source_location_id: 'loc-1',
      customer_id: 'cust-1',
      sale_id: 'sale-1',
      order_type: 'PICKUP',
      status: 'created',
      personnel: [
        { userId: 'user-loader', role: 'LOADER', name: 'Loader One' },
        { userId: 'user-other', role: 'OTHER', name: 'Other One' }
      ],
      notes: 'Pickup counter'
    });
  });

  it('stores an optional note when advancing a dispatch status', async () => {
    const service = new DesktopDeliveryService();
    jest.spyOn(service, 'listDispatchStatuses').mockResolvedValue({});
    const upsertSpy = jest.spyOn(desktopDb, 'upsertMasterDataRows').mockResolvedValue(undefined);
    const enqueueSpy = jest.spyOn(desktopDb, 'enqueueOutboxItem').mockResolvedValue({
      id: 'outbox-2',
      entity: 'sale_dispatch_status',
      action: 'update',
      payload: {},
      idempotency_key: 'idem-2',
      created_at: '2026-05-21T00:00:00.000Z',
      updated_at: '2026-05-21T00:00:00.000Z',
      status: 'pending',
      retry_count: 0,
      last_error: null
    });

    const record = await (service as any).updateDispatchStatus('sale-1', 'TRANSIT', 'Left at gate');

    expect(record.saleId).toBe('sale-1');
    expect(record.status).toBe('TRANSIT');
    expect(record.notes).toBe('Left at gate');
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    const queued = enqueueSpy.mock.calls[0][0];
    expect(queued.entity).toBe('sale_dispatch_status');
    expect(queued.action).toBe('update');
    expect(queued.payload).toMatchObject({
      sale_id: 'sale-1',
      status: 'TRANSIT',
      notes: 'Left at gate'
    });
  });

  it('keeps a dispatch status history when advancing the same sale again', async () => {
    const service = new DesktopDeliveryService();
    jest.spyOn(service, 'listDispatchStatuses').mockResolvedValue({
      'sale-1': {
        saleId: 'sale-1',
        status: 'TRANSIT',
        notes: 'Loaded on the truck',
        syncStatus: 'pending',
        lastError: null,
        updatedAt: '2026-05-21T09:00:00.000Z',
        history: [
          {
            status: 'TRANSIT',
            notes: 'Loaded on the truck',
            updatedAt: '2026-05-21T09:00:00.000Z'
          }
        ]
      }
    });
    const upsertSpy = jest.spyOn(desktopDb, 'upsertMasterDataRows').mockResolvedValue(undefined);
    const enqueueSpy = jest.spyOn(desktopDb, 'enqueueOutboxItem').mockResolvedValue({
      id: 'outbox-3',
      entity: 'sale_dispatch_status',
      action: 'update',
      payload: {},
      idempotency_key: 'idem-3',
      created_at: '2026-05-21T00:00:00.000Z',
      updated_at: '2026-05-21T00:00:00.000Z',
      status: 'pending',
      retry_count: 0,
      last_error: null
    });

    const record = await service.updateDispatchStatus('sale-1', 'DELIVERED', 'Dropped at gate');

    expect(record.history).toHaveLength(2);
    expect(record.history?.[0]).toMatchObject({
      status: 'TRANSIT',
      notes: 'Loaded on the truck'
    });
    expect(record.history?.[1]).toMatchObject({
      status: 'DELIVERED',
      notes: 'Dropped at gate'
    });
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });
});
