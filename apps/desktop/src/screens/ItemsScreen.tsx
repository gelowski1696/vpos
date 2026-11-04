import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  parseDesktopPosPriceLists,
  resolveDesktopUnitPrice,
  type DesktopMasterDataRow
} from '@vpos/desktop-core';
import type { OutboxItem } from '@vpos/shared-types';
import type {
  DesktopAppState,
  DesktopCatalogProduct,
  DesktopSaleLine,
  DesktopLendingDetail,
  DesktopLendingRecord,
  DesktopLpgItemActionRecord
} from '../db/schema';
import { SearchField } from '../components/inputs/SearchField';
import { desktopDb } from '../db/sqlite';
import { desktopAuthService } from '../services/desktop-auth.service';
import { desktopMasterDataService, type TenantAddonFlags } from '../services/desktop-master-data.service';
import { desktopPurchaseOrderService } from '../services/desktop-purchase-order.service';
import { desktopStockProjectionService } from '../services/desktop-stock-projection.service';

type Props = {
  appState: DesktopAppState;
  tenantAddons?: TenantAddonFlags;
  onOpenLpgService?: (productId: string) => void;
};

type ItemDetailRecord = {
  id: string;
  itemCode: string;
  name: string;
  category: string | null;
  brand: string | null;
  unit: string;
  isLpg: boolean;
  isLendable: boolean;
  requiresReturn: boolean;
  requiresDeposit: boolean;
  defaultDepositAmount: number | null;
  lendingUnitType: string | null;
  cylinderTypeId: string | null;
  lowStockAlertQty: number | null;
  updatedAt: string | null;
};

type CylinderTypeDetail = {
  id: string;
  code: string;
  name: string;
  sizeKg: number | null;
  depositAmount: number | null;
};

type ItemPriceRule = {
  priceListId: string;
  priceListName: string;
  scope: string;
  appliesTo: string;
  flowMode: 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  unitPrice: number;
  discountCapPct: number | null;
  priority: number | null;
};

type ItemMovementRow = {
  id: string;
  created_at: string;
  movement_type: string;
  movement_detail?: string;
  reference_type: string;
  reference_id: string;
  location_name: string;
  qty_delta: number;
  qty_full_delta: number;
  qty_empty_delta: number;
  qty_after: number;
  qty_after_known?: boolean;
  qty_full_after: number;
  qty_full_after_known?: boolean;
  qty_empty_after: number;
  qty_empty_after_known?: boolean;
};

type LendingLineLike = {
  productId: string;
  qtyOpen: number;
};

type LendingRecordLike = {
  id: string;
  status: string;
  branchId: string | null;
  locationId: string | null;
  lines: LendingLineLike[];
};

type LpgItemActionLike = {
  id: string;
  actionType: string;
  productId: string;
  qty: number;
  branchId: string | null;
  locationId: string | null;
  referenceActionId: string | null;
};

type ItemCatalogRecordBadgeTone = 'full' | 'empty' | 'qoh' | 'neutral';

type ItemCatalogRecordBadge = {
  label: string;
  tone: ItemCatalogRecordBadgeTone;
};

type ItemCatalogRecordRowProps = {
  title: string;
  meta: string;
  detail?: string | null;
  badges: ItemCatalogRecordBadge[];
  refillPriceLabel?: string | null;
  nonRefillPriceLabel?: string | null;
  statusLabel: string;
  statusTone: 'out' | 'low' | 'good';
  typeLabel: string;
  typeTone: 'lpg' | 'regular';
  priceLabel: string;
  selected?: boolean;
  sizeError?: string | null;
  onClick: () => void;
};

type ItemCatalogHeaderProps = {
  branchLabel: string;
  locationLabel: string;
  categoryLabel: string;
  countLabel: string;
};

type ItemCatalogCategoryChipProps = {
  label: string;
  count: string;
  active: boolean;
  onClick: () => void;
};

type ItemCatalogOverviewMetricTone = 'out' | 'good' | 'warn' | 'pending';
type ItemCatalogOverviewMetricIcon = 'total' | 'ready' | 'low' | 'out';

type ItemCatalogOverviewMetric = {
  key: string;
  label: string;
  value: string;
  icon: ItemCatalogOverviewMetricIcon;
  tone: ItemCatalogOverviewMetricTone;
};

type ItemCatalogOverviewPanelProps = {
  title: string;
  subtitle: string;
  metrics: ItemCatalogOverviewMetric[];
  onRefresh: () => void;
  refreshDisabled: boolean;
};

type ItemDetailTab = 'OVERVIEW' | 'CYLINDER' | 'PRICING';

type ItemDetailModalProps = {
  selected: DesktopCatalogProduct;
  selectedDetail: ItemDetailRecord | null;
  selectedCylinder: CylinderTypeDetail | null;
  selectedRules: ItemPriceRule[];
  selectedLendedQty: number;
  selectedDisposedQty: number;
  selectedCylinderSizeError: string | null;
  selectedSizeLabel: string | null;
  locationLabel: string;
  onClose: () => void;
  onOpenItemHistory: () => void;
  hideItemHistoryAction?: boolean;
  onOpenLpgService?: (productId: string) => void;
};

type ItemDetailCylinderActionInput = {
  isLpg: boolean;
  hasCylinderType: boolean;
  hasCylinder: boolean;
  onOpenLpgService?: (productId: string) => void;
};

type ItemDetailFactTone = 'good' | 'neutral' | 'accent' | 'danger' | 'warn';

type ItemDetailFactRowProps = {
  label: string;
  value: string;
  icon: 'inventory' | 'ready' | 'empty' | 'link' | 'disposed' | 'low' | 'scope' | 'rules';
  tone: ItemDetailFactTone;
  detail?: string | null;
};

const DEFAULT_ITEM_LIST_PAGE_SIZE = 10;

export function getItemDetailCylinderActions(_input: ItemDetailCylinderActionInput): [] {
  return [];
}

const screenStackClass = 'flex flex-col gap-5';
const summaryStripClass = 'desktop-summary-strip grid gap-3 sm:grid-cols-2 xl:grid-cols-6';
const summaryTileClass =
  'rounded-[18px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-2.5 shadow-[0_8px_18px_rgba(17,40,58,0.04)]';
const summaryLabelClass = 'block text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[0.96rem] font-extrabold text-[var(--text-strong)]';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] p-4 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const toolbarGridClass = 'items-toolbar-grid';
const listRowClass = 'items-catalog-row';
const listRowSelectedClass = 'is-selected';
const listMetaClass = 'text-[0.9rem] text-[var(--muted)]';
const modalBackdropClass = 'desktop-modal-backdrop';
const modalCardClass =
  'desktop-modal-card desktop-modal-card--detail';
const modalToolbarClass = 'desktop-modal-header flex shrink-0 flex-col gap-4';
const detailSheetClass = 'grid gap-3 overflow-auto px-5 pb-5 pt-4';
const detailNeutralPillClass =
  'inline-flex min-h-[30px] items-center justify-center rounded-full bg-[rgba(236,242,248,0.96)] px-3 text-[0.8rem] font-bold text-[var(--muted-strong)]';
const detailStatsGridClass = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4';
const detailStatCardClass =
  'grid gap-1 rounded-[18px] border border-[var(--border)] bg-[rgba(242,246,250,0.94)] px-4 py-3';
const detailStatLabelClass = 'text-[0.82rem] font-medium text-[var(--muted)]';
const detailStatValueClass = 'text-[1rem] font-extrabold leading-tight text-[var(--text-strong)]';
const detailSectionClass =
  'grid gap-3 rounded-[20px] border border-[var(--border)] bg-[rgba(255,255,255,0.98)] px-4 py-4 shadow-[0_8px_18px_rgba(17,40,58,0.04)]';
const detailSectionHeadClass = 'grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)] lg:items-start';
const detailSectionCopyClass = 'm-0 text-[0.9rem] leading-6 text-[var(--muted)]';
const detailKvGridClass = 'grid gap-2';
const detailKvRowClass =
  'grid gap-1 border-b border-[rgba(220,230,239,0.72)] pb-2 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] sm:gap-3';
const detailKvTermClass = 'm-0 text-[0.88rem] font-medium text-[var(--muted)]';
const detailKvValueClass = 'm-0 text-[0.92rem] font-semibold leading-6 text-[var(--text-strong)]';
const detailEmptyClass =
  'rounded-[16px] border border-dashed border-[var(--border)] bg-[rgba(242,246,250,0.88)] px-4 py-4 text-[0.92rem] text-[var(--muted)]';
const detailRuleCardClass =
  'grid gap-1 rounded-[16px] border border-[var(--border)] bg-[rgba(242,246,250,0.9)] px-4 py-3';
const detailRuleTitleClass = 'text-[0.92rem] font-bold leading-5 text-[var(--text-strong)]';
const detailRuleCopyClass = 'text-[0.82rem] leading-5 text-[var(--muted)]';
const historyRowClass = 'desktop-line-item-row desktop-line-item-row--compact';
const SHIFT_SECURITY_ITEM_HISTORY_MANAGER_ROLES = new Set([
  'admin',
  'owner',
  'platform_owner',
  'supervisor'
]);

function base64UrlToBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding === 2) {
    return `${normalized}==`;
  }
  if (padding === 3) {
    return `${normalized}=`;
  }
  if (padding === 0) {
    return normalized;
  }
  return '';
}

function decodeBase64(value: string): string | null {
  if (!value) {
    return null;
  }
  try {
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return window.atob(value);
    }
    if (typeof globalThis.atob === 'function') {
      return globalThis.atob(value);
    }
  } catch {
    return null;
  }
  return null;
}

