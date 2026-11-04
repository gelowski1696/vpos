import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_DESKTOP_APP_STATE, type DesktopPurchaseOrderRecord } from '../src/db/schema';
import { useDesktopUi } from '../src/components/feedback/DesktopUiFeedback';
import { PurchaseOrdersScreen } from '../src/screens/PurchaseOrdersScreen';
import { desktopMasterDataService } from '../src/services/desktop-master-data.service';
import { desktopPurchaseOrderService } from '../src/services/desktop-purchase-order.service';

jest.mock('../src/components/feedback/DesktopUiFeedback', () => ({
  useDesktopUi: jest.fn(() => ({
    showToast: () => undefined,
    setLoading: () => undefined,
    clearLoading: () => undefined
  }))
}));

jest.mock('../src/services/desktop-master-data.service', () => ({
  desktopMasterDataService: {
    loadSuppliers: jest.fn(),
    loadCatalog: jest.fn()
  }
}));

jest.mock('../src/services/desktop-purchase-order.service', () => ({
  desktopPurchaseOrderService: {
    listPurchaseOrders: jest.fn(),
    createPurchaseOrder: jest.fn(),
    updateDraftPurchaseOrder: jest.fn(),
    deleteDraftPurchaseOrder: jest.fn(),
    submitPurchaseOrder: jest.fn(),
    receivePurchaseOrder: jest.fn(),
    pulloutPurchaseOrder: jest.fn(),
    completePurchaseOrder: jest.fn(),
    cancelPurchaseOrder: jest.fn(),
    addAttachment: jest.fn()
  }
}));

function makePurchaseOrderRecord(
  index: number,
  overrides: Partial<DesktopPurchaseOrderRecord> = {}
): DesktopPurchaseOrderRecord {
  const day = String((index % 9) + 1).padStart(2, '0');
  const now = `2026-06-${day}T09:15:00.000Z`;
  const base: DesktopPurchaseOrderRecord = {
    id: `desk-po-${index}`,
    poNumber: `PO-2026-${String(index).padStart(4, '0')}`,
    status: index % 4 === 0 ? 'SUBMITTED' : index % 3 === 0 ? 'PARTIALLY_RECEIVED' : 'DRAFT',
    branchId: 'branch-1',
    branchLabel: 'Main Branch',
    locationId: 'loc-1',
    locationLabel: 'Warehouse',
    supplierId: `sup-${index}`,
    supplierLabel: index === 1 ? 'Acme Gas' : `Supplier ${index}`,
    notes: index === 1 ? 'Urgent warehouse top-up' : `Restock plan ${index}`,
    createdByUserId: null,
    submittedByUserId: null,
    completedByUserId: null,
    cancelledByUserId: null,
    submittedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    orderedQtyTotal: 10 + index,
    receivedQtyTotal: index % 3 === 0 ? 4 : 0,
    pulledOutQtyTotal: index % 5 === 0 ? 2 : 0,
    attachmentCount: index % 2,
    syncStatus: index % 4 === 0 ? 'synced' : 'pending',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    lines: [
      {
        id: `desk-po-line-${index}`,
        productId: `prod-${index}`,
        productSku: index === 1 ? 'LPG-11' : `SKU-${index}`,
        productName: index === 1 ? 'LPG 11kg' : `Item ${index}`,
        orderedQty: 10 + index,
        receivedQty: index % 3 === 0 ? 4 : 0,
        pulledOutQty: index % 5 === 0 ? 2 : 0,
        unitCost: 900 + index,
        notes: null
      }
    ],
    receipts: [],
    pullouts: [],
    attachments: []
  };

  return {
    ...base,
    ...overrides,
    lines: overrides.lines ?? base.lines,
    receipts: overrides.receipts ?? base.receipts,
    pullouts: overrides.pullouts ?? base.pullouts,
    attachments: overrides.attachments ?? base.attachments
  };
}

