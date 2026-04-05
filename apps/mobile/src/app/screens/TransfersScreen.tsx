import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import { toastError, toastSuccess } from '../goey-toast';
import type { AppTheme } from '../theme';
import { SwipeToDeleteRow } from '../components/SwipeToDeleteRow';
import {
  loadPendingInventoryDeltaByProductForLocation,
  mergeInventoryWithDeltas,
  type ProjectedInventoryTotals
} from '../local-stock-projection';
import {
  type MasterDataOption,
  loadLocationOptions,
  loadProductOptions,
  loadSupplierOptions
} from '../master-data-local';
import { useTutorialTarget } from '../tutorial/tutorial-provider';

type TransferRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
};

type ShiftRow = {
  id: string;
  payload: string;
  created_at: string;
};

type TransferPayload = {
  shift_id?: string;
  shiftId?: string;
  transfer_mode?: TransferMode;
  supplier_id?: string;
  supplier_name?: string;
  source_location_label?: string;
  destination_location_label?: string;
  source_location_id?: string;
  destination_location_id?: string;
  lines?: Array<{ productId?: string; product_id?: string; qtyFull?: number; qty_full?: number; qtyEmpty?: number; qty_empty?: number }>;
};

type TransferMode =
  | 'SUPPLIER_RESTOCK_IN'
  | 'SUPPLIER_RESTOCK_OUT'
  | 'INTER_STORE_TRANSFER'
  | 'STORE_TO_WAREHOUSE'
  | 'WAREHOUSE_TO_STORE'
  | 'GENERAL';

type LineInput = {
  key: string;
  productId: string;
  qty: string;
};

type InventoryBalanceSnapshot = {
  productId: string;
  locationId: string | null;
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
};

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  preferredLocationId?: string;
  inventoryProjectionVersion?: number;
  onDataChanged?: () => Promise<void> | void;
  syncBusy?: boolean;
};

function parsePayload(row: string): TransferPayload {
  try {
    return JSON.parse(row) as TransferPayload;
  } catch {
    return {};
  }
}

function parseRecord<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
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

function parseInventorySnapshot(payload: Record<string, unknown>): InventoryBalanceSnapshot | null {
  const productId = asString(payload.productId ?? payload.product_id);
  if (!productId) {
    return null;
  }
  const qtyOnHand = asNumber(payload.qtyOnHand ?? payload.qty_on_hand);
  if (qtyOnHand === null) {
    return null;
  }
  return {
    productId,
    locationId: asString(payload.locationId ?? payload.location_id),
    qtyOnHand,
    qtyFull: asNumber(payload.qtyFull ?? payload.qty_full) ?? 0,
    qtyEmpty: asNumber(payload.qtyEmpty ?? payload.qty_empty) ?? 0
  };
}

const FALLBACK_LOCATIONS: MasterDataOption[] = [{ id: 'loc-main', label: 'Main Store', type: 'BRANCH_STORE', code: 'LOC-MAIN' }];
const FALLBACK_PRODUCTS: MasterDataOption[] = [{ id: 'LPG-11-REFILL', label: 'LPG Refill 11kg', subtitle: 'LPG-11-REFILL' }];
const FALLBACK_SUPPLIERS: MasterDataOption[] = [{ id: 'sup-default', label: 'Default Supplier', locationId: 'loc-main' }];

const TRANSFER_MODE_OPTIONS: Array<{ value: TransferMode; label: string; subtitle: string }> = [
  {
    value: 'SUPPLIER_RESTOCK_IN',
    label: 'Supplier Restock In',
    subtitle: 'Supplier -> Store/Warehouse'
  },
  {
    value: 'SUPPLIER_RESTOCK_OUT',
    label: 'Supplier Return Out',
    subtitle: 'Store/Warehouse -> Supplier'
  },
  {
    value: 'INTER_STORE_TRANSFER',
    label: 'Inter-Store Transfer',
    subtitle: 'Store -> Store'
  },
  {
    value: 'STORE_TO_WAREHOUSE',
    label: 'Store to Warehouse',
    subtitle: 'Store -> Warehouse'
  },
  {
    value: 'WAREHOUSE_TO_STORE',
    label: 'Warehouse to Store',
    subtitle: 'Warehouse -> Store'
  },
  {
    value: 'GENERAL',
    label: 'General Transfer',
    subtitle: 'Any location pair'
  }
];

type PickerModalProps = {
  visible: boolean;
  title: string;
  options: MasterDataOption[];
  value: string;
  search: string;
  onSearch: (value: string) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  theme: AppTheme;
};

