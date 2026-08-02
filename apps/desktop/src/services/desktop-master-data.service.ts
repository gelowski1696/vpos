import { desktopDb } from '../db/sqlite';
import type {
  DesktopAppState,
  DesktopCatalogProduct,
  DesktopLendingDetail,
  DesktopLpgItemActionRecord,
  DesktopLendingReturnDraft,
  DesktopLendingRecord,
  DesktopMasterDataRow,
  DesktopOption,
  DesktopSaleRecord,
  DesktopTransferRecord
} from '../db/schema';
import { desktopAuthService } from './desktop-auth.service';

type BranchRecord = {
  id: string;
  code?: string;
  name?: string;
  isActive?: boolean;
};

type LocationRecord = {
  id: string;
  code?: string;
  name?: string;
  branchId?: string | null;
  type?: string | null;
  isActive?: boolean;
};

type SupplierRecord = {
  id: string;
  code?: string;
  name?: string;
  isActive?: boolean;
};

type PersonnelRecord = {
  id: string;
  code?: string;
  name?: string;
  fullName?: string;
  full_name?: string;
  displayName?: string;
  display_name?: string;
  firstName?: string;
  first_name?: string;
  middleName?: string;
  middle_name?: string;
  lastName?: string;
  last_name?: string;
  suffix?: string;
  roleName?: string;
  role_name?: string;
  roleCode?: string;
  role_code?: string;
  branchId?: string | null;
  roleId?: string | null;
  personnelRoleId?: string | null;
  role?: { id?: string; name?: string; code?: string } | null;
  isActive?: boolean;
  salaryType?: 'MONTHLY' | 'DAILY' | 'HOURLY' | 'PER_TRANSACTION';
  salary_type?: 'MONTHLY' | 'DAILY' | 'HOURLY' | 'PER_TRANSACTION';
  salaryRate?: number | string | null;
  salary_rate?: number | string | null;
  commissionEligible?: boolean | string | null;
  commission_eligible?: boolean | string | null;
};

type ProductRecord = {
  id: string;
  sku?: string;
  name?: string;
  category?: string | null;
  unit?: string;
  isLpg?: boolean;
  isActive?: boolean;
  standardCost?: number | null;
  sizeKg?: number | string | null;
  size_kg?: number | string | null;
  size?: string | null;
  cylinderSize?: number | string | null;
  cylinder_size?: number | string | null;
  cylinderTypeId?: string | null;
  cylinder_type_id?: string | null;
  pickupCommissionRate?: number | string | null;
  pickup_commission_rate?: number | string | null;
  deliveryCommissionRate?: number | string | null;
  delivery_commission_rate?: number | string | null;
};

type InventorySnapshotRow = {
  locationId?: string;
  productId?: string;
  qtyOnHand?: number;
  qtyFull?: number;
  qtyEmpty?: number;
};

type InventoryOpeningSnapshot = {
  rows?: InventorySnapshotRow[];
};

type PriceRuleRecord = {
  id: string;
  productId?: string;
  flowMode?: string;
  unitPrice?: number;
  priority?: number;
};

type PriceListRecord = {
  id: string;
  scope?: string;
  branchId?: string | null;
  customerTier?: string | null;
  customerCategoryId?: string | null;
  customerId?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  isActive?: boolean;
  rules?: PriceRuleRecord[];
};

export type TenantAddonFlags = {
  email_features: boolean;
  email_report: boolean;
  email_customer_balance: boolean;
  sms_alerts: boolean;
  auto_report_digest: boolean;
  custom_pricing: boolean;
  customer_category: boolean;
  item_price_cost_audit: boolean;
  petty_cash_attachments: boolean;
  shift_security_controls: boolean;
  kilo_overview_chart: boolean;
  receipt_amount_privacy: boolean;
  purchase_order_suite: boolean;
  delivery_dispatch_suite: boolean;
  queue_order_filtering: boolean;
  cashier_end_of_day_inventory_count: boolean;
};

type CustomerPricingProfile = {
  id: string;
  tier: string | null;
  customerCategoryId: string | null;
  contractPrice: number | null;
};

export type DesktopPosControlPolicy = {
  reports_enabled: boolean;
  inventory_reports_enabled: boolean;
  customers_enabled: boolean;
  items_enabled: boolean;
  transfer_enabled: boolean;
  lending_enabled: boolean;
  expense_enabled: boolean;
  shift_enabled: boolean;
  settings_enabled: boolean;
  purchase_orders_enabled: boolean;
  delivery_dispatch_enabled: boolean;
  updated_at: string;
  updated_by: string | null;
};

export const DEFAULT_TENANT_ADDONS: TenantAddonFlags = {
  email_features: false,
  email_report: false,
  email_customer_balance: false,
  sms_alerts: false,
  auto_report_digest: false,
  custom_pricing: false,
  customer_category: false,
  item_price_cost_audit: false,
  petty_cash_attachments: false,
  shift_security_controls: false,
  kilo_overview_chart: false,
  receipt_amount_privacy: false,
  purchase_order_suite: false,
  delivery_dispatch_suite: false,
  queue_order_filtering: false,
  cashier_end_of_day_inventory_count: false
};

export const DEFAULT_DESKTOP_POS_CONTROL_POLICY: DesktopPosControlPolicy = {
  reports_enabled: true,
  inventory_reports_enabled: true,
  customers_enabled: true,
  items_enabled: true,
  transfer_enabled: true,
  lending_enabled: true,
  expense_enabled: true,
  shift_enabled: true,
  settings_enabled: true,
  purchase_orders_enabled: true,
  delivery_dispatch_enabled: true,
  updated_at: new Date(0).toISOString(),
  updated_by: null
};

type SalesListReportRow = {
  sale_id: string;
};

type SaleDetailReport = {
  sale: {
    sale_id: string;
    status: 'ACTIVE' | 'CANCELLED' | 'VOIDED';
    recreated_from_sale_id?: string | null;
    created_at: string;
    cancelled_at?: string | null;
    cancel_reason?: string | null;
    receipt_number?: string | null;
    branch_id: string;
    branch_name: string;
    location_id: string;
    location_name: string;
    customer_id?: string | null;
    customer_code?: string | null;
    customer_name?: string | null;
    personnel_name?: string | null;
    driver_name?: string | null;
    helper_name?: string | null;
    sale_type: string;
    subtotal: number;
    discount_amount: number;
    total_amount: number;
    payment_total: number;
    payment_methods: string[];
  };
  lines: Array<{
    line_id: string;
    product_id: string;
    product_name: string;
    cylinder_flow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null;
    qty: number;
    unit_price: number;
    line_total: number;
  }>;
  returns: Array<{
    sale_return_id: string;
    status: 'POSTED' | 'VOIDED';
    reason: string;
    created_at: string;
    lines: Array<{
      sale_line_id: string;
      product_id: string;
      product_name: string;
      quantity: number;
      unit_price: number;
      line_total: number;
    }>;
  }>;
  payments: Array<{
    payment_id: string;
    payment_source: 'SALE' | 'SETTLEMENT';
    method: string;
    amount: number;
    reference_no?: string | null;
    notes?: string | null;
    posted_at?: string | null;
  }>;
  commissions?: Array<{
    product_id: string;
    product_name: string;
    personnel_id?: string | null;
    personnel_name: string;
    personnel_role?: string | null;
    sale_type: 'PICKUP' | 'DELIVERY';
    qty: number;
    commission_rate: number;
    split_percent: number;
    commission_amount: number;
  }>;
};

