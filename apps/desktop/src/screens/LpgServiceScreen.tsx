import { useEffect, useMemo, useState } from 'react';
import { desktopDb } from '../db/sqlite';
import type { DesktopAppState, DesktopCatalogProduct, DesktopLpgItemActionRecord } from '../db/schema';
import { SearchField } from '../components/inputs/SearchField';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import { desktopAuthService } from '../services/desktop-auth.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';

type Props = {
  appState: DesktopAppState;
  focusProductId?: string | null;
  focusNonce?: number;
  onOpenItems?: (productId: string) => void;
};

type ActionFilter = 'ALL' | 'DISPOSE' | 'JUNK' | 'REPLACE';
type ComposerType = 'DISPOSE' | 'REPLACE' | 'JUNK';

type LocalActionRecord = DesktopLpgItemActionRecord & {
  source?: 'server' | 'local' | 'cached';
  syncStatus?: 'pending' | 'processing' | 'failed' | 'needs_review' | 'synced' | null;
};

type DisposedEntryRow = LocalActionRecord & {
  usedQty: number;
  availableQty: number;
};

const screenStackClass = 'flex flex-col gap-5';
const summaryStripClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const summaryTileClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const summaryLabelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[1rem] font-extrabold text-[var(--text-strong)]';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const modalBackdropClass = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm';
const modalCardClass =
  'flex max-h-[min(90vh,920px)] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.97)] shadow-[var(--shadow-strong)]';
const modalToolbarClass =
  'flex shrink-0 flex-col gap-4 border-b border-[var(--border-soft)] bg-[rgba(248,251,255,0.98)] px-5 py-4';
const searchRowClass = 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center';
const refreshButtonClass = 'min-h-[48px] min-w-[140px] rounded-[14px]';
const topActionsClass = 'ml-auto flex flex-wrap gap-2';
const focusBannerClass = 'flex flex-wrap items-center justify-between gap-3';
const recordBlockClass =
  'grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.52)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.76),0_8px_18px_rgba(17,40,58,0.03)]';
const recordMainClass = 'grid min-w-0 gap-2';
const recordHeadClass = 'flex items-start justify-between gap-3';
const recordHeadCopyClass = 'grid min-w-0 gap-1';
const entryActionsClass = 'grid w-full gap-2';
const entryButtonClass = 'min-h-[40px] w-full rounded-[14px]';
const sheetContentClass = 'grid gap-4 overflow-auto px-5 pb-5 pt-4';
const sheetCopyClass = 'm-0 text-[0.92rem] leading-6 text-[var(--muted)]';
const composerStackClass = 'grid gap-3';
const productListClass = 'grid max-h-[260px] gap-2 overflow-auto';
const selectedProductClass =
  'grid gap-1 rounded-[16px] border border-[rgba(188,210,234,0.52)] bg-[rgba(245,249,253,0.96)] px-4 py-3';
const selectedProductTitleClass = 'text-[0.94rem] font-bold text-[var(--text-strong)]';
const selectedProductCopyClass = 'text-[0.82rem] leading-5 text-[var(--muted)]';
const composerFormClass = 'grid gap-3';
const qtyCardClass =
  'grid gap-3 rounded-[18px] border border-[rgba(188,210,234,0.5)] bg-[rgba(245,249,253,0.96)] px-4 py-4';
const qtyHeadClass = 'flex flex-wrap items-center justify-between gap-2';
const qtyHeadLabelClass = 'text-[0.8rem] font-extrabold uppercase tracking-[0.06em] text-[var(--muted)]';
const qtyHeadCopyClass = 'text-[0.8rem] text-[var(--muted)]';
const qtyRailClass = 'inline-flex items-center gap-2 self-start';
const qtyRailButtonClass =
  'grid h-[36px] w-[36px] place-items-center rounded-full border border-[var(--border)] bg-[rgba(255,255,255,0.96)] text-[1rem] font-bold text-[var(--text-strong)] transition hover:border-[rgba(25,118,210,0.24)] hover:bg-[rgba(248,251,255,0.98)]';
