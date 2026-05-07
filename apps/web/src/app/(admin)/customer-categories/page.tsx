'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { toastError, toastInfo, toastSuccess } from '../../../lib/web-toast';

type CustomerRecord = {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  customerCategoryId?: string | null;
  isActive: boolean;
};

type CustomerCategoryRecord = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  memberCount: number;
  customerIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type CurrentEntitlement = {
  addons?: {
    customer_category?: boolean;
  };
};

type FormState = {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  customerIds: string[];
};

function defaultForm(): FormState {
  return {
    code: '',
    name: '',
    description: '',
    isActive: true,
    customerIds: []
  };
}

function normalizeCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function CustomerCategoriesPage(): JSX.Element {
  const [categories, setCategories] = useState<CustomerCategoryRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );

  const activeCustomers = useMemo(
    () => customers.filter((customer) => customer.isActive),
    [customers]
  );

  const filteredCategories = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return categories;
    }
    return categories.filter((category) =>
      [
        category.code,
        category.name,
        category.description ?? '',
        String(category.memberCount)
      ].some((value) => value.toLowerCase().includes(term))
    );
  }, [categories, search]);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const entitlement = await apiRequest<CurrentEntitlement>('/platform/entitlements/current');
      const enabled = entitlement.addons?.customer_category === true;
      setFeatureEnabled(enabled);
      if (!enabled) {
        setCategories([]);
        setCustomers([]);
        return;
      }

      const [categoryRows, customerRows] = await Promise.all([
        apiRequest<CustomerCategoryRecord[]>('/master-data/customer-categories'),
        apiRequest<CustomerRecord[]>('/master-data/customers')
      ]);
      setCategories(categoryRows);
      setCustomers(customerRows);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load customer categories.';
      setError(message);
      toastError('Failed to load customer categories', { description: message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate(): void {
    setError(null);
    setEditingId(null);
    setForm(defaultForm());
    setDialogMode('create');
  }

  function openEdit(category: CustomerCategoryRecord): void {
    setError(null);
    setEditingId(category.id);
    setForm({
      code: category.code,
      name: category.name,
      description: category.description ?? '',
      isActive: category.isActive,
      customerIds: category.customerIds ?? []
    });
    setDialogMode('edit');
  }

  function closeDialog(): void {
    setDialogMode(null);
    setEditingId(null);
    setForm(defaultForm());
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleCustomer(customerId: string): void {
    setForm((prev) => {
      const selected = new Set(prev.customerIds);
      if (selected.has(customerId)) {
        selected.delete(customerId);
      } else {
        selected.add(customerId);
      }
      return { ...prev, customerIds: [...selected] };
    });
  }

  function categoryMemberNames(category: CustomerCategoryRecord): string {
    const names = activeCustomers
      .filter((customer) => category.customerIds.includes(customer.id))
      .map((customer) => `${customer.name} (${customer.code})`);
    if (names.length === 0) {
      return 'No members';
    }
    return names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4} more` : '');
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toastInfo('Customer category validation', { description: 'Name is required.' });
      return;
    }

    setSaving(true);
    setError(null);
    const payload = {
      code: normalizeCode(form.code),
      name,
      description: form.description.trim() || null,
      isActive: form.isActive,
      customerIds: form.customerIds
    };

    try {
      if (editingId) {
        await apiRequest(`/master-data/customer-categories/${editingId}`, {
          method: 'PUT',
          body: payload
        });
        toastSuccess('Customer category updated.');
      } else {
        await apiRequest('/master-data/customer-categories', {
          method: 'POST',
          body: payload
        });
        toastSuccess('Customer category created.');
      }
      closeDialog();
      await load();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to save customer category.';
      setError(message);
      toastError('Failed to save customer category', { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(category: CustomerCategoryRecord): Promise<void> {
    const confirmed = window.confirm(`Deactivate ${category.name}? Members will be unassigned from this category.`);
    if (!confirmed) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/master-data/customer-categories/${category.id}`, { method: 'DELETE' });
      toastSuccess('Customer category deactivated.');
      await load();
    } catch (deleteError) {
      const message = deleteError instanceof Error ? deleteError.message : 'Failed to deactivate customer category.';
      setError(message);
      toastError('Failed to deactivate customer category', { description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brandPrimary">Customer Management</p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Customer Categories</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Group customers for custom pricing. Each customer can belong to one category only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search code, name, members..."
            value={search}
          />
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => void load()}
            type="button"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button
            className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
            disabled={!featureEnabled}
            onClick={openCreate}
            type="button"
          >
            Add Category
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      {!loading && !featureEnabled ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <h2 className="text-base font-semibold">Customer Category add-on is not enabled</h2>
          <p className="mt-1">
            Enable Customer Category in Owner Tenant Console add-ons before managing customer groups.
          </p>
        </section>
      ) : null}

      {featureEnabled ? (
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-3 gap-3 border-b border-slate-200 p-4 text-sm dark:border-slate-700">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Categories</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{categories.length}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Active</p>
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
              {categories.filter((category) => category.isActive).length}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Assigned Customers</p>
            <p className="text-2xl font-bold text-brandPrimary">
              {categories.reduce((total, category) => total + Number(category.memberCount ?? 0), 0)}
            </p>
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>Loading customer categories...</td>
                </tr>
              ) : filteredCategories.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan={6}>No customer categories found.</td>
                </tr>
              ) : (
                filteredCategories.map((category) => (
                  <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50" key={category.id}>
                    <td className="px-4 py-3 align-top">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{category.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{category.code}</p>
                    </td>
                    <td className="max-w-sm px-4 py-3 align-top text-slate-600 dark:text-slate-300">
                      {category.description || '-'}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{category.memberCount} member(s)</p>
                      <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{categoryMemberNames(category)}</p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${category.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200'}`}>
                        {category.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-slate-500 dark:text-slate-400">{formatDate(category.updatedAt)}</td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                          onClick={() => openEdit(category)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40"
                          onClick={() => void deleteCategory(category)}
                          type="button"
                        >
                          Deactivate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 p-3 md:hidden">
          {loading ? (
            <p className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700">Loading customer categories...</p>
          ) : filteredCategories.length === 0 ? (
            <p className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700">No customer categories found.</p>
          ) : (
            filteredCategories.map((category) => (
              <article className="rounded-xl border border-slate-200 p-3 dark:border-slate-700" key={category.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{category.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{category.code}</p>
                  </div>
                  <span className="rounded-full bg-brandPrimary/10 px-2 py-1 text-xs font-semibold text-brandPrimary">
                    {category.memberCount} member(s)
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{category.description || '-'}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{categoryMemberNames(category)}</p>
                <div className="mt-3 flex gap-2">
                  <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold" onClick={() => openEdit(category)} type="button">Edit</button>
                  <button className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700" onClick={() => void deleteCategory(category)} type="button">Deactivate</button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      ) : null}

      {dialogMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <section className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {dialogMode === 'create' ? 'Add Customer Category' : 'Edit Customer Category'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Member changes reassign customers to this category and remove them from any previous category.
                </p>
              </div>
              <button
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300"
                onClick={closeDialog}
                type="button"
              >
                Close
              </button>
            </header>

            <form className="grid max-h-[calc(90vh-60px)] gap-4 overflow-y-auto p-4 md:grid-cols-12" onSubmit={(event) => void submit(event)}>
              <div className="space-y-3 md:col-span-5">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Code</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) => setField('code', normalizeCode(event.target.value))}
                    placeholder="Auto-generated if blank"
                    value={form.code}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Name</span>
                  <input
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) => setField('name', event.target.value)}
                    placeholder="Example: Wholesale Dealers"
                    required
                    value={form.name}
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Description</span>
                  <textarea
                    className="min-h-28 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) => setField('description', event.target.value)}
                    placeholder="Optional notes for this customer group..."
                    value={form.description}
                  />
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
                  <input checked={form.isActive} onChange={(event) => setField('isActive', event.target.checked)} type="checkbox" />
                  <span>Active</span>
                </label>
              </div>

              <section className="md:col-span-7">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Members</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Selected: {form.customerIds.length}. Customers can only be in one category.
                    </p>
                  </div>
                </div>
                <div className="max-h-[52vh] space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                  {activeCustomers.length === 0 ? (
                    <p className="p-3 text-sm text-slate-500">No active customers.</p>
                  ) : (
                    activeCustomers.map((customer) => {
                      const checked = form.customerIds.includes(customer.id);
                      const currentCategory = customer.customerCategoryId
                        ? categoryById.get(customer.customerCategoryId)
                        : null;
                      return (
                        <label
                          className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg border p-3 ${
                            checked
                              ? 'border-brandPrimary bg-brandPrimary/10'
                              : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800/60'
                          }`}
                          key={customer.id}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{customer.name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {customer.code}{customer.address ? ` - ${customer.address}` : ''}
                            </p>
                            {currentCategory && currentCategory.id !== editingId ? (
                              <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                                Currently in {currentCategory.name}. Selecting will reassign.
                              </p>
                            ) : null}
                          </div>
                          <input
                            checked={checked}
                            className="mt-1 h-4 w-4"
                            onChange={() => toggleCustomer(customer.id)}
                            type="checkbox"
                          />
                        </label>
                      );
                    })
                  )}
                </div>
              </section>

              <footer className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 md:col-span-12 dark:border-slate-700">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={closeDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={saving}
                  type="submit"
                >
                  {saving ? 'Saving...' : dialogMode === 'create' ? 'Create Category' : 'Save Changes'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
