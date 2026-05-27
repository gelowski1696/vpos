'use client';

import { useEffect, useMemo, useState } from 'react';
import { TablePaginationControls } from '../../../components/table-pagination-controls';
import { apiRequest } from '../../../lib/api-client';
import { useTablePagination } from '../../../lib/table-pagination';
import { toastError, toastSuccess } from '../../../lib/web-toast';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type LendingStatus =
  | 'OPEN'
  | 'PARTIALLY_RETURNED'
  | 'CLOSED'
  | 'OVERDUE'
  | 'CANCELLED'
  | 'FORCE_CLOSED';

type LendingReturnCondition = 'GOOD' | 'DAMAGED' | 'LOST';

type LendingRecord = {
  lending_id: string;
  branch_id: string;
  branch_name: string | null;
  location_id: string;
  location_name: string | null;
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  sale_id: string;
  status: LendingStatus;
  due_at: string | null;
  remarks: string | null;
  opened_at: string;
  line_count: number;
  total_quantity_lent: number;
  total_quantity_returned: number;
};

type LendingLineRecord = {
  lending_line_id: string;
  product_id: string;
  product_sku: string | null;
  product_name: string | null;
  quantity_lent: number;
  quantity_returned: number;
  quantity_open: number;
  deposit_amount: number | null;
  remarks: string | null;
};

type LendingReturnRecord = {
  lending_return_id: string;
  lending_line_id: string;
  returned_qty: number;
  condition: LendingReturnCondition;
  remarks: string | null;
  received_by_name: string | null;
  returned_at: string;
};

type LendingDetailRecord = LendingRecord & {
  lines: LendingLineRecord[];
  returns: LendingReturnRecord[];
};

type StatusFilter = 'ALL' | LendingStatus;

function fmtDate(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function fmtQty(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '0';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtMoney(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '-';
  return `PHP ${Number(value).toFixed(2)}`;
}

function statusBadgeClass(status: LendingStatus): string {
  if (status === 'CLOSED') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  }
  if (status === 'OVERDUE') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  }
  if (status === 'PARTIALLY_RETURNED') {
    return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300';
  }
  if (status === 'CANCELLED' || status === 'FORCE_CLOSED') {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  }
  return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300';
}

