import {
  buildAfterShiftInventorySyncNotification,
  resolveInventoryCountDiscrepancyStatus
} from '../src/lib/inventory-sync-notification';

describe('after-shift inventory sync notification', () => {
  it('builds a direct inventory report link for committed shift count syncs', () => {
    const notification = buildAfterShiftInventorySyncNotification({
      id: 'audit-1',
      created_at: '2026-06-23T09:05:00.000Z',
      action: 'SHIFT_CLOSE',
      entity: 'Shift',
      entity_id: 'shift-1',
      user_name: 'Cashier One',
      metadata: {
        closed_at: '2026-06-23T09:04:00.000Z',
        inventory_count_committed: true,
        inventory_count_line_count: 7,
        inventory_count_location_id: 'loc-1',
        inventory_report_date: '2026-06-23'
      }
    });

    expect(notification).toEqual(
      expect.objectContaining({
        id: 'audit-1',
        shiftId: 'shift-1',
        reportDate: '2026-06-23',
        href: '/inventory-daily-count?date=2026-06-23&shift_id=shift-1',
        cashierName: 'Cashier One',
        lineCount: 7,
        locationId: 'loc-1'
      })
    );
  });

  it('ignores ordinary shift close rows without an inventory count commit marker', () => {
    expect(
      buildAfterShiftInventorySyncNotification({
        id: 'audit-2',
        created_at: '2026-06-23T09:05:00.000Z',
        action: 'SHIFT_CLOSE',
        entity: 'Shift',
        entity_id: 'shift-1',
        metadata: {}
      })
    ).toBeNull();
  });

  it('marks inventory count notifications as mismatched when system and user input counts differ', () => {
    expect(
      resolveInventoryCountDiscrepancyStatus({
        inventory_report: {
          rows: [
            {
              is_lpg: false,
              system_qty_on_hand: 10,
              cashier_qty_on_hand: 7
            }
          ]
        }
      })
    ).toBe('mismatch');
  });

  it('marks inventory count notifications as matched when system and user input counts are equal', () => {
    expect(
      resolveInventoryCountDiscrepancyStatus({
        inventory_report: {
          rows: [
            {
              is_lpg: false,
              system_qty_on_hand: 10,
              cashier_qty_on_hand: 10
            },
            {
              is_lpg: true,
              system_qty_full: 4,
              cashier_qty_full: 4,
              system_qty_empty: 2,
              cashier_qty_empty: 2
            }
          ]
        }
      })
    ).toBe('match');
  });

  it('detects LPG full or empty count discrepancies', () => {
    expect(
      resolveInventoryCountDiscrepancyStatus({
        inventory_report: {
          rows: [
            {
              is_lpg: true,
              system_qty_full: 4,
              cashier_qty_full: 4,
              system_qty_empty: 2,
              cashier_qty_empty: 1
            }
          ]
        }
      })
    ).toBe('mismatch');
  });
});
