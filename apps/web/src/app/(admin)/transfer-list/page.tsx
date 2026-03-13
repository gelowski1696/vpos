'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiRequest } from '../../../lib/api-client';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type LocationRecord = {
  id: string;
  code: string;
  name: string;
  branchId: string | null;
  type: 'BRANCH_STORE' | 'BRANCH_WAREHOUSE' | 'TRUCK' | 'PERSONNEL';
  isActive: boolean;
};

type ProductRecord = {
  id: string;
  sku: string;
  name: string;
};

type TransferRow = {
  id: string;
  source_location_id: string;
  destination_location_id: string;
  shift_id?: string | null;
  requested_by_user_id: string;
  status: 'CREATED' | 'APPROVED' | 'POSTED' | 'REVERSED';
  transfer_mode?:
    | 'SUPPLIER_RESTOCK_IN'
    | 'SUPPLIER_RESTOCK_OUT'
    | 'INTER_STORE_TRANSFER'
    | 'STORE_TO_WAREHOUSE'
    | 'WAREHOUSE_TO_STORE'
    | 'GENERAL';
  supplier_id?: string | null;
  supplier_name?: string | null;
  source_location_label?: string | null;
  destination_location_label?: string | null;
  lines: Array<{ product_id: string; qty_full: number; qty_empty: number }>;
  approval_note?: string;
  posted_at?: string;
  created_at: string;
  updated_at: string;
};

