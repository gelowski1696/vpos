import {
  materializeReceiptDocument,
  type PrinterAdapter,
  type ReceiptDocument,
  type ReceiptLine
} from '@vpos/printing-core/src/index';
import {
  buildVposCustomerPaymentReceiptDocument,
  buildVposQueueOrderReceiptDocument,
  buildVposSaleReceiptDocument
} from '@vpos/printing-core/src/vpos-receipts';
import type {
  DesktopAppState,
  DesktopReceiptLayoutSettings,
  DesktopSaleRecord
} from '../db/schema';
import { printEscPosNative } from './desktop-printer.bridge';

function money(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class BrowserPrintAdapter implements PrinterAdapter {
  async print(lines: ReceiptLine[]): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('Receipt printing is only available in the desktop window.');
    }

    const popup = window.open('', 'vpos-desktop-receipt', 'width=420,height=760');
    if (!popup) {
      throw new Error('Unable to open receipt window. Please allow popups in the desktop shell.');
    }

    popup.document.open();
    popup.document.write(this.renderDocument(lines));
    popup.document.close();
    popup.focus();

    window.setTimeout(() => {
      popup.print();
    }, 250);
  }

  async testPrint(): Promise<void> {
    await this.print([{ align: 'center', emphasis: true, text: 'VPOS Desktop Test Print' }]);
  }

  private renderDocument(lines: ReceiptLine[]): string {
    const body = lines
      .map((line) => {
        if (line.imageBase64) {
          return `<div class="image-line"><img src="data:image/png;base64,${line.imageBase64}" style="max-width:${line.imageWidth ?? 220}px;" /></div>`;
        }
        const classes = ['receipt-line', `align-${line.align ?? 'left'}`, line.emphasis ? 'emphasis' : '']
          .filter(Boolean)
          .join(' ');
        return `<div class="${classes}">${escapeHtml(line.text)}</div>`;
      })
      .join('');

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>VPOS Desktop Receipt</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        background: #f6f2ec;
        font-family: "Consolas", "Courier New", monospace;
      }
      .receipt {
        width: 320px;
        margin: 0 auto;
        background: #fff;
        border: 1px solid #d9d2c7;
        border-radius: 16px;
        padding: 20px 18px;
        box-shadow: 0 14px 28px rgba(57, 38, 19, 0.12);
      }
      .receipt-line {
        white-space: pre-wrap;
        line-height: 1.45;
        font-size: 13px;
      }
      .align-left { text-align: left; }
      .align-center { text-align: center; }
      .align-right { text-align: right; }
      .emphasis { font-weight: 700; }
      .image-line { text-align: center; margin-bottom: 8px; }
      @media print {
        body {
          background: #fff;
          padding: 0;
        }
        .receipt {
          border: none;
          border-radius: 0;
          box-shadow: none;
          width: auto;
          padding: 0;
        }
      }
    </style>
  </head>
  <body>
    <section class="receipt">${body}</section>
  </body>
