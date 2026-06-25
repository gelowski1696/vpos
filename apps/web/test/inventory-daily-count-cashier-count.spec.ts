import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InventoryShiftItemBreakdown } from '../src/app/(admin)/inventory-daily-count/inventory-shift-item-breakdown';

describe('inventory daily count cashier comparison', () => {
  it('renders the item breakdown with system and cashier count labels', () => {
    expect(InventoryShiftItemBreakdown).toBeDefined();

    const markup = renderToStaticMarkup(
      createElement(InventoryShiftItemBreakdown, {
        row: {
          id: 'shift-1',
          shift_id: 'shift-1',
          branch_id: 'branch-1',
          branch_name: 'Main Branch',
          branch_code: 'BR-1',
          location_id: 'loc-1',
          location_name: 'Front Store',
          location_code: 'LOC-1',
          cashier_name: 'Cashier One',
          status: 'CLOSED',
          opened_at: '2026-06-23T08:00:00.000Z',
          closed_at: '2026-06-23T17:00:00.000Z',
          opening_snapshot_summary: {
            item_count: 1,
            qty_on_hand: 10,
            qty_full: 0,
            qty_empty: 0,
            captured_at: '2026-06-23T08:01:00.000Z',
            location_id: 'loc-1',
            location_code: 'LOC-1',
            location_name: 'Front Store'
          },
          closing_snapshot_summary: {
            item_count: 1,
            qty_on_hand: 7,
            qty_full: 0,
            qty_empty: 0,
            captured_at: '2026-06-23T17:01:00.000Z',
            location_id: 'loc-1',
            location_code: 'LOC-1',
            location_name: 'Front Store'
          },
          inventory_report: {
            opening_snapshot: null,
            closing_snapshot: {
              item_count: 1,
              qty_on_hand: 7,
              qty_full: 0,
              qty_empty: 0,
              captured_at: '2026-06-23T17:01:00.000Z',
              location_id: 'loc-1',
              location_code: 'LOC-1',
              location_name: 'Front Store'
            },
            has_opening_snapshot: true,
            rows: [
              {
                product_id: 'prod-1',
                sku: 'SKU-1',
                product_name: 'Water Gallon',
                category: 'Retail',
                unit: 'piece',
                is_lpg: false,
                system_qty_on_hand: 10,
                cashier_qty_on_hand: 7,
                start_qty_on_hand: 10,
                end_qty_on_hand: 7,
                delta_qty_on_hand: -3,
                system_qty_full: 0,
                cashier_qty_full: 0,
                start_qty_full: 0,
                end_qty_full: 0,
                delta_qty_full: 0,
                system_qty_empty: 0,
                cashier_qty_empty: 0,
                start_qty_empty: 0,
                end_qty_empty: 0,
                delta_qty_empty: 0,
                changed: true
              }
            ],
            totals: {
              item_count: 1,
              changed_count: 1,
              start_qty_on_hand: 10,
              end_qty_on_hand: 7,
              delta_qty_on_hand: -3,
              start_qty_full: 0,
              end_qty_full: 0,
              delta_qty_full: 0,
              start_qty_empty: 0,
              end_qty_empty: 0,
              delta_qty_empty: 0
            }
          },
          snapshot_state: 'complete',
          snapshot_warning: null
        }
      })
    );

    expect(markup).toContain('System Count');
    expect(markup).toContain('Cashier Input');
    expect(markup).toContain('Water Gallon');
  });
});
