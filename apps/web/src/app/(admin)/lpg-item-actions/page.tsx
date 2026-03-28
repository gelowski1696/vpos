'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';

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

const PAGE_SIZE = 15;

function dt(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function toSinceValue(value: string): string | undefined {
  if (!value.trim()) return undefined;
  return `${value.trim()}T00:00:00.000Z`;
}

function toUntilValue(value: string): string | undefined {
  if (!value.trim()) return undefined;
  return `${value.trim()}T23:59:59.999Z`;
}

function actionLabel(value: LpgItemActionRow['actionType'] | null): string {
  if (value === 'DISPOSE') return 'Disposed';
  if (value === 'REPLACE') return 'Replaced';
  return 'Junked';
}

export default function LpgItemActionsPage(): JSX.Element {
  const [actionTypeFilter, setActionTypeFilter] = useState<'ALL' | 'DISPOSE' | 'JUNK' | 'REPLACE'>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [locationFilter, setLocationFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateUntil, setDateUntil] = useState('');
  const [page, setPage] = useState(1);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [fullEmptyRows, setFullEmptyRows] = useState<FullEmptyRow[]>([]);
  const [actions, setActions] = useState<LpgItemActionRow[]>([]);
  const [summary, setSummary] = useState<LpgItemActionSummary>({
    counts: { dispose: 0, replace: 0, junk: 0 },
    qty: { disposed: 0, replaced: 0, junked: 0 }
  });

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

  const actionMap = useMemo(() => {
    const next = new Map<string, LpgItemActionRow>();
    for (const row of actions) {
      next.set(row.id, row);
    }
    return next;
  }, [actions]);

  const pagedActions = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return visibleActions.slice(start, start + PAGE_SIZE);
  }, [page, visibleActions]);

  const totalPages = Math.max(1, Math.ceil(visibleActions.length / PAGE_SIZE));

  const describeReference = (referenceActionId: string | null): string | null => {
    if (!referenceActionId) return null;
    const reference = actionMap.get(referenceActionId);
    if (!reference) return 'Linked to an earlier disposed record';
    const productName =
      reference.productName ?? productMap.get(reference.productId)?.name ?? 'Unknown item';
    return `From ${productName} disposed on ${dt(reference.createdAt)}`;
  };

  async function loadAll(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '500');
      if (branchFilter !== 'ALL') {
        params.set('branch_id', branchFilter);
      }
      if (locationFilter) {
        params.set('location_id', locationFilter);
      }
      const since = toSinceValue(dateFrom);
      const until = toUntilValue(dateUntil);
      if (since) {
        params.set('since', since);
      }
      if (until) {
        params.set('until', until);
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
  }, [branchFilter, locationFilter, dateFrom, dateUntil]);

  useEffect(() => {
    setPage(1);
  }, [actionTypeFilter, query, branchFilter, locationFilter, dateFrom, dateUntil]);

  return (
    <main className="space-y-5" data-tour="lpg-item-actions-root">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              LPG Service Records
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Review disposed, replaced, and junked LPG item records.
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Web view is records-only.
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

        <div className="mt-4 grid gap-3 md:grid-cols-6" data-tour="lpg-item-actions-filters">
          <label className="text-sm font-semibold">
            Branch
            <select
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={branchFilter}
              onChange={(event) => {
                setBranchFilter(event.target.value);
                setLocationFilter('');
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

          <label className="text-sm font-semibold">
            From Date
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </label>

          <label className="text-sm font-semibold">
            To Date
            <input
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              type="date"
              value={dateUntil}
              onChange={(event) => setDateUntil(event.target.value)}
            />
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
        <div className="flex flex-wrap items-center gap-2">
          {([
            { key: 'ALL', label: 'All Records' },
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

        {loading ? (
          <article className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-400">
            Loading LPG service records...
          </article>
        ) : (
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Service History
            </h3>
            <div className="mt-3 space-y-2">
              {!locationFilter ? (
                <p className="text-sm text-slate-500">Choose a location first.</p>
              ) : visibleActions.length === 0 ? (
                <p className="text-sm text-slate-500">No service history found for this filter.</p>
              ) : (
                pagedActions.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {row.productName ?? productMap.get(row.productId)?.name ?? row.productId} - {actionLabel(row.actionType)} x {row.qty}
                        </p>
                        <p className="text-xs text-slate-500">
                          {(row.productSku ?? productMap.get(row.productId)?.sku ?? '-')} - {row.locationName ?? row.locationCode ?? row.locationId} - {dt(row.createdAt)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{row.reason}</p>
                    {row.notes ? (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Notes: {row.notes}
                      </p>
                    ) : null}
                    {describeReference(row.referenceActionId) ? (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {describeReference(row.referenceActionId)}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            {visibleActions.length > PAGE_SIZE ? (
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm dark:border-slate-700">
                <p className="text-slate-500 dark:text-slate-400">
                  Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, visibleActions.length)} of {visibleActions.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    type="button"
                  >
                    Previous
                  </button>
                  <span className="text-slate-600 dark:text-slate-300">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    type="button"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        )}
      </section>
    </main>
  );
}
