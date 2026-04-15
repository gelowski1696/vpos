'use client';

import type { Route } from 'next';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiRequest } from '../../../lib/api-client';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type SalesListRow = {
  sale_id: string;
  status: 'ACTIVE' | 'CANCELLED' | 'VOIDED';
  recreated_from_sale_id: string | null;
  recreated_by_sale_id: string | null;
  posted_at: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  voided_at: string | null;
  void_reason: string | null;
  receipt_number: string | null;
  branch_id: string;
  branch_name: string;
  branch_code: string;
  location_id: string;
  location_name: string;
  location_code: string;
  cashier_name: string;
  cashier_email: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_code: string | null;
  customer_address: string | null;
  sale_type: string;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  cogs_amount: number;
  gross_profit: number;
  returned_total: number;
  payment_total: number;
  payment_methods: string[];
};

type SalesListResponse = {
  period: { since: string | null; until: string | null };
  rows: SalesListRow[];
};

type SalesDetailResponse = {
  sale: SalesListRow & {
    shift_id: string | null;
    shift_opened_at: string | null;
    personnel_name: string | null;
    driver_name: string | null;
    helper_name: string | null;
    returned_total: number;
  };
  lines: Array<{
    line_id: string;
    product_id: string;
    item_code: string;
    product_name: string;
    cylinder_flow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null;
    qty: number;
    unit_price: number;
    line_total: number;
    estimated_cost: number;
    gross_profit: number;
  }>;
  returns: Array<{
    sale_return_id: string;
    status: 'POSTED' | 'VOIDED';
    reason: string;
    created_at: string;
    voided_at: string | null;
    void_reason: string | null;
    total_amount: number;
    points_reversed: number;
    lines: Array<{
      sale_line_id: string;
      product_id: string;
      item_code: string;
      product_name: string;
      quantity: number;
      unit_price: number;
      line_total: number;
    }>;
  }>;
  payments: Array<{
    payment_id: string;
    payment_source: 'SALE' | 'SETTLEMENT';
    method: string;
    amount: number;
    reference_no: string | null;
  }>;
  delivery: {
    id: string;
    status: string;
    scheduled_at: string | null;
    completed_at: string | null;
    assignments: Array<{
      user_id: string;
      full_name: string;
      email: string;
      role: string;
    }>;
  } | null;
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

function fmtQty(value: number): string {
  return Number(value).toFixed(4).replace(/\.?0+$/, '');
}

function saleStatusClasses(status: 'ACTIVE' | 'CANCELLED' | 'VOIDED'): string {
  if (status === 'CANCELLED') {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200';
  }
  if (status === 'VOIDED') {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200';
  }
  return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200';
}

function saleReturnStatusClasses(status: 'POSTED' | 'VOIDED'): string {
  if (status === 'VOIDED') {
    return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
  }
  return 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200';
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

function recreateLabel(row: {
  recreated_from_sale_id: string | null;
  recreated_by_sale_id: string | null;
}): string | null {
  if (row.recreated_from_sale_id) {
    return `Recreated from ${row.recreated_from_sale_id}`;
  }
  if (row.recreated_by_sale_id) {
    return `Replacement sale ${row.recreated_by_sale_id}`;
  }
  return null;
}

function saleReturnStatusLabel(status: 'POSTED' | 'VOIDED'): string {
  if (status === 'VOIDED') {
    return 'Return Reversed';
  }
  return 'Return Posted';
}

function assignmentNamesByRole(
  assignments: Array<{ role: string; full_name: string }>,
  role: 'DRIVER' | 'HELPER' | 'PERSONNEL'
): string {
  const matches = assignments
    .filter((item) => item.role.trim().toUpperCase() === role)
    .map((item) => item.full_name.trim())
    .filter((value) => value.length > 0);
  return matches.length > 0 ? matches.join(', ') : '';
}

function splitCsvNames(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export default function SalesListPage(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [rows, setRows] = useState<SalesListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<SalesDetailResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [paymentBreakdownOpen, setPaymentBreakdownOpen] = useState(false);
  const [voidReturnOpen, setVoidReturnOpen] = useState(false);
  const [selectedReturnToVoid, setSelectedReturnToVoid] = useState<SalesDetailResponse['returns'][number] | null>(null);
  const [voidReturnReason, setVoidReturnReason] = useState('');
  const [voidReturnSaving, setVoidReturnSaving] = useState(false);
  const handledSearchSaleIdRef = useRef<string | null>(null);

  async function loadBranches(): Promise<void> {
    try {
      const data = await apiRequest<BranchRecord[]>('/master-data/branches');
      setBranches(data.filter((item) => item.isActive));
    } catch {
      setBranches([]);
    }
  }

  async function loadSales(): Promise<void> {
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
      const data = await apiRequest<SalesListResponse>(`/reports/sales/list${query ? `?${query}` : ''}`);
      setRows(data.rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load sales list');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBranches();
  }, []);

  useEffect(() => {
    void loadSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter, since, until]);

  useEffect(() => {
    const saleId = searchParams.get('sale_id')?.trim();
    if (!saleId) {
      handledSearchSaleIdRef.current = null;
      return;
    }
    if (handledSearchSaleIdRef.current === saleId) {
      return;
    }
    handledSearchSaleIdRef.current = saleId;
    void openDetails(saleId).finally(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('sale_id');
      const nextQuery = params.toString();
      router.replace((nextQuery ? `${pathname}?${nextQuery}` : pathname) as Route);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, router, searchParams]);

  async function openDetails(saleId: string): Promise<void> {
    setSelectedSaleId(saleId);
    setDetailsLoading(true);
    setDetailsError(null);
    setSelectedDetails(null);
    try {
      const data = await apiRequest<SalesDetailResponse>(`/reports/sales/${encodeURIComponent(saleId)}`);
      setSelectedDetails(data);
    } catch (cause) {
      setDetailsError(cause instanceof Error ? cause.message : 'Failed to load sale details');
    } finally {
      setDetailsLoading(false);
    }
  }

  function closeDetails(): void {
    setSelectedSaleId(null);
    setSelectedDetails(null);
    setDetailsError(null);
    setDetailsLoading(false);
    setPaymentBreakdownOpen(false);
  }

  async function refreshDetails(): Promise<void> {
    if (!selectedSaleId) {
      return;
    }
    await openDetails(selectedSaleId);
  }

  async function refreshAllViews(): Promise<void> {
    await Promise.all([loadSales(), refreshDetails()]);
  }

  function openVoidReturnDialog(saleReturn: SalesDetailResponse['returns'][number]): void {
    setSelectedReturnToVoid(saleReturn);
    setVoidReturnReason('');
    setVoidReturnOpen(true);
  }

  function closeVoidReturnDialog(): void {
    if (voidReturnSaving) {
      return;
    }
    setVoidReturnOpen(false);
    setSelectedReturnToVoid(null);
    setVoidReturnReason('');
  }

  async function submitVoidSaleReturn(): Promise<void> {
    if (!selectedReturnToVoid) {
      return;
    }
    const reason = voidReturnReason.trim();
    if (reason.length < 3) {
      setActionMessage('Void reason must be at least 3 characters.');
      return;
    }

    setVoidReturnSaving(true);
    setActionMessage(null);
    try {
      await apiRequest(`/sales/returns/${encodeURIComponent(selectedReturnToVoid.sale_return_id)}/void`, {
        method: 'POST',
        body: { reason }
      });
      setActionMessage(`Return ${selectedReturnToVoid.sale_return_id} was reversed.`);
      setVoidReturnOpen(false);
      setSelectedReturnToVoid(null);
      setVoidReturnReason('');
      await refreshAllViews();
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : 'Failed to void sale return.');
    } finally {
      setVoidReturnSaving(false);
    }
  }

  const selectedAssignments = selectedDetails?.delivery?.assignments ?? [];
  const selectedPersonnelNames = (() => {
    const values = [
      selectedDetails?.sale.personnel_name,
      selectedDetails?.sale.driver_name,
      selectedDetails?.sale.helper_name,
      assignmentNamesByRole(selectedAssignments, 'PERSONNEL'),
      assignmentNamesByRole(selectedAssignments, 'DRIVER'),
      assignmentNamesByRole(selectedAssignments, 'HELPER')
    ];
    const names = values.flatMap((value) => splitCsvNames(value));
    const unique = [...new Set(names)];
    return unique.length > 0 ? unique.join(', ') : 'N/A';
  })();

  return (
    <section className="space-y-4" data-tour="sales-list-root">
      <div
        className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        data-tour="sales-list-filters"
      >
        <h1 className="text-2xl font-bold text-brandPrimary">Sales List</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Posted server sales from mobile and web, filterable by branch and date range.
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
              onClick={() => void loadSales()}
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

      {actionMessage ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
          {actionMessage}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-0 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Sales Records</h2>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {rows.length} row(s)
          </span>
        </div>
        <div className="overflow-x-auto" data-tour="sales-list-table">
          <table className="min-w-[1300px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2">Posted At</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Receipt</th>
                <th className="px-3 py-2">Sale ID</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Customer Address</th>
                <th className="px-3 py-2">Cashier</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Items Returned</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">COGS</th>
                <th className="px-3 py-2 text-right">Gross</th>
                <th className="px-3 py-2">Payment Methods</th>
                <th className="px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={16}>
                    {loading ? 'Loading sales...' : 'No sales found for selected filter.'}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr className="border-t border-slate-100 dark:border-slate-800" key={row.sale_id}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{fmtDateTime(row.posted_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${saleStatusClasses(row.status)}`}>
                        {saleStatusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.receipt_number ?? 'N/A'}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      <div>{row.sale_id}</div>
                      {recreateLabel(row) ? (
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{recreateLabel(row)}</div>
                      ) : null}
                    </td>

                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {row.branch_name} ({row.branch_code})
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {row.customer_address ?? 'N/A'}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.cashier_name}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {row.customer_name ? `${row.customer_name}${row.customer_code ? ` (${row.customer_code})` : ''}` : 'Walk-in / N/A'}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.sale_type}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmtMoney(row.total_amount)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmtMoney(row.returned_total)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmtMoney(row.payment_total)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmtMoney(row.cogs_amount)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmtMoney(row.gross_profit)}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.payment_methods.join(', ') || 'N/A'}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        data-tour="sales-list-view"
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                        onClick={() => void openDetails(row.sale_id)}
                        type="button"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedSaleId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Sale Details</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedDetails?.sale.receipt_number
                    ? `Receipt #${selectedDetails.sale.receipt_number}`
                    : `Sale ID ${selectedSaleId}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedDetails ? (
                  <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${saleStatusClasses(selectedDetails.sale.status)}`}>
                    {saleStatusLabel(selectedDetails.sale.status)}
                  </span>
                ) : null}
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"
                  onClick={() => void refreshDetails()}
                  type="button"
                >
                  Refresh
                </button>
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
                  onClick={() => setPaymentBreakdownOpen(true)}
                  type="button"
                  disabled={detailsLoading || !selectedDetails}
                >
                  Payment Breakdown
                </button>
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"
                  onClick={closeDetails}
                  type="button"
                >
                  Close
                </button>
              </div>
            </header>

            <div className="overflow-y-auto p-4">
              {detailsLoading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Loading sale details...</p>
              ) : detailsError ? (
                <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                  {detailsError}
                </div>
              ) : selectedDetails ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Total</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {fmtMoney(selectedDetails.sale.total_amount)}
                      </p>
                    </article>
                    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Paid</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {fmtMoney(selectedDetails.sale.payment_total)}
                      </p>
                    </article>
                    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">COGS</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {fmtMoney(selectedDetails.sale.cogs_amount)}
                      </p>
                    </article>
                    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Gross Profit</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {fmtMoney(selectedDetails.sale.gross_profit)}
                      </p>
                    </article>
                    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Items Returned</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {fmtMoney(selectedDetails.sale.returned_total)}
                      </p>
                    </article>
                  </div>

                  {selectedDetails.sale.status !== 'ACTIVE' ? (
                    <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                      {selectedDetails.sale.status === 'CANCELLED'
                        ? `This sale was cancelled${selectedDetails.sale.cancelled_at ? ` on ${fmtDateTime(selectedDetails.sale.cancelled_at)}` : ''}${selectedDetails.sale.cancel_reason ? `. Reason: ${selectedDetails.sale.cancel_reason}` : '.'}`
                        : `This sale was voided${selectedDetails.sale.voided_at ? ` on ${fmtDateTime(selectedDetails.sale.voided_at)}` : ''}${selectedDetails.sale.void_reason ? `. Reason: ${selectedDetails.sale.void_reason}` : '.'}`}
                    </div>
                  ) : null}

                  {recreateLabel(selectedDetails.sale) ? (
                    <div className="rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
                      {selectedDetails.sale.recreated_from_sale_id
                        ? `This is a replacement sale created from ${selectedDetails.sale.recreated_from_sale_id}.`
                        : `This cancelled sale was replaced by ${selectedDetails.sale.recreated_by_sale_id}.`}
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2">
                    <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Transaction Info</h3>
                      <dl className="mt-2 grid grid-cols-[140px_1fr] gap-y-1 text-sm">
                        <dt className="text-slate-500 dark:text-slate-400">Posted At</dt>
                        <dd className="text-slate-800 dark:text-slate-100">{fmtDateTime(selectedDetails.sale.posted_at)}</dd>
                        <dt className="text-slate-500 dark:text-slate-400">Created At</dt>
                        <dd className="text-slate-800 dark:text-slate-100">{fmtDateTime(selectedDetails.sale.created_at)}</dd>
                        <dt className="text-slate-500 dark:text-slate-400">Sale Type</dt>
                        <dd className="text-slate-800 dark:text-slate-100">{selectedDetails.sale.sale_type}</dd>
                        <dt className="text-slate-500 dark:text-slate-400">Branch</dt>
                        <dd className="text-slate-800 dark:text-slate-100">
                          {selectedDetails.sale.branch_name} ({selectedDetails.sale.branch_code})
                        </dd>
                        <dt className="text-slate-500 dark:text-slate-400">Customer Address</dt>
                        <dd className="text-slate-800 dark:text-slate-100">
                          {selectedDetails.sale.customer_address ?? 'N/A'}
                        </dd>
                        <dt className="text-slate-500 dark:text-slate-400">Cashier</dt>
                        <dd className="text-slate-800 dark:text-slate-100">
                          {selectedDetails.sale.cashier_name} ({selectedDetails.sale.cashier_email})
                        </dd>
                        <dt className="text-slate-500 dark:text-slate-400">Customer</dt>
                        <dd className="text-slate-800 dark:text-slate-100">
                          {selectedDetails.sale.customer_name
                            ? `${selectedDetails.sale.customer_name}${
                                selectedDetails.sale.customer_code
                                  ? ` (${selectedDetails.sale.customer_code})`
                                  : ''
                              }`
                            : 'Walk-in / N/A'}
                        </dd>
                        <dt className="text-slate-500 dark:text-slate-400">Shift</dt>
                        <dd className="text-slate-800 dark:text-slate-100">
                          {selectedDetails.sale.shift_id
                            ? `${selectedDetails.sale.shift_id} (${fmtDateTime(
                                selectedDetails.sale.shift_opened_at
                              )})`
                            : 'N/A'}
                        </dd>
                        <dt className="text-slate-500 dark:text-slate-400">Recreated From</dt>
                        <dd className="text-slate-800 dark:text-slate-100">
                          {selectedDetails.sale.recreated_from_sale_id ?? 'N/A'}
                        </dd>
                        <dt className="text-slate-500 dark:text-slate-400">Replacement Sale</dt>
                        <dd className="text-slate-800 dark:text-slate-100">
                          {selectedDetails.sale.recreated_by_sale_id ?? 'N/A'}
                        </dd>
                        <dt className="text-slate-500 dark:text-slate-400">Personnel</dt>
                        <dd className="text-slate-800 dark:text-slate-100">{selectedPersonnelNames}</dd>
                      </dl>
                    </article>

                    <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Payment Breakdown</h3>
                      <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            <tr>
                              <th className="px-2 py-1">Source</th>
                              <th className="px-2 py-1">Method</th>
                              <th className="px-2 py-1 text-right">Amount</th>
                              <th className="px-2 py-1">Reference</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedDetails.payments.length === 0 ? (
                              <tr>
                                <td className="px-2 py-2 text-slate-500 dark:text-slate-400" colSpan={4}>
                                  No payments recorded.
                                </td>
                              </tr>
                            ) : (
                              selectedDetails.payments.map((payment) => (
                                <tr
                                  className="border-t border-slate-100 dark:border-slate-800"
                                  key={`${payment.payment_source}-${payment.payment_id}`}
                                >
                                  <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">
                                    {payment.payment_source === 'SETTLEMENT' ? 'Settlement' : 'Sale'}
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{payment.method}</td>
                                  <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">
                                    {fmtMoney(payment.amount)}
                                  </td>
                                  <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">
                                    {payment.reference_no ?? 'N/A'}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  </div>

                  <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Line Items</h3>
                    <div className="mt-2 overflow-x-auto">
                      <table className="min-w-[900px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                          <tr>
                            <th className="px-2 py-1.5">Item Code</th>
                            <th className="px-2 py-1.5">Product Name</th>
                            <th className="px-2 py-1.5 text-right">Qty</th>
                            <th className="px-2 py-1.5">LPG Flow</th>
                            <th className="px-2 py-1.5 text-right">Unit Price</th>
                            <th className="px-2 py-1.5 text-right">Line Total</th>
                            <th className="px-2 py-1.5 text-right">Est. Cost</th>
                            <th className="px-2 py-1.5 text-right">Gross Profit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedDetails.lines.length === 0 ? (
                            <tr>
                              <td className="px-2 py-2 text-slate-500 dark:text-slate-400" colSpan={8}>
                                No line items.
                              </td>
                            </tr>
                          ) : (
                            selectedDetails.lines.map((line) => (
                              <tr className="border-t border-slate-100 dark:border-slate-800" key={line.line_id}>
                                <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{line.item_code}</td>
                                <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{line.product_name}</td>
                                <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">{fmtQty(line.qty)}</td>
                                <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">
                                  {line.cylinder_flow === 'REFILL_EXCHANGE'
                                    ? 'Refill'
                                    : line.cylinder_flow === 'NON_REFILL'
                                      ? 'Non-Refill'
                                      : '-'}
                                </td>
                                <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">
                                  {fmtMoney(line.unit_price)}
                                </td>
                                <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">
                                  {fmtMoney(line.line_total)}
                                </td>
                                <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">
                                  {fmtMoney(line.estimated_cost)}
                                </td>
                                <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">
                                  {fmtMoney(line.gross_profit)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </article>

                  <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Return History</h3>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {selectedDetails.returns.length} return record(s)
                      </span>
                    </div>
                    <div className="mt-2 overflow-x-auto">
                      <table className="min-w-[980px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
                          <tr>
                            <th className="px-2 py-1.5">Returned At</th>
                            <th className="px-2 py-1.5">Status</th>
                            <th className="px-2 py-1.5">Return ID</th>
                            <th className="px-2 py-1.5 text-right">Amount</th>
                            <th className="px-2 py-1.5 text-right">Points Reversed</th>
                            <th className="px-2 py-1.5">Reason</th>
                            <th className="px-2 py-1.5">Lines</th>
                            <th className="px-2 py-1.5 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedDetails.returns.length === 0 ? (
                            <tr>
                              <td className="px-2 py-2 text-slate-500 dark:text-slate-400" colSpan={8}>
                                No item returns recorded for this sale.
                              </td>
                            </tr>
                          ) : (
                            selectedDetails.returns.map((saleReturn) => (
                              <tr className="border-t border-slate-100 dark:border-slate-800" key={saleReturn.sale_return_id}>
                                <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{fmtDateTime(saleReturn.created_at)}</td>
                                <td className="px-2 py-1.5">
                                  <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${saleReturnStatusClasses(saleReturn.status)}`}>
                                    {saleReturnStatusLabel(saleReturn.status)}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{saleReturn.sale_return_id}</td>
                                <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">{fmtMoney(saleReturn.total_amount)}</td>
                                <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">{saleReturn.points_reversed}</td>
                                <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">
                                  {saleReturn.reason}
                                  {saleReturn.status === 'VOIDED' && saleReturn.void_reason ? (
                                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                      Reversal note: {saleReturn.void_reason}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">
                                  {saleReturn.lines.map((line) => `${line.product_name} x ${fmtQty(line.quantity)}`).join(', ')}
                                </td>
                                <td className="px-2 py-1.5 text-center">
                                  {saleReturn.status === 'POSTED' && selectedDetails.sale.status === 'ACTIVE' ? (
                                    <button
                                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                                      onClick={() => openVoidReturnDialog(saleReturn)}
                                      type="button"
                                    >
                                      Reverse Return
                                    </button>
                                  ) : (
                                    <span className="text-xs text-slate-400 dark:text-slate-500">-</span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </article>

                  {selectedDetails.delivery ? (
                    <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Delivery Details</h3>
                      <dl className="mt-2 grid grid-cols-[140px_1fr] gap-y-1 text-sm">
                        <dt className="text-slate-500 dark:text-slate-400">Delivery ID</dt>
                        <dd className="text-slate-800 dark:text-slate-100">{selectedDetails.delivery.id}</dd>
                        <dt className="text-slate-500 dark:text-slate-400">Status</dt>
                        <dd className="text-slate-800 dark:text-slate-100">{selectedDetails.delivery.status}</dd>
                        <dt className="text-slate-500 dark:text-slate-400">Scheduled</dt>
                        <dd className="text-slate-800 dark:text-slate-100">
                          {fmtDateTime(selectedDetails.delivery.scheduled_at)}
                        </dd>
                        <dt className="text-slate-500 dark:text-slate-400">Completed</dt>
                        <dd className="text-slate-800 dark:text-slate-100">
                          {fmtDateTime(selectedDetails.delivery.completed_at)}
                        </dd>
                      </dl>

                      <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            <tr>
                              <th className="px-2 py-1">Role</th>
                              <th className="px-2 py-1">Personnel</th>
                              <th className="px-2 py-1">Email</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedDetails.delivery.assignments.length === 0 ? (
                              <tr>
                                <td className="px-2 py-2 text-slate-500 dark:text-slate-400" colSpan={3}>
                                  No assignments.
                                </td>
                              </tr>
                            ) : (
                              selectedDetails.delivery.assignments.map((assignment) => (
                                <tr
                                  className="border-t border-slate-100 dark:border-slate-800"
                                  key={`${assignment.user_id}:${assignment.role}`}
                                >
                                  <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{assignment.role}</td>
                                  <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{assignment.full_name}</td>
                                  <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{assignment.email}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">No details to display.</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {selectedSaleId && paymentBreakdownOpen && selectedDetails ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <section className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Payment Breakdown</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedDetails.sale.receipt_number
                    ? `Receipt #${selectedDetails.sale.receipt_number}`
                    : `Sale ID ${selectedDetails.sale.sale_id}`}
                </p>
              </div>
              <button
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"
                onClick={() => setPaymentBreakdownOpen(false)}
                type="button"
              >
                Close
              </button>
            </header>
            <div className="max-h-[75vh] overflow-y-auto p-4">
              <div className="grid gap-3 md:grid-cols-4">
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Total</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {fmtMoney(selectedDetails.sale.total_amount)}
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Paid</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {fmtMoney(selectedDetails.sale.payment_total)}
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Due</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {fmtMoney(Math.max(0, selectedDetails.sale.total_amount - selectedDetails.sale.payment_total))}
                  </p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Methods</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedDetails.sale.payment_methods.join(', ') || 'N/A'}
                  </p>
                </article>
              </div>

              <article className="mt-4 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Payment Lines</h3>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="px-2 py-1">Source</th>
                        <th className="px-2 py-1">Method</th>
                        <th className="px-2 py-1 text-right">Amount</th>
                        <th className="px-2 py-1">Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDetails.payments.length === 0 ? (
                        <tr>
                          <td className="px-2 py-2 text-slate-500 dark:text-slate-400" colSpan={4}>
                            No payments recorded.
                          </td>
                        </tr>
                      ) : (
                        selectedDetails.payments.map((payment) => (
                          <tr
                            className="border-t border-slate-100 dark:border-slate-800"
                            key={`breakdown-${payment.payment_source}-${payment.payment_id}`}
                          >
                            <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">
                              {payment.payment_source === 'SETTLEMENT' ? 'Settlement' : 'Sale'}
                            </td>
                            <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">{payment.method}</td>
                            <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">
                              {fmtMoney(payment.amount)}
                            </td>
                            <td className="px-2 py-1.5 text-slate-700 dark:text-slate-200">
                              {payment.reference_no ?? 'N/A'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>
          </section>
        </div>
      ) : null}

      {voidReturnOpen && selectedReturnToVoid ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-4">
          <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Reverse Sale Return</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Return {selectedReturnToVoid.sale_return_id} | {fmtMoney(selectedReturnToVoid.total_amount)}
                </p>
              </div>
              <button
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"
                onClick={closeVoidReturnDialog}
                type="button"
                disabled={voidReturnSaving}
              >
                Close
              </button>
            </header>
            <div className="space-y-3 p-4">
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                Reversing this return will remove the restored stock and add back any points that were reversed when the return was posted.
              </div>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Reversal Reason</span>
                <textarea
                  className="min-h-[110px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) => setVoidReturnReason(event.target.value)}
                  value={voidReturnReason}
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                  onClick={closeVoidReturnDialog}
                  type="button"
                  disabled={voidReturnSaving}
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  onClick={() => void submitVoidSaleReturn()}
                  type="button"
                  disabled={voidReturnSaving}
                >
                  {voidReturnSaving ? 'Reversing...' : 'Confirm Reverse Return'}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
