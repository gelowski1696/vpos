import {
  type PrinterAdapter,
  type ReceiptDocument,
  type ReceiptLine
} from '@vpos/printing-core';
import type { DesktopAppState, DesktopSaleRecord } from '../db/schema';
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

function buildPrintableLines(doc: ReceiptDocument): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  lines.push({ align: 'center', emphasis: true, text: doc.title });
  lines.push(...doc.lines);
  if (doc.footer) {
    lines.push({ align: 'center', emphasis: doc.footerEmphasis ?? false, text: doc.footer });
  }
  return lines;
}

export class DesktopReceiptService {
  private async printLines(lines: ReceiptLine[], appState: DesktopAppState): Promise<void> {
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
      } catch (error) {
        // Fall back to print dialog so cashier flow is not blocked by native printer setup issues.
        // eslint-disable-next-line no-console
        console.warn('[VPOS DESKTOP] Native printer transport failed, falling back to print dialog.', error);
      }
    }

    const adapter = new BrowserPrintAdapter();
    await adapter.print(lines);
  }

  buildSaleReceiptDocument(sale: DesktopSaleRecord, appState: DesktopAppState): ReceiptDocument {
    const lines: ReceiptLine[] = [
      { align: 'center', text: appState.setup.branchLabel || 'VPOS Desktop', emphasis: true },
      { align: 'center', text: appState.setup.locationLabel || 'Cashier Station' },
      { align: 'center', text: new Date(sale.createdAt).toLocaleString() },
      { text: '--------------------------------' },
      { text: `Receipt: ${sale.receiptNumber}` },
      { text: `Cashier: ${appState.setup.operatorName || 'Operator'}` },
      { text: `Customer: ${sale.payload.customerName || 'Walk-in'}` },
      { text: `Payment: ${sale.payload.paymentMethod}` },
      { text: `Sale Type: ${sale.payload.saleType}` },
      { text: '--------------------------------' }
    ];

    for (const line of sale.payload.lines) {
      lines.push({
        text: `${line.productName} x${line.quantity}`
      });
      lines.push({
        text: `${money(line.unitPrice)}  ${money(line.lineTotal)}`,
        align: 'right'
      });
    }

    lines.push({ text: '--------------------------------' });
    lines.push({ text: `Subtotal ${money(sale.payload.subtotal)}`, align: 'right' });
    lines.push({ text: `Discount ${money(sale.payload.discountAmount)}`, align: 'right' });
    lines.push({ text: `Total ${money(sale.payload.totalAmount)}`, align: 'right', emphasis: true });

    if (sale.payload.notes) {
      lines.push({ text: '--------------------------------' });
      lines.push({ text: `Notes: ${sale.payload.notes}` });
    }

    return {
      title: 'VPOS SALES RECEIPT',
      lines,
      footer: 'Thank you. Please keep this receipt.',
      footerEmphasis: false
    };
  }

  async printSaleReceipt(sale: DesktopSaleRecord, appState: DesktopAppState): Promise<void> {
    const lines = buildPrintableLines(this.buildSaleReceiptDocument(sale, appState));
    await this.printLines(lines, appState);
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
    await this.printLines(lines, appState);
  }
}

export const desktopReceiptService = new DesktopReceiptService();
