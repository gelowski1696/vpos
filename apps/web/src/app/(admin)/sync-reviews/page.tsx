'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { toastError, toastInfo, toastSuccess } from '../../../lib/web-toast';

type SyncReviewRow = {
  id: string;
  outbox_id: string;
  entity: string;
  reason: string;
  payload: Record<string, unknown>;
  status: 'OPEN' | 'RESOLVED';
  created_at: string;
  resolved_at?: string;
};

type StatusFilter = 'OPEN' | 'RESOLVED' | 'ALL';
type ReviewQuickFilter = 'ALL' | 'TRANSFER_OPEN';
type TransferDrillFilter = 'NONE' | 'STALE_CREATED' | 'STALE_APPROVED';

type TransferLifecycleRow = {
  id: string;
  status: 'CREATED' | 'APPROVED' | 'POSTED' | 'REVERSED';
  transfer_mode?:
    | 'SUPPLIER_RESTOCK_IN'
    | 'SUPPLIER_RESTOCK_OUT'
    | 'INTER_STORE_TRANSFER'
    | 'STORE_TO_WAREHOUSE'
    | 'WAREHOUSE_TO_STORE'
    | 'GENERAL';
  source_location_id: string;
  destination_location_id: string;
  created_at: string;
  updated_at: string;
};

const STALE_TRANSFER_MINUTES = 120;

