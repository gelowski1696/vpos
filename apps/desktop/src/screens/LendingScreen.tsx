import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DesktopAppState, DesktopLendingDetail, DesktopLendingReturnDraft, DesktopLendingRecord } from '../db/schema';
import { desktopDb } from '../db/sqlite';
import { desktopLendingService } from '../services/desktop-lending.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopSettingsService } from '../services/desktop-settings.service';
import { SearchField } from '../components/inputs/SearchField';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';

const RETURN_CONDITIONS = ['GOOD', 'DAMAGED', 'LOST'] as const;

type Props = {
  appState: DesktopAppState;
  onStateReload?: () => Promise<void> | void;
};

type LendingFilter = 'all' | 'OPEN' | 'PARTIALLY_RETURNED' | 'OVERDUE' | 'CLOSED';

type ReturnLineState = {
  returnedQty: string;
  condition: (typeof RETURN_CONDITIONS)[number];
};

type PendingReturnOutboxLine = {
  lendingLineId: string;
  returnedQty: number;
  condition: 'GOOD' | 'DAMAGED' | 'LOST';
  remarks: string | null;
};

type PendingReturnOutboxEntry = {
  lendingId: string;
  createdAt: string;
  remarks: string | null;
  lines: PendingReturnOutboxLine[];
};

type LendingOverviewMetricTone = 'good' | 'accent' | 'warn' | 'neutral';
type LendingOverviewMetricIcon = 'open' | 'partial' | 'overdue' | 'queued';

type LendingOverviewMetric = {
  key: string;
  label: string;
  value: string;
  icon: LendingOverviewMetricIcon;
  tone: LendingOverviewMetricTone;
};

type LendingManagementOverviewProps = {
  title: string;
  subtitle: string;
  metrics: LendingOverviewMetric[];
  onRefresh: () => void;
  refreshDisabled: boolean;
};

type LendingRecordRowProps = {
  receiptLabel: string;
  customerLabel: string;
  itemSummary: string;
  qtyLentLabel: string;
  returnedLabel: string;
  openLabel: string;
  openedDateLabel: string;
  openedTimeLabel: string;
  noteLabel: string;
  statusBadgeLabel: string;
  statusTone: 'open' | 'partial' | 'overdue' | 'closed';
  selected?: boolean;
  onClick: () => void;
};

type LendingFilterChipProps = {
  label: string;
  count: string;
  active: boolean;
  onClick: () => void;
};

type LendingDetailMetricTone = 'accent' | 'good' | 'warn' | 'purple' | 'neutral';

type LendingDetailMetricCardProps = {
  iconKind: 'detail' | 'open' | 'lent' | 'returned' | 'openqty';
  label: string;
  value: string;
  tone: LendingDetailMetricTone;
};

type LendingDetailInfoTone = 'accent' | 'good' | 'warn' | 'purple' | 'neutral';

type LendingDetailInfoCardProps = {
  iconKind: 'customer' | 'receipt' | 'note' | 'payment' | 'method' | 'posted';
  label: string;
  value: string;
  tone: LendingDetailInfoTone;
};

type LendingDepositPaymentSummary = {
  amount: number;
  method: string | null;
  postedAt: string;
  notes: string | null;
};

type LendingDetailModalContentProps = {
  record: DesktopLendingRecord;
  receiptLabel: string;
  customerLabel: string;
  itemSummary: string;
  detail: DesktopLendingDetail | null;
  depositPayment: LendingDepositPaymentSummary;
  loadingDetail: boolean;
  onClose: () => void;
  onOpenReturn: () => void;
  returnDisabled: boolean;
};

const screenStackClass = 'flex flex-col gap-5';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const listRowBodyTextClass = 'text-[0.9rem] text-[var(--muted)]';
const modalBackdropClass = 'desktop-modal-backdrop';
const modalCardClass =
  'desktop-modal-card desktop-modal-card--detail';
const actionModalCardClass =
  'desktop-modal-card desktop-modal-card--action';
const modalToolbarClass =
  'desktop-modal-header flex shrink-0 flex-col gap-4';
const detailMetricGridClass = 'grid gap-3 md:grid-cols-2 xl:grid-cols-4';
const detailCardClass =
  'grid gap-1 rounded-[20px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_10px_24px_rgba(17,40,58,0.04)]';
const detailLabelClass = 'text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const detailValueClass = 'text-[1rem] font-extrabold text-[var(--text-strong)]';
const infoListItemClass =
  'grid gap-1 rounded-[18px] border border-[var(--border-soft)] bg-white px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]';
const sectionCardClass =
  'grid gap-4 rounded-[24px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_12px_28px_rgba(17,40,58,0.05)]';
const lendingLineRowClass = 'desktop-line-item-row desktop-line-item-row--compact';

