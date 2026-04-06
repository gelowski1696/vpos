import { useEffect, useMemo, useState } from 'react';
import { desktopDb } from '../db/sqlite';
import type { DesktopAppState, DesktopCatalogProduct, DesktopOption, DesktopTransferLine, DesktopTransferMode } from '../db/schema';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopShiftService } from '../services/desktop-shift.service';
import { desktopTransferService } from '../services/desktop-transfer.service';

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

const TRANSFER_MODES: Array<{ value: DesktopTransferMode; label: string }> = [
  { value: 'GENERAL', label: 'General Transfer' },
  { value: 'INTER_STORE_TRANSFER', label: 'Inter-Store Transfer' },
  { value: 'STORE_TO_WAREHOUSE', label: 'Store To Warehouse' },
  { value: 'WAREHOUSE_TO_STORE', label: 'Warehouse To Store' },
  { value: 'SUPPLIER_RESTOCK_IN', label: 'Supplier Restock In' },
  { value: 'SUPPLIER_RESTOCK_OUT', label: 'Supplier Return Out' }
];

const screenStackClass = 'flex flex-col gap-5';
const summaryStripClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const summaryTileClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const summaryLabelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[1rem] font-extrabold text-[var(--text-strong)]';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const transferSetupGridClass = 'grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.95fr)]';
const transferSetupCardClass =
  'grid gap-4 rounded-[24px] border border-[rgba(188,210,234,0.5)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,254,0.98))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_10px_24px_rgba(17,40,58,0.04)]';
const transferContextGridClass = 'grid gap-3';
const transferContextRowClass =
  'grid gap-1 rounded-[18px] border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.94)] px-4 py-3';
const transferActionRowClass = 'flex flex-col gap-3 border-t border-[var(--border-soft)] pt-4 md:flex-row md:items-center md:justify-between';

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
  return Math.max(0, Number(value) || 0);
}

function parseInventorySnapshot(payload: string): { productId: string; locationId: string; stock: InventorySnapshot } | null {
  try {
    const row = JSON.parse(payload) as Record<string, unknown>;
    const productId = typeof row.productId === 'string' ? row.productId : '';
    const locationId = typeof row.locationId === 'string' ? row.locationId : '';
    if (!productId || !locationId) {
      return null;
    }
    return {
      productId,
      locationId,
      stock: {
        qtyOnHand: Number(row.qtyOnHand ?? 0) || 0,
        qtyFull: Number(row.qtyFull ?? 0) || 0,
        qtyEmpty: Number(row.qtyEmpty ?? 0) || 0
      }
    };
  } catch {
    return null;
  }
}

