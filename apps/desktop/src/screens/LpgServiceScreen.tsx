import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { desktopDb } from '../db/sqlite';
import type { DesktopAppState, DesktopCatalogProduct, DesktopLpgItemActionRecord } from '../db/schema';
import { SearchField } from '../components/inputs/SearchField';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import { desktopAuthService } from '../services/desktop-auth.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopSubscriptionPolicyService } from '../services/desktop-subscription-policy.service';
import { desktopStockProjectionService } from '../services/desktop-stock-projection.service';
import { parseLpgComposerQtyInput, resolveLpgComposerMaxQty, sanitizeLpgComposerQtyInput } from './lpg-service-qty';

type Props = {
  appState: DesktopAppState;
  focusProductId?: string | null;
  focusNonce?: number;
  onOpenItems?: (productId: string) => void;
};

type ActionFilter = 'ALL' | 'DISPOSE' | 'JUNK' | 'REPLACE';
type ComposerType = 'DISPOSE' | 'REPLACE' | 'JUNK';

type LocalActionRecord = DesktopLpgItemActionRecord & {
  source?: 'server' | 'local' | 'cached';
  syncStatus?: 'pending' | 'processing' | 'failed' | 'needs_review' | 'synced' | null;
};

type DisposedEntryRow = LocalActionRecord & {
  junkQty: number;
  replacedQty: number;
  availableQty: number;
};

type LpgOverviewMetricTone = 'out' | 'good' | 'warn' | 'pending';
type LpgOverviewIconKind =
  | 'service'
  | 'dispose'
  | 'replace'
  | 'junk'
  | 'pending'
  | 'branch'
  | 'location'
  | 'cashier'
  | 'status'
  | 'focus'
  | 'history'
  | 'plus';

type LpgOverviewMetric = {
  key: string;
  label: string;
  value: string;
  icon: LpgOverviewIconKind;
  tone: LpgOverviewMetricTone;
};

type LpgServiceOverviewPanelProps = {
  metrics: LpgOverviewMetric[];
  onRefresh: () => void;
  onHistory: () => void;
  onDispose: () => void;
  refreshDisabled: boolean;
  disposeDisabled: boolean;
};

type LpgServiceDetailModalProps = {
  entry: LocalActionRecord;
  product: DesktopCatalogProduct | null;
  referenceDescription: string | null;
  derivedStats?: {
    junkQty?: number;
    replacedQty?: number;
    availableQty?: number;
  } | null;
  onClose: () => void;
};

type LpgServiceFilterOption = {
  key: ActionFilter;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
};

type LpgServiceRecordChipTone = 'neutral' | 'accent' | 'good' | 'warn';
type LpgServiceRecordAvatarTone = 'neutral' | 'dispose' | 'replace' | 'junk';
type LpgServiceRecordStatusTone = 'good' | 'low' | 'out';
type LpgServiceRecordActionTone = 'secondary' | 'primary' | 'danger';
type LpgServiceRecordActionIcon = 'view' | 'replace' | 'junk';

type LpgServiceRecordActionButton = {
  key: string;
  label: string;
  tone: LpgServiceRecordActionTone;
  icon: LpgServiceRecordActionIcon;
  disabled?: boolean;
  onClick: () => void;
};

type LpgServiceRecordCard = {
  key: string;
  avatarLabel: string;
  avatarTone: LpgServiceRecordAvatarTone;
  title: string;
  subtitle: string;
  timestamp: string;
  chips: { label: string; tone: LpgServiceRecordChipTone }[];
  reason: string;
  statusLabel: string;
  statusTone: LpgServiceRecordStatusTone;
  recordCode: string;
  syncLabel?: string | null;
  notesLabel?: string | null;
  onOpen?: () => void;
  actions: LpgServiceRecordActionButton[];
};

type LpgServiceRecordsPanelProps = {
  title: string;
  description: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  filterOptions: LpgServiceFilterOption[];
  focusBanner?: {
    label: string;
    onClear: () => void;
  } | null;
  records: LpgServiceRecordCard[];
  emptyMessage: string;
};

type LpgServiceHistoryModalRecord = {
  key: string;
  actionType: LocalActionRecord['actionType'];
  title: string;
  timestamp: string;
  timeLabel: string;
  referenceLabel: string | null;
  qtyLabel: string;
  itemLabel: string;
  reason: string;
  statusLabel: string;
  onOpen: () => void;
};

type LpgServiceHistoryModalProps = {
  filterOptions: LpgServiceFilterOption[];
  records: LpgServiceHistoryModalRecord[];
  onClose: () => void;
};

const screenStackClass = 'flex flex-col gap-5';
const shellCardClass = 'desktop-module-section';
const modalBackdropClass = 'desktop-modal-backdrop';
const modalCardClass = 'desktop-modal-card desktop-modal-card--detail';
const pickerModalCardClass = 'desktop-modal-card desktop-modal-card--picker';
const modalToolbarClass = 'desktop-modal-header flex items-start justify-between gap-3';
const focusBannerClass = 'flex flex-wrap items-center justify-between gap-3';
const recordMainClass = 'grid min-w-0 gap-2';
const recordHeadClass = 'flex items-start justify-between gap-3';
const recordHeadCopyClass = 'grid min-w-0 gap-1';
const sheetContentClass = 'desktop-modal-body grid gap-4';
const sheetCopyClass = 'm-0 text-[0.92rem] leading-6 text-[var(--muted)]';
const composerStackClass = 'grid gap-4';
const productListClass = 'picker-list';
const selectedProductClass =
  'grid gap-2 rounded-[20px] border border-[rgba(188,210,234,0.52)] bg-[rgba(245,249,253,0.96)] px-4 py-4 shadow-[0_10px_22px_rgba(17,40,58,0.04)]';
const selectedProductTitleClass = 'text-[0.94rem] font-bold text-[var(--text-strong)]';
const selectedProductCopyClass = 'text-[0.82rem] leading-5 text-[var(--muted)]';
const composerFormClass = 'grid gap-3';
const qtyCardClass =
  'grid gap-4 rounded-[22px] border border-[rgba(188,210,234,0.5)] bg-[rgba(248,251,255,0.96)] px-5 py-5 shadow-[0_10px_22px_rgba(17,40,58,0.04)]';
const qtyHeadClass = 'flex flex-wrap items-center justify-between gap-2';
const qtyHeadLabelClass = 'text-[0.8rem] font-extrabold uppercase tracking-[0.06em] text-[var(--muted)]';
const qtyHeadCopyClass = 'text-[0.8rem] text-[var(--muted)]';
const qtyRailClass = 'grid grid-cols-[auto_minmax(120px,1fr)_auto] items-center gap-3';
const qtyRailButtonClass =
  'grid h-[48px] w-[48px] place-items-center rounded-[16px] border border-[var(--border)] bg-[rgba(255,255,255,0.96)] text-[1rem] font-bold text-[var(--text-strong)] transition hover:border-[rgba(25,118,210,0.24)] hover:bg-[rgba(248,251,255,0.98)] disabled:cursor-not-allowed disabled:opacity-45';
const qtyValueClass =
  'h-[56px] w-full rounded-[18px] border border-[var(--border)] bg-[rgba(255,255,255,0.96)] px-4 text-center text-[1.2rem] font-extrabold text-[var(--text-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_6px_16px_rgba(17,40,58,0.04)] transition focus:outline-none focus:border-[rgba(25,118,210,0.5)] disabled:cursor-not-allowed disabled:border-[rgba(210,220,230,0.82)] disabled:bg-[rgba(242,246,250,0.82)] disabled:text-[var(--muted)]';
const composerEmptyStateClass =
  'rounded-[18px] border border-dashed border-[rgba(188,210,234,0.72)] bg-[rgba(253,251,244,0.95)] px-4 py-4 text-[0.95rem] leading-6 text-[var(--muted-strong)]';
const composerSelectButtonClass =
  'inline-flex min-h-[56px] items-center justify-center gap-3 self-start rounded-[18px] border border-[rgba(25,118,210,0.34)] bg-[rgba(226,236,247,0.96)] px-5 text-[1rem] font-semibold text-[var(--accent-strong)] shadow-[0_10px_20px_rgba(25,118,210,0.12)] transition hover:-translate-y-[1px] hover:bg-[rgba(220,232,244,0.98)]';
const composerFieldClass = 'grid gap-2';
const composerFieldInputClass =
  'min-h-[54px] rounded-[16px] border border-[var(--border)] bg-[rgba(255,255,255,0.96)] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_6px_16px_rgba(17,40,58,0.04)] transition focus:outline-none focus:border-[rgba(25,118,210,0.5)]';
const composerNotesInputClass =
  'min-h-[146px] rounded-[16px] border border-[var(--border)] bg-[rgba(255,255,255,0.96)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_6px_16px_rgba(17,40,58,0.04)] transition focus:outline-none focus:border-[rgba(25,118,210,0.5)]';
const composerHeaderTileClass =
  'grid h-[72px] w-[72px] shrink-0 place-items-center rounded-[20px] border border-[rgba(229,210,210,0.6)] bg-[rgba(249,240,240,0.96)]';
const composerHeaderIconClass = 'h-[30px] w-[30px] text-[var(--danger)]';
const composerHeaderCopyClass = 'grid min-w-0 gap-1';
const composerLayoutClass = 'flex min-w-0 items-start gap-4';
const modalActionRowClass = 'desktop-modal-footer flex flex-wrap items-center justify-end gap-3';
const serviceRecordListClass = 'grid gap-3';
const serviceRecordCardClass =
  'grid gap-4 rounded-[22px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.97)] p-4 shadow-[0_10px_24px_rgba(17,40,58,0.04)] md:grid-cols-[minmax(0,1fr)_auto]';
