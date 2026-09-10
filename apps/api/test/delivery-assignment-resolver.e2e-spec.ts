import { BadRequestException } from '@nestjs/common';
import { DeliveryService } from '../src/modules/delivery/delivery.service';

describe('delivery assignment resolver', () => {
  function resolveUserId(service: DeliveryService) {
    return (service as unknown as {
      resolveUserId: (
        db: {
          personnel: { findFirst: jest.Mock };
          user: { findFirst: jest.Mock; create?: jest.Mock; update?: jest.Mock };
        },
        companyId: string,
        userRef: string
      ) => Promise<string>;
    }).resolveUserId.bind(service);
  }

  it('resolves a personnel code to the active rider user assigned to that personnel', async () => {
    const service = new DeliveryService();
    const db = {
      personnel: {
        findFirst: jest.fn(async () => ({ id: 'personnel-driver-1' }))
      },
      user: {
        findFirst: jest.fn(async () => ({ id: 'user-rider-1' }))
      }
    };

    await expect(resolveUserId(service)(db, 'company-1', 'EMP2')).resolves.toBe('user-rider-1');
    expect(db.personnel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          OR: expect.arrayContaining([
            { id: 'EMP2' },
            { code: { equals: 'EMP2', mode: 'insensitive' } }
          ])
        })
      })
    );
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: 'company-1',
          OR: expect.arrayContaining([
            { personnelId: 'personnel-driver-1' },
            { personnelId: 'EMP2' }
          ])
        })
      })
    );
  });

  it('creates an assignment-only user when sync references an active personnel without a rider login', async () => {
    const service = new DeliveryService();
    const db = {
      personnel: {
        findFirst: jest.fn(async () => ({
          id: 'personnel-driver-1',
          branchId: 'branch-1',
          code: 'PDR1',
          fullName: 'Driver One',
          email: null
        }))
      },
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn(async () => ({ id: 'assignment-user-1' })),
        update: jest.fn()
      }
    };

    await expect(resolveUserId(service)(db, 'company-1', 'personnel-driver-1')).resolves.toBe(
      'assignment-user-1'
    );
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: 'company-1',
          branchId: 'branch-1',
          personnelId: 'personnel-driver-1',
          username: null,
          email: 'delivery-assignment+personnel-driver-1@vpos.local',
          fullName: 'Driver One',
          mustChangePassword: true,
          isActive: true
        }),
        select: { id: true }
      })
    );
  });

  it('does not fall back to the first active user when assignment reference is unknown', async () => {
    const service = new DeliveryService();
    const db = {
      personnel: {
        findFirst: jest.fn(async () => null)
      },
      user: {
        findFirst: jest.fn(async () => null)
      }
    };

    await expect(resolveUserId(service)(db, 'company-1', 'missing-rider')).rejects.toThrow(
      BadRequestException
    );
    expect(db.user.findFirst).toHaveBeenCalledTimes(1);
    expect(db.user.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'company-1', isActive: true },
        orderBy: { createdAt: 'asc' }
      })
    );
  });

  it('does not hide rider-assigned deliveries because of rider branch mismatch', () => {
    const service = new DeliveryService();
    const where = (service as unknown as {
      buildDatabaseListWhere: (
        companyId: string,
        filters: { order_type?: 'DELIVERY'; branch_id?: string },
        riderScope: { userId: string; branchId: string | null }
      ) => Record<string, unknown>;
    }).buildDatabaseListWhere(
      'company-1',
      { order_type: 'DELIVERY' },
      { userId: 'user-rider-1', branchId: 'branch-from-rider-profile' }
    );

    expect(where).toEqual({
      companyId: 'company-1',
      AND: [
        { assignments: { some: {} } },
        { assignments: { some: { userId: 'user-rider-1' } } }
      ]
    });
  });
});
