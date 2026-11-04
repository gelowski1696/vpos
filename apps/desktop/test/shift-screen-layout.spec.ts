import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_DESKTOP_APP_STATE,
  type DesktopSaleRecord,
  type DesktopShiftCashEntry,
  type DesktopShiftInventorySnapshot,
  type DesktopShiftRecord
} from '../src/db/schema';
import {
  ShiftCloseModal,
  ShiftInventoryCountModal,
  ShiftStartModal,
  ShiftWorkspaceShell
} from '../src/screens/ShiftScreen';

function makeAppState() {
  return {
    ...DEFAULT_DESKTOP_APP_STATE,
    setup: {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      operatorName: 'Cashier One',
      branchId: 'branch-1',
      branchLabel: 'VMJAM - Desktop',
      locationId: 'location-1',
      locationLabel: 'Front Store'
    },
    auth: {
      ...DEFAULT_DESKTOP_APP_STATE.auth,
      userFullName: 'Cashier One'
    }
  };
}

function makeShift(status: DesktopShiftRecord['status']): DesktopShiftRecord {
  return {
    id: 'desk-shift-1',
    branchId: 'branch-1',
    branchLabel: 'VMJAM - Desktop',
    locationId: 'location-1',
    locationLabel: 'Front Store',
    userId: 'user-1',
    cashierName: 'Cashier One',
    openingCash: 1200,
    openingCashDenominations: undefined,
    openingInventorySnapshot: undefined,
    closingCash: status === 'CLOSED' ? 1450 : null,
    cashVariance: status === 'CLOSED' ? 50 : null,
    closingInventorySnapshot: null,
    status,
    syncStatus: 'pending',
    lastError: null,
    openedAt: '2026-06-22T08:00:00.000Z',
    closedAt: status === 'CLOSED' ? '2026-06-22T17:00:00.000Z' : null,
    createdAt: '2026-06-22T08:00:00.000Z',
    updatedAt: '2026-06-22T08:00:00.000Z'
  };
}

function makeCashEntry(): DesktopShiftCashEntry {
  return {
    id: 'cash-1',
    shiftId: 'desk-shift-1',
    direction: 'OUT',
    amount: 150,
    notes: 'Fuel advance',
    syncStatus: 'pending',
    lastError: null,
    createdAt: '2026-06-22T09:00:00.000Z',
    updatedAt: '2026-06-22T09:00:00.000Z'
  };
}

function makeInventorySnapshot(): DesktopShiftInventorySnapshot {
  return {
    capturedAt: '2026-06-22T17:01:00.000Z',
    locationId: 'location-1',
    locationLabel: 'Front Store',
    lines: [
      {
        productId: 'product-1',
        sku: 'SKU-1',
        productName: 'Water Gallon',
        category: 'Retail',
        unit: 'piece',
        isLpg: false,
        qtyOnHand: 10,
        qtyFull: 0,
        qtyEmpty: 0
      },
      {
        productId: 'product-2',
        sku: 'SKU-2',
        productName: 'LPG 11kg',
        category: 'LPG',
        unit: 'cylinder',
        isLpg: true,
        qtyOnHand: 12,
        qtyFull: 8,
        qtyEmpty: 4
      }
    ]
  };
}

function makeSale(): DesktopSaleRecord {
  return {
    id: 'sale-1',
    payload: {
      id: 'sale-1',
      shiftId: 'desk-shift-1',
      customerId: 'cust-1',
      customerName: 'Albert',
      saleType: 'PICKUP',
      paymentMethod: 'CASH',
      branchLabel: 'VMJAM - Desktop',
      locationLabel: 'Front Store',
      subtotal: 300,
      discountAmount: 0,
      totalAmount: 300,
      paidAmount: 300,
      changeAmount: 0,
      notes: 'Priority pickup',
      lines: [
        {
          productId: 'prod-1',
          productName: 'LPG 11kg',
          quantity: 1,
          unitPrice: 300,
          lineTotal: 300
        }
      ],
      createdAt: '2026-06-22T10:00:00.000Z'
    },
    saleStatus: 'ACTIVE',
    syncStatus: 'pending',
    receiptNumber: '#20260622-000001',
    createdAt: '2026-06-22T10:00:00.000Z',
    updatedAt: '2026-06-22T10:00:00.000Z'
  };
}

