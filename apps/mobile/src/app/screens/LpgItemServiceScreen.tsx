import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { LocalSessionService } from '../../features/auth/local-session.service';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import { normalizeApiBaseUrl } from '../api-base-url';
import { loadLocationOptions, type MasterDataOption } from '../master-data-local';
import {
  loadPendingInventoryDeltaByProductForLocation,
  mergeInventoryWithDeltas
} from '../local-stock-projection';
import { toastError, toastSuccess } from '../goey-toast';
import type { AppTheme } from '../theme';

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  inventoryProjectionVersion?: number;
  syncBusy?: boolean;
};

type MasterDataRow = {
  entity: string;
  record_id: string;
  payload: string;
  updated_at: string;
};

type ProductRecord = {
  id: string;
  itemCode: string;
  name: string;
  isLpg: boolean;
  isActive: boolean;
  cylinderTypeId: string | null;
};

type ProductStockMetrics = {
  qtyFull: number;
  qtyEmpty: number;
  qtyOnHand: number | null;
};

type InventoryBalanceRow = {
  productId: string;
  locationId: string | null;
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
};

type LpgItemActionType = 'DISPOSE' | 'REPLACE' | 'JUNK';

type LpgItemActionRow = {
  id: string;
  productId: string;
  productSku: string | null;
  productName: string | null;
  actionType: LpgItemActionType;
  qty: number;
  reason: string;
  notes: string | null;
  locationName: string | null;
  locationCode: string | null;
  referenceActionId: string | null;
  createdAt: string;
  syncStatus?: string | null;
  source?: 'server' | 'local';
};

type LocalLpgItemActionDbRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
};

type DisposedEntryRow = LpgItemActionRow & {
  usedQty: number;
  availableQty: number;
};

const env = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env;
const API_BASE_URL = normalizeApiBaseUrl(
  env?.EXPO_PUBLIC_API_BASE_URL ?? 'https://vmjamtech.com/api'
);

