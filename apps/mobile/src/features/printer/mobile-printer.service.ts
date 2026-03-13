import {
  EscPosAdapter,
  IMinAdapter,
  type NativePrinterTransport,
  NoPrinterAdapter,
  type PrinterAdapter,
  type PrinterType,
  type ReceiptDocument,
  type ReceiptLine,
  printReceipt,
  printXRead,
  printZRead,
  testPrint
} from '@vpos/printing-core';
import { createNativePrinterTransport, getNativePrinterCapabilities } from './native-printer.bridge';

type DatabaseLike = {
  getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
};

type StoredPrinterSetting = {
  device_id: string;
  printer_type: PrinterType;
  config_json: string | null;
  updated_at: string;
};

export type MobilePrinterPreference = {
  deviceId: string;
  printerType: PrinterType;
  config: Record<string, unknown> | null;
  updatedAt: string;
};

export type PrinterSetupInput = {
  printerType: PrinterType;
  config?: Record<string, unknown> | null;
};

export type MobilePrinterAdapterFactory = (type: PrinterType, config: Record<string, unknown> | null) => PrinterAdapter;

type MobilePrinterServiceOptions = {
  db?: DatabaseLike;
  deviceId?: string;
  adapterFactory?: MobilePrinterAdapterFactory;
};

export type MobilePrinterRuntimeCapabilities = {
  moduleAvailable: boolean;
  platform: string;
  isAndroid: boolean;
  hasIminSdk: boolean;
  hasBluetooth: boolean;
  supportsTcpEscPos: boolean;
};

const DEFAULT_DEVICE_ID = 'mobile-device-local';
const DEFAULT_PRINTER_TYPE: PrinterType = 'NONE';

export class MobilePrinterService {
  private readonly db?: DatabaseLike;
  private readonly deviceId: string;
  private readonly adapterFactory: MobilePrinterAdapterFactory;
  private inMemoryPreference: MobilePrinterPreference;

  constructor(options: MobilePrinterServiceOptions = {}) {
    this.db = options.db;
    this.deviceId = options.deviceId ?? DEFAULT_DEVICE_ID;
    this.adapterFactory = options.adapterFactory ?? defaultAdapterFactory;
    this.inMemoryPreference = this.defaultPreference();
  }

  async getPreference(): Promise<MobilePrinterPreference> {
    if (!this.db) {
      return this.inMemoryPreference;
    }

    const row = await this.db.getFirstAsync<StoredPrinterSetting>(
      'SELECT device_id, printer_type, config_json, updated_at FROM printer_settings WHERE device_id = ?',
      this.deviceId
    );
    if (!row) {
      const created = this.defaultPreference();
      await this.persistPreference(created);
      return created;
    }

    const preference = this.fromStoredRow(row);
    this.inMemoryPreference = preference;
    return preference;
  }

  async setPreference(input: PrinterSetupInput): Promise<MobilePrinterPreference> {
    const now = new Date().toISOString();
    const preference: MobilePrinterPreference = {
      deviceId: this.deviceId,
      printerType: input.printerType,
      config: input.config ?? null,
      updatedAt: now
    };

    if (this.db) {
      await this.persistPreference(preference);
    }

    this.inMemoryPreference = preference;
    return preference;
  }

  getAvailablePrinterTypes(): PrinterType[] {
    return ['IMIN', 'GENERIC_BUILTIN', 'BLUETOOTH', 'NONE'];
  }

  async getRuntimeCapabilities(): Promise<MobilePrinterRuntimeCapabilities> {
    return getNativePrinterCapabilities();
  }

  async runTestPrint(): Promise<boolean> {
    const preference = await this.getPreference();
    const adapter = this.selectAdapter(preference);
    await testPrint(adapter);
    return true;
  }

  async printReceiptDocument(document: ReceiptDocument): Promise<void> {
    const preference = await this.getPreference();
    await printReceipt(this.selectAdapter(preference), document);
  }

  async printXReadSummary(lines: ReceiptLine[]): Promise<void> {
    const preference = await this.getPreference();
    await printXRead(this.selectAdapter(preference), lines);
  }

  async printZReadSummary(lines: ReceiptLine[]): Promise<void> {
    const preference = await this.getPreference();
    await printZRead(this.selectAdapter(preference), lines);
  }

  private defaultPreference(): MobilePrinterPreference {
    return {
      deviceId: this.deviceId,
      printerType: DEFAULT_PRINTER_TYPE,
      config: null,
      updatedAt: new Date().toISOString()
    };
  }

  private fromStoredRow(row: StoredPrinterSetting): MobilePrinterPreference {
    return {
      deviceId: row.device_id,
      printerType: row.printer_type,
      config: row.config_json ? this.parseConfig(row.config_json) : null,
      updatedAt: row.updated_at
    };
  }

  private async persistPreference(preference: MobilePrinterPreference): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.runAsync(
      `
      INSERT INTO printer_settings(device_id, printer_type, config_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(device_id)
      DO UPDATE SET
        printer_type = excluded.printer_type,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at
      `,
      preference.deviceId,
      preference.printerType,
      preference.config ? JSON.stringify(preference.config) : null,
      preference.updatedAt
    );
  }

  private selectAdapter(preference: MobilePrinterPreference): PrinterAdapter {
    return this.adapterFactory(preference.printerType, preference.config);
  }

  private parseConfig(serialized: string): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(serialized) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

const nativeTransport: NativePrinterTransport = createNativePrinterTransport();

const defaultAdapterFactory: MobilePrinterAdapterFactory = (type, config): PrinterAdapter => {
  switch (type) {
    case 'IMIN':
      return new IMinAdapter(nativeTransport, config);
    case 'GENERIC_BUILTIN':
      return new EscPosAdapter(nativeTransport, config, 'GENERIC_BUILTIN');
    case 'BLUETOOTH':
      return new EscPosAdapter(nativeTransport, config, 'BLUETOOTH');
    case 'NONE':
    default:
      return new NoPrinterAdapter();
  }
};