function PickerModal(props: PickerModalProps): JSX.Element {
  const filtered = useMemo(() => {
    const query = props.search.trim().toLowerCase();
    if (!query) {
      return props.options.slice(0, 140);
    }
    return props.options.filter((option) => {
      const blob = `${option.label} ${option.subtitle ?? ''} ${option.id}`.toLowerCase();
      return blob.includes(query);
    });
  }, [props.options, props.search]);

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] pt-3">
        <Pressable style={StyleSheet.absoluteFillObject} onPress={props.onClose} />
        <View className="min-h-[72%] max-h-[90%] w-full gap-2.5 rounded-t-[18px] border px-3 py-3" style={{ backgroundColor: props.theme.card, borderColor: props.theme.cardBorder }}>
          <Text className="text-base font-extrabold" style={{ color: props.theme.heading }}>{props.title}</Text>
          <TextInput
            value={props.search}
            onChangeText={props.onSearch}
            placeholder="Search..."
            placeholderTextColor={props.theme.inputPlaceholder}
            className="rounded-xl px-3 py-2.5 text-sm"
            style={{ backgroundColor: props.theme.inputBg, color: props.theme.inputText }}
          />
          <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <Text className="mt-3 text-center text-xs" style={{ color: props.theme.subtext }}>No records found.</Text>
            ) : (
              filtered.map((option) => {
                const active = option.id === props.value;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => {
                      props.onSelect(option.id);
                      props.onClose();
                    }}
                    className="gap-px rounded-xl border px-2.5 py-[9px]"
                    style={{ borderColor: props.theme.cardBorder, backgroundColor: active ? props.theme.pillBg : 'transparent' }}
                  >
                    <Text className="text-[13px] font-bold" style={{ color: props.theme.heading }}>{option.label}</Text>
                    {option.subtitle ? (
                      <Text className="text-[11px]" style={{ color: props.theme.subtext }}>{option.subtitle}</Text>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
          <Pressable onPress={props.onClose} className="min-h-10 items-center justify-center rounded-[10px]" style={{ backgroundColor: props.theme.pillBg }}>
            <Text className="text-[13px] font-bold" style={{ color: props.theme.pillText }}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function TransfersScreen({
  db,
  theme,
  preferredLocationId,
  inventoryProjectionVersion = 0,
  onDataChanged,
  syncBusy = false
}: Props): JSX.Element {
  const { width, height } = useWindowDimensions();
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const isCompactLayout = shortEdge <= 360 || longEdge <= 740;
  const tutorialSource = useTutorialTarget('transfer-source');
  const tutorialProduct = useTutorialTarget('transfer-product');
  const tutorialQueue = useTutorialTarget('transfer-queue');
  const [transferMode, setTransferMode] = useState<TransferMode | ''>('');
  const [supplierId, setSupplierId] = useState('');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [fullLines, setFullLines] = useState<LineInput[]>([]);
  const [emptyLines, setEmptyLines] = useState<LineInput[]>([]);
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [locations, setLocations] = useState<MasterDataOption[]>(FALLBACK_LOCATIONS);
  const [products, setProducts] = useState<MasterDataOption[]>(FALLBACK_PRODUCTS);
  const [sourceInventoryByProduct, setSourceInventoryByProduct] = useState<
    Map<string, { qtyOnHand: number; qtyFull: number; qtyEmpty: number }>
  >(new Map());
  const [suppliers, setSuppliers] = useState<MasterDataOption[]>(FALLBACK_SUPPLIERS);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [destinationModalOpen, setDestinationModalOpen] = useState(false);
  const [transferTypeModalOpen, setTransferTypeModalOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');
  const [destinationSearch, setDestinationSearch] = useState('');
  const [transferTypeSearch, setTransferTypeSearch] = useState('');
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState<string>('ALL');
  const [itemPickerTarget, setItemPickerTarget] = useState<{ bucket: 'full' | 'empty'; key: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const prevSyncBusyRef = useRef(syncBusy);
  const sequenceRef = useRef(2);
  const transferModeInitializedRef = useRef(false);

  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const supplierById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);
  const selectedSupplier = supplierId ? supplierById.get(supplierId) ?? null : null;
  const selectedSourceLocation = sourceLocationId ? locationById.get(sourceLocationId) ?? null : null;
  const selectedDestinationLocation = destinationLocationId ? locationById.get(destinationLocationId) ?? null : null;
  const selectedMode = useMemo(
    () => TRANSFER_MODE_OPTIONS.find((option) => option.value === transferMode) ?? null,
    [transferMode]
  );
  const hasSelectedTransferMode = transferMode.length > 0;

  const storeLocations = useMemo(
    () => locations.filter((location) => (location.type ?? '').toUpperCase() === 'BRANCH_STORE'),
    [locations]
  );
  const warehouseLocations = useMemo(
    () => locations.filter((location) => (location.type ?? '').toUpperCase() === 'BRANCH_WAREHOUSE'),
    [locations]
  );
  const selectableAdjustmentLocations = useMemo(
    () => [...storeLocations, ...warehouseLocations],
    [storeLocations, warehouseLocations]
  );
  const preferredAdjustmentLocationId = useMemo(() => {
    const preferred = preferredLocationId?.trim();
    if (preferred && locationById.has(preferred)) {
      return preferred;
    }
    if (destinationLocationId.trim() && locationById.has(destinationLocationId.trim())) {
      return destinationLocationId.trim();
    }
    if (sourceLocationId.trim() && locationById.has(sourceLocationId.trim())) {
      return sourceLocationId.trim();
    }
    return selectableAdjustmentLocations[0]?.id ?? '';
  }, [
    destinationLocationId,
    locationById,
    preferredLocationId,
    selectableAdjustmentLocations,
    sourceLocationId
  ]);
  const selectedAdjustmentLocation = preferredAdjustmentLocationId
    ? locationById.get(preferredAdjustmentLocationId) ?? null
    : null;

  const selectableSourceLocations = useMemo(() => {
    if (!transferMode) {
      return [];
    }
    switch (transferMode) {
      case 'SUPPLIER_RESTOCK_IN':
        return [];
      case 'SUPPLIER_RESTOCK_OUT':
        return [...storeLocations, ...warehouseLocations];
      case 'INTER_STORE_TRANSFER':
        return storeLocations;
      case 'STORE_TO_WAREHOUSE':
        return storeLocations;
      case 'WAREHOUSE_TO_STORE':
        return warehouseLocations;
      default:
        return locations;
    }
  }, [locations, storeLocations, transferMode, warehouseLocations]);

  const selectableDestinationLocations = useMemo(() => {
    if (!transferMode) {
      return [];
    }
    switch (transferMode) {
      case 'SUPPLIER_RESTOCK_IN':
        return [...storeLocations, ...warehouseLocations];
      case 'SUPPLIER_RESTOCK_OUT':
        return [];
      case 'INTER_STORE_TRANSFER':
        return storeLocations.filter((location) => location.id !== sourceLocationId);
      case 'STORE_TO_WAREHOUSE':
        return warehouseLocations;
      case 'WAREHOUSE_TO_STORE':
        return storeLocations;
      default:
        return locations.filter((location) => location.id !== sourceLocationId);
    }
  }, [locations, sourceLocationId, storeLocations, transferMode, warehouseLocations]);

  useEffect(() => {
    if (!transferMode) {
      return;
    }
    if (transferMode === 'SUPPLIER_RESTOCK_IN') {
      return;
    }
    if (transferMode === 'SUPPLIER_RESTOCK_OUT') {
      return;
    }
    if (!selectableSourceLocations.some((location) => location.id === sourceLocationId)) {
      setSourceLocationId(selectableSourceLocations[0]?.id ?? '');
    }
    if (
      !selectableDestinationLocations.some((location) => location.id === destinationLocationId)
    ) {
      setDestinationLocationId(selectableDestinationLocations[0]?.id ?? '');
    }
  }, [
    destinationLocationId,
    selectableDestinationLocations,
    selectableSourceLocations,
    sourceLocationId,
    transferMode
  ]);

  useEffect(() => {
    if (!transferModeInitializedRef.current) {
      transferModeInitializedRef.current = true;
      return;
    }
    setItemModalOpen(false);
    setItemPickerTarget(null);
    resetTransferLines();
  }, [transferMode]);

  useEffect(() => {
    void refreshMasterData();
    void refresh();
    void refreshActiveShift();
  }, []);

  useEffect(() => {
    if (prevSyncBusyRef.current && !syncBusy) {
      void refresh();
      void refreshMasterData();
      void refreshActiveShift();
    }
    prevSyncBusyRef.current = syncBusy;
  }, [syncBusy]);

  const totalFullQty = useMemo(
    () =>
      fullLines.reduce((sum, line) => {
        const parsed = Number(line.qty || '0');
        return Number.isFinite(parsed) && parsed > 0 ? Number((sum + parsed).toFixed(4)) : sum;
      }, 0),
    [fullLines]
  );

  const totalEmptyQty = useMemo(
    () =>
      emptyLines.reduce((sum, line) => {
        const parsed = Number(line.qty || '0');
        return Number.isFinite(parsed) && parsed > 0 ? Number((sum + parsed).toFixed(4)) : sum;
      }, 0),
    [emptyLines]
  );

  const transferModeOptions = useMemo<MasterDataOption[]>(
    () =>
      TRANSFER_MODE_OPTIONS.map((mode) => ({
        id: mode.value,
        label: mode.label,
        subtitle: mode.subtitle
      })),
    []
  );

  const itemCategoryOptions = useMemo(() => {
    return [...new Set(products.map((product) => product.group).filter((value): value is string => Boolean(value)))]
      .sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    return products.filter((product) => {
      if (itemCategoryFilter !== 'ALL' && (product.group ?? 'Uncategorized') !== itemCategoryFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const blob = `${product.label} ${product.subtitle ?? ''} ${product.group ?? ''} ${product.id}`.toLowerCase();
      return blob.includes(query);
    });
  }, [itemCategoryFilter, itemSearch, products]);

  const createLineKey = (bucket: 'full' | 'empty'): string => {
    sequenceRef.current += 1;
    return `${bucket}-${sequenceRef.current}`;
  };

  const resetTransferLines = (): void => {
    setFullLines([]);
    setEmptyLines([]);
  };

  const refreshMasterData = async (): Promise<void> => {
    const [nextLocations, nextProducts, nextSuppliers, productRows] = await Promise.all([
      loadLocationOptions(db),
      loadProductOptions(db),
      loadSupplierOptions(db),
      db.getAllAsync<{ record_id: string; payload: string }>(
        `
        SELECT record_id, payload
        FROM master_data_local
        WHERE entity IN (?, ?)
        ORDER BY updated_at DESC
        `,
        'product',
        'products'
      )
    ]);

    const locationOptions = nextLocations.length ? nextLocations : FALLBACK_LOCATIONS;
    const lpgProductIds = new Set<string>();
    for (const row of productRows) {
      const payload = parseRecord<Record<string, unknown>>(row.payload, {});
      const id = asString(payload.id) ?? asString(payload.product_id) ?? row.record_id;
      if (!id) {
        continue;
      }
      const isLpg =
        payload.isLpg === true ||
        payload.is_lpg === true ||
        Boolean(asString(payload.cylinderTypeId ?? payload.cylinder_type_id));
      if (isLpg) {
        lpgProductIds.add(id);
      }
    }
    const lpgOnlyProducts = nextProducts.filter((product) => lpgProductIds.has(product.id));
    const productOptions = lpgOnlyProducts.length ? lpgOnlyProducts : FALLBACK_PRODUCTS;
    const supplierOptions = nextSuppliers.length ? nextSuppliers : FALLBACK_SUPPLIERS;

    setLocations(locationOptions);
    setProducts(productOptions);
    setSuppliers(supplierOptions);

    setSupplierId((current) =>
      supplierOptions.some((option) => option.id === current) ? current : supplierOptions[0]?.id ?? ''
    );
    const fallbackSource = locationOptions[0]?.id ?? '';
    const fallbackDestination = locationOptions.find((option) => option.id !== fallbackSource)?.id ?? fallbackSource;
    setSourceLocationId((current) =>
      locationOptions.some((option) => option.id === current) ? current : fallbackSource
    );
    setDestinationLocationId((current) =>
      locationOptions.some((option) => option.id === current) ? current : fallbackDestination
    );
    setFullLines((current) =>
      current.map((line) => ({
        ...line,
        productId: productOptions.some((option) => option.id === line.productId)
          ? line.productId
          : ''
      }))
    );
    setEmptyLines((current) =>
      current.map((line) => ({
        ...line,
        productId: productOptions.some((option) => option.id === line.productId)
          ? line.productId
          : ''
      }))
    );
  };

  const refresh = async (): Promise<void> => {
    const result = await db.getAllAsync<TransferRow>(
      `
      SELECT id, payload, sync_status, created_at
      FROM transfers_local
      ORDER BY created_at DESC
      LIMIT 20
      `
    );
    setRows(result);
  };

  const findActiveShiftId = async (): Promise<string | null> => {
    const rows = await db.getAllAsync<ShiftRow>(
      `
      SELECT id, payload, created_at
      FROM shifts_local
      ORDER BY created_at DESC
      `
    );
    for (const row of rows) {
      const payload = parseRecord<Record<string, unknown>>(row.payload, {});
      const statusRaw = String(payload.status ?? '').toUpperCase();
      if (statusRaw === 'OPEN') {
        return row.id;
      }
    }
    return null;
  };

  const refreshActiveShift = async (): Promise<void> => {
    const id = await findActiveShiftId();
    setActiveShiftId(id);
  };

  const appendLine = (bucket: 'full' | 'empty'): void => {
    const key = createLineKey(bucket);
    if (bucket === 'full') {
      setFullLines((current) => [...current, { key, productId: '', qty: '' }]);
      return;
    }
    setEmptyLines((current) => [...current, { key, productId: '', qty: '' }]);
  };

  const removeLine = (bucket: 'full' | 'empty', key: string): void => {
    if (bucket === 'full') {
      setFullLines((current) => current.filter((line) => line.key !== key));
      return;
    }
    setEmptyLines((current) => current.filter((line) => line.key !== key));
  };

  const updateLine = (
    bucket: 'full' | 'empty',
    key: string,
    next: Partial<Pick<LineInput, 'productId' | 'qty'>>
  ): void => {
    const updater = (current: LineInput[]) =>
      current.map((line) => (line.key === key ? { ...line, ...next } : line));
    if (bucket === 'full') {
      setFullLines(updater);
      return;
    }
    setEmptyLines(updater);
  };

  const parseLineQty = (value: string): number => {
    const parsed = Number(value || '0');
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return parsed;
  };

  const stepLineQty = (bucket: 'full' | 'empty', key: string, delta: number): void => {
    const applyStep = (line: LineInput): LineInput => {
      const nextQty = Math.max(0, parseLineQty(line.qty) + delta);
      return { ...line, qty: nextQty <= 0 ? '' : String(nextQty) };
    };
    if (bucket === 'full') {
      setFullLines((current) => current.map((line) => (line.key === key ? applyStep(line) : line)));
      return;
    }
    setEmptyLines((current) => current.map((line) => (line.key === key ? applyStep(line) : line)));
  };

  const requiresSourceStockCheck = (mode: TransferMode | ''): boolean =>
    mode.length > 0 && mode !== 'SUPPLIER_RESTOCK_IN';

  const activeSourceLocationId = useMemo(() => {
    if (!transferMode) {
      return null;
    }
    const id =
      transferMode === 'SUPPLIER_RESTOCK_IN' || transferMode === 'SUPPLIER_RESTOCK_OUT'
        ? preferredAdjustmentLocationId
        : requiresSourceStockCheck(transferMode)
          ? sourceLocationId.trim()
          : '';
    return id.length ? id : null;
  }, [preferredAdjustmentLocationId, sourceLocationId, transferMode]);

  const buildInventoryByProductForLocation = async (
    locationId: string
  ): Promise<Map<string, ProjectedInventoryTotals>> => {
    const rows = await db.getAllAsync<{ payload: string }>(
      `
      SELECT payload
      FROM master_data_local
      WHERE entity IN (?, ?)
      ORDER BY updated_at DESC
      `,
      'inventory_balance',
      'inventory_balances'
    );

    const inventoryByProduct = new Map<string, { qtyOnHand: number; qtyFull: number; qtyEmpty: number }>();
    for (const row of rows) {
      const snapshot = parseInventorySnapshot(parseRecord<Record<string, unknown>>(row.payload, {}));
      if (!snapshot) {
        continue;
      }
      if (snapshot.locationId && snapshot.locationId !== locationId) {
        continue;
      }
      const current = inventoryByProduct.get(snapshot.productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
      current.qtyOnHand += snapshot.qtyOnHand;
      current.qtyFull += snapshot.qtyFull;
      current.qtyEmpty += snapshot.qtyEmpty;
      inventoryByProduct.set(snapshot.productId, current);
    }
    const pendingDeltaByProduct = await loadPendingInventoryDeltaByProductForLocation(db, locationId);
    return mergeInventoryWithDeltas(inventoryByProduct, pendingDeltaByProduct);
  };

  useEffect(() => {
    if (!activeSourceLocationId) {
      setSourceInventoryByProduct(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const inventory = await buildInventoryByProductForLocation(activeSourceLocationId);
      if (!cancelled) {
        setSourceInventoryByProduct(inventory);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSourceLocationId, syncBusy, rows, inventoryProjectionVersion]);

  const resolveAvailableQtyForBucket = (productId: string, bucket: 'full' | 'empty'): number => {
    const stock = sourceInventoryByProduct.get(productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
    const product = productById.get(productId);
    if (product?.isLpg) {
      return Math.max(0, Number(stock.qtyOnHand || 0));
    }
    let available = bucket === 'full' ? stock.qtyFull : stock.qtyEmpty;
    if (available <= 0.0001 && stock.qtyFull <= 0.0001 && stock.qtyEmpty <= 0.0001) {
      available = stock.qtyOnHand;
    }
    return Math.max(0, Number(available || 0));
  };

  const resolveRemainingQtyForLine = (bucket: 'full' | 'empty', lineKey: string, productId: string): number => {
    if (!requiresSourceStockCheck(transferMode)) {
      return Number.POSITIVE_INFINITY;
    }
    if (!activeSourceLocationId) {
      return 0;
    }
    const available = resolveAvailableQtyForBucket(productId, bucket);
    const lines = bucket === 'full' ? fullLines : emptyLines;
    const usedByOthers = lines.reduce((sum, line) => {
      if (line.key === lineKey || line.productId !== productId) {
        return sum;
      }
      return sum + parseLineQty(line.qty);
    }, 0);
    return Math.max(0, Number((available - usedByOthers).toFixed(4)));
  };

  const stepLineQtyChecked = (bucket: 'full' | 'empty', key: string, delta: number): void => {
    const lines = bucket === 'full' ? fullLines : emptyLines;
    const line = lines.find((entry) => entry.key === key);
    if (!line) {
      return;
    }
    const nextQty = Math.max(0, parseLineQty(line.qty) + delta);
    if (delta > 0 && line.productId && requiresSourceStockCheck(transferMode)) {
      const allowed = resolveRemainingQtyForLine(bucket, key, line.productId);
      if (nextQty > allowed + 0.0001) {
        const productLabel = productById.get(line.productId)?.label ?? 'Item';
        toastError('Transfer qty', `${productLabel}: max ${allowed.toFixed(2)} for ${bucket.toUpperCase()} at source.`);
        return;
      }
    }
    updateLine(bucket, key, { qty: nextQty <= 0 ? '' : String(nextQty) });
  };

  const isProductDisabledForPicker = (productId: string, bucket: 'full' | 'empty'): boolean => {
    if (!requiresSourceStockCheck(transferMode)) {
      return false;
    }
    if (!activeSourceLocationId) {
      return true;
    }
    return resolveAvailableQtyForBucket(productId, bucket) <= 0.0001;
  };

  const validateSourceStockByMovement = async (
    sourceLocationId: string,
    sourceLabel: string,
    lines: Array<{ productId: string; qtyFull: number; qtyEmpty: number }>
  ): Promise<string[]> => {
    const inventoryByProduct = await buildInventoryByProductForLocation(sourceLocationId);
    const errors: string[] = [];

    for (const line of lines) {
      const product = productById.get(line.productId);
      const productLabel = product?.label ?? line.productId;
      const stock = inventoryByProduct.get(line.productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
      const requiredFull = Number(line.qtyFull || 0);
      const requiredEmpty = Number(line.qtyEmpty || 0);
      const requiredTotal = Number((requiredFull + requiredEmpty).toFixed(4));

      if (product?.isLpg) {
        if (requiredTotal > 0 && stock.qtyOnHand + 0.0001 < requiredTotal) {
          errors.push(
            `${productLabel}: insufficient stock at ${sourceLabel} (avail ${stock.qtyOnHand.toFixed(2)}, need ${requiredTotal.toFixed(2)}).`
          );
        }
        continue;
      }

      // For non-cylinder products, FULL/EMPTY buckets may be zero in local snapshot;
      // use qty_on_hand as fallback validation for total movement.
      if (stock.qtyFull <= 0.0001 && stock.qtyEmpty <= 0.0001) {
        if (requiredTotal > 0 && stock.qtyOnHand + 0.0001 < requiredTotal) {
          errors.push(
            `${productLabel}: insufficient stock at ${sourceLabel} (avail ${stock.qtyOnHand.toFixed(2)}, need ${requiredTotal.toFixed(2)}).`
          );
        }
        continue;
      }

      if (requiredFull > 0 && stock.qtyFull + 0.0001 < requiredFull) {
        errors.push(
          `${productLabel}: insufficient FULL at ${sourceLabel} (avail ${stock.qtyFull.toFixed(2)}, need ${requiredFull.toFixed(2)}).`
        );
      }
      if (requiredEmpty > 0 && stock.qtyEmpty + 0.0001 < requiredEmpty) {
        errors.push(
          `${productLabel}: insufficient EMPTY at ${sourceLabel} (avail ${stock.qtyEmpty.toFixed(2)}, need ${requiredEmpty.toFixed(2)}).`
        );
      }
    }
    return errors;
  };

  const openItemPicker = (bucket: 'full' | 'empty', key: string): void => {
    if (saving || syncBusy) {
      return;
    }
    if (!transferMode) {
      toastError('Transfer', 'Select transfer type first.');
      return;
    }
    setItemPickerTarget({ bucket, key });
    setItemSearch('');
    setItemCategoryFilter('ALL');
    setItemModalOpen(true);
  };

  const selectItemFromModal = (productId: string): void => {
    if (!itemPickerTarget) {
      return;
    }
    updateLine(itemPickerTarget.bucket, itemPickerTarget.key, { productId });
    setItemModalOpen(false);
    setItemPickerTarget(null);
  };

  const resolveEndpoints = (): {
    sourceId: string;
    destinationId: string;
    sourceLabel: string;
    destinationLabel: string;
    supplierName: string | null;
  } | null => {
    if (!transferMode) {
      toastError('Transfer', 'Please select transfer type.');
      return null;
    }
    const supplierName = selectedSupplier?.label ?? null;
    if (transferMode === 'SUPPLIER_RESTOCK_IN') {
      if (!supplierId.trim()) {
        toastError('Transfer', 'Please select supplier.');
        return null;
      }
      if (!preferredAdjustmentLocationId) {
        toastError('Transfer', 'Current branch location is missing. Reopen branch setup.');
        return null;
      }
      return {
        sourceId: preferredAdjustmentLocationId,
        destinationId: preferredAdjustmentLocationId,
        sourceLabel: supplierName ? `${supplierName} (Supplier)` : 'Supplier',
        destinationLabel: selectedAdjustmentLocation?.label ?? preferredAdjustmentLocationId,
        supplierName
      };
    }
    if (transferMode === 'SUPPLIER_RESTOCK_OUT') {
      if (!supplierId.trim()) {
        toastError('Transfer', 'Please select supplier.');
        return null;
      }
      if (!preferredAdjustmentLocationId) {
        toastError('Transfer', 'Current branch location is missing. Reopen branch setup.');
        return null;
      }
      return {
        sourceId: preferredAdjustmentLocationId,
        destinationId: preferredAdjustmentLocationId,
        sourceLabel: selectedAdjustmentLocation?.label ?? preferredAdjustmentLocationId,
        destinationLabel: supplierName ? `${supplierName} (Supplier)` : 'Supplier',
        supplierName
      };
    }

    if (!sourceLocationId || !destinationLocationId) {
      toastError('Transfer', 'Source and destination locations are required.');
      return null;
    }
    return {
      sourceId: sourceLocationId,
      destinationId: destinationLocationId,
      sourceLabel: locationById.get(sourceLocationId)?.label ?? sourceLocationId,
      destinationLabel: locationById.get(destinationLocationId)?.label ?? destinationLocationId,
      supplierName
    };
  };

  const createTransfer = async (): Promise<void> => {
    if (!transferMode) {
      toastError('Transfer', 'Please select transfer type.');
      return;
    }
    const endpoints = resolveEndpoints();
    if (!endpoints) {
      return;
    }
    if (
      endpoints.sourceId === endpoints.destinationId &&
      transferMode !== 'SUPPLIER_RESTOCK_IN' &&
      transferMode !== 'SUPPLIER_RESTOCK_OUT'
    ) {
      toastError('Transfer', 'Source and destination must be different.');
      return;
    }

    const merged = new Map<string, { qtyFull: number; qtyEmpty: number }>();
    for (const line of fullLines) {
      const productId = line.productId.trim();
      if (!productId) {
        continue;
      }
      const qty = Number(line.qty || '0');
      if (!Number.isFinite(qty) || qty < 0) {
        toastError('Transfer', 'FULL quantity must be a valid non-negative number.');
        return;
      }
      if (qty <= 0) {
        continue;
      }
      const bucket = merged.get(productId) ?? { qtyFull: 0, qtyEmpty: 0 };
      bucket.qtyFull = Number((bucket.qtyFull + qty).toFixed(4));
      merged.set(productId, bucket);
    }
    for (const line of emptyLines) {
      const productId = line.productId.trim();
      if (!productId) {
        continue;
      }
      const qty = Number(line.qty || '0');
      if (!Number.isFinite(qty) || qty < 0) {
        toastError('Transfer', 'EMPTY quantity must be a valid non-negative number.');
        return;
      }
      if (qty <= 0) {
        continue;
      }
      const bucket = merged.get(productId) ?? { qtyFull: 0, qtyEmpty: 0 };
      bucket.qtyEmpty = Number((bucket.qtyEmpty + qty).toFixed(4));
      merged.set(productId, bucket);
    }

    const lines = [...merged.entries()].map(([productId, value]) => ({
      productId,
      qtyFull: value.qtyFull,
      qtyEmpty: value.qtyEmpty
    }));
    if (lines.length === 0) {
      toastError('Transfer', 'Add at least one FULL or EMPTY line quantity.');
      return;
    }

    const shiftId = await findActiveShiftId();
    setActiveShiftId(shiftId);
    if (!shiftId) {
      toastError('Transfer', 'No active shift. Start duty first in Shift.');
      return;
    }

    if (requiresSourceStockCheck(transferMode)) {
      const stockErrors = await validateSourceStockByMovement(endpoints.sourceId, endpoints.sourceLabel, lines);
      if (stockErrors.length) {
        toastError('Transfer stock check', stockErrors[0]);
        return;
      }
    }

    setSaving(true);
    try {
      const service = new OfflineTransactionService(db);
      const id = await service.createOfflineTransfer({
        sourceLocationId: endpoints.sourceId,
        destinationLocationId: endpoints.destinationId,
        shiftId,
        transferMode,
        supplierId: supplierId || null,
        supplierName: endpoints.supplierName,
        sourceLocationLabel: endpoints.sourceLabel,
        destinationLocationLabel: endpoints.destinationLabel,
        lines
      });
      toastSuccess('Transfer queued', `Transfer ID: ${id}`);
      resetTransferLines();
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      toastError('Transfer failed', cause instanceof Error ? cause.message : 'Unable to queue transfer.');
    } finally {
      setSaving(false);
    }
  };

  const modeSubtitle = selectedMode?.subtitle ?? '';

  const renderLineTable = (bucket: 'full' | 'empty', lines: LineInput[]): JSX.Element => (
    <View
      className="gap-2 rounded-2xl border px-3 py-3"
      style={[
        isCompactLayout ? { paddingHorizontal: 8, paddingVertical: 8, gap: 6 } : null,
        { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
      ]}
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>
          {bucket === 'full' ? 'FULL Items' : 'EMPTY Items'}
        </Text>
        <Pressable
          className="min-h-9 items-center justify-center rounded-xl border px-3"
          style={{ borderColor: theme.cardBorder, backgroundColor: theme.card }}
          onPress={() => appendLine(bucket)}
          disabled={saving || syncBusy}
        >
          <Text className="text-[12px] font-bold" style={{ color: theme.heading }}>+ Add</Text>
        </Pressable>
      </View>
      {lines.length === 0 ? (
        <View
          style={[
            styles.transferEmptyCard,
            isCompactLayout ? { paddingHorizontal: 8, paddingVertical: 8, gap: 6 } : null,
            { borderColor: theme.cardBorder, backgroundColor: theme.card }
          ]}
        >
          <Text style={[styles.transferEmptyTitle, { color: theme.heading }]}>
            No {bucket === 'full' ? 'FULL' : 'EMPTY'} items yet.
          </Text>
          <Text style={[styles.transferEmptyCopy, { color: theme.subtext }]}>
            Tap + Add to choose the first {bucket === 'full' ? 'FULL' : 'EMPTY'} item for this transfer.
          </Text>
        </View>
      ) : (
        lines.map((line, index) => (
          <SwipeToDeleteRow
            key={line.key}
            theme={theme}
            onDelete={() => removeLine(bucket, line.key)}
            disabled={saving || syncBusy}
            deleteLabel="Remove"
          >
            <View
              className="gap-2 rounded-xl border px-3 py-3"
              style={[
                isCompactLayout ? { paddingHorizontal: 8, paddingVertical: 8, gap: 6 } : null,
                { borderColor: theme.cardBorder, backgroundColor: theme.card }
              ]}
            >
              <View
                className="flex-row items-start gap-2"
                style={isCompactLayout ? { gap: 8 } : null}
              >
                <Pressable
                  onPress={() => openItemPicker(bucket, line.key)}
                  className="min-w-0 flex-1 rounded-xl border px-3 py-2.5"
                  style={[
                    isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
                    { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
                  ]}
                  disabled={saving || syncBusy}
                >
                  <Text
                    className="text-[14px] font-bold"
                    style={[isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]}
                    numberOfLines={1}
                  >
                    {productById.get(line.productId)?.label ?? 'Select item'}
                  </Text>
                  {(productById.get(line.productId)?.subtitle ?? productById.get(line.productId)?.group) ? (
                    <Text className="text-[11px]" style={{ color: theme.subtext }}>
                      {productById.get(line.productId)?.subtitle ?? productById.get(line.productId)?.group}
                    </Text>
                  ) : null}
                  {line.productId ? (
                    <View className="mt-2 flex-row flex-wrap gap-1.5">
                      <View
                        className="min-h-7 justify-center rounded-full border px-2.5"
                        style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
                      >
                        <Text className="text-[11px] font-bold" style={{ color: theme.pillText }}>
                          Available {resolveAvailableQtyForBucket(line.productId, bucket).toFixed(2)}
                        </Text>
                      </View>
                      {requiresSourceStockCheck(transferMode) ? (
                        <View
                          className="min-h-7 justify-center rounded-full border px-2.5"
                          style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
                        >
                          <Text className="text-[11px] font-bold" style={{ color: theme.pillText }}>
                            Remaining {resolveRemainingQtyForLine(bucket, line.key, line.productId).toFixed(2)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : (
                    <Text className="mt-1.5 text-[11px]" style={{ color: theme.subtext }}>
                      Tap to choose the transfer item.
                    </Text>
                  )}
                </Pressable>

                <View
                  className="gap-1.5"
                  style={isCompactLayout ? { minWidth: 94, alignItems: 'flex-end' } : { minWidth: 112, alignItems: 'flex-end' }}
                >
                  <Text
                    className="text-[11px] font-semibold"
                    style={{ textAlign: 'right', color: theme.subtext }}
                  >
                    Qty
                  </Text>
                  <Text
                    className="text-[15px] font-extrabold"
                    style={{ textAlign: 'right', color: theme.heading }}
                  >
                    {parseLineQty(line.qty).toFixed(0)}
                  </Text>
                  <View className="flex-row items-center gap-2" style={isCompactLayout ? { gap: 4 } : null}>
                    <Pressable
                      onPress={() => stepLineQtyChecked(bucket, line.key, -1)}
                      className="items-center justify-center rounded-full"
                      style={[{ width: isCompactLayout ? 30 : 32, height: isCompactLayout ? 30 : 32, backgroundColor: theme.pillBg }]}
                      disabled={saving || syncBusy}
                    >
                      <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>-</Text>
                    </Pressable>
                    <View
                      className="items-center justify-center rounded-xl border"
                      style={[
                        isCompactLayout ? { width: 56, paddingHorizontal: 6, paddingVertical: 7 } : { width: 72, paddingHorizontal: 10, paddingVertical: 9 },
                        { backgroundColor: theme.inputBg, borderColor: theme.cardBorder }
                      ]}
                    >
                      <Text className="text-[13px] font-bold" style={{ color: theme.inputText }}>{parseLineQty(line.qty).toFixed(0)}</Text>
                    </View>
                    <Pressable
                      onPress={() => stepLineQtyChecked(bucket, line.key, 1)}
                      className="items-center justify-center rounded-full"
                      style={[{ width: isCompactLayout ? 30 : 32, height: isCompactLayout ? 30 : 32, backgroundColor: theme.pillBg }]}
                      disabled={saving || syncBusy}
                    >
                      <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>+</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          </SwipeToDeleteRow>
        ))
      )}
    </View>
  );

  return (
    <View
      className="gap-2.5 rounded-2xl border px-3.5 py-3.5"
      style={[
        isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 10, gap: 8, borderRadius: 14 } : null,
        { backgroundColor: theme.card, borderColor: theme.cardBorder }
      ]}
    >
      <View className="flex-row items-start gap-2.5" style={isCompactLayout ? { flexDirection: 'column', gap: 8 } : null}>
        <View className="flex-1">
          <Text className="text-lg font-bold" style={[isCompactLayout ? { fontSize: 16 } : null, { color: theme.heading }]}>Advanced Transfers</Text>
          <Text className="text-[13px]" style={[isCompactLayout ? { fontSize: 12 } : null, { color: theme.subtext }]}>
            Supplier, store, and warehouse stock movements with FULL/EMPTY control.
          </Text>
        </View>
        <Pressable
          className="min-h-11 items-center justify-center rounded-xl px-4"
          style={[
            isCompactLayout ? { alignSelf: 'stretch' } : null,
            { backgroundColor: saving || syncBusy ? theme.primaryMuted : theme.primary }
          ]}
          onPress={() => {
            void refresh();
            void refreshMasterData();
          }}
          disabled={saving || syncBusy}
        >
          <Text className="text-[13px] font-bold text-white">Refresh</Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ maxHeight: isCompactLayout ? 560 : 620 }}
        contentContainerStyle={{ gap: isCompactLayout ? 8 : 10 }}
        nestedScrollEnabled
      >
        <View ref={tutorialSource.ref} onLayout={tutorialSource.onLayout}>
          <Pressable
            onPress={() => {
              if (saving || syncBusy) {
                return;
              }
              setTransferTypeSearch('');
              setTransferTypeModalOpen(true);
            }}
            className="rounded-xl border px-3 py-2.5"
            style={[
              isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
              { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
            ]}
            disabled={saving || syncBusy}
          >
            <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Transfer Type</Text>
            <Text className="text-[14px] font-bold" style={[isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]} numberOfLines={1}>
              {selectedMode?.label ?? 'Select transfer type'}
            </Text>
          </Pressable>
          <Text style={[styles.helper, { color: theme.subtext }]}>{modeSubtitle}</Text>
        </View>

        {hasSelectedTransferMode && (transferMode === 'SUPPLIER_RESTOCK_IN' || transferMode === 'SUPPLIER_RESTOCK_OUT') ? (
          <View className="gap-2">
            <Pressable
              onPress={() => {
                if (saving || syncBusy) {
                  return;
                }
                setSupplierSearch('');
                setSupplierModalOpen(true);
              }}
              className="rounded-xl border px-3 py-2.5"
              style={[
                isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
                { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
              ]}
              disabled={saving || syncBusy}
            >
              <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Supplier</Text>
              <Text className="text-[14px] font-bold" style={[isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]} numberOfLines={1}>
                {selectedSupplier?.label ?? 'Select supplier'}
              </Text>
            </Pressable>
            <View
              className="rounded-xl border px-3 py-2.5"
              style={[
                isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
                { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
              ]}
            >
              <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>
                {transferMode === 'SUPPLIER_RESTOCK_IN' ? 'Restock Destination' : 'Restock Source'}
              </Text>
              <Text
                className="text-[14px] font-bold"
                style={[isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]}
                numberOfLines={1}
              >
                {selectedAdjustmentLocation?.label ?? 'No active branch location'}
              </Text>
              <Text className="mt-1 text-[11px]" style={{ color: theme.subtext }}>
                Supplier restocks use the current branch/store location automatically.
              </Text>
            </View>
          </View>
        ) : null}

        {hasSelectedTransferMode &&
        transferMode !== 'SUPPLIER_RESTOCK_IN' &&
        transferMode !== 'SUPPLIER_RESTOCK_OUT' ? (
          <Pressable
            onPress={() => {
              if (saving || syncBusy) {
                return;
              }
              setSourceSearch('');
              setSourceModalOpen(true);
            }}
            className="rounded-xl border px-3 py-2.5"
            style={[
              isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
              { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
            ]}
            disabled={saving || syncBusy}
          >
            <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Source Location</Text>
            <Text className="text-[14px] font-bold" style={[isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]} numberOfLines={1}>
              {selectedSourceLocation?.label ?? 'Select source'}
            </Text>
          </Pressable>
        ) : null}

        {hasSelectedTransferMode &&
        transferMode !== 'SUPPLIER_RESTOCK_IN' &&
        transferMode !== 'SUPPLIER_RESTOCK_OUT' ? (
          <Pressable
            onPress={() => {
              if (saving || syncBusy) {
                return;
              }
              setDestinationSearch('');
              setDestinationModalOpen(true);
            }}
            className="rounded-xl border px-3 py-2.5"
            style={[
              isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
              { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
            ]}
            disabled={saving || syncBusy}
          >
            <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Destination Location</Text>
            <Text className="text-[14px] font-bold" style={[isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]} numberOfLines={1}>
              {selectedDestinationLocation?.label ?? 'Select destination'}
            </Text>
          </Pressable>
        ) : null}
        {hasSelectedTransferMode ? (
          <View ref={tutorialProduct.ref} onLayout={tutorialProduct.onLayout}>
            {renderLineTable('full', fullLines)}
            {renderLineTable('empty', emptyLines)}
          </View>
        ) : (
          <View
            className="gap-1.5 rounded-xl border px-3 py-3"
            style={[
              isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
              { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
            ]}
          >
            <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>
              Select transfer type first
            </Text>
            <Text className="text-[12px]" style={{ color: theme.subtext }}>
              Choose the transfer type before selecting supplier, locations, and FULL or EMPTY items.
            </Text>
          </View>
        )}

        <View
          className="gap-1.5 rounded-xl border px-3 py-3"
          style={[
            isCompactLayout ? { paddingHorizontal: 8, paddingVertical: 8 } : null,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
          ]}
        >
          <Text className="text-[12px]" style={{ color: theme.subtext }}>
            Active Shift: {activeShiftId ?? 'No active shift'}
          </Text>
          <Text className="text-[12px]" style={{ color: theme.subtext }}>Line Items: {fullLines.length + emptyLines.length}</Text>
          <Text className="text-[12px]" style={{ color: theme.subtext }}>FULL Qty Total: {totalFullQty.toFixed(2)}</Text>
          <Text className="text-[12px]" style={{ color: theme.subtext }}>EMPTY Qty Total: {totalEmptyQty.toFixed(2)}</Text>
          <Text className="text-[12px]" style={{ color: theme.subtext }}>
            FULL and EMPTY quantities are posted separately for server-authoritative stock.
          </Text>
        </View>

        <View ref={tutorialQueue.ref} onLayout={tutorialQueue.onLayout}>
          <Pressable
            style={[
              styles.primaryBtn,
              {
                backgroundColor:
                  saving || !activeShiftId || !hasSelectedTransferMode ? theme.primaryMuted : theme.primary
              },
              tutorialQueue.active ? styles.tutorialTargetFocus : null
            ]}
            onPress={() => void createTransfer()}
            disabled={saving || syncBusy || !activeShiftId || !hasSelectedTransferMode}
          >
            <Text style={styles.primaryText}>{saving ? 'Queueing...' : 'Queue Transfer'}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <PickerModal
        visible={transferTypeModalOpen}
        title="Select Transfer Type"
        options={transferModeOptions}
        value={transferMode}
        search={transferTypeSearch}
        onSearch={setTransferTypeSearch}
        onClose={() => setTransferTypeModalOpen(false)}
        onSelect={(value) => setTransferMode(value as TransferMode)}
        theme={theme}
      />

      <PickerModal
        visible={supplierModalOpen}
        title="Select Supplier"
        options={suppliers}
        value={supplierId}
        search={supplierSearch}
        onSearch={setSupplierSearch}
        onClose={() => setSupplierModalOpen(false)}
        onSelect={setSupplierId}
        theme={theme}
      />

      <PickerModal
        visible={sourceModalOpen}
        title="Select Source Location"
        options={selectableSourceLocations}
        value={sourceLocationId}
        search={sourceSearch}
        onSearch={setSourceSearch}
        onClose={() => setSourceModalOpen(false)}
        onSelect={setSourceLocationId}
        theme={theme}
      />

      <PickerModal
        visible={destinationModalOpen}
        title="Select Destination Location"
        options={selectableDestinationLocations}
        value={destinationLocationId}
        search={destinationSearch}
        onSearch={setDestinationSearch}
        onClose={() => setDestinationModalOpen(false)}
        onSelect={setDestinationLocationId}
        theme={theme}
      />

      <Modal
        visible={itemModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setItemModalOpen(false);
          setItemPickerTarget(null);
        }}
      >
        <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] pt-3">
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => {
              setItemModalOpen(false);
              setItemPickerTarget(null);
            }}
          />
          <View
            className="min-h-[82%] max-h-[94%] w-full gap-2.5 rounded-t-[20px] border px-3 py-3"
            style={[
              isCompactLayout ? { minHeight: '86%', maxHeight: '96%', paddingHorizontal: 10, paddingVertical: 10, gap: 8 } : null,
              { backgroundColor: theme.card, borderColor: theme.cardBorder }
            ]}
          >
            <View className="gap-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Select Item</Text>
                <View
                  className="rounded-full px-3 py-1"
                  style={{ backgroundColor: (itemPickerTarget?.bucket ?? 'full') === 'full' ? theme.primary : theme.pillBg }}
                >
                  <Text
                    className="text-[11px] font-semibold"
                    style={{ color: (itemPickerTarget?.bucket ?? 'full') === 'full' ? '#FFFFFF' : theme.pillText }}
                  >
                    {(itemPickerTarget?.bucket ?? 'full') === 'full' ? 'FULL' : 'EMPTY'}
                  </Text>
                </View>
              </View>
              <Text className="text-[12px]" style={{ color: theme.subtext }}>
                Pick the transfer item and review source stock before adding quantity.
              </Text>
            </View>
            <TextInput
              value={itemSearch}
              onChangeText={setItemSearch}
              placeholder="Search item code or name"
              placeholderTextColor={theme.inputPlaceholder}
              className="rounded-xl px-3 py-[11px] text-[13px]"
              style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
            />
            <View style={[styles.itemCategoryWrap, isCompactLayout ? { height: 38 } : null]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.itemCategoryRow}>
                <Pressable
                  onPress={() => setItemCategoryFilter('ALL')}
                  style={[
                    styles.itemCategoryChip,
                    isCompactLayout ? { height: 28, maxWidth: 150, paddingHorizontal: 10 } : null,
                    { backgroundColor: itemCategoryFilter === 'ALL' ? theme.primary : theme.pillBg }
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[
                      styles.itemCategoryChipText,
                      isCompactLayout ? { maxWidth: 130, fontSize: 10 } : null,
                      { color: itemCategoryFilter === 'ALL' ? '#FFFFFF' : theme.pillText }
                    ]}
                  >
                    All Categories
                  </Text>
                </Pressable>
                {itemCategoryOptions.map((category) => {
                  const selected = itemCategoryFilter === category;
                  return (
                    <Pressable
                      key={category}
                      onPress={() => setItemCategoryFilter(category)}
                      style={[
                        styles.itemCategoryChip,
                        isCompactLayout ? { height: 28, maxWidth: 150, paddingHorizontal: 10 } : null,
                        { backgroundColor: selected ? theme.primary : theme.pillBg }
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={[
                          styles.itemCategoryChipText,
                          isCompactLayout ? { maxWidth: 130, fontSize: 10 } : null,
                          { color: selected ? '#FFFFFF' : theme.pillText }
                        ]}
                      >
                        {category}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ gap: 10, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
              {requiresSourceStockCheck(transferMode) && !activeSourceLocationId ? (
                <Text style={[styles.modalEmpty, { color: theme.subtext }]}>Select source location first to enable item selection.</Text>
              ) : null}
              {filteredProducts.length === 0 ? (
                <Text style={[styles.modalEmpty, { color: theme.subtext }]}>No matching items.</Text>
              ) : (
                filteredProducts.map((product) => {
                  const bucket = itemPickerTarget?.bucket ?? 'full';
                  const disabled = isProductDisabledForPicker(product.id, bucket);
                  const canShowSourceStock = Boolean(activeSourceLocationId);
                  const stock = canShowSourceStock
                    ? sourceInventoryByProduct.get(product.id) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 }
                    : null;
                  const showProductBasedStock = Boolean(product.isLpg);
                  const availableQty =
                    activeSourceLocationId
                      ? resolveAvailableQtyForBucket(product.id, bucket)
                      : null;
                  return (
                    <Pressable
                      key={product.id}
                      onPress={() => {
                        if (disabled) {
                          toastError(
                            'No stock',
                            `${product.label}: no available ${bucket.toUpperCase()} qty at source location.`
                          );
                          return;
                        }
                        selectItemFromModal(product.id);
                      }}
                      disabled={disabled}
                      className="gap-2 rounded-xl border px-3 py-3"
                      style={[
                        isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 10, gap: 6 } : null,
                        disabled ? styles.itemSelectCardDisabled : null,
                        { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
                      ]}
                    >
                      {disabled ? (
                        <>
                          <View style={styles.noStockBadge}>
                            <Text style={styles.noStockBadgeText}>NO STOCK</Text>
                          </View>
                          <Text style={styles.noStockWatermark}>NO STOCK</Text>
                        </>
                      ) : null}
                      <View className="flex-row items-start justify-between gap-3">
                        <View className="min-w-0 flex-1 gap-0.5">
                          <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>{product.label}</Text>
                          <Text className="text-[12px]" style={{ color: theme.subtext }}>{product.subtitle ?? product.id}</Text>
                        </View>
                        <View
                          className="rounded-full px-3 py-1"
                          style={[
                            isCompactLayout ? { paddingHorizontal: 8, paddingVertical: 4 } : null,
                            { backgroundColor: theme.pillBg }
                          ]}
                        >
                          <Text className="text-[11px] font-semibold" style={{ color: theme.pillText }}>{product.group ?? 'General'}</Text>
                        </View>
                      </View>
                      {stock && showProductBasedStock ? (
                        <View className="gap-2">
                          <View
                            className="rounded-xl px-3 py-2"
                            style={{ backgroundColor: theme.pillBg }}
                          >
                            <Text className="text-[10px] font-semibold uppercase" style={{ color: theme.subtext }}>Product Stock</Text>
                            <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{stock.qtyOnHand.toFixed(2)}</Text>
                          </View>
                          <Text className="text-[11px]" style={{ color: theme.subtext }}>
                            {transferMode === 'SUPPLIER_RESTOCK_IN' || transferMode === 'SUPPLIER_RESTOCK_OUT'
                              ? 'Current branch/store quantity for this item.'
                              : 'Transfer stock checks use this item&apos;s product quantity, not shared cylinder-type totals.'}
                          </Text>
                        </View>
                      ) : stock ? (
                        <View className="flex-row flex-wrap gap-2" style={isCompactLayout ? { gap: 6 } : null}>
                          <View
                            className="min-w-[31%] flex-1 rounded-xl px-3 py-2"
                            style={[isCompactLayout ? { minWidth: '31%', flexBasis: '31%' } : null, { backgroundColor: theme.pillBg }]}
                          >
                            <Text className="text-[10px] font-semibold uppercase" style={{ color: theme.subtext }}>FULL</Text>
                            <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{stock.qtyFull.toFixed(2)}</Text>
                          </View>
                          <View
                            className="min-w-[31%] flex-1 rounded-xl px-3 py-2"
                            style={[isCompactLayout ? { minWidth: '31%', flexBasis: '31%' } : null, { backgroundColor: theme.pillBg }]}
                          >
                            <Text className="text-[10px] font-semibold uppercase" style={{ color: theme.subtext }}>EMPTY</Text>
                            <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{stock.qtyEmpty.toFixed(2)}</Text>
                          </View>
                          <View
                            className="min-w-[31%] flex-1 rounded-xl px-3 py-2"
                            style={[isCompactLayout ? { minWidth: '31%', flexBasis: '31%' } : null, { backgroundColor: theme.pillBg }]}
                          >
                            <Text className="text-[10px] font-semibold uppercase" style={{ color: theme.subtext }}>QOH</Text>
                            <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{stock.qtyOnHand.toFixed(2)}</Text>
                          </View>
                        </View>
                      ) : (
                        <Text className="text-[12px]" style={{ color: theme.subtext }}>
                          {transferMode === 'SUPPLIER_RESTOCK_IN'
                            ? 'Supplier stock is not tracked locally for restock-in transfers.'
                            : 'Source stock appears after you select a source location.'}
                        </Text>
                      )}
                      {availableQty !== null ? (
                        <View
                          className="self-start rounded-full px-3 py-1"
                          style={{ backgroundColor: theme.pillBg }}
                        >
                          <Text className="text-[11px] font-semibold" style={{ color: theme.pillText }}>
                            {transferMode === 'SUPPLIER_RESTOCK_IN' || transferMode === 'SUPPLIER_RESTOCK_OUT'
                              ? `Store Qty: ${availableQty.toFixed(2)}`
                              : `Available ${bucket.toUpperCase()}: ${availableQty.toFixed(2)}`}
                          </Text>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Pressable
              onPress={() => {
                setItemModalOpen(false);
                setItemPickerTarget(null);
              }}
              className="min-h-10 items-center justify-center rounded-xl px-3"
              style={{ backgroundColor: theme.pillBg }}
            >
              <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Close</Text>
            </Pressable>
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10
  },
  title: {
    fontSize: 18,
    fontWeight: '700'
  },
  sub: {
    fontSize: 13
  },
  refreshBtn: {
    minHeight: 38,
    minWidth: 84,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  refreshText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 8
  },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: '800'
  },
  fieldTitle: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6
  },
  modeRow: {
    gap: 8,
    paddingRight: 6
  },
  modePill: {
    minHeight: 32,
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12
  },
  modeLabel: {
    fontSize: 11,
    fontWeight: '700'
  },
  selectorButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 2
  },
  selectorLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  selectorValue: {
    fontSize: 14,
    fontWeight: '700'
  },
  selectorSubValue: {
    fontSize: 11,
    marginTop: 1
  },
  selectorHalf: {
    flex: 1
  },
  endpointCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  endpointTitle: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4
  },
  endpointText: {
    fontSize: 12,
    fontWeight: '700'
  },
  endpointArrow: {
    fontSize: 14,
    fontWeight: '800',
    marginVertical: 2
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  lineItemCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8
  },
  transferEmptyCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 4
  },
  transferEmptyTitle: {
    fontSize: 13,
    fontWeight: '700'
  },
  transferEmptyCopy: {
    fontSize: 12,
    lineHeight: 18
  },
  lineItemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  lineItemLabel: {
    fontSize: 11,
    fontWeight: '700'
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  helper: {
    fontSize: 12,
    marginTop: -2
  },
  qtyValueBox: {
    width: 74,
    borderRadius: 10,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  qtyValueText: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center'
  },
  qtyWrap: {
    alignItems: 'flex-end',
    gap: 4
  },
  qtyStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center'
  },
  qtyBtnText: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 20
  },
  qtyLabel: {
    fontSize: 11,
    fontWeight: '700'
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
    paddingTop: 12,
    justifyContent: 'flex-end'
  },
  modalCard: {
    borderWidth: 1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    width: '100%',
    minHeight: '72%',
    maxHeight: '90%',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10
  },
  itemSelectModalCard: {
    borderWidth: 1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    width: '100%',
    maxHeight: '92%',
    minHeight: '80%',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800'
  },
  modalSearch: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14
  },
  itemCategoryWrap: {
    height: 42
  },
  itemCategoryRow: {
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingRight: 8
  },
  itemCategoryChip: {
    height: 30,
    maxWidth: 180,
    borderRadius: 999,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center'
  },
  itemCategoryChipText: {
    maxWidth: 158,
    fontSize: 11,
    fontWeight: '700'
  },
  modalList: {
    flex: 1
  },
  itemSelectList: {
    flex: 1
  },
  itemSelectListContent: {
    gap: 10,
    paddingBottom: 8
  },
  modalRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 1
  },
  itemSelectCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    overflow: 'hidden'
  },
  itemSelectCardDisabled: {
    opacity: 0.72
  },
  itemSelectCardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10
  },
  itemSelectCardTitleWrap: {
    flex: 1,
    gap: 2
  },
  itemSelectCardTitle: {
    fontSize: 15,
    fontWeight: '800'
  },
  itemSelectCardSub: {
    fontSize: 12
  },
  itemSelectPricePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  itemSelectPriceText: {
    fontSize: 11,
    fontWeight: '800'
  },
  noStockBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#B91C1C',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 3
  },
  noStockBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900'
  },
  noStockWatermark: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -58 }, { translateY: -10 }, { rotate: '-20deg' }],
    fontSize: 20,
    fontWeight: '900',
    color: 'rgba(185, 28, 28, 0.22)',
    zIndex: 1
  },
  itemAvailableText: {
    fontSize: 11,
    fontWeight: '700'
  },
  modalRowTitle: {
    fontSize: 13,
    fontWeight: '700'
  },
  modalRowSub: {
    fontSize: 11
  },
  modalEmpty: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12
  },
  modalClose: {
    minHeight: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalCloseText: {
    fontSize: 13,
    fontWeight: '700'
  },
  primaryBtn: {
    minHeight: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center'
  },
  primaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14
  },
  block: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 3
  },
  summaryText: {
    fontSize: 12,
    fontWeight: '600'
  },
  summaryHint: {
    fontSize: 11,
    marginTop: 3
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '700'
  },
  smallBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  removeBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7
  },
  smallBtnText: {
    fontSize: 12,
    fontWeight: '700'
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  transferCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  itemId: {
    fontSize: 12,
    fontWeight: '700'
  },
  itemMeta: {
    fontSize: 11
  },
  tutorialTargetFocus: {
    borderWidth: 2,
    borderColor: '#F59E0B',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6
  }
});


