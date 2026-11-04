import {
  desktopCustomerCode,
  desktopCustomerPaymentValidationError,
  desktopCustomerSaleStatus,
  filterDesktopCustomerSales,
  filterDesktopCustomers,
  filterDesktopCustomersWithBalance,
  matchDesktopCustomerSales,
  paginateDesktopCustomers,
  summarizeDesktopCustomerSales,
  summarizeDesktopCustomers,
  type DesktopOption,
  type DesktopSaleRecord
} from '@vpos/desktop-core';

function customer(id: string, label: string, overrides: Partial<DesktopOption> = {}): DesktopOption {
  return { id, label, subtitle: `${id.toUpperCase()} · Cached customer`, ...overrides };
}

function sale(input: {
  id: string;
  createdAt: string;
  customerId?: string | null;
  customerName?: string | null;
  syncStatus?: DesktopSaleRecord['syncStatus'];
  saleStatus?: DesktopSaleRecord['saleStatus'];
  paymentMethod?: DesktopSaleRecord['payload']['paymentMethod'];
  totalAmount?: number;
  creditBalance?: number;
}): DesktopSaleRecord {
  return {
    id: input.id,
    receiptNumber: `R-${input.id}`,
    syncStatus: input.syncStatus ?? 'synced',
    saleStatus: input.saleStatus ?? 'ACTIVE',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    payload: {
      id: input.id,
      customerId: input.customerId ?? 'customer-1',
      customerName: input.customerName ?? 'Customer One',
      saleType: 'PICKUP',
      paymentMode: (input.creditBalance ?? 0) > 0 ? 'PARTIAL' : 'FULL',
      paymentMethod: input.paymentMethod ?? 'CASH',
      branchLabel: 'Main Branch',
      locationLabel: 'Front Store',
      subtotal: input.totalAmount ?? 100,
      discountAmount: 0,
      totalAmount: input.totalAmount ?? 100,
      paidAmount: (input.totalAmount ?? 100) - (input.creditBalance ?? 0),
      creditBalance: input.creditBalance ?? 0,
      changeAmount: 0,
      notes: null,
      lines: [],
      createdAt: input.createdAt
    }
  };
}

describe('desktop customer projections', () => {
  it('filters directory fields, paginates safely, and calculates account totals', () => {
    const customers = Array.from({ length: 12 }, (_, index) => customer(
      `c${index + 1}`,
      `Customer ${index + 1}`,
      {
        address: index === 4 ? 'Jaro, Iloilo' : `Address ${index + 1}`,
        contactNumber: `091700000${index}`,
        balance: index === 2 ? 500 : index === 6 ? 200 : 0,
        pointsBalance: index + 1
      }
    ));

    expect(desktopCustomerCode(customers[0])).toBe('C1');
    expect(filterDesktopCustomers(customers, 'iloilo').map((row) => row.id)).toEqual(['c5']);
    expect(filterDesktopCustomers(customers, '500').map((row) => row.id)).toEqual(['c3']);
    expect(paginateDesktopCustomers(customers, 99, 10)).toMatchObject({
      page: 2,
      pageSize: 10,
      totalPages: 2,
      items: [{ id: 'c11' }, { id: 'c12' }]
    });
    expect(summarizeDesktopCustomers(customers)).toEqual({
      count: 12,
      balance: 700,
      points: 78,
      withBalance: 2
    });
    expect(filterDesktopCustomersWithBalance(customers, '').map((row) => row.id)).toEqual(['c3', 'c7']);
    expect(filterDesktopCustomersWithBalance(customers, 'address 7').map((row) => row.id)).toEqual(['c7']);
  });

  it('matches sales by customer id or normalized legacy name and sorts newest first', () => {
    const selectedCustomer = customer('customer-1', 'Customer One');
    const matchingById = sale({ id: 'id-match', createdAt: '2026-10-01T00:00:00.000Z' });
    const matchingByName = sale({
      id: 'name-match',
      createdAt: '2026-10-03T00:00:00.000Z',
      customerId: 'legacy-id',
      customerName: ' customer one '
    });
    const other = sale({
      id: 'other',
      createdAt: '2026-10-04T00:00:00.000Z',
      customerId: 'customer-2',
      customerName: 'Customer Two'
    });

    expect(matchDesktopCustomerSales([matchingById, other, matchingByName], selectedCustomer).map((row) => row.id))
      .toEqual(['name-match', 'id-match']);
  });

  it('filters receipt states and keeps cancelled balances out of totals', () => {
    const selectedCustomer = customer('customer-1', 'Customer One', { address: 'Downtown' });
    const pending = sale({
      id: 'pending',
      createdAt: '2026-10-03T00:00:00.000Z',
      syncStatus: 'pending',
      paymentMethod: 'E_WALLET',
      totalAmount: 100,
      creditBalance: 50
    });
    const synced = sale({
      id: 'synced',
      createdAt: '2026-10-02T00:00:00.000Z',
      syncStatus: 'synced',
      totalAmount: 200
    });
    const cancelled = sale({
      id: 'cancelled',
      createdAt: '2026-10-01T00:00:00.000Z',
      syncStatus: 'pending',
      saleStatus: 'CANCELLED',
      totalAmount: 300,
      creditBalance: 80
    });
    const sales = [pending, synced, cancelled];

    expect(filterDesktopCustomerSales(sales, '', 'BALANCE', selectedCustomer).map((row) => row.id)).toEqual(['pending']);
    expect(filterDesktopCustomerSales(sales, '', 'PENDING', selectedCustomer).map((row) => row.id)).toEqual(['pending', 'cancelled']);
    expect(filterDesktopCustomerSales(sales, '', 'CANCELLED', selectedCustomer).map((row) => row.id)).toEqual(['cancelled']);
    expect(filterDesktopCustomerSales(sales, 'wallet', 'ALL', selectedCustomer).map((row) => row.id)).toEqual(['pending']);
    expect(summarizeDesktopCustomerSales(sales)).toEqual({ count: 3, total: 600, balance: 50 });
    expect(desktopCustomerSaleStatus(pending)).toBe('PENDING');
    expect(desktopCustomerSaleStatus(cancelled)).toBe('CANCELLED');
  });

  it('enforces positive payments that do not exceed the projected customer balance', () => {
    expect(desktopCustomerPaymentValidationError(0, 100)).toBe('Amount must be greater than 0.');
    expect(desktopCustomerPaymentValidationError(Number.NaN, 100)).toBe('Amount must be greater than 0.');
    expect(desktopCustomerPaymentValidationError(100.01, 100)).toBe('Amount cannot be greater than the customer balance.');
    expect(desktopCustomerPaymentValidationError(100, 100)).toBeNull();
  });
});
