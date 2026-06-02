import { hasOpenLinkedLendingRecord } from '../src/modules/sales/sales.service';

describe('sales cancellation lending guard', () => {
  it('allows cancellation when linked lending records are closed', () => {
    expect(
      hasOpenLinkedLendingRecord([{ status: 'CLOSED' }, { status: 'FORCE_CLOSED' }, { status: 'CANCELLED' }])
    ).toBe(false);
  });

  it('blocks cancellation when any linked lending record is still open', () => {
    expect(
      hasOpenLinkedLendingRecord([{ status: 'CLOSED' }, { status: 'PARTIALLY_RETURNED' }, { status: 'OPEN' }])
    ).toBe(true);
  });
});
