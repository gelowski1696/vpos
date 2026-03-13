'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type SalesListRow = {
  sale_id: string;
  posted_at: string | null;
  created_at: string;
  receipt_number: string | null;
  branch_id: string;
  branch_name: string;
  branch_code: string;
  location_id: string;
  location_name: string;
  location_code: string;
  cashier_name: string;
  cashier_email: string;
  customer_name: string | null;
  customer_code: string | null;
  sale_type: string;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  cogs_amount: number;
  gross_profit: number;
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
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [rows, setRows] = useState<SalesListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<SalesDetailResponse | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [paymentBreakdownOpen, setPaymentBreakdownOpen] = useState(false);

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
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
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

      <div className="rounded-2xl border border-slate-200 bg-white p-0 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Sales Records</h2>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {rows.length} row(s)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1300px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2">Posted At</th>
                <th className="px-3 py-2">Receipt</th>
                <th className="px-3 py-2">Sale ID</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Cashier</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Total</th>
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
                  <td className="px-3 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={14}>
                    {loading ? 'Loading sales...' : 'No sales found for selected filter.'}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr className="border-t border-slate-100 dark:border-slate-800" key={row.sale_id}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{fmtDateTime(row.posted_at)}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.receipt_number ?? 'N/A'}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.sale_id}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {row.branch_name} ({row.branch_code})
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {row.location_name} ({row.location_code})
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.cashier_name}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {row.customer_name ? `${row.customer_name}${row.customer_code ? ` (${row.customer_code})` : ''}` : 'Walk-in / N/A'}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.sale_type}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmtMoney(row.total_amount)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmtMoney(row.payment_total)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmtMoney(row.cogs_amount)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmtMoney(row.gross_profit)}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.payment_methods.join(', ') || 'N/A'}</td>
                    <td className="px-3 py-2 text-center">
                      <button
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
                  </div>

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
                        <dt className="text-slate-500 dark:text-slate-400">Location</dt>
                        <dd className="text-slate-800 dark:text-slate-100">
                          {selectedDetails.sale.location_name} ({selectedDetails.sale.location_code})
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
    </section>
  );
}