const qtyValueClass = 'min-w-[32px] text-center text-[1rem] font-extrabold text-[var(--text-strong)]';
const modalActionRowClass = 'mt-1 flex flex-wrap items-center justify-end gap-3';
const serviceRecordListClass = 'grid gap-3';
const serviceRecordCardClass =
  'grid gap-4 rounded-[22px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.97)] p-4 shadow-[0_10px_24px_rgba(17,40,58,0.04)] md:grid-cols-[minmax(0,1fr)_auto]';
const serviceRecordMetaClass = 'flex flex-wrap gap-x-4 gap-y-1 text-[0.88rem] text-[var(--muted)]';
const serviceRecordCopyClass = 'grid gap-1 text-[0.92rem] text-[var(--muted-strong)]';
const serviceRecordSideClass = 'grid content-start justify-items-start gap-3 md:justify-items-end';
const productCardClass =
  'grid gap-2 rounded-[20px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-4 py-4 text-left shadow-[0_10px_24px_rgba(17,40,58,0.04)] transition hover:-translate-y-[1px] hover:border-[rgba(25,118,210,0.24)] hover:shadow-[0_14px_28px_rgba(17,40,58,0.08)]';
const productCardSelectedClass =
  'border-[rgba(25,118,210,0.3)] bg-[rgba(236,244,255,0.96)] shadow-[0_14px_30px_rgba(25,118,210,0.12)]';

function dt(value: string): string {
  return new Date(value).toLocaleString();
}

