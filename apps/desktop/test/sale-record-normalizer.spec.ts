import { normalizeDesktopSaleRecord, type DesktopSaleRecord } from '@vpos/desktop-core';

function makeSale(overrides: Partial<DesktopSaleRecord['payload']> = {}): DesktopSaleRecord {
  return {
    id: 'sale-1',
    payload: {
      id: 'sale-1',
      customerId: 'customer-1',
      customerName: 'Albert',
      saleType: 'PICKUP',
      paymentMethod: 'CASH',
      branchLabel: 'VMJAM - Desktop',
      locationLabel: 'VMJAM - Desktop Primary',
      subtotal: 100,
      discountAmount: 0,
      totalAmount: 100,
      paidAmount: 40,
      creditBalance: 60,
      notes: null,
      lines: [],
      createdAt: '2026-06-05T00:00:00.000Z',
      ...overrides
    },
    syncStatus: 'pending',
    receiptNumber: '20260605-0000001',
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z'
  };
}

describe('normalizeDesktopSaleRecord', () => {
  it('infers PARTIAL when payment mode is missing and credit balance remains', () => {
    const sale = makeSale({ paymentMode: undefined, paidAmount: 40, creditBalance: 60 });

    const normalized = normalizeDesktopSaleRecord(sale);

    expect(normalized.payload.paymentMode).toBe('PARTIAL');
  });

  it('keeps explicit FULL payment mode untouched', () => {
    const sale = makeSale({ paymentMode: 'FULL', paidAmount: 100, creditBalance: 0 });

    const normalized = normalizeDesktopSaleRecord(sale);

    expect(normalized.payload.paymentMode).toBe('FULL');
  });
});
