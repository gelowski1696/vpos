import type { PrinterAdapter, PrinterType } from '@vpos/printing-core';
import { MobilePrinterService } from '../src/features/printer/mobile-printer.service';

type PrinterSettingsRow = {
  device_id: string;
  printer_type: PrinterType;
  config_json: string | null;
  updated_at: string;
};

function createDbMock(): {
  rows: Map<string, PrinterSettingsRow>;
  db: {
    getFirstAsync: jest.Mock;
    runAsync: jest.Mock;
  };
} {
  const rows = new Map<string, PrinterSettingsRow>();

  const db = {
    getFirstAsync: jest.fn(async (_sql: string, ...params: unknown[]) => {
      return rows.get(String(params[0])) ?? null;
    }),
    runAsync: jest.fn(async (_sql: string, ...params: unknown[]) => {
      const row: PrinterSettingsRow = {
        device_id: String(params[0]),
        printer_type: String(params[1]) as PrinterType,
        config_json: (params[2] as string | null) ?? null,
        updated_at: String(params[3])
      };
      rows.set(row.device_id, row);
      return { changes: 1 };
    })
  };

  return { rows, db };
}

function createAdapterFactory(): {
  adapterFactory: (type: PrinterType) => PrinterAdapter;
  calls: PrinterType[];
  testCalls: PrinterType[];
} {
  const calls: PrinterType[] = [];
  const testCalls: PrinterType[] = [];

  return {
    adapterFactory: (type: PrinterType) => {
      calls.push(type);
      return {
        print: jest.fn(async () => undefined),
        testPrint: jest.fn(async () => {
          testCalls.push(type);
        })
      };
    },
    calls,
    testCalls
  };
}

describe('MobilePrinterService', () => {
  it('returns default NONE preference when no persisted row exists', async () => {
    const { db } = createDbMock();
    const service = new MobilePrinterService({
      db: db as never,
      deviceId: 'dev-printer-1'
    });

    const preference = await service.getPreference();

    expect(preference.deviceId).toBe('dev-printer-1');
    expect(preference.printerType).toBe('NONE');
    expect(preference.config).toBeNull();
  });

  it('persists and returns selected printer preference per device', async () => {
    const { db, rows } = createDbMock();
    const service = new MobilePrinterService({
      db: db as never,
      deviceId: 'dev-printer-2'
    });

    await service.setPreference({
      printerType: 'BLUETOOTH',
      config: { mac_address: 'AA:BB:CC:DD:EE:FF' }
    });

    const persisted = rows.get('dev-printer-2');
    const loaded = await service.getPreference();

    expect(persisted?.printer_type).toBe('BLUETOOTH');
    expect(loaded.printerType).toBe('BLUETOOTH');
    expect(loaded.config).toEqual({ mac_address: 'AA:BB:CC:DD:EE:FF' });
  });

  it('dispatches test print using adapter selected from current preference', async () => {
    const { db } = createDbMock();
    const { adapterFactory, calls, testCalls } = createAdapterFactory();
    const service = new MobilePrinterService({
      db: db as never,
      deviceId: 'dev-printer-3',
      adapterFactory: (type) => adapterFactory(type)
    });

    await service.setPreference({ printerType: 'IMIN' });
    await expect(service.runTestPrint()).resolves.toBe(true);

    expect(calls).toContain('IMIN');
    expect(testCalls).toContain('IMIN');
  });
});
