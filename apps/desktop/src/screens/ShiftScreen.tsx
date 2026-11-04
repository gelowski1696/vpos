import { useEffect, useMemo, useState } from 'react';
import { summarizeDesktopPettyCash } from '@vpos/desktop-core';
import type { OutboxItem } from '@vpos/shared-types';
import { desktopDb } from '../db/sqlite';
import type {
  DesktopAppState,
  DesktopExpenseRecord,
  DesktopSaleRecord,
  DesktopShiftCashEntry,
  DesktopShiftInventorySnapshot,
  DesktopShiftRecord
} from '../db/schema';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import { desktopExpenseService } from '../services/desktop-expense.service';
import type { TenantAddonFlags } from '../services/desktop-master-data.service';
import { desktopShiftInventoryReportService } from '../services/desktop-shift-inventory-report.service';
import { desktopShiftService } from '../services/desktop-shift.service';

type Props = {
  appState: DesktopAppState;
  tenantAddons?: TenantAddonFlags;
  onOutboxChanged?: () => Promise<void> | void;
  onAfterInventoryCountClose?: () => Promise<void> | void;
};

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function fmtDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '-';
}

function parseCashInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInventoryInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatInventoryInput(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
}

function resolveCashCollected(sale: DesktopSaleRecord): number {
  const paid = sale.payload.paidAmount ?? sale.payload.totalAmount;
  const change = sale.payload.changeAmount ?? 0;
  return Number(Math.max(0, paid - change).toFixed(2));
}

const screenStackClass = 'flex flex-col gap-4';
const summaryStripClass = 'desktop-summary-strip grid gap-3 sm:grid-cols-2 xl:grid-cols-7';
const summaryTileClass =
  'h-full rounded-[18px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.96)] px-3.5 py-3 shadow-[0_8px_18px_rgba(17,40,58,0.04)]';
const summaryLabelClass = 'block text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[0.96rem] font-extrabold text-[var(--text-strong)]';
const shellCardClass = 'desktop-module-section';
const contextStripClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const contextChipClass =
  'grid gap-1 rounded-[18px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-4 py-3 shadow-[0_8px_18px_rgba(17,40,58,0.04)]';
const contextLabelClass = 'text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const contextValueClass = 'text-[0.92rem] font-bold text-[var(--text-strong)]';
const actionCardClass =
  'grid content-start gap-3 rounded-[22px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.97)] p-3.5 shadow-[0_10px_24px_rgba(17,40,58,0.04)]';
const actionCardTitleClass = 'text-[1.02rem] font-extrabold text-[var(--text-strong)]';
const formGridClass = 'grid gap-2.5 md:grid-cols-2';
const infoMetricCardClass =
  'grid gap-1 rounded-[18px] border border-[var(--border-soft)] bg-white px-3.5 py-3 shadow-[0_8px_18px_rgba(17,40,58,0.04)]';
const infoMetricLabelClass = 'text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const infoMetricValueClass = 'text-[0.96rem] font-extrabold text-[var(--text-strong)]';
const cashMovementModeShellClass =
  'grid grid-cols-2 gap-1.5 rounded-[18px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(245,249,255,0.98),rgba(250,252,255,0.98))] p-1.5 shadow-[0_10px_20px_rgba(17,40,58,0.05)]';
const cashMovementFieldCardClass =
  'grid gap-2 rounded-[18px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(248,251,255,0.98),rgba(255,255,255,0.98))] px-3.5 py-3 shadow-[0_10px_20px_rgba(17,40,58,0.04)]';
const cashMovementFieldLabelClass = 'flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const cashMovementFieldIconClass =
  'grid h-7 w-7 shrink-0 place-items-center rounded-[10px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]';
const cashMovementInputShellClass =
  'flex min-h-[46px] items-center gap-2.5 rounded-[14px] border border-[rgba(220,230,239,0.9)] bg-white/95 px-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)] transition-[border-color,box-shadow] focus-within:border-[rgba(42,109,244,0.38)] focus-within:shadow-[0_0_0_4px_rgba(42,109,244,0.12)]';
const cashMovementInputClass =
  'w-full border-0 bg-transparent p-0 text-[0.92rem] font-semibold text-[var(--text-strong)] outline-none placeholder:text-[rgba(91,108,131,0.7)] disabled:cursor-not-allowed disabled:text-[rgba(91,108,131,0.7)]';
const listStackClass = 'space-y-3';
const recordCardClass =
  'flex flex-col gap-3 rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.98)] px-4 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)] md:flex-row md:items-start md:justify-between';
const recordBodyClass = 'min-w-0 space-y-1';
const recordTitleClass = 'text-[0.92rem] font-bold text-[var(--text-strong)]';
const recordMetaClass = 'block text-[0.8rem] text-[var(--muted)]';
const recordRightClass = 'flex min-w-[180px] flex-col items-start gap-2 md:items-end';
const modalBackdropClass = 'desktop-modal-backdrop';
const modalCardClass = 'desktop-modal-card desktop-modal-card--detail';
const modalToolbarClass = 'desktop-modal-header flex items-start justify-between gap-4';
const modalBodyClass = 'desktop-modal-body grid gap-4';
const modalFooterClass =
  'desktop-modal-footer flex shrink-0 flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6 sm:py-5';
const quickCashOptions = ['100', '200', '500', '1000'];
const inventoryCountPageSize = 6;
const openingCashDenominationOptions = [
  1000,
  500,
  200,
  100,
  50,
  20,
  10,
  5,
  1,
  0.5,
  0.25,
  0.1,
  0.05,
  0.01
] as const;

function emptyOpeningDenominationState(): Record<string, string> {
  return Object.fromEntries(openingCashDenominationOptions.map((value) => [String(value), ''])) as Record<string, string>;
}

function formatDenominationLabel(value: number): string {
  if (value >= 1) {
    return `PHP ${value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    })}`;
  }
  const centavos = Math.round(value * 100);
  return `${centavos} centavos`;
}

type OpeningDenominationRow = {
  denomination: number;
  quantity: number;
  total: number;
};

type InventoryCountInput = {
  qtyOnHand: string;
  qtyFull: string;
  qtyEmpty: string;
};

type InventoryCountInputMap = Record<string, InventoryCountInput>;

type InventorySnapshotLine = DesktopShiftInventorySnapshot['lines'][number];

type InventoryCountMetric = {
  countedQtyOnHand: number;
  enteredLineCount: number;
  requiredLineCount: number;
};

function createInventoryCountInputs(snapshot: DesktopShiftInventorySnapshot | null): InventoryCountInputMap {
  if (!snapshot) {
    return {};
  }
  return Object.fromEntries(
    snapshot.lines.map((line) => [
      line.productId,
      {
        qtyOnHand: '',
        qtyFull: '',
        qtyEmpty: ''
      }
    ])
  ) as InventoryCountInputMap;
}

