import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { LocalSessionService } from '../../features/auth/local-session.service';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import { normalizeApiBaseUrl } from '../api-base-url';
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
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [stockByProduct, setStockByProduct] = useState<Record<string, ProductStockMetrics>>({});
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedLocationName, setSelectedLocationName] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [actions, setActions] = useState<LpgItemActionRow[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerType, setComposerType] = useState<LpgItemActionType>('DISPOSE');
  const [referenceDisposeId, setReferenceDisposeId] = useState<string | null>(null);
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

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
      setSelectedLocationId(activeLocationId);
      setSelectedLocationName(appState?.selected_location_name ?? null);

      const [productRows, inventoryRows] = await Promise.all([
        getEntityRows(db, ['product', 'products']),
        getEntityRows(db, ['inventory_balance', 'inventory_balances'])
      ]);

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
        if (activeLocationId && parsed.locationId && parsed.locationId !== activeLocationId) {
          continue;
        }
        const existing = inventoryByProduct.get(parsed.productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
        existing.qtyOnHand += parsed.qtyOnHand;
        existing.qtyFull += parsed.qtyFull;
        existing.qtyEmpty += parsed.qtyEmpty;
        inventoryByProduct.set(parsed.productId, existing);
      }
      const pendingDeltaByProduct = activeLocationId
        ? await loadPendingInventoryDeltaByProductForLocation(db, activeLocationId)
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
        return nextProducts[0]?.id ?? null;
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

  const visibleProducts = useMemo(() => {
    const search = query.trim().toLowerCase();
    return products.filter((row) => {
      if (!search) {
        return true;
      }
      return `${row.itemCode} ${row.name}`.toLowerCase().includes(search);
    });
  }, [products, query]);

  const selectedProduct = useMemo(
    () =>
      visibleProducts.find((row) => row.id === selectedProductId) ??
      products.find((row) => row.id === selectedProductId) ??
      null,
    [products, selectedProductId, visibleProducts]
  );

  useEffect(() => {
    const loadActions = async (): Promise<void> => {
      if (!selectedProduct?.id || !selectedLocationId) {
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
            AND json_extract(payload, '$.product_id') = ?
            AND json_extract(payload, '$.location_id') = ?
          ORDER BY created_at DESC
          `,
          'pending',
          'processing',
          'failed',
          'FAILED',
          selectedProduct.id,
          selectedLocationId
        );
        const localActions = localPendingRows
          .map((row) => toLocalServiceActionRow(row))
          .filter((row): row is LpgItemActionRow => Boolean(row));
        let serverActions: LpgItemActionRow[] = [];
        try {
          const params = new URLSearchParams();
          params.set('product_id', selectedProduct.id);
          params.set('location_id', selectedLocationId);
          params.set('limit', '50');
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
  }, [db, selectedLocationId, selectedProduct?.id, syncBusy]);

  const selectedStock = selectedProduct
    ? stockByProduct[selectedProduct.id] ?? { qtyFull: 0, qtyEmpty: 0, qtyOnHand: 0 }
    : { qtyFull: 0, qtyEmpty: 0, qtyOnHand: 0 };

  const disposedEntries = useMemo<DisposedEntryRow[]>(() => {
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
      .map((row) => ({
        ...row,
        usedQty: usedByReference.get(row.id) ?? 0,
        availableQty: Math.max(0, row.qty - (usedByReference.get(row.id) ?? 0))
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [actions]);

  const historyRows = useMemo(
    () => [...actions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [actions]
  );

  const openComposer = (type: LpgItemActionType, referenceActionId?: string | null): void => {
    setComposerType(type);
    setReferenceDisposeId(referenceActionId ?? null);
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
          ? `${selectedProduct.name} was disposed from empty stock.`
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
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <Text style={[styles.title, { color: theme.heading }]}>LPG Item Service</Text>
      <Text style={[styles.sub, { color: theme.subtext }]}>
        Dispose from the LPG item. Replace or junk only from a prior disposed entry.
      </Text>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Location</Text>
          <Text style={[styles.summaryValueSmall, { color: theme.heading }]} numberOfLines={2}>
            {selectedLocationName ?? selectedLocationId ?? 'No location selected'}
          </Text>
        </View>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>LPG Items</Text>
          <Text style={[styles.summaryValue, { color: theme.heading }]}>{products.length}</Text>
        </View>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search LPG items by code or name"
        placeholderTextColor={theme.inputPlaceholder}
        style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
      />

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {loading ? (
          <Text style={[styles.detailLine, { color: theme.subtext }]}>Loading LPG items...</Text>
        ) : visibleProducts.length === 0 ? (
          <Text style={[styles.detailLine, { color: theme.subtext }]}>No LPG items found.</Text>
        ) : (
          visibleProducts.map((row) => {
            const active = selectedProductId === row.id;
            const stock = stockByProduct[row.id] ?? { qtyFull: 0, qtyEmpty: 0, qtyOnHand: 0 };
            return (
              <Pressable
                key={row.id}
                onPress={() => setSelectedProductId(row.id)}
                style={[
                  styles.itemCard,
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
                <View style={styles.itemRight}>
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>FULL {formatQty(stock.qtyFull)}</Text>
                  <Text style={[styles.itemMeta, { color: theme.heading }]}>EMPTY {formatQty(stock.qtyEmpty)}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {selectedProduct ? (
        <View style={[styles.detailBlock, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <View style={styles.detailHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.blockTitle, { color: theme.heading }]}>{selectedProduct.name}</Text>
              <Text style={[styles.detailLine, { color: theme.subtext }]}>{selectedProduct.itemCode}</Text>
            </View>
            <View style={[styles.emptyQtyCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
              <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Current Empty</Text>
              <Text style={[styles.summaryValue, { color: theme.heading }]}>{formatQty(selectedStock.qtyEmpty)}</Text>
            </View>
          </View>
          <Pressable
            onPress={() => openComposer('DISPOSE')}
            disabled={!selectedLocationId}
            style={[
              styles.primaryButton,
              { backgroundColor: selectedLocationId ? theme.primary : theme.primaryMuted }
            ]}
          >
            <Text style={styles.primaryButtonText}>Record Dispose</Text>
          </Pressable>

          <Text style={[styles.blockTitle, { color: theme.heading }]}>Disposed Entries</Text>
          {!selectedLocationId ? (
            <Text style={[styles.detailLine, { color: theme.subtext }]}>Select a location in app setup first.</Text>
          ) : disposedEntries.length === 0 ? (
            <Text style={[styles.detailLine, { color: theme.subtext }]}>No disposed entries yet for this LPG item and location.</Text>
          ) : (
            disposedEntries.map((row) => (
              <View key={row.id} style={[styles.ruleCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
                <Text style={[styles.ruleTitle, { color: theme.heading }]}>Disposed x {row.qty}</Text>
                <Text style={[styles.ruleLine, { color: theme.subtext }]}>{fmtDate(row.createdAt)}</Text>
                <Text style={[styles.ruleLine, { color: theme.subtext }]}>Reason: {row.reason}</Text>
                <Text style={[styles.ruleLine, { color: theme.subtext }]}>Used: {formatQty(row.usedQty)} | Available: {formatQty(row.availableQty)}</Text>
                {row.source === 'local' && row.syncStatus && row.syncStatus !== 'synced' ? (
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>Pending Sync: {row.syncStatus.toUpperCase()}</Text>
                ) : null}
                {row.notes ? (
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>Notes: {row.notes}</Text>
                ) : null}
                <View style={styles.entryActions}>
                  <Pressable
                    onPress={() => openComposer('REPLACE', row.id)}
                    disabled={row.availableQty <= 0}
                    style={[
                      styles.entryActionBtn,
                      { backgroundColor: row.availableQty > 0 ? '#0f766e' : '#94a3b8' }
                    ]}
                  >
                    <Text style={styles.entryActionText}>Replace</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => openComposer('JUNK', row.id)}
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
            ))
          )}

          <Text style={[styles.blockTitle, { color: theme.heading }]}>Action History</Text>
          {actionLoading ? (
            <Text style={[styles.detailLine, { color: theme.subtext }]}>Loading history...</Text>
          ) : historyRows.length === 0 ? (
            <Text style={[styles.detailLine, { color: theme.subtext }]}>No action history yet for this LPG item.</Text>
          ) : (
            historyRows.map((row) => (
              <View key={`history-${row.id}`} style={[styles.ruleCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
                <Text style={[styles.ruleTitle, { color: theme.heading }]}>{row.actionType} x {row.qty}</Text>
                <Text style={[styles.ruleLine, { color: theme.subtext }]}>{fmtDate(row.createdAt)}</Text>
                {row.referenceActionId ? (
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>From Dispose: {row.referenceActionId}</Text>
                ) : null}
                <Text style={[styles.ruleLine, { color: theme.subtext }]}>Reason: {row.reason}</Text>
                {row.source === 'local' && row.syncStatus && row.syncStatus !== 'synced' ? (
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>Pending Sync: {row.syncStatus.toUpperCase()}</Text>
                ) : null}
                {row.notes ? (
                  <Text style={[styles.ruleLine, { color: theme.subtext }]}>Notes: {row.notes}</Text>
                ) : null}
              </View>
            ))
          )}
        </View>
      ) : null}
      <Modal visible={composerOpen} transparent animationType="fade" onRequestClose={closeComposer}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeComposer} />
          <View style={[styles.dialogCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[styles.modalTitle, { color: theme.heading }]}>
              {composerType === 'DISPOSE'
                ? 'Record Dispose'
                : composerType === 'REPLACE'
                  ? 'Record Replace'
                  : 'Record Junk'}
            </Text>
            <Text style={[styles.modalSub, { color: theme.subtext }]}> 
              {composerType === 'DISPOSE'
                ? 'Dispose deducts from empty qty.'
                : composerType === 'REPLACE'
                  ? 'Replace adds back to empty qty from this disposed entry.'
                  : 'Junk records history against this disposed entry only.'}
            </Text>
            {referenceDisposeId ? (
              <Text style={[styles.ruleLine, { color: theme.subtext }]}>Disposed Reference: {referenceDisposeId}</Text>
            ) : null}
            <TextInput
              value={qty}
              onChangeText={setQty}
              placeholder="Quantity"
              keyboardType="number-pad"
              placeholderTextColor={theme.inputPlaceholder}
              style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
            />
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Reason"
              placeholderTextColor={theme.inputPlaceholder}
              style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
            />
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Notes (optional)"
              placeholderTextColor={theme.inputPlaceholder}
              multiline
              style={[styles.notesInput, { backgroundColor: theme.inputBg, color: theme.inputText }]}
            />
            <View style={styles.dialogActions}>
              <Pressable onPress={closeComposer} style={[styles.secondaryButton, { backgroundColor: theme.pillBg }]}>
                <Text style={[styles.secondaryButtonText, { color: theme.pillText }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void submitAction()}
                disabled={saving}
                style={[styles.primaryButton, { flex: 1, backgroundColor: saving ? theme.primaryMuted : theme.primary }]}
              >
                <Text style={styles.primaryButtonText}>{saving ? 'Saving...' : 'Save Action'}</Text>
              </Pressable>
            </View>
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
  modalSub: {
    fontSize: 12
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