function parseAccessTokenRoles(accessToken?: string | null): string[] {
  const token = accessToken?.trim() ?? '';
  if (!token) {
    return [];
  }
  const parts = token.split('.');
  if (parts.length < 2) {
    return [];
  }
  const decoded = decodeBase64(base64UrlToBase64(parts[1] ?? ''));
  if (!decoded) {
    return [];
  }
  try {
    const payload = JSON.parse(decoded) as Record<string, unknown>;
    const rolesRaw = payload.roles;
    return Array.isArray(rolesRaw)
      ? rolesRaw.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function isCashierOnlyAccessToken(accessToken?: string | null): boolean {
  const roles = parseAccessTokenRoles(accessToken);
  return roles.includes('cashier') && !roles.some((role) => SHIFT_SECURITY_ITEM_HISTORY_MANAGER_ROLES.has(role));
}

function shouldHideItemHistoryForShiftSecurity(input: {
  tenantAddons?: TenantAddonFlags;
  accessToken?: string | null;
}): boolean {
  return input.tenantAddons?.shift_security_controls === true && isCashierOnlyAccessToken(input.accessToken);
}

function ItemCatalogIcon({
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

function ItemCatalogSymbol({
  kind,
  className = ''
}: {
  kind: ItemCatalogOverviewMetricIcon | 'inventory' | 'scope' | 'refresh' | 'link' | 'rules' | 'history' | 'empty' | 'disposed';
  className?: string;
}): JSX.Element {
  let path: ReactNode;
  if (kind === 'total' || kind === 'inventory') {
    path = (
      <>
        <path d="M4 7.5h16" />
        <path d="M6 7.5V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7.5Z" />
        <path d="M10 11h4" />
      </>
    );
  } else if (kind === 'ready') {
    path = (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12 2.2 2.2L15.5 9.5" />
      </>
    );
  } else if (kind === 'low') {
    path = (
      <>
        <path d="M12 7v5" />
        <path d="M12 16h.01" />
        <path d="M10.3 4.5 3.5 17a1.7 1.7 0 0 0 1.5 2.5h14a1.7 1.7 0 0 0 1.5-2.5l-6.8-12.5a1.7 1.7 0 0 0-3.4 0Z" />
      </>
    );
  } else if (kind === 'out') {
    path = (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M8.5 12h7" />
      </>
    );
  } else if (kind === 'scope') {
    path = (
      <>
        <path d="M12 20s6-4.4 6-10a6 6 0 1 0-12 0c0 5.6 6 10 6 10Z" />
        <circle cx="12" cy="10" r="2.2" />
      </>
    );
  } else if (kind === 'link') {
    path = (
      <>
        <path d="M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7 7L17 13" />
        <path d="M14 11a5 5 0 0 1 0 7l-1.5 1.5a5 5 0 0 1-7-7L7 11" />
      </>
    );
  } else if (kind === 'rules') {
    path = (
      <>
        <path d="M5 6h14" />
        <path d="M5 10h14" />
        <path d="M5 14h14" />
        <path d="M5 18h9" />
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
  } else if (kind === 'empty') {
    path = (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="M15 9 9 15" />
      </>
    );
  } else if (kind === 'disposed') {
    path = (
      <>
        <path d="M9 6h6" />
        <path d="M5.5 8h13" />
        <path d="M8 8v9a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 17V8" />
        <path d="M10 11v4" />
        <path d="M14 11v4" />
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
  return <ItemCatalogIcon path={path} className={className} />;
}

export function ItemCatalogRecordRow({
  title,
  meta,
  detail,
  badges,
  refillPriceLabel = null,
  nonRefillPriceLabel = null,
  statusLabel,
  statusTone,
  typeLabel,
  typeTone,
  priceLabel,
  selected = false,
  sizeError = null,
  onClick
}: ItemCatalogRecordRowProps): JSX.Element {
  return (
    <button
      type="button"
      className={`${listRowClass} items-catalog-row--compact ${selected ? listRowSelectedClass : ''}`}
      onClick={onClick}
    >
      <div className="items-list-main items-catalog-row-main">
        <div className="items-list-title-row items-catalog-row-title-line">
          <strong>{title}</strong>
          <div className={`item-type-pill ${typeTone}`}>{typeLabel}</div>
        </div>
        <span className={`${listMetaClass} items-catalog-row-meta`}>{meta}</span>
        {detail ? <span className="items-catalog-row-detail">{detail}</span> : null}
        {sizeError ? <span className="items-catalog-row-error">Size Error: {sizeError}</span> : null}
        <div className="items-catalog-metrics items-catalog-metrics--compact">
          {badges.map((badge) => (
            <span key={badge.label} className={`items-catalog-metric-chip ${badge.tone}`}>
              {badge.label}
            </span>
          ))}
        </div>
      </div>
      <div className="items-list-right items-catalog-row-side">
        <div className="items-catalog-status-row">
          <div className={`stock-pill ${statusTone}`}>{statusLabel}</div>
        </div>
        <div className="items-catalog-flow-price-row items-catalog-flow-price-row--right">
          <span className="items-catalog-flow-price-chip">
            <span className="items-catalog-flow-price-chip-label">Refill</span>
            <strong className="items-catalog-flow-price-chip-value">{refillPriceLabel || '-'}</strong>
          </span>
          <span className="items-catalog-flow-price-chip">
            <span className="items-catalog-flow-price-chip-label">Non-Refill</span>
            <strong className="items-catalog-flow-price-chip-value">{nonRefillPriceLabel || '-'}</strong>
          </span>
        </div>
      </div>
    </button>
  );
}

export function ItemCatalogHeader({
  branchLabel,
  locationLabel,
  categoryLabel,
  countLabel
}: ItemCatalogHeaderProps): JSX.Element {
  return (
    <div className="items-catalog-header items-catalog-header--compact">
      <div className="items-catalog-header-copy">
        <div className="items-catalog-header-tile" aria-hidden="true">
          <ItemCatalogIcon
            className="items-catalog-header-icon"
            path={
              <>
                <path d="M4 8.5 12 4l8 4.5-8 4.5-8-4.5Z" />
                <path d="M4 15.5 12 20l8-4.5" />
                <path d="M4 12 12 16.5 20 12" />
              </>
            }
          />
        </div>
        <div className="items-catalog-header-text">
          <div className="eyebrow">Item Catalog</div>
          <h3 className="m-0 text-[1.05rem] font-extrabold text-[var(--text-strong)]">Branch Inventory Items</h3>
          <p className="mt-2 text-[0.9rem] leading-6 text-[var(--muted)]">
            {branchLabel} {'\u2022'} {locationLabel} {'\u2022'} {categoryLabel}
          </p>
        </div>
      </div>
      <div className="items-catalog-count-pill">{countLabel}</div>
    </div>
  );
}

export function ItemCatalogCategoryChip({
  label,
  count,
  active,
  onClick
}: ItemCatalogCategoryChipProps): JSX.Element {
  return (
    <button
      type="button"
      className={`items-catalog-filter-chip ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <span className="items-catalog-filter-chip-label">{label}</span>
      <span className="items-catalog-filter-count">{count}</span>
    </button>
  );
}

function ItemDetailFactRow({
  label,
  value,
  icon,
  tone,
  detail = null
}: ItemDetailFactRowProps): JSX.Element {
  return (
    <div className="items-detail-fact-row">
      <div className={`items-detail-fact-icon ${tone}`}>
        <ItemCatalogSymbol kind={icon} className="h-[16px] w-[16px]" />
      </div>
      <div className="items-detail-fact-copy">
        <span className="items-detail-fact-label">{label}</span>
        {detail ? <span className="items-detail-fact-detail">{detail}</span> : null}
      </div>
      <strong className="items-detail-fact-value">{value}</strong>
    </div>
  );
}

function resolveFlowPriceLabel(rules: ItemPriceRule[], flowMode: 'REFILL_EXCHANGE' | 'NON_REFILL'): string | null {
  const exactRule = rules.find((rule) => rule.flowMode === flowMode);
  const fallbackRule = rules.find((rule) => rule.flowMode === 'ANY');
  const resolvedRule = exactRule ?? fallbackRule ?? null;
  return resolvedRule ? fmtMoney(resolvedRule.unitPrice) : null;
}

export function applyInventoryCatalogPricing(input: {
  catalog: DesktopCatalogProduct[];
  priceListRows: DesktopMasterDataRow[];
  branchId: string;
  defaultLpgFlow: 'NONE' | 'REFILL_EXCHANGE' | 'NON_REFILL';
  atIso?: string;
}): DesktopCatalogProduct[] {
  const branchId = input.branchId.trim();
  if (!branchId) {
    return input.catalog;
  }
  const priceLists = parseDesktopPosPriceLists(input.priceListRows);
  return input.catalog.map((product) => {
    const activeUnitPrice = resolveDesktopUnitPrice({
      productId: product.id,
      branchId,
      customer: null,
      priceLists,
      allowCustomPricing: false,
      atIso: input.atIso,
      flowMode:
        product.isLpg && input.defaultLpgFlow !== 'NONE'
          ? input.defaultLpgFlow
          : null
    });
    return activeUnitPrice === null ? product : { ...product, unitPrice: activeUnitPrice };
  });
}

export function ItemDetailModal({
  selected,
  selectedDetail,
  selectedCylinder,
  selectedRules,
  selectedLendedQty,
  selectedDisposedQty,
  selectedCylinderSizeError,
  selectedSizeLabel,
  locationLabel,
  onClose,
  onOpenItemHistory,
  hideItemHistoryAction = false,
  onOpenLpgService
}: ItemDetailModalProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<ItemDetailTab>('OVERVIEW');
  const itemCode = selectedDetail?.itemCode || selected.sku;
  const itemName = selectedDetail?.name || selected.name;
  const itemCategory = selectedDetail?.category || selected.category || 'Uncategorized';
  const sizeLabel =
    selectedSizeLabel?.trim() ||
    selected.cylinderSizeLabel?.trim() ||
    (selectedCylinder?.sizeKg !== null && selectedCylinder?.sizeKg !== undefined ? `${selectedCylinder.sizeKg} kg` : null);
  const stockTone = resolveStockTone(selected);
  const stockLabel = resolveStockLabel(selected);
  const isLpg = selected.isLpg;
  const stockFacts: ItemDetailFactRowProps[] = isLpg
    ? [
        { label: 'Opening FULL', value: formatCylinderQty(selected.qtyFull), icon: 'ready', tone: 'good' },
        { label: 'Opening EMPTY', value: formatCylinderQty(selected.qtyEmpty), icon: 'empty', tone: 'neutral' },
        { label: 'Qty On Hand', value: formatQty(selected.qtyOnHand), icon: 'inventory', tone: 'accent' },
        { label: 'Disposed Qty', value: formatQty(selectedDisposedQty), icon: 'disposed', tone: 'danger' },
        { label: 'Lended Qty', value: formatQty(selectedLendedQty), icon: 'link', tone: 'neutral' },
        { label: 'Low-stock rule', value: 'Compare FULL qty only', icon: 'low', tone: 'warn' }
      ]
    : [
        { label: 'Qty On Hand', value: formatQty(selected.qtyOnHand), icon: 'inventory', tone: 'accent' },
        { label: 'Low-stock rule', value: 'Compare Qty On Hand', icon: 'low', tone: 'warn' },
        { label: 'Stock source', value: 'Inventory balances', icon: 'rules', tone: 'neutral' },
        { label: 'Location scope', value: locationLabel || 'Not set', icon: 'scope', tone: 'accent' }
      ];
  const catalogFactsLeft = [
    { label: 'Item Code', value: itemCode },
    { label: 'Product Name', value: itemName },
    { label: 'Category', value: itemCategory },
    { label: 'Brand', value: selectedDetail?.brand || '-' },
    { label: 'Type', value: isLpg ? 'LPG' : 'Non-LPG' },
    { label: 'Lendable', value: selectedDetail ? (selectedDetail.isLendable ? 'Yes' : 'No') : '-' },
    { label: 'Requires Return', value: selectedDetail ? (selectedDetail.requiresReturn ? 'Yes' : 'No') : '-' }
  ];
  const catalogFactsRight = [
    { label: 'Requires Deposit', value: selectedDetail ? (selectedDetail.requiresDeposit ? 'Yes' : 'No') : '-' },
    {
      label: 'Default Deposit',
      value:
        selectedDetail?.defaultDepositAmount !== null && selectedDetail?.defaultDepositAmount !== undefined
          ? fmtMoney(selectedDetail.defaultDepositAmount)
          : '-'
    },
    { label: 'Lending Unit', value: selectedDetail?.lendingUnitType || selected.unit },
    { label: 'Cylinder Size', value: sizeLabel ?? '-' },
    {
      label: 'Low Stock Alert Qty',
      value:
        selectedDetail?.lowStockAlertQty !== null && selectedDetail?.lowStockAlertQty !== undefined
          ? formatQty(selectedDetail.lowStockAlertQty)
          : '-'
    },
    { label: 'Updated', value: fmtDate(selectedDetail?.updatedAt ?? null) }
  ];

  const tabItems: Array<{ key: ItemDetailTab; label: string; icon: ItemCatalogOverviewMetricIcon | 'inventory' | 'link' | 'rules' }> = [
    { key: 'OVERVIEW', label: 'Overview', icon: 'inventory' },
    { key: 'CYLINDER', label: 'Linked Cylinder', icon: 'link' },
    { key: 'PRICING', label: 'Pricing Rules', icon: 'rules' }
  ];

  return (
    <div className={modalBackdropClass} role="presentation">
      <div className={modalCardClass}>
        <div className={`${modalToolbarClass} items-detail-modal-head panel-head`}>
          <div className="grid min-w-0 gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <div className={`grid h-[84px] w-[84px] shrink-0 place-items-center rounded-[26px] border ${isLpg ? 'border-[rgba(196,220,255,0.82)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)]' : 'border-[rgba(188,210,234,0.7)] bg-[rgba(248,251,255,0.98)] text-[var(--muted-strong)]'} shadow-[0_12px_26px_rgba(17,40,58,0.06)]`}>
              <ItemCatalogSymbol kind={isLpg ? 'inventory' : 'total'} className="h-[30px] w-[30px]" />
            </div>

            <div className="min-w-0">
              <div className="eyebrow">Item Detail</div>
              <h3 className="m-0 text-[1.8rem] font-extrabold tracking-[-0.03em] text-[var(--text-strong)] sm:text-[2.05rem]">
                {itemName}
              </h3>
              <p className="mt-2 text-[0.92rem] leading-6 text-[var(--muted)]">
                {itemCode} {'\u00b7'} {itemCategory} {'\u00b7'} {selected.unit}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <div className="item-type-pill lpg">{isLpg ? 'LPG Cylinder' : 'Regular Item'}</div>
                {sizeLabel ? <div className={detailNeutralPillClass}>{sizeLabel}</div> : null}
                <div className={`stock-pill ${stockTone}`}>{stockLabel}</div>
              </div>
              {selectedCylinderSizeError ? (
                <p className="mt-3 text-[0.84rem] font-semibold leading-5 text-rose-600">Size Error: {selectedCylinderSizeError}</p>
              ) : null}
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

        <div className="desktop-modal-body items-detail-modal-body">
          <div className={detailStatsGridClass}>
            <div className={detailStatCardClass}>
              <span className={detailStatLabelClass}>Price</span>
              <strong className={detailStatValueClass}>{fmtMoney(selected.unitPrice)}</strong>
            </div>
            <div className={detailStatCardClass}>
              <span className={detailStatLabelClass}>Unit</span>
              <strong className={detailStatValueClass}>{selected.unit}</strong>
            </div>
            <div className={detailStatCardClass}>
              <span className={detailStatLabelClass}>Qty On Hand</span>
              <strong className={detailStatValueClass}>{formatQty(selected.qtyOnHand)}</strong>
            </div>
            <div className={detailStatCardClass}>
              <span className={detailStatLabelClass}>{isLpg ? 'Full / Empty' : 'Stock source'}</span>
              <strong className={detailStatValueClass}>{isLpg ? `${formatCylinderQty(selected.qtyFull)} / ${formatCylinderQty(selected.qtyEmpty)}` : 'Inventory'}</strong>
            </div>
          </div>

          <div className="items-detail-tab-strip">
            {tabItems.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`items-detail-tab-chip ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span className="items-detail-tab-icon">
                  <ItemCatalogSymbol kind={tab.icon} className="h-[16px] w-[16px]" />
                </span>
                <span>{tab.label}</span>
              </button>
            ))}
            {!hideItemHistoryAction ? (
              <button
                type="button"
                className="items-detail-tab-action"
                onClick={onOpenItemHistory}
              >
                <span className="items-detail-tab-icon">
                  <ItemCatalogSymbol kind="history" className="h-[16px] w-[16px]" />
                </span>
                <span>Open Item History</span>
              </button>
            ) : null}
          </div>

          {activeTab === 'OVERVIEW' ? (
            <div className="desktop-detail-grid">
              <section className={`${detailSectionClass} items-detail-overview-card`}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Stock Snapshot</div>
                    <h4>Current stock view</h4>
                  </div>
                  <p className={detailSectionCopyClass}>
                    {isLpg
                      ? 'LPG items use full and empty counts together with qty on hand.'
                      : 'Regular items use quantity on hand from local inventory balances.'}
                  </p>
                </div>
                <div className="items-detail-fact-grid">
                  {stockFacts.map((fact) => (
                    <ItemDetailFactRow key={fact.label} {...fact} />
                  ))}
                </div>
              </section>

              <section className={`${detailSectionClass} items-detail-overview-card`}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Catalog Information</div>
                    <h4>Item master data</h4>
                  </div>
                  <p className={detailSectionCopyClass}>Reference details for pricing, lending rules, and category setup.</p>
                </div>
                <div className="items-detail-catalog-grid">
                  <div className="items-detail-catalog-column">
                    {catalogFactsLeft.map((fact) => (
                      <div key={fact.label} className="items-detail-catalog-row">
                        <dt className="items-detail-catalog-term">{fact.label}</dt>
                        <dd className="items-detail-catalog-value">{fact.value}</dd>
                      </div>
                    ))}
                  </div>
                  <div className="items-detail-catalog-column">
                    {catalogFactsRight.map((fact) => (
                      <div key={fact.label} className="items-detail-catalog-row">
                        <dt className="items-detail-catalog-term">{fact.label}</dt>
                        <dd className="items-detail-catalog-value">{fact.value}</dd>
                      </div>
                    ))}
                    {selectedCylinderSizeError ? (
                      <div className="items-detail-catalog-row">
                        <dt className="items-detail-catalog-term">Size Error</dt>
                        <dd className="items-detail-catalog-value items-detail-catalog-value--error">
                          {selectedCylinderSizeError}
                        </dd>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === 'CYLINDER' ? (
            <section className={detailSectionClass}>
              <div className={detailSectionHeadClass}>
                <div>
                  <div className="eyebrow">Linked Cylinder</div>
                  <h4>Cylinder reference</h4>
                </div>
                <p className={detailSectionCopyClass}>Used only for LPG items with linked cylinder setup.</p>
              </div>
              {!isLpg ? (
                <div className={detailEmptyClass}>This item is not an LPG item.</div>
              ) : !selectedDetail?.cylinderTypeId ? (
                <div className={detailEmptyClass}>No cylinder type is linked yet.</div>
              ) : selectedCylinder ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                  <div className="grid gap-3 rounded-[20px] border border-[rgba(188,210,234,0.55)] bg-[rgba(248,251,255,0.96)] px-4 py-4 shadow-[0_10px_22px_rgba(17,40,58,0.04)]">
                    <strong className="text-[1rem] font-extrabold text-[var(--text-strong)]">{selectedCylinder.code}</strong>
                    <span className="text-[0.92rem] leading-6 text-[var(--muted-strong)]">{selectedCylinder.name}</span>
                    <div className="flex flex-wrap gap-2">
                      <span className={detailNeutralPillClass}>Size {selectedCylinder.sizeKg === null ? 'Missing' : `${selectedCylinder.sizeKg} kg`}</span>
                      <span className={detailNeutralPillClass}>Deposit {selectedCylinder.depositAmount === null ? '-' : fmtMoney(selectedCylinder.depositAmount)}</span>
                    </div>
                    <div className="text-[0.86rem] font-medium text-[var(--success)]">Linked to LPG flow</div>
                  </div>
                  <div className={detailKvGridClass}>
                    <div className={detailKvRowClass}><dt className={detailKvTermClass}>Code</dt><dd className={detailKvValueClass}>{selectedCylinder.code}</dd></div>
                    <div className={detailKvRowClass}><dt className={detailKvTermClass}>Name</dt><dd className={detailKvValueClass}>{selectedCylinder.name}</dd></div>
                    <div className={detailKvRowClass}>
                      <dt className={detailKvTermClass}>Size</dt>
                      <dd className={selectedCylinder.sizeKg === null ? 'm-0 text-[0.92rem] font-semibold leading-6 text-rose-600' : detailKvValueClass}>
                        {selectedCylinder.sizeKg === null ? 'Missing size value' : `${selectedCylinder.sizeKg} kg`}
                      </dd>
                    </div>
                    <div className={detailKvRowClass}><dt className={detailKvTermClass}>Deposit</dt><dd className={detailKvValueClass}>{selectedCylinder.depositAmount === null ? '-' : fmtMoney(selectedCylinder.depositAmount)}</dd></div>
                  </div>
                </div>
              ) : (
                <div className={detailEmptyClass}>
                  Linked cylinder type ID: {selectedDetail.cylinderTypeId}. Cylinder type master data is not available on this device yet. Use Sync Now or Download Branch Data to refresh.
                </div>
              )}
            </section>
          ) : null}

          {activeTab === 'PRICING' ? (
            <section className={detailSectionClass}>
              <div className={detailSectionHeadClass}>
                <div>
                  <div className="eyebrow">Pricing Rules</div>
                  <h4>Price list coverage</h4>
                </div>
                <p className={detailSectionCopyClass}>Read-only rules currently downloaded to this desktop device.</p>
              </div>
              {selectedRules.length === 0 ? (
                <div className={detailEmptyClass}>No linked pricing rules.</div>
              ) : (
                <div className="grid gap-3">
                  {selectedRules.map((rule) => (
                    <div key={`${rule.priceListId}-${rule.priority ?? 'na'}-${rule.flowMode}-${rule.unitPrice}`} className={detailRuleCardClass}>
                      <strong className={detailRuleTitleClass}>{rule.priceListName}</strong>
                      <span className={detailRuleCopyClass}>{rule.scope} {'\u00b7'} {rule.appliesTo}</span>
                      <span className={detailRuleCopyClass}>Flow {flowLabel(rule.flowMode)}</span>
                      <span className={detailRuleCopyClass}>Unit Price {fmtMoney(rule.unitPrice)}</span>
                      <span className={detailRuleCopyClass}>
                        Discount Cap {rule.discountCapPct === null ? '-' : `${rule.discountCapPct}%`} {'\u00b7'} Priority {rule.priority === null ? '-' : rule.priority}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : null}

        </div>
      </div>
    </div>
  );
}

export function ItemCatalogOverviewPanel({
  title,
  subtitle,
  metrics,
  onRefresh,
  refreshDisabled
}: ItemCatalogOverviewPanelProps): JSX.Element {
  return (
    <>
      <section className="grid gap-3 rounded-[24px] border border-[rgba(188,210,234,0.58)] bg-[linear-gradient(180deg,rgba(255,255,255,0.99),rgba(246,250,255,0.97))] px-4 py-3.5 shadow-[0_14px_30px_rgba(17,40,58,0.07)] sm:px-5 sm:py-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[18px] border border-[rgba(196,220,255,0.78)] bg-[rgba(240,246,255,0.98)] text-[var(--accent-strong)] shadow-[0_8px_18px_rgba(17,40,58,0.05)]">
            <ItemCatalogSymbol kind="inventory" className="h-[22px] w-[22px]" />
          </div>
          <div className="min-w-0">
            <div className="text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--accent-strong)]">Item inventory</div>
            <h2 className="m-0 text-[1.12rem] font-extrabold tracking-[-0.02em] text-[var(--text-strong)] sm:text-[1.36rem]">
              {title}
            </h2>
            <p className="mt-1 text-[0.8rem] leading-5 text-[var(--muted)]">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-start gap-2.5 xl:justify-end">
          <button className="secondary-btn min-h-[46px] px-4 text-[0.86rem]" type="button" onClick={onRefresh} disabled={refreshDisabled}>
            Refresh
          </button>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const tone =
            metric.tone === 'good'
              ? {
                  shell: 'border-[rgba(37,166,91,0.28)] bg-[rgba(248,255,250,0.98)]',
                  icon: 'border-[rgba(37,166,91,0.24)] bg-[rgba(220,245,232,0.94)] text-[var(--success)]',
                  label: 'text-[var(--success)]',
                  line: 'from-[rgba(37,166,91,0.42)] to-[rgba(37,166,91,0.18)]'
                }
              : metric.tone === 'warn'
                ? {
                    shell: 'border-[rgba(205,138,26,0.28)] bg-[rgba(255,251,244,0.98)]',
                    icon: 'border-[rgba(205,138,26,0.24)] bg-[rgba(250,239,206,0.94)] text-[var(--warning)]',
                    label: 'text-[var(--warning)]',
                    line: 'from-[rgba(205,138,26,0.42)] to-[rgba(205,138,26,0.18)]'
                  }
                : metric.tone === 'out'
                  ? {
                      shell: 'border-[rgba(239,68,68,0.22)] bg-[rgba(255,248,248,0.98)]',
                      icon: 'border-[rgba(239,68,68,0.22)] bg-[rgba(252,228,228,0.94)] text-[var(--danger)]',
                      label: 'text-[var(--danger)]',
                      line: 'from-[rgba(239,68,68,0.42)] to-[rgba(239,68,68,0.18)]'
                    }
                  : {
                      shell: 'border-[rgba(245,158,11,0.2)] bg-[rgba(255,252,246,0.98)]',
                      icon: 'border-[rgba(245,158,11,0.24)] bg-[rgba(253,244,216,0.94)] text-[var(--warning)]',
                      label: 'text-[var(--warning)]',
                      line: 'from-[rgba(245,158,11,0.4)] to-[rgba(245,158,11,0.16)]'
                    };

          return (
            <article
              key={metric.key}
              className={`grid gap-3 overflow-hidden rounded-[20px] border px-4 py-3.5 shadow-[0_10px_22px_rgba(17,40,58,0.05)] ${tone.shell}`}
            >
              <div className="flex items-start gap-3">
                <div className={`grid h-[50px] w-[50px] shrink-0 place-items-center rounded-full border ${tone.icon}`}>
                  <ItemCatalogSymbol kind={metric.icon} className="h-[21px] w-[21px]" />
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

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function fmtDate(value: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
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

function resolveStockTone(product: DesktopCatalogProduct): 'out' | 'low' | 'good' {
  const available = resolveAvailableQty(product);
  if (available <= 0.0001) {
    return 'out';
  }
  if (available <= 3.0001) {
    return 'low';
  }
  return 'good';
}

function resolveStockLabel(product: DesktopCatalogProduct): string {
  const tone = resolveStockTone(product);
  if (tone === 'out') {
    return 'Out Of Stock';
  }
  if (tone === 'low') {
    return 'Low Stock';
  }
  return 'Ready';
}

function formatQty(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function formatCylinderQty(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 0
  });
}

function compactErrorText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function readFetchErrorDetail(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  const normalized = compactErrorText(raw);
  if (!normalized) {
    return '';
  }
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const messageValue = parsed.message;
    if (typeof messageValue === 'string' && messageValue.trim()) {
      return messageValue.trim();
    }
    if (Array.isArray(messageValue) && messageValue.length > 0) {
      const merged = compactErrorText(messageValue.map((entry) => String(entry ?? '')).join('; '));
      if (merged) {
        return merged;
      }
    }
  } catch {
    // Keep raw payload when response is not JSON.
  }
  return normalized;
}

function formatTransferModeLabel(
  mode: 'SUPPLIER_RESTOCK_IN' | 'SUPPLIER_RESTOCK_OUT' | 'CREATE' | 'USED' | 'CONVERT' | null
): string {
  switch (mode) {
    case 'SUPPLIER_RESTOCK_IN':
      return 'Supplier Restock In';
    case 'SUPPLIER_RESTOCK_OUT':
      return 'Supplier Restock Out';
    case 'CREATE':
      return 'Create';
    case 'USED':
      return 'Used';
    case 'CONVERT':
      return 'Convert';
    default:
      return 'Transfer';
  }
}

function formatLpgActionLabel(actionType: string): string {
  const normalized = actionType.trim().toUpperCase();
  switch (normalized) {
    case 'DISPOSE':
      return 'Dispose Item';
    case 'REPLACE':
      return 'Replace Item';
    case 'JUNK':
      return 'Junk Item';
    default:
      return normalized ? normalized.replace(/_/g, ' ') : 'LPG Item Action';
  }
}

function formatMovementTitle(row: ItemMovementRow): string {
  if (row.reference_type === 'SALE_CANCEL' || row.reference_type === 'SALE_CANCEL_LOCAL') {
    return row.movement_detail || 'Sale Cancel Reversal';
  }
  if (row.reference_type === 'SALE_RETURN' || row.reference_type === 'SALE_RETURN_LOCAL') {
    return row.movement_detail || 'Sale Return';
  }
  if (row.reference_type === 'SALE' || row.reference_type === 'SALE_LOCAL') {
    return row.movement_detail || 'Sale';
  }
  if (row.reference_type === 'TRANSFER_LOCAL' && row.movement_detail) {
    return row.movement_detail;
  }
  if (row.reference_type.startsWith('LPG_ITEM_') && row.movement_detail) {
    return row.movement_detail;
  }
  if (row.reference_type === 'PURCHASE_ORDER_LOCAL') {
    return row.movement_detail || (row.movement_type === 'PURCHASE_ORDER_PULLOUT' ? 'PO Pull-out (Empties)' : 'PO Receive');
  }
  return row.movement_type.replace(/_/g, ' ');
}

function formatMovementReference(row: ItemMovementRow): string {
  if (row.reference_type === 'TRANSFER_LOCAL') {
    return `Transfer ID ${row.reference_id}`;
  }
  if (row.reference_type.startsWith('LPG_ITEM_')) {
    return `Action ID ${row.reference_id}`;
  }
  if (row.reference_type === 'SALE') {
    return `Sale ${row.reference_id}`;
  }
  if (row.reference_type === 'SALE_LOCAL') {
    return `Sale ID ${row.reference_id}`;
  }
  if (row.reference_type === 'SALE_CANCEL' || row.reference_type === 'SALE_CANCEL_LOCAL') {
    return `Sale Cancel ${row.reference_id}`;
  }
  if (row.reference_type === 'SALE_RETURN') {
    return `Sale Return ${row.reference_id}`;
  }
  if (row.reference_type === 'SALE_RETURN_LOCAL') {
    return `Sale Return ${row.reference_id}`;
  }
  if (row.reference_type === 'LENDING_LOCAL') {
    return `Lending ${row.reference_id}`;
  }
  if (row.reference_type === 'LENDING_RETURN_LOCAL') {
    return `Lending Return ${row.reference_id}`;
  }
  if (row.reference_type === 'PURCHASE_ORDER_LOCAL') {
    return `PO ${row.reference_id}`;
  }
  return `Ref ${row.reference_type}:${row.reference_id}`;
}

function flowLabel(value: ItemPriceRule['flowMode']): string {
  if (value === 'REFILL_EXCHANGE') {
    return 'Refill Exchange';
  }
  if (value === 'NON_REFILL') {
    return 'Non-Refill';
  }
  return 'Any Flow';
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeFlow(value: unknown): 'REFILL_EXCHANGE' | 'NON_REFILL' | null {
  const raw = asString(value)?.toUpperCase();
  if (!raw) {
    return null;
  }
  const compact = raw.replace(/[\s-]+/g, '_');
  if (compact === 'REFILL_EXCHANGE' || compact === 'REFILL') {
    return 'REFILL_EXCHANGE';
  }
  if (compact === 'NON_REFILL' || compact === 'NONREFILL') {
    return 'NON_REFILL';
  }
  return null;
}

function normalizeTransferMode(
  value: unknown
):
  | 'SUPPLIER_RESTOCK_IN'
  | 'SUPPLIER_RESTOCK_OUT'
  | 'CREATE'
  | 'USED'
  | 'CONVERT'
  | null {
  const raw = asString(value)?.toUpperCase();
  if (
    raw === 'SUPPLIER_RESTOCK_IN' ||
    raw === 'SUPPLIER_RESTOCK_OUT' ||
    raw === 'CREATE' ||
    raw === 'USED' ||
    raw === 'CONVERT'
  ) {
    return raw;
  }
  return null;
}

function normalizeStatus(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

function shouldCountOpenLending(status: string | null | undefined): boolean {
  const normalized = normalizeStatus(status);
  return normalized === 'OPEN' || normalized === 'PARTIALLY_RETURNED' || normalized === 'OVERDUE';
}

function addQtyByProduct(target: Record<string, number>, productId: string, qty: number): void {
  if (!productId || !Number.isFinite(qty) || qty <= 0) {
    return;
  }
  target[productId] = Number(((target[productId] ?? 0) + qty).toFixed(4));
}

function addSignedQtyByProduct(target: Record<string, number>, productId: string, qty: number): void {
  if (!productId || !Number.isFinite(qty) || qty === 0) {
    return;
  }
  const next = Number(((target[productId] ?? 0) + qty).toFixed(4));
  target[productId] = next > 0 ? next : 0;
}

function parseLendingLineOpenQty(line: Record<string, unknown>): LendingLineLike | null {
  const productId = asString(line.product_id ?? line.productId);
  if (!productId) {
    return null;
  }
  const explicitOpenQty =
    asNumber(line.quantity_open ?? line.quantityOpen ?? line.qty_open ?? line.qtyOpen) ??
    asNumber(line.open_qty ?? line.openQty);
  if (explicitOpenQty !== null) {
    const normalizedOpenQty = Number(explicitOpenQty);
    if (normalizedOpenQty > 0) {
      return { productId, qtyOpen: normalizedOpenQty };
    }
    return null;
  }
  const lentQty =
    asNumber(line.quantity_lent ?? line.quantityLent ?? line.quantity ?? line.qty) ?? 0;
  const returnedQty =
    asNumber(line.quantity_returned ?? line.quantityReturned ?? line.returned_qty ?? line.returnedQty) ??
    0;
  const openQty = Number((lentQty - returnedQty).toFixed(4));
  if (openQty <= 0) {
    return null;
  }
  return { productId, qtyOpen: openQty };
}

function parseLendingLike(payload: Record<string, unknown>, fallbackId = ''): LendingRecordLike | null {
  const id = asString(payload.lending_id ?? payload.id) || fallbackId;
  const status = asString(payload.status) || '';
  if (!id || !status) {
    return null;
  }
  const linesRaw = Array.isArray(payload.lines)
    ? payload.lines
    : Array.isArray(payload.line_items)
      ? payload.line_items
      : [];
  const lines = linesRaw
    .map((value) => (value && typeof value === 'object' ? parseLendingLineOpenQty(value as Record<string, unknown>) : null))
    .filter((entry): entry is LendingLineLike => Boolean(entry));
  return {
    id,
    status,
    branchId: asString(payload.branch_id ?? payload.branchId),
    locationId: asString(payload.location_id ?? payload.locationId),
    lines
  };
}

function parseLpgItemActionLike(payload: Record<string, unknown>, fallbackId = ''): LpgItemActionLike | null {
  const id = asString(payload.id) || fallbackId;
  const actionType = normalizeStatus(asString(payload.actionType ?? payload.action_type) ?? '');
  const productId = asString(payload.productId ?? payload.product_id);
  const qty = asNumber(payload.qty ?? payload.quantity) ?? 0;
  if (!id || !actionType || !productId || qty <= 0) {
    return null;
  }
  return {
    id,
    actionType,
    productId,
    qty,
    branchId: asString(payload.branchId ?? payload.branch_id),
    locationId: asString(payload.locationId ?? payload.location_id),
    referenceActionId: asString(payload.referenceActionId ?? payload.reference_action_id)
  };
}

function parseItemDetail(row: { recordId: string; payload: string; updatedAt: string }): ItemDetailRecord {
  const payload = parsePayload(row.payload);
  const id = asString(payload.id) || row.recordId;
  const itemCode =
    asString(payload.itemCode) ||
    asString(payload.item_code) ||
    asString(payload.sku) ||
    asString(payload.code) ||
    id;
  const name = asString(payload.name) || asString(payload.display_name) || itemCode;

  return {
    id,
    itemCode,
    name,
    category: asString(payload.category) || asString(payload.category_code),
    brand: asString(payload.brand),
    unit: asString(payload.unit) || 'unit',
    isLpg: asBoolean(payload.isLpg ?? payload.is_lpg, false),
    isLendable: asBoolean(payload.isLendable ?? payload.is_lendable, false),
    requiresReturn: asBoolean(payload.requiresReturn ?? payload.requires_return, false),
    requiresDeposit: asBoolean(payload.requiresDeposit ?? payload.requires_deposit, false),
    defaultDepositAmount: asNumber(payload.defaultDepositAmount ?? payload.default_deposit_amount),
    lendingUnitType: asString(payload.lendingUnitType ?? payload.lending_unit_type),
    cylinderTypeId: asString(payload.cylinderTypeId ?? payload.cylinder_type_id),
    lowStockAlertQty: asNumber(payload.lowStockAlertQty ?? payload.low_stock_alert_qty),
    updatedAt: asString(payload.updatedAt ?? payload.updated_at) || row.updatedAt
  };
}

function parseCylinderType(row: { recordId: string; payload: string }): CylinderTypeDetail {
  const payload = parsePayload(row.payload);
  const id = asString(payload.id) || row.recordId;
  return {
    id,
    code: asString(payload.code) || id,
    name: asString(payload.name) || asString(payload.code) || id,
    sizeKg: asNumber(payload.sizeKg ?? payload.size_kg),
    depositAmount: asNumber(payload.depositAmount ?? payload.deposit_amount)
  };
}

function isUnsyncedOutboxStatus(value: OutboxItem['status']): boolean {
  return value === 'pending' || value === 'processing' || value === 'failed' || value === 'needs_review';
}

function sortMovementRowsNewestFirst<T extends { created_at: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const byCreatedAt = b.created_at.localeCompare(a.created_at);
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    return b.id.localeCompare(a.id);
  });
}

function decoratePendingMovementAfterValues(
  rows: ItemMovementRow[],
  currentStock: Pick<DesktopCatalogProduct, 'qtyOnHand' | 'qtyFull' | 'qtyEmpty'>
): ItemMovementRow[] {
  let runningQtyOnHand = Number(currentStock.qtyOnHand || 0);
  let runningQtyFull = Number(currentStock.qtyFull || 0);
  let runningQtyEmpty = Number(currentStock.qtyEmpty || 0);

  return sortMovementRowsNewestFirst(rows).map((row) => {
    const nextRow: ItemMovementRow = {
      ...row,
      qty_after: runningQtyOnHand,
      qty_after_known: true,
      qty_full_after: runningQtyFull,
      qty_full_after_known: true,
      qty_empty_after: runningQtyEmpty,
      qty_empty_after_known: true
    };
    runningQtyOnHand = Number((runningQtyOnHand - row.qty_delta).toFixed(4));
    runningQtyFull = Number((runningQtyFull - row.qty_full_delta).toFixed(4));
    runningQtyEmpty = Number((runningQtyEmpty - row.qty_empty_delta).toFixed(4));
    return nextRow;
  });
}

type PoLineInfo = { productId: string; isLpg: boolean; locationId: string };

function buildLocalPendingMovementRows(
  productId: string,
  locationId: string | null,
  currentStock: Pick<DesktopCatalogProduct, 'qtyOnHand' | 'qtyFull' | 'qtyEmpty'>,
  outboxRows: OutboxItem[],
  salesById: Map<string, { payload: { lines: DesktopSaleLine[]; locationId?: string | null } }>,
  poLineById: Map<string, PoLineInfo>
): ItemMovementRow[] {
  const normalizedLocationId = locationId?.trim() || null;
  const rows: ItemMovementRow[] = [];

  for (const row of outboxRows) {
    if (!isUnsyncedOutboxStatus(row.status)) {
      continue;
    }
    const payload = row.payload ?? {};
    if (row.entity === 'sale' && row.action === 'create') {
      const saleLocationId = asString(payload.locationId ?? payload.location_id);
      if (normalizedLocationId && saleLocationId && saleLocationId !== normalizedLocationId) {
        continue;
      }
      const lines = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
      lines.forEach((line, index) => {
        const lineProductId = asString(line.productId ?? line.product_id);
        const quantity = asNumber(line.quantity) ?? 0;
        const flow = normalizeFlow(line.cylinderFlow ?? line.cylinder_flow);
        if (lineProductId !== productId || quantity <= 0) {
          return;
        }
        rows.push({
          id: `local-sale:${row.id}:${index}`,
          created_at: row.created_at,
          movement_type: 'SALE',
          reference_type: 'SALE_LOCAL',
          reference_id: asString(payload.id) ?? row.id,
          location_name: saleLocationId ?? 'Desktop device',
          qty_delta: flow === 'REFILL_EXCHANGE' ? 0 : -quantity,
          qty_full_delta: flow ? -quantity : 0,
          qty_empty_delta: flow === 'REFILL_EXCHANGE' ? quantity : 0,
          qty_after: 0,
          qty_after_known: false,
          qty_full_after: 0,
          qty_full_after_known: false,
          qty_empty_after: 0,
          qty_empty_after_known: false
        });
      });
      continue;
    }

    if (row.entity === 'sale_cancel' && row.action === 'create') {
      const saleId = asString(payload.sale_id ?? payload.saleId ?? payload.id);
      if (!saleId) {
        continue;
      }
      const sourceSale = salesById.get(saleId);
      if (!sourceSale) {
        continue;
      }
      const saleLocationId = asString(
        sourceSale.payload.locationId ?? payload.location_id ?? payload.locationId
      );
      if (normalizedLocationId && saleLocationId && saleLocationId !== normalizedLocationId) {
        continue;
      }
      sourceSale.payload.lines.forEach((line, index) => {
        if (line.productId !== productId || line.quantity <= 0) {
          return;
        }
        const flow = normalizeFlow(line.cylinderFlow ?? null);
        rows.push({
          id: `local-sale-cancel:${row.id}:${index}`,
          created_at: row.created_at,
          movement_type: 'RETURN',
          movement_detail: 'Sale Cancel Reversal',
          reference_type: 'SALE_CANCEL_LOCAL',
          reference_id: saleId,
          location_name: saleLocationId ?? normalizedLocationId ?? 'Desktop device',
          qty_delta: flow === 'REFILL_EXCHANGE' ? 0 : line.quantity,
          qty_full_delta: flow ? line.quantity : 0,
          qty_empty_delta: flow === 'REFILL_EXCHANGE' ? -line.quantity : 0,
          qty_after: 0,
          qty_after_known: false,
          qty_full_after: 0,
          qty_full_after_known: false,
          qty_empty_after: 0,
          qty_empty_after_known: false
        });
      });
      continue;
    }

    if (row.entity === 'sale_return' && row.action === 'create') {
      const saleId = asString(payload.sale_id ?? payload.saleId);
      const sourceSale = saleId ? salesById.get(saleId) ?? null : null;
      const saleLinesById = new Map<string, DesktopSaleLine>();
      for (const line of sourceSale?.payload.lines ?? []) {
        if (line.lineId) {
          saleLinesById.set(line.lineId, line);
        }
      }
      const lines = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
      lines.forEach((line, index) => {
        const lineProductId = asString(line.product_id ?? line.productId);
        const quantity = asNumber(line.quantity) ?? 0;
        if (lineProductId !== productId || quantity <= 0) {
          return;
        }
        const saleLineId = asString(line.sale_line_id ?? line.saleLineId);
        const sourceLine = saleLineId ? saleLinesById.get(saleLineId) ?? null : null;
        const flow = normalizeFlow(sourceLine?.cylinderFlow ?? null);
        rows.push({
          id: `local-sale-return:${row.id}:${index}`,
          created_at: row.created_at,
          movement_type: 'SALE_RETURN',
          reference_type: 'SALE_RETURN_LOCAL',
          reference_id: saleId ?? row.id,
          location_name: normalizedLocationId ?? 'Desktop device',
          qty_delta: flow === 'REFILL_EXCHANGE' ? 0 : quantity,
          qty_full_delta: flow ? quantity : 0,
          qty_empty_delta: flow === 'REFILL_EXCHANGE' ? -quantity : 0,
          qty_after: 0,
          qty_after_known: false,
          qty_full_after: 0,
          qty_full_after_known: false,
          qty_empty_after: 0,
          qty_empty_after_known: false
        });
      });
      continue;
    }

    if (row.entity === 'lending' && row.action === 'create') {
      const lendingLocationId = asString(payload.location_id ?? payload.locationId);
      if (normalizedLocationId && lendingLocationId && lendingLocationId !== normalizedLocationId) {
        continue;
      }
      const lines: Array<Record<string, unknown>> = Array.isArray(payload.lines)
        ? (payload.lines as Array<Record<string, unknown>>)
        : Array.isArray(payload.line_items)
          ? (payload.line_items as Array<Record<string, unknown>>)
          : [];
      lines.forEach((lineValue, index) => {
        if (!lineValue || typeof lineValue !== 'object') {
          return;
        }
        const line = lineValue as Record<string, unknown>;
        const lineProductId = asString(line.product_id ?? line.productId);
        const quantity =
          asNumber(
            line.quantity_open ??
              line.quantityOpen ??
              line.open_qty ??
              line.openQty ??
              line.quantity ??
              line.qty
          ) ?? 0;
        if (lineProductId !== productId || quantity <= 0) {
          return;
        }
        rows.push({
          id: `local-lending:${row.id}:${index}`,
          created_at: row.created_at,
          movement_type: 'LENDING_OUT',
          reference_type: 'LENDING_LOCAL',
          reference_id: asString(payload.lending_id ?? payload.id) ?? row.id,
          location_name: lendingLocationId ?? 'Desktop device',
          qty_delta: -quantity,
          qty_full_delta: 0,
          qty_empty_delta: -quantity,
          qty_after: 0,
          qty_after_known: false,
          qty_full_after: 0,
          qty_full_after_known: false,
          qty_empty_after: 0,
          qty_empty_after_known: false
        });
      });
      continue;
    }

    if (row.entity === 'lending_return' && row.action === 'create') {
      const lendingLocationId = asString(payload.location_id ?? payload.locationId);
      if (normalizedLocationId && lendingLocationId && lendingLocationId !== normalizedLocationId) {
        continue;
      }
      const lines: Array<Record<string, unknown>> = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
      lines.forEach((lineValue, index) => {
        if (!lineValue || typeof lineValue !== 'object') {
          return;
        }
        const line = lineValue as Record<string, unknown>;
        const lineProductId = asString(line.product_id ?? line.productId);
        const quantity = asNumber(line.returned_qty ?? line.returnedQty ?? line.quantity ?? line.qty) ?? 0;
        if (lineProductId !== productId || quantity <= 0) {
          return;
        }
        rows.push({
          id: `local-lending-return:${row.id}:${index}`,
          created_at: row.created_at,
          movement_type: 'LENDING_RETURN',
          reference_type: 'LENDING_RETURN_LOCAL',
          reference_id: asString(payload.lending_return_id ?? payload.id) ?? row.id,
          location_name: lendingLocationId ?? 'Desktop device',
          qty_delta: quantity,
          qty_full_delta: 0,
          qty_empty_delta: quantity,
          qty_after: 0,
          qty_after_known: false,
          qty_full_after: 0,
          qty_full_after_known: false,
          qty_empty_after: 0,
          qty_empty_after_known: false
        });
      });
      continue;
    }

    if (row.entity === 'transfer' && row.action === 'create') {
      const transferMode = normalizeTransferMode(payload.transfer_mode ?? payload.transferMode);
      const sourceLocationId = asString(payload.source_location_id ?? payload.sourceLocationId);
      const destinationLocationId = asString(payload.destination_location_id ?? payload.destinationLocationId);
      const affectsAsSource =
        transferMode === 'SUPPLIER_RESTOCK_IN'
          ? false
          : transferMode === 'SUPPLIER_RESTOCK_OUT'
            ? destinationLocationId === normalizedLocationId
            : transferMode === 'CREATE' || transferMode === 'USED' || transferMode === 'CONVERT'
              ? false
              : normalizedLocationId
                ? sourceLocationId === normalizedLocationId
                : false;
      const affectsAsDestination =
        transferMode === 'SUPPLIER_RESTOCK_IN'
          ? destinationLocationId === normalizedLocationId
          : transferMode === 'SUPPLIER_RESTOCK_OUT'
            ? false
            : transferMode === 'CREATE' || transferMode === 'USED' || transferMode === 'CONVERT'
              ? destinationLocationId === normalizedLocationId
              : normalizedLocationId
                ? destinationLocationId === normalizedLocationId
                : false;
      const lines = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
      lines.forEach((line, index) => {
        const lineProductId = asString(line.productId ?? line.product_id);
        const qtyFull = asNumber(line.qtyFull ?? line.qty_full) ?? 0;
        const qtyEmpty = asNumber(line.qtyEmpty ?? line.qty_empty) ?? 0;
        if (lineProductId !== productId) {
          return;
        }

        let qtyDelta = 0;
        let qtyFullDelta = 0;
        let qtyEmptyDelta = 0;
        let movementType = 'TRANSFER';

        if (transferMode === 'CREATE') {
          qtyFullDelta = qtyEmpty;
          qtyEmptyDelta = -qtyEmpty;
          movementType = 'ADJUSTMENT';
        } else if (transferMode === 'USED') {
          qtyFullDelta = -qtyFull;
          qtyEmptyDelta = qtyFull;
          movementType = 'ADJUSTMENT';
        } else if (transferMode === 'CONVERT') {
          qtyEmptyDelta = qtyFull - qtyEmpty;
          movementType = 'ADJUSTMENT';
        } else if (affectsAsSource) {
          qtyDelta = -(qtyFull + qtyEmpty);
          qtyFullDelta = -qtyFull;
          qtyEmptyDelta = -qtyEmpty;
          movementType = 'TRANSFER_OUT';
        } else if (affectsAsDestination || transferMode === 'SUPPLIER_RESTOCK_IN') {
          qtyDelta = qtyFull + qtyEmpty;
          qtyFullDelta = qtyFull;
          qtyEmptyDelta = qtyEmpty;
          movementType = transferMode === 'SUPPLIER_RESTOCK_IN' ? 'ADJUSTMENT' : 'TRANSFER_IN';
        } else if (transferMode === 'SUPPLIER_RESTOCK_OUT') {
          qtyDelta = -(qtyFull + qtyEmpty);
          qtyFullDelta = -qtyFull;
          qtyEmptyDelta = -qtyEmpty;
          movementType = 'ADJUSTMENT';
        }

        if (qtyDelta === 0 && qtyFullDelta === 0 && qtyEmptyDelta === 0) {
          return;
        }

        rows.push({
          id: `local-transfer:${row.id}:${index}`,
          created_at: row.created_at,
          movement_type: movementType,
          movement_detail:
            movementType === 'TRANSFER_IN' || movementType === 'TRANSFER_OUT'
              ? `${formatTransferModeLabel(transferMode)} ${movementType === 'TRANSFER_IN' ? 'In' : 'Out'}`
              : formatTransferModeLabel(transferMode),
          reference_type: 'TRANSFER_LOCAL',
          reference_id: asString(payload.id) ?? row.id,
          location_name:
            (affectsAsDestination ? destinationLocationId : sourceLocationId) ??
            destinationLocationId ??
            sourceLocationId ??
            'Desktop device',
          qty_delta: qtyDelta,
          qty_full_delta: qtyFullDelta,
          qty_empty_delta: qtyEmptyDelta,
          qty_after: 0,
          qty_after_known: false,
          qty_full_after: 0,
          qty_full_after_known: false,
          qty_empty_after: 0,
          qty_empty_after_known: false
        });
      });
      continue;
    }

    if (row.entity === 'purchase_order_delivery' && row.action === 'delivery') {
      const poId = asString(payload.purchase_order_id ?? payload.purchaseOrderId);
      const receiveLines: Array<Record<string, unknown>> = Array.isArray(payload.receive_lines)
        ? (payload.receive_lines as Array<Record<string, unknown>>)
        : [];
      const pulloutLines: Array<Record<string, unknown>> = Array.isArray(payload.pullout_lines)
        ? (payload.pullout_lines as Array<Record<string, unknown>>)
        : [];

      // Accumulate receive + pullout into one net row per product per delivery
      let receiveQty = 0;
      let pulloutQty = 0;
      let matchedPoLine: PoLineInfo | null = null;

      for (const line of receiveLines) {
        const poLineId = asString(line.purchase_order_line_id ?? line.purchaseOrderLineId);
        const quantity = asNumber(line.quantity) ?? 0;
        if (!poLineId || quantity <= 0) continue;
        const poLine = poLineById.get(poLineId);
        if (!poLine || poLine.productId !== productId) continue;
        if (normalizedLocationId && poLine.locationId && poLine.locationId !== normalizedLocationId) continue;
        receiveQty += quantity;
        matchedPoLine = poLine;
      }

      for (const line of pulloutLines) {
        const poLineId = asString(line.purchase_order_line_id ?? line.purchaseOrderLineId);
        const quantity = asNumber(line.quantity) ?? 0;
        if (!poLineId || quantity <= 0) continue;
        const poLine = poLineById.get(poLineId);
        if (!poLine || poLine.productId !== productId || !poLine.isLpg) continue;
        if (normalizedLocationId && poLine.locationId && poLine.locationId !== normalizedLocationId) continue;
        pulloutQty += quantity;
        matchedPoLine = matchedPoLine ?? poLine;
      }

      if (matchedPoLine && (receiveQty > 0 || pulloutQty > 0)) {
        const isLpg = matchedPoLine.isLpg;
        const qtyDelta = receiveQty - pulloutQty;
        const detail = receiveQty > 0 && pulloutQty > 0
          ? `PO Receive +${receiveQty} / Pull-out -${pulloutQty}`
          : receiveQty > 0
            ? 'PO Receive'
            : 'PO Pull-out (Empties)';
        rows.push({
          id: `local-po-delivery:${row.id}`,
          created_at: row.created_at,
          movement_type: receiveQty > 0 ? 'PURCHASE_ORDER_RECEIVE' : 'PURCHASE_ORDER_PULLOUT',
          movement_detail: detail,
          reference_type: 'PURCHASE_ORDER_LOCAL',
          reference_id: poId ?? row.id,
          location_name: matchedPoLine.locationId ?? normalizedLocationId ?? 'Desktop device',
          qty_delta: qtyDelta,
          qty_full_delta: isLpg ? receiveQty : 0,
          qty_empty_delta: isLpg ? -pulloutQty : 0,
          qty_after: 0,
          qty_after_known: false,
          qty_full_after: 0,
          qty_full_after_known: false,
          qty_empty_after: 0,
          qty_empty_after_known: false
        });
      }
      continue;
    }

    if (row.entity === 'lpg_item_action') {
      const actionType = String(asString(payload.action_type ?? payload.actionType ?? row.action) ?? '').trim().toUpperCase();
      const actionLocationId = asString(payload.location_id ?? payload.locationId);
      const actionProductId = asString(payload.product_id ?? payload.productId);
      const qty = asNumber(payload.qty ?? payload.quantity) ?? 0;
      if ((normalizedLocationId && actionLocationId && actionLocationId !== normalizedLocationId) || actionProductId !== productId || qty <= 0) {
        continue;
      }
      const qtyDelta = actionType === 'DISPOSE' ? -qty : actionType === 'REPLACE' ? qty : 0;
      const qtyEmptyDelta = actionType === 'DISPOSE' ? -qty : actionType === 'REPLACE' ? qty : 0;
      if (qtyDelta === 0 && qtyEmptyDelta === 0) {
        continue;
      }
      rows.push({
        id: `local-lpg-action:${row.id}`,
        created_at: row.created_at,
        movement_type: 'ADJUSTMENT',
        movement_detail: formatLpgActionLabel(actionType),
        reference_type: `LPG_ITEM_${actionType || 'ACTION'}`,
        reference_id: asString(payload.id) ?? row.id,
        location_name: actionLocationId ?? 'Desktop device',
        qty_delta: qtyDelta,
        qty_full_delta: 0,
        qty_empty_delta: qtyEmptyDelta,
        qty_after: 0,
        qty_after_known: false,
        qty_full_after: 0,
        qty_full_after_known: false,
        qty_empty_after: 0,
        qty_empty_after_known: false
      });
    }
  }

  return decoratePendingMovementAfterValues(rows, currentStock);
}

export function ItemsScreen({ appState, tenantAddons, onOpenLpgService }: Props): JSX.Element {
  const [catalog, setCatalog] = useState<DesktopCatalogProduct[]>([]);
  const [detailByProduct, setDetailByProduct] = useState<Record<string, ItemDetailRecord>>({});
  const [cylinderById, setCylinderById] = useState<Record<string, CylinderTypeDetail>>({});
  const [priceRulesByProduct, setPriceRulesByProduct] = useState<Record<string, ItemPriceRule[]>>({});
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [pageSize, setPageSize] = useState(DEFAULT_ITEM_LIST_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Use this screen to review branch items, check stock, and send one straight into POS.');
  const [movementRows, setMovementRows] = useState<ItemMovementRow[]>([]);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);
  const [lendedQtyByProduct, setLendedQtyByProduct] = useState<Record<string, number>>({});
  const [disposedQtyByProduct, setDisposedQtyByProduct] = useState<Record<string, number>>({});
  const [movementFromDate, setMovementFromDate] = useState('');
  const [movementToDate, setMovementToDate] = useState('');
  const [itemHistoryOpen, setItemHistoryOpen] = useState(false);

  const refresh = async (): Promise<void> => {
    if (!appState.setup.locationId) {
      setCatalog([]);
      setLendedQtyByProduct({});
      setDisposedQtyByProduct({});
      return;
    }
    setLoading(true);
    try {
      const [rows, projectedInventory, productRows, cylinderRows, priceListRows] = await Promise.all([
        desktopMasterDataService.loadCatalog(appState.setup.locationId),
        desktopStockProjectionService.loadProjectedInventoryByProduct(appState.setup.locationId),
        desktopDb.listMasterData('product'),
        desktopDb.listMasterData('cylinder_type'),
        desktopDb.listMasterData('price_list')
      ]);
      const projectedRows = rows.map((product) => {
          const projected = projectedInventory.get(product.id);
          return projected
            ? {
                ...product,
                qtyOnHand: product.isLpg
                  ? Number((projected.qtyFull + projected.qtyEmpty).toFixed(4))
                  : projected.qtyOnHand,
                qtyFull: projected.qtyFull,
                qtyEmpty: projected.qtyEmpty
              }
            : product;
        });
      setCatalog(applyInventoryCatalogPricing({
        catalog: projectedRows,
        priceListRows: priceListRows as DesktopMasterDataRow[],
        branchId: appState.setup.branchId,
        defaultLpgFlow: appState.setup.posDefaultLpgFlow
      }));

      const nextDetails: Record<string, ItemDetailRecord> = {};
      for (const row of productRows) {
        const parsed = parseItemDetail(row);
        nextDetails[parsed.id] = parsed;
      }
      setDetailByProduct(nextDetails);

      const nextCylinders: Record<string, CylinderTypeDetail> = {};
      for (const row of cylinderRows) {
        const parsed = parseCylinderType(row);
        nextCylinders[parsed.id] = parsed;
      }
      setCylinderById(nextCylinders);

      const nextRules: Record<string, ItemPriceRule[]> = {};
      for (const row of priceListRows) {
        const payload = parsePayload(row.payload);
        const rules = Array.isArray(payload.rules) ? payload.rules : [];
        const priceListId = asString(payload.id) || row.recordId;
        const priceListName = asString(payload.name) || priceListId;
        const scope = (asString(payload.scope) || 'GLOBAL').toUpperCase();
        const appliesTo =
          asString(payload.customerTier ?? payload.customer_tier) ||
          asString(payload.customerId ?? payload.customer_id) ||
          asString(payload.branchId ?? payload.branch_id) ||
          'Branch/Global';

        for (const value of rules) {
          if (!value || typeof value !== 'object') {
            continue;
          }
          const rule = value as Record<string, unknown>;
          const productId = asString(rule.productId ?? rule.product_id);
          const unitPrice = asNumber(rule.unitPrice ?? rule.unit_price);
          if (!productId || unitPrice === null) {
            continue;
          }
          const flowMode = (asString(rule.flowMode ?? rule.flow_mode) || 'ANY').toUpperCase();
          const normalizedFlowMode: ItemPriceRule['flowMode'] =
            flowMode === 'REFILL_EXCHANGE' || flowMode === 'NON_REFILL' ? flowMode : 'ANY';
          const entry: ItemPriceRule = {
            priceListId,
            priceListName,
            scope,
            appliesTo,
            flowMode: normalizedFlowMode,
            unitPrice,
            discountCapPct: asNumber(rule.discountCapPct ?? rule.discount_cap_pct),
            priority: asNumber(rule.priority)
          };
          nextRules[productId] = [...(nextRules[productId] ?? []), entry];
        }
      }
      Object.keys(nextRules).forEach((productId) => {
        nextRules[productId] = nextRules[productId].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
      });
      setPriceRulesByProduct(nextRules);

      const nextLendedQtyByProduct: Record<string, number> = {};
      const nextDisposedQtyByProduct: Record<string, number> = {};
      const seenLendingIds = new Set<string>();
      const pendingOutboxCreatedLendingIds = new Set<string>();
      const seenLpgActionIds = new Set<string>();
      const lpgActionCandidates: LpgItemActionLike[] = [];
      const activeBranchId = appState.setup.branchId?.trim() || null;
      const activeLocationId = appState.setup.locationId?.trim() || null;

      const apiBase = appState.setup.apiBaseUrl.replace(/\/$/, '');
      const requestJson = async <T,>(path: string): Promise<T> => {
        const { response } = await desktopAuthService.authorizedFetch(appState, `${apiBase}${path}`, { method: 'GET' });
        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }
        return (await response.json()) as T;
      };
      const registerLpgAction = (parsed: LpgItemActionLike | null): void => {
        if (!parsed) {
          return;
        }
        if (activeBranchId && parsed.branchId && parsed.branchId !== activeBranchId) {
          return;
        }
        if (activeLocationId && parsed.locationId && parsed.locationId !== activeLocationId) {
          return;
        }
        if (seenLpgActionIds.has(parsed.id)) {
          return;
        }
        seenLpgActionIds.add(parsed.id);
        lpgActionCandidates.push(parsed);
      };

      if (appState.auth.accessToken?.trim()) {
        try {
          const params = new URLSearchParams();
          if (activeBranchId) {
            params.set('branch_id', activeBranchId);
          }
          if (activeLocationId) {
            params.set('location_id', activeLocationId);
          }
          params.set('limit', '200');
          const list = await requestJson<DesktopLendingRecord[]>(`/lending?${params.toString()}`);
          const activeRows = list.filter((row) => shouldCountOpenLending(row.status));
          const detailResults = await Promise.allSettled(
            activeRows.map((row) =>
              requestJson<DesktopLendingDetail>(`/lending/${encodeURIComponent(row.lending_id)}`)
            )
          );
          for (const result of detailResults) {
            if (result.status !== 'fulfilled') {
              continue;
            }
            const parsed = parseLendingLike(result.value as unknown as Record<string, unknown>, result.value.lending_id);
            if (!parsed || !shouldCountOpenLending(parsed.status)) {
              continue;
            }
            seenLendingIds.add(parsed.id);
            for (const line of parsed.lines) {
              addQtyByProduct(nextLendedQtyByProduct, line.productId, line.qtyOpen);
            }
          }
        } catch {
          // Keep lended qty best-effort and avoid blocking item catalog render.
        }

        try {
          const params = new URLSearchParams();
          if (activeBranchId) {
            params.set('branch_id', activeBranchId);
          }
          if (activeLocationId) {
            params.set('location_id', activeLocationId);
          }
          params.set('limit', '300');
          const rows = await requestJson<DesktopLpgItemActionRecord[]>(`/lpg-item-actions?${params.toString()}`);
          for (const row of rows) {
            registerLpgAction(parseLpgItemActionLike(row as unknown as Record<string, unknown>, row.id));
          }
        } catch {
          // Keep disposed qty best-effort and avoid blocking item catalog render.
        }
      }

      const [lendingRows, lendingDetailRows, lpgActionRows, outboxRows] = await Promise.all([
        desktopDb.listMasterData('lending'),
        desktopDb.listMasterData('lending_detail'),
        desktopDb.listMasterData('lpg_item_action'),
        desktopDb.listOutboxItems()
      ]);

      for (const row of lendingDetailRows) {
        const parsed = parseLendingLike(parsePayload(row.payload), row.recordId);
        if (!parsed || !shouldCountOpenLending(parsed.status) || seenLendingIds.has(parsed.id)) {
          continue;
        }
        if (activeBranchId && parsed.branchId && parsed.branchId !== activeBranchId) {
          continue;
        }
        if (activeLocationId && parsed.locationId && parsed.locationId !== activeLocationId) {
          continue;
        }
        seenLendingIds.add(parsed.id);
        for (const line of parsed.lines) {
          addQtyByProduct(nextLendedQtyByProduct, line.productId, line.qtyOpen);
        }
      }

      for (const row of lendingRows) {
        const parsed = parseLendingLike(parsePayload(row.payload), row.recordId);
        if (!parsed || !shouldCountOpenLending(parsed.status) || seenLendingIds.has(parsed.id)) {
          continue;
        }
        if (activeBranchId && parsed.branchId && parsed.branchId !== activeBranchId) {
          continue;
        }
        if (activeLocationId && parsed.locationId && parsed.locationId !== activeLocationId) {
          continue;
        }
        seenLendingIds.add(parsed.id);
        for (const line of parsed.lines) {
          addQtyByProduct(nextLendedQtyByProduct, line.productId, line.qtyOpen);
        }
      }

      for (const row of outboxRows) {
        const status = normalizeStatus(row.status);
        if (status !== 'PENDING' && status !== 'PROCESSING' && status !== 'FAILED' && status !== 'NEEDS_REVIEW') {
          continue;
        }
        if (row.entity !== 'lending') {
          continue;
        }
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const parsed = parseLendingLike(payload, row.id);
        if (!parsed || !shouldCountOpenLending(parsed.status) || seenLendingIds.has(parsed.id)) {
          continue;
        }
        if (activeBranchId && parsed.branchId && parsed.branchId !== activeBranchId) {
          continue;
        }
        if (activeLocationId && parsed.locationId && parsed.locationId !== activeLocationId) {
          continue;
        }
        seenLendingIds.add(parsed.id);
        pendingOutboxCreatedLendingIds.add(parsed.id);
        for (const line of parsed.lines) {
          addQtyByProduct(nextLendedQtyByProduct, line.productId, line.qtyOpen);
        }
      }

      for (const row of outboxRows) {
        const status = normalizeStatus(row.status);
        if (status !== 'PENDING' && status !== 'PROCESSING' && status !== 'FAILED' && status !== 'NEEDS_REVIEW') {
          continue;
        }
        if (row.entity !== 'lending_return') {
          continue;
        }
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const lendingId = asString(payload.lending_id);
        if (!lendingId || !pendingOutboxCreatedLendingIds.has(lendingId)) {
          continue;
        }
        const branchId = asString(payload.branch_id ?? payload.branchId);
        const locationId = asString(payload.location_id ?? payload.locationId);
        if (activeBranchId && branchId && branchId !== activeBranchId) {
          continue;
        }
        if (activeLocationId && locationId && locationId !== activeLocationId) {
          continue;
        }
        const lines: Array<Record<string, unknown>> = Array.isArray(payload.lines) ? (payload.lines as Array<Record<string, unknown>>) : [];
        for (const value of lines) {
          if (!value || typeof value !== 'object') {
            continue;
          }
          const line = value as Record<string, unknown>;
          const productId = asString(line.product_id ?? line.productId);
          const returnedQty =
            asNumber(line.returned_qty ?? line.returnedQty ?? line.quantity ?? line.qty) ?? 0;
          if (!productId || returnedQty <= 0) {
            continue;
          }
          addSignedQtyByProduct(nextLendedQtyByProduct, productId, -returnedQty);
        }
      }

      for (const row of lpgActionRows) {
        registerLpgAction(parseLpgItemActionLike(parsePayload(row.payload), row.recordId));
      }

      for (const row of outboxRows) {
        const status = normalizeStatus(row.status);
        if (status !== 'PENDING' && status !== 'PROCESSING' && status !== 'FAILED' && status !== 'NEEDS_REVIEW') {
          continue;
        }
        if (row.entity !== 'lpg_item_action') {
          continue;
        }
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const parsed = parseLpgItemActionLike(
          {
            ...payload,
            actionType: payload.actionType ?? payload.action_type ?? row.action
          },
          row.id
        );
        registerLpgAction(parsed);
      }

      const disposeById = new Map<string, LpgItemActionLike>();
      for (const action of lpgActionCandidates) {
        if (action.actionType !== 'DISPOSE') {
          continue;
        }
        disposeById.set(action.id, action);
        addSignedQtyByProduct(nextDisposedQtyByProduct, action.productId, action.qty);
      }
      for (const action of lpgActionCandidates) {
        if (action.actionType !== 'REPLACE' && action.actionType !== 'JUNK') {
          continue;
        }
        const referencedDispose = action.referenceActionId
          ? disposeById.get(action.referenceActionId)
          : null;
        const targetProductId = referencedDispose?.productId ?? action.productId;
        addSignedQtyByProduct(nextDisposedQtyByProduct, targetProductId, -action.qty);
      }

      setLendedQtyByProduct(nextLendedQtyByProduct);
      setDisposedQtyByProduct(nextDisposedQtyByProduct);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load local items right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [appState.setup.locationId]);

  const loadItemMovements = async (productId: string): Promise<void> => {
    setMovementLoading(true);
    setMovementError(null);
    try {
      if (movementFromDate && movementToDate && movementFromDate > movementToDate) {
        throw new Error('From date must be earlier than or equal to To date.');
      }
      const selectedProduct =
        catalog.find((entry) => entry.id === productId) ??
        filtered.find((entry) => entry.id === productId) ??
        null;
      const [outboxRows, sales, poRecords] = await Promise.all([
        desktopDb.listOutboxItems(),
        desktopDb.listSales(),
        desktopPurchaseOrderService.listPurchaseOrders()
      ]);
      const poLineById = new Map<string, PoLineInfo>();
      for (const po of poRecords) {
        for (const line of po.lines) {
          poLineById.set(line.id, { productId: line.productId, isLpg: line.isLpg, locationId: po.locationId });
        }
      }
      const localRows = buildLocalPendingMovementRows(
        productId,
        appState.setup.locationId,
        selectedProduct ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 },
        outboxRows,
        new Map(sales.map((sale) => [sale.id, sale] as const)),
        poLineById
      );

      let remoteRows: ItemMovementRow[] = [];
      if (appState.auth.accessToken?.trim()) {
        const params = new URLSearchParams();
        params.set('product_id', productId);
        params.set('limit', '120');
        if (appState.setup.locationId?.trim()) {
          params.set('location_id', appState.setup.locationId.trim());
        }
        if (movementFromDate) {
          params.set('since', movementFromDate);
        }
        if (movementToDate) {
          params.set('until', movementToDate);
        }
        const { response } = await desktopAuthService.authorizedFetch(
          appState,
          `${appState.setup.apiBaseUrl.replace(/\/$/, '')}/reports/inventory/movements?${params.toString()}`,
          { method: 'GET' }
        );
        if (!response.ok) {
          const detail = await readFetchErrorDetail(response);
          throw new Error(detail || `Unable to load item movements (${response.status})`);
        }
        const payload = (await response.json()) as { rows?: ItemMovementRow[] };
        remoteRows = Array.isArray(payload.rows) ? payload.rows : [];
      }
      setMovementRows(sortMovementRowsNewestFirst([...localRows, ...remoteRows]));
    } catch (error) {
      const fallbackProduct =
        catalog.find((entry) => entry.id === productId) ??
        filtered.find((entry) => entry.id === productId) ??
        null;
      const fallbackRows = await Promise.all([
        desktopDb.listOutboxItems(),
        desktopDb.listSales(),
        desktopPurchaseOrderService.listPurchaseOrders()
      ])
        .then(([outboxRows, sales, poRecords]) => {
          const fallbackPoLineById = new Map<string, PoLineInfo>();
          for (const po of poRecords) {
            for (const line of po.lines) {
              fallbackPoLineById.set(line.id, { productId: line.productId, isLpg: line.isLpg, locationId: po.locationId });
            }
          }
          return buildLocalPendingMovementRows(
            productId,
            appState.setup.locationId,
            fallbackProduct ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 },
            outboxRows,
            new Map(sales.map((sale) => [sale.id, sale] as const)),
            fallbackPoLineById
          );
        })
        .catch(() => []);
      setMovementRows(fallbackRows);
      const baseMessage =
        error instanceof Error ? error.message : 'Unable to load item movement history.';
      const normalizedMessage = baseMessage.toLowerCase();
      const restrictedMessage =
        normalizedMessage.includes('inventory reports are restricted for cashier accounts') ||
        normalizedMessage.includes('shift security controls add-on is enabled')
          ? 'Item movement history is restricted for cashier accounts when Shift Security Controls is enabled.'
          : baseMessage;
      setMovementError(
        fallbackRows.length > 0
          ? null
          : restrictedMessage
      );
    } finally {
      setMovementLoading(false);
    }
  };

  const categories = useMemo(
    () => ['ALL', ...Array.from(new Set(catalog.map((product) => product.category))).sort((a, b) => a.localeCompare(b))],
    [catalog]
  );

  const categoryScopedCounts = useMemo(() => {
    const term = search.trim().toLowerCase();
    const scopedRows = !term
      ? catalog
      : catalog.filter((product) =>
          [product.name, product.sku, product.category, product.unit].join(' ').toLowerCase().includes(term)
        );
    const counts = new Map<string, number>();
    for (const product of scopedRows) {
      const key = product.category;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    counts.set('ALL', scopedRows.length);
    return counts;
  }, [catalog, search]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return catalog.filter((product) => {
      if (category !== 'ALL' && product.category !== category) {
        return false;
      }
      if (!term) {
        return true;
      }
      return [product.name, product.sku, product.category, product.unit].join(' ').toLowerCase().includes(term);
    });
  }, [catalog, category, search]);

  useEffect(() => {
    setCurrentPage(1);
  }, [category, pageSize, search]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filtered.length / pageSize)),
    [filtered.length, pageSize]
  );

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [currentPage, filtered, pageSize]);

  const visiblePageButtons = useMemo(() => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    return Array.from(
      new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages].filter((page) => page >= 1 && page <= totalPages))
    ).sort((a, b) => a - b);
  }, [currentPage, totalPages]);

  const selected = filtered.find((product) => product.id === selectedId) ?? catalog.find((product) => product.id === selectedId) ?? null;
  const selectedDetail = selected ? detailByProduct[selected.id] ?? null : null;
  const selectedCylinder = selectedDetail?.cylinderTypeId ? cylinderById[selectedDetail.cylinderTypeId] ?? null : null;
  const selectedRules = selected ? priceRulesByProduct[selected.id] ?? [] : [];
  const resolveCylinderSizeLabel = (productId: string): string | null => {
    const product =
      catalog.find((entry) => entry.id === productId) ??
      filtered.find((entry) => entry.id === productId) ??
      null;
    const detail = detailByProduct[productId] ?? null;
    const fallbackSizeLabel = product?.cylinderSizeLabel?.trim() || null;
    if (!(detail?.isLpg || product?.isLpg)) {
      return null;
    }
    if (fallbackSizeLabel) {
      return fallbackSizeLabel;
    }
    if (!detail?.cylinderTypeId) {
      return null;
    }
    const cylinder = cylinderById[detail.cylinderTypeId] ?? null;
    if (cylinder?.sizeKg === null || cylinder?.sizeKg === undefined) {
      return null;
    }
    return `${cylinder.sizeKg} kg`;
  };
  const resolveCylinderSizeError = (productId: string): string | null => {
    const product =
      catalog.find((entry) => entry.id === productId) ??
      filtered.find((entry) => entry.id === productId) ??
      null;
    const detail = detailByProduct[productId] ?? null;
    const fallbackSizeLabel = product?.cylinderSizeLabel?.trim() || null;
    if (!(detail?.isLpg || product?.isLpg)) {
      return null;
    }
    if (!detail?.cylinderTypeId) {
      return 'No cylinder type linked.';
    }
    const cylinder = cylinderById[detail.cylinderTypeId] ?? null;
    if (!cylinder) {
      return fallbackSizeLabel
        ? null
        : `Linked cylinder type ${detail.cylinderTypeId} is not available on this device yet. Refresh branch data.`;
    }
    if (cylinder.sizeKg === null || cylinder.sizeKg === undefined) {
      if (fallbackSizeLabel) {
        return null;
      }
      return `Cylinder type ${cylinder.code} has no size value.`;
    }
    return null;
  };
  const selectedCylinderSizeError = selected ? resolveCylinderSizeError(selected.id) : null;
  const selectedLendedQty = selected ? lendedQtyByProduct[selected.id] ?? 0 : 0;
  const selectedDisposedQty = selected ? disposedQtyByProduct[selected.id] ?? 0 : 0;
  const hideItemHistoryAction = shouldHideItemHistoryForShiftSecurity({
    tenantAddons,
    accessToken: appState.auth.accessToken
  });

  useEffect(() => {
    if (!selected?.id) {
      setMovementRows([]);
      setMovementError(null);
      setMovementLoading(false);
      setItemHistoryOpen(false);
      return;
    }
    if (hideItemHistoryAction) {
      setMovementRows([]);
      setMovementError(null);
      setMovementLoading(false);
      setItemHistoryOpen(false);
      return;
    }
    void loadItemMovements(selected.id);
  }, [selected?.id, appState.setup.locationId, movementFromDate, movementToDate, hideItemHistoryAction]);

  const stockCounts = useMemo(
    () => ({
      total: catalog.length,
      ready: catalog.filter((product) => resolveStockTone(product) === 'good').length,
      low: catalog.filter((product) => resolveStockTone(product) === 'low').length,
      out: catalog.filter((product) => resolveStockTone(product) === 'out').length,
      lended: Number(catalog.reduce((sum, product) => sum + (lendedQtyByProduct[product.id] ?? 0), 0).toFixed(4)),
      disposed: Number(catalog.reduce((sum, product) => sum + (disposedQtyByProduct[product.id] ?? 0), 0).toFixed(4))
    }),
    [catalog, disposedQtyByProduct, lendedQtyByProduct]
  );

  return (
    <div className={screenStackClass}>
      <ItemCatalogOverviewPanel
        title="Item Management"
        subtitle="Track branch inventory, stock buckets, and item movement from one desktop workspace."
        metrics={[
          { key: 'all', label: 'All Items', value: String(stockCounts.total), icon: 'total', tone: 'good' },
          { key: 'ready', label: 'Ready', value: String(stockCounts.ready), icon: 'ready', tone: 'good' },
          { key: 'low', label: 'Low Stock', value: String(stockCounts.low), icon: 'low', tone: 'warn' },
          { key: 'out', label: 'Out Of Stock', value: String(stockCounts.out), icon: 'out', tone: 'out' }
        ]}
        onRefresh={() => void refresh()}
        refreshDisabled={loading}
      />

      <section className={`${shellCardClass} desktop-module-section items-catalog-shell`}>
        <ItemCatalogHeader
          branchLabel={appState.setup.branchLabel || 'Branch not set'}
          locationLabel={appState.setup.locationLabel || 'Location not set'}
          categoryLabel={category === 'ALL' ? 'All categories' : `${category} category`}
          countLabel={`${filtered.length} item${filtered.length === 1 ? '' : 's'}`}
        />

        <div className={`${toolbarGridClass} items-catalog-toolbar`}>
          <SearchField className="w-full" value={search} onChange={setSearch} placeholder="Search item, SKU, category, or unit" />
          <label className="full-width-field items-catalog-category-field">
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value === 'ALL' ? 'All categories' : value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="items-catalog-filter-row">
          {categories.map((value) => (
            <ItemCatalogCategoryChip
              key={value}
              label={value === 'ALL' ? 'All' : value}
              count={String(categoryScopedCounts.get(value) ?? 0)}
              active={category === value}
              onClick={() => setCategory(value)}
            />
          ))}
        </div>

        <div className="items-list">
          {filtered.length === 0 ? (
            <div className="empty-state">No items match this filter yet.</div>
          ) : (
            pagedItems.map((product) => {
              const rowRules = priceRulesByProduct[product.id] ?? [];
              const sizeLabel = product.isLpg ? (resolveCylinderSizeLabel(product.id) ?? 'No size') : 'No size';
              const sizeError = resolveCylinderSizeError(product.id);
              const refillPriceLabel = resolveFlowPriceLabel(rowRules, 'REFILL_EXCHANGE');
              const nonRefillPriceLabel = resolveFlowPriceLabel(rowRules, 'NON_REFILL');
              const badges: ItemCatalogRecordBadge[] = [];

              if (product.isLpg) {
                badges.push({ label: `Full ${formatCylinderQty(product.qtyFull)}`, tone: 'full' });
                badges.push({ label: `Empty ${formatCylinderQty(product.qtyEmpty)}`, tone: 'empty' });
              }

              badges.push({ label: `QOH ${formatQty(product.qtyOnHand)}`, tone: 'qoh' });
              if (product.isLpg) {
                badges.push({ label: `Lended ${formatQty(lendedQtyByProduct[product.id] ?? 0)}`, tone: 'neutral' });
                badges.push({ label: `Disposed ${formatQty(disposedQtyByProduct[product.id] ?? 0)}`, tone: 'neutral' });
              }

              return (
                <ItemCatalogRecordRow
                  key={product.id}
                  title={`${product.sku || product.id} | ${product.name}`}
                  meta={`${product.category || 'Uncategorized'} \u00b7 ${product.unit} \u00b7 ${sizeLabel}`}
                  detail={sizeError ? 'Size needs review' : null}
                  badges={badges}
                  refillPriceLabel={refillPriceLabel}
                  nonRefillPriceLabel={nonRefillPriceLabel}
                  statusLabel={resolveStockLabel(product)}
                  statusTone={resolveStockTone(product)}
                  typeLabel={product.isLpg ? 'LPG' : 'Regular'}
                  typeTone={product.isLpg ? 'lpg' : 'regular'}
                  priceLabel={fmtMoney(product.unitPrice)}
                  selected={selected?.id === product.id}
                  sizeError={sizeError}
                  onClick={() => setSelectedId(product.id)}
                />
              );
            })
          )}
        </div>

        {filtered.length > 0 ? (
          <div className="lending-records-footer">
            <div className="lending-records-footer-summary">
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} records
            </div>
            <div className="lending-records-pager">
              <button
                className="lending-records-page-btn"
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                aria-label="First page"
              >
                «
              </button>
              <button
                className="lending-records-page-btn"
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                aria-label="Previous page"
              >
                ‹
              </button>
              {visiblePageButtons.map((page) => (
                <button
                  key={page}
                  className={`lending-records-page-btn ${page === currentPage ? 'active' : ''}`}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  aria-current={page === currentPage ? 'page' : undefined}
                  aria-label={`Page ${page}`}
                >
                  {page}
                </button>
              ))}
              <button
                className="lending-records-page-btn"
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                aria-label="Next page"
              >
                ›
              </button>
              <button
                className="lending-records-page-btn"
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                aria-label="Last page"
              >
                »
              </button>
            </div>
            <div className="lending-records-page-size">
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                <option value={10}>10 per page</option>
                <option value={20}>20 per page</option>
                <option value={50}>50 per page</option>
              </select>
            </div>
          </div>
        ) : null}
      </section>

      {selected ? (
        <ItemDetailModal
          selected={selected}
          selectedDetail={selectedDetail}
          selectedCylinder={selectedCylinder}
          selectedRules={selectedRules}
          selectedLendedQty={selectedLendedQty}
          selectedDisposedQty={selectedDisposedQty}
          selectedCylinderSizeError={selectedCylinderSizeError}
          selectedSizeLabel={resolveCylinderSizeLabel(selected.id)}
          locationLabel={appState.setup.locationLabel || 'Not set'}
          onClose={() => {
            setSelectedId('');
            setItemHistoryOpen(false);
          }}
          onOpenItemHistory={() => setItemHistoryOpen(true)}
          hideItemHistoryAction={hideItemHistoryAction}
          onOpenLpgService={onOpenLpgService}
        />
      ) : null}

      {selected && itemHistoryOpen && !hideItemHistoryAction ? (
        <div className={modalBackdropClass} role="presentation">
          <div className={modalCardClass}>
            <div className={`${modalToolbarClass} panel-head`}>
              <div className="sales-detail-header">
                <div className="eyebrow">Item history</div>
                <h3>{selectedDetail?.itemCode || selected.sku}</h3>
                <p className={listMetaClass}>{selected.sku} {'\u00b7'} {selected.unit} {'\u00b7'} {selected.category || 'Uncategorized'}</p>
                <p className={listMetaClass}>{selected.name}</p>
              </div>
              <div className="sales-detail-actions">
                <div className="sales-detail-actions-group">
                  <button
                    className="secondary-btn mini-btn modal-close-icon-btn"
                    type="button"
                    onClick={() => setItemHistoryOpen(false)}
                    aria-label="Close modal"
                    title="Close"
                  >
                    <span aria-hidden="true">X</span>
                  </button>
                </div>
              </div>
            </div>
            <div className={`desktop-modal-body ${detailSheetClass}`}>
              <section className={detailSectionClass}>
                <div className={detailSectionHeadClass}>
                  <div>
                    <div className="eyebrow">Item Movement History</div>
                    <h4>Recent stock ledger rows</h4>
                  </div>
                  <div className="flex items-center justify-end">
                    <button
                      className="secondary-btn mini-btn"
                      type="button"
                      onClick={() => void loadItemMovements(selected.id)}
                      disabled={movementLoading}
                    >
                      {movementLoading ? 'Refreshing...' : 'Refresh history'}
                    </button>
                  </div>
                </div>
                <div className="items-history-filter-grid">
                  <label className="grid gap-1">
                    <span className={detailKvTermClass}>From</span>
                    <input
                      type="date"
                      value={movementFromDate}
                      onChange={(event) => setMovementFromDate(event.target.value)}
                      className="rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.94)] px-3 py-2 text-[0.85rem] text-[var(--text-strong)]"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className={detailKvTermClass}>To</span>
                    <input
                      type="date"
                      value={movementToDate}
                      onChange={(event) => setMovementToDate(event.target.value)}
                      className="rounded-xl border border-[var(--border)] bg-[rgba(255,255,255,0.94)] px-3 py-2 text-[0.85rem] text-[var(--text-strong)]"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      className="secondary-btn mini-btn"
                      type="button"
                      onClick={() => {
                        setMovementFromDate('');
                        setMovementToDate('');
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                {movementLoading ? (
                  <div className={detailEmptyClass}>Loading movement history...</div>
                ) : movementError ? (
                  <div className={detailEmptyClass}>{movementError}</div>
                ) : movementRows.length === 0 ? (
                  <div className={detailEmptyClass}>No movement records found for this item.</div>
                ) : (
                  <div className="grid gap-3">
                    {movementRows.slice(0, 40).map((row) => (
                        <div key={row.id} className={historyRowClass}>
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.95fr)] lg:items-start">
                            <div className="grid gap-1.5">
                              <strong className="text-[0.98rem] font-extrabold text-[var(--text-strong)]">
                                {formatMovementTitle(row)}
                              </strong>
                              <span className={detailRuleCopyClass}>
                                {fmtDate(row.created_at)} {'\u2022'} {row.location_name}
                              </span>
                              <span className={detailRuleCopyClass}>
                                {formatMovementReference(row)}
                              </span>
                            </div>
                          <div className="grid gap-1.5 rounded-[16px] border border-[var(--border)] bg-[rgba(242,246,250,0.9)] px-4 py-3">
                            <span className={detailRuleCopyClass}>
                              Qty: {formatQty(row.qty_delta)} | FULL: {formatCylinderQty(row.qty_full_delta)} | EMPTY: {formatCylinderQty(row.qty_empty_delta)}
                            </span>
                            <span className={detailRuleCopyClass}>
                              Qty After: {row.qty_after_known === false ? '-' : formatQty(row.qty_after)} | FULL After: {row.qty_full_after_known === false ? '-' : formatCylinderQty(row.qty_full_after)} | EMPTY After: {row.qty_empty_after_known === false ? '-' : formatCylinderQty(row.qty_empty_after)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      <div className="message-banner">{message}</div>
    </div>
  );
}
