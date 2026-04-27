import { useEffect, useMemo, useState } from 'react';
import { SearchField } from '../components/inputs/SearchField';
import { useDesktopUi } from '../components/feedback/DesktopUiFeedback';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { desktopDb } from '../db/sqlite';
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
  DesktopSalePayload,
  DesktopSaleRecord,
  DesktopSaleType
} from '../db/schema';
import { desktopAuthService } from '../services/desktop-auth.service';
import { desktopDeliveryService } from '../services/desktop-delivery.service';
import { desktopHeldCartService } from '../services/desktop-held-cart.service';
import { desktopMasterDataService } from '../services/desktop-master-data.service';
import { desktopReceiptService, type DesktopQueueOrderReceiptPayload } from '../services/desktop-receipt.service';
import { desktopSettingsService } from '../services/desktop-settings.service';
import { desktopShiftService } from '../services/desktop-shift.service';
import {
  desktopStockProjectionService,
  type DesktopProjectedInventoryTotals
} from '../services/desktop-stock-projection.service';
import { useDesktopTutorialTarget } from '../tutorial/tutorial-provider';

type CartLine = DesktopCatalogProduct & {
  lineId: string;
  quantity: number;
  cylinderFlow?: DesktopCylinderFlowSelection | null;
};

type Props = {
  appState: DesktopAppState;
  onOutboxChanged?: () => Promise<void> | void;
  reopenedSale?: DesktopSaleRecord | null;
  reopenedSaleMode?: 'copy' | 'recreate';
  reopenedSaleNonce?: number;
  quickAddProductId?: string | null;
  quickAddNonce?: number;
  onGoToShift?: () => void;
};

