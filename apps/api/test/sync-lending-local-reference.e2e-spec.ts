import { NotFoundException } from '@nestjs/common';
import { SyncService } from '../src/modules/sync/sync.service';
import type { LendingDetailRecord } from '../src/modules/lending/lending.service';

function lendingDetail(overrides: Partial<LendingDetailRecord> = {}): LendingDetailRecord {
  const now = '2026-09-09T02:59:00.000Z';
  return {
    lending_id: 'server-lending-1',
    company_id: 'company-1',
    branch_id: 'branch-1',
    branch_name: 'Main',
    location_id: 'loc-1',
    location_name: 'Store',
    customer_id: 'customer-1',
    customer_code: null,
    customer_name: 'Customer One',
    sale_id: 'sale-1',
    status: 'OPEN',
    due_at: null,
    remarks: null,
    settlement_type: 'NONE',
    settlement_amount: null,
    created_by_user_id: null,
    created_by_name: null,
    approved_by_user_id: null,
    approved_by_name: null,
    opened_at: now,
    closed_at: null,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
    line_count: 1,
    total_quantity_lent: 1,
    total_quantity_returned: 0,
    lines: [
      {
        lending_line_id: 'server-lending-line-1',
        source_sale_line_id: 'server-sale-line-1',
        product_id: 'prod-1',
        product_sku: 'SKU-1',
        product_name: 'LPG 11kg',
        quantity_lent: 1,
        quantity_returned: 0,
        quantity_open: 1,
        deposit_amount: null,
        remarks: null,
        created_at: now,
        updated_at: now
      }
    ],
    returns: [],
    deposit_payment: null,
    ...overrides
  };
}

function serviceWithLending(lendingService: Record<string, unknown>): SyncService {
  return new SyncService(
    undefined,
    undefined,
    undefined,
    lendingService as never
  );
}

describe('SyncService lending local reference repair', () => {
  it('drops local cart-line ids and keeps the sale line index when posting lending', async () => {
    const lendingService = {
      create: jest.fn(async () => lendingDetail()),
      getDetail: jest.fn(),
      list: jest.fn(),
      returnLending: jest.fn()
    };
    const service = serviceWithLending(lendingService);

    const result = await service.push('company-1', {
      device_id: 'desktop-1',
      outbox_items: [
        {
          id: 'outbox-lending-local',
          entity: 'lending',
          action: 'create',
          payload: {
            id: 'desktop-lending-1',
            lending_id: 'desktop-lending-1',
            sale_id: 'sale-1',
            lines: [
              {
                product_id: 'prod-1',
                source_sale_line_id: 'cart-line-1788921877922-993352',
                source_sale_line_index: 0,
                quantity: 1
              }
            ]
          },
          idempotency_key: 'desktop-lending:desktop-lending-1',
          created_at: '2026-09-09T02:59:25.000Z'
        }
      ]
    });

    expect(result).toEqual({ accepted: ['outbox-lending-local'], rejected: [] });
    expect(lendingService.create).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        sale_id: 'sale-1',
        lines: [
          expect.objectContaining({
            product_id: 'prod-1',
            source_sale_line_id: null,
            source_sale_line_index: 0,
            quantity: 1
          })
        ]
      }),
      undefined
    );
  });

  it('resolves a lending return by sale id after the local lending id is no longer known', async () => {
    const detail = lendingDetail();
    const returned = lendingDetail({
      status: 'CLOSED',
      total_quantity_returned: 1,
      lines: [{ ...detail.lines[0]!, quantity_returned: 1, quantity_open: 0 }]
    });
    const lendingService = {
      create: jest.fn(),
      getDetail: jest.fn(async (_companyId: string, lendingId: string) => {
        if (lendingId === 'desktop-lending-1') {
          throw new NotFoundException('Lending record not found');
        }
        return detail;
      }),
      list: jest.fn(async () => [detail]),
      returnLending: jest.fn(async () => returned)
    };
    const service = serviceWithLending(lendingService);

    const result = await service.push('company-1', {
      device_id: 'desktop-1',
      outbox_items: [
        {
          id: 'outbox-lending-return-local',
          entity: 'lending_return',
          action: 'create',
          payload: {
            id: 'desktop-lending-return-1',
            lending_id: 'desktop-lending-1',
            sale_id: 'sale-1',
            lines: [
              {
                product_id: 'prod-1',
                returned_qty: 1,
                condition: 'GOOD'
              }
            ]
          },
          idempotency_key: 'desktop-lending-return:desktop-lending-return-1',
          created_at: '2026-09-09T02:59:25.000Z'
        }
      ]
    });

    expect(result).toEqual({ accepted: ['outbox-lending-return-local'], rejected: [] });
    expect(lendingService.list).toHaveBeenCalledWith('company-1', { sale_id: 'sale-1', limit: 10 });
    expect(lendingService.returnLending).toHaveBeenCalledWith(
      'company-1',
      'server-lending-1',
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            lending_line_id: 'server-lending-line-1',
            returned_qty: 1
          })
        ]
      }),
      undefined
    );
  });
});
