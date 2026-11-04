import {
  DEFAULT_DESKTOP_APP_STATE,
  DEFAULT_DESKTOP_RECEIPT_LAYOUT_SETTINGS,
  type DesktopAppState,
  type DesktopSaleRecord
} from '../src/db/schema';
import {
  DesktopReceiptService,
  type DesktopCustomerPaymentReceiptPayload,
  type DesktopQueueOrderReceiptPayload
} from '../src/services/desktop-receipt.service';

function buildAppState(): DesktopAppState {
  return {
    ...DEFAULT_DESKTOP_APP_STATE,
    setupCompleted: true,
    setup: {
      ...DEFAULT_DESKTOP_APP_STATE.setup,
      operatorName: 'Cashier Jane',
      branchLabel: 'VMJAM Main',
      locationLabel: 'Front Counter'
    },
    receiptLayout: {
      ...DEFAULT_DESKTOP_RECEIPT_LAYOUT_SETTINGS,
      showStoreContact: true,
      storeContactInfo: '0917-000-0000',
      showStoreAddress: true,
      storeAddress: 'Juan Luna Street',
      showBusinessTin: true,
      businessTin: 'TIN 123-456-789',
      showPermitOrInfo: true,
      permitOrInfo: 'Permit 2026-001',
      showTerminalName: true,
      terminalName: 'POS-1',
      showCashierRole: true,
      cashierRoleLabel: 'Cashier',
      showItemCode: true,
      footerText: 'Thank you for choosing VPOS LPG.'
    }
  };
}