type PickerModalProps = {
  open: boolean;
  title: string;
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

const screenStackClass = 'flex flex-col gap-5';
const shellCardClass =
  'rounded-[28px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] p-5 shadow-[0_18px_44px_rgba(17,40,58,0.08)] backdrop-blur';
const summaryStripClass = 'desktop-summary-strip grid gap-3 sm:grid-cols-2 xl:grid-cols-5';
const summaryTileClass =
  'rounded-[20px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.94)] px-4 py-3 shadow-[0_10px_24px_rgba(17,40,58,0.05)]';
const summaryLabelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const summaryValueClass = 'mt-1 block text-[1rem] font-extrabold text-[var(--text-strong)]';
const selectorTileClass =
  'grid gap-1 rounded-[22px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.95)] px-4 py-4 text-left shadow-[0_10px_24px_rgba(17,40,58,0.05)] transition hover:-translate-y-[1px] hover:border-[rgba(25,118,210,0.28)] hover:shadow-[0_14px_28px_rgba(17,40,58,0.08)]';
const selectorLabelClass = 'text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]';
const selectorValueClass = 'text-[1rem] font-extrabold text-[var(--text-strong)]';
const selectorMetaClass = 'text-[0.88rem] text-[var(--muted)]';
const posModalBackdropClass = 'desktop-modal-backdrop';
const posModalCardClass =
  'desktop-modal-card desktop-modal-card--picker';
const posModalToolbarClass = 'desktop-modal-header flex shrink-0 flex-col gap-4';
const posMetricCardClass =
  'rounded-[22px] border border-slate-200 bg-slate-50/90 px-4 py-4 shadow-[0_14px_34px_-28px_rgba(15,23,42,0.22)]';
const posMetricLabelClass = 'text-xs font-semibold uppercase tracking-[0.18em] text-slate-500';
const posMetricValueClass = 'mt-2 block text-lg font-semibold text-slate-900';
const queueOrdersButtonClass =
  'relative inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[rgba(255,255,255,0.96)] px-3 text-[0.85rem] font-bold text-[var(--text)] shadow-[0_8px_16px_rgba(17,40,58,0.06)] transition-all disabled:opacity-50';

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function manilaDateToken(now: Date): string {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  return ymd.replace(/-/g, '');
}

function makeReceiptNumber(existingSales: DesktopSaleRecord[], now: Date): string {
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
  return `${prefix}-${String(maxSequence + 1).padStart(7, '0')}`;
}

function sanitizeSearchTerm(value: string): string {
  return value
    .replace(/%+/g, ' ')
    .trim()
    .toLowerCase();
}

function toWholeNumberInput(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  return digits.replace(/^0+(?=\d)/, '');
}

function normalizeWholeQuantity(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
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

function formatCylinderSizeLabel(product: { isLpg?: boolean; cylinderSizeLabel?: string | null }): string | null {
  if (!product.isLpg) {
    return null;
  }
  const normalized = typeof product.cylinderSizeLabel === 'string' ? product.cylinderSizeLabel.trim() : '';
  return normalized.length > 0 ? normalized : '-';
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

function makeCartLineId(): string {
  return `cart-line-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isSupportedRewardType(value: string | null | undefined): value is DesktopPosRewardType {
  return (
    value === 'DISCOUNT_FIXED' ||
    value === 'DISCOUNT_PERCENT' ||
    value === 'FREE_DELIVERY' ||
    value === 'FREE_PRODUCT' ||
    value === 'FREE_REFILL'
  );
}

function resolveRewardCartDiscount(reward: DesktopPosRewardRecord, cart: CartLine[]): number {
  if (reward.rewardType === 'FREE_PRODUCT') {
    const targetLine = cart.find((line) => line.id === reward.productId && !line.isLpg);
    if (!targetLine) {
      return 0;
    }
    const freeQty = Math.max(1, reward.freeQty ?? 1);
    return round2(Math.min(targetLine.quantity, freeQty) * targetLine.unitPrice);
  }

  if (reward.rewardType === 'FREE_REFILL') {
    const refillLines = cart.filter(
      (line) => line.isLpg && line.cylinderFlow === 'REFILL_EXCHANGE' && (!reward.productId || line.id === reward.productId)
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

function toRewardRecord(row: Record<string, unknown>): DesktopPosRewardRecord | null {
  const rewardType = typeof row.reward_type === 'string' ? row.reward_type.toUpperCase() : null;
  if (!isSupportedRewardType(rewardType)) {
    return null;
  }
  if (typeof row.id !== 'string') {
    return null;
  }
  return {
    id: row.id,
    code: typeof row.code === 'string' ? row.code : row.id,
    name: typeof row.name === 'string' ? row.name : row.id,
    description: typeof row.description === 'string' ? row.description : null,
    rewardType,
    pointsCost: Number(row.points_cost ?? 0) || 0,
    productId: typeof row.product_id === 'string' ? row.product_id : null,
    freeQty: row.free_qty == null ? null : Number(row.free_qty) || 0,
    discountValue: row.discount_value == null ? null : Number(row.discount_value) || 0,
    minSpend: row.min_spend == null ? null : Number(row.min_spend) || 0,
    status: typeof row.status === 'string' ? (row.status.toUpperCase() as DesktopPosRewardRecord['status']) : 'ACTIVE'
  };
}

function PickerModal(props: PickerModalProps): JSX.Element | null {
  if (!props.open) {
    return null;
  }

  return (
    <div className={posModalBackdropClass} onClick={props.onClose}>
      <div className={posModalCardClass} onClick={(event) => event.stopPropagation()}>
        <div className={posModalToolbarClass}>
          <div className="panel-head pos-sheet-head">
            <div>
              <div className="eyebrow">Selection</div>
              <h3>{props.title}</h3>
            </div>
            <button className="secondary-btn mini-btn" type="button" onClick={props.onClose}>
              Close
            </button>
          </div>

          <SearchField
            className="pos-sheet-search"
            value={props.search}
            onChange={props.onSearch}
            placeholder={props.placeholder}
            autoFocus
          />
        </div>

        <div className="desktop-modal-body picker-list">
          {!props.hideEmptyOption ? (
            <button
              type="button"
              className={`catalog-row picker-row ${props.selectedId === '' ? 'picker-row-selected' : ''}`}
              onClick={() => props.onSelect('')}
            >
              <div>
                <strong>{props.emptyOptionLabel ?? 'None'}</strong>
                <span>{props.emptyOptionHint ?? 'No selection yet.'}</span>
              </div>
            </button>
          ) : null}

          {props.options.length === 0 ? (
            <div className="empty-state">{props.emptyLabel}</div>
          ) : (
            props.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`catalog-row picker-row ${props.selectedId === option.id ? 'picker-row-selected' : ''}`}
                onClick={() => props.onSelect(option.id)}
              >
                <div>
                  <strong>{option.label}</strong>
                  <span>{option.subtitle ?? 'No extra details yet.'}</span>
                  {option.address?.trim() ? <span>{option.address.trim()}</span> : null}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="desktop-modal-footer">
          {props.onAction ? (
            <button className="primary-btn" type="button" onClick={props.onAction} disabled={props.actionDisabled}>
              {props.actionLabel ?? 'Add New'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PosScreen({
  appState,
  onOutboxChanged,
  reopenedSale = null,
  reopenedSaleMode = 'copy',
  reopenedSaleNonce = 0,
  quickAddProductId = null,
  quickAddNonce = 0,
  onGoToShift
}: Props): JSX.Element {
  const desktopUi = useDesktopUi();
  const orderTypeTarget = useDesktopTutorialTarget('pos-order-type');
  const customerTarget = useDesktopTutorialTarget('pos-customer');
  const itemSelectorTarget = useDesktopTutorialTarget('pos-item-selector');
  const proceedPaymentTarget = useDesktopTutorialTarget('pos-proceed-payment');
  const [customerSearch, setCustomerSearch] = useState('');
  const [personnelSearch, setPersonnelSearch] = useState('');
  const [helperSearch, setHelperSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [heldCartSearch, setHeldCartSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState('ALL');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedPersonnelId, setSelectedPersonnelId] = useState('');
  const [selectedHelperId, setSelectedHelperId] = useState('');
  const [notes, setNotes] = useState('');
  const [orderType, setOrderType] = useState<DesktopSaleType>('PICKUP');
  const [paymentMode, setPaymentMode] = useState<DesktopPaymentMode>('FULL');
  const [paymentMethod, setPaymentMethod] = useState<DesktopPaymentMethod>('CASH');
  const [paidAmount, setPaidAmount] = useState('0');
  const [discountAmount, setDiscountAmount] = useState('0');
  const [deliveryFee, setDeliveryFee] = useState('0');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [catalog, setCatalog] = useState<DesktopCatalogProduct[]>([]);
  const [projectedInventoryByProduct, setProjectedInventoryByProduct] = useState<
    Map<string, DesktopProjectedInventoryTotals>
  >(new Map());
  const [customers, setCustomers] = useState<DesktopOption[]>([]);
  const [personnels, setPersonnels] = useState<DesktopOption[]>([]);
  const [heldCarts, setHeldCarts] = useState<DesktopHeldCartRecord[]>([]);
  const [availableRewards, setAvailableRewards] = useState<DesktopPosRewardRecord[]>([]);
  const [selectedRewardId, setSelectedRewardId] = useState('');
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [holdLabel, setHoldLabel] = useState('');
  const [recreatedFromSaleId, setRecreatedFromSaleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [createCustomerModalOpen, setCreateCustomerModalOpen] = useState(false);
  const [personnelModalOpen, setPersonnelModalOpen] = useState(false);
  const [helperModalOpen, setHelperModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [queuePreviewOpen, setQueuePreviewOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [heldCartModalOpen, setHeldCartModalOpen] = useState(false);
  const [createCustomerName, setCreateCustomerName] = useState('');
  const [createCustomerAddress, setCreateCustomerAddress] = useState('');
  const [createCustomerCode, setCreateCustomerCode] = useState('');
  const [createCustomerContactNumber, setCreateCustomerContactNumber] = useState('');
  const [createCustomerGas, setCreateCustomerGas] = useState('');
  const [createCustomerProvince, setCreateCustomerProvince] = useState('');
  const [createCustomerCity, setCreateCustomerCity] = useState('');
  const [createCustomerSaving, setCreateCustomerSaving] = useState(false);
  const [message, setMessage] = useState(
    'Download branch data in Settings first, then POS will use the local products and customers.'
  );

  const showInfo = (nextMessage: string): void => {
    setMessage(nextMessage);
    desktopUi.showToast({ message: nextMessage, tone: 'info' });
  };

  const showSuccess = (nextMessage: string): void => {
    setMessage(nextMessage);
    desktopUi.showToast({ message: nextMessage, tone: 'success' });
  };

  const showWarning = (nextMessage: string): void => {
    setMessage(nextMessage);
    desktopUi.showToast({ message: nextMessage, tone: 'warning', durationMs: 3200 });
  };

  const showError = (nextMessage: string): void => {
    setMessage(nextMessage);
    desktopUi.showToast({ message: nextMessage, tone: 'error', durationMs: 4200 });
  };

  const filteredCustomers = useMemo(() => {
    const term = sanitizeSearchTerm(customerSearch);
    if (!term) {
      return customers;
    }
    return customers.filter(
      (customer) =>
        customer.label.toLowerCase().includes(term) ||
        (customer.subtitle ?? '').toLowerCase().includes(term) ||
        (customer.address ?? '').toLowerCase().includes(term)
    );
  }, [customerSearch, customers]);

  const closeCreateCustomerModal = (): void => {
    if (createCustomerSaving) {
      return;
    }
    setCreateCustomerModalOpen(false);
    setCreateCustomerName('');
    setCreateCustomerAddress('');
    setCreateCustomerCode('');
    setCreateCustomerContactNumber('');
    setCreateCustomerGas('');
    setCreateCustomerProvince('');
    setCreateCustomerCity('');
  };

  const handleCreateOfflineCustomer = async (): Promise<void> => {
    const name = createCustomerName.trim();
    if (!name) {
      showError('Customer name is required.');
      return;
    }
    setCreateCustomerSaving(true);
    try {
      const createdId = await desktopMasterDataService.createOfflineCustomer({
        name,
        address: createCustomerAddress.trim() || null,
        code: createCustomerCode.trim() || null,
        contactNumber: createCustomerContactNumber.trim() || null,
        gas: createCustomerGas.trim() || null,
        province: createCustomerProvince.trim() || null,
        city: createCustomerCity.trim() || null
      });
      const customerRows = await desktopMasterDataService.loadCustomers();
      setCustomers(customerRows);
      setSelectedCustomerId(createdId);
      setCustomerSearch('');
      setCreateCustomerModalOpen(false);
      setCreateCustomerName('');
      setCreateCustomerAddress('');
      setCreateCustomerCode('');
      setCreateCustomerContactNumber('');
      setCreateCustomerGas('');
      setCreateCustomerProvince('');
      setCreateCustomerCity('');
      setCustomerModalOpen(false);
      showSuccess(`${name} was saved locally and is ready for this sale.`);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to save customer locally.');
    } finally {
      setCreateCustomerSaving(false);
    }
  };

  const filteredPersonnels = useMemo(() => {
    const term = personnelSearch.trim().toLowerCase();
    const rows = personnels.filter((personnel) => personnel.id !== selectedHelperId);
    if (!term) {
      return rows;
    }
    return rows.filter(
      (personnel) =>
        personnel.label.toLowerCase().includes(term) ||
        (personnel.subtitle ?? '').toLowerCase().includes(term)
    );
  }, [personnelSearch, personnels, selectedHelperId]);

  const filteredHelpers = useMemo(() => {
    const term = helperSearch.trim().toLowerCase();
    const rows = personnels.filter((personnel) => personnel.id !== selectedPersonnelId);
    if (!term) {
      return rows;
    }
    return rows.filter(
      (personnel) =>
        personnel.label.toLowerCase().includes(term) ||
        (personnel.subtitle ?? '').toLowerCase().includes(term)
    );
  }, [helperSearch, personnels, selectedPersonnelId]);

  const itemCategoryOptions = useMemo(() => {
    const next = new Set<string>();
    for (const product of catalog) {
      if (product.category.trim()) {
        next.add(product.category.trim());
      }
    }
    return ['ALL', ...Array.from(next).sort((a, b) => a.localeCompare(b))];
  }, [catalog]);

  const filteredProducts = useMemo(() => {
    const term = sanitizeSearchTerm(itemSearch);
    return catalog.filter((product) => {
      const matchesCategory = itemCategoryFilter === 'ALL' || product.category === itemCategoryFilter;
      if (!matchesCategory) {
        return false;
      }
      if (!term) {
        return true;
      }
      return (
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        product.category.toLowerCase().includes(term) ||
        (product.cylinderSizeLabel ?? '').toLowerCase().includes(term)
      );
    });
  }, [catalog, itemCategoryFilter, itemSearch]);

  const filteredHeldCarts = useMemo(() => {
    const term = heldCartSearch.trim().toLowerCase();
    if (!term) {
      return heldCarts;
    }
    return heldCarts.filter((held) =>
      [
        held.label,
        held.customerName ?? '',
        held.lines.map((line) => line.productName).join(' ')
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [heldCartSearch, heldCarts]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );
  const currentPointsBalance = selectedCustomer?.pointsBalance ?? 0;
  const selectedPersonnel = useMemo(
    () => personnels.find((personnel) => personnel.id === selectedPersonnelId) ?? null,
    [personnels, selectedPersonnelId]
  );
  const selectedHelper = useMemo(
    () => personnels.find((personnel) => personnel.id === selectedHelperId) ?? null,
    [personnels, selectedHelperId]
  );
  const resolveProjectedProduct = (product: DesktopCatalogProduct): DesktopCatalogProduct => {
    const projected = projectedInventoryByProduct.get(product.id);
    if (!projected) {
      return product;
    }
    return {
      ...product,
      qtyOnHand: projected.qtyOnHand,
      qtyFull: projected.qtyFull,
      qtyEmpty: projected.qtyEmpty
    };
  };
  const resolveAvailableForLine = (product: DesktopCatalogProduct): number =>
    resolveAvailableQty(resolveProjectedProduct(product));

  const selectedReward = useMemo(
    () => availableRewards.find((reward) => reward.id === selectedRewardId) ?? null,
    [availableRewards, selectedRewardId]
  );
  const subtotal = useMemo(
    () => Number(cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0).toFixed(2)),
    [cart]
  );
  const discount = Math.min(subtotal, Number.isFinite(Number(discountAmount)) ? Number(discountAmount) : 0);
  const deliveryFeeValue = useMemo(() => {
    if (orderType !== 'DELIVERY') {
      return 0;
    }
    const parsed = Number(deliveryFee || '0');
    return Number.isFinite(parsed) && parsed > 0 ? round2(parsed) : 0;
  }, [deliveryFee, orderType]);
  const total = Number(Math.max(0, subtotal - discount + deliveryFeeValue).toFixed(2));
  const parsedPaidAmount = Number.isFinite(Number(paidAmount)) ? Number(paidAmount) : 0;
  const appliedPaidAmount = useMemo(
    () => Number(Math.max(0, Math.min(parsedPaidAmount, total)).toFixed(2)),
    [parsedPaidAmount, total]
  );
  const changeAmount = useMemo(
    () => Number((paymentMode === 'FULL' ? Math.max(0, parsedPaidAmount - total) : 0).toFixed(2)),
    [parsedPaidAmount, paymentMode, total]
  );
  const creditBalance = useMemo(
    () => Number((paymentMode === 'PARTIAL' ? Math.max(0, total - appliedPaidAmount) : 0).toFixed(2)),
    [appliedPaidAmount, paymentMode, total]
  );
  const rewardBaseAmount = useMemo(
    () => round2(Math.max(0, subtotal - discount) + deliveryFeeValue),
    [subtotal, discount, deliveryFeeValue]
  );
  const rewardEligibleOptions = useMemo(
    () =>
      availableRewards.filter((reward) => {
        if (reward.status !== 'ACTIVE') {
          return false;
        }
        if (selectedCustomer && reward.pointsCost > (selectedCustomer.pointsBalance ?? 0)) {
          return false;
        }
        if (reward.minSpend !== null && rewardBaseAmount < reward.minSpend) {
          return false;
        }
        if (
          (reward.rewardType === 'FREE_PRODUCT' || reward.rewardType === 'FREE_REFILL') &&
          resolveRewardCartDiscount(reward, cart) <= 0
        ) {
          return false;
        }
        if (reward.rewardType === 'FREE_DELIVERY' && orderType !== 'DELIVERY') {
          return false;
        }
        return true;
      }),
    [availableRewards, cart, orderType, rewardBaseAmount, selectedCustomer]
  );
  const rewardItemDiscountValue = useMemo(() => {
    if (!selectedReward) {
      return 0;
    }
    if (selectedReward.rewardType === 'DISCOUNT_FIXED') {
      return round2(Math.min(selectedReward.discountValue ?? 0, Math.max(0, subtotal - discount)));
    }
    if (selectedReward.rewardType === 'DISCOUNT_PERCENT') {
      return round2(Math.max(0, subtotal - discount) * ((selectedReward.discountValue ?? 0) / 100));
    }
    if (selectedReward.rewardType === 'FREE_PRODUCT' || selectedReward.rewardType === 'FREE_REFILL') {
      return resolveRewardCartDiscount(selectedReward, cart);
    }
    return 0;
  }, [cart, discount, selectedReward, subtotal]);
  const rewardDeliveryDiscountValue = useMemo(() => {
    if (!selectedReward || selectedReward.rewardType !== 'FREE_DELIVERY') {
      return 0;
    }
    return deliveryFeeValue;
  }, [deliveryFeeValue, selectedReward]);
  const totalRewardValue = useMemo(
    () => round2(rewardItemDiscountValue + rewardDeliveryDiscountValue),
    [rewardDeliveryDiscountValue, rewardItemDiscountValue]
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
    [cart]
  );
  const paymentReady = useMemo(() => {
    if (paymentMode === 'FULL') {
      return parsedPaidAmount + 0.0001 >= total;
    }
    return parsedPaidAmount >= 0 && parsedPaidAmount < total;
  }, [parsedPaidAmount, paymentMode, total]);
  const paymentHint = useMemo(() => {
    const modeHint =
      paymentMode === 'FULL'
        ? 'Full payment: amount tendered can be equal to or higher than total. Change is calculated automatically.'
        : 'Partial payment: collect any amount lower than the total. The remaining balance becomes customer credit.';
    const orderHint =
      orderType === 'DELIVERY'
        ? `Delivery sale: assign the field personnel first so this order stays linked to ${selectedPersonnel?.label ?? 'the delivery team'}.`
        : 'Pickup sale: cashier can complete this order at the counter once payment is ready.';
    return `${modeHint} ${orderHint}`;
  }, [orderType, paymentMode, selectedPersonnel?.label]);

  const refreshHeldCarts = async (): Promise<void> => {
    const rows = await desktopHeldCartService.listHeldCarts();
    setHeldCarts(rows);
  };

  const refreshCatalog = async (): Promise<void> => {
    if (!appState.setup.locationId) {
      setCatalog([]);
      setProjectedInventoryByProduct(new Map());
      setCustomers([]);
      setPersonnels([]);
      setActiveShiftId(null);
      return;
    }

    setLoadingCatalog(true);
    try {
      const [catalogRows, customerRows, personnelRows, activeShift, projectedInventory] = await Promise.all([
        desktopMasterDataService.loadCatalog(appState.setup.locationId),
        desktopMasterDataService.loadCustomers(),
        desktopMasterDataService.loadPersonnelOptions(),
        desktopShiftService.findActiveShift(),
        desktopStockProjectionService.loadProjectedInventoryByProduct(appState.setup.locationId)
      ]);
      const nextCatalog = catalogRows.map((product) => {
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
      setCatalog(nextCatalog);
      setProjectedInventoryByProduct(projectedInventory);
      setCustomers(customerRows);
      setPersonnels(personnelRows);
      setActiveShiftId(activeShift?.id ?? null);
      setCart((prev) =>
        prev.map((line) => {
          const match = nextCatalog.find((entry) => entry.id === line.id);
          return match
            ? {
                ...line,
                qtyOnHand: match.qtyOnHand,
                qtyFull: match.qtyFull,
                qtyEmpty: match.qtyEmpty
              }
            : line;
        })
      );
      if (nextCatalog.length === 0) {
        showWarning('No local products were found for this location yet. Download branch data in Settings first.');
      }
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    void refreshHeldCarts();
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [appState.setup.locationId]);

  useEffect(() => {
    if (saving) {
      desktopUi.setLoading({ visible: true, label: 'Saving sale...' });
      return;
    }
    if (loadingCatalog) {
      desktopUi.setLoading({ visible: true, label: 'Refreshing local products...' });
      return;
    }
    if (paymentModalOpen && rewardsLoading) {
      desktopUi.setLoading({ visible: true, label: 'Loading rewards...' });
      return;
    }
    desktopUi.clearLoading();
  }, [desktopUi, loadingCatalog, paymentModalOpen, rewardsLoading, saving]);

  useEffect(() => {
    if (!paymentModalOpen || !selectedCustomerId || !appState.setup.branchId || !appState.setup.locationId || !appState.auth.accessToken) {
      setAvailableRewards([]);
      setSelectedRewardId('');
      return;
    }

    let active = true;
    void (async () => {
      setRewardsLoading(true);
      try {
        const { response, state: nextState } = await desktopAuthService.authorizedFetch(
          appState,
          `${appState.setup.apiBaseUrl.replace(/\/$/, '')}/vcard/rewards?status=ACTIVE&branch_id=${encodeURIComponent(appState.setup.branchId)}&location_id=${encodeURIComponent(appState.setup.locationId)}&limit=100`
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
          showError(error instanceof Error ? error.message : 'Rewards are unavailable right now.');
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
    selectedCustomerId
  ]);

  useEffect(() => {
    if (!rewardEligibleOptions.some((reward) => reward.id === selectedRewardId)) {
      setSelectedRewardId('');
    }
  }, [rewardEligibleOptions, selectedRewardId]);

  useEffect(() => {
    if (!reopenedSale) {
      return;
    }

    const cartLines: CartLine[] = reopenedSale.payload.lines.map((line) => {
      const match = catalog.find((product) => product.id === line.productId);
      return {
        ...(match ?? {
          id: line.productId,
          sku: line.productId,
          name: line.productName,
          category: 'Reopened Sale',
          unit: 'unit',
          unitPrice: line.unitPrice,
          qtyOnHand: 0,
          qtyFull: 0,
          qtyEmpty: 0,
          isLpg: false
        }),
        lineId: line.lineId ?? makeCartLineId(),
        quantity: Math.max(1, normalizeWholeQuantity(line.quantity)),
        unitPrice: line.unitPrice,
        cylinderFlow: (match?.isLpg ?? false) ? (line.cylinderFlow ?? null) : null
      };
    });

    setCart(cartLines);
    setSelectedCustomerId(reopenedSale.payload.customerId ?? '');
    setSelectedPersonnelId(reopenedSale.payload.personnelId ?? '');
    setSelectedHelperId(reopenedSale.payload.helperId ?? '');
    setOrderType(reopenedSale.payload.saleType);
    setPaymentMode(reopenedSale.payload.paymentMode ?? 'FULL');
    setPaymentMethod(reopenedSale.payload.paymentMethod);
    setPaidAmount(
      String(
        reopenedSale.payload.paidAmount ??
          (reopenedSale.payload.paymentMode === 'PARTIAL'
            ? Math.max(0, reopenedSale.payload.totalAmount - (reopenedSale.payload.creditBalance ?? 0))
            : reopenedSale.payload.totalAmount)
      )
    );
    setRecreatedFromSaleId(
      reopenedSaleMode === 'recreate' ? reopenedSale.id : reopenedSale.payload.recreatedFromSaleId ?? null
    );
    setDiscountAmount(String(reopenedSale.payload.discountAmount ?? 0));
    setDeliveryFee(String(reopenedSale.payload.deliveryFee ?? 0));
    setNotes(
      [
        reopenedSale.payload.notes,
        reopenedSaleMode === 'recreate'
          ? `Recreated from ${reopenedSale.receiptNumber}`
          : `Reopened from ${reopenedSale.receiptNumber}`
      ]
        .filter(Boolean)
        .join(' | ')
    );
    setPersonnelModalOpen(false);
    setHelperModalOpen(false);
    setCustomerModalOpen(false);
    setItemModalOpen(false);
    setPaymentModalOpen(false);
    showInfo(
      reopenedSaleMode === 'recreate'
        ? `Loaded ${reopenedSale.receiptNumber} into POS as a replacement sale. Review and save when ready.`
        : `Loaded ${reopenedSale.receiptNumber} back into POS. Review and save when ready.`
    );
  }, [catalog, reopenedSale, reopenedSaleMode, reopenedSaleNonce]);

  const resetCheckoutForm = (): void => {
    setCart([]);
    setSelectedCustomerId('');
    setCustomerSearch('');
    setSelectedPersonnelId('');
    setPersonnelSearch('');
    setSelectedHelperId('');
    setHelperSearch('');
    setItemSearch('');
    setHeldCartSearch('');
    setItemCategoryFilter('ALL');
    setNotes('');
    setDiscountAmount('0');
    setDeliveryFee('0');
    setPaymentMode('FULL');
    setPaidAmount('0');
    setSelectedRewardId('');
    setAvailableRewards([]);
    setRecreatedFromSaleId(null);
    setHoldLabel('');
    setOrderType('PICKUP');
    setPaymentModalOpen(false);
  };

  const addToCart = (product: DesktopCatalogProduct): void => {
    const available = normalizeWholeQuantity(resolveAvailableForLine(product));
    const defaultFlow = product.isLpg && appState.setup.posDefaultLpgFlow !== 'NONE'
      ? appState.setup.posDefaultLpgFlow
      : null;
    if (available <= 0.0001) {
      showWarning(`${product.name} has no available stock right now.`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((line) =>
        product.isLpg
          ? line.id === product.id && (line.cylinderFlow ?? null) === defaultFlow
          : line.id === product.id
      );
      if (!existing) {
          return [...prev, { ...resolveProjectedProduct(product), lineId: makeCartLineId(), quantity: 1, cylinderFlow: defaultFlow }];
      }
      if (existing.quantity + 1 > available + 0.0001) {
        showWarning(`${product.name} only has ${available} available.`);
        return prev;
      }
      return prev.map((line) =>
        line.lineId === existing.lineId ? { ...line, quantity: line.quantity + 1 } : line
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
          const available = normalizeWholeQuantity(resolveAvailableForLine(line));
          const requested = normalizeWholeQuantity(nextQuantity);
          const capped = Math.min(requested, available);
          if (requested > available) {
            showWarning(`${line.name} only has ${available} available.`);
          }
          return { ...line, quantity: capped };
        })
        .filter((line) => line.quantity > 0)
    );
  };

  const setLineCylinderFlow = (lineId: string, nextFlow: DesktopCylinderFlowSelection): void => {
    setCart((prev) => {
      const current = prev.find((line) => line.lineId === lineId);
      if (!current || !current.isLpg || current.cylinderFlow === nextFlow) {
        return prev;
      }

      const duplicate = prev.find(
        (line) =>
          line.lineId !== lineId &&
          line.id === current.id &&
          line.isLpg &&
          line.cylinderFlow === nextFlow
      );

      if (!duplicate) {
        return prev.map((line) =>
          line.lineId === lineId
            ? {
                ...line,
                cylinderFlow: nextFlow
              }
            : line
        );
      }

      return prev
        .map((line) => {
          if (line.lineId === duplicate.lineId) {
            return {
              ...line,
              quantity: line.quantity + current.quantity
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
      showWarning('That item is not in the local branch catalog yet. Refresh branch data first.');
      return;
    }
    addToCart(product);
    showSuccess(`${product.name} was added to the POS cart.`);
  }, [catalog, quickAddNonce, quickAddProductId]);

  useEffect(() => {
    if (paymentMode === 'PARTIAL' && Number(paidAmount || '0') > total) {
      setPaidAmount(total.toFixed(2));
    }
  }, [paidAmount, paymentMode, total]);

  const handleSelectReward = (reward: DesktopPosRewardRecord): void => {
    setSelectedRewardId(reward.id);
    if (reward.rewardType === 'DISCOUNT_FIXED' && Number(discountAmount || '0') <= 0 && reward.discountValue !== null) {
      setDiscountAmount(reward.discountValue.toFixed(2));
      return;
    }
    if (reward.rewardType === 'DISCOUNT_PERCENT' && Number(discountAmount || '0') <= 0 && reward.discountValue !== null) {
      const suggested = round2(rewardBaseAmount * (reward.discountValue / 100));
      setDiscountAmount(suggested.toFixed(2));
      return;
    }
    if (reward.rewardType === 'FREE_DELIVERY' && orderType === 'DELIVERY' && deliveryFeeValue > 0) {
      setDeliveryFee('0.00');
      return;
    }
    if (
      (reward.rewardType === 'FREE_PRODUCT' || reward.rewardType === 'FREE_REFILL') &&
      Number(discountAmount || '0') <= 0
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
    showSuccess(customerId ? 'Customer updated for this sale.' : 'Walk-in customer selected.');
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
      refill: cart.filter((line) => line.isLpg && line.cylinderFlow === 'REFILL_EXCHANGE').length,
      nonRefill: cart.filter((line) => line.isLpg && line.cylinderFlow === 'NON_REFILL').length
    }),
    [cart]
  );
  const missingFlowCount = useMemo(
    () => cart.filter((line) => line.isLpg && !line.cylinderFlow).length,
    [cart]
  );
  const checkoutStatusLabel = useMemo(() => {
    if (!activeShiftId) {
      return 'Shift required';
    }
    if (!cart.length) {
      return 'Waiting for items';
    }
    if (!selectedCustomerId || !selectedPersonnelId) {
      return 'Needs customer and personnel';
    }
    if (missingFlowCount > 0) {
      return 'Needs LPG flow';
    }
    if (cartWarnings.length > 0) {
      return 'Needs stock review';
    }
    return 'Ready for payment';
  }, [activeShiftId, cart.length, cartWarnings.length, missingFlowCount, selectedCustomerId, selectedPersonnelId]);

  const validateCartBeforePayment = (): string | null => {
    if (!activeShiftId) {
      return 'Start Duty in Shift before proceeding to payment.';
    }
    if (!cart.length) {
      return 'Add at least one item before proceeding to payment.';
    }
    if (!selectedCustomerId) {
      return 'Customer is required before payment.';
    }
    if (!selectedPersonnelId) {
      return 'Personnel is required before payment.';
    }
    if (cart.some((line) => line.isLpg && !line.cylinderFlow)) {
      return 'Select Refill or Non-Refill for every LPG item before payment.';
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
      if (line.cylinderFlow === 'NON_REFILL' && (projected.qtyOnHand ?? 0) + 0.0001 < line.quantity) {
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
      ? [line.cylinderFlow === 'REFILL_EXCHANGE' ? 'Refill' : line.cylinderFlow === 'NON_REFILL' ? 'Non-Refill' : null, formatCylinderSizeLabel(line)]
          .filter(Boolean)
          .join(' | ')
      : formatCylinderSizeLabel(line)
  }));

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
    lines
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
    lines: Array<{ productId?: string | null; name: string; subtitle?: string | null; quantity: number; unitPrice: number }>;
  }): DesktopQueueOrderReceiptPayload => {
    const subtotalValue = Number(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0).toFixed(2));
    return {
      queueId,
      queueLabel,
      branchName: appState.setup.branchLabel,
      locationName: appState.setup.locationLabel,
      cashierName: appState.setup.operatorName || 'Operator',
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
        unitPrice: line.unitPrice
      })),
      subtotal: subtotalValue,
      discount: Number(queueDiscountAmount.toFixed(2)),
      total: Number((subtotalValue - queueDiscountAmount + queueDeliveryFee).toFixed(2)),
      paidAmount: Number(queuePaidAmount.toFixed(2)),
      paymentMode: queuePaymentMode,
      paymentMethod: queuePaymentMethod,
      notes: queueNotes,
      createdAt
    };
  };

  const printQueueOrderReceipt = async (payload: DesktopQueueOrderReceiptPayload): Promise<void> => {
    try {
      await desktopReceiptService.printQueueOrderReceipt(payload, appState);
      showSuccess(`Queue slip ${payload.queueLabel} was sent to the printer.`);
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : 'Unable to print queue slip.');
    }
  };

  const holdCurrentCart = async (): Promise<void> => {
    if (!cart.length) {
      showWarning('Add items first before holding a cart.');
      return;
    }

    const held = await desktopHeldCartService.holdCart({
      label: holdLabel,
      customerId: selectedCustomer?.id ?? null,
      customerName: selectedCustomer?.label ?? null,
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
        cylinderFlow: line.cylinderFlow ?? null
      }))
    });

    resetCheckoutForm();
    setQueuePreviewOpen(false);
    await refreshHeldCarts();
    showSuccess(`Queue order ${held.label} was saved and is ready to load later.`);
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
          category: 'Held Cart',
          unit: 'unit',
          unitPrice: line.unitPrice,
          qtyOnHand: 0,
          qtyFull: 0,
          qtyEmpty: 0,
          isLpg: false
        }),
        lineId: line.lineId ?? makeCartLineId(),
        quantity: Math.max(1, normalizeWholeQuantity(line.quantity)),
        unitPrice: line.unitPrice,
        cylinderFlow: (match?.isLpg ?? false) ? (line.cylinderFlow ?? null) : null
      };
    });

    setCart(cartLines);
    setSelectedCustomerId(held.customerId ?? '');
    setSelectedPersonnelId(held.personnelId ?? '');
    setSelectedHelperId(held.helperId ?? '');
    setOrderType(held.saleType);
    setPaymentMode(held.paymentMode ?? 'FULL');
    setPaymentMethod(held.paymentMethod);
    setPaidAmount(String(held.paidAmount ?? 0));
    setDiscountAmount(String(held.discountAmount));
    setDeliveryFee(String(held.deliveryFee ?? 0));
    setSelectedRewardId('');
    setNotes(held.notes ?? '');
    setHoldLabel('');
    setPaymentModalOpen(false);
    void (async () => {
      await desktopHeldCartService.removeHeldCart(held.id);
      await refreshHeldCarts();
    })();
    showSuccess(`Queue order ${held.label} was restored into POS.`);
  };

  const handleProceedToPayment = (): void => {
    const validationError = validateCartBeforePayment();
    if (validationError) {
      showWarning(validationError);
      if (validationError.includes('Customer')) {
        setCustomerModalOpen(true);
      } else if (validationError.includes('Personnel')) {
        setPersonnelModalOpen(true);
      } else if (validationError.includes('Shift')) {
        onGoToShift?.();
      }
      return;
    }
    setPaidAmount('0');
    setPaymentModalOpen(true);
  };

  const persistSale = async (): Promise<DesktopSaleRecord | null> => {
    if (!appState.setupCompleted) {
      showWarning('Finish setup first before saving sales.');
      return null;
    }
    if (!activeShiftId) {
      showWarning('Start Duty in Shift before saving a sale.');
      return null;
    }
    if (!appState.setup.locationId) {
      showWarning('Choose a branch location in Settings before using POS.');
      return null;
    }
    if (!catalog.length) {
      showWarning('No local product catalog is available yet. Download branch data in Settings first.');
      return null;
    }
    if (!cart.length) {
      showWarning('Add at least one item before saving a sale.');
      return null;
    }
    if (!selectedCustomerId) {
      showWarning('Customer is required before payment.');
      setCustomerModalOpen(true);
      return null;
    }
    if (!selectedPersonnelId) {
      showWarning('Personnel is required before payment.');
      setPersonnelModalOpen(true);
      return null;
    }
    if (cart.some((line) => line.isLpg && !line.cylinderFlow)) {
      showWarning('Select Refill or Non-Refill for every LPG item before payment.');
      return null;
    }
    if (paymentMode === 'FULL' && parsedPaidAmount + 0.0001 < total) {
      showWarning('Full payment requires amount equal to or greater than total.');
      return null;
    }
    if (paymentMode === 'PARTIAL') {
      if (!Number.isFinite(parsedPaidAmount) || parsedPaidAmount < 0) {
        showWarning('Enter a valid paid amount for partial payment.');
        return null;
      }
      if (parsedPaidAmount >= total) {
        showWarning('Partial payment must be less than total.');
        return null;
      }
    }
    if (cartWarnings.length > 0) {
      showWarning(cartWarnings[0]);
      return null;
    }
    if (selectedReward && !appState.auth.accessToken) {
      showWarning('Reward redemption needs an online desktop session. Clear the reward or sign in again.');
      return null;
    }

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const existingLocalSales = await desktopDb.listSales();
    const saleId = `desk-sale-${Date.now()}`;
    const receiptNumber = makeReceiptNumber(existingLocalSales, nowDate);
    const lines: DesktopSaleLine[] = cart.map((line) => ({
      lineId: line.lineId,
      productId: line.id,
      productName: line.name,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: Number((line.quantity * line.unitPrice).toFixed(2)),
      cylinderFlow: line.isLpg ? (line.cylinderFlow ?? null) : null
    }));
    let workingState = appState;
    let reservedRewardId: string | null = null;

    if (selectedReward) {
      const reserveResponse = await desktopAuthService.authorizedFetch(
        workingState,
        `${workingState.setup.apiBaseUrl.replace(/\/$/, '')}/vcard/rewards/${encodeURIComponent(selectedReward.id)}/reserve`,
        {
          method: 'POST',
          body: JSON.stringify({
            customer_id: selectedCustomer?.id ?? null,
            branch_id: workingState.setup.branchId,
            location_id: workingState.setup.locationId,
            amount: rewardBaseAmount,
            remarks: `Reserved from desktop POS (${orderType})`,
            metadata: {
              origin: 'DESKTOP_POS',
              order_type: orderType
            }
          })
        }
      );
      workingState = reserveResponse.state;
      if (!reserveResponse.response.ok) {
        const detail = await reserveResponse.response.text().catch(() => '');
        throw new Error(detail || `Unable to reserve reward (${reserveResponse.response.status})`);
      }
      const reserved = (await reserveResponse.response.json()) as { id?: string };
      reservedRewardId = typeof reserved.id === 'string' ? reserved.id : null;
      if (!reservedRewardId) {
        throw new Error('Reward reserve succeeded but no redemption id was returned.');
      }

      const applyResponse = await desktopAuthService.authorizedFetch(
        workingState,
        `${workingState.setup.apiBaseUrl.replace(/\/$/, '')}/vcard/rewards/redemptions/${encodeURIComponent(reservedRewardId)}/apply`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            sale_id: saleId,
            amount: rewardBaseAmount,
            remarks: `Applied from desktop POS sale ${saleId}`,
            metadata: {
              origin: 'DESKTOP_POS',
              sale_id: saleId
            }
          })
        }
      );
      workingState = applyResponse.state;
      if (!applyResponse.response.ok) {
        const detail = await applyResponse.response.text().catch(() => '');
        throw new Error(detail || `Unable to apply reward (${applyResponse.response.status})`);
      }
    }

    const syncedPaymentAmount = Number(
      (paymentMode === 'FULL' ? total : Math.max(0, Math.min(parsedPaidAmount, total))).toFixed(2)
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
        { userId: selectedPersonnel?.id ?? '', role: 'DRIVER' as const, name: selectedPersonnel?.label ?? null },
        ...(selectedHelper?.id
          ? [{ userId: selectedHelper.id, role: 'HELPER' as const, name: selectedHelper.label ?? null }]
          : [])
      ].filter((entry) => entry.userId.trim().length > 0),
      saleType: orderType,
      paymentMode,
      paymentMethod,
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
          method: paymentMethod,
          amount: syncedPaymentAmount,
          referenceNo: null
        }
      ],
      rewardId: selectedReward?.id ?? null,
      rewardName: selectedReward?.name ?? null,
      rewardPointsCost: selectedReward?.pointsCost ?? 0,
      rewardDiscountAmount: totalRewardValue,
      rewardRedemptionUsed: Boolean(selectedReward),
      notes: notes.trim() || null,
      lines,
      createdAt: now
    };

    const saleRecord: DesktopSaleRecord = {
      id: saleId,
      payload,
      syncStatus: 'pending',
      receiptNumber,
      createdAt: now,
      updatedAt: now
    };

    await desktopDb.saveSale(saleRecord);
    await desktopDb.enqueueOutboxItem({
      id: saleId,
      entity: 'sale',
      action: 'create',
      payload: payload as unknown as Record<string, unknown>,
      idempotency_key: `idem-sale-${saleId}`,
      created_at: now
    });

    if (orderType === 'DELIVERY') {
      await desktopDeliveryService.createDeliveryOrder({
        branchId: appState.setup.branchId,
        sourceLocationId: appState.setup.locationId,
        customerId: selectedCustomer?.id ?? '',
        customerName: selectedCustomer?.label ?? null,
        saleId,
        orderType: 'DELIVERY',
        personnel: [
          { userId: selectedPersonnel?.id ?? '', role: 'DRIVER' as const, name: selectedPersonnel?.label ?? null },
          ...(selectedHelper?.id
            ? [{ userId: selectedHelper.id, role: 'HELPER' as const, name: selectedHelper.label ?? null }]
            : [])
        ].filter((entry) => entry.userId.trim().length > 0),
        notes: 'Created from desktop POS delivery checkout'
      });
    }

    if (workingState !== appState) {
      await desktopSettingsService.saveState(workingState);
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
    try {
      const sale = await persistSale();
      if (!sale) {
        return;
      }
      if (withPrint && appState.setup.printerMode !== 'NONE') {
        await desktopReceiptService.printSaleReceipt(sale, appState);
        showSuccess(
          sale.payload.saleType === 'DELIVERY'
            ? `Sale ${sale.receiptNumber} was saved, delivery was queued, and the receipt was prepared.`
            : `Sale ${sale.receiptNumber} was saved and the receipt was prepared.`
        );
      } else {
        showSuccess(
          sale.payload.saleType === 'DELIVERY'
            ? `Sale ${sale.receiptNumber} and its delivery order were saved locally and are waiting to sync.`
            : `Sale ${sale.receiptNumber} was saved locally and is waiting to sync.`
        );
      }
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to complete checkout.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={screenStackClass}>
      <ScreenHeader
        routeId="pos"
        variant="workspace"
        title="POS sales"
        description="Build the order, queue carts, and complete checkout."
        actions={
          <button
            className={queueOrdersButtonClass}
            type="button"
            onClick={() => {
              setHeldCartSearch('');
              setHeldCartModalOpen(true);
            }}
            disabled={heldCarts.length === 0}
            aria-label="Queue Orders"
            title="Queue Orders"
          >
            <span aria-hidden="true">{'\uD83D\uDCC2'}</span>
            <span>Queue Orders</span>
            {heldCarts.length > 0 ? (
              <span className="absolute right-[-5px] top-[-5px] grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[linear-gradient(145deg,var(--accent),var(--accent-strong))] px-1 text-[0.62rem] font-extrabold text-white shadow-[0_8px_16px_rgba(25,118,210,0.18)]">
                {heldCarts.length > 99 ? '99+' : heldCarts.length}
              </span>
            ) : null}
          </button>
        }
      />

      <section className={summaryStripClass}>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Shift</span>
          <strong className={summaryValueClass}>{activeShiftId ? 'Open' : 'Required'}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Queue Orders</span>
          <strong className={summaryValueClass}>{heldCarts.length}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Cart Lines</span>
          <strong className={summaryValueClass}>{cart.length}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Order Type</span>
          <strong className={summaryValueClass}>{orderType}</strong>
        </div>
        <div className={summaryTileClass}>
          <span className={summaryLabelClass}>Total Due</span>
          <strong className={summaryValueClass}>{fmtMoney(total)}</strong>
        </div>
      </section>

      <section className={`${shellCardClass} pos-workspace-shell`}>
        <div className="pos-workspace-grid">
          <section className="desktop-workspace-section pos-composer-panel">
            <div className="pos-section-heading">
              <div>
                <div className="eyebrow">Checkout setup</div>
                <h3>Prepare the sale</h3>
              </div>
              <p>Set the route, assign the customer and crew, then add only the items you want to bill now.</p>
            </div>

            {!activeShiftId ? (
              <div className="flex flex-col gap-3 rounded-[22px] border border-[rgba(185,62,95,0.2)] bg-[var(--danger-soft)] p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <strong className="block text-[1rem] font-extrabold text-[var(--text-strong)]">Shift needed before POS sale.</strong>
                  <div className="mt-1 text-[0.92rem] text-[var(--muted-strong)]">Open a shift first, then continue with customer, personnel, items, and payment.</div>
                </div>
                <button className="primary-btn mini-btn" type="button" onClick={onGoToShift} disabled={!onGoToShift}>
                  Go To Shift
                </button>
              </div>
            ) : null}

            <div
              ref={orderTypeTarget.ref}
              className={`pos-order-toggle ${orderTypeTarget.active ? 'tutorial-target-active' : ''}`}
            >
              {(['PICKUP', 'DELIVERY'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`rounded-[16px] border px-4 py-3 text-sm font-bold transition ${
                    orderType === mode
                      ? 'border-[rgba(25,118,210,0.4)] bg-[linear-gradient(180deg,rgba(37,99,235,0.14),rgba(37,99,235,0.06))] text-[var(--text-strong)] shadow-[0_10px_24px_rgba(37,99,235,0.12)]'
                      : 'border-[var(--border-soft)] bg-white text-[var(--muted-strong)] hover:border-[rgba(25,118,210,0.24)]'
                  }`}
                  onClick={() => setOrderType(mode)}
                >
                  {mode === 'PICKUP' ? 'Pickup' : 'Delivery'}
                </button>
              ))}
            </div>

            <div className="pos-selector-stack">
              <button
                ref={customerTarget.ref}
                type="button"
                className={`${selectorTileClass} ${customerTarget.active ? 'tutorial-target-active' : ''}`}
                onClick={() => {
                  setCustomerSearch('');
                  setCustomerModalOpen(true);
                }}
              >
                <span className={selectorLabelClass}>Customer</span>
                <strong className={selectorValueClass}>{selectedCustomer?.label ?? 'Select customer'}</strong>
                {selectedCustomer ? (
                  <span className={selectorMetaClass}>
                    Points: {selectedCustomer.pointsBalance ?? 0} | Balance: {fmtMoney(selectedCustomer.balance ?? 0)}
                  </span>
                ) : null}
              </button>

              <div className="pos-selector-grid">
                <button
                  type="button"
                  className={selectorTileClass}
                  onClick={() => {
                    setPersonnelSearch('');
                    setPersonnelModalOpen(true);
                  }}
                >
                  <span className={selectorLabelClass}>Personnel (Required)</span>
                  <strong className={selectorValueClass}>{selectedPersonnel?.label ?? 'Select personnel'}</strong>
                </button>

                <button
                  type="button"
                  className={selectorTileClass}
                  onClick={() => {
                    setHelperSearch('');
                    setHelperModalOpen(true);
                  }}
                >
                  <span className={selectorLabelClass}>Helper (Optional)</span>
                  <strong className={selectorValueClass}>{selectedHelper?.label ?? 'Select helper'}</strong>
                </button>
              </div>

              <button
                ref={itemSelectorTarget.ref}
                type="button"
                className={`${selectorTileClass} ${itemSelectorTarget.active ? 'tutorial-target-active' : ''}`}
                onClick={() => {
                  setItemSearch('');
                  setItemCategoryFilter('ALL');
                  setItemModalOpen(true);
                }}
              >
                <span className={selectorLabelClass}>Items</span>
                <strong className={selectorValueClass}>Tap to add item ({cart.length} in cart)</strong>
                <span className={selectorMetaClass}>LPG items will need a Refill or Non-Refill choice after you add them.</span>
              </button>
            </div>
          </section>

          <aside className="desktop-workspace-section pos-quick-panel">
            <div className="pos-section-heading pos-section-heading--compact">
              <div>
                <div className="eyebrow">Current sale</div>
                <h3>Checkout snapshot</h3>
              </div>
              <p>Keep the important context visible while you build the cart.</p>
            </div>

            <div className="pos-quick-grid">
              <div className="pos-quick-card">
                <span className={summaryLabelClass}>Status</span>
                <strong>{checkoutStatusLabel}</strong>
              </div>
              <div className="pos-quick-card">
                <span className={summaryLabelClass}>LPG Mix</span>
                <strong>Refill {lpgFlowSummary.refill} | Non-Refill {lpgFlowSummary.nonRefill}</strong>
              </div>
              <div className="pos-quick-card">
                <span className={summaryLabelClass}>Customer</span>
                <strong>{selectedCustomer?.label ?? '-'}</strong>
              </div>
              {selectedCustomer?.address?.trim() ? (
                <div className="pos-quick-card">
                  <span className={summaryLabelClass}>Address</span>
                  <strong>{selectedCustomer.address.trim()}</strong>
                </div>
              ) : null}
              <div className="pos-quick-card">
                <span className={summaryLabelClass}>Personnel</span>
                <strong>{selectedPersonnel?.label ?? '-'}</strong>
              </div>
              <div className="pos-quick-card">
                <span className={summaryLabelClass}>Helper</span>
                <strong>{selectedHelper?.label ?? '-'}</strong>
              </div>
            </div>

            {cartWarnings.length > 0 ? <div className="message-banner stock-warning-banner !mt-0">{cartWarnings[0]}</div> : null}
            {orderType === 'DELIVERY' ? (
              <div className="delivery-note-card !mt-0">
                <strong>Delivery reminder</strong>
                <span>Keep the assigned personnel and helper on this order before completing payment.</span>
              </div>
            ) : null}
          </aside>

          <section className="desktop-workspace-section pos-cart-panel">
            <div className="panel-head compact pos-cart-head">
              <div>
                <div className="eyebrow">Cart</div>
                <h3>Sale lines</h3>
              </div>
              <div className="desktop-settings-actions">
                <button className="secondary-btn mini-btn" type="button" onClick={promptHoldCurrentCart} disabled={!cart.length || saving}>
                  Add to Queue
                </button>
              </div>
            </div>

            {!cart.length ? (
              <div className="empty-state">No items added yet.</div>
            ) : (
              <div className="cart-list pos-cart-list">
                {cart.map((line) => (
                  <div key={line.lineId} className="cart-row cart-row-stack pos-cart-card">
                    <div className="pos-cart-main">
                      <strong>{line.name}</strong>
                      <span className="pos-cart-code">{line.sku || line.id}</span>
                      {line.isLpg ? (
                        <span className="pos-cart-code">Size: {formatCylinderSizeLabel(line)}</span>
                      ) : null}
                      {line.isLpg ? (
                        <div className="flow-chip-row">
                          {([
                            { value: 'REFILL_EXCHANGE', label: 'Refill' },
                            { value: 'NON_REFILL', label: 'Non-Refill' }
                          ] as const).map((flow) => (
                            <button
                              key={`${line.lineId}-${flow.value}`}
                              type="button"
                              className={`flow-chip ${line.cylinderFlow === flow.value ? 'active' : ''}`}
                              onClick={() => setLineCylinderFlow(line.lineId, flow.value)}
                            >
                              {flow.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {line.isLpg && !line.cylinderFlow ? (
                        <span className="field-warning">Select Refill or Non-Refill before payment.</span>
                      ) : null}
                      {line.quantity > resolveAvailableForLine(line) + 0.0001 ? (
                        <span className="field-warning">{line.name} is above available stock.</span>
                      ) : null}
                      <span className="pos-cart-price">{fmtMoney(line.unitPrice)} each</span>
                      <span className="pos-cart-stock">Available {resolveAvailableForLine(line).toFixed(2)}</span>
                    </div>
                    <div className="pos-cart-side">
                      <strong className="pos-cart-line-total">{fmtMoney(line.quantity * line.unitPrice)}</strong>
                      <div className="cart-controls pos-cart-qty-rail">
                        <button type="button" onClick={() => updateQuantity(line.lineId, Math.max(0, line.quantity - 1))}>
                          -
                        </button>
                        <input
                          className="pos-cart-qty-input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={String(line.quantity)}
                          onChange={(event) => {
                            const digits = toWholeNumberInput(event.target.value);
                            if (!digits) {
                              return;
                            }
                            updateQuantity(line.lineId, Number(digits));
                          }}
                        />
                        <button type="button" onClick={() => updateQuantity(line.lineId, line.quantity + 1)}>
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="desktop-workspace-section pos-checkout-panel">
            <div className="pos-section-heading pos-section-heading--compact">
              <div>
                <div className="eyebrow">Checkout</div>
                <h3>Amounts and next action</h3>
              </div>
              <p>Keep the final totals visible before you open payment details.</p>
            </div>

            <div className="pos-checkout-summary-grid">
              <div className={summaryTileClass}>
                <span className={summaryLabelClass}>Subtotal</span>
                <strong className={summaryValueClass}>{fmtMoney(subtotal)}</strong>
              </div>
              {discount > 0 ? (
                <div className={summaryTileClass}>
                  <span className={summaryLabelClass}>Discount</span>
                  <strong className={summaryValueClass}>{fmtMoney(discount)}</strong>
                </div>
              ) : null}
              {orderType === 'DELIVERY' ? (
                <div className={summaryTileClass}>
                  <span className={summaryLabelClass}>Delivery Fee</span>
                  <strong className={summaryValueClass}>{fmtMoney(deliveryFeeValue)}</strong>
                </div>
              ) : null}
              <div className={`${summaryTileClass} border-[rgba(25,118,210,0.25)] bg-[linear-gradient(180deg,rgba(37,99,235,0.1),rgba(37,99,235,0.04))]`}>
                <span className={summaryLabelClass}>Total Due</span>
                <strong className={summaryValueClass}>{fmtMoney(total)}</strong>
              </div>
            </div>

            <div className="pos-action-panel">
              <div className="pos-action-note">
                <span className={summaryLabelClass}>Before payment</span>
                <strong>{checkoutStatusLabel}</strong>
                <p>Proceed when the customer, personnel, cart lines, and LPG flow selections are complete.</p>
              </div>

              <button
                ref={proceedPaymentTarget.ref}
                className={`primary-btn checkout-btn ${proceedPaymentTarget.active ? 'tutorial-target-active' : ''}`}
                type="button"
                onClick={handleProceedToPayment}
                disabled={saving || !cart.length}
              >
                Proceed To Payment
              </button>
            </div>
          </aside>
        </div>
      </section>

      <div className="message-banner">{message}</div>

      <PickerModal
        open={customerModalOpen}
        title="Select Customer"
        search={customerSearch}
        placeholder="Search customer, code, address, points, or balance"
        emptyLabel="No matching customers found."
        options={filteredCustomers}
        selectedId={selectedCustomerId}
        emptyOptionLabel="Walk-in customer"
        emptyOptionHint="No saved customer selected yet."
        onSearch={setCustomerSearch}
        onClose={() => setCustomerModalOpen(false)}
        onSelect={handleCustomerSelect}
        actionLabel="New Customer"
        onAction={() => setCreateCustomerModalOpen(true)}
        actionDisabled={createCustomerSaving}
      />

      {createCustomerModalOpen ? (
        <div className={posModalBackdropClass} onClick={closeCreateCustomerModal}>
          <div className="desktop-modal-card desktop-modal-card--action" onClick={(event) => event.stopPropagation()}>
            <div className="desktop-modal-header flex shrink-0 flex-col gap-3">
              <div className="panel-head !mb-0">
                <div>
                  <div className="eyebrow">Offline customer</div>
                  <h3 className="m-0 text-[1.08rem] font-extrabold text-[var(--text-strong)]">New customer</h3>
                  <p className="mt-2 text-[0.94rem] leading-6 text-[var(--muted)]">
                    Save a customer locally now. We&apos;ll sync it when desktop is connected again.
                  </p>
                </div>
              </div>
            </div>

            <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-4">
              <label className="grid gap-2">
                <span className={summaryLabelClass}>Name</span>
                <input
                  className="app-input"
                  value={createCustomerName}
                  onChange={(event) => setCreateCustomerName(event.target.value)}
                  placeholder="Customer name"
                />
              </label>
              <label className="grid gap-2">
                <span className={summaryLabelClass}>Address</span>
                <input
                  className="app-input"
                  value={createCustomerAddress}
                  onChange={(event) => setCreateCustomerAddress(event.target.value)}
                  placeholder="Customer address"
                />
              </label>
              <label className="grid gap-2">
                <span className={summaryLabelClass}>Code</span>
                <input
                  className="app-input"
                  value={createCustomerCode}
                  onChange={(event) => setCreateCustomerCode(event.target.value.toUpperCase())}
                  placeholder="Optional code"
                />
              </label>
              <label className="grid gap-2">
                <span className={summaryLabelClass}>Contact Number</span>
                <input
                  className="app-input"
                  value={createCustomerContactNumber}
                  onChange={(event) => setCreateCustomerContactNumber(event.target.value)}
                  placeholder="Optional contact number"
                />
              </label>
              <label className="grid gap-2">
                <span className={summaryLabelClass}>Gas</span>
                <input
                  className="app-input"
                  value={createCustomerGas}
                  onChange={(event) => setCreateCustomerGas(event.target.value)}
                  placeholder="Optional gas preference"
                />
              </label>
              <label className="grid gap-2">
                <span className={summaryLabelClass}>Province</span>
                <input
                  className="app-input"
                  value={createCustomerProvince}
                  onChange={(event) => setCreateCustomerProvince(event.target.value)}
                  placeholder="Optional province"
                />
              </label>
              <label className="grid gap-2">
                <span className={summaryLabelClass}>City</span>
                <input
                  className="app-input"
                  value={createCustomerCity}
                  onChange={(event) => setCreateCustomerCity(event.target.value)}
                  placeholder="Optional city"
                />
              </label>
            </div>

            <div className="desktop-modal-footer">
              <button className="secondary-btn" type="button" onClick={closeCreateCustomerModal} disabled={createCustomerSaving}>
                Cancel
              </button>
              <button className="primary-btn" type="button" onClick={() => void handleCreateOfflineCustomer()} disabled={createCustomerSaving}>
                {createCustomerSaving ? 'Saving...' : 'Save Customer'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PickerModal
        open={personnelModalOpen}
        title="Select Personnel"
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
        <div className={posModalBackdropClass} onClick={() => setItemModalOpen(false)}>
          <div className={posModalCardClass} onClick={(event) => event.stopPropagation()}>
            <div className={posModalToolbarClass}>
              <div className="panel-head pos-sheet-head">
                <div>
                  <div className="eyebrow">Selection</div>
                  <h3>Select Item</h3>
                </div>
                <button className="secondary-btn mini-btn" type="button" onClick={() => setItemModalOpen(false)}>
                  Close
                </button>
              </div>

              <SearchField
                className="pos-sheet-search"
                value={itemSearch}
                onChange={setItemSearch}
                placeholder="Search item code or name"
                autoFocus
              />

              <div className="filter-chip-row">
                {itemCategoryOptions.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={`filter-chip ${itemCategoryFilter === category ? 'active' : ''}`}
                    onClick={() => setItemCategoryFilter(category)}
                  >
                    {category === 'ALL' ? 'All Items' : category}
                  </button>
                ))}
              </div>
            </div>

            <div className="desktop-modal-body picker-list">
              {filteredProducts.length === 0 ? (
                <div className="empty-state">No matching items.</div>
              ) : (
                filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    className="catalog-row picker-row pos-item-card"
                    onClick={() => {
                      addToCart(product);
                      setItemModalOpen(false);
                    }}
                    disabled={resolveStockTone(product) === 'out'}
                  >
                    <div className="pos-item-card-main">
                      <strong>{product.name}</strong>
                      <span className="pos-item-card-meta">
                        {product.sku} | {product.category} | {product.unit}
                        {product.isLpg ? ` | Size ${formatCylinderSizeLabel(product)}` : ''}
                      </span>
                      <span className="pos-item-card-stock">
                        {product.isLpg
                          ? `Full ${product.qtyFull.toFixed(2)} | Empty ${product.qtyEmpty.toFixed(2)}`
                          : `On hand ${product.qtyOnHand.toFixed(2)}`}
                      </span>
                    </div>
                    <div className="catalog-row-right">
                      <strong>{fmtMoney(product.unitPrice)}</strong>
                      <div className={`stock-pill ${resolveStockTone(product)}`}>{resolveStockLabel(product)}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {queuePreviewOpen ? (
        <div className={posModalBackdropClass} onClick={() => setQueuePreviewOpen(false)}>
          <div className="desktop-modal-card desktop-modal-card--action" onClick={(event) => event.stopPropagation()}>
            <div className={posModalToolbarClass}>
              <div className="panel-head pos-sheet-head">
                <div>
                  <div className="eyebrow">Print Preview</div>
                  <h3>Add to Queue</h3>
                  <p className="startup-helper-copy pos-payment-copy">
                    Review the queued order preview before saving it for later recall.
                  </p>
                </div>
                <button className="secondary-btn mini-btn" type="button" onClick={() => setQueuePreviewOpen(false)}>
                  Back
                </button>
              </div>
            </div>

            <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-4">
              <section className={shellCardClass}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow">Print Preview</div>
                    <h4>{selectedCustomer?.label?.trim() || 'Walk-in customer'}</h4>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex min-h-[30px] items-center justify-center rounded-full bg-[rgba(236,242,248,0.96)] px-3 text-[0.8rem] font-bold text-[var(--muted-strong)]">{orderType}</span>
                    <span className="inline-flex min-h-[30px] items-center justify-center rounded-full bg-[rgba(236,242,248,0.96)] px-3 text-[0.8rem] font-bold text-[var(--muted-strong)]">{cart.length} item(s)</span>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className={summaryTileClass}>
                    <span className={summaryLabelClass}>Address</span>
                    <strong className={summaryValueClass}>{selectedCustomer?.address?.trim() ?? ''}</strong>
                  </div>
                  <div className={summaryTileClass}>
                    <span className={summaryLabelClass}>Items</span>
                    <strong className={summaryValueClass}>{cart.length}</strong>
                  </div>
                  <div className={summaryTileClass}>
                    <span className={summaryLabelClass}>Total</span>
                    <strong className={summaryValueClass}>{fmtMoney(total)}</strong>
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
                          <div className="desktop-line-item-row__title">{index + 1}. {line.name}</div>
                          {line.subtitle ? (
                            <div className="desktop-line-item-row__meta">{line.subtitle}</div>
                          ) : null}
                        </div>
                        <div className="desktop-line-item-row__stats">
                          <div className="desktop-line-item-row__stat">
                            <span className="desktop-line-item-row__stat-label">Qty</span>
                            <strong>{line.qty}</strong>
                          </div>
                          <div className="desktop-line-item-row__stat">
                            <span className="desktop-line-item-row__stat-label">Amount</span>
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
                    <strong className={summaryValueClass}>{fmtMoney(subtotal)}</strong>
                  </div>
                  <div className={summaryTileClass}>
                    <span className={summaryLabelClass}>Total</span>
                    <strong className={summaryValueClass}>{fmtMoney(total)}</strong>
                  </div>
                </div>
              </section>
            </div>

            <div className="desktop-modal-footer">
              <button className="secondary-btn" type="button" onClick={() => setQueuePreviewOpen(false)}>
                Back
              </button>
              <button
                className="secondary-btn"
                type="button"
                onClick={() =>
                  void printQueueOrderReceipt(
                    buildQueueOrderReceiptPayload({
                      queueId: `preview-${Date.now()}`,
                      queueLabel: holdLabel,
                      createdAt: new Date().toISOString(),
                      customerName: selectedCustomer?.label ?? null,
                      customerAddress: selectedCustomer?.address?.trim() ?? null,
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
                          ? [line.cylinderFlow === 'REFILL_EXCHANGE' ? 'Refill' : line.cylinderFlow === 'NON_REFILL' ? 'Non-Refill' : null, formatCylinderSizeLabel(line)]
                              .filter(Boolean)
                              .join(' | ')
                          : formatCylinderSizeLabel(line),
                        quantity: line.quantity,
                        unitPrice: line.unitPrice
                      }))
                    })
                  )
                }
              >
                Print
              </button>
              <button className="primary-btn" type="button" onClick={() => void holdCurrentCart()}>
                Add to Queue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {heldCartModalOpen ? (
        <div className={posModalBackdropClass} onClick={() => setHeldCartModalOpen(false)}>
          <div className={posModalCardClass} onClick={(event) => event.stopPropagation()}>
            <div className={posModalToolbarClass}>
              <div className="panel-head pos-sheet-head">
                <div>
                  <div className="eyebrow">Selection</div>
                  <h3>Queue Orders</h3>
                </div>
                <button className="secondary-btn mini-btn" type="button" onClick={() => setHeldCartModalOpen(false)}>
                  Close
                </button>
              </div>

              <SearchField
                className="pos-sheet-search"
                value={heldCartSearch}
                onChange={setHeldCartSearch}
                placeholder="Search queued order, customer, or item"
                autoFocus
              />
            </div>

            <div className="desktop-modal-body picker-list">
              {filteredHeldCarts.length === 0 ? (
                <div className="empty-state">No queued orders yet.</div>
              ) : (
                filteredHeldCarts.map((held) => (
                  <div
                    key={held.id}
                    className="catalog-row picker-row"
                  >
                    <div>
                      <strong>{held.label}</strong>
                      <span>{held.customerName || 'Walk-in customer'} | {held.lines.length} lines</span>
                      <span>{new Date(held.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className="catalog-row-right">
                      <strong>
                        {fmtMoney(
                          held.lines.reduce((sum, line) => sum + line.lineTotal, 0) -
                            held.discountAmount +
                            (held.deliveryFee ?? 0)
                        )}
                      </strong>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="secondary-btn mini-btn"
                          onClick={() => {
                            const customerOption = held.customerId ? customers.find((customer) => customer.id === held.customerId) ?? null : null;
                            void printQueueOrderReceipt(
                              buildQueueOrderReceiptPayload({
                                queueId: held.id,
                                queueLabel: held.label,
                                createdAt: held.createdAt,
                                customerName: held.customerName,
                                customerAddress: customerOption?.address?.trim() ?? null,
                                saleType: held.saleType,
                                paymentMode: held.paymentMode ?? 'FULL',
                                paymentMethod: held.paymentMethod,
                                paidAmount: Number((held.paidAmount ?? 0).toFixed(2)),
                                discountAmount: Number((held.discountAmount ?? 0).toFixed(2)),
                                deliveryFee: Number((held.deliveryFee ?? 0).toFixed(2)),
                                notes: held.notes ?? null,
                                personnelName: held.personnelName ?? null,
                                helperName: held.helperName ?? null,
                                lines: held.lines.map((line) => ({
                                  productId: line.productId,
                                  name: line.productName,
                                  subtitle: null,
                                  quantity: line.quantity,
                                  unitPrice: line.unitPrice
                                }))
                              })
                            );
                          }}
                        >
                          Print
                        </button>
                        <button
                          type="button"
                          className="primary-btn mini-btn"
                          onClick={() => {
                            void recallHeldCart(held);
                            setHeldCartModalOpen(false);
                          }}
                        >
                          Recall
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {paymentModalOpen ? (
        <div className={posModalBackdropClass} onClick={() => setPaymentModalOpen(false)}>
          <div className="desktop-modal-card desktop-modal-card--action" onClick={(event) => event.stopPropagation()}>
            <div className={posModalToolbarClass}>
              <div className="panel-head pos-sheet-head">
                <div>
                  <div className="eyebrow">Checkout</div>
                  <h3>Payment Details</h3>
                </div>
                <button className="secondary-btn mini-btn" type="button" onClick={() => setPaymentModalOpen(false)}>
                  Close
                </button>
              </div>
            </div>

            <div className="desktop-modal-body flex min-h-0 flex-1 flex-col gap-5">
              <p className="startup-helper-copy pos-payment-copy">{paymentHint}</p>

              <div className={summaryStripClass}>
                <div className={summaryTileClass}>
                  <span className={summaryLabelClass}>Order Type</span>
                  <strong className={summaryValueClass}>{orderType}</strong>
                </div>
                <div className={summaryTileClass}>
                  <span className={summaryLabelClass}>LPG Mix</span>
                  <strong className={summaryValueClass}>Refill {lpgFlowSummary.refill} | Non-Refill {lpgFlowSummary.nonRefill}</strong>
                </div>
                <div className={summaryTileClass}>
                  <span className={summaryLabelClass}>Customer</span>
                  <strong className={summaryValueClass}>{selectedCustomer?.label ?? '-'}</strong>
                </div>
                <div className={summaryTileClass}>
                  <span className={summaryLabelClass}>Address</span>
                  <strong className={summaryValueClass}>{selectedCustomer?.address?.trim() ?? ''}</strong>
                </div>
                <div className={summaryTileClass}>
                  <span className={summaryLabelClass}>Current Balance</span>
                  <strong className={summaryValueClass}>{fmtMoney(selectedCustomer?.balance ?? 0)}</strong>
                </div>
                <div className={summaryTileClass}>
                  <span className={summaryLabelClass}>Personnel</span>
                  <strong className={summaryValueClass}>{selectedPersonnel?.label ?? '-'}</strong>
                </div>
                <div className={summaryTileClass}>
                  <span className={summaryLabelClass}>Helper</span>
                  <strong className={summaryValueClass}>{selectedHelper?.label ?? '-'}</strong>
                </div>
              </div>

            {orderType === 'DELIVERY' ? (
              <div className="delivery-note-card">
                <strong>Delivery reminder</strong>
                <span>Keep the assigned personnel and helper on this order before completing payment.</span>
              </div>
            ) : null}

            {currentPointsBalance > 0 ? (
              <div className="payment-section-card pos-payment-section">
                <div>
                  <strong>Reward Redemption</strong>
                  <p>
                    Available points: {currentPointsBalance}. Choose one reward to reserve and apply during checkout.
                  </p>
                </div>
                {rewardsLoading ? (
                  <div className="empty-state">Loading rewards...</div>
                ) : rewardEligibleOptions.length === 0 ? (
                  <div className="empty-state">No active checkout rewards are available for this customer and branch.</div>
                ) : (
                  <div className="filter-chip-row reward-chip-row">
                    {rewardEligibleOptions.map((reward) => {
                      const active = reward.id === selectedRewardId;
                      return (
                        <button
                          key={reward.id}
                          type="button"
                          className={`filter-chip reward-chip ${active ? 'active' : ''}`}
                          onClick={() => handleSelectReward(reward)}
                          disabled={saving}
                        >
                          <strong>{reward.name}</strong>
                          <span>
                            {reward.pointsCost} pts
                            {reward.rewardType === 'FREE_PRODUCT' || reward.rewardType === 'FREE_REFILL'
                              ? ` | Save ${fmtMoney(resolveRewardCartDiscount(reward, cart))}`
                              : reward.discountValue !== null
                                ? ` | ${reward.rewardType === 'DISCOUNT_PERCENT' ? `${reward.discountValue}%` : fmtMoney(reward.discountValue)}`
                                : ''}
                          </span>
                        </button>
                      );
                    })}
                    {selectedReward ? (
                      <button
                        type="button"
                        className="filter-chip reward-chip"
                        onClick={() => setSelectedRewardId('')}
                        disabled={saving}
                      >
                        <strong>Clear Reward</strong>
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            <div className="payment-section-card pos-payment-section pos-payment-form-card">
              <div className="checkout-grid pos-payment-grid">
              <label className="payment-field-stack">
                <span>Payment Type</span>
                <div className="flow-chip-row payment-mode-row">
                  {(['FULL', 'PARTIAL'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`flow-chip ${paymentMode === mode ? 'active' : ''}`}
                      onClick={() => {
                        setPaymentMode(mode);
                        setPaidAmount('0');
                      }}
                    >
                      {mode === 'FULL' ? 'Full' : 'Partial'}
                    </button>
                  ))}
                </div>
              </label>

              <label className="payment-field-stack">
                <span>Payment method</span>
                <select
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value as DesktopPaymentMethod)}
                >
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="E_WALLET">E-Wallet</option>
                </select>
              </label>

              <label className="payment-field-stack">
                <span>Discount Amount</span>
                <input value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} placeholder="0.00" />
              </label>

              {orderType === 'DELIVERY' ? (
                <label className="payment-field-stack">
                  <span>Delivery Fee</span>
                  <input value={deliveryFee} onChange={(event) => setDeliveryFee(event.target.value)} placeholder="0.00" />
                </label>
              ) : null}

              <label className="payment-field-stack">
                <span>{paymentMode === 'FULL' ? 'Amount tendered' : 'Amount collected'}</span>
                <div className="flex items-center gap-2">
                  <input
                    className="flex-1"
                    value={paidAmount}
                    onChange={(event) => setPaidAmount(event.target.value)}
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
            </div>

              <label className="full-width-field payment-field-stack pos-payment-notes">
                <span>Notes (Optional)</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Delivery note, cashier note, or reminder"
                />
              </label>
            </div>

            <div className="payment-section-card pos-payment-section">
              <div>
                <strong>Sale Summary</strong>
                <p>Review the final amounts before completing this sale.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className={posMetricCardClass}>
                  <span className={posMetricLabelClass}>Paid</span>
                  <strong className={posMetricValueClass}>{fmtMoney(parsedPaidAmount)}</strong>
                </div>
                <div className={posMetricCardClass}>
                  <span className={posMetricLabelClass}>Change</span>
                  <strong className={posMetricValueClass}>{fmtMoney(changeAmount)}</strong>
                </div>
                <div className={posMetricCardClass}>
                  <span className={posMetricLabelClass}>Credit</span>
                  <strong className={posMetricValueClass}>{fmtMoney(creditBalance)}</strong>
                </div>
                <div className={posMetricCardClass}>
                  <span className={posMetricLabelClass}>Total</span>
                  <strong className={posMetricValueClass}>{fmtMoney(total)}</strong>
                </div>
              </div>
              <div className="payment-summary-list">
                <span>Items: {cart.length}</span>
                <span>Subtotal: {fmtMoney(subtotal)}</span>
                {discount > 0 ? <span>Discount: {fmtMoney(discount)}</span> : null}
                {orderType === 'DELIVERY' ? <span>Delivery Fee: {fmtMoney(deliveryFeeValue)}</span> : null}
                {selectedReward ? <span>Reward: {selectedReward.name}</span> : null}
                <span>Applied Payment: {fmtMoney(appliedPaidAmount)}</span>
                <span>Credit Due: {fmtMoney(creditBalance)}</span>
                <span>Mode: {paymentMode}</span>
              </div>
            </div>

            {cartWarnings.length > 0 ? <div className="message-banner stock-warning-banner">{cartWarnings[0]}</div> : null}

            <div className="desktop-modal-footer checkout-action-row pos-payment-actions">
              <button
                className="secondary-btn checkout-btn checkout-btn-print-inline"
                type="button"
                onClick={() => void completeCheckout(true)}
                disabled={saving || !cart.length || cartWarnings.length > 0 || !paymentReady}
              >
                {saving ? 'Saving...' : 'Complete & Print Receipt'}
              </button>
              <button
                className="secondary-btn checkout-btn checkout-btn-support"
                type="button"
                onClick={() => setPaymentModalOpen(false)}
                disabled={saving}
              >
                Back
              </button>
              <button
                className="primary-btn checkout-btn"
                type="button"
                onClick={() => void completeCheckout(false)}
                disabled={saving || !cart.length || cartWarnings.length > 0 || !paymentReady}
              >
                {saving ? 'Saving...' : 'Complete Sale'}
              </button>
            </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


