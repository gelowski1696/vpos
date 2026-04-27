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
  branchId?: string | null;
  roleId?: string | null;
  personnelRoleId?: string | null;
  role?: { id?: string; name?: string; code?: string } | null;
  isActive?: boolean;
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
  startsAt?: string;
  endsAt?: string | null;
  isActive?: boolean;
  rules?: PriceRuleRecord[];
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

function isProjectedSaleStatus(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'pending' || normalized === 'processing' || normalized === 'synced';
}

function isProjectedOutboxStatus(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'pending' || normalized === 'processing' || normalized === 'synced';
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
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
        method: toDesktopPaymentMethod(payment.method),
        amount: payment.amount,
        referenceNo: payment.reference_no ?? null
      })),
      notes: null,
      lines: detail.lines.map((line) => ({
        lineId: line.line_id,
        productId: line.product_id,
        productName: line.product_name,
        quantity: line.qty,
        unitPrice: line.unit_price,
        lineTotal: line.line_total,
        cylinderFlow: line.cylinder_flow ?? null
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
      productsResult.state ??
      locationsResult.state ??
      branchesResult.state;

    if (
      !branchesResult.response.ok ||
      !locationsResult.response.ok ||
      !productsResult.response.ok ||
      !inventoryOpeningResult.response.ok ||
      !priceListsResult.response.ok ||
      !expenseCategoriesResult.response.ok ||
      !suppliersResult.response.ok ||
      !personnelsResult.response.ok ||
      !customersResult.response.ok ||
      !lendingResult.response.ok ||
      !lpgActionsResult.response.ok ||
      !salesListResult.response.ok ||
      !transfersResult.response.ok
    ) {
      throw new Error('Unable to refresh desktop branch data from the server.');
    }

    const branchRows = (await branchesResult.response.json()) as BranchRecord[];
    const locationRows = (await locationsResult.response.json()) as LocationRecord[];
    const productRows = (await productsResult.response.json()) as ProductRecord[];
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
      return false;
    });

    await desktopDb.replaceMasterDataEntity('branch', toRows('branch', branchRows as Record<string, unknown>[]));
    await desktopDb.replaceMasterDataEntity('location', toRows('location', scopedLocations as Record<string, unknown>[]));
    await desktopDb.replaceMasterDataEntity('product', toRows('product', productRows as Record<string, unknown>[]));
    await desktopDb.replaceMasterDataEntity(
      'inventory_balance',
      toRows('inventory_balance', scopedInventoryRows as Record<string, unknown>[])
    );
    await desktopDb.replaceMasterDataEntity(
      'price_list',
      toRows('price_list', scopedPriceLists as Record<string, unknown>[])
    );
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
    await desktopDb.replaceMasterDataEntity('lending', toRows('lending', lendingRows as unknown as Record<string, unknown>[]));
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
      customers: customerRows.length,
      suppliers: supplierRows.length,
      personnels: personnelRows.length,
      lending: lendingRows.length,
      lpg_item_actions: lpgActionRows.length,
      sales: salesRecords.length,
      transfers: transferRecords.length
    };
    await this.reportDownloadAudit(nextState, branchId, downloadCounts);

    return {
      productCount: productRows.filter((row) => row.isActive !== false).length,
      customerCount: customerRows.length,
      lendingCount: lendingRows.length,
      salesCount: salesRecords.length,
      transferCount: transferRecords.length,
      syncedAt: new Date().toISOString(),
      state: nextState
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

    const receivablesByCustomerId = new Map<string, number>();
    for (const sale of saleRows) {
      if (!isProjectedSaleStatus(sale.syncStatus)) {
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
        pointsBalance: Math.floor(pointsBalance)
      });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
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
        const roleLabel = row.role?.name?.trim() || row.role?.code?.trim() || null;
        return {
          id: row.id,
          label: row.name?.trim() || row.code?.trim() || row.id,
          subtitle: [row.code?.trim(), roleLabel].filter(Boolean).join(' | ') || undefined
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
          isLpg: Boolean(row.isLpg)
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
    await desktopDb.replaceMasterDataEntity('lending', toRows('lending', rows as unknown as Record<string, unknown>[]));
    return {
      count: rows.length,
      state: nextState
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

