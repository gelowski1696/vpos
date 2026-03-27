'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { toastError, toastSuccess } from '../../../lib/web-toast';

type BranchRecord = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

type LocationRecord = {
  id: string;
  branchId?: string | null;
  code?: string | null;
  name: string;
};

type CylinderStatus = 'FULL' | 'EMPTY' | 'DAMAGED' | 'JUNKED' | 'DISPOSED' | 'LOST';
type ServiceActionType = 'JUNK' | 'DISPOSE' | 'REPLACE';

type CylinderRow = {
  serial: string;
  typeCode: string;
  status: CylinderStatus;
  locationId: string;
  updatedAt: string;
};

type CylinderServiceActionRow = {
  id: string;
  actionType: ServiceActionType;
  sourceSerial: string | null;
  replacementSerial: string | null;
  branchId: string;
  locationId: string;
  customerId: string | null;
  saleId: string | null;
  reason: string;
  notes: string | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  branchCode: string | null;
  branchName: string | null;
  locationCode: string | null;
  locationName: string | null;
  sourceCylinderStatus: CylinderStatus | null;
  sourceCylinderLocationId: string | null;
  replacementCylinderStatus: CylinderStatus | null;
  replacementCylinderLocationId: string | null;
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function toneClass(status: CylinderStatus): string {
  if (status === 'FULL') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (status === 'EMPTY') return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  if (status === 'DAMAGED') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  if (status === 'JUNKED') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  if (status === 'DISPOSED') return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100';
  return 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300';
}

function actionLabel(type: ServiceActionType): string {
  if (type === 'JUNK') return 'Moved To Junk';
  if (type === 'DISPOSE') return 'Disposed';
  return 'Replaced';
}

export default function CylindersPage(): JSX.Element {
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [rows, setRows] = useState<CylinderRow[]>([]);
  const [actions, setActions] = useState<CylinderServiceActionRow[]>([]);
  const [branchId, setBranchId] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | CylinderStatus>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<CylinderRow | null>(null);
  const [actionModal, setActionModal] = useState<null | ServiceActionType>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [replacementSerial, setReplacementSerial] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadAll(): Promise<{
    cylinders: CylinderRow[];
    actions: CylinderServiceActionRow[];
  }> {
    const [branchRows, locationRows, cylinderRows, serviceActions] = await Promise.all([
      apiRequest<BranchRecord[]>('/master-data/branches'),
      apiRequest<LocationRecord[]>('/master-data/locations'),
      apiRequest<CylinderRow[]>('/cylinders'),
      apiRequest<CylinderServiceActionRow[]>('/cylinders/service-actions?limit=120')
    ]);
    setBranches((branchRows ?? []).filter((row) => row.isActive));
    setLocations(locationRows ?? []);
    setRows(cylinderRows ?? []);
    setActions(serviceActions ?? []);
    return {
      cylinders: cylinderRows ?? [],
      actions: serviceActions ?? []
    };
  }

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        await loadAll();
      } catch (cause) {
        toastError('Cylinders', {
          description: cause instanceof Error ? cause.message : 'Failed to load cylinders.'
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const locationMap = useMemo(
    () => new Map(locations.map((row) => [row.id, row])),
    [locations]
  );

  const branchLocationIds = useMemo(() => {
    if (branchId === 'ALL') return null;
    return new Set(locations.filter((row) => (row.branchId ?? null) === branchId).map((row) => row.id));
  }, [locations, branchId]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows
      .filter((row) => (statusFilter === 'ALL' ? true : row.status === statusFilter))
      .filter((row) => (branchLocationIds ? branchLocationIds.has(row.locationId) : true))
      .filter((row) => {
        if (!query) return true;
        const locationLabel = locationMap.get(row.locationId)?.name ?? row.locationId;
        return `${row.serial} ${row.typeCode} ${row.status} ${locationLabel}`.toLowerCase().includes(query);
      });
  }, [rows, statusFilter, branchLocationIds, search, locationMap]);

  const selectedActions = useMemo(() => {
    if (!selected) return [];
    return actions.filter(
      (row) => row.sourceSerial === selected.serial || row.replacementSerial === selected.serial
    );
  }, [actions, selected]);

  const replacementCandidates = useMemo(() => {
    if (!selected) return [];
    const selectedBranchId = locationMap.get(selected.locationId)?.branchId ?? null;
    return rows.filter((row) => {
      if (row.serial === selected.serial) return false;
      if (row.status !== 'FULL') return false;
      const candidateBranchId = locationMap.get(row.locationId)?.branchId ?? null;
      return selectedBranchId ? candidateBranchId === selectedBranchId : true;
    });
  }, [rows, selected, locationMap]);

  const canJunk =
    selected &&
    selected.status !== 'JUNKED' &&
    selected.status !== 'DISPOSED' &&
    selected.status !== 'LOST';
  const canDispose = selected && (selected.status === 'DAMAGED' || selected.status === 'JUNKED');
  const canReplace =
    selected &&
    selected.status !== 'DISPOSED' &&
    selected.status !== 'LOST' &&
    selected.status !== 'JUNKED';

  async function submitAction(): Promise<void> {
    if (!selected || !actionModal || saving) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toastError('Cylinder Action', { description: 'Reason is required.' });
      return;
    }

    setSaving(true);
    try {
      if (actionModal === 'JUNK') {
        await apiRequest('/cylinders/service-actions/junk', {
          method: 'POST',
          body: {
            serial: selected.serial,
            branch_id: locationMap.get(selected.locationId)?.branchId ?? null,
            reason: trimmedReason,
            notes: notes.trim() || null
          }
        });
        toastSuccess('Cylinder moved to junk');
      } else if (actionModal === 'DISPOSE') {
        await apiRequest('/cylinders/service-actions/dispose', {
          method: 'POST',
          body: {
            serial: selected.serial,
            branch_id: locationMap.get(selected.locationId)?.branchId ?? null,
            reason: trimmedReason,
            notes: notes.trim() || null
          }
        });
        toastSuccess('Cylinder disposed');
      } else {
        const replacement = replacementCandidates.find((row) => row.serial === replacementSerial);
        if (!replacement) {
          toastError('Replace Cylinder', { description: 'Choose a replacement cylinder first.' });
          return;
        }
        await apiRequest('/cylinders/service-actions/replace', {
          method: 'POST',
          body: {
            source_serial: selected.serial,
            replacement_serial: replacement.serial,
            from_location_id: replacement.locationId,
            to_location_id: selected.locationId,
            branch_id: locationMap.get(replacement.locationId)?.branchId ?? null,
            reason: trimmedReason,
            notes: notes.trim() || null
          }
        });
        toastSuccess('Cylinder replacement posted');
      }

      setActionModal(null);
      setReason('');
      setNotes('');
      setReplacementSerial(null);
      const refreshed = await loadAll();
      setSelected(refreshed.cylinders.find((row) => row.serial === selected.serial) ?? null);
    } catch (cause) {
      toastError('Cylinder Action', {
        description: cause instanceof Error ? cause.message : 'Action failed.'
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6" data-tour="cylinders-root">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Cylinders</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
              Review serial cylinder assets, then use the detail panel to mark junk, dispose damaged units, or post a replacement service action.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={busy || loading}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:grid-cols-[1.2fr_0.8fr_0.8fr]" data-tour="cylinders-search">
        <label className="grid gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Serial, type code, or location"
            className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>
        <label className="grid gap-1" data-tour="cylinders-branch-filter">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Branch</span>
          <select
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
            className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            <option value="ALL">All Branches</option>
            {branches.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} ({row.code})
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'ALL' | CylinderStatus)}
            className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {['ALL', 'FULL', 'EMPTY', 'DAMAGED', 'JUNKED', 'DISPOSED', 'LOST'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-tour="cylinders-list">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cylinder Register</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{filteredRows.length} cylinders in view</p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredRows.map((row) => {
              const location = locationMap.get(row.locationId);
              return (
                <button
                  key={row.serial}
                  type="button"
                  onClick={() => setSelected(row)}
                  className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-800/80 dark:hover:border-slate-500"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{row.serial}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {row.typeCode} • {location?.name ?? row.locationId}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${toneClass(row.status)}`}>
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                    Updated {fmtDate(row.updatedAt)}
                  </p>
                </button>
              );
            })}
            {!loading && filteredRows.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                No cylinders matched the current filters.
              </div>
            ) : null}
          </div>
        </section>

        <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent Service Actions</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Latest junk, dispose, and replace actions across the tenant.
          </p>
          <div className="mt-4 space-y-3">
            {actions.slice(0, 12).map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{actionLabel(row.actionType)}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{fmtDate(row.createdAt)}</p>
                  </div>
                  <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                    {row.actionType}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  {row.sourceSerial}
                  {row.replacementSerial ? ` → ${row.replacementSerial}` : ''}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{row.reason}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 px-4 py-8">
          <button type="button" className="absolute inset-0" onClick={() => setSelected(null)} aria-label="Close cylinder detail" />
          <div className="relative z-10 max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-700">
              <div>
                <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{selected.serial}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {selected.typeCode} • {locationMap.get(selected.locationId)?.name ?? selected.locationId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <div className="grid max-h-[calc(88vh-80px)] gap-0 overflow-hidden lg:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-4 overflow-y-auto border-r border-slate-200 px-6 py-5 dark:border-slate-700">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/80">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Current Status</p>
                      <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{selected.status}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${toneClass(selected.status)}`}>
                      {selected.status}
                    </span>
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm">
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">Location</dt>
                      <dd className="font-medium text-slate-900 dark:text-slate-100">{locationMap.get(selected.locationId)?.name ?? selected.locationId}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">Last Updated</dt>
                      <dd className="font-medium text-slate-900 dark:text-slate-100">{fmtDate(selected.updatedAt)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="grid gap-3">
                  <button
                    type="button"
                    disabled={!canJunk}
                    onClick={() => {
                      setActionModal('JUNK');
                      setReason('');
                      setNotes('');
                      setReplacementSerial(null);
                    }}
                    className="rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Move To Junk
                  </button>
                  <button
                    type="button"
                    disabled={!canDispose}
                    onClick={() => {
                      setActionModal('DISPOSE');
                      setReason('');
                      setNotes('');
                      setReplacementSerial(null);
                    }}
                    className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Dispose
                  </button>
                  <button
                    type="button"
                    disabled={!canReplace}
                    onClick={() => {
                      setActionModal('REPLACE');
                      setReason('');
                      setNotes('');
                      setReplacementSerial(null);
                    }}
                    className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    Replace Cylinder
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto px-6 py-5">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent Activity For This Serial</h4>
                <div className="mt-4 space-y-3">
                  {selectedActions.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                      No service actions yet for this cylinder.
                    </div>
                  ) : (
                    selectedActions.map((row) => (
                      <div key={row.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/80">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{actionLabel(row.actionType)}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{fmtDate(row.createdAt)}</p>
                          </div>
                          <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100">
                            {row.actionType}
                          </span>
                        </div>
                        <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{row.reason}</p>
                        {row.replacementSerial ? (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Replacement cylinder: {row.replacementSerial}</p>
                        ) : null}
                        {row.notes ? (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Notes: {row.notes}</p>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {actionModal && selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-8">
          <button type="button" className="absolute inset-0" onClick={() => setActionModal(null)} aria-label="Close cylinder action dialog" />
          <div className="relative z-10 w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{actionLabel(actionModal)}</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {actionModal === 'REPLACE'
                ? 'Select the replacement cylinder and confirm why the swap is needed.'
                : 'Record the reason clearly so the service action stays easy to audit later.'}
            </p>

            {actionModal === 'REPLACE' ? (
              <div className="mt-5">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Replacement Cylinder
                </label>
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-3xl border border-slate-200 p-3 dark:border-slate-700">
                  {replacementCandidates.map((row) => (
                    <button
                      key={row.serial}
                      type="button"
                      onClick={() => setReplacementSerial(row.serial)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        replacementSerial === row.serial
                          ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                          : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-500'
                      }`}
                    >
                      <div className="font-semibold">{row.serial}</div>
                      <div className="mt-1 text-xs opacity-80">
                        {row.typeCode} • {locationMap.get(row.locationId)?.name ?? row.locationId}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5 grid gap-4">
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Reason</span>
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Enter the service reason"
                  className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>
              <label className="grid gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Optional notes"
                  className="min-h-28 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none ring-0 transition focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitAction()}
                disabled={saving}
                className={`inline-flex h-11 items-center justify-center rounded-2xl px-4 text-sm font-semibold text-white transition ${
                  actionModal === 'DISPOSE'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : actionModal === 'JUNK'
                      ? 'bg-amber-500 hover:bg-amber-600'
                      : 'bg-slate-900 hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {saving ? 'Saving...' : 'Save Action'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
