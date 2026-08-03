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
  posDefaultLpgFlow: 'NONE' | 'REFILL_EXCHANGE' | 'NON_REFILL';
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

export type DesktopReceiptLayoutSettings = {
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

export type DesktopWalkthroughState = {
  completedAt: string | null;
  dismissedAt: string | null;
};

export type DesktopAuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  signedInAt: string | null;
  userEmail: string | null;
  userFullName: string | null;
  pinHash: string | null;
  pinSalt: string | null;
};

export type DesktopAppState = {
  version: 1;
  setupCompleted: boolean;
  setup: DesktopSetupState;
  auth: DesktopAuthState;
  printerProfiles: DesktopPrinterProfile[];
  receiptLayout: DesktopReceiptLayoutSettings;
  walkthrough: DesktopWalkthroughState;
  sync: {
    lastSyncedAt: string | null;
    lastPullToken: string | null;
    lastSyncStatus: 'idle' | 'running' | 'success' | 'error';
    lastSyncMessage: string;
  };
};

export type DesktopPaymentMethod = 'CASH' | 'CARD' | 'E_WALLET';
export type DesktopSaleType = 'PICKUP' | 'DELIVERY';
export type DesktopCylinderFlowSelection = 'REFILL_EXCHANGE' | 'NON_REFILL';
export type DesktopPaymentMode = 'FULL' | 'PARTIAL';
export type DesktopPosRewardType =
  | 'DISCOUNT_FIXED'
  | 'DISCOUNT_PERCENT'
  | 'FREE_DELIVERY'
  | 'FREE_PRODUCT'
  | 'FREE_REFILL';

export type DesktopPosRewardRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  rewardType: DesktopPosRewardType;
  pointsCost: number;
  productId: string | null;
  freeQty: number | null;
  discountValue: number | null;
  minSpend: number | null;
  status: 'ACTIVE' | 'DRAFT' | 'INACTIVE' | 'ARCHIVED';
};

export type DesktopSaleLine = {
  lineId?: string;
  productId: string;
  productName: string;
  subtitle?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  cylinderFlow?: DesktopCylinderFlowSelection | null;
  pickupCommissionRate?: number;
  deliveryCommissionRate?: number;
};

export type DesktopSalePersonnelCommission = {
  productId: string;
  productName: string;
  personnelId: string | null;
  personnelName: string;
  personnelRole: string | null;
  saleType: DesktopSaleType;
  quantity: number;
  commissionRate: number;
  splitPercent: number;
  commissionAmount: number;
};

