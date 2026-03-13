import type { SQLiteDatabase } from 'expo-sqlite';

export type ReceiptLayoutSettings = {
  showHeaderLogoImage: boolean;
  headerLogoImageDataUrl: string;
  headerLogoPlacement: 'LEFT' | 'CENTER' | 'RIGHT';
  showHeaderLogoText: boolean;
  headerLogoText: string;
  showStoreContact: boolean;
  storeContactInfo: string;
  showStoreAddress: boolean;
  storeAddress: string;
  showBusinessTin: boolean;
  businessTin: string;
  showPermitOrInfo: boolean;
  permitOrInfo: string;
  showTerminalName: boolean;
  terminalName: string;
  showReceiptNumber: boolean;
  showSaleId: boolean;
  showDateTime: boolean;
  showBranch: boolean;
  showLocation: boolean;
  showCashier: boolean;
  showCashierRole: boolean;
  cashierRoleLabel: string;
  showOrderType: boolean;
  showCustomer: boolean;
  showPersonnel: boolean;
  showHelper: boolean;
  showItemCode: boolean;
  showPaymentMode: boolean;
  showSubtotal: boolean;
  showDiscount: boolean;
  showTotal: boolean;
  showPaid: boolean;
  showChange: boolean;
  showCreditDue: boolean;
  showFooter: boolean;
  footerText: string;
  topPaddingLines: number;
  bottomPaddingLines: number;
};

export const DEFAULT_RECEIPT_LAYOUT_SETTINGS: ReceiptLayoutSettings = {
  showHeaderLogoImage: false,
  headerLogoImageDataUrl: '',
  headerLogoPlacement: 'CENTER',
  showHeaderLogoText: true,
  headerLogoText: 'VMJAM LPG',
  showStoreContact: false,
  storeContactInfo: '',
  showStoreAddress: false,
  storeAddress: '',
  showBusinessTin: false,
  businessTin: '',
  showPermitOrInfo: false,
  permitOrInfo: '',
  showTerminalName: false,
  terminalName: '',
  showReceiptNumber: true,
  showSaleId: true,
  showDateTime: true,
  showBranch: true,
  showLocation: true,
  showCashier: true,
  showCashierRole: false,
  cashierRoleLabel: '',
  showOrderType: true,
  showCustomer: true,
  showPersonnel: true,
  showHelper: true,
  showItemCode: false,
  showPaymentMode: true,
  showSubtotal: true,
  showDiscount: true,
  showTotal: true,
  showPaid: true,
  showChange: true,
  showCreditDue: true,
  showFooter: true,
  footerText: 'Thank you for choosing VPOS LPG.',
  topPaddingLines: 2,
  bottomPaddingLines: 3
};

type StoredReceiptLayoutRow = {
  config_json: string | null;
};

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function toPlacement(value: unknown, fallback: 'LEFT' | 'CENTER' | 'RIGHT'): 'LEFT' | 'CENTER' | 'RIGHT' {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized === 'LEFT' || normalized === 'CENTER' || normalized === 'RIGHT') {
    return normalized;
  }
  return fallback;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const rounded = Math.round(parsed);
  if (rounded < 0) {
    return 0;
  }
  if (rounded > 12) {
    return 12;
  }
  return rounded;
}