function LendingPageIcon({
  path,
  className = ''
}: {
  path: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-[20px] w-[20px] ${className}`.trim()}
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

function LendingPageSymbol({
  kind,
  className = ''
}: {
  kind:
    | 'lending'
    | 'refresh'
    | 'detail'
    | 'customer'
    | 'receipt'
    | 'note'
    | 'payment'
    | 'method'
    | 'posted'
    | 'item'
    | 'return'
    | 'lent'
    | 'returned'
    | 'openqty'
    | LendingOverviewMetricIcon
    | 'closed';
  className?: string;
}): JSX.Element {
  let path: ReactNode;
  if (kind === 'lending') {
    path = (
      <>
        <path d="M7 5.5h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />
        <path d="M9 5.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.5" />
        <path d="M8.5 10.5h7" />
        <path d="M12 8.5v4" />
      </>
    );
  } else if (kind === 'detail' || kind === 'receipt') {
    path = (
      <>
        <rect x="6" y="4.5" width="12" height="15" rx="2.4" />
        <path d="M9.5 4.5V3.7A1.2 1.2 0 0 1 10.7 2.5h2.6a1.2 1.2 0 0 1 1.2 1.2v.8" />
        <path d="M9 9h6" />
        <path d="M9 12h6" />
        <path d="M9 15h4.5" />
      </>
    );
  } else if (kind === 'customer') {
    path = (
      <>
        <circle cx="12" cy="8.2" r="3.1" />
        <path d="M6 18a6 6 0 0 1 12 0" />
      </>
    );
  } else if (kind === 'note') {
    path = (
      <>
        <path d="M7 4.5h7l3 3V18a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 18V6A1.5 1.5 0 0 1 7.5 4.5Z" />
        <path d="M14 4.5V8h3" />
      </>
    );
  } else if (kind === 'payment') {
    path = (
      <>
        <path d="M4.5 8.5h15v8a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8Z" />
        <path d="M7 8.5V7a2.5 2.5 0 0 1 5 0v1.5" />
        <path d="M11.5 12.5h3.5" />
      </>
    );
  } else if (kind === 'method') {
    path = (
      <>
        <rect x="4" y="6" width="16" height="12" rx="2.4" />
        <path d="M4 10h16" />
        <path d="M8 14h3" />
      </>
    );
  } else if (kind === 'posted') {
    path = (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2.5" />
      </>
    );
  } else if (kind === 'item') {
    path = (
      <>
        <path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z" />
        <path d="M4 15.5 12 20l8-4.5" />
        <path d="M4 12 12 16.5 20 12" />
      </>
    );
  } else if (kind === 'return') {
    path = (
      <>
        <path d="M7 7h8a3 3 0 0 1 0 6H8.5" />
        <path d="m8.5 10-3 3 3 3" />
        <path d="M10 17h6" />
      </>
    );
  } else if (kind === 'lent') {
    path = (
      <>
        <path d="M12 4v10" />
        <path d="m8.5 7 3.5-3 3.5 3" />
        <path d="M6 16.5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V11h-4v3H10v-3H6Z" />
      </>
    );
  } else if (kind === 'returned') {
    path = (
      <>
        <path d="M12 20V10" />
        <path d="m15.5 17-3.5 3-3.5-3" />
        <path d="M6 7.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2V13h-4v-3H10v3H6Z" />
      </>
    );
  } else if (kind === 'openqty') {
    path = (
      <>
        <path d="M7 8h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
        <path d="M9 8V6.7A3 3 0 0 1 12 3.7a3 3 0 0 1 3 3V8" />
      </>
    );
  } else if (kind === 'open') {
    path = (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12 2.2 2.2L15.5 9.5" />
      </>
    );
  } else if (kind === 'partial') {
    path = (
      <>
        <path d="M8 7h8" />
        <path d="M8 12h6" />
        <path d="M8 17h4" />
        <path d="M16.5 14.5 20 18l-3.5 3.5" />
      </>
    );
  } else if (kind === 'overdue') {
    path = (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </>
    );
  } else if (kind === 'queued') {
    path = (
      <>
        <path d="M7 6h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-4H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
        <path d="M10 10h4" />
        <path d="M10 13h6" />
      </>
    );
  } else if (kind === 'closed') {
    path = (
      <>
        <rect x="6" y="8" width="12" height="12" rx="2.5" />
        <path d="M9 8V6.5A3 3 0 0 1 12 3.5a3 3 0 0 1 3 3V8" />
        <path d="m9.5 13 1.8 1.8L15 11.1" />
      </>
    );
  } else {
    path = (
      <>
        <path d="M20 11a8 8 0 1 0 2 5.3" />
        <path d="M20 4v7h-7" />
      </>
    );
  }
  return <LendingPageIcon path={path} className={className} />;
}

function lendingOverviewTone(
  tone: LendingOverviewMetricTone
): {
  shell: string;
  icon: string;
  label: string;
  line: string;
} {
  if (tone === 'good') {
    return {
      shell: 'border-[rgba(182,226,194,0.78)] bg-[rgba(255,255,255,0.98)]',
      icon: 'border-[rgba(182,226,194,0.72)] bg-[rgba(238,250,242,0.98)] text-[#1f9b4d]',
      label: 'text-[#1f9b4d]',
      line: 'from-[#7fe3a1] via-[#41c96f] to-[#27ae60]'
    };
  }
  if (tone === 'warn') {
    return {
      shell: 'border-[rgba(250,210,132,0.82)] bg-[rgba(255,255,255,0.98)]',
      icon: 'border-[rgba(250,210,132,0.72)] bg-[rgba(255,247,229,0.98)] text-[#d08a08]',
      label: 'text-[#c67700]',
      line: 'from-[#ffd98b] via-[#f4b64b] to-[#e29a10]'
    };
  }
  if (tone === 'accent') {
    return {
      shell: 'border-[rgba(196,220,255,0.82)] bg-[rgba(255,255,255,0.98)]',
      icon: 'border-[rgba(196,220,255,0.72)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]',
      label: 'text-[var(--accent-strong)]',
      line: 'from-[#9ec7ff] via-[#5294ff] to-[#1f74ea]'
    };
  }
  return {
    shell: 'border-[rgba(207,218,232,0.82)] bg-[rgba(255,255,255,0.98)]',
    icon: 'border-[rgba(207,218,232,0.72)] bg-[rgba(245,248,252,0.98)] text-[var(--muted-strong)]',
    label: 'text-[var(--muted-strong)]',
    line: 'from-[#d7dfeb] via-[#aab7ca] to-[#6f819d]'
  };
}

function lendingStatusTone(status: DesktopLendingRecord['status']): LendingRecordRowProps['statusTone'] {
  if (status === 'PARTIALLY_RETURNED') return 'partial';
  if (status === 'OVERDUE') return 'overdue';
  if (status === 'CLOSED' || status === 'FORCE_CLOSED') return 'closed';
  return 'open';
}

function lendingFilterLabel(filter: LendingFilter): string {
  if (filter === 'all') return 'All Records';
  return friendlyStatus(filter);
}

export function LendingManagementOverview({
  title,
  subtitle,
  metrics,
  onRefresh,
  refreshDisabled
}: LendingManagementOverviewProps): JSX.Element {
  return (
    <div className="lending-management-overview grid gap-5">
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <LendingPageSymbol kind="lending" className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">
              {title}
            </h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2.5 xl:justify-end">
          <button
            className="secondary-btn min-h-[46px] px-4 text-[0.86rem]"
            type="button"
            onClick={onRefresh}
            disabled={refreshDisabled}
          >
            Refresh
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const tone = lendingOverviewTone(metric.tone);
          return (
            <article
              key={metric.key}
              className={`grid gap-3 overflow-hidden rounded-[20px] border px-4 py-3.5 shadow-[0_10px_22px_rgba(17,40,58,0.05)] ${tone.shell}`}
            >
              <div className="flex items-start gap-3">
                <div className={`grid h-[50px] w-[50px] shrink-0 place-items-center rounded-full border ${tone.icon}`}>
                  <LendingPageSymbol kind={metric.icon} className="h-[21px] w-[21px]" />
                </div>
                <div className="min-w-0">
                  <div className={`text-[0.82rem] font-semibold ${tone.label}`}>{metric.label}</div>
                  <strong className="mt-1.5 block text-[0.98rem] font-extrabold tracking-[-0.01em] text-[var(--text-strong)] sm:text-[1.08rem]">
                    {metric.value}
                  </strong>
                </div>
              </div>
              <div className={`h-[4px] rounded-full bg-gradient-to-r ${tone.line}`} />
            </article>
          );
        })}
      </section>
    </div>
  );
}

export function LendingRecordRow({
  receiptLabel,
  customerLabel,
  itemSummary,
  qtyLentLabel,
  returnedLabel,
  openLabel,
  openedDateLabel,
  openedTimeLabel,
  noteLabel,
  statusBadgeLabel,
  statusTone,
  selected = false,
  onClick
}: LendingRecordRowProps): JSX.Element {
  const renderSummaryChip = (
    value: string,
    tone: 'good' | 'accent' | 'warn'
  ): JSX.Element => {
    const separatorIndex = value.indexOf(':');
    const label = separatorIndex >= 0 ? value.slice(0, separatorIndex).trim() : value.trim();
    const amount = separatorIndex >= 0 ? value.slice(separatorIndex + 1).trim() : '';
    return (
      <span className={`lending-record-row-chip ${tone}`}>
        <span className="lending-record-row-chip-dot" aria-hidden="true" />
        <span className="lending-record-row-chip-label">{label}</span>
        {amount ? <strong className="lending-record-row-chip-value">{amount}</strong> : null}
      </span>
    );
  };

  return (
    <button
      type="button"
      className={`lending-record-row ${selected ? 'is-selected' : ''}`}
      onClick={onClick}
    >
      <div className={`lending-record-row-icon ${statusTone}`}>
        <LendingPageSymbol kind={statusTone === 'closed' ? 'closed' : statusTone} className="lending-record-row-icon-svg" />
      </div>
      <div className="lending-record-row-main">
        <div className="lending-record-row-head">
          <div className="lending-record-row-head-copy">
            <strong className="lending-record-row-receipt">{receiptLabel}</strong>
            <span className="lending-record-row-customer">{customerLabel}</span>
          </div>
          <span className={`lending-record-row-badge ${statusTone}`}>{statusBadgeLabel}</span>
        </div>
        <div className="lending-record-row-summary">{itemSummary}</div>
        <div className="lending-record-row-chips">
          {renderSummaryChip(qtyLentLabel, 'good')}
          {renderSummaryChip(returnedLabel, 'accent')}
          {renderSummaryChip(openLabel, 'warn')}
        </div>
        <div className="lending-record-row-footer">
          <span>{openedDateLabel}</span>
          <span>{openedTimeLabel}</span>
          <span>{noteLabel}</span>
        </div>
      </div>
    </button>
  );
}

function LendingFilterChip({
  label,
  count,
  active,
  onClick
}: LendingFilterChipProps): JSX.Element {
  return (
    <button
      type="button"
      className={`lending-records-filter-chip ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <span className="lending-records-filter-chip-label">{label}</span>
      <span className="lending-records-filter-chip-count">{count}</span>
    </button>
  );
}

