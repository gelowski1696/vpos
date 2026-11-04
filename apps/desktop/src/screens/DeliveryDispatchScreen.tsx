import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SearchField } from '../components/inputs/SearchField';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import type { DesktopAppState, DesktopDispatchStatusRecord, DesktopSaleRecord } from '../db/schema';
import { desktopDb } from '../db/sqlite';
import { desktopDeliveryService } from '../services/desktop-delivery.service';

type Props = {
  appState: DesktopAppState;
  onOutboxChanged?: () => Promise<void> | void;
};

type DispatchStatus = 'PENDING' | 'TRANSIT' | 'DELIVERED' | 'COMPLETED';
type StatusFilter = 'ALL' | DispatchStatus;
type DispatchAdvanceAction = {
  sale: DesktopSaleRecord;
  currentStatus: DispatchStatus;
  nextStatus: DesktopDispatchStatusRecord['status'];
  notes: string;
};

type DispatchTimelineTone = 'accent' | 'warn' | 'good' | 'purple';
type DispatchListTone = {
  accent: string;
  icon: string;
  badge: string;
  action: string;
};
type DispatchTimelineStep = {
  status: DispatchStatus;
  label: string;
  tone: DispatchTimelineTone;
  active: boolean;
  timestamp: string | null;
  noteLabel: string;
  note: string | null;
};

const STATUS_NEXT: Record<DispatchStatus, DesktopDispatchStatusRecord['status'] | null> = {
  PENDING: 'TRANSIT',
  TRANSIT: 'DELIVERED',
  DELIVERED: 'COMPLETED',
  COMPLETED: null
};

const DISPATCH_STATUS_SEQUENCE: DispatchStatus[] = ['PENDING', 'TRANSIT', 'DELIVERED', 'COMPLETED'];

const STATUS_ACTION_LABEL: Record<DispatchStatus, string> = {
  PENDING: 'Start Transit',
  TRANSIT: 'Mark Delivered',
  DELIVERED: 'Mark Complete',
  COMPLETED: ''
};

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const screenStackClass = 'space-y-5';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const dispatchListGridClass =
  'grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)_minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,0.6fr)_minmax(0,0.8fr)_minmax(0,1.05fr)]';
const dispatchListRowClass =
  'relative overflow-hidden rounded-[24px] border border-[rgba(188,210,234,0.56)] bg-[rgba(255,255,255,0.98)] px-4 py-4 shadow-[0_12px_28px_rgba(17,40,58,0.05)] transition hover:border-[rgba(25,118,210,0.26)] hover:shadow-[0_16px_32px_rgba(17,40,58,0.08)]';
const dispatchListHeaderClass =
  'hidden rounded-[20px] bg-[rgba(248,251,255,0.92)] px-4 py-3 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[var(--muted-strong)] xl:grid';
const dispatchListCellValueClass = 'text-[0.86rem] font-semibold leading-5 text-[var(--text-strong)]';
const dispatchListCellMutedClass = 'text-[0.74rem] leading-5 text-[var(--muted)]';
const dispatchListActionButtonClass =
  'inline-flex min-h-[38px] items-center justify-center rounded-xl border px-3 py-2 text-[0.76rem] font-bold shadow-sm transition-opacity';
const dispatchListActionDoneClass =
  'inline-flex min-h-[38px] items-center justify-center rounded-xl border border-[rgba(182,226,194,0.45)] bg-[rgba(238,250,242,0.98)] px-3 py-2 text-[0.76rem] font-bold text-[#1a7a3c]';
const dispatchMoneyFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const dispatchDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
});
const dispatchTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC'
});

function fmtDateTime(value: string | null | undefined): string {
  if (!value) {
    return 'Not recorded';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

function fmtMoney(value: number): string {
  return dispatchMoneyFormatter.format(value);
}

function fmtDispatchDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : dispatchDateFormatter.format(date);
}

function fmtDispatchTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : dispatchTimeFormatter.format(date);
}

function fmtQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function getEffectiveStatus(
  statusMap: Record<string, DesktopDispatchStatusRecord>,
  saleId: string
): DispatchStatus {
  return statusMap[saleId]?.status ?? 'PENDING';
}

function statusLabel(status: DispatchStatus): string {
  switch (status) {
    case 'TRANSIT':
      return 'In Transit';
    case 'DELIVERED':
      return 'Delivered';
    case 'COMPLETED':
      return 'Completed';
    default:
      return 'Pending';
  }
}

function getDriverName(sale: DesktopSaleRecord): string | null {
  return (
    sale.payload.personnel?.find((person) => person.role === 'DRIVER')?.name ??
    sale.payload.personnelName ??
    null
  );
}

function getHelperName(sale: DesktopSaleRecord): string | null {
  return (
    sale.payload.personnel?.find((person) => person.role === 'HELPER')?.name ??
    sale.payload.helperName ??
    null
  );
}

function getItemsSummary(sale: DesktopSaleRecord): string {
  const count = sale.payload.lines.length;
  return `${count} item${count !== 1 ? 's' : ''}`;
}

