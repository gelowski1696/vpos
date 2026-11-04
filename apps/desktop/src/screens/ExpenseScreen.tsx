import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import { SearchField } from '../components/inputs/SearchField';
import type { DesktopAppState, DesktopExpenseRecord, DesktopOption } from '../db/schema';
import { desktopExpenseService } from '../services/desktop-expense.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopShiftService } from '../services/desktop-shift.service';
import { useDesktopTutorialTarget } from '../tutorial/tutorial-provider';
import { parseNonNegativeDecimalInput, sanitizeDecimalInput } from './PosScreen';

type Props = {
  appState: DesktopAppState;
  onOutboxChanged?: () => Promise<void> | void;
};

type ExpenseDirectionFilter = 'all' | 'in' | 'out';
type ExpenseSyncFilter = 'all' | 'pending' | 'failed' | 'synced';
const HISTORY_PAGE_SIZE = 20;

type DraftAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewDataUrl: string;
  createdAt: string;
};

type PettyCashEntryModalProps = {
  saving: boolean;
  selectedCategory: DesktopOption | null;
  categoriesAvailable: boolean;
  direction: 'IN' | 'OUT';
  amount: string;
  notes: string;
  reference: string;
  quickAmountOptions: string[];
  allowPettyCashAttachments: boolean;
  draftAttachments: DraftAttachment[];
  attachmentInputRef: React.RefObject<HTMLInputElement>;
  onClose: () => void;
  onOpenCategory: () => void;
  onDirectionChange: (direction: 'IN' | 'OUT') => void;
  onAmountChange: (value: string) => void;
  onQuickAmount: (quick: string) => void;
  onNotesChange: (value: string) => void;
  onReferenceChange: (value: string) => void;
  onAddAttachment: () => void;
  onRemoveAttachment: (id: string) => void;
  onAttachmentInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
};

type ExpenseDetailModalProps = {
  entry: DesktopExpenseRecord;
  onClose: () => void;
};

