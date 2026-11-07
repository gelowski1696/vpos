import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { desktopDb } from '../db/sqlite';
import type { DesktopAppState, DesktopCatalogProduct, DesktopOption, DesktopTransferLine, DesktopTransferMode } from '../db/schema';
import { SearchField } from '../components/inputs/SearchField';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopStockProjectionService } from '../services/desktop-stock-projection.service';
import { desktopShiftService } from '../services/desktop-shift.service';
import { desktopTransferService } from '../services/desktop-transfer.service';
import {
  canSelectTransferProduct,
  transferBucketConsumesStock,
  type TransferModeSelection
} from './transfer-stock-policy';

type Props = {
  appState: DesktopAppState;
  onOutboxChanged?: () => Promise<void> | void;
};

type LocationOption = {
  id: string;
  label: string;
  branchId?: string | null;
  type?: string | null;
};

type TransferDraftLine = {
  key: string;
  productId: string;
  qtyFull: string;
  qtyEmpty: string;
};

type InventorySnapshot = {
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
};

type TransferSuccessModalState = {
  transferId: string;
  lineCount: number;
  totalFull: number;
  totalEmpty: number;
  routeLabel: string;
};

type TransferModeOption = {
  value: DesktopTransferMode;
  label: string;
  subtitle: string;
};

const TRANSFER_MODES: TransferModeOption[] = [
  {
    value: 'SUPPLIER_RESTOCK_IN',
    label: 'Supplier Restock In',
    subtitle: 'Supplier -> Store/Warehouse'
  },
  {
    value: 'SUPPLIER_RESTOCK_OUT',
    label: 'Supplier Restock Out',
    subtitle: 'Store/Warehouse -> Supplier'
  },
  {
    value: 'CREATE',
    label: 'Create',
    subtitle: 'Empty -> Full (branch adjustment)'
  },
  {
    value: 'USED',
    label: 'Used',
    subtitle: 'Full -> Empty (branch adjustment)'
  },
  {
    value: 'CONVERT',
    label: 'Convert',
    subtitle: 'Empty -> Empty (branch adjustment)'
  },
  {
    value: 'INTER_STORE_TRANSFER',
    label: 'Inter-Store Transfer',
    subtitle: 'Store -> Store'
  },
  {
    value: 'STORE_TO_WAREHOUSE',
    label: 'Warehouse Restock Out',
    subtitle: 'Store -> Warehouse'
  },
  {
    value: 'WAREHOUSE_TO_STORE',
    label: 'Warehouse Restock In',
    subtitle: 'Warehouse -> Store'
  },
  {
    value: 'GENERAL',
    label: 'General Transfer',
    subtitle: 'Any location pair'
  }
];

const screenStackClass = 'flex flex-col gap-5';
const summaryStripClass = 'desktop-summary-strip grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const summaryTileClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const summaryLabelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[1rem] font-extrabold text-[var(--text-strong)]';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const transferSetupGridClass = 'transfer-builder-grid';
const transferSetupCardClass =
  'desktop-workspace-section transfer-stage-card';
const transferContextGridClass = 'grid gap-3';
const transferContextRowClass =
  'grid gap-1 rounded-[18px] border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.94)] px-4 py-3';
const transferActionRowClass = 'flex flex-col gap-3 border-t border-[var(--border-soft)] pt-4 md:flex-row md:items-center md:justify-between';
const transferModalBackdropClass = 'desktop-modal-backdrop';
const transferModalCardClass =
  'desktop-modal-card desktop-modal-card--picker';
const transferModalToolbarClass =
  'desktop-modal-header flex shrink-0 flex-col gap-4';
const transferLinesSectionClass =
  'desktop-workspace-section transfer-lines-section';

type TransferIconKind =
  | 'shift'
  | 'type'
  | 'lines'
  | 'full'
  | 'empty'
  | 'source'
  | 'destination'
  | 'supplier'
  | 'notes'
  | 'stock'
  | 'add'
  | 'remove'
  | 'save';