export function normalizeReceiptLayoutSettings(value: unknown): ReceiptLayoutSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_RECEIPT_LAYOUT_SETTINGS };
  }
  const raw = value as Record<string, unknown>;
  return {
    showHeaderLogoImage: toBoolean(raw.showHeaderLogoImage, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showHeaderLogoImage),
    headerLogoImageDataUrl: toString(raw.headerLogoImageDataUrl, DEFAULT_RECEIPT_LAYOUT_SETTINGS.headerLogoImageDataUrl),
    headerLogoPlacement: toPlacement(raw.headerLogoPlacement, DEFAULT_RECEIPT_LAYOUT_SETTINGS.headerLogoPlacement),
    showHeaderLogoText: toBoolean(raw.showHeaderLogoText, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showHeaderLogoText),
    headerLogoText: toString(raw.headerLogoText, DEFAULT_RECEIPT_LAYOUT_SETTINGS.headerLogoText),
    showStoreContact: toBoolean(raw.showStoreContact, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showStoreContact),
    storeContactInfo: toString(raw.storeContactInfo, DEFAULT_RECEIPT_LAYOUT_SETTINGS.storeContactInfo),
    showStoreAddress: toBoolean(raw.showStoreAddress, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showStoreAddress),
    storeAddress: toString(raw.storeAddress, DEFAULT_RECEIPT_LAYOUT_SETTINGS.storeAddress),
    showBusinessTin: toBoolean(raw.showBusinessTin, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showBusinessTin),
    businessTin: toString(raw.businessTin, DEFAULT_RECEIPT_LAYOUT_SETTINGS.businessTin),
    showPermitOrInfo: toBoolean(raw.showPermitOrInfo, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showPermitOrInfo),
    permitOrInfo: toString(raw.permitOrInfo, DEFAULT_RECEIPT_LAYOUT_SETTINGS.permitOrInfo),
    showTerminalName: toBoolean(raw.showTerminalName, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showTerminalName),
    terminalName: toString(raw.terminalName, DEFAULT_RECEIPT_LAYOUT_SETTINGS.terminalName),
    showReceiptNumber: toBoolean(raw.showReceiptNumber, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showReceiptNumber),
    showSaleId: toBoolean(raw.showSaleId, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showSaleId),
    showDateTime: toBoolean(raw.showDateTime, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showDateTime),
    showBranch: toBoolean(raw.showBranch, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showBranch),
    showLocation: toBoolean(raw.showLocation, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showLocation),
    showCashier: toBoolean(raw.showCashier, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showCashier),
    showCashierRole: toBoolean(raw.showCashierRole, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showCashierRole),
    cashierRoleLabel: toString(raw.cashierRoleLabel, DEFAULT_RECEIPT_LAYOUT_SETTINGS.cashierRoleLabel),
    showOrderType: toBoolean(raw.showOrderType, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showOrderType),
    showCustomer: toBoolean(raw.showCustomer, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showCustomer),
    showPersonnel: toBoolean(raw.showPersonnel, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showPersonnel),
    showHelper: toBoolean(raw.showHelper, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showHelper),
    showItemCode: toBoolean(raw.showItemCode, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showItemCode),
    showPaymentMode: toBoolean(raw.showPaymentMode, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showPaymentMode),
    showSubtotal: toBoolean(raw.showSubtotal, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showSubtotal),
    showDiscount: toBoolean(raw.showDiscount, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showDiscount),
    showTotal: toBoolean(raw.showTotal, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showTotal),
    showPaid: toBoolean(raw.showPaid, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showPaid),
    showChange: toBoolean(raw.showChange, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showChange),
    showCreditDue: toBoolean(raw.showCreditDue, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showCreditDue),
    showFooter: toBoolean(raw.showFooter, DEFAULT_RECEIPT_LAYOUT_SETTINGS.showFooter),
    footerText: toString(raw.footerText, DEFAULT_RECEIPT_LAYOUT_SETTINGS.footerText),
    topPaddingLines: toNumber(raw.topPaddingLines, DEFAULT_RECEIPT_LAYOUT_SETTINGS.topPaddingLines),
    bottomPaddingLines: toNumber(raw.bottomPaddingLines, DEFAULT_RECEIPT_LAYOUT_SETTINGS.bottomPaddingLines)
  };
}

export async function loadReceiptLayoutSettings(
  db: SQLiteDatabase,
  deviceId: string
): Promise<ReceiptLayoutSettings> {
  const row = await db.getFirstAsync<StoredReceiptLayoutRow>(
    'SELECT config_json FROM receipt_layout_settings WHERE device_id = ?',
    deviceId
  );

  if (!row?.config_json) {
    return { ...DEFAULT_RECEIPT_LAYOUT_SETTINGS };
  }

  try {
    const parsed = JSON.parse(row.config_json) as unknown;
    return normalizeReceiptLayoutSettings(parsed);
  } catch {
    return { ...DEFAULT_RECEIPT_LAYOUT_SETTINGS };
  }
}

export async function saveReceiptLayoutSettings(
  db: SQLiteDatabase,
  deviceId: string,
  settings: ReceiptLayoutSettings
): Promise<void> {
  const normalized = normalizeReceiptLayoutSettings(settings);
  await db.runAsync(
    `
    INSERT INTO receipt_layout_settings(device_id, config_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(device_id)
    DO UPDATE SET
      config_json = excluded.config_json,
      updated_at = excluded.updated_at
    `,
    deviceId,
    JSON.stringify(normalized),
    new Date().toISOString()
  );
}