type TransferApiRecord = {
  id: string;
  source_location_id: string;
  destination_location_id: string;
  shift_id?: string | null;
  transfer_mode?: string | null;
  supplier_id?: string | null;
  supplier_name?: string | null;
  source_location_label?: string | null;
  destination_location_label?: string | null;
  notes?: string | null;
  status: 'CREATED' | 'APPROVED' | 'POSTED' | 'REVERSED';
  lines: Array<{
    product_id: string;
    qty_full: number;
    qty_empty: number;
  }>;
  created_at: string;
  updated_at: string;
  reversal_reason?: string | null;
};

function safeParse(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildFullName(payload: Record<string, unknown>): string | null {
  const direct =
    asString(payload.fullName) ??
    asString(payload.full_name) ??
    asString(payload.displayName) ??
    asString(payload.display_name) ??
    asString(payload.name);
  if (direct) {
    return direct;
  }
  const first = asString(payload.firstName) ?? asString(payload.first_name);
  const middle = asString(payload.middleName) ?? asString(payload.middle_name);
  const last = asString(payload.lastName) ?? asString(payload.last_name);
  const suffix = asString(payload.suffix);
  const combined = [first, middle, last, suffix].filter((value): value is string => Boolean(value)).join(' ').trim();
  return combined.length > 0 ? combined : null;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return false;
}

function normalizePosControlPolicy(
  source: Record<string, unknown>,
  fallbackUpdatedAt?: string
): DesktopPosControlPolicy {
  const readFlag = (
    key: keyof Pick<
      DesktopPosControlPolicy,
      | 'reports_enabled'
      | 'inventory_reports_enabled'
      | 'customers_enabled'
      | 'items_enabled'
      | 'transfer_enabled'
      | 'lending_enabled'
      | 'expense_enabled'
      | 'shift_enabled'
      | 'settings_enabled'
      | 'purchase_orders_enabled'
      | 'delivery_dispatch_enabled'
    >
  ): boolean => (source[key] === undefined ? DEFAULT_DESKTOP_POS_CONTROL_POLICY[key] : asBoolean(source[key]));

  return {
    ...DEFAULT_DESKTOP_POS_CONTROL_POLICY,
    reports_enabled: readFlag('reports_enabled'),
    inventory_reports_enabled: readFlag('inventory_reports_enabled'),
    customers_enabled: readFlag('customers_enabled'),
    items_enabled: readFlag('items_enabled'),
    transfer_enabled: readFlag('transfer_enabled'),
    lending_enabled: readFlag('lending_enabled'),
    expense_enabled: readFlag('expense_enabled'),
    shift_enabled: readFlag('shift_enabled'),
    settings_enabled: readFlag('settings_enabled'),
    purchase_orders_enabled: readFlag('purchase_orders_enabled'),
    delivery_dispatch_enabled: readFlag('delivery_dispatch_enabled'),
    updated_at:
      asString(source.updated_at) ??
      asString(source.updatedAt) ??
      fallbackUpdatedAt ??
      DEFAULT_DESKTOP_POS_CONTROL_POLICY.updated_at,
    updated_by: asString(source.updated_by) ?? asString(source.updatedBy) ?? null
  };
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isProjectedSaleStatus(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'pending' || normalized === 'processing' || normalized === 'synced';
}

function isCancelledSaleStatus(value: string | null | undefined): boolean {
  return String(value ?? '').trim().toUpperCase() === 'CANCELLED';
}

function isProjectedOutboxStatus(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'pending' || normalized === 'processing' || normalized === 'synced';
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function compactErrorText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function readFetchErrorDetail(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  const normalized = compactErrorText(raw);
  if (!normalized) {
    return '';
  }
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const messageValue = parsed.message;
    if (typeof messageValue === 'string' && messageValue.trim()) {
      return messageValue.trim();
    }
    if (Array.isArray(messageValue) && messageValue.length > 0) {
      const merged = compactErrorText(messageValue.map((entry) => String(entry ?? '')).join('; '));
      if (merged) {
        return merged;
      }
    }
  } catch {
    // Preserve raw text when payload is not JSON.
  }
  return normalized;
}

function toDesktopPaymentMethod(value: string | null | undefined): 'CASH' | 'CARD' | 'E_WALLET' {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'CARD') {
    return 'CARD';
  }
  if (normalized === 'E_WALLET' || normalized === 'EWALLET') {
    return 'E_WALLET';
  }
  return 'CASH';
}

function toDesktopSaleType(value: string | null | undefined): 'PICKUP' | 'DELIVERY' {
  return String(value ?? '').trim().toUpperCase() === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';
}

function toDesktopSaleRecord(detail: SaleDetailReport): DesktopSaleRecord {
  const primaryPaymentMethod = detail.payments[0]?.method ?? detail.sale.payment_methods[0] ?? 'CASH';
  const createdAt = detail.sale.created_at;
  const updatedAt = detail.sale.cancelled_at ?? detail.returns[0]?.created_at ?? createdAt;

  return {
    id: detail.sale.sale_id,
    saleStatus: detail.sale.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
    cancelReason: detail.sale.cancel_reason ?? null,
    cancelledAt: detail.sale.cancelled_at ?? null,
    replacementSaleId: null,
    returns: detail.returns.map((entry) => ({
      id: entry.sale_return_id,
      reason: entry.reason,
      status: entry.status === 'POSTED' ? 'synced' : 'failed',
      createdAt: entry.created_at,
      lines: entry.lines.map((line) => ({
        saleLineId: line.sale_line_id,
        productId: line.product_id,
        productName: line.product_name,
        quantity: line.quantity,
        unitPrice: line.unit_price,
        lineTotal: line.line_total
      }))
    })),
    syncStatus: 'synced',
    receiptNumber: detail.sale.receipt_number ?? detail.sale.sale_id,
    createdAt,
    updatedAt,
    payload: {
      id: detail.sale.sale_id,
      customerId: detail.sale.customer_id ?? null,
      customerName: detail.sale.customer_name ?? null,
      recreatedFromSaleId: detail.sale.recreated_from_sale_id ?? null,
      personnelId: null,
      personnelName: detail.sale.personnel_name ?? detail.sale.driver_name ?? null,
      helperId: null,
      helperName: detail.sale.helper_name ?? null,
      saleType: toDesktopSaleType(detail.sale.sale_type),
      paymentMode: detail.sale.payment_total < detail.sale.total_amount ? 'PARTIAL' : 'FULL',
      paymentMethod: toDesktopPaymentMethod(primaryPaymentMethod),
      branchId: detail.sale.branch_id,
      branchLabel: detail.sale.branch_name,
      locationId: detail.sale.location_id,
      locationLabel: detail.sale.location_name,
      subtotal: detail.sale.subtotal,
      discountAmount: detail.sale.discount_amount,
      totalAmount: detail.sale.total_amount,
      paidAmount: detail.sale.payment_total,
      changeAmount: Math.max(0, Number((detail.sale.payment_total - detail.sale.total_amount).toFixed(2))),
      creditBalance: Math.max(0, Number((detail.sale.total_amount - detail.sale.payment_total).toFixed(2))),
      payments: detail.payments.map((payment) => ({
        id: payment.payment_id,
        source: payment.payment_source,
        method: toDesktopPaymentMethod(payment.method),
        amount: payment.amount,
        referenceNo: payment.reference_no ?? null,
        notes: payment.notes ?? null,
        createdAt: payment.posted_at ?? detail.sale.created_at
      })),
      commissionSplitMode: 'EQUAL',
      commissionTotal: Number(
        (detail.commissions ?? []).reduce((sum, commission) => sum + asNumber(commission.commission_amount), 0).toFixed(2)
      ),
      commissions: (detail.commissions ?? []).map((commission) => ({
        productId: commission.product_id,
        productName: commission.product_name,
        personnelId: commission.personnel_id ?? null,
        personnelName: commission.personnel_name,
        personnelRole: commission.personnel_role ?? null,
        saleType: commission.sale_type,
        quantity: asNumber(commission.qty),
        commissionRate: asNumber(commission.commission_rate),
        splitPercent: asNumber(commission.split_percent),
        commissionAmount: asNumber(commission.commission_amount)
      })),
      notes: null,
      lines: detail.lines.map((line) => ({
        lineId: line.line_id,
        productId: line.product_id,
        productName: line.product_name,
        quantity: line.qty,
        unitPrice: line.unit_price,
        lineTotal: line.line_total,
        cylinderFlow: line.cylinder_flow ?? null,
        pickupCommissionRate: 0,
        deliveryCommissionRate: 0
      })),
      createdAt
    }
  };
}

function toDesktopTransferRecord(record: TransferApiRecord): DesktopTransferRecord {
  const normalizedMode = String(record.transfer_mode ?? 'GENERAL').trim().toUpperCase();
  const transferMode: DesktopTransferRecord['transferMode'] =
    normalizedMode === 'SUPPLIER_RESTOCK_IN' ||
    normalizedMode === 'SUPPLIER_RESTOCK_OUT' ||
    normalizedMode === 'CREATE' ||
    normalizedMode === 'USED' ||
    normalizedMode === 'CONVERT' ||
    normalizedMode === 'INTER_STORE_TRANSFER' ||
    normalizedMode === 'STORE_TO_WAREHOUSE' ||
    normalizedMode === 'WAREHOUSE_TO_STORE'
      ? normalizedMode
      : 'GENERAL';

  return {
    id: record.id,
    sourceLocationId: record.source_location_id,
    sourceLocationLabel: record.source_location_label ?? record.source_location_id,
    destinationLocationId: record.destination_location_id,
    destinationLocationLabel: record.destination_location_label ?? record.destination_location_id,
    shiftId: record.shift_id ?? '',
    transferMode,
    supplierId: record.supplier_id ?? null,
    supplierName: record.supplier_name ?? null,
    notes: record.notes ?? null,
    lines: record.lines.map((line) => ({
      productId: line.product_id,
      productName: line.product_id,
      qtyFull: asNumber(line.qty_full),
      qtyEmpty: asNumber(line.qty_empty)
    })),
    syncStatus: record.status === 'POSTED' ? 'synced' : record.status === 'REVERSED' ? 'failed' : 'pending',
    lastError: record.reversal_reason ?? null,
    receivedStatus: 'pending',
    receivedAt: null,
    receivedBy: null,
    receivedNotes: null,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

function toRows(entity: string, records: Record<string, unknown>[]): DesktopMasterDataRow[] {
  const updatedAt = new Date().toISOString();
  return records
    .map((record) => {
      const recordId =
        asString(record.id) ??
        asString(record.code) ??
        asString(record.productId) ??
        asString(record.locationId);
      if (!recordId) {
        return null;
      }
      return {
        entity,
        recordId,
        payload: JSON.stringify(record),
        updatedAt
      };
    })
    .filter((row): row is DesktopMasterDataRow => Boolean(row));
}

async function loadLocalOnlyMasterDataRows(entity: string): Promise<DesktopMasterDataRow[]> {
  const rows = await desktopDb.listMasterData(entity);
  return rows.filter((row) => {
    try {
      const payload = JSON.parse(row.payload) as Record<string, unknown>;
      return payload.is_local_only === true;
    } catch {
      return false;
    }
  });
}

async function mergeLocalOnlyRows(entity: string, rows: DesktopMasterDataRow[]): Promise<DesktopMasterDataRow[]> {
  const preserved = await loadLocalOnlyMasterDataRows(entity);
  if (preserved.length === 0) {
    return rows;
  }
  const byKey = new Map(rows.map((row) => [row.recordId, row] as const));
  for (const row of preserved) {
    if (!byKey.has(row.recordId)) {
      byKey.set(row.recordId, row);
    }
  }
  return Array.from(byKey.values());
}

function withinWindow(priceList: PriceListRecord, now: Date): boolean {
  if (priceList.isActive === false) {
    return false;
  }
  const startsAt = priceList.startsAt ? new Date(priceList.startsAt) : null;
  const endsAt = priceList.endsAt ? new Date(priceList.endsAt) : null;
  if (startsAt && Number.isFinite(startsAt.getTime()) && startsAt.getTime() > now.getTime()) {
    return false;
  }
  if (endsAt && Number.isFinite(endsAt.getTime()) && endsAt.getTime() < now.getTime()) {
    return false;
  }
  return true;
}

export class DesktopMasterDataService {
  private isDetailCacheEligibleLendingStatus(status: DesktopLendingRecord['status'] | string | null | undefined): boolean {
    const normalized = String(status ?? '')
      .trim()
      .toUpperCase();
    return normalized === 'OPEN' || normalized === 'PARTIALLY_RETURNED' || normalized === 'OVERDUE';
  }

  private async cacheLendingDetails(
    state: DesktopAppState,
    lendingRows: DesktopLendingRecord[]
  ): Promise<{ rows: DesktopMasterDataRow[]; state: DesktopAppState }> {
    const lendingIds = Array.from(
      new Set(
        lendingRows
          .filter((row) => this.isDetailCacheEligibleLendingStatus(row.status))
          .map((row) => asString(row.lending_id) ?? asString((row as unknown as Record<string, unknown>).id))
          .filter((id): id is string => Boolean(id))
      )
    );

    if (lendingIds.length === 0) {
      return { rows: [], state };
    }

    const apiBase = normalizeBaseUrl(state.setup.apiBaseUrl);
    const updatedAt = new Date().toISOString();
    let nextState = state;
    const rows: DesktopMasterDataRow[] = [];

    for (const lendingId of lendingIds) {
      try {
        const detailResult = await desktopAuthService.authorizedFetch(
          nextState,
          `${apiBase}/lending/${encodeURIComponent(lendingId)}`
        );
        nextState = detailResult.state ?? nextState;
        if (!detailResult.response.ok) {
          continue;
        }
        const detail = (await detailResult.response.json()) as DesktopLendingDetail;
        const recordId = asString(detail.lending_id) ?? lendingId;
        rows.push({
          entity: 'lending_detail',
          recordId,
          payload: JSON.stringify(detail),
          updatedAt
        });
      } catch {
        // Non-blocking: keep already-cached details if one record fails to load.
      }
    }

    return { rows, state: nextState };
  }

  async fetchBranchOptions(state: DesktopAppState): Promise<{ options: DesktopOption[]; state: DesktopAppState }> {
    const { response, state: nextState } = await desktopAuthService.authorizedFetch(
      state,
      `${normalizeBaseUrl(state.setup.apiBaseUrl)}/master-data/branches`
    );
    if (!response.ok) {
      throw new Error(`Unable to load branches (${response.status})`);
    }
    const rows = (await response.json()) as BranchRecord[];
    return {
      state: nextState,
      options: rows
        .filter((row) => row.isActive !== false)
        .map((row) => ({
          id: row.id,
          label: row.name?.trim() || row.code?.trim() || row.id,
          subtitle: row.code?.trim() || undefined
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
    };
  }

  async fetchLocationOptions(state: DesktopAppState, branchId: string): Promise<{ options: DesktopOption[]; state: DesktopAppState }> {
    const { response, state: nextState } = await desktopAuthService.authorizedFetch(
      state,
      `${normalizeBaseUrl(state.setup.apiBaseUrl)}/master-data/locations`
    );
    if (!response.ok) {
      throw new Error(`Unable to load locations (${response.status})`);
    }
    const rows = (await response.json()) as LocationRecord[];
    return {
      state: nextState,
      options: rows
        .filter((row) => row.isActive !== false)
        .filter((row) => !row.branchId || row.branchId === branchId)
        .map((row) => ({
          id: row.id,
          branchId: row.branchId ?? undefined,
          label: row.name?.trim() || row.code?.trim() || row.id,
          subtitle: row.code?.trim() || undefined
        }))
        .sort((a, b) => a.label.localeCompare(b.label))
    };
  }

  async syncCatalog(
    state: DesktopAppState,
    branchId: string
  ): Promise<{
    productCount: number;
    customerCount: number;
    lendingCount: number;
    salesCount: number;
    transferCount: number;
    syncedAt: string;
    state: DesktopAppState;
  }> {
    const apiBase = normalizeBaseUrl(state.setup.apiBaseUrl);
    const [
      branchesResult,
      locationsResult,
      productsResult,
      cylinderTypesResult,
      inventoryOpeningResult,
      priceListsResult,
      expenseCategoriesResult,
      suppliersResult,
      personnelsResult,
      customersResult,
      lendingResult,
      lpgActionsResult,
      salesListResult,
      transfersResult
    ] = await Promise.all([
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/branches`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/locations`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/products`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/cylinder-types`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/inventory/opening-stock`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/price-lists`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/expense-categories`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/suppliers`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/personnels`),
      desktopAuthService.authorizedFetch(
        state,
        `${apiBase}/master-data/customers?include_balance=true&branch_id=${encodeURIComponent(branchId)}`
      ),
      desktopAuthService.authorizedFetch(
        state,
        `${apiBase}/lending?branch_id=${encodeURIComponent(branchId)}&limit=250`
      ),
      desktopAuthService.authorizedFetch(
        state,
        `${apiBase}/lpg-item-actions?branch_id=${encodeURIComponent(branchId)}&limit=500`
      ),
      desktopAuthService.authorizedFetch(
        state,
        `${apiBase}/reports/sales/list?branch_id=${encodeURIComponent(branchId)}&location_id=${encodeURIComponent(state.setup.locationId)}&limit=50`
      ),
      desktopAuthService.authorizedFetch(
        state,
        `${apiBase}/transfers?branch_id=${encodeURIComponent(branchId)}&limit=250`
      )
    ]);

    const nextState =
      transfersResult.state ??
      salesListResult.state ??
      lpgActionsResult.state ??
      lendingResult.state ??
      customersResult.state ??
      personnelsResult.state ??
      suppliersResult.state ??
      expenseCategoriesResult.state ??
      priceListsResult.state ??
      inventoryOpeningResult.state ??
      cylinderTypesResult.state ??
      productsResult.state ??
      locationsResult.state ??
      branchesResult.state;

    const endpointResults: Array<{ path: string; response: Response }> = [
      { path: '/master-data/branches', response: branchesResult.response },
      { path: '/master-data/locations', response: locationsResult.response },
      { path: '/master-data/products', response: productsResult.response },
      { path: '/master-data/cylinder-types', response: cylinderTypesResult.response },
      { path: '/master-data/inventory/opening-stock', response: inventoryOpeningResult.response },
      { path: '/master-data/price-lists', response: priceListsResult.response },
      { path: '/master-data/expense-categories', response: expenseCategoriesResult.response },
      { path: '/master-data/suppliers', response: suppliersResult.response },
      { path: '/master-data/personnels', response: personnelsResult.response },
      { path: '/master-data/customers', response: customersResult.response },
      { path: '/lending', response: lendingResult.response },
      { path: '/lpg-item-actions', response: lpgActionsResult.response },
      { path: '/reports/sales/list', response: salesListResult.response },
      { path: '/transfers', response: transfersResult.response }
    ];
    const failedEndpoints = endpointResults.filter((entry) => !entry.response.ok);
    if (failedEndpoints.length > 0) {
      const details = await Promise.all(
        failedEndpoints.map(async (entry) => {
          const detail = await readFetchErrorDetail(entry.response);
          return `${entry.path} (${entry.response.status})${detail ? `: ${detail}` : ''}`;
        })
      );
      const preview = details.slice(0, 2).join(' | ');
      const remainder = details.length > 2 ? ` (+${details.length - 2} more)` : '';
      throw new Error(`Unable to refresh desktop branch data from the server. ${preview}${remainder}`);
    }

    let finalState = nextState;
    let tenantAddonsRecord: Record<string, unknown> | null = null;
    try {
      const entitlementResult = await desktopAuthService.authorizedFetch(
        nextState,
        `${apiBase}/platform/entitlements/current`
      );
      finalState = entitlementResult.state ?? finalState;
      if (entitlementResult.response.ok) {
        const payload = (await entitlementResult.response.json()) as Record<string, unknown>;
        tenantAddonsRecord = {
          id: 'current',
          ...(payload.addons && typeof payload.addons === 'object' ? (payload.addons as Record<string, unknown>) : {})
        };
      }
    } catch {
      // Non-blocking: catalog refresh should still continue even if add-on fetch is unavailable.
    }

    let posControlPolicyRecord: Record<string, unknown> | null = null;
    try {
      const posSettingsResult = await desktopAuthService.authorizedFetch(
        finalState,
        `${apiBase}/platform/pos-settings/current`
      );
      finalState = posSettingsResult.state ?? finalState;
      if (posSettingsResult.response.ok) {
        const payload = (await posSettingsResult.response.json()) as Record<string, unknown>;
        posControlPolicyRecord = {
          id: 'current',
          ...normalizePosControlPolicy(payload)
        };
      }
    } catch {
      // Non-blocking: branch data refresh should still continue even if POS settings are unavailable.
    }

    const branchRows = (await branchesResult.response.json()) as BranchRecord[];
    const locationRows = (await locationsResult.response.json()) as LocationRecord[];
    const productRows = (await productsResult.response.json()) as ProductRecord[];
    const cylinderTypeRows = (await cylinderTypesResult.response.json()) as Record<string, unknown>[];
    const inventorySnapshot = (await inventoryOpeningResult.response.json()) as InventoryOpeningSnapshot;
    const priceListRows = (await priceListsResult.response.json()) as PriceListRecord[];
    const expenseCategoryRows = (await expenseCategoriesResult.response.json()) as Record<string, unknown>[];
    const supplierRows = (await suppliersResult.response.json()) as SupplierRecord[];
    const personnelRows = (await personnelsResult.response.json()) as PersonnelRecord[];
    const customerRows = (await customersResult.response.json()) as Record<string, unknown>[];
    const lendingRows = (await lendingResult.response.json()) as DesktopLendingRecord[];
    const lpgActionRows = (await lpgActionsResult.response.json()) as DesktopLpgItemActionRecord[];
    const salesListPayload = (await salesListResult.response.json()) as { rows?: SalesListReportRow[] };
    const transferRows = (await transfersResult.response.json()) as TransferApiRecord[];
    const salesListRows = Array.isArray(salesListPayload.rows) ? salesListPayload.rows : [];

    const salesDetailResults = await Promise.all(
      salesListRows.map(async (row) => {
        const detailResult = await desktopAuthService.authorizedFetch(
          nextState,
          `${apiBase}/reports/sales/${encodeURIComponent(row.sale_id)}`
        );
        if (!detailResult.response.ok) {
          return null;
        }
        return (await detailResult.response.json()) as SaleDetailReport;
      })
    );
    const salesRecords = salesDetailResults.filter((row): row is SaleDetailReport => Boolean(row)).map(toDesktopSaleRecord);
    const transferRecords = transferRows.map(toDesktopTransferRecord);
    const lendingDetailCache = await this.cacheLendingDetails(finalState, lendingRows);
    finalState = lendingDetailCache.state;

    const scopedLocations = locationRows.filter((row) => !row.branchId || row.branchId === branchId);
    const locationIdSet = new Set(scopedLocations.map((row) => row.id));
    const scopedInventoryRows = (inventorySnapshot.rows ?? []).filter((row) => {
      const locationId = asString(row.locationId);
      return Boolean(locationId && locationIdSet.has(locationId));
    });
    const scopedPriceLists = priceListRows.filter((row) => {
      const scope = (row.scope ?? '').toUpperCase();
      if (!scope || scope === 'GLOBAL') {
        return true;
      }
      if (scope === 'BRANCH') {
        return row.branchId === branchId;
      }
      return true;
    });

    await desktopDb.replaceMasterDataEntity('branch', toRows('branch', branchRows as Record<string, unknown>[]));
    await desktopDb.replaceMasterDataEntity('location', toRows('location', scopedLocations as Record<string, unknown>[]));
    await desktopDb.replaceMasterDataEntity('product', toRows('product', productRows as Record<string, unknown>[]));
    await desktopDb.replaceMasterDataEntity(
      'cylinder_type',
      toRows('cylinder_type', cylinderTypeRows)
    );
    await desktopDb.replaceMasterDataEntity(
      'inventory_balance',
      toRows('inventory_balance', scopedInventoryRows as Record<string, unknown>[])
    );
    await desktopDb.replaceMasterDataEntity(
      'price_list',
      toRows('price_list', scopedPriceLists as Record<string, unknown>[])
    );
    if (tenantAddonsRecord) {
      await desktopDb.replaceMasterDataEntity('tenant_addons', toRows('tenant_addons', [tenantAddonsRecord]));
    }
    if (posControlPolicyRecord) {
      await desktopDb.replaceMasterDataEntity(
        'pos_control_policy',
        toRows('pos_control_policy', [posControlPolicyRecord])
      );
    }
    await desktopDb.replaceMasterDataEntity(
      'expense_category',
      toRows('expense_category', expenseCategoryRows)
    );
    await desktopDb.replaceMasterDataEntity('supplier', toRows('supplier', supplierRows as Record<string, unknown>[]));
    await desktopDb.replaceMasterDataEntity(
      'personnel',
      toRows(
        'personnel',
        personnelRows.filter((row) => {
          const explicitBranchId = row.branchId ?? null;
          return explicitBranchId ? explicitBranchId === branchId : true;
        }) as unknown as Record<string, unknown>[]
      )
    );
    await desktopDb.replaceMasterDataEntity('customer', await mergeLocalOnlyRows('customer', toRows('customer', customerRows)));
    await desktopDb.replaceMasterDataEntity(
      'lending',
      await mergeLocalOnlyRows('lending', toRows('lending', lendingRows as unknown as Record<string, unknown>[]))
    );
    await desktopDb.replaceMasterDataEntity(
      'lending_detail',
      await mergeLocalOnlyRows('lending_detail', lendingDetailCache.rows)
    );
    await desktopDb.replaceMasterDataEntity(
      'lpg_item_action',
      toRows('lpg_item_action', lpgActionRows as unknown as Record<string, unknown>[])
    );
    await desktopDb.replaceMasterDataEntity(
      'remote_sale',
      toRows('remote_sale', salesRecords as unknown as Record<string, unknown>[])
    );
    await desktopDb.replaceMasterDataEntity(
      'remote_transfer',
      toRows('remote_transfer', transferRecords as unknown as Record<string, unknown>[])
    );

    const downloadCounts = {
      branches: branchRows.length,
      locations: scopedLocations.length,
      products: productRows.length,
      cylinder_types: cylinderTypeRows.length,
      customers: customerRows.length,
      suppliers: supplierRows.length,
      personnels: personnelRows.length,
      tenant_addons: tenantAddonsRecord ? 1 : 0,
      pos_control_policy: posControlPolicyRecord ? 1 : 0,
      lending: lendingRows.length,
      lending_details: lendingDetailCache.rows.length,
      lpg_item_actions: lpgActionRows.length,
      sales: salesRecords.length,
      transfers: transferRecords.length
    };
    await this.reportDownloadAudit(finalState, branchId, downloadCounts);

    return {
      productCount: productRows.filter((row) => row.isActive !== false).length,
      customerCount: customerRows.length,
      lendingCount: lendingRows.length,
      salesCount: salesRecords.length,
      transferCount: transferRecords.length,
      syncedAt: new Date().toISOString(),
      state: finalState
    };
  }

  private async reportDownloadAudit(
    state: DesktopAppState,
    branchId: string,
    counts: Record<string, number>
  ): Promise<void> {
    const apiBase = normalizeBaseUrl(state.setup.apiBaseUrl);
    try {
      await desktopAuthService.authorizedFetch(state, `${apiBase}/sync/download-audit`, {
        method: 'POST',
        body: JSON.stringify({
          source: 'desktop',
          device_id: state.setup.deviceId || 'desktop-branch-bootstrap',
          branch_id: branchId,
          downloaded_at: new Date().toISOString(),
          counts
        })
      });
    } catch {
      // non-blocking: desktop branch download should still complete
    }
  }

  async loadCachedSales(branchId?: string, locationId?: string, maxRows = 1500): Promise<DesktopSaleRecord[]> {
    const rows = await desktopDb.listMasterData('remote_sale');
    const boundedRows = [...rows]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, Math.max(1, maxRows));
    return boundedRows
      .map((row) => safeParse(row.payload) as unknown as DesktopSaleRecord)
      .filter((row) => !branchId || row.payload.branchId === branchId)
      .filter((row) => !locationId || row.payload.locationId === locationId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async loadCustomers(): Promise<DesktopOption[]> {
    const [customerRows, saleRows, outboxRows] = await Promise.all([
      desktopDb.listMasterData('customer'),
      desktopDb.listSales(),
      desktopDb.listOutboxItems()
    ]);

    const projectedLocalSaleIds = new Set(
      saleRows.filter((sale) => isProjectedSaleStatus(sale.syncStatus)).map((sale) => sale.id)
    );

    const receivablesByCustomerId = new Map<string, number>();
    for (const sale of saleRows) {
      if (!isProjectedSaleStatus(sale.syncStatus)) {
        continue;
      }
      if (isCancelledSaleStatus(sale.saleStatus)) {
        continue;
      }
      const customerId = sale.payload.customerId?.trim() || '';
      const paymentMode = sale.payload.paymentMode ?? 'FULL';
      const creditBalance = Number(sale.payload.creditBalance ?? 0);
      if (!customerId || paymentMode !== 'PARTIAL' || !Number.isFinite(creditBalance) || creditBalance <= 0) {
        continue;
      }
      receivablesByCustomerId.set(
        customerId,
        Number(((receivablesByCustomerId.get(customerId) ?? 0) + creditBalance).toFixed(2))
      );
    }

    const paymentsByCustomerId = new Map<string, number>();
    for (const row of outboxRows) {
      if (row.entity !== 'customer_payment' || !isProjectedOutboxStatus(row.status)) {
        continue;
      }
      const payload = row.payload as Record<string, unknown>;
      const customerId =
        asString(payload.customer_id) ??
        asString(payload.customerId) ??
        asString(payload.customer_code) ??
        asString(payload.customerCode);
      const purpose = asString(payload.purpose)?.trim().toUpperCase() ?? 'SALE_BALANCE';
      if (purpose === 'LENDING_DEPOSIT') {
        continue;
      }
      const linkedSaleId = asString(payload.sale_id) ?? asString(payload.saleId);
      if (linkedSaleId && projectedLocalSaleIds.has(linkedSaleId)) {
        // Sale-linked payments are already reflected in the local sale credit balance.
        continue;
      }
      const amount = asNumber(payload.amount);
      if (!customerId || amount <= 0) {
        continue;
      }
      paymentsByCustomerId.set(
        customerId,
        Number(((paymentsByCustomerId.get(customerId) ?? 0) + amount).toFixed(2))
      );
    }

    const options: DesktopOption[] = [];
    for (const row of customerRows) {
      const payload = safeParse(row.payload);
      const id = asString(payload.id);
      if (!id) {
        continue;
      }
      const name = asString(payload.name) ?? asString(payload.display_name) ?? id;
      const code = asString(payload.code);
      const address = asString(payload.address);
      const contactNumber = asString(payload.contactNumber ?? payload.contact_number);
      const gas = asString(payload.gas);
      const province = asString(payload.province);
      const city = asString(payload.city);
      const tier = asString(payload.tier);
      const customerCategoryId = asString(payload.customerCategoryId ?? payload.customer_category_id);
      const contractPrice = asOptionalNumber(payload.contractPrice ?? payload.contract_price);
      const baseBalance = asNumber(payload.outstandingBalance ?? payload.outstanding_balance);
      const receivable = receivablesByCustomerId.get(id) ?? 0;
      const payment = paymentsByCustomerId.get(id) ?? 0;
      const balance = Number(Math.max(0, baseBalance + receivable - payment).toFixed(2));
      const pointsBalance = asNumber(payload.pointsBalance ?? payload.points_balance);
      options.push({
        id,
        label: name,
        address: address ?? undefined,
        contactNumber: contactNumber ?? undefined,
        gas: gas ?? undefined,
        province: province ?? undefined,
        city: city ?? undefined,
        subtitle: [code, `Bal ${balance.toFixed(2)}`, `Pts ${Math.floor(pointsBalance)}`]
          .filter(Boolean)
          .join(' · '),
        balance,
        pointsBalance: Math.floor(pointsBalance),
        tier,
        customerCategoryId,
        contractPrice
      });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }

  async loadTenantAddons(): Promise<TenantAddonFlags> {
    const rows = await desktopDb.listMasterData('tenant_addons');
    const latest = rows
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    if (!latest?.payload) {
      return { ...DEFAULT_TENANT_ADDONS };
    }
    const payload = safeParse(latest.payload);
    const source =
      payload.addons && typeof payload.addons === 'object' && !Array.isArray(payload.addons)
        ? (payload.addons as Record<string, unknown>)
        : payload;
    return {
      ...DEFAULT_TENANT_ADDONS,
      email_features: asBoolean(source.email_features),
      email_report: asBoolean(source.email_report),
      email_customer_balance: asBoolean(source.email_customer_balance),
      sms_alerts: asBoolean(source.sms_alerts),
      auto_report_digest: asBoolean(source.auto_report_digest),
      custom_pricing: asBoolean(source.custom_pricing),
      customer_category: asBoolean(source.customer_category),
      item_price_cost_audit: asBoolean(source.item_price_cost_audit),
      petty_cash_attachments: asBoolean(source.petty_cash_attachments),
      shift_security_controls: asBoolean(source.shift_security_controls),
      kilo_overview_chart: asBoolean(source.kilo_overview_chart),
      receipt_amount_privacy: asBoolean(source.receipt_amount_privacy),
      purchase_order_suite: asBoolean(source.purchase_order_suite),
      delivery_dispatch_suite: asBoolean(source.delivery_dispatch_suite),
      queue_order_filtering: asBoolean(source.queue_order_filtering),
      cashier_end_of_day_inventory_count: asBoolean(source.cashier_end_of_day_inventory_count)
    };
  }

  async loadPosControlPolicy(): Promise<DesktopPosControlPolicy> {
    const rows = await desktopDb.listMasterData('pos_control_policy');
    const latest = rows
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    if (!latest?.payload) {
      return { ...DEFAULT_DESKTOP_POS_CONTROL_POLICY };
    }
    const payload = safeParse(latest.payload);
    return normalizePosControlPolicy(payload, latest.updatedAt);
  }

  async createOfflineCustomer(input: {
    name: string;
    address?: string | null;
    code?: string | null;
    contactNumber?: string | null;
    gas?: string | null;
    province?: string | null;
    city?: string | null;
  }): Promise<string> {
    const name = input.name.trim();
    if (!name) {
      throw new Error('Customer name is required.');
    }

    const now = new Date().toISOString();
    const id = `customer-local-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const payload = {
      id,
      code: input.code?.trim() || null,
      name,
      address: input.address?.trim() || null,
      contactNumber: input.contactNumber?.trim() || null,
      gas: input.gas?.trim() || null,
      province: input.province?.trim() || null,
      city: input.city?.trim() || null,
      type: 'RETAIL',
      tier: null,
      contractPrice: null,
      outstandingBalance: 0,
      pointsBalance: 0,
      isActive: true,
      is_local_only: true,
      local_created_at: now,
      created_at: now,
      updated_at: now
    };

    await desktopDb.upsertMasterDataRows([
      {
        entity: 'customer',
        recordId: id,
        payload: JSON.stringify(payload),
        updatedAt: now
      }
    ]);

    await desktopDb.enqueueOutboxItem({
      id: `outbox-customer-${id}`,
      entity: 'customer',
      action: 'create',
      payload,
      idempotency_key: `idem-customer-${id}`,
      created_at: now
    });

    return id;
  }

  async loadSuppliers(): Promise<DesktopOption[]> {
    const rows = await desktopDb.listMasterData('supplier');
    return rows
      .map((row) => safeParse(row.payload) as unknown as SupplierRecord)
      .filter((row) => row.isActive !== false)
      .map((row) => ({
        id: row.id,
        label: row.name?.trim() || row.code?.trim() || row.id,
        subtitle: row.code?.trim() || undefined
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async loadExpenseCategoryOptions(): Promise<DesktopOption[]> {
    const rows = await desktopDb.listMasterData('expense_category');
    return rows
      .map((row) => safeParse(row.payload))
      .filter((row) => row.isActive !== false && row.is_active !== false)
      .map((row) => {
        const id = asString(row.code) ?? asString(row.id) ?? row.code?.toString?.() ?? 'UNKNOWN';
        const label = asString(row.name) ?? id;
        const subtitle = asString(row.code) && asString(row.name) ? asString(row.code) ?? undefined : undefined;
        return {
          id,
          label,
          subtitle
        } satisfies DesktopOption;
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async loadPersonnelOptions(): Promise<DesktopOption[]> {
    const rows = await desktopDb.listMasterData('personnel');
    return rows
      .map((row) => safeParse(row.payload) as unknown as PersonnelRecord)
      .filter((row) => row.isActive !== false)
      .map((row) => {
        const code = asString(row.code) ?? null;
        const fullName =
          buildFullName(row as unknown as Record<string, unknown>) ??
          asString(row.fullName) ??
          asString(row.full_name) ??
          asString(row.name);
        const roleLabel =
          row.role?.name?.trim() ||
          row.role?.code?.trim() ||
          asString(row.roleName) ||
          asString(row.role_name) ||
          asString(row.roleCode) ||
          asString(row.role_code) ||
          null;
        return {
          id: row.id,
          label: code && fullName ? `${code} - ${fullName}` : fullName ?? code ?? row.id,
          subtitle: roleLabel ?? undefined,
          roleName: roleLabel,
          salaryType: row.salaryType ?? row.salary_type ?? 'MONTHLY',
          salaryRate: asNumber(row.salaryRate ?? row.salary_rate),
          commissionEligible:
            row.commissionEligible === undefined && row.commission_eligible === undefined
              ? true
              : asBoolean(row.commissionEligible ?? row.commission_eligible)
        } satisfies DesktopOption;
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async loadLpgItemActions(
    branchId?: string,
    locationId?: string,
    productId?: string
  ): Promise<DesktopLpgItemActionRecord[]> {
    const rows = await desktopDb.listMasterData('lpg_item_action');
    return rows
      .map((row) => safeParse(row.payload) as unknown as DesktopLpgItemActionRecord)
      .filter((row) => !branchId || row.branchId === branchId)
      .filter((row) => !locationId || row.locationId === locationId)
      .filter((row) => !productId || row.productId === productId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async loadCatalog(locationId: string): Promise<DesktopCatalogProduct[]> {
    const [productRows, inventoryRows, priceListRows, cylinderRows] = await Promise.all([
      desktopDb.listMasterData('product'),
      desktopDb.listMasterData('inventory_balance'),
      desktopDb.listMasterData('price_list'),
      desktopDb.listMasterData('cylinder_type')
    ]);

    const cylinderSizeById = new Map<string, string>();
    for (const row of cylinderRows) {
      const payload = safeParse(row.payload);
      const id = asString(payload.id) ?? row.recordId;
      if (!id || cylinderSizeById.has(id)) {
        continue;
      }
      const sizeSource = payload.sizeKg ?? payload.size_kg ?? payload.size;
      const sizeRaw =
        typeof sizeSource === 'number'
          ? Number.isFinite(sizeSource)
            ? String(sizeSource)
            : null
          : asString(sizeSource);
      if (!sizeRaw) {
        continue;
      }
      const sizeNumeric = Number(sizeRaw);
      const sizeLabel =
        Number.isFinite(sizeNumeric) && sizeNumeric > 0 ? `${sizeNumeric} kg` : sizeRaw.trim();
      if (sizeLabel) {
        cylinderSizeById.set(id, sizeLabel);
      }
    }

    const inventoryByProduct = new Map<string, { qtyOnHand: number; qtyFull: number; qtyEmpty: number }>();
    for (const row of inventoryRows) {
      const payload = safeParse(row.payload);
      const productId = asString(payload.productId);
      const inventoryLocationId = asString(payload.locationId);
      if (!productId || inventoryLocationId !== locationId) {
        continue;
      }
      inventoryByProduct.set(productId, {
        qtyOnHand: asNumber(payload.qtyOnHand),
        qtyFull: asNumber(payload.qtyFull),
        qtyEmpty: asNumber(payload.qtyEmpty)
      });
    }

    const activePriceLists = priceListRows
      .map((row) => safeParse(row.payload) as unknown as PriceListRecord)
      .filter((row) => withinWindow(row, new Date()))
      .sort((a, b) => {
        const aScope = (a.scope ?? '').toUpperCase() === 'BRANCH' ? 0 : 1;
        const bScope = (b.scope ?? '').toUpperCase() === 'BRANCH' ? 0 : 1;
        return aScope - bScope;
      });

    const priceByProduct = new Map<string, number>();
    for (const priceList of activePriceLists) {
      const rules = Array.isArray(priceList.rules) ? [...priceList.rules] : [];
      rules
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
        .forEach((rule) => {
          const productId = asString(rule.productId);
          const flowMode = (rule.flowMode ?? 'ANY').toUpperCase();
          if (!productId || priceByProduct.has(productId)) {
            return;
          }
          if (flowMode !== 'ANY' && flowMode !== 'REFILL_EXCHANGE' && flowMode !== 'NON_REFILL') {
            return;
          }
          priceByProduct.set(productId, asNumber(rule.unitPrice));
        });
    }

    return productRows
      .map((row) => safeParse(row.payload) as unknown as ProductRecord)
      .filter((row) => row.isActive !== false)
      .map((row) => {
        const inventory = inventoryByProduct.get(row.id) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
        const sizeCandidate = row.sizeKg ?? row.size_kg ?? row.size ?? row.cylinderSize ?? row.cylinder_size;
        const sizeRaw =
          typeof sizeCandidate === 'number'
            ? Number.isFinite(sizeCandidate)
              ? String(sizeCandidate)
              : null
            : asString(sizeCandidate);
        const sizeNumeric = sizeRaw ? Number(sizeRaw) : Number.NaN;
        const cylinderTypeId = asString(row.cylinderTypeId ?? row.cylinder_type_id);
        const cylinderSizeLabel =
          Number.isFinite(sizeNumeric) && sizeNumeric > 0
            ? `${sizeNumeric} kg`
            : sizeRaw && sizeRaw.trim().length > 0
              ? sizeRaw.trim()
              : cylinderTypeId
                ? (cylinderSizeById.get(cylinderTypeId) ?? null)
                : null;
        return {
          id: row.id,
          sku: row.sku?.trim() || row.id,
          name: row.name?.trim() || row.sku?.trim() || row.id,
          category: row.category?.trim() || 'Uncategorized',
          unit: row.unit?.trim() || 'unit',
          cylinderSizeLabel,
          unitPrice: priceByProduct.get(row.id) ?? asNumber(row.standardCost),
          qtyOnHand: inventory.qtyOnHand,
          qtyFull: inventory.qtyFull,
          qtyEmpty: inventory.qtyEmpty,
          isLpg: Boolean(row.isLpg),
          pickupCommissionRate: Math.max(
            0,
            asNumber(row.pickupCommissionRate ?? row.pickup_commission_rate)
          ),
          deliveryCommissionRate: Math.max(
            0,
            asNumber(row.deliveryCommissionRate ?? row.delivery_commission_rate)
          )
        } satisfies DesktopCatalogProduct;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async loadLendingRecords(branchId?: string, locationId?: string): Promise<DesktopLendingRecord[]> {
    const rows = await desktopDb.listMasterData('lending');
    return rows
      .map((row) => safeParse(row.payload) as unknown as DesktopLendingRecord)
      .filter((row) => !branchId || row.branch_id === branchId)
      .filter((row) => !locationId || row.location_id === locationId)
      .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime());
  }

  async refreshLendingRecords(
    state: DesktopAppState,
    branchId: string
  ): Promise<{ count: number; state: DesktopAppState }> {
    const { response, state: nextState } = await desktopAuthService.authorizedFetch(
      state,
      `${normalizeBaseUrl(state.setup.apiBaseUrl)}/lending?branch_id=${encodeURIComponent(branchId)}&limit=250`
    );
    if (!response.ok) {
      throw new Error(`Unable to load lending records (${response.status})`);
    }
    const rows = (await response.json()) as DesktopLendingRecord[];
    const detailCache = await this.cacheLendingDetails(nextState, rows);
    await desktopDb.replaceMasterDataEntity(
      'lending',
      await mergeLocalOnlyRows('lending', toRows('lending', rows as unknown as Record<string, unknown>[]))
    );
    await desktopDb.replaceMasterDataEntity(
      'lending_detail',
      await mergeLocalOnlyRows('lending_detail', detailCache.rows)
    );
    return {
      count: rows.length,
      state: detailCache.state
    };
  }

  async loadCachedLendingDetail(lendingId: string): Promise<DesktopLendingDetail | null> {
    const rows = await desktopDb.listMasterData('lending_detail');
    const match = rows.find((row) => row.recordId === lendingId);
    if (!match) {
      return null;
    }
    return safeParse(match.payload) as unknown as DesktopLendingDetail;
  }

  async refreshLendingDetail(
    state: DesktopAppState,
    lendingId: string
  ): Promise<{ detail: DesktopLendingDetail; state: DesktopAppState }> {
    const { response, state: nextState } = await desktopAuthService.authorizedFetch(
      state,
      `${normalizeBaseUrl(state.setup.apiBaseUrl)}/lending/${encodeURIComponent(lendingId)}`
    );
    if (!response.ok) {
      throw new Error(`Unable to load lending detail (${response.status})`);
    }
    const detail = (await response.json()) as DesktopLendingDetail;
    await desktopDb.upsertMasterDataRows([
      {
        entity: 'lending_detail',
        recordId: lendingId,
        payload: JSON.stringify(detail),
        updatedAt: new Date().toISOString()
      }
    ]);
    return { detail, state: nextState };
  }

  async recordLendingReturn(
    state: DesktopAppState,
    lendingId: string,
    draft: DesktopLendingReturnDraft
  ): Promise<{ detail: DesktopLendingDetail; state: DesktopAppState }> {
    const { response, state: nextState } = await desktopAuthService.authorizedFetch(
      state,
      `${normalizeBaseUrl(state.setup.apiBaseUrl)}/lending/${encodeURIComponent(lendingId)}/return`,
      {
        method: 'POST',
        body: JSON.stringify({
          remarks: draft.remarks ?? null,
          received_by_user_id: draft.received_by_user_id ?? null,
          lines: draft.lines.map((line) => ({
            lending_line_id: line.lending_line_id,
            returned_qty: line.returned_qty,
            condition: line.condition,
            remarks: line.remarks ?? null
          }))
        })
      }
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(detail || `Unable to record lending return (${response.status})`);
    }
    const detail = (await response.json()) as DesktopLendingDetail;
    const now = new Date().toISOString();
    await desktopDb.upsertMasterDataRows([
      {
        entity: 'lending_detail',
        recordId: lendingId,
        payload: JSON.stringify(detail),
        updatedAt: now
      },
      {
        entity: 'lending',
        recordId: lendingId,
        payload: JSON.stringify(detail),
        updatedAt: now
      }
    ]);
    return { detail, state: nextState };
  }
}

export const desktopMasterDataService = new DesktopMasterDataService();

