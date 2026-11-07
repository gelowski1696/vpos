import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SearchField } from "../components/inputs/SearchField";
import { resolveCustomerCheckoutDiscount } from "@vpos/desktop-core";
import { useDesktopUi } from "../components/feedback/DesktopUiFeedback";
import { desktopDb } from "../db/sqlite";
import type {
  DesktopAppState,
  DesktopCatalogProduct,
  DesktopCylinderFlowSelection,
  DesktopHeldCartRecord,
  DesktopOption,
  DesktopPaymentMethod,
  DesktopPaymentMode,
  DesktopPosRewardRecord,
  DesktopPosRewardType,
  DesktopSaleLine,
  DesktopSalePersonnelCommission,
  DesktopSalePayload,
  DesktopSaleRecord,
  DesktopSaleType,
  DesktopShiftInventorySnapshot,
  DesktopShiftRecord,
} from "../db/schema";
import { desktopAuthService } from "../services/desktop-auth.service";
import { desktopDeliveryService } from "../services/desktop-delivery.service";
import { desktopHeldCartService } from "../services/desktop-held-cart.service";
import {
  desktopMasterDataService,
  type TenantAddonFlags,
} from "../services/desktop-master-data.service";
import {
  desktopReceiptService,
  type DesktopQueueOrderReceiptPayload,
} from "../services/desktop-receipt.service";
import { buildSaleOutboxPayload } from "../services/desktop-sale-sync-payload";
import { desktopSettingsService } from "../services/desktop-settings.service";
import { desktopShiftService } from "../services/desktop-shift.service";
import { desktopSubscriptionPolicyService } from "../services/desktop-subscription-policy.service";
import {
  desktopShiftInventoryReportService,
} from "../services/desktop-shift-inventory-report.service";
import {
  desktopStockProjectionService,
  type DesktopProjectedInventoryTotals,
} from "../services/desktop-stock-projection.service";
import { useDesktopTutorialTarget } from "../tutorial/tutorial-provider";
import {
  buildQueueOrderAddressOptions,
  filterQueueOrdersByAddress,
} from "./queue-order-filtering";
import {
  ShiftCloseModal,
  ShiftInventoryCountModal,
} from "./ShiftScreen";

type CartLine = DesktopCatalogProduct & {
  lineId: string;
  quantity: number;
  subtitle?: string | null;
  cylinderFlow?: DesktopCylinderFlowSelection | null;
};

type LocalPriceRule = {
  productId: string;
  flowMode: "ANY" | DesktopCylinderFlowSelection;
  unitPrice: number;
  priority: number;
};

type LocalPriceList = {
  id: string;
  scope: "GLOBAL" | "BRANCH" | "TIER" | "CUSTOMER_GROUP" | "CONTRACT";
  branchId: string | null;
  customerTier: string | null;
  customerCategoryId: string | null;
  customerId: string | null;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  rules: LocalPriceRule[];
};

type Props = {
  appState: DesktopAppState;
  tenantAddons?: TenantAddonFlags;
  onOutboxChanged?: () => Promise<void> | void;
  onAfterInventoryCountClose?: () => Promise<void> | void;
  reopenedSale?: DesktopSaleRecord | null;
  reopenedSaleMode?: "copy" | "recreate";
  reopenedSaleNonce?: number;
  onConsumeReopenedSale?: () => void;
  quickAddProductId?: string | null;
  quickAddNonce?: number;
  onGoToShift?: () => void;
};

type CurrentEntitlementResponse = {
  status?: unknown;
  subscription_status?: unknown;
  subscriptionStatus?: unknown;
  grace_until?: unknown;
  graceUntil?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
  lastSyncedAt?: unknown;
  addons?: {
    receipt_amount_privacy?: boolean;
    cashier_end_of_day_inventory_count?: boolean;
  };
};

type CashEntryMode = "AMOUNT" | "DENOMINATION";

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

type EndDaySnapshot = {
  shift: DesktopShiftRecord;
  shiftId: string;
  openingCash: number;
  cashSales: number;
  cashReturns: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
};

type CheckoutSuccessModalState = {
  receiptNumber: string;
  message: string;
  note: string | null;
  paymentMethodLabel: string;
};

type QueueOrderSortMode =
  | "queue-time-newest"
  | "queue-time-oldest"
  | "amount-high-low"
  | "amount-low-high";

const QUEUE_ORDER_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

type QueueOrdersModalCardStyle = {
  width: string;
  maxWidth: string;
  [key: `--${string}`]: string;
};

export const QUEUE_ORDERS_MODAL_CARD_STYLE: QueueOrdersModalCardStyle = {
  width: "min(1680px, calc(100vw - 20px))",
  maxWidth: "min(1680px, calc(100vw - 20px))",
  "--modal-gap": "12px",
  "--modal-padding": "14px",
  "--modal-header-padding-y": "14px",
  "--modal-header-padding-x": "16px",
  "--modal-footer-padding-y": "12px",
  "--modal-footer-padding-x": "16px",
};

function getHeldCartTotal(held: DesktopHeldCartRecord): number {
  return (
    held.lines.reduce((sum, line) => sum + line.lineTotal, 0) -
    held.discountAmount +
    (held.deliveryFee ?? 0)
  );
}

function getHeldCartAvatarTone(label: string): "blue" | "green" | "amber" {
  const initial = label.trim().charCodeAt(0) || 0;
  const tones: Array<"blue" | "green" | "amber"> = ["blue", "green", "amber"];
  return tones[initial % tones.length];
}

function formatHeldCartDateTime(value: string): {
  date: string;
  time: string;
} {
  const date = new Date(value);
  return {
    date: date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

function queueOrderSortLabel(mode: QueueOrderSortMode): string {
  if (mode === "queue-time-oldest") {
    return "Queue time (Oldest)";
  }
  if (mode === "amount-high-low") {
    return "Amount (High to Low)";
  }
  if (mode === "amount-low-high") {
    return "Amount (Low to High)";
  }
  return "Queue time (Newest)";
}

function buildQueueOrderPageButtons(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  return [...new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages].filter((page) => page >= 1 && page <= totalPages))].sort(
    (left, right) => left - right,
  );
}

type PickerModalProps = {
  open: boolean;
  title: string;
  variant?: "customer" | "personnel" | "helper";
  search: string;
  placeholder: string;
  emptyLabel: string;
  options: DesktopOption[];
  selectedId: string;
  hideEmptyOption?: boolean;
  emptyOptionLabel?: string;
  emptyOptionHint?: string;
  onSearch: (value: string) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
};

type PickerModalVariant = NonNullable<PickerModalProps["variant"]>;
type PickerQuickFilter = "ALL" | "WITH_BALANCE" | "WITH_POINTS" | "WITH_ADDRESS" | "WITH_ROLE" | "COMMISSION" | "NO_ROLE";
type PickerSortMode = "CODE_ASC" | "NAME_ASC" | "BALANCE_DESC" | "POINTS_DESC" | "ROLE_ASC";
type PickerViewMode = "list" | "grid";
type ItemPickerSortMode =
  | "NAME_ASC"
  | "SKU_ASC"
  | "PRICE_ASC"
  | "PRICE_DESC"
  | "STOCK_DESC";

const screenStackClass = "flex flex-col gap-5";
const shellCardClass =
  "rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur";
const summaryStripClass =
  "desktop-summary-strip grid gap-3 sm:grid-cols-2 xl:grid-cols-5";
const summaryTileClass =
  "rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]";
const summaryLabelClass =
  "block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]";
const summaryValueClass =
  "mt-1 block text-[1rem] font-extrabold text-[var(--text-strong)]";
const posCreateCustomerLabelClass =
  "text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]";
const posCreateCustomerInputShellClass =
  "flex min-h-[60px] items-stretch overflow-hidden rounded-[16px] border border-[rgba(188,210,234,0.78)] bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_10px_20px_rgba(17,40,58,0.04)]";
const selectorTileClass =
  "grid gap-1 rounded-[22px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] px-4 py-4 text-left shadow-[0_10px_24px_rgba(17,40,58,0.05)] transition hover:-translate-y-[1px] hover:border-[rgba(25,118,210,0.28)] hover:shadow-[0_14px_28px_rgba(17,40,58,0.08)]";
const selectorLabelClass =
  "text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]";
const selectorValueClass =
  "text-[1rem] font-extrabold text-[var(--text-strong)]";
const selectorMetaClass = "text-[0.88rem] text-[var(--muted)]";
const posModalBackdropClass = "desktop-modal-backdrop";
const posModalCardClass = "desktop-modal-card desktop-modal-card--picker";
const posModalToolbarClass =
  "desktop-modal-header flex shrink-0 flex-col gap-4";
const posMetricCardClass =
  "rounded-[22px] border border-slate-200 bg-slate-50/90 px-4 py-4 shadow-[0_14px_34px_-28px_rgba(15,23,42,0.22)]";

export function getCheckoutSetupChangeButtonClass(isActive: boolean): string {
  return `primary-btn mini-btn${isActive ? " tutorial-target-active" : ""}`;
}
const posMetricLabelClass =
  "text-xs font-semibold uppercase tracking-[0.18em] text-slate-500";
const posMetricValueClass = "mt-2 block text-lg font-semibold text-slate-900";

type PosOverviewMetricTone = "good" | "accent" | "warn" | "danger" | "neutral";
type PosOverviewMetricIcon =
  | "pos"
  | "shift"
  | "queue"
  | "lines"
  | "route"
  | "total";

const POS_ORDER_TYPE_OPTIONS: ReadonlyArray<{
  value: DesktopSaleType;
  label: string;
  description: string;
}> = [
  {
    value: "PICKUP",
    label: "PICKUP",
    description: "Customer picks up the order.",
  },
  {
    value: "DELIVERY",
    label: "DELIVERY",
    description: "Order will be delivered.",
  },
];

