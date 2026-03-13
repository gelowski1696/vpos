import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import { toastError, toastSuccess } from '../goey-toast';
import type { AppTheme } from '../theme';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { SwipeToDeleteRow } from '../components/SwipeToDeleteRow';
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
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={props.onClose} />
        <View style={[styles.modalCard, { backgroundColor: props.theme.card, borderColor: props.theme.cardBorder }]}>
          <Text style={[styles.modalTitle, { color: props.theme.heading }]}>{props.title}</Text>
          <TextInput
            value={props.search}
            onChangeText={props.onSearch}
            placeholder="Search..."
            placeholderTextColor={props.theme.inputPlaceholder}
            style={[styles.modalSearch, { backgroundColor: props.theme.inputBg, color: props.theme.inputText }]}
          />
          <ScrollView style={styles.modalList} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
            {filtered.length === 0 ? (
              <Text style={[styles.modalEmpty, { color: props.theme.subtext }]}>No records found.</Text>
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
                    style={[
                      styles.modalRow,
                      {
                        borderColor: props.theme.cardBorder,
                        backgroundColor: active ? props.theme.pillBg : 'transparent'
                      }
                    ]}
                  >
                    <Text style={[styles.modalRowTitle, { color: props.theme.heading }]}>{option.label}</Text>
                    {option.subtitle ? (
                      <Text style={[styles.modalRowSub, { color: props.theme.subtext }]}>{option.subtitle}</Text>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
          <Pressable onPress={props.onClose} style={[styles.modalClose, { backgroundColor: props.theme.pillBg }]}>
            <Text style={[styles.modalCloseText, { color: props.theme.pillText }]}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function TransfersScreen({ db, theme, onDataChanged, syncBusy = false }: Props): JSX.Element {
  const tutorialSource = useTutorialTarget('transfer-source');
  const tutorialProduct = useTutorialTarget('transfer-product');
  const tutorialQueue = useTutorialTarget('transfer-queue');
  const [transferMode, setTransferMode] = useState<TransferMode>('SUPPLIER_RESTOCK_IN');
  const [supplierId, setSupplierId] = useState('');
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [fullLines, setFullLines] = useState<LineInput[]>([{ key: 'full-1', productId: '', qty: '' }]);
  const [emptyLines, setEmptyLines] = useState<LineInput[]>([{ key: 'empty-1', productId: '', qty: '' }]);
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
  const selectedSupplierLocationId = selectedSupplier?.locationId ?? null;
  const selectedMode = useMemo(
    () => TRANSFER_MODE_OPTIONS.find((option) => option.value === transferMode) ?? null,
    [transferMode]
  );

  const storeLocations = useMemo(
    () => locations.filter((location) => (location.type ?? '').toUpperCase() === 'BRANCH_STORE'),
    [locations]
  );
  const warehouseLocations = useMemo(
    () => locations.filter((location) => (location.type ?? '').toUpperCase() === 'BRANCH_WAREHOUSE'),
    [locations]
  );

  const selectableSourceLocations = useMemo(() => {
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
    if (transferMode === 'SUPPLIER_RESTOCK_IN') {
      if (
        !selectableDestinationLocations.some((location) => location.id === destinationLocationId)
      ) {
        setDestinationLocationId(selectableDestinationLocations[0]?.id ?? '');
      }
      return;
    }
    if (transferMode === 'SUPPLIER_RESTOCK_OUT') {
      if (!selectableSourceLocations.some((location) => location.id === sourceLocationId)) {
        setSourceLocationId(selectableSourceLocations[0]?.id ?? '');
      }
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

  const transferStats = useMemo(() => {
    const pending = rows.filter((row) => row.sync_status === 'pending').length;
    const synced = rows.filter((row) => row.sync_status === 'synced').length;
    const needsReview = rows.filter((row) => row.sync_status === 'needs_review').length;
    return { pending, synced, needsReview };
  }, [rows]);

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
    setFullLines([{ key: createLineKey('full'), productId: '', qty: '' }]);
    setEmptyLines([{ key: createLineKey('empty'), productId: '', qty: '' }]);
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
      setFullLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
      return;
    }
    setEmptyLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
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

  const requiresSourceStockCheck = (mode: TransferMode): boolean => mode !== 'SUPPLIER_RESTOCK_IN';

  const activeSourceLocationId = useMemo(() => {
    if (!requiresSourceStockCheck(transferMode)) {
      return null;
    }
    const id = sourceLocationId.trim();
    return id.length ? id : null;
  }, [sourceLocationId, transferMode]);

  const buildInventoryByProductForLocation = async (
    locationId: string
  ): Promise<Map<string, { qtyOnHand: number; qtyFull: number; qtyEmpty: number }>> => {
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
    return inventoryByProduct;
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
  }, [activeSourceLocationId, syncBusy]);

  const resolveAvailableQtyForBucket = (productId: string, bucket: 'full' | 'empty'): number => {
    const stock = sourceInventoryByProduct.get(productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
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

  const handleLineQtyChange = (bucket: 'full' | 'empty', key: string, value: string): void => {
    const lines = bucket === 'full' ? fullLines : emptyLines;
    const line = lines.find((entry) => entry.key === key);
    if (!line) {
      return;
    }
    const normalized = value.trim();
    if (normalized.length === 0) {
      updateLine(bucket, key, { qty: '' });
      return;
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) {
      updateLine(bucket, key, { qty: value });
      return;
    }
    if (line.productId && requiresSourceStockCheck(transferMode)) {
      const allowed = resolveRemainingQtyForLine(bucket, key, line.productId);
      if (parsed > allowed + 0.0001) {
        const productLabel = productById.get(line.productId)?.label ?? 'Item';
        toastError('Transfer qty', `${productLabel}: max ${allowed.toFixed(2)} for ${bucket.toUpperCase()} at source.`);
        return;
      }
    }
    updateLine(bucket, key, { qty: value });
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

      // For non-cylinder products, FULL/EMPTY buckets may be zero in local snapshot;
      // use qty_on_hand as fallback validation for total movement.
      if (stock.qtyFull <= 0.0001 && stock.qtyEmpty <= 0.0001) {
        const requiredTotal = Number((requiredFull + requiredEmpty).toFixed(4));
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
    const supplierName = selectedSupplier?.label ?? null;
    if (transferMode === 'SUPPLIER_RESTOCK_IN') {
      if (!selectedSupplierLocationId) {
        toastError('Transfer', 'Selected supplier is not linked to any location.');
        return null;
      }
      if (!destinationLocationId) {
        toastError('Transfer', 'Please select destination location.');
        return null;
      }
      return {
        sourceId: selectedSupplierLocationId,
        destinationId: destinationLocationId,
        sourceLabel: supplierName ? `${supplierName} (Supplier)` : selectedSupplierLocationId,
        destinationLabel: locationById.get(destinationLocationId)?.label ?? destinationLocationId,
        supplierName
      };
    }
    if (transferMode === 'SUPPLIER_RESTOCK_OUT') {
      if (!selectedSupplierLocationId) {
        toastError('Transfer', 'Selected supplier is not linked to any location.');
        return null;
      }
      if (!sourceLocationId) {
        toastError('Transfer', 'Please select source location.');
        return null;
      }
      return {
        sourceId: sourceLocationId,
        destinationId: selectedSupplierLocationId,
        sourceLabel: locationById.get(sourceLocationId)?.label ?? sourceLocationId,
        destinationLabel: supplierName ? `${supplierName} (Supplier)` : selectedSupplierLocationId,
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
    const endpoints = resolveEndpoints();
    if (!endpoints) {
      return;
    }
    if (endpoints.sourceId === endpoints.destinationId) {
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
  const endpointSourceLabel =
    transferMode === 'SUPPLIER_RESTOCK_IN'
      ? selectedSupplier
        ? `${selectedSupplier.label} (Supplier)`
        : 'Select supplier'
      : locationById.get(sourceLocationId)?.label ?? 'Select source';
  const endpointDestinationLabel =
    transferMode === 'SUPPLIER_RESTOCK_OUT'
      ? selectedSupplier
        ? `${selectedSupplier.label} (Supplier)`
        : 'Select supplier'
      : locationById.get(destinationLocationId)?.label ?? 'Select destination';

  const renderLineTable = (bucket: 'full' | 'empty', lines: LineInput[]): JSX.Element => (
    <View style={[styles.block, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
      <View style={styles.blockHeader}>
        <Text style={[styles.blockTitle, { color: theme.heading }]}>
          {bucket === 'full' ? 'FULL Items' : 'EMPTY Items'}
        </Text>
        <Pressable
          style={[styles.smallBtn, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}
          onPress={() => appendLine(bucket)}
          disabled={saving || syncBusy}
        >
          <Text style={[styles.smallBtnText, { color: theme.heading }]}>+ Add</Text>
        </Pressable>
      </View>
      {lines.map((line, index) => (
        <SwipeToDeleteRow
          key={line.key}
          theme={theme}
          onDelete={() => removeLine(bucket, line.key)}
          disabled={saving || syncBusy || lines.length <= 1}
          deleteLabel="Remove"
        >
          <View style={[styles.lineItemCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
            <View style={styles.lineItemHead}>
              <Text style={[styles.lineItemLabel, { color: theme.subtext }]}>
                {bucket === 'full' ? 'FULL' : 'EMPTY'} Line {index + 1}
              </Text>
            </View>

            <View style={styles.lineRow}>
              <Pressable
                onPress={() => openItemPicker(bucket, line.key)}
                style={[styles.selectorButton, styles.selectorHalf, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                disabled={saving || syncBusy}
              >
                <Text style={[styles.selectorLabel, { color: theme.subtext }]}>Item</Text>
                <Text style={[styles.selectorValue, { color: theme.inputText }]}>
                  {productById.get(line.productId)?.label ?? 'Select item'}
                </Text>
                {(productById.get(line.productId)?.subtitle ?? productById.get(line.productId)?.group) ? (
                  <Text style={[styles.selectorSubValue, { color: theme.subtext }]}>
                    {productById.get(line.productId)?.subtitle ?? productById.get(line.productId)?.group}
                  </Text>
                ) : null}
              </Pressable>
              <View style={styles.qtyWrap}>
                <Text style={[styles.qtyLabel, { color: theme.subtext }]}>Qty</Text>
                <View style={styles.qtyStepper}>
                  <Pressable
                    onPress={() => stepLineQtyChecked(bucket, line.key, -1)}
                    style={[styles.qtyBtn, { backgroundColor: theme.pillBg }]}
                    disabled={saving || syncBusy}
                  >
                    <Text style={[styles.qtyBtnText, { color: theme.pillText }]}>-</Text>
                  </Pressable>
                  <TextInput
                    value={line.qty}
                    onChangeText={(value) => handleLineQtyChange(bucket, line.key, value)}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={theme.inputPlaceholder}
                    style={[
                      styles.qtyInput,
                      { backgroundColor: theme.inputBg, color: theme.inputText, borderColor: theme.cardBorder }
                    ]}
                  />
                  <Pressable
                    onPress={() => stepLineQtyChecked(bucket, line.key, 1)}
                    style={[styles.qtyBtn, { backgroundColor: theme.pillBg }]}
                    disabled={saving || syncBusy}
                  >
                    <Text style={[styles.qtyBtnText, { color: theme.pillText }]}>+</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </SwipeToDeleteRow>
      ))}
    </View>
  );

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.heading }]}>Advanced Transfers</Text>
          <Text style={[styles.sub, { color: theme.subtext }]}>
            Supplier, store, and warehouse stock movements with FULL/EMPTY control.
          </Text>
        </View>
        <Pressable
          style={[styles.refreshBtn, { backgroundColor: saving || syncBusy ? theme.primaryMuted : theme.primary }]}
          onPress={() => {
            void refresh();
            void refreshMasterData();
          }}
          disabled={saving || syncBusy}
        >
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Pending</Text>
          <Text style={[styles.kpiValue, { color: transferStats.pending > 0 ? theme.danger : theme.heading }]}>
            {transferStats.pending}
          </Text>
        </View>
        <View style={[styles.kpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Needs Review</Text>
          <Text style={[styles.kpiValue, { color: transferStats.needsReview > 0 ? theme.danger : theme.heading }]}>
            {transferStats.needsReview}
          </Text>
        </View>
        <View style={[styles.kpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Synced</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>{transferStats.synced}</Text>
        </View>
      </View>

      <ScrollView style={{ maxHeight: 620 }} contentContainerStyle={{ gap: 10 }} nestedScrollEnabled>
        <View ref={tutorialSource.ref} onLayout={tutorialSource.onLayout}>
          <Pressable
            onPress={() => {
              if (saving || syncBusy) {
                return;
              }
              setTransferTypeSearch('');
              setTransferTypeModalOpen(true);
            }}
            style={[styles.selectorButton, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
            disabled={saving || syncBusy}
          >
            <Text style={[styles.selectorLabel, { color: theme.subtext }]}>Transfer Type</Text>
            <Text style={[styles.selectorValue, { color: theme.inputText }]}>
              {selectedMode?.label ?? 'Select transfer type'}
            </Text>
          </Pressable>
          <Text style={[styles.helper, { color: theme.subtext }]}>{modeSubtitle}</Text>
        </View>

        {transferMode === 'SUPPLIER_RESTOCK_IN' || transferMode === 'SUPPLIER_RESTOCK_OUT' ? (
          <Pressable
            onPress={() => {
              if (saving || syncBusy) {
                return;
              }
              setSupplierSearch('');
              setSupplierModalOpen(true);
            }}
            style={[styles.selectorButton, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
            disabled={saving || syncBusy}
          >
            <Text style={[styles.selectorLabel, { color: theme.subtext }]}>Supplier</Text>
            <Text style={[styles.selectorValue, { color: theme.inputText }]}>
              {selectedSupplier?.label ?? 'Select supplier'}
            </Text>
          </Pressable>
        ) : null}

        {transferMode !== 'SUPPLIER_RESTOCK_IN' ? (
          <Pressable
            onPress={() => {
              if (saving || syncBusy) {
                return;
              }
              setSourceSearch('');
              setSourceModalOpen(true);
            }}
            style={[styles.selectorButton, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
            disabled={saving || syncBusy}
          >
            <Text style={[styles.selectorLabel, { color: theme.subtext }]}>Source Location</Text>
            <Text style={[styles.selectorValue, { color: theme.inputText }]}>
              {selectedSourceLocation?.label ?? 'Select source'}
            </Text>
          </Pressable>
        ) : null}

        {transferMode !== 'SUPPLIER_RESTOCK_OUT' ? (
          <Pressable
            onPress={() => {
              if (saving || syncBusy) {
                return;
              }
              setDestinationSearch('');
              setDestinationModalOpen(true);
            }}
            style={[styles.selectorButton, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
            disabled={saving || syncBusy}
          >
            <Text style={[styles.selectorLabel, { color: theme.subtext }]}>Destination Location</Text>
            <Text style={[styles.selectorValue, { color: theme.inputText }]}>
              {selectedDestinationLocation?.label ?? 'Select destination'}
            </Text>
          </Pressable>
        ) : null}

        <View style={[styles.endpointCard, { borderColor: theme.cardBorder, backgroundColor: theme.pillBg }]}>
          <Text style={[styles.endpointTitle, { color: theme.pillText }]}>Transfer Route</Text>
          <Text style={[styles.endpointText, { color: theme.pillText }]}>{endpointSourceLabel}</Text>
          <Text style={[styles.endpointArrow, { color: theme.pillText }]}>→</Text>
          <Text style={[styles.endpointText, { color: theme.pillText }]}>{endpointDestinationLabel}</Text>
        </View>

        <View ref={tutorialProduct.ref} onLayout={tutorialProduct.onLayout}>
          {renderLineTable('full', fullLines)}
          {renderLineTable('empty', emptyLines)}
        </View>

        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryText, { color: theme.subtext }]}>
            Active Shift: {activeShiftId ?? 'No active shift'}
          </Text>
          <Text style={[styles.summaryText, { color: theme.subtext }]}>Line Items: {fullLines.length + emptyLines.length}</Text>
          <Text style={[styles.summaryText, { color: theme.subtext }]}>FULL Qty Total: {totalFullQty.toFixed(2)}</Text>
          <Text style={[styles.summaryText, { color: theme.subtext }]}>EMPTY Qty Total: {totalEmptyQty.toFixed(2)}</Text>
          <Text style={[styles.summaryHint, { color: theme.subtext }]}>
            FULL and EMPTY quantities are posted separately for server-authoritative stock.
          </Text>
        </View>

        <View ref={tutorialQueue.ref} onLayout={tutorialQueue.onLayout}>
          <Pressable
            style={[
              styles.primaryBtn,
              {
                backgroundColor:
                  saving || !activeShiftId ? theme.primaryMuted : theme.primary
              },
              tutorialQueue.active ? styles.tutorialTargetFocus : null
            ]}
            onPress={() => void createTransfer()}
            disabled={saving || syncBusy || !activeShiftId}
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
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => {
              setItemModalOpen(false);
              setItemPickerTarget(null);
            }}
          />
          <View style={[styles.itemSelectModalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[styles.modalTitle, { color: theme.heading }]}>Select Item</Text>
            <TextInput
              value={itemSearch}
              onChangeText={setItemSearch}
              placeholder="Search item code or name"
              placeholderTextColor={theme.inputPlaceholder}
              style={[styles.modalSearch, { backgroundColor: theme.inputBg, color: theme.inputText }]}
            />
            <View style={styles.itemCategoryWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.itemCategoryRow}>
                <Pressable
                  onPress={() => setItemCategoryFilter('ALL')}
                  style={[styles.itemCategoryChip, { backgroundColor: itemCategoryFilter === 'ALL' ? theme.primary : theme.pillBg }]}
                >
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.itemCategoryChipText, { color: itemCategoryFilter === 'ALL' ? '#FFFFFF' : theme.pillText }]}
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
                      style={[styles.itemCategoryChip, { backgroundColor: selected ? theme.primary : theme.pillBg }]}
                    >
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={[styles.itemCategoryChipText, { color: selected ? '#FFFFFF' : theme.pillText }]}
                      >
                        {category}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <ScrollView style={styles.itemSelectList} contentContainerStyle={styles.itemSelectListContent} keyboardShouldPersistTaps="handled">
              {requiresSourceStockCheck(transferMode) && !activeSourceLocationId ? (
                <Text style={[styles.modalEmpty, { color: theme.subtext }]}>Select source location first to enable item selection.</Text>
              ) : null}
              {filteredProducts.length === 0 ? (
                <Text style={[styles.modalEmpty, { color: theme.subtext }]}>No matching items.</Text>
              ) : (
                filteredProducts.map((product) => {
                  const bucket = itemPickerTarget?.bucket ?? 'full';
                  const disabled = isProductDisabledForPicker(product.id, bucket);
                  const availableQty =
                    requiresSourceStockCheck(transferMode) && activeSourceLocationId
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
                      style={[
                        styles.itemSelectCard,
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
                      <View style={styles.itemSelectCardHead}>
                        <View style={styles.itemSelectCardTitleWrap}>
                          <Text style={[styles.itemSelectCardTitle, { color: theme.heading }]}>{product.label}</Text>
                          <Text style={[styles.itemSelectCardSub, { color: theme.subtext }]}>{product.subtitle ?? product.id}</Text>
                        </View>
                        <View style={[styles.itemSelectPricePill, { backgroundColor: theme.pillBg }]}>
                          <Text style={[styles.itemSelectPriceText, { color: theme.pillText }]}>{product.group ?? 'General'}</Text>
                        </View>
                      </View>
                      {availableQty !== null ? (
                        <Text style={[styles.itemAvailableText, { color: theme.subtext }]}>
                          Available {bucket.toUpperCase()}: {availableQty.toFixed(2)}
                        </Text>
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
              style={[styles.modalClose, { backgroundColor: theme.pillBg }]}
            >
              <Text style={[styles.modalCloseText, { color: theme.pillText }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <View style={[styles.block, { borderColor: theme.cardBorder }]}>
        <Text style={[styles.blockTitle, { color: theme.heading }]}>Recent Local Transfers</Text>
        {rows.length === 0 ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>No local transfers yet.</Text>
        ) : (
          rows.slice(0, 8).map((row) => {
            const payload = parsePayload(row.payload);
            const transferLines = Array.isArray(payload.lines) ? payload.lines : [];
            const totalFull = transferLines.reduce((sum, line) => sum + Number(line.qty_full ?? line.qtyFull ?? 0), 0);
            const totalEmpty = transferLines.reduce((sum, line) => sum + Number(line.qty_empty ?? line.qtyEmpty ?? 0), 0);
            return (
              <View key={row.id} style={[styles.transferCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemId, { color: theme.heading }]}>{row.id}</Text>
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                    {(payload.transfer_mode ?? 'GENERAL').replace(/_/g, ' ')}
                    {' • '}
                    {payload.source_location_label ?? payload.source_location_id ?? '-'}
                    {' → '}
                    {payload.destination_location_label ?? payload.destination_location_id ?? '-'}
                  </Text>
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                    FULL {Number.isFinite(totalFull) ? totalFull.toFixed(2) : '0.00'} • EMPTY {Number.isFinite(totalEmpty) ? totalEmpty.toFixed(2) : '0.00'}
                  </Text>
                </View>
                <SyncStatusBadge status={row.sync_status} />
              </View>
            );
          })
        )}
      </View>
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
  qtyInput: {
    width: 74,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
    borderWidth: 1,
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
    backgroundColor: 'rgba(10, 16, 28, 0.56)',
    paddingHorizontal: 16,
    paddingVertical: 24,
    justifyContent: 'center'
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 16,
    width: '100%',
    minHeight: '80%',
    maxHeight: '92%',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10
  },
  itemSelectModalCard: {
    borderWidth: 1,
    borderRadius: 18,
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
