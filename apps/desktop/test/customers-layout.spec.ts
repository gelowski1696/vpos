import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_DESKTOP_APP_STATE } from '../src/db/schema';
import { CustomerTransactionsModal, CustomersScreen, CustomersWithBalanceModal } from '../src/screens/CustomersScreen';

jest.mock('../src/components/feedback/DesktopUiFeedback', () => ({
  useDesktopUi: () => ({
    showToast: () => undefined,
    setLoading: () => undefined,
    clearLoading: () => undefined
  })
}));

describe('CustomersScreen layout', () => {
  it('renders the compact management shell pattern', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomersScreen, {
        appState: {
          ...DEFAULT_DESKTOP_APP_STATE,
          setup: {
            ...DEFAULT_DESKTOP_APP_STATE.setup,
            branchId: 'branch-1',
            locationId: 'location-1'
          }
        }
      })
    );

    expect(markup).toContain('Customer Management');
    expect(markup).toContain('Track balances, points, and recent branch customer activity.');
    expect(markup).toContain('New Customer');
    expect(markup).toContain('Customers With Balance');
    expect(markup).toContain('Open the customer balance list and select who to review.');
    expect(markup).toContain('Open List');
    expect(markup).toContain('Cached branch customers');
    expect(markup).toContain('Search customer, code, address, balance, or points');
    expect(markup).toContain('0 customers');
    expect(markup).not.toContain('Follow-up accounts');
    expect(markup).not.toContain('Check balances, points, and recent transaction activity without leaving the desktop workspace.');
  });
});

describe('CustomersWithBalanceModal', () => {
  it('renders the compact balance list modal rows', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomersWithBalanceModal, {
        customers: [
          {
            id: 'cust-1',
            label: 'Angelo',
            address: 'Pasay City',
            balance: 50,
            pointsBalance: 0
          } as any,
          {
            id: 'cust-2',
            label: 'Ave',
            address: 'Makati Avenue',
            balance: 450,
            pointsBalance: 0
          } as any
        ],
        onClose: () => undefined,
        onOpenCustomer: () => undefined
      })
    );

    expect(markup).toContain('Customers with balance');
    expect(markup).toContain('Balance list');
    expect(markup).toContain('Search customer name, address, or code...');
    expect(markup).toContain('Sort by:');
    expect(markup).toContain('Name A-Z');
    expect(markup).toContain('Angelo');
    expect(markup).toContain('Pasay City');
    expect(markup).toContain('PHP 50.00');
    expect(markup).toContain('View Transactions');
    expect(markup).toContain('customers-balance-modal');
    expect(markup).toContain('customers-balance-row');
    expect(markup).toContain('Showing 1 to 2 of 2 customers');
  });
});

describe('CustomerTransactionsModal', () => {
  it('renders the richer transaction review modal without left row avatars', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomerTransactionsModal, {
        customer: {
          id: 'cust-1',
          label: 'Albert',
          address: 'Juan Luna Street',
          subtitle: 'CUST001',
          balance: 50,
          pointsBalance: 0
        } as any,
        sales: [
          {
            id: 'desk-sale-1',
            receiptNumber: '20260605-0000002',
            createdAt: '2026-06-05T04:38:20.000Z',
            syncStatus: 'pending',
            saleStatus: 'ACTIVE',
            payload: {
              customerName: 'Albert',
              totalAmount: 50,
              creditBalance: 0,
              saleType: 'PICKUP',
              paymentMethod: 'CASH'
            }
          },
          {
            id: 'desk-sale-2',
            receiptNumber: '20260528-0000005',
            createdAt: '2026-05-28T02:59:27.000Z',
            syncStatus: 'synced',
            saleStatus: 'ACTIVE',
            payload: {
              customerName: 'Albert',
              totalAmount: 160,
              creditBalance: 0,
              saleType: 'DELIVERY',
              paymentMethod: 'CASH'
            }
          }
        ] as any,
        loading: false,
        onClose: () => undefined,
        onOpenSale: () => undefined
      })
    );

    expect(markup).toContain('Transactions');
    expect(markup).toContain('Transaction overview');
    expect(markup).toContain('Pending Balance');
    expect(markup).toContain('Transaction list');
    expect(markup).toContain('Search receipts...');
    expect(markup).toContain('Filters');
    expect(markup).toContain('Receipt #20260605-0000002');
    expect(markup).toContain('Balance PHP 0.00');
    expect(markup).toContain('Showing 1 to 2 of 2 receipts');
    expect(markup).not.toContain('customer-transactions-row-avatar');
  });

  it('keeps the overview in sync with the active balance-only filter', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CustomerTransactionsModal, {
        customer: {
          id: 'cust-2',
          label: 'Balance Customer',
          address: 'Pasay City',
          subtitle: 'CUST002',
          balance: 50,
          pointsBalance: 0
        } as any,
        sales: [
          {
            id: 'desk-sale-balance',
            receiptNumber: '20260605-0000009',
            createdAt: '2026-06-05T04:38:20.000Z',
            syncStatus: 'pending',
            saleStatus: 'ACTIVE',
            payload: {
              customerName: 'Balance Customer',
              totalAmount: 150,
              creditBalance: 50,
              saleType: 'PICKUP',
              paymentMethod: 'CASH'
            }
          },
          {
            id: 'desk-sale-paid',
            receiptNumber: '20260605-0000010',
            createdAt: '2026-06-05T05:38:20.000Z',
            syncStatus: 'synced',
            saleStatus: 'ACTIVE',
            payload: {
              customerName: 'Balance Customer',
              totalAmount: 300,
              creditBalance: 0,
              saleType: 'DELIVERY',
              paymentMethod: 'CARD'
            }
          }
        ] as any,
        loading: false,
        initialFilter: 'balance-only',
        filterLocked: true,
        onClose: () => undefined,
        onOpenSale: () => undefined
      })
    );

    expect(markup).toContain('Showing 1 to 1 of 1 receipts');
    expect(markup).toContain('Receipt #20260605-0000009');
    expect(markup).not.toContain('Receipt #20260605-0000010');
    expect(markup).not.toContain('PHP 450.00');
    expect(markup).toContain('<option value="BALANCE" selected="">With Balance</option>');
    expect(markup).toContain('<select disabled="">');
  });
});