describe('DesktopReceiptService receipt layout', () => {
  const service = new DesktopReceiptService();

  it('builds sale receipts in the same layout pattern as mobile', () => {
    const appState = buildAppState();
    const sale = {
      id: 'sale-1',
      receiptNumber: '20260603-0000001',
      createdAt: '2026-06-03T01:56:00.000Z',
      updatedAt: '2026-06-03T01:56:00.000Z',
      syncStatus: 'pending',
      payload: {
        id: 'sale-1',
        customerId: 'cust-1',
        customerName: 'Albert',
        personnelId: 'p-1',
        personnelName: 'Driver Mike',
        helperId: 'h-1',
        helperName: 'Helper Lou',
        saleType: 'DELIVERY',
        paymentMode: 'PARTIAL',
        paymentMethod: 'CASH',
        branchLabel: 'VMJAM Main',
        locationLabel: 'Front Counter',
        subtotal: 3100,
        discountAmount: 100,
        totalAmount: 3000,
        paidAmount: 2800,
        changeAmount: 0,
        creditBalance: 200,
        notes: 'Handle with care',
        lines: [
          {
            lineId: 'line-1',
            productId: 'prod-1',
            productName: 'LPG Refill 11kg',
            subtitle: 'SKU-11',
            quantity: 2,
            unitPrice: 950,
            lineTotal: 1900
          },
          {
            lineId: 'line-2',
            productId: 'prod-2',
            productName: 'Deposit 11kg',
            subtitle: 'DEP-11',
            quantity: 1,
            unitPrice: 1100,
            lineTotal: 1100
          }
        ],
        createdAt: '2026-06-03T01:56:00.000Z'
      }
    } as DesktopSaleRecord;

    expect(service.buildSaleReceiptDocument(sale, appState)).toEqual({
      title: 'VPOS RECEIPT',
      isReprint: false,
      lines: [
        { align: 'center', text: 'VMJAM LPG', emphasis: true },
        { align: 'center', text: '0917-000-0000', emphasis: true },
        { align: 'center', text: 'Juan Luna Street', emphasis: true },
        { align: 'center', text: 'TIN 123-456-789', emphasis: true },
        { align: 'center', text: 'Permit 2026-001', emphasis: true },
        { align: 'center', text: 'Receipt #20260603-0000001', emphasis: true },
        { align: 'left', text: 'Sale ID: sale-1', emphasis: true },
        { align: 'left', text: `Date: ${new Date(sale.createdAt).toLocaleString()}`, emphasis: true },
        { align: 'left', text: 'Branch: VMJAM Main', emphasis: true },
        { align: 'left', text: 'Location: Front Counter', emphasis: true },
        { align: 'left', text: 'Terminal: POS-1', emphasis: true },
        { align: 'left', text: 'Cashier: Cashier Jane', emphasis: true },
        { align: 'left', text: 'Role: Cashier', emphasis: true },
        { align: 'left', text: 'Type: DELIVERY', emphasis: true },
        { align: 'left', text: 'Customer: Albert', emphasis: true },
        { align: 'left', text: 'Personnel: Driver Mike', emphasis: true },
        { align: 'left', text: 'Helper: Helper Lou', emphasis: true },
        { align: 'left', text: '------------------------------' },
        { align: 'left', text: '2 x SKU-11 - LPG Refill 11kg', emphasis: true },
        { align: 'right', text: '  @ 950.00 = 1900.00', emphasis: true },
        { align: 'left', text: '1 x DEP-11 - Deposit 11kg', emphasis: true },
        { align: 'right', text: '  @ 1100.00 = 1100.00', emphasis: true },
        { align: 'left', text: '------------------------------' },
        { align: 'left', text: 'QTY TOTAL: 3', emphasis: true },
        { align: 'left', text: 'ITEM COUNT: 2', emphasis: true },
        { align: 'left', text: '------------------------------' },
        { align: 'left', text: 'Subtotal: PHP 3100.00', emphasis: true },
        { align: 'left', text: 'Discount: PHP 100.00', emphasis: true },
        { align: 'left', text: '------------------------------' },
        { align: 'center', text: 'GRAND TOTAL', emphasis: true },
        { align: 'center', text: 'PHP 3000.00', emphasis: true },
        { align: 'left', text: '------------------------------' },
        { align: 'left', text: 'Total: PHP 3000.00', emphasis: true },
        { align: 'left', text: 'Paid (CASH): PHP 2800.00', emphasis: true },
        { align: 'left', text: 'Change: PHP 0.00', emphasis: true },
        { align: 'left', text: 'Credit Due: PHP 200.00', emphasis: true },
        { align: 'left', text: 'Payment Mode: PARTIAL', emphasis: true },
        { align: 'left', text: 'Notes: Handle with care', emphasis: true },
        { align: 'left', text: '------------------------------' },
        { align: 'center', text: 'BALANCE DUE: PHP 200.00', emphasis: true }
      ],
      footer: 'Thank you for choosing VPOS LPG.',
      footerEmphasis: true,
      topPaddingLines: 2,
      bottomPaddingLines: 3
    });
  });

  it('builds queue order receipts in the same layout pattern as mobile', () => {
    const appState = buildAppState();
    const payload: DesktopQueueOrderReceiptPayload = {
      queueId: 'queue-1',
      queueLabel: 'Q-001',
      branchName: 'VMJAM Main',
      locationName: 'Front Counter',
      cashierName: 'Cashier Jane',
      orderType: 'DELIVERY',
      customerName: 'Albert',
      customerAddress: 'Juan Luna Street',
      personnelName: 'Driver Mike',
      helperName: 'Helper Lou',
      lines: [
        { productId: 'prod-1', name: 'LPG Refill 11kg', subtitle: 'SKU-11', quantity: 2, unitPrice: 950 }
      ],
      subtotal: 1900,
      discount: 0,
      total: 1900,
      paidAmount: 1900,
      paymentMode: 'FULL',
      paymentMethod: 'CASH',
      notes: 'Priority queue',
      createdAt: '2026-06-03T01:56:00.000Z'
    };

    expect(service.buildQueueOrderReceiptDocument(payload, appState)).toEqual({
      title: 'VPOS QUEUE ORDER',
      isReprint: false,
      lines: [
        { align: 'center', text: 'VMJAM LPG', emphasis: true },
        { align: 'center', text: '0917-000-0000', emphasis: true },
        { align: 'center', text: 'Juan Luna Street', emphasis: true },
        { align: 'left', text: '------------------------------' },
        { align: 'center', text: 'QUEUE ORDER', emphasis: true },
        { align: 'center', text: 'Q-001', emphasis: true },
        { align: 'left', text: 'Queue ID: queue-1', emphasis: true },
        { align: 'left', text: `Date: ${new Date(payload.createdAt).toLocaleString()}`, emphasis: true },
        { align: 'left', text: 'Branch: VMJAM Main', emphasis: true },
        { align: 'left', text: 'Location: Front Counter', emphasis: true },
        { align: 'left', text: 'Cashier: Cashier Jane', emphasis: true },
        { align: 'left', text: 'Type: DELIVERY', emphasis: true },
        { align: 'left', text: 'Customer: Albert', emphasis: true },
        { align: 'left', text: 'Address: Juan Luna Street', emphasis: true },
        { align: 'left', text: 'Personnel: Driver Mike', emphasis: true },
        { align: 'left', text: 'Helper: Helper Lou', emphasis: true },
        { align: 'left', text: '------------------------------' },
        { align: 'left', text: '2 x SKU-11 - LPG Refill 11kg', emphasis: true },
        { align: 'right', text: '  @ 950.00 = 1900.00', emphasis: true },
        { align: 'left', text: '------------------------------' },
        { align: 'left', text: 'QTY TOTAL: 2', emphasis: true },
        { align: 'left', text: 'ITEM COUNT: 1', emphasis: true },
        { align: 'left', text: 'Subtotal: PHP 1900.00', emphasis: true },
        { align: 'left', text: 'Discount: PHP 0.00', emphasis: true },
        { align: 'left', text: 'Total: PHP 1900.00', emphasis: true },
        { align: 'left', text: 'Paid: PHP 1900.00', emphasis: true },
        { align: 'left', text: 'Payment Mode: FULL', emphasis: true },
        { align: 'left', text: 'Payment: CASH', emphasis: true },
        { align: 'left', text: 'Notes: Priority queue', emphasis: true },
        { align: 'left', text: '------------------------------' }
      ],
      footer: 'Thank you for choosing VPOS LPG.',
      footerEmphasis: true
    });
  });

  it('builds balance payment receipts in the same layout pattern as mobile', () => {
    const appState = buildAppState();
    const payload: DesktopCustomerPaymentReceiptPayload = {
      customerName: 'Albert',
      customerAddress: 'Juan Luna Street',
      amount: 500,
      remainingBalance: 200,
      method: 'CARD',
      referenceNo: 'OR-1234',
      notes: 'Paid at counter',
      createdAt: '2026-06-03T01:56:00.000Z'
    };

    expect(service.buildCustomerPaymentReceiptDocument(payload, appState)).toEqual({
      title: 'VPOS BALANCE PAYMENT',
      isReprint: false,
      lines: [
        { align: 'center', text: 'VMJAM LPG', emphasis: true },
        { align: 'left', text: 'Branch: VMJAM Main', emphasis: true },
        { align: 'left', text: 'Location: Front Counter', emphasis: true },
        { align: 'left', text: 'Cashier: Cashier Jane', emphasis: true },
        { align: 'left', text: '------------------------------' },
        { align: 'center', text: 'BALANCE PAYMENT', emphasis: true },
        { align: 'left', text: `Date: ${new Date(payload.createdAt).toLocaleString()}`, emphasis: true },
        { align: 'left', text: 'Customer: Albert', emphasis: true },
        { align: 'left', text: 'Address: Juan Luna Street', emphasis: true },
        { align: 'left', text: '------------------------------' },
        { align: 'left', text: 'Paid: PHP 500.00', emphasis: true },
        { align: 'left', text: 'Remaining: PHP 200.00', emphasis: true },
        { align: 'left', text: 'Method: CARD', emphasis: true },
        { align: 'left', text: 'Reference: OR-1234', emphasis: true },
        { align: 'left', text: 'Notes: Paid at counter', emphasis: true }
      ],
      footer: 'Thank you for choosing VPOS LPG.',
      footerEmphasis: true,
      topPaddingLines: 2,
      bottomPaddingLines: 3
    });
  });
});