function PosOverviewIcon({
  path,
  className = "",
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

function PosOverviewSymbol({
  kind,
  className = "",
}: {
  kind: PosOverviewMetricIcon;
  className?: string;
}): JSX.Element {
  let path: ReactNode;
  if (kind === "pos") {
    path = (
      <>
        <rect x="5" y="4.5" width="14" height="15" rx="2.5" />
        <path d="M8 8.5h8" />
        <path d="M8 12h4" />
        <path d="M15.2 15.2h.01" />
      </>
    );
  } else if (kind === "shift") {
    path = (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="m9.2 12 1.8 1.9 3.8-4.4" />
      </>
    );
  } else if (kind === "queue") {
    path = (
      <>
        <path d="M6.5 7.5h11A1.5 1.5 0 0 1 19 9v7.5H7.5A1.5 1.5 0 0 1 6 15V9a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path d="M8 7.5V6A1.5 1.5 0 0 1 9.5 4.5H15" />
      </>
    );
  } else if (kind === "lines") {
    path = (
      <>
        <rect x="5" y="5.5" width="14" height="13" rx="2.5" />
        <path d="M8.5 9.5h7" />
        <path d="M8.5 12.5h7" />
        <path d="M8.5 15.5h4.5" />
      </>
    );
  } else if (kind === "route") {
    path = (
      <>
        <path d="M7 6.5h10" />
        <path d="M7 17.5h10" />
        <path d="m13 9.2 3 2.8-3 2.8" />
        <path d="M11 14.8 8 12l3-2.8" />
      </>
    );
  } else {
    path = (
      <>
        <rect x="4.5" y="6" width="15" height="12" rx="2.2" />
        <path d="M8 12h8" />
        <path d="M12 9v6" />
      </>
    );
  }
  return <PosOverviewIcon path={path} className={className} />;
}

function PosChevronDownIcon({ className = "" }: { className?: string }): JSX.Element {
  return <PosOverviewIcon path={<path d="m7 10 5 5 5-5" />} className={className} />;
}

function PosChevronUpIcon({ className = "" }: { className?: string }): JSX.Element {
  return <PosOverviewIcon path={<path d="m7 14 5-5 5 5" />} className={className} />;
}

function PosChevronRightIcon({ className = "" }: { className?: string }): JSX.Element {
  return <PosOverviewIcon path={<path d="m9 6 6 6-6 6" />} className={className} />;
}

function PosCheckIcon({ className = "" }: { className?: string }): JSX.Element {
  return <PosOverviewIcon path={<path d="m7.5 12.5 3 3 6-7" />} className={className} />;
}

function PosPlusIcon({ className = "" }: { className?: string }): JSX.Element {
  return (
    <PosOverviewIcon
      path={
        <>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </>
      }
      className={className}
    />
  );
}

function PosMinusIcon({ className = "" }: { className?: string }): JSX.Element {
  return <PosOverviewIcon path={<path d="M5 12h14" />} className={className} />;
}

function PosTrashIcon({ className = "" }: { className?: string }): JSX.Element {
  return (
    <PosOverviewIcon
      path={
        <>
          <path d="M7 7h10" />
          <path d="M10 7V5h4v2" />
          <path d="M9 10v7" />
          <path d="M15 10v7" />
          <path d="M6.5 7.5 7.2 19h9.6l.7-11.5" />
        </>
      }
      className={className}
    />
  );
}

function PosArrowRightIcon({ className = "" }: { className?: string }): JSX.Element {
  return (
    <PosOverviewIcon
      path={
        <>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </>
      }
      className={className}
    />
  );
}

type PosSetupRowIconKind = "customer" | "personnel" | "helper" | "type";

function PosSetupRowSymbol({
  kind,
  className = "",
}: {
  kind: PosSetupRowIconKind;
  className?: string;
}): JSX.Element {
  let path: ReactNode;
  if (kind === "customer") {
    path = (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M6.5 18c.7-2.8 3-4.5 5.5-4.5s4.8 1.7 5.5 4.5" />
      </>
    );
  } else if (kind === "personnel") {
    path = (
      <>
        <circle cx="10" cy="8.5" r="2.2" />
        <path d="M6.5 18c.5-2.4 2.3-3.8 3.5-3.8s3 1.4 3.5 3.8" />
        <path d="M15.8 10.2h2.2" />
        <path d="M17 9.1v2.2" />
      </>
    );
  } else if (kind === "helper") {
    path = (
      <>
        <path d="M8.5 7.5h7" />
        <path d="M8.5 11h7" />
        <path d="M8.5 14.5h4" />
        <path d="M6.5 18.5V6.8A1.8 1.8 0 0 1 8.3 5h7.4A1.8 1.8 0 0 1 17.5 6.8v11.7" />
      </>
    );
  } else {
    path = (
      <>
        <rect x="5" y="6" width="14" height="12" rx="2.5" />
        <path d="M9 9.5h6" />
        <path d="M9 12.5h6" />
        <path d="M9 15.5h3.5" />
      </>
    );
  }
  return <PosOverviewIcon path={path} className={className} />;
}

function posOverviewMetricTone(kind: PosOverviewMetricTone): {
  shell: string;
  icon: string;
  label: string;
  line: string;
} {
  if (kind === "good") {
    return {
      shell: "border-[rgba(182,226,194,0.78)] bg-[rgba(244,252,247,0.98)]",
      icon: "border-[rgba(182,226,194,0.78)] bg-[rgba(237,250,242,0.98)] text-[#1f9b4d]",
      label: "text-[#1f9b4d]",
      line: "from-[#8ad9a2] to-[#36b96d]",
    };
  }
  if (kind === "warn") {
    return {
      shell: "border-[rgba(245,205,126,0.8)] bg-[rgba(255,250,242,0.98)]",
      icon: "border-[rgba(245,205,126,0.78)] bg-[rgba(255,246,229,0.98)] text-[#d68b00]",
      label: "text-[#d68b00]",
      line: "from-[#f6c56d] to-[#ee9b08]",
    };
  }
  if (kind === "danger") {
    return {
      shell: "border-[rgba(246,186,186,0.82)] bg-[rgba(255,245,245,0.98)]",
      icon: "border-[rgba(246,186,186,0.78)] bg-[rgba(255,236,236,0.98)] text-[#cf3f5f]",
      label: "text-[#cf3f5f]",
      line: "from-[#f3a6b5] to-[#dc5e7b]",
    };
  }
  if (kind === "neutral") {
    return {
      shell: "border-[rgba(197,210,228,0.82)] bg-[rgba(248,251,255,0.98)]",
      icon: "border-[rgba(197,210,228,0.78)] bg-[rgba(241,246,255,0.98)] text-[var(--muted-strong)]",
      label: "text-[var(--muted-strong)]",
      line: "from-[rgba(182,198,222,0.95)] to-[rgba(120,142,172,0.95)]",
    };
  }
  return {
    shell: "border-[rgba(171,206,255,0.82)] bg-[rgba(243,248,255,0.98)]",
    icon: "border-[rgba(171,206,255,0.78)] bg-[rgba(236,244,255,0.98)] text-[var(--accent-strong)]",
    label: "text-[var(--accent-strong)]",
    line: "from-[rgba(108,164,255,0.95)] to-[rgba(37,99,235,0.95)]",
  };
}

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function fmtQty(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function parseCashInput(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
  0.01,
] as const;

function emptyOpeningDenominationState(): Record<string, string> {
  return Object.fromEntries(
    openingCashDenominationOptions.map((value) => [String(value), ""]),
  ) as Record<string, string>;
}

function formatDenominationLabel(value: number): string {
  if (value >= 1) {
    return `PHP ${value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  }
  const centavos = Math.round(value * 100);
  return `${centavos} centavos`;
}

function createInventoryCountInputs(
  snapshot: DesktopShiftInventorySnapshot | null,
): InventoryCountInputMap {
  if (!snapshot) {
    return {};
  }
  return Object.fromEntries(
    snapshot.lines.map((line) => [
      line.productId,
      {
        qtyOnHand: "",
        qtyFull: "",
        qtyEmpty: "",
      },
    ]),
  ) as InventoryCountInputMap;
}

function parseInventoryCountOrFallback(
  value: string | undefined,
  fallback: number,
): number {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function buildInventoryCountSnapshot(
  snapshot: DesktopShiftInventorySnapshot,
  counts: InventoryCountInputMap,
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
          qtyOnHand: Number((qtyFull + qtyEmpty).toFixed(2)),
        };
      }
      const qtyOnHand = parseInventoryCountOrFallback(entry?.qtyOnHand, line.qtyOnHand);
      return {
        ...line,
        qtyOnHand,
        qtyFull: 0,
        qtyEmpty: 0,
      };
    }),
  };
}

function formatPaymentMethodLabel(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "CASH") {
    return "Cash";
  }
  if (normalized === "CARD") {
    return "Card";
  }
  if (normalized === "E_WALLET" || normalized === "EWALLET") {
    return "E-Wallet";
  }
  return normalized || "Unknown";
}

export function sanitizeDecimalInput(
  value: string,
  maxFractionDigits = 2,
): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) {
    return "";
  }
  const [wholeRaw, ...fractionParts] = cleaned.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "");
  if (fractionParts.length === 0) {
    return whole;
  }
  const fraction = fractionParts
    .join("")
    .slice(0, Math.max(0, maxFractionDigits));
  return `${whole || "0"}.${fraction}`;
}

export function parseNonNegativeDecimalInput(value: string): number {
  const normalized = sanitizeDecimalInput(value);
  if (!normalized || normalized === "0.") {
    return 0;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return round2(parsed);
}

function resolveCashCollected(sale: DesktopSaleRecord): number {
  const paid = sale.payload.paidAmount ?? sale.payload.totalAmount;
  const change = sale.payload.changeAmount ?? 0;
  return Number(Math.max(0, paid - change).toFixed(2));
}

function manilaDateToken(now: Date): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return ymd.replace(/-/g, "");
}

function makeReceiptNumber(
  existingSales: DesktopSaleRecord[],
  now: Date,
): string {
  const prefix = manilaDateToken(now);
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let maxSequence = 0;
  for (const sale of existingSales) {
    const match = sale.receiptNumber.match(pattern);
    if (!match) {
      continue;
    }
    const next = Number.parseInt(match[1], 10);
    if (Number.isFinite(next) && next > maxSequence) {
      maxSequence = next;
    }
  }
  return `${prefix}-${String(maxSequence + 1).padStart(7, "0")}`;
}

function sanitizeSearchTerm(value: string): string {
  return value.replace(/%+/g, " ").trim().toLowerCase();
}

function toWholeNumberInput(value: string): string {
  const digits = value.replace(/[^\d]/g, "");
  return digits.replace(/^0+(?=\d)/, "");
}

function normalizeWholeQuantity(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

export function normalizeCartQuantityDraftInput(value: string): string {
  return toWholeNumberInput(value);
}

export function parseCartQuantityDraftInput(value: string): number | null {
  const normalized = normalizeCartQuantityDraftInput(value);
  if (!normalized) {
    return null;
  }
  return normalizeWholeQuantity(Number(normalized));
}

function resolveAvailableQty(product: DesktopCatalogProduct): number {
  if (product.isLpg) {
    const full = Math.max(0, Number(product.qtyFull || 0));
    if (full > 0.0001) {
      return full;
    }
  }
  return Math.max(0, Number(product.qtyOnHand || 0));
}

function formatCylinderSizeLabel(product: {
  isLpg?: boolean;
  cylinderSizeLabel?: string | null;
}): string | null {
  if (!product.isLpg) {
    return null;
  }
  const normalized =
    typeof product.cylinderSizeLabel === "string"
      ? product.cylinderSizeLabel.trim()
      : "";
  return normalized.length > 0 ? normalized : "-";
}

function resolveStockTone(
  product: DesktopCatalogProduct,
): "out" | "low" | "good" {
  const available = resolveAvailableQty(product);
  if (available <= 0.0001) {
    return "out";
  }
  if (available <= 3.0001) {
    return "low";
  }
  return "good";
}

function resolveStockLabel(product: DesktopCatalogProduct): string {
  const tone = resolveStockTone(product);
  if (tone === "out") {
    return "Out Of Stock";
  }
  if (tone === "low") {
    return "Low Stock";
  }
  return "Ready";
}

function hasCylinderStock(product: DesktopCatalogProduct): boolean {
  return product.isLpg || product.qtyFull > 0.0001 || product.qtyEmpty > 0.0001;
}

function formatStockQuantity(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : "0";
}

function formatCylinderStockQuantity(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : "0";
}

function productMatchesItemSearch(
  product: DesktopCatalogProduct,
  term: string,
): boolean {
  if (!term) {
    return true;
  }
  return (
    product.name.toLowerCase().includes(term) ||
    product.sku.toLowerCase().includes(term) ||
    product.category.toLowerCase().includes(term) ||
    (product.cylinderSizeLabel ?? "").toLowerCase().includes(term)
  );
}

function itemPickerSortLabel(sortMode: ItemPickerSortMode): string {
  if (sortMode === "SKU_ASC") {
    return "Code (A-Z)";
  }
  if (sortMode === "PRICE_ASC") {
    return "Price (Low-High)";
  }
  if (sortMode === "PRICE_DESC") {
    return "Price (High-Low)";
  }
  if (sortMode === "STOCK_DESC") {
    return "Stock (High-Low)";
  }
  return "Name (A-Z)";
}

function itemPickerCategoryLabel(category: string): string {
  return category === "ALL" ? "All Items" : category;
}

function itemPickerStockSummary(product: DesktopCatalogProduct): string {
  if (hasCylinderStock(product)) {
    return `Full ${formatCylinderStockQuantity(product.qtyFull)} | Empty ${formatCylinderStockQuantity(product.qtyEmpty)}`;
  }
  return `On hand ${formatStockQuantity(product.qtyOnHand)}`;
}

function makeCartLineId(): string {
  return `cart-line-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildEqualSplitCommissionPreview(args: {
  lines: DesktopSaleLine[];
  personnel: Array<{
    id: string | null;
    name: string | null;
    role: "DRIVER" | "HELPER" | "PERSONNEL";
    commissionEligible?: boolean;
  }>;
  saleType: DesktopSaleType;
}): DesktopSalePersonnelCommission[] {
  const eligiblePersonnel = args.personnel
    .filter((person) => person.commissionEligible !== false)
    .filter((person) => (person.id ?? "").trim().length > 0 || (person.name ?? "").trim().length > 0);

  if (eligiblePersonnel.length === 0) {
    return [];
  }

  const splitPercent = round2(100 / eligiblePersonnel.length);
  const rows: DesktopSalePersonnelCommission[] = [];

  for (const line of args.lines) {
    const quantity = Math.max(0, Number(line.quantity || 0));
    const commissionRate = round2(
      Math.max(
        0,
        args.saleType === "DELIVERY"
          ? Number(line.deliveryCommissionRate || 0)
          : Number(line.pickupCommissionRate || 0),
      ),
    );
    const totalCommission = round2(quantity * commissionRate);
    if (quantity <= 0 || commissionRate <= 0 || totalCommission <= 0) {
      continue;
    }

    let allocated = 0;
    eligiblePersonnel.forEach((person, index) => {
      const isLast = index === eligiblePersonnel.length - 1;
      const commissionAmount = isLast
        ? round2(totalCommission - allocated)
        : round2(totalCommission / eligiblePersonnel.length);
      allocated = round2(allocated + commissionAmount);
      if (commissionAmount <= 0) {
        return;
      }
      rows.push({
        productId: line.productId,
        productName: line.productName,
        personnelId: person.id,
        personnelName: person.name ?? person.id ?? "Personnel",
        personnelRole: person.role,
        saleType: args.saleType,
        quantity,
        commissionRate,
        splitPercent,
        commissionAmount,
      });
    });
  }

  return rows;
}

function parseRecord<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function parsePriceLists(rows: Array<{ payload: string }>): LocalPriceList[] {
  const lists: LocalPriceList[] = [];
  for (const row of rows) {
    const payload = parseRecord<Record<string, unknown>>(row.payload, {});
    const id = asString(payload.id);
    const scope = asString(payload.scope)?.toUpperCase() as
      | LocalPriceList["scope"]
      | undefined;
    const startsAt = asString(payload.startsAt ?? payload.starts_at);
    if (!id || !scope || !startsAt) {
      continue;
    }

    const rulesRaw = Array.isArray(payload.rules) ? payload.rules : [];
    const rules: LocalPriceRule[] = [];
    for (const ruleRow of rulesRaw) {
      if (!ruleRow || typeof ruleRow !== "object") {
        continue;
      }
      const rule = ruleRow as Record<string, unknown>;
      const productId = asString(rule.productId ?? rule.product_id);
      const flowModeRaw = asString(
        rule.flowMode ?? rule.flow_mode,
      )?.toUpperCase();
      const unitPrice = asNumber(rule.unitPrice ?? rule.unit_price);
      const priority = asNumber(rule.priority);
      if (!productId || unitPrice === null || priority === null) {
        continue;
      }
      const flowMode: LocalPriceRule["flowMode"] =
        flowModeRaw === "REFILL_EXCHANGE" || flowModeRaw === "NON_REFILL"
          ? flowModeRaw
          : "ANY";
      rules.push({
        productId,
        flowMode,
        unitPrice: round2(unitPrice),
        priority,
      });
    }

    lists.push({
      id,
      scope,
      branchId: asString(payload.branchId ?? payload.branch_id),
      customerTier:
        asString(
          payload.customerTier ?? payload.customer_tier,
        )?.toUpperCase() ?? null,
      customerCategoryId: asString(
        payload.customerCategoryId ?? payload.customer_category_id,
      ),
      customerId: asString(payload.customerId ?? payload.customer_id),
      startsAt,
      endsAt: asString(payload.endsAt ?? payload.ends_at),
      isActive:
        payload.isActive === false || payload.is_active === false
          ? false
          : true,
      rules,
    });
  }
  return lists;
}

function resolveLocalPrice(input: {
  productId: string;
  baseUnitPrice: number;
  branchId: string;
  customer: DesktopOption | null;
  priceLists: LocalPriceList[];
  allowCustomPricing: boolean;
  atIso: string;
  flowMode?: DesktopCylinderFlowSelection | null;
}): number | null {
  const atMs = parseDateMs(input.atIso);
  if (atMs === null) {
    return null;
  }

  const activeLists = input.priceLists.filter((list) => {
    if (!list.isActive) {
      return false;
    }
    const startMs = parseDateMs(list.startsAt);
    if (startMs === null || startMs > atMs) {
      return false;
    }
    const endMs = parseDateMs(list.endsAt);
    if (endMs !== null && endMs < atMs) {
      return false;
    }
    return true;
  });

  const pick = (lists: LocalPriceList[]): number | null => {
    const matches: Array<{
      unitPrice: number;
      priority: number;
      flowRank: number;
    }> = [];
    for (const list of lists) {
      for (const rule of list.rules) {
        if (rule.productId !== input.productId) {
          continue;
        }
        let flowRank: number | null = null;
        if (!input.flowMode) {
          flowRank = rule.flowMode === "ANY" ? 0 : null;
        } else if (rule.flowMode === input.flowMode) {
          flowRank = 0;
        } else if (rule.flowMode === "ANY") {
          flowRank = 1;
        }
        if (flowRank === null) {
          continue;
        }
        matches.push({
          unitPrice: rule.unitPrice,
          priority: rule.priority,
          flowRank,
        });
      }
    }
    if (!matches.length) {
      return null;
    }
    matches.sort((a, b) => {
      if (a.flowRank !== b.flowRank) {
        return a.flowRank - b.flowRank;
      }
      return a.priority - b.priority;
    });
    return round2(matches[0].unitPrice);
  };

  const contract = pick(
    activeLists.filter(
      (list) =>
        list.scope === "CONTRACT" &&
        input.customer?.id &&
        list.customerId === input.customer.id,
    ),
  );
  if (contract !== null) {
    return contract;
  }

  let basePrice: number | null = null;
  if (input.allowCustomPricing && input.customer?.customerCategoryId) {
    const customerGroup = pick(
      activeLists.filter(
        (list) =>
          list.scope === "CUSTOMER_GROUP" &&
          list.customerCategoryId &&
          list.customerCategoryId === input.customer?.customerCategoryId,
      ),
    );
    if (customerGroup !== null) {
      basePrice = customerGroup;
    }
  }

  const tier = basePrice === null
    ? pick(
        activeLists.filter(
          (list) =>
            list.scope === "TIER" &&
            input.customer?.tier &&
            list.customerTier &&
            list.customerTier.toUpperCase() === input.customer.tier.toUpperCase(),
        ),
      )
    : null;
  if (basePrice === null && tier !== null) {
    basePrice = tier;
  }

  const branch = basePrice === null
    ? pick(
        activeLists.filter(
          (list) => list.scope === "BRANCH" && list.branchId === input.branchId,
        ),
      )
    : null;
  if (basePrice === null && branch !== null) {
    basePrice = branch;
  }

  const global = basePrice === null ? pick(activeLists.filter((list) => list.scope === "GLOBAL")) : null;
  basePrice ??= global ?? input.baseUnitPrice;

  return round2(basePrice);
}

function isSupportedRewardType(
  value: string | null | undefined,
): value is DesktopPosRewardType {
  return (
    value === "DISCOUNT_FIXED" ||
    value === "DISCOUNT_PERCENT" ||
    value === "FREE_DELIVERY" ||
    value === "FREE_PRODUCT" ||
    value === "FREE_REFILL"
  );
}

function resolveRewardCartDiscount(
  reward: DesktopPosRewardRecord,
  cart: CartLine[],
): number {
  if (reward.rewardType === "FREE_PRODUCT") {
    const targetLine = cart.find(
      (line) => line.id === reward.productId && !line.isLpg,
    );
    if (!targetLine) {
      return 0;
    }
    const freeQty = Math.max(1, reward.freeQty ?? 1);
    return round2(
      Math.min(targetLine.quantity, freeQty) * targetLine.unitPrice,
    );
  }

  if (reward.rewardType === "FREE_REFILL") {
    const refillLines = cart.filter(
      (line) =>
        line.isLpg &&
        line.cylinderFlow === "REFILL_EXCHANGE" &&
        (!reward.productId || line.id === reward.productId),
    );
    if (!refillLines.length) {
      return 0;
    }
    let remainingFreeQty = Math.max(1, reward.freeQty ?? 1);
    let total = 0;
    for (const line of refillLines) {
      if (remainingFreeQty <= 0) {
        break;
      }
      const appliedQty = Math.min(line.quantity, remainingFreeQty);
      total += appliedQty * line.unitPrice;
      remainingFreeQty -= appliedQty;
    }
    return round2(total);
  }

  return 0;
}

function toRewardRecord(
  row: Record<string, unknown>,
): DesktopPosRewardRecord | null {
  const rewardType =
    typeof row.reward_type === "string" ? row.reward_type.toUpperCase() : null;
  if (!isSupportedRewardType(rewardType)) {
    return null;
  }
  if (typeof row.id !== "string") {
    return null;
  }
  return {
    id: row.id,
    code: typeof row.code === "string" ? row.code : row.id,
    name: typeof row.name === "string" ? row.name : row.id,
    description: typeof row.description === "string" ? row.description : null,
    rewardType,
    pointsCost: Number(row.points_cost ?? 0) || 0,
    productId: typeof row.product_id === "string" ? row.product_id : null,
    freeQty: row.free_qty == null ? null : Number(row.free_qty) || 0,
    discountValue:
      row.discount_value == null ? null : Number(row.discount_value) || 0,
    minSpend: row.min_spend == null ? null : Number(row.min_spend) || 0,
    status:
      typeof row.status === "string"
        ? (row.status.toUpperCase() as DesktopPosRewardRecord["status"])
        : "ACTIVE",
  };
}

const PICKER_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function resolvePickerVariant(
  title: string,
  variant?: PickerModalVariant,
): PickerModalVariant {
  if (variant) {
    return variant;
  }
  const normalized = title.toLowerCase();
  if (normalized.includes("helper")) {
    return "helper";
  }
  if (normalized.includes("personnel")) {
    return "personnel";
  }
  return "customer";
}

function pickerEntityLabel(variant: PickerModalVariant, count: number): string {
  const singular =
    variant === "customer"
      ? "Customer"
      : variant === "helper"
        ? "Helper"
        : "Personnel";
  if (variant === "personnel") {
    return `${count} Personnel found`;
  }
  return `${count} ${singular}${count === 1 ? "" : "s"} found`;
}

function splitOptionLabel(option: DesktopOption): { code: string; name: string } {
  const rawLabel = option.label.trim();
  const codeFromSubtitle =
    option.subtitle
      ?.split("·")[0]
      ?.trim()
      .replace(/^Code\s+/i, "") ?? "";
  const codeFromLabel = rawLabel.includes(" - ")
    ? rawLabel.split(" - ")[0]?.trim() ?? ""
    : "";
  const nameFromLabel = rawLabel.includes(" - ")
    ? rawLabel.split(" - ").slice(1).join(" - ").trim()
    : rawLabel;
  return {
    code: codeFromSubtitle || codeFromLabel || option.id,
    name: nameFromLabel || rawLabel || option.id,
  };
}

function resolvePickerMeta(
  option: DesktopOption,
  variant: PickerModalVariant,
): {
  code: string;
  name: string;
  subtitle: string;
  balance: number;
  points: number;
  address: string;
  role: string;
  commission: string;
} {
  const split = splitOptionLabel(option);
  const balance = Number(option.balance ?? 0);
  const points = Math.floor(Number(option.pointsBalance ?? 0));
  const role = option.roleName?.trim() || option.subtitle?.trim() || "-";
  return {
    code: split.code,
    name: split.name,
    subtitle:
      variant === "customer"
        ? option.subtitle?.trim() || `${split.code} · Bal ${balance.toFixed(2)} · Pts ${points}`
        : option.subtitle?.trim() || role,
    balance,
    points,
    address: option.address?.trim() || "-",
    role,
    commission: option.commissionEligible === false ? "No" : "Yes",
  };
}

function pickerQuickFilters(
  variant: PickerModalVariant,
  options: DesktopOption[],
): Array<{ id: PickerQuickFilter; label: string; count: number }> {
  if (variant === "customer") {
    return [
      { id: "ALL", label: "All Customers", count: options.length },
      {
        id: "WITH_BALANCE",
        label: "With Balance",
        count: options.filter((option) => Number(option.balance ?? 0) > 0).length,
      },
      {
        id: "WITH_POINTS",
        label: "With Points",
        count: options.filter((option) => Number(option.pointsBalance ?? 0) > 0).length,
      },
      {
        id: "WITH_ADDRESS",
        label: "With Address",
        count: options.filter((option) => Boolean(option.address?.trim())).length,
      },
    ];
  }

  const personnelFilters: Array<{ id: PickerQuickFilter; label: string; count: number }> = [
    {
      id: "ALL",
      label: variant === "helper" ? "All Helpers" : "All Personnel",
      count: options.length,
    },
    {
      id: "WITH_ROLE",
      label: "With Role",
      count: options.filter((option) => Boolean(option.roleName?.trim() || option.subtitle?.trim())).length,
    },
    {
      id: "COMMISSION",
      label: "Commission",
      count: options.filter((option) => option.commissionEligible !== false).length,
    },
  ];

  if (variant === "helper") {
    personnelFilters.push({
      id: "NO_ROLE",
      label: "No Role",
      count: options.filter((option) => !(option.roleName?.trim() || option.subtitle?.trim())).length,
    });
  }

  return personnelFilters;
}

function applyPickerQuickFilter(
  options: DesktopOption[],
  filter: PickerQuickFilter,
): DesktopOption[] {
  if (filter === "WITH_BALANCE") {
    return options.filter((option) => Number(option.balance ?? 0) > 0);
  }
  if (filter === "WITH_POINTS") {
    return options.filter((option) => Number(option.pointsBalance ?? 0) > 0);
  }
  if (filter === "WITH_ADDRESS") {
    return options.filter((option) => Boolean(option.address?.trim()));
  }
  if (filter === "WITH_ROLE") {
    return options.filter((option) => Boolean(option.roleName?.trim() || option.subtitle?.trim()));
  }
  if (filter === "COMMISSION") {
    return options.filter((option) => option.commissionEligible !== false);
  }
  if (filter === "NO_ROLE") {
    return options.filter((option) => !(option.roleName?.trim() || option.subtitle?.trim()));
  }
  return options;
}

function pickerSortLabel(sortMode: PickerSortMode): string {
  if (sortMode === "NAME_ASC") {
    return "Name (A-Z)";
  }
  if (sortMode === "BALANCE_DESC") {
    return "Balance (High-Low)";
  }
  if (sortMode === "POINTS_DESC") {
    return "Points (High-Low)";
  }
  if (sortMode === "ROLE_ASC") {
    return "Role (A-Z)";
  }
  return "Code (A-Z)";
}

function PickerModal(props: PickerModalProps): JSX.Element | null {
  const variant = resolvePickerVariant(props.title, props.variant);
  const [quickFilter, setQuickFilter] = useState<PickerQuickFilter>("ALL");
  const [sortMode, setSortMode] = useState<PickerSortMode>(
    variant === "customer" ? "CODE_ASC" : "NAME_ASC",
  );
  const [viewMode, setViewMode] = useState<PickerViewMode>("list");
  const [pageSize, setPageSize] = useState<number>(PICKER_PAGE_SIZE_OPTIONS[0]);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (props.open) {
      setQuickFilter("ALL");
      setSortMode(variant === "customer" ? "CODE_ASC" : "NAME_ASC");
      setViewMode("list");
      setPageSize(PICKER_PAGE_SIZE_OPTIONS[0]);
      setCurrentPage(1);
    }
  }, [props.open, variant]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, props.search, quickFilter, sortMode, viewMode]);

  const quickFilters = useMemo(
    () => pickerQuickFilters(variant, props.options),
    [props.options, variant],
  );
  const sortedOptions = useMemo(() => {
    const rows = applyPickerQuickFilter(props.options, quickFilter);
    return [...rows].sort((left, right) => {
      const leftMeta = resolvePickerMeta(left, variant);
      const rightMeta = resolvePickerMeta(right, variant);
      if (sortMode === "NAME_ASC") {
        return leftMeta.name.localeCompare(rightMeta.name);
      }
      if (sortMode === "BALANCE_DESC") {
        return rightMeta.balance - leftMeta.balance;
      }
      if (sortMode === "POINTS_DESC") {
        return rightMeta.points - leftMeta.points;
      }
      if (sortMode === "ROLE_ASC") {
        return leftMeta.role.localeCompare(rightMeta.role);
      }
      return leftMeta.code.localeCompare(rightMeta.code, undefined, {
        numeric: true,
      });
    });
  }, [props.options, quickFilter, sortMode, variant]);
  const totalPages = Math.max(1, Math.ceil(sortedOptions.length / pageSize));
  const boundedCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = (boundedCurrentPage - 1) * pageSize;
  const pageRows = sortedOptions.slice(pageStartIndex, pageStartIndex + pageSize);
  const pageButtons = buildQueueOrderPageButtons(boundedCurrentPage, totalPages);
  const selectionLabel =
    variant === "customer"
      ? "Customer"
      : variant === "helper"
        ? "Helper"
        : "Personnel";
  const pickerSubtitle =
    variant === "customer"
      ? "Choose a saved customer for this sale, or create a local customer before checkout."
      : null;

  if (!props.open) {
    return null;
  }

  return (
    <div className={`${posModalBackdropClass} pos-directory-backdrop`} onClick={props.onClose}>
      <div
        className={`desktop-modal-card desktop-modal-card--picker pos-directory-modal ${
          variant === "customer" ? "pos-directory-modal--customer" : ""
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="desktop-modal-header pos-directory-header">
          <div className="pos-directory-title">
            {variant === "customer" ? (
              <span className="pos-directory-title-icon" aria-hidden="true">
                <PosSetupRowSymbol kind="customer" className="h-[24px] w-[24px]" />
              </span>
            ) : null}
            <div className="pos-directory-title-copy">
              <div className="eyebrow">Selection</div>
              <h3>{props.title}</h3>
              {pickerSubtitle ? <p>{pickerSubtitle}</p> : null}
            </div>
          </div>
          <button
            className="secondary-btn mini-btn modal-close-icon-btn"
            type="button"
            onClick={props.onClose}
            aria-label="Close modal"
            title="Close"
          >
            <span aria-hidden="true">X</span>
          </button>
        </div>

        <div className="desktop-modal-body pos-directory-body">
          <aside className="pos-directory-sidebar">
            <SearchField
              className="pos-directory-search"
              value={props.search}
              onChange={props.onSearch}
              placeholder={props.placeholder}
              autoFocus
            />

            <div className="pos-directory-filter-block">
              <span className="pos-directory-filter-title">Quick filters</span>
              <div className="pos-directory-filter-list">
                {quickFilters.map((filter) => (
                  <button
                    key={filter.id}
                    className={`pos-directory-filter-btn ${quickFilter === filter.id ? "is-active" : ""}`}
                    type="button"
                    onClick={() => setQuickFilter(filter.id)}
                  >
                    <span className="pos-directory-filter-icon" aria-hidden="true">
                      <PosOverviewSymbol
                        kind={filter.id === "ALL" ? "total" : filter.id === "WITH_BALANCE" || filter.id === "COMMISSION" ? "shift" : "lines"}
                        className="h-[19px] w-[19px]"
                      />
                    </span>
                    <span>{filter.label}</span>
                    <strong>{filter.count}</strong>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="pos-directory-main">
            <div className="pos-directory-toolbar">
              <strong>{pickerEntityLabel(variant, sortedOptions.length)}</strong>
              <div className="pos-directory-controls">
                <label className="pos-directory-sort">
                  <span aria-hidden="true">↕</span>
                  <select
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value as PickerSortMode)}
                    aria-label={`Sort ${selectionLabel.toLowerCase()} list`}
                  >
                    <option value="CODE_ASC">Sort by: {pickerSortLabel("CODE_ASC")}</option>
                    <option value="NAME_ASC">Sort by: {pickerSortLabel("NAME_ASC")}</option>
                    {variant === "customer" ? (
                      <>
                        <option value="BALANCE_DESC">Sort by: {pickerSortLabel("BALANCE_DESC")}</option>
                        <option value="POINTS_DESC">Sort by: {pickerSortLabel("POINTS_DESC")}</option>
                      </>
                    ) : (
                      <option value="ROLE_ASC">Sort by: {pickerSortLabel("ROLE_ASC")}</option>
                    )}
                  </select>
                </label>
                <div className="pos-directory-view-toggle" aria-label="View mode">
                  <button
                    className={viewMode === "list" ? "is-active" : ""}
                    type="button"
                    onClick={() => setViewMode("list")}
                    aria-label="List view"
                    title="List view"
                  >
                    <span aria-hidden="true">☰</span>
                  </button>
                  <button
                    className={viewMode === "grid" ? "is-active" : ""}
                    type="button"
                    onClick={() => setViewMode("grid")}
                    aria-label="Grid view"
                    title="Grid view"
                  >
                    <span aria-hidden="true">▦</span>
                  </button>
                </div>
              </div>
            </div>

            {viewMode === "list" ? (
              <div className={`pos-directory-table pos-directory-table--${variant}`}>
                <div className="pos-directory-table-head">
                  <span aria-hidden="true" />
                  <span>Code</span>
                  <span>{selectionLabel} Name</span>
                  {variant === "customer" ? (
                    <>
                      <span>Balance</span>
                      <span>Points</span>
                      <span>Address</span>
                    </>
                  ) : (
                    <>
                      <span>Role</span>
                      <span>Commission</span>
                    </>
                  )}
                  <span aria-hidden="true" />
                </div>

                <div className="pos-directory-rows">
                  {!props.hideEmptyOption && boundedCurrentPage === 1 ? (
                    <button
                      type="button"
                      className={`pos-directory-row ${props.selectedId === "" ? "is-selected" : ""}`}
                      onClick={() => props.onSelect("")}
                    >
                      <span className="pos-directory-avatar" aria-hidden="true">
                        <PosOverviewSymbol kind="total" className="h-[18px] w-[18px]" />
                      </span>
                      <strong>-</strong>
                      <span className="pos-directory-name-cell">
                        <strong>{props.emptyOptionLabel ?? `No ${selectionLabel.toLowerCase()}`}</strong>
                        <small>{props.emptyOptionHint ?? "No selection yet."}</small>
                      </span>
                      {variant === "customer" ? (
                        <>
                          <span>-</span>
                          <span>-</span>
                          <span>-</span>
                        </>
                      ) : (
                        <>
                          <span>{props.emptyOptionHint ?? "-"}</span>
                          <span>-</span>
                        </>
                      )}
                      <span className="pos-directory-row-action" aria-hidden="true">
                        {props.selectedId === "" ? "✓" : "›"}
                      </span>
                    </button>
                  ) : null}

                  {pageRows.length === 0 ? (
                    <div className="empty-state pos-directory-empty">{props.emptyLabel}</div>
                  ) : (
                    pageRows.map((option) => {
                      const meta = resolvePickerMeta(option, variant);
                      const isSelected = props.selectedId === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          className={`pos-directory-row ${isSelected ? "is-selected" : ""}`}
                          onClick={() => props.onSelect(option.id)}
                        >
                          <span className="pos-directory-avatar" aria-hidden="true">
                            <PosOverviewSymbol kind="total" className="h-[18px] w-[18px]" />
                          </span>
                          <strong>{meta.code}</strong>
                          <span className="pos-directory-name-cell">
                            <strong>{meta.name}</strong>
                            <small>{variant === "customer" ? meta.address : meta.subtitle}</small>
                            <span className="pos-directory-inline-meta">
                              {variant === "customer"
                                ? `Bal ${fmtMoney(meta.balance)} | Pts ${meta.points}`
                                : `Role ${meta.role} | Comm ${meta.commission}`}
                            </span>
                          </span>
                          {variant === "customer" ? (
                            <>
                              <span>{fmtMoney(meta.balance)}</span>
                              <span>{meta.points}</span>
                              <span>{meta.address}</span>
                            </>
                          ) : (
                            <>
                              <span>{meta.role}</span>
                              <span>{meta.commission}</span>
                            </>
                          )}
                          <span className="pos-directory-row-action" aria-hidden="true">
                            {isSelected ? "✓" : "›"}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="pos-directory-card-grid">
                {pageRows.length === 0 ? (
                  <div className="empty-state pos-directory-empty">{props.emptyLabel}</div>
                ) : (
                  pageRows.map((option) => {
                    const meta = resolvePickerMeta(option, variant);
                    const isSelected = props.selectedId === option.id;
                    return (
                      <button
                        key={option.id}
                        className={`pos-directory-card-option ${isSelected ? "is-selected" : ""}`}
                        type="button"
                        onClick={() => props.onSelect(option.id)}
                      >
                        <span className="pos-directory-avatar" aria-hidden="true">
                          <PosOverviewSymbol kind="total" className="h-[18px] w-[18px]" />
                        </span>
                        <strong>{meta.name}</strong>
                        <span>{meta.code}</span>
                        <small>{variant === "customer" ? meta.address : meta.role}</small>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            <div className="pos-directory-pager">
              <span>
                Showing {sortedOptions.length === 0 ? 0 : pageStartIndex + 1} to{" "}
                {Math.min(pageStartIndex + pageSize, sortedOptions.length)} of{" "}
                {sortedOptions.length} {variant === "customer" ? "customers" : "records"}
              </span>
              <div className="pos-directory-page-buttons">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={boundedCurrentPage <= 1}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                {pageButtons.map((page) => (
                  <button
                    key={page}
                    className={boundedCurrentPage === page ? "is-active" : ""}
                    type="button"
                    onClick={() => setCurrentPage(page)}
                  >
                    {page}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={boundedCurrentPage >= totalPages}
                  aria-label="Next page"
                >
                  ›
                </button>
              </div>
              <label className="pos-directory-page-size">
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  aria-label="Rows per page"
                >
                  {PICKER_PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size} per page
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        </div>

        <div className="desktop-modal-footer pos-directory-footer">
          {props.onAction ? (
            <button
              className="primary-btn"
              type="button"
              onClick={props.onAction}
              disabled={props.actionDisabled}
            >
              <span className="pos-directory-action-icon" aria-hidden="true">
                +
              </span>
              {props.actionLabel ?? "Add New"}
            </button>
          ) : null}
          <button className="secondary-btn" type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

type CartQuantityInputProps = {
  lineId: string;
  quantity: number;
  onUpdateQuantity: (lineId: string, nextQuantity: number) => void;
};

function CartQuantityInput({
  lineId,
  quantity,
  onUpdateQuantity,
}: CartQuantityInputProps): JSX.Element {
  const [draftValue, setDraftValue] = useState(() =>
    String(normalizeWholeQuantity(quantity)),
  );
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(String(normalizeWholeQuantity(quantity)));
    }
  }, [isFocused, quantity]);

  const commitDraftValue = (nextDraftValue: string): void => {
    const committedQuantity = parseCartQuantityDraftInput(nextDraftValue);
    onUpdateQuantity(lineId, committedQuantity ?? 0);
  };

  return (
    <input
      className="pos-cart-qty-input"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draftValue}
      onFocus={() => {
        setIsFocused(true);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        const nextTarget = event.relatedTarget;
        const container = event.currentTarget.parentElement;
        if (
          draftValue === "" &&
          nextTarget instanceof Node &&
          container?.contains(nextTarget)
        ) {
          return;
        }
        commitDraftValue(draftValue);
      }}
      onChange={(event) => {
        const nextDraftValue = normalizeCartQuantityDraftInput(
          event.target.value,
        );
        setDraftValue(nextDraftValue);
        if (nextDraftValue !== "") {
          const committedQuantity = parseCartQuantityDraftInput(nextDraftValue);
          if (committedQuantity !== null) {
            onUpdateQuantity(lineId, committedQuantity);
          }
        }
      }}
    />
  );
}

export function PosScreen({
  appState,
  tenantAddons,
  onOutboxChanged,
  onAfterInventoryCountClose,
  reopenedSale = null,
  reopenedSaleMode = "copy",
  reopenedSaleNonce = 0,
  onConsumeReopenedSale,
  quickAddProductId = null,
  quickAddNonce = 0,
  onGoToShift,
}: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const orderTypeTarget = useDesktopTutorialTarget("pos-order-type");
  const customerTarget = useDesktopTutorialTarget("pos-customer");
  const itemSelectorTarget = useDesktopTutorialTarget("pos-item-selector");
  const proceedPaymentTarget = useDesktopTutorialTarget("pos-proceed-payment");
  const cachedCashierEndOfDayInventoryCountAddonEnabled =
    tenantAddons?.cashier_end_of_day_inventory_count === true;
  const [customerSearch, setCustomerSearch] = useState("");
  const [personnelSearch, setPersonnelSearch] = useState("");
  const [helperSearch, setHelperSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [heldCartSearch, setHeldCartSearch] = useState("");
  const [heldCartProvinceFilter, setHeldCartProvinceFilter] = useState("ALL");
  const [heldCartCityFilter, setHeldCartCityFilter] = useState("ALL");
  const [heldCartSortMode, setHeldCartSortMode] =
    useState<QueueOrderSortMode>("queue-time-newest");
  const [heldCartPageSize, setHeldCartPageSize] = useState<number>(
    QUEUE_ORDER_PAGE_SIZE_OPTIONS[0],
  );
  const [heldCartCurrentPage, setHeldCartCurrentPage] = useState(1);
  const [itemCategoryFilter, setItemCategoryFilter] = useState("ALL");
  const [itemPickerSortMode, setItemPickerSortMode] =
    useState<ItemPickerSortMode>("NAME_ASC");
  const [itemPickerViewMode, setItemPickerViewMode] =
    useState<PickerViewMode>("list");
  const [itemPickerPageSize, setItemPickerPageSize] = useState<number>(
    PICKER_PAGE_SIZE_OPTIONS[0],
  );
  const [itemPickerCurrentPage, setItemPickerCurrentPage] = useState(1);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedPersonnelId, setSelectedPersonnelId] = useState("");
  const [selectedHelperId, setSelectedHelperId] = useState("");
  const [notes, setNotes] = useState("");
  const [orderType, setOrderType] = useState<DesktopSaleType>("PICKUP");
  const [paymentMode, setPaymentMode] = useState<DesktopPaymentMode>("FULL");
  const [paymentMethod, setPaymentMethod] =
    useState<DesktopPaymentMethod>("CASH");
  const [paidAmount, setPaidAmount] = useState("0");
  const [
    receiptAmountPrivacyAddonEnabled,
    setReceiptAmountPrivacyAddonEnabled,
  ] = useState(false);
  const [
    cashierEndOfDayInventoryCountAddonEnabled,
    setCashierEndOfDayInventoryCountAddonEnabled,
  ] = useState(cachedCashierEndOfDayInventoryCountAddonEnabled);
  const [deliveryDispatchAddonEnabled, setDeliveryDispatchAddonEnabled] =
    useState(false);
  const [purchaseOrderAddonEnabled, setPurchaseOrderAddonEnabled] =
    useState(false);
  const [queueOrderFilteringAddonEnabled, setQueueOrderFilteringAddonEnabled] =
    useState(false);
  const [hideReceiptAmounts, setHideReceiptAmounts] = useState(false);
  const [discountAmount, setDiscountAmount] = useState("0");
  const [deliveryFee, setDeliveryFee] = useState("0");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [catalogBase, setCatalogBase] = useState<DesktopCatalogProduct[]>([]);
  const [catalog, setCatalog] = useState<DesktopCatalogProduct[]>([]);
  const [priceLists, setPriceLists] = useState<LocalPriceList[]>([]);
  const [allowCustomPricing, setAllowCustomPricing] = useState(false);
  const [projectedInventoryByProduct, setProjectedInventoryByProduct] =
    useState<Map<string, DesktopProjectedInventoryTotals>>(new Map());
  const [customers, setCustomers] = useState<DesktopOption[]>([]);
  const [personnels, setPersonnels] = useState<DesktopOption[]>([]);
  const [heldCarts, setHeldCarts] = useState<DesktopHeldCartRecord[]>([]);
  const [availableRewards, setAvailableRewards] = useState<
    DesktopPosRewardRecord[]
  >([]);
  const [selectedRewardId, setSelectedRewardId] = useState("");
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [endDaySnapshot, setEndDaySnapshot] = useState<EndDaySnapshot | null>(
    null,
  );
  const [endDayModalOpen, setEndDayModalOpen] = useState(false);
  const [endDayInventoryModalOpen, setEndDayInventoryModalOpen] =
    useState(false);
  const [endDayLoading, setEndDayLoading] = useState(false);
  const [endDayCashEntryMode, setEndDayCashEntryMode] =
    useState<CashEntryMode>("DENOMINATION");
  const [endDayCash, setEndDayCash] = useState("0");
  const [endDayDenominationCounts, setEndDayDenominationCounts] = useState<
    Record<string, string>
  >(() => emptyOpeningDenominationState());
  const [endDayInventorySnapshot, setEndDayInventorySnapshot] =
    useState<DesktopShiftInventorySnapshot | null>(null);
  const [endDayInventoryCounts, setEndDayInventoryCounts] =
    useState<InventoryCountInputMap>({});
  const [checkoutSetupModalOpen, setCheckoutSetupModalOpen] = useState(false);
  const [orderTypeDropdownOpen, setOrderTypeDropdownOpen] = useState(false);
  const orderTypeDropdownRef = useRef<HTMLDivElement | null>(null);
  const [holdLabel, setHoldLabel] = useState("");
  const [recreatedFromSaleId, setRecreatedFromSaleId] = useState<string | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [createCustomerModalOpen, setCreateCustomerModalOpen] = useState(false);
  const [personnelModalOpen, setPersonnelModalOpen] = useState(false);
  const [helperModalOpen, setHelperModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [queuePreviewOpen, setQueuePreviewOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [saleSuccessModal, setSaleSuccessModal] =
    useState<CheckoutSuccessModalState | null>(null);
  const [heldCartModalOpen, setHeldCartModalOpen] = useState(false);
  const [clearOrderConfirmOpen, setClearOrderConfirmOpen] = useState(false);
  const [createCustomerName, setCreateCustomerName] = useState("");
  const [createCustomerAddress, setCreateCustomerAddress] = useState("");
  const [createCustomerContactNumber, setCreateCustomerContactNumber] =
    useState("");
  const [createCustomerGas, setCreateCustomerGas] = useState("");
  const [createCustomerProvince, setCreateCustomerProvince] = useState("");
  const [createCustomerCity, setCreateCustomerCity] = useState("");
  const [createCustomerSaving, setCreateCustomerSaving] = useState(false);
  const [lastAppliedReopenNonce, setLastAppliedReopenNonce] =
    useState<number>(-1);
  const [message, setMessage] = useState(
    "Download branch data in Settings first, then POS will use the local products and customers.",
  );
  const pickerModalOpen =
    customerModalOpen || personnelModalOpen || helperModalOpen || itemModalOpen;

  useEffect(() => {
    if (itemModalOpen) {
      setItemPickerCurrentPage(1);
      setItemPickerViewMode("list");
      setItemPickerPageSize(PICKER_PAGE_SIZE_OPTIONS[0]);
    }
  }, [itemModalOpen]);

  useEffect(() => {
    setItemPickerCurrentPage(1);
  }, [
    itemCategoryFilter,
    itemPickerPageSize,
    itemPickerSortMode,
    itemPickerViewMode,
    itemSearch,
  ]);

  useEffect(() => {
    if (!pickerModalOpen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [pickerModalOpen]);

  useEffect(() => {
    if (!orderTypeDropdownOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const eventTarget = event.target;
      if (
        eventTarget instanceof Node &&
        orderTypeDropdownRef.current?.contains(eventTarget)
      ) {
        return;
      }
      setOrderTypeDropdownOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOrderTypeDropdownOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [orderTypeDropdownOpen]);

  const handleOrderTypeSelect = (nextOrderType: DesktopSaleType): void => {
    setOrderType(nextOrderType);
    setOrderTypeDropdownOpen(false);
  };

  const showInfo = (nextMessage: string): void => {
    setMessage(nextMessage);
    desktopUi.showToast({ message: nextMessage, tone: "info" });
  };

  const showSuccess = (nextMessage: string): void => {
    setMessage(nextMessage);
    desktopUi.showToast({ message: nextMessage, tone: "success" });
  };

  const showWarning = (nextMessage: string): void => {
    setMessage(nextMessage);
    desktopUi.showToast({
      message: nextMessage,
      tone: "warning",
      durationMs: 3200,
    });
  };

  const showError = (nextMessage: string): void => {
    setMessage(nextMessage);
    desktopUi.showToast({
      message: nextMessage,
      tone: "error",
      durationMs: 4200,
    });
  };

  const openCustomerPicker = (): void => {
    setCustomerSearch("");
    setCustomerModalOpen(true);
  };

  const openPersonnelPicker = (): void => {
    setPersonnelSearch("");
    setPersonnelModalOpen(true);
  };

  const openHelperPicker = (): void => {
    setHelperSearch("");
    setHelperModalOpen(true);
  };

  const openItemPicker = (): void => {
    setItemSearch("");
    setItemCategoryFilter("ALL");
    setItemModalOpen(true);
  };

  const closeSaleSuccessModal = (): void => {
    setSaleSuccessModal(null);
  };

  const filteredCustomers = useMemo(() => {
    const term = sanitizeSearchTerm(customerSearch);
    if (!term) {
      return customers;
    }
    return customers.filter(
      (customer) =>
        customer.label.toLowerCase().includes(term) ||
        (customer.subtitle ?? "").toLowerCase().includes(term) ||
        (customer.address ?? "").toLowerCase().includes(term),
    );
  }, [customerSearch, customers]);

  const closeCreateCustomerModal = (): void => {
    if (createCustomerSaving) {
      return;
    }
    setCreateCustomerModalOpen(false);
    setCreateCustomerName("");
    setCreateCustomerAddress("");
    setCreateCustomerContactNumber("");
    setCreateCustomerGas("");
    setCreateCustomerProvince("");
    setCreateCustomerCity("");
  };

  const handleCreateOfflineCustomer = async (): Promise<void> => {
    const name = createCustomerName.trim();
    if (!name) {
      showError("Customer name is required.");
      return;
    }
    setCreateCustomerSaving(true);
    try {
      const createdId = await desktopMasterDataService.createOfflineCustomer({
        name,
        address: createCustomerAddress.trim() || null,
        contactNumber: createCustomerContactNumber.trim() || null,
        gas: createCustomerGas.trim() || null,
        province: createCustomerProvince.trim() || null,
        city: createCustomerCity.trim() || null,
      });
      const customerRows = await desktopMasterDataService.loadCustomers();
      setCustomers(customerRows);
      setSelectedCustomerId(createdId);
      setCustomerSearch("");
      setCreateCustomerModalOpen(false);
      setCreateCustomerName("");
      setCreateCustomerAddress("");
      setCreateCustomerContactNumber("");
      setCreateCustomerGas("");
      setCreateCustomerProvince("");
      setCreateCustomerCity("");
      setCustomerModalOpen(false);
      showSuccess(`${name} was saved locally and is ready for this sale.`);
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : "Unable to save customer locally.",
      );
    } finally {
      setCreateCustomerSaving(false);
    }
  };

  const filteredPersonnels = useMemo(() => {
    const term = personnelSearch.trim().toLowerCase();
    const rows = personnels.filter(
      (personnel) => personnel.id !== selectedHelperId,
    );
    if (!term) {
      return rows;
    }
    return rows.filter(
      (personnel) =>
        personnel.label.toLowerCase().includes(term) ||
        (personnel.subtitle ?? "").toLowerCase().includes(term),
    );
  }, [personnelSearch, personnels, selectedHelperId]);

  const filteredHelpers = useMemo(() => {
    const term = helperSearch.trim().toLowerCase();
    const rows = personnels.filter(
      (personnel) => personnel.id !== selectedPersonnelId,
    );
    if (!term) {
      return rows;
    }
    return rows.filter(
      (personnel) =>
        personnel.label.toLowerCase().includes(term) ||
        (personnel.subtitle ?? "").toLowerCase().includes(term),
    );
  }, [helperSearch, personnels, selectedPersonnelId]);

  const itemCategoryOptions = useMemo(() => {
    const next = new Set<string>();
    for (const product of catalog) {
      if (product.category.trim()) {
        next.add(product.category.trim());
      }
    }
    return ["ALL", ...Array.from(next).sort((a, b) => a.localeCompare(b))];
  }, [catalog]);

  const filteredProducts = useMemo(() => {
    const term = sanitizeSearchTerm(itemSearch);
    return catalog.filter((product) => {
      const matchesCategory =
        itemCategoryFilter === "ALL" || product.category === itemCategoryFilter;
      if (!matchesCategory) {
        return false;
      }
      return productMatchesItemSearch(product, term);
    });
  }, [catalog, itemCategoryFilter, itemSearch]);

  const itemDirectoryCategoryFilters = useMemo(() => {
    const term = sanitizeSearchTerm(itemSearch);
    return itemCategoryOptions.map((category) => {
      const count = catalog.filter((product) => {
        const matchesCategory =
          category === "ALL" || product.category === category;
        return matchesCategory && productMatchesItemSearch(product, term);
      }).length;
      return {
        id: category,
        label: itemPickerCategoryLabel(category),
        count,
      };
    });
  }, [catalog, itemCategoryOptions, itemSearch]);

  const sortedItemDirectoryProducts = useMemo(() => {
    return [...filteredProducts].sort((left, right) => {
      if (itemPickerSortMode === "SKU_ASC") {
        return left.sku.localeCompare(right.sku, undefined, { numeric: true });
      }
      if (itemPickerSortMode === "PRICE_ASC") {
        return left.unitPrice - right.unitPrice || left.name.localeCompare(right.name);
      }
      if (itemPickerSortMode === "PRICE_DESC") {
        return right.unitPrice - left.unitPrice || left.name.localeCompare(right.name);
      }
      if (itemPickerSortMode === "STOCK_DESC") {
        return (
          resolveAvailableQty(right) - resolveAvailableQty(left) ||
          left.name.localeCompare(right.name)
        );
      }
      return left.name.localeCompare(right.name);
    });
  }, [filteredProducts, itemPickerSortMode]);

  const itemDirectoryTotalPages = Math.max(
    1,
    Math.ceil(sortedItemDirectoryProducts.length / itemPickerPageSize),
  );
  const itemDirectoryCurrentPage = Math.min(
    itemPickerCurrentPage,
    itemDirectoryTotalPages,
  );
  const itemDirectoryStartIndex =
    (itemDirectoryCurrentPage - 1) * itemPickerPageSize;
  const itemDirectoryPageProducts = sortedItemDirectoryProducts.slice(
    itemDirectoryStartIndex,
    itemDirectoryStartIndex + itemPickerPageSize,
  );
  const itemDirectoryPageButtons = buildQueueOrderPageButtons(
    itemDirectoryCurrentPage,
    itemDirectoryTotalPages,
  );

  const filteredHeldCarts = useMemo(() => {
    return filterQueueOrdersByAddress(
      heldCarts,
      {
        search: heldCartSearch,
        province: queueOrderFilteringAddonEnabled
          ? heldCartProvinceFilter
          : "ALL",
        city: queueOrderFilteringAddonEnabled ? heldCartCityFilter : "ALL",
      },
      customers,
    );
  }, [
    customers,
    heldCartCityFilter,
    heldCartProvinceFilter,
    heldCartSearch,
    heldCarts,
    queueOrderFilteringAddonEnabled,
  ]);

  const sortedHeldCarts = useMemo(() => {
    const rows = [...filteredHeldCarts];
    rows.sort((left, right) => {
      const leftTotal = getHeldCartTotal(left);
      const rightTotal = getHeldCartTotal(right);
      const leftTime = new Date(left.updatedAt).getTime();
      const rightTime = new Date(right.updatedAt).getTime();

      if (heldCartSortMode === "queue-time-oldest") {
        return leftTime - rightTime;
      }
      if (heldCartSortMode === "amount-high-low") {
        return rightTotal - leftTotal || rightTime - leftTime;
      }
      if (heldCartSortMode === "amount-low-high") {
        return leftTotal - rightTotal || rightTime - leftTime;
      }
      return rightTime - leftTime;
    });
    return rows;
  }, [filteredHeldCarts, heldCartSortMode]);

  const totalHeldCartPages = Math.max(
    1,
    Math.ceil(sortedHeldCarts.length / heldCartPageSize),
  );
  useEffect(() => {
    setHeldCartCurrentPage((page) => Math.min(page, totalHeldCartPages));
  }, [totalHeldCartPages]);
  const safeHeldCartPage = Math.min(heldCartCurrentPage, totalHeldCartPages);
  const pageStartIndex = (safeHeldCartPage - 1) * heldCartPageSize;
  const pagedHeldCarts = useMemo(
    () => sortedHeldCarts.slice(pageStartIndex, pageStartIndex + heldCartPageSize),
    [heldCartPageSize, pageStartIndex, sortedHeldCarts],
  );
  const visibleHeldCartPageButtons = useMemo(
    () => buildQueueOrderPageButtons(safeHeldCartPage, totalHeldCartPages),
    [safeHeldCartPage, totalHeldCartPages],
  );
  const { provinceOptions: heldCartProvinceOptions, cityOptions: heldCartCityOptions } =
    useMemo(
      () =>
        buildQueueOrderAddressOptions(
          heldCarts,
          customers,
          queueOrderFilteringAddonEnabled ? heldCartProvinceFilter : "ALL",
        ),
      [
        customers,
        heldCarts,
        heldCartProvinceFilter,
        queueOrderFilteringAddonEnabled,
      ],
    );

  const selectedCustomer = useMemo(
    () =>
      customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );
  const currentPointsBalance = selectedCustomer?.pointsBalance ?? 0;
  const selectedPersonnel = useMemo(
    () =>
      personnels.find((personnel) => personnel.id === selectedPersonnelId) ??
      null,
    [personnels, selectedPersonnelId],
  );
  const selectedHelper = useMemo(
    () =>
      personnels.find((personnel) => personnel.id === selectedHelperId) ?? null,
    [personnels, selectedHelperId],
  );

  const resolveUnitPrice = (
    product: DesktopCatalogProduct,
    customer: DesktopOption | null,
    flowMode?: DesktopCylinderFlowSelection | null,
  ): number => {
    const branchId = appState.setup.branchId?.trim();
    if (!branchId) {
      return product.unitPrice;
    }
    const resolved = resolveLocalPrice({
      productId: product.id,
      baseUnitPrice: product.unitPrice,
      branchId,
      customer,
      priceLists,
      allowCustomPricing,
      atIso: new Date().toISOString(),
      flowMode,
    });
    return resolved === null ? product.unitPrice : resolved;
  };

  const applyCustomerPricingToCatalog = (
    baseCatalog: DesktopCatalogProduct[],
    customer: DesktopOption | null,
  ): DesktopCatalogProduct[] =>
    baseCatalog.map((product) => ({
      ...product,
      unitPrice: resolveUnitPrice(
        product,
        customer,
        product.isLpg && appState.setup.posDefaultLpgFlow !== "NONE"
          ? appState.setup.posDefaultLpgFlow
          : null,
      ),
    }));

  const resolveProjectedProduct = (
    product: DesktopCatalogProduct,
  ): DesktopCatalogProduct => {
    const projected = projectedInventoryByProduct.get(product.id);
    if (!projected) {
      return product;
    }
    return {
      ...product,
      qtyOnHand: product.isLpg
        ? Number((projected.qtyFull + projected.qtyEmpty).toFixed(4))
        : projected.qtyOnHand,
      qtyFull: projected.qtyFull,
      qtyEmpty: projected.qtyEmpty,
    };
  };
  const resolveAvailableForLine = (product: DesktopCatalogProduct): number =>
    resolveAvailableQty(resolveProjectedProduct(product));

  const selectedReward = useMemo(
    () =>
      availableRewards.find((reward) => reward.id === selectedRewardId) ?? null,
    [availableRewards, selectedRewardId],
  );
  const subtotal = useMemo(
    () =>
      Number(
        cart
          .reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
          .toFixed(2),
      ),
    [cart],
  );
  const discount = Math.min(
    subtotal,
    parseNonNegativeDecimalInput(discountAmount),
  );
  const deliveryFeeValue = useMemo(() => {
    if (orderType !== "DELIVERY") {
      return 0;
    }
    return parseNonNegativeDecimalInput(deliveryFee);
  }, [deliveryFee, orderType]);
  const total = Number(
    Math.max(0, subtotal - discount + deliveryFeeValue).toFixed(2),
  );
  const parsedPaidAmount = parseNonNegativeDecimalInput(paidAmount);
  const appliedPaidAmount = useMemo(
    () => Number(Math.max(0, Math.min(parsedPaidAmount, total)).toFixed(2)),
    [parsedPaidAmount, total],
  );
  const changeAmount = useMemo(
    () =>
      Number(
        (paymentMode === "FULL"
          ? Math.max(0, parsedPaidAmount - total)
          : 0
        ).toFixed(2),
      ),
    [parsedPaidAmount, paymentMode, total],
  );
  const creditBalance = useMemo(
    () =>
      Number(
        (paymentMode === "PARTIAL"
          ? Math.max(0, total - appliedPaidAmount)
          : 0
        ).toFixed(2),
      ),
    [appliedPaidAmount, paymentMode, total],
  );
  const amountPrivacyMaskEnabled =
    hideReceiptAmounts && receiptAmountPrivacyAddonEnabled;
  const formatAmountForSummary = (value: number): string =>
    amountPrivacyMaskEnabled ? "*** HIDDEN ***" : fmtMoney(value);
  const rewardBaseAmount = useMemo(
    () => round2(Math.max(0, subtotal - discount) + deliveryFeeValue),
    [subtotal, discount, deliveryFeeValue],
  );
  const rewardEligibleOptions = useMemo(
    () =>
      availableRewards.filter((reward) => {
        if (reward.status !== "ACTIVE") {
          return false;
        }
        if (
          selectedCustomer &&
          reward.pointsCost > (selectedCustomer.pointsBalance ?? 0)
        ) {
          return false;
        }
        if (reward.minSpend !== null && rewardBaseAmount < reward.minSpend) {
          return false;
        }
        if (
          (reward.rewardType === "FREE_PRODUCT" ||
            reward.rewardType === "FREE_REFILL") &&
          resolveRewardCartDiscount(reward, cart) <= 0
        ) {
          return false;
        }
        if (reward.rewardType === "FREE_DELIVERY" && orderType !== "DELIVERY") {
          return false;
        }
        return true;
      }),
    [availableRewards, cart, orderType, rewardBaseAmount, selectedCustomer],
  );
  const rewardItemDiscountValue = useMemo(() => {
    if (!selectedReward) {
      return 0;
    }
    if (selectedReward.rewardType === "DISCOUNT_FIXED") {
      return round2(
        Math.min(
          selectedReward.discountValue ?? 0,
          Math.max(0, subtotal - discount),
        ),
      );
    }
    if (selectedReward.rewardType === "DISCOUNT_PERCENT") {
      return round2(
        Math.max(0, subtotal - discount) *
          ((selectedReward.discountValue ?? 0) / 100),
      );
    }
    if (
      selectedReward.rewardType === "FREE_PRODUCT" ||
      selectedReward.rewardType === "FREE_REFILL"
    ) {
      return resolveRewardCartDiscount(selectedReward, cart);
    }
    return 0;
  }, [cart, discount, selectedReward, subtotal]);
  const rewardDeliveryDiscountValue = useMemo(() => {
    if (!selectedReward || selectedReward.rewardType !== "FREE_DELIVERY") {
      return 0;
    }
    return deliveryFeeValue;
  }, [deliveryFeeValue, selectedReward]);
  const totalRewardValue = useMemo(
    () => round2(rewardItemDiscountValue + rewardDeliveryDiscountValue),
    [rewardDeliveryDiscountValue, rewardItemDiscountValue],
  );
  const cartWarnings = useMemo(
    () =>
      cart
        .map((line) => {
          const available = resolveAvailableForLine(line);
          if (line.quantity > available + 0.0001) {
            return `${line.name} only has ${available.toFixed(2)} available.`;
          }
          return null;
        })
        .filter((value): value is string => Boolean(value)),
    [cart],
  );
  const paymentReady = useMemo(() => {
    if (paymentMode === "FULL") {
      return parsedPaidAmount + 0.0001 >= total;
    }
    return parsedPaidAmount >= 0 && parsedPaidAmount < total;
  }, [parsedPaidAmount, paymentMode, total]);
  const paymentHint = useMemo(() => {
    const modeHint =
      paymentMode === "FULL"
        ? "Full payment: amount tendered can be equal to or higher than total. Change is calculated automatically."
        : "Partial payment: collect any amount lower than the total. The remaining balance becomes customer credit.";
    const orderHint =
      orderType === "DELIVERY"
        ? `Delivery sale: assign the field personnel first so this order stays linked to ${selectedPersonnel?.label ?? "the delivery team"}.`
        : "Pickup sale: cashier can complete this order at the counter once payment is ready.";
    return `${modeHint} ${orderHint}`;
  }, [orderType, paymentMode, selectedPersonnel?.label]);
  const endDayDenominationRows = useMemo(
    () =>
      openingCashDenominationOptions.map((denomination) => {
        const raw = endDayDenominationCounts[String(denomination)] ?? "";
        const parsed = Number.parseInt(raw, 10);
        const quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        return {
          denomination,
          quantity,
          total: Number((quantity * denomination).toFixed(2)),
        };
      }),
    [endDayDenominationCounts],
  );
  const endDayDenominationTotal = useMemo(
    () =>
      Number(
        endDayDenominationRows
          .reduce((sum, row) => sum + row.total, 0)
          .toFixed(2),
      ),
    [endDayDenominationRows],
  );
  const endDayCashAmount =
    endDayCashEntryMode === "DENOMINATION"
      ? endDayDenominationTotal
      : parseCashInput(endDayCash);
  const endDayDenominationActiveLines = useMemo(
    () => endDayDenominationRows.filter((row) => row.quantity > 0).length,
    [endDayDenominationRows],
  );
  const endDayDenominationPieces = useMemo(
    () => endDayDenominationRows.reduce((sum, row) => sum + row.quantity, 0),
    [endDayDenominationRows],
  );
  const endDayVariance = useMemo(() => {
    const expected = endDaySnapshot?.expectedCash ?? 0;
    const counted = endDayCashAmount;
    return Number((counted - expected).toFixed(2));
  }, [endDayCashAmount, endDaySnapshot?.expectedCash]);

  const refreshHeldCarts = async (): Promise<void> => {
    const rows = await desktopHeldCartService.listHeldCarts();
    setHeldCarts(rows);
  };

  const refreshCatalog = async (): Promise<void> => {
    if (!appState.setup.locationId) {
      setCatalogBase([]);
      setCatalog([]);
      setPriceLists([]);
      setAllowCustomPricing(false);
      setDeliveryDispatchAddonEnabled(false);
      setPurchaseOrderAddonEnabled(false);
      setQueueOrderFilteringAddonEnabled(false);
      setProjectedInventoryByProduct(new Map());
      setCustomers([]);
      setPersonnels([]);
      setActiveShiftId(null);
      return;
    }

    setLoadingCatalog(true);
    try {
      const [
        catalogRows,
        customerRows,
        personnelRows,
        activeShift,
        projectedInventory,
        tenantAddons,
        priceListRows,
      ] = await Promise.all([
        desktopMasterDataService.loadCatalog(appState.setup.locationId),
        desktopMasterDataService.loadCustomers(),
        desktopMasterDataService.loadPersonnelOptions(),
        desktopShiftService.findActiveShift(),
        desktopStockProjectionService.loadProjectedInventoryByProduct(
          appState.setup.locationId,
        ),
        desktopMasterDataService.loadTenantAddons(),
        desktopDb.listMasterData("price_list"),
      ]);
      const nextPriceLists = parsePriceLists(priceListRows);
      const nextAllowCustomPricing = tenantAddons.custom_pricing === true;
      const selectedCustomer =
        customerRows.find((customer) => customer.id === selectedCustomerId) ??
        null;
      const nextBaseCatalog = catalogRows.map((product) => {
        const projected = projectedInventory.get(product.id);
        return projected
          ? {
              ...product,
              qtyOnHand: product.isLpg
                ? Number((projected.qtyFull + projected.qtyEmpty).toFixed(4))
                : projected.qtyOnHand,
              qtyFull: projected.qtyFull,
              qtyEmpty: projected.qtyEmpty,
            }
          : product;
      });
      const branchId = appState.setup.branchId?.trim() ?? "";
      const nextCatalog = nextBaseCatalog.map((product) => {
        if (!branchId) {
          return product;
        }
        const resolved = resolveLocalPrice({
          productId: product.id,
          baseUnitPrice: product.unitPrice,
          branchId,
          customer: selectedCustomer,
          priceLists: nextPriceLists,
          allowCustomPricing: nextAllowCustomPricing,
          atIso: new Date().toISOString(),
          flowMode:
            product.isLpg && appState.setup.posDefaultLpgFlow !== "NONE"
              ? appState.setup.posDefaultLpgFlow
              : null,
        });
        return resolved === null
          ? product
          : { ...product, unitPrice: resolved };
      });
      setCatalogBase(nextBaseCatalog);
      setCatalog(nextCatalog);
      setPriceLists(nextPriceLists);
      setAllowCustomPricing(nextAllowCustomPricing);
      setDeliveryDispatchAddonEnabled(
        tenantAddons.delivery_dispatch_suite === true,
      );
      setPurchaseOrderAddonEnabled(tenantAddons.purchase_order_suite === true);
      setQueueOrderFilteringAddonEnabled(
        tenantAddons.queue_order_filtering === true,
      );
      setProjectedInventoryByProduct(projectedInventory);
      setCustomers(customerRows);
      setPersonnels(personnelRows);
      setActiveShiftId(activeShift?.id ?? null);
      setCart((prev) =>
        prev.map((line) => {
          const match = nextCatalog.find((entry) => entry.id === line.id);
          const baseMatch = nextBaseCatalog.find((entry) => entry.id === line.id);
          return match
            ? {
                ...line,
                unitPrice:
                  resolveLocalPrice({
                    productId: line.id,
                    baseUnitPrice: baseMatch?.unitPrice ?? line.unitPrice,
                    branchId,
                    customer: selectedCustomer,
                    priceLists: nextPriceLists,
                    allowCustomPricing: nextAllowCustomPricing,
                    atIso: new Date().toISOString(),
                    flowMode: line.isLpg ? (line.cylinderFlow ?? null) : null,
                  }) ?? line.unitPrice,
                qtyOnHand: match.qtyOnHand,
                qtyFull: match.qtyFull,
                qtyEmpty: match.qtyEmpty,
                pickupCommissionRate: match.pickupCommissionRate ?? 0,
                deliveryCommissionRate: match.deliveryCommissionRate ?? 0,
              }
            : line;
        }),
      );
      if (nextCatalog.length === 0) {
        showWarning(
          "No local products were found for this location yet. Download branch data in Settings first.",
        );
      }
    } finally {
      setLoadingCatalog(false);
    }
  };

  const refreshReceiptAmountPrivacyAddon = async (): Promise<void> => {
    if (!appState.auth.accessToken) {
      setReceiptAmountPrivacyAddonEnabled(false);
      setCashierEndOfDayInventoryCountAddonEnabled(
        cachedCashierEndOfDayInventoryCountAddonEnabled,
      );
      setHideReceiptAmounts(false);
      return;
    }
    try {
      const { response, state: nextState } =
        await desktopAuthService.authorizedFetch(
          appState,
          `${appState.setup.apiBaseUrl.replace(/\/$/, "")}/platform/entitlements/current`,
        );
      if (!response.ok) {
        throw new Error(`Unable to load tenant add-ons (${response.status})`);
      }
      const payload = (await response.json()) as CurrentEntitlementResponse;
      await desktopSubscriptionPolicyService.applyRemotePayload(
        payload as Record<string, unknown>,
        undefined,
        "pos_entitlements",
      );
      const enabled = payload?.addons?.receipt_amount_privacy === true;
      const cashierInventoryCountEnabled =
        payload?.addons?.cashier_end_of_day_inventory_count === true;
      if (nextState !== appState) {
        await desktopSettingsService.saveState(nextState);
      }
      setReceiptAmountPrivacyAddonEnabled(enabled);
      setCashierEndOfDayInventoryCountAddonEnabled(
        cashierInventoryCountEnabled,
      );
      if (!enabled) {
        setHideReceiptAmounts(false);
      }
    } catch {
      setReceiptAmountPrivacyAddonEnabled(false);
      setCashierEndOfDayInventoryCountAddonEnabled(
        cachedCashierEndOfDayInventoryCountAddonEnabled,
      );
      setHideReceiptAmounts(false);
    }
  };

  useEffect(() => {
    void refreshHeldCarts();
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [appState.setup.locationId]);

  useEffect(() => {
    void refreshReceiptAmountPrivacyAddon();
  }, [
    appState.auth.accessToken,
    appState.setup.apiBaseUrl,
    cachedCashierEndOfDayInventoryCountAddonEnabled,
  ]);

  useEffect(() => {
    if (catalogBase.length === 0) {
      return;
    }
    const nextCatalog = applyCustomerPricingToCatalog(
      catalogBase,
      selectedCustomer,
    );
    setCatalog(nextCatalog);
    setCart((prev) =>
      prev.map((line) => {
        const baseMatch = catalogBase.find((entry) => entry.id === line.id);
        const catalogMatch = nextCatalog.find((entry) => entry.id === line.id);
        if (!catalogMatch) {
          return line;
        }
        return {
          ...line,
          unitPrice: baseMatch
            ? resolveUnitPrice(
                baseMatch,
                selectedCustomer,
                line.isLpg ? (line.cylinderFlow ?? null) : null,
              )
            : line.unitPrice,
          qtyOnHand: catalogMatch.qtyOnHand,
          qtyFull: catalogMatch.qtyFull,
          qtyEmpty: catalogMatch.qtyEmpty,
        };
      }),
    );
  }, [
    allowCustomPricing,
    appState.setup.posDefaultLpgFlow,
    catalogBase,
    priceLists,
    selectedCustomer,
  ]);

  useEffect(() => {
    if (saving) {
      desktopUi.setLoading({
        visible: true,
        label:
          endDayModalOpen || endDayInventoryModalOpen
            ? "Ending day..."
            : "Saving sale...",
      });
      return;
    }
    if (loadingCatalog) {
      desktopUi.setLoading({
        visible: true,
        label: "Refreshing local products...",
      });
      return;
    }
    if (paymentModalOpen && rewardsLoading) {
      desktopUi.setLoading({ visible: true, label: "Loading rewards..." });
      return;
    }
    desktopUi.clearLoading();
  }, [
    desktopUi,
    endDayModalOpen,
    loadingCatalog,
    paymentModalOpen,
    rewardsLoading,
    saving,
  ]);

  useEffect(() => {
    if (
      !paymentModalOpen ||
      !selectedCustomerId ||
      !appState.setup.branchId ||
      !appState.setup.locationId ||
      !appState.auth.accessToken
    ) {
      setAvailableRewards([]);
      setSelectedRewardId("");
      return;
    }

    let active = true;
    void (async () => {
      setRewardsLoading(true);
      try {
        const { response, state: nextState } =
          await desktopAuthService.authorizedFetch(
            appState,
            `${appState.setup.apiBaseUrl.replace(/\/$/, "")}/vcard/rewards?status=ACTIVE&branch_id=${encodeURIComponent(appState.setup.branchId)}&location_id=${encodeURIComponent(appState.setup.locationId)}&limit=100`,
          );
        if (!response.ok) {
          throw new Error(`Unable to load rewards (${response.status})`);
        }
        const rows = (await response.json()) as Array<Record<string, unknown>>;
        const parsed = rows
          .map((row) => toRewardRecord(row))
          .filter((row): row is DesktopPosRewardRecord => Boolean(row));
        if (!active) {
          return;
        }
        if (nextState !== appState) {
          await desktopSettingsService.saveState(nextState);
        }
        setAvailableRewards(parsed);
      } catch (error) {
        if (active) {
          setAvailableRewards([]);
          showError(
            error instanceof Error
              ? error.message
              : "Rewards are unavailable right now.",
          );
        }
      } finally {
        if (active) {
          setRewardsLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [
    appState,
    appState.auth.accessToken,
    appState.setup.apiBaseUrl,
    appState.setup.branchId,
    appState.setup.locationId,
    paymentModalOpen,
    selectedCustomerId,
  ]);

  useEffect(() => {
    if (
      !rewardEligibleOptions.some((reward) => reward.id === selectedRewardId)
    ) {
      setSelectedRewardId("");
    }
  }, [rewardEligibleOptions, selectedRewardId]);

  useEffect(() => {
    if (
      !receiptAmountPrivacyAddonEnabled ||
      paymentMode === "PARTIAL" ||
      creditBalance > 0.0001
    ) {
      setHideReceiptAmounts(false);
    }
  }, [receiptAmountPrivacyAddonEnabled, paymentMode, creditBalance]);

  useEffect(() => {
    if (!queueOrderFilteringAddonEnabled) {
      setHeldCartProvinceFilter("ALL");
      setHeldCartCityFilter("ALL");
    }
  }, [queueOrderFilteringAddonEnabled]);

  useEffect(() => {
    if (heldCartModalOpen) {
      setHeldCartCurrentPage(1);
    }
  }, [heldCartModalOpen]);

  useEffect(() => {
    if (!reopenedSale) {
      return;
    }
    if (lastAppliedReopenNonce === reopenedSaleNonce) {
      return;
    }
    setLastAppliedReopenNonce(reopenedSaleNonce);

    const cartLines: CartLine[] = reopenedSale.payload.lines.map((line) => {
      const match = catalog.find((product) => product.id === line.productId);
      return {
        ...(match ?? {
          id: line.productId,
          sku: line.productId,
          name: line.productName,
          category: "Reopened Sale",
          unit: "unit",
          unitPrice: line.unitPrice,
          qtyOnHand: 0,
          qtyFull: 0,
          qtyEmpty: 0,
          isLpg: false,
        }),
        lineId: line.lineId ?? makeCartLineId(),
        quantity: Math.max(1, normalizeWholeQuantity(line.quantity)),
        unitPrice: line.unitPrice,
        cylinderFlow:
          (match?.isLpg ?? false) ? (line.cylinderFlow ?? null) : null,
      };
    });

    setCart(cartLines);
    setSelectedCustomerId(reopenedSale.payload.customerId ?? "");
    setSelectedPersonnelId(reopenedSale.payload.personnelId ?? "");
    setSelectedHelperId(reopenedSale.payload.helperId ?? "");
    setOrderType(reopenedSale.payload.saleType);
    setPaymentMode(reopenedSale.payload.paymentMode ?? "FULL");
    setPaymentMethod(reopenedSale.payload.paymentMethod);
    setHideReceiptAmounts(reopenedSale.payload.hideAmounts === true);
    setPaidAmount(
      String(
        reopenedSale.payload.paidAmount ??
          (reopenedSale.payload.paymentMode === "PARTIAL"
            ? Math.max(
                0,
                reopenedSale.payload.totalAmount -
                  (reopenedSale.payload.creditBalance ?? 0),
              )
            : reopenedSale.payload.totalAmount),
      ),
    );
    setRecreatedFromSaleId(
      reopenedSaleMode === "recreate"
        ? reopenedSale.id
        : (reopenedSale.payload.recreatedFromSaleId ?? null),
    );
    setDiscountAmount(String(reopenedSale.payload.discountAmount ?? 0));
    setDeliveryFee(String(reopenedSale.payload.deliveryFee ?? 0));
    setNotes(
      [
        reopenedSale.payload.notes,
        reopenedSaleMode === "recreate"
          ? `Recreated from ${reopenedSale.receiptNumber}`
          : `Reopened from ${reopenedSale.receiptNumber}`,
      ]
        .filter(Boolean)
        .join(" | "),
    );
    setPersonnelModalOpen(false);
    setHelperModalOpen(false);
    setCustomerModalOpen(false);
    setItemModalOpen(false);
    setPaymentModalOpen(false);
    showInfo(
      reopenedSaleMode === "recreate"
        ? `Loaded ${reopenedSale.receiptNumber} into POS as a replacement sale. Review and save when ready.`
        : `Loaded ${reopenedSale.receiptNumber} back into POS. Review and save when ready.`,
    );
    onConsumeReopenedSale?.();
  }, [
    catalog,
    lastAppliedReopenNonce,
    onConsumeReopenedSale,
    reopenedSale,
    reopenedSaleMode,
    reopenedSaleNonce,
  ]);

  const resetCheckoutForm = (): void => {
    setCart([]);
    setSelectedCustomerId("");
    setCustomerSearch("");
    setSelectedPersonnelId("");
    setPersonnelSearch("");
    setSelectedHelperId("");
    setHelperSearch("");
    setItemSearch("");
    setHeldCartSearch("");
    setItemCategoryFilter("ALL");
    setNotes("");
    setDiscountAmount("0");
    setDeliveryFee("0");
    setPaymentMode("FULL");
    setPaymentMethod("CASH");
    setPaidAmount("0");
    setHideReceiptAmounts(false);
    setSelectedRewardId("");
    setAvailableRewards([]);
    setRecreatedFromSaleId(null);
    setHoldLabel("");
    setOrderType("PICKUP");
    setQueuePreviewOpen(false);
    setClearOrderConfirmOpen(false);
    setPaymentModalOpen(false);
  };

  const addToCart = (product: DesktopCatalogProduct): void => {
    const available = normalizeWholeQuantity(resolveAvailableForLine(product));
    const defaultFlow =
      product.isLpg && appState.setup.posDefaultLpgFlow !== "NONE"
        ? appState.setup.posDefaultLpgFlow
        : null;
    if (available <= 0.0001) {
      showWarning(`${product.name} has no available stock right now.`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((line) =>
        product.isLpg
          ? line.id === product.id &&
            (line.cylinderFlow ?? null) === defaultFlow
          : line.id === product.id,
      );
      if (!existing) {
        return [
          ...prev,
          {
            ...resolveProjectedProduct(product),
            lineId: makeCartLineId(),
            quantity: 1,
            cylinderFlow: defaultFlow,
          },
        ];
      }
      if (existing.quantity + 1 > available + 0.0001) {
        showWarning(`${product.name} only has ${available} available.`);
        return prev;
      }
      return prev.map((line) =>
        line.lineId === existing.lineId
          ? { ...line, quantity: line.quantity + 1 }
          : line,
      );
    });
  };

  const updateQuantity = (lineId: string, nextQuantity: number): void => {
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.lineId !== lineId) {
            return line;
          }
          const available = normalizeWholeQuantity(
            resolveAvailableForLine(line),
          );
          const requested = normalizeWholeQuantity(nextQuantity);
          const capped = Math.min(requested, available);
          if (requested > available) {
            showWarning(`${line.name} only has ${available} available.`);
          }
          return { ...line, quantity: capped };
        })
        .filter((line) => line.quantity > 0),
    );
  };

  const setLineCylinderFlow = (
    lineId: string,
    nextFlow: DesktopCylinderFlowSelection,
  ): void => {
    setCart((prev) => {
      const current = prev.find((line) => line.lineId === lineId);
      if (!current || !current.isLpg || current.cylinderFlow === nextFlow) {
        return prev;
      }
      const baseProduct =
        catalogBase.find((entry) => entry.id === current.id) ?? current;
      const nextUnitPrice = resolveUnitPrice(
        baseProduct,
        selectedCustomer,
        nextFlow,
      );

      const duplicate = prev.find(
        (line) =>
          line.lineId !== lineId &&
          line.id === current.id &&
          line.isLpg &&
          line.cylinderFlow === nextFlow,
      );

      if (!duplicate) {
        return prev.map((line) =>
          line.lineId === lineId
            ? {
                ...line,
                cylinderFlow: nextFlow,
                unitPrice: nextUnitPrice,
              }
            : line,
        );
      }

      return prev
        .map((line) => {
          if (line.lineId === duplicate.lineId) {
            const duplicateBase =
              catalogBase.find((entry) => entry.id === line.id) ?? line;
            return {
              ...line,
              quantity: line.quantity + current.quantity,
              unitPrice: resolveUnitPrice(
                duplicateBase,
                selectedCustomer,
                nextFlow,
              ),
            };
          }
          return line;
        })
        .filter((line) => line.lineId !== lineId);
    });
  };

  useEffect(() => {
    if (!quickAddProductId) {
      return;
    }
    const product = catalog.find((entry) => entry.id === quickAddProductId);
    if (!product) {
      showWarning(
        "That item is not in the local branch catalog yet. Refresh branch data first.",
      );
      return;
    }
    addToCart(product);
    showSuccess(`${product.name} was added to the POS cart.`);
  }, [catalog, quickAddNonce, quickAddProductId]);

  useEffect(() => {
    if (paymentMode === "PARTIAL" && Number(paidAmount || "0") > total) {
      setPaidAmount(total.toFixed(2));
    }
  }, [paidAmount, paymentMode, total]);

  const handleSelectReward = (reward: DesktopPosRewardRecord): void => {
    setSelectedRewardId(reward.id);
    if (
      reward.rewardType === "DISCOUNT_FIXED" &&
      Number(discountAmount || "0") <= 0 &&
      reward.discountValue !== null
    ) {
      setDiscountAmount(reward.discountValue.toFixed(2));
      return;
    }
    if (
      reward.rewardType === "DISCOUNT_PERCENT" &&
      Number(discountAmount || "0") <= 0 &&
      reward.discountValue !== null
    ) {
      const suggested = round2(rewardBaseAmount * (reward.discountValue / 100));
      setDiscountAmount(suggested.toFixed(2));
      return;
    }
    if (
      reward.rewardType === "FREE_DELIVERY" &&
      orderType === "DELIVERY" &&
      deliveryFeeValue > 0
    ) {
      setDeliveryFee("0.00");
      return;
    }
    if (
      (reward.rewardType === "FREE_PRODUCT" ||
        reward.rewardType === "FREE_REFILL") &&
      Number(discountAmount || "0") <= 0
    ) {
      const suggested = resolveRewardCartDiscount(reward, cart);
      if (suggested > 0) {
        setDiscountAmount(suggested.toFixed(2));
      }
    }
  };

  const handleCustomerSelect = (customerId: string): void => {
    setSelectedCustomerId(customerId);
    setCustomerModalOpen(false);
    showSuccess(
      customerId ? "Customer updated for this sale." : "Customer cleared.",
    );
  };

  const handlePersonnelSelect = (personnelId: string): void => {
    setSelectedPersonnelId(personnelId);
    setPersonnelModalOpen(false);
  };

  const handleHelperSelect = (helperId: string): void => {
    setSelectedHelperId(helperId);
    setHelperModalOpen(false);
  };

  const lpgFlowSummary = useMemo(
    () => ({
      refill: cart.filter(
        (line) => line.isLpg && line.cylinderFlow === "REFILL_EXCHANGE",
      ).length,
      nonRefill: cart.filter(
        (line) => line.isLpg && line.cylinderFlow === "NON_REFILL",
      ).length,
    }),
    [cart],
  );
  const missingFlowCount = useMemo(
    () => cart.filter((line) => line.isLpg && !line.cylinderFlow).length,
    [cart],
  );
  const checkoutStatusLabel = useMemo(() => {
    if (!activeShiftId) {
      return "Shift required";
    }
    if (!cart.length) {
      return "Waiting for items";
    }
    if (!selectedCustomerId || !selectedPersonnelId) {
      return "Needs customer and personnel";
    }
    if (missingFlowCount > 0) {
      return "Needs LPG flow";
    }
    if (cartWarnings.length > 0) {
      return "Needs stock review";
    }
    return "Ready for payment";
  }, [
    activeShiftId,
    cart.length,
    cartWarnings.length,
    missingFlowCount,
    selectedCustomerId,
    selectedPersonnelId,
  ]);

  const checkoutSetupReady = checkoutStatusLabel === "Ready for payment";
  const checkoutSetupTitle = checkoutSetupReady
    ? "Setup complete"
    : "Setup pending";
  const checkoutSetupDescription = !activeShiftId
    ? "Open a shift first, then continue with customer and crew."
    : checkoutSetupReady
      ? "All required information is set."
      : "Review customer, personnel, helper, and order type before payment.";
  const compactCheckoutSetupNote = !activeShiftId
    ? "Open a shift before checkout."
    : checkoutSetupReady
      ? "Setup is ready for payment."
      : "";
  const totalQuantity = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity, 0),
    [cart],
  );
  const refillQuantity = useMemo(
    () =>
      cart
        .filter((line) => line.isLpg && line.cylinderFlow === "REFILL_EXCHANGE")
        .reduce((sum, line) => sum + line.quantity, 0),
    [cart],
  );
  const nonRefillQuantity = useMemo(
    () =>
      cart
        .filter((line) => line.isLpg && line.cylinderFlow === "NON_REFILL")
        .reduce((sum, line) => sum + line.quantity, 0),
    [cart],
  );
  const compactCategoryOptions = useMemo(() => {
    const visible = itemCategoryOptions.slice(0, 5);
    if (visible.includes(itemCategoryFilter)) {
      return visible;
    }
    return [
      itemCategoryFilter,
      ...visible.filter((category) => category !== itemCategoryFilter),
    ].slice(0, 5);
  }, [itemCategoryFilter, itemCategoryOptions]);
  const compactVisibleProducts = useMemo(
    () => filteredProducts,
    [filteredProducts],
  );
  const compactShowsCylinderStock = useMemo(
    () => compactVisibleProducts.some((product) => hasCylinderStock(product)),
    [compactVisibleProducts],
  );
  const compactVisibleCartLines = useMemo(() => cart, [cart]);

  const hasDraftToClear = useMemo(() => {
    if (cart.length > 0) {
      return true;
    }
    if (selectedCustomerId || selectedPersonnelId || selectedHelperId) {
      return true;
    }
    if (notes.trim().length > 0) {
      return true;
    }
    if (recreatedFromSaleId) {
      return true;
    }
    if (
      orderType !== "PICKUP" ||
      paymentMode !== "FULL" ||
      paymentMethod !== "CASH"
    ) {
      return true;
    }
    if (hideReceiptAmounts || selectedRewardId.trim().length > 0) {
      return true;
    }
    if (
      parseNonNegativeDecimalInput(discountAmount) > 0 ||
      parseNonNegativeDecimalInput(deliveryFee) > 0
    ) {
      return true;
    }
    if (parseNonNegativeDecimalInput(paidAmount) > 0) {
      return true;
    }
    return false;
  }, [
    cart.length,
    selectedCustomerId,
    selectedPersonnelId,
    selectedHelperId,
    notes,
    recreatedFromSaleId,
    orderType,
    paymentMode,
    paymentMethod,
    hideReceiptAmounts,
    selectedRewardId,
    discountAmount,
    deliveryFee,
    paidAmount,
  ]);

  const promptClearCurrentOrder = (): void => {
    if (saving || !hasDraftToClear) {
      return;
    }
    setClearOrderConfirmOpen(true);
  };

  const confirmClearCurrentOrder = (): void => {
    if (saving) {
      return;
    }
    resetCheckoutForm();
    showSuccess("POS order was cleared. You can start a fresh sale.");
  };

  const validateCartBeforePayment = (): string | null => {
    if (!activeShiftId) {
      return "Start Duty in Shift before proceeding to payment.";
    }
    if (!cart.length) {
      return "Add at least one item before proceeding to payment.";
    }
    if (!selectedCustomerId) {
      return "Customer is required before payment.";
    }
    if (!selectedPersonnelId) {
      return "Personnel is required before payment.";
    }
    if (cart.some((line) => line.isLpg && !line.cylinderFlow)) {
      return "Select Refill or Non-Refill for every LPG item before payment.";
    }
    if (cartWarnings.length > 0) {
      return cartWarnings[0];
    }
    for (const line of cart) {
      if (!line.isLpg) {
        continue;
      }
      const projected = resolveProjectedProduct(line);
      if ((projected.qtyFull ?? 0) + 0.0001 < line.quantity) {
        return `${line.name} does not have enough FULL stock for this sale.`;
      }
      if (
        line.cylinderFlow === "NON_REFILL" &&
        (projected.qtyOnHand ?? 0) + 0.0001 < line.quantity
      ) {
        return `${line.name} does not have enough stock for a non-refill sale.`;
      }
    }
    return null;
  };

  const queuePreviewLines = cart.slice(0, 12).map((line) => ({
    id: line.lineId,
    name: line.name,
    qty: Math.max(1, normalizeWholeQuantity(line.quantity)),
    amount: Number((line.quantity * line.unitPrice).toFixed(2)),
    subtitle: line.isLpg
      ? [
          line.cylinderFlow === "REFILL_EXCHANGE"
            ? "Refill"
            : line.cylinderFlow === "NON_REFILL"
              ? "Non-Refill"
              : null,
          formatCylinderSizeLabel(line),
        ]
          .filter(Boolean)
          .join(" | ")
      : formatCylinderSizeLabel(line),
  }));

  const buildHeldCartLabel = (): string => {
    const explicitLabel = holdLabel.trim();
    if (explicitLabel) {
      return explicitLabel;
    }
    const customerLabel = selectedCustomer?.label?.trim();
    if (customerLabel) {
      return `${customerLabel} ${new Date().toLocaleTimeString()}`;
    }
    return `Held Cart ${new Date().toLocaleTimeString()}`;
  };

  const buildHeldCartLineSubtitle = (line: {
    productId: string;
    cylinderFlow?: DesktopCylinderFlowSelection | null;
  }): string | null => {
    const catalogEntry =
      catalog.find((entry) => entry.id === line.productId) ?? null;
    const isLpg = Boolean(catalogEntry?.isLpg || line.cylinderFlow);
    const sizeLabel = formatCylinderSizeLabel({
      isLpg,
      cylinderSizeLabel: catalogEntry?.cylinderSizeLabel ?? null,
    });
    if (!line.cylinderFlow) {
      return sizeLabel;
    }
    return [
      line.cylinderFlow === "REFILL_EXCHANGE" ? "Refill" : "Non-Refill",
      sizeLabel,
    ]
      .filter(Boolean)
      .join(" | ");
  };

  const buildQueueOrderReceiptPayload = ({
    queueId,
    queueLabel,
    createdAt,
    customerName,
    customerAddress,
    saleType,
    paymentMode: queuePaymentMode,
    paymentMethod: queuePaymentMethod,
    paidAmount: queuePaidAmount,
    discountAmount: queueDiscountAmount,
    deliveryFee: queueDeliveryFee,
    notes: queueNotes,
    personnelName,
    helperName,
    lines,
  }: {
    queueId: string;
    queueLabel: string;
    createdAt: string;
    customerName: string | null;
    customerAddress: string | null;
    saleType: DesktopSaleType;
    paymentMode: DesktopPaymentMode;
    paymentMethod: DesktopPaymentMethod;
    paidAmount: number;
    discountAmount: number;
    deliveryFee: number;
    notes: string | null;
    personnelName: string | null;
    helperName: string | null;
    lines: Array<{
      productId?: string | null;
      name: string;
      subtitle?: string | null;
      quantity: number;
      unitPrice: number;
    }>;
  }): DesktopQueueOrderReceiptPayload => {
    const subtotalValue = Number(
      lines
        .reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)
        .toFixed(2),
    );
    return {
      queueId,
      queueLabel,
      branchName: appState.setup.branchLabel,
      locationName: appState.setup.locationLabel,
      cashierName: appState.setup.operatorName || "Operator",
      orderType: saleType,
      customerName,
      customerAddress,
      personnelName,
      helperName,
      lines: lines.map((line) => ({
        productId: line.productId ?? null,
        name: line.name,
        subtitle: line.subtitle ?? null,
        quantity: Math.max(1, normalizeWholeQuantity(line.quantity)),
        unitPrice: line.unitPrice,
      })),
      subtotal: subtotalValue,
      discount: Number(queueDiscountAmount.toFixed(2)),
      total: Number(
        (subtotalValue - queueDiscountAmount + queueDeliveryFee).toFixed(2),
      ),
      paidAmount: Number(queuePaidAmount.toFixed(2)),
      paymentMode: queuePaymentMode,
      paymentMethod: queuePaymentMethod,
      notes: queueNotes,
      createdAt,
    };
  };

  const printQueueOrderReceipt = async (
    payload: DesktopQueueOrderReceiptPayload,
  ): Promise<void> => {
    try {
      await desktopReceiptService.printQueueOrderReceipt(payload, appState);
      showSuccess(`Queue slip ${payload.queueLabel} was sent to the printer.`);
    } catch (cause) {
      showError(
        cause instanceof Error ? cause.message : "Unable to print queue slip.",
      );
    }
  };

  const holdCurrentCart = async (): Promise<void> => {
    if (!cart.length) {
      showWarning("Add items first before holding a cart.");
      return;
    }

    const queueLabel = buildHeldCartLabel();
    const held = await desktopHeldCartService.holdCart({
      label: queueLabel,
      customerId: selectedCustomer?.id ?? null,
      customerName: selectedCustomer?.label ?? null,
      customerProvince: selectedCustomer?.province?.trim() || null,
      customerCity: selectedCustomer?.city?.trim() || null,
      personnelId: selectedPersonnel?.id ?? null,
      personnelName: selectedPersonnel?.label ?? null,
      helperId: selectedHelper?.id ?? null,
      helperName: selectedHelper?.label ?? null,
      saleType: orderType,
      paymentMode,
      paymentMethod,
      paidAmount: Number(parsedPaidAmount.toFixed(2)),
      discountAmount: discount,
      deliveryFee: deliveryFeeValue,
      notes: notes.trim() || null,
      lines: cart.map((line) => ({
        lineId: line.lineId,
        productId: line.id,
        productName: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: Number((line.quantity * line.unitPrice).toFixed(2)),
        cylinderFlow: line.cylinderFlow ?? null,
        pickupCommissionRate: round2(Number(line.pickupCommissionRate || 0)),
        deliveryCommissionRate: round2(Number(line.deliveryCommissionRate || 0)),
      })),
    });

    resetCheckoutForm();
    setQueuePreviewOpen(false);
    await refreshHeldCarts();
    showSuccess(
      `Queue order ${held.label} was saved and is ready to load later.`,
    );
  };

  const promptHoldCurrentCart = (): void => {
    if (!cart.length || saving) {
      return;
    }
    setQueuePreviewOpen(true);
  };

  const recallHeldCart = async (held: DesktopHeldCartRecord): Promise<void> => {
    const cartLines: CartLine[] = held.lines.map((line) => {
      const match = catalog.find((product) => product.id === line.productId);
      return {
        ...(match ?? {
          id: line.productId,
          sku: line.productId,
          name: line.productName,
          category: "Held Cart",
          unit: "unit",
          unitPrice: line.unitPrice,
          qtyOnHand: 0,
          qtyFull: 0,
        qtyEmpty: 0,
        isLpg: false,
        pickupCommissionRate: line.pickupCommissionRate ?? 0,
        deliveryCommissionRate: line.deliveryCommissionRate ?? 0,
      }),
      lineId: line.lineId ?? makeCartLineId(),
      quantity: Math.max(1, normalizeWholeQuantity(line.quantity)),
      unitPrice: line.unitPrice,
      pickupCommissionRate: line.pickupCommissionRate ?? match?.pickupCommissionRate ?? 0,
      deliveryCommissionRate: line.deliveryCommissionRate ?? match?.deliveryCommissionRate ?? 0,
      cylinderFlow:
        (match?.isLpg ?? false) ? (line.cylinderFlow ?? null) : null,
    };
    });

    setCart(cartLines);
    setSelectedCustomerId(held.customerId ?? "");
    setSelectedPersonnelId(held.personnelId ?? "");
    setSelectedHelperId(held.helperId ?? "");
    setOrderType(held.saleType);
    setPaymentMode(held.paymentMode ?? "FULL");
    setPaymentMethod(held.paymentMethod);
    setPaidAmount(String(held.paidAmount ?? 0));
    setDiscountAmount(String(held.discountAmount));
    setDeliveryFee(String(held.deliveryFee ?? 0));
    setSelectedRewardId("");
    setNotes(held.notes ?? "");
    setHoldLabel("");
    setPaymentModalOpen(false);
    void (async () => {
      await desktopHeldCartService.removeHeldCart(held.id);
      await refreshHeldCarts();
    })();
    showSuccess(`Queue order ${held.label} was restored into POS.`);
  };

  const clearEndDayDenominations = (): void => {
    setEndDayDenominationCounts(emptyOpeningDenominationState());
  };

  const resetEndDayFlowState = (): void => {
    setEndDayModalOpen(false);
    setEndDayInventoryModalOpen(false);
    setEndDaySnapshot(null);
    setEndDayInventorySnapshot(null);
    setEndDayInventoryCounts({});
    setEndDayCashEntryMode("DENOMINATION");
    setEndDayCash("0");
    clearEndDayDenominations();
  };

  const addEndDayCashAmount = (value: string): void => {
    const next = Number((parseCashInput(endDayCash) + parseCashInput(value)).toFixed(2));
    setEndDayCash(String(next));
  };

  const selectEndDayCashMode = (mode: CashEntryMode): void => {
    if (mode === endDayCashEntryMode) {
      return;
    }
    if (mode === "AMOUNT") {
      setEndDayCash(endDayDenominationTotal.toFixed(2));
    }
    setEndDayCashEntryMode(mode);
  };

  const updateEndDayDenominationCount = (denomination: number, value: string): void => {
    const sanitized = value.replace(/[^\d]/g, "");
    setEndDayDenominationCounts((prev) => ({
      ...prev,
      [String(denomination)]: sanitized,
    }));
  };

  const stepEndDayDenominationCount = (denomination: number, delta: 1 | -1): void => {
    const key = String(denomination);
    const currentValue = endDayDenominationCounts[key] ?? "";
    const currentQty = Number.parseInt(currentValue, 10);
    const nextQty = Math.max(0, (Number.isFinite(currentQty) ? currentQty : 0) + delta);
    setEndDayDenominationCounts((prev) => ({
      ...prev,
      [key]: nextQty > 0 ? String(nextQty) : "",
    }));
  };

  const submitEndDayClose = async (
    closingInventorySnapshot?: DesktopShiftInventorySnapshot | null,
  ): Promise<void> => {
    if (!endDaySnapshot) {
      return;
    }
    const counted = endDayCashAmount;
    const variance = Number((counted - endDaySnapshot.expectedCash).toFixed(2));
    const record = await desktopShiftService.closeShift(appState, {
      shiftId: endDaySnapshot.shiftId,
      closingCash: counted,
      cashVariance: variance,
      closingInventorySnapshot,
    });
    resetEndDayFlowState();
    await refreshCatalog();
    if (onOutboxChanged) {
      await onOutboxChanged();
    }
    showSuccess(`Shift ${record.id} was ended from POS and is waiting to sync.`);
  };

  const continueToEndDayInventoryCount = async (): Promise<void> => {
    if (!endDaySnapshot) {
      return;
    }
    setSaving(true);
    try {
      const snapshot = await desktopShiftInventoryReportService.captureSnapshot({
        locationId: endDaySnapshot.shift.locationId || appState.setup.locationId,
        locationLabel:
          endDaySnapshot.shift.locationLabel || appState.setup.locationLabel,
      });
      setEndDayInventorySnapshot(snapshot);
      setEndDayInventoryCounts(createInventoryCountInputs(snapshot));
      setEndDayModalOpen(false);
      setEndDayInventoryModalOpen(true);
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : "Unable to prepare the inventory count now.",
      );
    } finally {
      setSaving(false);
    }
  };

  const finalizeEndDayClose = async (): Promise<void> => {
    if (!endDayInventorySnapshot) {
      return;
    }
    setSaving(true);
    try {
      const closingInventorySnapshot = buildInventoryCountSnapshot(
        endDayInventorySnapshot,
        endDayInventoryCounts,
      );
      await submitEndDayClose(closingInventorySnapshot);
      setEndDayInventoryModalOpen(false);
      if (onAfterInventoryCountClose) {
        await onAfterInventoryCountClose();
      }
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to end day from POS.",
      );
    } finally {
      setSaving(false);
    }
  };

  const openEndDayModal = async (): Promise<void> => {
    if (!activeShiftId) {
      showWarning("Start Duty in Shift before ending the day.");
      return;
    }
    setEndDayLoading(true);
    try {
      const [activeShift, cashEntries, salesRows] = await Promise.all([
        desktopShiftService.findActiveShift(),
        desktopShiftService.listShiftCashEntries(),
        desktopDb.listSales(),
      ]);
      if (!activeShift) {
        setActiveShiftId(null);
        showWarning("No active shift found. Open duty first.");
        return;
      }
      const openedAt = new Date(activeShift.openedAt).getTime();
      const closedAt = activeShift.closedAt
        ? new Date(activeShift.closedAt).getTime()
        : Number.POSITIVE_INFINITY;
      const shiftSales = salesRows.filter((sale) => {
        const createdAt = new Date(sale.createdAt).getTime();
        return createdAt >= openedAt && createdAt <= closedAt;
      });
      const shiftCashEntries = cashEntries.filter(
        (entry) => entry.shiftId === activeShift.id,
      );
      const cashIn = shiftCashEntries
        .filter((entry) => entry.direction === "IN")
        .reduce((sum, entry) => sum + entry.amount, 0);
      const cashOut = shiftCashEntries
        .filter((entry) => entry.direction === "OUT")
        .reduce((sum, entry) => sum + entry.amount, 0);
      const cashSales = shiftSales
        .filter(
          (sale) =>
            sale.saleStatus !== "CANCELLED" &&
            sale.payload.paymentMethod === "CASH",
        )
        .reduce((sum, sale) => sum + resolveCashCollected(sale), 0);
      const cashReturns = shiftSales
        .filter((sale) => sale.payload.paymentMethod === "CASH")
        .reduce(
          (sum, sale) =>
            sum +
            (sale.returns ?? []).reduce(
              (entrySum, entry) =>
                entrySum +
                entry.lines.reduce(
                  (lineSum, line) => lineSum + Number(line.lineTotal ?? 0),
                  0,
                ),
              0,
            ),
          0,
        );
      const expectedCash = Number(
        (
          activeShift.openingCash +
          cashSales - 
          cashReturns +
          cashIn - 
          cashOut
        ).toFixed(2),
      );
      setEndDaySnapshot({
        shift: activeShift,
        shiftId: activeShift.id,
        openingCash: activeShift.openingCash,
        cashSales,
        cashReturns,
        cashIn,
        cashOut,
        expectedCash,
      });
      setEndDayCash(expectedCash.toFixed(2));
      setEndDayCashEntryMode("DENOMINATION");
      clearEndDayDenominations();
      setEndDayInventoryModalOpen(false);
      setEndDayInventorySnapshot(null);
      setEndDayInventoryCounts({});
      setEndDayModalOpen(true);
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : "Unable to prepare end of day summary.",
      );
    } finally {
      setEndDayLoading(false);
    }
  };

  const endDayFromPos = async (): Promise<void> => {
    if (!endDaySnapshot) {
      showWarning("End-of-day summary is not ready yet.");
      return;
    }
    if (cashierEndOfDayInventoryCountAddonEnabled) {
      await continueToEndDayInventoryCount();
      return;
    }
    setSaving(true);
    try {
      await submitEndDayClose(null);
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to end day from POS.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleProceedToPayment = (): void => {
    const validationError = validateCartBeforePayment();
    if (validationError) {
      showWarning(validationError);
      if (validationError.includes("Customer")) {
        setCustomerModalOpen(true);
      } else if (validationError.includes("Personnel")) {
        setPersonnelModalOpen(true);
      } else if (validationError.includes("Shift")) {
        onGoToShift?.();
      }
      return;
    }
    const checkoutDiscount = resolveCustomerCheckoutDiscount({
      customerDiscount: selectedCustomer?.contractPrice,
      currentDiscount: discount,
      subtotal,
    });
    if (checkoutDiscount !== discount) {
      setDiscountAmount(checkoutDiscount === 0 ? "0" : checkoutDiscount.toFixed(2));
    }
    setPaidAmount("0");
    setPaymentModalOpen(true);
  };

  const persistSale = async (): Promise<DesktopSaleRecord | null> => {
    if (!appState.setupCompleted) {
      showWarning("Finish setup first before saving sales.");
      return null;
    }
    if (!activeShiftId) {
      showWarning("Start Duty in Shift before saving a sale.");
      return null;
    }
    if (!appState.setup.locationId) {
      showWarning("Choose a branch location in Settings before using POS.");
      return null;
    }
    if (!catalog.length) {
      showWarning(
        "No local product catalog is available yet. Download branch data in Settings first.",
      );
      return null;
    }
    if (!cart.length) {
      showWarning("Add at least one item before saving a sale.");
      return null;
    }
    if (!selectedCustomerId) {
      showWarning("Customer is required before payment.");
      setCustomerModalOpen(true);
      return null;
    }
    if (!selectedPersonnelId) {
      showWarning("Personnel is required before payment.");
      setPersonnelModalOpen(true);
      return null;
    }
    if (cart.some((line) => line.isLpg && !line.cylinderFlow)) {
      showWarning(
        "Select Refill or Non-Refill for every LPG item before payment.",
      );
      return null;
    }
    if (paymentMode === "FULL" && parsedPaidAmount + 0.0001 < total) {
      showWarning(
        "Full payment requires amount equal to or greater than total.",
      );
      return null;
    }
    if (paymentMode === "PARTIAL") {
      if (!Number.isFinite(parsedPaidAmount) || parsedPaidAmount < 0) {
        showWarning("Enter a valid paid amount for partial payment.");
        return null;
      }
      if (parsedPaidAmount >= total) {
        showWarning("Partial payment must be less than total.");
        return null;
      }
    }
    if (hideReceiptAmounts && creditBalance > 0.0001) {
      showWarning(
        "Receipt amount privacy is not allowed for sales with balance due.",
      );
      return null;
    }
    if (cartWarnings.length > 0) {
      showWarning(cartWarnings[0]);
      return null;
    }
    await desktopSubscriptionPolicyService.assertCanCreateTransactions("sale");
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const existingLocalSales = await desktopDb.listSales();
    const saleId = `desk-sale-${Date.now()}`;
    const receiptNumber = makeReceiptNumber(existingLocalSales, nowDate);
    const lines: DesktopSaleLine[] = cart.map((line) => ({
      lineId: line.lineId,
      productId: line.id,
      productName: line.name,
      subtitle: line.subtitle ?? null,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: Number((line.quantity * line.unitPrice).toFixed(2)),
      cylinderFlow: line.isLpg ? (line.cylinderFlow ?? null) : null,
      pickupCommissionRate: round2(Number(line.pickupCommissionRate || 0)),
      deliveryCommissionRate: round2(Number(line.deliveryCommissionRate || 0)),
    }));
    const primaryPersonnelRole: "DRIVER" | "PERSONNEL" =
      orderType === "DELIVERY" ? "DRIVER" : "PERSONNEL";
    const commissionRows = buildEqualSplitCommissionPreview({
      lines,
      saleType: orderType,
      personnel: [
        {
          id: selectedPersonnel?.id ?? null,
          role: primaryPersonnelRole,
          name: selectedPersonnel?.label ?? null,
          commissionEligible: selectedPersonnel?.commissionEligible,
        },
        ...(selectedHelper?.id
          ? [
              {
                id: selectedHelper.id,
                role: "HELPER" as const,
                name: selectedHelper.label ?? null,
                commissionEligible: selectedHelper.commissionEligible,
              },
            ]
          : []),
      ],
    });
    const commissionTotal = round2(
      commissionRows.reduce((sum, row) => sum + row.commissionAmount, 0),
    );
    const syncedPaymentAmount = Number(
      (paymentMode === "FULL"
        ? total
        : Math.max(0, Math.min(parsedPaidAmount, total))
      ).toFixed(2),
    );

    const payload: DesktopSalePayload = {
      id: saleId,
      shiftId: activeShiftId,
      customerId: selectedCustomer?.id ?? null,
      customerName: selectedCustomer?.label ?? null,
      recreatedFromSaleId,
      personnelId: selectedPersonnel?.id ?? null,
      personnelName: selectedPersonnel?.label ?? null,
      helperId: selectedHelper?.id ?? null,
      helperName: selectedHelper?.label ?? null,
      personnel: [
        {
          userId: selectedPersonnel?.id ?? "",
          role: primaryPersonnelRole,
          name: selectedPersonnel?.label ?? null,
        },
        ...(selectedHelper?.id
          ? [
              {
                userId: selectedHelper.id,
                role: "HELPER" as const,
                name: selectedHelper.label ?? null,
              },
            ]
          : []),
      ].filter((entry) => entry.userId.trim().length > 0),
      saleType: orderType,
      paymentMode,
      paymentMethod,
      hideAmounts: hideReceiptAmounts,
      branchId: appState.setup.branchId,
      branchLabel: appState.setup.branchLabel,
      locationId: appState.setup.locationId,
      locationLabel: appState.setup.locationLabel,
      subtotal,
      discountAmount: discount,
      deliveryFee: deliveryFeeValue,
      totalAmount: total,
      paidAmount: Number(parsedPaidAmount.toFixed(2)),
      changeAmount,
      creditBalance,
      payments: [
        {
          id: `${saleId}-payment-1`,
          source: "SALE",
          method: paymentMethod,
          amount: syncedPaymentAmount,
          referenceNo: null,
          notes: null,
          createdAt: now,
        },
      ],
      rewardId: selectedReward?.id ?? null,
      rewardName: selectedReward?.name ?? null,
      rewardPointsCost: selectedReward?.pointsCost ?? 0,
      rewardDiscountAmount: totalRewardValue,
      rewardBaseAmount,
      rewardRedemptionUsed: Boolean(selectedReward),
      commissionSplitMode: "EQUAL",
      commissionTotal,
      commissions: commissionRows,
      notes: notes.trim() || null,
      lines,
      createdAt: now,
    };

    const saleRecord: DesktopSaleRecord = {
      id: saleId,
      payload,
      syncStatus: "pending",
      receiptNumber,
      createdAt: now,
      updatedAt: now,
    };

    await desktopDb.saveSale(saleRecord);
    await desktopDb.enqueueOutboxItem({
      id: saleId,
      entity: "sale",
      action: "create",
      payload: buildSaleOutboxPayload(payload),
      idempotency_key: `idem-sale-${saleId}`,
      created_at: now,
    });

    if (orderType === "DELIVERY" && deliveryDispatchAddonEnabled) {
      await desktopDeliveryService.createDeliveryOrder({
        branchId: appState.setup.branchId,
        sourceLocationId: appState.setup.locationId,
        customerId: selectedCustomer?.id ?? "",
        customerName: selectedCustomer?.label ?? null,
        saleId,
        orderType: "DELIVERY",
        personnel: [
          {
            userId: selectedPersonnel?.id ?? "",
            role: "DRIVER" as const,
            name: selectedPersonnel?.label ?? null,
          },
          ...(selectedHelper?.id
            ? [
                {
                  userId: selectedHelper.id,
                  role: "HELPER" as const,
                  name: selectedHelper.label ?? null,
                },
              ]
            : []),
        ].filter((entry) => entry.userId.trim().length > 0),
        notes: "Created from desktop POS delivery checkout",
      });
    }

    await refreshCatalog();
    await refreshHeldCarts();
    if (onOutboxChanged) {
      await onOutboxChanged();
    }
    resetCheckoutForm();
    return saleRecord;
  };

  const completeCheckout = async (withPrint: boolean): Promise<void> => {
    setSaving(true);
    let nextSaleSuccessModal: CheckoutSuccessModalState | null = null;
    try {
      const sale = await persistSale();
      if (!sale) {
        return;
      }
      const dispatchQueued =
        sale.payload.saleType === "DELIVERY" && deliveryDispatchAddonEnabled;
      const paymentMethodLabel = formatPaymentMethodLabel(
        sale.payload.paymentMethod,
      );
      const noteParts: string[] = [];
      let message = dispatchQueued
        ? `Sale ${sale.receiptNumber} and its delivery order were saved locally and are waiting to sync.`
        : `Sale ${sale.receiptNumber} was saved locally and is waiting to sync.`;

      if (sale.payload.saleType === "DELIVERY") {
        if (dispatchQueued) {
          noteParts.push("Delivery order queued for sync.");
        } else {
          noteParts.push(
            "Delivery Dispatch add-on is not enabled, so no dispatch order was created.",
          );
        }
      }

      if (withPrint) {
        if (appState.setup.printerMode === "NONE") {
          noteParts.push("Receipt printing is disabled on this workstation.");
        } else {
          try {
            await desktopReceiptService.printSaleReceipt(sale, appState);
            message = `Sale ${sale.receiptNumber} was completed and the receipt was printed.`;
          } catch (printError) {
            noteParts.push(
              printError instanceof Error
                ? printError.message
                : "Receipt printing failed.",
            );
            message = `Sale ${sale.receiptNumber} was completed, but the receipt could not be printed.`;
          }
        }
      }

      setMessage(message);
      nextSaleSuccessModal = {
        receiptNumber: sale.receiptNumber,
        message,
        note: noteParts.length > 0 ? noteParts.join(" ") : null,
        paymentMethodLabel,
      };
    } catch (error) {
      showError(
        error instanceof Error ? error.message : "Unable to complete checkout.",
      );
    } finally {
      setSaving(false);
    }

    if (nextSaleSuccessModal) {
      setSaleSuccessModal(nextSaleSuccessModal);
    }
  };

  return (
    <div className="pos-static-shell">
      <section className="pos-static-metrics" aria-label="POS summary">
        {(
          [
            {
              key: "shift",
              label: "Shift",
              value: activeShiftId ? "Open" : "Required",
              icon: "shift",
              tone: activeShiftId ? "good" : "danger",
              onClick: onGoToShift,
              disabled: Boolean(activeShiftId || !onGoToShift),
            },
            {
              key: "queue",
              label: "Queue Orders",
              value: String(heldCarts.length),
              icon: "queue",
              tone: heldCarts.length > 0 ? "accent" : "neutral",
              onClick: () => {
                setHeldCartSearch("");
                setHeldCartModalOpen(true);
              },
              disabled: heldCarts.length === 0,
            },
            {
              key: "lines",
              label: "Cart Lines",
              value: String(cart.length),
              icon: "lines",
              tone: cart.length > 0 ? "accent" : "neutral",
              onClick: undefined,
              disabled: true,
            },
            {
              key: "route",
              label: "Order Type",
              value: orderType,
              icon: "route",
              tone: "neutral",
              onClick: undefined,
              disabled: true,
            },
            {
              key: "total",
              label: "Total Due",
              value: formatAmountForSummary(total),
              icon: "total",
              tone: total > 0 ? "good" : "neutral",
              onClick: undefined,
              disabled: true,
            },
          ] as const
        ).map((card) => {
          const tone = posOverviewMetricTone(card.tone);
          if (card.key === "route") {
            return (
              <label
                key={card.key}
                className={`pos-static-metric pos-static-order-select-card ${tone.shell}`}
              >
                <span className={`pos-static-metric-icon ${tone.icon}`}>
                  <PosOverviewSymbol
                    kind={card.icon}
                    className="h-[20px] w-[20px]"
                  />
                </span>
                <span className="pos-static-metric-copy">
                  <span className={`pos-static-metric-label ${tone.label}`}>
                    {card.label}
                  </span>
                  <strong>{card.value}</strong>
                </span>
                <PosChevronDownIcon className="pos-static-select-chevron h-[18px] w-[18px]" />
                <select
                  className="pos-static-native-select"
                  aria-label="Order type"
                  value={orderType}
                  onChange={(event) =>
                    setOrderType(event.target.value as DesktopSaleType)
                  }
                >
                  <option value="PICKUP">PICKUP</option>
                  <option value="DELIVERY">DELIVERY</option>
                </select>
              </label>
            );
          }
          return (
            <button
              key={card.key}
              type="button"
              className={`pos-static-metric ${tone.shell}`}
              onClick={card.onClick}
              disabled={card.disabled}
            >
              <span className={`pos-static-metric-icon ${tone.icon}`}>
                <PosOverviewSymbol
                  kind={card.icon}
                  className="h-[20px] w-[20px]"
                />
              </span>
              <span className="pos-static-metric-copy">
                <span className={`pos-static-metric-label ${tone.label}`}>
                  {card.label}
                </span>
                <strong>{card.value}</strong>
              </span>
              {card.key === "shift" && activeShiftId ? (
                <span className={`pos-static-meter-line ${tone.line}`} />
              ) : null}
            </button>
          );
        })}
      </section>

      <section className="pos-static-workspace" aria-label="POS checkout">
        <aside className="pos-static-panel pos-static-setup-panel">
          <div className="pos-static-panel-head">
            <h2>Checkout setup</h2>
          </div>

          <div className="pos-static-step-list">
            <div className="pos-static-order-control" ref={orderTypeDropdownRef}>
              <button
                ref={orderTypeTarget.ref}
                className={`pos-static-step pos-static-order-trigger is-active ${
                  orderTypeDropdownOpen ? "is-open" : ""
                } ${orderTypeTarget.active ? "tutorial-target-active" : ""}`}
                type="button"
                aria-expanded={orderTypeDropdownOpen}
                aria-haspopup="listbox"
                onClick={() => setOrderTypeDropdownOpen((isOpen) => !isOpen)}
              >
                <span className="pos-static-order-trigger-icon">
                  <PosOverviewSymbol kind="route" className="h-[19px] w-[19px]" />
                </span>
                <span className="pos-static-step-copy">
                  <span>Order Type</span>
                  <strong>{orderType}</strong>
                </span>
                {orderTypeDropdownOpen ? (
                  <PosChevronUpIcon className="pos-static-select-chevron h-[18px] w-[18px]" />
                ) : (
                  <PosChevronDownIcon className="pos-static-select-chevron h-[18px] w-[18px]" />
                )}
              </button>
              {orderTypeDropdownOpen ? (
                <div className="pos-static-order-menu" role="listbox" aria-label="Order type">
                  {POS_ORDER_TYPE_OPTIONS.map((option) => {
                    const isSelected = option.value === orderType;
                    return (
                      <button
                        key={option.value}
                        className={`pos-static-order-option ${
                          isSelected ? "is-selected" : ""
                        }`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleOrderTypeSelect(option.value)}
                      >
                        <span className="pos-static-order-option-icon">
                          <PosOverviewSymbol
                            kind="route"
                            className="h-[18px] w-[18px]"
                          />
                        </span>
                        <span className="pos-static-order-option-copy">
                          <strong>{option.label}</strong>
                          <span>{option.description}</span>
                        </span>
                        {isSelected ? (
                          <PosCheckIcon className="pos-static-order-option-check h-[20px] w-[20px]" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <button
              ref={customerTarget.ref}
              className={`pos-static-step ${customerTarget.active ? "tutorial-target-active" : ""}`}
              type="button"
              onClick={openCustomerPicker}
            >
              <span className="pos-static-step-number">2</span>
              <span className="pos-static-step-copy">
                <span>Customer</span>
                <strong>{selectedCustomer?.label ?? "Select customer"}</strong>
              </span>
              <PosChevronDownIcon className="pos-static-select-chevron h-[18px] w-[18px]" />
            </button>

            <button
              className="pos-static-step"
              type="button"
              onClick={openPersonnelPicker}
            >
              <span className="pos-static-step-number">3</span>
              <span className="pos-static-step-copy">
                <span>Personnel</span>
                <strong>{selectedPersonnel?.label ?? "Select personnel"}</strong>
              </span>
              <PosChevronDownIcon className="pos-static-select-chevron h-[18px] w-[18px]" />
            </button>

            <button
              className="pos-static-step"
              type="button"
              onClick={openHelperPicker}
            >
              <span className="pos-static-step-number">4</span>
              <span className="pos-static-step-copy">
                <span>Helper</span>
                <strong>{selectedHelper?.label ?? "Not assigned"}</strong>
              </span>
              <PosChevronDownIcon className="pos-static-select-chevron h-[18px] w-[18px]" />
            </button>
          </div>

          {compactCheckoutSetupNote ? (
            <div
              className={`pos-static-setup-note ${!activeShiftId ? "is-warning" : ""}`}
            >
              <span className="pos-static-note-icon" aria-hidden="true">
                i
              </span>
              <span>
                {compactCheckoutSetupNote}
              </span>
              {!activeShiftId ? (
                <button
                  className="pos-static-inline-action"
                  type="button"
                  onClick={onGoToShift}
                  disabled={!onGoToShift}
                >
                  Go
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="pos-static-side-actions">
            <button
              className="secondary-btn pos-static-action-btn"
              type="button"
              onClick={promptHoldCurrentCart}
              disabled={!cart.length || saving}
            >
              <PosOverviewSymbol kind="queue" className="h-[18px] w-[18px]" />
              <span>Add to Queue</span>
            </button>
            <button
              className="secondary-btn pos-static-action-btn pos-static-clear-btn"
              type="button"
              onClick={promptClearCurrentOrder}
              disabled={saving || !hasDraftToClear}
            >
              <PosTrashIcon className="h-[18px] w-[18px]" />
              <span>Clear Order</span>
            </button>
          </div>
        </aside>

        <main className="pos-static-panel pos-static-items-panel">
          <div className="pos-static-item-toolbar">
            <SearchField
              className="pos-static-search"
              value={itemSearch}
              onChange={setItemSearch}
              placeholder="Search items..."
            />
          </div>

          <div className="pos-static-category-row" aria-label="Item categories">
            {compactCategoryOptions.map((category) => (
              <button
                key={category}
                type="button"
                className={`pos-static-category-chip ${itemCategoryFilter === category ? "active" : ""}`}
                onClick={() => setItemCategoryFilter(category)}
              >
                {category === "ALL" ? "All" : category}
              </button>
            ))}
          </div>

          <div className="pos-static-item-table">
            <div className="pos-static-item-head">
              <span>Item Name</span>
              <span>{compactShowsCylinderStock ? "Full" : "QOH"}</span>
              <span>{compactShowsCylinderStock ? "Empty" : ""}</span>
              <span>Price</span>
              <span aria-hidden="true" />
            </div>
            <div className="pos-static-item-rows">
              {compactVisibleProducts.length === 0 ? (
                <div className="pos-static-empty-state">No matching items.</div>
              ) : (
                compactVisibleProducts.map((product) => {
                  const stockTone = resolveStockTone(product);
                  const showCylinderStock = hasCylinderStock(product);
                  const itemDisabled = !selectedCustomerId || stockTone === "out";
                  return (
                    <button
                      key={product.id}
                      type="button"
                      className="pos-static-item-row"
                      onClick={() => {
                        addToCart(product);
                        showSuccess(`${product.name} was added to the POS cart.`);
                      }}
                      disabled={itemDisabled}
                      title={
                        !selectedCustomerId
                          ? "Select a customer first"
                          : stockTone === "out"
                            ? "Out of stock"
                            : `Add ${product.name}`
                      }
                    >
                      <span className="pos-static-item-name">
                        <strong>{product.name}</strong>
                        <small>
                          {product.sku} | {product.category}
                          {product.isLpg
                            ? ` | ${formatCylinderSizeLabel(product)}`
                            : ""}
                        </small>
                      </span>
                      <span className="pos-static-item-stock-count" title={showCylinderStock ? `Full quantity: ${formatCylinderStockQuantity(product.qtyFull)}` : `Qty on hand: ${formatStockQuantity(product.qtyOnHand)}`}>
                        {showCylinderStock ? formatCylinderStockQuantity(product.qtyFull) : formatStockQuantity(product.qtyOnHand)}
                      </span>
                      <span
                        className="pos-static-item-stock-count"
                        title={
                          showCylinderStock
                            ? `Empty quantity: ${formatCylinderStockQuantity(product.qtyEmpty)}`
                          : undefined
                        }
                      >
                        {showCylinderStock ? formatCylinderStockQuantity(product.qtyEmpty) : ""}
                      </span>
                      <strong className="pos-static-item-price">
                        {fmtMoney(product.unitPrice)}
                      </strong>
                      <span className="pos-static-add-icon" aria-hidden="true">
                        <PosPlusIcon className="h-[18px] w-[18px]" />
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="pos-static-item-footer">
            <span>
              Showing {compactVisibleProducts.length} of {filteredProducts.length} items
            </span>
            <button
              ref={itemSelectorTarget.ref}
              className="secondary-btn"
              type="button"
              onClick={openItemPicker}
              disabled={!selectedCustomerId}
            >
              View all items
            </button>
          </div>
        </main>

        <aside className="pos-static-panel pos-static-cart-panel">
          <div className="pos-static-cart-head">
            <h2>Cart</h2>
            <button
              className="secondary-btn pos-static-icon-btn"
              type="button"
              onClick={promptClearCurrentOrder}
              disabled={saving || !hasDraftToClear}
              aria-label="Clear order"
              title="Clear order"
            >
              <PosTrashIcon className="h-[20px] w-[20px]" />
            </button>
          </div>

          <div className="pos-static-cart-body">
            {!cart.length ? (
              <div className="pos-static-cart-empty">
                <div className="pos-static-cart-empty-icon" aria-hidden="true">
                  <PosOverviewSymbol kind="lines" className="h-[34px] w-[34px]" />
                </div>
                <strong>No items added yet.</strong>
                <span>Add items from the menu to build your order.</span>
              </div>
            ) : (
              <div className="pos-static-cart-lines">
                {compactVisibleCartLines.map((line) => (
                  <div key={line.lineId} className="pos-static-cart-line">
                    <div className="pos-static-cart-line-main">
                      <strong>{line.name}</strong>
                      <span>
                        {line.isLpg
                          ? formatCylinderSizeLabel(line)
                          : line.sku}
                      </span>
                      {line.isLpg ? (
                        <div className="pos-static-flow-row">
                          {(
                            [
                              { value: "REFILL_EXCHANGE", label: "Refill" },
                              { value: "NON_REFILL", label: "Non-Refill" },
                            ] as const
                          ).map((flow) => (
                            <button
                              key={`${line.lineId}-${flow.value}`}
                              type="button"
                              className={`flow-chip ${line.cylinderFlow === flow.value ? "active" : ""}`}
                              onClick={() => setLineCylinderFlow(line.lineId, flow.value)}
                            >
                              {flow.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="pos-static-cart-line-side">
                      <strong>{fmtMoney(line.quantity * line.unitPrice)}</strong>
                      <div className="cart-controls pos-static-cart-controls">
                        <button
                          type="button"
                          onClick={() =>
                            updateQuantity(
                              line.lineId,
                              Math.max(0, line.quantity - 1),
                            )
                          }
                          aria-label={`Decrease ${line.name}`}
                        >
                          <PosMinusIcon className="h-[15px] w-[15px]" />
                        </button>
                        <CartQuantityInput
                          lineId={line.lineId}
                          quantity={line.quantity}
                          onUpdateQuantity={updateQuantity}
                        />
                        <button
                          type="button"
                          onClick={() => updateQuantity(line.lineId, line.quantity + 1)}
                          aria-label={`Increase ${line.name}`}
                        >
                          <PosPlusIcon className="h-[15px] w-[15px]" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pos-static-total-block">
            <div className="pos-static-total-row">
              <span>Subtotal</span>
              <strong>{formatAmountForSummary(subtotal)}</strong>
            </div>
            {discount > 0 ? (
              <div className="pos-static-total-row">
                <span>Discount</span>
                <strong>{formatAmountForSummary(discount)}</strong>
              </div>
            ) : null}
            {orderType === "DELIVERY" ? (
              <div className="pos-static-total-row">
                <span>Delivery Fee</span>
                <strong>{formatAmountForSummary(deliveryFeeValue)}</strong>
              </div>
            ) : null}
            <div className="pos-static-total-row pos-static-total-row--due">
              <span>Total Due</span>
              <strong>{formatAmountForSummary(total)}</strong>
            </div>
          </div>

          <div className="pos-static-cart-actions">
            <button
              ref={proceedPaymentTarget.ref}
              className={`primary-btn pos-static-pay-btn ${proceedPaymentTarget.active ? "tutorial-target-active" : ""}`}
              type="button"
              onClick={handleProceedToPayment}
              disabled={saving || !cart.length}
            >
              <span>Proceed To Payment</span>
              <PosArrowRightIcon className="h-[18px] w-[18px]" />
            </button>
          </div>
        </aside>
      </section>

      <div className="pos-static-status-line">
        <span>{cartWarnings[0] ?? message}</span>
      </div>

      {clearOrderConfirmOpen ? (
        <div
          className={posModalBackdropClass}
          style={{ zIndex: 95 }}
          onClick={() => !saving && setClearOrderConfirmOpen(false)}
        >
          <div
            className="desktop-modal-card desktop-modal-card--detail"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="desktop-modal-header flex shrink-0 flex-col gap-3">
              <div className="panel-head !mb-0">
                <div>
                  <div className="eyebrow">Confirm clear order</div>
                  <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">
                    Reset current POS order?
                  </h3>
                  <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
                    This clears items, customer, personnel, amounts, notes, and
                    payment details for this draft.
                  </p>
                </div>
                <button
                  className="secondary-btn mini-btn modal-close-icon-btn"
                  type="button"
                  onClick={() => setClearOrderConfirmOpen(false)}
                  disabled={saving}
                  aria-label="Close modal"
                  title="Close"
                >
                  <span aria-hidden="true">X</span>
                </button>
              </div>
            </div>
            <div className="desktop-modal-body grid gap-3">
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Items</span>
                <strong className={summaryValueClass}>{cart.length}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Current Total</span>
                <strong className={summaryValueClass}>{fmtMoney(total)}</strong>
              </div>
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Customer</span>
                <strong className={summaryValueClass}>
                  {selectedCustomer?.label ?? "Select customer"}
                </strong>
              </div>
            </div>
            <div className="desktop-modal-footer">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setClearOrderConfirmOpen(false)}
                disabled={saving}
              >
                Keep Order
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={confirmClearCurrentOrder}
                disabled={saving}
              >
                Clear Order
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {endDayModalOpen && endDaySnapshot ? (
        <ShiftCloseModal
          appState={appState}
          activeShift={endDaySnapshot.shift}
          expectedCash={endDaySnapshot.expectedCash}
          requiresInventoryCount={cashierEndOfDayInventoryCountAddonEnabled}
          closingCashEntryMode={endDayCashEntryMode}
          closingCashAmount={endDayCashAmount}
          closingCash={endDayCash}
          closingDenominationRows={endDayDenominationRows}
          closingDenominationCounts={endDayDenominationCounts}
          closingDenominationActiveLines={endDayDenominationActiveLines}
          closingDenominationPieces={endDayDenominationPieces}
          closingDenominationTotal={endDayDenominationTotal}
          variancePreview={endDayVariance}
          saving={saving}
          onClose={resetEndDayFlowState}
          onSelectMode={selectEndDayCashMode}
          onClosingCashChange={setEndDayCash}
          onQuickAmount={addEndDayCashAmount}
          onStepDenomination={stepEndDayDenominationCount}
          onUpdateDenomination={updateEndDayDenominationCount}
          onClearDenominations={clearEndDayDenominations}
          onEndShift={() => void endDayFromPos()}
        />
      ) : null}

      {endDayInventoryModalOpen &&
      endDayInventorySnapshot &&
      endDaySnapshot ? (
        <ShiftInventoryCountModal
          appState={appState}
          activeShift={endDaySnapshot.shift}
          expectedCash={endDaySnapshot.expectedCash}
          countedCash={endDayCashAmount}
          cashVariance={endDayVariance}
          inventorySnapshot={endDayInventorySnapshot}
          inventoryCounts={endDayInventoryCounts}
          saving={saving}
          onClose={() => {
            if (!saving) {
              setEndDayInventoryModalOpen(false);
              setEndDayModalOpen(true);
            }
          }}
          onBackToCloseout={() => {
            if (!saving) {
              setEndDayInventoryModalOpen(false);
              setEndDayModalOpen(true);
            }
          }}
          onUpdateCount={(productId, field, value) => {
            setEndDayInventoryCounts((prev) => ({
              ...prev,
              [productId]: {
                ...(prev[productId] ?? { qtyOnHand: "", qtyFull: "", qtyEmpty: "" }),
                [field]: value,
              },
            }));
          }}
          onFinalize={() => void finalizeEndDayClose()}
        />
      ) : null}

      {checkoutSetupModalOpen ? (
        <div
          className={posModalBackdropClass}
          onClick={() => setCheckoutSetupModalOpen(false)}
        >
          <div
            className="desktop-modal-card desktop-modal-card--action pos-setup-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="desktop-modal-header flex shrink-0 flex-col gap-3">
              <div className="panel-head !mb-0">
                <div className="pos-setup-modal-title">
                  <span className="pos-setup-modal-icon">
                    <PosOverviewSymbol
                      kind="pos"
                      className="h-[22px] w-[22px]"
                    />
                  </span>
                  <div>
                    <div className="eyebrow">Checkout setup</div>
                    <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">
                      Change checkout setup
                    </h3>
                    <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
                      Update the details below. Changes will be reflected in the
                      order.
                    </p>
                  </div>
                </div>
                <button
                  className="secondary-btn mini-btn modal-close-icon-btn"
                  type="button"
                  onClick={() => setCheckoutSetupModalOpen(false)}
                  aria-label="Close modal"
                  title="Close"
                >
                  <span aria-hidden="true">X</span>
                </button>
              </div>
            </div>

            <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-3">
              <div
                ref={orderTypeTarget.ref}
                className={`pos-setup-modal-row pos-setup-modal-row--type ${orderTypeTarget.active ? "tutorial-target-active" : ""}`}
              >
                <span className="pos-setup-modal-row__icon">
                  <PosSetupRowSymbol
                    kind="type"
                    className="h-[20px] w-[20px]"
                  />
                </span>
                <span className="pos-setup-modal-row__copy">
                  <span>Order type</span>
                  <strong>
                    {orderType === "PICKUP" ? "Pickup" : "Delivery"}
                  </strong>
                  <span>Select how the order will be fulfilled.</span>
                </span>
                <div className="pos-setup-order-toggle">
                  {(["PICKUP", "DELIVERY"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`rounded-[14px] border px-4 py-2 text-sm font-bold transition ${
                        orderType === mode
                          ? "border-[rgba(25,118,210,0.4)] bg-[linear-gradient(180deg,rgba(37,99,235,0.14),rgba(37,99,235,0.06))] text-[var(--text-strong)] shadow-[0_10px_24px_rgba(37,99,235,0.12)]"
                          : "border-[var(--border-soft)] bg-white text-[var(--muted-strong)] hover:border-[rgba(25,118,210,0.24)]"
                      }`}
                      onClick={() => setOrderType(mode)}
                    >
                      {mode === "PICKUP" ? "Pickup" : "Delivery"}
                    </button>
                  ))}
                </div>
              </div>

              <button
                className="pos-setup-modal-row"
                type="button"
                onClick={openCustomerPicker}
              >
                <span className="pos-setup-modal-row__icon">
                  <PosSetupRowSymbol
                    kind="customer"
                    className="h-[20px] w-[20px]"
                  />
                </span>
                <span className="pos-setup-modal-row__copy">
                  <span>Customer</span>
                  <strong>
                    {selectedCustomer?.label ?? "Select customer"}
                  </strong>
                  <span>
                    {selectedCustomer
                      ? `Points ${selectedCustomer.pointsBalance ?? 0} | Balance ${fmtMoney(selectedCustomer.balance ?? 0)}`
                      : "Select who this order is for."}
                  </span>
                </span>
                <PosChevronRightIcon className="pos-setup-modal-row__chevron h-[20px] w-[20px]" />
              </button>

              <button
                className="pos-setup-modal-row"
                type="button"
                onClick={openPersonnelPicker}
              >
                <span className="pos-setup-modal-row__icon">
                  <PosSetupRowSymbol
                    kind="personnel"
                    className="h-[20px] w-[20px]"
                  />
                </span>
                <span className="pos-setup-modal-row__copy">
                  <span>Personnel (Required)</span>
                  <strong>
                    {selectedPersonnel?.label ?? "Select personnel"}
                  </strong>
                  <span>
                    {selectedPersonnel?.subtitle ??
                      "Assign the cashier or driver handling this order."}
                  </span>
                </span>
                <PosChevronRightIcon className="pos-setup-modal-row__chevron h-[20px] w-[20px]" />
              </button>

              <button
                className="pos-setup-modal-row"
                type="button"
                onClick={openHelperPicker}
              >
                <span className="pos-setup-modal-row__icon">
                  <PosSetupRowSymbol
                    kind="helper"
                    className="h-[20px] w-[20px]"
                  />
                </span>
                <span className="pos-setup-modal-row__copy">
                  <span>Helper (Optional)</span>
                  <strong>{selectedHelper?.label ?? "Not assigned"}</strong>
                  <span>
                    {selectedHelper?.subtitle ??
                      "Add a helper only when needed."}
                  </span>
                </span>
                <PosChevronRightIcon className="pos-setup-modal-row__chevron h-[20px] w-[20px]" />
              </button>

              <div className="pos-setup-note">
                <span className={summaryLabelClass}>Note</span>
                <strong>
                  Changing these details may affect the items in your cart.
                </strong>
              </div>
            </div>

            <div className="desktop-modal-footer">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setCheckoutSetupModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => setCheckoutSetupModalOpen(false)}
              >
                Apply Changes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PickerModal
        open={customerModalOpen}
        title="Select Customer"
        variant="customer"
        search={customerSearch}
        placeholder="Search customer, code, address, points, or balance"
        emptyLabel="No matching customers found."
        options={filteredCustomers}
        selectedId={selectedCustomerId}
        hideEmptyOption
        onSearch={setCustomerSearch}
        onClose={() => setCustomerModalOpen(false)}
        onSelect={handleCustomerSelect}
        actionLabel="New Customer"
        onAction={() => setCreateCustomerModalOpen(true)}
        actionDisabled={createCustomerSaving}
      />

      {createCustomerModalOpen ? (
        <div
          className={`${posModalBackdropClass} pos-create-customer-backdrop`}
          role="presentation"
          onClick={closeCreateCustomerModal}
        >
          <div
            className="desktop-modal-card desktop-modal-card--action customers-create-modal pos-create-customer-modal"
            aria-busy={createCustomerSaving}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="desktop-modal-header customers-create-modal-head">
              <div className="customers-create-modal-hero">
                <div className="customers-create-modal-hero-icon" aria-hidden="true">
                  <PosSetupRowSymbol kind="customer" className="h-[24px] w-[24px]" />
                </div>
                <div className="min-w-0">
                  <div className="eyebrow">Offline customer</div>
                  <h3 className="m-0 text-[1.36rem] font-extrabold tracking-[-0.03em] text-[var(--text-strong)]">
                    New customer
                  </h3>
                  <p className="mt-2 text-[0.92rem] leading-6 text-[var(--muted)]">
                    Save this customer locally and use it for the current sale.
                    It will sync when desktop connects again.
                  </p>
                </div>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn"
                type="button"
                onClick={closeCreateCustomerModal}
                disabled={createCustomerSaving}
                aria-label="Close modal"
                title="Close"
              >
                <span aria-hidden="true">X</span>
              </button>
            </div>

            <div className="desktop-modal-body customers-create-modal-body">
              <div className="customers-create-modal-grid">
                <label className="grid gap-2">
                  <span className={posCreateCustomerLabelClass}>
                    Customer Name <span className="text-[var(--danger)]">*</span>
                  </span>
                  <div className={posCreateCustomerInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createCustomerName}
                      onChange={(event) => setCreateCustomerName(event.target.value)}
                      placeholder="Enter customer name"
                      disabled={createCustomerSaving}
                      autoFocus
                    />
                  </div>
                </label>
                <label className="grid gap-2">
                  <span className={posCreateCustomerLabelClass}>Address</span>
                  <div className={posCreateCustomerInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createCustomerAddress}
                      onChange={(event) => setCreateCustomerAddress(event.target.value)}
                      placeholder="Enter customer address"
                      disabled={createCustomerSaving}
                    />
                  </div>
                </label>
              </div>

              <div className="customers-create-modal-section-head">
                <div className="customers-create-modal-section-label-row">
                  <div className="customers-create-modal-section-title">Optional Details</div>
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="customers-create-modal-section-chevron">
                    <path d="m7 14 5-5 5 5" />
                  </svg>
                </div>
                <p>
                  Customer code is assigned after sync. Add more details now only
                  if they help complete this sale.
                </p>
              </div>

              <div className="customers-create-modal-grid">
                <label className="grid gap-2">
                  <span className={posCreateCustomerLabelClass}>Customer Code</span>
                  <div className={posCreateCustomerInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value="Auto-assigned after sync"
                      readOnly
                      disabled
                    />
                  </div>
                </label>
                <label className="grid gap-2">
                  <span className={posCreateCustomerLabelClass}>Gas Preference</span>
                  <div className={posCreateCustomerInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createCustomerGas}
                      onChange={(event) => setCreateCustomerGas(event.target.value)}
                      placeholder="Enter gas preference"
                      disabled={createCustomerSaving}
                    />
                  </div>
                </label>
                <label className="grid gap-2">
                  <span className={posCreateCustomerLabelClass}>Contact Number</span>
                  <div className={posCreateCustomerInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createCustomerContactNumber}
                      onChange={(event) => setCreateCustomerContactNumber(event.target.value)}
                      placeholder="Enter contact number"
                      disabled={createCustomerSaving}
                    />
                  </div>
                </label>
                <label className="grid gap-2">
                  <span className={posCreateCustomerLabelClass}>Province</span>
                  <div className={posCreateCustomerInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createCustomerProvince}
                      onChange={(event) => setCreateCustomerProvince(event.target.value)}
                      placeholder="Enter province"
                      disabled={createCustomerSaving}
                    />
                  </div>
                </label>
                <label className="grid gap-2 customers-create-modal-grid-span">
                  <span className={posCreateCustomerLabelClass}>City</span>
                  <div className={posCreateCustomerInputShellClass}>
                    <input
                      className="customers-create-modal-input"
                      value={createCustomerCity}
                      onChange={(event) => setCreateCustomerCity(event.target.value)}
                      placeholder="Enter city"
                      disabled={createCustomerSaving}
                    />
                  </div>
                </label>
              </div>
            </div>

            <div className="desktop-modal-footer customers-create-modal-footer">
              <button
                className="secondary-btn customers-create-modal-btn"
                type="button"
                onClick={closeCreateCustomerModal}
                disabled={createCustomerSaving}
              >
                Cancel
              </button>
              <button
                className="primary-btn customers-create-modal-btn"
                type="button"
                onClick={() => void handleCreateOfflineCustomer()}
                disabled={createCustomerSaving}
              >
                {createCustomerSaving ? "Saving..." : "Save Customer"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PickerModal
        open={personnelModalOpen}
        title="Select Personnel"
        variant="personnel"
        search={personnelSearch}
        placeholder="Search personnel or role"
        emptyLabel="No matching personnel found."
        options={filteredPersonnels}
        selectedId={selectedPersonnelId}
        hideEmptyOption
        onSearch={setPersonnelSearch}
        onClose={() => setPersonnelModalOpen(false)}
        onSelect={handlePersonnelSelect}
      />

      <PickerModal
        open={helperModalOpen}
        title="Select Helper"
        variant="helper"
        search={helperSearch}
        placeholder="Search helper or role"
        emptyLabel="No matching helper found."
        options={filteredHelpers}
        selectedId={selectedHelperId}
        emptyOptionLabel="No helper"
        emptyOptionHint="Helper is optional for this sale."
        onSearch={setHelperSearch}
        onClose={() => setHelperModalOpen(false)}
        onSelect={handleHelperSelect}
      />

      {itemModalOpen ? (
        <div
          className={`${posModalBackdropClass} pos-directory-backdrop`}
          onClick={() => setItemModalOpen(false)}
        >
          <div
            className="desktop-modal-card desktop-modal-card--picker pos-directory-modal pos-directory-item-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="desktop-modal-header pos-directory-header">
              <div>
                <div className="eyebrow">Selection</div>
                <h3>Select Item</h3>
              </div>
              <button
                className="secondary-btn mini-btn modal-close-icon-btn"
                type="button"
                onClick={() => setItemModalOpen(false)}
                aria-label="Close modal"
                title="Close"
              >
                <span aria-hidden="true">X</span>
              </button>
            </div>

            <div className="desktop-modal-body pos-directory-body">
              <aside className="pos-directory-sidebar pos-directory-item-sidebar">
              <SearchField
                  className="pos-directory-search"
                value={itemSearch}
                onChange={setItemSearch}
                placeholder="Search item code or name"
                autoFocus
              />

                <div className="pos-directory-filter-block">
                  <span className="pos-directory-filter-title">Categories</span>
                  <div className="pos-directory-filter-list pos-directory-item-filter-list">
                    {itemDirectoryCategoryFilters.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        className={`pos-directory-filter-btn ${itemCategoryFilter === category.id ? "is-active" : ""}`}
                        onClick={() => setItemCategoryFilter(category.id)}
                      >
                        <span className="pos-directory-filter-icon" aria-hidden="true">
                          <PosOverviewSymbol
                            kind={category.id === "ALL" ? "total" : "lines"}
                            className="h-[19px] w-[19px]"
                          />
                        </span>
                        <span>{category.label}</span>
                        <strong>{category.count}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>

              <section className="pos-directory-main">
                <div className="pos-directory-toolbar">
                  <strong>{sortedItemDirectoryProducts.length} Items found</strong>
                  <div className="pos-directory-controls">
                    <label className="pos-directory-sort">
                      <span aria-hidden="true">↕</span>
                      <select
                        value={itemPickerSortMode}
                        onChange={(event) =>
                          setItemPickerSortMode(event.target.value as ItemPickerSortMode)
                        }
                        aria-label="Sort item list"
                      >
                        <option value="NAME_ASC">
                          Sort by: {itemPickerSortLabel("NAME_ASC")}
                        </option>
                        <option value="SKU_ASC">
                          Sort by: {itemPickerSortLabel("SKU_ASC")}
                        </option>
                        <option value="PRICE_ASC">
                          Sort by: {itemPickerSortLabel("PRICE_ASC")}
                        </option>
                        <option value="PRICE_DESC">
                          Sort by: {itemPickerSortLabel("PRICE_DESC")}
                        </option>
                        <option value="STOCK_DESC">
                          Sort by: {itemPickerSortLabel("STOCK_DESC")}
                        </option>
                      </select>
                    </label>
                    <div className="pos-directory-view-toggle" aria-label="View mode">
                      <button
                        className={itemPickerViewMode === "list" ? "is-active" : ""}
                        type="button"
                        onClick={() => setItemPickerViewMode("list")}
                        aria-label="List view"
                        title="List view"
                      >
                        <span aria-hidden="true">☰</span>
                      </button>
                      <button
                        className={itemPickerViewMode === "grid" ? "is-active" : ""}
                        type="button"
                        onClick={() => setItemPickerViewMode("grid")}
                        aria-label="Grid view"
                        title="Grid view"
                      >
                        <span aria-hidden="true">▦</span>
                      </button>
                    </div>
                  </div>
                </div>

                {itemPickerViewMode === "list" ? (
                  <div className="pos-directory-table pos-directory-table--item">
                    <div className="pos-directory-table-head">
                      <span aria-hidden="true" />
                      <span>Code</span>
                      <span>Item Name</span>
                      <span>Category</span>
                      <span>Stock</span>
                      <span>Price</span>
                      <span aria-hidden="true" />
                    </div>

                    <div className="pos-directory-rows">
                      {itemDirectoryPageProducts.length === 0 ? (
                        <div className="empty-state pos-directory-empty">
                          No matching items.
                        </div>
                      ) : (
                        itemDirectoryPageProducts.map((product) => {
                          const stockTone = resolveStockTone(product);
                          const disabled = stockTone === "out";
                          return (
                            <button
                              key={product.id}
                              type="button"
                              className={`pos-directory-row pos-directory-item-row ${disabled ? "is-disabled" : ""}`}
                              onClick={() => {
                                addToCart(product);
                                setItemModalOpen(false);
                              }}
                              disabled={disabled}
                            >
                              <span className="pos-directory-avatar" aria-hidden="true">
                                <PosOverviewSymbol kind="lines" className="h-[18px] w-[18px]" />
                              </span>
                              <strong>{product.sku}</strong>
                              <span className="pos-directory-name-cell">
                              <strong>{product.name}</strong>
                              <small>
                                {product.unit}
                                {product.isLpg
                                  ? ` | Size ${formatCylinderSizeLabel(product)}`
                                  : ""}
                              </small>
                              <span className="pos-directory-inline-meta">
                                {`${product.category || "-"} | ${itemPickerStockSummary(product)} | ${fmtMoney(product.unitPrice)}`}
                              </span>
                            </span>
                              <span>{product.category || "-"}</span>
                              <span className="pos-directory-item-stock">
                                <strong>{itemPickerStockSummary(product)}</strong>
                                <small className={`stock-pill ${stockTone}`}>
                                  {resolveStockLabel(product)}
                                </small>
                              </span>
                              <span>{fmtMoney(product.unitPrice)}</span>
                              <span className="pos-directory-row-action" aria-hidden="true">
                                <PosPlusIcon className="h-[16px] w-[16px]" />
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="pos-directory-card-grid pos-directory-item-card-grid">
                    {itemDirectoryPageProducts.length === 0 ? (
                      <div className="empty-state pos-directory-empty">
                        No matching items.
                      </div>
                    ) : (
                      itemDirectoryPageProducts.map((product) => {
                        const stockTone = resolveStockTone(product);
                        const disabled = stockTone === "out";
                        return (
                          <button
                            key={product.id}
                            className={`pos-directory-card-option pos-directory-item-card-option ${disabled ? "is-disabled" : ""}`}
                            type="button"
                            onClick={() => {
                              addToCart(product);
                              setItemModalOpen(false);
                            }}
                            disabled={disabled}
                          >
                            <span className="pos-directory-avatar" aria-hidden="true">
                              <PosOverviewSymbol kind="lines" className="h-[18px] w-[18px]" />
                            </span>
                            <span className="pos-directory-item-card-main">
                              <strong>{product.name}</strong>
                              <span>{product.sku}</span>
                            </span>
                            <small className="pos-directory-item-card-meta">
                              {product.category || "-"}
                            </small>
                            <span className="pos-directory-item-card-stock">
                              <span className={`stock-pill ${stockTone}`}>
                                {resolveStockLabel(product)}
                              </span>
                              <span>{itemPickerStockSummary(product)}</span>
                            </span>
                            <span className="pos-directory-item-card-footer">
                              <strong>{fmtMoney(product.unitPrice)}</strong>
                              <span className="pos-directory-item-card-add" aria-hidden="true">
                                <PosPlusIcon className="h-[15px] w-[15px]" />
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                <div className="pos-directory-pager">
                  <span>
                    Showing{" "}
                    {sortedItemDirectoryProducts.length === 0
                      ? 0
                      : itemDirectoryStartIndex + 1}{" "}
                    to{" "}
                    {Math.min(
                      itemDirectoryStartIndex + itemPickerPageSize,
                      sortedItemDirectoryProducts.length,
                    )}{" "}
                    of {sortedItemDirectoryProducts.length} items
                  </span>
                  <div className="pos-directory-page-buttons">
                    <button
                      type="button"
                      onClick={() =>
                        setItemPickerCurrentPage((page) => Math.max(1, page - 1))
                      }
                      disabled={itemDirectoryCurrentPage <= 1}
                      aria-label="Previous page"
                    >
                      ‹
                    </button>
                    {itemDirectoryPageButtons.map((page) => (
                      <button
                        key={page}
                        className={itemDirectoryCurrentPage === page ? "is-active" : ""}
                        type="button"
                        onClick={() => setItemPickerCurrentPage(page)}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setItemPickerCurrentPage((page) =>
                          Math.min(itemDirectoryTotalPages, page + 1),
                        )
                      }
                      disabled={itemDirectoryCurrentPage >= itemDirectoryTotalPages}
                      aria-label="Next page"
                    >
                      ›
                    </button>
                  </div>
                  <label className="pos-directory-page-size">
                    <select
                      value={itemPickerPageSize}
                      onChange={(event) =>
                        setItemPickerPageSize(Number(event.target.value))
                      }
                      aria-label="Rows per page"
                    >
                      {PICKER_PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size} per page
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
            </div>

            <div className="desktop-modal-footer pos-directory-footer">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setItemModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {queuePreviewOpen ? (
        <div
          className={posModalBackdropClass}
          onClick={() => setQueuePreviewOpen(false)}
        >
          <div
            className="desktop-modal-card desktop-modal-card--action"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={posModalToolbarClass}>
              <div className="panel-head pos-sheet-head">
                <div>
                  <div className="eyebrow">Print Preview</div>
                  <h3>Add to Queue</h3>
                  <p className="startup-helper-copy pos-payment-copy">
                    Review the queued order preview before saving it for later
                    recall.
                  </p>
                </div>
                <button
                  className="secondary-btn mini-btn"
                  type="button"
                  onClick={() => setQueuePreviewOpen(false)}
                >
                  Back
                </button>
              </div>
            </div>

            <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-4">
              <section className={shellCardClass}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow">Print Preview</div>
                    <h4>
                      {selectedCustomer?.label?.trim() || "Select customer"}
                    </h4>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex min-h-[30px] items-center justify-center rounded-full bg-[rgba(236,242,248,0.96)] px-3 text-[0.8rem] font-bold text-[var(--muted-strong)]">
                      {orderType}
                    </span>
                    <span className="inline-flex min-h-[30px] items-center justify-center rounded-full bg-[rgba(236,242,248,0.96)] px-3 text-[0.8rem] font-bold text-[var(--muted-strong)]">
                      {cart.length} item(s)
                    </span>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className={summaryTileClass}>
                    <span className={summaryLabelClass}>Address</span>
                    <strong className={summaryValueClass}>
                      {selectedCustomer?.address?.trim() ?? ""}
                    </strong>
                  </div>
                  <div className={summaryTileClass}>
                    <span className={summaryLabelClass}>Items</span>
                    <strong className={summaryValueClass}>{cart.length}</strong>
                  </div>
                  <div className={summaryTileClass}>
                    <span className={summaryLabelClass}>Total</span>
                    <strong className={summaryValueClass}>
                      {fmtMoney(total)}
                    </strong>
                  </div>
                </div>
              </section>

              <section className={shellCardClass}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow">Details</div>
                    <h4>Queued line items</h4>
                  </div>
                </div>
                {queuePreviewLines.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-[var(--border-soft)] bg-[rgba(255,255,255,0.78)] px-4 py-5 text-sm text-[var(--muted)]">
                    No items in this order.
                  </div>
                ) : (
                  <div className="mt-4 grid gap-3">
                    {queuePreviewLines.map((line, index) => (
                      <div key={line.id} className="desktop-line-item-row">
                        <div className="desktop-line-item-row__main">
                          <div className="desktop-line-item-row__title">
                            {index + 1}. {line.name}
                          </div>
                          {line.subtitle ? (
                            <div className="desktop-line-item-row__meta">
                              {line.subtitle}
                            </div>
                          ) : null}
                        </div>
                        <div className="desktop-line-item-row__stats">
                          <div className="desktop-line-item-row__stat">
                            <span className="desktop-line-item-row__stat-label">
                              Qty
                            </span>
                            <strong>{line.qty}</strong>
                          </div>
                          <div className="desktop-line-item-row__stat">
                            <span className="desktop-line-item-row__stat-label">
                              Amount
                            </span>
                            <strong>{fmtMoney(line.amount)}</strong>
                          </div>
                        </div>
                      </div>
                    ))}
                    {cart.length > queuePreviewLines.length ? (
                      <div className="rounded-[20px] border border-dashed border-[var(--border-soft)] bg-[rgba(255,255,255,0.78)] px-4 py-4 text-sm text-[var(--muted)]">
                        +{cart.length - queuePreviewLines.length} more item(s)
                      </div>
                    ) : null}
                  </div>
                )}
              </section>

              <section className={shellCardClass}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow">Summary</div>
                    <h4>Queued sale totals</h4>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className={summaryTileClass}>
                    <span className={summaryLabelClass}>Subtotal</span>
                    <strong className={summaryValueClass}>
                      {fmtMoney(subtotal)}
                    </strong>
                  </div>
                  <div className={summaryTileClass}>
                    <span className={summaryLabelClass}>Total</span>
                    <strong className={summaryValueClass}>
                      {fmtMoney(total)}
                    </strong>
                  </div>
                </div>
              </section>
            </div>

            <div className="desktop-modal-footer">
              <button
                className="secondary-btn"
                type="button"
                onClick={() => setQueuePreviewOpen(false)}
              >
                Back
              </button>
              <button
                className="secondary-btn"
                type="button"
                onClick={() =>
                  void printQueueOrderReceipt(
                    buildQueueOrderReceiptPayload({
                      queueId: `preview-${Date.now()}`,
                      queueLabel: buildHeldCartLabel(),
                      createdAt: new Date().toISOString(),
                      customerName: selectedCustomer?.label ?? null,
                      customerAddress:
                        selectedCustomer?.address?.trim() ?? null,
                      saleType: orderType,
                      paymentMode,
                      paymentMethod,
                      paidAmount: Number(parsedPaidAmount.toFixed(2)),
                      discountAmount: discount,
                      deliveryFee: deliveryFeeValue,
                      notes: notes.trim() || null,
                      personnelName: selectedPersonnel?.label ?? null,
                      helperName: selectedHelper?.label ?? null,
                      lines: cart.map((line) => ({
                        productId: line.id,
                        name: line.name,
                        subtitle: line.isLpg
                          ? [
                              line.cylinderFlow === "REFILL_EXCHANGE"
                                ? "Refill"
                                : line.cylinderFlow === "NON_REFILL"
                                  ? "Non-Refill"
                                  : null,
                              formatCylinderSizeLabel(line),
                            ]
                              .filter(Boolean)
                              .join(" | ")
                          : formatCylinderSizeLabel(line),
                        quantity: line.quantity,
                        unitPrice: line.unitPrice,
                      })),
                    }),
                  )
                }
              >
                Print
              </button>
              <button
                className="primary-btn"
                type="button"
                onClick={() => void holdCurrentCart()}
              >
                Add to Queue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {heldCartModalOpen ? (
        <div
          className={posModalBackdropClass}
          onClick={() => setHeldCartModalOpen(false)}
        >
          <div
            className={posModalCardClass}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={`${posModalToolbarClass} queue-orders-modal-toolbar`}>
              <div className="queue-orders-modal-hero">
                <div className="queue-orders-modal-hero-main">
                  <div className="queue-orders-modal-icon" aria-hidden="true">
                    <span>{"≡"}</span>
                  </div>
                  <div>
                    <div className="eyebrow">Selection</div>
                    <h3>Queue Orders</h3>
                  </div>
                </div>
                <button
                  className="secondary-btn mini-btn modal-close-icon-btn queue-orders-modal-close-btn"
                  type="button"
                  onClick={() => setHeldCartModalOpen(false)}
                  aria-label="Close modal"
                  title="Close"
                >
                  <span aria-hidden="true">X</span>
                </button>
              </div>

              <p className="queue-orders-modal-copy">
                Search and select a queued order to proceed.
              </p>

              <div
                className={`queue-orders-toolbar-grid ${queueOrderFilteringAddonEnabled ? "" : "queue-orders-toolbar-grid--single"}`}
              >
                <SearchField
                  className="queue-orders-search"
                  value={heldCartSearch}
                  onChange={(value) => {
                    setHeldCartSearch(value);
                    setHeldCartCurrentPage(1);
                  }}
                  placeholder="Search queued order, customer, or amount..."
                  autoFocus
                />

                {queueOrderFilteringAddonEnabled ? (
                  <div className="queue-orders-filter-grid">
                    <label className="queue-orders-filter-field">
                      <span>Province</span>
                      <select
                        className="queue-orders-select"
                        value={heldCartProvinceFilter}
                        onChange={(event) => {
                          setHeldCartProvinceFilter(event.target.value);
                          setHeldCartCityFilter("ALL");
                          setHeldCartCurrentPage(1);
                        }}
                      >
                        <option value="ALL">All provinces</option>
                        {heldCartProvinceOptions.map((province) => (
                          <option key={province} value={province}>
                            {province}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="queue-orders-filter-field">
                      <span>City</span>
                      <select
                        className="queue-orders-select"
                        value={heldCartCityFilter}
                        onChange={(event) => {
                          setHeldCartCityFilter(event.target.value);
                          setHeldCartCurrentPage(1);
                        }}
                      >
                        <option value="ALL">All cities</option>
                        {heldCartCityOptions.map((city) => (
                          <option key={city} value={city}>
                            {city}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="desktop-modal-body queue-orders-modal-body">
              <div className="queue-orders-results-row">
                <div className="queue-orders-results-count">
                  <strong>{sortedHeldCarts.length}</strong>
                  <span>
                    queued order{sortedHeldCarts.length === 1 ? "" : "s"} found
                  </span>
                </div>

                <label className="queue-orders-sort-field">
                  <span>Sort by</span>
                  <select
                    className="queue-orders-select"
                    value={heldCartSortMode}
                    onChange={(event) => {
                      setHeldCartSortMode(event.target.value as QueueOrderSortMode);
                      setHeldCartCurrentPage(1);
                    }}
                  >
                    <option value="queue-time-newest">Queue time (Newest)</option>
                    <option value="queue-time-oldest">Queue time (Oldest)</option>
                    <option value="amount-high-low">Amount (High to Low)</option>
                    <option value="amount-low-high">Amount (Low to High)</option>
                  </select>
                </label>
              </div>

              {pagedHeldCarts.length === 0 ? (
                <div className="empty-state queue-orders-empty-state">
                  No queued orders match this filter yet.
                </div>
              ) : (
                <div className="queue-orders-list">
                  {pagedHeldCarts.map((held) => {
                    const primaryName = held.customerName?.trim() || held.label;
                    const { date, time } = formatHeldCartDateTime(held.updatedAt);
                    const avatarTone = getHeldCartAvatarTone(primaryName);
                    const totalAmount = getHeldCartTotal(held);
                    const addressLine = [held.customerProvince, held.customerCity]
                      .filter((value): value is string => Boolean(value && value.trim()))
                      .join(", ");

                    return (
                      <div key={held.id} className={`queue-orders-card queue-orders-card--${avatarTone}`}>
                        <div className="queue-orders-card-main">
                          <div className={`queue-orders-avatar queue-orders-avatar--${avatarTone}`} aria-hidden="true">
                            {primaryName.trim().charAt(0).toUpperCase() || "#"}
                          </div>
                          <div className="queue-orders-card-title">
                            <strong>{primaryName}</strong>
                            <span className="queue-orders-card-time">
                              {time}
                            </span>
                          </div>
                        </div>

                        <div className="queue-orders-card-meta">
                          <div className="queue-orders-card-meta-item">
                            <span>Lines</span>
                            <strong>{held.lines.length} line{held.lines.length === 1 ? "" : "s"}</strong>
                          </div>
                          <div className="queue-orders-card-meta-item">
                            <span>Date</span>
                            <strong>{date}</strong>
                            <span>{time}</span>
                          </div>
                          {queueOrderFilteringAddonEnabled && addressLine ? (
                            <div className="queue-orders-card-meta-item">
                              <span>Address</span>
                              <strong>{addressLine}</strong>
                            </div>
                          ) : null}
                        </div>

                        <div className="queue-orders-card-amount">
                          <span>Amount</span>
                          <strong>{fmtMoney(totalAmount)}</strong>
                        </div>

                        <div className="queue-orders-card-actions">
                          <button
                            type="button"
                            className="queue-orders-action-btn queue-orders-action-btn--secondary"
                            onClick={() => {
                              const customerOption = held.customerId
                                ? customers.find(
                                    (customer) => customer.id === held.customerId,
                                  ) ?? null
                                : null;
                              void printQueueOrderReceipt(
                                buildQueueOrderReceiptPayload({
                                  queueId: held.id,
                                  queueLabel: held.label,
                                  createdAt: held.createdAt,
                                  customerName: held.customerName,
                                  customerAddress:
                                    customerOption?.address?.trim() ?? null,
                                  saleType: held.saleType,
                                  paymentMode: held.paymentMode ?? "FULL",
                                  paymentMethod: held.paymentMethod,
                                  paidAmount: Number(
                                    (held.paidAmount ?? 0).toFixed(2),
                                  ),
                                  discountAmount: Number(
                                    (held.discountAmount ?? 0).toFixed(2),
                                  ),
                                  deliveryFee: Number(
                                    (held.deliveryFee ?? 0).toFixed(2),
                                  ),
                                  notes: held.notes ?? null,
                                  personnelName: held.personnelName ?? null,
                                  helperName: held.helperName ?? null,
                                  lines: held.lines.map((line) => ({
                                    productId: line.productId,
                                    name: line.productName,
                                    subtitle: buildHeldCartLineSubtitle(line),
                                    quantity: line.quantity,
                                    unitPrice: line.unitPrice,
                                  })),
                                }),
                              );
                            }}
                          >
                            Print
                          </button>
                          <button
                            type="button"
                            className="queue-orders-action-btn queue-orders-action-btn--danger"
                            onClick={() => {
                              const confirmed = window.confirm(
                                `Delete queued order ${held.label}?`,
                              );
                              if (!confirmed) {
                                return;
                              }
                              void (async () => {
                                await desktopHeldCartService.removeHeldCart(
                                  held.id,
                                );
                                await refreshHeldCarts();
                                showSuccess(
                                  `Queue order ${held.label} was removed.`,
                                );
                              })();
                            }}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="queue-orders-action-btn queue-orders-action-btn--primary"
                            onClick={() => {
                              void recallHeldCart(held);
                              setHeldCartModalOpen(false);
                            }}
                          >
                            Recall
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {sortedHeldCarts.length > 0 ? (
                <div className="lending-records-footer queue-orders-footer">
                  <div className="lending-records-footer-summary queue-orders-footer-summary">
                    Showing {pageStartIndex + 1} to{" "}
                    {Math.min(safeHeldCartPage * heldCartPageSize, sortedHeldCarts.length)} of{" "}
                    {sortedHeldCarts.length} orders
                  </div>
                  <div className="lending-records-pager">
                    <button
                      className="lending-records-page-btn"
                      type="button"
                      onClick={() => setHeldCartCurrentPage(1)}
                      disabled={safeHeldCartPage === 1}
                      aria-label="First page"
                    >
                      {"<"}
                    </button>
                    <button
                      className="lending-records-page-btn"
                      type="button"
                      onClick={() =>
                        setHeldCartCurrentPage((page) => Math.max(1, page - 1))
                      }
                      disabled={safeHeldCartPage === 1}
                      aria-label="Previous page"
                    >
                      {"<"}
                    </button>
                    {visibleHeldCartPageButtons.map((page) => (
                      <button
                        key={page}
                        className={`lending-records-page-btn ${
                          page === safeHeldCartPage ? "active" : ""
                        }`}
                        type="button"
                        onClick={() => setHeldCartCurrentPage(page)}
                        aria-current={page === safeHeldCartPage ? "page" : undefined}
                        aria-label={`Page ${page}`}
                      >
                        {page}
                      </button>
                    ))}
                    <button
                      className="lending-records-page-btn"
                      type="button"
                      onClick={() =>
                        setHeldCartCurrentPage((page) =>
                          Math.min(totalHeldCartPages, page + 1),
                        )
                      }
                      disabled={safeHeldCartPage === totalHeldCartPages}
                      aria-label="Next page"
                    >
                      {">"}
                    </button>
                    <button
                      className="lending-records-page-btn"
                      type="button"
                      onClick={() => setHeldCartCurrentPage(totalHeldCartPages)}
                      disabled={safeHeldCartPage === totalHeldCartPages}
                      aria-label="Last page"
                    >
                      {">"}
                    </button>
                  </div>
                  <label className="lending-records-page-size queue-orders-page-size">
                    <span>Rows per page</span>
                    <select
                      value={heldCartPageSize}
                      onChange={(event) => {
                        setHeldCartPageSize(Number(event.target.value));
                        setHeldCartCurrentPage(1);
                      }}
                    >
                      {QUEUE_ORDER_PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size} per page
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {paymentModalOpen ? (
        <div
          className={`${posModalBackdropClass} pos-payment-backdrop`}
          onClick={() => setPaymentModalOpen(false)}
        >
          <div
            className="desktop-modal-card desktop-modal-card--action pos-payment-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={posModalToolbarClass}>
              <div className="panel-head pos-sheet-head">
                <div>
                  <div className="eyebrow">Checkout</div>
                  <h3>Payment Details</h3>
                </div>
                <button
                  className="secondary-btn mini-btn modal-close-icon-btn"
                  type="button"
                  onClick={() => setPaymentModalOpen(false)}
                  aria-label="Close modal"
                  title="Close"
                >
                  <span aria-hidden="true">X</span>
                </button>
              </div>
            </div>

            <div className="desktop-modal-body pos-payment-modal-body">
              <div className="pos-payment-notice">
                <div className="pos-payment-notice-icon" aria-hidden="true">
                  <PosOverviewSymbol
                    kind="shift"
                    className="h-[22px] w-[22px]"
                  />
                </div>
                <div className="pos-payment-notice-copy">
                  <strong>
                    Full payment: amount tendered can be equal to or higher than
                    total.
                  </strong>
                  <span>{paymentHint}</span>
                </div>
              </div>

              <div className="pos-payment-info-grid">
                <div className={`${summaryTileClass} pos-payment-info-tile`}>
                  <div
                    className="pos-payment-info-icon pos-payment-info-icon--blue"
                    aria-hidden="true"
                  >
                    <PosOverviewSymbol
                      kind="route"
                      className="h-[20px] w-[20px]"
                    />
                  </div>
                  <div className="pos-payment-info-copy">
                    <span className="pos-payment-info-label">Order Type</span>
                    <strong className="pos-payment-info-value">
                      {orderType}
                    </strong>
                  </div>
                </div>
                <div className={`${summaryTileClass} pos-payment-info-tile`}>
                  <div
                    className="pos-payment-info-icon pos-payment-info-icon--green"
                    aria-hidden="true"
                  >
                    <PosOverviewSymbol
                      kind="total"
                      className="h-[20px] w-[20px]"
                    />
                  </div>
                  <div className="pos-payment-info-copy">
                    <span className="pos-payment-info-label">Customer</span>
                    <strong className="pos-payment-info-value">
                      {selectedCustomer?.label ?? "-"}
                    </strong>
                  </div>
                </div>
                <div className={`${summaryTileClass} pos-payment-info-tile`}>
                  <div
                    className="pos-payment-info-icon pos-payment-info-icon--purple"
                    aria-hidden="true"
                  >
                    <PosOverviewSymbol
                      kind="shift"
                      className="h-[20px] w-[20px]"
                    />
                  </div>
                  <div className="pos-payment-info-copy">
                    <span className="pos-payment-info-label">Address</span>
                    <strong className="pos-payment-info-value">
                      {selectedCustomer?.address?.trim() || "-"}
                    </strong>
                  </div>
                </div>
                <div className={`${summaryTileClass} pos-payment-info-tile`}>
                  <div
                    className="pos-payment-info-icon pos-payment-info-icon--orange"
                    aria-hidden="true"
                  >
                    <PosOverviewSymbol
                      kind="route"
                      className="h-[20px] w-[20px]"
                    />
                  </div>
                  <div className="pos-payment-info-copy">
                    <span className="pos-payment-info-label">
                      Current Balance
                    </span>
                    <strong className="pos-payment-info-value">
                      {fmtMoney(selectedCustomer?.balance ?? 0)}
                    </strong>
                  </div>
                </div>
                <div className={`${summaryTileClass} pos-payment-info-tile`}>
                  <div
                    className="pos-payment-info-icon pos-payment-info-icon--blue"
                    aria-hidden="true"
                  >
                    <PosOverviewSymbol
                      kind="total"
                      className="h-[20px] w-[20px]"
                    />
                  </div>
                  <div className="pos-payment-info-copy">
                    <span className="pos-payment-info-label">Personnel</span>
                    <strong className="pos-payment-info-value">
                      {selectedPersonnel?.label ?? "-"}
                    </strong>
                  </div>
                </div>
                <div className={`${summaryTileClass} pos-payment-info-tile`}>
                  <div
                    className="pos-payment-info-icon pos-payment-info-icon--green"
                    aria-hidden="true"
                  >
                    <PosOverviewSymbol
                      kind="shift"
                      className="h-[20px] w-[20px]"
                    />
                  </div>
                  <div className="pos-payment-info-copy">
                    <span className="pos-payment-info-label">Helper</span>
                    <strong className="pos-payment-info-value">
                      {selectedHelper?.label ?? "-"}
                    </strong>
                  </div>
                </div>
              </div>

              {currentPointsBalance > 0 ? (
                <div className="payment-section-card pos-payment-section pos-payment-reward-card">
                  <div>
                    <strong>Reward Redemption</strong>
                    <p>
                      Available points: {currentPointsBalance}. Choose one
                      reward to queue with this sale and apply on sync.
                    </p>
                  </div>
                  {rewardsLoading ? (
                    <div className="empty-state">Loading rewards...</div>
                  ) : rewardEligibleOptions.length === 0 ? (
                    <div className="empty-state">
                      No active checkout rewards are available for this customer
                      and branch.
                    </div>
                  ) : (
                    <div className="filter-chip-row reward-chip-row">
                      {rewardEligibleOptions.map((reward) => {
                        const active = reward.id === selectedRewardId;
                        return (
                          <button
                            key={reward.id}
                            type="button"
                            className={`filter-chip reward-chip ${active ? "active" : ""}`}
                            onClick={() => handleSelectReward(reward)}
                            disabled={saving}
                          >
                            <strong>{reward.name}</strong>
                            <span>
                              {reward.pointsCost} pts
                              {reward.rewardType === "FREE_PRODUCT" ||
                              reward.rewardType === "FREE_REFILL"
                                ? ` | Save ${fmtMoney(resolveRewardCartDiscount(reward, cart))}`
                                : reward.discountValue !== null
                                  ? ` | ${reward.rewardType === "DISCOUNT_PERCENT" ? `${reward.discountValue}%` : fmtMoney(reward.discountValue)}`
                                  : ""}
                            </span>
                          </button>
                        );
                      })}
                      {selectedReward ? (
                        <button
                          type="button"
                          className="filter-chip reward-chip"
                          onClick={() => setSelectedRewardId("")}
                          disabled={saving}
                        >
                          <strong>Clear Reward</strong>
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="payment-section-card pos-payment-section pos-payment-form-card pos-payment-grid">
                <div className="pos-payment-details-grid">
                  <div className="pos-payment-details-column">
                    <label className="payment-field-stack">
                      <span>Payment Type</span>
                      <div className="flow-chip-row payment-mode-row">
                        {(["FULL", "PARTIAL"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            className={`flow-chip ${paymentMode === mode ? "active" : ""}`}
                            onClick={() => {
                              setPaymentMode(mode);
                              setPaidAmount("0");
                            }}
                          >
                            {mode === "FULL" ? "Full" : "Partial"}
                          </button>
                        ))}
                      </div>
                    </label>

                    <label className="payment-field-stack">
                      <span>Payment method</span>
                      <select
                        value={paymentMethod}
                        onChange={(event) =>
                          setPaymentMethod(
                            event.target.value as DesktopPaymentMethod,
                          )
                        }
                      >
                        <option value="CASH">Cash</option>
                        <option value="CARD">Card</option>
                        <option value="E_WALLET">E-Wallet</option>
                      </select>
                    </label>

                    <label className="payment-field-stack">
                      <span>
                        {paymentMode === "FULL"
                          ? "Amount tendered"
                          : "Amount collected"}
                      </span>
                      <div className="flex items-center gap-2">
                        <input
                          className="flex-1"
                          inputMode="decimal"
                          value={paidAmount}
                          onChange={(event) =>
                            setPaidAmount(
                              sanitizeDecimalInput(event.target.value),
                            )
                          }
                          onBlur={() => {
                            const normalized =
                              parseNonNegativeDecimalInput(paidAmount);
                            setPaidAmount(
                              normalized === 0 ? "0" : normalized.toFixed(2),
                            );
                          }}
                          placeholder="0.00"
                        />
                        <button
                          type="button"
                          className="secondary-btn px-3 py-2"
                          onClick={() => setPaidAmount(total.toFixed(2))}
                          disabled={saving}
                        >
                          Exact
                        </button>
                      </div>
                    </label>

                    {orderType === "DELIVERY" ? (
                      <label className="payment-field-stack pos-payment-delivery-field">
                        <span>Delivery Fee</span>
                        <input
                          inputMode="decimal"
                          value={deliveryFee}
                          onChange={(event) =>
                            setDeliveryFee(
                              sanitizeDecimalInput(event.target.value),
                            )
                          }
                          onBlur={() => {
                            const normalized =
                              parseNonNegativeDecimalInput(deliveryFee);
                            setDeliveryFee(
                              normalized === 0 ? "0" : normalized.toFixed(2),
                            );
                          }}
                          placeholder="0.00"
                        />
                      </label>
                    ) : null}
                  </div>

                  <div className="pos-payment-details-column pos-payment-details-column--divider">
                    {receiptAmountPrivacyAddonEnabled ? (
                      <label className="payment-field-stack">
                        <span>Receipt Amount Privacy</span>
                        <button
                          type="button"
                          className={`flow-chip ${hideReceiptAmounts ? "active" : ""}`}
                          onClick={() => {
                            const blocked =
                              paymentMode === "PARTIAL" ||
                              creditBalance > 0.0001;
                            if (blocked) {
                              setHideReceiptAmounts(false);
                              showInfo(
                                "Receipt amount privacy is not available for sales with balance due.",
                              );
                              return;
                            }
                            setHideReceiptAmounts((prev) => !prev);
                          }}
                          disabled={saving}
                        >
                          {hideReceiptAmounts
                            ? "Hide Amounts: ON"
                            : "Hide Amounts: OFF"}
                        </button>
                      </label>
                    ) : null}

                    <label className="payment-field-stack">
                      <span>Discount Amount</span>
                      <input
                        inputMode="decimal"
                        value={discountAmount}
                        onChange={(event) =>
                          setDiscountAmount(
                            sanitizeDecimalInput(event.target.value),
                          )
                        }
                        onBlur={() => {
                          const normalized =
                            parseNonNegativeDecimalInput(discountAmount);
                          setDiscountAmount(
                            normalized === 0 ? "0" : normalized.toFixed(2),
                          );
                        }}
                        placeholder="0.00"
                      />
                    </label>

                    <label className="full-width-field payment-field-stack pos-payment-notes">
                      <span>Notes (Optional)</span>
                      <textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Delivery note, cashier note, or reminder"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="payment-section-card pos-payment-section pos-payment-summary-card">
                <div className="pos-payment-summary-head">
                  <div>
                    <strong>Sale Summary</strong>
                    <p>Review the final amounts before completing this sale.</p>
                  </div>
                </div>
                <div className="pos-payment-summary-amount-grid">
                  <div className={`${posMetricCardClass} pos-payment-summary-amount-card`}>
                    <span className={posMetricLabelClass}>Paid</span>
                    <strong className={posMetricValueClass}>
                      {formatAmountForSummary(parsedPaidAmount)}
                    </strong>
                  </div>
                  <div className={`${posMetricCardClass} pos-payment-summary-amount-card`}>
                    <span className={posMetricLabelClass}>Change</span>
                    <strong className={posMetricValueClass}>
                      {formatAmountForSummary(changeAmount)}
                    </strong>
                  </div>
                  <div className={`${posMetricCardClass} pos-payment-summary-amount-card`}>
                    <span className={posMetricLabelClass}>Credit</span>
                    <strong className={posMetricValueClass}>
                      {formatAmountForSummary(creditBalance)}
                    </strong>
                  </div>
                  <div className={`${posMetricCardClass} pos-payment-summary-amount-card`}>
                    <span className={posMetricLabelClass}>Total</span>
                    <strong className={posMetricValueClass}>
                      {formatAmountForSummary(total)}
                    </strong>
                  </div>
                </div>
                <div className="pos-payment-summary-meta-grid">
                  <div className="pos-payment-summary-meta-col">
                    <span>Items: {cart.length}</span>
                    <span>Subtotal: {formatAmountForSummary(subtotal)}</span>
                    {discount > 0 ? (
                      <span>Discount: {formatAmountForSummary(discount)}</span>
                    ) : null}
                    {orderType === "DELIVERY" ? (
                      <span>
                        Delivery Fee: {formatAmountForSummary(deliveryFeeValue)}
                      </span>
                    ) : null}
                  </div>
                  <div className="pos-payment-summary-meta-col">
                    <span>
                      Applied Payment:{" "}
                      {formatAmountForSummary(appliedPaidAmount)}
                    </span>
                    <span>Mode: {paymentMode}</span>
                    {selectedReward ? (
                      <span>Reward: {selectedReward.name}</span>
                    ) : null}
                  </div>
                  <div className="pos-payment-summary-meta-col">
                    <span>
                      Credit Due: {formatAmountForSummary(creditBalance)}
                    </span>
                  </div>
                </div>
              </div>

              {cartWarnings.length > 0 ? (
                <div className="message-banner stock-warning-banner">
                  {cartWarnings[0]}
                </div>
              ) : null}

            </div>

            <div className="desktop-modal-footer pos-payment-footer">
              <div className="pos-payment-footer-stack">
                <button
                  className="secondary-btn checkout-btn checkout-btn-print-inline"
                  type="button"
                  onClick={() => void completeCheckout(true)}
                  disabled={
                    saving ||
                    !cart.length ||
                    cartWarnings.length > 0 ||
                    !paymentReady
                  }
                >
                  {saving ? "Saving..." : "Complete & Print Receipt"}
                </button>
                <button
                  className="secondary-btn checkout-btn checkout-btn-support checkout-btn-danger"
                  type="button"
                  onClick={promptClearCurrentOrder}
                  disabled={saving || !hasDraftToClear}
                >
                  Clear Order
                </button>
                <button
                  className="primary-btn checkout-btn"
                  type="button"
                  onClick={() => void completeCheckout(false)}
                  disabled={
                    saving ||
                    !cart.length ||
                    cartWarnings.length > 0 ||
                    !paymentReady
                  }
                >
                  {saving ? "Saving..." : "Complete Sale"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {saleSuccessModal ? (
        <div
          className="desktop-modal-backdrop pos-sale-success-backdrop"
          onClick={() => undefined}
        >
          <div
            className="pos-sale-success-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-sale-success-title"
            aria-describedby="pos-sale-success-copy"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pos-sale-success-body">
              <div className="pos-sale-success-icon-shell" aria-hidden="true">
                <svg
                  viewBox="0 0 64 64"
                  fill="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    fill="#ffffff"
                    fillOpacity="0.14"
                  />
                  <path
                    d="M27.2 41.5 18.7 33l4.8-4.8 3.7 3.7 12.3-12.3 4.8 4.8-17.1 17.1Z"
                    fill="#fff"
                  />
                </svg>
              </div>

              <div className="pos-sale-success-copy-stack">
                <span className="eyebrow pos-sale-success-eyebrow">
                  POS sale complete
                </span>
                <h3
                  id="pos-sale-success-title"
                  className="pos-sale-success-title"
                >
                  Payment Successful
                </h3>
                <p id="pos-sale-success-copy" className="pos-sale-success-copy">
                  {saleSuccessModal.message}
                </p>
              </div>

              <div className="pos-sale-success-details">
                <div className="pos-sale-success-detail">
                  <span>Receipt</span>
                  <strong>{saleSuccessModal.receiptNumber}</strong>
                </div>
                <div className="pos-sale-success-detail">
                  <span>Payment Method</span>
                  <strong>{saleSuccessModal.paymentMethodLabel}</strong>
                </div>
              </div>

              {saleSuccessModal.note ? (
                <div className="pos-sale-success-note">
                  {saleSuccessModal.note}
                </div>
              ) : null}
            </div>

            <div className="pos-sale-success-footer">
              <button
                className="primary-btn pos-sale-success-continue-btn"
                type="button"
                onClick={closeSaleSuccessModal}
                autoFocus
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