export function TransferScreen({ appState, onOutboxChanged }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const [catalog, setCatalog] = useState<DesktopCatalogProduct[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [suppliers, setSuppliers] = useState<DesktopOption[]>([]);
  const [sourceInventoryByProduct, setSourceInventoryByProduct] = useState<Map<string, InventorySnapshot>>(new Map());
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [mode, setMode] = useState<DesktopTransferMode>('GENERAL');
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<TransferDraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const announce = (message: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
    desktopUi.showToast({ message, tone });
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [locationRows, catalogRows, supplierRows, activeShift] = await Promise.all([
        desktopDb.listMasterData('location'),
        appState.setup.locationId ? desktopMasterDataService.loadCatalog(appState.setup.locationId) : Promise.resolve([]),
        desktopMasterDataService.loadSuppliers(),
        desktopShiftService.findActiveShift()
      ]);
      const nextLocations = locationRows
        .map((row) => parseLocationOption(row.payload))
        .filter((row): row is LocationOption => Boolean(row))
        .filter((row) => !row.branchId || row.branchId === appState.setup.branchId);
      setLocations(nextLocations);
      setCatalog(catalogRows);
      setSuppliers(supplierRows);
      setActiveShiftId(activeShift?.id ?? null);
      setSourceId((current) => current || appState.setup.locationId);
      setDestinationId((current) => current || nextLocations.find((row) => row.id !== appState.setup.locationId)?.id || '');
      setSupplierId((current) => current || supplierRows[0]?.id || '');
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

  const destinationOptions = useMemo(
    () => {
      const stores = locations.filter((location) => (location.type ?? '').toUpperCase().includes('STORE'));
      const warehouses = locations.filter((location) => (location.type ?? '').toUpperCase().includes('WAREHOUSE'));

      switch (mode) {
        case 'SUPPLIER_RESTOCK_IN':
          return [...stores, ...warehouses];
        case 'SUPPLIER_RESTOCK_OUT':
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

  const sourceOptions = useMemo(() => {
    const stores = locations.filter((location) => (location.type ?? '').toUpperCase().includes('STORE'));
    const warehouses = locations.filter((location) => (location.type ?? '').toUpperCase().includes('WAREHOUSE'));

    switch (mode) {
      case 'SUPPLIER_RESTOCK_IN':
        return [];
      case 'SUPPLIER_RESTOCK_OUT':
        return [...stores, ...warehouses];
      case 'INTER_STORE_TRANSFER':
        return stores;
      case 'STORE_TO_WAREHOUSE':
        return stores;
      case 'WAREHOUSE_TO_STORE':
        return warehouses;
      default:
        return locations;
    }
  }, [locations, mode]);

  useEffect(() => {
    if (!sourceOptions.length) {
      return;
    }
    if (!sourceOptions.some((location) => location.id === sourceId)) {
      setSourceId(sourceOptions[0]?.id ?? '');
    }
  }, [sourceId, sourceOptions]);

  useEffect(() => {
    if (!destinationOptions.length) {
      setDestinationId('');
      return;
    }
    if (!destinationOptions.some((location) => location.id === destinationId)) {
      setDestinationId(destinationOptions[0]?.id ?? '');
    }
  }, [destinationId, destinationOptions]);

  const selectedSupplier = useMemo(
    () => suppliers.find((row) => row.id === supplierId) ?? null,
    [supplierId, suppliers]
  );

  const requiresSourceStockCheck = useMemo(() => mode !== 'SUPPLIER_RESTOCK_IN', [mode]);
  const activeSourceLocationId = useMemo(() => {
    if (!requiresSourceStockCheck) {
      return null;
    }
    const id = sourceId.trim();
    return id || null;
  }, [requiresSourceStockCheck, sourceId]);

  const productById = useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog]);

  const totalFull = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.qtyFull) || 0), 0), [lines]);
  const totalEmpty = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.qtyEmpty) || 0), 0), [lines]);

  useEffect(() => {
    if (!activeSourceLocationId) {
      setSourceInventoryByProduct(new Map());
      return;
    }

    let cancelled = false;
    void (async () => {
      const rows = await desktopDb.listMasterData('inventory_balance');
      const next = new Map<string, InventorySnapshot>();
      for (const row of rows) {
        const snapshot = parseInventorySnapshot(row.payload);
        if (!snapshot || snapshot.locationId !== activeSourceLocationId) {
          continue;
        }
        const current = next.get(snapshot.productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
        current.qtyOnHand += snapshot.stock.qtyOnHand;
        current.qtyFull += snapshot.stock.qtyFull;
        current.qtyEmpty += snapshot.stock.qtyEmpty;
        next.set(snapshot.productId, current);
      }
      if (!cancelled) {
        setSourceInventoryByProduct(next);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSourceLocationId]);

  const resolveAvailableQtyForBucket = (productId: string, bucket: 'full' | 'empty'): number => {
    const stock =
      sourceInventoryByProduct.get(productId) ??
      (() => {
        const product = productById.get(productId);
        return {
          qtyOnHand: product?.qtyOnHand ?? 0,
          qtyFull: product?.qtyFull ?? 0,
          qtyEmpty: product?.qtyEmpty ?? 0
        };
      })();
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
          fullQty > availableFull + 0.0001
            ? `${product?.name ?? 'Item'} only has ${availableFull.toFixed(2)} FULL available at source.`
            : null,
        empty:
          emptyQty > availableEmpty + 0.0001
            ? `${product?.name ?? 'Item'} only has ${availableEmpty.toFixed(2)} EMPTY available at source.`
            : null
      });
    }
    return warnings;
  }, [lines, productById, requiresSourceStockCheck, activeSourceLocationId, sourceInventoryByProduct]);

  const hasBlockingStockWarning = useMemo(
    () =>
      Array.from(lineWarnings.values()).some((warning) => Boolean(warning.full || warning.empty)) ||
      (requiresSourceStockCheck && !activeSourceLocationId),
    [activeSourceLocationId, lineWarnings, requiresSourceStockCheck]
  );

  const addLine = (): void => {
    setLines((current) => [...current, { key: makeLineKey(), productId: '', qtyFull: '', qtyEmpty: '' }]);
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
        if (delta > 0 && line.productId && requiresSourceStockCheck) {
          const allowed = resolveRemainingQtyForLine(line.key, line.productId, bucket === 'qtyFull' ? 'full' : 'empty');
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

  const removeLine = (key: string): void => {
    setLines((current) => current.filter((line) => line.key !== key));
  };

  const saveTransfer = async (): Promise<void> => {
    setSaving(true);
    try {
      const destination = destinationOptions.find((row) => row.id === destinationId);
      const source = sourceOptions.find((row) => row.id === sourceId);
      const needsSupplier = mode === 'SUPPLIER_RESTOCK_IN' || mode === 'SUPPLIER_RESTOCK_OUT';
      if (needsSupplier && !selectedSupplier) {
        throw new Error('Choose a supplier first.');
      }
      if (!destination && mode !== 'SUPPLIER_RESTOCK_OUT') {
        throw new Error('Choose a destination first.');
      }
      if (!source && mode !== 'SUPPLIER_RESTOCK_IN') {
        throw new Error('Choose a source first.');
      }
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
        sourceLocationId: source?.id ?? 'supplier',
        sourceLocationLabel: source?.label ?? selectedSupplier?.label ?? 'Supplier',
        destinationLocationId: destination?.id ?? 'supplier',
        destinationLocationLabel: destination?.label ?? selectedSupplier?.label ?? 'Supplier',
        shiftId: activeShiftId ?? '',
        transferMode: mode,
        supplierId: selectedSupplier?.id ?? null,
        supplierName: selectedSupplier?.label ?? null,
        lines: payloadLines
      });
      setLines([]);
      announce(`Transfer ${record.id} was saved locally and is waiting to sync.`, 'success');
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

  const handleRefresh = async (): Promise<void> => {
    await refresh();
    announce('Transfer setup and recent records refreshed.', 'success');
  };

  return (
    <div className={screenStackClass}>
      <ScreenHeader
        routeId="transfer"
        title="Transfer"
        description="Create transfers with the same simple flow as mobile, then send them later."
      />

      <section className={summaryStripClass}>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Active Shift</span>
          <strong className={summaryValueClass}>{activeShiftId ? 'Open' : 'Required'}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Destination</span>
          <strong className={summaryValueClass}>{destinationOptions.length}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Full Qty</span>
          <strong className={summaryValueClass}>{fmtQty(totalFull)}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Empty Qty</span>
          <strong className={summaryValueClass}>{fmtQty(totalEmpty)}</strong>
        </div>
      </section>

      <section className={`${shellCardClass} flex flex-col gap-5`}>
        <div className="panel-head items-center !mb-0">
          <div>
            <div className="eyebrow">Transfer setup</div>
            <h3>Create a new transfer</h3>
            <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">Pick the route first, then add only the item lines you want to move.</p>
          </div>
          <button className="secondary-btn" type="button" onClick={() => void handleRefresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {requiresSourceStockCheck && !activeSourceLocationId ? (
          <div className="message-banner">
            Choose a source location first so desktop can check available stock before saving.
          </div>
        ) : null}

        <div className={transferSetupGridClass}>
          <section className={transferSetupCardClass}>
            <div className="grid gap-1">
              <span className="eyebrow">Route</span>
              <strong>Where this transfer is going</strong>
            </div>
            <div className="form-grid">
              <label>
                <span>Transfer Type</span>
                <select value={mode} onChange={(event) => setMode(event.target.value as DesktopTransferMode)}>
                  {TRANSFER_MODES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {mode === 'SUPPLIER_RESTOCK_IN' || mode === 'SUPPLIER_RESTOCK_OUT' ? (
                <label>
                  <span>Supplier</span>
                  <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                    <option value="">Choose supplier</option>
                    {suppliers.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  <span>Source</span>
                  <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                    <option value="">Choose source</option>
                    {sourceOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {mode === 'SUPPLIER_RESTOCK_OUT' ? null : (
                <label className="full-width-field">
                  <span>Destination</span>
                  <select value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
                    <option value="">Choose destination</option>
                    {destinationOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </section>

          <section className={transferSetupCardClass}>
            <div className="grid gap-1">
              <span className="eyebrow">Summary</span>
              <strong>Current transfer snapshot</strong>
            </div>
            <div className={transferContextGridClass}>
              <div className={transferContextRowClass}>
                <span className={summaryLabelClass}>Source</span>
                <strong className="text-[0.98rem] font-extrabold text-[var(--text-strong)]">
                  {mode === 'SUPPLIER_RESTOCK_IN'
                    ? selectedSupplier?.label || 'Supplier'
                    : sourceOptions.find((row) => row.id === sourceId)?.label || 'Not set'}
                </strong>
              </div>
              <div className={transferContextRowClass}>
                <span className={summaryLabelClass}>Destination</span>
                <strong className="text-[0.98rem] font-extrabold text-[var(--text-strong)]">
                  {mode === 'SUPPLIER_RESTOCK_OUT'
                    ? selectedSupplier?.label || 'Supplier'
                    : destinationOptions.find((row) => row.id === destinationId)?.label || 'Choose destination'}
                </strong>
              </div>
              <div className={transferContextRowClass}>
                <span className={summaryLabelClass}>Shift</span>
                <strong className="text-[0.98rem] font-extrabold text-[var(--text-strong)]">{activeShiftId ? 'Open' : 'Open shift first'}</strong>
              </div>
              <div className={transferContextRowClass}>
                <span className={summaryLabelClass}>Items ready</span>
                <strong className="text-[0.98rem] font-extrabold text-[var(--text-strong)]">{lines.length}</strong>
              </div>
            </div>
          </section>
        </div>

        <section className="sales-line-panel transfer-lines-panel">
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Transfer lines</div>
              <h3>Items to move</h3>
            </div>
            <button className="secondary-btn mini-btn" type="button" onClick={addLine}>
              Add Line
            </button>
          </div>
          <div className="cart-list">
            {lines.length === 0 ? (
              <div className="empty-state">
                No item lines yet. Tap <strong>Add Line</strong> to start this transfer.
              </div>
            ) : (
              lines.map((line) => (
                <div key={line.key} className="transfer-line-card">
                  <div className="transfer-line-grid transfer-line-grid-single-row">
                    <label className="transfer-line-item-field">
                      <span>Item</span>
                      <select value={line.productId} onChange={(event) => updateLine(line.key, { productId: event.target.value })}>
                        <option value="">Choose item</option>
                        {catalog.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Full Qty</span>
                      <div className="cart-controls pos-cart-qty-rail transfer-qty-rail">
                        <button type="button" onClick={() => stepLineQty(line.key, 'qtyFull', -1)}>
                          -
                        </button>
                        <span className="pos-cart-qty-value transfer-qty-value">{fmtQty(parseDraftQty(line.qtyFull))}</span>
                        <button type="button" onClick={() => stepLineQty(line.key, 'qtyFull', 1)}>
                          +
                        </button>
                      </div>
                      {line.productId && requiresSourceStockCheck ? (
                        <small className={lineWarnings.get(line.key)?.full ? 'field-warning' : 'field-helper'}>
                          Available FULL: {resolveRemainingQtyForLine(line.key, line.productId, 'full').toFixed(2)}
                        </small>
                      ) : null}
                      {lineWarnings.get(line.key)?.full ? <small className="field-warning">{lineWarnings.get(line.key)?.full}</small> : null}
                    </label>
                    <label>
                      <span>Empty Qty</span>
                      <div className="cart-controls pos-cart-qty-rail transfer-qty-rail">
                        <button type="button" onClick={() => stepLineQty(line.key, 'qtyEmpty', -1)}>
                          -
                        </button>
                        <span className="pos-cart-qty-value transfer-qty-value">{fmtQty(parseDraftQty(line.qtyEmpty))}</span>
                        <button type="button" onClick={() => stepLineQty(line.key, 'qtyEmpty', 1)}>
                          +
                        </button>
                      </div>
                      {line.productId && requiresSourceStockCheck ? (
                        <small className={lineWarnings.get(line.key)?.empty ? 'field-warning' : 'field-helper'}>
                          Available EMPTY: {resolveRemainingQtyForLine(line.key, line.productId, 'empty').toFixed(2)}
                        </small>
                      ) : null}
                      {lineWarnings.get(line.key)?.empty ? <small className="field-warning">{lineWarnings.get(line.key)?.empty}</small> : null}
                    </label>
                    <div className="transfer-line-action-cell">
                      <span className="transfer-line-action-label" aria-hidden="true">
                        Remove
                      </span>
                      <button
                        className="secondary-btn mini-btn transfer-line-remove"
                        type="button"
                        onClick={() => removeLine(line.key)}
                        title="Remove line"
                        aria-label="Remove line"
                      >
                        <span aria-hidden="true">🗑</span>
                      </button>
                    </div>
                  </div>
                  {line.productId ? (
                    <div className="transfer-line-meta">
                      <span>{productById.get(line.productId)?.name ?? 'Selected item'}</span>
                      <strong>
                        {requiresSourceStockCheck
                          ? `Source stock: FULL ${fmtQty(resolveAvailableQtyForBucket(line.productId, 'full'))} | EMPTY ${fmtQty(resolveAvailableQtyForBucket(line.productId, 'empty'))}`
                          : 'Supplier transfer'}
                      </strong>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>

        <div className={transferActionRowClass}>
          <div className="grid gap-1">
            <span className={summaryLabelClass}>Ready to send</span>
            <strong className="text-[1rem] font-extrabold text-[var(--text-strong)]">{lines.length === 0 ? 'Add item lines first' : `${lines.length} item line${lines.length === 1 ? '' : 's'} ready for queue`}</strong>
          </div>
          <button className="primary-btn" type="button" onClick={() => void saveTransfer()} disabled={saving || !activeShiftId || hasBlockingStockWarning}>
            {saving ? 'Saving...' : 'Save Transfer'}
          </button>
        </div>
      </section>
    </div>
  );
}