function parsePayload(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function asNumber(value: unknown): number | null {
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

function fmtDate(value: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function formatQty(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) {
    return '0';
  }
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function actionLabel(value: LpgItemActionType): string {
  if (value === 'DISPOSE') return 'Disposed';
  if (value === 'REPLACE') return 'Replaced';
  return 'Junked';
}

function actionFilterLabel(value: 'ALL' | LpgItemActionType): string {
  if (value === 'ALL') return 'All Records';
  return actionLabel(value);
}

function shouldQueueOffline(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('network error') ||
    normalized.includes('request failed (503)') ||
    normalized.includes('request failed (502)') ||
    normalized.includes('request failed (504)')
  );
}

function parseProduct(row: MasterDataRow): ProductRecord {
  const payload = parsePayload(row.payload);
  return {
    id: asString(payload.id) || row.record_id,
    itemCode:
      asString(payload.itemCode) ||
      asString(payload.item_code) ||
      asString(payload.sku) ||
      asString(payload.code) ||
      row.record_id,
    name: asString(payload.name) || asString(payload.display_name) || row.record_id,
    isLpg: asBoolean(payload.isLpg ?? payload.is_lpg, false),
    isActive: asBoolean(payload.isActive ?? payload.is_active, true),
    cylinderTypeId: asString(payload.cylinderTypeId ?? payload.cylinder_type_id) || null
  };
}

function parseInventoryBalanceRow(row: MasterDataRow): InventoryBalanceRow | null {
  const payload = parsePayload(row.payload);
  const productId = asString(payload.productId ?? payload.product_id);
  const qtyOnHand = asNumber(payload.qtyOnHand ?? payload.qty_on_hand);
  if (!productId || qtyOnHand === null) {
    return null;
  }
  return {
    productId,
    locationId: asString(payload.locationId ?? payload.location_id) || null,
    qtyOnHand,
    qtyFull: asNumber(payload.qtyFull ?? payload.qty_full) ?? 0,
    qtyEmpty: asNumber(payload.qtyEmpty ?? payload.qty_empty) ?? 0
  };
}

function toLocalServiceActionRow(row: LocalLpgItemActionDbRow): LpgItemActionRow | null {
  const payload = parsePayload(row.payload);
  const actionTypeRaw = asString(payload.action_type ?? payload.actionType).toUpperCase();
  if (actionTypeRaw !== 'DISPOSE' && actionTypeRaw !== 'REPLACE' && actionTypeRaw !== 'JUNK') {
    return null;
  }
  const qty = asNumber(payload.qty);
  const reason = asString(payload.reason);
  if (qty === null || qty <= 0 || !reason) {
    return null;
  }
  return {
    id: row.id,
    productId: asString(payload.product_id ?? payload.productId),
    productSku: asString(payload.product_sku ?? payload.productSku) || null,
    productName: asString(payload.product_name ?? payload.productName) || null,
    actionType: actionTypeRaw,
    qty,
    reason,
    notes: asString(payload.notes) || null,
    locationName: asString(payload.location_name ?? payload.locationName) || null,
    locationCode: asString(payload.location_code ?? payload.locationCode) || null,
    referenceActionId: asString(payload.reference_action_id ?? payload.referenceActionId) || null,
    createdAt: asString(payload.created_at ?? payload.createdAt) || row.created_at,
    syncStatus: row.sync_status,
    source: 'local'
  };
}

async function getEntityRows(
  db: SQLiteDatabase,
  aliases: string[]
): Promise<MasterDataRow[]> {
  if (!aliases.length) {
    return [];
  }
  const normalized = aliases.map((alias) => alias.toLowerCase());
  const placeholders = normalized.map(() => '?').join(', ');
  return db.getAllAsync<MasterDataRow>(
    `
    SELECT entity, record_id, payload, updated_at
    FROM master_data_local
    WHERE lower(entity) IN (${placeholders})
    ORDER BY updated_at DESC
    `,
    ...normalized
  );
}

export function LpgItemServiceScreen({
  db,
  theme,
  inventoryProjectionVersion = 0,
  syncBusy = false
}: Props): JSX.Element {
  const prevSyncBusyRef = useRef(syncBusy);
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<MasterDataOption[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [stockByProduct, setStockByProduct] = useState<Record<string, ProductStockMetrics>>({});
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedLocationName, setSelectedLocationName] = useState<string | null>(null);
  const [selectedLocationType, setSelectedLocationType] = useState<'STORE' | 'WAREHOUSE'>('STORE');
  const [query, setQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [actions, setActions] = useState<LpgItemActionRow[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composerType, setComposerType] = useState<LpgItemActionType>('DISPOSE');
  const [referenceDisposeId, setReferenceDisposeId] = useState<string | null>(null);
  const [modalProductQuery, setModalProductQuery] = useState('');
  const [actionTypeFilter, setActionTypeFilter] = useState<'ALL' | 'DISPOSE' | 'JUNK' | 'REPLACE'>('DISPOSE');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const storeLocations = useMemo(
    () => locations.filter((location) => (location.type ?? '').toUpperCase() === 'BRANCH_STORE'),
    [locations]
  );
  const warehouseLocations = useMemo(
    () => locations.filter((location) => (location.type ?? '').toUpperCase() === 'BRANCH_WAREHOUSE'),
    [locations]
  );
  const showLocationTypeSelector = storeLocations.length > 0 && warehouseLocations.length > 0;

  const apiRequest = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const session = new LocalSessionService(db);
    await session.initializeFromStorage();
    const accessToken = await session.getAccessToken();
    if (!accessToken) {
      throw new Error('No active access token. Please sign in again.');
    }

    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    if (!(init?.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed (${response.status})`);
    }

    return (await response.json()) as T;
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const appState = await db.getFirstAsync<{
        selected_location_id: string | null;
        selected_location_name: string | null;
      }>('SELECT selected_location_id, selected_location_name FROM app_state WHERE id = 1');
      const activeLocationId = appState?.selected_location_id ?? null;

      const [locationOptions, productRows, inventoryRows] = await Promise.all([
        loadLocationOptions(db),
        getEntityRows(db, ['product', 'products']),
        getEntityRows(db, ['inventory_balance', 'inventory_balances'])
      ]);
      setLocations(locationOptions);

      const storeOptions = locationOptions.filter((location) => (location.type ?? '').toUpperCase() === 'BRANCH_STORE');
      const warehouseOptions = locationOptions.filter((location) => (location.type ?? '').toUpperCase() === 'BRANCH_WAREHOUSE');
      const activeLocationOption = locationOptions.find((location) => location.id === activeLocationId) ?? null;
      const resolvedLocationType: 'STORE' | 'WAREHOUSE' =
        (activeLocationOption?.type ?? '').toUpperCase() === 'BRANCH_WAREHOUSE' ? 'WAREHOUSE' : 'STORE';
      setSelectedLocationType((current) => {
        if (current === 'WAREHOUSE' && warehouseOptions.length > 0) {
          return current;
        }
        return resolvedLocationType;
      });
      const hasWarehouseTopology = storeOptions.length > 0 && warehouseOptions.length > 0;
      const desiredType = hasWarehouseTopology ? selectedLocationType : resolvedLocationType;
      const candidateLocations =
        desiredType === 'WAREHOUSE' && warehouseOptions.length > 0
          ? warehouseOptions
          : storeOptions.length > 0
            ? storeOptions
            : warehouseOptions.length > 0
              ? warehouseOptions
              : locationOptions;
      const scopedLocation =
        candidateLocations.find((location) => location.id === activeLocationId) ?? candidateLocations[0] ?? null;
      setSelectedLocationId(scopedLocation?.id ?? null);
      setSelectedLocationName(scopedLocation?.label ?? appState?.selected_location_name ?? null);

      const nextProducts = productRows
        .map((row) => parseProduct(row))
        .filter((row) => row.isLpg && row.isActive && row.cylinderTypeId)
        .sort((a, b) => a.name.localeCompare(b.name));
      const inventoryByProduct = new Map<string, { qtyOnHand: number; qtyFull: number; qtyEmpty: number }>();
      for (const row of inventoryRows) {
        const parsed = parseInventoryBalanceRow(row);
        if (!parsed) {
          continue;
        }
        if (scopedLocation?.id && parsed.locationId && parsed.locationId !== scopedLocation.id) {
          continue;
        }
        const existing = inventoryByProduct.get(parsed.productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
        existing.qtyOnHand += parsed.qtyOnHand;
        existing.qtyFull += parsed.qtyFull;
        existing.qtyEmpty += parsed.qtyEmpty;
        inventoryByProduct.set(parsed.productId, existing);
      }
      const pendingDeltaByProduct = scopedLocation?.id
        ? await loadPendingInventoryDeltaByProductForLocation(db, scopedLocation.id)
        : new Map();
      const projectedInventoryByProduct = mergeInventoryWithDeltas(
        inventoryByProduct,
        pendingDeltaByProduct
      );
      const nextStockByProduct: Record<string, ProductStockMetrics> = {};
      for (const product of nextProducts) {
        const stock = projectedInventoryByProduct.get(product.id);
        nextStockByProduct[product.id] = {
          qtyFull: stock?.qtyFull ?? 0,
          qtyEmpty: stock?.qtyEmpty ?? 0,
          qtyOnHand: stock?.qtyOnHand ?? 0
        };
      }

      setProducts(nextProducts);
      setStockByProduct(nextStockByProduct);
      setSelectedProductId((current) => {
        if (current && nextProducts.some((row) => row.id === current)) {
          return current;
        }
        return null;
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [db, inventoryProjectionVersion]);

  useEffect(() => {
    if (prevSyncBusyRef.current && !syncBusy) {
      void refresh();
    }
    prevSyncBusyRef.current = syncBusy;
  }, [syncBusy]);

  useEffect(() => {
    if (!showLocationTypeSelector) {
      return;
    }
    const options = selectedLocationType === 'WAREHOUSE' ? warehouseLocations : storeLocations;
    if (!options.length) {
      return;
    }
    const currentStillMatches = options.some((location) => location.id === selectedLocationId);
    if (currentStillMatches) {
      return;
    }
    setSelectedLocationId(options[0]?.id ?? null);
    setSelectedLocationName(options[0]?.label ?? null);
  }, [selectedLocationId, selectedLocationType, showLocationTypeSelector, storeLocations, warehouseLocations]);

  const visibleProducts = useMemo(() => {
    const search = query.trim().toLowerCase();
    return products.filter((row) => {
      if (!search) {
        return true;
      }
      return `${row.itemCode} ${row.name}`.toLowerCase().includes(search);
    });
  }, [products, query]);

  const productMap = useMemo(() => {
    const next = new Map<string, ProductRecord>();
    for (const row of products) {
      next.set(row.id, row);
    }
    return next;
  }, [products]);

  const modalVisibleProducts = useMemo(() => {
    const search = modalProductQuery.trim().toLowerCase();
    return products.filter((row) => {
      if (!search) {
        return true;
      }
      return `${row.itemCode} ${row.name}`.toLowerCase().includes(search);
    });
  }, [modalProductQuery, products]);

  const selectedProduct = useMemo(
    () =>
      visibleProducts.find((row) => row.id === selectedProductId) ??
      products.find((row) => row.id === selectedProductId) ??
      null,
    [products, selectedProductId, visibleProducts]
  );

  useEffect(() => {
    const loadActions = async (): Promise<void> => {
      if (!selectedLocationId) {
        setActions([]);
        return;
      }
      setActionLoading(true);
      try {
        const localPendingRows = await db.getAllAsync<LocalLpgItemActionDbRow>(
          `
          SELECT id, payload, sync_status, created_at, updated_at
          FROM lpg_item_actions_local
          WHERE sync_status IN (?, ?, ?, ?)
            AND json_extract(payload, '$.location_id') = ?
          ORDER BY created_at DESC
          `,
          'pending',
          'processing',
          'failed',
          'FAILED',
          selectedLocationId
        );
        const localActions = localPendingRows
          .map((row) => toLocalServiceActionRow(row))
          .filter((row): row is LpgItemActionRow => Boolean(row));
        let serverActions: LpgItemActionRow[] = [];
        try {
          const params = new URLSearchParams();
          params.set('location_id', selectedLocationId);
          params.set('limit', '150');
          serverActions = (await apiRequest<LpgItemActionRow[]>(
            `/lpg-item-actions?${params.toString()}`
          )).map((row) => ({ ...row, source: 'server', syncStatus: 'synced' }));
        } catch {
          serverActions = [];
        }
        const seenIds = new Set(serverActions.map((row) => row.id));
        setActions([...localActions.filter((row) => !seenIds.has(row.id)), ...serverActions]);
      } finally {
        setActionLoading(false);
      }
    };
    void loadActions();
  }, [db, selectedLocationId, syncBusy]);

  const disposedEntries = useMemo<DisposedEntryRow[]>(() => {
    const search = query.trim().toLowerCase();
    const usedByReference = new Map<string, number>();
    for (const row of actions) {
      if (!row.referenceActionId) {
        continue;
      }
      usedByReference.set(
        row.referenceActionId,
        (usedByReference.get(row.referenceActionId) ?? 0) + row.qty
      );
    }
    return actions
      .filter((row) => row.actionType === 'DISPOSE')
      .filter((row) => {
        if (!search) {
          return true;
        }
        const product = productMap.get(row.productId);
        return `${row.productSku ?? product?.itemCode ?? ''} ${row.productName ?? product?.name ?? ''} ${row.reason} ${row.notes ?? ''}`
          .toLowerCase()
          .includes(search);
      })
      .map((row) => ({
        ...row,
        usedQty: usedByReference.get(row.id) ?? 0,
        availableQty: Math.max(0, row.qty - (usedByReference.get(row.id) ?? 0))
      }))
      .filter((row) => row.availableQty > 0)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [actions, productMap, query]);

  const historyRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return [...actions]
      .filter((row) => {
        if (actionTypeFilter !== 'ALL' && row.actionType !== actionTypeFilter) {
          return false;
        }
        if (!search) {
          return true;
        }
        const product = productMap.get(row.productId);
        return `${row.productSku ?? product?.itemCode ?? ''} ${row.productName ?? product?.name ?? ''} ${row.reason} ${row.notes ?? ''} ${row.actionType}`
          .toLowerCase()
          .includes(search);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [actionTypeFilter, actions, productMap, query]);

  const mainBlockTitle = useMemo(() => {
    if (actionTypeFilter === 'DISPOSE') return 'Disposed Records';
    if (actionTypeFilter === 'REPLACE') return 'Replaced Records';
    if (actionTypeFilter === 'JUNK') return 'Junked Records';
    return 'All Records';
  }, [actionTypeFilter]);

  const actionMap = useMemo(() => {
    const next = new Map<string, LpgItemActionRow>();
    for (const row of actions) {
      next.set(row.id, row);
    }
    return next;
  }, [actions]);

  const describeReference = (referenceActionId: string | null): string | null => {
    if (!referenceActionId) return null;
    const reference = actionMap.get(referenceActionId);
    if (!reference) return 'Linked to an earlier disposed record';
    const productName =
      reference.productName ?? productMap.get(reference.productId)?.name ?? 'Unknown item';
    return `From ${productName} disposed on ${fmtDate(reference.createdAt)}`;
  };

  const openComposer = (
    type: LpgItemActionType,
    referenceActionId?: string | null,
    productId?: string | null
  ): void => {
    setComposerType(type);
    setReferenceDisposeId(referenceActionId ?? null);
    setSelectedProductId(productId ?? null);
    setModalProductQuery('');
    setQty('1');
    setReason('');
    setNotes('');
    setComposerOpen(true);
  };

  const closeComposer = (): void => {
    setComposerOpen(false);
    setQty('1');
    setReason('');
    setNotes('');
    setReferenceDisposeId(null);
    setSelectedProductId(null);
    setModalProductQuery('');
    setComposerType('DISPOSE');
  };

  const submitAction = async (): Promise<void> => {
    if (!selectedProduct || !selectedLocationId || saving) {
      return;
    }
    const parsedQty = Math.trunc(Number(qty));
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      toastError('LPG Item Service', 'Enter a valid quantity.');
      return;
    }
    if (!reason.trim()) {
      toastError('LPG Item Service', 'Reason is required.');
      return;
    }
    if (composerType !== 'DISPOSE' && !referenceDisposeId) {
      toastError('LPG Item Service', 'Choose a disposed entry first.');
      return;
    }
    if (composerType === 'DISPOSE' && !selectedProduct) {
      toastError('LPG Item Service', 'Select an LPG item first.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        product_id: selectedProduct.id,
        location_id: selectedLocationId,
        qty: parsedQty,
        reason: reason.trim(),
        notes: notes.trim() || undefined,
        ...(referenceDisposeId ? { reference_action_id: referenceDisposeId } : {})
      };
      let created: LpgItemActionRow | null = null;
      let queuedOffline = false;
      try {
        created = {
          ...(await apiRequest<LpgItemActionRow>(
            `/lpg-item-actions/${composerType.toLowerCase()}`,
            {
              method: 'POST',
              body: JSON.stringify(payload)
            }
          )),
          source: 'server',
          syncStatus: 'synced'
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to save LPG item service action.';
        if (!shouldQueueOffline(message)) {
          throw error;
        }
        queuedOffline = true;
        const offline = new OfflineTransactionService(db);
        const actionId = await offline.createOfflineLpgItemAction({
          actionType: composerType,
          locationId: selectedLocationId,
          locationName: selectedLocationName,
          productId: selectedProduct.id,
          productSku: selectedProduct.itemCode,
          productName: selectedProduct.name,
          qty: parsedQty,
          reason: reason.trim(),
          notes: notes.trim() || null,
          referenceActionId: referenceDisposeId
        });
        created = {
          id: actionId,
          productId: selectedProduct.id,
          productSku: selectedProduct.itemCode,
          productName: selectedProduct.name,
          actionType: composerType,
          qty: parsedQty,
          reason: reason.trim(),
          notes: notes.trim() || null,
          locationName: selectedLocationName,
          locationCode: null,
          referenceActionId: referenceDisposeId ?? null,
          createdAt: new Date().toISOString(),
          syncStatus: 'pending',
          source: 'local'
        };
      }

      const emptyDelta =
        composerType === 'DISPOSE' ? -parsedQty : composerType === 'REPLACE' ? parsedQty : 0;
      setActions((current) => [created as LpgItemActionRow, ...current]);
      if (emptyDelta !== 0) {
        setStockByProduct((current) => {
          const existing = current[selectedProduct.id] ?? {
            qtyFull: 0,
            qtyEmpty: 0,
            qtyOnHand: 0
          };
          const nextEmpty = Math.max(0, existing.qtyEmpty + emptyDelta);
          return {
            ...current,
            [selectedProduct.id]: {
              ...existing,
              qtyEmpty: nextEmpty,
              qtyOnHand: existing.qtyFull + nextEmpty
            }
          };
        });
      }

      toastSuccess(
        queuedOffline ? 'LPG item action queued offline' : 'LPG item action saved',
        composerType === 'DISPOSE'
          ? `${selectedProduct.name} was deducted from empty stock.`
          : composerType === 'REPLACE'
            ? `${selectedProduct.name} empty stock was added back.`
            : `${selectedProduct.name} junk note was recorded.`
      );
      closeComposer();
    } catch (error) {
      toastError(
        'LPG Item Service',
        error instanceof Error ? error.message : 'Unable to save LPG item service action.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="gap-2.5 rounded-2xl border px-3.5 py-3.5" style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}>
      <Text className="text-lg font-bold" style={{ color: theme.heading }}>LPG Service Records</Text>
      <Text className="text-[13px]" style={{ color: theme.subtext }}>
        Record disposed items here. Junked and replaced entries must come from an existing disposed record.
      </Text>

      <View className="flex-row gap-2">
        <View className="flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Location</Text>
          <Text className="text-[12px] font-bold" style={{ color: theme.heading }} numberOfLines={2}>
            {selectedLocationName ?? selectedLocationId ?? 'No location selected'}
          </Text>
        </View>
        <View className="flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>LPG Items</Text>
          <Text className="text-lg font-extrabold" style={{ color: theme.heading }}>{products.length}</Text>
        </View>
      </View>

      {showLocationTypeSelector ? (
        <View className="gap-1.5">
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Location Scope</Text>
          <View className="flex-row gap-2">
            {([
              { key: 'STORE', label: 'Store' },
              { key: 'WAREHOUSE', label: 'Warehouse' }
            ] as const).map((option) => {
              const active = selectedLocationType === option.key;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setSelectedLocationType(option.key)}
                  className="min-h-9 flex-1 items-center justify-center rounded-full px-3"
                  style={{ backgroundColor: active ? theme.primary : theme.pillBg }}
                >
                  <Text className="text-[11px] font-bold" style={{ color: active ? '#FFFFFF' : theme.pillText }}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="text-[11px]" style={{ color: theme.subtext }}>
            Switch between store and warehouse service records when warehouse topology is enabled.
          </Text>
        </View>
      ) : null}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search records by item, reason, or action"
        placeholderTextColor={theme.inputPlaceholder}
        className="rounded-xl px-3 py-[11px] text-[13px]"
        style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
      />

      <Pressable
        onPress={() => openComposer('DISPOSE')}
        disabled={!selectedLocationId}
        className="min-h-11 items-center justify-center rounded-xl px-3"
        style={{ backgroundColor: selectedLocationId ? theme.primary : theme.primaryMuted }}
      >
        <Text className="text-[13px] font-bold text-white">{actionLabel('DISPOSE')}</Text>
      </Pressable>

      <View className="flex-row justify-end">
        <Pressable
          onPress={() => setHistoryOpen(true)}
          className="min-h-10 items-center justify-center rounded-xl px-3"
          style={{ backgroundColor: theme.pillBg }}
        >
          <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Service History</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
        {([
          { key: 'ALL', label: 'All Records' },
          { key: 'DISPOSE', label: 'Disposed' },
          { key: 'JUNK', label: 'Junked' },
          { key: 'REPLACE', label: 'Replaced' }
        ] as const).map((chip) => {
          const active = actionTypeFilter === chip.key;
          return (
            <Pressable
              key={chip.key}
              onPress={() => setActionTypeFilter(chip.key)}
              className="min-h-9 items-center justify-center rounded-full px-3"
              style={{ backgroundColor: active ? theme.primary : theme.pillBg }}
            >
              <Text className="text-[11px] font-bold" style={{ color: active ? '#FFFFFF' : theme.pillText }}>
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View className="gap-2 rounded-2xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
        <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{mainBlockTitle}</Text>
        {!selectedLocationId ? (
          <Text style={[styles.detailLine, { color: theme.subtext }]}>Select a location in app setup first.</Text>
        ) : actionTypeFilter === 'DISPOSE' ? (
          disposedEntries.length === 0 ? (
            <Text style={[styles.detailLine, { color: theme.subtext }]}>No disposed records found for this location.</Text>
          ) : (
            disposedEntries.map((row) => {
              const product = productMap.get(row.productId);
              const stock = stockByProduct[row.productId] ?? { qtyFull: 0, qtyEmpty: 0, qtyOnHand: 0 };
              return (
                <View key={row.id} style={[styles.ruleCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
                  <Text style={[styles.ruleTitle, { color: theme.heading }]}>
                    {row.productName ?? product?.name ?? row.productId}
                  </Text>
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                    {(row.productSku ?? product?.itemCode ?? '-')} | EMPTY {formatQty(stock.qtyEmpty)}
                  </Text>
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>Disposed x {row.qty}</Text>
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>{fmtDate(row.createdAt)}</Text>
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>Reason: {row.reason}</Text>
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                    Used: {formatQty(row.usedQty)} | Available: {formatQty(row.availableQty)}
                  </Text>
                  {row.source === 'local' && row.syncStatus && row.syncStatus !== 'synced' ? (
                    <Text style={[styles.ruleLine, { color: theme.subtext }]}>Pending Sync: {row.syncStatus.toUpperCase()}</Text>
                  ) : null}
                  {row.notes ? (
                    <Text style={[styles.ruleLine, { color: theme.subtext }]}>Notes: {row.notes}</Text>
                  ) : null}
                  <View style={styles.entryActions}>
                    <Pressable
                      onPress={() => openComposer('REPLACE', row.id, row.productId)}
                      disabled={row.availableQty <= 0}
                      style={[
                        styles.entryActionBtn,
                        { backgroundColor: row.availableQty > 0 ? '#0f766e' : '#94a3b8' }
                      ]}
                    >
                      <Text style={styles.entryActionText}>Replace</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => openComposer('JUNK', row.id, row.productId)}
                      disabled={row.availableQty <= 0}
                      style={[
                        styles.entryActionBtn,
                        { backgroundColor: row.availableQty > 0 ? '#475569' : '#94a3b8' }
                      ]}
                    >
                      <Text style={styles.entryActionText}>Junk</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )
        ) : historyRows.length === 0 ? (
          <Text style={[styles.detailLine, { color: theme.subtext }]}>No records found for this filter.</Text>
        ) : (
          historyRows.map((row) => {
            const product = productMap.get(row.productId);
            return (
              <View key={`main-history-${row.id}`} style={[styles.ruleCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
                <Text style={[styles.ruleTitle, { color: theme.heading }]}>
                  {row.productName ?? product?.name ?? row.productId} | {actionLabel(row.actionType)} x {row.qty}
                </Text>
                <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                  {(row.productSku ?? product?.itemCode ?? '-')} | {fmtDate(row.createdAt)}
                </Text>
                {describeReference(row.referenceActionId) ? (
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>{describeReference(row.referenceActionId)}</Text>
                ) : null}
                <Text style={[styles.ruleLine, { color: theme.subtext }]}>Reason: {row.reason}</Text>
                {row.source === 'local' && row.syncStatus && row.syncStatus !== 'synced' ? (
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>Pending Sync: {row.syncStatus.toUpperCase()}</Text>
                ) : null}
                {row.notes ? (
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>Notes: {row.notes}</Text>
                ) : null}
              </View>
            );
          })
        )}
      </View>
      <Modal visible={composerOpen} transparent animationType="fade" onRequestClose={closeComposer}>
        <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] px-3 pt-3">
          <Pressable style={styles.modalBackdrop} onPress={closeComposer} />
          <View className="min-h-[76%] max-h-[92%] gap-3 rounded-[20px] border p-3" style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}>
            <Text className="text-base font-extrabold" style={{ color: theme.heading }}>
              {actionLabel(composerType)}
            </Text>
            <Text className="text-[12px]" style={{ color: theme.subtext }}> 
              {composerType === 'DISPOSE'
                ? 'Choose the LPG item here, then save the disposed record.'
                : composerType === 'REPLACE'
                  ? 'This records a replacement from the selected disposed record.'
                  : 'This records junk against the selected disposed record only.'}
            </Text>
            {referenceDisposeId ? (
              <Text style={[styles.ruleLine, { color: theme.subtext }]}>Disposed Record: {referenceDisposeId}</Text>
            ) : null}
            {composerType === 'DISPOSE' ? (
              <>
                <TextInput
                  value={modalProductQuery}
                  onChangeText={setModalProductQuery}
                  placeholder="Search LPG item"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
                <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
                  {modalVisibleProducts.map((row) => {
                    const active = selectedProductId === row.id;
                    const stock = stockByProduct[row.id] ?? { qtyFull: 0, qtyEmpty: 0, qtyOnHand: 0 };
                    return (
                      <Pressable
                        key={row.id}
                        onPress={() => setSelectedProductId(row.id)}
                        style={[
                          styles.modalProductCard,
                          {
                            borderColor: active ? theme.primary : theme.cardBorder,
                            backgroundColor: active ? theme.pillBg : theme.inputBg
                          }
                        ]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.itemName, { color: theme.heading }]}>{row.name}</Text>
                          <Text style={[styles.itemMeta, { color: theme.subtext }]}>{row.itemCode}</Text>
                        </View>
                        <Text style={[styles.itemMeta, { color: theme.heading }]}>
                          EMPTY {formatQty(stock.qtyEmpty)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            ) : selectedProduct ? (
              <View className="rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                <Text style={[styles.itemName, { color: theme.heading }]}>{selectedProduct.name}</Text>
                <Text style={[styles.itemMeta, { color: theme.subtext }]}>{selectedProduct.itemCode}</Text>
              </View>
            ) : null}
            <TextInput
              value={qty}
              onChangeText={setQty}
              placeholder="Quantity"
              keyboardType="number-pad"
              placeholderTextColor={theme.inputPlaceholder}
              className="rounded-xl px-3 py-[11px] text-[13px]"
              style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
            />
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Reason"
              placeholderTextColor={theme.inputPlaceholder}
              className="rounded-xl px-3 py-[11px] text-[13px]"
              style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
            />
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Notes (optional)"
              placeholderTextColor={theme.inputPlaceholder}
              multiline
              className="min-h-[84px] rounded-xl px-3 py-[11px] text-[13px]"
              style={{ backgroundColor: theme.inputBg, color: theme.inputText, textAlignVertical: 'top' }}
            />
            <View className="flex-row gap-2">
              <Pressable onPress={closeComposer} className="min-h-11 flex-1 items-center justify-center rounded-xl px-3" style={{ backgroundColor: theme.pillBg }}>
                <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void submitAction()}
                disabled={saving}
                className="min-h-11 flex-1 items-center justify-center rounded-xl px-3"
                style={{ backgroundColor: saving ? theme.primaryMuted : theme.primary }}
              >
                <Text className="text-[13px] font-bold text-white">{saving ? 'Saving...' : 'Save Action'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={historyOpen} transparent animationType="fade" onRequestClose={() => setHistoryOpen(false)}>
        <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] px-3 pt-3">
          <Pressable style={styles.modalBackdrop} onPress={() => setHistoryOpen(false)} />
          <View className="min-h-[80%] max-h-[92%] gap-3 rounded-[20px] border p-3" style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}>
            <View className="flex-row items-start gap-2">
              <View style={{ flex: 1 }}>
                <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Service History</Text>
                <Text className="text-[12px]" style={{ color: theme.subtext }}>
                  Filter: {actionFilterLabel(actionTypeFilter)}
                </Text>
              </View>
              <Pressable
                onPress={() => setHistoryOpen(false)}
                className="min-h-10 items-center justify-center rounded-xl px-3"
                style={{ backgroundColor: theme.pillBg }}
              >
                <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Close</Text>
              </Pressable>
            </View>

            <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
              {actionLoading ? (
                <Text style={[styles.detailLine, { color: theme.subtext }]}>Loading history...</Text>
              ) : historyRows.length === 0 ? (
                <Text style={[styles.detailLine, { color: theme.subtext }]}>No action history found for this filter.</Text>
              ) : (
                historyRows.map((row) => {
                  const product = productMap.get(row.productId);
                  return (
                    <View key={`history-${row.id}`} style={[styles.ruleCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                      <Text style={[styles.ruleTitle, { color: theme.heading }]}>
                        {row.productName ?? product?.name ?? row.productId} | {actionLabel(row.actionType)} x {row.qty}
                      </Text>
                      <Text style={[styles.ruleLine, { color: theme.subtext }]}>
                        {(row.productSku ?? product?.itemCode ?? '-')} | {fmtDate(row.createdAt)}
                      </Text>
                      {describeReference(row.referenceActionId) ? (
                        <Text style={[styles.ruleLine, { color: theme.subtext }]}>{describeReference(row.referenceActionId)}</Text>
                      ) : null}
                      <Text style={[styles.ruleLine, { color: theme.subtext }]}>Reason: {row.reason}</Text>
                      {row.source === 'local' && row.syncStatus && row.syncStatus !== 'synced' ? (
                        <Text style={[styles.ruleLine, { color: theme.subtext }]}>Pending Sync: {row.syncStatus.toUpperCase()}</Text>
                      ) : null}
                      {row.notes ? (
                        <Text style={[styles.ruleLine, { color: theme.subtext }]}>Notes: {row.notes}</Text>
                      ) : null}
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10
  },
  title: {
    fontSize: 18,
    fontWeight: '700'
  },
  sub: {
    fontSize: 12
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '800'
  },
  summaryValueSmall: {
    fontSize: 12,
    fontWeight: '700'
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13
  },
  list: {
    maxHeight: 260
  },
  listContent: {
    gap: 8,
    paddingBottom: 6
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  itemName: {
    fontSize: 13,
    fontWeight: '700'
  },
  itemMeta: {
    fontSize: 11
  },
  itemRight: {
    alignItems: 'flex-end'
  },
  modalProductList: {
    maxHeight: 180
  },
  modalProductListContent: {
    gap: 8,
    paddingBottom: 4
  },
  modalProductCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  detailBlock: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8
  },
  detailHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start'
  },
  emptyQtyCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 92,
    alignItems: 'center'
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: '800'
  },
  detailLine: {
    fontSize: 12
  },
  ruleCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  ruleTitle: {
    fontSize: 12,
    fontWeight: '700'
  },
  ruleLine: {
    fontSize: 11
  },
  entryActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6
  },
  entryActionBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  entryActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800'
  },
  primaryButton: {
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800'
  },
  topActionRow: {
    flexDirection: 'row',
    gap: 8
  },
  topActionBtn: {
    flex: 1
  },
  filterRow: {
    gap: 8,
    paddingBottom: 2
  },
  filterChip: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700'
  },
  secondaryButton: {
    minHeight: 42,
    minWidth: 108,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14
  },
  secondaryButtonText: {
    fontSize: 12,
    fontWeight: '800'
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 8, 23, 0.6)'
  },
  dialogCard: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800'
  },
  historyDialogCard: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    minHeight: '72%',
    maxHeight: '72%'
  },
  historyHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start'
  },
  modalSub: {
    fontSize: 12
  },
  historyList: {
    flex: 1
  },
  historyListContent: {
    gap: 8,
    paddingBottom: 10
  },
  composerProductCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2
  },
  notesInput: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 96,
    textAlignVertical: 'top',
    fontSize: 13
  },
  dialogActions: {
    flexDirection: 'row',
    gap: 8
  }
});
