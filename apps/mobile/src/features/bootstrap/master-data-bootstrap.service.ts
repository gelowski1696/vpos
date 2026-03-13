import type { SQLiteDatabase } from 'expo-sqlite';
import type { MasterDataOption } from '../../app/master-data-local';
import { normalizeApiBaseUrl } from '../../app/api-base-url';

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

type MasterDataBootstrapOptions = {
  baseUrl: string;
  db: SQLiteDatabase;
  getAccessToken: () => Promise<string | undefined>;
  getClientId?: () => Promise<string | undefined>;
};

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
  isActive?: boolean;
};

type PriceListRecord = {
  id: string;
  scope?: string;
  branchId?: string | null;
  updatedAt?: string;
  updated_at?: string;
};

type InventoryOpeningSnapshot = {
  asOf?: string;
  rows?: Array<{
    locationId?: string;
    productId?: string;
    qtyOnHand?: number;
    qtyFull?: number;
    qtyEmpty?: number;
    avgCost?: number;
    inventoryValue?: number;
    hasOpeningEntry?: boolean;
    hasTransactionalMovements?: boolean;
    lastMovementAt?: string | null;
  }>;
};

type ServerProbeResult = {
  online: boolean;
  message: string;
};

type BootstrapResult = {
  downloadedAt: string;
  fingerprint: string;
  counts: Record<string, number>;
};

type BranchScopedData = {
  branches: BranchRecord[];
  locations: LocationRecord[];
  users: Record<string, unknown>[];
  personnels: Record<string, unknown>[];
  customers: Record<string, unknown>[];
  suppliers: Record<string, unknown>[];
  products: Record<string, unknown>[];
  cylinderTypes: Record<string, unknown>[];
  cylinders: Array<{ serial: string; typeCode?: string; status?: string; locationId?: string; updatedAt?: string }>;
  inventoryBalances: Record<string, unknown>[];
  expenseCategories: Record<string, unknown>[];
  priceLists: PriceListRecord[];
};

