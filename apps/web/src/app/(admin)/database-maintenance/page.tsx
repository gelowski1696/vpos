'use client';

import { useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';

type BackupPayloadSummary = {
  tableCount: number;
  rowCount: number;
};

type BackupPayload = {
  format: 'VPOS_TENANT_DB_BACKUP_V1';
  createdAt: string;
  companyId: string;
  companyCode: string | null;
  companyName: string | null;
  datastoreMode: 'SHARED_DB' | 'DEDICATED_DB';
  summary: BackupPayloadSummary;
};

type BackupResponse = {
  backupId: string;
  fileName: string;
  payload: BackupPayload;
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

function downloadJsonFile(fileName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function DatabaseMaintenancePage(): JSX.Element {
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreFileName, setRestoreFileName] = useState('');
  const [restorePayload, setRestorePayload] = useState<unknown>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<BackupResponse | null>(null);
  const [lastRestore, setLastRestore] = useState<RestoreResponse | null>(null);

  const restorePreview = useMemo(() => {
    if (!restorePayload || typeof restorePayload !== 'object' || Array.isArray(restorePayload)) {
      return null;
    }
    const record = restorePayload as Record<string, unknown>;
    const summary = (record.summary ?? {}) as Record<string, unknown>;
    return {
      companyCode:
        typeof record.companyCode === 'string' && record.companyCode.trim()
          ? record.companyCode.trim()
          : '-',
      companyName:
        typeof record.companyName === 'string' && record.companyName.trim()
          ? record.companyName.trim()
          : '-',
      createdAt:
        typeof record.createdAt === 'string' && record.createdAt.trim()
          ? record.createdAt
          : '-',
      tableCount: Number(summary.tableCount ?? 0),
      rowCount: Number(summary.rowCount ?? 0),
      format: String(record.format ?? '-')
    };
  }, [restorePayload]);

  async function handleDownloadBackup(): Promise<void> {
    setBackupLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiRequest<BackupResponse>('/database-maintenance/backup');
      setLastBackup(response);
      downloadJsonFile(response.fileName, response.payload);
      setSuccess(
        `Backup downloaded: ${response.fileName} (${response.payload.summary.tableCount} tables, ${response.payload.summary.rowCount} rows).`
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Failed to create backup.'
      );
    } finally {
      setBackupLoading(false);
    }
  }

  async function handleFileSelection(
    event: React.ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const file = event.target.files?.[0];
    setError(null);
    setSuccess(null);
    setLastRestore(null);
    if (!file) {
      setRestoreFileName('');
      setRestorePayload(null);
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      setRestoreFileName(file.name);
      setRestorePayload(parsed);
    } catch {
      setRestoreFileName(file.name);
      setRestorePayload(null);
      setError('Selected file is not a valid backup JSON.');
    }
  }

  async function handleRestore(): Promise<void> {
    if (!restorePayload) {
      setError('Choose a backup file first.');
      return;
    }
    setRestoreLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await apiRequest<RestoreResponse>('/database-maintenance/restore', {
        method: 'POST',
        body: {
          payload: restorePayload,
          confirmation: restoreConfirmation.trim().toUpperCase()
        }
      });
      setLastRestore(result);
      setSuccess(
        `Restore completed: ${result.tablesRestored} tables, ${result.rowsInserted} inserted, ${result.rowsDeleted} cleared.`
      );
      setRestoreConfirmation('');
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Restore failed.'
      );
    } finally {
      setRestoreLoading(false);
    }
  }

  return (
    <main className="space-y-5" data-tour="database-maintenance-root">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
        <h1 className="text-2xl font-bold text-brandPrimary">Database Backup and Restore</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Download a tenant backup file, then restore from a previous backup when needed.
        </p>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Create Backup</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            This downloads a full tenant backup file in JSON format.
          </p>
          <div className="mt-4">
            <button
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
              disabled={backupLoading}
              onClick={() => void handleDownloadBackup()}
              type="button"
            >
              {backupLoading ? 'Preparing Backup...' : 'Download Backup'}
            </button>
          </div>
          {lastBackup ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <p>
                <strong>File:</strong> {lastBackup.fileName}
              </p>
              <p>
                <strong>Created:</strong> {formatDateTime(lastBackup.payload.createdAt)}
              </p>
              <p>
                <strong>Rows:</strong> {lastBackup.payload.summary.rowCount}
              </p>
              <p>
                <strong>Tables:</strong> {lastBackup.payload.summary.tableCount}
              </p>
            </div>
          ) : null}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900/70">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Restore Backup</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Choose a backup file and confirm restore. This replaces current tenant records.
          </p>

          <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Backup File
            <input
              accept=".json,application/json"
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => void handleFileSelection(event)}
              type="file"
            />
          </label>

          {restoreFileName ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Selected file: {restoreFileName}
            </p>
          ) : null}

          {restorePreview ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <p>
                <strong>Format:</strong> {restorePreview.format}
              </p>
              <p>
                <strong>Company:</strong> {restorePreview.companyName} ({restorePreview.companyCode})
              </p>
              <p>
                <strong>Created:</strong> {formatDateTime(restorePreview.createdAt)}
              </p>
              <p>
                <strong>Rows:</strong> {restorePreview.rowCount}
              </p>
              <p>
                <strong>Tables:</strong> {restorePreview.tableCount}
              </p>
            </div>
          ) : null}

          <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Type RESTORE to confirm
            <input
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              onChange={(event) => setRestoreConfirmation(event.target.value)}
              placeholder="RESTORE"
              value={restoreConfirmation}
            />
          </label>

          <div className="mt-4">
            <button
              className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
              disabled={restoreLoading}
              onClick={() => void handleRestore()}
              type="button"
            >
              {restoreLoading ? 'Restoring...' : 'Run Restore'}
            </button>
          </div>

          {lastRestore ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <p>
                <strong>Restored At:</strong> {formatDateTime(lastRestore.restoredAt)}
              </p>
              <p>
                <strong>Tables:</strong> {lastRestore.tablesRestored}
              </p>
              <p>
                <strong>Rows Inserted:</strong> {lastRestore.rowsInserted}
              </p>
              <p>
                <strong>Rows Cleared:</strong> {lastRestore.rowsDeleted}
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
