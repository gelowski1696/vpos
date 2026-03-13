'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { toastError, toastInfo, toastSuccess } from '../../../lib/web-toast';

type EntitlementStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED';
type BranchMode = 'SINGLE' | 'MULTI';
type InventoryMode = 'STORE_ONLY' | 'STORE_WAREHOUSE';
type TenancyMode = 'SHARED_DB' | 'DEDICATED_DB';
type TenancyMigrationState = 'NONE' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

type TenantSummary = {
  company_id: string;
  company_code: string;
  company_name: string;
  client_id: string;
  tenancy_mode: TenancyMode;
  datastore_ref: string | null;
  datastore_migration_state: TenancyMigrationState;
  subscription_status: EntitlementStatus;
  branch_count: number;
  location_count: number;
  user_count: number;
  updated_at: string;
  entitlement: {
    status: EntitlementStatus;
    maxBranches: number;
    branchMode: BranchMode;
    inventoryMode: InventoryMode;
    allowDelivery: boolean;
    allowTransfers: boolean;
    allowMobile: boolean;
    graceUntil: string | null;
    lastSyncedAt: string;
  };
};

type OverrideFormState = {
  status: EntitlementStatus;
  max_branches: number;
  branch_mode: BranchMode;
  inventory_mode: InventoryMode;
  allow_delivery: boolean;
  allow_transfers: boolean;
  allow_mobile: boolean;
  grace_until: string;
  reason: string;
};

type DialogMode = 'bindings' | 'override' | 'suspend' | 'reactivate' | 'provision' | 'delete' | null;

type ProvisionFormState = {
  client_id: string;
  company_name: string;
  company_code: string;
  template: '' | 'SINGLE_STORE' | 'STORE_WAREHOUSE' | 'MULTI_BRANCH_STARTER';
  tenancy_mode: TenancyMode;
  datastore_ref: string;
  subman_api_key: string;
  admin_email: string;
  admin_password: string;
};

type ActiveSubscriptionOption = {
  subscription_id: string;
  status: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  plan_id: string | null;
  plan_name: string | null;
  start_date: string | null;
  end_date: string | null;
  next_billing_date: string | null;
  client_id_hint: string;
};

type BranchItem = {
  id: string;
  code: string;
  name: string;
  type: 'STORE' | 'WAREHOUSE';
  isActive: boolean;
};

type LocationItem = {
  id: string;
  code: string;
  name: string;
  type: 'BRANCH_STORE' | 'BRANCH_WAREHOUSE' | 'TRUCK' | 'PERSONNEL';
  branchId?: string | null;
  isActive: boolean;
};

type UserItem = {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  isActive: boolean;
};

type TenantBindings = {
  branches: BranchItem[];
  locations: LocationItem[];
  users: UserItem[];
};

function statusPill(status: EntitlementStatus): string {
  if (status === 'ACTIVE') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (status === 'PAST_DUE') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
  if (status === 'SUSPENDED') return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300';
  return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
}

function boolPill(value: boolean): string {
  return value ? 'Yes' : 'No';
}