function lendingStatusBadgeLabel(status: DesktopLendingRecord['status']): string {
  if (status === 'PARTIALLY_RETURNED') return 'PARTIAL';
  if (status === 'FORCE_CLOSED') return 'CLOSED';
  return status.replace(/_/g, ' ');
}

function lendingDetailMetricToneClass(tone: LendingDetailMetricTone): string {
  if (tone === 'good') return 'good';
  if (tone === 'warn') return 'warn';
  if (tone === 'purple') return 'purple';
  if (tone === 'neutral') return 'neutral';
  return 'accent';
}

function lendingDetailInfoToneClass(tone: LendingDetailInfoTone): string {
  if (tone === 'good') return 'good';
  if (tone === 'warn') return 'warn';
  if (tone === 'purple') return 'purple';
  if (tone === 'accent') return 'accent';
  return 'neutral';
}

function LendingDetailMetricCard({
  iconKind,
  label,
  value,
  tone
}: LendingDetailMetricCardProps): JSX.Element {
  return (
    <div className="lending-detail-metric-card">
      <div className={`lending-detail-metric-icon ${lendingDetailMetricToneClass(tone)}`}>
        <LendingPageSymbol kind={iconKind} className="lending-detail-metric-icon-svg" />
      </div>
      <div className="lending-detail-metric-copy">
        <span className="lending-detail-metric-label">{label}</span>
        <strong className="lending-detail-metric-value">{value}</strong>
      </div>
    </div>
  );
}

function LendingDetailInfoCard({
  iconKind,
  label,
  value,
  tone
}: LendingDetailInfoCardProps): JSX.Element {
  return (
    <div className="lending-detail-info-card">
      <div className={`lending-detail-info-icon ${lendingDetailInfoToneClass(tone)}`}>
        <LendingPageSymbol kind={iconKind} className="lending-detail-info-icon-svg" />
      </div>
      <div className="lending-detail-info-copy">
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    </div>
  );
}