function TransferIcon({ path, className = '' }: { path: ReactNode; className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-[20px] w-[20px] ${className}`.trim()}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

function TransferSymbol({ kind, className = '' }: { kind: TransferIconKind; className?: string }): JSX.Element {
  let path: ReactNode;
  if (kind === 'shift') {
    path = (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="m9.2 12 1.8 1.9 3.8-4.4" />
      </>
    );
  } else if (kind === 'type') {
    path = (
      <>
        <path d="M7 6.5h10" />
        <path d="M7 17.5h10" />
        <path d="m13 9.2 3 2.8-3 2.8" />
        <path d="M11 14.8 8 12l3-2.8" />
      </>
    );
  } else if (kind === 'lines') {
    path = (
      <>
        <rect x="5" y="5.5" width="14" height="13" rx="2.5" />
        <path d="M8.5 9.5h7" />
        <path d="M8.5 12.5h7" />
        <path d="M8.5 15.5h4.5" />
      </>
    );
  } else if (kind === 'full') {
    path = (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="m8.5 12 2.2 2.2L15.5 9.5" />
      </>
    );
  } else if (kind === 'empty') {
    path = (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="M8.5 12h7" />
      </>
    );
  } else if (kind === 'source') {
    path = (
      <>
        <path d="M5 12h11" />
        <path d="m12 8 4 4-4 4" />
        <path d="M5 5.5h14" />
        <path d="M5 18.5h14" />
      </>
    );
  } else if (kind === 'destination') {
    path = (
      <>
        <path d="M19 12H8" />
        <path d="m12 8-4 4 4 4" />
        <path d="M5 5.5h14" />
        <path d="M5 18.5h14" />
      </>
    );
  } else if (kind === 'supplier') {
    path = (
      <>
        <path d="M4.5 17.5V8.2L12 4.5l7.5 3.7v9.3" />
        <path d="M8 11h8" />
        <path d="M8 14h8" />
        <path d="M7 17.5h10" />
      </>
    );
  } else if (kind === 'notes') {
    path = (
      <>
        <path d="M6.5 5.5h8.8L18 8.2v10.3h-11.5z" />
        <path d="M14.5 5.5v3h3" />
        <path d="M9 12h6" />
        <path d="M9 15h4" />
      </>
    );
  } else if (kind === 'stock') {
    path = (
      <>
        <path d="M5 7.5h14" />
        <path d="M7 7.5V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v12H7z" />
        <path d="M10 11h4" />
      </>
    );
  } else if (kind === 'add') {
    path = (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    );
  } else if (kind === 'remove') {
    path = (
      <>
        <path d="M9 6h6" />
        <path d="M5.5 8h13" />
        <path d="M8 8v9a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 17V8" />
        <path d="M10 11v4" />
        <path d="M14 11v4" />
      </>
    );
  } else {
    path = (
      <>
        <path d="M5 12.5 9.2 17 19 7" />
      </>
    );
  }
  return <TransferIcon path={path} className={className} />;
}

function parseLocationOption(payload: string): LocationOption | null {
  try {
    const row = JSON.parse(payload) as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : null;
    const label =
      (typeof row.name === 'string' && row.name.trim()) ||
      (typeof row.label === 'string' && row.label.trim()) ||
      null;
    if (!id || !label) {
      return null;
    }
    return {
      id,
      label,
      branchId: typeof row.branchId === 'string' ? row.branchId : typeof row.branch_id === 'string' ? row.branch_id : null,
      type: typeof row.type === 'string' ? row.type : null
    };
  } catch {
    return null;
  }
}

function fmtTransferMode(value: DesktopTransferMode): string {
  return value.replace(/_/g, ' ');
}

function makeLineKey(): string {
  return `line-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function fmtQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function parseDraftQty(value: string): number {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function normalizeDraftQtyInput(value: string): string {
  const sanitized = value.replace(/[^0-9]/g, '');
  if (!sanitized) {
    return '';
  }
  const parsed = Number.parseInt(sanitized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '';
  }
  return String(parsed);
}

function isSupplierRestockMode(mode: TransferModeSelection): boolean {
  return mode === 'SUPPLIER_RESTOCK_IN' || mode === 'SUPPLIER_RESTOCK_OUT';
}

function isSingleBucketAdjustmentMode(mode: TransferModeSelection): mode is 'CREATE' | 'USED' | 'CONVERT' {
  return mode === 'CREATE' || mode === 'USED' || mode === 'CONVERT';
}

function getBucketIndicator(mode: TransferModeSelection, bucket: 'full' | 'empty'): string {
  switch (mode) {
    case 'SUPPLIER_RESTOCK_IN':
      return '+';
    case 'SUPPLIER_RESTOCK_OUT':
      return '-';
    case 'CREATE':
      return bucket === 'full' ? '+' : '-';
    case 'USED':
      return bucket === 'full' ? '-' : '+';
    case 'CONVERT':
      return bucket === 'full' ? 'EMPTY (+)' : 'EMPTY (-)';
    case 'STORE_TO_WAREHOUSE':
    case 'WAREHOUSE_TO_STORE':
    case 'INTER_STORE_TRANSFER':
    case 'GENERAL':
      return '- / +';
    default:
      return '';
  }
}

function getBucketLabel(mode: TransferModeSelection, bucket: 'full' | 'empty'): string {
  if (mode === 'CONVERT') {
    return bucket === 'full' ? 'EMPTY (+)' : 'EMPTY (-)';
  }
  const bucketLabel = bucket === 'full' ? 'Full' : 'Empty';
  const indicator = getBucketIndicator(mode, bucket);
  return indicator ? `${bucketLabel} (${indicator})` : bucketLabel;
}

export function TransferScreen({ appState, onOutboxChanged }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const [catalog, setCatalog] = useState<DesktopCatalogProduct[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [suppliers, setSuppliers] = useState<DesktopOption[]>([]);
  const [sourceInventoryByProduct, setSourceInventoryByProduct] = useState<Map<string, InventorySnapshot>>(new Map());
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [mode, setMode] = useState<TransferModeSelection>('');
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<TransferDraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [transferSuccessModal, setTransferSuccessModal] = useState<TransferSuccessModalState | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemPickerLineKey, setItemPickerLineKey] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('ALL');
  const transferModeInitRef = useRef(false);

  const announce = (message: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
    desktopUi.showToast({ message, tone });
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [locationRows, catalogRows, projectedInventory, supplierRows, activeShift] = await Promise.all([
        desktopDb.listMasterData('location'),
        appState.setup.locationId ? desktopMasterDataService.loadCatalog(appState.setup.locationId) : Promise.resolve([]),
        appState.setup.locationId
          ? desktopStockProjectionService.loadProjectedInventoryByProduct(appState.setup.locationId)
          : Promise.resolve(new Map<string, InventorySnapshot>()),
        desktopMasterDataService.loadSuppliers(),
        desktopShiftService.findActiveShift()
      ]);
      const nextLocations = locationRows
        .map((row) => parseLocationOption(row.payload))
        .filter((row): row is LocationOption => Boolean(row));
      setLocations(nextLocations);
      const projectedCatalog = catalogRows.map((product) => {
        const projected = projectedInventory.get(product.id);
        return projected
          ? {
              ...product,
              qtyOnHand: projected.qtyOnHand,
              qtyFull: projected.qtyFull,
              qtyEmpty: projected.qtyEmpty
            }
          : product;
      });
      // Transfers also handle accessories and other regular stock. Filtering to
      // LPG whenever an LPG item existed made every non-LPG item impossible to
      // restock from this screen.
      setCatalog(projectedCatalog);
      setSuppliers(supplierRows);
      setActiveShiftId(activeShift?.id ?? null);
      setSourceId((current) => current);
      setDestinationId((current) => current);
      setSupplierId((current) => current);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [appState.setup.branchId, appState.setup.locationId]);

  useEffect(() => {
    if (saving) {
      desktopUi.setLoading({ visible: true, label: 'Saving transfer...' });
      return;
    }
    if (loading) {
      desktopUi.setLoading({ visible: true, label: 'Loading transfer setup...' });
      return;
    }
    desktopUi.clearLoading();
  }, [desktopUi, loading, saving]);

  const warehouseLocations = useMemo(
    () => locations.filter((location) => (location.type ?? '').toUpperCase().includes('WAREHOUSE')),
    [locations]
  );
  const transferModeOptions = useMemo(
    () =>
      TRANSFER_MODES.filter((option) => {
        if (option.value === 'STORE_TO_WAREHOUSE' || option.value === 'WAREHOUSE_TO_STORE') {
          return warehouseLocations.length > 0;
        }
        return true;
      }),
    [warehouseLocations.length]
  );
  const selectedMode = useMemo(
    () => transferModeOptions.find((option) => option.value === mode) ?? null,
    [mode, transferModeOptions]
  );
  const modeSubtitle = selectedMode?.subtitle ?? '';

  const hasSelectedMode = Boolean(mode);
  const preferredAdjustmentLocationId = appState.setup.locationId.trim() || '';
  const selectedAdjustmentLocation = useMemo(
    () => locations.find((row) => row.id === preferredAdjustmentLocationId) ?? null,
    [locations, preferredAdjustmentLocationId]
  );

  const destinationOptions = useMemo(
    () => {
      if (!mode) {
        return [];
      }
      const stores = locations.filter((location) => (location.type ?? '').toUpperCase().includes('STORE'));
      const warehouses = locations.filter((location) => (location.type ?? '').toUpperCase().includes('WAREHOUSE'));

      switch (mode) {
        case 'SUPPLIER_RESTOCK_IN':
          return [];
        case 'SUPPLIER_RESTOCK_OUT':
          return [];
        case 'CREATE':
        case 'USED':
        case 'CONVERT':
          return [];
        case 'INTER_STORE_TRANSFER':
          return stores.filter((location) => location.id !== sourceId);
        case 'STORE_TO_WAREHOUSE':
          return warehouses;
        case 'WAREHOUSE_TO_STORE':
          return stores;
        default:
          return locations.filter((location) => location.id !== sourceId);
      }
    },
    [locations, mode, sourceId]
  );

  const localSourceLocations = useMemo(
    () => locations.filter((location) => !location.branchId || location.branchId === appState.setup.branchId),
    [appState.setup.branchId, locations]
  );

  const sourceOptions = useMemo(() => {
    if (!mode) {
      return [];
    }
    const stores = localSourceLocations.filter((location) => (location.type ?? '').toUpperCase().includes('STORE'));
    const warehouses = localSourceLocations.filter((location) => (location.type ?? '').toUpperCase().includes('WAREHOUSE'));

    switch (mode) {
      case 'SUPPLIER_RESTOCK_IN':
        return [];
      case 'SUPPLIER_RESTOCK_OUT':
        return [];
      case 'CREATE':
      case 'USED':
      case 'CONVERT':
        return [];
      case 'INTER_STORE_TRANSFER':
        return stores;
      case 'STORE_TO_WAREHOUSE':
        return stores;
      case 'WAREHOUSE_TO_STORE':
        return warehouses;
      default:
        return localSourceLocations;
    }
  }, [localSourceLocations, mode]);

  useEffect(() => {
    if (!sourceOptions.length) {
      if (mode && !isSupplierRestockMode(mode) && !isSingleBucketAdjustmentMode(mode)) {
        setSourceId('');
      }
      return;
    }
    if (!sourceOptions.some((location) => location.id === sourceId)) {
      setSourceId('');
    }
  }, [mode, sourceId, sourceOptions]);

  useEffect(() => {
    if (!destinationOptions.length) {
      setDestinationId('');
      return;
    }
    if (!destinationOptions.some((location) => location.id === destinationId)) {
      setDestinationId('');
    }
  }, [destinationId, destinationOptions]);

  const selectedSupplier = useMemo(
    () => suppliers.find((row) => row.id === supplierId) ?? null,
    [supplierId, suppliers]
  );

  useEffect(() => {
    if (!mode) {
      return;
    }
    const stillAvailable = transferModeOptions.some((option) => option.value === mode);
    if (!stillAvailable) {
      setMode('');
    }
  }, [mode, transferModeOptions]);

  useEffect(() => {
    if (!transferModeInitRef.current) {
      transferModeInitRef.current = true;
      return;
    }
    setItemModalOpen(false);
    setItemPickerLineKey(null);
    setLines([]);
    setSourceId('');
    setDestinationId('');
    setSupplierId('');
    setNotes('');
  }, [mode]);

  const requiresSourceStockCheck = useMemo(
    () => Boolean(mode) && mode !== 'SUPPLIER_RESTOCK_IN',
    [mode]
  );
  const activeSourceLocationId = useMemo(() => {
    if (!mode) {
      return null;
    }
    if (isSupplierRestockMode(mode) || isSingleBucketAdjustmentMode(mode)) {
      return preferredAdjustmentLocationId || null;
    }
    if (!requiresSourceStockCheck) {
      return null;
    }
    const id = sourceId.trim();
    return id || null;
  }, [mode, preferredAdjustmentLocationId, requiresSourceStockCheck, sourceId]);

  const productById = useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog]);
  const itemCategoryOptions = useMemo(() => {
    const categories = new Set<string>();
    for (const product of catalog) {
      const category = product.category.trim();
      if (category) {
        categories.add(category);
      }
    }
    return ['ALL', ...Array.from(categories).sort((left, right) => left.localeCompare(right))];
  }, [catalog]);
  const filteredProducts = useMemo(() => {
    const needle = itemSearch.trim().toLowerCase();
    return catalog.filter((product) => {
      const matchesCategory = itemCategoryFilter === 'ALL' || product.category === itemCategoryFilter;
      if (!matchesCategory) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return (
        product.name.toLowerCase().includes(needle) ||
        product.sku.toLowerCase().includes(needle) ||
        product.category.toLowerCase().includes(needle) ||
        product.unit.toLowerCase().includes(needle) ||
        (product.cylinderSizeLabel ?? '').toLowerCase().includes(needle)
      );
    });
  }, [catalog, itemCategoryFilter, itemSearch]);

  const totalFull = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.qtyFull) || 0), 0), [lines]);
  const totalEmpty = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.qtyEmpty) || 0), 0), [lines]);

  useEffect(() => {
    if (!activeSourceLocationId) {
      setSourceInventoryByProduct(new Map());
      return;
    }

    let cancelled = false;
    void (async () => {
      const next = await desktopStockProjectionService.loadProjectedInventoryByProduct(activeSourceLocationId);
      if (!cancelled) {
        setSourceInventoryByProduct(next);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSourceLocationId]);

  const resolveAvailableQtyForBucket = (productId: string, bucket: 'full' | 'empty'): number => {
    const product = productById.get(productId);
    const stock =
      sourceInventoryByProduct.get(productId) ??
      (() => {
        return {
          qtyOnHand: product?.qtyOnHand ?? 0,
          qtyFull: product?.qtyFull ?? 0,
          qtyEmpty: product?.qtyEmpty ?? 0
        };
      })();
    if (product?.isLpg === false) {
      return bucket === 'full' ? Math.max(0, Number(stock.qtyOnHand || 0)) : 0;
    }
    let available = bucket === 'full' ? stock.qtyFull : stock.qtyEmpty;
    if (available <= 0.0001 && stock.qtyFull <= 0.0001 && stock.qtyEmpty <= 0.0001) {
      available = stock.qtyOnHand;
    }
    return Math.max(0, Number(available || 0));
  };

  const resolveRemainingQtyForLine = (lineKey: string, productId: string, bucket: 'full' | 'empty'): number => {
    if (!requiresSourceStockCheck) {
      return Number.POSITIVE_INFINITY;
    }
    if (!activeSourceLocationId) {
      return 0;
    }
    const available = resolveAvailableQtyForBucket(productId, bucket);
    const usedByOthers = lines.reduce((sum, line) => {
      if (line.key === lineKey || line.productId !== productId) {
        return sum;
      }
      return sum + (bucket === 'full' ? Number(line.qtyFull) || 0 : Number(line.qtyEmpty) || 0);
    }, 0);
    return Math.max(0, Number((available - usedByOthers).toFixed(4)));
  };

  const lineWarnings = useMemo(() => {
    const warnings = new Map<string, { full: string | null; empty: string | null }>();
    for (const line of lines) {
      if (!line.productId || !requiresSourceStockCheck) {
        continue;
      }
      const product = productById.get(line.productId);
      const fullQty = Number(line.qtyFull) || 0;
      const emptyQty = Number(line.qtyEmpty) || 0;
      const availableFull = resolveRemainingQtyForLine(line.key, line.productId, 'full');
      const availableEmpty = resolveRemainingQtyForLine(line.key, line.productId, 'empty');
      warnings.set(line.key, {
        full:
          transferBucketConsumesStock(mode, 'full') && fullQty > availableFull + 0.0001
            ? `${product?.name ?? 'Item'} only has ${availableFull.toFixed(2)} ${product?.isLpg === false ? 'quantity' : 'FULL'} available at source.`
            : null,
        empty:
          transferBucketConsumesStock(mode, 'empty') && emptyQty > availableEmpty + 0.0001
            ? `${product?.name ?? 'Item'} only has ${availableEmpty.toFixed(2)} EMPTY available at source.`
            : null
      });
    }
    return warnings;
  }, [lines, mode, productById, requiresSourceStockCheck, activeSourceLocationId, sourceInventoryByProduct]);

  const hasBlockingStockWarning = useMemo(
    () =>
      Array.from(lineWarnings.values()).some((warning) => Boolean(warning.full || warning.empty)) ||
      (requiresSourceStockCheck && !activeSourceLocationId),
    [activeSourceLocationId, lineWarnings, requiresSourceStockCheck]
  );
  const visibleProducts = useMemo(() => filteredProducts.slice(0, 80), [filteredProducts]);
  const sourceSummaryLabel = mode === 'SUPPLIER_RESTOCK_IN'
    ? selectedSupplier
      ? `${selectedSupplier.label} (Supplier)`
      : 'Choose supplier'
    : mode === 'SUPPLIER_RESTOCK_OUT'
      ? selectedAdjustmentLocation?.label || 'Current branch location'
    : isSingleBucketAdjustmentMode(mode)
      ? selectedAdjustmentLocation?.label || 'Current branch location'
      : sourceOptions.find((row) => row.id === sourceId)?.label || 'Choose source';
  const destinationSummaryLabel = mode === 'SUPPLIER_RESTOCK_OUT'
    ? selectedSupplier
      ? `${selectedSupplier.label} (Supplier)`
      : 'Choose supplier'
    : isSingleBucketAdjustmentMode(mode)
      ? selectedAdjustmentLocation?.label || 'Current branch location'
      : mode === 'SUPPLIER_RESTOCK_IN'
        ? selectedAdjustmentLocation?.label || 'Current branch location'
        : destinationOptions.find((row) => row.id === destinationId)?.label || 'Choose destination';
  const hasDraftToClear = lines.length > 0 || Boolean(notes.trim());
  const hasValidTransferLine = lines.some(
    (line) => Boolean(line.productId) && ((Number(line.qtyFull) || 0) > 0 || (Number(line.qtyEmpty) || 0) > 0)
  );
  const firstBlockingStockWarning = Array.from(lineWarnings.values()).find((warning) => warning.full || warning.empty);
  const transferStatusMessage = !activeShiftId
    ? 'Open Shift first before saving a transfer.'
    : !hasSelectedMode
      ? 'Choose a transfer type to unlock item selection.'
      : requiresSourceStockCheck && !activeSourceLocationId
        ? 'Choose a source location so available stock can be checked.'
        : lines.length === 0
          ? 'Add items from the list to build this transfer.'
          : !hasValidTransferLine
            ? 'Select at least one item and enter a transfer quantity.'
          : firstBlockingStockWarning?.full || firstBlockingStockWarning?.empty
            ? firstBlockingStockWarning.full ?? firstBlockingStockWarning.empty ?? 'Transfer quantities exceed source stock.'
            : 'Transfer is ready to save locally and sync later.';
  const canSaveTransfer = !saving && Boolean(activeShiftId) && hasSelectedMode && hasValidTransferLine && !hasBlockingStockWarning;
  const canAttemptSaveTransfer = !saving && hasSelectedMode && hasValidTransferLine && !hasBlockingStockWarning;

  const openSaveConfirmation = (): void => {
    if (!activeShiftId) {
      announce('Start Duty in Shift before saving a transfer.', 'warning');
      return;
    }
    if (canSaveTransfer) {
      setSaveConfirmOpen(true);
    }
  };

  const addLine = (): void => {
    if (!hasSelectedMode) {
      announce('Choose a transfer type first so desktop knows which stock rules to apply.', 'warning');
      return;
    }
    setLines((current) => [...current, { key: makeLineKey(), productId: '', qtyFull: '', qtyEmpty: '' }]);
  };

  const addProductToDraft = (product: DesktopCatalogProduct): void => {
    if (!hasSelectedMode) {
      announce('Choose a transfer type first so desktop knows which stock rules to apply.', 'warning');
      return;
    }
    if (requiresSourceStockCheck && !activeSourceLocationId) {
      announce('Choose a source location first so desktop can check available stock.', 'warning');
      return;
    }
    const availableFull = resolveAvailableQtyForBucket(product.id, 'full');
    const availableEmpty = resolveAvailableQtyForBucket(product.id, 'empty');
    if (!canSelectTransferProduct(mode, requiresSourceStockCheck, availableFull, availableEmpty)) {
      announce(`${product.name} has no available stock at the selected source.`, 'warning');
      return;
    }
    setLines((current) => [...current, { key: makeLineKey(), productId: product.id, qtyFull: '', qtyEmpty: '' }]);
    announce(`${product.name} was added to this transfer.`, 'success');
  };

  const openItemPicker = (lineKey: string): void => {
    if (!hasSelectedMode) {
      announce('Choose a transfer type first so desktop knows which stock rules to apply.', 'warning');
      return;
    }
    setItemPickerLineKey(lineKey);
    setItemSearch('');
    setItemCategoryFilter('ALL');
    setItemModalOpen(true);
  };

  const closeItemPicker = (): void => {
    setItemModalOpen(false);
    setItemPickerLineKey(null);
  };

  const selectItemFromModal = (productId: string): void => {
    if (!itemPickerLineKey) {
      return;
    }
    const product = productById.get(productId);
    updateLine(itemPickerLineKey, {
      productId,
      ...(product?.isLpg === false ? { qtyEmpty: '' } : {})
    });
    closeItemPicker();
  };

  const updateLine = (key: string, patch: Partial<TransferDraftLine>): void => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const stepLineQty = (key: string, bucket: 'qtyFull' | 'qtyEmpty', delta: number): void => {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) {
          return line;
        }
        const stockBucket = bucket === 'qtyFull' ? 'full' : 'empty';
        if (delta > 0 && line.productId && requiresSourceStockCheck && transferBucketConsumesStock(mode, stockBucket)) {
          const allowed = resolveRemainingQtyForLine(line.key, line.productId, stockBucket);
          const nextValue = parseDraftQty(line[bucket]) + delta;
          if (nextValue > allowed + 0.0001) {
            return line;
          }
        }
        const nextValue = Math.max(0, parseDraftQty(line[bucket]) + delta);
        return {
          ...line,
          [bucket]: nextValue <= 0 ? '' : String(nextValue)
        };
      })
    );
  };

  const setLineQty = (key: string, bucket: 'qtyFull' | 'qtyEmpty', rawValue: string): void => {
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) {
          return line;
        }
        const normalized = normalizeDraftQtyInput(rawValue);
        const nextValue = parseDraftQty(normalized);
        const stockBucket = bucket === 'qtyFull' ? 'full' : 'empty';
        if (line.productId && requiresSourceStockCheck && transferBucketConsumesStock(mode, stockBucket)) {
          const allowed = resolveRemainingQtyForLine(
            line.key,
            line.productId,
            stockBucket
          );
          if (nextValue > allowed + 0.0001) {
            return {
              ...line,
              [bucket]: allowed <= 0 ? '' : String(Math.max(0, Math.floor(allowed)))
            };
          }
        }
        return {
          ...line,
          [bucket]: nextValue <= 0 ? '' : String(nextValue)
        };
      })
    );
  };

  const removeLine = (key: string): void => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const clearTransferLines = (): void => {
    setLines([]);
    setNotes('');
    announce('Transfer lines were cleared.', 'info');
  };

  const resolveEndpoints = (): {
    sourceLocationId: string;
    sourceLocationLabel: string;
    destinationLocationId: string;
    destinationLocationLabel: string;
    supplierId: string | null;
    supplierName: string | null;
    transferMode: DesktopTransferMode;
  } => {
    if (!mode) {
      throw new Error('Choose a transfer type first.');
    }
    const supplierName = selectedSupplier?.label ?? null;
    if (mode === 'SUPPLIER_RESTOCK_IN') {
      if (!selectedSupplier) {
        throw new Error('Choose a supplier first.');
      }
      if (!preferredAdjustmentLocationId || !selectedAdjustmentLocation) {
        throw new Error('Current branch location is missing. Reopen branch setup.');
      }
      return {
        sourceLocationId: preferredAdjustmentLocationId,
        sourceLocationLabel: `${selectedSupplier.label} (Supplier)`,
        destinationLocationId: preferredAdjustmentLocationId,
        destinationLocationLabel: selectedAdjustmentLocation.label,
        supplierId: selectedSupplier.id,
        supplierName,
        transferMode: mode
      };
    }
    if (mode === 'SUPPLIER_RESTOCK_OUT') {
      if (!selectedSupplier) {
        throw new Error('Choose a supplier first.');
      }
      if (!preferredAdjustmentLocationId || !selectedAdjustmentLocation) {
        throw new Error('Current branch location is missing. Reopen branch setup.');
      }
      return {
        sourceLocationId: preferredAdjustmentLocationId,
        sourceLocationLabel: selectedAdjustmentLocation.label,
        destinationLocationId: preferredAdjustmentLocationId,
        destinationLocationLabel: `${selectedSupplier.label} (Supplier)`,
        supplierId: selectedSupplier.id,
        supplierName,
        transferMode: mode
      };
    }
    if (isSingleBucketAdjustmentMode(mode)) {
      if (!preferredAdjustmentLocationId || !selectedAdjustmentLocation) {
        throw new Error('Current branch location is missing. Reopen branch setup.');
      }
      return {
        sourceLocationId: preferredAdjustmentLocationId,
        sourceLocationLabel: selectedAdjustmentLocation.label,
        destinationLocationId: preferredAdjustmentLocationId,
        destinationLocationLabel: selectedAdjustmentLocation.label,
        supplierId: null,
        supplierName: null,
        transferMode: mode
      };
    }

    const source = sourceOptions.find((row) => row.id === sourceId);
    const destination = destinationOptions.find((row) => row.id === destinationId);
    if (!source) {
      throw new Error('Choose a source first.');
    }
    if (!destination) {
      throw new Error('Choose a destination first.');
    }
    if (source.id === destination.id) {
      throw new Error('Source and destination must be different.');
    }
    return {
      sourceLocationId: source.id,
      sourceLocationLabel: source.label,
      destinationLocationId: destination.id,
      destinationLocationLabel: destination.label,
      supplierId: null,
      supplierName: null,
      transferMode: mode
    };
  };

  const saveTransfer = async (): Promise<void> => {
    setSaving(true);
    try {
      const endpoints = resolveEndpoints();
      const payloadLines: DesktopTransferLine[] = lines
        .map((line) => {
          const product = productById.get(line.productId);
          return {
            productId: line.productId,
            productName: product?.name ?? '',
            qtyFull: Number(line.qtyFull) || 0,
            qtyEmpty: Number(line.qtyEmpty) || 0
          };
        })
        .filter((line) => line.productId && (line.qtyFull > 0 || line.qtyEmpty > 0));

      if (payloadLines.length === 0) {
        throw new Error('Add at least one item line first.');
      }

      if (requiresSourceStockCheck && !activeSourceLocationId) {
        throw new Error('Choose a source location first so stock can be checked.');
      }
      const blockingWarning = Array.from(lineWarnings.values()).find((warning) => warning.full || warning.empty);
      if (blockingWarning?.full || blockingWarning?.empty) {
        throw new Error(blockingWarning.full ?? blockingWarning.empty ?? 'Transfer quantities exceed source stock.');
      }

      const record = await desktopTransferService.createTransfer(appState, {
        sourceLocationId: endpoints.sourceLocationId,
        sourceLocationLabel: endpoints.sourceLocationLabel,
        destinationLocationId: endpoints.destinationLocationId,
        destinationLocationLabel: endpoints.destinationLocationLabel,
        shiftId: activeShiftId ?? '',
        transferMode: endpoints.transferMode,
        supplierId: endpoints.supplierId,
        supplierName: endpoints.supplierName,
        notes: notes.trim() || null,
        lines: payloadLines
      });
      setSaveConfirmOpen(false);
      setTransferSuccessModal({
        transferId: record.id,
        lineCount: payloadLines.length,
        totalFull,
        totalEmpty,
        routeLabel: `${endpoints.sourceLocationLabel} -> ${endpoints.destinationLocationLabel}`
      });
      setLines([]);
      setMode('');
      setSourceId('');
      setDestinationId('');
      setSupplierId('');
      setNotes('');
      announce(`Transfer ${record.id} was saved as a draft. Confirm it from Transfer History to move stock.`, 'success');
      await refresh();
      if (onOutboxChanged) {
        await onOutboxChanged();
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to save this transfer right now.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <TransferSymbol kind="type" className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">
              Transfer
            </h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">
              Build the movement, review stock impact, and save it locally.
            </p>
          </div>
        </div>
      </section>

      <div className="transfer-static-shell">
        <section className="transfer-static-metrics" aria-label="Transfer summary">
          <div className={`transfer-static-metric ${activeShiftId ? 'is-good' : 'is-danger'}`}>
            <span className="transfer-static-metric-icon">
              <TransferSymbol kind="shift" />
            </span>
            <span className="transfer-static-metric-copy">
              <span>Shift</span>
              <strong>{activeShiftId ? 'Open' : 'Required'}</strong>
            </span>
          </div>
          <div className={`transfer-static-metric ${hasSelectedMode ? 'is-accent' : 'is-neutral'}`}>
            <span className="transfer-static-metric-icon">
              <TransferSymbol kind="type" />
            </span>
            <span className="transfer-static-metric-copy">
              <span>Transfer Type</span>
              <strong>{selectedMode?.label ?? 'Choose type'}</strong>
            </span>
          </div>
          <div className={`transfer-static-metric ${lines.length ? 'is-accent' : 'is-neutral'}`}>
            <span className="transfer-static-metric-icon">
              <TransferSymbol kind="lines" />
            </span>
            <span className="transfer-static-metric-copy">
              <span>Lines</span>
              <strong>{lines.length}</strong>
            </span>
          </div>
          <div className={`transfer-static-metric ${totalFull > 0 ? 'is-good' : 'is-neutral'}`}>
            <span className="transfer-static-metric-icon">
              <TransferSymbol kind="full" />
            </span>
            <span className="transfer-static-metric-copy">
              <span>Full / Qty</span>
              <strong>{fmtQty(totalFull)}</strong>
            </span>
          </div>
          <div className={`transfer-static-metric ${totalEmpty > 0 ? 'is-good' : 'is-neutral'}`}>
            <span className="transfer-static-metric-icon">
              <TransferSymbol kind="empty" />
            </span>
            <span className="transfer-static-metric-copy">
              <span>Empty Qty</span>
              <strong>{fmtQty(totalEmpty)}</strong>
            </span>
          </div>
        </section>

        <section className="transfer-static-workspace" aria-label="Transfer builder">
          <aside className="transfer-static-panel transfer-static-setup-panel">
            <div className="transfer-static-panel-head">
              <h2>Transfer Setup</h2>
            </div>

            <div className="transfer-static-step-list">
              <label className={`transfer-static-step ${hasSelectedMode ? 'is-active' : ''}`}>
                <span className="transfer-static-step-number">1</span>
                <span className="transfer-static-step-copy">
                  <span>Transfer Type</span>
                  <strong>{selectedMode?.label ?? 'Choose transfer type'}</strong>
                  <small>{modeSubtitle || 'Select the movement rule first.'}</small>
                </span>
                <select
                  className="transfer-static-step-field"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as TransferModeSelection)}
                >
                  <option value="">Choose transfer type</option>
                  {transferModeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {isSupplierRestockMode(mode) ? (
                <label className={`transfer-static-step ${supplierId ? 'is-active' : ''}`}>
                  <span className="transfer-static-step-number">2</span>
                  <span className="transfer-static-step-copy">
                    <span>Supplier</span>
                    <strong>{selectedSupplier?.label ?? 'Choose supplier'}</strong>
                    <small>{mode === 'SUPPLIER_RESTOCK_IN' ? 'Supplier sends stock into this branch.' : 'This branch returns stock to supplier.'}</small>
                  </span>
                  <select
                    className="transfer-static-step-field"
                    value={supplierId}
                    onChange={(event) => setSupplierId(event.target.value)}
                  >
                    <option value="">Choose supplier</option>
                    {suppliers.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : isSingleBucketAdjustmentMode(mode) ? (
                <div className="transfer-static-step is-active">
                  <span className="transfer-static-step-number">2</span>
                  <span className="transfer-static-step-copy">
                    <span>Adjustment Location</span>
                    <strong>{selectedAdjustmentLocation?.label || 'No active branch location'}</strong>
                    <small>This movement applies to the current branch location.</small>
                  </span>
                </div>
              ) : (
                <>
                  <label className={`transfer-static-step ${sourceId ? 'is-active' : ''}`}>
                    <span className="transfer-static-step-number">2</span>
                    <span className="transfer-static-step-copy">
                      <span>Source</span>
                      <strong>{sourceOptions.find((row) => row.id === sourceId)?.label || 'Choose source'}</strong>
                      <small>Stock will be checked from this location.</small>
                    </span>
                    <select
                      className="transfer-static-step-field"
                      value={sourceId}
                      onChange={(event) => setSourceId(event.target.value)}
                      disabled={!hasSelectedMode}
                    >
                      <option value="">Choose source</option>
                      {sourceOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className={`transfer-static-step ${destinationId ? 'is-active' : ''}`}>
                    <span className="transfer-static-step-number">3</span>
                    <span className="transfer-static-step-copy">
                      <span>Destination</span>
                      <strong>{destinationOptions.find((row) => row.id === destinationId)?.label || 'Choose destination'}</strong>
                      <small>Stock will be received at this location.</small>
                    </span>
                    <select
                      className="transfer-static-step-field"
                      value={destinationId}
                      onChange={(event) => setDestinationId(event.target.value)}
                      disabled={!hasSelectedMode}
                    >
                      <option value="">Choose destination</option>
                      {destinationOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>

            <label className="transfer-static-note-field">
              <span>
                <TransferSymbol kind="notes" className="h-[16px] w-[16px]" />
                Notes
              </span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional transfer notes"
                disabled={!hasSelectedMode}
              />
            </label>
          </aside>

          <main className="transfer-static-panel transfer-static-items-panel">
            <div className="transfer-static-panel-head">
              <h2>Items</h2>
              <span>{filteredProducts.length} found</span>
            </div>

            <div className="transfer-static-item-toolbar">
              <SearchField
                className="transfer-static-search"
                value={itemSearch}
                onChange={setItemSearch}
                placeholder="Search items..."
              />
            </div>

            <div className="transfer-static-category-row" aria-label="Item categories">
              {itemCategoryOptions.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={`transfer-static-category-chip ${itemCategoryFilter === category ? 'active' : ''}`}
                  onClick={() => setItemCategoryFilter(category)}
                >
                  {category === 'ALL' ? 'All' : category}
                </button>
              ))}
            </div>

            <div className="transfer-static-item-table">
              <div className="transfer-static-item-head">
                <span>Item Name</span>
                <span>Full / Qty</span>
                <span>Empty</span>
                <span>QOH</span>
                <span aria-hidden="true" />
              </div>
              <div className="transfer-static-item-rows">
                {!hasSelectedMode ? (
                  <div className="transfer-static-empty-state">Choose a transfer type to begin selecting items.</div>
                ) : requiresSourceStockCheck && !activeSourceLocationId ? (
                  <div className="transfer-static-empty-state">Choose a source location to review available stock.</div>
                ) : visibleProducts.length === 0 ? (
                  <div className="transfer-static-empty-state">No matching items.</div>
                ) : (
                  visibleProducts.map((product) => {
                    const sourceStock = sourceInventoryByProduct.get(product.id);
                    const availableFull = resolveAvailableQtyForBucket(product.id, 'full');
                    const availableEmpty = resolveAvailableQtyForBucket(product.id, 'empty');
                    const availableQoh = sourceStock?.qtyOnHand ?? product.qtyOnHand;
                    const canSelect = canSelectTransferProduct(
                      mode,
                      requiresSourceStockCheck,
                      availableFull,
                      availableEmpty
                    );

                    return (
                      <button
                        key={product.id}
                        type="button"
                        className="transfer-static-item-row"
                        onClick={() => addProductToDraft(product)}
                        disabled={!canSelect}
                        title={canSelect ? `Add ${product.name}` : 'No source stock available'}
                      >
                        <span className="transfer-static-item-name">
                          <strong>{product.name}</strong>
                          <small>
                            {product.sku} | {product.category}
                            {product.isLpg ? ` | ${(product.cylinderSizeLabel ?? '').trim() || 'No size'}` : ''}
                          </small>
                        </span>
                        <span className="transfer-static-item-stock-count">{fmtQty(product.isLpg ? availableFull : availableQoh)}</span>
                        <span className="transfer-static-item-stock-count">{product.isLpg ? fmtQty(availableEmpty) : '-'}</span>
                        <span className="transfer-static-item-stock-count">{fmtQty(availableQoh)}</span>
                        <span className="transfer-static-add-icon" aria-hidden="true">
                          <TransferSymbol kind="add" className="h-[18px] w-[18px]" />
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="transfer-static-item-footer">
              <span>Showing {visibleProducts.length} of {filteredProducts.length} items</span>
              <button className="secondary-btn" type="button" onClick={addLine} disabled={!hasSelectedMode}>
                <TransferSymbol kind="add" className="h-[16px] w-[16px]" />
                <span>Add Blank Line</span>
              </button>
            </div>
          </main>

          <aside className="transfer-static-panel transfer-static-cart-panel">
            <div className="transfer-static-cart-head">
              <h2>Transfer Draft</h2>
              <button
                className="secondary-btn transfer-static-icon-btn"
                type="button"
                onClick={clearTransferLines}
                disabled={saving || !hasDraftToClear}
                aria-label="Clear transfer lines"
                title="Clear transfer lines"
              >
                <TransferSymbol kind="remove" className="h-[18px] w-[18px]" />
              </button>
            </div>

            <div className="transfer-static-cart-body">
              {lines.length === 0 ? (
                <div className="transfer-static-cart-empty">
                  <div className="transfer-static-cart-empty-icon" aria-hidden="true">
                    <TransferSymbol kind="lines" className="h-[34px] w-[34px]" />
                  </div>
                  <strong>No items added yet.</strong>
                  <span>Add items from the list to build this transfer.</span>
                </div>
              ) : (
                <div className="transfer-static-cart-lines">
                  {lines.map((line, index) => {
                    const product = productById.get(line.productId);
                    const warning = lineWarnings.get(line.key);
                    return (
                      <div key={line.key} className="transfer-static-cart-line">
                        <button
                          type="button"
                          className="transfer-static-cart-line-main"
                          onClick={() => openItemPicker(line.key)}
                        >
                          <strong>{product?.name ?? `Line ${index + 1}: Choose item`}</strong>
                          <span>
                            {product
                              ? `${product.sku} | ${product.category}${product.isLpg ? ` | ${(product.cylinderSizeLabel ?? '').trim() || 'No size'}` : ''}`
                              : 'Select an item for this transfer line.'}
                          </span>
                        </button>

                        <div className="transfer-static-line-qty-grid">
                          <div className={`transfer-static-line-qty-card ${warning?.full ? 'has-warning' : ''}`}>
                            <div className="transfer-static-qty-head">
                              <span>{product?.isLpg === false ? `Quantity (${getBucketIndicator(mode, 'full') || '+'})` : getBucketLabel(mode, 'full')}</span>
                              {line.productId && requiresSourceStockCheck && transferBucketConsumesStock(mode, 'full') ? (
                                <small>{resolveRemainingQtyForLine(line.key, line.productId, 'full').toFixed(2)} available</small>
                              ) : null}
                            </div>
                            <div className="cart-controls transfer-static-qty-controls">
                              <button type="button" onClick={() => stepLineQty(line.key, 'qtyFull', -1)} aria-label="Decrease full quantity">
                                -
                              </button>
                              <input
                                value={line.qtyFull}
                                onChange={(event) => setLineQty(line.key, 'qtyFull', event.target.value)}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                placeholder="0"
                                aria-label="Full quantity"
                                className="transfer-static-qty-input"
                              />
                              <button type="button" onClick={() => stepLineQty(line.key, 'qtyFull', 1)} aria-label="Increase full quantity">
                                +
                              </button>
                            </div>
                            {warning?.full ? <small className="field-warning">{warning.full}</small> : null}
                          </div>

                          {product?.isLpg === false ? null : <div className={`transfer-static-line-qty-card ${warning?.empty ? 'has-warning' : ''}`}>
                            <div className="transfer-static-qty-head">
                              <span>{getBucketLabel(mode, 'empty')}</span>
                              {line.productId && requiresSourceStockCheck && transferBucketConsumesStock(mode, 'empty') ? (
                                <small>{resolveRemainingQtyForLine(line.key, line.productId, 'empty').toFixed(2)} available</small>
                              ) : null}
                            </div>
                            <div className="cart-controls transfer-static-qty-controls">
                              <button type="button" onClick={() => stepLineQty(line.key, 'qtyEmpty', -1)} aria-label="Decrease empty quantity">
                                -
                              </button>
                              <input
                                value={line.qtyEmpty}
                                onChange={(event) => setLineQty(line.key, 'qtyEmpty', event.target.value)}
                                inputMode="numeric"
                                pattern="[0-9]*"
                                placeholder="0"
                                aria-label="Empty quantity"
                                className="transfer-static-qty-input"
                              />
                              <button type="button" onClick={() => stepLineQty(line.key, 'qtyEmpty', 1)} aria-label="Increase empty quantity">
                                +
                              </button>
                            </div>
                            {warning?.empty ? <small className="field-warning">{warning.empty}</small> : null}
                          </div>}
                        </div>

                        {line.productId ? (
                          <div className="transfer-static-stock-note">
                            <TransferSymbol kind="stock" className="h-[16px] w-[16px]" />
                            <span>
                              {product?.isLpg === false
                                ? `${requiresSourceStockCheck ? 'Source' : 'Current branch'} stock: QTY ${fmtQty(resolveAvailableQtyForBucket(line.productId, 'full'))}`
                                : requiresSourceStockCheck
                                  ? `Source stock: FULL ${fmtQty(resolveAvailableQtyForBucket(line.productId, 'full'))} | EMPTY ${fmtQty(resolveAvailableQtyForBucket(line.productId, 'empty'))}`
                                  : `Current branch stock: FULL ${fmtQty(resolveAvailableQtyForBucket(line.productId, 'full'))} | EMPTY ${fmtQty(resolveAvailableQtyForBucket(line.productId, 'empty'))}`}
                            </span>
                          </div>
                        ) : null}

                        <button
                          className="secondary-btn transfer-static-remove-line"
                          type="button"
                          onClick={() => removeLine(line.key)}
                        >
                          <TransferSymbol kind="remove" className="h-[16px] w-[16px]" />
                          <span>Remove</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="transfer-static-total-block">
              <div className="transfer-static-total-row">
                <span>Source</span>
                <strong>{sourceSummaryLabel}</strong>
              </div>
              <div className="transfer-static-total-row">
                <span>Destination</span>
                <strong>{destinationSummaryLabel}</strong>
              </div>
              <div className="transfer-static-total-row">
                <span>Total Full / Qty</span>
                <strong>{fmtQty(totalFull)}</strong>
              </div>
              <div className="transfer-static-total-row">
                <span>Total Empty</span>
                <strong>{fmtQty(totalEmpty)}</strong>
              </div>
            </div>

            <div className="transfer-static-cart-actions">
              <button
                className="primary-btn transfer-static-save-btn"
                type="button"
                onClick={openSaveConfirmation}
                disabled={!canAttemptSaveTransfer}
              >
                <span>{saving ? 'Saving...' : 'Save Transfer'}</span>
                <TransferSymbol kind="save" className="h-[18px] w-[18px]" />
              </button>
            </div>
          </aside>
        </section>

        <div className={`transfer-static-status-line ${firstBlockingStockWarning ? 'is-warning' : ''}`}>
          <span>{transferStatusMessage}</span>
        </div>
      </div>

      {saveConfirmOpen ? (
        <div
          className={transferModalBackdropClass}
          style={{ zIndex: 95 }}
          onClick={() => !saving && setSaveConfirmOpen(false)}
        >
          <div
            className="desktop-modal-card desktop-modal-card--detail"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="desktop-modal-header flex shrink-0 flex-col gap-3">
              <div className="panel-head !mb-0">
                <div>
                  <div className="eyebrow">Confirm transfer draft</div>
                  <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">
                    Save this transfer?
                  </h3>
                  <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
                    This saves a draft only. Inventory quantities will move after the transfer is confirmed in Transfer History.
                  </p>
                </div>
                <button
                  className="secondary-btn mini-btn modal-close-icon-btn"
                  type="button"
                  onClick={() => setSaveConfirmOpen(false)}
                  disabled={saving}
                  aria-label="Close modal"
                  title="Close"
                >
                  <span aria-hidden="true">X</span>
                </button>
              </div>
            </div>
            <div className="desktop-modal-body grid gap-3">
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Route</span>
                <strong className={summaryValueClass}>{sourceSummaryLabel} {'->'} {destinationSummaryLabel}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Lines</span>
                <strong className={summaryValueClass}>{lines.length}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Full / Qty / Empty</span>
                <strong className={summaryValueClass}>{fmtQty(totalFull)} / {fmtQty(totalEmpty)}</strong>
              </div>
            </div>
            <div className="desktop-modal-footer">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setSaveConfirmOpen(false)}
                disabled={saving}
              >
                Review Draft
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => void saveTransfer()}
                disabled={saving}
                autoFocus
              >
                {saving ? 'Saving...' : 'Confirm Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {transferSuccessModal ? (
        <div
          className="desktop-modal-backdrop pos-sale-success-backdrop"
          onClick={() => undefined}
        >
          <div
            className="pos-sale-success-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transfer-save-success-title"
            aria-describedby="transfer-save-success-copy"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pos-sale-success-body">
              <div className="pos-sale-success-icon-shell" aria-hidden="true">
                <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
                  <circle cx="32" cy="32" r="26" fill="#ffffff" fillOpacity="0.14" />
                  <path d="M27.2 41.5 18.7 33l4.8-4.8 3.7 3.7 12.3-12.3 4.8 4.8-17.1 17.1Z" fill="#fff" />
                </svg>
              </div>

              <div className="pos-sale-success-copy-stack">
                <span className="eyebrow pos-sale-success-eyebrow">Transfer draft saved</span>
                <h3 id="transfer-save-success-title" className="pos-sale-success-title">
                  Save Successful
                </h3>
                <p id="transfer-save-success-copy" className="pos-sale-success-copy">
                  Transfer {transferSuccessModal.transferId} was saved as a draft.
                </p>
              </div>

              <div className="pos-sale-success-details">
                <div className="pos-sale-success-detail">
                  <span>Transfer ID</span>
                  <strong>{transferSuccessModal.transferId}</strong>
                </div>
                <div className="pos-sale-success-detail">
                  <span>Lines</span>
                  <strong>{transferSuccessModal.lineCount}</strong>
                </div>
                <div className="pos-sale-success-detail">
                  <span>Full / Qty / Empty</span>
                  <strong>{fmtQty(transferSuccessModal.totalFull)} / {fmtQty(transferSuccessModal.totalEmpty)}</strong>
                </div>
              </div>

              <div className="pos-sale-success-note">
                Confirm this transfer from Transfer History to move inventory. Route: {transferSuccessModal.routeLabel}.
              </div>
            </div>

            <div className="pos-sale-success-footer">
              <button
                className="primary-btn pos-sale-success-continue-btn"
                type="button"
                onClick={() => setTransferSuccessModal(null)}
                autoFocus
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {itemModalOpen ? (
        <div className={transferModalBackdropClass} onClick={closeItemPicker}>
          <div className={transferModalCardClass} onClick={(event) => event.stopPropagation()}>
            <div className={transferModalToolbarClass}>
              <div className="panel-head compact !mb-0">
                <div>
                  <div className="eyebrow">Selection</div>
                  <h3>Select Item</h3>
                  <p className="mt-2 text-[0.92rem] leading-6 text-[var(--muted)]">
                    Review the branch stock first, then choose the product line you want to move.
                  </p>
                </div>
                <button
                  className="secondary-btn mini-btn modal-close-icon-btn"
                  type="button"
                  onClick={closeItemPicker}
                  aria-label="Close modal"
                  title="Close"
                >
                  <span aria-hidden="true">X</span>
                </button>
              </div>

              <SearchField
                value={itemSearch}
                onChange={setItemSearch}
                placeholder="Search item code, name, category, or unit"
                autoFocus
              />

              <div className="filter-chip-row">
                {itemCategoryOptions.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={`filter-chip ${itemCategoryFilter === category ? 'active' : ''}`}
                    onClick={() => setItemCategoryFilter(category)}
                  >
                    {category === 'ALL' ? 'All Categories' : category}
                  </button>
                ))}
              </div>
            </div>

            <div className="desktop-modal-body picker-list">
              {requiresSourceStockCheck && !activeSourceLocationId ? (
                <div className="empty-state">Choose a source location first to review stock before selecting an item.</div>
              ) : filteredProducts.length === 0 ? (
                <div className="empty-state">No matching items.</div>
              ) : (
                filteredProducts.map((product) => {
                  const availableFull = resolveAvailableQtyForBucket(product.id, 'full');
                  const availableEmpty = resolveAvailableQtyForBucket(product.id, 'empty');
                  const availableQoh = sourceInventoryByProduct.get(product.id)?.qtyOnHand ?? product.qtyOnHand;
                  const canSelect = canSelectTransferProduct(
                    mode,
                    requiresSourceStockCheck,
                    availableFull,
                    availableEmpty
                  );

                  return (
                    <button
                      key={product.id}
                      type="button"
                      className="catalog-row picker-row pos-item-card"
                      onClick={() => selectItemFromModal(product.id)}
                      disabled={!canSelect}
                    >
                      <div className="pos-item-card-main">
                        <strong>{product.name}</strong>
                        <span className="pos-item-card-meta">
                          {product.sku} | {product.category} | {product.unit}
                          {product.isLpg ? ` | Size ${(product.cylinderSizeLabel ?? '').trim() || '-'}` : ''}
                        </span>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                          <div className="rounded-[16px] border border-[rgba(188,210,234,0.45)] bg-[rgba(248,251,255,0.95)] px-3 py-2">
                            <span className="block text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{product.isLpg ? 'Full' : 'Quantity'}</span>
                            <strong className="mt-1 block text-[0.98rem] font-extrabold text-[var(--text-strong)]">{fmtQty(product.isLpg ? availableFull : availableQoh)}</strong>
                          </div>
                          <div className="rounded-[16px] border border-[rgba(188,210,234,0.45)] bg-[rgba(248,251,255,0.95)] px-3 py-2">
                            <span className="block text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Empty</span>
                            <strong className="mt-1 block text-[0.98rem] font-extrabold text-[var(--text-strong)]">{product.isLpg ? fmtQty(availableEmpty) : '-'}</strong>
                          </div>
                          <div className="rounded-[16px] border border-[rgba(188,210,234,0.45)] bg-[rgba(248,251,255,0.95)] px-3 py-2">
                            <span className="block text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">QOH</span>
                            <strong className="mt-1 block text-[0.98rem] font-extrabold text-[var(--text-strong)]">{fmtQty(availableQoh)}</strong>
                          </div>
                        </div>
                        <span className="mt-2 text-[0.86rem] text-[var(--muted)]">
                          {isSupplierRestockMode(mode) || isSingleBucketAdjustmentMode(mode)
                            ? 'Current branch stock for this product.'
                            : 'Desktop transfer checks this source stock before saving.'}
                        </span>
                      </div>
                      <div className="catalog-row-right">
                        <div className={`stock-pill ${canSelect ? 'good' : 'out'}`}>{canSelect ? 'Select' : 'No Stock'}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

