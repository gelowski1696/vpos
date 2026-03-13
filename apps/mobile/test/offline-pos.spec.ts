import type { PrinterAdapter, ReceiptLine } from '@vpos/printing-core';
import { OfflinePosService } from '../src/features/pos/offline-pos.service';

type ReceiptState = {
  sale_id: string;
  receipt_number: string;
  payload: string;
  reprint_count: number;
};

function createDbMock(): {
  state: {
    sales: Map<string, { payload: string }>;
    receipts: Map<string, ReceiptState>;
    outboxInserts: number;
  };
  db: {
    runAsync: jest.Mock;
    getFirstAsync: jest.Mock;
  };
} {
  const state = {
    sales: new Map<string, { payload: string }>(),
    receipts: new Map<string, ReceiptState>(),
    outboxInserts: 0
  };

  const db = {
    runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('INSERT INTO sales_local')) {
        state.sales.set(String(params[0]), { payload: String(params[1]) });
      }
      if (normalized.includes('INSERT INTO outbox')) {
        state.outboxInserts += 1;
      }
      if (normalized.includes('INSERT INTO receipts_local')) {
        state.receipts.set(String(params[0]), {
          sale_id: String(params[0]),
          receipt_number: String(params[1]),
          payload: String(params[2]),
          reprint_count: 0
        });
      }
      if (normalized.includes('UPDATE receipts_local SET reprint_count = reprint_count + 1')) {
        const row = state.receipts.get(String(params[1]));
        if (row) {
          row.reprint_count += 1;
        }
      }
      return { changes: 1, lastInsertRowId: 1 };
    }),
    getFirstAsync: jest.fn(async (_sql: string, ...params: unknown[]) => {
      const saleId = String(params[0]);
      return state.receipts.get(saleId) ?? null;
    })
  };

  return { state, db };
}

class CapturePrinterAdapter implements PrinterAdapter {
  readonly batches: ReceiptLine[][] = [];

  async print(lines: ReceiptLine[]): Promise<void> {
    this.batches.push(lines);
  }

  async testPrint(): Promise<void> {
    return;
  }
}

describe('OfflinePosService', () => {
  it('supports product search, barcode scan, and favorites toggling', () => {
    const { db } = createDbMock();
    const service = new OfflinePosService(db as never, new CapturePrinterAdapter());
    service.setCatalog([
      { id: 'prod-11', name: 'LPG Refill 11kg', unitPrice: 950, barcode: '111111' },
      { id: 'prod-22', name: 'LPG Refill 22kg', unitPrice: 1800, barcode: '222222' }
    ]);

    expect(service.searchProducts('11kg')).toHaveLength(1);
    expect(service.scanBarcode('222222')?.id).toBe('prod-22');
    expect(service.toggleFavorite('prod-11')).toBe(true);
    expect(service.searchProducts('prod-11')[0].isFavorite).toBe(true);
  });

  it('creates offline sale, stores receipt, and prints initial receipt without reprint marker', async () => {
    const { db, state } = createDbMock();
    const printer = new CapturePrinterAdapter();
    const service = new OfflinePosService(db as never, printer);

    service.setCatalog([{ id: 'prod-11', name: 'LPG Refill 11kg', unitPrice: 950, barcode: '111111' }]);
    service.addToCart('prod-11', 2);
    service.setDiscountAmount(50);
    service.setSplitPayments([
      { method: 'CASH', amount: 1000 },
      { method: 'CARD', amount: 850 }
    ]);

    const checkout = await service.checkout({
      branchId: 'branch-main',
      locationId: 'loc-main',
      customerId: 'cust-walkin',
      saleType: 'PICKUP'
    });

    expect(checkout.receiptDocument.isReprint).toBe(false);
    expect(state.sales.size).toBe(1);
    expect(state.receipts.get(checkout.saleId)?.reprint_count).toBe(0);
    expect(printer.batches).toHaveLength(1);
    expect(printer.batches[0][0].text).toBe('VPOS RECEIPT');
  });

  it('reprints receipt with REPRINT marker and queues reprint event', async () => {
    const { db, state } = createDbMock();
    const printer = new CapturePrinterAdapter();
    const service = new OfflinePosService(db as never, printer);

    service.setCatalog([{ id: 'prod-11', name: 'LPG Refill 11kg', unitPrice: 950 }]);
    service.addToCart('prod-11', 1);
    service.setSplitPayments([{ method: 'CASH', amount: 950 }]);

    const checkout = await service.checkout({
      branchId: 'branch-main',
      locationId: 'loc-main'
    });

    const reprint = await service.reprint(checkout.saleId);

    expect(reprint.receiptDocument.isReprint).toBe(true);
    expect(state.receipts.get(checkout.saleId)?.reprint_count).toBe(1);
    expect(printer.batches).toHaveLength(2);
    expect(printer.batches[1].some((line) => line.text.includes('REPRINT'))).toBe(true);
    expect(state.outboxInserts).toBeGreaterThanOrEqual(2);
  });

  it('rejects checkout when split payments do not match net total', async () => {
    const { db } = createDbMock();
    const service = new OfflinePosService(db as never, new CapturePrinterAdapter());

    service.setCatalog([{ id: 'prod-11', name: 'LPG Refill 11kg', unitPrice: 950 }]);
    service.addToCart('prod-11', 1);
    service.setSplitPayments([{ method: 'CASH', amount: 900 }]);

    await expect(
      service.checkout({
        branchId: 'branch-main',
        locationId: 'loc-main'
      })
    ).rejects.toThrow('Split payment total must match sale total');
  });
});
