import {
  deriveDesktopLendingSyncState,
  desktopLendingEffectiveStatus,
  desktopLendingOpenQuantity,
  filterDesktopLendingRecords,
  paginateDesktopLendingRecords,
  summarizeDesktopLendingRecords,
  type DesktopLendingRecord
} from '@vpos/desktop-core';
import type { OutboxItem } from '@vpos/shared-types';

function lending(id: string, overrides: Partial<DesktopLendingRecord> = {}): DesktopLendingRecord {
  return {
    lending_id: id, company_id: 'company-1', branch_id: 'branch-1', branch_name: 'Branch',
    location_id: 'location-1', location_name: 'Store', customer_id: `customer-${id}`,
    customer_code: id.toUpperCase(), customer_name: `Customer ${id}`, sale_id: `sale-${id}`,
    status: 'OPEN', due_at: null, remarks: null, settlement_type: 'NONE', settlement_amount: null,
    created_by_user_id: 'user-1', created_by_name: 'Cashier', approved_by_user_id: null,
    approved_by_name: null, opened_at: '2026-10-08T09:00:00.000Z', closed_at: null,
    cancelled_at: null, created_at: '2026-10-08T09:00:00.000Z', updated_at: '2026-10-08T09:00:00.000Z',
    line_count: 1, total_quantity_lent: 4, total_quantity_returned: 0,
    ...overrides
  };
}

function outbox(status: OutboxItem['status']): OutboxItem {
  return {
    id: `outbox-${status}`, entity: 'lending_return', action: 'create', payload: { lending_id: 'lend-1' },
    idempotency_key: `idem-${status}`, created_at: '2026-10-09T00:00:00.000Z',
    updated_at: '2026-10-09T00:00:00.000Z', status, retry_count: 0, last_error: null
  };
}

describe('desktop lending projection', () => {
  const now = new Date('2026-10-09T12:00:00.000Z');
  const rows = [
    lending('open', { opened_at: '2026-10-09T08:00:00.000Z' }),
    lending('partial', { customer_name: 'Ana Partial', status: 'PARTIALLY_RETURNED', total_quantity_returned: 2 }),
    lending('overdue', { due_at: '2026-10-01T00:00:00.000Z' }),
    lending('closed', { status: 'CLOSED', total_quantity_returned: 4, closed_at: '2026-10-08T10:00:00.000Z' })
  ];

  it('derives status/open quantity and summarizes the directory', () => {
    expect(desktopLendingOpenQuantity(rows[1])).toBe(2);
    expect(desktopLendingEffectiveStatus(rows[2], now)).toBe('OVERDUE');
    expect(summarizeDesktopLendingRecords(rows, now)).toEqual({
      total: 4, open: 1, partial: 1, overdue: 1, closed: 1, openQuantity: 10
    });
  });

  it('filters by status/date/customer/search, sorts, and paginates', () => {
    expect(filterDesktopLendingRecords(rows, {
      search: 'rcpt-overdue', status: 'OVERDUE', date: 'ALL', customerId: 'ALL', sort: 'OPENED_DESC',
      receiptBySaleId: { 'sale-overdue': 'RCPT-OVERDUE' }, now
    }).map((row) => row.lending_id)).toEqual(['overdue']);
    expect(filterDesktopLendingRecords(rows, {
      search: '', status: 'ALL', date: 'TODAY', customerId: 'customer-open', sort: 'CUSTOMER_ASC', now
    }).map((row) => row.lending_id)).toEqual(['open']);
    const sorted = filterDesktopLendingRecords(rows, {
      search: '', status: 'ALL', date: 'ALL', customerId: 'ALL', sort: 'OPEN_DESC', now
    });
    expect(sorted[0].lending_id).toBe('open');
    expect(paginateDesktopLendingRecords(sorted, 2, 3)).toMatchObject({ page: 2, totalPages: 2, records: [{ lending_id: 'closed' }] });
  });

  it('shows failed work ahead of pending and otherwise treats the record as synced', () => {
    expect(deriveDesktopLendingSyncState('lend-1', [outbox('pending')])).toBe('PENDING');
    expect(deriveDesktopLendingSyncState('lend-1', [outbox('pending'), outbox('failed')])).toBe('FAILED');
    expect(deriveDesktopLendingSyncState('lend-2', [outbox('failed')])).toBe('SYNCED');
  });
});
