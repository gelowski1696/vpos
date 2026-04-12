'use client';

import type { Route } from 'next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { EntityManager } from '../../../components/entity-manager';
import {
  MasterDataImportWizard,
  type ImportColumn
} from '../../../components/master-data-import-wizard';
import { apiRequest } from '../../../lib/api-client';

function customerTypeLabel(value: unknown): string {
  if (value === 'BUSINESS') {
    return 'Business';
  }
  return 'Retail';
}

function yesNo(value: unknown): string {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return 'Yes';
  }
  return 'No';
}

function money(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  const amount = Number(value);
  if (Number.isNaN(amount)) {
    return '-';
  }
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2
  }).format(amount);
}

function generateShortCode(prefix: string): string {
  const normalizedPrefix = prefix
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4) || 'CU';
  const suffixLength = Math.max(1, 8 - normalizedPrefix.length);
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const suffix = seed.slice(-suffixLength).padStart(suffixLength, '0');
  return `${normalizedPrefix}${suffix}`.slice(0, 8);
}

type CustomerSalesHistoryResponse = {
  rows: Array<{
    sale_id: string;
    receipt_number: string | null;
    sale_type: string;
    total_amount: number;
    payment_total: number;
    posted_at: string | null;
    created_at: string;
  }>;
};

type CustomerPaymentHistoryRow = {
  payment_id: string;
  sale_id?: string | null;
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  method: 'CASH' | 'CARD' | 'E_WALLET';
  amount: number;
  reference_no: string | null;
  posted_at: string;
  customer_outstanding_balance: number;
};

type CustomerHistoryEntry = {
  id: string;
  type: 'SALE' | 'PAYMENT';
  timestamp: string;
  title: string;
  subtitle: string;
  amount: number;
};

