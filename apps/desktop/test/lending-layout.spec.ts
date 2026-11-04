import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  LendingManagementOverview,
  LendingRecordRow,
  LendingDetailModalContent
} from '../src/screens/LendingScreen';

describe('LendingManagementOverview', () => {
  it('renders the compact management shell with lending metrics only', () => {
    const markup = renderToStaticMarkup(
      React.createElement(LendingManagementOverview, {
        title: 'Lending Management',
        subtitle: 'Track active lends, partial returns, overdue records, and queued return activity.',
        metrics: [
          { key: 'open', label: 'Open', value: '8', icon: 'open', tone: 'good' },
          { key: 'partial', label: 'Partial Return', value: '3', icon: 'partial', tone: 'accent' },
          { key: 'overdue', label: 'Overdue', value: '2', icon: 'overdue', tone: 'warn' },
          { key: 'queued', label: 'Queued Returns', value: '4', icon: 'queued', tone: 'neutral' }
        ],
        onRefresh: () => undefined,
        refreshDisabled: false
      })
    );

    expect(markup).toContain('Lending Management');
    expect(markup).toContain('Track active lends');
    expect(markup).not.toContain('Current lending scope');
    expect(markup).toContain('Refresh');
    expect(markup).toContain('lending-management-overview');
  });
});

describe('LendingRecordRow', () => {
  it('renders a compact lending record row with receipt, customer, quantities, and status', () => {
    const markup = renderToStaticMarkup(
      React.createElement(LendingRecordRow, {
        receiptLabel: '#20260604-0000001',
        customerLabel: 'Albert',
        itemSummary: 'ITEM-A | Item A | 11 kg',
        qtyLentLabel: 'Qty Lent: 10',
        returnedLabel: 'Returned: 4',
        openLabel: 'Open: 6',
        openedDateLabel: '6/4/2026',
        openedTimeLabel: '10:30:00 AM',
        noteLabel: 'No note',
        statusBadgeLabel: 'PARTIAL',
        statusTone: 'partial',
        selected: true,
        onClick: () => undefined
      })
    );

    expect(markup).toContain('#20260604-0000001');
    expect(markup).toContain('Albert');
    expect(markup).toContain('ITEM-A | Item A | 11 kg');
    expect(markup).toContain('Qty Lent');
    expect(markup).toContain('Returned');
    expect(markup).toContain('Open');
    expect(markup).toContain('lending-record-row-chip-value">10');
    expect(markup).toContain('lending-record-row-chip-value">4');
    expect(markup).toContain('lending-record-row-chip-value">6');
    expect(markup).toContain('PARTIAL');
    expect(markup).toContain('6/4/2026');
    expect(markup).toContain('10:30:00 AM');
    expect(markup).toContain('No note');
    expect(markup).toContain('lending-record-row');
    expect(markup).not.toContain('Lending detail');
  });
});

describe('LendingDetailModalContent', () => {
  it('renders the refreshed lending detail modal sections and line summary', () => {
    const markup = renderToStaticMarkup(
      React.createElement(LendingDetailModalContent, {
        record: {
          lending_id: 'lend-1',
          sale_id: 'sale-1',
          customer_id: 'cust-1',
          customer_name: 'Albert',
          status: 'OPEN',
          total_quantity_lent: 1,
          total_quantity_returned: 0,
          opened_at: '2026-06-05T04:40:08.000Z',
          due_at: null,
          remarks: '',
          branch_id: 'branch-1',
          location_id: 'location-1',
          created_at: '2026-06-05T04:40:08.000Z',
          updated_at: '2026-06-05T04:40:08.000Z'
        },
        receiptLabel: '20260605-0000002',
        customerLabel: 'Albert',
        itemSummary: 'Item A | A | 5 kg',
        detail: {
          lending_id: 'lend-1',
          sale_id: 'sale-1',
          customer_id: 'cust-1',
          customer_name: 'Albert',
          status: 'OPEN',
          total_quantity_lent: 1,
          total_quantity_returned: 0,
          opened_at: '2026-06-05T04:40:08.000Z',
          due_at: null,
          remarks: '',
          branch_id: 'branch-1',
          location_id: 'location-1',
          created_at: '2026-06-05T04:40:08.000Z',
          updated_at: '2026-06-05T04:40:08.000Z',
          deposit_payment: null,
          lines: [
            {
              lending_line_id: 'line-1',
              product_id: 'prod-1',
              product_name: 'Item A',
              product_sku: 'A',
              quantity_lent: 1,
              quantity_returned: 0,
              quantity_open: 1,
              deposit_amount: 0
            }
          ],
          returns: []
        },
        depositPayment: {
          amount: 0,
          method: null,
          postedAt: '2026-06-05T04:40:08.000Z',
          notes: null
        },
        loadingDetail: false,
        onClose: () => undefined,
        onOpenReturn: () => undefined,
        returnDisabled: false
      })
    );

    expect(markup).toContain('Receipt #20260605-0000002');
    expect(markup).toContain('Record Return');
    expect(markup).toContain('Lending Context');
    expect(markup).toContain('Deposit Payment');
    expect(markup).toContain('Lent Items');
    expect(markup).toContain('Return History');
    expect(markup).toContain('No deposit payment has been recorded for this lending yet.');
    expect(markup).toContain('Qty Lent: 1 | Returned: 0 | Open: 1');
    expect(markup).toContain('lending-detail-metric-grid');
  });
});
