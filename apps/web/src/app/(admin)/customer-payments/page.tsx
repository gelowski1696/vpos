'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type CustomerRecord = {
  id: string;
  code: string;
  name: string;
  outstandingBalance?: number;
};

type CustomerPaymentRow = {
  payment_id: string;
  sale_id?: string | null;
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  branch_id: string | null;
  branch_name: string | null;
  method: 'CASH' | 'CARD' | 'E_WALLET';
  amount: number;
  reference_no: string | null;
  notes: string | null;
  posted_at: string;
  created_by_name: string | null;
  customer_outstanding_balance: number;
};

function fmtMoney(value: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2
  }).format(value);
}

function fmtDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export default function CustomerPaymentsPage(): JSX.Element {
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [rows, setRows] = useState<CustomerPaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState('ALL');
  const [selectedBranchId, setSelectedBranchId] = useState('ALL');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  const selectedCustomer = useMemo(
    () => customers.find((row) => row.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  async function loadFilters(): Promise<void> {
    const [branchData, customerData] = await Promise.all([
      apiRequest<BranchRecord[]>('/master-data/branches'),
      apiRequest<CustomerRecord[]>('/master-data/customers?include_balance=true')
    ]);
    const activeBranches = branchData.filter((branch) => branch.isActive);
    setBranches(activeBranches);
    setCustomers(customerData);
    setSelectedBranchId((current) => {
      if (current === 'ALL') {
        return current;
      }
      if (activeBranches.some((branch) => branch.id === current)) {
        return current;
      }
      return 'ALL';
    });
    setSelectedCustomerId((current) => {
      if (current === 'ALL') {
        return current;
      }
      if (current && customerData.some((customer) => customer.id === current)) {
        return current;
      }
      return 'ALL';
    });
  }

  async function loadRows(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedBranchId !== 'ALL') {
        params.set('branch_id', selectedBranchId);
      }
      if (selectedCustomerId !== 'ALL') {
        params.set('customer_id', selectedCustomerId);
      }
      if (since) {
        params.set('since', new Date(`${since}T00:00:00.000`).toISOString());
      }
      if (until) {
        params.set('until', new Date(`${until}T23:59:59.999`).toISOString());
      }
      params.set('limit', '300');
      const query = params.toString();
      const data = await apiRequest<CustomerPaymentRow[]>(
        `/customer-payments${query ? `?${query}` : ''}`
      );
      setRows(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load customer payments');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadFilters();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to load customer payment filters');
      }
    })();
  }, []);

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId, selectedCustomerId, since, until]);

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-brandPrimary">Customer Payments</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Payment history view. New customer payments are recorded from Mobile Sales Details.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Payment History Filters</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Customer</span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setSelectedCustomerId(event.target.value)}
              value={selectedCustomerId}
            >
              <option value="ALL">All Customers</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} ({customer.code})
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
              Outstanding: {fmtMoney(selectedCustomer?.outstandingBalance ?? 0)}
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Branch</span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setSelectedBranchId(event.target.value)}
              value={selectedBranchId}
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
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-60"
              disabled={loading}
              onClick={() => void loadRows()}
              type="button"
            >
              {loading ? 'Loading...' : 'Refresh History'}
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
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Customer Payment Records</h2>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {rows.length} row(s)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2">Posted At</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Branch</th>
                <th className="px-3 py-2">Sale</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Outstanding Balance</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Posted By</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={10}>
                    {loading ? 'Loading customer payments...' : 'No customer payments found.'}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr className="border-t border-slate-100 dark:border-slate-800" key={row.payment_id}>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{fmtDate(row.posted_at)}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                      {row.customer_name ?? row.customer_id}
                      {row.customer_code ? ` (${row.customer_code})` : ''}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.branch_name ?? 'All/Unspecified'}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.sale_id ?? 'N/A'}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.method}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmtMoney(row.amount)}</td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                      {fmtMoney(row.customer_outstanding_balance)}
                    </td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.reference_no ?? 'N/A'}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.created_by_name ?? 'N/A'}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.notes ?? '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
