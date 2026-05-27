'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TablePaginationControls } from '../../../../components/table-pagination-controls';
import { apiRequest } from '../../../../lib/api-client';
import { useTablePagination } from '../../../../lib/table-pagination';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type SalesReturnHistoryRow = {
  sale_return_id: string;
  sale_id: string;
  sale_status: 'ACTIVE' | 'CANCELLED' | 'VOIDED';
  status: 'POSTED' | 'VOIDED';
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  reason: string;
  total_amount: number;
  points_reversed: number;
  receipt_number: string | null;
  branch_id: string;
  branch_name: string;
  branch_code: string;
  location_id: string;
  location_name: string;
  location_code: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_code: string | null;
  customer_address: string | null;
  line_count: number;
};

type SalesReturnsHistoryResponse = {
  period: { since: string | null; until: string | null };
  rows: SalesReturnHistoryRow[];
};

function fmtDateTime(value: string | null): string {
  if (!value) {
    return 'N/A';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function fmtMoney(value: number): string {
  return value.toFixed(2);
}

function saleReturnStatusClasses(status: 'POSTED' | 'VOIDED'): string {
  if (status === 'VOIDED') {
    return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
  }
  return 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200';
}

function saleReturnStatusLabel(status: 'POSTED' | 'VOIDED'): string {
  if (status === 'VOIDED') {
    return 'Return Reversed';
  }
  return 'Return Posted';
}

function saleStatusLabel(status: 'ACTIVE' | 'CANCELLED' | 'VOIDED'): string {
  if (status === 'CANCELLED') {
    return 'Cancelled Sale';
  }
  if (status === 'VOIDED') {
    return 'Voided Sale';
  }
  return 'Active Sale';
}

export default function LendingReturnHistoryPage(): JSX.Element {
  const router = useRouter();
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [rows, setRows] = useState<SalesReturnHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadBranches(): Promise<void> {
    try {
      const data = await apiRequest<BranchRecord[]>('/master-data/branches');
      setBranches(data.filter((item) => item.isActive));
    } catch {
      setBranches([]);
    }
  }

  async function loadReturnHistory(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (since.trim()) {
        params.set('since', new Date(`${since}T00:00:00.000`).toISOString());
      }
      if (until.trim()) {
        params.set('until', new Date(`${until}T23:59:59.999`).toISOString());
      }
      if (branchFilter !== 'ALL') {
        params.set('branch_id', branchFilter);
      }
      params.set('limit', '500');
      const query = params.toString();
      const data = await apiRequest<SalesReturnsHistoryResponse>(`/reports/sales/returns${query ? `?${query}` : ''}`);
      setRows(data.rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load return history');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBranches();
  }, []);

  useEffect(() => {
    void loadReturnHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter, since, until]);

  const paginatedRows = useTablePagination(rows, {
    initialPageSize: 25,
    pageSizeOptions: [10, 25, 50, 100],
    resetKey: `${branchFilter}|${since}|${until}|${rows.length}`
  });

  return (
    <section className="space-y-4" data-tour="lending-return-history-root">
      <div
        className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        data-tour="lending-return-history-filters"
      >
        <h1 className="text-2xl font-bold text-brandPrimary">Return History</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          View posted and reversed sales returns with branch and date filtering.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
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
              onClick={() => void loadReturnHistory()}
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

      <div className="rounded-2xl border border-slate-200 bg-white p-0 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Return History</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Track item returns and reversed return postings for the selected branch and period.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {rows.length} row(s)
          </span>
        </div>
        <div className="overflow-x-auto" data-tour="lending-return-history-table">
          <table className="min-w-[1300px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2">Returned At</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Return ID</th>
                <th className="px-3 py-2">Receipt / Sale</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Customer Address</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Points Reversed</th>
                <th className="px-3 py-2 text-right">Lines</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={12}>
                    {loading ? 'Loading return history...' : 'No sale returns found for selected filter.'}
                  </td>
                </tr>
              ) : (
                paginatedRows.pageRows.map((row) => (
                  <tr className="border-t border-slate-100 dark:border-slate-800" key={row.sale_return_id}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{fmtDateTime(row.created_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${saleReturnStatusClasses(row.status)}`}>
                        {saleReturnStatusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.sale_return_id}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {row.receipt_number ?? row.sale_id}
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sale: {saleStatusLabel(row.sale_status)}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {row.customer_name ? `${row.customer_name}${row.customer_code ? ` (${row.customer_code})` : ''}` : 'Walk-in / N/A'}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.branch_name}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.customer_address ?? ''}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmtMoney(row.total_amount)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{row.points_reversed}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{row.line_count}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {row.reason}
                      {row.status === 'VOIDED' && row.void_reason ? (
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Reversal note: {row.void_reason}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                        onClick={() => router.push(`/sales-list?sale_id=${encodeURIComponent(row.sale_id)}` as Route)}
                        type="button"
                      >
                        View Sale
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <TablePaginationControls
          endRow={paginatedRows.endRow}
          onPageChange={paginatedRows.setPage}
          onPageSizeChange={paginatedRows.setPageSize}
          page={paginatedRows.page}
          pageSize={paginatedRows.pageSize}
          pageSizeOptions={paginatedRows.pageSizeOptions}
          startRow={paginatedRows.startRow}
          totalItems={paginatedRows.totalItems}
          totalPages={paginatedRows.totalPages}
        />
      </div>
    </section>
  );
}