function DispatchIcon({
  children,
  className = 'h-[18px] w-[18px]'
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function dispatchTone(status: DispatchStatus): {
  shell: string;
  icon: string;
  value: string;
  chip: string;
  accent: string;
} {
  switch (status) {
    case 'TRANSIT':
      return {
        shell: 'border-[rgba(246,211,147,0.72)] bg-[rgba(255,251,244,0.96)]',
        icon: 'border-[rgba(246,211,147,0.72)] bg-[rgba(255,244,225,0.98)] text-[#b56a00]',
        value: 'text-[#b56a00]',
        chip: 'bg-[rgba(246,211,147,0.6)] text-[#b56a00]',
        accent: 'bg-[linear-gradient(135deg,#f2b55d,#c67d17)]'
      };
    case 'DELIVERED':
      return {
        shell: 'border-[rgba(182,226,194,0.72)] bg-[rgba(250,255,252,0.96)]',
        icon: 'border-[rgba(182,226,194,0.72)] bg-[rgba(238,250,242,0.98)] text-[#1a7a3c]',
        value: 'text-[#1a7a3c]',
        chip: 'bg-[rgba(182,226,194,0.6)] text-[#1a7a3c]',
        accent: 'bg-[linear-gradient(135deg,#59d48a,#1a7a3c)]'
      };
    case 'COMPLETED':
      return {
        shell: 'border-[rgba(196,220,255,0.78)] bg-[rgba(248,251,255,0.98)]',
        icon: 'border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]',
        value: 'text-[var(--accent-strong)]',
        chip: 'bg-[rgba(196,220,255,0.6)] text-[var(--accent-strong)]',
        accent: 'bg-[linear-gradient(135deg,var(--accent),var(--accent-strong))]'
      };
    default:
      return {
        shell: 'border-[rgba(210,210,220,0.6)] bg-[rgba(250,250,252,0.98)]',
        icon: 'border-[rgba(210,210,220,0.6)] bg-[rgba(244,244,248,0.98)] text-[#555]',
        value: 'text-[#555]',
        chip: 'bg-[rgba(210,210,220,0.5)] text-[#555]',
        accent: 'bg-[linear-gradient(135deg,#f2b55d,#c67d17)]'
      };
  }
}

function dispatchListTone(status: DispatchStatus): DispatchListTone {
  switch (status) {
    case 'TRANSIT':
      return {
        accent: 'bg-[linear-gradient(135deg,var(--accent),var(--accent-strong))]',
        icon: 'border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]',
        badge: 'border-[rgba(196,220,255,0.78)] bg-[rgba(235,243,255,0.98)] text-[var(--accent-strong)]',
        action: 'border-[rgba(25,118,210,0.18)] bg-[linear-gradient(135deg,var(--accent),var(--accent-strong))] text-white hover:opacity-90'
      };
    case 'DELIVERED':
      return {
        accent: 'bg-[linear-gradient(135deg,#59d48a,#1a7a3c)]',
        icon: 'border-[rgba(182,226,194,0.78)] bg-[rgba(238,250,242,0.98)] text-[#1a7a3c]',
        badge: 'border-[rgba(182,226,194,0.78)] bg-[rgba(238,250,242,0.98)] text-[#1a7a3c]',
        action: 'border-[rgba(26,122,60,0.16)] bg-[linear-gradient(135deg,#59d48a,#1a7a3c)] text-white hover:opacity-90'
      };
    case 'COMPLETED':
      return {
        accent: 'bg-[linear-gradient(135deg,#34b759,#1a7a3c)]',
        icon: 'border-[rgba(182,226,194,0.78)] bg-[rgba(238,250,242,0.98)] text-[#1a7a3c]',
        badge: 'border-[rgba(182,226,194,0.78)] bg-[rgba(238,250,242,0.98)] text-[#1a7a3c]',
        action: 'border-[rgba(26,122,60,0.16)] bg-[linear-gradient(135deg,#34b759,#1a7a3c)] text-white hover:opacity-90'
      };
    default:
      return {
        accent: 'bg-[linear-gradient(135deg,#f2b55d,#c67d17)]',
        icon: 'border-[rgba(246,211,147,0.72)] bg-[rgba(255,244,225,0.98)] text-[#b56a00]',
        badge: 'border-[rgba(246,211,147,0.72)] bg-[rgba(255,244,225,0.98)] text-[#b56a00]',
        action: 'border-[rgba(246,211,147,0.16)] bg-[linear-gradient(135deg,#f2b55d,#c67d17)] text-white hover:opacity-90'
      };
  }
}

function dispatchTimelineTone(status: DispatchStatus): DispatchTimelineTone {
  switch (status) {
    case 'TRANSIT':
      return 'warn';
    case 'DELIVERED':
      return 'good';
    case 'COMPLETED':
      return 'purple';
    default:
      return 'accent';
  }
}

function dispatchTimelineIconStyle(tone: DispatchTimelineTone, active: boolean): {
  color: string;
  backgroundColor: string;
  borderColor: string;
  opacity?: number;
} {
  if (!active) {
    return {
      color: 'var(--muted)',
      backgroundColor: 'rgba(247,250,255,0.94)',
      borderColor: 'rgba(217,228,239,0.72)',
      opacity: 0.82
    };
  }

  switch (tone) {
    case 'warn':
      return {
        color: '#b56a00',
        backgroundColor: 'rgba(255,244,225,0.98)',
        borderColor: 'rgba(246,211,147,0.82)'
      };
    case 'good':
      return {
        color: '#1a7a3c',
        backgroundColor: 'rgba(238,250,242,0.98)',
        borderColor: 'rgba(182,226,194,0.82)'
      };
    case 'purple':
      return {
        color: '#6f4fd9',
        backgroundColor: 'rgba(246,242,255,0.98)',
        borderColor: 'rgba(208,198,255,0.84)'
      };
    default:
      return {
        color: 'var(--accent-strong)',
        backgroundColor: 'rgba(240,246,255,0.98)',
        borderColor: 'rgba(196,220,255,0.82)'
      };
  }
}

function buildDispatchTimelineSteps(
  sale: DesktopSaleRecord,
  dispatchStatus: DispatchStatus,
  statusRecord: DesktopDispatchStatusRecord | null
): DispatchTimelineStep[] {
  const historyByStatus = new Map<DispatchStatus, { notes: string | null; updatedAt: string }>();
  for (const entry of statusRecord?.history ?? []) {
    historyByStatus.set(entry.status as DispatchStatus, {
      notes: entry.notes,
      updatedAt: entry.updatedAt
    });
  }

  const currentIndex = DISPATCH_STATUS_SEQUENCE.indexOf(dispatchStatus);
  const currentHistory = statusRecord?.status === dispatchStatus ? statusRecord : null;

  return DISPATCH_STATUS_SEQUENCE.map((status, index) => {
    const historyEntry = historyByStatus.get(status);
    const fallbackEntry =
      currentHistory?.status === status
        ? {
            notes: currentHistory.notes,
            updatedAt: currentHistory.updatedAt
          }
        : null;
    const reached = index <= currentIndex;
    const timestamp =
      status === 'PENDING'
        ? sale.createdAt
        : historyEntry?.updatedAt ?? fallbackEntry?.updatedAt ?? null;
    const note =
      status === 'PENDING'
        ? sale.payload.notes?.trim() || null
        : historyEntry?.notes ?? fallbackEntry?.notes ?? null;

    return {
      status,
      label: statusLabel(status),
      tone: dispatchTimelineTone(status),
      active: reached,
      timestamp,
      noteLabel: status === 'PENDING' && sale.payload.notes?.trim() ? 'Order note' : 'Status note',
      note
    };
  });
}

function statusIcon(status: DispatchStatus): ReactNode {
  switch (status) {
    case 'TRANSIT':
      return (
        <>
          <rect x="1" y="3" width="15" height="13" rx="2" />
          <path d="M16 8h4l3 3v5h-7V8z" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </>
      );
    case 'DELIVERED':
      return (
        <>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </>
      );
    case 'COMPLETED':
      return <polyline points="20 6 9 17 4 12" />;
    case 'PENDING':
    default:
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </>
      );
  }
}

function MetricCard({
  label,
  value,
  status
}: {
  label: string;
  value: number;
  status: DispatchStatus;
}): JSX.Element {
  const tone = dispatchTone(status);

  return (
    <div className={`flex items-center gap-3 rounded-2xl border p-4 ${tone.shell}`}>
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${tone.icon}`}>
        <DispatchIcon>{statusIcon(status)}</DispatchIcon>
      </div>
      <div className="min-w-0">
        <div className={`text-2xl font-extrabold leading-tight ${tone.value}`}>{value}</div>
        <div className="text-xs font-semibold text-muted">{label}</div>
      </div>
    </div>
  );
}

function DetailMetricCard({
  label,
  value,
  icon,
  tone
}: {
  label: string;
  value: string;
  icon: 'pending' | 'transit' | 'delivered' | 'completed';
  tone: 'accent' | 'good' | 'warn' | 'purple';
}): JSX.Element {
  const iconTone = {
    accent: 'border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]',
    good: 'border-[rgba(182,226,194,0.72)] bg-[rgba(238,250,242,0.98)] text-[#1a7a3c]',
    warn: 'border-[rgba(246,211,147,0.72)] bg-[rgba(255,244,225,0.98)] text-[#b56a00]',
    purple: 'border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]'
  }[tone];

  const valueTone = {
    accent: 'text-[var(--text-strong)]',
    good: 'text-[#1a7a3c]',
    warn: 'text-[#b56a00]',
    purple: 'text-[var(--accent-strong)]'
  }[tone];

  const iconPath: Record<'pending' | 'transit' | 'delivered' | 'completed', ReactNode> = {
    pending: (
      <>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </>
    ),
    transit: (
      <>
        <rect x="1" y="3" width="15" height="13" rx="2" />
        <path d="M16 8h4l3 3v5h-7V8z" />
      </>
    ),
    delivered: (
      <>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </>
    ),
    completed: <polyline points="20 6 9 17 4 12" />
  };

  return (
    <div className="rounded-2xl border border-[var(--border-soft)] bg-[rgba(248,251,255,0.8)] p-3">
      <div className="flex items-start gap-2.5">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${iconTone}`}>
          <DispatchIcon className="h-[15px] w-[15px]">{iconPath[icon]}</DispatchIcon>
        </span>
        <div className="min-w-0">
          <span className="block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
            {label}
          </span>
          <strong className={`block text-[0.88rem] font-bold leading-5 line-clamp-2 break-words ${valueTone}`}>
            {value}
          </strong>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-xs font-semibold text-muted">{label}</span>
      <span className="text-right text-xs font-medium text-text">{value}</span>
    </div>
  );
}

