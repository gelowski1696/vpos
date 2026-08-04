import { NotFoundException } from '@nestjs/common';
import { SyncService } from '../src/modules/sync/sync.service';
import type { DeliveryOrderRecord } from '../src/modules/delivery/delivery.service';

function deliveryOrder(overrides: Partial<DeliveryOrderRecord> = {}): DeliveryOrderRecord {
  return {
    id: 'delivery-local-1',
    order_type: 'DELIVERY',
    status: 'CREATED',
    sale_id: 'sale-1',
    customer_id: 'customer-1',
    personnel: [{ user_id: 'personnel-driver-1', role: 'DRIVER' }],
    created_at: '2026-08-04T08:00:00.000Z',
    updated_at: '2026-08-04T08:00:00.000Z',
    ...overrides
  };
}

function serviceWithDelivery(
  deliveryService: Record<string, unknown>,
  entitlementsService?: Record<string, unknown>
): SyncService {
  return new SyncService(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    entitlementsService as never,
    deliveryService as never
  );
}

describe('SyncService delivery dispatch posting', () => {
  it('creates a synced delivery order and assigns the rider personnel', async () => {
    const created = deliveryOrder({ status: 'CREATED' });
    const assigned = deliveryOrder({ status: 'ASSIGNED' });
    const deliveryService = {
      get: jest.fn(async () => {
        throw new NotFoundException('Delivery order not found');
      }),
      list: jest.fn(),
      create: jest.fn(async () => created),
      assign: jest.fn(async () => assigned),
      updateStatus: jest.fn()
    };
    const service = serviceWithDelivery(deliveryService);

    const result = await service.push(
      'company-1',
      {
        device_id: 'desktop-1',
        outbox_items: [
          {
            id: 'out-delivery-create',
            entity: 'delivery_order',
            action: 'create',
            payload: {
              id: 'delivery-local-1',
              order_type: 'DELIVERY',
              status: 'created',
              sale_id: 'sale-1',
              customer_id: 'customer-1',
              personnel: [{ userId: 'personnel-driver-1', role: 'DRIVER' }]
            },
            idempotency_key: 'idem-delivery-create',
            created_at: '2026-08-04T08:00:00.000Z'
          }
        ]
      },
      'cashier-1'
    );

    expect(result).toEqual({ accepted: ['out-delivery-create'], rejected: [] });
    expect(deliveryService.create).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        id: 'delivery-local-1',
        order_type: 'DELIVERY',
        sale_id: 'sale-1',
        customer_id: 'customer-1',
        personnel: [{ user_id: 'personnel-driver-1', role: 'DRIVER' }]
      })
    );
    expect(deliveryService.assign).toHaveBeenCalledWith(
      'company-1',
      'delivery-local-1',
      expect.objectContaining({
        personnel: [{ user_id: 'personnel-driver-1', role: 'DRIVER' }],
        actor_user_id: 'cashier-1'
      })
    );
    expect(deliveryService.updateStatus).not.toHaveBeenCalled();
  });

  it('applies a POS TRANSIT dispatch status to the server delivery order', async () => {
    const inTransit = deliveryOrder({ status: 'OUT_FOR_DELIVERY' });
    const deliveryService = {
      get: jest.fn(),
      list: jest.fn(async () => [deliveryOrder({ status: 'ASSIGNED' })]),
      create: jest.fn(),
      assign: jest.fn(),
      updateStatus: jest.fn(async () => inTransit)
    };
    const service = serviceWithDelivery(deliveryService);

    const result = await service.push(
      'company-1',
      {
        device_id: 'desktop-1',
        outbox_items: [
          {
            id: 'out-dispatch-transit',
            entity: 'sale_dispatch_status',
            action: 'update',
            payload: {
              sale_id: 'sale-1',
              status: 'TRANSIT',
              updated_at: '2026-08-04T08:05:00.000Z'
            },
            idempotency_key: 'desktop-dispatch-status:sale-1',
            created_at: '2026-08-04T08:05:00.000Z'
          }
        ]
      },
      'cashier-1'
    );

    expect(result).toEqual({ accepted: ['out-dispatch-transit'], rejected: [] });
    expect(deliveryService.list).toHaveBeenCalledWith('company-1', { sale_id: 'sale-1', limit: 1 });
    expect(deliveryService.updateStatus).toHaveBeenCalledWith(
      'company-1',
      'delivery-local-1',
      expect.objectContaining({
        status: 'OUT_FOR_DELIVERY',
        actor_user_id: 'cashier-1'
      })
    );
  });

  it('derives unique persisted idempotency keys for each dispatch status step', () => {
    const service = serviceWithDelivery({});
    const resolveKey = (service as unknown as {
      resolveOutboxIdempotencyKey: (item: {
        id: string;
        entity: string;
        action: string;
        payload: Record<string, unknown>;
        idempotency_key: string;
        created_at: string;
      }) => string;
    }).resolveOutboxIdempotencyKey.bind(service);

    const pendingKey = resolveKey({
      id: 'out-dispatch-pending',
      entity: 'sale_dispatch_status',
      action: 'update',
      payload: {
        sale_id: 'sale-1',
        status: 'PENDING',
        updated_at: '2026-08-04T08:00:00.000Z'
      },
      idempotency_key: 'desktop-dispatch-status:sale-1',
      created_at: '2026-08-04T08:00:00.000Z'
    });
    const transitKey = resolveKey({
      id: 'out-dispatch-transit',
      entity: 'sale_dispatch_status',
      action: 'update',
      payload: {
        sale_id: 'sale-1',
        status: 'TRANSIT',
        updated_at: '2026-08-04T08:05:00.000Z'
      },
      idempotency_key: 'desktop-dispatch-status:sale-1',
      created_at: '2026-08-04T08:05:00.000Z'
    });

    expect(pendingKey).not.toBe(transitKey);
    expect(transitKey).toBe('desktop-dispatch-status:sale-1:sale-1:TRANSIT:2026-08-04T08:05:00.000Z');
  });

  it('keeps accepting offline delivery sync rows when the dispatch add-on is disabled', async () => {
    const deliveryService = {
      create: jest.fn(),
      assign: jest.fn(),
      updateStatus: jest.fn()
    };
    const entitlementsService = {
      enforceTenantAddonEnabled: jest.fn(async () => {
        throw new Error('Delivery Dispatch Suite add-on is not enabled');
      })
    };
    const service = serviceWithDelivery(deliveryService, entitlementsService);

    const result = await service.push('company-1', {
      device_id: 'desktop-1',
      outbox_items: [
        {
          id: 'out-delivery-create',
          entity: 'delivery_order',
          action: 'create',
          payload: {
            id: 'delivery-local-1',
            order_type: 'DELIVERY',
            status: 'created',
            personnel: [{ userId: 'personnel-driver-1', role: 'DRIVER' }]
          },
          idempotency_key: 'idem-delivery-create',
          created_at: '2026-08-04T08:00:00.000Z'
        }
      ]
    });

    expect(result).toEqual({ accepted: ['out-delivery-create'], rejected: [] });
    expect(deliveryService.create).not.toHaveBeenCalled();
  });
});
