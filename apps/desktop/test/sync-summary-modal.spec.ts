import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SyncSummaryModal } from '../src/components/feedback/SyncSummaryModal';

describe('SyncSummaryModal', () => {
  it('renders synced and unsynced totals grouped by record type', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SyncSummaryModal, {
        message: 'Sync completed without blocking other work.',
        summary: {
          synced: [
            { key: 'sales', label: 'Sales', count: 5 },
            { key: 'transfers', label: 'Transfers', count: 1 }
          ],
          unsynced: [{ key: 'expenses', label: 'Expenses', count: 1 }]
        },
        onClose: () => undefined
      })
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Sync Summary');
    expect(markup).toContain('Synced (6)');
    expect(markup).toContain('Unsynced (1)');
    expect(markup).toContain('Sales');
    expect(markup).toContain('Transfers');
    expect(markup).toContain('Expenses');
  });
});
