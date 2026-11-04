import type { ReceiptDocument, ReceiptLine } from './index';

export type VposReceiptLayoutSettings = {
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

export type VposReceiptPaymentMethod = 'CASH' | 'CARD' | 'E_WALLET';
export type VposReceiptOrderType = 'PICKUP' | 'DELIVERY';
export type VposReceiptPaymentMode = 'FULL' | 'PARTIAL';

export type VposReceiptItemLine = {
  name: string;
  subtitle?: string | null;
  quantity: number;
  unitPrice: number;
};

export type VposSaleReceiptInput = {
  receiptNumber: string;
  saleId: string;
  branchName: string;
  locationName: string;
  cashierName: string | null;
  orderType: VposReceiptOrderType;
  customerName: string | null;
  personnelName: string | null;
  helperName: string | null;
  lines: VposReceiptItemLine[];
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  creditBalance: number;
  notes?: string | null;
  paymentMode: VposReceiptPaymentMode;
  paymentMethod: VposReceiptPaymentMethod;
  rewardRedemptionUsed?: boolean;
  hideAmounts?: boolean;
  createdAt: string;
};

export type VposQueueOrderReceiptInput = {
  queueId: string;
  queueLabel: string;
  branchName: string;
  locationName: string;
  cashierName: string | null;
  orderType: VposReceiptOrderType;
  customerName: string | null;
  customerAddress?: string | null;
  personnelName: string | null;
  helperName: string | null;
  lines: VposReceiptItemLine[];
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  notes?: string | null;
  paymentMode: VposReceiptPaymentMode;
  paymentMethod: VposReceiptPaymentMethod;
  createdAt: string;
};

export type VposCustomerPaymentReceiptInput = {
  branchName: string | null;
  locationName: string | null;
  cashierName: string | null;
  customerName: string;
  customerAddress?: string | null;
  amount: number;
  remainingBalance: number;
  method: VposReceiptPaymentMethod;
  referenceNo?: string | null;
  notes?: string | null;
  createdAt: string;
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

export function normalizeVposReceiptLayoutSettings(
  value: unknown,
  defaults: VposReceiptLayoutSettings
): VposReceiptLayoutSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaults };
  }
  const raw = value as Record<string, unknown>;
  return {
    showHeaderLogoImage: toBoolean(raw.showHeaderLogoImage, defaults.showHeaderLogoImage),
    headerLogoImageDataUrl: toString(raw.headerLogoImageDataUrl, defaults.headerLogoImageDataUrl),
    headerLogoPlacement: toPlacement(raw.headerLogoPlacement, defaults.headerLogoPlacement),
    showHeaderLogoText: toBoolean(raw.showHeaderLogoText, defaults.showHeaderLogoText),
    headerLogoText: toString(raw.headerLogoText, defaults.headerLogoText),
    showStoreContact: toBoolean(raw.showStoreContact, defaults.showStoreContact),
    storeContactInfo: toString(raw.storeContactInfo, defaults.storeContactInfo),
    showStoreAddress: toBoolean(raw.showStoreAddress, defaults.showStoreAddress),
    storeAddress: toString(raw.storeAddress, defaults.storeAddress),
    showBusinessTin: toBoolean(raw.showBusinessTin, defaults.showBusinessTin),
    businessTin: toString(raw.businessTin, defaults.businessTin),
    showPermitOrInfo: toBoolean(raw.showPermitOrInfo, defaults.showPermitOrInfo),
    permitOrInfo: toString(raw.permitOrInfo, defaults.permitOrInfo),
    showTerminalName: toBoolean(raw.showTerminalName, defaults.showTerminalName),
    terminalName: toString(raw.terminalName, defaults.terminalName),
    showReceiptNumber: toBoolean(raw.showReceiptNumber, defaults.showReceiptNumber),
    showSaleId: toBoolean(raw.showSaleId, defaults.showSaleId),
    showDateTime: toBoolean(raw.showDateTime, defaults.showDateTime),
    showBranch: toBoolean(raw.showBranch, defaults.showBranch),
    showLocation: toBoolean(raw.showLocation, defaults.showLocation),
    showCashier: toBoolean(raw.showCashier, defaults.showCashier),
    showCashierRole: toBoolean(raw.showCashierRole, defaults.showCashierRole),
    cashierRoleLabel: toString(raw.cashierRoleLabel, defaults.cashierRoleLabel),
    showOrderType: toBoolean(raw.showOrderType, defaults.showOrderType),
    showCustomer: toBoolean(raw.showCustomer, defaults.showCustomer),
    showPersonnel: toBoolean(raw.showPersonnel, defaults.showPersonnel),
    showHelper: toBoolean(raw.showHelper, defaults.showHelper),
    showItemCode: toBoolean(raw.showItemCode, defaults.showItemCode),
    showPaymentMode: toBoolean(raw.showPaymentMode, defaults.showPaymentMode),
    showSubtotal: toBoolean(raw.showSubtotal, defaults.showSubtotal),
    showDiscount: toBoolean(raw.showDiscount, defaults.showDiscount),
    showTotal: toBoolean(raw.showTotal, defaults.showTotal),
    showPaid: toBoolean(raw.showPaid, defaults.showPaid),
    showChange: toBoolean(raw.showChange, defaults.showChange),
    showCreditDue: toBoolean(raw.showCreditDue, defaults.showCreditDue),
    showFooter: toBoolean(raw.showFooter, defaults.showFooter),
    footerText: toString(raw.footerText, defaults.footerText),
    topPaddingLines: toNumber(raw.topPaddingLines, defaults.topPaddingLines),
    bottomPaddingLines: toNumber(raw.bottomPaddingLines, defaults.bottomPaddingLines)
  };
}