function extractTransferIdFromReview(row: SyncReviewRow): string | null {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const candidates = [
    payload.transfer_id,
    payload.client_transfer_id,
    payload.id,
    payload.transferId
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  const outbox = row.outbox_id?.trim() ?? '';
  if (outbox.toLowerCase().startsWith('transfer-')) {
    return outbox;
  }
  return null;
}

function transferHref(params: {
  transferId?: string | null;
  status?: string | null;
  transferMode?: string | null;
}): string {
  const query = new URLSearchParams();
  if (params.transferId) {
    query.set('transfer_id', params.transferId);
  }
  if (params.status) {
    query.set('status', params.status);
  }
  if (params.transferMode) {
    query.set('transfer_mode', params.transferMode);
  }
  return query.toString() ? `/transfer-list?${query.toString()}` : '/transfer-list';
}

export default function SyncReviewsPage(): JSX.Element {
  const [rows, setRows] = useState<SyncReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [quickFilter, setQuickFilter] = useState<ReviewQuickFilter>('ALL');
  const [transferDrillFilter, setTransferDrillFilter] = useState<TransferDrillFilter>('NONE');
  const [selected, setSelected] = useState<SyncReviewRow | null>(null);
  const [resolution, setResolution] = useState('manual review completed');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [staleCreatedTransfers, setStaleCreatedTransfers] = useState<TransferLifecycleRow[]>([]);
  const [staleApprovedTransfers, setStaleApprovedTransfers] = useState<TransferLifecycleRow[]>([]);

  const isTransferReview = (row: SyncReviewRow): boolean =>
    row.entity.trim().toLowerCase() === 'transfer' ||
    row.reason.trim().toLowerCase().includes('transfer');

  const transferAgeMinutes = (row: TransferLifecycleRow): number => {
    const basisIso = row.status === 'APPROVED' ? row.updated_at : row.created_at;
    const basis = new Date(basisIso).getTime();
    if (Number.isNaN(basis)) {
      return 0;
    }
    return Math.max(0, Math.round((Date.now() - basis) / 60000));
  };

  const loadStaleTransferRows = async (): Promise<void> => {
    const [createdRows, approvedRows] = await Promise.all([
      apiRequest<TransferLifecycleRow[]>(
        `/transfers?status=CREATED&min_age_minutes=${STALE_TRANSFER_MINUTES}&age_basis=CREATED_AT&limit=500`
      ),
      apiRequest<TransferLifecycleRow[]>(
        `/transfers?status=APPROVED&min_age_minutes=${STALE_TRANSFER_MINUTES}&age_basis=UPDATED_AT&limit=500`
      )
    ]);
    setStaleCreatedTransfers(createdRows ?? []);
    setStaleApprovedTransfers(approvedRows ?? []);
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const query =
        statusFilter === 'ALL'
          ? '/reviews?limit=300'
          : `/reviews?status=${statusFilter}&limit=300`;
      const [data] = await Promise.all([
        apiRequest<{ rows: SyncReviewRow[] }>(query),
        loadStaleTransferRows()
      ]);
      setRows(data.rows ?? []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load sync reviews';
      setError(message);
      toastError('Failed to load sync reviews', { description: message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [statusFilter]);

  const openCount = useMemo(
    () => rows.filter((row) => row.status === 'OPEN').length,
    [rows]
  );

  const openTransferReviewCount = useMemo(
    () => rows.filter((row) => row.status === 'OPEN' && isTransferReview(row)).length,
    [rows]
  );

  const resolvedCount = useMemo(
    () => rows.filter((row) => row.status === 'RESOLVED').length,
    [rows]
  );

  const previewPayload = useMemo(
    () => (selected ? JSON.stringify(selected.payload ?? {}, null, 2) : ''),
    [selected]
  );

  const filteredRows = useMemo(() => {
    if (quickFilter === 'TRANSFER_OPEN') {
      return rows.filter((row) => row.status === 'OPEN' && isTransferReview(row));
    }
    return rows;
  }, [quickFilter, rows]);

  const drilledTransferRows = useMemo(() => {
    if (transferDrillFilter === 'STALE_CREATED') {
      return staleCreatedTransfers;
    }
    if (transferDrillFilter === 'STALE_APPROVED') {
      return staleApprovedTransfers;
    }
    return [];
  }, [staleApprovedTransfers, staleCreatedTransfers, transferDrillFilter]);

  const resolveReview = async (row: SyncReviewRow): Promise<void> => {
    const text = resolution.trim();
    if (!text) {
      const message = 'Resolution note is required.';
      setError(message);
      toastInfo('Resolution note required', { description: message });
      return;
    }
    setResolvingId(row.id);
    setError(null);
    try {
      await apiRequest<{ id: string; status: string }>(`/reviews/${row.id}/resolve`, {
        method: 'POST',
        body: { resolution: text }
      });
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                status: 'RESOLVED',
                resolved_at: new Date().toISOString(),
                payload: { ...item.payload, resolution: text }
              }
            : item
        )
      );
      if (selected?.id === row.id) {
        setSelected({
          ...row,
          status: 'RESOLVED',
          resolved_at: new Date().toISOString(),
          payload: { ...row.payload, resolution: text }
        });
      }
      toastSuccess('Sync review resolved', { description: row.id });
    } catch (resolveError) {
      const message = resolveError instanceof Error ? resolveError.message : 'Failed to resolve review';
      setError(message);
      toastError('Failed to resolve review', { description: message });
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <main>
      <h1 className="text-2xl font-bold text-brandPrimary">Sync Reviews</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Review rejected sync records, inspect payloads, and resolve conflicts with audit trail.
      </p>

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Total</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{rows.length}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Open</p>
          <p className="mt-1 text-2xl font-semibold text-rose-600 dark:text-rose-300">{openCount}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
          <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Resolved</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-300">{resolvedCount}</p>
        </article>
      </section>

      <section className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
        {(['OPEN', 'RESOLVED', 'ALL'] as const).map((value) => {
          const selectedFilter = statusFilter === value;
          return (
            <button
              className={`rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition ${
                selectedFilter
                  ? 'bg-brandPrimary text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
              key={value}
              onClick={() => setStatusFilter(value)}
              type="button"
            >
              {value}
            </button>
          );
        })}
        <button
          className="ml-auto rounded-lg bg-brandPrimary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          disabled={loading}
          onClick={() => void refresh()}
          type="button"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </section>

      <section className="mt-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Transfer Failure Drill-Down
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              quickFilter === 'ALL'
                ? 'bg-brandPrimary text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
            onClick={() => setQuickFilter('ALL')}
            type="button"
          >
            All Reviews
          </button>
          <button
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              quickFilter === 'TRANSFER_OPEN'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50'
            }`}
            onClick={() => setQuickFilter('TRANSFER_OPEN')}
            type="button"
          >
            Open Transfer Reviews ({openTransferReviewCount})
          </button>
          <button
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              transferDrillFilter === 'STALE_CREATED'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50'
            }`}
            onClick={() => setTransferDrillFilter((current) => (current === 'STALE_CREATED' ? 'NONE' : 'STALE_CREATED'))}
            type="button"
          >
            Stale CREATED Transfers ({staleCreatedTransfers.length})
          </button>
          <button
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              transferDrillFilter === 'STALE_APPROVED'
                ? 'bg-sky-600 text-white'
                : 'bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50'
            }`}
            onClick={() => setTransferDrillFilter((current) => (current === 'STALE_APPROVED' ? 'NONE' : 'STALE_APPROVED'))}
            type="button"
          >
            Stale APPROVED Transfers ({staleApprovedTransfers.length})
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          Stale threshold: {STALE_TRANSFER_MINUTES} minutes (based on transfer create/last-update time).
        </p>
      </section>

      {transferDrillFilter !== 'NONE' ? (
        <section className="mt-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {transferDrillFilter === 'STALE_CREATED' ? 'Stale CREATED Transfers' : 'Stale APPROVED Transfers'}
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="pb-2 pr-3">Transfer ID</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Mode</th>
                  <th className="pb-2 pr-3">From</th>
                  <th className="pb-2 pr-3">To</th>
                  <th className="pb-2 pr-3">Updated</th>
                  <th className="pb-2">Age</th>
                  <th className="pb-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {drilledTransferRows.map((row) => (
                  <tr className="border-t border-slate-100 dark:border-slate-700" key={row.id}>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-700 dark:text-slate-200">{row.id}</td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{row.status}</td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{row.transfer_mode ?? 'GENERAL'}</td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{row.source_location_id}</td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{row.destination_location_id}</td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{row.updated_at}</td>
                    <td className="py-2 font-semibold text-amber-700 dark:text-amber-300">
                      {transferAgeMinutes(row)} min
                    </td>
                    <td className="py-2 text-right">
                      <a
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        href={transferHref({
                          transferId: row.id,
                          status: row.status,
                          transferMode: row.transfer_mode ?? 'GENERAL'
                        })}
                      >
                        Open Transfer
                      </a>
                    </td>
                  </tr>
                ))}
                {drilledTransferRows.length === 0 ? (
                  <tr>
                    <td className="py-3 text-slate-500 dark:text-slate-400" colSpan={8}>
                      No stale transfers in this lifecycle stage.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      ) : null}

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="text-left text-xs uppercase text-slate-500 dark:text-slate-400">
              <tr>
                <th className="pb-2 pr-3">Created</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3">Entity</th>
                <th className="pb-2 pr-3">Outbox ID</th>
                <th className="pb-2 pr-3">Reason</th>
                <th className="pb-2 pr-3">Payload</th>
                <th className="pb-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr className="border-t border-slate-100 dark:border-slate-700" key={row.id}>
                  <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{row.created_at}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.status === 'OPEN'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{row.entity}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-600 dark:text-slate-300">{row.outbox_id}</td>
                  <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{row.reason}</td>
                  <td className="py-2 pr-3">
                    <button
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      onClick={() => setSelected(row)}
                      type="button"
                    >
                      Preview
                    </button>
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      {extractTransferIdFromReview(row) ? (
                        <a
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          href={transferHref({
                            transferId: extractTransferIdFromReview(row),
                            status: row.entity.trim().toLowerCase() === 'transfer' ? 'CREATED' : null
                          })}
                        >
                          Open Transfer
                        </a>
                      ) : null}
                      {row.status === 'OPEN' ? (
                        <button
                          className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                          disabled={resolvingId === row.id}
                          onClick={() => void resolveReview(row)}
                          type="button"
                        >
                          {resolvingId === row.id ? 'Resolving...' : 'Resolve'}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500 dark:text-slate-400">Resolved</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="py-3 text-slate-500 dark:text-slate-400" colSpan={7}>
                    No sync review rows for this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 md:hidden">
          {filteredRows.map((row) => (
            <article className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/60" key={row.id}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{row.entity}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    row.status === 'OPEN'
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  }`}
                >
                  {row.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{row.created_at}</p>
              <p className="mt-2 text-xs text-slate-700 dark:text-slate-200">{row.reason}</p>
              <p className="mt-1 font-mono text-[10px] text-slate-500 dark:text-slate-400">{row.outbox_id}</p>
              <div className="mt-3 flex gap-2">
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                  onClick={() => setSelected(row)}
                  type="button"
                >
                  Preview
                </button>
                {extractTransferIdFromReview(row) ? (
                  <a
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                    href={transferHref({
                      transferId: extractTransferIdFromReview(row),
                      status: row.entity.trim().toLowerCase() === 'transfer' ? 'CREATED' : null
                    })}
                  >
                    Open Transfer
                  </a>
                ) : null}
                {row.status === 'OPEN' ? (
                  <button
                    className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-60"
                    disabled={resolvingId === row.id}
                    onClick={() => void resolveReview(row)}
                    type="button"
                  >
                    {resolvingId === row.id ? 'Resolving...' : 'Resolve'}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
          {filteredRows.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No sync review rows for this filter.</p> : null}
        </div>
      </section>

      {selected ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-3 md:items-center">
          <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Payload Preview</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selected.entity} | {selected.status} | {selected.id}
                </p>
              </div>
              <button
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                onClick={() => setSelected(null)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Resolution Note
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-brandPrimary dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  onChange={(event) => setResolution(event.target.value)}
                  value={resolution}
                />
              </label>
              <div className="flex items-end justify-end">
                {selected.status === 'OPEN' ? (
                  <button
                    className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                    disabled={resolvingId === selected.id}
                    onClick={() => void resolveReview(selected)}
                    type="button"
                  >
                    {resolvingId === selected.id ? 'Resolving...' : 'Resolve This Review'}
                  </button>
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">This review is already resolved.</span>
                )}
              </div>
            </div>

            <pre className="mt-3 max-h-[52vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              {previewPayload}
            </pre>
          </div>
        </div>
      ) : null}
    </main>
  );
}