export type DesktopSalePayload = {
  id: string;
  shiftId?: string | null;
  customerId: string | null;
  customerName: string | null;
  recreatedFromSaleId?: string | null;
  personnelId?: string | null;
  personnelName?: string | null;
  helperId?: string | null;
  helperName?: string | null;
  personnel?: Array<{ userId: string; role: 'DRIVER' | 'HELPER' | 'PERSONNEL'; name: string | null }>;
  saleType: DesktopSaleType;
  paymentMode?: DesktopPaymentMode;
  paymentMethod: DesktopPaymentMethod;
  hideAmounts?: boolean;
  branchId?: string | null;
  branchLabel: string;
  locationId?: string | null;
  locationLabel: string;
  subtotal: number;
  discountAmount: number;
  deliveryFee?: number;
  totalAmount: number;
  paidAmount?: number;
  changeAmount?: number;
  creditBalance?: number;
  payments?: Array<{
    id?: string | null;
    source?: 'SALE' | 'SETTLEMENT' | null;
    method: DesktopPaymentMethod;
    amount: number;
    referenceNo?: string | null;
    notes?: string | null;
    createdAt?: string | null;
  }>;
  rewardId?: string | null;
  rewardName?: string | null;
  rewardPointsCost?: number;
  rewardDiscountAmount?: number;
  rewardBaseAmount?: number;
  rewardRedemptionUsed?: boolean;
  commissionSplitMode?: 'EQUAL' | null;
  commissionTotal?: number;
  commissions?: DesktopSalePersonnelCommission[];
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

export type DesktopHeldCartRecord = {
  id: string;
  label: string;
  customerId: string | null;
  customerName: string | null;
  customerProvince?: string | null;
  customerCity?: string | null;
  personnelId?: string | null;
  personnelName?: string | null;
  helperId?: string | null;
  helperName?: string | null;
  saleType: DesktopSaleType;
  paymentMode?: DesktopPaymentMode;
  paymentMethod: DesktopPaymentMethod;
  paidAmount?: number;
  discountAmount: number;
  deliveryFee?: number;
  notes: string | null;
  lines: DesktopSaleLine[];
  createdAt: string;
  updatedAt: string;
};

export type DesktopTransferMode =
  | 'SUPPLIER_RESTOCK_IN'
  | 'SUPPLIER_RESTOCK_OUT'
  | 'CREATE'
  | 'USED'
  | 'CONVERT'
  | 'INTER_STORE_TRANSFER'
  | 'STORE_TO_WAREHOUSE'
  | 'WAREHOUSE_TO_STORE'
  | 'GENERAL';

export type DesktopTransferLine = {
  productId: string;
  productName: string;
  qtyFull: number;
  qtyEmpty: number;
};

export type DesktopTransferRecord = {
  id: string;
  sourceLocationId: string;
  sourceLocationLabel: string;
  destinationLocationId: string;
  destinationLocationLabel: string;
  shiftId: string;
  transferMode: DesktopTransferMode;
  supplierId?: string | null;
  supplierName?: string | null;
  notes?: string | null;
  lines: DesktopTransferLine[];
  syncStatus: 'pending' | 'failed' | 'synced';
  lastError?: string | null;
  receivedStatus?: 'pending' | 'received';
  receivedAt?: string | null;
  receivedBy?: string | null;
  receivedNotes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DesktopShiftInventorySnapshotLine = {
  productId: string;
  sku: string;
  productName: string;
  category: string;
  unit: string;
  isLpg: boolean;
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
};

export type DesktopShiftInventorySnapshot = {
  capturedAt: string;
  locationId: string;
  locationLabel?: string | null;
  lines: DesktopShiftInventorySnapshotLine[];
};

export type DesktopShiftRecord = {
  id: string;
  branchId: string;
  branchLabel: string;
  locationId: string;
  locationLabel: string;
  userId: string;
  cashierName: string;
  openingCash: number;
  openingCashDenominations?: Array<{
    denomination: number;
    quantity: number;
    total: number;
  }>;
  openingInventorySnapshot?: DesktopShiftInventorySnapshot;
  closingCash?: number | null;
  cashVariance?: number | null;
  closingInventorySnapshot?: DesktopShiftInventorySnapshot | null;
  status: 'OPEN' | 'CLOSED';
  syncStatus: 'pending' | 'failed' | 'synced';
  lastError?: string | null;
  openedAt: string;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DesktopShiftCashEntry = {
  id: string;
  shiftId: string;
  direction: 'IN' | 'OUT';
  amount: number;
  notes?: string | null;
  syncStatus: 'pending' | 'failed' | 'synced';
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DesktopExpenseRecord = {
  id: string;
  shiftId: string;
  categoryCode: string;
  categoryLabel: string | null;
  direction: 'IN' | 'OUT';
  amount: number;
  notes?: string | null;
  attachments?: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    previewDataUrl?: string | null;
    uploadedUrl?: string | null;
    createdAt: string;
  }>;
  syncStatus: 'pending' | 'failed' | 'synced';
  lastError?: string | null;
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
  address?: string;
  contactNumber?: string;
  gas?: string;
  province?: string;
  city?: string;
  branchId?: string;
  balance?: number;
  pointsBalance?: number;
  tier?: string | null;
  customerCategoryId?: string | null;
  contractPrice?: number | null;
  roleName?: string | null;
  salaryType?: 'MONTHLY' | 'DAILY' | 'HOURLY' | 'PER_TRANSACTION';
  salaryRate?: number;
  commissionEligible?: boolean;
};

export type DesktopCatalogProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  cylinderSizeLabel?: string | null;
  unitPrice: number;
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
  isLpg: boolean;
  pickupCommissionRate?: number;
  deliveryCommissionRate?: number;
};

export type DesktopPurchaseOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PARTIALLY_RECEIVED'
  | 'COMPLETED'
  | 'CANCELLED';

export type DesktopPurchaseOrderLineRecord = {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  isLpg: boolean;
  orderedQty: number;
  receivedQty: number;
  pulledOutQty: number;
  unitCost: number;
  notes: string | null;
};

export type DesktopPurchaseOrderAttachmentRecord = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedUrl: string | null;
  sourceChannel: string | null;
  retentionUntil: string | null;
  createdAt: string;
};

export type DesktopPurchaseOrderReceiptLineRecord = {
  id: string;
  purchaseOrderLineId: string;
  productId: string;
  productSku: string;
  productName: string;
  quantity: number;
  unitCost: number;
  ledgerReferenceId: string | null;
};

export type DesktopPurchaseOrderReceiptRecord = {
  id: string;
  locationId: string;
  locationLabel: string;
  receivedByUserId: string | null;
  notes: string | null;
  createdAt: string;
  lines: DesktopPurchaseOrderReceiptLineRecord[];
};

export type DesktopPurchaseOrderPulloutReason =
  | 'EXPIRED'
  | 'DAMAGED'
  | 'WRONG_ITEM'
  | 'OVERDELIVERY'
  | 'EMPTIES'
  | 'OTHER';

export type DesktopPurchaseOrderPulloutLineRecord = {
  id: string;
  purchaseOrderLineId: string;
  productId: string;
  productSku: string;
  productName: string;
  quantity: number;
  unitCost: number;
  pulloutReason: DesktopPurchaseOrderPulloutReason | null;
  ledgerReferenceId: string | null;
};

export type DesktopPurchaseOrderPulloutRecord = {
  id: string;
  locationId: string;
  locationLabel: string;
  pulledOutByUserId: string | null;
  notes: string | null;
  createdAt: string;
  lines: DesktopPurchaseOrderPulloutLineRecord[];
};

export type DesktopPurchaseOrderDeliveryRecord = {
  id: string;
  locationId: string;
  locationLabel: string;
  referenceNo: string | null;
  postedByUserId: string | null;
  notes: string | null;
  createdAt: string;
  receipts: DesktopPurchaseOrderReceiptRecord[];
  pullouts: DesktopPurchaseOrderPulloutRecord[];
};

export type DesktopPurchaseOrderRecord = {
  id: string;
  poNumber: string | null;
  status: DesktopPurchaseOrderStatus;
  branchId: string;
  branchLabel: string;
  locationId: string;
  locationLabel: string;
  supplierId: string;
  supplierLabel: string;
  notes: string | null;
  createdByUserId: string | null;
  submittedByUserId: string | null;
  completedByUserId: string | null;
  cancelledByUserId: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  orderedQtyTotal: number;
  receivedQtyTotal: number;
  pulledOutQtyTotal: number;
  attachmentCount: number;
  syncStatus: 'pending' | 'failed' | 'synced';
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  lines: DesktopPurchaseOrderLineRecord[];
  receipts: DesktopPurchaseOrderReceiptRecord[];
  pullouts: DesktopPurchaseOrderPulloutRecord[];
  deliveries: DesktopPurchaseOrderDeliveryRecord[];
  attachments: DesktopPurchaseOrderAttachmentRecord[];
};

export type DesktopDeliveryOrderRecord = {
  id: string;
  branchId: string;
  sourceLocationId: string;
  customerId: string;
  customerName?: string | null;
  saleId?: string | null;
  orderType: 'PICKUP' | 'DELIVERY';
  status: 'created' | 'synced' | 'failed';
  syncStatus: 'pending' | 'failed' | 'synced';
  personnel: Array<{ userId: string; role: 'DRIVER' | 'HELPER' | 'LOADER' | 'OTHER'; name?: string | null }>;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  lastError?: string | null;
};

export type DesktopDispatchStatusHistoryEntry = {
  status: 'TRANSIT' | 'DELIVERED' | 'COMPLETED';
  notes: string | null;
  updatedAt: string;
};

export type DesktopDispatchStatusRecord = {
  saleId: string;
  status: 'TRANSIT' | 'DELIVERED' | 'COMPLETED';
  notes: string | null;
  syncStatus: 'pending' | 'failed' | 'synced';
  lastError: string | null;
  updatedAt: string;
  history?: DesktopDispatchStatusHistoryEntry[];
};

export type DesktopLpgItemActionRecord = {
  id: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  locationId: string;
  locationCode: string | null;
  locationName: string | null;
  productId: string;
  productSku: string | null;
  productName: string | null;
  actionType: 'DISPOSE' | 'REPLACE' | 'JUNK';
  qty: number;
  reason: string;
  notes: string | null;
  referenceActionId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
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

export type DesktopLendingDepositPayment = {
  payment_id: string;
  method: DesktopPaymentMethod;
  amount: number;
  reference_no: string | null;
  notes: string | null;
  posted_at: string;
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
  deposit_payment?: DesktopLendingDepositPayment | null;
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

export const DEFAULT_DESKTOP_RECEIPT_LAYOUT_SETTINGS: DesktopReceiptLayoutSettings = {
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
    printerPort: '9100',
    posDefaultLpgFlow: 'NONE'
  },
  auth: {
    accessToken: null,
    refreshToken: null,
    signedInAt: null,
    userEmail: null,
    userFullName: null,
    pinHash: null,
    pinSalt: null
  },
  printerProfiles: [],
  receiptLayout: DEFAULT_DESKTOP_RECEIPT_LAYOUT_SETTINGS,
  walkthrough: {
    completedAt: null,
    dismissedAt: null
  },
  sync: {
    lastSyncedAt: null,
    lastPullToken: null,
    lastSyncStatus: 'idle',
    lastSyncMessage: 'Desktop setup has not been completed yet.'
  }
};
