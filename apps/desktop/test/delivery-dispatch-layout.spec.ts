import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_DESKTOP_APP_STATE, type DesktopDispatchStatusRecord, type DesktopSaleRecord } from '../src/db/schema';
import { useDesktopUi } from '../src/components/feedback/DesktopUiFeedback';
import { DeliveryDispatchScreen } from '../src/screens/DeliveryDispatchScreen';
import { desktopDb } from '../src/db/sqlite';
import { desktopDeliveryService } from '../src/services/desktop-delivery.service';

jest.mock('../src/components/feedback/DesktopUiFeedback', () => ({
  useDesktopUi: jest.fn(() => ({
    showToast: () => undefined,
    setLoading: () => undefined,
    clearLoading: () => undefined
  }))
}));

jest.mock('../src/db/sqlite', () => ({
  desktopDb: {
    listSales: jest.fn()
  }
}));

jest.mock('../src/services/desktop-delivery.service', () => ({
  desktopDeliveryService: {
    listDispatchStatuses: jest.fn(),
    updateDispatchStatus: jest.fn()
  }
}));

function makeSale(index: number, overrides: Partial<DesktopSaleRecord> = {}): DesktopSaleRecord {
  const day = String((index % 9) + 1).padStart(2, '0');
  const now = `2026-06-${day}T09:15:00.000Z`;
  const base: DesktopSaleRecord = {
    id: `desk-sale-${index}`,
    receiptNumber: `20260617-000000${index}`,
    saleStatus: 'ACTIVE',
    syncStatus: 'pending',
    createdAt: now,
    updatedAt: now,
    payload: {
      id: `desk-sale-${index}`,
      customerId: `cust-${index}`,
      customerName: index === 1 ? 'Angelo' : `Customer ${index}`,
      saleType: 'DELIVERY',
      paymentMode: 'FULL',
      paymentMethod: 'CASH',
      branchId: 'branch-1',
      branchLabel: 'Main Branch',
      locationId: 'loc-1',
      locationLabel: 'Warehouse',
      subtotal: 1000 + index,
      discountAmount: 0,
      totalAmount: 1000 + index,
      paidAmount: 1000 + index,
      changeAmount: 0,
      creditBalance: 0,
      notes: index === 1 ? 'Leave at the back gate' : `Delivery note ${index}`,
      personnel: [
        { userId: `driver-${index}`, role: 'DRIVER', name: `Driver ${index}` },
        { userId: `helper-${index}`, role: 'HELPER', name: `Helper ${index}` }
      ],
      personnelName: `Driver ${index}`,
      helperName: `Helper ${index}`,
      lines: [
        {
          lineId: `line-${index}-1`,
          productId: `prod-${index}-1`,
          productName: `Gas ${index}-A`,
          subtitle: 'LPG Item',
          quantity: 1,
          unitPrice: 500 + index,
          lineTotal: 500 + index
        },
        {
          lineId: `line-${index}-2`,
          productId: `prod-${index}-2`,
          productName: `Gas ${index}-B`,
          subtitle: 'LPG Item',
          quantity: 2,
          unitPrice: 250 + index,
          lineTotal: 500 + index * 2
        }
      ],
      createdAt: now
    }
  };

  return {
    ...base,
    ...overrides,
    payload: {
      ...base.payload,
      ...(overrides.payload ?? {}),
      lines: overrides.payload?.lines ?? base.payload.lines
    }
  };
}

function makeDispatchStatus(
  saleId: string,
  status: DesktopDispatchStatusRecord['status']
): DesktopDispatchStatusRecord {
  const now = '2026-06-17T10:00:00.000Z';
  return {
    saleId,
    status,
    notes: null,
    syncStatus: 'pending',
    lastError: null,
    updatedAt: now
  };
}