function resolveLogoBase64(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const marker = 'base64,';
  const index = trimmed.indexOf(marker);
  if (index >= 0) {
    return trimmed.slice(index + marker.length).trim();
  }
  return trimmed;
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function addLine(
  lines: ReceiptLine[],
  condition: boolean,
  text: string,
  align: 'left' | 'center' | 'right' = 'left',
  emphasis = false
): void {
  if (!condition) {
    return;
  }
  lines.push({ align, text, emphasis });
}

function moneyOrMask(value: number, hideAmounts: boolean): string {
  return hideAmounts ? '*** HIDDEN ***' : `PHP ${value.toFixed(2)}`;
}

export function buildVposSaleReceiptDocument(
  input: VposSaleReceiptInput,
  layout: VposReceiptLayoutSettings
): ReceiptDocument {
  const lines: ReceiptDocument['lines'] = [];
  const logoBase64 = resolveLogoBase64(layout.headerLogoImageDataUrl);
  const qtyTotal = input.lines.reduce((sum, line) => sum + line.quantity, 0);
  const itemCount = input.lines.length;
  const hasBalanceDue = input.creditBalance > 0.009;
  const hideAmounts = input.hideAmounts === true;
  const hasPersonnel = Boolean((input.personnelName ?? '').trim());
  const hasHelper = Boolean((input.helperName ?? '').trim());

  if (layout.showHeaderLogoImage && logoBase64) {
    const logoAlign =
      layout.headerLogoPlacement === 'LEFT'
        ? 'left'
        : layout.headerLogoPlacement === 'RIGHT'
          ? 'right'
          : 'center';
    lines.push({
      align: logoAlign,
      text: '',
      imageBase64: logoBase64,
      imageWidth: 220
    });
  }

  addLine(lines, layout.showHeaderLogoText, layout.headerLogoText.trim() || 'VMJAM LPG', 'center', true);
  addLine(lines, layout.showStoreContact && Boolean(layout.storeContactInfo.trim()), layout.storeContactInfo.trim(), 'center', true);
  addLine(lines, layout.showStoreAddress && Boolean(layout.storeAddress.trim()), layout.storeAddress.trim(), 'center', true);
  addLine(lines, layout.showBusinessTin && Boolean(layout.businessTin.trim()), layout.businessTin.trim(), 'center', true);
  addLine(lines, layout.showPermitOrInfo && Boolean(layout.permitOrInfo.trim()), layout.permitOrInfo.trim(), 'center', true);
  addLine(lines, layout.showReceiptNumber, `Receipt #${input.receiptNumber}`, 'center', true);
  addLine(lines, layout.showSaleId, `Sale ID: ${input.saleId}`, 'left', true);
  addLine(lines, layout.showDateTime, `Date: ${new Date(input.createdAt).toLocaleString()}`, 'left', true);
  addLine(lines, layout.showBranch, `Branch: ${input.branchName}`, 'left', true);
  addLine(lines, layout.showLocation, `Location: ${input.locationName}`, 'left', true);
  addLine(
    lines,
    layout.showTerminalName && Boolean(layout.terminalName.trim()),
    `Terminal: ${layout.terminalName.trim()}`,
    'left',
    true
  );
  addLine(lines, layout.showCashier, `Cashier: ${input.cashierName ?? '-'}`, 'left', true);
  addLine(
    lines,
    layout.showCashierRole && Boolean(layout.cashierRoleLabel.trim()),
    `Role: ${layout.cashierRoleLabel.trim()}`,
    'left',
    true
  );
  addLine(lines, layout.showOrderType, `Type: ${input.orderType}`, 'left', true);
  addLine(lines, layout.showCustomer, `Customer: ${input.customerName ?? '-'}`, 'left', true);
  addLine(lines, layout.showPersonnel && hasPersonnel, `Personnel: ${input.personnelName?.trim() ?? ''}`, 'left', true);
  addLine(lines, layout.showHelper && hasHelper, `Helper: ${input.helperName?.trim() ?? ''}`, 'left', true);

  lines.push({ align: 'left', text: '------------------------------' });
  lines.push(
    ...input.lines.flatMap((line) => {
      const itemName = layout.showItemCode && line.subtitle ? `${line.subtitle} - ${line.name}` : line.name;
      return [
        {
          align: 'left' as const,
          text: `${formatQty(line.quantity)} x ${itemName}`,
          emphasis: true
        },
        {
          align: 'right' as const,
          text: `  @ ${line.unitPrice.toFixed(2)} = ${(line.quantity * line.unitPrice).toFixed(2)}`,
          emphasis: true
        }
      ];
    })
  );
  lines.push({ align: 'left', text: '------------------------------' });
  addLine(lines, true, `QTY TOTAL: ${formatQty(qtyTotal)}`, 'left', true);
  addLine(lines, true, `ITEM COUNT: ${itemCount}`, 'left', true);
  lines.push({ align: 'left', text: '------------------------------' });

  addLine(lines, layout.showSubtotal, `Subtotal: ${moneyOrMask(input.subtotal, hideAmounts)}`, 'left', true);
  addLine(lines, layout.showDiscount, `Discount: ${moneyOrMask(input.discount, hideAmounts)}`, 'left', true);
  lines.push({ align: 'left', text: '------------------------------' });
  addLine(lines, true, 'GRAND TOTAL', 'center', true);
  addLine(lines, true, hideAmounts ? '*** HIDDEN ***' : `PHP ${input.total.toFixed(2)}`, 'center', true);
  lines.push({ align: 'left', text: '------------------------------' });
  addLine(lines, layout.showTotal, `Total: ${moneyOrMask(input.total, hideAmounts)}`, 'left', true);
  addLine(lines, layout.showPaid, `Paid (${input.paymentMethod}): ${moneyOrMask(input.paidAmount, hideAmounts)}`, 'left', true);
  addLine(lines, layout.showChange, `Change: ${moneyOrMask(input.changeAmount, hideAmounts)}`, 'left', true);
  addLine(lines, layout.showCreditDue && hasBalanceDue, `Credit Due: ${moneyOrMask(input.creditBalance, hideAmounts)}`, 'left', true);
  addLine(lines, layout.showPaymentMode, `Payment Mode: ${input.paymentMode}`, 'left', true);
  addLine(lines, Boolean(input.notes), `Notes: ${input.notes ?? ''}`, 'left', true);
  lines.push({ align: 'left', text: '------------------------------' });
  addLine(
    lines,
    true,
    hasBalanceDue
      ? `BALANCE DUE: ${moneyOrMask(input.creditBalance, hideAmounts)}`
      : `CHANGE: ${moneyOrMask(input.changeAmount, hideAmounts)}`,
    'center',
    true
  );

  return {
    title: 'VPOS RECEIPT',
    isReprint: false,
    lines,
    footer: layout.showFooter ? layout.footerText.trim() || 'Thank you for choosing VPOS LPG.' : undefined,
    footerEmphasis: true,
    topPaddingLines: layout.topPaddingLines,
    bottomPaddingLines: layout.bottomPaddingLines
  };
}

export function buildVposQueueOrderReceiptDocument(
  input: VposQueueOrderReceiptInput,
  layout: VposReceiptLayoutSettings
): ReceiptDocument {
  const lines: ReceiptDocument['lines'] = [];
  const logoBase64 = resolveLogoBase64(layout.headerLogoImageDataUrl);
  const qtyTotal = input.lines.reduce((sum, line) => sum + line.quantity, 0);

  if (layout.showHeaderLogoImage && logoBase64) {
    const logoAlign =
      layout.headerLogoPlacement === 'LEFT'
        ? 'left'
        : layout.headerLogoPlacement === 'RIGHT'
          ? 'right'
          : 'center';
    lines.push({
      align: logoAlign,
      text: '',
      imageBase64: logoBase64,
      imageWidth: 220
    });
  }

  addLine(lines, layout.showHeaderLogoText, layout.headerLogoText.trim() || 'VMJAM LPG', 'center', true);
  addLine(lines, layout.showStoreContact && Boolean(layout.storeContactInfo.trim()), layout.storeContactInfo.trim(), 'center', true);
  addLine(lines, layout.showStoreAddress && Boolean(layout.storeAddress.trim()), layout.storeAddress.trim(), 'center', true);
  lines.push({ align: 'left', text: '------------------------------' });
  addLine(lines, true, 'QUEUE ORDER', 'center', true);
  addLine(lines, true, input.queueLabel, 'center', true);
  addLine(lines, true, `Queue ID: ${input.queueId}`, 'left', true);
  addLine(lines, true, `Date: ${new Date(input.createdAt).toLocaleString()}`, 'left', true);
  addLine(lines, layout.showBranch, `Branch: ${input.branchName}`, 'left', true);
  addLine(lines, layout.showLocation, `Location: ${input.locationName}`, 'left', true);
  addLine(lines, true, `Cashier: ${input.cashierName ?? '-'}`, 'left', true);
  addLine(lines, true, `Type: ${input.orderType}`, 'left', true);
  addLine(lines, true, `Customer: ${input.customerName ?? 'Walk-in customer'}`, 'left', true);
  addLine(lines, Boolean(input.customerAddress?.trim()), `Address: ${input.customerAddress?.trim() ?? ''}`, 'left', true);
  addLine(lines, Boolean(input.personnelName?.trim()), `Personnel: ${input.personnelName?.trim() ?? ''}`, 'left', true);
  addLine(lines, Boolean(input.helperName?.trim()), `Helper: ${input.helperName?.trim() ?? ''}`, 'left', true);
  lines.push({ align: 'left', text: '------------------------------' });
  lines.push(
    ...input.lines.flatMap((line) => {
      const itemName = layout.showItemCode && line.subtitle ? `${line.subtitle} - ${line.name}` : line.name;
      return [
        {
          align: 'left' as const,
          text: `${formatQty(line.quantity)} x ${itemName}`,
          emphasis: true
        },
        {
          align: 'right' as const,
          text: `  @ ${line.unitPrice.toFixed(2)} = ${(line.quantity * line.unitPrice).toFixed(2)}`,
          emphasis: true
        }
      ];
    })
  );
  lines.push({ align: 'left', text: '------------------------------' });
  addLine(lines, true, `QTY TOTAL: ${formatQty(qtyTotal)}`, 'left', true);
  addLine(lines, true, `ITEM COUNT: ${input.lines.length}`, 'left', true);
  addLine(lines, true, `Subtotal: PHP ${input.subtotal.toFixed(2)}`, 'left', true);
  addLine(lines, true, `Discount: PHP ${input.discount.toFixed(2)}`, 'left', true);
  addLine(lines, true, `Total: PHP ${input.total.toFixed(2)}`, 'left', true);
  addLine(lines, true, `Paid: PHP ${input.paidAmount.toFixed(2)}`, 'left', true);
  addLine(lines, true, `Payment Mode: ${input.paymentMode}`, 'left', true);
  addLine(lines, true, `Payment: ${input.paymentMethod}`, 'left', true);
  addLine(lines, Boolean(input.notes), `Notes: ${input.notes ?? ''}`, 'left', true);
  lines.push({ align: 'left', text: '------------------------------' });

  return {
    title: 'VPOS QUEUE ORDER',
    isReprint: false,
    lines,
    footer: layout.showFooter
      ? layout.footerText.trim() || 'Queue order slip only. Recall this order to continue checkout.'
      : undefined,
    footerEmphasis: true
  };
}

export function buildVposCustomerPaymentReceiptDocument(
  input: VposCustomerPaymentReceiptInput,
  layout: VposReceiptLayoutSettings
): ReceiptDocument {
  const lines: ReceiptDocument['lines'] = [];
  const logoBase64 = resolveLogoBase64(layout.headerLogoImageDataUrl);

  if (layout.showHeaderLogoImage && logoBase64) {
    const logoAlign =
      layout.headerLogoPlacement === 'LEFT'
        ? 'left'
        : layout.headerLogoPlacement === 'RIGHT'
          ? 'right'
          : 'center';
    lines.push({
      align: logoAlign,
      text: '',
      imageBase64: logoBase64,
      imageWidth: 220
    });
  }

  addLine(lines, layout.showHeaderLogoText, layout.headerLogoText.trim() || 'VMJAM LPG', 'center', true);
  addLine(lines, layout.showBranch, `Branch: ${input.branchName ?? '-'}`, 'left', true);
  addLine(lines, layout.showLocation, `Location: ${input.locationName ?? '-'}`, 'left', true);
  addLine(lines, layout.showCashier, `Cashier: ${input.cashierName ?? '-'}`, 'left', true);
  lines.push({ align: 'left', text: '------------------------------' });
  addLine(lines, true, 'BALANCE PAYMENT', 'center', true);
  addLine(lines, true, `Date: ${new Date(input.createdAt).toLocaleString()}`, 'left', true);
  addLine(lines, true, `Customer: ${input.customerName}`, 'left', true);
  addLine(lines, Boolean(input.customerAddress?.trim()), `Address: ${input.customerAddress?.trim() ?? ''}`, 'left', true);
  lines.push({ align: 'left', text: '------------------------------' });
  addLine(lines, true, `Paid: PHP ${input.amount.toFixed(2)}`, 'left', true);
  addLine(lines, true, `Remaining: PHP ${input.remainingBalance.toFixed(2)}`, 'left', true);
  addLine(lines, true, `Method: ${input.method}`, 'left', true);
  addLine(lines, Boolean(input.referenceNo?.trim()), `Reference: ${input.referenceNo?.trim() ?? ''}`, 'left', true);
  addLine(lines, Boolean(input.notes?.trim()), `Notes: ${input.notes?.trim() ?? ''}`, 'left', true);

  return {
    title: 'VPOS BALANCE PAYMENT',
    isReprint: false,
    lines,
    footer: layout.showFooter ? layout.footerText.trim() || 'Customer balance payment slip.' : undefined,
    footerEmphasis: true,
    topPaddingLines: layout.topPaddingLines,
    bottomPaddingLines: layout.bottomPaddingLines
  };
}
