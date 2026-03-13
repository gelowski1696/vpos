'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { toastError, toastInfo, toastSuccess } from '../../../lib/web-toast';

type Scope = 'GLOBAL' | 'BRANCH' | 'TIER' | 'CONTRACT';
type FlowMode = 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';

type PriceRule = {
  id?: string;
  productId: string;
  flowMode: FlowMode;
  unitPrice: number;
  discountCapPct: number;
  priority: number;
};

type PriceListRecord = {
  id: string;
  code: string;
  name: string;
  scope: Scope;
  branchId?: string | null;
  customerTier?: string | null;
  customerId?: string | null;
  startsAt: string;
  endsAt?: string | null;
  isActive: boolean;
  rules: PriceRule[];
  createdAt: string;
  updatedAt: string;
};

type ProductRecord = {
  id: string;
  sku: string;
  name: string;
  category?: string | null;
  isLpg: boolean;
  isActive: boolean;
};

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
  tier?: string | null;
  isActive: boolean;
};

type FormState = {
  code: string;
  name: string;
  scope: Scope;
  branchId: string;
  customerTier: string;
  customerId: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  rules: PriceRule[];
};

type DialogMode = 'create' | 'edit' | null;

const SCOPE_INFO: Array<{ scope: Scope; label: string; description: string; priority: number }> = [
  {
    scope: 'GLOBAL',
    label: 'Default Price (All Customers)',
    description: 'Used when there is no branch, tier, or contract override.',
    priority: 4
  },
  {
    scope: 'BRANCH',
    label: 'Branch Override',
    description: 'Applies only to one branch. Overrides global default.',
    priority: 3
  },
  {
    scope: 'TIER',
    label: 'Customer Tier Price',
    description: 'Applies to a customer group like PREMIUM or REGULAR.',
    priority: 2
  },
  {
    scope: 'CONTRACT',
    label: 'Specific Customer Contract',
    description: 'Highest priority. Applies only to one customer.',
    priority: 1
  }
];

const PRIORITY_BY_SCOPE: Record<Scope, number> = {
  GLOBAL: 4,
  BRANCH: 3,
  TIER: 2,
  CONTRACT: 1
};

const FLOW_OPTIONS: Array<{ value: FlowMode; label: string }> = [
  { value: 'ANY', label: 'Any Flow' },
  { value: 'REFILL_EXCHANGE', label: 'Refill Exchange' },
  { value: 'NON_REFILL', label: 'Non-Refill' }
];
const FLOW_OPTIONS_LPG: Array<{ value: FlowMode; label: string }> = [
  { value: 'REFILL_EXCHANGE', label: 'Refill Exchange' },
  { value: 'NON_REFILL', label: 'Non-Refill' }
];
const FLOW_OPTIONS_NON_LPG: Array<{ value: FlowMode; label: string }> = [
  { value: 'ANY', label: 'Any Flow' }
];

function toInputDateTime(value?: string | null): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoOrNull(value: string): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2
  }).format(value || 0);
}

function makeCodeFromName(name: string): string {
  const cleaned = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 24);
  return cleaned ? `PL-${cleaned}` : '';
}

function createEmptyRule(defaultProductId: string, scope: Scope): PriceRule {
  return {
    productId: defaultProductId,
    flowMode: 'ANY',
    unitPrice: 0,
    discountCapPct: 5,
    priority: PRIORITY_BY_SCOPE[scope]
  };
}

function buildDefaultForm(defaultProductId: string): FormState {
  const now = new Date();
  now.setSeconds(0, 0);
  return {
    code: '',
    name: '',
    scope: 'GLOBAL',
    branchId: '',
    customerTier: '',
    customerId: '',
    startsAt: toInputDateTime(now.toISOString()),
    endsAt: '',
    isActive: true,
    rules: [createEmptyRule(defaultProductId, 'GLOBAL')]
  };
}

function scopeLabel(scope: Scope): string {
  return SCOPE_INFO.find((entry) => entry.scope === scope)?.label ?? scope;
}

