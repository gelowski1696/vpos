'use client';

type TenantOperationalResetDialogProps = {
  open: boolean;
  companyCode: string;
  companyName: string;
  confirmationValue: string;
  notesValue: string;
  saving: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onConfirmationChange: (value: string) => void;
  onNotesChange: (value: string) => void;
};

export function TenantOperationalResetDialog({
  open,
  companyCode,
  companyName,
  confirmationValue,
  notesValue,
  saving,
  error,
  onClose,
  onConfirm,
  onConfirmationChange,
  onNotesChange
}: TenantOperationalResetDialogProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  const canSubmit = confirmationValue.trim().toUpperCase() === companyCode.trim().toUpperCase();

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/55 p-4">
      <section className="w-full max-w-3xl rounded-3xl border border-rose-200 bg-white shadow-2xl dark:border-rose-900/60 dark:bg-slate-900">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="space-y-1">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-300">
              Destructive Action
            </p>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Reset Tenant Data</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {companyName} ({companyCode})
            </p>
          </div>
          <button
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <div className="space-y-5 px-5 py-5">
          <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-100">
            This will delete transactional history, inventory movements, shifts, and related operational rows for this tenant.
            Master data such as customers, items, branches, locations, users, and price lists will remain intact.
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">Optional notes</span>
              <textarea
                className="min-h-24 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-rose-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-rose-700"
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Add an audit note for why this tenant was reset..."
                value={notesValue}
              />
            </label>

            <label className="text-sm md:col-span-2">
              <span className="mb-1 block font-medium text-slate-700 dark:text-slate-200">
                Type <span className="font-semibold text-rose-600">{companyCode}</span> to confirm
              </span>
              <input
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-rose-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-rose-700"
                onChange={(event) => onConfirmationChange(event.target.value)}
                placeholder={companyCode}
                value={confirmationValue}
              />
            </label>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
          <button
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-rose-300"
            disabled={saving || !canSubmit}
            onClick={onConfirm}
            type="button"
          >
            {saving ? 'Resetting...' : 'Reset Data'}
          </button>
        </footer>
      </section>
    </div>
  );
}