function fmtDateTime(value: string | null | undefined): string {
  if (!value) {
    return 'N/A';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function fmtQty(value: number): string {
  return Number(value).toFixed(4).replace(/\.?0+$/, '');
}

function modeLabel(value: TransferRow['transfer_mode']): string {
  switch (value) {
    case 'SUPPLIER_RESTOCK_IN':
      return 'Supplier Restock In';
    case 'SUPPLIER_RESTOCK_OUT':
      return 'Supplier Return Out';
    case 'INTER_STORE_TRANSFER':
      return 'Inter-Store Transfer';
    case 'STORE_TO_WAREHOUSE':
      return 'Store to Warehouse';
    case 'WAREHOUSE_TO_STORE':
      return 'Warehouse to Store';
    default:
      return 'General Transfer';
  }
}

function deriveModeFromLocations(
  source: LocationRecord | undefined,
  destination: LocationRecord | undefined
): TransferRow['transfer_mode'] {
  const sourceType = source?.type ?? '';
  const destinationType = destination?.type ?? '';
  if (sourceType === 'BRANCH_STORE' && destinationType === 'BRANCH_STORE') {
    return 'INTER_STORE_TRANSFER';
  }
  if (sourceType === 'BRANCH_STORE' && destinationType === 'BRANCH_WAREHOUSE') {
    return 'STORE_TO_WAREHOUSE';
  }
  if (sourceType === 'BRANCH_WAREHOUSE' && destinationType === 'BRANCH_STORE') {
    return 'WAREHOUSE_TO_STORE';
  }
  return 'GENERAL';
}

function statusBadgeClass(status: TransferRow['status']): string {
  if (status === 'POSTED') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  }
  if (status === 'APPROVED') {
    return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
  }
  if (status === 'REVERSED') {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  }
  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
}

export default function TransferListPage(): JSX.Element {
  const searchParams = useSearchParams();
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TransferRow['status']>('ALL');
  const [modeFilter, setModeFilter] = useState<'ALL' | NonNullable<TransferRow['transfer_mode']>>('ALL');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<TransferRow | null>(null);
  const [urlFiltersApplied, setUrlFiltersApplied] = useState(false);
  const [transferDeepLinkConsumed, setTransferDeepLinkConsumed] = useState(false);

  const deepLinkTransferId = searchParams.get('transfer_id')?.trim() ?? '';
  const deepLinkStatus = searchParams.get('status')?.trim().toUpperCase() ?? '';
  const deepLinkMode = searchParams.get('transfer_mode')?.trim().toUpperCase() ?? '';
  const deepLinkBranchId = searchParams.get('branch_id')?.trim() ?? '';
  const deepLinkSince = searchParams.get('since')?.trim() ?? '';
  const deepLinkUntil = searchParams.get('until')?.trim() ?? '';

  const locationById = useMemo(() => new Map(locations.map((row) => [row.id, row])), [locations]);
  const productByRef = useMemo(() => {
    const map = new Map<string, ProductRecord>();
    for (const product of products) {
      map.set(product.id, product);
      map.set(product.sku, product);
    }
    return map;
  }, [products]);

  async function loadMasterData(): Promise<void> {
    const [branchResult, locationResult, productResult] = await Promise.allSettled([
      apiRequest<BranchRecord[]>('/master-data/branches'),
      apiRequest<LocationRecord[]>('/master-data/locations'),
      apiRequest<ProductRecord[]>('/master-data/products')
    ]);
    setBranches(branchResult.status === 'fulfilled' ? branchResult.value.filter((row) => row.isActive) : []);
    setLocations(locationResult.status === 'fulfilled' ? locationResult.value : []);
    setProducts(productResult.status === 'fulfilled' ? productResult.value : []);
  }

  async function loadTransfers(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (branchFilter !== 'ALL') {
        params.set('branch_id', branchFilter);
      }
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }
      if (modeFilter !== 'ALL') {
        params.set('transfer_mode', modeFilter);
      }
      if (since.trim()) {
        params.set('since', new Date(`${since}T00:00:00.000`).toISOString());
      }
      if (until.trim()) {
        params.set('until', new Date(`${until}T23:59:59.999`).toISOString());
      }
      params.set('limit', '500');
      const query = params.toString();
      const data = await apiRequest<TransferRow[]>(query ? `/transfers?${query}` : '/transfers');
      setRows(data);
      if (!transferDeepLinkConsumed && deepLinkTransferId) {
        const found = data.find((row) => row.id === deepLinkTransferId);
        if (found) {
          setSelectedTransfer(found);
        } else {
          try {
            const transfer = await apiRequest<TransferRow>(`/transfers/${encodeURIComponent(deepLinkTransferId)}`);
            setSelectedTransfer(transfer);
          } catch {
            // Keep page usable even when the target transfer is not found.
          }
        }
        setTransferDeepLinkConsumed(true);
      }
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : 'Failed to load transfers');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMasterData();
  }, []);

  useEffect(() => {
    if (!deepLinkTransferId) {
      setTransferDeepLinkConsumed(true);
      return;
    }
    setTransferDeepLinkConsumed(false);
  }, [deepLinkTransferId]);

  useEffect(() => {
    if (urlFiltersApplied) {
      return;
    }
    if (
      deepLinkStatus === 'CREATED' ||
      deepLinkStatus === 'APPROVED' ||
      deepLinkStatus === 'POSTED' ||
      deepLinkStatus === 'REVERSED'
    ) {
      setStatusFilter(deepLinkStatus);
    }
    if (
      deepLinkMode === 'SUPPLIER_RESTOCK_IN' ||
      deepLinkMode === 'SUPPLIER_RESTOCK_OUT' ||
      deepLinkMode === 'INTER_STORE_TRANSFER' ||
      deepLinkMode === 'STORE_TO_WAREHOUSE' ||
      deepLinkMode === 'WAREHOUSE_TO_STORE' ||
      deepLinkMode === 'GENERAL'
    ) {
      setModeFilter(deepLinkMode);
    }
    if (deepLinkBranchId) {
      setBranchFilter(deepLinkBranchId);
    }
    if (deepLinkSince) {
      const parsed = new Date(deepLinkSince);
      if (!Number.isNaN(parsed.getTime())) {
        setSince(parsed.toISOString().slice(0, 10));
      }
    }
    if (deepLinkUntil) {
      const parsed = new Date(deepLinkUntil);
      if (!Number.isNaN(parsed.getTime())) {
        setUntil(parsed.toISOString().slice(0, 10));
      }
    }
    setUrlFiltersApplied(true);
  }, [deepLinkBranchId, deepLinkMode, deepLinkSince, deepLinkStatus, deepLinkUntil, urlFiltersApplied]);

  useEffect(() => {
    if (!urlFiltersApplied) {
      return;
    }
    void loadTransfers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFiltersApplied]);

  const filteredRows = useMemo(() => {
    const sinceIso = since.trim() ? new Date(`${since}T00:00:00.000`).toISOString() : null;
    const untilIso = until.trim() ? new Date(`${until}T23:59:59.999`).toISOString() : null;
    return rows.filter((row) => {
      if (sinceIso && row.created_at < sinceIso) {
        return false;
      }
      if (untilIso && row.created_at > untilIso) {
        return false;
      }
      if (branchFilter !== 'ALL') {
        const sourceBranchId = locationById.get(row.source_location_id)?.branchId ?? null;
        const destinationBranchId = locationById.get(row.destination_location_id)?.branchId ?? null;
        if (sourceBranchId !== branchFilter && destinationBranchId !== branchFilter) {
          return false;
        }
      }
      if (statusFilter !== 'ALL' && row.status !== statusFilter) {
        return false;
      }
      const rowTransferMode =
        row.transfer_mode ??
        deriveModeFromLocations(
          locationById.get(row.source_location_id),
          locationById.get(row.destination_location_id)
        );
      if (modeFilter !== 'ALL' && rowTransferMode !== modeFilter) {
        return false;
      }
      return true;
    });
  }, [branchFilter, locationById, modeFilter, rows, since, statusFilter, until]);

  const totalFull = useMemo(
    () => filteredRows.reduce((sum, row) => sum + row.lines.reduce((lineSum, line) => lineSum + Number(line.qty_full || 0), 0), 0),
    [filteredRows]
  );
  const totalEmpty = useMemo(
    () => filteredRows.reduce((sum, row) => sum + row.lines.reduce((lineSum, line) => lineSum + Number(line.qty_empty || 0), 0), 0),
    [filteredRows]
  );

  function locationLabel(id: string, fallbackLabel?: string | null): string {
    if (fallbackLabel && fallbackLabel.trim()) {
      return fallbackLabel;
    }
    const row = locationById.get(id);
    if (!row) {
      return id;
    }
    return `${row.name} (${row.code})`;
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-brandPrimary">Transfer List</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Supplier restock and location transfer movements (FULL/EMPTY) posted from mobile and web.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-6">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Branch</span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setBranchFilter(event.target.value)}
              value={branchFilter}
            >
              <option value="ALL">All Branches</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code})
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Status</span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) =>
                setStatusFilter(event.target.value as 'ALL' | TransferRow['status'])
              }
              value={statusFilter}
            >
              <option value="ALL">All Statuses</option>
              <option value="CREATED">Created</option>
              <option value="APPROVED">Approved</option>
              <option value="POSTED">Posted</option>
              <option value="REVERSED">Reversed</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Mode</span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) =>
                setModeFilter(
                  event.target.value as 'ALL' | NonNullable<TransferRow['transfer_mode']>
                )
              }
              value={modeFilter}
            >
              <option value="ALL">All Modes</option>
              <option value="SUPPLIER_RESTOCK_IN">Supplier Restock In</option>
              <option value="SUPPLIER_RESTOCK_OUT">Supplier Return Out</option>
              <option value="INTER_STORE_TRANSFER">Inter-Store Transfer</option>
              <option value="STORE_TO_WAREHOUSE">Store to Warehouse</option>
              <option value="WAREHOUSE_TO_STORE">Warehouse to Store</option>
              <option value="GENERAL">General</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Date From</span>
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setSince(event.target.value)}
              type="date"
              value={since}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Date To</span>
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setUntil(event.target.value)}
              type="date"
              value={until}
            />
          </label>

          <div className="flex items-end">
            <button
              className="w-full rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              disabled={loading}
              onClick={() => void loadTransfers()}
              type="button"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Transfers</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{filteredRows.length}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Moved FULL</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{fmtQty(totalFull)}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Moved EMPTY</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{fmtQty(totalEmpty)}</p>
        </article>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-0 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Transfer Records</h2>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {filteredRows.length} row(s)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-auto text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2">Created At</th>
                <th className="px-3 py-2">Transfer ID</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">From</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Shift</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">FULL</th>
                <th className="px-3 py-2 text-right">EMPTY</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={10}>
                    {loading ? 'Loading transfers...' : 'No transfers found for selected filter.'}
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const sourceLocation = locationById.get(row.source_location_id);
                  const destinationLocation = locationById.get(row.destination_location_id);
                  const transferMode = row.transfer_mode ?? deriveModeFromLocations(sourceLocation, destinationLocation);
                  const movedFull = row.lines.reduce((sum, line) => sum + Number(line.qty_full || 0), 0);
                  const movedEmpty = row.lines.reduce((sum, line) => sum + Number(line.qty_empty || 0), 0);
                  return (
                    <tr className="border-t border-slate-100 dark:border-slate-800" key={row.id}>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200 sm:whitespace-nowrap">{fmtDateTime(row.created_at)}</td>
                      <td className="max-w-[220px] break-all px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-200">{row.id}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{modeLabel(transferMode)}</td>
                      <td className="max-w-[220px] break-words px-3 py-2 text-slate-700 dark:text-slate-200">
                        {locationLabel(row.source_location_id, row.source_location_label)}
                      </td>
                      <td className="max-w-[220px] break-words px-3 py-2 text-slate-700 dark:text-slate-200">
                        {locationLabel(row.destination_location_id, row.destination_location_label)}
                      </td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.shift_id ?? '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200 sm:whitespace-nowrap">{fmtQty(movedFull)}</td>
                      <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200 sm:whitespace-nowrap">{fmtQty(movedEmpty)}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                          onClick={() => setSelectedTransfer(row)}
                          type="button"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedTransfer ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Transfer Details</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">{selectedTransfer.id}</p>
              </div>
              <button
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"
                onClick={() => setSelectedTransfer(null)}
                type="button"
              >
                Close
              </button>
            </header>
            <div className="space-y-4 overflow-y-auto p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Transfer Mode</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {modeLabel(selectedTransfer.transfer_mode)}
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedTransfer.status}</p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Shift</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedTransfer.shift_id ?? '-'}
                  </p>
                </article>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">From</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {locationLabel(selectedTransfer.source_location_id, selectedTransfer.source_location_label)}
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">To</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {locationLabel(selectedTransfer.destination_location_id, selectedTransfer.destination_location_label)}
                  </p>
                </article>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
                  Transfer Lines
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full table-auto text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                      <tr>
                        <th className="px-3 py-2">Item Code</th>
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2 text-right">FULL</th>
                        <th className="px-3 py-2 text-right">EMPTY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedTransfer.lines.map((line, index) => {
                        const product = productByRef.get(line.product_id);
                        return (
                          <tr key={`${line.product_id}-${index}`} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="max-w-[220px] break-words px-3 py-2 text-slate-700 dark:text-slate-200">{product?.sku ?? line.product_id}</td>
                            <td className="max-w-[280px] break-words px-3 py-2 text-slate-700 dark:text-slate-200">{product?.name ?? 'N/A'}</td>
                            <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200 sm:whitespace-nowrap">{fmtQty(line.qty_full)}</td>
                            <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200 sm:whitespace-nowrap">{fmtQty(line.qty_empty)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