function renderDispatchMarkup(
  records: DesktopSaleRecord[],
  options: {
    statusMap?: Record<string, DesktopDispatchStatusRecord>;
    selectedSale?: DesktopSaleRecord | null;
    pageSize?: number;
    dispatchNotes?: string;
    pendingAdvanceAction?: {
      sale: DesktopSaleRecord;
      currentStatus: 'PENDING' | 'TRANSIT' | 'DELIVERED' | 'COMPLETED';
      nextStatus: DesktopDispatchStatusRecord['status'];
      notes: string;
    } | null;
    loading?: boolean;
    searchTerm?: string;
    statusFilter?: 'ALL' | 'PENDING' | 'TRANSIT' | 'DELIVERED' | 'COMPLETED';
    currentPage?: number;
    updatingId?: string | null;
  } = {}
): string {
  jest.mocked(useDesktopUi).mockReturnValue({
    showToast: () => undefined,
    setLoading: () => undefined,
    clearLoading: () => undefined
  });

  jest.mocked(desktopDb.listSales).mockResolvedValue(records);
  jest.mocked(desktopDeliveryService.listDispatchStatuses).mockResolvedValue(options.statusMap ?? {});

  const actualUseState = React.useState.bind(React);

  jest
    .spyOn(React, 'useState')
    .mockImplementationOnce(() => [records, jest.fn()] as any)
    .mockImplementationOnce(() => [options.statusMap ?? {}, jest.fn()] as any)
    .mockImplementationOnce(() => [options.loading ?? false, jest.fn()] as any)
    .mockImplementationOnce(() => [options.searchTerm ?? '', jest.fn()] as any)
    .mockImplementationOnce(() => [options.statusFilter ?? 'ALL', jest.fn()] as any)
    .mockImplementationOnce(() => [options.currentPage ?? 1, jest.fn()] as any)
    .mockImplementationOnce(() => [options.selectedSale ?? null, jest.fn()] as any)
    .mockImplementationOnce(() => [options.updatingId ?? null, jest.fn()] as any)
    .mockImplementationOnce(() => [options.pageSize ?? 10, jest.fn()] as any)
    .mockImplementationOnce(() => [options.dispatchNotes ?? '', jest.fn()] as any)
    .mockImplementationOnce(() => [options.pendingAdvanceAction ?? null, jest.fn()] as any)
    .mockImplementation((initial) => actualUseState(initial));

  return renderToStaticMarkup(
    React.createElement(DeliveryDispatchScreen, {
      appState: {
        ...DEFAULT_DESKTOP_APP_STATE,
        setup: {
          ...DEFAULT_DESKTOP_APP_STATE.setup,
          branchId: 'branch-1',
          branchLabel: 'Main Branch',
          locationId: 'loc-1',
          locationLabel: 'Warehouse'
        }
      },
      onOutboxChanged: () => undefined
    })
  );
}