type SelectedCustomer = {
  id: string;
  code: string;
  name: string;
  outstandingBalance: number;
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

export default function CustomersPage(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [reloadSignal, setReloadSignal] = useState(0);
  const [liveFormState, setLiveFormState] = useState<{
    mode: 'create' | 'edit';
    editingId: string | null;
    code: string;
  }>({
    mode: 'create',
    editingId: null,
    code: ''
  });
  const [liveCodeState, setLiveCodeState] = useState<'idle' | 'invalid' | 'checking' | 'exists' | 'available'>('idle');
  const codeCheckTokenRef = useRef(0);
  const codeCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transactionsOpen, setTransactionsOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<CustomerHistoryEntry[]>([]);

  useEffect(() => {
    if (codeCheckTimerRef.current) {
      clearTimeout(codeCheckTimerRef.current);
      codeCheckTimerRef.current = null;
    }

    const normalizedCode = String(liveFormState.code ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!normalizedCode) {
      setLiveCodeState('idle');
      return;
    }
    if (normalizedCode.length < 1 || normalizedCode.length > 8) {
      setLiveCodeState('invalid');
      return;
    }

    const token = codeCheckTokenRef.current + 1;
    codeCheckTokenRef.current = token;
    setLiveCodeState('checking');
    codeCheckTimerRef.current = setTimeout(() => {
      const query = new URLSearchParams();
      query.set('code', normalizedCode);
      if (liveFormState.mode === 'edit' && liveFormState.editingId) {
        query.set('excludeId', liveFormState.editingId);
      }
      void apiRequest<{ exists: boolean }>(`/master-data/customers/code-exists?${query.toString()}`)
        .then((result) => {
          if (codeCheckTokenRef.current !== token) {
            return;
          }
          setLiveCodeState(result.exists ? 'exists' : 'available');
        })
        .catch(() => {
          if (codeCheckTokenRef.current !== token) {
            return;
          }
          setLiveCodeState('idle');
        });
    }, 250);

    return () => {
      if (codeCheckTimerRef.current) {
        clearTimeout(codeCheckTimerRef.current);
        codeCheckTimerRef.current = null;
      }
    };
  }, [liveFormState.code, liveFormState.editingId, liveFormState.mode]);

  const customerTypeTemplateValues = useMemo(() => ['RETAIL', 'BUSINESS'], []);
  const customerTierTemplateValues = useMemo(() => ['REGULAR', 'PREMIUM', 'WHOLESALE'], []);
  const activeTemplateValues = useMemo(() => ['true', 'false'], []);
  const importColumns: ImportColumn[] = useMemo(
    () => [
      {
        key: 'code',
        label: 'Customer Code',
        required: true,
        example: 'CUST001',
        aliases: ['customercode', 'customer_code']
      },
      {
        key: 'name',
        label: 'Customer Name',
        required: true,
        example: 'Walk-in Customer',
        aliases: ['customername', 'customer_name']
      },
      {
        key: 'address',
        label: 'Address',
        example: 'Brgy. Sample, City',
        aliases: ['customer_address']
      },
      {
        key: 'type',
        label: 'Customer Type',
        example: 'RETAIL',
        templateDropdownValues: customerTypeTemplateValues
      },
      {
        key: 'tier',
        label: 'Tier',
        example: 'REGULAR',
        templateDropdownValues: customerTierTemplateValues
      },
      { key: 'contractPrice', label: 'Contract Price', example: 0, aliases: ['contract_price'] },
      {
        key: 'isActive',
        label: 'Active',
        example: true,
        aliases: ['is_active'],
        templateDropdownValues: activeTemplateValues
      }
    ],
    [activeTemplateValues, customerTierTemplateValues, customerTypeTemplateValues]
  );
  const deepLinkCustomerId = searchParams.get('customer_id')?.trim() || null;
  const handleDeepLinkHandled = useCallback(
    (_result: { id: string; found: boolean }) => {
      if (!deepLinkCustomerId) {
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.delete('customer_id');
      const nextQuery = params.toString();
      router.replace((nextQuery ? `${pathname}?${nextQuery}` : pathname) as Route);
    },
    [deepLinkCustomerId, pathname, router, searchParams]
  );
  const transactionSummary = useMemo(() => {
    let saleCount = 0;
    let paymentCount = 0;
    let saleTotal = 0;
    let paymentTotal = 0;
    for (const item of transactions) {
      if (item.type === 'SALE') {
        saleCount += 1;
        saleTotal += item.amount;
      } else {
        paymentCount += 1;
        paymentTotal += item.amount;
      }
    }
    return {
      saleCount,
      paymentCount,
      saleTotal: Number(saleTotal.toFixed(2)),
      paymentTotal: Number(paymentTotal.toFixed(2))
    };
  }, [transactions]);

  const latestOutstandingBalance = useMemo(() => {
    const latestPayment = transactions.find((item) => item.type === 'PAYMENT');
    if (!latestPayment) {
      return selectedCustomer?.outstandingBalance ?? 0;
    }
    const marker = latestPayment.subtitle.match(/Balance:\s*([0-9.,-]+)/i)?.[1] ?? null;
    if (!marker) {
      return selectedCustomer?.outstandingBalance ?? 0;
    }
    const parsed = Number(marker.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : selectedCustomer?.outstandingBalance ?? 0;
  }, [selectedCustomer?.outstandingBalance, transactions]);

  async function openTransactions(row: Record<string, unknown>): Promise<void> {
    const customerId = String(row.id ?? '').trim();
    if (!customerId) {
      return;
    }
    setSelectedCustomer({
      id: customerId,
      code: String(row.code ?? customerId),
      name: String(row.name ?? customerId),
      outstandingBalance: Number(row.outstandingBalance ?? 0)
    });
    setTransactionsOpen(true);
    setTransactionsLoading(true);
    setTransactionsError(null);
    setTransactions([]);
    try {
      const [salesRes, paymentsRes] = await Promise.all([
        apiRequest<CustomerSalesHistoryResponse>(
          `/reports/sales/list?customer_id=${encodeURIComponent(customerId)}&limit=500`
        ),
        apiRequest<CustomerPaymentHistoryRow[]>(
          `/customer-payments?customer_id=${encodeURIComponent(customerId)}&limit=500`
        )
      ]);
      const saleEntries: CustomerHistoryEntry[] = (salesRes.rows ?? []).map((rowItem) => ({
        id: `sale:${rowItem.sale_id}`,
        type: 'SALE',
        timestamp: rowItem.posted_at ?? rowItem.created_at,
        title: rowItem.receipt_number
          ? `Sale ${rowItem.receipt_number}`
          : `Sale ${rowItem.sale_id}`,
        subtitle: `${rowItem.sale_type} | Paid ${money(rowItem.payment_total)} | Total ${money(rowItem.total_amount)}`,
        amount: Number(rowItem.total_amount ?? 0)
      }));
      const paymentEntries: CustomerHistoryEntry[] = (paymentsRes ?? []).map((rowItem) => ({
        id: `payment:${rowItem.payment_id}`,
        type: 'PAYMENT',
        timestamp: rowItem.posted_at,
        title: `Payment ${rowItem.method}`,
        subtitle: `${rowItem.sale_id ? `Sale ${rowItem.sale_id} | ` : ''}${rowItem.reference_no ? `Ref ${rowItem.reference_no} | ` : ''}Balance: ${Number(rowItem.customer_outstanding_balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        amount: Number(rowItem.amount ?? 0)
      }));
      const merged = [...saleEntries, ...paymentEntries].sort((a, b) =>
        (b.timestamp ?? '').localeCompare(a.timestamp ?? '')
      );
      setTransactions(merged);
    } catch (cause) {
      setTransactionsError(
        cause instanceof Error ? cause.message : 'Failed to load customer transactions.'
      );
    } finally {
      setTransactionsLoading(false);
    }
  }

  function closeTransactions(): void {
    setTransactionsOpen(false);
    setSelectedCustomer(null);
    setTransactions([]);
    setTransactionsError(null);
    setTransactionsLoading(false);
  }

  return (
    <>
      <EntityManager
      defaultValues={{ code: '', name: '', address: '', type: 'RETAIL', tier: 'REGULAR', contractPrice: null, isActive: true }}
      endpoint="/master-data/customers?include_balance=true"
      reloadSignal={reloadSignal}
      toolbarActions={
        <MasterDataImportWizard
          title="Customers"
          entity="customers"
          endpointBase="/master-data/import/customers"
          columns={importColumns}
          onImported={() => {
            setReloadSignal((current) => current + 1);
          }}
        />
      }
      fields={[
        {
          key: 'code',
          label: 'Customer Code',
          helperText: 'Optional short code (1-8, A-Z/0-9). Leave blank to auto-generate.'
        },
        {
          key: 'name',
          label: 'Customer Name',
          required: true,
          helperText: 'Display name used in POS and reports.'
        },
        {
          key: 'address',
          label: 'Customer Address',
          helperText: 'Optional address shown in customer detail screens.'
        },
        {
          key: 'type',
          label: 'Customer Type',
          type: 'select',
          required: true,
          options: [
            { value: 'RETAIL', label: 'Retail' },
            { value: 'BUSINESS', label: 'Business' }
          ]
        },
        {
          key: 'tier',
          label: 'Customer Tier',
          type: 'select',
          options: [
            { value: 'REGULAR', label: 'Regular' },
            { value: 'PREMIUM', label: 'Premium' },
            { value: 'WHOLESALE', label: 'Wholesale' }
          ],
          helperText: 'Used for tier-based pricing rules.'
        },
        {
          key: 'contractPrice',
          label: 'Contract Price (PHP)',
          type: 'number',
          helperText: 'Optional fixed price if this customer has a direct contract.'
        },
        {
          key: 'outstandingBalance',
          label: 'Outstanding Balance',
          formHidden: true
        },
        { key: 'isActive', label: 'Active', type: 'boolean' }
      ]}
      tableColumnOverrides={{
        type: {
          label: 'Customer Type',
          render: (value) => customerTypeLabel(value)
        },
        tier: {
          label: 'Tier',
          render: (value) => (value ? String(value) : '-')
        },
        address: {
          label: 'Address',
          render: (value) => (value ? String(value) : '-')
        },
        contractPrice: {
          label: 'Contract Price',
          render: (value) => money(value)
        },
        outstandingBalance: {
          label: 'Outstanding Balance',
          render: (value) => money(value)
        },
        isActive: {
          label: 'Active',
          render: (value) => yesNo(value)
        }
      }}
      onFormStateChange={(form, context) => {
        setLiveFormState({
          mode: context.mode,
          editingId: context.editingId,
          code: String(form.code ?? '')
        });
      }}
      renderFieldAction={({ field, disabled, setValue }) =>
        field.key === 'code' ? (
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => setValue(generateShortCode('CU'))}
            title="Auto-generate code"
            type="button"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
              <path d="M12 3v4M12 17v4M4.2 7.2l2.8 2.8M17 14l2.8 2.8M3 12h4M17 12h4M4.2 16.8 7 14M17 10l2.8-2.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
            </svg>
          </button>
        ) : null
      }
      renderFieldIndicator={({ field }) => {
        if (field.key !== 'code') {
          return null;
        }
        if (liveCodeState === 'invalid') {
          return <p className="text-xs text-rose-600">X Code must be 1 to 8 characters (A-Z, 0-9).</p>;
        }
        if (liveCodeState === 'checking') {
          return <p className="text-xs text-slate-500">Checking code availability...</p>;
        }
        if (liveCodeState === 'exists') {
          return <p className="text-xs text-rose-600">X Code already exists.</p>;
        }
        if (liveCodeState === 'available') {
          return <p className="text-xs text-emerald-600">OK Code is available.</p>;
        }
        return <p className="text-xs text-slate-500">If left blank, code is auto-generated.</p>;
      }}
      rowActions={[
        {
          key: 'transactions',
          label: 'Transactions',
          onClick: (row) => {
            void openTransactions(row);
          },
          buttonClassName:
            'rounded-lg border border-sky-300 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/40',
          showWhenReadOnly: true
        }
      ]}
      title="Customers"
      transformBeforeSubmit={async (payload, context) => {
        const normalizedCode = String(payload.code ?? '')
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
        if (normalizedCode && (normalizedCode.length < 1 || normalizedCode.length > 8)) {
          throw new Error('Customer code must be 1 to 8 characters (A-Z, 0-9).');
        }
        if (normalizedCode) {
          const query = new URLSearchParams();
          query.set('code', normalizedCode);
          if (context.mode === 'edit' && context.editingId) {
            query.set('excludeId', context.editingId);
          }
          const existsResult = await apiRequest<{ exists: boolean }>(
            `/master-data/customers/code-exists?${query.toString()}`
          );
          if (existsResult.exists) {
            throw new Error(`Customer code "${normalizedCode}" already exists.`);
          }
        }

        return {
          ...payload,
          code: normalizedCode,
          address:
            payload.address === null || payload.address === undefined || String(payload.address).trim() === ''
              ? null
              : String(payload.address).trim(),
          tier: payload.tier ? String(payload.tier) : null,
          contractPrice:
            payload.contractPrice === null || payload.contractPrice === undefined || payload.contractPrice === ''
              ? null
              : Number(payload.contractPrice)
        };
      }}
      allowDelete
      deepLinkEditId={deepLinkCustomerId}
      onDeepLinkHandled={handleDeepLinkHandled}
      />

      {transactionsOpen && selectedCustomer ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <section className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {selectedCustomer.name}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedCustomer.code} | Customer Transactions
                </p>
              </div>
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={closeTransactions}
                type="button"
              >
                Close
              </button>
            </header>

            <div className="grid gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs sm:grid-cols-5 dark:border-slate-700 dark:bg-slate-950/40">
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-slate-500 dark:text-slate-400">Sales</p>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{transactionSummary.saleCount}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-slate-500 dark:text-slate-400">Payments</p>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{transactionSummary.paymentCount}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-slate-500 dark:text-slate-400">Sales Total</p>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{money(transactionSummary.saleTotal)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-slate-500 dark:text-slate-400">Payments Total</p>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{money(transactionSummary.paymentTotal)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                <p className="text-slate-500 dark:text-slate-400">Outstanding</p>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{money(latestOutstandingBalance)}</p>
              </div>
            </div>

            <div className="overflow-auto p-4">
              {transactionsLoading ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Loading transactions...</p>
              ) : transactionsError ? (
                <p className="text-sm text-rose-600">{transactionsError}</p>
              ) : transactions.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No transactions found for this customer.
                </p>
              ) : (
                <div className="space-y-2">
                  {transactions.map((item) => (
                    <article
                      key={item.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              item.type === 'SALE'
                                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
                                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            }`}
                          >
                            {item.type}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {fmtDateTime(item.timestamp)}
                          </span>
                        </div>
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {item.title}
                        </p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {money(item.amount)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
