export type DesktopSetupState = {
  operatorName: string;
  clientId: string;
  authEmail: string;
  deviceId: string;
  branchId: string;
  branchLabel: string;
  locationId: string;
  locationLabel: string;
  apiBaseUrl: string;
  printerMode: 'USB' | 'LAN' | 'NONE';
  printerName: string;
  printerHost: string;
  printerPort: string;
};

export type DesktopPrinterProfile = {
  id: string;
  label: string;
  mode: 'USB' | 'LAN';
  printerName: string;
  printerHost: string;
  printerPort: string;
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
  lastTestStatus: 'idle' | 'success' | 'error';
  lastTestMessage: string | null;
};

export type DesktopAuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  signedInAt: string | null;
};

export type DesktopAppState = {
  version: 1;
  setupCompleted: boolean;
  setup: DesktopSetupState;
  auth: DesktopAuthState;
  printerProfiles: DesktopPrinterProfile[];
  sync: {
    lastSyncedAt: string | null;
    lastSyncStatus: 'idle' | 'running' | 'success' | 'error';
    lastSyncMessage: string;
  };
};

export type DesktopPaymentMethod = 'CASH' | 'CARD' | 'E_WALLET';
export type DesktopSaleType = 'PICKUP' | 'DELIVERY';

export type DesktopSaleLine = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type DesktopSalePayload = {
  id: string;
  customerId: string | null;
  customerName: string | null;
  recreatedFromSaleId?: string | null;
  saleType: DesktopSaleType;
  paymentMethod: DesktopPaymentMethod;
  branchLabel: string;
  locationLabel: string;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  notes: string | null;
  lines: DesktopSaleLine[];
  createdAt: string;
};

export type DesktopSaleReturnLine = {
  saleLineId: string | null;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type DesktopSaleReturnRecord = {
  id: string;
  reason: string;
  status: 'pending' | 'synced' | 'failed';
  createdAt: string;
  lines: DesktopSaleReturnLine[];
};

export type DesktopSaleRecord = {
  id: string;
  payload: DesktopSalePayload;
  saleStatus?: 'ACTIVE' | 'CANCELLED';
  cancelReason?: string | null;
  cancelledAt?: string | null;
  replacementSaleId?: string | null;
  returns?: DesktopSaleReturnRecord[];
  syncStatus: 'pending' | 'failed' | 'synced';
  receiptNumber: string;
  createdAt: string;
  updatedAt: string;
};

export type DesktopMasterDataRow = {
  entity: string;
  recordId: string;
  payload: string;
  updatedAt: string;
};

export type DesktopOption = {
  id: string;
  label: string;
  subtitle?: string;
  branchId?: string;
  balance?: number;
  pointsBalance?: number;
};

export type DesktopCatalogProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  unitPrice: number;
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
  isLpg: boolean;
};

export type DesktopLendingLine = {
  lending_line_id: string;
  source_sale_line_id: string | null;
  product_id: string;
  product_sku: string | null;
  product_name: string | null;
  quantity_lent: number;
  quantity_returned: number;
  quantity_open: number;
  deposit_amount: number | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
};

export type DesktopLendingReturn = {
  lending_return_id: string;
  lending_line_id: string;
  returned_qty: number;
  condition: string;
  remarks: string | null;
  received_by_user_id: string | null;
  received_by_name: string | null;
  returned_at: string;
  created_at: string;
};

export type DesktopLendingRecord = {
  lending_id: string;
  company_id: string;
  branch_id: string;
  branch_name: string | null;
  location_id: string;
  location_name: string | null;
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  sale_id: string;
  status: 'OPEN' | 'PARTIALLY_RETURNED' | 'OVERDUE' | 'CLOSED' | 'CANCELLED' | 'FORCE_CLOSED';
  due_at: string | null;
  remarks: string | null;
  settlement_type: string;
  settlement_amount: number | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  approved_by_user_id: string | null;
  approved_by_name: string | null;
  opened_at: string;
  closed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  line_count: number;
  total_quantity_lent: number;
  total_quantity_returned: number;
};

export type DesktopLendingDetail = DesktopLendingRecord & {
  lines: DesktopLendingLine[];
  returns: DesktopLendingReturn[];
};

export type DesktopLendingReturnDraftLine = {
  lending_line_id: string;
  returned_qty: number;
  condition: 'GOOD' | 'DAMAGED' | 'LOST';
  remarks?: string | null;
};

export type DesktopLendingReturnDraft = {
  remarks?: string | null;
  received_by_user_id?: string | null;
  lines: DesktopLendingReturnDraftLine[];
};

export const DEFAULT_DESKTOP_APP_STATE: DesktopAppState = {
  version: 1,
  setupCompleted: false,
  setup: {
    operatorName: '',
    clientId: '',
    authEmail: '',
    deviceId: 'desktop-vpos',
    branchId: '',
    branchLabel: '',
    locationId: '',
    locationLabel: '',
    apiBaseUrl: 'https://vmjamtech.com/api',
    printerMode: 'USB',
    printerName: '',
    printerHost: '',
    printerPort: '9100'
  },
  auth: {
    accessToken: null,
    refreshToken: null,
    signedInAt: null
  },
  printerProfiles: [],
  sync: {
    lastSyncedAt: null,
    lastSyncStatus: 'idle',
    lastSyncMessage: 'Desktop setup has not been completed yet.'
  }
};
