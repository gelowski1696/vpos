'use client';

import { useEffect, useMemo, useState } from 'react';
import { TablePaginationControls } from '../../../components/table-pagination-controls';
import { apiRequest } from '../../../lib/api-client';
import { useTablePagination } from '../../../lib/table-pagination';
import { toastError } from '../../../lib/web-toast';
import {
  resolveCustomerPricingView,
  type CustomerPricingBranch,
  type CustomerPricingCategory,
  type CustomerPricingCustomer,
  type CustomerPricingFlowMode,
  type CustomerPricingList,
  type CustomerPricingProduct,
  type CustomerPricingView
} from '../../../lib/customer-pricing-view';
import { getScopeLookupOrder, lookupStepLabel, scopeLabel, scopeLabelWithAddonText } from '../../../lib/price-list-addons';

type EntitlementResponse = {
  addons?: {
    customer_pricelist_view?: boolean;
    custom_pricing?: boolean;
    customer_category?: boolean;
  };
};

function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '-';
  }
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2
  }).format(Number(value));
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function formatDateRange(start: string, end: string | null | undefined): string {
  const startText = formatDateTime(start);
  const endText = end ? formatDateTime(end) : 'Open-ended';
  return `${startText} - ${endText}`;
}

function flowLabel(value: CustomerPricingFlowMode | null): string {
  if (value === 'REFILL_EXCHANGE') {
    return 'Refill exchange';
  }
  if (value === 'NON_REFILL') {
    return 'Non-refill';
  }
  return 'Any flow';
}

function scopeTargetLabel(
  list: CustomerPricingList,
  customer: CustomerPricingCustomer,
  branch: CustomerPricingBranch,
  categoryName: string | null
): string {
  switch (list.scope) {
    case 'CONTRACT':
      return list.customerId === customer.id ? `Customer ${customer.code}` : 'Specific customer';
    case 'CUSTOMER_GROUP':
      return categoryName ? `Category ${categoryName}` : list.customerCategoryId ? `Category ID ${list.customerCategoryId}` : 'Customer category';
    case 'TIER':
      return list.customerTier ? `Tier ${list.customerTier}` : 'Customer tier';
    case 'BRANCH':
      return list.branchId === branch.id ? `Branch ${branch.code}` : 'Branch-specific';
    case 'GLOBAL':
      return 'All customers';
    default:
      return list.scope;
  }
}

function scopeDisplayLabel(scope: CustomerPricingView['applicableLists'][number]['scope'], customPricingEnabled: boolean): string {
  return scope === 'CUSTOMER_GROUP' && customPricingEnabled ? scopeLabelWithAddonText(scope) : scopeLabel(scope);
}

function candidateText(candidate: CustomerPricingView['productRows'][number]['final']): string {
  if (!candidate) {
    return 'No matching price';
  }
  if (candidate.source === 'customer_contract_price') {
    return `${candidate.sourceLabel} · ${formatMoney(candidate.unitPrice)}`;
  }
  const code = candidate.priceListCode?.trim() || candidate.priceListName?.trim() || candidate.sourceLabel;
  return `${code} · ${formatMoney(candidate.unitPrice)}`;
}

function candidateSubtext(candidate: CustomerPricingView['productRows'][number]['final']): string {
  if (!candidate) {
    return 'No applicable rule found for the selected customer and branch context.';
  }
  if (candidate.priceListName && candidate.priceListCode) {
    return `${candidate.sourceLabel} · ${candidate.priceListName}`;
  }
  if (candidate.priceListName) {
    return `${candidate.sourceLabel} · ${candidate.priceListName}`;
  }
  return candidate.sourceLabel;
}

function candidateScopeCell(candidate: CustomerPricingView['productRows'][number]['candidates'][keyof CustomerPricingView['productRows'][number]['candidates']]) {
  if (!candidate) {
    return <span className="text-slate-400">-</span>;
  }
  return (
    <div className="space-y-0.5">
      <div className="font-semibold text-slate-900 dark:text-slate-100">{formatMoney(candidate.unitPrice)}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">
        {candidate.priceListCode?.trim() || candidate.sourceLabel}
      </div>
    </div>
  );
}

