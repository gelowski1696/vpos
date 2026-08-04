import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DeliveryService } from '../src/modules/delivery/delivery.service';

describe('delivery location pings', () => {
  let service: DeliveryService;

  beforeEach(() => {
    service = new DeliveryService();
  });

  it('records a GPS ping for an assigned rider in memory mode', async () => {
    const order = await service.create(
      'comp-demo',
      {
        order_type: 'DELIVERY',
        personnel: [{ user_id: 'user-rider-1', role: 'DRIVER' }]
      },
      { user_id: 'admin-1', roles: ['admin'] }
    );

    const ping = await service.recordLocationPing(
      'comp-demo',
      order.id,
      {
        latitude: 14.5995,
        longitude: 120.9842,
        accuracy: 10,
        recorded_at: '2026-08-04T10:00:00.000Z'
      },
      { user_id: 'user-rider-1', roles: ['rider'] }
    );

    expect(ping).toMatchObject({
      delivery_order_id: order.id,
      rider_user_id: 'user-rider-1',
      latitude: 14.5995,
      longitude: 120.9842
    });
  });

  it('rejects invalid coordinates and unassigned riders', async () => {
    const order = await service.create(
      'comp-demo',
      {
        order_type: 'DELIVERY',
        personnel: [{ user_id: 'user-rider-1', role: 'DRIVER' }]
      },
      { user_id: 'admin-1', roles: ['admin'] }
    );

    await expect(
      service.recordLocationPing(
        'comp-demo',
        order.id,
        { latitude: 190, longitude: 120.9842 },
        { user_id: 'user-rider-1', roles: ['rider'] }
      )
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.recordLocationPing(
        'comp-demo',
        order.id,
        { latitude: 14.5995, longitude: 120.9842 },
        { user_id: 'other-rider', roles: ['rider'] }
      )
    ).rejects.toThrow(ForbiddenException);
  });
});