function readStringField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeOptions(rows: BranchRecord[]): MasterDataOption[] {
  return rows
    .filter((row) => row && typeof row.id === 'string' && row.id.trim().length > 0)
    .map((row) => ({
      id: row.id,
      label: row.name?.trim() || row.code?.trim() || row.id,
      subtitle: row.code?.trim() || undefined
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function filterLocationsByBranch(rows: LocationRecord[], branchId: string): LocationRecord[] {
  return rows.filter((row) => {
    if (!row || typeof row.id !== 'string') {
      return false;
    }
    return !row.branchId || row.branchId === branchId;
  });
}

function filterPriceListsByBranch(rows: PriceListRecord[], branchId: string): PriceListRecord[] {
  return rows.filter((row) => {
    if (!row || typeof row.id !== 'string') {
      return false;
    }
    if ((row.scope || '').toUpperCase() !== 'BRANCH') {
      return true;
    }
    return row.branchId === branchId;
  });
}

function readTimestamp(value: Record<string, unknown>): string {
  const direct = value.updatedAt;
  if (typeof direct === 'string' && direct.trim()) {
    return direct;
  }
  const snake = value.updated_at;
  if (typeof snake === 'string' && snake.trim()) {
    return snake;
  }
  return '';
}

const CUSTOMER_FINGERPRINT_VOLATILE_KEYS = new Set([
  'outstandingBalance',
  'outstanding_balance',
  'balanceDue',
  'balance_due',
  'creditBalance',
  'credit_balance',
  'lastPaymentAt',
  'last_payment_at'
]);

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }
  if (value && typeof value === 'object') {
    const asRecord = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    Object.keys(asRecord)
      .sort((a, b) => a.localeCompare(b))
      .forEach((key) => {
        next[key] = sortKeysDeep(asRecord[key]);
      });
    return next;
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sanitizeCustomerForFingerprint(row: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...row };
  for (const key of CUSTOMER_FINGERPRINT_VOLATILE_KEYS) {
    delete next[key];
  }
  return next;
}

function normalizeForFingerprint(
  rows: Record<string, unknown>[],
  sanitizer?: (row: Record<string, unknown>) => Record<string, unknown>
): string {
  const compact = rows
    .map((sourceRow) => {
      const row = sanitizer ? sanitizer(sourceRow) : sourceRow;
      const id = typeof row.id === 'string' ? row.id : '';
      const updated = readTimestamp(row);
      const payload = stableStringify(row);
      return `${id}|${updated}|${payload}`;
    })
    .sort();
  return compact.join('||');
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  const normalized = hash >>> 0;
  return normalized.toString(16).padStart(8, '0');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export class MasterDataBootstrapService {
  private readonly baseUrl: string;
  private readonly db: SQLiteDatabase;
  private readonly getAccessToken: () => Promise<string | undefined>;
  private readonly getClientId?: () => Promise<string | undefined>;
  private readonly fetchFn: FetchLike;

  constructor(options: MasterDataBootstrapOptions) {
    this.baseUrl = normalizeApiBaseUrl(options.baseUrl);
    this.db = options.db;
    this.getAccessToken = options.getAccessToken;
    this.getClientId = options.getClientId;
    const availableFetch = (globalThis as { fetch?: FetchLike }).fetch;
    if (!availableFetch) {
      throw new Error('Global fetch is not available in this runtime');
    }
    this.fetchFn = availableFetch;
  }

  async probeServer(): Promise<ServerProbeResult> {
    const token = await this.getAccessToken();
    if (!token) {
      return { online: false, message: 'No active access token. Please sign in again.' };
    }

    try {
      const response = await withTimeout(
        this.fetchFn(`${this.baseUrl}/sync/pull?since=0&device_id=bootstrap-probe`, {
          method: 'GET',
          headers: await this.headers(token)
        }),
        6000,
        'Server check timed out'
      );

      if (response.ok || response.status === 401 || response.status === 403 || response.status === 400) {
        return { online: true, message: 'Server reachable.' };
      }

      const detail = await response.text();
      return { online: false, message: `Server responded ${response.status}: ${detail || 'Unavailable'}` };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to reach server';
      return { online: false, message };
    }
  }

  async fetchBranchOptions(): Promise<MasterDataOption[]> {
    const branches = await this.getJson<BranchRecord[]>('/master-data/branches');
    const active = branches.filter((row) => row.isActive !== false);
    return normalizeOptions(active);
  }

  async fetchLocationOptions(branchId: string): Promise<MasterDataOption[]> {
    const locations = await this.getJson<LocationRecord[]>('/master-data/locations');
    const filtered = filterLocationsByBranch(locations, branchId).filter((row) => row.isActive !== false);
    return filtered
      .map((row) => ({
        id: row.id,
        label: row.name?.trim() || row.code?.trim() || row.id,
        subtitle: row.code?.trim() || undefined,
        branchId: row.branchId ?? undefined
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  async bootstrapForBranch(branchId: string): Promise<BootstrapResult> {
    const scoped = await this.fetchBranchScopedData(branchId);
    const downloadedAt = new Date().toISOString();
    const fingerprint = this.computeFingerprint(scoped);

    await this.db.withTransactionAsync(async () => {
      await this.replaceEntity('branch', scoped.branches, downloadedAt);
      await this.replaceEntity('location', scoped.locations, downloadedAt);
      await this.replaceEntity('user', scoped.users, downloadedAt);
      await this.replaceEntity('personnel', scoped.personnels, downloadedAt);
      await this.replaceEntity('customer', scoped.customers, downloadedAt);
      await this.replaceEntity('supplier', scoped.suppliers, downloadedAt);
      await this.replaceEntity('product', scoped.products, downloadedAt);
      await this.replaceEntity('cylinder_type', scoped.cylinderTypes, downloadedAt);
      await this.replaceEntity('inventory_balance', scoped.inventoryBalances, downloadedAt);
      await this.replaceEntity('expense_category', scoped.expenseCategories, downloadedAt);
      await this.replaceEntity('price_list', scoped.priceLists, downloadedAt);
      await this.replaceCylinders(scoped.cylinders, downloadedAt);
    });

    return {
      downloadedAt,
      fingerprint,
      counts: {
        branches: scoped.branches.length,
        locations: scoped.locations.length,
        users: scoped.users.length,
        personnels: scoped.personnels.length,
        customers: scoped.customers.length,
        suppliers: scoped.suppliers.length,
        products: scoped.products.length,
        cylinderTypes: scoped.cylinderTypes.length,
        cylinders: scoped.cylinders.length,
        inventoryBalances: scoped.inventoryBalances.length,
        expenseCategories: scoped.expenseCategories.length,
        priceLists: scoped.priceLists.length
      }
    };
  }

  async getBranchDataFingerprint(
    branchId: string
  ): Promise<{ fingerprint: string; counts: Record<string, number>; sampledAt: string }> {
    const scoped = await this.fetchBranchScopedData(branchId);
    return {
      fingerprint: this.computeFingerprint(scoped),
      sampledAt: new Date().toISOString(),
      counts: {
        branches: scoped.branches.length,
        locations: scoped.locations.length,
        users: scoped.users.length,
        personnels: scoped.personnels.length,
        customers: scoped.customers.length,
        suppliers: scoped.suppliers.length,
        products: scoped.products.length,
        cylinderTypes: scoped.cylinderTypes.length,
        cylinders: scoped.cylinders.length,
        inventoryBalances: scoped.inventoryBalances.length,
        expenseCategories: scoped.expenseCategories.length,
        priceLists: scoped.priceLists.length
      }
    };
  }

  private async getJson<T>(path: string): Promise<T> {
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error('No active access token. Please sign in again.');
    }

    const response = await withTimeout(
      this.fetchFn(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: await this.headers(token)
      }),
      15000,
      `Request timeout on ${path}`
    );

    if (!response.ok) {
      throw new Error(`Bootstrap request failed (${response.status}) on ${path}: ${await response.text()}`);
    }

    return (await response.json()) as T;
  }

  private async replaceEntity(entity: string, rows: Record<string, unknown>[], updatedAt: string): Promise<void> {
    await this.db.runAsync('DELETE FROM master_data_local WHERE entity = ?', entity);

    for (const row of rows) {
      const candidateId = row.id;
      if (typeof candidateId !== 'string' || !candidateId.trim()) {
        continue;
      }

      await this.db.runAsync(
        `
        INSERT INTO master_data_local(entity, record_id, payload, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(entity, record_id) DO UPDATE SET
          payload = excluded.payload,
          updated_at = excluded.updated_at
        `,
        entity,
        candidateId,
        JSON.stringify(row),
        updatedAt
      );
    }
  }

  private async replaceCylinders(
    rows: Array<{ serial: string; typeCode?: string; status?: string; locationId?: string }>,
    updatedAt: string
  ): Promise<void> {
    await this.db.runAsync('DELETE FROM cylinders_local');
    for (const row of rows) {
      const serial = typeof row.serial === 'string' ? row.serial.trim() : '';
      const cylinderTypeCode =
        typeof row.typeCode === 'string' && row.typeCode.trim() ? row.typeCode.trim() : '';
      const statusRaw = typeof row.status === 'string' ? row.status.trim().toUpperCase() : '';
      const locationId =
        typeof row.locationId === 'string' && row.locationId.trim() ? row.locationId.trim() : '';
      if (!serial || !cylinderTypeCode || !locationId) {
        continue;
      }
      const status =
        statusRaw === 'FULL' || statusRaw === 'EMPTY' || statusRaw === 'DAMAGED' || statusRaw === 'LOST'
          ? statusRaw
          : 'EMPTY';
      await this.db.runAsync(
        `
        INSERT INTO cylinders_local(serial, cylinder_type_code, status, location_id, ownership, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(serial) DO UPDATE SET
          cylinder_type_code = excluded.cylinder_type_code,
          status = excluded.status,
          location_id = excluded.location_id,
          ownership = excluded.ownership,
          updated_at = excluded.updated_at
        `,
        serial,
        cylinderTypeCode,
        status,
        locationId,
        'COMPANY',
        updatedAt
      );
    }
  }

  private computeFingerprint(scoped: BranchScopedData): string {
    const payload = [
      `branches:${normalizeForFingerprint(scoped.branches as Record<string, unknown>[])}`,
      `locations:${normalizeForFingerprint(scoped.locations as Record<string, unknown>[])}`,
      `users:${normalizeForFingerprint(scoped.users)}`,
      `personnels:${normalizeForFingerprint(scoped.personnels)}`,
      `customers:${normalizeForFingerprint(scoped.customers, sanitizeCustomerForFingerprint)}`,
      `suppliers:${normalizeForFingerprint(scoped.suppliers)}`,
      `products:${normalizeForFingerprint(scoped.products)}`,
      `cylinderTypes:${normalizeForFingerprint(scoped.cylinderTypes)}`,
      `cylinders:${normalizeForFingerprint(scoped.cylinders as Record<string, unknown>[])}`,
      `inventoryBalances:${normalizeForFingerprint(scoped.inventoryBalances)}`,
      `expenseCategories:${normalizeForFingerprint(scoped.expenseCategories)}`,
      `priceLists:${normalizeForFingerprint(scoped.priceLists as Record<string, unknown>[])}`
    ].join('##');
    return `v2:${hashString(payload)}`;
  }

  private async fetchBranchScopedData(branchId: string): Promise<BranchScopedData> {
    const [branches, locations, users, personnels, customers, suppliers, products, cylinderTypes, cylinders, inventoryOpening, expenseCategories, priceLists] = await Promise.all([
      this.getJson<BranchRecord[]>('/master-data/branches'),
      this.getJson<LocationRecord[]>('/master-data/locations'),
      this.getJson<Record<string, unknown>[]>('/master-data/users'),
      this.getJson<Record<string, unknown>[]>('/master-data/personnels'),
      this.getJson<Record<string, unknown>[]>(
        `/master-data/customers?include_balance=true&branch_id=${encodeURIComponent(branchId)}`
      ),
      this.getJson<Record<string, unknown>[]>('/master-data/suppliers'),
      this.getJson<Record<string, unknown>[]>('/master-data/products'),
      this.getJson<Record<string, unknown>[]>('/master-data/cylinder-types'),
      this.getJson<Array<{ serial: string; typeCode?: string; status?: string; locationId?: string; updatedAt?: string }>>('/cylinders'),
      this.getJson<InventoryOpeningSnapshot>('/master-data/inventory/opening-stock'),
      this.getJson<Record<string, unknown>[]>('/master-data/expense-categories'),
      this.getJson<PriceListRecord[]>('/master-data/price-lists')
    ]);

    const scopedLocations = filterLocationsByBranch(locations, branchId);
    const locationIdSet = new Set(scopedLocations.map((row) => row.id));
    const scopedUsers = users.filter((row) => {
      const explicitBranchId = readStringField(row, [
        'branchId',
        'branch_id',
        'assignedBranchId',
        'assigned_branch_id',
        'defaultBranchId',
        'default_branch_id'
      ]);
      if (explicitBranchId) {
        return explicitBranchId === branchId;
      }

      const explicitLocationId = readStringField(row, [
        'locationId',
        'location_id',
        'assignedLocationId',
        'assigned_location_id',
        'defaultLocationId',
        'default_location_id'
      ]);
      if (explicitLocationId) {
        return locationIdSet.has(explicitLocationId);
      }

      // Backward compatibility: older user records may not carry branch linkage yet.
      return true;
    });
    const scopedPersonnels = personnels.filter((row) => {
      const explicitBranchId = readStringField(row, ['branchId', 'branch_id']);
      return explicitBranchId ? explicitBranchId === branchId : true;
    });
    const inventoryRows = Array.isArray(inventoryOpening.rows) ? inventoryOpening.rows : [];
    const scopedInventoryRows = inventoryRows
      .filter((row) => {
        const locationId = typeof row.locationId === 'string' ? row.locationId.trim() : '';
        return Boolean(locationId && locationIdSet.has(locationId));
      })
      .map((row) => {
        const locationId = String(row.locationId ?? '').trim();
        const productId = String(row.productId ?? '').trim();
        return {
          id: `${locationId}:${productId}`,
          locationId,
          productId,
          qtyOnHand: Number(row.qtyOnHand ?? 0),
          qtyFull: Number(row.qtyFull ?? 0),
          qtyEmpty: Number(row.qtyEmpty ?? 0),
          avgCost: Number(row.avgCost ?? 0),
          inventoryValue: Number(row.inventoryValue ?? 0),
          hasOpeningEntry: Boolean(row.hasOpeningEntry),
          hasTransactionalMovements: Boolean(row.hasTransactionalMovements),
          lastMovementAt: row.lastMovementAt ?? null
        };
      });

    return {
      branches: branches.filter((row) => row.id === branchId),
      locations: scopedLocations,
      users: scopedUsers,
      personnels: scopedPersonnels,
      customers,
      suppliers,
      products,
      cylinderTypes,
      cylinders: cylinders.filter((row) => row && typeof row.serial === 'string' && locationIdSet.has(String(row.locationId ?? '').trim())),
      inventoryBalances: scopedInventoryRows,
      expenseCategories,
      priceLists: filterPriceListsByBranch(priceLists, branchId)
    };
  }

  private async headers(accessToken: string): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`
    };

    if (this.getClientId) {
      const clientId = (await this.getClientId())?.trim();
      if (clientId) {
        headers['x-client-id'] = clientId;
      }
    }

    return headers;
  }
}

export type { BootstrapResult, ServerProbeResult };