function renderPurchaseOrdersMarkup(
  records: DesktopPurchaseOrderRecord[],
  options: {
    detailId?: string | null;
    createOpen?: boolean;
    lineDrafts?: {
      id: string;
      productId: string;
      orderedQty: string;
      unitCost: string;
      notes: string;
    }[];
    productPickerState?:
      | {
          lineId: string | null;
          search: string;
          category: string;
        }
      | null;
    cancelState?:
      | {
          recordId: string;
          reason: string;
          busy: boolean;
        }
      | null;
  } = {}
): string {
  jest.mocked(useDesktopUi).mockReturnValue({
    showToast: () => undefined,
    setLoading: () => undefined,
    clearLoading: () => undefined
  });

  jest.mocked(desktopPurchaseOrderService.listPurchaseOrders).mockResolvedValue(records);
  jest.mocked(desktopMasterDataService.loadSuppliers).mockResolvedValue([
    { id: 'sup-1', label: 'Acme Gas' }
  ] as any);
  jest.mocked(desktopMasterDataService.loadCatalog).mockResolvedValue([
    {
      id: 'prod-1',
      sku: 'LPG-11',
      name: 'LPG 11kg',
      category: 'LPG',
      unit: 'cylinder',
      isLpg: true,
      cylinderSizeLabel: '11 kg',
      qtyFull: 24,
      qtyEmpty: 8,
      qtyOnHand: 32,
      unitPrice: 900
    }
  ] as any);

  const actualUseState = React.useState.bind(React);

  jest
    .spyOn(React, 'useState')
    .mockImplementationOnce(() => [false, jest.fn()] as any)
    .mockImplementationOnce(() => [records, jest.fn()] as any)
    .mockImplementationOnce(() => [[{ id: 'sup-1', label: 'Acme Gas' }], jest.fn()] as any)
    .mockImplementationOnce(() => [[{
      id: 'prod-1',
      sku: 'LPG-11',
      name: 'LPG 11kg',
      category: 'LPG',
      unit: 'cylinder',
      isLpg: true,
      cylinderSizeLabel: '11 kg',
      qtyFull: 24,
      qtyEmpty: 8,
      qtyOnHand: 32,
      unitPrice: 900
    }], jest.fn()] as any)
    .mockImplementationOnce(() => ['', jest.fn()] as any)
    .mockImplementationOnce(() => ['ALL', jest.fn()] as any)
    .mockImplementationOnce(() => ['ALL', jest.fn()] as any)
    .mockImplementationOnce(() => [10, jest.fn()] as any)
    .mockImplementationOnce(() => [1, jest.fn()] as any)
    .mockImplementationOnce(() => [options.createOpen ?? false, jest.fn()] as any)
    .mockImplementationOnce(() => [null, jest.fn()] as any)
    .mockImplementationOnce(() => [options.detailId ?? null, jest.fn()] as any)
    .mockImplementationOnce(() => [false, jest.fn()] as any)
    .mockImplementationOnce(() => [options.lineDrafts ?? [], jest.fn()] as any)
    .mockImplementationOnce(() => ['', jest.fn()] as any)
    .mockImplementationOnce(() => ['', jest.fn()] as any)
    .mockImplementationOnce(() => [options.productPickerState ?? null, jest.fn()] as any)
    .mockImplementationOnce(() => [null, jest.fn()] as any)
    .mockImplementationOnce(() => [null, jest.fn()] as any)
    .mockImplementationOnce(() => [options.cancelState ?? null, jest.fn()] as any)
    .mockImplementationOnce(() => [null, jest.fn()] as any)
    .mockImplementation((initial) => actualUseState(initial));

  return renderToStaticMarkup(
    React.createElement(PurchaseOrdersScreen, {
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

describe('PurchaseOrdersScreen layout', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the purchase-order workspace shell with create action, seeded records, and pager footer', () => {
    const records = Array.from({ length: 12 }, (_, index) => makePurchaseOrderRecord(index + 1));

    const markup = renderPurchaseOrdersMarkup(records);

    expect(markup).toContain('Purchase Orders');
    expect(markup).toContain('Create and process purchase orders offline.');
    expect(markup).toContain('New Purchase Order');
    expect(markup).toContain('Purchase order history');
    expect(markup).toContain('Search PO number, supplier, item, or note');
    expect(markup).toContain('Pending (9)');
    expect(markup).toContain('Synced (3)');
    expect(markup).toContain('Acme Gas');
    expect(markup).toContain('PO-2026-0001');
    expect(markup).toContain('Urgent warehouse top-up');
    expect(markup).toContain('Showing 1 to 10 of 12 records');
    expect(markup).toContain('10 per page');
  });

  it('renders the empty state when no purchase orders match yet', () => {
    const markup = renderPurchaseOrdersMarkup([]);

    expect(markup).toContain('Purchase Orders');
    expect(markup).toContain('Purchase order history');
    expect(markup).toContain('No purchase orders match this filter yet.');
  });

  it('renders the purchase-order editor modal shell with summary and add-item action', () => {
    const markup = renderPurchaseOrdersMarkup([makePurchaseOrderRecord(1)], { createOpen: true });

    expect(markup).toContain('New Purchase Order');
    expect(markup).toContain('Create a supplier order offline and queue it for sync.');
    expect(markup).toContain('min(1120px, calc(100vw - 48px))');
    expect(markup).toContain('purchase-order-editor-modal-header');
    expect(markup).toContain('Supplier');
    expect(markup).toContain('Location');
    expect(markup).toContain('Order lines');
    expect(markup).toContain('Add Item');
    expect(markup).not.toContain('Add Line');
    expect(markup).toContain('No items added yet.');
    expect(markup).toContain('purchase-order-add-item-btn');
    expect(markup).toContain('purchase-order-editor-save-btn');
    expect(markup).toContain('purchase-order-editor-cancel-btn');
    expect(markup).toContain('Order Summary');
    expect(markup).toContain('Estimated Total');
    expect(markup).toContain('Save Purchase Order');
  });

  it('renders compact order-line controls with grouped total actions', () => {
    const markup = renderPurchaseOrdersMarkup([makePurchaseOrderRecord(1)], {
      createOpen: true,
      lineDrafts: [
        { id: 'po-draft-line-1', productId: 'prod-1', orderedQty: '1', unitCost: '50', notes: '' }
      ]
    });

    expect(markup).toContain('purchase-order-line-total-bar');
    expect(markup).toContain('purchase-order-line-delete-btn');
  });

  it('renders the purchase-order product picker with POS-style search and category chips', () => {
    const markup = renderPurchaseOrdersMarkup([makePurchaseOrderRecord(1)], {
      createOpen: true,
      productPickerState: {
        lineId: null,
        search: '',
        category: 'ALL'
      }
    });

    expect(markup).toContain('Select Product');
    expect(markup).toContain('Search product code or name');
    expect(markup).toContain('All Categories');
    expect(markup).toContain('LPG-11 - LPG 11kg');
  });

  it('gates detail actions for a draft purchase order', () => {
    const record = makePurchaseOrderRecord(7, {
      poNumber: 'PO-2026-0700',
      status: 'DRAFT'
    });

    const markup = renderPurchaseOrdersMarkup([record], { detailId: record.id });

    expect(markup).toContain('Purchase Order Detail');
    expect(markup).toContain('PO-2026-0700');
    expect(markup).toContain('Purchase Order Lines');
    expect(markup).toContain('Actions');
    expect(markup).toContain('Order Progress');
    expect(markup).toContain('Details');
    expect(markup).toContain('Activity Timeline');
    expect(markup).toContain('Activity Summary');
    expect(markup).toContain('Submit Purchase Order');
    expect(markup).toContain('Edit Draft');
    expect(markup).toContain('Delete Draft');
    expect(markup).not.toContain('Receive Stock');
    expect(markup).not.toContain('Record Pullout');
    expect(markup).not.toContain('Complete Purchase Order');
    expect(markup).toContain('Cancel Purchase Order');
  });

  it('disables the cancel action until a reason is entered', () => {
    const record = makePurchaseOrderRecord(8, {
      poNumber: 'PO-2026-0800',
      status: 'SUBMITTED'
    });

    const markup = renderPurchaseOrdersMarkup([record], {
      cancelState: {
        recordId: record.id,
        reason: '',
        busy: false
      }
    });

    expect(markup).toContain('Cancel Purchase Order');
    expect(markup).toContain('Record the reason before cancelling this offline purchase order.');
    expect(markup).toContain('disabled=""');
  });

  it('renders the detail shell for a partially received purchase order', () => {
    const record = makePurchaseOrderRecord(9, {
      poNumber: 'PO-2026-0900',
      status: 'PARTIALLY_RECEIVED',
      receipts: [
        {
          id: 'receipt-1',
          createdAt: '2026-06-07T10:30:00.000Z',
          locationId: 'loc-1',
          locationLabel: 'Warehouse',
          receivedByUserId: null,
          notes: 'Morning receive',
          lines: []
        }
      ]
    });

    const markup = renderPurchaseOrdersMarkup([record], { detailId: record.id });

    expect(markup).toContain('PO-2026-0900');
    expect(markup).toContain('Receive Stock');
    expect(markup).toContain('Add Attachment');
  });
});