function hasInventoryCountValue(value: string | undefined): boolean {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

function parseEnteredInventoryCount(value: string | undefined): number {
  return hasInventoryCountValue(value) ? parseInventoryInput(value ?? '') : 0;
}

function parseInventoryCountOrFallback(value: string | undefined, fallback: number): number {
  return hasInventoryCountValue(value) ? parseInventoryInput(value ?? '') : fallback;
}

function isInventoryCountLineComplete(line: InventorySnapshotLine, entry: InventoryCountInput | undefined): boolean {
  if (line.isLpg) {
    return hasInventoryCountValue(entry?.qtyFull) && hasInventoryCountValue(entry?.qtyEmpty);
  }
  return hasInventoryCountValue(entry?.qtyOnHand);
}

function isInventoryCountComplete(snapshot: DesktopShiftInventorySnapshot, counts: InventoryCountInputMap): boolean {
  return snapshot.lines.every((line) => isInventoryCountLineComplete(line, counts[line.productId]));
}

function buildInventoryCountSnapshot(
  snapshot: DesktopShiftInventorySnapshot,
  counts: InventoryCountInputMap
): DesktopShiftInventorySnapshot {
  return {
    ...snapshot,
    capturedAt: new Date().toISOString(),
    lines: snapshot.lines.map((line) => {
      const entry = counts[line.productId];
      if (line.isLpg) {
        const qtyFull = parseInventoryCountOrFallback(entry?.qtyFull, line.qtyFull);
        const qtyEmpty = parseInventoryCountOrFallback(entry?.qtyEmpty, line.qtyEmpty);
        return {
          ...line,
          qtyFull,
          qtyEmpty,
          qtyOnHand: Number((qtyFull + qtyEmpty).toFixed(2))
        };
      }
      const qtyOnHand = parseInventoryCountOrFallback(entry?.qtyOnHand, line.qtyOnHand);
      return {
        ...line,
        qtyOnHand,
        qtyFull: 0,
        qtyEmpty: 0
      };
    })
  };
}

function summarizeInventoryCount(snapshot: DesktopShiftInventorySnapshot, counts: InventoryCountInputMap): InventoryCountMetric {
  return snapshot.lines.reduce<InventoryCountMetric>(
    (totals, line) => {
      const entry = counts[line.productId];
      const countedQtyOnHand = line.isLpg
        ? Number((parseEnteredInventoryCount(entry?.qtyFull) + parseEnteredInventoryCount(entry?.qtyEmpty)).toFixed(2))
        : parseEnteredInventoryCount(entry?.qtyOnHand);

      return {
        countedQtyOnHand: Number((totals.countedQtyOnHand + countedQtyOnHand).toFixed(2)),
        enteredLineCount: totals.enteredLineCount + (isInventoryCountLineComplete(line, entry) ? 1 : 0),
        requiredLineCount: totals.requiredLineCount + 1
      };
    },
    {
      countedQtyOnHand: 0,
      enteredLineCount: 0,
      requiredLineCount: 0
    }
  );
}

type CashEntryMode = 'AMOUNT' | 'DENOMINATION';

type ShiftWorkspaceShellProps = {
  appState: DesktopAppState;
  activeShift: DesktopShiftRecord | null;
  shifts: DesktopShiftRecord[];
  cashEntries: DesktopShiftCashEntry[];
  shiftSales: DesktopSaleRecord[];
  cashDirection: 'IN' | 'OUT';
  cashAmount: string;
  cashNotes: string;
  closingCash: string;
  cashIn: number;
  cashOut: number;
  cashSales: number;
  cashReturns: number;
  expectedCash: number;
  saving: boolean;
  loading: boolean;
  onOpenStartShift: () => void;
  onCashDirectionChange: (value: 'IN' | 'OUT') => void;
  onCashAmountChange: (value: string) => void;
  onCashNotesChange: (value: string) => void;
  onAddCashAdjustment: () => void;
  onOpenCloseShift: () => void;
};

type ShiftStartModalProps = {
  appState: DesktopAppState;
  openingCashEntryMode: CashEntryMode;
  openingCashAmount: number;
  openingCash: string;
  openingDenominationRows: OpeningDenominationRow[];
  openingDenominationCounts: Record<string, string>;
  openingDenominationActiveLines: number;
  openingDenominationPieces: number;
  openingDenominationTotal: number;
  saving: boolean;
  onClose: () => void;
  onSelectMode: (mode: CashEntryMode) => void;
  onOpeningCashChange: (value: string) => void;
  onQuickAmount: (value: string) => void;
  onStepDenomination: (denomination: number, delta: 1 | -1) => void;
  onUpdateDenomination: (denomination: number, value: string) => void;
  onClearDenominations: () => void;
  onStart: () => void;
};

type ShiftCloseModalProps = {
  appState: DesktopAppState;
  activeShift: DesktopShiftRecord;
  expectedCash: number;
  requiresInventoryCount?: boolean;
  closingCashEntryMode: CashEntryMode;
  closingCashAmount: number;
  closingCash: string;
  closingDenominationRows: OpeningDenominationRow[];
  closingDenominationCounts: Record<string, string>;
  closingDenominationActiveLines: number;
  closingDenominationPieces: number;
  closingDenominationTotal: number;
  variancePreview: number;
  saving: boolean;
  onClose: () => void;
  onSelectMode: (mode: CashEntryMode) => void;
  onClosingCashChange: (value: string) => void;
  onQuickAmount: (value: string) => void;
  onStepDenomination: (denomination: number, delta: 1 | -1) => void;
  onUpdateDenomination: (denomination: number, value: string) => void;
  onClearDenominations: () => void;
  onEndShift: () => void;
};

type ShiftInventoryCountModalProps = {
  appState: DesktopAppState;
  activeShift: DesktopShiftRecord;
  expectedCash: number;
  countedCash: number;
  cashVariance: number;
  inventorySnapshot: DesktopShiftInventorySnapshot;
  inventoryCounts: InventoryCountInputMap;
  saving: boolean;
  onClose: () => void;
  onBackToCloseout: () => void;
  onUpdateCount: (productId: string, field: keyof InventoryCountInput, value: string) => void;
  onFinalize: () => void;
};

type ShiftVisualTone = 'accent' | 'good' | 'warn' | 'neutral' | 'danger';

function shiftToneClasses(tone: ShiftVisualTone): {
  shell: string;
  icon: string;
  badge: string;
  value: string;
} {
  if (tone === 'good') {
    return {
      shell: 'border-[rgba(190,228,199,0.72)] bg-[rgba(248,253,249,0.98)]',
      icon: 'border-[rgba(190,228,199,0.72)] bg-[rgba(238,250,242,0.98)] text-[#1a7a3c]',
      badge: 'border-[rgba(190,228,199,0.72)] bg-[rgba(238,250,242,0.98)] text-[#1a7a3c]',
      value: 'text-[#1a7a3c]'
    };
  }
  if (tone === 'warn') {
    return {
      shell: 'border-[rgba(245,219,173,0.74)] bg-[rgba(255,250,244,0.98)]',
      icon: 'border-[rgba(246,211,147,0.72)] bg-[rgba(255,244,225,0.98)] text-[#b56a00]',
      badge: 'border-[rgba(246,211,147,0.72)] bg-[rgba(255,244,225,0.98)] text-[#b56a00]',
      value: 'text-[#b56a00]'
    };
  }
  if (tone === 'danger') {
    return {
      shell: 'border-[rgba(248,190,196,0.76)] bg-[rgba(255,248,249,0.98)]',
      icon: 'border-[rgba(248,190,196,0.76)] bg-[rgba(255,238,240,0.98)] text-[#c2415c]',
      badge: 'border-[rgba(248,190,196,0.76)] bg-[rgba(255,238,240,0.98)] text-[#c2415c]',
      value: 'text-[#c2415c]'
    };
  }
  if (tone === 'neutral') {
    return {
      shell: 'border-[rgba(198,210,224,0.74)] bg-[rgba(250,252,255,0.98)]',
      icon: 'border-[rgba(198,210,224,0.74)] bg-[rgba(244,247,251,0.98)] text-[#5b6c83]',
      badge: 'border-[rgba(198,210,224,0.74)] bg-[rgba(244,247,251,0.98)] text-[#5b6c83]',
      value: 'text-[#233142]'
    };
  }
  return {
    shell: 'border-[rgba(198,220,245,0.78)] bg-[rgba(245,249,255,0.98)]',
    icon: 'border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]',
    badge: 'border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]',
    value: 'text-[var(--accent-strong)]'
  };
}

function shiftSyncTone(syncStatus: 'pending' | 'failed' | 'synced'): ShiftVisualTone {
  if (syncStatus === 'failed') {
    return 'danger';
  }
  if (syncStatus === 'synced') {
    return 'good';
  }
  return 'warn';
}

function shiftDutyTone(activeShift: DesktopShiftRecord | null): ShiftVisualTone {
  return activeShift ? 'good' : 'neutral';
}

function formatShiftStatusLabel(value: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return 'Pending';
  }
  return normalized
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function ShiftIcon({
  kind,
  className = 'h-[18px] w-[18px]'
}: {
  kind:
    | 'shift'
    | 'cash'
    | 'forecast'
    | 'sale'
    | 'movement'
    | 'timeline'
    | 'location'
    | 'user'
    | 'history'
    | 'log'
    | 'start'
    | 'close'
    | 'status';
  className?: string;
}): JSX.Element {
  if (kind === 'cash') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.5 7.5h17v9h-17z" />
        <circle cx="12" cy="12" r="2.4" />
        <path d="M7 10h.01M17 14h.01" />
      </svg>
    );
  }
  if (kind === 'forecast') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19h16" />
        <path d="M6.5 15.5 10 12l3 2.5 4.5-6" />
        <path d="M15.8 8.5h1.7V10.2" />
      </svg>
    );
  }
  if (kind === 'sale') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 4.8h9l3 3v11.4H6z" />
        <path d="M15 4.8v3h3" />
        <path d="M8.6 11h6.8M8.6 14.2h6.8" />
      </svg>
    );
  }
  if (kind === 'movement') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 8h11" />
        <path d="m11 5 4 3-4 3" />
        <path d="M20 16H9" />
        <path d="m13 13-4 3 4 3" />
      </svg>
    );
  }
  if (kind === 'timeline') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="7" cy="7" r="2" />
        <circle cx="17" cy="12" r="2" />
        <circle cx="7" cy="17" r="2" />
        <path d="M8.6 8.2 15.4 10.8M15.4 13.2 8.6 15.8" />
      </svg>
    );
  }
  if (kind === 'location') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 21s6-4.6 6-10a6 6 0 1 0-12 0c0 5.4 6 10 6 10Z" />
        <circle cx="12" cy="11" r="2.2" />
      </svg>
    );
  }
  if (kind === 'user') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="3.1" />
        <path d="M5 19c1.8-3.1 4.2-4.6 7-4.6s5.2 1.5 7 4.6" />
      </svg>
    );
  }
  if (kind === 'history') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4v5h5" />
        <path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.7" />
        <path d="M12 8v4l2.5 1.5" />
      </svg>
    );
  }
  if (kind === 'log') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 5h10" />
        <path d="M7 9h10" />
        <path d="M7 13h6" />
        <path d="M5 19h14" />
      </svg>
    );
  }
  if (kind === 'start') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }
  if (kind === 'close') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 6 12 12" />
        <path d="M18 6 6 18" />
      </svg>
    );
  }
  if (kind === 'status') {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 7 10.2 16.8 6 12.6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ShiftSummaryCard({
  label,
  value,
  note,
  icon,
  tone
}: {
  label: string;
  value: string;
  note: string;
  icon: Parameters<typeof ShiftIcon>[0]['kind'];
  tone: ShiftVisualTone;
}): JSX.Element {
  const classes = shiftToneClasses(tone);
  return (
    <div className={`${summaryTileClass} ${classes.shell}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[14px] border ${classes.icon}`}>
          <ShiftIcon kind={icon} className="h-[16px] w-[16px]" />
        </span>
        <div className="min-w-0">
          <span className={summaryLabelClass}>{label}</span>
          <strong className={`${summaryValueClass} ${classes.value}`}>{value}</strong>
          <p className="mt-1 text-[0.74rem] leading-[1.15rem] text-[var(--muted)]">{note}</p>
        </div>
      </div>
    </div>
  );
}

function ShiftInlineMetric({
  label,
  value,
  note,
  icon,
  tone
}: {
  label: string;
  value: string;
  note: string;
  icon: Parameters<typeof ShiftIcon>[0]['kind'];
  tone: ShiftVisualTone;
}): JSX.Element {
  const classes = shiftToneClasses(tone);
  return (
    <div className="grid h-full content-start gap-2 rounded-[20px] border border-[rgba(220,230,239,0.82)] bg-white px-3.5 py-3.5 shadow-[0_8px_18px_rgba(17,40,58,0.04)]">
      <div className="flex items-center gap-2.5">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[12px] border ${classes.icon}`}>
          <ShiftIcon kind={icon} className="h-[14px] w-[14px]" />
        </span>
        <span className={infoMetricLabelClass}>{label}</span>
      </div>
      <strong className={`block text-[0.94rem] font-extrabold ${classes.value}`}>{value}</strong>
      <p className="text-[0.74rem] leading-[1.1rem] text-[var(--muted)]">{note}</p>
    </div>
  );
}

function ShiftContextPill({
  label,
  value,
  icon
}: {
  label: string;
  value: string;
  icon: Parameters<typeof ShiftIcon>[0]['kind'];
}): JSX.Element {
  return (
    <div className={contextChipClass}>
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-[10px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.96)] text-[var(--accent-strong)]">
          <ShiftIcon kind={icon} className="h-[13px] w-[13px]" />
        </span>
        <span className={contextLabelClass}>{label}</span>
      </div>
      <strong className={contextValueClass}>{value}</strong>
    </div>
  );
}

function ShiftSnapshotRow({
  label,
  value
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[rgba(220,230,239,0.72)] py-2.5 last:border-b-0 last:pb-0 first:pt-0">
      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</span>
      <strong className="text-right text-[0.82rem] font-bold leading-5 text-[var(--text-strong)]">{value}</strong>
    </div>
  );
}

function ShiftActivityRow({
  title,
  subtitle,
  amount,
  meta,
  status,
  tone
}: {
  title: string;
  subtitle: string;
  amount: string;
  meta: string;
  status: string;
  tone: ShiftVisualTone;
}): JSX.Element {
  const classes = shiftToneClasses(tone);
  return (
    <article className={recordCardClass}>
      <div className={recordBodyClass}>
        <strong className={`${recordTitleClass} leading-5`}>{title}</strong>
        <span className={`mt-1 ${recordMetaClass} leading-5`}>{subtitle}</span>
      </div>
      <div className={recordRightClass}>
        <strong className="text-[0.96rem] font-extrabold tracking-[-0.01em] text-[var(--text-strong)]">{amount}</strong>
        <span className="text-[0.74rem] leading-5 text-[var(--muted)]">{meta}</span>
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[0.65rem] font-bold uppercase tracking-[0.12em] ${classes.badge}`}>
          {formatShiftStatusLabel(status)}
        </span>
      </div>
    </article>
  );
}

