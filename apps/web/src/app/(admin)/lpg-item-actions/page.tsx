'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { toastError, toastSuccess } from '../../../lib/web-toast';

type BranchRecord = { id: string; code: string; name: string; isActive: boolean };
type LocationRecord = { id: string; branchId?: string | null; code: string; name: string; isActive: boolean };
type ProductRecord = {
  id: string;
  sku: string;
  name: string;
  isLpg: boolean;
  cylinderTypeId: string | null;
  isActive: boolean;
};
type FullEmptyRow = {
  location_id: string;
  location_name: string;
  product_id: string;
  item_code: string;
  product_name: string;
  qty_full: number;
  qty_empty: number;
};
type LpgItemActionRow = {
  id: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  locationId: string;
  locationCode: string | null;
  locationName: string | null;
  productId: string;
  productSku: string | null;
  productName: string | null;
  actionType: 'DISPOSE' | 'REPLACE' | 'JUNK';
  qty: number;
  reason: string;
  notes: string | null;
  referenceActionId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};
type LpgItemActionSummary = {
  counts: { dispose: number; replace: number; junk: number };
  qty: { disposed: number; replaced: number; junked: number };
};

function dt(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function actionLabel(value: LpgItemActionRow['actionType'] | null): string {
  if (value === 'DISPOSE') return 'Record Dispose';
  if (value === 'REPLACE') return 'Record Replace';
  return 'Record Junk';
}

export default function LpgItemActionsPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'DISPOSED' | 'HISTORY'>('DISPOSED');
  const [actionTypeFilter, setActionTypeFilter] = useState<'ALL' | 'DISPOSE' | 'JUNK' | 'REPLACE'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [locationFilter, setLocationFilter] = useState('');
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [fullEmptyRows, setFullEmptyRows] = useState<FullEmptyRow[]>([]);
  const [actions, setActions] = useState<LpgItemActionRow[]>([]);
  const [summary, setSummary] = useState<LpgItemActionSummary>({
    counts: { dispose: 0, replace: 0, junk: 0 },
    qty: { disposed: 0, replaced: 0, junked: 0 }
  });
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<null | 'DISPOSE' | 'REPLACE' | 'JUNK'>(null);
  const [referenceActionId, setReferenceActionId] = useState<string | null>(null);
  const [modalProductQuery, setModalProductQuery] = useState('');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const filteredLocations = useMemo(
    () =>
      locations.filter((row) =>
        branchFilter === 'ALL' ? true : (row.branchId ?? '') === branchFilter
      ),
    [branchFilter, locations]
  );

  const productMap = useMemo(() => {
    const next = new Map<string, ProductRecord>();
    for (const row of products) {
      next.set(row.id, row);
    }
    return next;
  }, [products]);

  const visibleProducts = useMemo(() => {
    const search = query.trim().toLowerCase();
    return products
      .filter((row) => row.isLpg && row.cylinderTypeId && row.isActive)
      .filter((row) => {
        if (!search) return true;
        return `${row.sku} ${row.name}`.toLowerCase().includes(search);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, query]);

  const modalVisibleProducts = useMemo(() => {
    const search = modalProductQuery.trim().toLowerCase();
    return products
      .filter((row) => row.isLpg && row.cylinderTypeId && row.isActive)
      .filter((row) => {
        if (!search) return true;
        return `${row.sku} ${row.name}`.toLowerCase().includes(search);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [modalProductQuery, products]);

  const selectedProduct = useMemo(
    () => products.find((row) => row.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );

  const selectedBalance = useMemo(() => {
    if (!selectedProduct || !locationFilter) {
      return { qty_full: 0, qty_empty: 0 };
    }
    return (
      fullEmptyRows.find(
        (row) => row.product_id === selectedProduct.id && row.location_id === locationFilter
      ) ?? { qty_full: 0, qty_empty: 0 }
    );
  }, [fullEmptyRows, locationFilter, selectedProduct]);

  const visibleActions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return actions
      .filter((row) => {
        if (locationFilter && row.locationId !== locationFilter) return false;
        if (actionTypeFilter !== 'ALL' && row.actionType !== actionTypeFilter) return false;
        if (!search) return true;
        const product = productMap.get(row.productId);
        return `${row.productSku ?? product?.sku ?? ''} ${row.productName ?? product?.name ?? ''} ${row.reason} ${row.notes ?? ''} ${row.actionType}`
          .toLowerCase()
          .includes(search);
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) * -1);
  }, [actionTypeFilter, actions, locationFilter, productMap, query]);

  const disposedEntries = useMemo(() => {
    const usedByReference = new Map<string, number>();
    for (const row of visibleActions) {
      if (!row.referenceActionId) continue;
      usedByReference.set(row.referenceActionId, (usedByReference.get(row.referenceActionId) ?? 0) + row.qty);
    }
    return visibleActions
      .filter((row) => row.actionType === 'DISPOSE')
      .map((row) => ({
        ...row,
        usedQty: usedByReference.get(row.id) ?? 0,
        availableQty: Math.max(0, row.qty - (usedByReference.get(row.id) ?? 0))
      }));
  }, [visibleActions]);

  async function loadAll(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '180');
      if (branchFilter !== 'ALL') {
        params.set('branch_id', branchFilter);
      }
      if (locationFilter) {
        params.set('location_id', locationFilter);
      }

      const [branchRows, locationRows, productRows, stockRows, actionRows, summaryRow] =
        await Promise.all([
          apiRequest<BranchRecord[]>('/master-data/branches'),
          apiRequest<LocationRecord[]>('/master-data/locations'),
          apiRequest<ProductRecord[]>('/master-data/products'),
          apiRequest<{ rows: FullEmptyRow[] }>('/reports/inventory/full-empty-by-product'),
          apiRequest<LpgItemActionRow[]>(`/lpg-item-actions?${params.toString()}`),
          apiRequest<LpgItemActionSummary>(`/lpg-item-actions/summary?${params.toString()}`)
        ]);

      setBranches(branchRows.filter((row) => row.isActive));
      setLocations(locationRows.filter((row) => row.isActive));
      setProducts(productRows);
      setFullEmptyRows(stockRows.rows);
      setActions(actionRows);
      setSummary(summaryRow);
      if (!locationFilter) {
        const firstLocation = locationRows.find((row) =>
          branchFilter === 'ALL' ? row.isActive : row.isActive && (row.branchId ?? '') === branchFilter
        );
        setLocationFilter(firstLocation?.id ?? '');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load LPG item actions');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter, locationFilter]);

  async function submitAction(): Promise<void> {
    if (!selectedProduct || !locationFilter || !actionModal || saving) {
      return;
    }
    const parsedQty = Math.trunc(Number(qty));
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      toastError('Invalid qty', { description: 'Enter a positive whole-number quantity.' });
      return;
    }
    if (!reason.trim()) {
      toastError('Reason required', { description: 'Please add a reason for this item service action.' });
      return;
    }
    if (actionModal !== 'DISPOSE' && !referenceActionId) {
      toastError('Disposed entry required', {
        description: 'Choose a disposed entry before recording replace or junk.'
      });
      return;
    }
    if (actionModal === 'DISPOSE' && !selectedProduct) {
      toastError('LPG item required', {
        description: 'Choose the LPG item inside the dispose dialog first.'
      });
      return;
    }

    setSaving(true);
    try {
      await apiRequest(`/lpg-item-actions/${actionModal.toLowerCase()}`, {
        method: 'POST',
        body: {
          product_id: selectedProduct.id,
          location_id: locationFilter,
          branch_id: branchFilter !== 'ALL' ? branchFilter : undefined,
          qty: parsedQty,
          reason: reason.trim(),
          notes: notes.trim() || undefined,
          reference_action_id: referenceActionId ?? undefined
        }
      });
      toastSuccess(`${actionLabel(actionModal)} saved`, {
        description: `${selectedProduct.name} was updated successfully.`
      });
      setActionModal(null);
      setReferenceActionId(null);
      setSelectedProductId(null);
      setModalProductQuery('');
      setQty('1');
      setReason('');
      setNotes('');
      await loadAll();
    } catch (caught) {
      toastError(actionLabel(actionModal), {
        description: caught instanceof Error ? caught.message : 'Unable to save action.'
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="space-y-5" data-tour="lpg-item-actions-root">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              LPG Item Service
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Record item-level dispose, replace, and junk actions against LPG empty stock.
            </p>
          </div>
          <button
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold dark:border-slate-600 dark:bg-slate-900"
            onClick={() => void loadAll()}
            type="button"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4" data-tour="lpg-item-actions-filters">
          <label className="text-sm font-semibold">
            Branch
            <select
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={branchFilter}
              onChange={(event) => {
                setBranchFilter(event.target.value);
                setLocationFilter('');
                setSelectedProductId(null);
              }}
            >
              <option value="ALL">All Branches</option>
              {branches.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} ({row.code})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold">
            Location
            <select
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
            >
              <option value="">Choose location</option>
              {filteredLocations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name} ({row.code})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold md:col-span-2">
            Search Records
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              placeholder="Search by item, action, or reason"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
            <p className="text-xs uppercase tracking-wide text-slate-500">Disposed</p>
            <p className="mt-1 text-xl font-bold">{summary.counts.dispose}</p>
            <p className="text-xs text-slate-500">Qty {summary.qty.disposed}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
            <p className="text-xs uppercase tracking-wide text-slate-500">Replaced</p>
            <p className="mt-1 text-xl font-bold">{summary.counts.replace}</p>
            <p className="text-xs text-slate-500">Qty {summary.qty.replaced}</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
            <p className="text-xs uppercase tracking-wide text-slate-500">Junked</p>
            <p className="mt-1 text-xl font-bold">{summary.counts.junk}</p>
            <p className="text-xs text-slate-500">Qty {summary.qty.junked}</p>
          </article>
        </div>
      </section>

      {error ? (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
          {error}
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex justify-start">
          <button
            className="rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={!locationFilter}
            onClick={() => {
              setActionModal('DISPOSE');
              setReferenceActionId(null);
              setSelectedProductId(null);
              setModalProductQuery('');
            }}
            type="button"
          >
            {actionLabel('DISPOSE')}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {([
            { key: 'DISPOSED', label: 'Disposed Entries' },
            { key: 'HISTORY', label: 'Action History' }
          ] as const).map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'
                }`}
                onClick={() => setActiveTab(tab.key)}
                type="button"
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {([
            { key: 'ALL', label: 'All' },
            { key: 'DISPOSE', label: 'Disposed' },
            { key: 'JUNK', label: 'Junked' },
            { key: 'REPLACE', label: 'Replaced' }
          ] as const).map((chip) => {
            const active = actionTypeFilter === chip.key;
            return (
              <button
                key={chip.key}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-sky-600 text-white'
                    : 'border border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300'
                }`}
                onClick={() => setActionTypeFilter(chip.key)}
                type="button"
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'DISPOSED' ? (
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Disposed Entries
            </h3>
            <div className="mt-3 space-y-2">
              {!locationFilter ? (
                <p className="text-sm text-slate-500">Choose a location first.</p>
              ) : disposedEntries.length === 0 ? (
                <p className="text-sm text-slate-500">No disposed entries found for this filter.</p>
              ) : (
                disposedEntries.map((row) => {
                  const stock =
                    fullEmptyRows.find(
                      (entry) => entry.product_id === row.productId && entry.location_id === row.locationId
                    ) ?? null;
                  return (
                    <div
                      key={`dispose-${row.id}`}
                      className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                    >
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        {row.productName ?? productMap.get(row.productId)?.name ?? row.productId}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {(row.productSku ?? productMap.get(row.productId)?.sku ?? '-')} • EMPTY {stock?.qty_empty ?? 0}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {dt(row.createdAt)} • Used {row.usedQty} • Available {row.availableQty}
                      </p>
                      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{row.reason}</p>
                      {row.notes ? (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Notes: {row.notes}
                        </p>
                      ) : null}
                      <div className="mt-3 flex gap-2">
                        <button
                          className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-400"
                          disabled={row.availableQty <= 0}
                          onClick={() => {
                            setActionModal('REPLACE');
                            setReferenceActionId(row.id);
                            setSelectedProductId(row.productId);
                          }}
                          type="button"
                        >
                          {actionLabel('REPLACE')}
                        </button>
                        <button
                          className="flex-1 rounded-xl bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:bg-slate-400"
                          disabled={row.availableQty <= 0}
                          onClick={() => {
                            setActionModal('JUNK');
                            setReferenceActionId(row.id);
                            setSelectedProductId(row.productId);
                          }}
                          type="button"
                        >
                          {actionLabel('JUNK')}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </article>
        ) : (
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Action History
            </h3>
            <div className="mt-3 space-y-2">
              {!locationFilter ? (
                <p className="text-sm text-slate-500">Choose a location first.</p>
              ) : visibleActions.length === 0 ? (
                <p className="text-sm text-slate-500">No service history found for this filter.</p>
              ) : (
                visibleActions.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {row.productName ?? productMap.get(row.productId)?.name ?? row.productId} • {row.actionType} x {row.qty}
                        </p>
                        <p className="text-xs text-slate-500">
                          {(row.productSku ?? productMap.get(row.productId)?.sku ?? '-')} • {row.locationName ?? row.locationCode ?? row.locationId} • {dt(row.createdAt)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                      {row.reason}
                    </p>
                    {row.notes ? (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Notes: {row.notes}
                      </p>
                    ) : null}
                    {row.referenceActionId ? (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        From Dispose: {row.referenceActionId}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </article>
        )}
      </section>

      {actionModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {actionLabel(actionModal)}
                </h2>
                {selectedProduct ? (
                  <p className="text-sm text-slate-500">
                    {selectedProduct.name} • {selectedBalance.qty_empty} empty on hand
                  </p>
                ) : null}
                {referenceActionId ? (
                  <p className="text-xs text-slate-500">Disposed Reference: {referenceActionId}</p>
                ) : null}
              </div>
              <button
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold dark:border-slate-600"
                onClick={() => setActionModal(null)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {actionModal === 'DISPOSE' ? (
                <label className="block text-sm font-semibold">
                  LPG Item
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                    placeholder="Search by item code or product name"
                    value={modalProductQuery}
                    onChange={(event) => setModalProductQuery(event.target.value)}
                  />
                  <div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                    {modalVisibleProducts.map((row) => {
                      const stock =
                        fullEmptyRows.find(
                          (entry) => entry.product_id === row.id && entry.location_id === locationFilter
                        ) ?? null;
                      const active = selectedProductId === row.id;
                      return (
                        <button
                          key={row.id}
                          className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${
                            active
                              ? 'border-sky-500 bg-sky-50 dark:border-sky-400 dark:bg-sky-950/30'
                              : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
                          }`}
                          onClick={() => setSelectedProductId(row.id)}
                          type="button"
                        >
                          <span>
                            <span className="block font-semibold text-slate-900 dark:text-slate-100">{row.name}</span>
                            <span className="block text-xs text-slate-500">{row.sku}</span>
                          </span>
                          <span className="text-xs text-slate-500">EMPTY {stock?.qty_empty ?? 0}</span>
                        </button>
                      );
                    })}
                  </div>
                </label>
              ) : selectedProduct ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800/60">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{selectedProduct.name}</p>
                  <p className="text-xs text-slate-500">{selectedProduct.sku}</p>
                </div>
              ) : null}

              <label className="block text-sm font-semibold">
                Quantity
                <input
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                  inputMode="numeric"
                  value={qty}
                  onChange={(event) => setQty(event.target.value)}
                />
              </label>

              <label className="block text-sm font-semibold">
                Reason
                <input
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>

              <label className="block text-sm font-semibold">
                Notes
                <textarea
                  className="mt-1 min-h-[96px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold dark:border-slate-600"
                onClick={() => {
                  setActionModal(null);
                  setReferenceActionId(null);
                  setSelectedProductId(null);
                  setModalProductQuery('');
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
                disabled={saving}
                onClick={() => void submitAction()}
                type="button"
              >
                {saving ? 'Saving...' : 'Save Action'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