function ExpenseGlyph({
  children,
  className = ''
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={`inline-flex h-10 w-10 items-center justify-center rounded-[14px] ${className}`.trim()}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

function ExpenseIcon({
  path,
  className = ''
}: {
  path: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-[18px] w-[18px] ${className}`.trim()}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

const ALLOWED_PETTY_CASH_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]);

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function fmtDate(value: string): string {
  return new Date(value).toLocaleString();
}

function fmtAttachmentSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return '0 KB';
  }
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function sanitizeExpenseAmountInput(value: string): string {
  return sanitizeDecimalInput(value);
}

const screenStackClass = 'space-y-5';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const modalBackdropClass = 'fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 py-8 backdrop-blur-sm';
const modalCardClass =
  'w-full max-w-3xl rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.5)]';
const entryModalCardClass = 'expense-entry-modal-shell desktop-modal-card desktop-modal-card--action max-w-[820px]';

function ExpenseListMetaIcon({ kind }: { kind: 'shift' | 'code' | 'note' | 'attachment' }): JSX.Element {
  if (kind === 'shift') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="sales-list-card-meta-icon">
        <path d="M5.5 4.5h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14V6a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path d="M6.5 3v3M13.5 3v3M4 8.5h12" />
      </svg>
    );
  }
  if (kind === 'code') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="sales-list-card-meta-icon">
        <path d="M4.5 6.5 8 10l-3.5 3.5" />
        <path d="M11.5 6.5 15 10l-3.5 3.5" />
      </svg>
    );
  }
  if (kind === 'attachment') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="sales-list-card-meta-icon">
        <path d="M7.5 10.5V7.25a2.75 2.75 0 1 1 5.5 0v5.5a4.25 4.25 0 0 1-8.5 0V6.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="sales-list-card-meta-icon">
      <path d="M5 6h10" />
      <path d="M5 10h10" />
      <path d="M5 14h6" />
    </svg>
  );
}

function ExpensePageSymbol({
  kind,
  className = ''
}: {
  kind:
    | 'petty-cash'
    | 'cash-in'
    | 'cash-out'
    | 'net'
    | 'shift'
    | 'pending'
    | 'local'
    | 'branch'
    | 'location'
    | 'cashier'
    | 'status'
    | 'calendar'
    | 'info'
    | 'plus';
  className?: string;
}): JSX.Element {
  let path: ReactNode;
  if (kind === 'petty-cash') {
    path = (
      <>
        <path d="M8 4h8" />
        <path d="M7 8h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
        <path d="M12 11v4" />
        <path d="M10 13h4" />
        <path d="M9.5 4a2.5 2.5 0 0 1 5 0" />
      </>
    );
  } else if (kind === 'cash-in') {
    path = (
      <>
        <path d="M12 19V5" />
        <path d="M7 10l5-5 5 5" />
      </>
    );
  } else if (kind === 'cash-out') {
    path = (
      <>
        <path d="M12 5v14" />
        <path d="M7 14l5 5 5-5" />
      </>
    );
  } else if (kind === 'net') {
    path = (
      <>
        <path d="M4 7.5h16" />
        <path d="M6 7.5V6A2 2 0 0 1 8 4h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7.5Z" />
        <path d="M16 12.5h.01" />
      </>
    );
  } else if (kind === 'shift' || kind === 'calendar') {
    path = (
      <>
        <path d="M5.5 4.5h13a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18V6a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path d="M7.5 3v3M16.5 3v3M4 9h16" />
      </>
    );
  } else if (kind === 'pending') {
    path = (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2.5" />
      </>
    );
  } else if (kind === 'local') {
    path = (
      <>
        <path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>
    );
  } else if (kind === 'branch') {
    path = (
      <>
        <path d="M6 20V6l6-2 6 2v14" />
        <path d="M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" />
      </>
    );
  } else if (kind === 'location') {
    path = (
      <>
        <path d="M12 20s6-4.4 6-10a6 6 0 1 0-12 0c0 5.6 6 10 6 10Z" />
        <circle cx="12" cy="10" r="2.2" />
      </>
    );
  } else if (kind === 'cashier') {
    path = (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5 19a7 7 0 0 1 14 0" />
      </>
    );
  } else if (kind === 'status') {
    path = (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12 2.2 2.2L15.5 9.5" />
      </>
    );
  } else if (kind === 'info') {
    path = (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 10.5v5" />
        <path d="M12 8h.01" />
      </>
    );
  } else {
    path = (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    );
  }

  return <ExpenseIcon path={path} className={className} />;
}

function expenseStatusClass(syncStatus: DesktopExpenseRecord['syncStatus']): string {
  if (syncStatus === 'failed') {
    return 'is-failed';
  }
  if (syncStatus === 'synced') {
    return 'is-synced';
  }
  return 'is-pending';
}

function expenseStatusLabel(syncStatus: DesktopExpenseRecord['syncStatus']): string {
  if (syncStatus === 'failed') {
    return 'Needs Retry';
  }
  if (syncStatus === 'synced') {
    return 'Synced';
  }
  return 'Pending';
}

function expenseMetricTone(kind: 'in' | 'out' | 'net' | 'shift' | 'pending' | 'local'): {
  shell: string;
  icon: string;
  line: string;
  label: string;
} {
  if (kind === 'in') {
    return {
      shell: 'border-[rgba(182,226,194,0.68)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,252,248,0.98))]',
      icon: 'border-[rgba(182,226,194,0.72)] bg-[rgba(238,250,242,0.98)] text-[#1f9b4d]',
      line: 'from-[#38b35a] to-[#bde7c7]',
      label: 'text-[#179244]'
    };
  }
  if (kind === 'out') {
    return {
      shell: 'border-[rgba(247,196,201,0.72)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(255,248,249,0.98))]',
      icon: 'border-[rgba(247,196,201,0.78)] bg-[rgba(255,241,243,0.98)] text-[#ea3434]',
      line: 'from-[#ff5555] to-[#ffd2d2]',
      label: 'text-[#ea3434]'
    };
  }
  if (kind === 'pending') {
    return {
      shell: 'border-[rgba(251,214,166,0.72)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(255,251,246,0.98))]',
      icon: 'border-[rgba(251,214,166,0.78)] bg-[rgba(255,246,236,0.98)] text-[#ea7d0a]',
      line: 'from-[#f59f0b] to-[#ffe0b2]',
      label: 'text-[#ea7d0a]'
    };
  }
  if (kind === 'shift') {
    return {
      shell: 'border-[rgba(218,198,255,0.72)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(249,246,255,0.98))]',
      icon: 'border-[rgba(218,198,255,0.78)] bg-[rgba(245,239,255,0.98)] text-[#6f3bd1]',
      line: 'from-[#7c4dff] to-[#ddccff]',
      label: 'text-[#5f32c9]'
    };
  }
  if (kind === 'local') {
    return {
      shell: 'border-[rgba(196,220,255,0.72)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.98))]',
      icon: 'border-[rgba(196,220,255,0.78)] bg-[rgba(238,245,255,0.98)] text-[var(--accent-strong)]',
      line: 'from-[#3b82f6] to-[#c8deff]',
      label: 'text-[var(--accent-strong)]'
    };
  }
  return {
    shell: 'border-[rgba(196,220,255,0.72)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.98))]',
    icon: 'border-[rgba(196,220,255,0.78)] bg-[rgba(238,245,255,0.98)] text-[var(--accent-strong)]',
    line: 'from-[#4f8df6] to-[#c8deff]',
    label: 'text-[var(--accent-strong)]'
  };
}

export function PettyCashEntryModal({
  saving,
  selectedCategory,
  categoriesAvailable,
  direction,
  amount,
  notes,
  reference,
  quickAmountOptions,
  allowPettyCashAttachments,
  draftAttachments,
  attachmentInputRef,
  onClose,
  onOpenCategory,
  onDirectionChange,
  onAmountChange,
  onQuickAmount,
  onNotesChange,
  onReferenceChange,
  onAddAttachment,
  onRemoveAttachment,
  onAttachmentInputChange,
  onSubmit
}: PettyCashEntryModalProps): JSX.Element {
  const draftDateTime = useMemo(() => new Date(), []);

  return (
    <div className={entryModalCardClass} onClick={(event) => event.stopPropagation()}>
      <input
        ref={attachmentInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/jpg"
        multiple
        onChange={onAttachmentInputChange}
        style={{ display: 'none' }}
      />

      <div className="expense-entry-modal-header desktop-modal-header shrink-0 px-5 py-5 sm:px-7 sm:py-6 lg:px-8 lg:py-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <ExpenseGlyph className="h-14 w-14 rounded-[20px] border border-[rgba(188,210,234,0.52)] bg-[rgba(245,249,253,0.96)] text-[var(--accent-strong)] shadow-[0_10px_22px_rgba(17,40,58,0.04)]">
              <ExpensePageSymbol kind="petty-cash" className="h-[24px] w-[24px]" />
            </ExpenseGlyph>
            <div className="min-w-0">
              <h3 className="mt-1 text-[1.28rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.42rem]">
                Add Petty Cash Record
              </h3>
              <p className="mt-2 max-w-[36rem] text-[0.9rem] leading-6 text-[var(--muted)]">
                Record cash transaction for this shift.
              </p>
            </div>
          </div>
          <button
            className="secondary-btn mini-btn modal-close-icon-btn h-11 w-11 shrink-0 text-[var(--text-strong)] sm:h-12 sm:w-12"
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            title="Close"
          >
            <ExpenseIcon
              path={
                <>
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </>
              }
            />
          </button>
        </div>
      </div>

      <div className="expense-entry-modal-body desktop-modal-body min-h-0 overflow-y-auto px-5 py-5 sm:px-7 sm:py-7 lg:px-8 lg:py-8">
        <div className="grid gap-6">
          <section className="grid gap-3 md:grid-cols-2">
            {([
              {
                value: 'IN' as const,
                label: 'Cash In',
                subtitle: 'Cash replenishment',
                activeClass:
                  'border-[rgba(96,146,108,0.5)] bg-[rgba(236,248,238,0.92)] shadow-[0_12px_26px_rgba(57,167,95,0.08)]',
                iconShell: 'border-[rgba(182,226,194,0.72)] bg-[rgba(238,250,242,0.98)] text-[#1f9b4d]',
                iconPath: (
                  <>
                    <path d="M12 19V5" />
                    <path d="M7 10l5-5 5 5" />
                  </>
                )
              },
              {
                value: 'OUT' as const,
                label: 'Cash Out',
                subtitle: 'Expense / Withdrawal',
                activeClass:
                  'border-[rgba(197,95,77,0.42)] bg-[rgba(255,239,237,0.92)] shadow-[0_12px_26px_rgba(212,84,84,0.08)]',
                iconShell: 'border-[rgba(247,196,201,0.78)] bg-[rgba(255,241,243,0.98)] text-[#ea3434]',
                iconPath: (
                  <>
                    <path d="M12 5v14" />
                    <path d="M7 14l5 5 5-5" />
                  </>
                )
              }
            ]).map((option) => {
              const active = direction === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`grid min-h-[92px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-[22px] border px-5 py-4 text-left transition ${
                    active
                      ? option.activeClass
                      : 'border-[var(--border)] bg-[rgba(255,255,255,0.96)] hover:border-[rgba(25,118,210,0.24)] hover:bg-[rgba(248,251,255,0.98)]'
                  }`}
                  onClick={() => onDirectionChange(option.value)}
                >
                  <span className={`grid h-[56px] w-[56px] place-items-center rounded-full border ${option.iconShell}`}>
                    <ExpenseIcon path={option.iconPath} className="h-[24px] w-[24px]" />
                  </span>
                  <span className="min-w-0">
                    <strong className="block text-[0.98rem] font-bold text-[var(--text-strong)]">{option.label}</strong>
                    <span className="mt-1 block text-[0.84rem] text-[var(--muted)]">{option.subtitle}</span>
                  </span>
                  {active ? (
                    <span className="grid h-[28px] w-[28px] place-items-center rounded-full bg-[#25aa52] text-white">
                      <ExpenseIcon path={<path d="m7.5 12 2.2 2.2L15 8.8" />} className="h-[14px] w-[14px]" />
                    </span>
                  ) : (
                    <span className="h-[28px] w-[28px]" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-[0.86rem] font-bold text-[var(--text-strong)]">Amount</span>
              <span className="grid min-h-[64px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border border-[var(--border)] bg-[rgba(255,255,255,0.96)] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_6px_16px_rgba(17,40,58,0.04)]">
                <span className="inline-flex min-h-[42px] items-center rounded-[14px] bg-[rgba(240,246,255,0.96)] px-4 text-[0.96rem] font-semibold text-[var(--text-strong)]">
                  PHP
                </span>
                <input
                  value={amount}
                  onChange={(event) => onAmountChange(sanitizeExpenseAmountInput(event.target.value))}
                  placeholder="0.00"
                  inputMode="decimal"
                  className="min-w-0 border-0 bg-transparent p-0 text-[1.42rem] font-extrabold tracking-[-0.03em] text-[var(--text-strong)] outline-none placeholder:text-[var(--muted)]"
                />
                <span className="grid gap-1 text-[var(--muted)]">
                  <ExpenseIcon path={<path d="m8 14 4-4 4 4" />} className="h-[14px] w-[14px]" />
                  <ExpenseIcon path={<path d="m8 10 4 4 4-4" />} className="h-[14px] w-[14px]" />
                </span>
              </span>
            </label>

            <label className="grid gap-2">
              <span className="text-[0.86rem] font-bold text-[var(--text-strong)]">Date &amp; Time</span>
              <span className="grid min-h-[64px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border border-[var(--border)] bg-[rgba(255,255,255,0.96)] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_6px_16px_rgba(17,40,58,0.04)]">
                <ExpensePageSymbol kind="calendar" className="h-[20px] w-[20px] text-[var(--muted-strong)]" />
                <span className="truncate text-[0.94rem] font-medium text-[var(--text-strong)]">
                  {draftDateTime.toLocaleDateString()} • {draftDateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <ExpenseIcon path={<path d="m8 10 4 4 4-4" />} className="h-[16px] w-[16px] text-[var(--muted)]" />
              </span>
            </label>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-[0.86rem] font-bold text-[var(--text-strong)]">Category</span>
              <button
                className="grid min-h-[62px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border border-[var(--border)] bg-[rgba(255,255,255,0.96)] px-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_6px_16px_rgba(17,40,58,0.04)] transition hover:border-[rgba(25,118,210,0.24)] hover:bg-[rgba(248,251,255,0.98)]"
                type="button"
                onClick={onOpenCategory}
              >
                <span className="grid h-[40px] w-[40px] place-items-center rounded-[12px] bg-[rgba(240,246,255,0.96)] text-[var(--accent-strong)]">
                  <ExpenseIcon
                    path={
                      <>
                        <path d="M7 7h.01M12 7h.01M17 7h.01M7 12h.01M12 12h.01M17 12h.01M7 17h.01M12 17h.01M17 17h.01" />
                        <path d="M5 5h14v14H5z" />
                      </>
                    }
                    className="h-[18px] w-[18px]"
                  />
                </span>
                <span className="min-w-0">
                  <strong className="block truncate text-[0.94rem] font-medium text-[var(--text-strong)]">
                    {selectedCategory ? selectedCategory.label : categoriesAvailable ? 'Select category' : 'No category available'}
                  </strong>
                </span>
                <ExpenseIcon path={<path d="m8 10 4 4 4-4" />} className="h-[16px] w-[16px] text-[var(--muted)]" />
              </button>
            </label>

            <label className="grid gap-2">
              <span className="text-[0.86rem] font-bold text-[var(--text-strong)]">Payment Type</span>
              <span className="grid min-h-[62px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] border border-[var(--border)] bg-[rgba(255,255,255,0.96)] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_6px_16px_rgba(17,40,58,0.04)]">
                <span className="grid h-[40px] w-[40px] place-items-center rounded-[12px] bg-[rgba(240,246,255,0.96)] text-[var(--accent-strong)]">
                  <ExpenseIcon
                    path={
                      <>
                        <rect x="4" y="6" width="16" height="12" rx="2" />
                        <path d="M4 10h16" />
                        <path d="M8 14h2.5" />
                      </>
                    }
                    className="h-[18px] w-[18px]"
                  />
                </span>
                <span className="truncate text-[0.94rem] font-medium text-[var(--text-strong)]">Cash</span>
                <ExpenseIcon path={<path d="m8 10 4 4 4-4" />} className="h-[16px] w-[16px] text-[var(--muted)]" />
              </span>
            </label>
          </section>

          <section className="grid gap-2">
            <span className="text-[0.86rem] font-bold text-[var(--text-strong)]">Description <span className="text-rose-600">*</span></span>
            <label className="block">
              <span className="sr-only">Description</span>
              <textarea
                value={notes}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Describe why this petty cash record is being added."
                maxLength={255}
                className="min-h-[108px] w-full rounded-[18px] border border-[var(--border)] bg-[rgba(255,255,255,0.96)] px-4 py-4 text-[0.92rem] leading-7 text-[var(--text-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_6px_16px_rgba(17,40,58,0.04)] outline-none transition placeholder:text-[var(--muted)] focus:border-[rgba(25,118,210,0.5)]"
              />
            </label>
            <div className="text-right text-[0.76rem] text-[var(--muted)]">{notes.length}/255</div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
            <label className="grid gap-2">
              <span className="text-[0.86rem] font-bold text-[var(--text-strong)]">
                Reference <span className="font-medium text-[var(--muted)]">(Optional)</span>
              </span>
              <input
                value={reference}
                onChange={(event) => onReferenceChange(event.target.value)}
                placeholder="OR No. 12345"
                className="min-h-[60px] rounded-[18px] border border-[var(--border)] bg-[rgba(255,255,255,0.96)] px-4 text-[0.92rem] text-[var(--text-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_6px_16px_rgba(17,40,58,0.04)] outline-none transition placeholder:text-[var(--muted)] focus:border-[rgba(25,118,210,0.5)]"
              />
            </label>

            <div className="grid gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[0.86rem] font-bold text-[var(--text-strong)]">
                  Attachment <span className="font-medium text-[var(--muted)]">(Optional)</span>
                </span>
                <span className="text-[0.76rem] text-[var(--muted)]">
                  Up to 3 files (Max 5 MB each)
                </span>
              </div>
              <div className="rounded-[20px] border border-dashed border-[rgba(196,220,255,0.82)] bg-[rgba(248,251,255,0.72)] p-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => {
                    const attachment = draftAttachments[index] ?? null;
                    const canAddSlot = allowPettyCashAttachments && !attachment && draftAttachments.length < 3 && index === draftAttachments.length;
                    if (attachment) {
                      return (
                        <article
                          key={attachment.id}
                          className="relative overflow-hidden rounded-[16px] border border-[rgba(188,210,234,0.56)] bg-white p-2 shadow-[0_8px_18px_rgba(17,40,58,0.05)]"
                        >
                          <div className="aspect-[0.88] overflow-hidden rounded-[12px] bg-[rgba(240,246,255,0.82)]">
                            <img src={attachment.previewDataUrl} alt={attachment.fileName} className="h-full w-full object-cover" />
                          </div>
                          <button
                            className="absolute right-2 top-2 inline-grid h-7 w-7 place-items-center rounded-full bg-[#ef4444] text-white shadow-[0_8px_16px_rgba(239,68,68,0.24)]"
                            type="button"
                            onClick={() => onRemoveAttachment(attachment.id)}
                            aria-label={`Remove ${attachment.fileName}`}
                          >
                            <ExpenseIcon
                              path={
                                <>
                                  <path d="M6 6l12 12" />
                                  <path d="M18 6L6 18" />
                                </>
                              }
                              className="h-[12px] w-[12px]"
                            />
                          </button>
                          <div className="mt-2 text-center">
                            <div className="truncate text-[0.72rem] font-semibold text-[var(--text-strong)]">{attachment.fileName}</div>
                            <div className="mt-1 text-[0.68rem] text-[var(--muted)]">
                              {(attachment.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                            </div>
                          </div>
                        </article>
                      );
                    }

                    if (canAddSlot) {
                      return (
                        <button
                          key={`attachment-add-${index}`}
                          type="button"
                          onClick={onAddAttachment}
                          disabled={saving}
                          className="grid aspect-[0.88] place-items-center rounded-[16px] border border-dashed border-[rgba(140,182,223,0.56)] bg-[rgba(255,255,255,0.92)] text-center transition hover:border-[rgba(25,118,210,0.34)] hover:bg-[rgba(248,251,255,0.98)]"
                        >
                          <span className="grid justify-items-center gap-2">
                            <span className="grid h-[44px] w-[44px] place-items-center rounded-[14px] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]">
                              <ExpensePageSymbol kind="plus" className="h-[20px] w-[20px]" />
                            </span>
                            <span className="text-[0.82rem] font-semibold text-[var(--accent-strong)]">Add file</span>
                            <span className="text-[0.72rem] text-[var(--muted)]">
                              ({draftAttachments.length}/3)
                            </span>
                          </span>
                        </button>
                      );
                    }

                    return (
                      <div
                        key={`attachment-empty-${index}`}
                        className="grid aspect-[0.88] place-items-center rounded-[16px] border border-dashed border-[rgba(210,220,230,0.82)] bg-[rgba(255,255,255,0.56)]"
                      >
                        <span className="text-[0.72rem] text-[var(--muted)]" />
                      </div>
                    );
                  })}
                </div>
                {!allowPettyCashAttachments ? (
                  <div className="mt-3 text-[0.78rem] text-[var(--muted)]">Attachment upload is disabled for this tenant.</div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="expense-entry-modal-footer desktop-modal-footer shrink-0 flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-7 sm:py-6 lg:px-8 lg:py-7">
        <button
          className="secondary-btn inline-flex min-h-[52px] items-center justify-center px-8 text-[0.9rem] sm:min-w-[188px]"
          type="button"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className="primary-btn inline-flex min-h-[52px] items-center justify-center gap-3 px-8 text-[0.9rem] sm:min-w-[280px]"
          type="button"
          onClick={onSubmit}
          disabled={saving}
        >
          <ExpenseIcon
            path={
              <>
                <path d="M5 7h14v10H5z" />
                <path d="M8 7V5h8v2" />
                <path d="M8 17v-4h8v4" />
              </>
            }
            className="h-[18px] w-[18px]"
          />
          {saving ? 'Saving...' : 'Save Record'}
        </button>
      </div>
    </div>
  );
}

export function ExpenseDetailModal({ entry, onClose }: ExpenseDetailModalProps): JSX.Element {
  const isOut = entry.direction === 'OUT';
  return (
    <div className="desktop-modal-card desktop-modal-card--action max-w-5xl" onClick={(event) => event.stopPropagation()}>
      <div className="desktop-modal-header shrink-0 px-5 py-5 sm:px-7 sm:py-6 lg:px-8 lg:py-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="eyebrow">Expense detail</div>
            <h3 className="mt-1 text-[1.2rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.34rem]">
              {entry.categoryLabel || entry.categoryCode}
            </h3>
            <p className="mt-2 text-[0.88rem] text-[var(--muted)]">Entry ID {entry.id}</p>
          </div>
          <button
            className="secondary-btn mini-btn modal-close-icon-btn h-11 w-11 shrink-0 text-[var(--text-strong)] sm:h-12 sm:w-12"
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            title="Close"
          >
            <ExpenseIcon
              path={
                <>
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </>
              }
            />
          </button>
        </div>
      </div>

      <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-5 px-5 py-5 sm:px-7 sm:py-7 lg:px-8 lg:py-8">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-[20px] border border-[rgba(188,210,234,0.52)] bg-[rgba(255,255,255,0.98)] px-4 py-4 shadow-[0_8px_20px_rgba(17,40,58,0.05)]">
            <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Amount</span>
            <strong className="mt-2 block text-[1rem] font-extrabold text-[var(--text-strong)]">
              {`${isOut ? '-' : '+'}${fmtMoney(entry.amount)}`}
            </strong>
          </div>
          <div className="rounded-[20px] border border-[rgba(188,210,234,0.52)] bg-[rgba(255,255,255,0.98)] px-4 py-4 shadow-[0_8px_20px_rgba(17,40,58,0.05)]">
            <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Direction</span>
            <strong className="mt-2 block text-[1rem] font-extrabold text-[var(--text-strong)]">{entry.direction}</strong>
          </div>
          <div className="rounded-[20px] border border-[rgba(188,210,234,0.52)] bg-[rgba(255,255,255,0.98)] px-4 py-4 shadow-[0_8px_20px_rgba(17,40,58,0.05)]">
            <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Status</span>
            <div className="mt-2">
              <span className={`sales-list-card-status ${expenseStatusClass(entry.syncStatus)}`}>
                {expenseStatusLabel(entry.syncStatus)}
              </span>
            </div>
          </div>
          <div className="rounded-[20px] border border-[rgba(188,210,234,0.52)] bg-[rgba(255,255,255,0.98)] px-4 py-4 shadow-[0_8px_20px_rgba(17,40,58,0.05)]">
            <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Shift</span>
            <strong className="mt-2 block text-[1rem] font-extrabold text-[var(--text-strong)]">{entry.shiftId}</strong>
          </div>
        </div>

        <section className="rounded-[22px] border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_10px_22px_rgba(17,40,58,0.05)]">
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Entry context</div>
              <h3>Expense record details</h3>
            </div>
          </div>
          <div className="desktop-detail-grid desktop-detail-grid--three">
            <div className="desktop-detail-list-item">
              <dt>Category Code</dt>
              <dd>{entry.categoryCode}</dd>
            </div>
            <div className="desktop-detail-list-item">
              <dt>Created At</dt>
              <dd>{fmtDate(entry.createdAt)}</dd>
            </div>
            <div className="desktop-detail-list-item">
              <dt>Updated At</dt>
              <dd>{fmtDate(entry.updatedAt)}</dd>
            </div>
          </div>
        </section>

        <section className="rounded-[22px] border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_10px_22px_rgba(17,40,58,0.05)]">
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Expense notes</div>
              <h3>Entry notes</h3>
            </div>
          </div>
          {entry.notes ? (
            <div className="rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(248,251,255,0.92)] px-4 py-3 text-[0.9rem] leading-7 text-[var(--text-strong)]">
              {entry.notes}
            </div>
          ) : (
            <div className="empty-state">No notes were recorded for this expense entry.</div>
          )}
        </section>

        <section className="rounded-[22px] border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_10px_22px_rgba(17,40,58,0.05)]">
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Attachments</div>
              <h3>Receipt files</h3>
            </div>
          </div>
          {!entry.attachments || entry.attachments.length === 0 ? (
            <div className="empty-state">No receipt files were attached to this expense entry.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {entry.attachments.map((attachment) => (
                <article
                  key={attachment.id}
                  className="overflow-hidden rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(255,255,255,0.98)] p-3 shadow-[0_8px_18px_rgba(17,40,58,0.05)]"
                >
                  {attachment.previewDataUrl ? (
                    <div className="aspect-[1.15] overflow-hidden rounded-[14px] bg-[rgba(240,246,255,0.86)]">
                      <img src={attachment.previewDataUrl} alt={attachment.fileName} className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="grid aspect-[1.15] place-items-center rounded-[14px] bg-[rgba(240,246,255,0.86)] text-[var(--muted)]">
                      <ExpensePageSymbol kind="local" className="h-[22px] w-[22px]" />
                    </div>
                  )}
                  <div className="mt-3 grid gap-1">
                    <strong className="truncate text-[0.9rem] font-semibold text-[var(--text-strong)]">{attachment.fileName}</strong>
                    <span className="text-[0.78rem] text-[var(--muted)]">{fmtAttachmentSize(attachment.sizeBytes)}</span>
                    <span className="text-[0.78rem] text-[var(--muted)]">{fmtDate(attachment.createdAt)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {entry.lastError ? (
          <section className="rounded-[22px] border border-[rgba(240,162,176,0.46)] bg-[rgba(255,241,243,0.92)] p-4 shadow-[0_8px_18px_rgba(212,84,84,0.07)]">
            <div className="panel-head compact">
              <div>
                <div className="eyebrow">Sync issue</div>
                <h3>Last error</h3>
              </div>
            </div>
            <div className="text-[0.9rem] leading-7 text-[#8a2648]">{entry.lastError}</div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function ExpenseScreen({ appState, onOutboxChanged }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const createTarget = useDesktopTutorialTarget('expense-create');
  const filterTarget = useDesktopTutorialTarget('expense-filter');
  const [categories, setCategories] = useState<DesktopOption[]>([]);
  const [entries, setEntries] = useState<DesktopExpenseRecord[]>([]);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [directionFilter, setDirectionFilter] = useState<ExpenseDirectionFilter>('all');
  const [syncFilter, setSyncFilter] = useState<ExpenseSyncFilter>('all');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [selectedExpenseId, setSelectedExpenseId] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [amount, setAmount] = useState('0');
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState('');
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([]);
  const [allowPettyCashAttachments, setAllowPettyCashAttachments] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const announce = (message: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
    desktopUi.showToast({ message, tone });
  };

  const handleRefresh = async (notify = false): Promise<void> => {
    await refresh();
    if (notify) {
      announce('Desktop petty cash list refreshed.', 'success');
    }
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [categoryRows, expenseRows, shifts, tenantAddons] = await Promise.all([
        desktopMasterDataService.loadExpenseCategoryOptions(),
        desktopExpenseService.listExpenses(),
        desktopShiftService.listShifts(),
        desktopMasterDataService.loadTenantAddons()
      ]);
      const openShift = shifts.find((shift) => shift.status === 'OPEN') ?? null;
      setCategories(categoryRows);
      setEntries(expenseRows);
      setActiveShiftId(openShift?.id ?? null);
      setAllowPettyCashAttachments(tenantAddons.petty_cash_attachments === true);
      if (tenantAddons.petty_cash_attachments !== true) {
        setDraftAttachments([]);
      }
      if (openShift) {
        setNotes((current) => current);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (saving) {
      desktopUi.setLoading({ visible: true, label: 'Queueing petty cash entry...' });
      return;
    }
    if (loading) {
      desktopUi.setLoading({ visible: true, label: 'Loading petty cash records...' });
      return;
    }
    desktopUi.clearLoading();
  }, [desktopUi, loading, saving]);

  const parsedAmount = parseNonNegativeDecimalInput(amount);
  const selectedCategory = useMemo(
    () => categories.find((option) => option.id === categoryCode) ?? null,
    [categories, categoryCode]
  );

  const filteredCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();
    if (!query) {
      return categories.slice(0, 80);
    }
    return categories
      .filter((option) => `${option.label} ${option.subtitle ?? ''} ${option.id}`.toLowerCase().includes(query))
      .slice(0, 80);
  }, [categories, categorySearch]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (directionFilter === 'in' && entry.direction !== 'IN') {
        return false;
      }
      if (directionFilter === 'out' && entry.direction !== 'OUT') {
        return false;
      }
      if (syncFilter === 'pending' && entry.syncStatus !== 'pending') {
        return false;
      }
      if (syncFilter === 'failed' && entry.syncStatus !== 'failed') {
        return false;
      }
      if (syncFilter === 'synced' && entry.syncStatus !== 'synced') {
        return false;
      }
      if (!query) {
        return true;
      }
      return `${entry.categoryLabel ?? ''} ${entry.categoryCode} ${entry.direction} ${entry.shiftId} ${entry.notes ?? ''} ${entry.syncStatus} ${entry.lastError ?? ''} ${entry.amount} ${entry.createdAt}`
        .toLowerCase()
        .includes(query);
    });
  }, [directionFilter, entries, search, syncFilter]);

  const selectedExpense = useMemo(
    () => entries.find((entry) => entry.id === selectedExpenseId) ?? null,
    [entries, selectedExpenseId]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [directionFilter, search, syncFilter]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredEntries.length / HISTORY_PAGE_SIZE)),
    [filteredEntries.length]
  );

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const pagedEntries = useMemo(() => {
    const start = (currentPage - 1) * HISTORY_PAGE_SIZE;
    return filteredEntries.slice(start, start + HISTORY_PAGE_SIZE);
  }, [currentPage, filteredEntries]);

  const counts = useMemo(() => {
    let pending = 0;
    let failed = 0;
    let synced = 0;
    let inCount = 0;
    let outCount = 0;
    for (const entry of entries) {
      if (entry.syncStatus === 'pending') {
        pending += 1;
      } else if (entry.syncStatus === 'failed') {
        failed += 1;
      } else if (entry.syncStatus === 'synced') {
        synced += 1;
      }
      if (entry.direction === 'IN') {
        inCount += 1;
      } else {
        outCount += 1;
      }
    }
    return {
      all: entries.length,
      pending,
      failed,
      synced,
      in: inCount,
      out: outCount
    };
  }, [entries]);

  const totals = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    for (const entry of entries) {
      if (entry.direction === 'IN') {
        totalIn += entry.amount;
      } else {
        totalOut += entry.amount;
      }
    }
    return {
      totalIn: Number(totalIn.toFixed(2)),
      totalOut: Number(totalOut.toFixed(2)),
      net: Number((totalIn - totalOut).toFixed(2))
    };
  }, [entries]);

  const quickAmountOptions = ['100', '200', '500', '1000'];

  const resetDraft = (): void => {
    setCategoryCode('');
    setCategorySearch('');
    setDirection('OUT');
    setAmount('0');
    setNotes('');
    setReference('');
    setDraftAttachments([]);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = '';
    }
  };

  const removeDraftAttachment = (id: string): void => {
    setDraftAttachments((current) => current.filter((row) => row.id !== id));
  };

  const openAttachmentPicker = (): void => {
    if (saving) {
      return;
    }
    if (!allowPettyCashAttachments) {
      announce('Attachments are not enabled for this tenant.', 'warning');
      return;
    }
    if (draftAttachments.length >= 3) {
      announce('Maximum of 3 attachments only.', 'warning');
      return;
    }
    attachmentInputRef.current?.click();
  };

  const onAttachmentInputChange = async (
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    if (!allowPettyCashAttachments) {
      event.target.value = '';
      return;
    }
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    const slots = Math.max(0, 3 - draftAttachments.length);
    if (slots === 0) {
      announce('Maximum of 3 attachments only.', 'warning');
      return;
    }
    const selected = Array.from(files).slice(0, slots);
    try {
      const next = await Promise.all(
        selected.map(
              (file) =>
                new Promise<DraftAttachment>((resolvePromise, rejectPromise) => {
              const mimeType = file.type.trim().toLowerCase();
              if (!ALLOWED_PETTY_CASH_ATTACHMENT_MIME_TYPES.has(mimeType)) {
                rejectPromise(new Error('Attachment must be jpg/jpeg/png/webp.'));
                return;
              }
              if (file.size > 5 * 1024 * 1024) {
                rejectPromise(new Error('Attachment must be up to 5 MB.'));
                return;
              }
              const reader = new FileReader();
              reader.onerror = () => rejectPromise(new Error('Unable to read selected file.'));
              reader.onload = () => {
                const result = typeof reader.result === 'string' ? reader.result : '';
                if (!result) {
                  rejectPromise(new Error('Attachment preview data is empty.'));
                  return;
                }
                resolvePromise({
                  id: `desktop-attachment-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
                  fileName: file.name.trim() || 'attachment.jpg',
                  mimeType,
                  sizeBytes: file.size,
                  previewDataUrl: result,
                  createdAt: new Date().toISOString()
                });
              };
              reader.readAsDataURL(file);
            })
        )
      );
      setDraftAttachments((current) => [...current, ...next].slice(0, 3));
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to add attachment.', 'error');
    } finally {
      event.target.value = '';
    }
  };

  const applyQuickAmount = (quick: string): void => {
    const currentAmount = Number(amount || '0');
    const quickValue = Number(quick);
    if (Number.isFinite(currentAmount) && Number.isFinite(quickValue)) {
      setAmount(String(Number((currentAmount + quickValue).toFixed(2))));
      return;
    }
    setAmount(quick);
  };

  const handleCreateEntry = async (): Promise<void> => {
    if (!activeShiftId) {
      announce('No active open shift. Start duty first.', 'warning');
      return;
    }
    if (!categoryCode.trim()) {
      announce('Expense category is required.', 'warning');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      announce('Amount must be greater than zero.', 'warning');
      return;
    }
    if (!notes.trim()) {
      announce('Description is required.', 'warning');
      return;
    }

    setSaving(true);
    try {
      const descriptionValue = notes.trim();
      const referenceValue = reference.trim();
      const combinedNotes = [descriptionValue, referenceValue ? `Reference: ${referenceValue}` : null]
        .filter((value): value is string => Boolean(value))
        .join('\n');
      const record = await desktopExpenseService.createExpense(appState, {
        shiftId: activeShiftId,
        categoryCode: categoryCode.trim(),
        categoryLabel: selectedCategory?.label ?? null,
        direction,
        amount: parsedAmount,
        notes: combinedNotes || null,
        attachments: allowPettyCashAttachments
          ? draftAttachments.map((attachment) => ({
              id: attachment.id,
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              previewDataUrl: attachment.previewDataUrl,
              sourceChannel: 'desktop',
              createdAt: attachment.createdAt
            }))
          : []
      });
      announce(`Petty cash ${record.direction} was queued locally.`, 'success');
      setEntryModalOpen(false);
      setCategoryModalOpen(false);
      resetDraft();
      await refresh();
      if (onOutboxChanged) {
        await onOutboxChanged();
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to queue petty cash entry.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <ExpensePageSymbol kind="petty-cash" className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">
              Expense Management
            </h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">
              Track shift cash movements.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2.5 xl:justify-end">
          <button className="secondary-btn min-h-[46px] px-4 text-[0.86rem]" type="button" onClick={() => void handleRefresh(true)} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            ref={createTarget.ref}
            className={`primary-btn inline-flex min-h-[48px] items-center gap-2.5 rounded-[16px] px-5 text-[0.88rem] ${createTarget.active ? 'tutorial-target-active' : ''}`}
            type="button"
            onClick={() => {
              resetDraft();
              setEntryModalOpen(true);
            }}
            disabled={!activeShiftId}
            aria-label="Record transaction"
          >
            <ExpensePageSymbol kind="plus" className="h-[18px] w-[18px]" />
            <span>Record Transaction</span>
          </button>
        </div>
      </section>

      {!activeShiftId ? (
        <div className="message-banner stock-warning-banner">Open a shift first before recording petty cash.</div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {([
          { key: 'in', label: 'Cash In', value: fmtMoney(totals.totalIn), icon: 'cash-in', tone: expenseMetricTone('in') },
          { key: 'out', label: 'Cash Out', value: fmtMoney(totals.totalOut), icon: 'cash-out', tone: expenseMetricTone('out') },
          { key: 'net', label: 'Net Cash', value: fmtMoney(totals.net), icon: 'net', tone: expenseMetricTone('net') },
          { key: 'pending', label: 'Pending Sync', value: String(counts.pending), icon: 'pending', tone: expenseMetricTone('pending') }
        ] as const).map((card) => (
          <article
            key={card.key}
            className={`grid gap-3 overflow-hidden rounded-[20px] border px-4 py-3.5 shadow-[0_10px_22px_rgba(17,40,58,0.05)] ${card.tone.shell}`}
          >
            <div className="flex items-start gap-3">
              <div className={`grid h-[50px] w-[50px] shrink-0 place-items-center rounded-full border ${card.tone.icon}`}>
                <ExpensePageSymbol kind={card.icon} className="h-[21px] w-[21px]" />
              </div>
              <div className="min-w-0">
                <div className={`text-[0.82rem] font-semibold ${card.tone.label}`}>{card.label}</div>
                <strong className="mt-1.5 block text-[0.98rem] font-extrabold tracking-[-0.01em] text-[var(--text-strong)] sm:text-[1.08rem]">
                  {card.value}
                </strong>
              </div>
            </div>
            <div className={`h-[4px] rounded-full bg-gradient-to-r ${card.tone.line}`} />
          </article>
        ))}
      </section>

      <section className={`${shellCardClass} grid gap-4`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div
            ref={filterTarget.ref}
            className={`inline-flex flex-wrap items-center gap-2 rounded-[22px] border border-[rgba(188,210,234,0.58)] bg-[rgba(255,255,255,0.97)] p-2 shadow-[0_10px_24px_rgba(17,40,58,0.04)] ${filterTarget.active ? 'tutorial-target-active' : ''}`}
          >
            {([
              ['all', `All (${counts.all})`, 'plus'],
              ['in', `In (${counts.in})`, 'cash-in'],
              ['out', `Out (${counts.out})`, 'cash-out']
            ] as Array<[ExpenseDirectionFilter, string, 'plus' | 'cash-in' | 'cash-out']>).map(([filter, label, icon]) => (
              <button
                key={filter}
                type="button"
                className={`inline-flex min-h-[48px] items-center gap-3 rounded-[16px] px-4 text-[0.94rem] font-semibold transition ${
                  directionFilter === filter
                    ? 'bg-[linear-gradient(145deg,var(--accent),var(--accent-strong))] text-white shadow-[0_14px_28px_rgba(25,118,210,0.2)]'
                    : 'text-[var(--text-strong)] hover:bg-[rgba(240,246,255,0.96)]'
                }`}
                onClick={() => setDirectionFilter(filter)}
              >
                <ExpensePageSymbol kind={icon} className="h-[18px] w-[18px]" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {([
              ['all', `All Status`],
              ['pending', `Pending (${counts.pending})`],
              ['failed', `Retry (${counts.failed})`],
              ['synced', `Synced (${counts.synced})`]
            ] as Array<[ExpenseSyncFilter, string]>).map(([filter, label]) => (
              <button
                key={filter}
                type="button"
                className={`filter-chip ${syncFilter === filter ? 'active' : ''}`}
                onClick={() => setSyncFilter(filter)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <SearchField
          className="w-full"
          value={search}
          onChange={setSearch}
          placeholder="Search category, shift, note, amount, or sync error"
        />

        <div className="grid gap-3">
          {filteredEntries.length === 0 ? (
            <div className="empty-state">No desktop petty cash entries match this filter yet.</div>
          ) : (
            pagedEntries.map((entry) => {
              const isOut = entry.direction === 'OUT';
              return (
                <article
                  key={entry.id}
                  className="relative overflow-hidden rounded-[22px] border border-[rgba(188,210,234,0.56)] bg-[rgba(255,255,255,0.98)] px-5 py-4 shadow-[0_12px_28px_rgba(17,40,58,0.05)] transition hover:border-[rgba(25,118,210,0.26)] hover:shadow-[0_16px_32px_rgba(17,40,58,0.08)]"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedExpenseId(entry.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedExpenseId(entry.id);
                    }
                  }}
                >
                  <span
                    className={`absolute inset-y-0 left-0 w-[4px] rounded-full ${
                      isOut ? 'bg-[#ff4d4f]' : 'bg-[#22c55e]'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start">
                    <div
                      className={`grid h-[58px] w-[58px] shrink-0 place-items-center rounded-full border ${
                        isOut
                          ? 'border-[rgba(247,196,201,0.78)] bg-[rgba(255,241,243,0.98)] text-[#ea3434]'
                          : 'border-[rgba(182,226,194,0.72)] bg-[rgba(238,250,242,0.98)] text-[#1f9b4d]'
                      }`}
                    >
                      <ExpensePageSymbol kind={isOut ? 'cash-out' : 'cash-in'} className="h-[24px] w-[24px]" />
                    </div>
                    <div className="min-w-0">
                      <strong className="block text-[1.02rem] font-extrabold text-[var(--text-strong)]">
                        {entry.categoryLabel || entry.categoryCode}
                      </strong>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.88rem] text-[var(--muted-strong)]">
                        <span>{entry.direction}</span>
                        <span>&bull;</span>
                        <span>Shift {entry.shiftId}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.82rem] text-[var(--muted)]">
                        <span className="inline-flex items-center gap-1.5">
                          <ExpenseListMetaIcon kind="shift" />
                          {new Date(entry.createdAt).toLocaleDateString()}
                        </span>
                        <span>&bull;</span>
                        <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
                        {allowPettyCashAttachments && entry.attachments?.length ? (
                          <>
                            <span>&bull;</span>
                            <span className="inline-flex items-center gap-1.5">
                              <ExpenseListMetaIcon kind="attachment" />
                              {entry.attachments.length} attachment{entry.attachments.length === 1 ? '' : 's'}
                            </span>
                          </>
                        ) : null}
                      </div>
                      {entry.notes ? (
                        <div className="mt-2 text-[0.88rem] leading-6 text-[var(--muted)]">{entry.notes}</div>
                      ) : null}
                      {entry.lastError ? (
                        <div className="mt-2 text-[0.82rem] font-medium text-[#a93d55]">Error: {entry.lastError}</div>
                      ) : null}
                    </div>
                    <div className="grid justify-items-start gap-2 md:justify-items-end">
                      <strong
                        className="text-[1.08rem] font-extrabold tracking-[-0.01em]"
                        style={{ color: isOut ? '#ea3434' : '#1f9b4d' }}
                      >
                        {`${isOut ? '-' : '+'}${fmtMoney(entry.amount)}`}
                      </strong>
                      <span className={`sales-list-card-status ${expenseStatusClass(entry.syncStatus)}`}>
                        {expenseStatusLabel(entry.syncStatus)}
                      </span>
                      <button
                        className="secondary-btn mini-btn"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedExpenseId(entry.id);
                        }}
                      >
                        View Details
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>

        {filteredEntries.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-[var(--border-soft)] pt-4 md:flex-row md:items-center md:justify-between">
            <div className="text-sm font-medium text-[var(--muted)]">
              Showing {(currentPage - 1) * HISTORY_PAGE_SIZE + 1}-{Math.min(currentPage * HISTORY_PAGE_SIZE, filteredEntries.length)} of {filteredEntries.length}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="secondary-btn mini-btn"
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span className="rounded-full border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-3 py-1 text-sm font-semibold text-[var(--muted-strong)]">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="secondary-btn mini-btn"
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {entryModalOpen ? (
        <div className={modalBackdropClass} onClick={() => !saving && setEntryModalOpen(false)}>
          <PettyCashEntryModal
            saving={saving}
            selectedCategory={selectedCategory}
            categoriesAvailable={categories.length > 0}
            direction={direction}
            amount={amount}
            notes={notes}
            reference={reference}
            quickAmountOptions={quickAmountOptions}
            allowPettyCashAttachments={allowPettyCashAttachments}
            draftAttachments={draftAttachments}
            attachmentInputRef={attachmentInputRef}
            onClose={() => !saving && setEntryModalOpen(false)}
            onOpenCategory={() => setCategoryModalOpen(true)}
            onDirectionChange={setDirection}
            onAmountChange={setAmount}
            onQuickAmount={applyQuickAmount}
            onNotesChange={setNotes}
            onReferenceChange={setReference}
            onAddAttachment={openAttachmentPicker}
            onRemoveAttachment={removeDraftAttachment}
            onAttachmentInputChange={(event) => void onAttachmentInputChange(event)}
            onSubmit={() => void handleCreateEntry()}
          />
        </div>
      ) : null}

      <button
        className="desktop-floating-action-btn desktop-floating-action-btn--with-bottom-bar"
        type="button"
        onClick={() => {
          resetDraft();
          setEntryModalOpen(true);
        }}
        disabled={!activeShiftId}
        aria-label="Quick add petty cash transaction"
        title="Quick add petty cash transaction"
      >
        <ExpensePageSymbol kind="plus" className="h-[30px] w-[30px]" />
      </button>

      {selectedExpense ? (
        <div className={modalBackdropClass} onClick={() => setSelectedExpenseId('')}>
          <ExpenseDetailModal entry={selectedExpense} onClose={() => setSelectedExpenseId('')} />
        </div>
      ) : null}

      {categoryModalOpen ? (
        <div className={modalBackdropClass} onClick={() => setCategoryModalOpen(false)}>
          <div className={`${modalCardClass} max-w-4xl`} onClick={(event) => event.stopPropagation()}>
            <div className="pos-sheet-toolbar">
              <div className="panel-head pos-sheet-head">
                <div>
                  <div className="eyebrow">Selection</div>
                  <h3>Select Expense Category</h3>
                </div>
                <button
                  className="secondary-btn mini-btn modal-close-icon-btn"
                  type="button"
                  onClick={() => setCategoryModalOpen(false)}
                  aria-label="Close modal"
                  title="Close"
                >
                  <ExpenseIcon
                    path={
                      <>
                        <path d="M6 6l12 12" />
                        <path d="M18 6L6 18" />
                      </>
                    }
                  />
                </button>
              </div>

              <SearchField
                className="pos-sheet-search"
                value={categorySearch}
                onChange={setCategorySearch}
                placeholder="Search expense category"
                autoFocus
              />
            </div>

            <div className="picker-list">
              {filteredCategories.length === 0 ? (
                <div className="empty-state">No matching category.</div>
              ) : (
                filteredCategories.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`catalog-row picker-row ${option.id === categoryCode ? 'picker-row-selected' : ''}`}
                    onClick={() => {
                      setCategoryCode(option.id);
                      setCategoryModalOpen(false);
                    }}
                  >
                    <div>
                      <strong>{option.label}</strong>
                      <span>{option.subtitle ?? option.id}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}