function flowLabel(flowMode: FlowMode): string {
  return FLOW_OPTIONS.find((entry) => entry.value === flowMode)?.label ?? 'Any Flow';
}

function statusLabel(row: PriceListRecord): string {
  if (!row.isActive) {
    return 'Inactive';
  }
  const now = Date.now();
  const start = new Date(row.startsAt).getTime();
  const end = row.endsAt ? new Date(row.endsAt).getTime() : Number.POSITIVE_INFINITY;
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 'Active';
  }
  if (start > now) {
    return 'Scheduled';
  }
  if (end < now) {
    return 'Expired';
  }
  return 'Active';
}

function scopeTarget(row: PriceListRecord, branchById: Map<string, string>, customerById: Map<string, string>): string {
  if (row.scope === 'BRANCH') {
    return row.branchId ? branchById.get(row.branchId) ?? row.branchId : 'Branch not selected';
  }
  if (row.scope === 'TIER') {
    return row.customerTier || 'Tier not selected';
  }
  if (row.scope === 'CONTRACT') {
    return row.customerId ? customerById.get(row.customerId) ?? row.customerId : 'Customer not selected';
  }
  return 'All branches and customers';
}

export default function PriceListsPage(): JSX.Element {
  const [priceLists, setPriceLists] = useState<PriceListRecord[]>([]);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [form, setForm] = useState<FormState>(buildDefaultForm(''));
  const [copySourceId, setCopySourceId] = useState('');
  const [copyMode, setCopyMode] = useState<'append' | 'replace'>('append');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPickerCategory, setProductPickerCategory] = useState('ALL');
  const [productPickerSearch, setProductPickerSearch] = useState('');
  const [productPickerSelected, setProductPickerSelected] = useState<string[]>([]);

  const productOptions = useMemo(
    () =>
      products.map((item) => ({
        id: item.id,
        label: `${item.name} (${item.sku})${item.category ? ` - ${item.category}` : ''}`
      })),
    [products]
  );

  const productNameById = useMemo(
    () => new Map(products.map((item) => [item.id, `${item.name} (${item.sku})`])),
    [products]
  );
  const productById = useMemo(
    () => new Map(products.map((item) => [item.id, item])),
    [products]
  );

  const branchById = useMemo(
    () => new Map(branches.map((item) => [item.id, `${item.name} (${item.code})`])),
    [branches]
  );

  const customerById = useMemo(
    () => new Map(customers.map((item) => [item.id, `${item.name} (${item.code})`])),
    [customers]
  );

  const tierOptions = useMemo(() => {
    const tiers = new Set<string>();
    for (const customer of customers) {
      if (customer.tier) {
        tiers.add(customer.tier);
      }
    }
    if (tiers.size === 0) {
      tiers.add('REGULAR');
      tiers.add('PREMIUM');
    }
    return [...tiers].sort();
  }, [customers]);

  const defaultProductId = useMemo(() => products[0]?.id ?? '', [products]);
  const productCategoryOptions = useMemo(() => {
    const categories = new Set<string>();
    for (const product of products) {
      const category = String(product.category ?? '').trim();
      if (category) {
        categories.add(category);
      }
    }
    return ['ALL', ...Array.from(categories).sort((a, b) => a.localeCompare(b))];
  }, [products]);
  const productPickerRows = useMemo(() => {
    const searchTerm = productPickerSearch.trim().toLowerCase();
    return products.filter((product) => {
      const category = String(product.category ?? '').trim() || 'Uncategorized';
      const categoryMatch = productPickerCategory === 'ALL' || category === productPickerCategory;
      if (!categoryMatch) {
        return false;
      }
      if (!searchTerm) {
        return true;
      }
      return (
        product.name.toLowerCase().includes(searchTerm) ||
        product.sku.toLowerCase().includes(searchTerm) ||
        category.toLowerCase().includes(searchTerm)
      );
    });
  }, [productPickerCategory, productPickerSearch, products]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return priceLists;
    }

    return priceLists.filter((row) => {
      const target = scopeTarget(row, branchById, customerById);
      return (
        row.code.toLowerCase().includes(term) ||
        row.name.toLowerCase().includes(term) ||
        scopeLabel(row.scope).toLowerCase().includes(term) ||
        target.toLowerCase().includes(term)
      );
    });
  }, [priceLists, search, branchById, customerById]);
  const copyablePriceLists = useMemo(
    () => priceLists.filter((row) => row.id !== editingId),
    [editingId, priceLists]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [listRows, productRows, branchRows, customerRows] = await Promise.all([
          apiRequest<PriceListRecord[]>('/master-data/price-lists'),
          apiRequest<ProductRecord[]>('/master-data/products'),
          apiRequest<BranchRecord[]>('/master-data/branches'),
          apiRequest<CustomerRecord[]>('/master-data/customers')
        ]);
        setPriceLists(listRows);
      setProducts(productRows.filter((item) => item.isActive));
      setBranches(branchRows.filter((item) => item.isActive));
      setCustomers(customerRows.filter((item) => item.isActive));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load price list data.';
      setError(message);
      toastError('Failed to load price list data', { description: message });
    } finally {
      setLoading(false);
    }
    })();
  }, []);

  useEffect(() => {
    if (dialogMode === 'create' && form.rules.length === 0 && defaultProductId) {
      setForm((prev) => ({ ...prev, rules: [createEmptyRule(defaultProductId, prev.scope)] }));
    }
  }, [defaultProductId, dialogMode, form.rules.length]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate(): void {
    setError(null);
    setEditingId(null);
    setConfirmOpen(false);
    setForm(buildDefaultForm(defaultProductId));
    setCopySourceId('');
    setCopyMode('append');
    setDialogMode('create');
  }

  function openEdit(row: PriceListRecord): void {
    setError(null);
    setConfirmOpen(false);
    setEditingId(row.id);
    setForm({
      code: row.code,
      name: row.name,
      scope: row.scope,
      branchId: row.branchId ?? '',
      customerTier: row.customerTier ?? '',
      customerId: row.customerId ?? '',
      startsAt: toInputDateTime(row.startsAt),
      endsAt: toInputDateTime(row.endsAt),
      isActive: row.isActive,
      rules:
        row.rules.length > 0
          ? row.rules.map((rule) => ({
              id: rule.id,
              productId: rule.productId,
              flowMode: rule.flowMode ?? 'ANY',
              unitPrice: Number(rule.unitPrice),
              discountCapPct: Number(rule.discountCapPct),
              priority: Number(rule.priority)
            }))
          : [createEmptyRule(defaultProductId, row.scope)]
    });
    setCopySourceId('');
    setCopyMode('append');
    setDialogMode('edit');
  }

  function closeDialog(): void {
    setDialogMode(null);
    setEditingId(null);
    setConfirmOpen(false);
    setCopySourceId('');
    setCopyMode('append');
    setProductPickerOpen(false);
    setProductPickerCategory('ALL');
    setProductPickerSearch('');
    setProductPickerSelected([]);
  }

  function onScopeChange(nextScope: Scope): void {
    setForm((prev) => ({
      ...prev,
      scope: nextScope,
      branchId: nextScope === 'BRANCH' ? prev.branchId : '',
      customerTier: nextScope === 'TIER' ? prev.customerTier : '',
      customerId: nextScope === 'CONTRACT' ? prev.customerId : '',
      rules: prev.rules.map((rule) => ({ ...rule, priority: PRIORITY_BY_SCOPE[nextScope] }))
    }));
  }

  function addRule(): void {
    setForm((prev) => ({
      ...prev,
      rules: [...prev.rules, createEmptyRule(defaultProductId, prev.scope)]
    }));
  }

  function removeRule(index: number): void {
    setForm((prev) => {
      if (prev.rules.length <= 1) {
        return prev;
      }
      const next = [...prev.rules];
      next.splice(index, 1);
      return { ...prev, rules: next };
    });
  }

  function updateRule<K extends keyof PriceRule>(index: number, key: K, value: PriceRule[K]): void {
    setForm((prev) => {
      const next = [...prev.rules];
      const current = next[index];
      if (!current) {
        return prev;
      }
      const updatedRule = { ...current, [key]: value } as PriceRule;
      if (key === 'productId') {
        const selectedProduct = productById.get(String(value ?? ''));
        if (selectedProduct?.isLpg) {
          if (updatedRule.flowMode === 'ANY') {
            updatedRule.flowMode = 'REFILL_EXCHANGE';
          }
        } else {
          updatedRule.flowMode = 'ANY';
        }
      }
      if (key === 'flowMode') {
        const selectedProduct = productById.get(updatedRule.productId);
        if (!selectedProduct?.isLpg) {
          updatedRule.flowMode = 'ANY';
        }
      }
      next[index] = updatedRule;
      return { ...prev, rules: next };
    });
  }

  function openProductPicker(): void {
    setProductPickerCategory('ALL');
    setProductPickerSearch('');
    setProductPickerSelected([]);
    setProductPickerOpen(true);
  }

  function toggleProductPickerItem(productId: string): void {
    setProductPickerSelected((prev) => {
      if (prev.includes(productId)) {
        return prev.filter((id) => id !== productId);
      }
      return [...prev, productId];
    });
  }

  function addSelectedProductsToRules(): void {
    if (productPickerSelected.length === 0) {
      toastInfo('Add products', { description: 'Select at least one product.' });
      return;
    }
    let added = 0;
    let skipped = 0;
    setForm((prev) => {
      const existing = new Set(prev.rules.map((rule) => `${rule.productId}|${rule.flowMode ?? 'ANY'}`));
      const nextRules = [...prev.rules];
      for (const productId of productPickerSelected) {
        const product = productById.get(productId);
        const targetFlows: FlowMode[] = product?.isLpg
          ? ['REFILL_EXCHANGE', 'NON_REFILL']
          : ['ANY'];
        for (const flowMode of targetFlows) {
          const key = `${productId}|${flowMode}`;
          if (existing.has(key)) {
            skipped += 1;
            continue;
          }
          nextRules.push({
            ...createEmptyRule(productId, prev.scope),
            flowMode
          });
          existing.add(key);
          added += 1;
        }
      }
      return { ...prev, rules: nextRules };
    });
    setProductPickerOpen(false);
    setProductPickerSelected([]);
    setProductPickerSearch('');
    setProductPickerCategory('ALL');
    if (added > 0) {
      toastSuccess('Products added', {
        description:
          skipped > 0
            ? `${added} added. ${skipped} already existed (Product + Any Flow).`
            : `${added} product(s) added to pricing rows.`
      });
      return;
    }
    toastInfo('No products added', { description: 'Selected products already exist in pricing rows.' });
  }

  function copyRulesFromPriceList(): void {
    const sourceId = copySourceId.trim();
    if (!sourceId) {
      toastInfo('Copy prices', { description: 'Select a source price list first.' });
      return;
    }
    const source = priceLists.find((row) => row.id === sourceId);
    if (!source) {
      toastError('Copy prices failed', { description: 'Source price list not found.' });
      return;
    }
    if (!source.rules || source.rules.length === 0) {
      toastInfo('Copy prices', { description: 'Selected source has no product prices to copy.' });
      return;
    }

    const mappedRules: PriceRule[] = source.rules
      .filter((rule) => rule.productId)
      .map((rule) => ({
        productId: rule.productId,
        flowMode: productById.get(rule.productId)?.isLpg ? rule.flowMode ?? 'REFILL_EXCHANGE' : 'ANY',
        unitPrice: Number(rule.unitPrice ?? 0),
        discountCapPct: Number(rule.discountCapPct ?? 0),
        priority: PRIORITY_BY_SCOPE[form.scope]
      }));

    if (mappedRules.length === 0) {
      toastInfo('Copy prices', { description: 'Selected source has no valid rows to copy.' });
      return;
    }

    setForm((prev) => {
      if (copyMode === 'replace') {
        return { ...prev, rules: mappedRules };
      }
      const existingKeys = new Set(
        prev.rules.map((rule) => `${rule.productId}|${rule.flowMode ?? 'ANY'}`)
      );
      const toAppend = mappedRules.filter((rule) => {
        const key = `${rule.productId}|${rule.flowMode ?? 'ANY'}`;
        if (existingKeys.has(key)) {
          return false;
        }
        existingKeys.add(key);
        return true;
      });
      return { ...prev, rules: [...prev.rules, ...toAppend] };
    });

    toastSuccess('Product prices copied', {
      description:
        copyMode === 'replace'
          ? `Copied ${mappedRules.length} row(s) from ${source.name}.`
          : `Copied from ${source.name}. Duplicate Product + Flow rows were skipped.`
    });
  }

  function validateBeforeConfirm(): string | null {
    if (!form.name.trim()) {
      return 'Please enter a price list name.';
    }
    if (form.scope === 'BRANCH' && !form.branchId) {
      return 'Please select the branch for this price list.';
    }
    if (form.scope === 'TIER' && !form.customerTier.trim()) {
      return 'Please select the customer tier for this price list.';
    }
    if (form.scope === 'CONTRACT' && !form.customerId) {
      return 'Please select the customer contract target.';
    }
    if (form.rules.length === 0) {
      return 'Please add at least one product price.';
    }
    if (form.rules.some((rule) => !rule.productId)) {
      return 'Each row must have a product.';
    }
    if (
      form.rules.some((rule) => {
        const product = productById.get(rule.productId);
        if (!product) {
          return false;
        }
        return !product.isLpg && rule.flowMode !== 'ANY';
      })
    ) {
      return 'Non-LPG products can only use Any Flow.';
    }
    return null;
  }

  function requestSave(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const validationError = validateBeforeConfirm();
    if (validationError) {
      setError(validationError);
      toastInfo('Price list validation', { description: validationError });
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  async function confirmSave(): Promise<void> {
    setSaving(true);
    setError(null);

    const finalCode = form.code.trim() || makeCodeFromName(form.name);

    const payload = {
      code: finalCode,
      name: form.name.trim(),
      scope: form.scope,
      branchId: form.scope === 'BRANCH' ? form.branchId || null : null,
      customerTier: form.scope === 'TIER' ? form.customerTier || null : null,
      customerId: form.scope === 'CONTRACT' ? form.customerId || null : null,
      startsAt: toIsoOrNull(form.startsAt) ?? new Date().toISOString(),
      endsAt: toIsoOrNull(form.endsAt),
      isActive: form.isActive,
      rules: form.rules
        .filter((rule) => rule.productId)
        .map((rule) => ({
          id: rule.id,
          productId: rule.productId,
          flowMode: productById.get(rule.productId)?.isLpg ? rule.flowMode : 'ANY',
          unitPrice: Number(rule.unitPrice),
          discountCapPct: Number(rule.discountCapPct),
          priority: PRIORITY_BY_SCOPE[form.scope]
        }))
    };

    try {
      if (editingId) {
        await apiRequest(`/master-data/price-lists/${editingId}`, {
          method: 'PUT',
          body: payload
        });
        toastSuccess('Price list updated successfully.');
      } else {
        await apiRequest('/master-data/price-lists', {
          method: 'POST',
          body: payload
        });
        toastSuccess('Price list created successfully.');
      }

      const refreshed = await apiRequest<PriceListRecord[]>('/master-data/price-lists');
      setPriceLists(refreshed);
      closeDialog();
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Failed to save price list.';
      setError(message);
      toastError('Failed to save price list', { description: message });
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  return (
    <main>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brandPrimary">Price Lists</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Create easy-to-understand pricing rules. Higher priority wins automatically: Contract, Tier, Branch, then Default.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, code, target..."
            value={search}
          />
          <button
            className="rounded-lg bg-brandPrimary px-3 py-2 text-sm font-semibold text-white hover:brightness-110"
            onClick={openCreate}
            type="button"
          >
            Add Price List
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        {SCOPE_INFO.map((item) => (
          <article className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900" key={item.scope}>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{item.label}</p>
            <p className="mt-1 text-slate-600 dark:text-slate-300">{item.description}</p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-brandPrimary">Priority {item.priority}</p>
          </article>
        ))}
      </div>

      {error ? <p className="mb-3 text-sm text-rose-700 dark:text-rose-400">{error}</p> : null}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Loading price lists...</p>
        ) : filteredRows.length === 0 ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">No price lists found.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/70">
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="px-4 py-3">Price List</th>
                    <th className="px-4 py-3">Who Gets This Price</th>
                    <th className="px-4 py-3">When Active</th>
                    <th className="px-4 py-3">Products</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, idx) => {
                    const status = statusLabel(row);
                    return (
                      <tr
                        className={`border-b border-slate-100 text-sm dark:border-slate-800 ${idx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/50 dark:bg-slate-900/70'}`}
                        key={row.id}
                      >
                        <td className="px-4 py-3 align-top">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{row.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{row.code}</p>
                          <p className="mt-1 text-xs text-brandPrimary">{scopeLabel(row.scope)}</p>
                        </td>
                        <td className="px-4 py-3 align-top text-slate-700 dark:text-slate-200">
                          {scopeTarget(row, branchById, customerById)}
                        </td>
                        <td className="px-4 py-3 align-top text-slate-700 dark:text-slate-200">
                          <p>Start: {formatDateTime(row.startsAt)}</p>
                          <p>End: {formatDateTime(row.endsAt)}</p>
                        </td>
                        <td className="px-4 py-3 align-top text-slate-700 dark:text-slate-200">
                          <p>{row.rules.length} product(s)</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {row.rules[0]
                              ? `${productNameById.get(row.rules[0].productId) ?? row.rules[0].productId} (${flowLabel(row.rules[0].flowMode)}) @ ${formatMoney(row.rules[0].unitPrice)}`
                              : 'No rule'}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{status}</span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <button
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                            onClick={() => openEdit(row)}
                            type="button"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 p-3 md:hidden">
              {filteredRows.map((row) => (
                <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/70" key={row.id}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{row.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{row.code}</p>
                    </div>
                    <button
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                      onClick={() => openEdit(row)}
                      type="button"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="space-y-1 text-xs text-slate-700 dark:text-slate-200">
                    <p><span className="font-semibold">Type:</span> {scopeLabel(row.scope)}</p>
                    <p><span className="font-semibold">Target:</span> {scopeTarget(row, branchById, customerById)}</p>
                    <p><span className="font-semibold">Start:</span> {formatDateTime(row.startsAt)}</p>
                    <p><span className="font-semibold">Status:</span> {statusLabel(row)}</p>
                    <p><span className="font-semibold">Products:</span> {row.rules.length}</p>
                    {row.rules[0] ? (
                      <p><span className="font-semibold">Flow:</span> {flowLabel(row.rules[0].flowMode)}</p>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      {dialogMode ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {dialogMode === 'create' ? 'Create Price List' : 'Edit Price List'}
              </h2>
              <button
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"
                onClick={closeDialog}
                type="button"
              >
                Close
              </button>
            </header>

            <form className="space-y-4 p-4" onSubmit={requestSave}>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Price List Name</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) => setField('name', event.target.value)}
                    placeholder="Example: Premium Customer Price"
                    required
                    value={form.name}
                  />
                </label>

                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Reference Code</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) => setField('code', event.target.value.toUpperCase())}
                    placeholder="Optional (auto-generated if blank)"
                    value={form.code}
                  />
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">Internal identifier used by reports and audits.</span>
                </label>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Who gets this price?</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {SCOPE_INFO.map((item) => (
                    <button
                      className={`rounded-xl border p-3 text-left ${form.scope === item.scope ? 'border-brandPrimary bg-brandPrimary/10 text-brandPrimary' : 'border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200'}`}
                      key={item.scope}
                      onClick={() => onScopeChange(item.scope)}
                      type="button"
                    >
                      <p className="font-semibold">{item.label}</p>
                      <p className="text-xs">{item.description}</p>
                      <p className="mt-1 text-xs font-semibold uppercase">Priority {item.priority}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {form.scope === 'BRANCH' ? (
                  <label className="text-sm md:col-span-3">
                    <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Branch</span>
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      onChange={(event) => setField('branchId', event.target.value)}
                      required
                      value={form.branchId}
                    >
                      <option value="">Select branch</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name} ({branch.code})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {form.scope === 'TIER' ? (
                  <label className="text-sm md:col-span-3">
                    <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Customer Tier</span>
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      onChange={(event) => setField('customerTier', event.target.value)}
                      required
                      value={form.customerTier}
                    >
                      <option value="">Select tier</option>
                      {tierOptions.map((tier) => (
                        <option key={tier} value={tier}>
                          {tier}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {form.scope === 'CONTRACT' ? (
                  <label className="text-sm md:col-span-3">
                    <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Customer</span>
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      onChange={(event) => setField('customerId', event.target.value)}
                      required
                      value={form.customerId}
                    >
                      <option value="">Select customer</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name} ({customer.code})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Start Date and Time</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) => setField('startsAt', event.target.value)}
                    required
                    type="datetime-local"
                    value={form.startsAt}
                  />
                </label>

                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">End Date and Time (optional)</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) => setField('endsAt', event.target.value)}
                    type="datetime-local"
                    value={form.endsAt}
                  />
                </label>

                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Status</span>
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) => setField('isActive', event.target.value === 'true')}
                    value={String(form.isActive)}
                  >
                    <option value="true">Active</option>
                    <option value="false">Inactive</option>
                  </select>
                </label>
              </div>

              <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Product Prices</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Set the selling price and max discount allowed per product.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      onClick={addRule}
                      type="button"
                    >
                      Add Single Row
                    </button>
                    <button
                      className="rounded-lg border border-brandPrimary px-3 py-1.5 text-xs font-semibold text-brandPrimary hover:bg-brandPrimary/10"
                      onClick={openProductPicker}
                      type="button"
                    >
                      Add Multiple Products
                    </button>
                  </div>
                </div>

                <div className="mb-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 md:grid-cols-12 dark:border-slate-700 dark:bg-slate-800/60">
                  <label className="text-xs md:col-span-7">
                    <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Copy from existing price list</span>
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      onChange={(event) => setCopySourceId(event.target.value)}
                      value={copySourceId}
                    >
                      <option value="">Select source price list</option>
                      {copyablePriceLists.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name} ({row.code}) - {scopeLabel(row.scope)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs md:col-span-3">
                    <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Copy mode</span>
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      onChange={(event) => setCopyMode(event.target.value === 'replace' ? 'replace' : 'append')}
                      value={copyMode}
                    >
                      <option value="append">Append missing</option>
                      <option value="replace">Replace all rows</option>
                    </select>
                  </label>
                  <div className="flex items-end md:col-span-2">
                    <button
                      className="w-full rounded-lg border border-brandPrimary px-3 py-2 text-xs font-semibold text-brandPrimary hover:bg-brandPrimary/10"
                      onClick={copyRulesFromPriceList}
                      type="button"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {form.rules.map((rule, index) => (
                    <div className="grid gap-2 rounded-lg border border-slate-200 p-2 md:grid-cols-12 dark:border-slate-700" key={`${rule.id ?? 'new'}-${index}`}>
                      <label className="text-xs md:col-span-4">
                        <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Product</span>
                        <select
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          onChange={(event) => updateRule(index, 'productId', event.target.value)}
                          value={rule.productId}
                        >
                          <option value="">Select product</option>
                          {productOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="text-xs md:col-span-2">
                        <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Flow</span>
                        {(() => {
                          const selectedProduct = productById.get(rule.productId);
                          const flowOptionsForRow = selectedProduct?.isLpg
                            ? (rule.flowMode === 'ANY'
                                ? [...FLOW_OPTIONS_LPG, { value: 'ANY', label: 'Any Flow (legacy)' }]
                                : FLOW_OPTIONS_LPG)
                            : FLOW_OPTIONS_NON_LPG;
                          return (
                        <select
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          onChange={(event) => updateRule(index, 'flowMode', event.target.value as FlowMode)}
                          value={rule.flowMode}
                        >
                          {flowOptionsForRow.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                          );
                        })()}
                      </label>

                      <label className="text-xs md:col-span-2">
                        <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Selling Price (PHP)</span>
                        <input
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          min="0"
                          onChange={(event) => updateRule(index, 'unitPrice', Number(event.target.value || 0))}
                          step="0.01"
                          type="number"
                          value={rule.unitPrice}
                        />
                      </label>

                      <label className="text-xs md:col-span-2">
                        <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Max Discount %</span>
                        <input
                          className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                          min="0"
                          onChange={(event) => updateRule(index, 'discountCapPct', Number(event.target.value || 0))}
                          step="0.01"
                          type="number"
                          value={rule.discountCapPct}
                        />
                      </label>

                      <div className="flex items-end md:col-span-2">
                        <button
                          className="w-full rounded-lg border border-rose-300 px-2 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40"
                          onClick={() => removeRule(index)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
                <p className="font-semibold text-slate-900 dark:text-slate-100">Summary</p>
                <p className="text-slate-700 dark:text-slate-200">
                  {scopeLabel(form.scope)} | Priority {PRIORITY_BY_SCOPE[form.scope]} | {form.rules.length} product rule(s)
                </p>
              </section>

              <div className="flex items-center justify-end gap-2">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={closeDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white hover:brightness-110" disabled={saving} type="submit">
                  {dialogMode === 'create' ? 'Create Price List' : 'Save Changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Confirm Save</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              This will {editingId ? 'update' : 'create'} the price list and apply the selected priority rules.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => setConfirmOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
                disabled={saving}
                onClick={() => void confirmSave()}
                type="button"
              >
                {saving ? 'Saving...' : 'Confirm'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {dialogMode && productPickerOpen ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/55 p-4">
          <section className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Select Products</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Filter by category, then select multiple products to add pricing rows.</p>
              </div>
              <button
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"
                onClick={() => setProductPickerOpen(false)}
                type="button"
              >
                Close
              </button>
            </header>

            <div className="grid gap-2 border-b border-slate-200 px-4 py-3 md:grid-cols-12 dark:border-slate-700">
              <label className="text-xs md:col-span-5">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Category</span>
                <select
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) => setProductPickerCategory(event.target.value)}
                  value={productPickerCategory}
                >
                  {productCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category === 'ALL' ? 'All Categories' : category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs md:col-span-7">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Search</span>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) => setProductPickerSearch(event.target.value)}
                  placeholder="Search name, item code, category..."
                  value={productPickerSearch}
                />
              </label>
            </div>

            <div className="max-h-[52vh] overflow-y-auto p-3">
              {productPickerRows.length === 0 ? (
                <p className="rounded-lg border border-slate-200 p-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  No products found for current filters.
                </p>
              ) : (
                <div className="space-y-2">
                  {productPickerRows.map((product) => {
                    const checked = productPickerSelected.includes(product.id);
                    const category = String(product.category ?? '').trim() || 'Uncategorized';
                    return (
                      <label
                        className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-3 ${
                          checked
                            ? 'border-brandPrimary bg-brandPrimary/10'
                            : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60'
                        }`}
                        key={product.id}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{product.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {product.sku} | {category}
                          </p>
                        </div>
                        <input
                          checked={checked}
                          className="mt-1 h-4 w-4"
                          onChange={() => toggleProductPickerItem(product.id)}
                          type="checkbox"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-700">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Selected: <span className="font-semibold">{productPickerSelected.length}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => setProductPickerOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
                  onClick={addSelectedProductsToRules}
                  type="button"
                >
                  Add Selected
                </button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