export function ShiftWorkspaceShell({
  appState,
  activeShift,
  shifts,
  cashEntries,
  shiftSales,
  cashDirection,
  cashAmount,
  cashNotes,
  closingCash,
  cashIn,
  cashOut,
  cashSales,
  cashReturns,
  expectedCash,
  saving,
  loading,
  onOpenStartShift,
  onCashDirectionChange,
  onCashAmountChange,
  onCashNotesChange,
  onAddCashAdjustment,
  onOpenCloseShift
}: ShiftWorkspaceShellProps): JSX.Element {
  const dutyTone = shiftDutyTone(activeShift);
  const dutyClasses = shiftToneClasses(dutyTone);
  const countedCash = parseCashInput(closingCash);
  const variancePreview = activeShift ? Number((countedCash - expectedCash).toFixed(2)) : 0;
  const varianceTone: ShiftVisualTone =
    variancePreview > 0 ? 'good' : variancePreview < 0 ? 'danger' : 'accent';
  const cashierName =
    activeShift?.cashierName || appState.auth.userFullName || appState.setup.operatorName || 'Cashier';
  const shiftHistoryRows = shifts.slice(0, 6);
  const cashEntryRows = cashEntries.slice(0, 6);
  const shiftSaleRows = shiftSales.slice(0, 8);
  const dutyLabel = activeShift ? 'Open duty' : 'No active shift';
  const dutyContextLabel = activeShift ? 'Open duty' : 'Ready to start';
  const dutyMeta = activeShift ? `Started ${fmtDate(activeShift.openedAt)}` : 'Ready for the next opening count';
  const movementNote = `In ${fmtMoney(cashIn)} | Out ${fmtMoney(cashOut)}`;
  const headerActionLabel = activeShift ? 'End Duty' : 'Start Duty';
  const primaryHeaderAction = activeShift ? onOpenCloseShift : onOpenStartShift;
  const currentMovementTotal = Number((cashIn + cashOut).toFixed(2));
  const currentDutyActionLabel = activeShift ? 'Live duty workspace' : 'Opening checklist';
  const currentDutyActionCopy = activeShift
    ? 'Track this shift through closeout without leaving the workspace.'
    : 'Enter opening cash before starting duty so this shift begins with the correct cash baseline.';
  const currentDutyDetails = [
    { label: 'Branch', value: activeShift?.branchLabel || appState.setup.branchLabel || 'Not set' },
    { label: 'Location', value: activeShift?.locationLabel || appState.setup.locationLabel || 'Not set' },
    { label: 'Cashier', value: cashierName },
    { label: 'Expected Cash', value: fmtMoney(expectedCash) }
  ];
  return (
    <div className={screenStackClass}>
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <ShiftIcon kind="user" className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <div className="eyebrow">Shift</div>
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">Shift</h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">
              Open, track, and close cashier duty with the same compact desktop module pattern used across inventory and service screens.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2.5 xl:justify-end">
          <button
            className="primary-btn inline-flex min-h-[48px] items-center gap-2.5 rounded-[16px] px-5 text-[0.88rem]"
            type="button"
            onClick={primaryHeaderAction}
            disabled={saving}
          >
            <ShiftIcon kind={activeShift ? 'close' : 'start'} className="h-[18px] w-[18px]" />
            <span>{headerActionLabel}</span>
          </button>
        </div>
      </section>

      <section className={summaryStripClass}>
        <ShiftSummaryCard
          label="Duty State"
          value={dutyLabel}
          note={activeShift ? 'Tracking local activity' : 'Ready to start'}
          icon="status"
          tone={dutyTone}
        />
        <ShiftSummaryCard
          label="Opening Cash"
          value={fmtMoney(activeShift?.openingCash ?? 0)}
          note={activeShift ? 'Opening cash baseline' : 'Will be recorded on start'}
          icon="cash"
          tone="accent"
        />
        <ShiftSummaryCard
          label="Drawer Forecast"
          value={fmtMoney(expectedCash)}
          note="Expected drawer value"
          icon="forecast"
          tone="good"
        />
        <ShiftSummaryCard
          label="Cash Sales"
          value={fmtMoney(cashSales)}
          note="Cash collected in duty"
          icon="sale"
          tone="accent"
        />
        <ShiftSummaryCard
          label="Cash Movement"
          value={fmtMoney(currentMovementTotal)}
          note={movementNote}
          icon="movement"
          tone="warn"
        />
        <ShiftSummaryCard
          label="Receipts in Duty"
          value={String(shiftSales.length)}
          note="Local receipts attached"
          icon="history"
          tone="neutral"
        />
        <ShiftSummaryCard
          label="Cash Returns"
          value={fmtMoney(cashReturns)}
          note={cashReturns > 0 ? 'Returns posted in duty' : 'No cash returns posted'}
          icon="history"
          tone={cashReturns > 0 ? 'warn' : 'neutral'}
        />
      </section>

      <section className="grid gap-3">
        <section className={`${shellCardClass} !gap-3 !p-4 shift-current-duty-card`}>
            <div className="panel-head compact !mb-0">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]">
                  <ShiftIcon kind="user" className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <div className="eyebrow">Current duty</div>
                  <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">Current duty</h3>
                  <p className="m-0 text-[0.9rem] leading-6 text-[var(--muted)]">
                    {activeShift ? 'Track this shift through closeout without leaving the workspace.' : 'Review workstation context before opening the next duty.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-px overflow-hidden rounded-[18px] border border-[var(--border-soft)] bg-[rgba(220,230,239,0.82)] md:grid-cols-4">
              {currentDutyDetails.map((item) => (
                <div key={item.label} className="bg-white px-3.5 py-3">
                  <span className={infoMetricLabelClass}>{item.label}</span>
                  <strong className="mt-1 block text-[0.94rem] font-extrabold text-[var(--text-strong)]">{item.value}</strong>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 rounded-[18px] border border-[rgba(196,220,255,0.74)] bg-[linear-gradient(180deg,rgba(244,248,255,0.98),rgba(250,252,255,0.98))] px-3.5 py-3 shadow-[0_8px_20px_rgba(17,40,58,0.04)] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border border-[rgba(196,220,255,0.74)] bg-white text-[var(--accent-strong)]">
                  <ShiftIcon kind={activeShift ? 'status' : 'start'} className="h-[16px] w-[16px]" />
                </span>
                <div className="min-w-0">
                  <strong className="block text-[0.9rem] font-bold text-[var(--text-strong)]">{currentDutyActionLabel}</strong>
                  <p className="m-0 text-[0.8rem] leading-5 text-[var(--muted)]">{currentDutyActionCopy}</p>
                </div>
              </div>
            </div>
        </section>

        <section className={`${shellCardClass} !gap-4 !p-4 shift-duty-controls-card`}>
            <div className="panel-head compact !mb-0 shift-duty-controls-head">
              <div className="flex min-w-0 items-start gap-3.5">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_10px_24px_rgba(17,40,58,0.05)]">
                  <ShiftIcon kind="movement" className="h-[22px] w-[22px]" />
                </span>
                <div className="min-w-0">
                  <div className="eyebrow">Duty controls</div>
                  <h3 className="m-0 text-[1.08rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.2rem]">Duty controls</h3>
                  <p className="m-0 text-[0.9rem] leading-6 text-[var(--muted)]">
                    Manage cash movement and closeout from the same compact action workspace.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 shift-duty-controls-grid xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
              <section className={`${actionCardClass} shift-duty-action-panel !gap-4 !rounded-[26px] !border-[rgba(188,210,234,0.58)] !bg-[rgba(255,255,255,0.98)] !p-5`}>
                <div className="panel-head compact !mb-0">
                  <div>
                    <div className="eyebrow">Action desk</div>
                    <h3 className="m-0 text-[1.06rem] font-extrabold text-[var(--text-strong)]">Cash movement</h3>
                    <p className="m-0 mt-1 text-[0.84rem] leading-6 text-[var(--muted)]">
                      {activeShift ? 'Record cash in or out without leaving the current duty workspace.' : 'Start duty first before recording cash movement.'}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3.5">
                  <div className={cashMovementModeShellClass}>
                    {(['OUT', 'IN'] as const).map((direction) => {
                      const isActive = cashDirection === direction;
                      const isCashIn = direction === 'IN';
                      const activeClass = 'border-transparent bg-[linear-gradient(145deg,var(--accent),var(--accent-strong))] text-white shadow-[0_12px_22px_rgba(42,109,244,0.24)]';
                      const idleClass = 'border-transparent bg-transparent text-[var(--muted)] hover:bg-[rgba(240,246,255,0.9)]';

                      return (
                        <button
                          key={direction}
                          type="button"
                          className={`flex min-h-[60px] items-center justify-center gap-2.5 rounded-[16px] border px-4 text-[0.88rem] font-extrabold transition-[background,color,box-shadow,transform] ${isActive ? activeClass : idleClass} disabled:cursor-not-allowed disabled:opacity-55`}
                          onClick={() => onCashDirectionChange(direction)}
                          disabled={!activeShift}
                          aria-pressed={isActive}
                        >
                          <span className={`grid h-8 w-8 place-items-center rounded-[11px] ${isActive ? 'bg-white/18 text-current' : 'bg-white/92 text-[var(--accent-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]'}`}>
                            <ShiftIcon kind={isCashIn ? 'cash' : 'movement'} className="h-[14px] w-[14px]" />
                          </span>
                          <span>{isCashIn ? 'Cash In' : 'Cash Out'}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className={`${formGridClass} items-stretch`}>
                    <label className={`${cashMovementFieldCardClass} !rounded-[22px] !px-4 !py-3.5`}>
                      <span className={cashMovementFieldLabelClass}>
                        <span className={cashMovementFieldIconClass}>
                          <ShiftIcon kind="cash" className="h-[13px] w-[13px]" />
                        </span>
                        Amount
                      </span>
                      <div className={`${cashMovementInputShellClass} !min-h-[60px] !rounded-[16px] !px-4`}>
                        <span className="text-[0.8rem] font-extrabold uppercase tracking-[0.08em] text-[var(--accent-strong)]">PHP</span>
                        <input
                          className={`${cashMovementInputClass} !text-[0.98rem]`}
                          value={cashAmount}
                          onChange={(event) => onCashAmountChange(event.target.value)}
                          placeholder="0.00"
                          disabled={!activeShift}
                          inputMode="decimal"
                        />
                      </div>
                    </label>
                    <label className={`${cashMovementFieldCardClass} !rounded-[22px] !px-4 !py-3.5`}>
                      <span className={cashMovementFieldLabelClass}>
                        <span className={cashMovementFieldIconClass}>
                          <ShiftIcon kind="log" className="h-[13px] w-[13px]" />
                        </span>
                        Notes
                      </span>
                      <div className={`${cashMovementInputShellClass} !min-h-[60px] !rounded-[16px] !px-4`}>
                        <input
                          className={`${cashMovementInputClass} !text-[0.98rem]`}
                          value={cashNotes}
                          onChange={(event) => onCashNotesChange(event.target.value)}
                          placeholder="Add reason or notes"
                          disabled={!activeShift}
                        />
                      </div>
                    </label>
                  </div>
                </div>
              </section>

              <section className={`${actionCardClass} shift-duty-closeout-panel !gap-4 !rounded-[26px] !border-[rgba(188,210,234,0.58)] !bg-[rgba(255,255,255,0.98)] !p-5`}>
                <div className="grid gap-4 lg:grid-cols-[minmax(200px,0.84fr)_minmax(0,1.16fr)] lg:items-start">
                  <div className="grid content-start gap-2.5">
                    <div className="eyebrow">Closeout</div>
                    <h3 className="m-0 text-[1.06rem] font-extrabold text-[var(--text-strong)]">Close shift</h3>
                    <p className="m-0 text-[0.84rem] leading-6 text-[var(--muted)]">
                      {activeShift ? 'Compare the forecast against the counted drawer before ending duty.' : 'A shift must be open before closeout can begin.'}
                    </p>
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-3">
                    <ShiftInlineMetric
                      label="Expected"
                      value={fmtMoney(expectedCash)}
                      note="Forecast from sales"
                      icon="forecast"
                      tone="good"
                    />
                    <ShiftInlineMetric
                      label="Counted"
                      value={fmtMoney(countedCash)}
                      note={activeShift ? 'Live preview from count' : 'Waiting for active duty'}
                      icon="cash"
                      tone="accent"
                    />
                    <ShiftInlineMetric
                      label="Variance"
                      value={fmtMoney(variancePreview)}
                      note={activeShift ? 'Balanced drawer preview' : 'No active closeout'}
                      icon="movement"
                      tone={varianceTone}
                    />
                  </div>
                </div>
              </section>

              <section className="grid gap-3 rounded-[26px] border border-[rgba(188,210,234,0.58)] bg-[rgba(255,255,255,0.98)] p-5 shadow-[0_10px_24px_rgba(17,40,58,0.04)] shift-duty-summary-panel">
                <div>
                  <strong className="block text-[1.02rem] font-extrabold text-[var(--text-strong)]">Current movement summary</strong>
                  <strong className="mt-3 block text-[1.9rem] font-extrabold tracking-[-0.03em] text-[var(--text-strong)]">{fmtMoney(currentMovementTotal)}</strong>
                  <p className="mt-3 max-w-[34ch] text-[0.84rem] leading-6 text-[var(--muted)]">
                    {activeShift ? 'This keeps the current workflow unchanged and queues entries for sync.' : 'Open a shift to record movement and keep the drawer aligned.'}
                  </p>
                </div>
                {activeShift ? (
                  <button
                    className="secondary-btn min-h-[52px] justify-center rounded-[18px] px-5 text-[0.95rem] font-bold"
                    type="button"
                    onClick={onAddCashAdjustment}
                    disabled={saving}
                  >
                    Add Cash Adjustment
                  </button>
                ) : null}
              </section>

              <section className={`grid gap-3 rounded-[26px] border p-5 shadow-[0_10px_24px_rgba(17,40,58,0.04)] shift-duty-snapshot-panel ${dutyClasses.shell}`}>
                <div className="flex flex-col gap-3 border-b border-[rgba(220,230,239,0.72)] pb-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[14px] border ${dutyClasses.icon}`}>
                      <ShiftIcon kind="shift" className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <span className={infoMetricLabelClass}>Duty snapshot</span>
                      <strong className="mt-1 block text-[1.02rem] font-extrabold text-[var(--text-strong)]">{dutyContextLabel}</strong>
                      <p className="mt-1 text-[0.78rem] leading-5 text-[var(--muted)]">{dutyMeta}</p>
                    </div>
                  </div>
                  <span className={`inline-flex h-fit rounded-full border px-3 py-1.5 text-[0.72rem] font-bold ${dutyClasses.badge}`}>
                    {dutyLabel}
                  </span>
                </div>

                <div className="grid gap-1.5">
                  <ShiftSnapshotRow label="Duty" value={dutyLabel} />
                  <ShiftSnapshotRow label="Cashier" value={cashierName} />
                  <ShiftSnapshotRow label="Expected Cash" value={fmtMoney(expectedCash)} />
                  <ShiftSnapshotRow label="Started" value={activeShift ? fmtDate(activeShift.openedAt) : 'Not started'} />
                </div>
              </section>
            </div>
        </section>
      </section>

      <section className="grid gap-3 xl:grid-cols-3">
        <section className={`${shellCardClass} !gap-3 !p-4 shift-history-panel`}>
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Archive</div>
              <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">Shift history</h3>
              <p className="m-0 text-[0.84rem] leading-6 text-[var(--muted)]">
                Review the latest local shifts with their open and close timestamps.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="empty-state">Loading local shift activity...</div>
            ) : shiftHistoryRows.length === 0 ? (
              <div className="empty-state">No local shifts yet.</div>
            ) : (
              shiftHistoryRows.map((shift) => (
                <ShiftActivityRow
                  key={shift.id}
                  title={shift.cashierName}
                  subtitle={`${shift.id} | Opened ${fmtDate(shift.openedAt)}`}
                  amount={fmtMoney(shift.openingCash)}
                  meta={shift.closedAt ? `Closed ${fmtDate(shift.closedAt)}` : 'Still open'}
                  status={shift.syncStatus}
                  tone={shift.status === 'OPEN' ? 'accent' : shiftSyncTone(shift.syncStatus)}
                />
              ))
            )}
          </div>
        </section>

        <section className={`${shellCardClass} !gap-3 !p-4 shift-cash-log-panel`}>
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Drawer Log</div>
              <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">Cash adjustment log</h3>
              <p className="m-0 text-[0.84rem] leading-6 text-[var(--muted)]">
                Keep a visible trail of local cash additions and deductions inside duty.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="empty-state">Loading local cash adjustments...</div>
            ) : cashEntryRows.length === 0 ? (
              <div className="empty-state">No cash adjustments yet.</div>
            ) : (
              cashEntryRows.map((entry) => (
                <ShiftActivityRow
                  key={entry.id}
                  title={entry.direction === 'IN' ? 'Cash In' : 'Cash Out'}
                  subtitle={entry.notes || 'No notes'}
                  amount={fmtMoney(entry.amount)}
                  meta={fmtDate(entry.createdAt)}
                  status={entry.syncStatus}
                  tone={entry.direction === 'IN' ? 'good' : 'warn'}
                />
              ))
            )}
          </div>
        </section>

        <section className={`${shellCardClass} !gap-3 !p-4 shift-sales-panel`}>
          <div className="panel-head compact">
            <div>
              <div className="eyebrow">Receipt Coverage</div>
              <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">Sales in current duty</h3>
              <p className="m-0 text-[0.84rem] leading-6 text-[var(--muted)]">
                Local receipts counted inside the current shift window stay visible here for quick review.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="empty-state">Loading local sales in this duty...</div>
            ) : shiftSaleRows.length === 0 ? (
              <div className="empty-state">No local sales are inside this shift window yet.</div>
            ) : (
              shiftSaleRows.map((sale) => (
                <ShiftActivityRow
                  key={sale.id}
                  title={sale.receiptNumber}
                  subtitle={`${sale.payload.customerName || 'Walk-in customer'} | ${sale.payload.paymentMethod}`}
                  amount={fmtMoney(sale.payload.totalAmount)}
                  meta={fmtDate(sale.createdAt)}
                  status={sale.saleStatus === 'CANCELLED' ? 'cancelled' : sale.syncStatus}
                  tone={sale.saleStatus === 'CANCELLED' ? 'danger' : shiftSyncTone(sale.syncStatus)}
                />
              ))
            )}
          </div>
        </section>
      </section>
    </div>
  );
}

