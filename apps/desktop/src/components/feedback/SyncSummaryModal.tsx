import { useEffect, useMemo, useRef } from 'react';
import type { DesktopSyncSummary, DesktopSyncSummaryLine } from '@vpos/desktop-core';

type Props = {
  summary: DesktopSyncSummary;
  message: string;
  onClose: () => void;
};

function total(lines: DesktopSyncSummaryLine[]): number {
  return lines.reduce((sum, line) => sum + line.count, 0);
}

function SummarySection({
  title,
  lines,
  tone
}: {
  title: string;
  lines: DesktopSyncSummaryLine[];
  tone: 'success' | 'warning';
}): JSX.Element {
  const sectionTotal = total(lines);
  const success = tone === 'success';

  return (
    <section
      className={[
        'min-w-0 rounded-[20px] border p-4',
        success
          ? 'border-emerald-200 bg-emerald-50/80'
          : 'border-amber-200 bg-amber-50/80'
      ].join(' ')}
      aria-label={`${title} records`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className={success ? 'm-0 text-base font-extrabold text-emerald-900' : 'm-0 text-base font-extrabold text-amber-950'}>
          {title} ({sectionTotal})
        </h3>
        <span
          className={[
            'grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-black',
            success ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-amber-950'
          ].join(' ')}
          aria-hidden="true"
        >
          {success ? '✓' : '!'}
        </span>
      </div>

      {lines.length > 0 ? (
        <dl className="m-0 grid gap-2">
          {lines.map((line) => (
            <div
              key={line.key}
              className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/80 bg-white/90 px-3 py-2.5 shadow-sm"
            >
              <dt className="min-w-0 truncate text-sm font-semibold text-slate-700">{line.label}</dt>
              <dd className="m-0 shrink-0 text-base font-black tabular-nums text-slate-950">{line.count}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="m-0 rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-4 text-sm text-slate-600">
          {success ? 'No queued records were synced in this run.' : 'No records need attention.'}
        </p>
      )}
    </section>
  );
}

export function SyncSummaryModal({ summary, message, onClose }: Props): JSX.Element {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);
  const syncedTotal = useMemo(() => total(summary.synced), [summary.synced]);
  const unsyncedTotal = useMemo(() => total(summary.unsynced), [summary.unsynced]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'Tab') {
        const first = closeButtonRef.current;
        const last = doneButtonRef.current;
        if (!first || !last) {
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-4 py-8 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_30px_90px_-40px_rgba(15,23,42,0.5)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-summary-title"
        aria-describedby="sync-summary-message"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="m-0 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Sync completed</p>
            <h2 id="sync-summary-title" className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">
              Sync Summary
            </h2>
            <p id="sync-summary-message" className="mt-1 text-sm leading-5 text-slate-600">
              {message}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            className="secondary-btn mini-btn modal-close-icon-btn"
            type="button"
            onClick={onClose}
            aria-label="Close sync summary"
            title="Close"
          >
            <span aria-hidden="true">X</span>
          </button>
        </header>

        <div className="grid max-h-[65vh] gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          <SummarySection title="Synced" lines={summary.synced} tone="success" />
          <SummarySection title="Unsynced" lines={summary.unsynced} tone="warning" />
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <p className="m-0 text-sm font-semibold text-slate-600">
            {syncedTotal} synced · {unsyncedTotal} unsynced
          </p>
          <button ref={doneButtonRef} className="primary-btn min-w-[110px]" type="button" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