function actionLabel(value: ActionFilter | LocalActionRecord['actionType']): string {
  if (value === 'DISPOSE') return 'Disposed';
  if (value === 'REPLACE') return 'Replaced';
  if (value === 'JUNK') return 'Junked';
  return 'All Records';
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

function mapOutboxAction(row: Awaited<ReturnType<typeof desktopDb.listOutboxItems>>[number]): LocalActionRecord | null {
  if (row.entity !== 'lpg_item_action') {
    return null;
  }
  const payload = row.payload ?? {};
  const actionTypeRaw = String(row.action || '').trim().toUpperCase();
  if (actionTypeRaw !== 'DISPOSE' && actionTypeRaw !== 'REPLACE' && actionTypeRaw !== 'JUNK') {
    return null;
  }
  const qty = Number(payload.qty);
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  const productId = typeof payload.product_id === 'string' ? payload.product_id : typeof payload.productId === 'string' ? payload.productId : '';
  const locationId = typeof payload.location_id === 'string' ? payload.location_id : typeof payload.locationId === 'string' ? payload.locationId : '';
  if (!productId || !locationId || !Number.isFinite(qty) || qty <= 0 || !reason) {
    return null;
  }
  return {
    id: row.id,
    branchId: typeof payload.branch_id === 'string' ? payload.branch_id : typeof payload.branchId === 'string' ? payload.branchId : '',
    branchCode: null,
    branchName: null,
    locationId,
    locationCode: null,
    locationName: null,
    productId,
    productSku: typeof payload.product_sku === 'string' ? payload.product_sku : typeof payload.productSku === 'string' ? payload.productSku : null,
    productName: typeof payload.product_name === 'string' ? payload.product_name : typeof payload.productName === 'string' ? payload.productName : null,
    actionType: actionTypeRaw,
    qty,
    reason,
    notes: typeof payload.notes === 'string' && payload.notes.trim() ? payload.notes.trim() : null,
    referenceActionId:
      typeof payload.reference_action_id === 'string'
        ? payload.reference_action_id
        : typeof payload.referenceActionId === 'string'
          ? payload.referenceActionId
          : null,
    createdByUserId:
      typeof payload.user_id === 'string'
        ? payload.user_id
        : typeof payload.userId === 'string'
          ? payload.userId
          : null,
    createdAt:
      typeof payload.created_at === 'string'
        ? payload.created_at
        : typeof payload.createdAt === 'string'
          ? payload.createdAt
          : row.created_at,
    updatedAt: row.updated_at,
    source: 'local',
    syncStatus: row.status
  };
}

function normalizeServerAction(row: DesktopLpgItemActionRecord): LocalActionRecord {
  return {
    ...row,
    source: 'server',
    syncStatus: 'synced'
  };
}

function dedupeActions(rows: LocalActionRecord[]): LocalActionRecord[] {
  const seen = new Map<string, LocalActionRecord>();
  for (const row of rows) {
    if (!seen.has(row.id)) {
      seen.set(row.id, row);
      continue;
    }
    const existing = seen.get(row.id)!;
    if (existing.source === 'local' && row.source !== 'local') {
      seen.set(row.id, row);
    }
  }
  return Array.from(seen.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function makeActionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lpg-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function parseComposerQty(value: string): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return parsed;
}

export function LpgServiceScreen({ appState, focusProductId = null, focusNonce = 0 }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const [catalog, setCatalog] = useState<DesktopCatalogProduct[]>([]);
  const [actions, setActions] = useState<LocalActionRecord[]>([]);
  const [query, setQuery] = useState('');
  const [focusedProductId, setFocusedProductId] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<ActionFilter>('DISPOSE');
  const [composerOpen, setComposerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composerType, setComposerType] = useState<ComposerType>('DISPOSE');
  const [referenceDisposeId, setReferenceDisposeId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [modalProductQuery, setModalProductQuery] = useState('');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('Record disposed items here. Junked and replaced entries must come from an existing disposed record.');

  const refresh = async (): Promise<void> => {
    if (!appState.setup.locationId) {
      setCatalog([]);
      setActions([]);
      return;
    }

    setLoading(true);
    setActionLoading(true);
    try {
      const [catalogRows, cachedActionRows, outboxRows] = await Promise.all([
        desktopMasterDataService.loadCatalog(appState.setup.locationId),
        desktopMasterDataService.loadLpgItemActions(appState.setup.branchId, appState.setup.locationId),
        desktopDb.listOutboxItems()
      ]);
      const lpgCatalog = catalogRows.filter((row) => row.isLpg);
      setCatalog(lpgCatalog);

      const localRows = outboxRows
        .filter((row) => row.entity === 'lpg_item_action' && (row.status === 'pending' || row.status === 'processing' || row.status === 'failed'))
        .map((row) => mapOutboxAction(row))
        .filter((row): row is LocalActionRecord => Boolean(row))
        .filter((row) => row.locationId === appState.setup.locationId);

      let serverRows: LocalActionRecord[] = [];
      try {
        const params = new URLSearchParams();
        params.set('location_id', appState.setup.locationId);
        params.set('limit', '150');
        const { response } = await desktopAuthService.authorizedFetch(
          appState,
          `${appState.setup.apiBaseUrl.replace(/\/$/, '')}/lpg-item-actions?${params.toString()}`
        );
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(detail || `Unable to load LPG item actions (${response.status})`);
        }
        serverRows = ((await response.json()) as DesktopLpgItemActionRecord[]).map((row) => normalizeServerAction(row));
      } catch (error) {
        serverRows = cachedActionRows.map((row) => ({ ...row, source: 'cached', syncStatus: 'synced' as const }));
        setMessage(error instanceof Error ? error.message : 'Showing cached LPG service records right now.');
      }

      setActions(dedupeActions([...localRows, ...serverRows]));
    } finally {
      setLoading(false);
      setActionLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [appState.setup.branchId, appState.setup.locationId]);

  useEffect(() => {
    if (saving) {
      desktopUi.setLoading({ visible: true, label: 'Saving LPG service record...' });
      return;
    }
    if (loading) {
      desktopUi.setLoading({ visible: true, label: 'Loading LPG service...' });
      return;
    }
    desktopUi.clearLoading();
  }, [desktopUi, loading, saving]);

  useEffect(() => {
    if (!focusProductId) {
      return;
    }
    setFocusedProductId(focusProductId);
    const match = catalog.find((product) => product.id === focusProductId);
    if (match) {
      setMessage(`${match.name} is now focused in LPG Service.`);
    }
  }, [focusNonce, focusProductId, catalog]);

  const productMap = useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog]);

  const counts = useMemo(
    () => ({
      dispose: actions.filter((row) => row.actionType === 'DISPOSE').length,
      replace: actions.filter((row) => row.actionType === 'REPLACE').length,
      junk: actions.filter((row) => row.actionType === 'JUNK').length
    }),
    [actions]
  );

  const actionMap = useMemo(() => new Map(actions.map((row) => [row.id, row])), [actions]);

  const selectedProduct = useMemo(
    () => catalog.find((product) => product.id === selectedProductId) ?? null,
    [catalog, selectedProductId]
  );

  const modalVisibleProducts = useMemo(() => {
    const search = modalProductQuery.trim().toLowerCase();
    return catalog.filter((row) => {
      if (!search) {
        return true;
      }
      return `${row.sku} ${row.name}`.toLowerCase().includes(search);
    });
  }, [catalog, modalProductQuery]);

  const disposedEntries = useMemo<DisposedEntryRow[]>(() => {
    const search = query.trim().toLowerCase();
    const usedByReference = new Map<string, number>();
    for (const row of actions) {
      if (!row.referenceActionId) {
        continue;
      }
      usedByReference.set(row.referenceActionId, (usedByReference.get(row.referenceActionId) ?? 0) + row.qty);
    }
    return actions
      .filter((row) => row.actionType === 'DISPOSE')
      .filter((row) => !focusedProductId || row.productId === focusedProductId)
      .filter((row) => {
        if (!search) {
          return true;
        }
        const product = productMap.get(row.productId);
        return `${row.productSku ?? product?.sku ?? ''} ${row.productName ?? product?.name ?? ''} ${row.reason} ${row.notes ?? ''}`
          .toLowerCase()
          .includes(search);
      })
      .map((row) => ({
        ...row,
        usedQty: usedByReference.get(row.id) ?? 0,
        availableQty: Math.max(0, row.qty - (usedByReference.get(row.id) ?? 0))
      }))
      .filter((row) => row.availableQty > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [actions, focusedProductId, productMap, query]);

  const selectedDisposedEntry = useMemo(() => {
    if (!referenceDisposeId) {
      return null;
    }
    return disposedEntries.find((row) => row.id === referenceDisposeId) ?? null;
  }, [disposedEntries, referenceDisposeId]);

  const historyRows = useMemo(() => {
    const search = query.trim().toLowerCase();
    return [...actions]
      .filter((row) => !focusedProductId || row.productId === focusedProductId)
      .filter((row) => {
        if (actionFilter !== 'ALL' && row.actionType !== actionFilter) {
          return false;
        }
        if (!search) {
          return true;
        }
        const product = productMap.get(row.productId);
        return `${row.productSku ?? product?.sku ?? ''} ${row.productName ?? product?.name ?? ''} ${row.reason} ${row.notes ?? ''} ${row.actionType}`
          .toLowerCase()
          .includes(search);
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [actionFilter, actions, focusedProductId, productMap, query]);

  const mainBlockTitle = useMemo(() => {
    if (actionFilter === 'DISPOSE') return 'Disposed Records';
    if (actionFilter === 'REPLACE') return 'Replaced Records';
    if (actionFilter === 'JUNK') return 'Junked Records';
    return 'All Records';
  }, [actionFilter]);

  const describeReference = (referenceActionId: string | null): string | null => {
    if (!referenceActionId) return null;
    const reference = actionMap.get(referenceActionId);
    if (!reference) return 'Linked to an earlier disposed record';
    const productName = reference.productName ?? productMap.get(reference.productId)?.name ?? 'Unknown item';
    return `From ${productName} disposed on ${dt(reference.createdAt)}`;
  };

  const openComposer = (type: ComposerType, referenceActionId?: string | null, productId?: string | null): void => {
    setComposerType(type);
    setReferenceDisposeId(referenceActionId ?? null);
    setSelectedProductId(productId ?? null);
    setModalProductQuery('');
    setQty('1');
    setReason('');
    setNotes('');
    setComposerOpen(true);
  };

  const stepComposerQty = (delta: number): void => {
    const current = parseComposerQty(qty);
    const maxQty = composerType === 'DISPOSE' ? null : selectedDisposedEntry?.availableQty ?? null;
    let next = Math.max(1, current + delta);
    if (maxQty !== null) {
      next = Math.min(next, Math.max(1, Math.trunc(maxQty)));
    }
    setQty(String(next));
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
    if (!selectedProduct || !appState.setup.locationId || saving) {
      return;
    }

    const parsedQty = Math.trunc(Number(qty));
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      desktopUi.showToast({ tone: 'error', message: 'Enter a valid quantity.' });
      return;
    }
    if (!reason.trim()) {
      desktopUi.showToast({ tone: 'error', message: 'Reason is required.' });
      return;
    }
    if (composerType !== 'DISPOSE' && !referenceDisposeId) {
      desktopUi.showToast({ tone: 'error', message: 'Choose a disposed entry first.' });
      return;
    }

    const actionId = makeActionId();
    const createdAt = new Date().toISOString();
    const payload: Record<string, unknown> = {
      id: actionId,
      product_id: selectedProduct.id,
      product_sku: selectedProduct.sku,
      product_name: selectedProduct.name,
      branch_id: appState.setup.branchId,
      location_id: appState.setup.locationId,
      location_name: appState.setup.locationLabel,
      qty: parsedQty,
      reason: reason.trim(),
      notes: notes.trim() || null,
      reference_action_id: referenceDisposeId ?? null,
      created_at: createdAt
    };

    setSaving(true);
    try {
      const actionName = composerType.toLowerCase();
      const { response } = await desktopAuthService.authorizedFetch(
        appState,
        `${appState.setup.apiBaseUrl.replace(/\/$/, '')}/lpg-item-actions/${actionName}`,
        {
          method: 'POST',
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(detail || `Unable to save LPG service action (${response.status})`);
      }

      const saved = normalizeServerAction((await response.json()) as DesktopLpgItemActionRecord);
      setActions((current) => dedupeActions([saved, ...current]));
      desktopUi.showToast({
        tone: 'success',
        message:
          composerType === 'DISPOSE'
            ? `${selectedProduct.name} disposed record was saved.`
            : composerType === 'REPLACE'
              ? `${selectedProduct.name} replacement was recorded.`
              : `${selectedProduct.name} junk note was recorded.`
      });
      closeComposer();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unable to save LPG item action.';
      if (shouldQueueOffline(messageText)) {
        await desktopDb.enqueueOutboxItem({
          id: actionId,
          entity: 'lpg_item_action',
          action: composerType.toLowerCase(),
          payload,
          idempotency_key: `idem-lpg-item-action-${actionId}`,
          created_at: createdAt
        });
        const queued: LocalActionRecord = {
          id: actionId,
          branchId: appState.setup.branchId,
          branchCode: null,
          branchName: appState.setup.branchLabel || null,
          locationId: appState.setup.locationId,
          locationCode: null,
          locationName: appState.setup.locationLabel || null,
          productId: selectedProduct.id,
          productSku: selectedProduct.sku,
          productName: selectedProduct.name,
          actionType: composerType,
          qty: parsedQty,
          reason: reason.trim(),
          notes: notes.trim() || null,
          referenceActionId: referenceDisposeId ?? null,
          createdByUserId: null,
          createdAt,
          updatedAt: createdAt,
          source: 'local',
          syncStatus: 'pending'
        };
        setActions((current) => dedupeActions([queued, ...current]));
        desktopUi.showToast({
          tone: 'success',
          message:
            composerType === 'DISPOSE'
              ? `${selectedProduct.name} was queued offline as disposed.`
              : composerType === 'REPLACE'
                ? `${selectedProduct.name} replacement was queued offline.`
                : `${selectedProduct.name} junk note was queued offline.`
        });
        closeComposer();
        return;
      }
      desktopUi.showToast({ tone: 'error', message: messageText });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <ScreenHeader
        routeId="lpg-service"
        title="LPG Service Records"
        description="Record disposed items here. Junked and replaced entries must come from an existing disposed record."
      />

      <section className={summaryStripClass}>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Disposed</span>
          <strong className={summaryValueClass}>{counts.dispose}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Replaced</span>
          <strong className={summaryValueClass}>{counts.replace}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Junked</span>
          <strong className={summaryValueClass}>{counts.junk}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>LPG Items</span>
          <strong className={summaryValueClass}>{catalog.length}</strong>
        </div>
      </section>

      <section className={`${shellCardClass} grid gap-5`}>
        <div className={searchRowClass}>
          <SearchField className="w-full" value={query} onChange={setQuery} placeholder="Search LPG item, reason, or notes" />
          <button className={`secondary-btn ${refreshButtonClass}`} type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['ALL', 'DISPOSE', 'JUNK', 'REPLACE'] as ActionFilter[]).map((value) => (
            <button key={value} type="button" className={`filter-chip ${actionFilter === value ? 'active' : ''}`} onClick={() => setActionFilter(value)}>
              {actionLabel(value)}
            </button>
          ))}
          <div className={topActionsClass}>
            <button className="primary-btn" type="button" onClick={() => openComposer('DISPOSE')} disabled={!appState.setup.locationId}>
              Disposed
            </button>
            <button className="secondary-btn" type="button" onClick={() => setHistoryOpen(true)}>
              Service History
            </button>
          </div>
        </div>

        {focusedProductId ? (
          <div className={`message-banner ${focusBannerClass}`}>
            <span>{productMap.get(focusedProductId)?.name ?? 'Focused LPG item'} is currently filtered here.</span>
            <button className="secondary-btn mini-btn" type="button" onClick={() => setFocusedProductId(null)}>
              Clear Focus
            </button>
          </div>
        ) : null}

        <div className={recordBlockClass}>
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">LPG service</div>
              <h3>{mainBlockTitle}</h3>
            </div>
          </div>

          {actionFilter === 'DISPOSE' ? (
            disposedEntries.length === 0 ? (
              <div className="empty-state">No disposed records found for this location.</div>
            ) : (
              <div className={serviceRecordListClass}>
                {disposedEntries.map((row) => {
                  const product = productMap.get(row.productId);
                  return (
                    <article key={row.id} className={serviceRecordCardClass}>
                      <div className={recordMainClass}>
                        <div className={recordHeadClass}>
                          <div className={recordHeadCopyClass}>
                            <strong>{row.productName ?? product?.name ?? row.productId}</strong>
                            <span>{(row.productSku ?? product?.sku ?? '-') + ` | EMPTY ${fmtNumber(product?.qtyEmpty ?? 0)}`}</span>
                          </div>
                        </div>
                        <div className={serviceRecordMetaClass}>
                          <span>Disposed x {fmtNumber(row.qty)}</span>
                          <span>{dt(row.createdAt)}</span>
                        </div>
                        <div className={serviceRecordCopyClass}>
                          <span>Reason: {row.reason}</span>
                          <span>Used: {fmtNumber(row.usedQty)} | Available: {fmtNumber(row.availableQty)}</span>
                          {row.syncStatus && row.syncStatus !== 'synced' ? <span>Pending Sync: {row.syncStatus.toUpperCase()}</span> : null}
                          {row.notes ? <span>Notes: {row.notes}</span> : null}
                        </div>
                      </div>
                      <div className={serviceRecordSideClass}>
                        <div className="stock-pill out">Disposed</div>
                        <div className={entryActionsClass}>
                          <button className={`primary-btn ${entryButtonClass}`} type="button" onClick={() => openComposer('REPLACE', row.id, row.productId)} disabled={row.availableQty <= 0}>
                            Replace
                          </button>
                          <button className={`secondary-btn ${entryButtonClass}`} type="button" onClick={() => openComposer('JUNK', row.id, row.productId)} disabled={row.availableQty <= 0}>
                            Junk
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )
          ) : historyRows.length === 0 ? (
            <div className="empty-state">No records found for this filter.</div>
          ) : (
            <div className={serviceRecordListClass}>
              {historyRows.map((row) => {
                const product = productMap.get(row.productId);
                return (
                  <article key={`main-history-${row.id}`} className={serviceRecordCardClass}>
                    <div className={recordMainClass}>
                      <div className={recordHeadClass}>
                        <div className={recordHeadCopyClass}>
                          <strong>{row.productName ?? product?.name ?? row.productId}</strong>
                          <span>{`${row.productSku ?? product?.sku ?? '-'} | ${actionLabel(row.actionType)} x ${fmtNumber(row.qty)}`}</span>
                        </div>
                      </div>
                      <div className={serviceRecordMetaClass}>
                        <span>{dt(row.createdAt)}</span>
                        {describeReference(row.referenceActionId) ? <span>{describeReference(row.referenceActionId)}</span> : null}
                      </div>
                      <div className={serviceRecordCopyClass}>
                        <span>Reason: {row.reason}</span>
                        {row.syncStatus && row.syncStatus !== 'synced' ? <span>Pending Sync: {row.syncStatus.toUpperCase()}</span> : null}
                        {row.notes ? <span>Notes: {row.notes}</span> : null}
                      </div>
                    </div>
                    <div className={serviceRecordSideClass}>
                      <div className={`stock-pill ${row.actionType === 'REPLACE' ? 'good' : row.actionType === 'JUNK' ? 'low' : 'out'}`}>
                        {actionLabel(row.actionType)}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {composerOpen ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={modalCardClass}>
            <div className="desktop-sheet-handle" aria-hidden="true" />
            <div className={`${modalToolbarClass} panel-head desktop-sheet-head`}>
              <div>
                <div className="eyebrow">LPG service action</div>
                <h3>{actionLabel(composerType)}</h3>
              </div>
              <button className="secondary-btn mini-btn" type="button" onClick={closeComposer}>
                Close
              </button>
            </div>

            <div className={sheetContentClass}>
              <p className={sheetCopyClass}>
                {composerType === 'DISPOSE'
                  ? 'Choose the LPG item here, then save the disposed record.'
                  : composerType === 'REPLACE'
                    ? 'This records a replacement from the selected disposed record.'
                    : 'This records junk against the selected disposed record only.'}
              </p>

              {referenceDisposeId ? <div className="message-banner">Disposed Record: {describeReference(referenceDisposeId) ?? referenceDisposeId}</div> : null}

              {composerType === 'DISPOSE' ? (
                <div className={composerStackClass}>
                  <SearchField className="w-full" value={modalProductQuery} onChange={setModalProductQuery} placeholder="Search LPG item" />
                  <div className={productListClass}>
                    {modalVisibleProducts.map((row) => {
                      const active = selectedProductId === row.id;
                      return (
                        <button
                          key={row.id}
                          type="button"
                          className={`${productCardClass} ${active ? productCardSelectedClass : ''}`}
                          onClick={() => setSelectedProductId(row.id)}
                        >
                          <div>
                            <strong className={selectedProductTitleClass}>{row.name}</strong>
                            <span className={selectedProductCopyClass}>{row.sku}</span>
                          </div>
                          <span className={selectedProductCopyClass}>EMPTY {fmtNumber(row.qtyEmpty)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : selectedProduct ? (
                <div className={selectedProductClass}>
                  <strong className={selectedProductTitleClass}>{selectedProduct.name}</strong>
                  <span className={selectedProductCopyClass}>{selectedProduct.sku}</span>
                </div>
              ) : null}

              <div className={composerFormClass}>
                <div className={qtyCardClass}>
                  <div className={qtyHeadClass}>
                    <span className={qtyHeadLabelClass}>Quantity</span>
                    {composerType !== 'DISPOSE' && selectedDisposedEntry ? (
                      <small className={qtyHeadCopyClass}>Available {fmtNumber(selectedDisposedEntry.availableQty)}</small>
                    ) : null}
                  </div>
                  <div className={qtyRailClass}>
                    <button className={qtyRailButtonClass} type="button" onClick={() => stepComposerQty(-1)} aria-label="Decrease quantity">
                      -
                    </button>
                    <span className={qtyValueClass}>{parseComposerQty(qty)}</span>
                    <button className={qtyRailButtonClass} type="button" onClick={() => stepComposerQty(1)} aria-label="Increase quantity">
                      +
                    </button>
                  </div>
                </div>

                <label className="full-width-field">
                  <span>Reason</span>
                  <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason" />
                </label>
                <label className="full-width-field">
                  <span>Notes (optional)</span>
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notes (optional)" />
                </label>
              </div>

              <div className={modalActionRowClass}>
                <button className="secondary-btn" type="button" onClick={closeComposer}>
                  Cancel
                </button>
                <button className="primary-btn" type="button" onClick={() => void submitAction()} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Action'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {historyOpen ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={modalCardClass}>
            <div className="desktop-sheet-handle" aria-hidden="true" />
            <div className={`${modalToolbarClass} panel-head desktop-sheet-head`}>
              <div>
                <div className="eyebrow">LPG service history</div>
                <h3>Service History</h3>
              </div>
              <button className="secondary-btn mini-btn" type="button" onClick={() => setHistoryOpen(false)}>
                Close
              </button>
            </div>
            <div className={sheetContentClass}>
              <p className={sheetCopyClass}>Filter: {actionLabel(actionFilter)}</p>
              {actionLoading ? (
                <div className="empty-state">Loading history...</div>
              ) : historyRows.length === 0 ? (
                <div className="empty-state">No action history found for this filter.</div>
              ) : (
                <div className={serviceRecordListClass}>
                  {historyRows.map((row) => {
                    const product = productMap.get(row.productId);
                    return (
                      <article key={`history-${row.id}`} className={serviceRecordCardClass}>
                        <div className={recordMainClass}>
                          <div className={recordHeadClass}>
                            <div className={recordHeadCopyClass}>
                              <strong>{row.productName ?? product?.name ?? row.productId}</strong>
                              <span>{`${row.productSku ?? product?.sku ?? '-'} | ${actionLabel(row.actionType)} x ${fmtNumber(row.qty)}`}</span>
                            </div>
                          </div>
                          <div className={serviceRecordMetaClass}>
                            <span>{dt(row.createdAt)}</span>
                            {describeReference(row.referenceActionId) ? <span>{describeReference(row.referenceActionId)}</span> : null}
                          </div>
                          <div className={serviceRecordCopyClass}>
                            <span>Reason: {row.reason}</span>
                            {row.syncStatus && row.syncStatus !== 'synced' ? <span>Pending Sync: {row.syncStatus.toUpperCase()}</span> : null}
                            {row.notes ? <span>Notes: {row.notes}</span> : null}
                          </div>
                        </div>
                        <div className={serviceRecordSideClass}>
                          <div className={`stock-pill ${row.actionType === 'REPLACE' ? 'good' : row.actionType === 'JUNK' ? 'low' : 'out'}`}>
                            {actionLabel(row.actionType)}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="message-banner">{message}</div>
    </div>
  );
}

function fmtNumber(value: number): string {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}
