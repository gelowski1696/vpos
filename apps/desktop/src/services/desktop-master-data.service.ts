import { desktopDb } from '../db/sqlite';
import type {
  DesktopAppState,
  DesktopCatalogProduct,
  DesktopLendingDetail,
  DesktopLendingRecord,
  DesktopMasterDataRow,
  DesktopOption
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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
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
  ): Promise<{ productCount: number; customerCount: number; lendingCount: number; syncedAt: string; state: DesktopAppState }> {
    const apiBase = normalizeBaseUrl(state.setup.apiBaseUrl);
    const [
      branchesResult,
      locationsResult,
      productsResult,
      inventoryOpeningResult,
      priceListsResult,
      customersResult,
      lendingResult
    ] = await Promise.all([
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/branches`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/locations`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/products`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/inventory/opening-stock`),
      desktopAuthService.authorizedFetch(state, `${apiBase}/master-data/price-lists`),
      desktopAuthService.authorizedFetch(
        state,
        `${apiBase}/master-data/customers?include_balance=true&branch_id=${encodeURIComponent(branchId)}`
      ),
      desktopAuthService.authorizedFetch(
        state,
        `${apiBase}/lending?branch_id=${encodeURIComponent(branchId)}&limit=250`
      )
    ]);

    const nextState =
      lendingResult.state ??
      customersResult.state ??
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
      !customersResult.response.ok ||
      !lendingResult.response.ok
    ) {
      throw new Error('Unable to refresh desktop branch data from the server.');
    }

    const branchRows = (await branchesResult.response.json()) as BranchRecord[];
    const locationRows = (await locationsResult.response.json()) as LocationRecord[];
    const productRows = (await productsResult.response.json()) as ProductRecord[];
    const inventorySnapshot = (await inventoryOpeningResult.response.json()) as InventoryOpeningSnapshot;
    const priceListRows = (await priceListsResult.response.json()) as PriceListRecord[];
    const customerRows = (await customersResult.response.json()) as Record<string, unknown>[];
    const lendingRows = (await lendingResult.response.json()) as DesktopLendingRecord[];

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
    await desktopDb.replaceMasterDataEntity('customer', toRows('customer', customerRows));
    await desktopDb.replaceMasterDataEntity('lending', toRows('lending', lendingRows as unknown as Record<string, unknown>[]));

    return {
      productCount: productRows.filter((row) => row.isActive !== false).length,
      customerCount: customerRows.length,
      lendingCount: lendingRows.length,
      syncedAt: new Date().toISOString(),
      state: nextState
    };
  }

  async loadCustomers(): Promise<DesktopOption[]> {
    const customerRows = await desktopDb.listMasterData('customer');
    const options: DesktopOption[] = [];
    for (const row of customerRows) {
      const payload = safeParse(row.payload);
      const id = asString(payload.id);
      if (!id) {
        continue;
      }
      const name = asString(payload.name) ?? asString(payload.display_name) ?? id;
      const code = asString(payload.code);
      const balance = asNumber(payload.outstandingBalance ?? payload.outstanding_balance);
      const pointsBalance = asNumber(payload.pointsBalance ?? payload.points_balance);
      options.push({
        id,
        label: name,
        subtitle: [code, `Bal ${balance.toFixed(2)}`, `Pts ${Math.floor(pointsBalance)}`]
          .filter(Boolean)
          .join(' · '),
        balance,
        pointsBalance: Math.floor(pointsBalance)
      });
    }
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }

  async loadCatalog(locationId: string): Promise<DesktopCatalogProduct[]> {
    const [productRows, inventoryRows, priceListRows] = await Promise.all([
      desktopDb.listMasterData('product'),
      desktopDb.listMasterData('inventory_balance'),
      desktopDb.listMasterData('price_list')
    ]);

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
        return {
          id: row.id,
          sku: row.sku?.trim() || row.id,
          name: row.name?.trim() || row.sku?.trim() || row.id,
          category: row.category?.trim() || 'Uncategorized',
          unit: row.unit?.trim() || 'unit',
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
}

export const desktopMasterDataService = new DesktopMasterDataService();