const serviceRecordMetaClass = 'flex flex-wrap gap-x-4 gap-y-1 text-[0.88rem] text-[var(--muted)]';
const serviceRecordCopyClass = 'grid gap-1 text-[0.92rem] text-[var(--muted-strong)]';
const serviceRecordSideClass = 'grid content-start justify-items-start gap-3 md:justify-items-end';
const productCardClass =
  'grid gap-2 rounded-[20px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-4 py-4 text-left shadow-[0_10px_24px_rgba(17,40,58,0.04)] transition hover:-translate-y-[1px] hover:border-[rgba(25,118,210,0.24)] hover:shadow-[0_14px_28px_rgba(17,40,58,0.08)]';
const productCardSelectedClass =
  'border-[rgba(25,118,210,0.3)] bg-[rgba(236,244,255,0.96)] shadow-[0_14px_30px_rgba(25,118,210,0.12)]';

function LpgServiceIcon({
  path,
  className = ''
}: {
  path: ReactNode;
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

function LpgPageSymbol({ kind, className = '' }: { kind: LpgOverviewIconKind; className?: string }): JSX.Element {
  let path: ReactNode;
  if (kind === 'service') {
    path = (
      <>
        <path d="M8 4h8" />
        <path d="M7 8h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
        <path d="M12 11v4" />
        <path d="M10 13h4" />
        <path d="M9.5 4a2.5 2.5 0 0 1 5 0" />
      </>
    );
  } else if (kind === 'dispose') {
    path = (
      <>
        <path d="M12 5v14" />
        <path d="M7 14l5 5 5-5" />
      </>
    );
  } else if (kind === 'replace') {
    path = (
      <>
        <path d="M7 7h10" />
        <path d="m13 4 4 3-4 3" />
        <path d="M17 17H7" />
        <path d="m11 14-4 3 4 3" />
      </>
    );
  } else if (kind === 'junk') {
    path = (
      <>
        <path d="M8 7h8" />
        <path d="M9 7V5h6v2" />
        <path d="M7 7l1 11h8l1-11" />
        <path d="M10 11v4M14 11v4" />
      </>
    );
  } else if (kind === 'pending') {
    path = (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2.5" />
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
  } else if (kind === 'history') {
    path = (
      <>
        <path d="M4 12a8 8 0 1 0 3-6.2" />
        <path d="M4 4v5h5" />
        <path d="M12 8v4l2.5 2.5" />
      </>
    );
  } else if (kind === 'plus') {
    path = (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    );
  } else {
    path = (
      <>
        <path d="M12 20s6-4.4 6-10a6 6 0 1 0-12 0c0 5.6 6 10 6 10Z" />
        <path d="M12 7.5v5" />
        <path d="m9.5 10.5 2.5 2.5 2.5-2.5" />
      </>
    );
  }
  return <LpgServiceIcon path={path} className={className} />;
}

function LpgRecordActionIcon({ icon, className = '' }: { icon: LpgServiceRecordActionIcon; className?: string }): JSX.Element {
  if (icon === 'replace') {
    return (
      <LpgServiceIcon
        className={className}
        path={
          <>
            <path d="M7 7h10" />
            <path d="m13 4 4 3-4 3" />
            <path d="M17 17H7" />
            <path d="m11 14-4 3 4 3" />
          </>
        }
      />
    );
  }

  if (icon === 'junk') {
    return (
      <LpgServiceIcon
        className={className}
        path={
          <>
            <path d="M8 7h8" />
            <path d="M9 7V5h6v2" />
            <path d="M7 7l1 11h8l1-11" />
            <path d="M10 11v4M14 11v4" />
          </>
        }
      />
    );
  }

  return (
    <LpgServiceIcon
      className={className}
      path={
        <>
          <path d="M2.5 12s3.8-6 9.5-6 9.5 6 9.5 6-3.8 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.4" />
        </>
      }
    />
  );
}

function buildVisiblePages(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  if (currentPage <= 3) {
    return [1, 2, 3, 4, 5];
  }
  if (currentPage >= totalPages - 2) {
    return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2];
}

function getRecordActionButtonClass(tone: LpgServiceRecordActionTone): string {
  if (tone === 'primary') {
    return 'primary-btn lpg-service-record-action-btn';
  }
  if (tone === 'danger') {
    return 'secondary-btn lpg-service-record-action-btn lpg-service-record-action-btn--danger';
  }
  return 'secondary-btn lpg-service-record-action-btn';
}

function historyCardToneClass(actionType: LocalActionRecord['actionType']): string {
  if (actionType === 'REPLACE') {
    return 'replace';
  }
  if (actionType === 'JUNK') {
    return 'junk';
  }
  return 'dispose';
}

export function LpgServiceRecordsPanel({
  title,
  description,
  searchValue,
  onSearchChange,
  filterOptions,
  focusBanner = null,
  records,
  emptyMessage
}: LpgServiceRecordsPanelProps): JSX.Element {
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const activeFilterKey = filterOptions.find((option) => option.active)?.key ?? 'ALL';
  const totalCount = records.length;
  const totalPages = Math.max(1, Math.ceil(Math.max(totalCount, 1) / pageSize));
  const startIndex = totalCount === 0 ? 0 : (currentPage - 1) * pageSize;
  const visibleRecords = records.slice(startIndex, startIndex + pageSize);
  const showingStart = totalCount === 0 ? 0 : startIndex + 1;
  const showingEnd = totalCount === 0 ? 0 : startIndex + visibleRecords.length;
  const visiblePages = buildVisiblePages(currentPage, totalPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilterKey, searchValue, totalCount]);

  useEffect(() => {
    setCurrentPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  return (
    <div className="lpg-service-records-shell">
      <div className="lpg-service-records-head">
        <div className="panel-head compact">
          <div>
            <div className="eyebrow">Service Records</div>
            <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">{title}</h3>
            <p className="m-0 text-[0.92rem] leading-6 text-[var(--muted)]">{description}</p>
          </div>
        </div>
      </div>

      <div className="lpg-service-records-toolbar">
        <div className="grid gap-4">
          <div className="lpg-service-records-search">
            <SearchField
              className="w-full"
              value={searchValue}
              onChange={onSearchChange}
              placeholder="Search LPG item, reason, or notes..."
            />
          </div>
          <div className="lpg-service-records-filter-row">
            {filterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`lpg-service-records-filter-chip ${option.active ? 'active' : ''}`}
                onClick={option.onClick}
              >
                <span>{option.label}</span>
                <span className="lpg-service-records-filter-count">{fmtNumber(option.count)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {focusBanner ? (
        <div className={`message-banner ${focusBannerClass}`}>
          <span>{focusBanner.label}</span>
          <button className="secondary-btn mini-btn" type="button" onClick={focusBanner.onClear}>
            Clear Focus
          </button>
        </div>
      ) : null}

      {visibleRecords.length === 0 ? (
        <div className="empty-state">{emptyMessage}</div>
      ) : (
        <div className="lpg-service-record-list">
          {visibleRecords.map((record) => {
            const clickable = Boolean(record.onOpen);
            return (
              <article
                key={record.key}
                className={`lpg-service-record-card${clickable ? ' is-clickable' : ''}`}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={record.onOpen}
                onKeyDown={
                  clickable
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          record.onOpen?.();
                        }
                      }
                    : undefined
                }
              >
                <div className="lpg-service-record-main">
                  <div className={`lpg-service-record-avatar ${record.avatarTone}`}>{record.avatarLabel}</div>
                  <div className="lpg-service-record-copy">
                    <div className="lpg-service-record-head-copy">
                      <strong className="lpg-service-record-title">{record.title}</strong>
                      <span className="lpg-service-record-meta">
                        {record.subtitle} <span aria-hidden="true">•</span> {record.timestamp}
                      </span>
                    </div>
                    <div className="lpg-service-record-chip-row">
                      {record.chips.map((chip) => (
                        <span key={`${record.key}-${chip.label}`} className={`lpg-service-record-chip ${chip.tone}`}>
                          {chip.label}
                        </span>
                      ))}
                    </div>
                    <div className="lpg-service-record-reason">
                      <LpgServiceIcon
                        className="h-[16px] w-[16px]"
                        path={
                          <>
                            <path d="M5 6.5h14" />
                            <path d="M5 11.5h14" />
                            <path d="M5 16.5h8" />
                            <path d="M4 4h16v16H4z" />
                          </>
                        }
                      />
                      <span>Reason: {record.reason}</span>
                    </div>
                    {record.notesLabel ? <div className="lpg-service-record-note">{record.notesLabel}</div> : null}
                  </div>
                </div>

                <div className="lpg-service-record-side">
                  <div className={`stock-pill ${record.statusTone}`}>{record.statusLabel}</div>
                  <span className="lpg-service-record-code">ID: {record.recordCode}</span>
                  {record.syncLabel ? <span className="lpg-service-record-sync">{record.syncLabel}</span> : null}
                </div>

                {record.actions.length > 0 ? (
                  <div className="lpg-service-record-actions">
                    {record.actions.map((action) => (
                      <button
                        key={`${record.key}-${action.key}`}
                        className={getRecordActionButtonClass(action.tone)}
                        type="button"
                        disabled={action.disabled}
                        onClick={(event) => {
                          event.stopPropagation();
                          action.onClick();
                        }}
                      >
                        <LpgRecordActionIcon icon={action.icon} className="h-[16px] w-[16px]" />
                        <span>{action.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <div className="lpg-service-records-footer">
        <span className="lpg-service-records-footer-copy">
          Showing {showingStart} to {showingEnd} of {totalCount} records
        </span>

        <div className="lpg-service-records-pager">
          <button
            className="lpg-service-records-page-btn"
            type="button"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1 || totalCount === 0}
            aria-label="First page"
          >
            «
          </button>
          <button
            className="lpg-service-records-page-btn"
            type="button"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={currentPage === 1 || totalCount === 0}
            aria-label="Previous page"
          >
            ‹
          </button>
          {visiblePages.map((page) => (
            <button
              key={page}
              className={`lpg-service-records-page-btn ${page === currentPage ? 'active' : ''}`}
              type="button"
              onClick={() => setCurrentPage(page)}
              aria-label={`Page ${page}`}
            >
              {page}
            </button>
          ))}
          <button
            className="lpg-service-records-page-btn"
            type="button"
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={currentPage === totalPages || totalCount === 0}
            aria-label="Next page"
          >
            ›
          </button>
          <button
            className="lpg-service-records-page-btn"
            type="button"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages || totalCount === 0}
            aria-label="Last page"
          >
            »
          </button>
        </div>

        <label className="lpg-service-records-page-size">
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={10}>10 per page</option>
            <option value={20}>20 per page</option>
            <option value={50}>50 per page</option>
          </select>
        </label>
      </div>
    </div>
  );
}

export function LpgServiceHistoryModal({
  filterOptions,
  records,
  onClose
}: LpgServiceHistoryModalProps): JSX.Element {
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const activeFilterKey = filterOptions.find((option) => option.active)?.key ?? 'ALL';
  const totalCount = records.length;
  const totalPages = Math.max(1, Math.ceil(Math.max(totalCount, 1) / pageSize));
  const startIndex = totalCount === 0 ? 0 : (currentPage - 1) * pageSize;
  const visibleRecords = records.slice(startIndex, startIndex + pageSize);
  const showingStart = totalCount === 0 ? 0 : startIndex + 1;
  const showingEnd = totalCount === 0 ? 0 : startIndex + visibleRecords.length;
  const visiblePages = buildVisiblePages(currentPage, totalPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeFilterKey, totalCount]);

  useEffect(() => {
    setCurrentPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  return (
    <div className={`${modalCardClass} lpg-service-history-modal`} onClick={(event) => event.stopPropagation()}>
      <div className="desktop-modal-header lpg-service-history-header">
        <div className="lpg-service-history-hero">
          <div className="lpg-service-history-icon-tile">
            <LpgPageSymbol kind="history" className="h-[30px] w-[30px]" />
          </div>
          <div className="lpg-service-history-copy">
            <h3>LPG Service History</h3>
            <p>Review the full disposed, replaced, and junked trail for the current filter.</p>
          </div>
        </div>
        <button
          className="secondary-btn mini-btn modal-close-icon-btn"
          type="button"
          onClick={onClose}
          aria-label="Close modal"
          title="Close"
        >
          <LpgServiceIcon
            path={
              <>
                <path d="M6 6l12 12" />
                <path d="M18 6L6 18" />
              </>
            }
          />
        </button>
      </div>

      <div className="desktop-modal-body lpg-service-history-body">
        <div className="lpg-service-history-toolbar">
          <div className="lpg-service-history-chip-row">
            {filterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`lpg-service-history-chip ${option.active ? 'active' : ''}`}
                onClick={option.onClick}
              >
                {option.key !== 'ALL' ? (
                  <span className={`lpg-service-history-dot ${historyCardToneClass(option.key as LocalActionRecord['actionType'])}`} />
                ) : null}
                <span>{option.label}</span>
                <span className="lpg-service-history-chip-count">{fmtNumber(option.count)}</span>
              </button>
            ))}
          </div>
          <span className="lpg-service-history-summary">
            Showing {showingStart} to {showingEnd} of {totalCount} records
          </span>
        </div>

        {visibleRecords.length === 0 ? (
          <div className="empty-state">No action history found for this filter.</div>
        ) : (
          <div className="lpg-service-history-list">
            {visibleRecords.map((record) => (
              <article
                key={record.key}
                className={`lpg-service-history-card ${historyCardToneClass(record.actionType)}`}
              >
                <div className="lpg-service-history-main">
                  <div className={`lpg-service-history-action-icon ${historyCardToneClass(record.actionType)}`}>
                    <LpgPageSymbol
                      kind={record.actionType === 'REPLACE' ? 'replace' : record.actionType === 'JUNK' ? 'junk' : 'dispose'}
                      className="h-[24px] w-[24px]"
                    />
                  </div>
                  <div className="lpg-service-history-main-copy">
                    <strong className="lpg-service-history-title">{record.title}</strong>
                    <div className="lpg-service-history-meta">
                      <span>{record.timestamp}</span>
                      <span aria-hidden="true">•</span>
                      <span>{record.timeLabel}</span>
                    </div>
                    {record.referenceLabel ? <div className="lpg-service-history-reference">{record.referenceLabel}</div> : null}
                  </div>
                </div>

                <div className="lpg-service-history-info">
                  <div className="lpg-service-history-badges">
                    <span className="lpg-service-history-badge">
                      <LpgServiceIcon
                        className="h-[14px] w-[14px]"
                        path={
                          <>
                            <path d="m12 4 6 3.5v9L12 20l-6-3.5v-9L12 4Z" />
                            <path d="m9.5 9 2.5-1.5L14.5 9v3l-2.5 1.5L9.5 12V9Z" />
                          </>
                        }
                      />
                      <span>{record.qtyLabel}</span>
                    </span>
                    <span className="lpg-service-history-badge">
                      <LpgServiceIcon
                        className="h-[14px] w-[14px]"
                        path={
                          <>
                            <path d="M7 7h7l3 3v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
                            <path d="m12 7 0 3h3" />
                          </>
                        }
                      />
                      <span>{record.itemLabel}</span>
                    </span>
                  </div>
                  <div className="lpg-service-history-reason">Reason: {record.reason}</div>
                </div>

                <div className="lpg-service-history-side">
                  <div className={`stock-pill ${record.actionType === 'REPLACE' ? 'good' : record.actionType === 'JUNK' ? 'low' : 'out'}`}>
                    {record.statusLabel}
                  </div>
                  <button className="secondary-btn lpg-service-history-view-btn" type="button" onClick={record.onOpen}>
                    <LpgRecordActionIcon icon="view" className="h-[16px] w-[16px]" />
                    <span>View Details</span>
                    <span aria-hidden="true">›</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="desktop-modal-footer lpg-service-history-footer">
        <div className="lpg-service-records-pager">
          <button
            className="lpg-service-records-page-btn"
            type="button"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1 || totalCount === 0}
            aria-label="First page"
          >
            «
          </button>
          <button
            className="lpg-service-records-page-btn"
            type="button"
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            disabled={currentPage === 1 || totalCount === 0}
            aria-label="Previous page"
          >
            ‹
          </button>
          {visiblePages.map((page) => (
            <button
              key={page}
              className={`lpg-service-records-page-btn ${page === currentPage ? 'active' : ''}`}
              type="button"
              onClick={() => setCurrentPage(page)}
              aria-label={`Page ${page}`}
            >
              {page}
            </button>
          ))}
          <button
            className="lpg-service-records-page-btn"
            type="button"
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            disabled={currentPage === totalPages || totalCount === 0}
            aria-label="Next page"
          >
            ›
          </button>
          <button
            className="lpg-service-records-page-btn"
            type="button"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages || totalCount === 0}
            aria-label="Last page"
          >
            »
          </button>
        </div>
        <label className="lpg-service-records-page-size">
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            <option value={10}>10 per page</option>
            <option value={20}>20 per page</option>
            <option value={50}>50 per page</option>
          </select>
        </label>
      </div>
    </div>
  );
}

function lpgOverviewTone(tone: LpgOverviewMetricTone): {
  shell: string;
  icon: string;
  label: string;
  line: string;
} {
  if (tone === 'good') {
    return {
      shell: 'border-[rgba(182,226,194,0.62)] bg-[rgba(255,255,255,0.98)]',
      icon: 'border-[rgba(182,226,194,0.72)] bg-[rgba(238,250,242,0.98)] text-[#1f9b4d]',
      label: 'text-[#1f9b4d]',
      line: 'from-[#6fd38b] to-[#bee8c8]'
    };
  }
  if (tone === 'warn') {
    return {
      shell: 'border-[rgba(246,214,146,0.74)] bg-[rgba(255,255,255,0.98)]',
      icon: 'border-[rgba(246,214,146,0.74)] bg-[rgba(255,248,236,0.98)] text-[#bd7a12]',
      label: 'text-[#bd7a12]',
      line: 'from-[#f5c463] to-[#f7df9f]'
    };
  }
  if (tone === 'pending') {
    return {
      shell: 'border-[rgba(251,191,36,0.54)] bg-[rgba(255,255,255,0.98)]',
      icon: 'border-[rgba(251,191,36,0.58)] bg-[rgba(255,249,219,0.98)] text-[#c97d10]',
      label: 'text-[#c97d10]',
      line: 'from-[#f59e0b] to-[#fde68a]'
    };
  }
  return {
    shell: 'border-[rgba(247,196,201,0.72)] bg-[rgba(255,255,255,0.98)]',
    icon: 'border-[rgba(247,196,201,0.78)] bg-[rgba(255,241,243,0.98)] text-[#ea3434]',
    label: 'text-[#d64545]',
    line: 'from-[#ff7a7a] to-[#ffd0d0]'
  };
}

export function LpgServiceOverviewPanel({
  metrics,
  onRefresh,
  onHistory,
  onDispose,
  refreshDisabled,
  disposeDisabled
}: LpgServiceOverviewPanelProps): JSX.Element {
  return (
    <>
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <LpgPageSymbol kind="service" className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">
              LPG Service Management
            </h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">
              Track disposed, replaced, and junked LPG item activity.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2.5 xl:justify-end">
          <button className="secondary-btn min-h-[46px] px-4 text-[0.86rem]" type="button" onClick={onRefresh} disabled={refreshDisabled}>
            Refresh
          </button>
          <button className="secondary-btn min-h-[46px] px-4 text-[0.86rem]" type="button" onClick={onHistory}>
            <span className="inline-flex items-center gap-2">
              <LpgPageSymbol kind="history" className="h-[16px] w-[16px]" />
              Service History
            </span>
          </button>
          <button
            className="primary-btn inline-flex min-h-[48px] items-center gap-2.5 rounded-[16px] px-5 text-[0.88rem]"
            type="button"
            onClick={onDispose}
            disabled={disposeDisabled}
          >
            <LpgPageSymbol kind="plus" className="h-[18px] w-[18px]" />
            <span>Dispose Item</span>
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const tone = lpgOverviewTone(metric.tone);
          return (
            <article
              key={metric.key}
              className={`grid gap-3 overflow-hidden rounded-[20px] border px-4 py-3.5 shadow-[0_10px_22px_rgba(17,40,58,0.05)] ${tone.shell}`}
            >
              <div className="flex items-start gap-3">
                <div className={`grid h-[50px] w-[50px] shrink-0 place-items-center rounded-full border ${tone.icon}`}>
                  <LpgPageSymbol kind={metric.icon} className="h-[21px] w-[21px]" />
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
    </>
  );
}

export function LpgServiceDetailModal({
  entry,
  product,
  referenceDescription,
  derivedStats,
  onClose
}: LpgServiceDetailModalProps): JSX.Element {
  const tone =
    entry.actionType === 'REPLACE'
      ? 'good'
      : entry.actionType === 'JUNK'
        ? 'warn'
        : entry.syncStatus && entry.syncStatus !== 'synced'
          ? 'pending'
          : 'out';
  const toneClasses = lpgOverviewTone(tone);

  return (
    <div className="desktop-modal-card desktop-modal-card--action max-w-5xl" onClick={(event) => event.stopPropagation()}>
      <div className="desktop-modal-header shrink-0 px-5 py-5 sm:px-7 sm:py-6 lg:px-8 lg:py-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="eyebrow">Service record</div>
            <h3 className="mt-1 text-[1.2rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.34rem]">
              {entry.productName ?? product?.name ?? entry.productId}
            </h3>
            <p className="mt-2 text-[0.88rem] text-[var(--muted)]">Action ID {entry.id}</p>
          </div>
          <button
            className="secondary-btn mini-btn modal-close-icon-btn h-11 w-11 shrink-0 text-[var(--text-strong)] sm:h-12 sm:w-12"
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            title="Close"
          >
            <LpgServiceIcon
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
            <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Action</span>
            <div className="mt-2">
              <span className={`stock-pill ${entry.actionType === 'REPLACE' ? 'good' : entry.actionType === 'JUNK' ? 'low' : 'out'}`}>
                {actionLabel(entry.actionType)}
              </span>
            </div>
          </div>
          <div className="rounded-[20px] border border-[rgba(188,210,234,0.52)] bg-[rgba(255,255,255,0.98)] px-4 py-4 shadow-[0_8px_20px_rgba(17,40,58,0.05)]">
            <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Quantity</span>
            <strong className="mt-2 block text-[1rem] font-extrabold text-[var(--text-strong)]">{fmtNumber(entry.qty)}</strong>
          </div>
          <div className="rounded-[20px] border border-[rgba(188,210,234,0.52)] bg-[rgba(255,255,255,0.98)] px-4 py-4 shadow-[0_8px_20px_rgba(17,40,58,0.05)]">
            <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Sync Status</span>
            <div className="mt-2">
              <span className={`sales-list-card-status ${entry.syncStatus && entry.syncStatus !== 'synced' ? 'pending' : 'synced'}`}>
                {entry.syncStatus && entry.syncStatus !== 'synced' ? entry.syncStatus.toUpperCase() : 'SYNCED'}
              </span>
            </div>
          </div>
          <div className="rounded-[20px] border border-[rgba(188,210,234,0.52)] bg-[rgba(255,255,255,0.98)] px-4 py-4 shadow-[0_8px_20px_rgba(17,40,58,0.05)]">
            <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Created</span>
            <strong className="mt-2 block text-[0.96rem] font-extrabold text-[var(--text-strong)]">{dt(entry.createdAt)}</strong>
          </div>
        </div>

        <section className="rounded-[22px] border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_10px_22px_rgba(17,40,58,0.05)]">
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Record context</div>
              <h3>Service details</h3>
            </div>
          </div>
          <div className="desktop-detail-grid desktop-detail-grid--three">
            <div className="desktop-detail-list-item">
              <dt>Item Code</dt>
              <dd>{entry.productSku ?? product?.sku ?? '-'}</dd>
            </div>
            <div className="desktop-detail-list-item">
              <dt>Product Name</dt>
              <dd>{entry.productName ?? product?.name ?? entry.productId}</dd>
            </div>
            <div className="desktop-detail-list-item">
              <dt>Location</dt>
              <dd>{entry.locationName ?? entry.locationId}</dd>
            </div>
            <div className="desktop-detail-list-item">
              <dt>Branch</dt>
              <dd>{entry.branchName ?? entry.branchId}</dd>
            </div>
            <div className="desktop-detail-list-item">
              <dt>Updated At</dt>
              <dd>{dt(entry.updatedAt)}</dd>
            </div>
            <div className="desktop-detail-list-item">
              <dt>Reference Trail</dt>
              <dd>{referenceDescription ?? 'No linked disposed record'}</dd>
            </div>
          </div>
        </section>

        {entry.actionType === 'DISPOSE' && derivedStats ? (
          <section className="rounded-[22px] border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_10px_22px_rgba(17,40,58,0.05)]">
            <div className="panel-head compact">
              <div>
                <div className="eyebrow">Disposed trail</div>
                <h3>Linked movement summary</h3>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className={`rounded-[18px] border px-4 py-3 shadow-[0_8px_18px_rgba(17,40,58,0.05)] ${toneClasses.shell}`}>
                <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Replaced</span>
                <strong className="mt-2 block text-[1rem] font-extrabold text-[var(--text-strong)]">{fmtNumber(derivedStats.replacedQty ?? 0)}</strong>
              </div>
              <div className={`rounded-[18px] border px-4 py-3 shadow-[0_8px_18px_rgba(17,40,58,0.05)] ${toneClasses.shell}`}>
                <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Junked</span>
                <strong className="mt-2 block text-[1rem] font-extrabold text-[var(--text-strong)]">{fmtNumber(derivedStats.junkQty ?? 0)}</strong>
              </div>
              <div className={`rounded-[18px] border px-4 py-3 shadow-[0_8px_18px_rgba(17,40,58,0.05)] ${toneClasses.shell}`}>
                <span className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Available</span>
                <strong className="mt-2 block text-[1rem] font-extrabold text-[var(--text-strong)]">{fmtNumber(derivedStats.availableQty ?? 0)}</strong>
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-[22px] border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.98)] p-4 shadow-[0_10px_22px_rgba(17,40,58,0.05)]">
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Reason and notes</div>
              <h3>Recorded cashier notes</h3>
            </div>
          </div>
          <div className="grid gap-3">
            <div className="rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(248,251,255,0.92)] px-4 py-3 text-[0.9rem] leading-7 text-[var(--text-strong)]">
              Reason: {entry.reason}
            </div>
            {entry.notes ? (
              <div className="rounded-[18px] border border-[rgba(188,210,234,0.45)] bg-[rgba(248,251,255,0.92)] px-4 py-3 text-[0.9rem] leading-7 text-[var(--text-strong)]">
                Notes: {entry.notes}
              </div>
            ) : (
              <div className="empty-state">No extra notes were recorded for this service action.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function dt(value: string): string {
  return new Date(value).toLocaleString();
}

function actionLabel(value: ActionFilter | LocalActionRecord['actionType']): string {
  if (value === 'DISPOSE') return 'Disposed';
  if (value === 'REPLACE') return 'Replaced';
  if (value === 'JUNK') return 'Junked';
  return 'All Records';
}

function actionCodePrefix(value: LocalActionRecord['actionType']): string {
  if (value === 'DISPOSE') return 'DISP';
  if (value === 'REPLACE') return 'REPL';
  return 'JUNK';
}

function formatActionRecordCode(value: LocalActionRecord['actionType'], id: string): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return `${actionCodePrefix(value)}-${compact.slice(-6).padStart(6, '0')}`;
}

function recordAvatarLabel(productName: string | null | undefined, productSku: string | null | undefined, fallback: string): string {
  const source = (productName ?? '').trim() || (productSku ?? '').trim() || fallback.trim();
  return source.charAt(0).toUpperCase() || 'L';
}

function recordAvatarTone(value: LocalActionRecord['actionType']): LpgServiceRecordAvatarTone {
  if (value === 'REPLACE') return 'replace';
  if (value === 'JUNK') return 'junk';
  return 'dispose';
}

export function buildLpgServiceHistoryState({
  actions,
  productMap,
  query,
  focusedProductId,
  actionFilter
}: {
  actions: LocalActionRecord[];
  productMap: Map<string, Pick<DesktopCatalogProduct, 'sku' | 'name'>>;
  query: string;
  focusedProductId: string | null;
  actionFilter: ActionFilter;
}): {
  scopedRows: LocalActionRecord[];
  historyRows: LocalActionRecord[];
  filterCounts: Record<ActionFilter, number>;
} {
  const search = query.trim().toLowerCase();
  const scopedRows = [...actions]
    .filter((row) => !focusedProductId || row.productId === focusedProductId)
    .filter((row) => {
      if (!search) {
        return true;
      }
      const product = productMap.get(row.productId);
      return `${row.productSku ?? product?.sku ?? ''} ${row.productName ?? product?.name ?? ''} ${row.reason} ${row.notes ?? ''} ${row.actionType}`
        .toLowerCase()
        .includes(search);
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const historyRows =
    actionFilter === 'ALL' ? scopedRows : scopedRows.filter((row) => row.actionType === actionFilter);

  return {
    scopedRows,
    historyRows,
    filterCounts: {
      ALL: scopedRows.length,
      DISPOSE: scopedRows.filter((row) => row.actionType === 'DISPOSE').length,
      JUNK: scopedRows.filter((row) => row.actionType === 'JUNK').length,
      REPLACE: scopedRows.filter((row) => row.actionType === 'REPLACE').length
    }
  };
}

function isProjectedOutboxStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? '').trim().toLowerCase();
  return (
    normalized === 'pending' ||
    normalized === 'processing' ||
    normalized === 'failed' ||
    normalized === 'needs_review'
  );
}

function mapOutboxAction(row: Awaited<ReturnType<typeof desktopDb.listOutboxItems>>[number]): LocalActionRecord | null {
  if (row.entity !== 'lpg_item_action') {
    return null;
  }
  const payload = row.payload ?? {};
  const actionTypeRaw = String(row.action || '').trim().toUpperCase();
  if (actionTypeRaw !== 'DISPOSE' && actionTypeRaw !== 'REPLACE' && actionTypeRaw !== 'JUNK') {
    return null;
  }
  const qty = Number(payload.qty);
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  const productId = typeof payload.product_id === 'string' ? payload.product_id : typeof payload.productId === 'string' ? payload.productId : '';
  const locationId = typeof payload.location_id === 'string' ? payload.location_id : typeof payload.locationId === 'string' ? payload.locationId : '';
  if (!productId || !locationId || !Number.isFinite(qty) || qty <= 0 || !reason) {
    return null;
  }
  return {
    id: row.id,
    branchId: typeof payload.branch_id === 'string' ? payload.branch_id : typeof payload.branchId === 'string' ? payload.branchId : '',
    branchCode: null,
    branchName: null,
    locationId,
    locationCode: null,
    locationName: null,
    productId,
    productSku: typeof payload.product_sku === 'string' ? payload.product_sku : typeof payload.productSku === 'string' ? payload.productSku : null,
    productName: typeof payload.product_name === 'string' ? payload.product_name : typeof payload.productName === 'string' ? payload.productName : null,
    actionType: actionTypeRaw,
    qty,
    reason,
    notes: typeof payload.notes === 'string' && payload.notes.trim() ? payload.notes.trim() : null,
    referenceActionId:
      typeof payload.reference_action_id === 'string'
        ? payload.reference_action_id
        : typeof payload.referenceActionId === 'string'
          ? payload.referenceActionId
          : null,
    createdByUserId:
      typeof payload.user_id === 'string'
        ? payload.user_id
        : typeof payload.userId === 'string'
          ? payload.userId
          : null,
    createdAt:
      typeof payload.created_at === 'string'
        ? payload.created_at
        : typeof payload.createdAt === 'string'
          ? payload.createdAt
          : row.created_at,
    updatedAt: row.updated_at,
    source: 'local',
    syncStatus: row.status
  };
}

function normalizeServerAction(row: DesktopLpgItemActionRecord): LocalActionRecord {
  return {
    ...row,
    source: 'server',
    syncStatus: 'synced'
  };
}

function dedupeActions(rows: LocalActionRecord[]): LocalActionRecord[] {
  const seen = new Map<string, LocalActionRecord>();
  for (const row of rows) {
    if (!seen.has(row.id)) {
      seen.set(row.id, row);
      continue;
    }
    const existing = seen.get(row.id)!;
    if (existing.source === 'local' && row.source !== 'local') {
      seen.set(row.id, row);
    }
  }
  return Array.from(seen.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function makeActionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lpg-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function LpgServiceScreen({ appState, focusProductId = null, focusNonce = 0 }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const [catalog, setCatalog] = useState<DesktopCatalogProduct[]>([]);
  const [actions, setActions] = useState<LocalActionRecord[]>([]);
  const [query, setQuery] = useState('');
  const [focusedProductId, setFocusedProductId] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<ActionFilter>('DISPOSE');
  const [historyActionFilter, setHistoryActionFilter] = useState<ActionFilter>('ALL');
  const [composerOpen, setComposerOpen] = useState(false);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedActionId, setSelectedActionId] = useState<string>('');
  const [composerType, setComposerType] = useState<ComposerType>('DISPOSE');
  const [referenceDisposeId, setReferenceDisposeId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [modalProductQuery, setModalProductQuery] = useState('');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('Record disposed items here. Junked and replaced entries must come from an existing disposed record.');

  const refresh = async (): Promise<void> => {
    if (!appState.setup.locationId) {
      setCatalog([]);
      setActions([]);
      return;
    }

    setLoading(true);
    setActionLoading(true);
    try {
      const [catalogRows, projectedInventory, cachedActionRows, outboxRows] = await Promise.all([
        desktopMasterDataService.loadCatalog(appState.setup.locationId),
        desktopStockProjectionService.loadProjectedInventoryByProduct(appState.setup.locationId),
        desktopMasterDataService.loadLpgItemActions(appState.setup.branchId, appState.setup.locationId),
        desktopDb.listOutboxItems()
      ]);
      const lpgCatalog = catalogRows
        .filter((row) => row.isLpg)
        .map((product) => {
          const projected = projectedInventory.get(product.id);
          return projected
            ? {
                ...product,
                qtyOnHand: projected.qtyOnHand,
                qtyFull: projected.qtyFull,
                qtyEmpty: projected.qtyEmpty
              }
            : product;
        });
      setCatalog(lpgCatalog);

      const localRows = outboxRows
        .filter((row) => row.entity === 'lpg_item_action' && isProjectedOutboxStatus(row.status))
        .map((row) => mapOutboxAction(row))
        .filter((row): row is LocalActionRecord => Boolean(row))
        .filter((row) => row.locationId === appState.setup.locationId);

      let serverRows: LocalActionRecord[] = [];
      if (!appState.auth.accessToken) {
        serverRows = cachedActionRows.map((row) => ({ ...row, source: 'cached', syncStatus: 'synced' as const }));
        setMessage('Offline mode: showing cached LPG service records and pending queue on this desktop.');
      } else {
        try {
          const params = new URLSearchParams();
          params.set('location_id', appState.setup.locationId);
          params.set('limit', '150');
          const { response } = await desktopAuthService.authorizedFetch(
            appState,
            `${appState.setup.apiBaseUrl.replace(/\/$/, '')}/lpg-item-actions?${params.toString()}`
          );
          if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(detail || `Unable to load LPG item actions (${response.status})`);
          }
          serverRows = ((await response.json()) as DesktopLpgItemActionRecord[]).map((row) => normalizeServerAction(row));
        } catch (error) {
          serverRows = cachedActionRows.map((row) => ({ ...row, source: 'cached', syncStatus: 'synced' as const }));
          setMessage(error instanceof Error ? error.message : 'Showing cached LPG service records right now.');
        }
      }

      setActions(dedupeActions([...localRows, ...serverRows]));
    } finally {
      setLoading(false);
      setActionLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [appState.setup.branchId, appState.setup.locationId]);

  useEffect(() => {
    if (saving) {
      desktopUi.setLoading({ visible: true, label: 'Saving LPG service record...' });
      return;
    }
    if (loading) {
      desktopUi.setLoading({ visible: true, label: 'Loading LPG service...' });
      return;
    }
    desktopUi.clearLoading();
  }, [desktopUi, loading, saving]);

  useEffect(() => {
    if (!focusProductId) {
      return;
    }
    setFocusedProductId(focusProductId);
    const match = catalog.find((product) => product.id === focusProductId);
    if (match) {
      setMessage(`${match.name} is now focused in LPG Service.`);
    }
  }, [focusNonce, focusProductId, catalog]);

  const productMap = useMemo(() => new Map(catalog.map((product) => [product.id, product])), [catalog]);

  const counts = useMemo(
    () => ({
      dispose: actions.filter((row) => row.actionType === 'DISPOSE').length,
      replace: actions.filter((row) => row.actionType === 'REPLACE').length,
      junk: actions.filter((row) => row.actionType === 'JUNK').length,
      queued: actions.filter((row) => row.syncStatus && row.syncStatus !== 'synced').length
    }),
    [actions]
  );

  const actionMap = useMemo(() => new Map(actions.map((row) => [row.id, row])), [actions]);
  const selectedAction = useMemo(() => actionMap.get(selectedActionId) ?? null, [actionMap, selectedActionId]);

  const selectedProduct = useMemo(
    () => catalog.find((product) => product.id === selectedProductId) ?? null,
    [catalog, selectedProductId]
  );

  const modalVisibleProducts = useMemo(() => {
    const search = modalProductQuery.trim().toLowerCase();
    return catalog.filter((row) => {
      if (!search) {
        return true;
      }
      return `${row.sku} ${row.name}`.toLowerCase().includes(search);
    });
  }, [catalog, modalProductQuery]);

  const disposedEntries = useMemo<DisposedEntryRow[]>(() => {
    const search = query.trim().toLowerCase();
    const junkByReference = new Map<string, number>();
    const replacedByReference = new Map<string, number>();
    for (const row of actions) {
      if (!row.referenceActionId) {
        continue;
      }
      if (row.actionType === 'JUNK') {
        junkByReference.set(row.referenceActionId, (junkByReference.get(row.referenceActionId) ?? 0) + row.qty);
      } else if (row.actionType === 'REPLACE') {
        replacedByReference.set(row.referenceActionId, (replacedByReference.get(row.referenceActionId) ?? 0) + row.qty);
      }
    }
    return actions
      .filter((row) => row.actionType === 'DISPOSE')
      .filter((row) => !focusedProductId || row.productId === focusedProductId)
      .filter((row) => {
        if (!search) {
          return true;
        }
        const product = productMap.get(row.productId);
        return `${row.productSku ?? product?.sku ?? ''} ${row.productName ?? product?.name ?? ''} ${row.reason} ${row.notes ?? ''}`
          .toLowerCase()
          .includes(search);
      })
      .map((row) => ({
        ...row,
        junkQty: junkByReference.get(row.id) ?? 0,
        replacedQty: replacedByReference.get(row.id) ?? 0,
        availableQty: Math.max(
          0,
          row.qty - ((junkByReference.get(row.id) ?? 0) + (replacedByReference.get(row.id) ?? 0))
        )
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [actions, focusedProductId, productMap, query]);

  const selectedDisposedEntry = useMemo(() => {
    if (!referenceDisposeId) {
      return null;
    }
    return disposedEntries.find((row) => row.id === referenceDisposeId) ?? null;
  }, [disposedEntries, referenceDisposeId]);
  const selectedDisposedDetail = useMemo(
    () => disposedEntries.find((row) => row.id === selectedActionId) ?? null,
    [disposedEntries, selectedActionId]
  );

  const composerQtyLimit = useMemo(
    () =>
      resolveLpgComposerMaxQty({
        composerType,
        selectedProductQtyEmpty: selectedProduct?.qtyEmpty ?? null,
        selectedDisposedEntryAvailableQty: selectedDisposedEntry?.availableQty ?? null
      }),
    [composerType, selectedDisposedEntry?.availableQty, selectedProduct?.qtyEmpty]
  );

  const composerQtyHasProduct = Boolean(selectedProduct);
  const composerQtyHasReference = composerType === 'DISPOSE' ? true : Boolean(selectedDisposedEntry);
  const composerQtyHasSelection = composerType === 'DISPOSE' ? composerQtyHasProduct : composerQtyHasProduct && composerQtyHasReference;
  const composerQtyEnabled = composerQtyHasSelection && composerQtyLimit > 0;
  const composerQtyValue = parseLpgComposerQtyInput(qty);

  const composerQtyHint = useMemo(() => {
    if (!composerQtyHasProduct) {
      return 'Select an item first';
    }
    if (composerType !== 'DISPOSE' && !composerQtyHasReference) {
      return 'Select a disposed entry first';
    }
    if (composerQtyLimit > 0) {
      return composerType === 'DISPOSE'
        ? `Available ${fmtNumber(composerQtyLimit)} empty`
        : `Available ${fmtNumber(composerQtyLimit)}`;
    }
    return 'No quantity available';
  }, [composerQtyHasProduct, composerQtyHasReference, composerQtyLimit, composerType]);

  useEffect(() => {
    if (!composerOpen) {
      return;
    }

    if (!composerQtyEnabled) {
      if (qty !== '') {
        setQty('');
      }
      return;
    }

    setQty((current) => {
      const parsed = parseLpgComposerQtyInput(current);
      if (!current.trim() || parsed <= 0) {
        return '1';
      }
      if (composerQtyLimit > 0 && parsed > composerQtyLimit) {
        return String(Math.max(1, Math.trunc(composerQtyLimit)));
      }
      return String(parsed);
    });
  }, [composerOpen, composerQtyEnabled, composerQtyLimit, composerType, referenceDisposeId, selectedDisposedEntry?.id, selectedProduct?.id]);

  const historyState = useMemo(
    () =>
      buildLpgServiceHistoryState({
        actions,
        productMap,
        query,
        focusedProductId,
        actionFilter
      }),
    [actionFilter, actions, focusedProductId, productMap, query]
  );

  const historyRows = historyState.historyRows;

  const historyModalRows = useMemo(() => {
    return [...actions]
      .filter((row) => {
        if (historyActionFilter !== 'ALL' && row.actionType !== historyActionFilter) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [actions, historyActionFilter]);

  const mainBlockTitle = useMemo(() => {
    if (actionFilter === 'DISPOSE') return 'Disposed Records';
    if (actionFilter === 'REPLACE') return 'Replaced Records';
    if (actionFilter === 'JUNK') return 'Junked Records';
    return 'All Records';
  }, [actionFilter]);

  const filterCounts = historyState.filterCounts;

  const historyFilterCounts = useMemo(
    () => ({
      ALL: actions.length,
      DISPOSE: actions.filter((row) => row.actionType === 'DISPOSE').length,
      JUNK: actions.filter((row) => row.actionType === 'JUNK').length,
      REPLACE: actions.filter((row) => row.actionType === 'REPLACE').length
    }),
    [actions]
  );

  const filterOptions = useMemo<LpgServiceFilterOption[]>(
    () => [
      { key: 'ALL', label: 'All Records', count: filterCounts.ALL, active: actionFilter === 'ALL', onClick: () => setActionFilter('ALL') },
      { key: 'DISPOSE', label: 'Disposed', count: filterCounts.DISPOSE, active: actionFilter === 'DISPOSE', onClick: () => setActionFilter('DISPOSE') },
      { key: 'JUNK', label: 'Junked', count: filterCounts.JUNK, active: actionFilter === 'JUNK', onClick: () => setActionFilter('JUNK') },
      { key: 'REPLACE', label: 'Replaced', count: filterCounts.REPLACE, active: actionFilter === 'REPLACE', onClick: () => setActionFilter('REPLACE') }
    ],
    [actionFilter, filterCounts]
  );

  const historyFilterOptions = useMemo<LpgServiceFilterOption[]>(
    () => [
      { key: 'ALL', label: 'All Records', count: historyFilterCounts.ALL, active: historyActionFilter === 'ALL', onClick: () => setHistoryActionFilter('ALL') },
      { key: 'DISPOSE', label: 'Disposed', count: historyFilterCounts.DISPOSE, active: historyActionFilter === 'DISPOSE', onClick: () => setHistoryActionFilter('DISPOSE') },
      { key: 'REPLACE', label: 'Replaced', count: historyFilterCounts.REPLACE, active: historyActionFilter === 'REPLACE', onClick: () => setHistoryActionFilter('REPLACE') },
      { key: 'JUNK', label: 'Junked', count: historyFilterCounts.JUNK, active: historyActionFilter === 'JUNK', onClick: () => setHistoryActionFilter('JUNK') }
    ],
    [historyActionFilter, historyFilterCounts]
  );

  const disposedRecordCards = useMemo<LpgServiceRecordCard[]>(
    () =>
      disposedEntries.map((row) => {
        const product = productMap.get(row.productId);
        const productName = row.productName ?? product?.name ?? row.productId;
        const productSku = row.productSku ?? product?.sku ?? '-';
        const emptyQty = fmtNumber(product?.qtyEmpty ?? 0);
        return {
          key: row.id,
          avatarLabel: recordAvatarLabel(productName, productSku, row.id),
          avatarTone: recordAvatarTone(row.actionType),
          title: `${productName} | EMPTY ${emptyQty}`,
          subtitle: `Disposed x ${fmtNumber(row.qty)}`,
          timestamp: dt(row.createdAt),
          chips: [
            { label: `Junk ${fmtNumber(row.junkQty)}`, tone: 'warn' },
            { label: `Replaced ${fmtNumber(row.replacedQty)}`, tone: 'good' },
            { label: `Disposed ${fmtNumber(row.qty)}`, tone: 'accent' },
            { label: `EMPTY ${emptyQty}`, tone: 'neutral' }
          ],
          reason: row.reason,
          statusLabel: 'Disposed',
          statusTone: 'out',
          recordCode: formatActionRecordCode(row.actionType, row.id),
          syncLabel: row.syncStatus && row.syncStatus !== 'synced' ? `Pending Sync: ${row.syncStatus.toUpperCase()}` : null,
          notesLabel: row.notes ? `Notes: ${row.notes}` : null,
          onOpen: () => openActionDetail(row.id),
          actions: [
            {
              key: 'replace',
              label: 'Replace',
              tone: 'primary',
              icon: 'replace',
              disabled: row.availableQty <= 0,
              onClick: () => openComposer('REPLACE', row.id, row.productId)
            },
            {
              key: 'junk',
              label: 'Junk',
              tone: 'danger',
              icon: 'junk',
              disabled: row.availableQty <= 0,
              onClick: () => openComposer('JUNK', row.id, row.productId)
            }
          ]
        };
      }),
    [disposedEntries, productMap]
  );

  const historyRecordCards = useMemo<LpgServiceRecordCard[]>(
    () =>
      historyRows.map((row) => {
        const product = productMap.get(row.productId);
        const productName = row.productName ?? product?.name ?? row.productId;
        const productSku = row.productSku ?? product?.sku ?? '-';
        return {
          key: row.id,
          avatarLabel: recordAvatarLabel(productName, productSku, row.id),
          avatarTone: recordAvatarTone(row.actionType),
          title: `${productName} | ${productSku}`,
          subtitle: `${actionLabel(row.actionType)} x ${fmtNumber(row.qty)}`,
          timestamp: dt(row.createdAt),
          chips: [
            { label: `Qty ${fmtNumber(row.qty)}`, tone: 'accent' },
            { label: productSku, tone: 'neutral' }
          ],
          reason: row.reason,
          statusLabel: actionLabel(row.actionType),
          statusTone: row.actionType === 'REPLACE' ? 'good' : row.actionType === 'JUNK' ? 'low' : 'out',
          recordCode: formatActionRecordCode(row.actionType, row.id),
          syncLabel: row.syncStatus && row.syncStatus !== 'synced' ? `Pending Sync: ${row.syncStatus.toUpperCase()}` : null,
          notesLabel: row.notes ? `Notes: ${row.notes}` : describeReference(row.referenceActionId),
          onOpen: () => openActionDetail(row.id),
          actions: []
        };
      }),
    [historyRows, productMap]
  );

  const historyModalCards = useMemo<LpgServiceHistoryModalRecord[]>(
    () =>
      historyModalRows.map((row) => {
        const product = productMap.get(row.productId);
        const productName = row.productName ?? product?.name ?? row.productId;
        const reference = describeReference(row.referenceActionId);
        return {
          key: row.id,
          actionType: row.actionType,
          title: `${productName} | ${actionLabel(row.actionType)} x ${fmtNumber(row.qty)}`,
          timestamp: new Date(row.createdAt).toLocaleDateString(),
          timeLabel: new Date(row.createdAt).toLocaleTimeString(),
          referenceLabel: reference,
          qtyLabel: `Qty ${fmtNumber(row.qty)}`,
          itemLabel: productName,
          reason: row.reason,
          statusLabel: actionLabel(row.actionType),
          onOpen: () => openActionDetail(row.id)
        };
      }),
    [historyModalRows, productMap]
  );

  const activeRecordCards = actionFilter === 'DISPOSE' ? disposedRecordCards : historyRecordCards;

  const overviewMetrics: LpgOverviewMetric[] = [
    { key: 'dispose', label: 'Disposed', value: String(counts.dispose), icon: 'dispose', tone: 'out' },
    { key: 'replace', label: 'Replaced', value: String(counts.replace), icon: 'replace', tone: 'good' },
    { key: 'junk', label: 'Junked', value: String(counts.junk), icon: 'junk', tone: 'warn' },
    { key: 'queued', label: 'Queued', value: String(counts.queued), icon: 'pending', tone: 'pending' }
  ];

  function describeReference(referenceActionId: string | null): string | null {
    if (!referenceActionId) return null;
    const reference = actionMap.get(referenceActionId);
    if (!reference) return 'Linked to an earlier disposed record';
    const productName = reference.productName ?? productMap.get(reference.productId)?.name ?? 'Unknown item';
    return `From ${productName} disposed on ${dt(reference.createdAt)}`;
  }

  function openActionDetail(actionId: string): void {
    setSelectedActionId(actionId);
  }

  function openComposer(type: ComposerType, referenceActionId?: string | null, productId?: string | null): void {
    setComposerType(type);
    setReferenceDisposeId(referenceActionId ?? null);
    setSelectedProductId(productId ?? null);
    setModalProductQuery('');
    setQty('');
    setReason('');
    setNotes('');
    setItemPickerOpen(false);
    setComposerOpen(true);
  }

  const stepComposerQty = (delta: number): void => {
    if (!composerQtyEnabled) {
      return;
    }

    const current = parseLpgComposerQtyInput(qty) || 1;
    let next = Math.max(1, current + delta);
    if (composerQtyLimit > 0) {
      next = Math.min(next, Math.max(1, Math.trunc(composerQtyLimit)));
    }
    setQty(String(next));
  };

  const normalizeComposerQty = (): void => {
    if (!composerQtyEnabled) {
      setQty('');
      return;
    }

    const parsed = parseLpgComposerQtyInput(qty);
    if (parsed <= 0) {
      setQty('1');
      return;
    }

    if (composerQtyLimit > 0 && parsed > composerQtyLimit) {
      setQty(String(Math.max(1, Math.trunc(composerQtyLimit))));
      return;
    }

    setQty(String(parsed));
  };

  const closeComposer = (): void => {
    setComposerOpen(false);
    setItemPickerOpen(false);
    setQty('');
    setReason('');
    setNotes('');
    setReferenceDisposeId(null);
    setSelectedProductId(null);
    setModalProductQuery('');
    setComposerType('DISPOSE');
  };

  const submitAction = async (): Promise<void> => {
    if (!appState.setup.locationId || saving) {
      return;
    }

    if (!composerQtyEnabled) {
      desktopUi.showToast({
        tone: 'error',
        message: !composerQtyHasProduct
          ? 'Select an item first.'
          : composerType !== 'DISPOSE' && !composerQtyHasReference
            ? 'Choose a disposed entry first.'
            : 'No quantity available.'
      });
      return;
    }

    if (!selectedProduct) {
      desktopUi.showToast({ tone: 'error', message: 'Select an item first.' });
      return;
    }

    const parsedQty = parseLpgComposerQtyInput(qty);
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      desktopUi.showToast({ tone: 'error', message: 'Enter a valid quantity.' });
      return;
    }
    if (!reason.trim()) {
      desktopUi.showToast({ tone: 'error', message: 'Reason is required.' });
      return;
    }
    if (composerType !== 'DISPOSE' && !referenceDisposeId) {
      desktopUi.showToast({ tone: 'error', message: 'Choose a disposed entry first.' });
      return;
    }
    if (composerQtyLimit > 0 && parsedQty > composerQtyLimit) {
      desktopUi.showToast({
        tone: 'error',
        message:
          composerType === 'DISPOSE'
            ? `Only ${fmtNumber(composerQtyLimit)} empty item(s) are available to dispose.`
            : `Only ${fmtNumber(composerQtyLimit)} disposed item(s) are still available.`
      });
      return;
    }

    const actionId = makeActionId();
    const createdAt = new Date().toISOString();
    const payload: Record<string, unknown> = {
      id: actionId,
      action_id: actionId,
      action_type: composerType,
      actionType: composerType,
      product_id: selectedProduct.id,
      product_sku: selectedProduct.sku,
      product_name: selectedProduct.name,
      branch_id: appState.setup.branchId,
      location_id: appState.setup.locationId,
      location_name: appState.setup.locationLabel,
      qty: parsedQty,
      reason: reason.trim(),
      notes: notes.trim() || null,
      reference_action_id: referenceDisposeId ?? null,
      created_at: createdAt
    };
    const queueOfflineAction = async (): Promise<void> => {
      await desktopSubscriptionPolicyService.assertCanCreateTransactions('lpg_item_action');
      await desktopDb.enqueueOutboxItem({
        id: actionId,
        entity: 'lpg_item_action',
        action: composerType.toLowerCase(),
        payload,
        idempotency_key: `idem-lpg-item-action-${actionId}`,
        created_at: createdAt
      });
      await desktopDb.upsertMasterDataRows([
        {
          entity: 'lpg_item_action',
          recordId: actionId,
          payload: JSON.stringify({
            id: actionId,
            branchId: appState.setup.branchId,
            branchCode: null,
            branchName: appState.setup.branchLabel || null,
            locationId: appState.setup.locationId,
            locationCode: null,
            locationName: appState.setup.locationLabel || null,
            productId: selectedProduct.id,
            productSku: selectedProduct.sku,
            productName: selectedProduct.name,
            actionType: composerType,
            qty: parsedQty,
            reason: reason.trim(),
            notes: notes.trim() || null,
            referenceActionId: referenceDisposeId ?? null,
            createdByUserId: null,
            createdAt,
            updatedAt: createdAt,
            is_local_only: true
          } satisfies DesktopLpgItemActionRecord & { is_local_only: true }),
          updatedAt: createdAt
        }
      ]);
      const queued: LocalActionRecord = {
        id: actionId,
        branchId: appState.setup.branchId,
        branchCode: null,
        branchName: appState.setup.branchLabel || null,
        locationId: appState.setup.locationId,
        locationCode: null,
        locationName: appState.setup.locationLabel || null,
        productId: selectedProduct.id,
        productSku: selectedProduct.sku,
        productName: selectedProduct.name,
        actionType: composerType,
        qty: parsedQty,
        reason: reason.trim(),
        notes: notes.trim() || null,
        referenceActionId: referenceDisposeId ?? null,
        createdByUserId: null,
        createdAt,
        updatedAt: createdAt,
        source: 'local',
        syncStatus: 'pending'
      };
      setActions((current) => dedupeActions([queued, ...current]));
      desktopUi.showToast({
        tone: 'success',
        message:
          composerType === 'DISPOSE'
            ? `${selectedProduct.name} disposed record was queued for sync.`
            : composerType === 'REPLACE'
              ? `${selectedProduct.name} replacement was queued for sync.`
              : `${selectedProduct.name} junk note was queued for sync.`
      });
      closeComposer();
    };

    setSaving(true);
    try {
      await queueOfflineAction();
      await refresh();
    } catch (error) {
      desktopUi.showToast({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to queue LPG item action.'
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <LpgServiceOverviewPanel
        metrics={overviewMetrics}
        onRefresh={() => void refresh()}
        onHistory={() => {
          setHistoryActionFilter('ALL');
          setHistoryOpen(true);
        }}
        onDispose={() => openComposer('DISPOSE')}
        refreshDisabled={loading}
        disposeDisabled={!appState.setup.locationId}
      />

      {!appState.setup.locationId ? (
        <div className="message-banner stock-warning-banner">Select a location first before recording LPG service actions.</div>
      ) : null}

      <section className={`${shellCardClass} grid gap-5`}>
        <LpgServiceRecordsPanel
          title={mainBlockTitle}
          description="Review the full disposed, replaced, and junked trail for the current filter."
          searchValue={query}
          onSearchChange={setQuery}
          filterOptions={filterOptions}
          focusBanner={
            focusedProductId
              ? {
                  label: `${productMap.get(focusedProductId)?.name ?? 'Focused LPG item'} is currently filtered here.`,
                  onClear: () => setFocusedProductId(null)
                }
              : null
          }
          records={activeRecordCards}
          emptyMessage={actionFilter === 'DISPOSE' ? 'No disposed records found for this location.' : 'No records found for this filter.'}
        />
      </section>

      {composerOpen ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={modalCardClass}>
            <div className={modalToolbarClass}>
              <div className={composerLayoutClass}>
                <div className={composerHeaderTileClass}>
                  <svg
                    className={composerHeaderIconClass}
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      d="M7 6.5C7 5.12 8.12 4 9.5 4h5C15.88 4 17 5.12 17 6.5v11c0 1.38-1.12 2.5-2.5 2.5h-5C8.12 20 7 18.88 7 17.5v-11Z"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    />
                    <path d="M9.5 7.5h5M9.5 10.5h5M9.5 13.5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <path d="M8 21h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </div>
                <div className={composerHeaderCopyClass}>
                  <div className="eyebrow">LPG service action</div>
                  <h3>{actionLabel(composerType)}</h3>
                  <p className="m-0 text-[0.9rem] leading-6 text-[var(--muted)]">
                    {composerType === 'DISPOSE'
                      ? 'Select an item and capture the disposal record.'
                      : composerType === 'REPLACE'
                        ? 'Record a replacement against a previously disposed entry.'
                        : 'Record junk against a previously disposed entry.'}
                  </p>
                </div>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn"
                type="button"
                onClick={closeComposer}
                aria-label="Close modal"
                title="Close"
              >
                <LpgServiceIcon
                  path={
                    <>
                      <path d="M6 6l12 12" />
                      <path d="M18 6L6 18" />
                    </>
                  }
                />
              </button>
            </div>

            <div className={sheetContentClass}>
              {referenceDisposeId ? <div className="message-banner">Disposed Record: {describeReference(referenceDisposeId) ?? referenceDisposeId}</div> : null}
              <div className="lpg-service-composer-grid">
                <div className={composerStackClass}>
                  <div className="panel-head compact">
                    <div>
                      <div className="eyebrow">Item selection</div>
                      <h3>Select the item to record</h3>
                    </div>
                  </div>
                  {composerType === 'DISPOSE' ? (
                    <button className={composerSelectButtonClass} type="button" onClick={() => setItemPickerOpen(true)}>
                      Select item
                    </button>
                  ) : null}
                  {selectedProduct ? (
                    <div className={selectedProductClass}>
                      <strong className={selectedProductTitleClass}>{selectedProduct.name}</strong>
                      <span className={selectedProductCopyClass}>
                        {selectedProduct.sku} | {selectedProduct.category || 'Uncategorized'} | {selectedProduct.unit}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.96)] px-3 py-1 text-[0.78rem] font-semibold text-[var(--text-strong)]">
                          FULL {fmtNumber(selectedProduct.qtyFull)}
                        </span>
                        <span className="rounded-full border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.96)] px-3 py-1 text-[0.78rem] font-semibold text-[var(--text-strong)]">
                          EMPTY {fmtNumber(selectedProduct.qtyEmpty)}
                        </span>
                        <span className="rounded-full border border-[rgba(188,210,234,0.5)] bg-[rgba(255,255,255,0.96)] px-3 py-1 text-[0.78rem] font-semibold text-[var(--text-strong)]">
                          QOH {fmtNumber(selectedProduct.qtyOnHand)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className={composerEmptyStateClass}>Select an LPG item first to continue.</div>
                  )}

                  {composerType !== 'DISPOSE' ? (
                    selectedDisposedEntry ? (
                      <div className="desktop-line-item-row desktop-line-item-row--compact">
                        <div className="grid gap-1">
                          <strong className="text-[0.95rem] text-[var(--text-strong)]">Disposed source trail</strong>
                          <span className="text-[0.88rem] leading-5 text-[var(--muted)]">
                            {describeReference(selectedDisposedEntry.id) ?? selectedDisposedEntry.id}
                          </span>
                          <span className="text-[0.84rem] text-[var(--muted)]">Available {fmtNumber(selectedDisposedEntry.availableQty)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className={composerEmptyStateClass}>Select a disposed entry first to continue.</div>
                    )
                  ) : null}
                </div>

                <div className={composerFormClass}>
                  <div className={qtyCardClass}>
                    <div className={qtyHeadClass}>
                      <span className={qtyHeadLabelClass}>Quantity</span>
                      <small className={qtyHeadCopyClass}>{composerQtyHint}</small>
                    </div>
                    <div className={qtyRailClass}>
                      <button
                        className={qtyRailButtonClass}
                        type="button"
                        onClick={() => stepComposerQty(-1)}
                        aria-label="Decrease quantity"
                        disabled={!composerQtyEnabled || composerQtyValue <= 1}
                      >
                        -
                      </button>
                      <input
                        className={qtyValueClass}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={qty}
                        onChange={(event) => setQty(sanitizeLpgComposerQtyInput(event.target.value))}
                        onBlur={normalizeComposerQty}
                        disabled={!composerQtyEnabled}
                        aria-label="Quantity"
                        placeholder={composerQtyEnabled ? '1' : ''}
                      />
                      <button
                        className={qtyRailButtonClass}
                        type="button"
                        onClick={() => stepComposerQty(1)}
                        aria-label="Increase quantity"
                        disabled={!composerQtyEnabled || (composerQtyLimit > 0 && composerQtyValue >= composerQtyLimit)}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <label className={composerFieldClass}>
                    <span>Reason</span>
                    <input
                      className={composerFieldInputClass}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Reason"
                    />
                  </label>
                  <label className={composerFieldClass}>
                    <span>Notes (optional)</span>
                    <textarea
                      className={composerNotesInputClass}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Notes (optional)"
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className={modalActionRowClass}>
              <button className="secondary-btn" type="button" onClick={closeComposer}>
                Cancel
              </button>
              <button className="primary-btn" type="button" onClick={() => void submitAction()} disabled={saving}>
                {saving ? 'Saving...' : 'Save Action'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {itemPickerOpen && composerOpen && composerType === 'DISPOSE' ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={pickerModalCardClass}>
            <div className={modalToolbarClass}>
              <div>
                <div className="eyebrow">Item selection</div>
                <h3>Select Item</h3>
                <p className="m-0 text-[0.9rem] leading-6 text-[var(--muted)]">Choose the LPG item you want to mark as disposed.</p>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn"
                type="button"
                onClick={() => setItemPickerOpen(false)}
                aria-label="Close modal"
                title="Close"
              >
                <LpgServiceIcon
                  path={
                    <>
                      <path d="M6 6l12 12" />
                      <path d="M18 6L6 18" />
                    </>
                  }
                />
              </button>
            </div>
            <div className={sheetContentClass}>
              <SearchField className="w-full" value={modalProductQuery} onChange={setModalProductQuery} placeholder="Search item code or name" />
              <div className={productListClass}>
                {modalVisibleProducts.map((row) => {
                  const active = selectedProductId === row.id;
                  const outOfStock = row.qtyEmpty <= 0;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={`catalog-row picker-row pos-item-card ${active ? 'picker-row-selected' : ''}`}
                      onClick={() => {
                        if (!outOfStock) {
                          setSelectedProductId(row.id);
                          setItemPickerOpen(false);
                        }
                      }}
                      disabled={outOfStock}
                    >
                      <div className="pos-item-card-main">
                        <strong>{row.name}</strong>
                        <span className="pos-item-card-meta">
                          {row.sku} | {row.category || 'Uncategorized'} | {row.unit}
                        </span>
                        <span className="pos-item-card-stock">
                          Full {fmtNumber(row.qtyFull)} | Empty {fmtNumber(row.qtyEmpty)} | QOH {fmtNumber(row.qtyOnHand)}
                        </span>
                      </div>
                      <div className="catalog-row-right">
                        <div className={`stock-pill ${outOfStock ? 'out' : active ? 'good' : 'good'}`}>
                          {outOfStock ? 'No Stock' : active ? 'Selected' : 'Ready'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {historyOpen ? (
        <div className={modalBackdropClass} role="presentation">
          <LpgServiceHistoryModal
            filterOptions={historyFilterOptions}
            records={historyModalCards}
            onClose={() => setHistoryOpen(false)}
          />
        </div>
        ) : null}

      {selectedAction ? (
        <div className={modalBackdropClass} role="presentation" onClick={() => setSelectedActionId('')}>
          <LpgServiceDetailModal
            entry={selectedAction}
            product={productMap.get(selectedAction.productId) ?? null}
            referenceDescription={describeReference(selectedAction.referenceActionId)}
            derivedStats={
              selectedDisposedDetail
                ? {
                    junkQty: selectedDisposedDetail.junkQty,
                    replacedQty: selectedDisposedDetail.replacedQty,
                    availableQty: selectedDisposedDetail.availableQty
                  }
                : null
            }
            onClose={() => setSelectedActionId('')}
          />
        </div>
      ) : null}

      <button
        className="desktop-floating-action-btn desktop-floating-action-btn--with-bottom-bar"
        type="button"
        onClick={() => openComposer('DISPOSE')}
        disabled={!appState.setup.locationId}
        aria-label="Quick add LPG service disposal"
        title="Quick add LPG service disposal"
      >
        <LpgPageSymbol kind="plus" className="h-[30px] w-[30px]" />
      </button>
    </div>
  );
}

function fmtNumber(value: number): string {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}
