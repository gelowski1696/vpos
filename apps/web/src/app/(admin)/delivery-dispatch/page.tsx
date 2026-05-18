'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  API_BASE_URL,
  apiRequest,
  getAccessToken,
  getSessionClientId
} from '../../../lib/api-client';
import { toastError, toastInfo, toastSuccess } from '../../../lib/web-toast';

type EntitlementResponse = {
  addons?: {
    delivery_dispatch_suite?: boolean;
  };
};

type BranchRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type UserRow = {
  id: string;
  fullName: string;
  email: string;
  branchId?: string | null;
  isActive: boolean;
  roles: string[];
};

type DeliveryStatus =
  | 'CREATED'
  | 'ASSIGNED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETURNED'
  | 'COMPLETE';

type DeliveryOrderRow = {
  id: string;
  order_type: 'PICKUP' | 'DELIVERY';
  status: DeliveryStatus;
  customer_id?: string | null;
  sale_id?: string | null;
  personnel: Array<{ user_id: string; role: string }>;
  cashier_validated_at?: string | null;
  cashier_validated_by_user_id?: string | null;
  cashier_validated_by_name?: string | null;
  created_at: string;
  updated_at: string;
};

type DeliveryEventRow = {
  id: string;
  delivery_order_id: string;
  from_status: DeliveryStatus | null;
  to_status: DeliveryStatus;
  notes?: string;
  actor_user_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

function dt(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function statusClasses(status: DeliveryStatus): string {
  switch (status) {
    case 'COMPLETE':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/35 dark:text-emerald-200';
    case 'DELIVERED':
      return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/35 dark:text-cyan-200';
    case 'OUT_FOR_DELIVERY':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/35 dark:text-amber-200';
    case 'FAILED':
      return 'bg-rose-100 text-rose-800 dark:bg-rose-900/35 dark:text-rose-200';
    case 'RETURNED':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/35 dark:text-purple-200';
    case 'ASSIGNED':
      return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/35 dark:text-indigo-200';
    case 'CREATED':
    default:
      return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
  }
}

export default function DeliveryDispatchPage(): JSX.Element {
  const searchParams = useSearchParams();
  const saleFromQuery = searchParams.get('sale_id')?.trim() ?? '';

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [rows, setRows] = useState<DeliveryOrderRow[]>([]);

  const [statusFilter, setStatusFilter] = useState<'ALL' | DeliveryStatus>('ALL');
  const [branchFilter, setBranchFilter] = useState('ALL');
  const [riderFilter, setRiderFilter] = useState('ALL');
  const [saleFilter, setSaleFilter] = useState(saleFromQuery);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<DeliveryOrderRow | null>(null);
  const [events, setEvents] = useState<DeliveryEventRow[]>([]);

  const [createOrderType, setCreateOrderType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [createSaleId, setCreateSaleId] = useState(saleFromQuery);
  const [createNotes, setCreateNotes] = useState('');

  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState<'DRIVER' | 'HELPER' | 'PERSONNEL'>('DRIVER');
  const [statusNotes, setStatusNotes] = useState('');
  const [cashierValidatorUserId, setCashierValidatorUserId] = useState('');

  const userById = useMemo(() => new Map(users.map((row) => [row.id, row])), [users]);
  const riders = useMemo(
    () =>
      users.filter(
        (row) =>
          row.isActive &&
          row.roles.some((role) => {
            const normalized = role.trim().toLowerCase();
            return (
              normalized === 'driver' ||
              normalized === 'helper' ||
              normalized === 'rider' ||
              normalized === 'cashier'
            );
          })
      ),
    [users]
  );
  const cashValidators = useMemo(
    () =>
      users.filter(
        (row) =>
          row.isActive &&
          row.roles.some((role) => {
            const normalized = role.trim().toLowerCase();
            return (
              normalized === 'cashier' ||
              normalized === 'admin' ||
              normalized === 'owner' ||
              normalized === 'supervisor' ||
              normalized === 'platform_owner'
            );
          })
      ),
    [users]
  );

  async function loadMeta(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const entitlement = await apiRequest<EntitlementResponse>(
        '/platform/entitlements/current'
      );
      const addonEnabled = entitlement.addons?.delivery_dispatch_suite === true;
      setEnabled(addonEnabled);
      if (!addonEnabled) {
        setRows([]);
        return;
      }
      const [branchRows, userRows] = await Promise.all([
        apiRequest<BranchRow[]>('/master-data/branches'),
        apiRequest<UserRow[]>('/master-data/users')
      ]);
      setBranches(branchRows.filter((row) => row.isActive));
      setUsers(userRows.filter((row) => row.isActive));
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : 'Failed to load delivery dispatch metadata.';
      setError(message);
      toastError('Delivery dispatch load failed', { description: message });
    } finally {
      setLoading(false);
    }
  }

  async function loadOrders(): Promise<void> {
    if (!enabled) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (branchFilter !== 'ALL') params.set('branch_id', branchFilter);
      if (riderFilter !== 'ALL') params.set('rider_user_id', riderFilter);
      if (saleFilter.trim()) params.set('sale_id', saleFilter.trim());
      params.set('limit', '300');
      const data = await apiRequest<DeliveryOrderRow[]>(
        `/delivery/orders?${params.toString()}`
      );
      setRows(data);
      if (selectedId) {
        const found = data.find((row) => row.id === selectedId) ?? null;
        setSelectedRow(found);
      }
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Failed to load delivery orders.';
      setError(message);
      toastError('Delivery orders load failed', { description: message });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function openRow(row: DeliveryOrderRow): Promise<void> {
    setSelectedId(row.id);
    setSelectedRow(row);
    setStatusNotes('');
    try {
      const data = await apiRequest<DeliveryEventRow[]>(
        `/delivery/orders/${encodeURIComponent(row.id)}/events`
      );
      setEvents(data);
    } catch {
      setEvents([]);
    }
  }

  useEffect(() => {
    void loadMeta();
  }, []);

  useEffect(() => {
    if (enabled === true) {
      void loadOrders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, statusFilter, branchFilter, riderFilter]);

  useEffect(() => {
    setCreateSaleId(saleFromQuery);
    setSaleFilter(saleFromQuery);
  }, [saleFromQuery]);

  async function createOrder(): Promise<void> {
    if (!createSaleId.trim()) {
      toastInfo('Sale ID is required before creating delivery order.');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/delivery/orders', {
        method: 'POST',
        body: {
          order_type: createOrderType,
          sale_id: createSaleId.trim(),
          notes: createNotes.trim() || null,
          personnel: []
        }
      });
      toastSuccess('Delivery order created.');
      await loadOrders();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Failed to create delivery order.';
      toastError('Create delivery failed', { description: message });
    } finally {
      setBusy(false);
    }
  }

  async function assignSelected(): Promise<void> {
    if (!selectedRow) return;
    if (!assignUserId) {
      toastInfo('Select rider/personnel first.');
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/delivery/orders/${encodeURIComponent(selectedRow.id)}/assign`, {
        method: 'POST',
        body: {
          notes: statusNotes.trim() || null,
          personnel: [{ user_id: assignUserId, role: assignRole }]
        }
      });
      toastSuccess('Delivery assignment updated.');
      await Promise.all([
        loadOrders(),
        openRow({ ...selectedRow, status: 'ASSIGNED' })
      ]);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Failed to assign delivery order.';
      toastError('Assign failed', { description: message });
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(next: DeliveryStatus): Promise<void> {
    if (!selectedRow) return;
    setBusy(true);
    try {
      await apiRequest(`/delivery/orders/${encodeURIComponent(selectedRow.id)}/status`, {
        method: 'POST',
        body: {
          status: next,
          notes: statusNotes.trim() || null,
          ...(next === 'COMPLETE' && cashierValidatorUserId
            ? { cashier_validated_by_user_id: cashierValidatorUserId }
            : {})
        }
      });
      toastSuccess(`Delivery status set to ${next}.`);
      await Promise.all([loadOrders(), openRow({ ...selectedRow, status: next })]);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Failed to update delivery status.';
      toastError('Status update failed', { description: message });
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv(): Promise<void> {
    if (!enabled) {
      return;
    }
    const token = getAccessToken();
    if (!token) {
      toastError('Session expired. Please log in again.');
      return;
    }
    const clientId = getSessionClientId();
    const params = new URLSearchParams();
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    if (branchFilter !== 'ALL') params.set('branch_id', branchFilter);
    if (riderFilter !== 'ALL') params.set('rider_user_id', riderFilter);
    if (saleFilter.trim()) params.set('sale_id', saleFilter.trim());
    params.set('limit', '1000');

    const response = await fetch(
      `${API_BASE_URL}/delivery/orders/export.csv?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-VPOS-Client': 'web',
          'X-Client-Id': clientId
        }
      }
    );
    if (!response.ok) {
      const text = await response.text();
      toastError('CSV export failed', { description: text || `HTTP ${response.status}` });
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `delivery_dispatch_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toastSuccess('Delivery CSV exported.');
  }

  if (enabled === false) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Delivery Dispatch</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Delivery Dispatch Suite add-on is not enabled for this tenant.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4" data-tour="delivery-dispatch-root">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Delivery Dispatch</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Assign riders, track delivery lifecycle, enforce cashier validation before COMPLETE, and export dispatch CSV.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200" onClick={() => void loadOrders()} type="button" disabled={loading || busy}>
              {loading ? 'Loading...' : 'Refresh'}
            </button>
            <button className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900" onClick={() => void exportCsv()} type="button" disabled={loading || busy}>
              Export Delivery CSV
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <label className="text-xs">
            <span className="mb-1 block text-slate-600 dark:text-slate-300">Status</span>
            <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'ALL' | DeliveryStatus)}>
              <option value="ALL">All</option>
              <option value="CREATED">CREATED</option>
              <option value="ASSIGNED">ASSIGNED</option>
              <option value="OUT_FOR_DELIVERY">OUT_FOR_DELIVERY</option>
              <option value="DELIVERED">DELIVERED</option>
              <option value="FAILED">FAILED</option>
              <option value="RETURNED">RETURNED</option>
              <option value="COMPLETE">COMPLETE</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-slate-600 dark:text-slate-300">Branch</span>
            <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
              <option value="ALL">All</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-slate-600 dark:text-slate-300">Rider/User</span>
            <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={riderFilter} onChange={(event) => setRiderFilter(event.target.value)}>
              <option value="ALL">All</option>
              {riders.map((row) => (
                <option key={row.id} value={row.id}>{row.fullName}</option>
              ))}
            </select>
          </label>
          <label className="text-xs md:col-span-2">
            <span className="mb-1 block text-slate-600 dark:text-slate-300">Sale ID</span>
            <div className="flex gap-2">
              <input className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={saleFilter} onChange={(event) => setSaleFilter(event.target.value)} />
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-600" type="button" onClick={() => void loadOrders()}>
                Apply
              </button>
            </div>
          </label>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-200">{error}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Dispatch Orders</h2>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">{rows.length}</span>
          </header>
          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/80 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2">Delivery</th>
                  <th className="px-3 py-2">Sale</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Rider</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td className="px-3 py-6 text-center text-slate-500" colSpan={5}>{loading ? 'Loading...' : 'No delivery orders found.'}</td></tr>
                ) : rows.map((row) => {
                  const riderLabel = row.personnel
                    .map((entry) => userById.get(entry.user_id)?.fullName ?? entry.user_id)
                    .join(', ') || '-';
                  return (
                    <tr key={row.id} className={`cursor-pointer border-t border-slate-100 dark:border-slate-800 ${selectedId === row.id ? 'bg-brandPrimary/10 dark:bg-brandPrimary/20' : ''}`} onClick={() => void openRow(row)}>
                      <td className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-100">{row.id}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{row.sale_id ?? '-'}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClasses(row.status)}`}>{row.status}</span></td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{riderLabel}</td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{dt(row.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Actions</h2>

          <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Create from Sale</p>
            <div className="mt-2 grid gap-2">
              <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-800" value={createOrderType} onChange={(event) => setCreateOrderType(event.target.value as 'DELIVERY' | 'PICKUP')}>
                <option value="DELIVERY">DELIVERY</option>
                <option value="PICKUP">PICKUP</option>
              </select>
              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-800" placeholder="Sale ID" value={createSaleId} onChange={(event) => setCreateSaleId(event.target.value)} />
              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-800" placeholder="Notes (optional)" value={createNotes} onChange={(event) => setCreateNotes(event.target.value)} />
              <button className="rounded-lg bg-brandPrimary px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" type="button" onClick={() => void createOrder()} disabled={busy || loading}>
                Create Delivery Order
              </button>
            </div>
          </div>

          {selectedRow ? (
            <>
              <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Selected</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{selectedRow.id}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Sale: {selectedRow.sale_id ?? '-'}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Status: {selectedRow.status}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Cashier Validation: {selectedRow.cashier_validated_by_name ?? '-'}</p>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Assign Rider</p>
                <div className="mt-2 grid gap-2">
                  <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-800" value={assignUserId} onChange={(event) => setAssignUserId(event.target.value)}>
                    <option value="">Select user</option>
                    {riders.map((row) => (
                      <option key={row.id} value={row.id}>{row.fullName} ({row.email})</option>
                    ))}
                  </select>
                  <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-800" value={assignRole} onChange={(event) => setAssignRole(event.target.value as 'DRIVER' | 'HELPER' | 'PERSONNEL')}>
                    <option value="DRIVER">DRIVER</option>
                    <option value="HELPER">HELPER</option>
                    <option value="PERSONNEL">PERSONNEL</option>
                  </select>
                  <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-800" placeholder="Notes" value={statusNotes} onChange={(event) => setStatusNotes(event.target.value)} />
                  <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200" type="button" onClick={() => void assignSelected()} disabled={busy}>
                    Save Assignment
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status Actions</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(['OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED', 'ASSIGNED'] as DeliveryStatus[]).map((status) => (
                    <button key={status} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200" type="button" onClick={() => void setStatus(status)} disabled={busy}>
                      {status}
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid gap-2">
                  <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-800" value={cashierValidatorUserId} onChange={(event) => setCashierValidatorUserId(event.target.value)}>
                    <option value="">Select cashier validator for COMPLETE</option>
                    {cashValidators.map((row) => (
                      <option key={row.id} value={row.id}>{row.fullName} ({row.roles.join(', ')})</option>
                    ))}
                  </select>
                  <button className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60" type="button" onClick={() => void setStatus('COMPLETE')} disabled={busy || !cashierValidatorUserId}>
                    Mark COMPLETE
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Timeline</p>
                <div className="mt-2 max-h-44 space-y-1 overflow-auto text-xs text-slate-700 dark:text-slate-200">
                  {events.length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-400">No delivery events yet.</p>
                  ) : events.map((event) => (
                    <p key={event.id}>
                      {dt(event.created_at)} | {event.from_status ?? '-'} {'->'} {event.to_status} | {event.notes ?? '-'}
                    </p>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Select a delivery order to manage assignments and status.</p>
          )}
        </article>
      </div>
    </section>
  );
}
