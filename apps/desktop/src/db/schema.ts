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

export type DesktopSaleRecord = {
  id: string;
  payload: DesktopSalePayload;
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
  sync: {
    lastSyncedAt: null,
    lastSyncStatus: 'idle',
    lastSyncMessage: 'Desktop setup has not been completed yet.'
  }
};