export default function CustomerViewingPage(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [branches, setBranches] = useState<CustomerPricingBranch[]>([]);
  const [customers, setCustomers] = useState<CustomerPricingCustomer[]>([]);
  const [categories, setCategories] = useState<CustomerPricingCategory[]>([]);
  const [products, setProducts] = useState<CustomerPricingProduct[]>([]);
  const [priceLists, setPriceLists] = useState<CustomerPricingList[]>([]);

  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [requestedFlow, setRequestedFlow] = useState<CustomerPricingFlowMode | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [requestedAt, setRequestedAt] = useState(() => new Date().toISOString());
  const [customPricingEnabled, setCustomPricingEnabled] = useState(false);

  const customerById = useMemo(() => new Map(customers.map((row) => [row.id, row])), [customers]);
  const branchById = useMemo(() => new Map(branches.map((row) => [row.id, row])), [branches]);
  const categoryById = useMemo(() => new Map(categories.map((row) => [row.id, row])), [categories]);

  const selectedCustomer = useMemo(() => {
    if (selectedCustomerId && customerById.has(selectedCustomerId)) {
      return customerById.get(selectedCustomerId) ?? null;
    }
    return customers.find((row) => row.isActive) ?? customers[0] ?? null;
  }, [customerById, customers, selectedCustomerId]);

  const selectedBranch = useMemo(() => {
    if (branchId && branchById.has(branchId)) {
      return branchById.get(branchId) ?? null;
    }
    return branches.find((row) => row.isActive) ?? branches[0] ?? null;
  }, [branchById, branchId, branches]);

  const customerCategoryName = useMemo(() => {
    if (!selectedCustomer?.customerCategoryId) {
      return null;
    }
    return categoryById.get(selectedCustomer.customerCategoryId)?.name ?? null;
  }, [categoryById, selectedCustomer]);

  const scopeOrder = useMemo(() => getScopeLookupOrder(customPricingEnabled), [customPricingEnabled]);

  const customerOptions = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    const filtered = term
      ? customers.filter((row) => {
          const haystack = `${row.code} ${row.name} ${row.tier ?? ''} ${row.province ?? ''} ${row.city ?? ''}`.toLowerCase();
          return haystack.includes(term);
        })
      : customers;
    if (selectedCustomer && !filtered.some((row) => row.id === selectedCustomer.id)) {
      return [selectedCustomer, ...filtered];
    }
    return filtered;
  }, [customerSearch, customers, selectedCustomer]);

  const pricingView = useMemo<CustomerPricingView | null>(() => {
    if (!selectedCustomer || !selectedBranch) {
      return null;
    }
    return resolveCustomerPricingView({
      customer: selectedCustomer,
      branchId: selectedBranch.id,
      requestedAt,
      requestedFlow,
      products,
      branches,
      priceLists,
      customPricingEnabled
    });
  }, [branches, customPricingEnabled, priceLists, products, requestedAt, requestedFlow, selectedBranch, selectedCustomer]);

  const filteredRows = useMemo(() => {
    if (!pricingView) {
      return [];
    }
    const term = productSearch.trim().toLowerCase();
    if (!term) {
      return pricingView.productRows;
    }
    return pricingView.productRows.filter((row) => {
      const category = row.product.category ?? '';
      const haystack = `${row.product.sku} ${row.product.name} ${category}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [pricingView, productSearch]);

  const paginatedRows = useTablePagination(filteredRows, {
    initialPageSize: 10,
    pageSizeOptions: [10, 25, 50],
    resetKey: `${selectedCustomerId}|${branchId}|${requestedFlow ?? 'ANY'}|${productSearch}|${filteredRows.length}`
  });

  const scopeColumns = useMemo(
    () =>
      scopeOrder.map((scope) => ({
        scope,
        label: scopeDisplayLabel(scope, customPricingEnabled),
        stepLabel: lookupStepLabel(scope, customPricingEnabled)
      })),
    [customPricingEnabled, scopeOrder]
  );

  async function loadData(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const entitlement = await apiRequest<EntitlementResponse>('/platform/entitlements/current');
      const addonEnabled = entitlement.addons?.customer_pricelist_view === true;
      setEnabled(addonEnabled);
      setCustomPricingEnabled(entitlement.addons?.custom_pricing === true);
      if (!addonEnabled) {
        setBranches([]);
        setCustomers([]);
        setCategories([]);
        setProducts([]);
        setPriceLists([]);
        return;
      }

      const branchPromise = apiRequest<CustomerPricingBranch[]>('/master-data/branches');
      const customerPromise = apiRequest<CustomerPricingCustomer[]>('/master-data/customers');
      const productPromise = apiRequest<CustomerPricingProduct[]>('/master-data/products');
      const priceListPromise = apiRequest<CustomerPricingList[]>('/master-data/price-lists');

      const [branchRows, customerRows, productRows, priceListRows] = await Promise.all([
        branchPromise,
        customerPromise,
        productPromise,
        priceListPromise
      ]);

      setBranches(branchRows);
      setCustomers(customerRows);
      setProducts(productRows);
      setPriceLists(priceListRows);

      if (entitlement.addons?.customer_category === true) {
        try {
          const categoryRows = await apiRequest<CustomerPricingCategory[]>('/master-data/customer-categories');
          setCategories(categoryRows);
        } catch {
          setCategories([]);
        }
      } else {
        setCategories([]);
      }

      setRequestedAt(new Date().toISOString());
      const defaultCustomer = customerRows.find((row) => row.isActive) ?? customerRows[0] ?? null;
      const defaultBranch = branchRows.find((row) => row.isActive) ?? branchRows[0] ?? null;
      setSelectedCustomerId((current) => current || defaultCustomer?.id || '');
      setBranchId((current) => current || defaultBranch?.id || '');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load customer pricing view data.';
      setError(message);
      toastError('Customer viewing load failed', { description: message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!selectedCustomerId && customers.length > 0) {
      const defaultCustomer = customers.find((row) => row.isActive) ?? customers[0];
      if (defaultCustomer) {
        setSelectedCustomerId(defaultCustomer.id);
      }
    }
    if (selectedCustomerId && !customers.some((row) => row.id === selectedCustomerId) && customers.length > 0) {
      const defaultCustomer = customers.find((row) => row.isActive) ?? customers[0];
      setSelectedCustomerId(defaultCustomer?.id ?? '');
    }
  }, [customers, selectedCustomerId]);

  useEffect(() => {
    if (!branchId && branches.length > 0) {
      const defaultBranch = branches.find((row) => row.isActive) ?? branches[0];
      if (defaultBranch) {
        setBranchId(defaultBranch.id);
      }
    }
    if (branchId && !branches.some((row) => row.id === branchId) && branches.length > 0) {
      const defaultBranch = branches.find((row) => row.isActive) ?? branches[0];
      setBranchId(defaultBranch?.id ?? '');
    }
  }, [branchId, branches]);

  if (enabled === false) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Customer Viewing</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Customer Pricelist View add-on is not enabled for this tenant.
        </p>
      </section>
    );
  }

  if (loading && enabled === null) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Customer Viewing</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Loading customer pricing context...</p>
      </section>
    );
  }

  const selectedCategoryName = customerCategoryName ?? selectedCustomer?.customerCategoryId ?? null;

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Customer Viewing</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Compare customer-specific, tier, branch, and global prices in the same precedence used by checkout.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={() => void loadData()}
              type="button"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[1.8fr_1.2fr_1fr_1fr_auto]">
          <label className="text-xs">
            <span className="mb-1 block text-slate-600 dark:text-slate-300">Search Customer</span>
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setCustomerSearch(event.target.value)}
              placeholder="Search by code, name, tier, or location"
              value={customerSearch}
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-slate-600 dark:text-slate-300">Customer</span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setSelectedCustomerId(event.target.value)}
              value={selectedCustomerId}
            >
              {customerOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                  {!row.isActive ? ' (Inactive)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-slate-600 dark:text-slate-300">Branch Context</span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setBranchId(event.target.value)}
              value={branchId}
            >
              {branches.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} - {row.name}
                  {!row.isActive ? ' (Inactive)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-slate-600 dark:text-slate-300">Flow Mode</span>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => {
                const next = event.target.value;
                setRequestedFlow(next === 'ANY' ? null : (next as CustomerPricingFlowMode));
              }}
              value={requestedFlow ?? 'ANY'}
            >
              <option value="ANY">Any flow</option>
              <option value="REFILL_EXCHANGE">Refill exchange</option>
              <option value="NON_REFILL">Non-refill</option>
            </select>
          </label>
          <div className="flex items-end">
            <div className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              As of {formatDateTime(requestedAt)}
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </div>
        ) : null}

        {selectedCustomer && selectedBranch ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Customer</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {selectedCustomer.code} - {selectedCustomer.name}
                {!selectedCustomer.isActive ? ' (Inactive)' : ''}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {selectedCustomer.province || '-'}{selectedCustomer.city ? `, ${selectedCustomer.city}` : ''}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Customer Pricing</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                Tier {selectedCustomer.tier ?? '-'}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Category {selectedCategoryName ?? '-'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Branch Context</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {selectedBranch.code} - {selectedBranch.name}
                {!selectedBranch.isActive ? ' (Inactive)' : ''}
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{flowLabel(requestedFlow)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/80">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Coverage</div>
              <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {pricingView?.applicableLists.length ?? 0} price list(s)
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {pricingView?.productRows.length ?? 0} product row(s)
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {pricingView ? (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Applicable Price Lists</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  These are the active lists that match the selected customer and branch context.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {scopeColumns.map((column) => (
                  <span
                    key={column.scope}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {column.label}
                  </span>
                ))}
              </div>
            </div>

            {pricingView.applicableLists.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                No active price lists match this customer context.
              </div>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {pricingView.applicableLists.map((list) => (
                  <article
                    key={list.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/80"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {scopeDisplayLabel(list.scope, pricingView.customPricingEnabled)}
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {list.code}
                        </div>
                      </div>
                      <div className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
                        {lookupStepLabel(list.scope, pricingView.customPricingEnabled)}
                      </div>
                    </div>
                    <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">{list.name}</div>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {scopeTargetLabel(list, pricingView.customer, pricingView.branch, customerCategoryName)}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="rounded-full bg-white px-2 py-1 shadow-sm dark:bg-slate-900">
                        {list.ruleCount} rule(s)
                      </span>
                      <span className="rounded-full bg-white px-2 py-1 shadow-sm dark:bg-slate-900">
                        {formatDateRange(list.startsAt, list.endsAt)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Resolved Item Prices</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    The table checks each scope from left to right. The first populated price becomes the final price.
                  </p>
                </div>
                <label className="min-w-[260px] text-xs">
                  <span className="mb-1 block text-slate-600 dark:text-slate-300">Search Item</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Search SKU, product name, or category"
                    value={productSearch}
                  />
                </label>
              </div>
            </div>

            <div className="overflow-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/90 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-3">SKU</th>
                    <th className="px-3 py-3">Product</th>
                    {scopeColumns.map((column) => (
                      <th key={column.scope} className="px-3 py-3">
                        <div>{column.label}</div>
                        <div className="mt-1 normal-case tracking-normal text-slate-400 dark:text-slate-500">
                          {column.stepLabel}
                        </div>
                      </th>
                    ))}
                    <th className="px-3 py-3">Final</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {loading ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-slate-500" colSpan={3 + scopeColumns.length}>
                        Loading...
                      </td>
                    </tr>
                  ) : paginatedRows.totalItems === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-slate-500" colSpan={3 + scopeColumns.length}>
                        No products match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    paginatedRows.pageRows.map((row) => (
                      <tr
                        key={row.product.id}
                        className={row.product.isActive ? '' : 'bg-slate-50/70 dark:bg-slate-800/30'}
                      >
                        <td className="whitespace-nowrap px-3 py-3 align-top text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {row.product.sku}
                          {!row.product.isActive ? (
                            <div className="mt-1 inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                              Inactive
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{row.product.name}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {row.product.category ?? 'No category'}
                          </div>
                        </td>
                        {scopeColumns.map((column) => (
                          <td key={column.scope} className="px-3 py-3 align-top text-xs text-slate-700 dark:text-slate-200">
                            {candidateScopeCell(row.candidates[column.scope] ?? null)}
                          </td>
                        ))}
                        <td className="px-3 py-3 align-top">
                          <div
                            className={`rounded-xl border px-3 py-2 ${
                              row.final
                                ? 'border-slate-200 bg-emerald-50 text-slate-900 dark:border-slate-700 dark:bg-emerald-950/30 dark:text-slate-100'
                                : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200'
                            }`}
                          >
                            <div className="text-sm font-semibold">{candidateText(row.final)}</div>
                            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                              {candidateSubtext(row.final)}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <TablePaginationControls
              page={paginatedRows.page}
              pageSize={paginatedRows.pageSize}
              totalItems={paginatedRows.totalItems}
              totalPages={paginatedRows.totalPages}
              startRow={paginatedRows.startRow}
              endRow={paginatedRows.endRow}
              pageSizeOptions={paginatedRows.pageSizeOptions}
              onPageChange={paginatedRows.setPage}
              onPageSizeChange={paginatedRows.setPageSize}
            />
          </section>
        </>
      ) : null}
    </section>
  );
}