function toDateTimeLocal(isoValue: string | null): string {
  if (!isoValue) {
    return '';
  }
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function toCompanyCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

function formatSubscriptionDate(value: string | null): string {
  if (!value) {
    return 'N/A';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export default function TenantsPage(): JSX.Element {
  const [items, setItems] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selected, setSelected] = useState<TenantSummary | null>(null);
  const [overrideForm, setOverrideForm] = useState<OverrideFormState | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [suspendGraceUntil, setSuspendGraceUntil] = useState('');
  const [activeSubscriptions, setActiveSubscriptions] = useState<ActiveSubscriptionOption[]>([]);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [loadingBindings, setLoadingBindings] = useState(false);
  const [bindings, setBindings] = useState<TenantBindings | null>(null);
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState('');
  const [deleteConfirmCode, setDeleteConfirmCode] = useState('');
  const [provisionForm, setProvisionForm] = useState<ProvisionFormState>({
    client_id: '',
    company_name: '',
    company_code: '',
    template: '',
    tenancy_mode: 'SHARED_DB',
    datastore_ref: '',
    subman_api_key: '',
    admin_email: '',
    admin_password: ''
  });

  const savingMessage =
    dialogMode === 'provision'
      ? 'Provisioning tenant...'
      : dialogMode === 'override'
        ? 'Saving tenant changes...'
        : dialogMode === 'suspend'
          ? 'Suspending tenant...'
        : dialogMode === 'reactivate'
          ? 'Reactivating tenant...'
          : dialogMode === 'delete'
            ? 'Deleting tenant...'
            : 'Processing request...';

  async function loadTenants(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiRequest<TenantSummary[]>('/platform/owner/tenants');
      setItems(rows);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load tenants';
      if (message.includes('403') || message.toLowerCase().includes('forbidden')) {
        setError('Owner access required. Login with a platform owner account to manage tenants.');
        toastError('Owner access required');
      } else {
        setError(message);
        toastError('Failed to load tenants', { description: message });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTenants();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return items;
    }
    return items.filter((row) =>
      [
        row.company_name,
        row.company_code,
        row.client_id,
        row.subscription_status,
        row.tenancy_mode,
        row.datastore_migration_state
      ].some((value) =>
        String(value).toLowerCase().includes(term)
      )
    );
  }, [items, search]);

  function openOverride(row: TenantSummary): void {
    setError(null);
    setSelected(row);
    setDialogMode('override');
    setOverrideForm({
      status: row.entitlement.status,
      max_branches: row.entitlement.maxBranches,
      branch_mode: row.entitlement.branchMode,
      inventory_mode: row.entitlement.inventoryMode,
      allow_delivery: row.entitlement.allowDelivery,
      allow_transfers: row.entitlement.allowTransfers,
      allow_mobile: row.entitlement.allowMobile,
      grace_until: toDateTimeLocal(row.entitlement.graceUntil),
      reason: ''
    });
  }

  async function openBindings(row: TenantSummary): Promise<void> {
    setError(null);
    setSelected(row);
    setDialogMode('bindings');
    setBindings(null);
    setLoadingBindings(true);

    try {
      const companyId = encodeURIComponent(row.company_id);
      const [branches, locations, users] = await Promise.all([
        apiRequest<BranchItem[]>(`/master-data/branches?companyId=${companyId}`),
        apiRequest<LocationItem[]>(`/master-data/locations?companyId=${companyId}`),
        apiRequest<UserItem[]>(`/master-data/users?companyId=${companyId}`)
      ]);
      setBindings({ branches, locations, users });
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load tenant bindings';
      setError(message);
      toastError('Failed to load tenant bindings', { description: message });
      setBindings({ branches: [], locations: [], users: [] });
    } finally {
      setLoadingBindings(false);
    }
  }

  function openSuspend(row: TenantSummary): void {
    setError(null);
    setSelected(row);
    setDialogMode('suspend');
    setActionReason('');
    setSuspendGraceUntil(toDateTimeLocal(row.entitlement.graceUntil));
  }

  function openReactivate(row: TenantSummary): void {
    setError(null);
    setSelected(row);
    setDialogMode('reactivate');
    setActionReason('');
    setSuspendGraceUntil('');
  }

  function openDelete(row: TenantSummary): void {
    setError(null);
    setSelected(row);
    setDialogMode('delete');
    setActionReason('');
    setDeleteConfirmCode('');
  }

  function closeDialog(): void {
    setDialogMode(null);
    setSelected(null);
    setBindings(null);
    setOverrideForm(null);
    setActionReason('');
    setSuspendGraceUntil('');
    setSelectedSubscriptionId('');
    setDeleteConfirmCode('');
    setProvisionForm({
      client_id: '',
      company_name: '',
      company_code: '',
      template: '',
      tenancy_mode: 'SHARED_DB',
      datastore_ref: '',
      subman_api_key: '',
      admin_email: '',
      admin_password: ''
    });
  }

  const branchNameById = useMemo(
    () =>
      new Map(
        (bindings?.branches ?? []).map((branch) => [
          branch.id,
          `${branch.name} (${branch.code})`
        ])
      ),
    [bindings]
  );

  const selectedSubscription = useMemo(
    () => activeSubscriptions.find((row) => row.subscription_id === selectedSubscriptionId) ?? null,
    [activeSubscriptions, selectedSubscriptionId]
  );

  async function loadActiveSubscriptions(submanApiKey?: string): Promise<void> {
    setLoadingSubscriptions(true);
    try {
      const rows = await apiRequest<ActiveSubscriptionOption[]>('/platform/owner/subscriptions/active', {
        method: 'POST',
        body: {
          subman_api_key: submanApiKey?.trim() || undefined
        }
      });
      setActiveSubscriptions(rows);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load active subscriptions';
      setError(message);
      toastError('Failed to load active subscriptions', { description: message });
      setActiveSubscriptions([]);
    } finally {
      setLoadingSubscriptions(false);
    }
  }

  async function openProvision(): Promise<void> {
    setError(null);
    setSelected(null);
    setDialogMode('provision');
    await loadActiveSubscriptions(provisionForm.subman_api_key);
  }

  function applySubscriptionSelection(subscriptionId: string): void {
    setSelectedSubscriptionId(subscriptionId);
    const selectedRow = activeSubscriptions.find((row) => row.subscription_id === subscriptionId);
    if (!selectedRow) {
      return;
    }

    setProvisionForm((prev) => ({
      ...prev,
      client_id: selectedRow.client_id_hint || selectedRow.subscription_id,
      company_name: prev.company_name || selectedRow.customer_name,
      company_code: prev.company_code || toCompanyCode(selectedRow.customer_name)
    }));
  }

  async function submitOverride(): Promise<void> {
    if (!selected || !overrideForm) {
      return;
    }
    setSaving(true);
    setError(null);

    try {
      await apiRequest<{ entitlement: TenantSummary['entitlement'] }>(
        `/platform/owner/tenants/${selected.company_id}/override`,
        {
          method: 'POST',
          body: {
            ...overrideForm,
            grace_until: overrideForm.grace_until ? new Date(overrideForm.grace_until).toISOString() : null
          }
        }
      );
      toastSuccess('Entitlement override applied', { description: selected.company_name });
      closeDialog();
      await loadTenants();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to override entitlement';
      setError(message);
      toastError('Failed to override entitlement', { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function submitSuspend(): Promise<void> {
    if (!selected) {
      return;
    }
    setSaving(true);
    setError(null);

    try {
      await apiRequest<{ entitlement: TenantSummary['entitlement'] }>(
        `/platform/owner/tenants/${selected.company_id}/suspend`,
        {
          method: 'POST',
          body: {
            reason: actionReason || undefined,
            grace_until: suspendGraceUntil ? new Date(suspendGraceUntil).toISOString() : null
          }
        }
      );
      toastSuccess('Tenant suspended', { description: selected.company_name });
      closeDialog();
      await loadTenants();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to suspend tenant';
      setError(message);
      toastError('Failed to suspend tenant', { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function submitReactivate(): Promise<void> {
    if (!selected) {
      return;
    }
    setSaving(true);
    setError(null);

    try {
      await apiRequest<{ entitlement: TenantSummary['entitlement'] }>(
        `/platform/owner/tenants/${selected.company_id}/reactivate`,
        {
          method: 'POST',
          body: {
            reason: actionReason || undefined
          }
        }
      );
      toastSuccess('Tenant reactivated', { description: selected.company_name });
      closeDialog();
      await loadTenants();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to reactivate tenant';
      setError(message);
      toastError('Failed to reactivate tenant', { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function submitDelete(): Promise<void> {
    if (!selected) {
      return;
    }
    if (deleteConfirmCode.trim().toUpperCase() !== selected.company_code.trim().toUpperCase()) {
      const message = `Type "${selected.company_code}" to confirm deletion.`;
      setError(message);
      toastInfo('Delete confirmation required', { description: message });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiRequest(`/platform/owner/tenants/${selected.company_id}`, {
        method: 'DELETE',
        body: {
          reason: actionReason.trim() || undefined
        }
      });
      toastSuccess('Tenant deleted', { description: selected.company_name });
      closeDialog();
      await loadTenants();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to delete tenant';
      setError(message);
      toastError('Failed to delete tenant', { description: message });
    } finally {
      setSaving(false);
    }
  }

  async function submitProvisionFromSubscription(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await apiRequest('/platform/owner/tenants/provision-from-subscription', {
        method: 'POST',
        body: {
          client_id: provisionForm.client_id.trim(),
          company_name: provisionForm.company_name.trim() || undefined,
          company_code: provisionForm.company_code.trim() || undefined,
          template: provisionForm.template || undefined,
          tenancy_mode: provisionForm.tenancy_mode,
          datastore_ref:
            provisionForm.tenancy_mode === 'DEDICATED_DB'
              ? provisionForm.datastore_ref.trim() || undefined
              : undefined,
          subman_api_key: provisionForm.subman_api_key.trim() || undefined,
          bootstrap_defaults: false,
          admin_email: provisionForm.admin_email.trim() || undefined,
          admin_password: provisionForm.admin_password || undefined
        }
      });
      toastSuccess('Tenant provisioned', { description: provisionForm.client_id.trim() });
      closeDialog();
      await loadTenants();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to provision tenant from subscriptionapp';
      setError(message);
      toastError('Failed to provision tenant', { description: message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brandPrimary">Owner Tenant Console</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            View tenant health, override entitlements, and suspend/reactivate with audit logs.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Tenant creation can pull plan/client details from subscriptionapp via configured SUBMAN gateway.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="w-56 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tenant..."
            value={search}
          />
          <button
            className="rounded-lg bg-brandPrimary px-3 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving}
            onClick={() => void openProvision()}
            type="button"
          >
            Add Tenant
          </button>
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            disabled={saving}
            onClick={() => void loadTenants()}
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 text-sm text-rose-700">{error}</p> : null}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">Loading tenant summaries...</p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-slate-500 dark:text-slate-400">No tenants found.</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1100px] border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/70">
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="px-4 py-3">Tenant</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Topology</th>
                    <th className="px-4 py-3">Tenancy</th>
                    <th className="px-4 py-3">Features</th>
                    <th className="px-4 py-3">Counts</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, index) => (
                    <tr
                      className={`border-b border-slate-100 text-sm text-slate-800 dark:border-slate-800 dark:text-slate-200 ${index % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/60 dark:bg-slate-900/60'}`}
                      key={row.company_id}
                    >
                      <td className="px-4 py-3 align-top">
                        <p className="font-semibold">{row.company_name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{row.company_code}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Client: {row.client_id}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusPill(row.subscription_status)}`}>
                          {row.subscription_status}
                        </span>
                        {row.entitlement.graceUntil ? (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Grace until {new Date(row.entitlement.graceUntil).toLocaleString()}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p>{row.entitlement.branchMode} ({row.entitlement.maxBranches})</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{row.entitlement.inventoryMode}</p>
                      </td>
                      <td className="px-4 py-3 align-top text-xs">
                        <p>{row.tenancy_mode === 'DEDICATED_DB' ? 'Dedicated DB' : 'Shared DB'}</p>
                        <p className="text-slate-500 dark:text-slate-400">
                          Ref: {row.datastore_ref || 'N/A'}
                        </p>
                        <p className="text-slate-500 dark:text-slate-400">
                          State: {row.datastore_migration_state}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top text-xs">
                        <p>Delivery: {boolPill(row.entitlement.allowDelivery)}</p>
                        <p>Transfers: {boolPill(row.entitlement.allowTransfers)}</p>
                        <p>Mobile: {boolPill(row.entitlement.allowMobile)}</p>
                      </td>
                      <td className="px-4 py-3 align-top text-xs">
                        <p>Branches: {row.branch_count}</p>
                        <p>Locations: {row.location_count}</p>
                        <p>Users: {row.user_count}</p>
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-slate-500 dark:text-slate-400">
                        {new Date(row.updated_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                            onClick={() => void openBindings(row)}
                            type="button"
                          >
                            Bindings
                          </button>
                          <button
                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                            onClick={() => openOverride(row)}
                            type="button"
                          >
                            Override
                          </button>
                          <button
                            className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-950/40"
                            onClick={() => openSuspend(row)}
                            type="button"
                          >
                            Suspend
                          </button>
                          <button
                            className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                            onClick={() => openReactivate(row)}
                            type="button"
                          >
                            Reactivate
                          </button>
                          <button
                            className="rounded-lg border border-rose-500 bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500 dark:border-rose-700"
                            onClick={() => openDelete(row)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 p-3 md:hidden">
              {filtered.map((row) => (
                <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/70" key={row.company_id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{row.company_name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{row.company_code} · {row.client_id}</p>
                    </div>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusPill(row.subscription_status)}`}>
                      {row.subscription_status}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                    <p>Branch Mode: {row.entitlement.branchMode} ({row.entitlement.maxBranches})</p>
                    <p>Inventory: {row.entitlement.inventoryMode}</p>
                    <p>
                      Tenancy: {row.tenancy_mode === 'DEDICATED_DB' ? 'Dedicated DB' : 'Shared DB'} | Ref:{' '}
                      {row.datastore_ref || 'N/A'} | State: {row.datastore_migration_state}
                    </p>
                    <p>Delivery/Transfers/Mobile: {boolPill(row.entitlement.allowDelivery)} / {boolPill(row.entitlement.allowTransfers)} / {boolPill(row.entitlement.allowMobile)}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200" onClick={() => void openBindings(row)} type="button">Bindings</button>
                    <button className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200" onClick={() => openOverride(row)} type="button">Override</button>
                    <button className="rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:border-rose-700 dark:text-rose-300" onClick={() => openSuspend(row)} type="button">Suspend</button>
                    <button className="rounded-lg border border-emerald-300 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-700 dark:text-emerald-300" onClick={() => openReactivate(row)} type="button">Reactivate</button>
                    <button className="rounded-lg border border-rose-500 bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white dark:border-rose-700" onClick={() => openDelete(row)} type="button">Delete</button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      {dialogMode === 'bindings' && selected ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Tenant Bindings: {selected.company_name}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Read-only view of branches, locations, and users linked to this tenant.</p>
              </div>
              <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300" onClick={closeDialog} type="button">Close</button>
            </header>

            <div className="grid gap-3 p-4 md:grid-cols-3">
              <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Branches</p>
                <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{bindings?.branches.length ?? 0}</p>
              </article>
              <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Locations</p>
                <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{bindings?.locations.length ?? 0}</p>
              </article>
              <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Users</p>
                <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{bindings?.users.length ?? 0}</p>
              </article>
            </div>

            <div className="grid gap-4 px-4 pb-4 lg:grid-cols-3">
              <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Branches</h3>
                {loadingBindings ? (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Loading...</p>
                ) : (bindings?.branches.length ?? 0) === 0 ? (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No branches.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {bindings?.branches.map((branch) => (
                      <article className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/60" key={branch.id}>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{branch.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {branch.code} | {branch.type} | {branch.isActive ? 'Active' : 'Inactive'}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Locations</h3>
                {loadingBindings ? (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Loading...</p>
                ) : (bindings?.locations.length ?? 0) === 0 ? (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No locations.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {bindings?.locations.map((location) => (
                      <article className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/60" key={location.id}>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{location.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {location.code} | {location.type}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Branch: {location.branchId ? branchNameById.get(location.branchId) ?? location.branchId : 'Not linked'}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/40">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Users</h3>
                {loadingBindings ? (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Loading...</p>
                ) : (bindings?.users.length ?? 0) === 0 ? (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No users.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {bindings?.users.map((user) => (
                      <article className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/60" key={user.id}>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{user.fullName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {user.roles.length > 0 ? user.roles.join(', ') : 'No roles'} | {user.isActive ? 'Active' : 'Inactive'}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {dialogMode === 'override' && selected && overrideForm ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Override Entitlement: {selected.company_name}</h2>
              <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300" onClick={closeDialog} type="button">Close</button>
            </header>
            <div className="grid gap-3 p-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Status</span>
                <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onChange={(event) => setOverrideForm((prev) => prev ? { ...prev, status: event.target.value as EntitlementStatus } : prev)} value={overrideForm.status}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PAST_DUE">PAST_DUE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                  <option value="CANCELED">CANCELED</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Max Branches</span>
                <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" min={1} onChange={(event) => setOverrideForm((prev) => prev ? { ...prev, max_branches: Number(event.target.value) || 1 } : prev)} type="number" value={overrideForm.max_branches} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Branch Mode</span>
                <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onChange={(event) => setOverrideForm((prev) => prev ? { ...prev, branch_mode: event.target.value as BranchMode } : prev)} value={overrideForm.branch_mode}>
                  <option value="SINGLE">SINGLE</option>
                  <option value="MULTI">MULTI</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Inventory Mode</span>
                <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onChange={(event) => setOverrideForm((prev) => prev ? { ...prev, inventory_mode: event.target.value as InventoryMode } : prev)} value={overrideForm.inventory_mode}>
                  <option value="STORE_ONLY">STORE_ONLY</option>
                  <option value="STORE_WAREHOUSE">STORE_WAREHOUSE</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Grace Until (Optional)</span>
                <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onChange={(event) => setOverrideForm((prev) => prev ? { ...prev, grace_until: event.target.value } : prev)} type="datetime-local" value={overrideForm.grace_until} />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Reason (Audit Note)</span>
                <textarea className="min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onChange={(event) => setOverrideForm((prev) => prev ? { ...prev, reason: event.target.value } : prev)} placeholder="Optional change note for audit trail..." value={overrideForm.reason} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Allow Delivery</span>
                <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onChange={(event) => setOverrideForm((prev) => prev ? { ...prev, allow_delivery: event.target.value === 'true' } : prev)} value={String(overrideForm.allow_delivery)}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Allow Transfers</span>
                <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onChange={(event) => setOverrideForm((prev) => prev ? { ...prev, allow_transfers: event.target.value === 'true' } : prev)} value={String(overrideForm.allow_transfers)}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Allow Mobile</span>
                <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onChange={(event) => setOverrideForm((prev) => prev ? { ...prev, allow_mobile: event.target.value === 'true' } : prev)} value={String(overrideForm.allow_mobile)}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" onClick={closeDialog} type="button">Cancel</button>
              <button className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white hover:brightness-110" disabled={saving} onClick={() => void submitOverride()} type="button">
                {saving ? 'Saving...' : 'Save Override'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {dialogMode === 'provision' ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Provision Tenant from Subscription</h2>
              <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300" onClick={closeDialog} type="button">Close</button>
            </header>
            <div className="grid gap-3 p-4 md:grid-cols-2">
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Active Subscription</span>
                <div className="flex gap-2">
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    onChange={(event) => applySubscriptionSelection(event.target.value)}
                    value={selectedSubscriptionId}
                  >
                    <option value="">Select active subscription...</option>
                    {activeSubscriptions.map((subscription) => (
                      <option key={subscription.subscription_id} value={subscription.subscription_id}>
                        {subscription.customer_name} - {subscription.plan_name ?? 'No Plan'} | Ends: {formatSubscriptionDate(subscription.end_date)} ({subscription.subscription_id})
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={() => void loadActiveSubscriptions(provisionForm.subman_api_key)}
                    type="button"
                  >
                    {loadingSubscriptions ? 'Loading...' : 'Reload'}
                  </button>
                </div>
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                  Shows only ACTIVE subscriptions from SubMan.
                </span>
                {selectedSubscription ? (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                    <div><span className="font-medium">Subscription ID:</span> {selectedSubscription.subscription_id}</div>
                    <div><span className="font-medium">Start:</span> {formatSubscriptionDate(selectedSubscription.start_date)}</div>
                    <div><span className="font-medium">End:</span> {formatSubscriptionDate(selectedSubscription.end_date)}</div>
                    <div><span className="font-medium">Next Billing:</span> {formatSubscriptionDate(selectedSubscription.next_billing_date)}</div>
                  </div>
                ) : null}
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Client ID</span>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) => setProvisionForm((prev) => ({ ...prev, client_id: event.target.value }))}
                  placeholder="e.g. TENANT_ACME"
                  required
                  value={provisionForm.client_id}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Template (Optional)</span>
                <select
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) =>
                    setProvisionForm((prev) => ({
                      ...prev,
                      template: event.target.value as ProvisionFormState['template']
                    }))
                  }
                  value={provisionForm.template}
                >
                  <option value="">Auto from plan</option>
                  <option value="SINGLE_STORE">SINGLE_STORE</option>
                  <option value="STORE_WAREHOUSE">STORE_WAREHOUSE</option>
                  <option value="MULTI_BRANCH_STARTER">MULTI_STORE</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Tenancy Mode</span>
                <select
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) =>
                    setProvisionForm((prev) => ({
                      ...prev,
                      tenancy_mode: event.target.value as TenancyMode,
                      datastore_ref: event.target.value === 'DEDICATED_DB' ? prev.datastore_ref : ''
                    }))
                  }
                  value={provisionForm.tenancy_mode}
                >
                  <option value="SHARED_DB">Shared DB</option>
                  <option value="DEDICATED_DB">Dedicated DB</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">
                  Datastore Reference {provisionForm.tenancy_mode === 'DEDICATED_DB' ? '(Optional)' : '(Disabled for Shared DB)'}
                </span>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                  disabled={provisionForm.tenancy_mode !== 'DEDICATED_DB'}
                  onChange={(event) => setProvisionForm((prev) => ({ ...prev, datastore_ref: event.target.value }))}
                  placeholder="e.g. postgresql://tenant-db-host/vpos_tenant"
                  value={provisionForm.datastore_ref}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Subscription API Key (Optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) => setProvisionForm((prev) => ({ ...prev, subman_api_key: event.target.value }))}
                  placeholder="Use tenant API key if SubMan requires it"
                  type="password"
                  value={provisionForm.subman_api_key}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Company Name Override (Optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) => setProvisionForm((prev) => ({ ...prev, company_name: event.target.value }))}
                  placeholder="Leave blank to use subscriptionapp value"
                  value={provisionForm.company_name}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Company Code Override (Optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) => setProvisionForm((prev) => ({ ...prev, company_code: event.target.value }))}
                  placeholder="Leave blank to use subscriptionapp value"
                  value={provisionForm.company_code}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Tenant Owner Email (Optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) => setProvisionForm((prev) => ({ ...prev, admin_email: event.target.value }))}
                  placeholder="owner@tenant.local"
                  type="email"
                  value={provisionForm.admin_email}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Tenant Owner Password (Optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  onChange={(event) => setProvisionForm((prev) => ({ ...prev, admin_password: event.target.value }))}
                  placeholder="Owner@123"
                  type="password"
                  value={provisionForm.admin_password}
                />
              </label>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" onClick={closeDialog} type="button">Cancel</button>
              <button className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white hover:brightness-110" disabled={saving || !provisionForm.client_id.trim()} onClick={() => void submitProvisionFromSubscription()} type="button">
                {saving ? 'Provisioning...' : 'Provision Tenant'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {dialogMode === 'suspend' && selected ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Suspend {selected.company_name}?</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              This blocks new transactional writes for this tenant based on entitlement policy.
            </p>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Grace Until (optional)</span>
              <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onChange={(event) => setSuspendGraceUntil(event.target.value)} type="datetime-local" value={suspendGraceUntil} />
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Reason</span>
              <textarea className="min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onChange={(event) => setActionReason(event.target.value)} placeholder="Audit note for this suspension..." value={actionReason} />
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" onClick={closeDialog} type="button">Cancel</button>
              <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500" disabled={saving} onClick={() => void submitSuspend()} type="button">
                {saving ? 'Suspending...' : 'Confirm Suspend'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {dialogMode === 'reactivate' && selected ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Reactivate {selected.company_name}?</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              This sets tenant entitlement status back to ACTIVE and clears grace lock.
            </p>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Reason</span>
              <textarea className="min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" onChange={(event) => setActionReason(event.target.value)} placeholder="Audit note for this reactivation..." value={actionReason} />
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" onClick={closeDialog} type="button">Cancel</button>
              <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500" disabled={saving} onClick={() => void submitReactivate()} type="button">
                {saving ? 'Reactivating...' : 'Confirm Reactivate'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {dialogMode === 'delete' && selected ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Delete Tenant: {selected.company_name}</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              This will permanently delete the tenant and related records. For dedicated mode, the dedicated database will also be dropped.
            </p>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Reason (Audit note)</span>
              <textarea
                className="min-h-20 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                onChange={(event) => setActionReason(event.target.value)}
                placeholder="Reason for tenant deletion..."
                value={actionReason}
              />
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">
                Type <span className="font-mono">{selected.company_code}</span> to confirm
              </span>
              <input
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                onChange={(event) => setDeleteConfirmCode(event.target.value)}
                placeholder={selected.company_code}
                value={deleteConfirmCode}
              />
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800" onClick={closeDialog} type="button">Cancel</button>
              <button
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={saving || deleteConfirmCode.trim().toUpperCase() !== selected.company_code.trim().toUpperCase()}
                onClick={() => void submitDelete()}
                type="button"
              >
                {saving ? 'Deleting...' : 'Delete Tenant'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {saving ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[1px]">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brandPrimary dark:border-slate-600 dark:border-t-brandSecondary" />
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{savingMessage}</p>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Please wait. Actions are temporarily disabled.
            </p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
