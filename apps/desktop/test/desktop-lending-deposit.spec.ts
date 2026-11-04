import {
  buildLendingDepositPaymentOutbox,
  sumLendingDepositAmount
} from '../src/services/desktop-lending-deposit';

describe('desktop lending deposit payment helper', () => {
  it('sums whole lending deposit amounts and builds a deposit payment outbox payload', () => {
    const total = sumLendingDepositAmount([
      { deposit_amount: 1200 },
      { deposit_amount: 2200.5 },
      { deposit_amount: null }
    ]);

    expect(total).toBe(3400.5);

    const result = buildLendingDepositPaymentOutbox({
      lendingId: 'lend-1',
      saleId: 'sale-1',
      customerId: 'cust-1',
      receiptNumber: '20260602-0000001',
      branchId: 'branch-1',
      locationId: 'location-1',
      paymentMethod: 'CARD',
      depositLines: [
        { deposit_amount: 1200 },
        { deposit_amount: 2200.5 }
      ],
      notes: 'Lending deposit for receipt #20260602-0000001'
    });

    expect(result).not.toBeNull();
    expect(result?.outbox.entity).toBe('customer_payment');
    expect(result?.outbox.payload.purpose).toBe('LENDING_DEPOSIT');
    expect(result?.outbox.payload.sale_id).toBe('sale-1');
    expect(result?.outbox.payload.customer_id).toBe('cust-1');
    expect(result?.outbox.payload.method).toBe('CARD');
    expect(result?.outbox.payload.amount).toBe(3400.5);
    expect(result?.outbox.payload.notes).toContain('20260602-0000001');
    expect(result?.summary.amount).toBe(3400.5);
    expect(result?.summary.method).toBe('CARD');
  });

  it('skips creating a deposit payment when the deposit total is zero', () => {
    const result = buildLendingDepositPaymentOutbox({
      lendingId: 'lend-2',
      saleId: 'sale-2',
      customerId: 'cust-2',
      receiptNumber: '20260602-0000002',
      branchId: 'branch-1',
      locationId: 'location-1',
      paymentMethod: 'CASH',
      depositLines: [{ deposit_amount: 0 }, { deposit_amount: null }],
      notes: null
    });

    expect(result).toBeNull();
  });
});