export default function LendingPage(): JSX.Element {
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [rows, setRows] = useState<LendingRecord[]>([]);
  const [branchId, setBranchId] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<LendingDetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnRemarks, setReturnRemarks] = useState('');
  const [returnQtyByLine, setReturnQtyByLine] = useState<Record<string, string>>({});
  const [returnConditionByLine, setReturnConditionByLine] = useState<
    Record<string, LendingReturnCondition>
  >({});

  async function loadBranches(): Promise<void> {
    const branchRows = await apiRequest<BranchRecord[]>('/master-data/branches');
    setBranches((branchRows ?? []).filter((row) => row.isActive));
  }

  async function loadRows(): Promise<void> {
    const params = new URLSearchParams({ limit: '300' });
    if (branchId !== 'ALL') {
      params.set('branch_id', branchId);
    }
    if (statusFilter !== 'ALL') {
      params.set('status', statusFilter);
    }
    const response = await apiRequest<LendingRecord[]>(`/lending?${params.toString()}`);
    setRows(response ?? []);
  }

  async function refresh(showToast = false): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await loadRows();
      if (showToast) {
        toastSuccess('Lending data refreshed');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load lending records.';
      setError(message);
      toastError('Load failed', { description: message });
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(lendingId: string): Promise<void> {
    setSelectedId(lendingId);
    setDetailLoading(true);
    try {
      const detail = await apiRequest<LendingDetailRecord>(`/lending/${encodeURIComponent(lendingId)}`);
      setSelectedDetail(detail);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load lending detail.';
      toastError('Load detail failed', { description: message });
      setSelectedId(null);
      setSelectedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        await Promise.all([loadBranches(), loadRows()]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to load lending page.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }
    void refresh();
  }, [branchId, loading, statusFilter]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return rows;
    }
    return rows.filter((row) =>
      `${row.lending_id} ${row.sale_id} ${row.customer_name ?? ''} ${row.customer_code ?? ''} ${
        row.branch_name ?? ''
      } ${row.location_name ?? ''}`
        .toLowerCase()
        .includes(query)
    );
  }, [rows, search]);

  const stats = useMemo(() => {
    const open = filteredRows.filter((row) => row.status === 'OPEN').length;
    const partial = filteredRows.filter((row) => row.status === 'PARTIALLY_RETURNED').length;
    const overdue = filteredRows.filter((row) => row.status === 'OVERDUE').length;
    const totalOpenQty = filteredRows.reduce(
      (sum, row) => sum + Math.max(0, row.total_quantity_lent - row.total_quantity_returned),
      0
    );
    return {
      count: filteredRows.length,
      open,
      partial,
      overdue,
      totalOpenQty: Number(totalOpenQty.toFixed(4))
    };
  }, [filteredRows]);

  const paginatedFilteredRows = useTablePagination(filteredRows, {
    initialPageSize: 25,
    pageSizeOptions: [10, 25, 50, 100],
    resetKey: `${branchId}|${statusFilter}|${search}|${filteredRows.length}`
  });

  const canReturn =
    selectedDetail &&
    selectedDetail.status !== 'CLOSED' &&
    selectedDetail.status !== 'CANCELLED' &&
    selectedDetail.status !== 'FORCE_CLOSED' &&
    selectedDetail.lines.some((line) => line.quantity_open > 0);

  function resetReturnModal(detail: LendingDetailRecord): void {
    setReturnRemarks('');
    setReturnQtyByLine(
      Object.fromEntries(detail.lines.filter((line) => line.quantity_open > 0).map((line) => [line.lending_line_id, '']))
    );
    setReturnConditionByLine(
      Object.fromEntries(
        detail.lines
          .filter((line) => line.quantity_open > 0)
          .map((line) => [line.lending_line_id, 'GOOD' as LendingReturnCondition])
      )
    );
  }

  async function submitReturn(): Promise<void> {
    if (!selectedDetail || returnBusy) {
      return;
    }
    const lines = selectedDetail.lines
      .map((line) => ({
        line,
        qty: Number(returnQtyByLine[line.lending_line_id] || '0'),
        condition: returnConditionByLine[line.lending_line_id] ?? 'GOOD'
      }))
      .filter((entry) => Number.isFinite(entry.qty) && entry.qty > 0);

    if (lines.length === 0) {
      toastError('Return required', { description: 'Enter a returned quantity for at least one open line.' });
      return;
    }

    for (const entry of lines) {
      if (entry.qty > entry.line.quantity_open) {
        toastError('Invalid quantity', {
          description: `${entry.line.product_name ?? entry.line.product_id} only has ${fmtQty(entry.line.quantity_open)} open.`
        });
        return;
      }
    }

    setReturnBusy(true);
    try {
      const detail = await apiRequest<LendingDetailRecord>(`/lending/${encodeURIComponent(selectedDetail.lending_id)}/return`, {
        method: 'POST',
        body: {
          remarks: returnRemarks.trim() || null,
          lines: lines.map((entry) => ({
            lending_line_id: entry.line.lending_line_id,
            returned_qty: entry.qty,
            condition: entry.condition
          }))
        }
      });
      setSelectedDetail(detail);
      setReturnModalOpen(false);
      await loadRows();
      toastSuccess('Return recorded');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to save the return.';
      toastError('Return failed', { description: message });
    } finally {
      setReturnBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-tour="lending-root">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-500">Returnable Assets</p>
            <h1 className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100" data-tour="header-page-title">
              Lending Tracker
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
              Review open lendings, inspect what is still out with customers, and record returns without leaving the admin workspace.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70"
            onClick={() => void refresh(true)}
            disabled={busy}
          >
            {busy ? 'Refreshing...' : 'Refresh Lending'}
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Records</p>
            <p className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{stats.count}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Open</p>
            <p className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{stats.open}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Partial</p>
            <p className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{stats.partial}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Open Qty</p>
            <p className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{fmtQty(stats.totalOpenQty)}</p>
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">{stats.overdue} overdue</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-[1.4fr_0.8fr_auto]">
          <label className="flex flex-col gap-2" data-tour="lending-search">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by customer, sale ID, or lending ID"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none ring-0 placeholder:text-slate-400 focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-2" data-tour="lending-branch-filter">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Branch</span>
            <select
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="ALL">All branches</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} - {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2" data-tour="lending-status-filter">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="ALL">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="PARTIALLY_RETURNED">Partially Returned</option>
              <option value="OVERDUE">Overdue</option>
              <option value="CLOSED">Closed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="FORCE_CLOSED">Force Closed</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900" data-tour="lending-table">
        {loading ? (
          <div className="p-8 text-sm text-slate-500 dark:text-slate-400">Loading lending records...</div>
        ) : error ? (
          <div className="p-8 text-sm text-rose-600 dark:text-rose-300">{error}</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-8 text-sm text-slate-500 dark:text-slate-400">No lending records matched your current filters.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-950/40">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Reference</th>
                  <th className="px-4 py-3 font-semibold">Branch / Location</th>
                  <th className="px-4 py-3 font-semibold">Quantities</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Opened</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedFilteredRows.pageRows.map((row) => {
                  const openQty = Math.max(0, row.total_quantity_lent - row.total_quantity_returned);
                  return (
                    <tr key={row.lending_id} className="align-top">
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {row.customer_name ?? row.customer_code ?? row.customer_id}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{row.customer_code ?? row.customer_id}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">{row.lending_id}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sale {row.sale_id}</p>
                        {row.due_at ? (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Due {fmtDate(row.due_at)}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                        <p>{row.branch_name ?? row.branch_id}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{row.location_name ?? row.location_id}</p>
                      </td>
                      <td className="px-4 py-4 text-slate-600 dark:text-slate-300">
                        <p>Lent {fmtQty(row.total_quantity_lent)}</p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Returned {fmtQty(row.total_quantity_returned)} | Open {fmtQty(openQty)}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
                          {row.status === 'PARTIALLY_RETURNED' ? 'PARTIAL' : row.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-slate-600 dark:text-slate-300">{fmtDate(row.opened_at)}</td>
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-200"
                          onClick={() => void openDetail(row.lending_id)}
                        >
                          View detail
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
            <TablePaginationControls
              endRow={paginatedFilteredRows.endRow}
              onPageChange={paginatedFilteredRows.setPage}
              onPageSizeChange={paginatedFilteredRows.setPageSize}
              page={paginatedFilteredRows.page}
              pageSize={paginatedFilteredRows.pageSize}
              pageSizeOptions={paginatedFilteredRows.pageSizeOptions}
              startRow={paginatedFilteredRows.startRow}
              totalItems={paginatedFilteredRows.totalItems}
              totalPages={paginatedFilteredRows.totalPages}
            />
          </>
        )}
      </section>

      {selectedId ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 px-4 py-6 lg:items-center">
          <div className="absolute inset-0" onClick={() => { setSelectedId(null); setSelectedDetail(null); }} />
          <div className="relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            {detailLoading || !selectedDetail ? (
              <div className="p-8 text-sm text-slate-500 dark:text-slate-400">Loading lending detail...</div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6 dark:border-slate-800">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-500">Lending Detail</p>
                    <h2 className="mt-2 text-xl font-black text-slate-900 dark:text-slate-100">{selectedDetail.lending_id}</h2>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      Sale {selectedDetail.sale_id} | {selectedDetail.customer_name ?? selectedDetail.customer_code ?? selectedDetail.customer_id}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-200"
                    onClick={() => {
                      setSelectedId(null);
                      setSelectedDetail(null);
                    }}
                  >
                    Close
                  </button>
                </div>

                <div className="grid gap-3 border-b border-slate-200 p-6 md:grid-cols-4 dark:border-slate-800">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</p>
                    <p className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">{selectedDetail.status}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Opened</p>
                    <p className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">{fmtDate(selectedDetail.opened_at)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Due</p>
                    <p className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">{fmtDate(selectedDetail.due_at)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Outstanding</p>
                    <p className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                      {fmtQty(
                        selectedDetail.lines.reduce((sum, line) => sum + Math.max(0, line.quantity_open), 0)
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                    <section>
                      <h3 className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-slate-100">Lending Lines</h3>
                      <div className="mt-3 space-y-3">
                        {selectedDetail.lines.map((line) => (
                          <article
                            key={line.lending_line_id}
                            className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="font-semibold text-slate-900 dark:text-slate-100">
                                  {line.product_name ?? line.product_id}
                                </p>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{line.product_sku ?? line.product_id}</p>
                              </div>
                              {line.deposit_amount !== null ? (
                                <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                  Deposit {fmtMoney(line.deposit_amount)}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Lent</p>
                                <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{fmtQty(line.quantity_lent)}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Returned</p>
                                <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{fmtQty(line.quantity_returned)}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Open</p>
                                <p className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{fmtQty(line.quantity_open)}</p>
                              </div>
                            </div>
                            {line.remarks ? (
                              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{line.remarks}</p>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </section>

                    <section>
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-slate-100">Return History</h3>
                        <button
                          type="button"
                          className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={!canReturn}
                          onClick={() => {
                            if (selectedDetail) {
                              resetReturnModal(selectedDetail);
                              setReturnModalOpen(true);
                            }
                          }}
                        >
                          Record Return
                        </button>
                      </div>
                      <div className="mt-3 space-y-3">
                        {selectedDetail.returns.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            No returns recorded yet.
                          </div>
                        ) : (
                          selectedDetail.returns.map((entry) => (
                            <article
                              key={entry.lending_return_id}
                              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40"
                            >
                              <div className="flex items-center justify-between gap-4">
                                <p className="font-semibold text-slate-900 dark:text-slate-100">
                                  Qty {fmtQty(entry.returned_qty)} returned
                                </p>
                                <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                  {entry.condition}
                                </span>
                              </div>
                              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{fmtDate(entry.returned_at)}</p>
                              {entry.received_by_name ? (
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Received by {entry.received_by_name}</p>
                              ) : null}
                              {entry.remarks ? (
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{entry.remarks}</p>
                              ) : null}
                            </article>
                          ))
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {returnModalOpen && selectedDetail ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 px-4 py-6 lg:items-center">
          <div className="absolute inset-0" onClick={() => setReturnModalOpen(false)} />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6 dark:border-slate-800">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-500">Return Flow</p>
                <h3 className="mt-2 text-xl font-black text-slate-900 dark:text-slate-100">Record Lending Return</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Enter how many items came back and note the condition for each returned line.
                </p>
              </div>
              <button
                type="button"
                className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-200"
                onClick={() => setReturnModalOpen(false)}
                disabled={returnBusy}
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {selectedDetail.lines
                  .filter((line) => line.quantity_open > 0)
                  .map((line) => (
                    <article
                      key={line.lending_line_id}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{line.product_name ?? line.product_id}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Open quantity: {fmtQty(line.quantity_open)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-[0.8fr_1fr]">
                        <label className="flex flex-col gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Returned Quantity</span>
                          <input
                            value={returnQtyByLine[line.lending_line_id] ?? ''}
                            onChange={(event) =>
                              setReturnQtyByLine((prev) => ({ ...prev, [line.lending_line_id]: event.target.value }))
                            }
                            inputMode="decimal"
                            placeholder="0"
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Condition</span>
                          <select
                            value={returnConditionByLine[line.lending_line_id] ?? 'GOOD'}
                            onChange={(event) =>
                              setReturnConditionByLine((prev) => ({
                                ...prev,
                                [line.lending_line_id]: event.target.value as LendingReturnCondition
                              }))
                            }
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          >
                            <option value="GOOD">Good</option>
                            <option value="DAMAGED">Damaged</option>
                            <option value="LOST">Lost</option>
                          </select>
                        </label>
                      </div>
                    </article>
                  ))}

                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Remarks</span>
                  <textarea
                    value={returnRemarks}
                    onChange={(event) => setReturnRemarks(event.target.value)}
                    placeholder="Optional notes about this return"
                    rows={3}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </label>
              </div>
            </div>

            <div className="border-t border-slate-200 p-6 dark:border-slate-800">
              <button
                type="button"
                className="inline-flex min-w-[180px] items-center justify-center rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void submitReturn()}
                disabled={returnBusy}
              >
                {returnBusy ? 'Saving Return...' : 'Save Return'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