function DetailSection({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-2xl border border-[var(--border-soft)] bg-[rgba(255,255,255,0.96)] p-4 shadow-[0_12px_28px_rgba(17,40,58,0.05)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-extrabold text-[var(--text-strong)]">{title}</h4>
      </div>
      {children}
    </section>
  );
}

function DispatchModalCloseButton({
  onClick
}: {
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      className="secondary-btn mini-btn modal-close-icon-btn h-10 w-10 shrink-0 text-[var(--text-strong)]"
      type="button"
      onClick={onClick}
      aria-label="Close modal"
      title="Close"
    >
      <DispatchIcon className="h-[16px] w-[16px]">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </DispatchIcon>
    </button>
  );
}

function DispatchActionButton({
  label,
  tone,
  onClick,
  disabled
}: {
  label: string;
  tone: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  const className =
    tone === 'primary'
      ? 'primary-btn'
      : tone === 'danger'
        ? 'purchase-order-detail-action-btn purchase-order-detail-action-btn--danger'
        : 'secondary-btn';

  return (
    <button
      className={`${className} purchase-order-detail-action-btn w-full justify-center gap-2`}
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      <span>{label}</span>
    </button>
  );
}

function DispatchProgressCard({
  sale,
  status,
  statusRecord
}: {
  sale: DesktopSaleRecord;
  status: DispatchStatus;
  statusRecord: DesktopDispatchStatusRecord | null;
}): JSX.Element {
  const steps = buildDispatchTimelineSteps(sale, status, statusRecord);
  const recordedSteps = steps.filter((step) => step.timestamp).length;
  const currentTone = dispatchTone(status);

  return (
    <section className="rounded-2xl border border-[var(--border-soft)] bg-[rgba(255,255,255,0.96)] p-4 shadow-[0_12px_28px_rgba(17,40,58,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-extrabold text-[var(--text-strong)]">Dispatch Progress</h4>
          <p className="mt-1 text-xs leading-5 text-muted">
            Each milestone shows the date, time, and note captured for that status.
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${currentTone.chip}`}>
          {statusLabel(status)}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-muted">
        <span>{recordedSteps} of {steps.length} stages recorded</span>
        <span>{statusRecord ? `Last update ${fmtDateTime(statusRecord.updatedAt)}` : 'Awaiting first dispatch update'}</span>
      </div>

      <div className="mt-4 purchase-order-detail-timeline">
        {steps.map((step) => (
          <div
            key={step.status}
            className={`purchase-order-detail-timeline-item ${step.active ? '' : 'opacity-70'}`}
          >
            <span
              className="purchase-order-detail-timeline-icon"
              style={dispatchTimelineIconStyle(step.tone, step.active)}
            >
              <DispatchIcon className="h-[14px] w-[14px]">{statusIcon(step.status)}</DispatchIcon>
            </span>
            <div className="purchase-order-detail-timeline-copy">
              <strong>{step.label}</strong>
              <span>
                {step.timestamp ? <time dateTime={step.timestamp}>{fmtDateTime(step.timestamp)}</time> : 'Not recorded yet'}
              </span>
              <span>
                {step.noteLabel}: {step.note ?? 'No note recorded.'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DispatchDetailModal({
  sale,
  dispatchStatus,
  statusRecord,
  updating,
  onClose,
  statusNotes,
  onStatusNotesChange,
  onAdvanceStatus
}: {
  sale: DesktopSaleRecord;
  dispatchStatus: DispatchStatus;
  statusRecord: DesktopDispatchStatusRecord | null;
  updating: boolean;
  onClose: () => void;
  statusNotes: string;
  onStatusNotesChange: (value: string) => void;
  onAdvanceStatus: (next: DesktopDispatchStatusRecord['status'], notes?: string) => void;
}): JSX.Element {
  const driverName = getDriverName(sale);
  const helperName = getHelperName(sale);
  const nextStatus = STATUS_NEXT[dispatchStatus];
  const tone = dispatchTone(dispatchStatus);

  const orderTotal = sale.payload.totalAmount;
  const itemCount = sale.payload.lines.length;
  const dispatchSummary = [
    {
      label: 'Dispatch ID',
      value: sale.id
    },
    {
      label: 'Receipt',
      value: sale.receiptNumber
    },
    {
      label: 'Last Updated',
      value: fmtDateTime(sale.updatedAt)
    },
    {
      label: 'Notes',
      value: sale.payload.notes?.trim() || 'No note recorded.'
    }
  ];

  return (
    <div className="desktop-modal-backdrop" role="presentation">
      <div
        className="desktop-modal-card desktop-modal-card--detail w-[min(1120px,calc(100vw-48px))] max-w-[min(1120px,calc(100vw-48px))] overflow-hidden"
        style={{ width: 'min(1120px, calc(100vw - 48px))', maxWidth: 'min(1120px, calc(100vw - 48px))' }}
      >
        <div className="desktop-modal-header flex shrink-0 flex-col gap-4 px-5 py-5 sm:px-7 sm:py-6 lg:px-8 lg:py-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-[20px] border ${tone.icon} shadow-[0_10px_22px_rgba(17,40,58,0.04)]`}>
                <DispatchIcon className="h-[24px] w-[24px]">{statusIcon(dispatchStatus)}</DispatchIcon>
              </div>
              <div className="min-w-0">
                <div className="text-[0.84rem] font-medium text-[var(--muted-strong)]">Dispatch Detail</div>
                <h3 className="mt-1 text-[1.28rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.42rem]">
                  {sale.payload.customerName ?? 'Walk-in Customer'}
                </h3>
                <p className="mt-2 max-w-[36rem] text-[0.9rem] leading-6 text-[var(--muted)]">
                  {sale.receiptNumber} - {sale.payload.branchLabel} / {sale.payload.locationLabel}
                </p>
              </div>
            </div>

            <DispatchModalCloseButton onClick={() => {
              if (!updating) {
                onClose();
              }
            }} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {dispatchSummary.map((entry) => (
              <div
                key={entry.label}
                className="rounded-2xl border border-[var(--border-soft)] bg-[rgba(248,251,255,0.8)] px-4 py-3"
              >
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted">
                  {entry.label}
                </div>
                <div className="mt-1 text-[0.92rem] font-semibold text-[var(--text-strong)]">
                  {entry.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-5 px-5 py-5 sm:px-7 sm:py-7 lg:px-8 lg:py-8">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DetailMetricCard label="Items" value={String(itemCount)} icon="pending" tone="accent" />
            <DetailMetricCard label="Total" value={fmtMoney(orderTotal)} icon="delivered" tone="good" />
            <DetailMetricCard label="Driver" value={driverName ?? 'Unassigned'} icon="transit" tone="warn" />
            <DetailMetricCard label="Helper" value={helperName ?? 'Not set'} icon="completed" tone="purple" />
          </div>

          <div className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.85fr)]">
            <div className="grid min-h-0 gap-5">
              <DetailSection title="Delivery Lines">
                <div className="overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[rgba(248,251,255,0.8)]">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-[rgba(242,246,250,0.96)] text-[0.7rem] uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2">Qty</th>
                        <th className="px-3 py-2">Unit Price</th>
                        <th className="px-3 py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgba(217,228,239,0.82)]">
                      {sale.payload.lines.map((line, index) => (
                        <tr key={line.lineId ?? `${line.productId}-${index}`}>
                          <td className="px-3 py-3 align-top font-semibold text-[var(--text-strong)]">
                            {index + 1}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <div className="font-semibold text-[var(--text-strong)]">{line.productName}</div>
                            {line.subtitle ? (
                              <div className="mt-0.5 text-[11px] text-muted">{line.subtitle}</div>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 align-top font-semibold text-[var(--text-strong)]">
                            x{fmtQty(line.quantity)}
                          </td>
                          <td className="px-3 py-3 align-top text-[var(--muted-strong)]">
                            {fmtMoney(line.unitPrice)}
                          </td>
                          <td className="px-3 py-3 align-top font-semibold text-[var(--text-strong)]">
                            {fmtMoney(line.lineTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="px-3 py-3 font-semibold text-[var(--text-strong)]" colSpan={2}>
                          Total
                        </td>
                        <td className="px-3 py-3 font-semibold text-[var(--text-strong)]">
                          {fmtQty(sale.payload.lines.reduce((sum, line) => sum + line.quantity, 0))}
                        </td>
                        <td />
                        <td className="px-3 py-3 font-semibold text-[var(--text-strong)]">
                          {fmtMoney(orderTotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </DetailSection>

              <DetailSection title="Details">
                <div className="grid gap-2">
                  <DetailRow label="Sale ID" value={sale.payload.id} />
                  <DetailRow label="Receipt" value={sale.receiptNumber} />
                  <DetailRow label="Branch" value={sale.payload.branchLabel} />
                  <DetailRow label="Location" value={sale.payload.locationLabel} />
                  <DetailRow label="Status" value={<span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${tone.chip}`}>{statusLabel(dispatchStatus)}</span>} />
                  <DetailRow label="Last Updated" value={fmtDateTime(sale.updatedAt)} />
                  <DetailRow label="Notes" value={sale.payload.notes?.trim() || 'No note recorded.'} />
                </div>
              </DetailSection>
            </div>

            <div className="grid min-h-0 gap-5">
              <DetailSection title="Actions">
                <div className="grid gap-3">
                  {nextStatus ? (
                    <>
                      <label className="grid gap-2">
                        <span className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted">
                          Status note (optional)
                        </span>
                        <textarea
                          value={statusNotes}
                          onChange={(event) => onStatusNotesChange(event.target.value)}
                          placeholder="Add a note for this status update"
                          rows={4}
                          disabled={updating}
                          className="min-h-[112px] rounded-2xl border border-[var(--border-soft)] bg-[rgba(248,251,255,0.92)] px-4 py-3 text-sm leading-6 text-[var(--text-strong)] outline-none transition placeholder:text-muted focus:border-[var(--accent)] focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                      <DispatchActionButton
                        label={updating ? 'Updating...' : STATUS_ACTION_LABEL[dispatchStatus]}
                        tone="primary"
                        onClick={() => onAdvanceStatus(nextStatus, statusNotes)}
                        disabled={updating}
                      />
                    </>
                  ) : (
                    <div className="flex items-center justify-center gap-2 rounded-xl bg-[rgba(196,220,255,0.3)] px-4 py-3">
                      <DispatchIcon className="h-4 w-4 text-[var(--accent-strong)]">
                        <polyline points="20 6 9 17 4 12" />
                      </DispatchIcon>
                      <span className="text-sm font-bold text-[var(--accent-strong)]">
                        Delivery Completed
                      </span>
                    </div>
                  )}
                </div>
              </DetailSection>

              <DispatchProgressCard sale={sale} status={dispatchStatus} statusRecord={statusRecord} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DispatchAdvanceModal({
  action,
  updating,
  onClose,
  onNotesChange,
  onConfirm
}: {
  action: DispatchAdvanceAction;
  updating: boolean;
  onClose: () => void;
  onNotesChange: (value: string) => void;
  onConfirm: () => void;
}): JSX.Element {
  const currentTone = dispatchTone(action.currentStatus);
  const nextTone = dispatchTone(action.nextStatus as DispatchStatus);
  const nextStatusLabel = statusLabel(action.nextStatus as DispatchStatus);
  const buttonLabel = `Confirm ${STATUS_ACTION_LABEL[action.currentStatus]}`;

  return (
    <div className="desktop-modal-backdrop" role="presentation" onClick={() => !updating && onClose()}>
      <div
        className="desktop-modal-card desktop-modal-card--action w-[min(760px,calc(100vw-48px))] max-w-[min(760px,calc(100vw-48px))] overflow-hidden"
        style={{ width: 'min(760px, calc(100vw - 48px))', maxWidth: 'min(760px, calc(100vw - 48px))' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-advance-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="desktop-modal-header flex shrink-0 flex-col gap-4 px-5 py-5 sm:px-7 sm:py-6 lg:px-8 lg:py-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[0.84rem] font-medium text-[var(--muted-strong)]">Dispatch action</div>
              <h3
                id="dispatch-advance-modal-title"
                className="mt-1 text-[1.26rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.4rem]"
              >
                Confirm Dispatch Update
              </h3>
              <p className="mt-2 max-w-[34rem] text-[0.92rem] leading-6 text-[var(--muted)]">
                Mark {action.sale.payload.customerName ?? 'this order'} as {nextStatusLabel} and add an optional note if needed.
              </p>
            </div>

            <DispatchModalCloseButton onClick={onClose} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[rgba(248,251,255,0.82)] px-4 py-3">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted">Customer</div>
              <div className="mt-1 text-[0.95rem] font-semibold text-[var(--text-strong)]">
                {action.sale.payload.customerName ?? 'Walk-in Customer'}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[rgba(248,251,255,0.82)] px-4 py-3">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted">Receipt</div>
              <div className="mt-1 text-[0.95rem] font-semibold text-[var(--text-strong)]">
                {action.sale.receiptNumber}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[rgba(248,251,255,0.82)] px-4 py-3">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted">Current</div>
              <div className="mt-1 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide bg-[rgba(210,210,220,0.5)] text-[#555]">
                {statusLabel(action.currentStatus)}
              </div>
            </div>
            <div className="rounded-2xl border border-[var(--border-soft)] bg-[rgba(248,251,255,0.82)] px-4 py-3">
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted">Next</div>
              <div className={`mt-1 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${nextTone.chip}`}>
                {nextStatusLabel}
              </div>
            </div>
          </div>
        </div>

        <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-4 px-5 py-5 sm:px-7 sm:py-7 lg:px-8 lg:py-8">
          <div className="rounded-2xl border border-[var(--border-soft)] bg-[rgba(248,251,255,0.84)] px-4 py-3 text-sm leading-6 text-[var(--muted-strong)]">
            This update will advance the dispatch status immediately. Add a short note to keep the offline history clear for the team.
          </div>

          <label className="grid gap-2">
            <span className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted">
              Status note (optional)
            </span>
            <textarea
              value={action.notes}
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="Add a note for this status update"
              rows={4}
              disabled={updating}
              className="min-h-[120px] rounded-2xl border border-[var(--border-soft)] bg-[rgba(248,251,255,0.92)] px-4 py-3 text-sm leading-6 text-[var(--text-strong)] outline-none transition placeholder:text-muted focus:border-[var(--accent)] focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
        </div>

        <div className="desktop-modal-footer flex shrink-0 flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-7 sm:py-6 lg:px-8 lg:py-7">
          <button
            className="secondary-btn inline-flex min-h-[52px] items-center justify-center px-8 text-[0.9rem] sm:min-w-[160px]"
            type="button"
            onClick={onClose}
            disabled={updating}
          >
            Cancel
          </button>
          <button
            className="primary-btn inline-flex min-h-[52px] items-center justify-center px-8 text-[0.9rem] sm:min-w-[220px]"
            type="button"
            onClick={onConfirm}
            disabled={updating}
          >
            {updating ? 'Updating...' : buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeliveryDispatchScreen({ appState, onOutboxChanged }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const [sales, setSales] = useState<DesktopSaleRecord[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, DesktopDispatchStatusRecord>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSale, setSelectedSale] = useState<DesktopSaleRecord | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(10);
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [advanceAction, setAdvanceAction] = useState<DispatchAdvanceAction | null>(null);

  async function loadData(): Promise<void> {
    setLoading(true);
    try {
      const [allSales, allStatuses] = await Promise.all([
        desktopDb.listSales(),
        desktopDeliveryService.listDispatchStatuses()
      ]);
      const deliverySales = allSales.filter(
        (sale) => sale.payload.saleType === 'DELIVERY' && sale.saleStatus !== 'CANCELLED'
      );
      setSales(deliverySales);
      setStatusMap(allStatuses);
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Failed to load delivery orders.'
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // reload if the active branch or location changes
  }, [appState.setup.branchId, appState.setup.locationId]);

  const filteredSales = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return sales.filter((sale) => {
      const effectiveStatus = getEffectiveStatus(statusMap, sale.id);
      if (statusFilter !== 'ALL' && effectiveStatus !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        sale.receiptNumber,
        sale.payload.customerName,
        sale.payload.notes,
        getDriverName(sale),
        getHelperName(sale),
        ...sale.payload.lines.flatMap((line) => [line.productName, line.subtitle ?? ''])
      ]
        .filter((value): value is string => Boolean(value && value.trim().length > 0))
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [sales, statusMap, statusFilter, searchTerm]);

  const metrics = useMemo(
    () => ({
      ALL: sales.length,
      PENDING: sales.filter((sale) => getEffectiveStatus(statusMap, sale.id) === 'PENDING').length,
      TRANSIT: sales.filter((sale) => getEffectiveStatus(statusMap, sale.id) === 'TRANSIT').length,
      DELIVERED: sales.filter((sale) => getEffectiveStatus(statusMap, sale.id) === 'DELIVERED').length,
      COMPLETED: sales.filter((sale) => getEffectiveStatus(statusMap, sale.id) === 'COMPLETED').length
    }),
    [sales, statusMap]
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, pageSize]);

  useEffect(() => {
    setDispatchNotes('');
  }, [selectedSale?.id]);

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedSales = filteredSales.slice((safePage - 1) * pageSize, safePage * pageSize);
  const visiblePageButtons = useMemo(() => {
    const start = Math.max(1, safePage - 1);
    const end = Math.min(totalPages, start + 2);
    const buttons: number[] = [];
    for (let page = Math.max(1, end - 2); page <= end; page += 1) {
      buttons.push(page);
    }
    return buttons;
  }, [safePage, totalPages]);

  const statusFilterButtons: Array<{ id: StatusFilter; label: string }> = [
    { id: 'ALL', label: 'All' },
    { id: 'PENDING', label: 'Pending' },
    { id: 'TRANSIT', label: 'In Transit' },
    { id: 'DELIVERED', label: 'Delivered' },
    { id: 'COMPLETED', label: 'Completed' }
  ];

  async function handleAdvanceStatus(
    sale: DesktopSaleRecord,
    next: DesktopDispatchStatusRecord['status'],
    notes?: string
  ): Promise<boolean> {
    setUpdatingId(sale.id);
    try {
      await desktopDeliveryService.updateDispatchStatus(sale.id, next, notes);
      await loadData();
      if (onOutboxChanged) {
        await onOutboxChanged();
      }
      setDispatchNotes('');
      desktopUi.showToast({
        tone: 'success',
        message: `${sale.payload.customerName ?? 'Order'} marked as ${statusLabel(next as DispatchStatus)}.`
      });
      return true;
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Failed to update delivery status.'
      });
      return false;
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleConfirmAdvanceAction(): Promise<void> {
    if (!advanceAction) {
      return;
    }
    const success = await handleAdvanceStatus(
      advanceAction.sale,
      advanceAction.nextStatus,
      advanceAction.notes
    );
    if (success) {
      setAdvanceAction(null);
    }
  }

  const branchLocationLabel =
    appState.setup.branchLabel && appState.setup.locationLabel
      ? `${appState.setup.branchLabel} / ${appState.setup.locationLabel}`
      : 'Delivery orders from POS - track and advance status per order';

  return (
    <div className={screenStackClass}>
      <div className={shellCardClass}>
        <div className="flex flex-col gap-2">
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-muted">
            Add-on Workspace
          </p>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[1.6rem] font-extrabold tracking-[-0.03em] text-[var(--text-strong)]">
                Delivery Dispatch
              </h1>
              <p className="mt-1 text-sm text-[var(--muted)]">{branchLocationLabel}</p>
            </div>
            <div className="text-xs font-semibold text-muted">
              Dispatch queue, rider handoff, and status tracking
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Pending" value={metrics.PENDING} status="PENDING" />
          <MetricCard label="In Transit" value={metrics.TRANSIT} status="TRANSIT" />
          <MetricCard label="Delivered" value={metrics.DELIVERED} status="DELIVERED" />
          <MetricCard label="Completed" value={metrics.COMPLETED} status="COMPLETED" />
        </div>
      </div>

      <div className={shellCardClass}>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)_auto] xl:items-start">
          <SearchField
            value={searchTerm}
            onChange={(value) => {
              setSearchTerm(value);
              setCurrentPage(1);
            }}
            placeholder="Search by customer, order no., driver..."
            className="text-[0.9rem]"
          />

          <div className="flex flex-wrap items-center gap-2 xl:justify-center">
            {statusFilterButtons.map((filter) => {
              const active = statusFilter === filter.id;
              const count = filter.id === 'ALL' ? metrics.ALL : metrics[filter.id];
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => {
                    setStatusFilter(filter.id);
                    setCurrentPage(1);
                  }}
                  className={`filter-chip ${active ? 'active' : ''}`}
                >
                  {filter.label}
                  {filter.id === 'ALL' ? '' : ` (${count})`}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-muted">Loading delivery orders...</div>
        ) : sales.length === 0 ? (
          <div className="py-12 text-center">
            <DispatchIcon className="mx-auto mb-3 h-10 w-10 opacity-25">
              <rect x="1" y="3" width="15" height="13" rx="2" />
              <path d="M16 8h4l3 3v5h-7V8z" />
              <circle cx="5.5" cy="18.5" r="2.5" />
              <circle cx="18.5" cy="18.5" r="2.5" />
            </DispatchIcon>
            <div className="text-sm font-semibold text-text">No delivery orders</div>
            <div className="mt-1 text-xs text-muted">No delivery orders match this filter yet.</div>
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-sm font-semibold text-text">No delivery orders</div>
            <div className="mt-1 text-xs text-muted">No delivery orders match this filter yet.</div>
          </div>
        ) : (
          <>
            <div className="mt-4 border-t border-[var(--border-soft)] pt-4">
              <div className={`${dispatchListHeaderClass} ${dispatchListGridClass}`}>
                <span>Status</span>
                <span>Customer</span>
                <span>Order No.</span>
                <span>Date</span>
                <span>Driver</span>
                <span>Items</span>
                <span>Amount</span>
                <span>Action</span>
              </div>

              <div className="mt-3 space-y-3">
                {pagedSales.map((sale) => {
                  const dispatchStatus = getEffectiveStatus(statusMap, sale.id);
                  const nextStatus = STATUS_NEXT[dispatchStatus];
                  const driverName = getDriverName(sale);
                  const isUpdating = updatingId === sale.id;
                  const tone = dispatchListTone(dispatchStatus);
                  const noteSnippet = sale.payload.notes?.trim() || branchLocationLabel;

                  return (
                    <article
                      key={sale.id}
                      className={`${dispatchListRowClass} ${dispatchListGridClass}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedSale(sale)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedSale(sale);
                        }
                      }}
                    >
                      <span className={`absolute inset-y-0 left-0 w-[4px] rounded-full ${tone.accent}`} aria-hidden="true" />

                      <div className="flex min-w-0 items-start gap-3 xl:flex-col xl:gap-2">
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${tone.icon}`}>
                          <DispatchIcon className="h-[16px] w-[16px]">{statusIcon(dispatchStatus)}</DispatchIcon>
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-[0.69rem] font-bold uppercase tracking-[0.12em] ${tone.badge}`}>
                          {statusLabel(dispatchStatus)}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="min-w-0 text-left"
                        onClick={() => setSelectedSale(sale)}
                      >
                        <div className="text-[0.94rem] font-bold leading-5 text-[var(--text-strong)]">
                          {sale.payload.customerName ?? 'Walk-in Customer'}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[0.74rem] text-[var(--muted)]">
                          <DispatchIcon className="h-[13px] w-[13px]">
                            <circle cx="12" cy="8" r="3" />
                            <path d="M5 19c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5" />
                          </DispatchIcon>
                          <span className="line-clamp-1">{noteSnippet}</span>
                        </div>
                      </button>

                      <div className="min-w-0">
                        <div className={dispatchListCellValueClass}>#{sale.receiptNumber}</div>
                      </div>

                      <div className="min-w-0">
                        <div className={dispatchListCellValueClass}>{fmtDispatchDate(sale.createdAt)}</div>
                        <div className={dispatchListCellMutedClass}>{fmtDispatchTime(sale.createdAt)}</div>
                      </div>

                      <div className="min-w-0">
                        <div className={dispatchListCellValueClass}>{driverName ?? 'Unassigned'}</div>
                      </div>

                      <div className="min-w-0">
                        <div className={dispatchListCellValueClass}>{getItemsSummary(sale)}</div>
                      </div>

                      <div className="min-w-0 xl:text-right">
                        <div className="text-[1.04rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)]">
                          {fmtMoney(sale.payload.totalAmount)}
                        </div>
                      </div>

                      <div className="grid justify-items-start gap-2 xl:justify-items-end">
                        <button
                          className="secondary-btn mini-btn min-w-[110px]"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedSale(sale);
                          }}
                        >
                          View Details
                        </button>
                        {nextStatus ? (
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={(event) => {
                              event.stopPropagation();
                              setAdvanceAction({
                                sale,
                                currentStatus: dispatchStatus,
                                nextStatus,
                                notes: ''
                              });
                            }}
                            className={`${dispatchListActionButtonClass} min-w-[110px] ${tone.action} ${isUpdating ? 'opacity-60' : ''}`}
                          >
                            {isUpdating ? 'Updating...' : STATUS_ACTION_LABEL[dispatchStatus]}
                          </button>
                        ) : (
                          <div className={`${dispatchListActionDoneClass} min-w-[110px]`}>
                            Done
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-[var(--border-soft)] pt-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="text-xs text-muted">
                  Showing {(safePage - 1) * pageSize + 1} to {Math.min(safePage * pageSize, filteredSales.length)} of {filteredSales.length} records
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    className="secondary-btn mini-btn"
                    aria-label="Previous page"
                  >
                    Previous
                  </button>

                  {visiblePageButtons.map((page) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      className={page === safePage ? 'primary-btn mini-btn' : 'secondary-btn mini-btn'}
                    >
                      {page}
                    </button>
                  ))}

                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    className="secondary-btn mini-btn"
                    aria-label="Next page"
                  >
                    Next
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted">
                    Page {safePage} of {totalPages}
                  </span>
                  <select
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className="min-h-[42px] rounded-[14px] border border-[var(--border-soft)] bg-white px-3 text-xs font-semibold text-[var(--text-strong)]"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size} per page
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {selectedSale ? (
        <DispatchDetailModal
          sale={selectedSale}
          dispatchStatus={getEffectiveStatus(statusMap, selectedSale.id)}
          statusRecord={statusMap[selectedSale.id] ?? null}
          updating={updatingId === selectedSale.id}
          statusNotes={dispatchNotes}
          onStatusNotesChange={setDispatchNotes}
          onClose={() => {
            setSelectedSale(null);
            setDispatchNotes('');
          }}
          onAdvanceStatus={(next, notes) => void handleAdvanceStatus(selectedSale, next, notes)}
        />
      ) : null}

      {advanceAction ? (
        <DispatchAdvanceModal
          action={advanceAction}
          updating={updatingId === advanceAction.sale.id}
          onClose={() => setAdvanceAction(null)}
          onNotesChange={(value) =>
            setAdvanceAction((current) => (current ? { ...current, notes: value } : current))
          }
          onConfirm={() => void handleConfirmAdvanceAction()}
        />
      ) : null}
    </div>
  );
}