describe('DeliveryDispatchScreen layout', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the purchase-order-style dispatch workspace shell with chips, cards, and pager', () => {
    const records = Array.from({ length: 12 }, (_, index) => makeSale(index + 1));
    const statusMap = {
      [records[1].id]: makeDispatchStatus(records[1].id, 'TRANSIT'),
      [records[2].id]: makeDispatchStatus(records[2].id, 'DELIVERED'),
      [records[3].id]: makeDispatchStatus(records[3].id, 'COMPLETED')
    };

    const markup = renderDispatchMarkup(records, {
      statusMap,
      searchTerm: '',
      statusFilter: 'ALL',
      currentPage: 1
    });

    expect(markup).toContain('Delivery Dispatch');
    expect(markup).toContain('Search by customer, order no., driver...');
    expect(markup).toContain('Status');
    expect(markup).toContain('Customer');
    expect(markup).toContain('Order No.');
    expect(markup).toContain('Date');
    expect(markup).toContain('Driver');
    expect(markup).toContain('Items');
    expect(markup).toContain('Amount');
    expect(markup).toContain('Action');
    expect(markup).toContain('Pending (9)');
    expect(markup).toContain('In Transit (1)');
    expect(markup).toContain('Delivered (1)');
    expect(markup).toContain('View Details');
    expect(markup).toContain('Start Transit');
    expect(markup).toContain('Showing 1 to 10 of 12 records');
    expect(markup).toContain('Page 1 of 2');
    expect(markup).toContain('10 per page');
    expect(markup).toContain('Driver 1');
  });

  it('renders the purchase-order-style dispatch modal shell for a selected record', () => {
    const records = [makeSale(1), makeSale(2)];
    const selectedSale = records[1];
    const statusMap = {
      [selectedSale.id]: makeDispatchStatus(selectedSale.id, 'TRANSIT')
    };

    const markup = renderDispatchMarkup(records, {
      statusMap,
      selectedSale,
      searchTerm: '',
      statusFilter: 'ALL',
      currentPage: 1
    });

    expect(markup).toContain('Dispatch Detail');
    expect(markup).toContain('Last Updated');
    expect(markup).toContain('Mark Delivered');
    expect(markup).toContain('desktop-modal-card--detail');
    expect(markup).toContain('modal-close-icon-btn');
    expect(markup).not.toContain('mt-2 inline-flex items-center gap-2');
  });

  it('renders compact summary metrics in the dispatch detail modal', () => {
    const records = [makeSale(1), makeSale(2)];
    const selectedSale = records[1];
    const statusMap = {
      [selectedSale.id]: makeDispatchStatus(selectedSale.id, 'TRANSIT')
    };

    const markup = renderDispatchMarkup(records, {
      statusMap,
      selectedSale,
      searchTerm: '',
      statusFilter: 'ALL',
      currentPage: 1
    });

    expect(markup).toContain('grid h-8 w-8 shrink-0 place-items-center rounded-lg border');
    expect(markup).toContain('text-[0.68rem] font-semibold uppercase tracking-[0.12em]');
    expect(markup).toContain('text-[0.88rem] font-bold leading-5');
  });

  it('renders an optional status note field in the dispatch modal before advancing', () => {
    const records = [makeSale(1), makeSale(2)];
    const selectedSale = records[1];
    const statusMap = {
      [selectedSale.id]: makeDispatchStatus(selectedSale.id, 'TRANSIT')
    };

    const markup = renderDispatchMarkup(records, {
      statusMap,
      selectedSale,
      searchTerm: '',
      statusFilter: 'ALL',
      currentPage: 1
    });

    expect(markup).toContain('Status note (optional)');
    expect(markup).toContain('Add a note for this status update');
  });

  it('renders a dispatch timeline with timestamps and notes for reached statuses', () => {
    const records = [makeSale(1), makeSale(2)];
    const selectedSale = records[1];
    const statusMap = {
      [selectedSale.id]: {
        ...makeDispatchStatus(selectedSale.id, 'DELIVERED'),
        history: [
          {
            status: 'TRANSIT' as const,
            notes: 'Loaded on the truck',
            updatedAt: '2026-06-17T09:30:00.000Z'
          },
          {
            status: 'DELIVERED' as const,
            notes: 'Dropped at the side gate',
            updatedAt: '2026-06-17T10:15:00.000Z'
          }
        ]
      }
    };

    const markup = renderDispatchMarkup(records, {
      statusMap,
      selectedSale,
      searchTerm: '',
      statusFilter: 'ALL',
      currentPage: 1
    });

    expect(markup).toContain('Dispatch Progress');
    expect(markup).toContain('Pending');
    expect(markup).toContain('In Transit');
    expect(markup).toContain('Delivered');
    expect(markup).toContain('Completed');
    expect(markup).toContain('dateTime="2026-06-17T09:30:00.000Z"');
    expect(markup).toContain('dateTime="2026-06-17T10:15:00.000Z"');
    expect(markup).toContain('Loaded on the truck');
    expect(markup).toContain('Dropped at the side gate');
  });

  it('renders a confirmation modal with notes when a list action is selected', () => {
    const records = [makeSale(1), makeSale(2)];
    const selectedSale = records[1];
    const statusMap = {
      [selectedSale.id]: makeDispatchStatus(selectedSale.id, 'PENDING')
    };

    const markup = renderDispatchMarkup(records, {
      statusMap,
      pendingAdvanceAction: {
        sale: selectedSale,
        currentStatus: 'PENDING',
        nextStatus: 'TRANSIT',
        notes: ''
      },
      searchTerm: '',
      statusFilter: 'ALL',
      currentPage: 1
    });

    expect(markup).toContain('Confirm Dispatch Update');
    expect(markup).toContain('Status note (optional)');
    expect(markup).toContain('Add a note for this status update');
    expect(markup).toContain('Confirm Start Transit');
  });

  it('renders a friendly empty state when no delivery orders are available', () => {
    const markup = renderDispatchMarkup([], {
      statusMap: {},
      searchTerm: '',
      statusFilter: 'ALL',
      currentPage: 1
    });

    expect(markup).toContain('No delivery orders match this filter yet.');
    expect(markup).toContain('Delivery Dispatch');
  });
});