</html>`;
  }
}

export type DesktopQueueOrderReceiptPayload = {
  queueId: string;
  queueLabel: string;
  branchName: string;
  locationName: string;
  cashierName: string | null;
  orderType: 'PICKUP' | 'DELIVERY';
  customerName: string | null;
  customerAddress?: string | null;
  personnelName: string | null;
  helperName: string | null;
  lines: Array<{ productId?: string | null; name: string; quantity: number; unitPrice: number; subtitle?: string | null }>;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  paymentMode: 'FULL' | 'PARTIAL';
  paymentMethod: 'CASH' | 'CARD' | 'E_WALLET';
  notes?: string | null;
  createdAt: string;
};

export type DesktopCustomerPaymentReceiptPayload = {
  customerName: string;
  customerAddress?: string | null;
  amount: number;
  remainingBalance: number;
  method: 'CASH' | 'CARD' | 'E_WALLET';
  referenceNo?: string | null;
  notes?: string | null;
  createdAt: string;
};

export class DesktopReceiptService {
  private async printLines(
    lines: ReceiptLine[],
    appState: DesktopAppState,
    options: { allowBrowserFallback?: boolean } = {}
  ): Promise<void> {
    const allowBrowserFallback = options.allowBrowserFallback ?? true;
    const printerMode = appState.setup.printerMode;
    const nativePrintable = printerMode === 'USB' || printerMode === 'LAN';

    if (nativePrintable) {
      try {
        const didPrintNatively = await printEscPosNative(lines, {
          mode: printerMode,
          printerName: appState.setup.printerName || null,
          printerHost: appState.setup.printerHost || null,
          printerPort: appState.setup.printerPort ? Number(appState.setup.printerPort) : null
        });
        if (didPrintNatively) {
          return;
        }
        if (!allowBrowserFallback) {
          throw new Error('Native desktop printer transport is not available. Open VPOS in the desktop app to run a printer test.');
        }
      } catch (error) {
        if (!allowBrowserFallback) {
          throw error;
        }
        // Fall back to print dialog so cashier flow is not blocked by native printer setup issues.
        // eslint-disable-next-line no-console
        console.warn('[VPOS DESKTOP] Native printer transport failed, falling back to print dialog.', error);
      }
    } else if (!allowBrowserFallback) {
      throw new Error('Choose USB or LAN before running a printer test.');
    }

    const adapter = new BrowserPrintAdapter();
    await adapter.print(lines);
  }

  buildSaleReceiptDocument(sale: DesktopSaleRecord, appState: DesktopAppState): ReceiptDocument {
    return buildVposSaleReceiptDocument(
      {
        receiptNumber: sale.receiptNumber,
        saleId: sale.payload.id,
        branchName: sale.payload.branchLabel || appState.setup.branchLabel,
        locationName: sale.payload.locationLabel || appState.setup.locationLabel,
        cashierName: appState.setup.operatorName || null,
        orderType: sale.payload.saleType,
        customerName: sale.payload.customerName,
        personnelName: sale.payload.personnelName ?? null,
        helperName: sale.payload.helperName ?? null,
        lines: sale.payload.lines.map((line) => ({
          name: line.productName,
          subtitle: line.subtitle ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice
        })),
        subtotal: sale.payload.subtotal,
        discount: sale.payload.discountAmount,
        total: sale.payload.totalAmount,
        paidAmount: sale.payload.paidAmount ?? sale.payload.totalAmount,
        changeAmount: sale.payload.changeAmount ?? 0,
        creditBalance: sale.payload.creditBalance ?? 0,
        notes: sale.payload.notes,
        paymentMode: sale.payload.paymentMode ?? 'FULL',
        paymentMethod: sale.payload.paymentMethod,
        rewardRedemptionUsed: sale.payload.rewardRedemptionUsed,
        hideAmounts: sale.payload.hideAmounts === true,
        createdAt: sale.createdAt
      },
      appState.receiptLayout
    );
  }

  buildQueueOrderReceiptDocument(input: DesktopQueueOrderReceiptPayload, appState: DesktopAppState): ReceiptDocument {
    return buildVposQueueOrderReceiptDocument(
      {
        queueId: input.queueId,
        queueLabel: input.queueLabel,
        branchName: input.branchName,
        locationName: input.locationName,
        cashierName: input.cashierName,
        orderType: input.orderType,
        customerName: input.customerName,
        customerAddress: input.customerAddress ?? null,
        personnelName: input.personnelName,
        helperName: input.helperName,
        lines: input.lines.map((line) => ({
          name: line.name,
          subtitle: line.subtitle ?? null,
          quantity: line.quantity,
          unitPrice: line.unitPrice
        })),
        subtotal: input.subtotal,
        discount: input.discount,
        total: input.total,
        paidAmount: input.paidAmount,
        notes: input.notes,
        paymentMode: input.paymentMode,
        paymentMethod: input.paymentMethod,
        createdAt: input.createdAt
      },
      appState.receiptLayout
    );
  }

  buildCustomerPaymentReceiptDocument(
    input: DesktopCustomerPaymentReceiptPayload,
    appState: DesktopAppState
  ): ReceiptDocument {
    return buildVposCustomerPaymentReceiptDocument(
      {
        branchName: appState.setup.branchLabel || null,
        locationName: appState.setup.locationLabel || null,
        cashierName: appState.setup.operatorName || null,
        customerName: input.customerName,
        customerAddress: input.customerAddress ?? null,
        amount: input.amount,
        remainingBalance: input.remainingBalance,
        method: input.method,
        referenceNo: input.referenceNo ?? null,
        notes: input.notes ?? null,
        createdAt: input.createdAt
      },
      appState.receiptLayout
    );
  }

  async printSaleReceipt(sale: DesktopSaleRecord, appState: DesktopAppState): Promise<void> {
    const lines = materializeReceiptDocument(this.buildSaleReceiptDocument(sale, appState));
    await this.printLines(lines, appState);
  }

  async printQueueOrderReceipt(input: DesktopQueueOrderReceiptPayload, appState: DesktopAppState): Promise<void> {
    const lines = materializeReceiptDocument(this.buildQueueOrderReceiptDocument(input, appState));
    await this.printLines(lines, appState);
  }

  async printCustomerPaymentReceipt(
    input: DesktopCustomerPaymentReceiptPayload,
    appState: DesktopAppState
  ): Promise<void> {
    const lines = materializeReceiptDocument(this.buildCustomerPaymentReceiptDocument(input, appState));
    await this.printLines(lines, appState);
  }

  buildLayoutTestReceiptDocument(layout: DesktopReceiptLayoutSettings, appState: DesktopAppState): ReceiptDocument {
    const now = new Date().toISOString();
    return buildVposSaleReceiptDocument(
      {
        receiptNumber: 'TEST-000123',
        saleId: 'sale-test-001',
        branchName: appState.setup.branchLabel || 'Branch Name',
        locationName: appState.setup.locationLabel || 'Counter 1',
        cashierName: appState.setup.operatorName || 'Cashier',
        orderType: 'PICKUP',
        customerName: 'Walk-in Customer',
        personnelName: 'Assigned Driver',
        helperName: 'Assigned Helper',
        lines: [
          {
            name: 'Shinegas 11kg',
            subtitle: 'SKU-011',
            quantity: 1,
            unitPrice: 980
          }
        ],
        subtotal: 980,
        discount: 20,
        total: 960,
        paidAmount: 1000,
        changeAmount: 40,
        creditBalance: 0,
        notes: 'Layout preview',
        paymentMode: 'FULL',
        paymentMethod: 'CASH',
        createdAt: now
      },
      {
        ...layout,
        storeContactInfo: layout.storeContactInfo || '0917-000-0000',
        storeAddress: layout.storeAddress || 'Store Address',
        cashierRoleLabel: layout.cashierRoleLabel || 'Cashier'
      }
    );
  }

  async testPrinter(appState: DesktopAppState): Promise<void> {
    const lines: ReceiptLine[] = [
      { align: 'center', emphasis: true, text: 'VPOS DESKTOP TEST' },
      { align: 'center', text: appState.setup.branchLabel || 'Branch Not Set' },
      { align: 'center', text: appState.setup.locationLabel || 'Location Not Set' },
      { text: '--------------------------------' },
      { text: `Printer Mode: ${appState.setup.printerMode}` },
      { text: `Printer Name: ${appState.setup.printerName || 'Not set'}` },
      { text: `Printer Host: ${appState.setup.printerHost || 'Not set'}` },
      { text: `Printer Port: ${appState.setup.printerPort || '9100'}` },
      { text: '--------------------------------' },
      { text: 'If this printed correctly, this desktop station is ready.' }
    ];
    await this.printLines(lines, appState, { allowBrowserFallback: false });
  }

  async testReceiptLayout(
    layout: DesktopReceiptLayoutSettings,
    appState: DesktopAppState
  ): Promise<void> {
    const lines = materializeReceiptDocument(this.buildLayoutTestReceiptDocument(layout, appState));
    await this.printLines(lines, appState, { allowBrowserFallback: false });
  }
}

export const desktopReceiptService = new DesktopReceiptService();