export function LendingDetailModalContent({
  record,
  receiptLabel,
  customerLabel,
  itemSummary,
  detail,
  depositPayment,
  loadingDetail,
  onClose,
  onOpenReturn,
  returnDisabled
}: LendingDetailModalContentProps): JSX.Element {
  const hasDepositPayment = depositPayment.amount > 0;
  const statusLabel = lendingStatusBadgeLabel(record.status);

  return (
    <>
      <div className={`${modalToolbarClass} lending-detail-modal-head`}>
        <div className="lending-detail-hero">
          <div className="lending-detail-hero-tile">
            <LendingPageSymbol kind="detail" className="lending-detail-hero-tile-svg" />
          </div>
          <div className="lending-detail-hero-copy">
            <div className="eyebrow">Lending detail</div>
            <h3>{`Receipt #${receiptLabel}`}</h3>
            <div className="lending-detail-hero-meta">
              <span>
                <LendingPageSymbol kind="customer" className="lending-detail-hero-meta-icon" />
                {customerLabel}
              </span>
              <span>
                <LendingPageSymbol kind="item" className="lending-detail-hero-meta-icon" />
                {itemSummary}
              </span>
            </div>
            <button
              className="secondary-btn lending-detail-return-btn"
              type="button"
              onClick={onOpenReturn}
              disabled={returnDisabled}
            >
              <LendingPageSymbol kind="return" className="h-[16px] w-[16px]" />
              <span>Record Return</span>
            </button>
          </div>
        </div>
        <button
          className="secondary-btn mini-btn modal-close-icon-btn"
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          title="Close"
        >
          <span aria-hidden="true">X</span>
        </button>
      </div>

      <div className="desktop-modal-body lending-detail-modal-body">
        <div className="lending-detail-metric-grid">
          <LendingDetailMetricCard iconKind="open" label="Status" value={statusLabel} tone="accent" />
          <LendingDetailMetricCard iconKind="lent" label="Qty Lent" value={fmtNumber(record.total_quantity_lent)} tone="neutral" />
          <LendingDetailMetricCard iconKind="returned" label="Qty Returned" value={fmtNumber(record.total_quantity_returned)} tone="good" />
          <LendingDetailMetricCard iconKind="openqty" label="Open Qty" value={fmtNumber(openQuantity(record))} tone="purple" />
        </div>

        <section className="lending-detail-section">
          <div className="lending-detail-section-head">
            <div>
              <div className="eyebrow">Lending Context</div>
              <h4>Receipt and customer notes</h4>
            </div>
          </div>
          <dl className="lending-detail-info-grid lending-detail-info-grid--three">
            <LendingDetailInfoCard iconKind="customer" label="Customer" value={customerLabel} tone="accent" />
            <LendingDetailInfoCard iconKind="receipt" label="Receipt Number" value={receiptLabel} tone="good" />
            <LendingDetailInfoCard
              iconKind="note"
              label="Remarks"
              value={record.remarks || 'No lending note recorded.'}
              tone="warn"
            />
          </dl>
        </section>

        <section className="lending-detail-section">
          <div className="lending-detail-section-head">
            <div>
              <div className="eyebrow">Deposit Payment</div>
              <h4>Collected when lending was saved</h4>
            </div>
          </div>
          <dl className="lending-detail-info-grid lending-detail-info-grid--three">
            <LendingDetailInfoCard iconKind="payment" label="Amount" value={fmtMoney(depositPayment.amount)} tone="good" />
            <LendingDetailInfoCard
              iconKind="method"
              label="Method"
              value={formatPaymentMethod(depositPayment.method)}
              tone="purple"
            />
            <LendingDetailInfoCard
              iconKind="posted"
              label="Posted"
              value={hasDepositPayment ? new Date(depositPayment.postedAt).toLocaleString() : 'Not recorded'}
              tone="accent"
            />
          </dl>
          <div className="lending-detail-note-banner">
            {hasDepositPayment
              ? depositPayment.notes || 'Deposit payment was recorded when this lending was created.'
              : 'No deposit payment has been recorded for this lending yet.'}
          </div>
        </section>

        <section className="lending-detail-section">
          <div className="lending-detail-section-head">
            <div>
              <div className="eyebrow">Lent Items</div>
              <h4>{loadingDetail ? 'Loading line detail...' : 'Current lines'}</h4>
            </div>
          </div>
          {!detail ? (
            <div className="lending-detail-empty-state">
              <LendingPageSymbol kind="posted" className="lending-detail-empty-state-icon" />
              <span>Full line detail is not cached for this record yet. Open it once while online to store the detail on this desktop.</span>
            </div>
          ) : (
            <div className="lending-detail-lines-table">
              <div className="lending-detail-lines-head">
                <span>Item</span>
                <span>Qty Lent</span>
                <span>Qty Returned</span>
              </div>
              <div className="lending-detail-lines-body">
                {detail.lines.map((line) => (
                  <div key={line.lending_line_id} className="lending-detail-line-row">
                    <div className="lending-detail-line-main">
                      <div className="lending-detail-line-icon">
                        <LendingPageSymbol kind="item" className="lending-detail-line-icon-svg" />
                      </div>
                      <div className="lending-detail-line-copy">
                        <strong>{line.product_sku || line.product_id || '-'}</strong>
                        <span>{line.product_name || line.product_id}</span>
                        <span>{`Qty Lent: ${fmtNumber(line.quantity_lent)} | Returned: ${fmtNumber(line.quantity_returned)} | Open: ${fmtNumber(line.quantity_open)}`}</span>
                      </div>
                    </div>
                    <strong className="lending-detail-line-number">{fmtNumber(line.quantity_lent)}</strong>
                    <strong className="lending-detail-line-number">{fmtNumber(line.quantity_returned)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="lending-detail-section">
          <div className="lending-detail-section-head">
            <div>
              <div className="eyebrow">Return History</div>
              <h4>Recorded returns</h4>
            </div>
          </div>
          {!detail || detail.returns.length === 0 ? (
            <div className="lending-detail-empty-state">
              <LendingPageSymbol kind="posted" className="lending-detail-empty-state-icon" />
              <span>No return history is cached for this desktop record yet.</span>
            </div>
          ) : (
            <div className="lending-detail-return-list">
              {detail.returns.map((entry) => (
                <article key={entry.lending_return_id} className="lending-detail-return-row">
                  <div className="lending-detail-return-main">
                    <strong>{`Qty Returned: ${fmtNumber(entry.returned_qty)} | Condition: ${entry.condition}`}</strong>
                    <span>{entry.received_by_name || 'Branch staff'}</span>
                  </div>
                  <div className="lending-detail-return-side">
                    <strong>{new Date(entry.returned_at).toLocaleDateString()}</strong>
                    <span>{entry.remarks || 'No return note'}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function fmtNumber(value: number): string {
  return Number(value).toFixed(2).replace(/\.00$/, '');
}

function fmtMoney(value: number): string {
  return `PHP ${Number(value).toFixed(2)}`;
}

function toWholeNumberInput(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

function parseWholeNumber(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

function formatPaymentMethod(value: unknown): string {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'E_WALLET' || raw === 'EWALLET') {
    return 'E-Wallet';
  }
  if (raw === 'CARD') {
    return 'Card';
  }
  if (raw === 'CASH') {
    return 'Cash';
  }
  return raw || '-';
}

function friendlyStatus(status: DesktopLendingRecord['status']): string {
  switch (status) {
    case 'PARTIALLY_RETURNED':
      return 'Partial Return';
    case 'FORCE_CLOSED':
      return 'Force Closed';
    default:
      return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function openQuantity(record: DesktopLendingRecord): number {
  return Number((record.total_quantity_lent - record.total_quantity_returned).toFixed(3));
}

function isLikelyLocalPendingLending(detail: DesktopLendingDetail): boolean {
  if (detail.lending_id.startsWith('desktop-lending-') || detail.lending_id.startsWith('local-')) {
    return true;
  }
  return detail.lines.some((line) => line.lending_line_id.startsWith(`${detail.lending_id}-line-`));
}

function normalizeOutboxStatus(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function isPendingOutboxStatus(value: string | null | undefined): boolean {
  const status = normalizeOutboxStatus(value);
  return status === 'PENDING' || status === 'PROCESSING' || status === 'FAILED' || status === 'NEEDS_REVIEW';
}

function applyPendingReturnsToRecord(
  record: DesktopLendingRecord,
  pendingEntries: PendingReturnOutboxEntry[] | undefined
): DesktopLendingRecord {
  if (!pendingEntries?.length) {
    return record;
  }
  const recordUpdatedAtMs = Number.isFinite(new Date(record.updated_at).getTime())
    ? new Date(record.updated_at).getTime()
    : 0;
  const extraReturned = pendingEntries.reduce((sum, entry) => {
    const entryCreatedAtMs = Number.isFinite(new Date(entry.createdAt).getTime())
      ? new Date(entry.createdAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    if (entryCreatedAtMs <= recordUpdatedAtMs) {
      return sum;
    }
    return sum + entry.lines.reduce((lineSum, line) => lineSum + line.returnedQty, 0);
  }, 0);
  if (!Number.isFinite(extraReturned) || extraReturned <= 0) {
    return record;
  }
  const totalReturned = Number(
    Math.min(record.total_quantity_lent, record.total_quantity_returned + extraReturned).toFixed(3)
  );
  const totalOpen = Number(Math.max(0, record.total_quantity_lent - totalReturned).toFixed(3));
  const status: DesktopLendingRecord['status'] =
    totalOpen <= 0
      ? 'CLOSED'
      : totalReturned > 0
        ? 'PARTIALLY_RETURNED'
        : record.status;
  return {
    ...record,
    status,
    total_quantity_returned: totalReturned
  };
}

function applyPendingReturnsToDetail(
  detail: DesktopLendingDetail,
  pendingEntries: PendingReturnOutboxEntry[] | undefined
): DesktopLendingDetail {
  if (!pendingEntries?.length) {
    return detail;
  }
  const detailUpdatedAtMs = Number.isFinite(new Date(detail.updated_at).getTime())
    ? new Date(detail.updated_at).getTime()
    : 0;
  const extraReturnedByLineId = new Map<string, number>();
  const extraReturns = [] as DesktopLendingDetail['returns'];
  for (const entry of pendingEntries) {
    const entryCreatedAtMs = Number.isFinite(new Date(entry.createdAt).getTime())
      ? new Date(entry.createdAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    if (entryCreatedAtMs <= detailUpdatedAtMs) {
      continue;
    }
    for (const line of entry.lines) {
      if (!line.lendingLineId || !Number.isFinite(line.returnedQty) || line.returnedQty <= 0) {
        continue;
      }
      extraReturnedByLineId.set(
        line.lendingLineId,
        Number(((extraReturnedByLineId.get(line.lendingLineId) ?? 0) + line.returnedQty).toFixed(3))
      );
      extraReturns.push({
        lending_return_id: `pending-${entry.lendingId}-${line.lendingLineId}-${extraReturns.length + 1}`,
        lending_line_id: line.lendingLineId,
        returned_qty: line.returnedQty,
        condition: line.condition,
        remarks: line.remarks ?? entry.remarks,
        received_by_user_id: null,
        received_by_name: 'Pending Sync',
        returned_at: entry.createdAt,
        created_at: entry.createdAt
      });
    }
  }
  if (!extraReturnedByLineId.size) {
    return detail;
  }
  const lines = detail.lines.map((line) => {
    const extraReturned = extraReturnedByLineId.get(line.lending_line_id) ?? 0;
    const quantityReturned = Number((line.quantity_returned + extraReturned).toFixed(3));
    return {
      ...line,
      quantity_returned: quantityReturned,
      quantity_open: Number(Math.max(0, line.quantity_lent - quantityReturned).toFixed(3))
    };
  });
  const totalReturned = Number(lines.reduce((sum, line) => sum + line.quantity_returned, 0).toFixed(3));
  const totalOpen = Number(lines.reduce((sum, line) => sum + line.quantity_open, 0).toFixed(3));
  const status: DesktopLendingRecord['status'] =
    totalOpen <= 0
      ? 'CLOSED'
      : totalReturned > 0
        ? 'PARTIALLY_RETURNED'
        : detail.status;
  return {
    ...detail,
    status,
    total_quantity_returned: totalReturned,
    lines,
    returns: [...extraReturns, ...detail.returns]
  };
}

export function LendingScreen({ appState, onStateReload }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const [records, setRecords] = useState<DesktopLendingRecord[]>([]);
  const [pendingReturnOutboxByLendingId, setPendingReturnOutboxByLendingId] = useState<
    Map<string, PendingReturnOutboxEntry[]>
  >(new Map());
  const [receiptBySaleId, setReceiptBySaleId] = useState<Map<string, string>>(new Map());
  const [itemSummaryByLendingId, setItemSummaryByLendingId] = useState<Map<string, string>>(new Map());
  const [selectedLendingId, setSelectedLendingId] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<DesktopLendingDetail | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<LendingFilter>('all');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnRemarks, setReturnRemarks] = useState('');
  const [returnLines, setReturnLines] = useState<Record<string, ReturnLineState>>({});
  const [savingReturn, setSavingReturn] = useState(false);
  const announce = (message: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
    desktopUi.showToast({ message, tone });
  };

  const loadRecords = async (): Promise<void> => {
    setLoading(true);
    try {
      const [rows, sales, catalog, outboxRows] = await Promise.all([
        desktopMasterDataService.loadLendingRecords(appState.setup.branchId, appState.setup.locationId),
        desktopDb.listSales(),
        appState.setup.locationId
          ? desktopMasterDataService.loadCatalog(appState.setup.locationId)
          : Promise.resolve([]),
        desktopDb.listOutboxItems()
      ]);
      const pendingReturnMap = new Map<string, PendingReturnOutboxEntry[]>();
      for (const row of outboxRows) {
        if (!isPendingOutboxStatus(row.status)) {
          continue;
        }
        if (row.entity !== 'lending_return' || row.action !== 'create') {
          continue;
        }
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const lendingId = typeof payload.lending_id === 'string' ? payload.lending_id.trim() : '';
        if (!lendingId) {
          continue;
        }
        const createdAt =
          typeof payload.created_at === 'string' && payload.created_at.trim()
            ? payload.created_at.trim()
            : row.created_at;
        const remarks = typeof payload.remarks === 'string' && payload.remarks.trim() ? payload.remarks.trim() : null;
        const rawLines = Array.isArray(payload.lines) ? payload.lines : [];
        const lines: PendingReturnOutboxLine[] = rawLines
          .map((value) => {
            if (!value || typeof value !== 'object') {
              return null;
            }
            const line = value as Record<string, unknown>;
            const lendingLineId =
              typeof line.lending_line_id === 'string' ? line.lending_line_id.trim() : '';
            const returnedQtyRaw = line.returned_qty ?? line.returnedQty ?? line.quantity ?? line.qty;
            const returnedQty = Number(returnedQtyRaw);
            if (!lendingLineId || !Number.isFinite(returnedQty) || returnedQty <= 0) {
              return null;
            }
            const conditionRaw =
              typeof line.condition === 'string' ? line.condition.trim().toUpperCase() : 'GOOD';
            const condition: PendingReturnOutboxLine['condition'] =
              conditionRaw === 'DAMAGED' || conditionRaw === 'LOST' ? conditionRaw : 'GOOD';
            const lineRemarks =
              typeof line.remarks === 'string' && line.remarks.trim() ? line.remarks.trim() : null;
            return {
              lendingLineId,
              returnedQty: Number(returnedQty.toFixed(3)),
              condition,
              remarks: lineRemarks
            };
          })
          .filter((line): line is PendingReturnOutboxLine => Boolean(line));
        if (!lines.length) {
          continue;
        }
        const entries = pendingReturnMap.get(lendingId) ?? [];
        entries.push({
          lendingId,
          createdAt,
          remarks,
          lines
        });
        pendingReturnMap.set(lendingId, entries);
      }
      const projectedRows = rows.map((row) =>
        applyPendingReturnsToRecord(row, pendingReturnMap.get(row.lending_id))
      );
      const nextReceiptBySaleId = new Map<string, string>();
      const productById = new Map(catalog.map((row) => [row.id, row]));
      const detailSummaryByLendingId = new Map<string, string>();
      const firstSaleLineBySaleId = new Map<
        string,
        { productId: string; productName: string }
      >();
      for (const sale of sales) {
        const saleId = String(sale.id ?? '').trim();
        const receipt = String(sale.receiptNumber ?? '').trim();
        if (!saleId || !receipt) {
          continue;
        }
        nextReceiptBySaleId.set(saleId, receipt);
        const firstLine = Array.isArray(sale.payload.lines) ? sale.payload.lines[0] : null;
        if (!firstLine || typeof firstLine.productId !== 'string' || !firstLine.productId.trim()) {
          continue;
        }
        firstSaleLineBySaleId.set(saleId, {
          productId: firstLine.productId.trim(),
          productName: String(firstLine.productName ?? '').trim()
        });
      }
      const detailRows = await desktopDb.listMasterData('lending_detail');
      for (const row of detailRows) {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(row.payload) as Record<string, unknown>;
        } catch {
          continue;
        }
        const lendingId = String(payload.lending_id ?? payload.id ?? row.recordId ?? '').trim();
        const firstLine =
          Array.isArray(payload.lines) && payload.lines[0] && typeof payload.lines[0] === 'object'
            ? (payload.lines[0] as Record<string, unknown>)
            : null;
        if (!lendingId || !firstLine) {
          continue;
        }
        const productId = String(firstLine.product_id ?? '').trim();
        const product = productId ? productById.get(productId) ?? null : null;
        const itemCode =
          String(firstLine.product_sku ?? '').trim() ||
          product?.sku?.trim() ||
          productId ||
          '-';
        const itemName =
          String(firstLine.product_name ?? '').trim() ||
          product?.name?.trim() ||
          productId ||
          '-';
        const itemSize =
          product?.cylinderSizeLabel?.trim() ||
          product?.unit?.trim() ||
          '-';
        detailSummaryByLendingId.set(lendingId, `${itemCode} | ${itemName} | ${itemSize}`);
      }
      const nextItemSummaryByLendingId = new Map<string, string>();
      for (const row of projectedRows) {
        const detailSummary = detailSummaryByLendingId.get(row.lending_id);
        if (detailSummary) {
          nextItemSummaryByLendingId.set(row.lending_id, detailSummary);
          continue;
        }
        const firstLine = firstSaleLineBySaleId.get(String(row.sale_id ?? '').trim());
        const product = firstLine?.productId ? productById.get(firstLine.productId) : null;
        const itemCode = product?.sku?.trim() || firstLine?.productId || '-';
        const itemName = firstLine?.productName?.trim() || product?.name?.trim() || '-';
        const itemSize = product?.cylinderSizeLabel?.trim() || product?.unit?.trim() || '-';
        nextItemSummaryByLendingId.set(
          row.lending_id,
          `${itemCode} | ${itemName} | ${itemSize}`
        );
      }
      const missingSummaryIds = projectedRows
        .map((row) => row.lending_id)
        .filter((lendingId) => (nextItemSummaryByLendingId.get(lendingId) ?? '') === '- | - | -');
      for (const lendingId of missingSummaryIds) {
        if (!appState.auth.accessToken) {
          break;
        }
        try {
          const result = await desktopMasterDataService.refreshLendingDetail(appState, lendingId);
          const firstLine = result.detail.lines[0];
          if (!firstLine) {
            continue;
          }
          const product = firstLine.product_id ? productById.get(firstLine.product_id) ?? null : null;
          const itemCode = firstLine.product_sku?.trim() || product?.sku?.trim() || firstLine.product_id || '-';
          const itemName = firstLine.product_name?.trim() || product?.name?.trim() || firstLine.product_id || '-';
          const itemSize = product?.cylinderSizeLabel?.trim() || product?.unit?.trim() || '-';
          nextItemSummaryByLendingId.set(lendingId, `${itemCode} | ${itemName} | ${itemSize}`);
          await desktopSettingsService.saveState(result.state);
          if (onStateReload) {
            await onStateReload();
          }
        } catch {
          // Keep placeholder if detail still cannot be resolved.
        }
      }
      setReceiptBySaleId(nextReceiptBySaleId);
      setItemSummaryByLendingId(nextItemSummaryByLendingId);
      setPendingReturnOutboxByLendingId(pendingReturnMap);
      setRecords(projectedRows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRecords();
  }, [appState.setup.branchId, appState.setup.locationId]);

  useEffect(() => {
    if (savingReturn) {
      desktopUi.setLoading({ visible: true, label: 'Saving lending return...' });
      return;
    }
    if (loadingDetail) {
      desktopUi.setLoading({ visible: true, label: 'Loading lending detail...' });
      return;
    }
    if (loading) {
      desktopUi.setLoading({ visible: true, label: 'Loading lending records...' });
      return;
    }
    desktopUi.clearLoading();
  }, [desktopUi, loading, loadingDetail, savingReturn]);

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((record) => {
      if (activeFilter !== 'all' && record.status !== activeFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      const receipt = receiptBySaleId.get(record.sale_id)?.toLowerCase() ?? '';
      const itemSummary = itemSummaryByLendingId.get(record.lending_id)?.toLowerCase() ?? '';
      const haystack = [
        record.customer_name ?? '',
        receipt,
        itemSummary,
        record.remarks ?? '',
        friendlyStatus(record.status)
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [activeFilter, itemSummaryByLendingId, receiptBySaleId, records, search]);

  const sortedRecords = useMemo(() => {
    const rows = [...filteredRecords];
    rows.sort((a, b) => {
      const aTime = new Date(a.opened_at).getTime();
      const bTime = new Date(b.opened_at).getTime();
      const aMs = Number.isFinite(aTime) ? aTime : 0;
      const bMs = Number.isFinite(bTime) ? bTime : 0;
      return bMs - aMs;
    });
    return rows;
  }, [filteredRecords]);

  useEffect(() => {
    setCurrentPage(0);
  }, [activeFilter, pageSize, search]);

  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages - 1);
  const pageStartIndex = sortedRecords.length ? safeCurrentPage * pageSize : 0;
  const pageEndIndex = sortedRecords.length ? Math.min(pageStartIndex + pageSize, sortedRecords.length) : 0;
  const visibleRecords = sortedRecords.slice(pageStartIndex, pageStartIndex + pageSize);

  const resolveReceiptNumber = (record: { sale_id?: string | null }): string | null => {
    const saleId = String(record.sale_id ?? '').trim();
    if (!saleId) {
      return null;
    }
    const receipt = receiptBySaleId.get(saleId);
    return receipt && receipt.trim().length > 0 ? receipt.trim() : null;
  };

  const selectedRecord =
    filteredRecords.find((record) => record.lending_id === selectedLendingId) ??
    records.find((record) => record.lending_id === selectedLendingId) ??
    null;
  const selectedReceiptNumber = selectedRecord ? resolveReceiptNumber(selectedRecord) : null;
  const selectedDepositPayment = useMemo(() => {
    if (!selectedDetail) {
      return null;
    }
    const depositAmount = Number(
      selectedDetail.lines.reduce((sum, line) => sum + Number(line.deposit_amount ?? 0), 0).toFixed(2)
    );
    const payment = selectedDetail.deposit_payment ?? null;
    const amountValue = Number((payment?.amount ?? depositAmount).toFixed(2));
    const amount = Number.isFinite(amountValue) ? amountValue : 0;
    return {
      amount,
      method: payment?.method ?? null,
      postedAt: payment?.posted_at ?? selectedDetail.created_at,
      notes: payment?.notes ?? null
    };
  }, [selectedDetail]);
  const selectedDepositPaymentSummary: LendingDepositPaymentSummary | null = selectedRecord
    ? {
        amount: selectedDepositPayment?.amount ?? 0,
        method: selectedDepositPayment?.method ?? null,
        postedAt: selectedDepositPayment?.postedAt ?? selectedRecord.opened_at,
        notes: selectedDepositPayment?.notes ?? null
      }
    : null;

  useEffect(() => {
    let active = true;
    async function loadDetail(): Promise<void> {
      if (!selectedRecord) {
        setSelectedDetail(null);
        return;
      }
      setLoadingDetail(true);
      try {
        const cached = await desktopMasterDataService.loadCachedLendingDetail(selectedRecord.lending_id);
        if (active) {
          setSelectedDetail(
            cached
              ? applyPendingReturnsToDetail(
                  cached,
                  pendingReturnOutboxByLendingId.get(selectedRecord.lending_id)
                )
              : null
          );
        }
        if (appState.auth.accessToken) {
          try {
            const result = await desktopMasterDataService.refreshLendingDetail(appState, selectedRecord.lending_id);
            if (!active) {
              return;
            }
            setSelectedDetail(
              applyPendingReturnsToDetail(
                result.detail,
                pendingReturnOutboxByLendingId.get(selectedRecord.lending_id)
              )
            );
            await desktopSettingsService.saveState(result.state);
            if (onStateReload) {
              await onStateReload();
            }
          } catch {
            if (active && !cached) {
              announce('This lending detail is only partially available offline right now. Connect once to load its full line history.', 'warning');
            }
          }
        }
      } finally {
        if (active) {
          setLoadingDetail(false);
        }
      }
    }
    void loadDetail();
    return () => {
      active = false;
    };
  }, [selectedRecord?.lending_id, appState.auth.accessToken, pendingReturnOutboxByLendingId]);

  const counts = useMemo(
    () => ({
      all: records.length,
      OPEN: records.filter((record) => record.status === 'OPEN').length,
      PARTIALLY_RETURNED: records.filter((record) => record.status === 'PARTIALLY_RETURNED').length,
      OVERDUE: records.filter((record) => record.status === 'OVERDUE').length,
      CLOSED: records.filter((record) => record.status === 'CLOSED').length,
      QUEUED: [...pendingReturnOutboxByLendingId.values()].reduce((sum, entries) => sum + entries.length, 0)
    }),
    [pendingReturnOutboxByLendingId, records]
  );

  const overviewMetrics = useMemo<LendingOverviewMetric[]>(
    () => [
      { key: 'open', label: 'Open', value: String(counts.OPEN), icon: 'open', tone: 'good' },
      {
        key: 'partial',
        label: 'Partial Return',
        value: String(counts.PARTIALLY_RETURNED),
        icon: 'partial',
        tone: 'accent'
      },
      { key: 'overdue', label: 'Overdue', value: String(counts.OVERDUE), icon: 'overdue', tone: 'warn' },
      { key: 'queued', label: 'Queued Returns', value: String(counts.QUEUED), icon: 'queued', tone: 'neutral' }
    ],
    [counts.CLOSED, counts.OPEN, counts.OVERDUE, counts.PARTIALLY_RETURNED, counts.QUEUED]
  );

  const recordCountLabel = `${sortedRecords.length} record${sortedRecords.length === 1 ? '' : 's'}`;
  const pageLabel = sortedRecords.length
    ? `Showing ${pageStartIndex + 1} to ${pageEndIndex} of ${sortedRecords.length} records`
    : 'Showing 0 records';
  const pageButtons = Array.from({ length: totalPages }, (_, index) => index);
  const visiblePageButtons = useMemo(() => {
    if (totalPages <= 5) {
      return pageButtons;
    }
    return Array.from(
      new Set(
        [0, safeCurrentPage - 1, safeCurrentPage, safeCurrentPage + 1, totalPages - 1].filter(
          (index) => index >= 0 && index < totalPages
        )
      )
    ).sort((a, b) => a - b);
  }, [pageButtons, safeCurrentPage, totalPages]);
  const goToPage = (nextPage: number): void => {
    setCurrentPage(Math.max(0, Math.min(totalPages - 1, nextPage)));
  };

  const returnableLines = useMemo(
    () => (selectedDetail?.lines ?? []).filter((line) => line.quantity_open > 0),
    [selectedDetail]
  );

  const setReturnLineQty = (lineId: string, nextQty: number, maxQty: number): void => {
    const cappedMax = Math.max(0, Math.floor(maxQty));
    const normalizedQty = Number.isFinite(nextQty)
      ? Math.min(cappedMax, Math.max(0, Math.trunc(nextQty)))
      : 0;
    setReturnLines((prev) => ({
      ...prev,
      [lineId]: {
        ...prev[lineId],
        condition: prev[lineId]?.condition ?? 'GOOD',
        returnedQty: normalizedQty > 0 ? String(normalizedQty) : ''
      }
    }));
  };

  const setReturnLineQtyFromInput = (lineId: string, rawValue: string, maxQty: number): void => {
    const nextValue = toWholeNumberInput(rawValue);
    if (!nextValue) {
      setReturnLines((prev) => ({
        ...prev,
        [lineId]: {
          ...prev[lineId],
          condition: prev[lineId]?.condition ?? 'GOOD',
          returnedQty: ''
        }
      }));
      return;
    }
    setReturnLineQty(lineId, parseWholeNumber(nextValue), maxQty);
  };

  const openReturnModal = (): void => {
    if (!selectedDetail || returnableLines.length === 0) {
      announce('This lending record has no open quantity left to return.', 'warning');
      return;
    }
    const nextLines: Record<string, ReturnLineState> = {};
    returnableLines.forEach((line) => {
      nextLines[line.lending_line_id] = {
        returnedQty: '',
        condition: 'GOOD'
      };
    });
    setReturnLines(nextLines);
    setReturnRemarks('');
    setReturnModalOpen(true);
  };

  const handleRefreshRecords = async (): Promise<void> => {
    if (!appState.auth.accessToken || !appState.setup.branchId) {
      announce('Sign in and choose a branch first before refreshing desktop lending records.', 'warning');
      return;
    }
    try {
      const result = await desktopMasterDataService.refreshLendingRecords(appState, appState.setup.branchId);
      await desktopSettingsService.saveState(result.state);
      if (onStateReload) {
        await onStateReload();
      }
      announce(`Desktop lending cache refreshed. ${result.count} branch records are now available on this workstation.`, 'success');
      await loadRecords();
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to refresh desktop lending records right now.', 'error');
    }
  };

  const handleSubmitReturn = async (): Promise<void> => {
    if (!selectedRecord || !selectedDetail) {
      return;
    }

    const draftEntries = returnableLines
      .map((line) => {
        const row = returnLines[line.lending_line_id];
        const qty = parseWholeNumber(row?.returnedQty);
        if (qty <= 0) {
          return null;
        }
        return {
          line,
          lending_line_id: line.lending_line_id,
          returned_qty: qty,
          condition: row?.condition ?? 'GOOD',
          remarks: null
        };
      })
      .filter(Boolean) as Array<
      DesktopLendingReturnDraft['lines'][number] & {
        line: DesktopLendingDetail['lines'][number];
      }
    >;

    for (const entry of draftEntries) {
      if (entry.returned_qty > entry.line.quantity_open) {
        announce(
          `${entry.line.product_name || entry.line.product_id} only has ${fmtNumber(entry.line.quantity_open)} open.`,
          'warning'
        );
        return;
      }
    }

    const draftLines = draftEntries.map(({ line: _line, ...entry }) => entry);

    if (draftLines.length === 0) {
      announce('Enter at least one return quantity before saving this lending return.', 'warning');
      return;
    }
    const totalReturnQty = draftLines.reduce((sum, line) => sum + line.returned_qty, 0);
    const receiptLabel = selectedReceiptNumber ? `receipt #${selectedReceiptNumber}` : 'this receipt';
    const confirmed = window.confirm(
      `Record return of ${fmtNumber(totalReturnQty)} for ${receiptLabel}?`
    );
    if (!confirmed) {
      return;
    }

    setSavingReturn(true);
    try {
      const draft = {
        remarks: returnRemarks.trim() || null,
        lines: draftLines
      } satisfies DesktopLendingReturnDraft;
      let nextDetail: DesktopLendingDetail;
      let nextMessage = '';
      const forceOfflineQueue = isLikelyLocalPendingLending(selectedDetail);

      if (!forceOfflineQueue && appState.auth.accessToken) {
        try {
          const result = await desktopMasterDataService.recordLendingReturn(appState, selectedRecord.lending_id, draft);
          await desktopSettingsService.saveState(result.state);
          if (onStateReload) {
            await onStateReload();
          }
          nextDetail = result.detail;
          nextMessage = `Return saved for ${receiptLabel}. The lending record is now updated on this desktop.`;
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Unable to record the lending return right now.';
          if (!/fetch|network|offline|failed/i.test(detail)) {
            throw error;
          }
          nextDetail = await desktopLendingService.queueOfflineReturn(appState, selectedDetail, draft);
          nextMessage = `Return queued locally for ${receiptLabel}. It will sync when this desktop reconnects.`;
        }
      } else {
        nextDetail = await desktopLendingService.queueOfflineReturn(appState, selectedDetail, draft);
        nextMessage = `Return queued locally for ${receiptLabel}. It will sync when this desktop reconnects.`;
      }

      setSelectedDetail(
        applyPendingReturnsToDetail(
          nextDetail,
          pendingReturnOutboxByLendingId.get(nextDetail.lending_id)
        )
      );
      setRecords((prev) =>
        prev.map((record) =>
          record.lending_id === nextDetail.lending_id
            ? {
                ...record,
                ...applyPendingReturnsToRecord(
                  nextDetail,
                  pendingReturnOutboxByLendingId.get(nextDetail.lending_id)
                )
              }
            : record
        )
      );
      setReturnModalOpen(false);
      setReturnRemarks('');
      setReturnLines({});
      announce(nextMessage, nextMessage.includes('queued locally') ? 'warning' : 'success');
      await loadRecords();
      const outboxRows = await desktopDb.listOutboxItems();
      if (onStateReload && outboxRows.some((row) => row.entity === 'lending_return' && (row.status === 'pending' || row.status === 'failed'))) {
        await onStateReload();
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to record the lending return right now.', 'error');
    } finally {
      setSavingReturn(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <LendingManagementOverview
        title="Lending Management"
        subtitle="Track active lends, partial returns, overdue records, and queued return activity."
        metrics={overviewMetrics}
        onRefresh={() => void handleRefreshRecords()}
        refreshDisabled={loading}
      />

      <section className={`${shellCardClass} desktop-module-section lending-records-shell`}>
        <div className="lending-records-header">
          <div className="lending-records-header-main">
            <div className="lending-records-header-icon">
              <LendingPageSymbol kind="lending" className="lending-records-header-icon-svg" />
            </div>
            <div className="lending-records-header-copy">
              <div className="eyebrow">Lending directory</div>
              <h3 className="m-0 text-[1.12rem] font-extrabold text-[var(--text-strong)] sm:text-[1.32rem]">
                Lended and returned records
              </h3>
              <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
                Search by customer, receipt, or item, then open a record to review lines and capture returns cleanly.
              </p>
            </div>
          </div>
          <div className="items-catalog-count-pill lending-records-count-pill">{recordCountLabel}</div>
        </div>

        <div className="lending-records-toolbar">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search customer, receipt, item, status, or note"
            className="lending-records-search"
          />
        </div>

        <div className="lending-records-filter-bar">
          <div className="lending-records-filter-row">
            {([
              ['all', 'All', String(counts.all)],
              ['OPEN', 'Open', String(counts.OPEN)],
              ['PARTIALLY_RETURNED', 'Partial', String(counts.PARTIALLY_RETURNED)],
              ['OVERDUE', 'Overdue', String(counts.OVERDUE)],
              ['CLOSED', 'Closed', String(counts.CLOSED)]
            ] as Array<[LendingFilter, string, string]>).map(([filter, label, count]) => (
              <LendingFilterChip
                key={filter}
                label={label}
                count={count}
                active={activeFilter === filter}
                onClick={() => setActiveFilter(filter)}
              />
            ))}
          </div>

        </div>

        <div className="lending-record-list">
          {loading ? (
            <div className="empty-state">Loading desktop lending records...</div>
          ) : visibleRecords.length === 0 ? (
            <div className="empty-state">No desktop lending records match this filter yet.</div>
          ) : (
            visibleRecords.map((record) => {
              const openedAt = new Date(record.opened_at);
              const openedAtMs = openedAt.getTime();
              const safeOpenedAt = Number.isFinite(openedAtMs) ? openedAt : new Date();
              const openedDateLabel = safeOpenedAt.toLocaleDateString();
              const openedTimeLabel = safeOpenedAt.toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit'
              });
              const statusBadgeLabel =
                record.status === 'PARTIALLY_RETURNED'
                  ? 'PARTIAL'
                  : record.status === 'FORCE_CLOSED'
                    ? 'CLOSED'
                    : record.status;
              const noteLabel = record.remarks?.trim() || 'No note';
              return (
                <LendingRecordRow
                  key={record.lending_id}
                  receiptLabel={resolveReceiptNumber(record) ?? `Lending ${record.lending_id}`}
                  customerLabel={record.customer_name || 'Customer lending record'}
                  itemSummary={itemSummaryByLendingId.get(record.lending_id) ?? '- | - | -'}
                  qtyLentLabel={`Qty Lent: ${fmtNumber(record.total_quantity_lent)}`}
                  returnedLabel={`Returned: ${fmtNumber(record.total_quantity_returned)}`}
                  openLabel={`Open: ${fmtNumber(openQuantity(record))}`}
                  openedDateLabel={openedDateLabel}
                  openedTimeLabel={openedTimeLabel}
                  noteLabel={noteLabel}
                  statusBadgeLabel={statusBadgeLabel}
                  statusTone={lendingStatusTone(record.status)}
                  selected={selectedRecord?.lending_id === record.lending_id}
                  onClick={() => setSelectedLendingId(record.lending_id)}
                />
              );
            })
          )}
        </div>

        <div className="lending-records-footer">
          <div className="lending-records-footer-summary">{pageLabel}</div>
          <div className="lending-records-pager">
            <button
              type="button"
              className="lending-records-page-btn"
              onClick={() => goToPage(0)}
              disabled={safeCurrentPage === 0}
              aria-label="First page"
            >
              «
            </button>
            <button
              type="button"
              className="lending-records-page-btn"
              onClick={() => goToPage(safeCurrentPage - 1)}
              disabled={safeCurrentPage === 0}
              aria-label="Previous page"
            >
              ‹
            </button>
            {visiblePageButtons.map((pageIndex) => (
              <button
                key={pageIndex}
                type="button"
                className={`lending-records-page-btn ${pageIndex === safeCurrentPage ? 'active' : ''}`}
                onClick={() => goToPage(pageIndex)}
                aria-current={pageIndex === safeCurrentPage ? 'page' : undefined}
                aria-label={`Page ${pageIndex + 1}`}
              >
                {pageIndex + 1}
              </button>
            ))}
            <button
              type="button"
              className="lending-records-page-btn"
              onClick={() => goToPage(safeCurrentPage + 1)}
              disabled={safeCurrentPage >= totalPages - 1}
              aria-label="Next page"
            >
              ›
            </button>
            <button
              type="button"
              className="lending-records-page-btn"
              onClick={() => goToPage(totalPages - 1)}
              disabled={safeCurrentPage >= totalPages - 1}
              aria-label="Last page"
            >
              »
            </button>
          </div>
          <div className="lending-records-page-size">
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
              <option value={10}>10 per page</option>
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
            </select>
          </div>
        </div>
      </section>

      {selectedRecord ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={modalCardClass}>
            <LendingDetailModalContent
              record={selectedRecord}
              receiptLabel={selectedReceiptNumber ?? '-'}
              customerLabel={selectedRecord.customer_name || selectedRecord.customer_id}
              itemSummary={itemSummaryByLendingId.get(selectedRecord.lending_id) ?? '- | - | -'}
              detail={selectedDetail}
              depositPayment={
                selectedDepositPaymentSummary ?? {
                  amount: 0,
                  method: null,
                  postedAt: selectedRecord.opened_at,
                  notes: null
                }
              }
              loadingDetail={loadingDetail}
              onClose={() => setSelectedLendingId('')}
              onOpenReturn={openReturnModal}
              returnDisabled={openQuantity(selectedRecord) <= 0 || loadingDetail}
            />
          </div>
        </div>
      ) : null}

      {returnModalOpen && selectedDetail ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={actionModalCardClass}>
            <div className={`${modalToolbarClass} panel-head`}>
              <div className="sales-detail-header">
                <div className="eyebrow">Lending return</div>
                <h3>{`Receipt #${selectedReceiptNumber ?? '-'}`}</h3>
                <p className={listRowBodyTextClass}>{selectedRecord?.customer_name || selectedRecord?.customer_id || '-'}</p>
              </div>
              <div className="sales-detail-actions">
                <div className="sales-detail-actions-group">
                  <button
                    className="secondary-btn mini-btn modal-close-icon-btn"
                    type="button"
                    onClick={() => setReturnModalOpen(false)}
                    aria-label="Close modal"
                    title="Close"
                  >
                    <span aria-hidden="true">X</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="desktop-modal-body grid min-h-0 gap-4">
              {selectedDepositPayment ? (
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(170px,0.7fr)_minmax(170px,0.7fr)]">
                  <div className={detailCardClass}>
                    <span className={detailLabelClass}>Deposit Amount</span>
                    <strong className={detailValueClass}>{fmtMoney(selectedDepositPayment.amount)}</strong>
                    <span className={listRowBodyTextClass}>
                      {selectedDepositPayment.amount > 0
                        ? 'Deposit collected for this lending'
                        : 'No deposit payment recorded yet'}
                    </span>
                  </div>
                  <div className={detailCardClass}>
                    <span className={detailLabelClass}>Payment Method</span>
                    <strong className={detailValueClass}>{formatPaymentMethod(selectedDepositPayment.method)}</strong>
                    <span className={listRowBodyTextClass}>
                      {selectedDepositPayment.amount > 0
                        ? 'Payment posted at lending time'
                        : 'Method not yet recorded'}
                    </span>
                  </div>
                  <div className={detailCardClass}>
                    <span className={detailLabelClass}>Paid At</span>
                    <strong className={detailValueClass}>
                      {selectedDepositPayment.amount > 0
                        ? new Date(selectedDepositPayment.postedAt).toLocaleString()
                        : 'Not recorded'}
                    </strong>
                    <span className={listRowBodyTextClass}>
                      {selectedDepositPayment.amount > 0
                        ? selectedDepositPayment.notes || 'Lending deposit record'
                        : 'No deposit payment recorded yet'}
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="cart-list">
                {returnableLines.map((line) => (
                  <div key={line.lending_line_id} className={lendingLineRowClass}>
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(170px,0.78fr)_minmax(170px,0.78fr)] lg:items-start">
                      <div className="grid gap-1.5">
                        <span className={detailLabelClass}>Item</span>
                        <div className="grid gap-2 rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(255,255,255,0.97)] px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)]">
                          <strong className="text-[1rem] font-extrabold text-[var(--text-strong)]">{line.product_name || line.product_id}</strong>
                          <span className={listRowBodyTextClass}>Open quantity {fmtNumber(line.quantity_open)}</span>
                        </div>
                      </div>
                      <label className="grid gap-1.5">
                        <span className={detailLabelClass}>Return Qty</span>
                        {(() => {
                          const lineId = line.lending_line_id;
                          const maxQty = Math.max(0, Math.floor(line.quantity_open));
                          const currentQty = parseWholeNumber(returnLines[lineId]?.returnedQty);
                          return (
                            <div className="return-qty-field">
                              <div className="return-qty-rail">
                                <button
                                  type="button"
                                  className="return-qty-step"
                                  onClick={() => setReturnLineQty(lineId, currentQty - 1, maxQty)}
                                  disabled={currentQty <= 0}
                                  aria-label={`Decrease return qty for ${line.product_name || line.product_id}`}
                                >
                                  -
                                </button>
                                <input
                                  className="return-qty-input"
                                  value={returnLines[lineId]?.returnedQty ?? ''}
                                  onChange={(event) => setReturnLineQtyFromInput(lineId, event.target.value, maxQty)}
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder="0"
                                />
                                <button
                                  type="button"
                                  className="return-qty-step"
                                  onClick={() => setReturnLineQty(lineId, currentQty + 1, maxQty)}
                                  disabled={currentQty >= maxQty}
                                  aria-label={`Increase return qty for ${line.product_name || line.product_id}`}
                                >
                                  +
                                </button>
                              </div>
                              <div className="return-qty-meta">
                                <span>{`Open ${fmtNumber(line.quantity_open)}`}</span>
                                <button
                                  type="button"
                                  className="secondary-btn mini-btn return-qty-max-btn"
                                  onClick={() => setReturnLineQty(lineId, maxQty, maxQty)}
                                  disabled={maxQty <= 0}
                                >
                                  Set Max
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </label>
                      <label className="grid gap-1.5">
                        <span className={detailLabelClass}>Condition</span>
                        <select
                          value={returnLines[line.lending_line_id]?.condition ?? 'GOOD'}
                          onChange={(event) =>
                            setReturnLines((prev) => ({
                              ...prev,
                              [line.lending_line_id]: {
                                ...prev[line.lending_line_id],
                                condition: event.target.value as ReturnLineState['condition']
                              }
                            }))
                          }
                        >
                          {RETURN_CONDITIONS.map((condition) => (
                            <option key={condition} value={condition}>
                              {condition}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              <label className="full-width-field">
                <span>Return Remarks</span>
                <textarea
                  value={returnRemarks}
                  onChange={(event) => setReturnRemarks(event.target.value)}
                  placeholder="Reason, condition note, or receiving remark"
                />
              </label>
              <div className="action-row desktop-settings-actions">
                <button className="secondary-btn" type="button" onClick={() => setReturnModalOpen(false)}>
                  Cancel
                </button>
                <button className="primary-btn" type="button" onClick={() => void handleSubmitReturn()} disabled={savingReturn}>
                  {savingReturn ? 'Saving Return...' : 'Save Return'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