export function ShiftStartModal({
  appState,
  openingCashEntryMode,
  openingCashAmount,
  openingCash,
  openingDenominationRows,
  openingDenominationCounts,
  openingDenominationActiveLines,
  openingDenominationPieces,
  openingDenominationTotal,
  saving,
  onClose,
  onSelectMode,
  onOpeningCashChange,
  onQuickAmount,
  onStepDenomination,
  onUpdateDenomination,
  onClearDenominations,
  onStart
}: ShiftStartModalProps): JSX.Element {
  const cashierName = appState.auth.userFullName || appState.setup.operatorName || 'Cashier';
  const locationLabel = appState.setup.locationLabel || 'Not set';
  const branchLabel = appState.setup.branchLabel || 'Not set';

  return (
    <div className={modalBackdropClass} role="presentation" onClick={() => !saving && onClose()}>
      <div
        className={`${modalCardClass} shift-start-modal-shell !max-w-[980px] !rounded-[28px]`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={modalToolbarClass}>
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-[56px] w-[56px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.74)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
              <ShiftIcon kind="start" className="h-[24px] w-[24px]" />
            </div>
            <div className="min-w-0">
              <div className="eyebrow">Shift opening</div>
              <h3 className="m-0 text-[1.08rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)]">Opening cash</h3>
              <p className="mt-1.5 max-w-[40rem] text-[0.84rem] leading-5 text-[var(--muted)]">
                Count the drawer first, confirm the baseline amount, and start the next duty with a clean opening snapshot.
              </p>
            </div>
          </div>
          <button
            className="secondary-btn mini-btn modal-close-icon-btn"
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close modal"
            title="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6 18 18" />
              <path d="M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className={`${modalBodyClass} !gap-3`}>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <div className={infoMetricCardClass}>
              <span className={infoMetricLabelClass}>Entry Mode</span>
              <strong className={infoMetricValueClass}>
                {openingCashEntryMode === 'DENOMINATION' ? 'Denomination count' : 'Manual amount'}
              </strong>
            </div>
            <div className={infoMetricCardClass}>
              <span className={infoMetricLabelClass}>Current Total</span>
              <strong className={`${infoMetricValueClass} text-[var(--accent-strong)]`}>{fmtMoney(openingCashAmount)}</strong>
            </div>
            <div className={infoMetricCardClass}>
              <span className={infoMetricLabelClass}>Cashier</span>
              <strong className={infoMetricValueClass}>{cashierName}</strong>
            </div>
            <div className={infoMetricCardClass}>
              <span className={infoMetricLabelClass}>Branch / Location</span>
              <strong className={infoMetricValueClass}>{branchLabel}</strong>
              <span className="text-[0.76rem] text-[var(--muted)]">{locationLabel}</span>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className={`${shellCardClass} !gap-3 !p-3.5`}>
              <div className="panel-head compact !mb-0 flex flex-wrap items-start justify-between gap-2.5">
                <div>
                  <div className="eyebrow">Opening cash</div>
                  <h3 className="m-0 text-[0.98rem] font-extrabold text-[var(--text-strong)]">Count the opening drawer</h3>
                  <p className="m-0 text-[0.8rem] leading-5 text-[var(--muted)]">
                    Choose the counting method that matches how the cashier prepares the drawer.
                  </p>
                </div>
                <div className="filter-chip-row opening-cash-mode-row">
                  {([
                    { key: 'DENOMINATION', label: 'Denomination' },
                    { key: 'AMOUNT', label: 'Amount' }
                  ] as const).map((mode) => (
                    <button
                      key={mode.key}
                      type="button"
                      className={`filter-chip ${openingCashEntryMode === mode.key ? 'active' : ''}`}
                      onClick={() => onSelectMode(mode.key)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {openingCashEntryMode === 'AMOUNT' ? (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <label className="payment-field-stack">
                    <span>Amount</span>
                    <input value={openingCash} onChange={(event) => onOpeningCashChange(event.target.value)} placeholder="0.00" />
                  </label>
                  <div className="grid gap-2 rounded-[16px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-3.5 py-3.5 shadow-[0_8px_20px_rgba(17,40,58,0.04)]">
                    <span className={infoMetricLabelClass}>Quick Add</span>
                    <div className="filter-chip-row opening-cash-quick-row">
                      {quickCashOptions.map((quick) => (
                        <button key={quick} type="button" className="filter-chip" onClick={() => onQuickAmount(quick)}>
                          +{quick}
                        </button>
                      ))}
                    </div>
                    <p className="m-0 text-[0.74rem] leading-5 text-[var(--muted)]">Build the opening total faster, then review it before starting duty.</p>
                  </div>
                </div>
              ) : (
                <div className="opening-denomination-layout">
                  <div className="opening-denomination-table-wrap">
                    <table className="opening-denomination-table">
                      <thead>
                        <tr>
                          <th>Denomination</th>
                          <th>Qty</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openingDenominationRows.map((row) => (
                          <tr key={row.denomination} className={row.quantity > 0 ? 'is-active' : ''}>
                            <td className="opening-denomination-label">{formatDenominationLabel(row.denomination)}</td>
                            <td>
                              <div className="opening-denomination-qty">
                                <button
                                  type="button"
                                  className="opening-denomination-step"
                                  onClick={() => onStepDenomination(row.denomination, -1)}
                                  aria-label={`Decrease ${formatDenominationLabel(row.denomination)}`}
                                >
                                  -
                                </button>
                                <input
                                  value={openingDenominationCounts[String(row.denomination)] ?? ''}
                                  onChange={(event) => onUpdateDenomination(row.denomination, event.target.value)}
                                  inputMode="numeric"
                                  className="opening-denomination-input"
                                  placeholder="0"
                                />
                                <button
                                  type="button"
                                  className="opening-denomination-step"
                                  onClick={() => onStepDenomination(row.denomination, 1)}
                                  aria-label={`Increase ${formatDenominationLabel(row.denomination)}`}
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="opening-denomination-total">{fmtMoney(row.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="opening-denomination-summary">
                    <div className={`${contextChipClass} opening-denomination-summary-card`}>
                      <span className={contextLabelClass}>Active Lines</span>
                      <strong className={contextValueClass}>{openingDenominationActiveLines}</strong>
                    </div>
                    <div className={`${contextChipClass} opening-denomination-summary-card`}>
                      <span className={contextLabelClass}>Total Pieces</span>
                      <strong className={contextValueClass}>{openingDenominationPieces}</strong>
                    </div>
                    <div className={`${contextChipClass} opening-denomination-summary-card opening-denomination-summary-total`}>
                      <span className={contextLabelClass}>Calculated Total</span>
                      <strong className="text-[0.98rem] font-extrabold text-[var(--success)]">
                        {fmtMoney(openingDenominationTotal)}
                      </strong>
                    </div>
                  </div>

                  <div className="opening-denomination-tools">
                    <button className="secondary-btn mini-btn" type="button" onClick={onClearDenominations}>
                      Clear Counts
                    </button>
                  </div>
                </div>
              )}
            </section>

            <aside className="grid">
              <section className={`${shellCardClass} !gap-3 !p-3.5`}>
                <div className="panel-head compact !mb-0">
                  <div>
                    <div className="eyebrow">Start summary</div>
                    <h3 className="m-0 text-[0.98rem] font-extrabold text-[var(--text-strong)]">Shift opening snapshot</h3>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <ShiftSnapshotRow label="Current Total" value={fmtMoney(openingCashAmount)} />
                  <ShiftSnapshotRow label="Cashier" value={cashierName} />
                  <ShiftSnapshotRow label="Branch" value={branchLabel} />
                  <ShiftSnapshotRow label="Location" value={locationLabel} />
                </div>
                <div className="border-t border-[rgba(220,230,239,0.72)] pt-3">
                  <div className="eyebrow">Start checklist</div>
                  <div className="mt-2 grid gap-2">
                    {[
                      'Review the cashier, branch, and location shown above.',
                      'Confirm the opening total matches the counted drawer.',
                      'Start duty only when the drawer is ready for the first receipt.'
                    ].map((item) => (
                      <div key={item} className="rounded-[14px] border border-[rgba(188,210,234,0.46)] bg-[rgba(248,251,255,0.9)] px-3 py-2 text-[0.76rem] leading-5 text-[var(--text-strong)]">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>

        <div className={`${modalFooterClass} !justify-end`}>
          <button className="primary-btn checkout-btn" type="button" onClick={onStart} disabled={saving || openingCashAmount < 0}>
            {saving ? 'Starting...' : 'Start Duty'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShiftCloseModal({
  appState,
  activeShift,
  expectedCash,
  requiresInventoryCount = false,
  closingCashEntryMode,
  closingCashAmount,
  closingCash,
  closingDenominationRows,
  closingDenominationCounts,
  closingDenominationActiveLines,
  closingDenominationPieces,
  closingDenominationTotal,
  variancePreview,
  saving,
  onClose,
  onSelectMode,
  onClosingCashChange,
  onQuickAmount,
  onStepDenomination,
  onUpdateDenomination,
  onClearDenominations,
  onEndShift
}: ShiftCloseModalProps): JSX.Element {
  const varianceTone: ShiftVisualTone =
    variancePreview > 0 ? 'good' : variancePreview < 0 ? 'danger' : 'accent';
  const shiftStatusLabel = activeShift.status === 'OPEN' ? 'Open duty' : formatShiftStatusLabel(activeShift.status);
  const locationLabel = activeShift.locationLabel || appState.setup.locationLabel || 'Not set';
  const branchLabel = activeShift.branchLabel || appState.setup.branchLabel || 'Not set';
  const subtitle = requiresInventoryCount
    ? 'Count the closing drawer, then review the item inventory snapshot before ending the duty.'
    : 'Count the closing drawer, confirm the final total, and end the duty with the same compact denomination workflow used during shift start.';

  return (
    <div className={modalBackdropClass} role="presentation" onClick={() => !saving && onClose()}>
      <div
        className={`${modalCardClass} shift-close-modal-shell !max-w-[920px] !rounded-[28px]`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={modalToolbarClass}>
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-[56px] w-[56px] shrink-0 place-items-center rounded-[18px] border border-[rgba(245,219,173,0.74)] bg-[rgba(255,244,225,0.98)] text-[#b56a00] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
              <ShiftIcon kind="close" className="h-[24px] w-[24px]" />
            </div>
            <div className="min-w-0">
              <div className="eyebrow">Closeout</div>
              <h3 className="m-0 text-[1.08rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)]">Close shift</h3>
              <p className="mt-1.5 max-w-[38rem] text-[0.84rem] leading-5 text-[var(--muted)]">{subtitle}</p>
            </div>
          </div>
          <button
            className="secondary-btn mini-btn modal-close-icon-btn"
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close modal"
            title="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6 18 18" />
              <path d="M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className={`${modalBodyClass} !gap-3`}>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <div className={infoMetricCardClass}>
              <span className={infoMetricLabelClass}>Entry Mode</span>
              <strong className={infoMetricValueClass}>
                {closingCashEntryMode === 'DENOMINATION' ? 'Denomination count' : 'Manual amount'}
              </strong>
            </div>
            <div className={infoMetricCardClass}>
              <span className={infoMetricLabelClass}>Current Total</span>
              <strong className={`${infoMetricValueClass} text-[var(--accent-strong)]`}>{fmtMoney(closingCashAmount)}</strong>
            </div>
            <div className={infoMetricCardClass}>
              <span className={infoMetricLabelClass}>Expected Cash</span>
              <strong className={infoMetricValueClass}>{fmtMoney(expectedCash)}</strong>
            </div>
            <div className={`${infoMetricCardClass} ${shiftToneClasses(varianceTone).shell}`}>
              <span className={infoMetricLabelClass}>Variance</span>
              <strong className={`${infoMetricValueClass} ${shiftToneClasses(varianceTone).value}`}>{fmtMoney(variancePreview)}</strong>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className={`${shellCardClass} !gap-3 !p-3.5`}>
              <div className="panel-head compact !mb-0 flex flex-wrap items-start justify-between gap-2.5">
                <div>
                  <div className="eyebrow">Counted cash</div>
                  <h3 className="m-0 text-[0.98rem] font-extrabold text-[var(--text-strong)]">Count the closing drawer</h3>
                  <p className="m-0 text-[0.8rem] leading-5 text-[var(--muted)]">
                    Choose the same counting method the cashier uses before ending this duty.
                  </p>
                </div>
                <div className="filter-chip-row opening-cash-mode-row">
                  {([
                    { key: 'DENOMINATION', label: 'Denomination' },
                    { key: 'AMOUNT', label: 'Amount' }
                  ] as const).map((mode) => (
                    <button
                      key={mode.key}
                      type="button"
                      className={`filter-chip ${closingCashEntryMode === mode.key ? 'active' : ''}`}
                      onClick={() => onSelectMode(mode.key)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {closingCashEntryMode === 'AMOUNT' ? (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <label className="payment-field-stack">
                    <span>Counted Cash</span>
                    <input value={closingCash} onChange={(event) => onClosingCashChange(event.target.value)} placeholder="0.00" />
                  </label>
                  <div className="grid gap-2 rounded-[16px] border border-[var(--border-soft)] bg-[rgba(248,251,255,0.96)] px-3.5 py-3.5 shadow-[0_8px_20px_rgba(17,40,58,0.04)]">
                    <span className={infoMetricLabelClass}>Quick Add</span>
                    <div className="filter-chip-row opening-cash-quick-row">
                      {quickCashOptions.map((quick) => (
                        <button key={quick} type="button" className="filter-chip" onClick={() => onQuickAmount(quick)}>
                          +{quick}
                        </button>
                      ))}
                    </div>
                    <p className="m-0 text-[0.74rem] leading-5 text-[var(--muted)]">
                      Build the closing total faster, then review the variance before ending duty.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="opening-denomination-layout">
                  <div className="opening-denomination-table-wrap">
                    <table className="opening-denomination-table">
                      <thead>
                        <tr>
                          <th>Denomination</th>
                          <th>Qty</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {closingDenominationRows.map((row) => (
                          <tr key={row.denomination} className={row.quantity > 0 ? 'is-active' : ''}>
                            <td className="opening-denomination-label">{formatDenominationLabel(row.denomination)}</td>
                            <td>
                              <div className="opening-denomination-qty">
                                <button
                                  type="button"
                                  className="opening-denomination-step"
                                  onClick={() => onStepDenomination(row.denomination, -1)}
                                  aria-label={`Decrease ${formatDenominationLabel(row.denomination)}`}
                                >
                                  -
                                </button>
                                <input
                                  value={closingDenominationCounts[String(row.denomination)] ?? ''}
                                  onChange={(event) => onUpdateDenomination(row.denomination, event.target.value)}
                                  inputMode="numeric"
                                  className="opening-denomination-input"
                                  placeholder="0"
                                />
                                <button
                                  type="button"
                                  className="opening-denomination-step"
                                  onClick={() => onStepDenomination(row.denomination, 1)}
                                  aria-label={`Increase ${formatDenominationLabel(row.denomination)}`}
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="opening-denomination-total">{fmtMoney(row.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="opening-denomination-summary">
                    <div className={`${contextChipClass} opening-denomination-summary-card`}>
                      <span className={contextLabelClass}>Active Lines</span>
                      <strong className={contextValueClass}>{closingDenominationActiveLines}</strong>
                    </div>
                    <div className={`${contextChipClass} opening-denomination-summary-card`}>
                      <span className={contextLabelClass}>Total Pieces</span>
                      <strong className={contextValueClass}>{closingDenominationPieces}</strong>
                    </div>
                    <div className={`${contextChipClass} opening-denomination-summary-card opening-denomination-summary-total`}>
                      <span className={contextLabelClass}>Calculated Total</span>
                      <strong className="text-[0.98rem] font-extrabold text-[var(--success)]">
                        {fmtMoney(closingDenominationTotal)}
                      </strong>
                    </div>
                  </div>

                  <div className="opening-denomination-tools">
                    <button className="secondary-btn mini-btn" type="button" onClick={onClearDenominations}>
                      Clear Counts
                    </button>
                  </div>
                </div>
              )}
            </section>

            <aside className="grid">
              <section className={`${shellCardClass} !gap-3 !p-3.5`}>
                <div className="panel-head compact !mb-0">
                  <div>
                    <div className="eyebrow">Close summary</div>
                    <h3 className="m-0 text-[0.98rem] font-extrabold text-[var(--text-strong)]">Shift closeout snapshot</h3>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <ShiftSnapshotRow label="Current Total" value={fmtMoney(closingCashAmount)} />
                  <ShiftSnapshotRow label="Expected Cash" value={fmtMoney(expectedCash)} />
                  <ShiftSnapshotRow label="Variance" value={fmtMoney(variancePreview)} />
                  <ShiftSnapshotRow label="Duty" value={shiftStatusLabel} />
                  <ShiftSnapshotRow label="Cashier" value={activeShift.cashierName} />
                </div>
                <div className="border-t border-[rgba(220,230,239,0.72)] pt-3">
                  <div className="eyebrow">Close checklist</div>
                  <div className="mt-2 grid gap-2">
                    {[
                      `Confirm ${branchLabel} / ${locationLabel} matches the drawer being closed.`,
                      'Review the counted total and variance before ending duty.',
                      `Close this duty only after all receipts for ${activeShift.cashierName} are complete.`
                    ].map((item) => (
                      <div key={item} className="rounded-[14px] border border-[rgba(188,210,234,0.46)] bg-[rgba(248,251,255,0.9)] px-3 py-2 text-[0.76rem] leading-5 text-[var(--text-strong)]">
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>

        <div className={modalFooterClass}>
          <button className="secondary-btn checkout-btn checkout-btn-support" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary-btn checkout-btn" type="button" onClick={onEndShift} disabled={saving}>
            {saving ? 'Saving...' : requiresInventoryCount ? 'Review Inventory' : 'End Duty'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShiftInventoryCountModal({
  appState,
  activeShift,
  expectedCash,
  countedCash,
  cashVariance,
  inventorySnapshot,
  inventoryCounts,
  saving,
  onClose,
  onBackToCloseout,
  onUpdateCount,
  onFinalize
}: ShiftInventoryCountModalProps): JSX.Element {
  const [currentPage, setCurrentPage] = useState(1);
  const inventoryTotals = useMemo(
    () => summarizeInventoryCount(inventorySnapshot, inventoryCounts),
    [inventoryCounts, inventorySnapshot]
  );
  const countComplete = useMemo(
    () => isInventoryCountComplete(inventorySnapshot, inventoryCounts),
    [inventoryCounts, inventorySnapshot]
  );
  const remainingLineCount = Math.max(0, inventoryTotals.requiredLineCount - inventoryTotals.enteredLineCount);
  const locationLabel = inventorySnapshot.locationLabel || appState.setup.locationLabel || 'Not set';
  const branchLabel = activeShift.branchLabel || appState.setup.branchLabel || 'Not set';
  const totalItems = inventorySnapshot.lines.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / inventoryCountPageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pageRows = inventorySnapshot.lines.slice(
    (safePage - 1) * inventoryCountPageSize,
    safePage * inventoryCountPageSize
  );
  const startItem = totalItems === 0 ? 0 : (safePage - 1) * inventoryCountPageSize + 1;
  const endItem = totalItems === 0 ? 0 : Math.min(safePage * inventoryCountPageSize, totalItems);
  const varianceTone: ShiftVisualTone =
    cashVariance > 0 ? 'good' : cashVariance < 0 ? 'danger' : 'accent';
  const varianceNote =
    cashVariance > 0 ? 'Cash drawer is over expected.' : cashVariance < 0 ? 'Cash drawer is below expected.' : 'Cash drawer is balanced.';

  return (
    <div className={modalBackdropClass} role="presentation" onClick={() => !saving && onClose()}>
      <div
        className={`${modalCardClass} shift-inventory-count-modal-shell !max-w-[1120px] !rounded-[28px]`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={modalToolbarClass}>
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-[56px] w-[56px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.74)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
              <ShiftIcon kind="timeline" className="h-[24px] w-[24px]" />
            </div>
            <div className="min-w-0">
              <div className="eyebrow">End of day</div>
              <h3 className="m-0 text-[1.08rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)]">
                Inventory count
              </h3>
              <p className="mt-1.5 max-w-[42rem] text-[0.84rem] leading-5 text-[var(--muted)]">
                Enter the physical item counts for each line before the shift is finalized.
              </p>
            </div>
          </div>
          <button
            className="secondary-btn mini-btn modal-close-icon-btn"
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close modal"
            title="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6 18 18" />
              <path d="M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className={`${modalBodyClass} !gap-3`}>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <div className={infoMetricCardClass}>
              <span className={infoMetricLabelClass}>Shift</span>
              <strong className={infoMetricValueClass}>{activeShift.cashierName}</strong>
              <span className="text-[0.76rem] text-[var(--muted)]">{branchLabel} / {locationLabel}</span>
            </div>
            <div className={infoMetricCardClass}>
              <span className={infoMetricLabelClass}>Counted Cash</span>
              <strong className={`${infoMetricValueClass} text-[var(--accent-strong)]`}>{fmtMoney(countedCash)}</strong>
              <span className="text-[0.76rem] text-[var(--muted)]">Expected {fmtMoney(expectedCash)}</span>
            </div>
            <div className={`${infoMetricCardClass} ${shiftToneClasses(varianceTone).shell}`}>
              <span className={infoMetricLabelClass}>Cash Variance</span>
              <strong className={`${infoMetricValueClass} ${shiftToneClasses(varianceTone).value}`}>{fmtMoney(cashVariance)}</strong>
              <span className="text-[0.76rem] text-[var(--muted)]">{varianceNote}</span>
            </div>
            <div className={infoMetricCardClass}>
              <span className={infoMetricLabelClass}>Inventory Lines</span>
              <strong className={infoMetricValueClass}>{totalItems.toLocaleString()}</strong>
              <span className="text-[0.76rem] text-[var(--muted)]">
                Showing {startItem} to {endItem} of {totalItems}
              </span>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
            <section className={`${shellCardClass} !gap-3 !p-3.5`}>
              <div className="panel-head compact !mb-0 flex flex-wrap items-start justify-between gap-2.5">
                <div className="min-w-0">
                  <div className="eyebrow">Snapshot table</div>
                  <h3 className="m-0 text-[0.98rem] font-extrabold text-[var(--text-strong)]">Count items per snapshot line</h3>
                  <p className="m-0 text-[0.8rem] leading-5 text-[var(--muted)]">
                    Work through each inventory line and record the counted quantity on hand.
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-[20px] border border-[var(--border-soft)] bg-white">
                <table className="inventory-count-table w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-[var(--border-soft)] text-[0.72rem] uppercase tracking-[0.08em] text-[var(--muted)]">
                      <th className="px-3 py-2 font-semibold">Item</th>
                      <th className="px-3 py-2 font-semibold">Counted</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((line) => {
                      const entry = inventoryCounts[line.productId];
                      const lineComplete = isInventoryCountLineComplete(line, entry);
                      const hasLpgCount = hasInventoryCountValue(entry?.qtyFull) || hasInventoryCountValue(entry?.qtyEmpty);
                      const countedQtyOnHand = line.isLpg
                        ? Number((parseEnteredInventoryCount(entry?.qtyFull) + parseEnteredInventoryCount(entry?.qtyEmpty)).toFixed(2))
                        : parseEnteredInventoryCount(entry?.qtyOnHand);

                      return (
                        <tr key={line.productId} className="border-b border-[rgba(220,230,239,0.72)] align-top last:border-b-0">
                          <td className="px-3 py-3">
                            <div className="grid gap-0.5">
                              <strong className="text-[0.88rem] text-[var(--text-strong)]">{line.productName}</strong>
                              <span className="text-[0.78rem] text-[var(--muted)]">{line.sku}</span>
                              <span className="text-[0.74rem] text-[var(--muted)]">{line.category}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            {line.isLpg ? (
                              <div className="grid gap-2 sm:grid-cols-2">
                                <label className="grid gap-1">
                                  <span className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Full</span>
                                  <div className={`${cashMovementInputShellClass} !min-h-[42px] !rounded-[12px] !px-3`}>
                                    <input
                                      className={`${cashMovementInputClass} !text-[0.9rem]`}
                                      value={entry?.qtyFull ?? ''}
                                      onChange={(event) => onUpdateCount(line.productId, 'qtyFull', event.target.value)}
                                      inputMode="decimal"
                                      placeholder="0"
                                    />
                                  </div>
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Empty</span>
                                  <div className={`${cashMovementInputShellClass} !min-h-[42px] !rounded-[12px] !px-3`}>
                                    <input
                                      className={`${cashMovementInputClass} !text-[0.9rem]`}
                                      value={entry?.qtyEmpty ?? ''}
                                      onChange={(event) => onUpdateCount(line.productId, 'qtyEmpty', event.target.value)}
                                      inputMode="decimal"
                                      placeholder="0"
                                    />
                                  </div>
                                </label>
                                <div className="sm:col-span-2 text-[0.74rem] text-[var(--muted)]">
                                  On hand {hasLpgCount ? formatInventoryInput(countedQtyOnHand) : '-'}
                                </div>
                              </div>
                            ) : (
                              <div className="grid gap-1">
                                <label className="grid gap-1">
                                  <span className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">On hand</span>
                                  <div className={`${cashMovementInputShellClass} !min-h-[42px] !rounded-[12px] !px-3`}>
                                    <input
                                      className={`${cashMovementInputClass} !text-[0.9rem]`}
                                      value={entry?.qtyOnHand ?? ''}
                                      onChange={(event) => onUpdateCount(line.productId, 'qtyOnHand', event.target.value)}
                                      inputMode="decimal"
                                      placeholder="0"
                                    />
                                  </div>
                                </label>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <div className="grid gap-0.5">
                              <strong
                                className={`text-[0.84rem] font-extrabold ${
                                  lineComplete ? shiftToneClasses('good').value : shiftToneClasses('warn').value
                                }`}
                              >
                                {lineComplete ? 'Count entered' : 'Needs count'}
                              </strong>
                              <span className="text-[0.76rem] text-[var(--muted)]">
                                {line.isLpg ? 'Full and empty required' : 'On hand required'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-2.5 border-t border-[rgba(220,230,239,0.72)] pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[0.78rem] text-[var(--muted)]">
                  Showing {startItem} to {endItem} of {totalItems} item{totalItems === 1 ? '' : 's'}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    className="lending-records-page-btn"
                    type="button"
                    onClick={() => setCurrentPage(1)}
                    disabled={safePage === 1}
                    aria-label="First page"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M11 17l-5-5 5-5" />
                      <path d="M18 17l-5-5 5-5" />
                    </svg>
                  </button>
                  <button
                    className="lending-records-page-btn"
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={safePage === 1}
                    aria-label="Previous page"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                  <span className="inline-flex min-h-[34px] items-center rounded-full border border-[var(--border-soft)] bg-white px-3 text-[0.78rem] font-semibold text-[var(--text-strong)]">
                    {safePage}
                  </span>
                  <button
                    className="lending-records-page-btn"
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={safePage === totalPages}
                    aria-label="Next page"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                  <button
                    className="lending-records-page-btn"
                    type="button"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={safePage === totalPages}
                    aria-label="Last page"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M13 17l5-5-5-5" />
                      <path d="M6 17l5-5-5-5" />
                    </svg>
                  </button>
                </div>
              </div>
            </section>

            <aside className="grid gap-3">
              <section className={`${shellCardClass} !gap-3 !p-3.5`}>
                <div className="panel-head compact !mb-0">
                  <div>
                    <div className="eyebrow">Count summary</div>
                    <h3 className="m-0 text-[0.98rem] font-extrabold text-[var(--text-strong)]">Inventory totals</h3>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <ShiftSnapshotRow label="Counted on hand" value={formatInventoryInput(inventoryTotals.countedQtyOnHand)} />
                  <ShiftSnapshotRow label="Entered lines" value={`${inventoryTotals.enteredLineCount} / ${inventoryTotals.requiredLineCount}`} />
                  <ShiftSnapshotRow label="Remaining lines" value={String(remainingLineCount)} />
                </div>
              </section>

              <section className={`${shellCardClass} !gap-3 !p-3.5`}>
                <div className="panel-head compact !mb-0">
                  <div>
                    <div className="eyebrow">Count review</div>
                    <h3 className="m-0 text-[0.98rem] font-extrabold text-[var(--text-strong)]">Before you finalize</h3>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <ShiftSnapshotRow label="Branch" value={branchLabel} />
                  <ShiftSnapshotRow label="Location" value={locationLabel} />
                  <ShiftSnapshotRow label="Captured" value={fmtDate(inventorySnapshot.capturedAt)} />
                  <ShiftSnapshotRow label="Cash Variance" value={fmtMoney(cashVariance)} />
                </div>
              </section>
            </aside>
          </div>
        </div>

        <div className={modalFooterClass}>
          <span className="text-[0.78rem] font-semibold text-[var(--muted)] sm:mr-auto">
            {countComplete ? 'All item counts entered.' : `${remainingLineCount} inventory line${remainingLineCount === 1 ? '' : 's'} remaining.`}
          </span>
          <button className="secondary-btn mini-btn" type="button" onClick={onBackToCloseout} disabled={saving}>
            Back to Closeout
          </button>
          <button className="primary-btn checkout-btn" type="button" onClick={onFinalize} disabled={saving || totalItems === 0 || !countComplete}>
            {saving ? 'Saving...' : 'Finalize Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShiftScreen({ appState, tenantAddons, onOutboxChanged, onAfterInventoryCountClose }: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const endOfDayInventoryCountEnabled = tenantAddons?.cashier_end_of_day_inventory_count === true;
  const [shifts, setShifts] = useState<DesktopShiftRecord[]>([]);
  const [cashEntries, setCashEntries] = useState<DesktopShiftCashEntry[]>([]);
  const [expenseRows, setExpenseRows] = useState<DesktopExpenseRecord[]>([]);
  const [outboxRows, setOutboxRows] = useState<OutboxItem[]>([]);
  const [sales, setSales] = useState<DesktopSaleRecord[]>([]);
  const [openingCashEntryMode, setOpeningCashEntryMode] = useState<CashEntryMode>('DENOMINATION');
  const [openingCash, setOpeningCash] = useState('0');
  const [openingDenominationCounts, setOpeningDenominationCounts] = useState<Record<string, string>>(
    () => emptyOpeningDenominationState()
  );
  const [closingCashEntryMode, setClosingCashEntryMode] = useState<CashEntryMode>('DENOMINATION');
  const [closingCash, setClosingCash] = useState('0');
  const [closingDenominationCounts, setClosingDenominationCounts] = useState<Record<string, string>>(
    () => emptyOpeningDenominationState()
  );
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [inventoryCountModalOpen, setInventoryCountModalOpen] = useState(false);
  const [inventoryCountSnapshot, setInventoryCountSnapshot] = useState<DesktopShiftInventorySnapshot | null>(null);
  const [inventoryCountInputs, setInventoryCountInputs] = useState<InventoryCountInputMap>({});
  const [cashAmount, setCashAmount] = useState('0');
  const [cashDirection, setCashDirection] = useState<'IN' | 'OUT'>('OUT');
  const [cashNotes, setCashNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const announce = (message: string, tone: 'info' | 'success' | 'warning' | 'error' = 'info'): void => {
    desktopUi.showToast({ message, tone });
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [shiftRows, cashRows, saleRows, pettyCashRows, nextOutboxRows] = await Promise.all([
        desktopShiftService.listShifts(),
        desktopShiftService.listShiftCashEntries(),
        desktopDb.listSales(),
        desktopExpenseService.listExpenses(),
        desktopDb.listOutboxItems()
      ]);
      setShifts(shiftRows);
      setCashEntries(cashRows);
      setSales(saleRows);
      setExpenseRows(pettyCashRows);
      setOutboxRows(nextOutboxRows);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (saving) {
      desktopUi.setLoading({ visible: true, label: 'Saving shift update...' });
      return;
    }
    if (loading) {
      desktopUi.setLoading({ visible: true, label: 'Loading shift records...' });
      return;
    }
    desktopUi.clearLoading();
  }, [desktopUi, loading, saving]);

  const activeShift = useMemo(() => shifts.find((row) => row.status === 'OPEN') ?? null, [shifts]);
  const activeCashEntries = useMemo(() => cashEntries.filter((entry) => entry.shiftId === activeShift?.id), [cashEntries, activeShift?.id]);
  const cashIn = useMemo(() => activeCashEntries.filter((row) => row.direction === 'IN').reduce((sum, row) => sum + row.amount, 0), [activeCashEntries]);
  const cashOut = useMemo(() => activeCashEntries.filter((row) => row.direction === 'OUT').reduce((sum, row) => sum + row.amount, 0), [activeCashEntries]);
  const pettyCash = useMemo(
    () => summarizeDesktopPettyCash(expenseRows, { shiftId: activeShift?.id }),
    [activeShift?.id, expenseRows]
  );
  const lendingDepositCash = useMemo(() => {
    if (!activeShift) return 0;
    const openedAt = new Date(activeShift.openedAt).getTime();
    const closedAt = activeShift.closedAt ? new Date(activeShift.closedAt).getTime() : Number.POSITIVE_INFINITY;
    return Number(outboxRows
      .filter((row) => row.entity === 'customer_payment')
      .filter((row) => String(row.payload.purpose ?? '').toUpperCase() === 'LENDING_DEPOSIT')
      .filter((row) => String(row.payload.method ?? '').toUpperCase() === 'CASH')
      .filter((row) => {
        const postedAt = new Date(String(row.payload.posted_at ?? row.payload.created_at ?? row.created_at)).getTime();
        return Number.isFinite(postedAt) && postedAt >= openedAt && postedAt <= closedAt;
      })
      .reduce((sum, row) => sum + Number(row.payload.amount ?? 0), 0)
      .toFixed(2));
  }, [activeShift, outboxRows]);
  const drawerCashIn = Number((cashIn + pettyCash.totalIn + lendingDepositCash).toFixed(2));
  const drawerCashOut = Number((cashOut + pettyCash.totalOut).toFixed(2));
  const shiftSales = useMemo(() => {
    if (!activeShift) {
      return [];
    }
    const openedAt = new Date(activeShift.openedAt).getTime();
    const closedAt = activeShift.closedAt ? new Date(activeShift.closedAt).getTime() : Number.POSITIVE_INFINITY;
    return sales.filter((sale) => {
      const createdAt = new Date(sale.createdAt).getTime();
      return createdAt >= openedAt && createdAt <= closedAt;
    });
  }, [activeShift, sales]);

  const cashSales = useMemo(
    () =>
      shiftSales
        .filter((sale) => sale.saleStatus !== 'CANCELLED' && sale.payload.paymentMethod === 'CASH')
        .reduce((sum, sale) => sum + resolveCashCollected(sale), 0),
    [shiftSales]
  );

  const cashReturns = useMemo(
    () =>
      shiftSales
        .filter((sale) => sale.payload.paymentMethod === 'CASH')
        .reduce(
          (sum, sale) =>
            sum +
            (sale.returns ?? []).reduce(
              (entrySum, entry) => entrySum + entry.lines.reduce((lineSum, line) => lineSum + line.lineTotal, 0),
              0
            ),
          0
        ),
    [shiftSales]
  );

  const expectedCash = useMemo(
    () => (!activeShift ? 0 : Number((activeShift.openingCash + cashSales - cashReturns + drawerCashIn - drawerCashOut).toFixed(2))),
    [activeShift, cashReturns, cashSales, drawerCashIn, drawerCashOut]
  );
  const openingDenominationRows = useMemo(
    () =>
      openingCashDenominationOptions.map((denomination) => {
        const raw = openingDenominationCounts[String(denomination)] ?? '';
        const parsed = Number.parseInt(raw, 10);
        const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        return {
          denomination,
          quantity,
          total: Number((quantity * denomination).toFixed(2))
        };
      }),
    [openingDenominationCounts]
  );
  const openingDenominationTotal = useMemo(
    () => Number(openingDenominationRows.reduce((sum, row) => sum + row.total, 0).toFixed(2)),
    [openingDenominationRows]
  );
  const openingCashAmount = openingCashEntryMode === 'DENOMINATION' ? openingDenominationTotal : parseCashInput(openingCash);
  const closingDenominationRows = useMemo(
    () =>
      openingCashDenominationOptions.map((denomination) => {
        const raw = closingDenominationCounts[String(denomination)] ?? '';
        const parsed = Number.parseInt(raw, 10);
        const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        return {
          denomination,
          quantity,
          total: Number((quantity * denomination).toFixed(2))
        };
      }),
    [closingDenominationCounts]
  );
  const closingDenominationTotal = useMemo(
    () => Number(closingDenominationRows.reduce((sum, row) => sum + row.total, 0).toFixed(2)),
    [closingDenominationRows]
  );
  const closingCashAmount = closingCashEntryMode === 'DENOMINATION' ? closingDenominationTotal : parseCashInput(closingCash);

  const openingCashDenominationEntries = useMemo(
    () =>
      openingDenominationRows
        .filter((row) => row.quantity > 0)
        .map((row) => ({
          denomination: row.denomination,
          quantity: row.quantity
        })),
    [openingDenominationRows]
  );
  const openingDenominationActiveLines = useMemo(
    () => openingDenominationRows.filter((row) => row.quantity > 0).length,
    [openingDenominationRows]
  );
  const openingDenominationPieces = useMemo(
    () => openingDenominationRows.reduce((sum, row) => sum + row.quantity, 0),
    [openingDenominationRows]
  );
  const closingDenominationActiveLines = useMemo(
    () => closingDenominationRows.filter((row) => row.quantity > 0).length,
    [closingDenominationRows]
  );
  const closingDenominationPieces = useMemo(
    () => closingDenominationRows.reduce((sum, row) => sum + row.quantity, 0),
    [closingDenominationRows]
  );

  const addOpeningCashAmount = (value: string): void => {
    const next = Number((parseCashInput(openingCash) + parseCashInput(value)).toFixed(2));
    setOpeningCash(String(next));
  };

  const selectOpeningCashMode = (mode: CashEntryMode): void => {
    if (mode === openingCashEntryMode) {
      return;
    }
    if (mode === 'AMOUNT') {
      setOpeningCash(openingDenominationTotal.toFixed(2));
    }
    setOpeningCashEntryMode(mode);
  };

  const updateOpeningDenominationCount = (denomination: number, value: string): void => {
    const sanitized = value.replace(/[^\d]/g, '');
    setOpeningDenominationCounts((prev) => ({
      ...prev,
      [String(denomination)]: sanitized
    }));
  };

  const stepOpeningDenominationCount = (denomination: number, delta: number): void => {
    const key = String(denomination);
    const currentValue = openingDenominationCounts[key] ?? '';
    const currentQty = Number.parseInt(currentValue, 10);
    const nextQty = Math.max(0, (Number.isFinite(currentQty) ? currentQty : 0) + delta);
    setOpeningDenominationCounts((prev) => ({
      ...prev,
      [key]: nextQty > 0 ? String(nextQty) : ''
    }));
  };

  const clearOpeningDenominations = (): void => {
    setOpeningDenominationCounts(emptyOpeningDenominationState());
  };

  const addClosingCashAmount = (value: string): void => {
    const next = Number((parseCashInput(closingCash) + parseCashInput(value)).toFixed(2));
    setClosingCash(String(next));
  };

  const selectClosingCashMode = (mode: CashEntryMode): void => {
    if (mode === closingCashEntryMode) {
      return;
    }
    if (mode === 'AMOUNT') {
      setClosingCash(closingDenominationTotal.toFixed(2));
    }
    setClosingCashEntryMode(mode);
  };

  const updateClosingDenominationCount = (denomination: number, value: string): void => {
    const sanitized = value.replace(/[^\d]/g, '');
    setClosingDenominationCounts((prev) => ({
      ...prev,
      [String(denomination)]: sanitized
    }));
  };

  const stepClosingDenominationCount = (denomination: number, delta: 1 | -1): void => {
    const key = String(denomination);
    const currentValue = closingDenominationCounts[key] ?? '';
    const currentQty = Number.parseInt(currentValue, 10);
    const nextQty = Math.max(0, (Number.isFinite(currentQty) ? currentQty : 0) + delta);
    setClosingDenominationCounts((prev) => ({
      ...prev,
      [key]: nextQty > 0 ? String(nextQty) : ''
    }));
  };

  const clearClosingDenominations = (): void => {
    setClosingDenominationCounts(emptyOpeningDenominationState());
  };

  const resetClosingFlowState = (): void => {
    setCloseModalOpen(false);
    setInventoryCountModalOpen(false);
    setInventoryCountSnapshot(null);
    setInventoryCountInputs({});
    setClosingCashEntryMode('DENOMINATION');
    setClosingCash('0');
    clearClosingDenominations();
  };

  const openStartShiftModal = (): void => {
    setOpeningCashEntryMode('DENOMINATION');
    setOpeningCash('0');
    clearOpeningDenominations();
    setStartModalOpen(true);
  };

  const openCloseShiftModal = (): void => {
    if (!activeShift) {
      return;
    }
    setClosingCashEntryMode('DENOMINATION');
    setClosingCash('0');
    clearClosingDenominations();
    setInventoryCountModalOpen(false);
    setInventoryCountSnapshot(null);
    setInventoryCountInputs({});
    setCloseModalOpen(true);
  };

  const startShift = async (): Promise<void> => {
    setSaving(true);
    try {
      const record = await desktopShiftService.openShift(appState, {
        openingCash: openingCashAmount,
        openingCashDenominations:
          openingCashEntryMode === 'DENOMINATION' ? openingCashDenominationEntries : []
      });
      announce(`Shift ${record.id} is now open and waiting to sync.`, 'success');
      setStartModalOpen(false);
      resetClosingFlowState();
      await refresh();
      if (onOutboxChanged) {
        await onOutboxChanged();
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to start this shift right now.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const submitShiftClose = async (closingInventorySnapshot?: DesktopShiftInventorySnapshot | null): Promise<void> => {
    if (!activeShift) {
      return;
    }
    const counted = closingCashAmount;
    const variance = Number((counted - expectedCash).toFixed(2));
    const record = await desktopShiftService.closeShift(appState, {
      shiftId: activeShift.id,
      closingCash: counted,
      cashVariance: variance,
      closingInventorySnapshot
    });
    announce(`Shift ${record.id} was closed locally and is waiting to sync.`, 'success');
    resetClosingFlowState();
    await refresh();
    if (onOutboxChanged) {
      await onOutboxChanged();
    }
  };

  const continueToInventoryCount = async (): Promise<void> => {
    if (!activeShift) {
      return;
    }
    setSaving(true);
    try {
      const snapshot = await desktopShiftInventoryReportService.captureSnapshot({
        locationId: activeShift.locationId,
        locationLabel: activeShift.locationLabel
      });
      setInventoryCountSnapshot(snapshot);
      setInventoryCountInputs(createInventoryCountInputs(snapshot));
      setCloseModalOpen(false);
      setInventoryCountModalOpen(true);
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to prepare the inventory count now.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const finalizeShiftClose = async (): Promise<void> => {
    if (!inventoryCountSnapshot) {
      return;
    }
    setSaving(true);
    try {
      const closingInventorySnapshot = buildInventoryCountSnapshot(inventoryCountSnapshot, inventoryCountInputs);
      await submitShiftClose(closingInventorySnapshot);
      setInventoryCountModalOpen(false);
      if (onAfterInventoryCountClose) {
        await onAfterInventoryCountClose();
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to close this shift right now.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const endShift = async (): Promise<void> => {
    if (!activeShift) {
      return;
    }
    if (endOfDayInventoryCountEnabled) {
      await continueToInventoryCount();
      return;
    }
    setSaving(true);
    try {
      await submitShiftClose(null);
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to close this shift right now.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addCashAdjustment = async (): Promise<void> => {
    if (!activeShift) {
      announce('Open a shift first before adding cash adjustments.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await desktopShiftService.createShiftCashEntry({
        shiftId: activeShift.id,
        direction: cashDirection,
        amount: Number(cashAmount) || 0,
        notes: cashNotes
      });
      setCashAmount('0');
      setCashNotes('');
      announce(`Cash ${cashDirection} was added locally and is waiting to sync.`, 'success');
      await refresh();
      if (onOutboxChanged) {
        await onOutboxChanged();
      }
    } catch (error) {
      announce(error instanceof Error ? error.message : 'Unable to add this cash adjustment right now.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <ShiftWorkspaceShell
        appState={appState}
        activeShift={activeShift}
        shifts={shifts}
        cashEntries={cashEntries}
        shiftSales={shiftSales}
        cashDirection={cashDirection}
        cashAmount={cashAmount}
        cashNotes={cashNotes}
        closingCash={closingCashAmount.toFixed(2)}
        cashIn={drawerCashIn}
        cashOut={drawerCashOut}
        cashSales={cashSales}
        cashReturns={cashReturns}
        expectedCash={expectedCash}
        saving={saving}
        loading={loading}
        onOpenStartShift={openStartShiftModal}
        onCashDirectionChange={setCashDirection}
        onCashAmountChange={setCashAmount}
        onCashNotesChange={setCashNotes}
        onAddCashAdjustment={() => void addCashAdjustment()}
        onOpenCloseShift={openCloseShiftModal}
      />

      {startModalOpen ? (
        <ShiftStartModal
          appState={appState}
          openingCashEntryMode={openingCashEntryMode}
          openingCashAmount={openingCashAmount}
          openingCash={openingCash}
          openingDenominationRows={openingDenominationRows}
          openingDenominationCounts={openingDenominationCounts}
          openingDenominationActiveLines={openingDenominationActiveLines}
          openingDenominationPieces={openingDenominationPieces}
          openingDenominationTotal={openingDenominationTotal}
          saving={saving}
          onClose={() => setStartModalOpen(false)}
          onSelectMode={selectOpeningCashMode}
          onOpeningCashChange={setOpeningCash}
          onQuickAmount={addOpeningCashAmount}
          onStepDenomination={stepOpeningDenominationCount}
          onUpdateDenomination={updateOpeningDenominationCount}
          onClearDenominations={clearOpeningDenominations}
          onStart={() => void startShift()}
        />
      ) : null}

      {activeShift && closeModalOpen ? (
        <ShiftCloseModal
          appState={appState}
          activeShift={activeShift}
          expectedCash={expectedCash}
          requiresInventoryCount={endOfDayInventoryCountEnabled}
          closingCashEntryMode={closingCashEntryMode}
          closingCashAmount={closingCashAmount}
          closingCash={closingCash}
          closingDenominationRows={closingDenominationRows}
          closingDenominationCounts={closingDenominationCounts}
          closingDenominationActiveLines={closingDenominationActiveLines}
          closingDenominationPieces={closingDenominationPieces}
          closingDenominationTotal={closingDenominationTotal}
          variancePreview={Number((closingCashAmount - expectedCash).toFixed(2))}
          saving={saving}
          onClose={() => setCloseModalOpen(false)}
          onSelectMode={selectClosingCashMode}
          onClosingCashChange={setClosingCash}
          onQuickAmount={addClosingCashAmount}
          onStepDenomination={stepClosingDenominationCount}
          onUpdateDenomination={updateClosingDenominationCount}
          onClearDenominations={clearClosingDenominations}
          onEndShift={() => void endShift()}
        />
      ) : null}

      {activeShift && inventoryCountModalOpen && inventoryCountSnapshot ? (
        <ShiftInventoryCountModal
          appState={appState}
          activeShift={activeShift}
          expectedCash={expectedCash}
          countedCash={closingCashAmount}
          cashVariance={Number((closingCashAmount - expectedCash).toFixed(2))}
          inventorySnapshot={inventoryCountSnapshot}
          inventoryCounts={inventoryCountInputs}
          saving={saving}
          onClose={() => {
            setInventoryCountModalOpen(false);
            setCloseModalOpen(true);
          }}
          onBackToCloseout={() => {
            setInventoryCountModalOpen(false);
            setCloseModalOpen(true);
          }}
          onUpdateCount={(productId, field, value) => {
            setInventoryCountInputs((prev) => ({
              ...prev,
              [productId]: {
                ...(prev[productId] ?? { qtyOnHand: '', qtyFull: '', qtyEmpty: '' }),
                [field]: value
              }
            }));
          }}
          onFinalize={() => void finalizeShiftClose()}
        />
      ) : null}
    </div>
  );
}