describe('ShiftWorkspaceShell', () => {
  it('renders the compact module-style active-duty workspace shell and activity panels', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ShiftWorkspaceShell, {
        appState: makeAppState(),
        activeShift: makeShift('OPEN'),
        shifts: [makeShift('OPEN'), makeShift('CLOSED')],
        cashEntries: [makeCashEntry()],
        shiftSales: [makeSale()],
        cashDirection: 'OUT',
        cashAmount: '150',
        cashNotes: 'Fuel advance',
        closingCash: '1450',
        cashIn: 0,
        cashOut: 150,
        cashSales: 300,
        cashReturns: 0,
        expectedCash: 1350,
        saving: false,
        loading: false,
        onOpenStartShift: () => undefined,
        onCashDirectionChange: () => undefined,
        onCashAmountChange: () => undefined,
        onCashNotesChange: () => undefined,
        onAddCashAdjustment: () => undefined,
        onOpenCloseShift: () => undefined
      })
    );

    expect(markup).toContain('>Shift<');
    expect(markup).toContain('Current duty');
    expect(markup).toContain('Duty controls');
    expect(markup).toContain('Close shift');
    expect(markup).not.toContain('Duty timeline');
    expect(markup).toContain('Sales in current duty');
    expect(markup).toContain('Cash Returns');
    expect(markup).toContain('shift-duty-controls-head');
    expect(markup).toContain('shift-duty-controls-grid');
    expect(markup).toContain('shift-duty-action-panel');
    expect(markup).toContain('shift-duty-closeout-panel');
    expect(markup).toContain('shift-duty-summary-panel');
    expect(markup).toContain('shift-duty-snapshot-panel');
    expect(markup).toContain('Current movement summary');
    expect(markup).toContain('Duty snapshot');
    expect(markup).toContain('desktop-summary-strip');
    expect(markup).toContain('End Duty');
    expect(markup).not.toContain('Close Shift');
    expect(markup.match(/>End Duty</g) ?? []).toHaveLength(1);
    expect(markup.indexOf('End Duty')).toBeLessThan(markup.indexOf('desktop-summary-strip'));
  });

  it('renders the compact module-style no-active-duty setup state', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ShiftWorkspaceShell, {
        appState: makeAppState(),
        activeShift: null,
        shifts: [],
        cashEntries: [],
        shiftSales: [],
        cashDirection: 'OUT',
        cashAmount: '0',
        cashNotes: '',
        closingCash: '0',
        cashIn: 0,
        cashOut: 0,
        cashSales: 0,
        cashReturns: 0,
        expectedCash: 0,
        saving: false,
        loading: false,
        onOpenStartShift: () => undefined,
        onCashDirectionChange: () => undefined,
        onCashAmountChange: () => undefined,
        onCashNotesChange: () => undefined,
        onAddCashAdjustment: () => undefined,
        onOpenCloseShift: () => undefined
      })
    );

    expect(markup).toContain('Ready to start');
    expect(markup).toContain('Start Duty');
    expect(markup).toContain('No active shift');
    expect(markup).toContain('Current duty');
    expect(markup).toContain('Opening checklist');
    expect(markup).not.toContain('Start duty checklist');
    expect(markup.match(/>Start Duty</g) ?? []).toHaveLength(1);
  });

  it('renders the compact module-style start modal', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ShiftStartModal, {
        appState: makeAppState(),
        openingCashEntryMode: 'DENOMINATION',
        openingCashAmount: 1200,
        openingCash: '1200',
        openingDenominationRows: [
          { denomination: 1000, quantity: 1, total: 1000 },
          { denomination: 100, quantity: 2, total: 200 }
        ],
        openingDenominationCounts: { '1000': '1', '100': '2' },
        openingDenominationActiveLines: 2,
        openingDenominationPieces: 3,
        openingDenominationTotal: 1200,
        saving: false,
        onClose: () => undefined,
        onSelectMode: () => undefined,
        onOpeningCashChange: () => undefined,
        onQuickAmount: () => undefined,
        onStepDenomination: () => undefined,
        onUpdateDenomination: () => undefined,
        onClearDenominations: () => undefined,
        onStart: () => undefined
      })
    );

    expect(markup).toContain('Opening cash');
    expect(markup).toContain('Start summary');
    expect(markup).toContain('Start checklist');
    expect(markup).toContain('Denomination count');
    expect(markup).toContain('desktop-modal-card');
    expect(markup).not.toContain('text-white/72');
    expect(markup).not.toContain('Back');
  });

  it('renders the compact module-style close modal', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ShiftCloseModal, {
        appState: makeAppState(),
        activeShift: makeShift('OPEN'),
        expectedCash: 1350,
        closingCashEntryMode: 'DENOMINATION',
        closingCashAmount: 1450,
        closingCash: '1450',
        closingDenominationRows: [
          { denomination: 1000, quantity: 1, total: 1000 },
          { denomination: 100, quantity: 4, total: 400 },
          { denomination: 50, quantity: 1, total: 50 }
        ],
        closingDenominationCounts: { '1000': '1', '100': '4', '50': '1' },
        closingDenominationActiveLines: 3,
        closingDenominationPieces: 6,
        closingDenominationTotal: 1450,
        variancePreview: 100,
        saving: false,
        onClose: () => undefined,
        onSelectMode: () => undefined,
        onClosingCashChange: () => undefined,
        onQuickAmount: () => undefined,
        onStepDenomination: () => undefined,
        onUpdateDenomination: () => undefined,
        onClearDenominations: () => undefined,
        onEndShift: () => undefined
      })
    );

    expect(markup).toContain('Close shift');
    expect(markup).toContain('Entry Mode');
    expect(markup).toContain('Close summary');
    expect(markup).toContain('Close checklist');
    expect(markup).toContain('Denomination count');
    expect(markup).toContain('Variance');
    expect(markup).toContain('Cancel');
    expect(markup).toContain('End Duty');
  });

  it('shows the inventory review action when the end-of-day addon is enabled', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ShiftCloseModal, {
        appState: makeAppState(),
        activeShift: makeShift('OPEN'),
        expectedCash: 1350,
        requiresInventoryCount: true,
        closingCashEntryMode: 'DENOMINATION',
        closingCashAmount: 1450,
        closingCash: '1450',
        closingDenominationRows: [
          { denomination: 1000, quantity: 1, total: 1000 },
          { denomination: 100, quantity: 4, total: 400 },
          { denomination: 50, quantity: 1, total: 50 }
        ],
        closingDenominationCounts: { '1000': '1', '100': '4', '50': '1' },
        closingDenominationActiveLines: 3,
        closingDenominationPieces: 6,
        closingDenominationTotal: 1450,
        variancePreview: 100,
        saving: false,
        onClose: () => undefined,
        onSelectMode: () => undefined,
        onClosingCashChange: () => undefined,
        onQuickAmount: () => undefined,
        onStepDenomination: () => undefined,
        onUpdateDenomination: () => undefined,
        onClearDenominations: () => undefined,
        onEndShift: () => undefined
      })
    );

    expect(markup).toContain('Review Inventory');
    expect(markup).toContain('inventory snapshot');
  });

  it('renders the compact inventory count modal for end-of-day capture', () => {
    const snapshot = makeInventorySnapshot();
    const markup = renderToStaticMarkup(
      React.createElement(ShiftInventoryCountModal, {
        appState: makeAppState(),
        activeShift: makeShift('OPEN'),
        expectedCash: 1350,
        countedCash: 1450,
        cashVariance: 100,
        inventorySnapshot: snapshot,
        inventoryCounts: {
          'product-1': { qtyOnHand: '', qtyFull: '', qtyEmpty: '' },
          'product-2': { qtyOnHand: '', qtyFull: '', qtyEmpty: '' }
        },
        saving: false,
        onClose: () => undefined,
        onBackToCloseout: () => undefined,
        onUpdateCount: () => undefined,
        onFinalize: () => undefined
      })
    );

    expect(markup).toContain('Inventory count');
    expect(markup).toContain('Finalize Close');
    expect(markup).toContain('Back to Closeout');
    expect(markup).toContain('Water Gallon');
    expect(markup).toContain('LPG 11kg');
    expect(markup).toContain('Counted Cash');
    expect(markup).toContain('inventory-count-table');
    expect(markup).toContain('2 inventory lines remaining.');
    expect(markup).not.toContain('>System</th>');
    expect(markup).not.toContain('System on hand');
    expect(markup).not.toContain('Current system snapshot');
    expect(markup).not.toContain('Full 8 / Empty 4');
    expect(markup).not.toContain('On hand 10');
    expect(markup).not.toContain('Matching snapshot');
  });
});
