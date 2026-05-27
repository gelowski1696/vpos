'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';

type OnlineBackupRow = {
  id: string;
  label: string | null;
  createdAt: string;
  retentionMonths: 1 | 3 | 6;
  expiresAt: string;
  createdByUserId: string | null;
  createdByName: string | null;
  rowCount: number;
  tableCount: number;
  companyCode: string | null;
  companyName: string | null;
  datastoreMode: 'SHARED_DB' | 'DEDICATED_DB';
};

type RestoreResponse = {
  restoredAt: string;
  companyId: string;
  tablesRestored: number;
  rowsDeleted: number;
  rowsInserted: number;
  datastoreMode: 'SHARED_DB' | 'DEDICATED_DB';
};

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export default function DatabaseMaintenancePage(): JSX.Element {
  const [backups, setBackups] = useState<OnlineBackupRow[]>([]);
  const [selectedBackupId, setSelectedBackupId] = useState('');
  const [backupLabel, setBackupLabel] = useState('');
  const [retentionMonths, setRetentionMonths] = useState<1 | 3 | 6>(3);
  const [backupLoading, setBackupLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreAcknowledge, setRestoreAcknowledge] = useState(false);
  const [lastRestore, setLastRestore] = useState<RestoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedBackup = useMemo(
    () => backups.find((row) => row.id === selectedBackupId) ?? null,
    [backups, selectedBackupId]
  );

  async function loadBackups(showLoading = true): Promise<void> {
    if (showLoading) {
      setListLoading(true);
    }
    try {
      const rows = await apiRequest<OnlineBackupRow[]>(
        '/database-maintenance/backups?limit=40'
      );
      setBackups(Array.isArray(rows) ? rows : []);
      if (!selectedBackupId && rows.length > 0) {
        setSelectedBackupId(rows[0].id);
      } else if (selectedBackupId && !rows.some((row) => row.id === selectedBackupId)) {
        setSelectedBackupId(rows[0]?.id ?? '');
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load online backups.'
      );
    } finally {
      if (showLoading) {
        setListLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadBackups(true);
  }, []);

  async function handleCreateBackup(): Promise<void> {
    setBackupLoading(true);
    setError(null);
    setSuccess(null);
    setLastRestore(null);
    try {
      const created = await apiRequest<OnlineBackupRow>('/database-maintenance/backups', {
        method: 'POST',
        body: {
          label: backupLabel.trim() || undefined,
          retentionMonths
        }
      });
      setBackupLabel('');
      await loadBackups(false);
      setSelectedBackupId(created.id);
      setSuccess('Online backup saved successfully.');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not save online backup.'
      );
    } finally {
      setBackupLoading(false);
    }
  }

  async function handleDeleteBackup(): Promise<void> {
    if (!selectedBackupId) {
      setError('Please select a backup copy first.');
      return;
    }
    const accepted = window.confirm('Delete this selected backup copy?');
    if (!accepted) {
      return;
    }

    setDeleteLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest<{ deleted: boolean; backup: OnlineBackupRow }>(
        `/database-maintenance/backups/${selectedBackupId}`,
        {
          method: 'DELETE'
        }
      );
      await loadBackups(false);
      setSuccess('Selected backup deleted successfully.');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Could not delete selected backup.'
      );
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleRestore(): Promise<void> {
    if (!selectedBackupId) {
      setError('Please select a backup copy first.');
      return;
    }
    if (!restoreAcknowledge) {
      setError('Please confirm before restoring.');
      return;
    }
    setRestoreLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await apiRequest<RestoreResponse>('/database-maintenance/restore', {
        method: 'POST',
        body: {
          backupId: selectedBackupId,
          confirmation: 'RESTORE'
        }
      });
      setLastRestore(result);
      setRestoreAcknowledge(false);
      setSuccess('Restore completed successfully.');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Restore did not finish.'
      );
    } finally {
      setRestoreLoading(false);
    }
  }

  return (
    <main className="space-y-5" data-tour="database-maintenance-root">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
        <h1 className="text-2xl font-bold text-brandPrimary">Online Backup and Restore</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Backups are saved securely online. You can restore from any saved copy below.
        </p>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Save New Online Backup</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            This creates a full online snapshot of your current records.
          </p>

          <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Backup Name (optional)
            <input
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setBackupLabel(event.target.value)}
              placeholder="Example: Before month-end closing"
              value={backupLabel}
            />
          </label>

          <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Auto Delete After
            <select
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10);
                if (value === 1 || value === 3 || value === 6) {
                  setRetentionMonths(value);
                }
              }}
              value={String(retentionMonths)}
            >
              <option value="1">1 month</option>
              <option value="3">3 months</option>
              <option value="6">6 months</option>
            </select>
          </label>

          <div className="mt-4">
            <button
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
              disabled={backupLoading}
              onClick={() => void handleCreateBackup()}
              type="button"
            >
              {backupLoading ? 'Saving Backup...' : 'Save Backup Online'}
            </button>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Restore From Online Backup</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Choose one backup copy, then confirm restore.
          </p>

          {listLoading ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading online backups...</p>
          ) : backups.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              No online backups yet. Save one first.
            </p>
          ) : (
            <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {backups.map((backup) => (
                <button
                  key={backup.id}
                  type="button"
                  onClick={() => setSelectedBackupId(backup.id)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    selectedBackupId === backup.id
                      ? 'border-sky-400 bg-sky-50 dark:border-sky-500 dark:bg-sky-900/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900/60 dark:hover:border-slate-600'
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {backup.label?.trim() || 'Untitled Backup'}
                  </p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Saved {formatDateTime(backup.createdAt)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {backup.rowCount} records | {backup.tableCount} sections
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Auto-delete: {formatDateTime(backup.expiresAt)}
                  </p>
                </button>
              ))}
            </div>
          )}

          {selectedBackup ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <p>
                <strong>Selected:</strong> {selectedBackup.label?.trim() || 'Untitled Backup'}
              </p>
              <p>
                <strong>Business:</strong> {selectedBackup.companyName ?? '-'} ({selectedBackup.companyCode ?? '-'})
              </p>
              <p>
                <strong>Saved:</strong> {formatDateTime(selectedBackup.createdAt)}
              </p>
              <p>
                <strong>Retention:</strong> {selectedBackup.retentionMonths} month(s)
              </p>
              <p>
                <strong>Auto-delete:</strong> {formatDateTime(selectedBackup.expiresAt)}
              </p>
              <p>
                <strong>Created By:</strong> {selectedBackup.createdByName ?? 'System'}
              </p>
            </div>
          ) : null}

          <label className="mt-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
            <input
              checked={restoreAcknowledge}
              className="mt-0.5 h-4 w-4"
              onChange={(event) => setRestoreAcknowledge(event.target.checked)}
              type="checkbox"
            />
            <span>I understand this restore will replace my current records.</span>
          </label>

          <div className="mt-4">
            <button
              className="rounded-lg border border-rose-400 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-600 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-950/40"
              disabled={deleteLoading || !selectedBackupId}
              onClick={() => void handleDeleteBackup()}
              type="button"
            >
              {deleteLoading ? 'Deleting...' : 'Delete Selected Backup'}
            </button>
          </div>

          <div className="mt-3">
            <button
              className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
              disabled={restoreLoading || deleteLoading || !selectedBackupId}
              onClick={() => void handleRestore()}
              type="button"
            >
              {restoreLoading ? 'Restoring...' : 'Restore Selected Backup'}
            </button>
          </div>

          {lastRestore ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <p>
                <strong>Restored:</strong> {formatDateTime(lastRestore.restoredAt)}
              </p>
              <p>
                <strong>Records Restored:</strong> {lastRestore.rowsInserted}
              </p>
              <p>
                <strong>Old Records Replaced:</strong> {lastRestore.rowsDeleted}
              </p>
            </div>
          ) : null}
        </article>
      </section>

      {error ? (
        <section className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </section>
      ) : null}

      {success ? (
        <section className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          {success}
        </section>
      ) : null}
    </main>
  );
}
