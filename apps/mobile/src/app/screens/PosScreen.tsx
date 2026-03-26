import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import { toastError, toastInfo, toastSuccess } from '../goey-toast';
import type { AppTheme } from '../theme';
import { useTutorialTarget } from '../tutorial/tutorial-provider';
import { SwipeToDeleteRow } from '../components/SwipeToDeleteRow';
import { LocalSessionService } from '../../features/auth/local-session.service';
import { HttpAuthTransport } from '../../features/auth/http-auth.transport';
import { normalizeApiBaseUrl } from '../api-base-url';
import {
  loadPendingInventoryDeltaByProductForLocation,
  mergeInventoryWithDeltas,
  type ProjectedInventoryTotals
} from '../local-stock-projection';
import {
  type MasterDataOption,
  loadBranchOptions,
  loadCustomerOptions,
  loadLocationOptions,
  loadPersonnelOptions
} from '../master-data-local';

type Product = {
  id: string;
  name: string;
  unitPrice: number;
  subtitle?: string;
  category?: string | null;
  qtyFull?: number;
  qtyEmpty?: number;
  qtyOnHand?: number | null;
  isLpg?: boolean;
};

type CylinderFlowSelection = 'REFILL_EXCHANGE' | 'NON_REFILL';

type CustomerProfile = {
  id: string;
  tier: string | null;
  contractPrice: number | null;
  pointsBalance: number;
};

type PosRewardType =
  | 'DISCOUNT_FIXED'
  | 'DISCOUNT_PERCENT'
  | 'FREE_DELIVERY'
  | 'FREE_PRODUCT'
  | 'FREE_REFILL';
type PosRewardRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  reward_type: PosRewardType;
  points_cost: number;
  product_id: string | null;
  free_qty: number | null;
  discount_value: number | null;
  min_spend: number | null;
  status: 'ACTIVE' | 'DRAFT' | 'INACTIVE' | 'ARCHIVED';
};

type PosRewardRedemptionRecord = {
  id: string;
  reward_id: string;
  status: 'RESERVED' | 'APPLIED' | 'CANCELLED' | 'VOIDED' | 'EXPIRED';
  points_spent: number;
};

type LendingEligibleProductRecord = {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  available_qty: number;
  requires_deposit: boolean;
  default_deposit_amount: number | null;
  lending_unit_type: string | null;
};

type PostSaleLendingState = {
  saleId: string;
  customerId: string;
  customerName: string | null;
  branchName: string;
  locationName: string;
  products: LendingEligibleProductRecord[];
};

type LocalPriceRule = {
  productId: string;
  flowMode: 'ANY' | CylinderFlowSelection;
  unitPrice: number;
  priority: number;
};

type LocalPriceList = {
  id: string;
  scope: 'GLOBAL' | 'BRANCH' | 'TIER' | 'CONTRACT';
  branchId: string | null;
  customerTier: string | null;
  customerId: string | null;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  rules: LocalPriceRule[];
};

type CartLine = Product & {
  lineId: string;
  quantity: number;
  cylinderFlow?: CylinderFlowSelection | null;
};
type ShiftStateRow = {
  id: string;
  payload: string;
  created_at: string;
};

type InventoryBalanceSnapshot = {
  productId: string;
  locationId: string | null;
  qtyOnHand: number;
  qtyFull: number;
  qtyEmpty: number;
};

const env = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env;
const POS_API_BASE_URL = normalizeApiBaseUrl(
  env?.EXPO_PUBLIC_API_BASE_URL ?? 'https://vmjamtech.com/api'
);

export type PosQueuedSaleReceiptPayload = {
  saleId: string;
  customerId?: string | null;
  branchId: string;
  branchName: string;
  locationId: string;
  locationName: string;
  cashierName: string | null;
  orderType: 'PICKUP' | 'DELIVERY';
  customerName: string | null;
  personnelName: string | null;
  helperName: string | null;
  lines: Array<{ name: string; subtitle?: string; quantity: number; unitPrice: number }>;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  creditBalance: number;
  notes?: string | null;
  paymentMode: 'FULL' | 'PARTIAL';
  paymentMethod: 'CASH' | 'CARD' | 'E_WALLET';
  rewardRedemptionUsed?: boolean;
  createdAt: string;
};

type PosQueuedSaleReceiptResult = {
  printed: boolean;
  receiptNumber?: string;
  message?: string;
};

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  cashierName?: string | null;
  preferredBranchId?: string;
  preferredLocationId?: string;
  defaultLpgFlowForNewItem?: 'NONE' | CylinderFlowSelection;
  inventoryProjectionVersion?: number;
  onDataChanged?: () => Promise<void> | void;
  onPrintQueuedSaleReceipt?: (payload: PosQueuedSaleReceiptPayload) => Promise<PosQueuedSaleReceiptResult>;
  onGoToShift?: () => void;
  syncBusy?: boolean;
};

function parseRecord<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatQty(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) {
    return '-';
  }
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
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

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function parseCustomerProfile(payload: Record<string, unknown>): CustomerProfile | null {
  const id = asString(payload.id);
  if (!id) {
    return null;
  }
  return {
    id,
    tier: asString(payload.tier),
    contractPrice: asNumber(payload.contractPrice ?? payload.contract_price),
    pointsBalance: Math.max(0, asNumber(payload.pointsBalance ?? payload.points_balance) ?? 0)
  };
}

function isSupportedPosRewardType(value: string | null | undefined): value is PosRewardType {
  return (
    value === 'DISCOUNT_FIXED' ||
    value === 'DISCOUNT_PERCENT' ||
    value === 'FREE_DELIVERY' ||
    value === 'FREE_PRODUCT' ||
    value === 'FREE_REFILL'
  );
}

function resolveRewardCartDiscount(reward: PosRewardRecord, cart: CartLine[]): number {
  if (reward.reward_type === 'FREE_PRODUCT') {
    const targetLine = cart.find(
      (line) => line.id === reward.product_id && !line.isLpg
    );
    if (!targetLine) {
      return 0;
    }
    const freeQty = Math.max(1, reward.free_qty ?? 1);
    return round2(Math.min(targetLine.quantity, freeQty) * targetLine.unitPrice);
  }

  if (reward.reward_type === 'FREE_REFILL') {
    const refillLines = cart.filter(
      (line) =>
        line.isLpg &&
        line.cylinderFlow === 'REFILL_EXCHANGE' &&
        (!reward.product_id || line.id === reward.product_id)
    );
    if (!refillLines.length) {
      return 0;
    }
    let remainingFreeQty = Math.max(1, reward.free_qty ?? 1);
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

function parsePriceLists(rows: Array<{ payload: string }>): LocalPriceList[] {
  const lists: LocalPriceList[] = [];
  for (const row of rows) {
    const payload = parseRecord<Record<string, unknown>>(row.payload, {});
    const id = asString(payload.id);
    const scope = asString(payload.scope)?.toUpperCase() as LocalPriceList['scope'] | undefined;
    const startsAt = asString(payload.startsAt ?? payload.starts_at);
    if (!id || !scope || !startsAt) {
      continue;
    }

    const rulesRaw = Array.isArray(payload.rules) ? payload.rules : [];
    const rules: LocalPriceRule[] = [];
    for (const ruleRow of rulesRaw) {
      if (!ruleRow || typeof ruleRow !== 'object') {
        continue;
      }
      const rule = ruleRow as Record<string, unknown>;
      const productId = asString(rule.productId ?? rule.product_id);
      const flowModeRaw = asString(rule.flowMode ?? rule.flow_mode)?.toUpperCase();
      const unitPrice = asNumber(rule.unitPrice ?? rule.unit_price);
      const priority = asNumber(rule.priority);
      if (!productId || unitPrice === null || priority === null) {
        continue;
      }
      const flowMode: LocalPriceRule['flowMode'] =
        flowModeRaw === 'REFILL_EXCHANGE' || flowModeRaw === 'NON_REFILL' ? flowModeRaw : 'ANY';
      rules.push({
        productId,
        flowMode,
        unitPrice: round2(unitPrice),
        priority
      });
    }

    lists.push({
      id,
      scope,
      branchId: asString(payload.branchId ?? payload.branch_id),
      customerTier: asString(payload.customerTier ?? payload.customer_tier)?.toUpperCase() ?? null,
      customerId: asString(payload.customerId ?? payload.customer_id),
      startsAt,
      endsAt: asString(payload.endsAt ?? payload.ends_at),
      isActive: payload.isActive === false || payload.is_active === false ? false : true,
      rules
    });
  }
  return lists;
}

function parseInventorySnapshot(payload: Record<string, unknown>): InventoryBalanceSnapshot | null {
  const productId = asString(payload.productId ?? payload.product_id);
  if (!productId) {
    return null;
  }
  const qtyOnHandRaw = asNumber(payload.qtyOnHand ?? payload.qty_on_hand);
  const qtyFull = asNumber(payload.qtyFull ?? payload.qty_full) ?? 0;
  const qtyEmpty = asNumber(payload.qtyEmpty ?? payload.qty_empty) ?? 0;
  const qtyOnHand = qtyOnHandRaw !== null ? qtyOnHandRaw : round2(qtyFull + qtyEmpty);
  return {
    productId,
    locationId: asString(payload.locationId ?? payload.location_id),
    qtyOnHand,
    qtyFull,
    qtyEmpty
  };
}

function resolveLocalPrice(input: {
  productId: string;
  branchId: string;
  customer: CustomerProfile | null;
  priceLists: LocalPriceList[];
  atIso: string;
  flowMode?: CylinderFlowSelection | null;
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
    const matches: Array<{ unitPrice: number; priority: number; flowRank: number }> = [];
    for (const list of lists) {
      for (const rule of list.rules) {
        if (rule.productId !== input.productId) {
          continue;
        }
        let flowRank: number | null = null;
        if (!input.flowMode) {
          flowRank = rule.flowMode === 'ANY' ? 0 : null;
        } else if (rule.flowMode === input.flowMode) {
          flowRank = 0;
        } else if (rule.flowMode === 'ANY') {
          flowRank = 1;
        }
        if (flowRank === null) {
          continue;
        }
        matches.push({ unitPrice: rule.unitPrice, priority: rule.priority, flowRank });
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
    activeLists.filter((list) => list.scope === 'CONTRACT' && input.customer?.id && list.customerId === input.customer.id)
  );
  if (contract !== null) {
    return contract;
  }

  if (input.customer?.contractPrice !== null && input.customer?.contractPrice !== undefined) {
    // Guard against accidental zero defaults from imported/customer records.
    // Positive contract price overrides list-based pricing.
    if (input.customer.contractPrice > 0) {
      return round2(input.customer.contractPrice);
    }
  }

  const tier = pick(
    activeLists.filter(
      (list) =>
        list.scope === 'TIER' &&
        input.customer?.tier &&
        list.customerTier &&
        list.customerTier.toUpperCase() === input.customer.tier.toUpperCase()
    )
  );
  if (tier !== null) {
    return tier;
  }

  const branch = pick(activeLists.filter((list) => list.scope === 'BRANCH' && list.branchId === input.branchId));
  if (branch !== null) {
    return branch;
  }

  const global = pick(activeLists.filter((list) => list.scope === 'GLOBAL'));
  if (global !== null) {
    return global;
  }

  return null;
}

const FALLBACK_PRODUCTS: Product[] = [
  {
    id: 'LPG-11-REFILL',
    name: 'LPG Refill 11kg',
    unitPrice: 950,
    subtitle: 'LPG-11-REFILL',
    category: 'LPG',
    qtyFull: 0,
    qtyEmpty: 0,
    qtyOnHand: 0,
    isLpg: true
  },
  {
    id: 'LPG-22-REFILL',
    name: 'LPG Refill 22kg',
    unitPrice: 1800,
    subtitle: 'LPG-22-REFILL',
    category: 'LPG',
    qtyFull: 0,
    qtyEmpty: 0,
    qtyOnHand: 0,
    isLpg: true
  }
];

const FALLBACK_BRANCHES: MasterDataOption[] = [{ id: 'branch-main', label: 'Main Branch', subtitle: 'MAIN' }];
const FALLBACK_LOCATIONS: MasterDataOption[] = [{ id: 'loc-main', label: 'Main Store', subtitle: 'LOC-MAIN' }];

type PickerModalProps = {
  visible: boolean;
  title: string;
  options: MasterDataOption[];
  value: string;
  optional?: boolean;
  placeholder?: string;
  search: string;
  onSearch: (value: string) => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  theme: AppTheme;
};

function PickerModal(props: PickerModalProps): JSX.Element {
  const filtered = useMemo(() => {
    const q = props.search.trim().toLowerCase();
    if (!q) {
      return props.options.slice(0, 120);
    }
    return props.options.filter((option) => {
      const blob = `${option.label} ${option.subtitle ?? ''} ${option.id}`.toLowerCase();
      return blob.includes(q);
    });
  }, [props.options, props.search]);

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={props.onClose} />
        <View style={[styles.modalCard, { backgroundColor: props.theme.card, borderColor: props.theme.cardBorder }]}>
          <Text style={[styles.modalTitle, { color: props.theme.heading }]}>{props.title}</Text>
          <TextInput
            value={props.search}
            onChangeText={props.onSearch}
            placeholder={props.placeholder ?? 'Search...'}
            placeholderTextColor={props.theme.inputPlaceholder}
            style={[styles.modalSearch, { backgroundColor: props.theme.inputBg, color: props.theme.inputText }]}
          />

          <ScrollView style={styles.modalList} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
            {props.optional ? (
              <Pressable
                onPress={() => {
                  props.onSelect('');
                  props.onClose();
                }}
                style={[styles.modalRow, { borderColor: props.theme.cardBorder, backgroundColor: props.theme.pillBg }]}
              >
                <Text style={[styles.modalRowTitle, { color: props.theme.pillText }]}>None</Text>
              </Pressable>
            ) : null}

            {filtered.length === 0 ? (
              <Text style={[styles.modalEmpty, { color: props.theme.subtext }]}>No records found.</Text>
            ) : (
              filtered.map((option) => {
                const active = option.id === props.value;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => {
                      props.onSelect(option.id);
                      props.onClose();
                    }}
                    style={[
                      styles.modalRow,
                      {
                        borderColor: props.theme.cardBorder,
                        backgroundColor: active ? props.theme.pillBg : 'transparent'
                      }
                    ]}
                  >
                    <Text style={[styles.modalRowTitle, { color: props.theme.heading }]}>{option.label}</Text>
                    {option.subtitle ? (
                      <Text style={[styles.modalRowSub, { color: props.theme.subtext }]}>{option.subtitle}</Text>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Pressable onPress={props.onClose} style={[styles.modalClose, { backgroundColor: props.theme.pillBg }]}>
            <Text style={[styles.modalCloseText, { color: props.theme.pillText }]}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function PosScreen({
  db,
  theme,
  cashierName,
  preferredBranchId,
  preferredLocationId,
  defaultLpgFlowForNewItem = 'NONE',
  inventoryProjectionVersion = 0,
  onDataChanged,
  onPrintQueuedSaleReceipt,
  onGoToShift,
  syncBusy = false
}: Props): JSX.Element {
  const { width, height } = useWindowDimensions();
  const shortEdge = Math.min(width, height);
  const longEdge = Math.max(width, height);
  const isCompactLayout = shortEdge <= 360 || longEdge <= 740;
  const tutorialOrderType = useTutorialTarget('pos-order-type');
  const tutorialCustomer = useTutorialTarget('pos-customer');
  const tutorialItemSelector = useTutorialTarget('pos-item-selector');
  const tutorialProceedPayment = useTutorialTarget('pos-proceed-payment');
  const [catalog, setCatalog] = useState<Product[]>(FALLBACK_PRODUCTS);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [branchId, setBranchId] = useState('branch-main');
  const [locationId, setLocationId] = useState('loc-main');
  const [orderType, setOrderType] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [customerId, setCustomerId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [helperId, setHelperId] = useState('');
  const [branches, setBranches] = useState<MasterDataOption[]>(FALLBACK_BRANCHES);
  const [locations, setLocations] = useState<MasterDataOption[]>(FALLBACK_LOCATIONS);
  const [customers, setCustomers] = useState<MasterDataOption[]>([]);
  const [personnels, setPersonnels] = useState<MasterDataOption[]>([]);
  const [priceLists, setPriceLists] = useState<LocalPriceList[]>([]);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(null);
  const [projectedInventoryByProduct, setProjectedInventoryByProduct] = useState<
    Map<string, ProjectedInventoryTotals>
  >(new Map());
  const [discount, setDiscount] = useState('0');
  const [deliveryFee, setDeliveryFee] = useState('0.00');
  const [paymentMode, setPaymentMode] = useState<'FULL' | 'PARTIAL'>('FULL');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'E_WALLET'>('CASH');
  const [paidAmount, setPaidAmount] = useState('0');
  const [showPaymentStep, setShowPaymentStep] = useState(false);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [availableRewards, setAvailableRewards] = useState<PosRewardRecord[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [selectedRewardId, setSelectedRewardId] = useState('');
  const [postSaleLending, setPostSaleLending] = useState<PostSaleLendingState | null>(null);
  const [lendingQtyByProduct, setLendingQtyByProduct] = useState<Record<string, string>>({});
  const [lendingDepositByProduct, setLendingDepositByProduct] = useState<Record<string, string>>({});
  const [lendingRemarks, setLendingRemarks] = useState('');
  const [lendingSaving, setLendingSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedCustomerOutstanding, setSelectedCustomerOutstanding] = useState(0);
  const prevSyncBusyRef = useRef(syncBusy);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);

  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [driverModalOpen, setDriverModalOpen] = useState(false);
  const [helperModalOpen, setHelperModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [helperSearch, setHelperSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [itemCategoryFilter, setItemCategoryFilter] = useState<string>('ALL');

  const subtotal = useMemo(() => round2(cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)), [cart]);
  const discountValue = useMemo(() => {
    const parsed = Number(discount || '0');
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return Math.min(parsed, subtotal);
  }, [discount, subtotal]);
  const deliveryFeeValue = useMemo(() => {
    if (orderType !== 'DELIVERY') {
      return 0;
    }
    const parsed = Number(deliveryFee || '0');
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return round2(parsed);
  }, [deliveryFee, orderType]);
  const baseNetTotal = useMemo(() => round2(subtotal - discountValue), [subtotal, discountValue]);
  const total = useMemo(() => round2(baseNetTotal + deliveryFeeValue), [baseNetTotal, deliveryFeeValue]);

  const scopedLocations = useMemo(() => {
    const branchScoped = locations.filter((option) => !option.branchId || option.branchId === branchId);
    return branchScoped.length ? branchScoped : locations;
  }, [locations, branchId]);

  const branch = useMemo(() => branches.find((option) => option.id === branchId), [branches, branchId]);
  const location = useMemo(() => scopedLocations.find((option) => option.id === locationId), [scopedLocations, locationId]);
  const selectedCustomer = useMemo(() => customers.find((option) => option.id === customerId), [customers, customerId]);
  const selectedDriver = useMemo(() => personnels.find((option) => option.id === driverId), [personnels, driverId]);
  const selectedHelper = useMemo(() => personnels.find((option) => option.id === helperId), [personnels, helperId]);
  const personnelLabel = orderType === 'DELIVERY' ? 'Driver' : 'Personnel';
  const currentPointsBalance = customerProfile?.pointsBalance ?? 0;
  const isCustomerReady = customerId.trim().length > 0;
  const isPersonnelReady = driverId.trim().length > 0;
  const hasCart = cart.length > 0;
  const canProceedToPayment = hasCart && isCustomerReady && isPersonnelReady;
  const parsedPaidAmount = useMemo(() => {
    const parsed = Number(paidAmount || '0');
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return round2(parsed);
  }, [paidAmount]);
  const appliedPaidAmount = useMemo(
    () => round2(paymentMode === 'FULL' ? Math.min(parsedPaidAmount, total) : Math.min(parsedPaidAmount, total)),
    [parsedPaidAmount, paymentMode, total]
  );
  const changeAmount = useMemo(
    () => round2(paymentMode === 'FULL' ? Math.max(0, parsedPaidAmount - total) : 0),
    [parsedPaidAmount, paymentMode, total]
  );
  const creditBalance = useMemo(() => round2(Math.max(0, total - appliedPaidAmount)), [appliedPaidAmount, total]);
  const lpgFlowSummary = useMemo(() => {
    return cart.reduce(
      (acc, line) => {
        if (!line.isLpg) {
          return acc;
        }
        if (line.cylinderFlow === 'NON_REFILL') {
          acc.nonRefill += line.quantity;
        } else if (line.cylinderFlow === 'REFILL_EXCHANGE') {
          acc.refill += line.quantity;
        }
        return acc;
      },
      { refill: 0, nonRefill: 0 }
    );
  }, [cart]);
  const paymentReady = useMemo(() => {
    if (!showPaymentStep || !canProceedToPayment) {
      return false;
    }
    if (paymentMode === 'FULL') {
      return parsedPaidAmount >= round2(total);
    }
    return parsedPaidAmount >= 0 && parsedPaidAmount < round2(total);
  }, [showPaymentStep, canProceedToPayment, paymentMode, parsedPaidAmount, total]);
  const selectedReward = useMemo(
    () => availableRewards.find((reward) => reward.id === selectedRewardId) ?? null,
    [availableRewards, selectedRewardId]
  );
  const rewardBaseAmount = useMemo(
    () => round2(Math.max(0, subtotal - discountValue) + deliveryFeeValue),
    [subtotal, discountValue, deliveryFeeValue]
  );
  const rewardItemDiscountValue = useMemo(() => {
    if (!selectedReward) {
      return 0;
    }
    if (selectedReward.reward_type === 'DISCOUNT_FIXED') {
      return round2(Math.min(selectedReward.discount_value ?? 0, Math.max(0, subtotal - discountValue)));
    }
    if (selectedReward.reward_type === 'DISCOUNT_PERCENT') {
      const percent = Math.max(0, selectedReward.discount_value ?? 0);
      return round2(Math.max(0, subtotal - discountValue) * (percent / 100));
    }
    if (selectedReward.reward_type === 'FREE_PRODUCT' || selectedReward.reward_type === 'FREE_REFILL') {
      return resolveRewardCartDiscount(selectedReward, cart);
    }
    return 0;
  }, [cart, discountValue, selectedReward, subtotal]);
  const rewardDeliveryDiscountValue = useMemo(() => {
    if (!selectedReward || selectedReward.reward_type !== 'FREE_DELIVERY') {
      return 0;
    }
    return deliveryFeeValue;
  }, [deliveryFeeValue, selectedReward]);
  const totalRewardValue = useMemo(
    () => round2(rewardItemDiscountValue + rewardDeliveryDiscountValue),
    [rewardDeliveryDiscountValue, rewardItemDiscountValue]
  );
  const rewardEligibleOptions = useMemo(() => {
    return availableRewards.filter((reward) => {
      if (reward.status !== 'ACTIVE') {
        return false;
      }
      if (customerProfile && reward.points_cost > customerProfile.pointsBalance) {
        return false;
      }
      if (reward.min_spend !== null && rewardBaseAmount < reward.min_spend) {
        return false;
      }
      if (
        (reward.reward_type === 'FREE_PRODUCT' || reward.reward_type === 'FREE_REFILL') &&
        resolveRewardCartDiscount(reward, cart) <= 0
      ) {
        return false;
      }
      return true;
    });
  }, [availableRewards, cart, customerProfile, rewardBaseAmount]);

  const itemCategoryOptions = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const item of catalog) {
      const value = item.category?.trim();
      if (!value) {
        continue;
      }
      set.add(value);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    return catalog
      .filter((item) => {
        if (itemCategoryFilter !== 'ALL' && (item.category?.trim() ?? '') !== itemCategoryFilter) {
          return false;
        }
        if (!q) {
          return true;
        }
        return `${item.name} ${item.subtitle ?? ''} ${item.id} ${item.category ?? ''}`.toLowerCase().includes(q);
      })
      .slice(0, 120);
  }, [catalog, itemSearch, itemCategoryFilter]);

  const resolveProjectedStock = (
    product: Pick<Product, 'id' | 'qtyOnHand' | 'qtyFull' | 'qtyEmpty'>
  ): ProjectedInventoryTotals | null => {
    const fromProjection = projectedInventoryByProduct.get(product.id);
    if (fromProjection) {
      return fromProjection;
    }
    const fallbackOnHand =
      typeof product.qtyOnHand === 'number' && Number.isFinite(product.qtyOnHand) ? product.qtyOnHand : null;
    const fallbackFull =
      typeof product.qtyFull === 'number' && Number.isFinite(product.qtyFull) ? product.qtyFull : null;
    const fallbackEmpty =
      typeof product.qtyEmpty === 'number' && Number.isFinite(product.qtyEmpty) ? product.qtyEmpty : null;
    if (fallbackOnHand === null && fallbackFull === null && fallbackEmpty === null) {
      return null;
    }
    return {
      qtyOnHand: fallbackOnHand ?? 0,
      qtyFull: fallbackFull ?? 0,
      qtyEmpty: fallbackEmpty ?? 0
    };
  };

  const itemFlowPrices = useMemo(() => {
    const map = new Map<
      string,
      { refill: number | null; nonRefill: number | null }
    >();
    const nowIso = new Date().toISOString();
    for (const product of filteredCatalog) {
      if (!product.isLpg) {
        map.set(product.id, { refill: null, nonRefill: null });
        continue;
      }
      const refill = resolveLocalPrice({
        productId: product.id,
        branchId,
        customer: customerProfile,
        priceLists,
        atIso: nowIso,
        flowMode: 'REFILL_EXCHANGE'
      });
      const nonRefill = resolveLocalPrice({
        productId: product.id,
        branchId,
        customer: customerProfile,
        priceLists,
        atIso: nowIso,
        flowMode: 'NON_REFILL'
      });
      map.set(product.id, {
        refill: refill !== null ? round2(refill) : null,
        nonRefill: nonRefill !== null ? round2(nonRefill) : null
      });
    }
    return map;
  }, [filteredCatalog, branchId, customerProfile, priceLists]);

  const personnelChoicesForDriver = useMemo(
    () => personnels.filter((option) => option.id !== helperId || option.id === driverId),
    [personnels, helperId, driverId]
  );
  const personnelChoicesForHelper = useMemo(
    () => personnels.filter((option) => option.id !== driverId || option.id === helperId),
    [personnels, helperId, driverId]
  );

  const vcardApiRequest = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const session = new LocalSessionService(db);
    await session.initializeFromStorage();
    const transport = new HttpAuthTransport({ baseUrl: POS_API_BASE_URL });
    const send = async (token?: string): Promise<Response> => {
      const clientId = await session.getClientId();
      const headers = new Headers(init?.headers ?? {});
      headers.set('content-type', 'application/json');
      if (token) {
        headers.set('authorization', `Bearer ${token}`);
      }
      if (clientId?.trim()) {
        headers.set('x-client-id', clientId.trim());
      }
      return fetch(`${POS_API_BASE_URL}${path}`, {
        ...init,
        headers
      });
    };

    let token = await session.getAccessToken();
    let response = await send(token);
    if (response.status === 401) {
      const refreshed = await session.refreshSession(transport);
      if (refreshed) {
        token = await session.getAccessToken();
        response = await send(token);
      }
    }
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const payload = (await response.json()) as { message?: string | string[]; error?: string };
        if (Array.isArray(payload.message)) {
          message = payload.message.join(', ');
        } else if (typeof payload.message === 'string') {
          message = payload.message;
        } else if (typeof payload.error === 'string') {
          message = payload.error;
        }
      } catch {
        // ignore parse failure
      }
      throw new Error(message);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  };

  const loadRewardsForCheckout = async (): Promise<void> => {
    if (!showPaymentStep || !customerId.trim() || !branchId.trim()) {
      setAvailableRewards([]);
      return;
    }
    setRewardsLoading(true);
    try {
      const rewards = await vcardApiRequest<Array<Record<string, unknown>>>(
        `/vcard/rewards?status=ACTIVE&branch_id=${encodeURIComponent(branchId.trim())}&location_id=${encodeURIComponent(locationId.trim())}&limit=100`
      );
      const normalized: PosRewardRecord[] = [];
      for (const row of rewards ?? []) {
        const rewardType = asString(row.reward_type ?? row.rewardType)?.toUpperCase();
        if (!isSupportedPosRewardType(rewardType)) {
          continue;
        }
        const id = asString(row.id);
        const code = asString(row.code);
        const name = asString(row.name);
        if (!id || !code || !name) {
          continue;
        }
        normalized.push({
          id,
          code,
          name,
          description: asString(row.description) ?? null,
          reward_type: rewardType,
          points_cost: Math.max(0, asNumber(row.points_cost ?? row.pointsCost) ?? 0),
          product_id: asString(row.product_id ?? row.productId),
          free_qty: asNumber(row.free_qty ?? row.freeQty),
          discount_value: asNumber(row.discount_value ?? row.discountValue),
          min_spend: asNumber(row.min_spend ?? row.minSpend),
          status: (asString(row.status)?.toUpperCase() as PosRewardRecord['status']) ?? 'ACTIVE'
        });
      }
      setAvailableRewards(normalized);
    } catch (cause) {
      setAvailableRewards([]);
      toastInfo('Rewards unavailable', cause instanceof Error ? cause.message : 'Could not load rewards.');
    } finally {
      setRewardsLoading(false);
    }
  };

  const openPostSaleLendingModal = (state: PostSaleLendingState): void => {
    setPostSaleLending(state);
    setLendingRemarks('');
    setLendingQtyByProduct(
      Object.fromEntries(state.products.map((product) => [product.product_id, '']))
    );
    setLendingDepositByProduct(
      Object.fromEntries(
        state.products.map((product) => [
          product.product_id,
          product.default_deposit_amount !== null ? product.default_deposit_amount.toFixed(2) : ''
        ])
      )
    );
  };

  const closePostSaleLendingModal = (): void => {
    if (lendingSaving) {
      return;
    }
    setPostSaleLending(null);
    setLendingRemarks('');
    setLendingQtyByProduct({});
    setLendingDepositByProduct({});
  };

  const savePostSaleLending = async (): Promise<void> => {
    if (!postSaleLending || lendingSaving) {
      return;
    }
    const lines = postSaleLending.products
      .map((product) => {
        const qty = Number(lendingQtyByProduct[product.product_id] || '0');
        const depositRaw = lendingDepositByProduct[product.product_id];
        const deposit = depositRaw?.trim().length ? Number(depositRaw) : null;
        return {
          product,
          qty,
          deposit
        };
      })
      .filter((entry) => Number.isFinite(entry.qty) && entry.qty > 0);

    if (lines.length === 0) {
      toastInfo('Lending', 'Enter quantity for at least one lendable item.');
      return;
    }
    for (const entry of lines) {
      if (entry.qty > entry.product.available_qty) {
        toastError(
          'Lending',
          `${entry.product.name} only has ${entry.product.available_qty.toFixed(4)} available.`
        );
        return;
      }
      if (entry.product.requires_deposit && (entry.deposit === null || !Number.isFinite(entry.deposit) || entry.deposit < 0)) {
        toastError('Lending', `Deposit is required for ${entry.product.name}.`);
        return;
      }
      if (entry.deposit !== null && (!Number.isFinite(entry.deposit) || entry.deposit < 0)) {
        toastError('Lending', `Deposit must be 0 or higher for ${entry.product.name}.`);
        return;
      }
    }

    setLendingSaving(true);
    try {
      await vcardApiRequest('/lending', {
        method: 'POST',
        body: JSON.stringify({
          sale_id: postSaleLending.saleId,
          remarks: lendingRemarks.trim() || null,
          lines: lines.map((entry) => ({
            product_id: entry.product.product_id,
            quantity: entry.qty,
            deposit_amount: entry.deposit
          }))
        })
      });
      toastSuccess('Lending saved', `Linked to sale ${postSaleLending.saleId}.`);
      closePostSaleLendingModal();
      await onDataChanged?.();
    } catch (cause) {
      toastError('Lending failed', cause instanceof Error ? cause.message : 'Unable to save lending.');
    } finally {
      setLendingSaving(false);
    }
  };

  const handleSelectReward = (reward: PosRewardRecord): void => {
    setSelectedRewardId(reward.id);
    if (reward.reward_type === 'DISCOUNT_FIXED' && Number(discount || '0') <= 0 && reward.discount_value !== null) {
      setDiscount(reward.discount_value.toFixed(2));
      return;
    }
    if (reward.reward_type === 'DISCOUNT_PERCENT' && Number(discount || '0') <= 0 && reward.discount_value !== null) {
      const suggested = round2(rewardBaseAmount * (reward.discount_value / 100));
      setDiscount(suggested.toFixed(2));
      return;
    }
    if (reward.reward_type === 'FREE_DELIVERY' && orderType === 'DELIVERY' && Number(deliveryFee || '0') > 0) {
      setDeliveryFee('0.00');
      return;
    }
    if (
      (reward.reward_type === 'FREE_PRODUCT' || reward.reward_type === 'FREE_REFILL') &&
      Number(discount || '0') <= 0
    ) {
      const suggested = resolveRewardCartDiscount(reward, cart);
      if (suggested > 0) {
        setDiscount(suggested.toFixed(2));
      }
    }
  };

  useEffect(() => {
    if (cart.length === 0) {
      setPaidAmount('0');
      setDeliveryFee('0.00');
      setShowPaymentStep(false);
      return;
    }
    if (paymentMode === 'PARTIAL' && Number(paidAmount || '0') > total) {
      setPaidAmount(total.toFixed(2));
    }
  }, [total, cart.length, paymentMode, paidAmount]);

  useEffect(() => {
    if (orderType !== 'DELIVERY') {
      setDeliveryFee('0.00');
    }
  }, [orderType]);

  useEffect(() => {
    if (!showPaymentStep) {
      setAvailableRewards([]);
      setSelectedRewardId('');
      return;
    }
    void loadRewardsForCheckout();
  }, [showPaymentStep, customerId, branchId, locationId]);

  useEffect(() => {
    void refreshMasterData();
  }, []);

  useEffect(() => {
    void refreshActiveShift();
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [branchId, customerId, locationId, inventoryProjectionVersion]);

  useEffect(() => {
    if (prevSyncBusyRef.current && !syncBusy) {
      void refreshMasterData();
      void refreshActiveShift();
      void refreshCatalog();
    }
    prevSyncBusyRef.current = syncBusy;
  }, [syncBusy, branchId, customerId, locationId]);

  useEffect(() => {
    if (itemCategoryFilter === 'ALL') {
      return;
    }
    if (!itemCategoryOptions.includes(itemCategoryFilter)) {
      setItemCategoryFilter('ALL');
    }
  }, [itemCategoryFilter, itemCategoryOptions]);

  useEffect(() => {
    let mounted = true;
    const loadOutstanding = async (): Promise<void> => {
      if (!customerId.trim()) {
        if (mounted) {
          setSelectedCustomerOutstanding(0);
        }
        return;
      }
      const row = await db.getFirstAsync<{ payload: string }>(
        `
        SELECT payload
        FROM master_data_local
        WHERE entity IN (?, ?) AND record_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
        `,
        'customer',
        'customers',
        customerId.trim()
      );
      const payload = row?.payload ? parseRecord<Record<string, unknown>>(row.payload, {}) : {};
      const outstanding = asNumber(payload.outstandingBalance ?? payload.outstanding_balance) ?? 0;
      if (mounted) {
        setSelectedCustomerOutstanding(round2(Math.max(0, outstanding)));
      }
    };
    void loadOutstanding();
    return () => {
      mounted = false;
    };
  }, [customerId, db]);

  useEffect(() => {
    setSelectedRewardId('');
  }, [customerId]);

  useEffect(() => {
    if (!selectedRewardId) {
      return;
    }
    if (!rewardEligibleOptions.some((reward) => reward.id === selectedRewardId)) {
      setSelectedRewardId('');
    }
  }, [rewardEligibleOptions, selectedRewardId]);

  useEffect(() => {
    if (!scopedLocations.length) {
      return;
    }
    if (scopedLocations.some((option) => option.id === locationId)) {
      return;
    }
    setLocationId(scopedLocations[0].id);
  }, [scopedLocations, locationId]);

  useEffect(() => {
    if (!preferredBranchId) {
      return;
    }
    if (!branches.some((option) => option.id === preferredBranchId)) {
      return;
    }
    setBranchId(preferredBranchId);
  }, [preferredBranchId, branches]);

  useEffect(() => {
    if (!preferredLocationId) {
      return;
    }
    if (!scopedLocations.some((option) => option.id === preferredLocationId)) {
      return;
    }
    setLocationId(preferredLocationId);
  }, [preferredLocationId, scopedLocations]);

  const refreshMasterData = async (): Promise<void> => {
    const [nextBranches, nextLocations, nextCustomers, nextPersonnels] = await Promise.all([
      loadBranchOptions(db),
      loadLocationOptions(db),
      loadCustomerOptions(db),
      loadPersonnelOptions(db)
    ]);

    const branchOptions = nextBranches.length ? nextBranches : FALLBACK_BRANCHES;
    const locationOptions = nextLocations.length ? nextLocations : FALLBACK_LOCATIONS;

    setBranches(branchOptions);
    setLocations(locationOptions);
    setCustomers(nextCustomers);
    setPersonnels(nextPersonnels);

    setBranchId((current) => {
      if (preferredBranchId && branchOptions.some((option) => option.id === preferredBranchId)) {
        return preferredBranchId;
      }
      if (branchOptions.some((option) => option.id === current)) {
        return current;
      }
      return branchOptions[0].id;
    });

    setLocationId((current) => {
      if (preferredLocationId && locationOptions.some((option) => option.id === preferredLocationId)) {
        return preferredLocationId;
      }
      if (locationOptions.some((option) => option.id === current)) {
        return current;
      }
      const preferredBranch = preferredBranchId && branchOptions.some((option) => option.id === preferredBranchId)
        ? preferredBranchId
        : branchOptions[0].id;
      const locationForBranch = locationOptions.find((option) => !option.branchId || option.branchId === preferredBranch);
      return locationForBranch?.id ?? locationOptions[0].id;
    });

    setCustomerId((current) => (current && !nextCustomers.some((option) => option.id === current) ? '' : current));
    setDriverId((current) => (current && !nextPersonnels.some((option) => option.id === current) ? '' : current));
    setHelperId((current) => (current && !nextPersonnels.some((option) => option.id === current) ? '' : current));
  };

  const findActiveShiftId = async (): Promise<string | null> => {
    const rows = await db.getAllAsync<ShiftStateRow>(
      `
      SELECT id, payload, created_at
      FROM shifts_local
      ORDER BY created_at DESC
      LIMIT 50
      `
    );
    for (const row of rows) {
      const payload = parseRecord<Record<string, unknown>>(row.payload, {});
      const status = String(payload.status ?? '').toLowerCase();
      if (status === 'open') {
        return row.id;
      }
    }
    return null;
  };

  const refreshActiveShift = async (): Promise<void> => {
    const id = await findActiveShiftId();
    setActiveShiftId(id);
  };

  const requireActiveShift = async (): Promise<string | null> => {
    const id = await findActiveShiftId();
    setActiveShiftId(id);
    if (!id) {
      toastError('POS', 'No active duty. Go to Shift tab and tap Start Duty first.');
      return null;
    }
    return id;
  };

  const refreshCatalog = async (): Promise<void> => {
    const productRows = await db.getAllAsync<{ payload: string }>(
      `
      SELECT payload
      FROM master_data_local
      WHERE entity IN (?, ?)
      ORDER BY updated_at DESC
      `,
      'product',
      'products'
    );

    if (!productRows.length) {
      setCatalog(FALLBACK_PRODUCTS);
      setProjectedInventoryByProduct(new Map());
      return;
    }

    const priceListRows = await db.getAllAsync<{ payload: string }>(
      `
      SELECT payload
      FROM master_data_local
      WHERE entity IN (?, ?)
      ORDER BY updated_at DESC
      `,
      'price_list',
      'price_lists'
    );

    let customerProfile: CustomerProfile | null = null;
    if (customerId.trim()) {
      const customerRow = await db.getFirstAsync<{ payload: string }>(
        `
        SELECT payload
        FROM master_data_local
        WHERE entity IN (?, ?) AND record_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
        `,
        'customer',
        'customers',
        customerId.trim()
      );
      if (customerRow?.payload) {
        customerProfile = parseCustomerProfile(parseRecord<Record<string, unknown>>(customerRow.payload, {}));
      }
    }

    const localPriceLists = parsePriceLists(priceListRows);
    setPriceLists(localPriceLists);
    setCustomerProfile(customerProfile);
    const nowIso = new Date().toISOString();
    const dedupe = new Map<string, Product>();
    const inventoryRows = await db.getAllAsync<{ payload: string }>(
      `
      SELECT payload
      FROM master_data_local
      WHERE entity IN (?, ?)
      ORDER BY updated_at DESC
      `,
      'inventory_balance',
      'inventory_balances'
    );
    const inventoryByProduct = new Map<string, ProjectedInventoryTotals>();
    for (const row of inventoryRows) {
      const snapshot = parseInventorySnapshot(parseRecord<Record<string, unknown>>(row.payload, {}));
      if (!snapshot) {
        continue;
      }
      if (locationId.trim().length && snapshot.locationId && snapshot.locationId !== locationId.trim()) {
        continue;
      }
      const current = inventoryByProduct.get(snapshot.productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
      current.qtyOnHand += snapshot.qtyOnHand;
      current.qtyFull += snapshot.qtyFull;
      current.qtyEmpty += snapshot.qtyEmpty;
      inventoryByProduct.set(snapshot.productId, current);
    }
    const pendingDeltaByProduct = await loadPendingInventoryDeltaByProductForLocation(db, locationId.trim());
    const projectedInventory = mergeInventoryWithDeltas(inventoryByProduct, pendingDeltaByProduct);
    setProjectedInventoryByProduct(projectedInventory);

    for (const row of productRows) {
      const payload = parseRecord<Record<string, unknown>>(row.payload, {});
      const id = typeof payload.id === 'string' ? payload.id : '';
      const name = typeof payload.name === 'string' ? payload.name : '';
      const code =
        typeof payload.itemCode === 'string'
          ? payload.itemCode
          : typeof payload.item_code === 'string'
            ? payload.item_code
            : typeof payload.sku === 'string'
              ? payload.sku
              : '';
      const fallbackPrice =
        asNumber(payload.unitPrice ?? payload.unit_price ?? payload.price) ?? 0;

      if (!id || !name) {
        continue;
      }

      if (dedupe.has(id)) {
        continue;
      }
      const category = asString(payload.category ?? payload.category_code);

      const isLpg =
        payload.isLpg === true ||
        payload.is_lpg === true ||
        Boolean(asString(payload.cylinderTypeId ?? payload.cylinder_type_id));

      const resolvedPrice = isLpg
        ? resolveLocalPrice({
            productId: id,
            branchId,
            customer: customerProfile,
            priceLists: localPriceLists,
            atIso: nowIso,
            flowMode: 'REFILL_EXCHANGE'
          }) ??
          resolveLocalPrice({
            productId: id,
            branchId,
            customer: customerProfile,
            priceLists: localPriceLists,
            atIso: nowIso,
            flowMode: 'NON_REFILL'
          }) ??
          resolveLocalPrice({
            productId: id,
            branchId,
            customer: customerProfile,
            priceLists: localPriceLists,
            atIso: nowIso,
            flowMode: null
          })
        : resolveLocalPrice({
            productId: id,
            branchId,
            customer: customerProfile,
            priceLists: localPriceLists,
            atIso: nowIso,
            flowMode: null
          });
      const stock = projectedInventory.get(id);

      dedupe.set(id, {
        id,
        name,
        subtitle: code || id,
        category,
        qtyFull: stock ? stock.qtyFull : undefined,
        qtyEmpty: stock ? stock.qtyEmpty : undefined,
        qtyOnHand: stock ? stock.qtyOnHand : null,
        unitPrice: resolvedPrice !== null ? resolvedPrice : fallbackPrice > 0 ? round2(fallbackPrice) : 0,
        isLpg
      });
    }

    const parsed = [...dedupe.values()].sort((a, b) => a.name.localeCompare(b.name));
    setCatalog(parsed.length ? parsed : FALLBACK_PRODUCTS);
  };

  const createLineId = (productId: string, flow?: CylinderFlowSelection | null): string =>
    `${productId}:${flow ?? 'NA'}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;

  const resolveDefaultFlowForNewLine = (): CylinderFlowSelection | null => {
    if (defaultLpgFlowForNewItem === 'REFILL_EXCHANGE' || defaultLpgFlowForNewItem === 'NON_REFILL') {
      return defaultLpgFlowForNewItem;
    }
    return null;
  };

  const resolveLineUnitPrice = (
    product: Product,
    flow: CylinderFlowSelection | null
  ): number => {
    const atIso = new Date().toISOString();
    if (!product.isLpg) {
      const resolved = resolveLocalPrice({
        productId: product.id,
        branchId,
        customer: customerProfile,
        priceLists,
        atIso,
        flowMode: null
      });
      return resolved !== null ? round2(resolved) : product.unitPrice;
    }

    if (!flow) {
      const preview =
        resolveLocalPrice({
          productId: product.id,
          branchId,
          customer: customerProfile,
          priceLists,
          atIso,
          flowMode: 'REFILL_EXCHANGE'
        }) ??
        resolveLocalPrice({
          productId: product.id,
          branchId,
          customer: customerProfile,
          priceLists,
          atIso,
          flowMode: 'NON_REFILL'
        }) ??
        resolveLocalPrice({
          productId: product.id,
          branchId,
          customer: customerProfile,
          priceLists,
          atIso,
          flowMode: null
        });
      return preview !== null ? round2(preview) : product.unitPrice;
    }

    const exact = resolveLocalPrice({
      productId: product.id,
      branchId,
      customer: customerProfile,
      priceLists,
      atIso,
      flowMode: flow
    });
    return exact !== null ? round2(exact) : product.unitPrice;
  };

  const validateProductQtyForCart = (
    product: Product,
    nextTotalQty: number
  ): string | null => {
    const stock = resolveProjectedStock(product);
    if (product.isLpg) {
      const availableFull = stock ? Math.max(0, stock.qtyFull) : null;
      if (availableFull === null) {
        return `${product.name}: no stock data available yet. Download/sync branch data first.`;
      }
      if (nextTotalQty > availableFull + 0.0001) {
        return `${product.name}: insufficient FULL qty (avail ${availableFull.toFixed(2)}, need ${nextTotalQty.toFixed(2)}).`;
      }
      return null;
    }
    const availableOnHand = stock ? Math.max(0, stock.qtyOnHand) : null;
    if (availableOnHand === null) {
      return `${product.name}: no stock data available yet. Download/sync branch data first.`;
    }
    if (nextTotalQty > availableOnHand + 0.0001) {
      return `${product.name}: insufficient qty on hand (avail ${availableOnHand.toFixed(2)}, need ${nextTotalQty.toFixed(2)}).`;
    }
    return null;
  };

  const isItemOutOfStock = (product: Product): boolean => {
    const stock = resolveProjectedStock(product);
    if (product.isLpg) {
      const full = stock ? stock.qtyFull : null;
      if (full === null) {
        return true;
      }
      return full <= 0;
    }
    const qoh = stock ? stock.qtyOnHand : null;
    if (qoh === null) {
      return true;
    }
    return qoh <= 0;
  };

  const addToCart = (product: Product): void => {
    let stockError: string | null = null;
    setCart((prev) => {
      const flow: CylinderFlowSelection | null = product.isLpg ? resolveDefaultFlowForNewLine() : null;
      const unitPrice = resolveLineUnitPrice(product, flow);
      const currentTotalQty = prev
        .filter((line) => line.id === product.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      const nextTotalQty = round2(currentTotalQty + 1);
      stockError = validateProductQtyForCart(product, nextTotalQty);
      if (stockError) {
        return prev;
      }
      const existing = prev.find(
        (line) =>
          line.id === product.id &&
          (product.isLpg ? line.cylinderFlow === flow : true)
      );
      if (!existing) {
        return [
          ...prev,
          {
            ...product,
            lineId: createLineId(product.id, flow),
            quantity: 1,
            unitPrice,
            cylinderFlow: flow
          }
        ];
      }
      return prev.map((line) =>
        line.lineId === existing.lineId ? { ...line, quantity: line.quantity + 1, unitPrice } : line
      );
    });
    if (stockError) {
      toastError('Insufficient inventory', stockError);
    }
  };

  const updateQty = (lineId: string, quantity: number): void => {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((line) => line.lineId !== lineId));
      return;
    }
    let stockError: string | null = null;
    setCart((prev) => {
      const target = prev.find((line) => line.lineId === lineId);
      if (!target) {
        return prev;
      }
      if (quantity <= target.quantity) {
        return prev.map((line) => (line.lineId === lineId ? { ...line, quantity } : line));
      }
      const currentTotalQty = prev
        .filter((line) => line.id === target.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      const nextTotalQty = round2(currentTotalQty - target.quantity + quantity);
      stockError = validateProductQtyForCart(target, nextTotalQty);
      if (stockError) {
        return prev;
      }
      return prev.map((line) => (line.lineId === lineId ? { ...line, quantity } : line));
    });
    if (stockError) {
      toastError('Insufficient inventory', stockError);
    }
  };

  const resolveFlowUnitPrice = (line: CartLine, flow: CylinderFlowSelection): number => {
    const resolved = resolveLocalPrice({
      productId: line.id,
      branchId,
      customer: customerProfile,
      priceLists,
      atIso: new Date().toISOString(),
      flowMode: flow
    });
    return resolved !== null ? round2(resolved) : line.unitPrice;
  };

  useEffect(() => {
    setCart((prev) => {
      let changed = false;
      const next = prev.map((line) => {
        const nextPrice = resolveLineUnitPrice(
          line,
          line.isLpg ? (line.cylinderFlow ?? null) : null
        );
        if (Math.abs(nextPrice - line.unitPrice) < 0.0001) {
          return line;
        }
        changed = true;
        return { ...line, unitPrice: nextPrice };
      });
      return changed ? next : prev;
    });
  }, [branchId, customerProfile, priceLists]);

  const validateCartInventoryBeforeQueue = async (): Promise<string[]> => {
    if (!locationId.trim() || cart.length === 0) {
      return [];
    }

    const errors: string[] = [];
    for (const line of cart) {
      const inventory = resolveProjectedStock(line) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
      const required = round2(line.quantity);
      if (line.isLpg) {
        if (!line.cylinderFlow) {
          errors.push(`${line.name}: select Refill/Non-Refill.`);
          continue;
        }
        if (inventory.qtyFull + 0.0001 < required) {
          errors.push(
            `${line.name}: insufficient FULL at ${location?.label ?? locationId} (avail ${inventory.qtyFull.toFixed(2)}, need ${required.toFixed(2)}).`
          );
        }
        if (line.cylinderFlow === 'NON_REFILL' && inventory.qtyOnHand + 0.0001 < required) {
          errors.push(
            `${line.name}: insufficient stock at ${location?.label ?? locationId} (avail ${inventory.qtyOnHand.toFixed(2)}, need ${required.toFixed(2)}).`
          );
        }
      } else if (inventory.qtyOnHand + 0.0001 < required) {
        errors.push(
          `${line.name}: insufficient stock at ${location?.label ?? locationId} (avail ${inventory.qtyOnHand.toFixed(2)}, need ${required.toFixed(2)}).`
        );
      }
    }
    return errors;
  };

  const setLineCylinderFlow = (lineId: string, nextFlow: CylinderFlowSelection): void => {
    setCart((prev) => {
      const current = prev.find((line) => line.lineId === lineId);
      if (!current || !current.isLpg || current.cylinderFlow === nextFlow) {
        return prev;
      }
      const nextUnitPrice = resolveFlowUnitPrice(current, nextFlow);

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
                cylinderFlow: nextFlow,
                unitPrice: nextUnitPrice
              }
            : line
        );
      }

      return prev
        .map((line) => {
          if (line.lineId === duplicate.lineId) {
            return { ...line, quantity: line.quantity + current.quantity, unitPrice: nextUnitPrice };
          }
          return line;
        })
        .filter((line) => line.lineId !== lineId);
    });
  };

  const handleProceedToPayment = async (): Promise<void> => {
    const duty = await requireActiveShift();
    if (!duty) {
      return;
    }
    if (!hasCart) {
      toastError('POS', 'Add item(s) first.');
      return;
    }
    if (!isCustomerReady) {
      toastError('POS', 'Customer is required before payment.');
      return;
    }
    if (!isPersonnelReady) {
      toastError('POS', `${personnelLabel} is required before payment.`);
      return;
    }
    if (cart.some((line) => line.isLpg && !line.cylinderFlow)) {
      toastError('POS', 'Select Refill or Non-Refill for every LPG item before payment.');
      return;
    }
    const inventoryErrors = await validateCartInventoryBeforeQueue();
    if (inventoryErrors.length > 0) {
      toastError('POS Inventory', inventoryErrors.slice(0, 2).join('\n'));
      return;
    }
    if (paymentMode === 'FULL') {
      setPaidAmount(total.toFixed(2));
    }
    setShowPaymentStep(true);
  };

  const checkout = async (): Promise<void> => {
    const duty = await requireActiveShift();
    if (!duty) {
      return;
    }

    if (!cart.length) {
      toastError('POS', 'Cart is empty.');
      return;
    }

    if (!branchId.trim() || !locationId.trim()) {
      toastError('POS', 'Startup branch context is missing. Reopen branch setup.');
      return;
    }

    if (!customerId.trim()) {
      toastError('POS', 'Customer is required before payment.');
      return;
    }

    const deliveryPersonnel: Array<{ userId: string; role: 'DRIVER' | 'HELPER' }> = [];
    if (driverId.trim()) {
      deliveryPersonnel.push({ userId: driverId.trim(), role: 'DRIVER' });
    }
    if (helperId.trim()) {
      deliveryPersonnel.push({ userId: helperId.trim(), role: 'HELPER' });
    }

    if (!driverId.trim()) {
      toastError('POS', `${personnelLabel} is required before payment.`);
      return;
    }

    if (deliveryPersonnel.length === 0) {
      toastError('POS', 'Assign at least one personnel before payment.');
      return;
    }

    if (paymentMode === 'FULL' && parsedPaidAmount < round2(total)) {
      toastError('POS', 'Full payment requires amount equal to or greater than total.');
      return;
    }

    if (paymentMode === 'PARTIAL') {
      if (!Number.isFinite(parsedPaidAmount) || parsedPaidAmount < 0) {
        toastError('POS', 'Enter a valid paid amount for partial payment.');
        return;
      }
      if (parsedPaidAmount >= round2(total)) {
        toastError('POS', 'Partial payment must be less than total.');
        return;
      }
    }

    if (cart.some((line) => line.isLpg && !line.cylinderFlow)) {
      toastError('POS', 'Select Refill or Non-Refill for every LPG item before checkout.');
      return;
    }
    const inventoryErrors = await validateCartInventoryBeforeQueue();
    if (inventoryErrors.length > 0) {
      toastError('POS Inventory', inventoryErrors.slice(0, 2).join('\n'));
      return;
    }

    setSaving(true);
    let reservedReward: PosRewardRedemptionRecord | null = null;
    try {
      if (selectedReward) {
        reservedReward = await vcardApiRequest<PosRewardRedemptionRecord>(
          `/vcard/rewards/${encodeURIComponent(selectedReward.id)}/reserve`,
          {
            method: 'POST',
            body: JSON.stringify({
              customer_id: customerId.trim(),
              branch_id: branchId.trim(),
              location_id: locationId.trim(),
              amount: rewardBaseAmount,
              remarks: `Reserved from mobile POS (${orderType})`,
              metadata: {
                origin: 'MOBILE_POS',
                order_type: orderType
              }
            })
          }
        );
      }
      const creditDue = round2(total - appliedPaidAmount);
      const lpgFlowModes = [
        ...new Set(
          cart
            .filter((line) => line.isLpg)
            .map((line) => line.cylinderFlow)
            .filter((value): value is CylinderFlowSelection => Boolean(value))
        )
      ];
      const saleLevelCylinderFlow = lpgFlowModes.length === 1 ? lpgFlowModes[0] : undefined;
      const postingDiscountAmount = round2(discountValue - deliveryFeeValue);
      const service = new OfflineTransactionService(db);
      const saleId = await service.createOfflineSale({
        branchId: branchId.trim(),
        locationId: locationId.trim(),
        shiftId: activeShiftId,
        customerId: customerId.trim() || null,
        saleType: orderType,
        cylinderFlow: saleLevelCylinderFlow,
        discountAmount: postingDiscountAmount,
        paymentMode,
        creditBalance: creditDue > 0 ? creditDue : 0,
        creditNotes: paymentNotes.trim() || null,
        personnelId: driverId.trim() || null,
        personnelName: selectedDriver?.label ?? null,
        driverId: driverId.trim() || null,
        driverName: selectedDriver?.label ?? null,
        helperId: helperId.trim() || null,
        helperName: selectedHelper?.label ?? null,
        personnel: deliveryPersonnel.map((item) => ({
          userId: item.userId,
          role: item.role,
          name:
            item.role === 'DRIVER'
              ? (selectedDriver?.label ?? null)
              : (selectedHelper?.label ?? null)
        })),
        lines: cart.map((line) => ({
          productId: line.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          ...(line.isLpg && line.cylinderFlow ? { cylinderFlow: line.cylinderFlow } : {})
        })),
        payments: [{ method: paymentMethod, amount: appliedPaidAmount }]
      });

      if (reservedReward) {
        await vcardApiRequest<PosRewardRedemptionRecord>(
          `/vcard/rewards/redemptions/${encodeURIComponent(reservedReward.id)}/apply`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              sale_id: saleId,
              amount: rewardBaseAmount,
              remarks: `Applied from mobile POS sale ${saleId}`,
              metadata: {
                origin: 'MOBILE_POS',
                sale_id: saleId
              }
            })
          }
        );
      }

      if (orderType === 'DELIVERY') {
        await service.createOfflineDeliveryOrder({
          branchId: branchId.trim(),
          sourceLocationId: locationId.trim(),
          customerId: customerId.trim(),
          saleId,
          orderType: 'DELIVERY',
          personnel: deliveryPersonnel,
          notes: 'Created from POS delivery checkout'
        });
      }

      toastSuccess(
        'Sale queued offline',
        creditDue > 0
          ? `Sale ID: ${saleId} (Credit due PHP ${creditDue.toFixed(2)})`
          : orderType === 'DELIVERY'
            ? `Sale + delivery queued: ${saleId}`
            : `Sale ID: ${saleId}`
      );

      if (onPrintQueuedSaleReceipt) {
        try {
          const printResult = await onPrintQueuedSaleReceipt({
            saleId,
            customerId: customerId.trim() || null,
            branchId: branchId.trim(),
            branchName: branch?.label ?? branchId.trim(),
            locationId: locationId.trim(),
            locationName: location?.label ?? locationId.trim(),
            cashierName: cashierName?.trim() ? cashierName.trim() : null,
            orderType,
            customerName: selectedCustomer?.label ?? null,
            personnelName: selectedDriver?.label ?? null,
            helperName: selectedHelper?.label ?? null,
            lines: cart.map((line) => ({
              name: line.name,
              subtitle: line.subtitle,
              quantity: line.quantity,
              unitPrice: line.unitPrice
            })),
            subtotal,
            discount: discountValue,
            total,
            paidAmount: parsedPaidAmount,
            changeAmount,
            creditBalance: creditDue > 0 ? creditDue : 0,
            notes: paymentNotes.trim() || null,
            paymentMode,
            paymentMethod,
            rewardRedemptionUsed: Boolean(reservedReward),
            createdAt: new Date().toISOString()
          });

          if (printResult.printed) {
            toastSuccess(
              'Receipt printed',
              printResult.receiptNumber ? `Receipt #${printResult.receiptNumber}` : printResult.message ?? 'Printed successfully.'
            );
          } else if (printResult.message) {
            toastInfo('Receipt not printed', printResult.message);
          }
        } catch (printCause) {
          const message = printCause instanceof Error ? printCause.message : 'Print failed.';
          toastInfo('Receipt not printed', message);
        }
      }

      let eligibleLendingProducts: LendingEligibleProductRecord[] = [];
      if (customerId.trim()) {
        try {
          eligibleLendingProducts = await vcardApiRequest<LendingEligibleProductRecord[]>(
            `/lending/eligible-products/by-sale/${encodeURIComponent(saleId)}`
          );
        } catch {
          eligibleLendingProducts = [];
        }
      }

      const postSaleLendingSeed =
        customerId.trim() && eligibleLendingProducts.length > 0
          ? {
              saleId,
              customerId: customerId.trim(),
              customerName: selectedCustomer?.label ?? null,
              branchName: branch?.label ?? branchId.trim(),
              locationName: location?.label ?? locationId.trim(),
              products: eligibleLendingProducts
            }
          : null;

      setCart([]);
      setDiscount('0');
      setDeliveryFee('0.00');
      setPaymentMode('FULL');
      setPaidAmount('0');
      setPaymentNotes('');
      setSelectedRewardId('');
      setAvailableRewards([]);
      setShowPaymentStep(false);
      setCustomerId('');
      setCustomerSearch('');
      setDriverId('');
      setDriverSearch('');
      setHelperId('');
      setHelperSearch('');
      await refreshCatalog();
      await onDataChanged?.();
      if (postSaleLendingSeed) {
        Alert.alert(
          'Create Lending',
          'Sale is saved. Do you want to create a lending record for this customer now?',
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Create Lending',
              onPress: () => openPostSaleLendingModal(postSaleLendingSeed)
            }
          ]
        );
      }
    } catch (cause) {
      if (reservedReward?.id) {
        try {
          await vcardApiRequest<PosRewardRedemptionRecord>(
            `/vcard/rewards/redemptions/${encodeURIComponent(reservedReward.id)}/cancel`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                remarks: 'Cancelled because POS checkout did not complete',
                metadata: { origin: 'MOBILE_POS' }
              })
            }
          );
        } catch {
          // Leave best-effort rollback only; original error remains primary.
        }
      }
      toastError('POS checkout failed', cause instanceof Error ? cause.message : 'Unable to queue sale.');
    } finally {
      setSaving(false);
    }
  };

  const promptQueueSale = (): void => {
    if (saving || syncBusy || !paymentReady) {
      return;
    }
    const parts = [
      `Total: PHP ${total.toFixed(2)}`,
      ...(orderType === 'DELIVERY' ? [`Delivery Fee: PHP ${deliveryFeeValue.toFixed(2)}`] : []),
      ...(selectedReward ? [`Reward: ${selectedReward.name} (${selectedReward.points_cost} pts)`] : []),
      `Paid: PHP ${appliedPaidAmount.toFixed(2)}`,
      creditBalance > 0
        ? `Balance Due: PHP ${creditBalance.toFixed(2)}`
        : `Change: PHP ${changeAmount.toFixed(2)}`
    ];
    Alert.alert('Confirm Sale', parts.join('\n'), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Complete Sale',
        onPress: () => {
          void checkout();
        }
      }
    ]);
  };

  return (
    <View
      style={[
        styles.card,
        isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 10, gap: 8, borderRadius: 14 } : null,
        { backgroundColor: theme.card, borderColor: theme.cardBorder }
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, isCompactLayout ? { fontSize: 16 } : null, { color: theme.heading }]}>POS Sales</Text>
        <Text style={[styles.sub, isCompactLayout ? { fontSize: 12 } : null, { color: theme.subtext }]}>
          Pickup and delivery in one checkout flow.
        </Text>
      </View>

      <View
        style={[
          styles.shiftGuardBar,
          {
            borderColor: theme.cardBorder,
            backgroundColor: activeShiftId ? theme.inputBg : theme.pillBg
          }
        ]}
      >
        <Text style={[styles.shiftGuardTitle, { color: activeShiftId ? theme.heading : theme.pillText }]}>
          {activeShiftId ? 'Duty Active' : 'Duty Required'}
        </Text>
        <Text style={[styles.shiftGuardSub, { color: activeShiftId ? theme.subtext : theme.pillText }]}>
          {activeShiftId
            ? `Shift ${activeShiftId} is active.`
            : 'Start Duty in Shift tab before proceeding to payment.'}
        </Text>
        {!activeShiftId ? (
          <Pressable
            style={[styles.shiftGuardAction, { backgroundColor: theme.primary }]}
            onPress={onGoToShift}
            disabled={!onGoToShift}
          >
            <Text style={styles.shiftGuardActionText}>Go to Shift</Text>
          </Pressable>
        ) : null}
      </View>

      <View
        style={[
          styles.contextBar,
          isCompactLayout ? { paddingHorizontal: 8, paddingVertical: 6 } : null,
          { borderColor: theme.cardBorder, backgroundColor: theme.pillBg }
        ]}
      >
        <Text
          style={[styles.contextText, isCompactLayout ? { fontSize: 11 } : null, { color: theme.pillText }]}
          numberOfLines={1}
        >
          Branch: {branch?.label ?? branchId}
        </Text>
        <Text
          style={[styles.contextText, isCompactLayout ? { fontSize: 11 } : null, { color: theme.pillText }]}
          numberOfLines={1}
        >
          Location: {location?.label ?? locationId}
        </Text>
      </View>

      <View
        ref={tutorialOrderType.ref}
        onLayout={tutorialOrderType.onLayout}
        style={[styles.row, isCompactLayout ? { gap: 6 } : null]}
      >
        {(['PICKUP', 'DELIVERY'] as const).map((mode) => {
          const selected = orderType === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => setOrderType(mode)}
              style={[
                styles.modePill,
                isCompactLayout ? { minHeight: 36 } : null,
                { backgroundColor: selected ? theme.primary : theme.pillBg },
                tutorialOrderType.active ? styles.tutorialTargetFocus : null
              ]}
            >
              <Text style={{ color: selected ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: isCompactLayout ? 11 : 12 }}>
                {mode}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View ref={tutorialCustomer.ref} onLayout={tutorialCustomer.onLayout}>
        <Pressable
          onPress={() => {
            setCustomerSearch('');
            setCustomerModalOpen(true);
          }}
          style={[
            styles.selectorButton,
            isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
            tutorialCustomer.active ? styles.tutorialTargetFocus : null
          ]}
        >
          <Text style={[styles.selectorLabel, { color: theme.subtext }]}>Customer</Text>
          <Text style={[styles.selectorValue, isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]} numberOfLines={1}>
            {selectedCustomer?.label ?? 'Select customer'}
          </Text>
          {selectedCustomer ? (
            <Text style={[styles.selectorMeta, { color: theme.subtext }]}>
              Points: {currentPointsBalance} | Balance: PHP {selectedCustomerOutstanding.toFixed(2)}
            </Text>
          ) : null}
        </Pressable>
      </View>

      <View style={[styles.row, isCompactLayout ? { flexDirection: 'column', gap: 6 } : null]}>
        <Pressable
          onPress={() => {
            setDriverSearch('');
            setDriverModalOpen(true);
          }}
          style={[
            styles.selectorButton,
            styles.selectorHalf,
            isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
          ]}
        >
          <Text style={[styles.selectorLabel, { color: theme.subtext }]}>{personnelLabel} (Required)</Text>
          <Text style={[styles.selectorValue, isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]} numberOfLines={1}>
            {selectedDriver?.label ?? `Select ${personnelLabel.toLowerCase()}`}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setHelperSearch('');
            setHelperModalOpen(true);
          }}
          style={[
            styles.selectorButton,
            styles.selectorHalf,
            isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
          ]}
        >
          <Text style={[styles.selectorLabel, { color: theme.subtext }]}>Helper (Optional)</Text>
          <Text style={[styles.selectorValue, isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]} numberOfLines={1}>
            {selectedHelper?.label ?? 'Select helper'}
          </Text>
        </Pressable>
      </View>

      <View ref={tutorialItemSelector.ref} onLayout={tutorialItemSelector.onLayout}>
        <Pressable
          onPress={() => {
            setItemSearch('');
            setItemCategoryFilter('ALL');
            setItemModalOpen(true);
          }}
          style={[
            styles.selectorButton,
            isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
            tutorialItemSelector.active ? styles.tutorialTargetFocus : null
          ]}
        >
          <Text style={[styles.selectorLabel, { color: theme.subtext }]}>Items</Text>
          <Text style={[styles.selectorValue, { color: theme.inputText }]}>Tap to add item ({cart.length} in cart)</Text>
        </Pressable>
      </View>
      <Text style={[styles.sub, { color: theme.subtext }]}>
        Default LPG flow for new item:{' '}
        {defaultLpgFlowForNewItem === 'NONE'
          ? 'Require per item'
          : defaultLpgFlowForNewItem === 'REFILL_EXCHANGE'
            ? 'Refill Exchange'
            : 'Non-Refill'}
      </Text>

      <View style={[styles.block, { borderColor: theme.cardBorder }]}>
        <Text style={[styles.blockTitle, { color: theme.heading }]}>Cart</Text>
        {cart.length === 0 ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>No items added yet.</Text>
        ) : (
          cart.map((line) => (
            <SwipeToDeleteRow
              key={line.lineId}
              theme={theme}
              onDelete={() => updateQty(line.lineId, 0)}
              disabled={saving || syncBusy}
              deleteLabel="Remove"
            >
              <View style={[styles.cartRow, isCompactLayout ? { alignItems: 'flex-start' } : null]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cartName, { color: theme.heading }]}>{line.name}</Text>
                  <Text style={[styles.cartCode, { color: theme.subtext }]}>{line.subtitle ?? line.id}</Text>
                  {line.isLpg ? (
                    <View style={[styles.row, isCompactLayout ? { flexWrap: 'wrap', gap: 6 } : null]}>
                      {([
                        { value: 'REFILL_EXCHANGE', label: 'Refill' },
                        { value: 'NON_REFILL', label: 'Non-Refill' }
                      ] as const).map((flow) => {
                        const selected = line.cylinderFlow === flow.value;
                        return (
                          <Pressable
                            key={`${line.lineId}-${flow.value}`}
                            onPress={() => setLineCylinderFlow(line.lineId, flow.value)}
                            style={[
                              styles.flowChip,
                              isCompactLayout ? { minHeight: 22, marginTop: 4, paddingHorizontal: 9 } : null,
                              { backgroundColor: selected ? theme.primary : theme.pillBg }
                            ]}
                          >
                            <Text style={[styles.flowChipText, { color: selected ? '#FFFFFF' : theme.pillText }]}>
                              {flow.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  {line.isLpg && !line.cylinderFlow ? (
                    <Text style={[styles.cartCode, { color: '#B45309' }]}>Select flow to apply exact LPG price.</Text>
                  ) : null}
                  <Text style={[styles.cartPrice, { color: theme.subtext }]}>PHP {line.unitPrice.toFixed(2)} each</Text>
                </View>
                <View style={[styles.cartRightRail, isCompactLayout ? { minWidth: 88 } : null]}>
                  <Text
                    style={[
                      styles.cartLineTotal,
                      isCompactLayout ? { minWidth: 0, textAlign: 'right' } : null,
                      { color: theme.heading }
                    ]}
                  >
                    PHP {(line.unitPrice * line.quantity).toFixed(2)}
                  </Text>
                  <View style={styles.qtyWrap}>
                    <Pressable style={[styles.qtyBtn, { backgroundColor: theme.pillBg }]} onPress={() => updateQty(line.lineId, line.quantity - 1)}>
                      <Text style={[styles.qtyText, { color: theme.pillText }]}>-</Text>
                    </Pressable>
                    <Text style={[styles.qtyValue, { color: theme.heading }]}>{line.quantity}</Text>
                    <Pressable style={[styles.qtyBtn, { backgroundColor: theme.pillBg }]} onPress={() => updateQty(line.lineId, line.quantity + 1)}>
                      <Text style={[styles.qtyText, { color: theme.pillText }]}>+</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </SwipeToDeleteRow>
          ))
        )}
      </View>

      <View style={[styles.summary, { borderColor: theme.cardBorder }]}>
        <Text style={[styles.summaryText, { color: theme.subtext }]}>Order Type: {orderType}</Text>
        <Text style={[styles.summaryText, { color: theme.subtext }]}>
          LPG Mix: Refill {lpgFlowSummary.refill} | Non-Refill {lpgFlowSummary.nonRefill}
        </Text>
        <Text style={[styles.summaryText, { color: theme.subtext }]}>Customer: {selectedCustomer?.label ?? '-'}</Text>
        <Text style={[styles.summaryText, { color: theme.subtext }]}>{personnelLabel}: {selectedDriver?.label ?? '-'}</Text>
        <Text style={[styles.summaryText, { color: theme.subtext }]}>Helper: {selectedHelper?.label ?? '-'}</Text>
        <Text style={[styles.summaryText, { color: theme.subtext }]}>Items: {cart.length}</Text>
        <Text style={[styles.summaryText, { color: theme.subtext }]}>Subtotal: PHP {subtotal.toFixed(2)}</Text>
        <Text style={[styles.summaryText, { color: theme.subtext }]}>Discount: PHP {discountValue.toFixed(2)}</Text>
        <Text style={[styles.summaryTotal, { color: theme.heading }]}>Total: PHP {total.toFixed(2)}</Text>
      </View>

      {!showPaymentStep ? (
        <View ref={tutorialProceedPayment.ref} onLayout={tutorialProceedPayment.onLayout}>
          <Pressable
            style={[
              styles.checkoutBtn,
              { backgroundColor: canProceedToPayment && Boolean(activeShiftId) ? theme.primary : theme.primaryMuted },
              tutorialProceedPayment.active ? styles.tutorialTargetFocus : null
            ]}
            onPress={() => void handleProceedToPayment()}
            disabled={!canProceedToPayment || saving || syncBusy || !activeShiftId}
          >
            <Text style={styles.checkoutText}>Proceed to Payment</Text>
          </Pressable>
        </View>
      ) : null}

      <PickerModal
        visible={customerModalOpen}
        title="Select Customer"
        options={customers}
        value={customerId}
        search={customerSearch}
        onSearch={setCustomerSearch}
        onClose={() => setCustomerModalOpen(false)}
        onSelect={setCustomerId}
        theme={theme}
      />

      <PickerModal
        visible={driverModalOpen}
        title={`Select ${personnelLabel}`}
        options={personnelChoicesForDriver}
        value={driverId}
        search={driverSearch}
        onSearch={setDriverSearch}
        onClose={() => setDriverModalOpen(false)}
        onSelect={setDriverId}
        theme={theme}
      />

      <PickerModal
        visible={helperModalOpen}
        title="Select Helper"
        options={personnelChoicesForHelper}
        value={helperId}
        optional
        search={helperSearch}
        onSearch={setHelperSearch}
        onClose={() => setHelperModalOpen(false)}
        onSelect={setHelperId}
        theme={theme}
      />

      <Modal visible={itemModalOpen} transparent animationType="fade" onRequestClose={() => setItemModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setItemModalOpen(false)} />
          <View
            style={[
              styles.itemSelectModalCard,
              isCompactLayout ? { minHeight: '86%', maxHeight: '96%', paddingHorizontal: 10, paddingVertical: 10, gap: 8 } : null,
              { backgroundColor: theme.card, borderColor: theme.cardBorder }
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.heading }]}>Select Item</Text>
            <TextInput
              value={itemSearch}
              onChangeText={setItemSearch}
              placeholder="Search item code or name"
              placeholderTextColor={theme.inputPlaceholder}
              style={[styles.modalSearch, { backgroundColor: theme.inputBg, color: theme.inputText }]}
            />
            <View style={[styles.itemCategoryWrap, isCompactLayout ? { height: 38 } : null]}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.itemCategoryRow}
                style={styles.itemCategoryScroll}
              >
                <Pressable
                  onPress={() => setItemCategoryFilter('ALL')}
                  style={[
                    styles.itemCategoryChip,
                    isCompactLayout ? { height: 28, maxWidth: 150, paddingHorizontal: 10 } : null,
                    { backgroundColor: itemCategoryFilter === 'ALL' ? theme.primary : theme.pillBg }
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    ellipsizeMode='tail'
                    style={[
                      styles.itemCategoryChipText,
                      isCompactLayout ? { maxWidth: 130, fontSize: 10 } : null,
                      { color: itemCategoryFilter === 'ALL' ? '#FFFFFF' : theme.pillText }
                    ]}
                  >
                    All Categories
                  </Text>
                </Pressable>
                {itemCategoryOptions.map((category) => {
                  const selected = itemCategoryFilter === category;
                  return (
                    <Pressable
                      key={category}
                      onPress={() => setItemCategoryFilter(category)}
                      style={[
                        styles.itemCategoryChip,
                        isCompactLayout ? { height: 28, maxWidth: 150, paddingHorizontal: 10 } : null,
                        { backgroundColor: selected ? theme.primary : theme.pillBg }
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        ellipsizeMode='tail'
                        style={[
                          styles.itemCategoryChipText,
                          isCompactLayout ? { maxWidth: 130, fontSize: 10 } : null,
                          { color: selected ? '#FFFFFF' : theme.pillText }
                        ]}
                      >
                        {category}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <ScrollView
              style={styles.itemSelectList}
              contentContainerStyle={styles.itemSelectListContent}
              keyboardShouldPersistTaps="handled"
            >
              {filteredCatalog.length === 0 ? (
                <Text style={[styles.modalEmpty, { color: theme.subtext }]}>No matching items.</Text>
              ) : (
                filteredCatalog.map((product) => {
                  const flowPrice = itemFlowPrices.get(product.id) ?? { refill: null, nonRefill: null };
                  const outOfStock = isItemOutOfStock(product);
                  return (
                    <Pressable
                      key={product.id}
                      onPress={() => {
                        if (outOfStock) {
                          toastError('No stock', `${product.name} has no available stock.`);
                          return;
                        }
                        addToCart(product);
                        setItemModalOpen(false);
                      }}
                      disabled={outOfStock}
                      style={[
                        styles.itemSelectCard,
                        isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 10, gap: 6 } : null,
                        outOfStock ? styles.itemSelectCardDisabled : null,
                        { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
                      ]}
                    >
                    {outOfStock ? (
                      <>
                        <View style={styles.noStockBadge}>
                          <Text style={styles.noStockBadgeText}>NO STOCK</Text>
                        </View>
                        <Text style={styles.noStockWatermark}>NO STOCK</Text>
                      </>
                    ) : null}
                    <View style={styles.itemSelectCardHead}>
                      <View style={styles.itemSelectCardTitleWrap}>
                        <Text style={[styles.itemSelectCardTitle, { color: theme.heading }]}>{product.name}</Text>
                        <Text style={[styles.itemSelectCardSub, { color: theme.subtext }]}>
                          {product.subtitle ?? product.id}
                        </Text>
                      </View>
                      <View style={[styles.itemSelectPricePill, isCompactLayout ? { paddingHorizontal: 8, paddingVertical: 4 } : null, { backgroundColor: theme.pillBg }]}>
                        <Text style={[styles.itemSelectPriceText, { color: theme.pillText }]}>
                          PHP {product.unitPrice.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                    {product.isLpg ? (
                      <View style={[styles.itemFlowPriceRow, isCompactLayout ? { flexDirection: 'column', alignItems: 'flex-start', gap: 2 } : null]}>
                        <Text style={[styles.itemFlowPriceText, { color: theme.subtext }]}>
                          Refill: {flowPrice.refill !== null ? `PHP ${flowPrice.refill.toFixed(2)}` : '-'}
                        </Text>
                        <Text style={[styles.itemFlowPriceText, { color: theme.subtext }]}>
                          Non-Refill: {flowPrice.nonRefill !== null ? `PHP ${flowPrice.nonRefill.toFixed(2)}` : '-'}
                        </Text>
                      </View>
                    ) : null}
                    {product.category ? (
                      <Text style={[styles.itemSelectCardMeta, { color: theme.subtext }]}>Category: {product.category}</Text>
                    ) : null}
                    <View style={[styles.itemStockMetrics, isCompactLayout ? { flexWrap: 'wrap', gap: 6 } : null]}>
                      <View style={[styles.itemStockChip, isCompactLayout ? { minWidth: '31%', flexBasis: '31%' } : null, { backgroundColor: theme.pillBg }]}>
                        <Text style={[styles.itemStockChipLabel, { color: theme.subtext }]}>FULL</Text>
                        <Text style={[styles.itemStockChipValue, { color: theme.heading }]}>{formatQty(product.qtyFull)}</Text>
                      </View>
                      <View style={[styles.itemStockChip, isCompactLayout ? { minWidth: '31%', flexBasis: '31%' } : null, { backgroundColor: theme.pillBg }]}>
                        <Text style={[styles.itemStockChipLabel, { color: theme.subtext }]}>EMPTY</Text>
                        <Text style={[styles.itemStockChipValue, { color: theme.heading }]}>{formatQty(product.qtyEmpty)}</Text>
                      </View>
                      <View style={[styles.itemStockChip, isCompactLayout ? { minWidth: '31%', flexBasis: '31%' } : null, { backgroundColor: theme.pillBg }]}>
                        <Text style={[styles.itemStockChipLabel, { color: theme.subtext }]}>QOH</Text>
                        <Text style={[styles.itemStockChipValue, { color: theme.heading }]}>{formatQty(product.qtyOnHand)}</Text>
                      </View>
                    </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Pressable onPress={() => setItemModalOpen(false)} style={[styles.modalClose, { backgroundColor: theme.pillBg }]}>
              <Text style={[styles.modalCloseText, { color: theme.pillText }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showPaymentStep}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!saving) {
            setShowPaymentStep(false);
          }
        }}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => {
              if (!saving) {
                setShowPaymentStep(false);
              }
            }}
          />
          <View
            style={[
              styles.modalCard,
              styles.paymentModalCard,
              isCompactLayout ? { height: '88%', maxHeight: '92%', paddingHorizontal: 10, paddingVertical: 10, gap: 8 } : null,
              { backgroundColor: theme.card, borderColor: theme.cardBorder }
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.heading }]}>Payment Details</Text>
            <Text style={[styles.paymentHint, isCompactLayout ? { fontSize: 11 } : null, { color: theme.subtext }]}>
              {paymentMode === 'FULL'
                ? 'Full payment: amount tendered can be equal or higher than total (change is auto-calculated).'
                : 'Partial payment: collect any amount from 0 up to less than total; remaining becomes customer credit.'}
            </Text>

            <ScrollView style={styles.paymentModalBody} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
              <View style={[styles.summary, { borderColor: theme.cardBorder }]}>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Order Type: {orderType}</Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>
                  LPG Mix: Refill {lpgFlowSummary.refill} | Non-Refill {lpgFlowSummary.nonRefill}
                </Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Customer: {selectedCustomer?.label ?? '-'}</Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>
                  Customer Current Balance: PHP {selectedCustomerOutstanding.toFixed(2)}
                </Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>{personnelLabel}: {selectedDriver?.label ?? '-'}</Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Helper: {selectedHelper?.label ?? '-'}</Text>
              </View>

              <View style={[styles.summary, { borderColor: theme.cardBorder }]}>
                <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Reward Redemption</Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>
                  Available points: {currentPointsBalance}
                </Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>
                  Pick one reward to reserve/apply during checkout. Discount fields can still be adjusted before saving.
                </Text>
                {rewardsLoading ? (
                  <Text style={[styles.summaryText, { color: theme.subtext }]}>Loading rewards...</Text>
                ) : rewardEligibleOptions.length === 0 ? (
                  <Text style={[styles.summaryText, { color: theme.subtext }]}>No active checkout rewards available for this customer/branch.</Text>
                ) : (
                  <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
                    {rewardEligibleOptions.map((reward) => {
                      const active = reward.id === selectedRewardId;
                      return (
                        <Pressable
                          key={reward.id}
                          style={[
                            styles.methodPill,
                            { flexBasis: '48%', backgroundColor: active ? theme.primary : theme.pillBg }
                          ]}
                          onPress={() => handleSelectReward(reward)}
                          disabled={saving}
                        >
                          <Text style={{ color: active ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: 11 }}>
                            {reward.name}
                          </Text>
                          <Text style={{ color: active ? '#FFFFFF' : theme.pillText, fontSize: 10 }}>
                            {reward.points_cost} pts
                            {reward.reward_type === 'FREE_PRODUCT' || reward.reward_type === 'FREE_REFILL'
                              ? ` | Save PHP ${resolveRewardCartDiscount(reward, cart).toFixed(2)}`
                              : reward.discount_value !== null
                                ? ` | ${reward.reward_type === 'DISCOUNT_PERCENT' ? `${reward.discount_value}%` : `PHP ${reward.discount_value.toFixed(2)}`}`
                                : ''}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {selectedReward ? (
                      <Pressable
                        style={[styles.methodPill, { flexBasis: '48%', backgroundColor: theme.pillBg }]}
                        onPress={() => setSelectedRewardId('')}
                        disabled={saving}
                      >
                        <Text style={{ color: theme.pillText, fontWeight: '700', fontSize: 11 }}>Clear Reward</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>

              <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Payment Type</Text>
              <View style={[styles.row, isCompactLayout ? { gap: 6 } : null]}>
                {(['FULL', 'PARTIAL'] as const).map((mode) => {
                  const selected = paymentMode === mode;
                  return (
                    <Pressable
                      key={mode}
                      style={[
                        styles.methodPill,
                        isCompactLayout ? { minHeight: 36 } : null,
                        {
                          backgroundColor: selected ? theme.primary : theme.pillBg
                        }
                      ]}
                      onPress={() => {
                        setPaymentMode(mode);
                        if (mode === 'FULL') {
                          setPaidAmount(total.toFixed(2));
                        }
                      }}
                      disabled={saving}
                    >
                      <Text style={{ color: selected ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: isCompactLayout ? 11 : 12 }}>
                        {mode}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Payment Method</Text>
              <View style={[styles.row, isCompactLayout ? { flexWrap: 'wrap', gap: 6 } : null]}>
                {(['CASH', 'CARD', 'E_WALLET'] as const).map((method) => {
                  const selected = method === paymentMethod;
                  return (
                    <Pressable
                      key={method}
                      style={[
                        styles.methodPill,
                        isCompactLayout ? { flex: 0, width: '32%', minHeight: 36 } : null,
                        {
                          backgroundColor: selected ? theme.primary : theme.pillBg
                        }
                      ]}
                      onPress={() => setPaymentMethod(method)}
                      disabled={saving}
                    >
                      <Text style={{ color: selected ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: isCompactLayout ? 10 : 12 }}>
                        {method}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Discount Amount</Text>
              <TextInput
                value={discount}
                onChangeText={setDiscount}
                keyboardType="numeric"
                editable={canProceedToPayment && !saving}
                placeholder="0.00"
                placeholderTextColor={theme.inputPlaceholder}
                style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
              />

              {orderType === 'DELIVERY' ? (
                <>
                  <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Delivery Fee</Text>
                  <TextInput
                    value={deliveryFee}
                    onChangeText={setDeliveryFee}
                    keyboardType="numeric"
                    editable={canProceedToPayment && !saving}
                    placeholder="0.00"
                    placeholderTextColor={theme.inputPlaceholder}
                    style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
                  />
                </>
              ) : null}

              <Text style={[styles.fieldLabel, { color: theme.subtext }]}>
                {paymentMode === 'FULL' ? 'Amount Tendered' : 'Amount Collected'}
              </Text>
              <TextInput
                value={paidAmount}
                onChangeText={setPaidAmount}
                keyboardType="numeric"
                editable={canProceedToPayment && !saving}
                placeholder="0.00"
                placeholderTextColor={theme.inputPlaceholder}
                style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
              />

              <View style={[styles.paymentKpiRow, isCompactLayout ? { flexDirection: 'column', gap: 6 } : null]}>
                <View style={[styles.paymentKpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.paymentKpiLabel, { color: theme.subtext }]}>Total</Text>
                  <Text style={[styles.paymentKpiValue, { color: theme.heading }]}>PHP {total.toFixed(2)}</Text>
                </View>
                <View style={[styles.paymentKpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.paymentKpiLabel, { color: theme.subtext }]}>Paid</Text>
                  <Text style={[styles.paymentKpiValue, { color: theme.heading }]}>PHP {parsedPaidAmount.toFixed(2)}</Text>
                </View>
              </View>

              <View style={[styles.paymentKpiRow, isCompactLayout ? { flexDirection: 'column', gap: 6 } : null]}>
                <View style={[styles.paymentKpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.paymentKpiLabel, { color: theme.subtext }]}>Change</Text>
                  <Text style={[styles.paymentKpiValue, { color: theme.heading }]}>PHP {changeAmount.toFixed(2)}</Text>
                </View>
                <View style={[styles.paymentKpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.paymentKpiLabel, { color: theme.subtext }]}>Credit Due</Text>
                  <Text style={[styles.paymentKpiValue, { color: theme.heading }]}>PHP {creditBalance.toFixed(2)}</Text>
                </View>
              </View>

              <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Notes (Optional)</Text>
              <TextInput
                value={paymentNotes}
                onChangeText={setPaymentNotes}
                editable={canProceedToPayment && !saving}
                placeholder={
                  paymentMode === 'PARTIAL'
                    ? 'Credit notes / terms (optional)'
                    : 'Reference or cashier note (optional)'
                }
                placeholderTextColor={theme.inputPlaceholder}
                style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
              />

              <View style={[styles.summary, { borderColor: theme.cardBorder }]}>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Items: {cart.length}</Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Subtotal: PHP {subtotal.toFixed(2)}</Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Discount: PHP {discountValue.toFixed(2)}</Text>
                {orderType === 'DELIVERY' ? (
                  <Text style={[styles.summaryText, { color: theme.subtext }]}>Delivery Fee: PHP {deliveryFeeValue.toFixed(2)}</Text>
                ) : null}
                {selectedReward ? (
                  <Text style={[styles.summaryText, { color: theme.subtext }]}>
                    Reward: {selectedReward.name} ({selectedReward.points_cost} pts)
                  </Text>
                ) : null}
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Applied Payment: PHP {appliedPaidAmount.toFixed(2)}</Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Credit Due: PHP {creditBalance.toFixed(2)}</Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Mode: {paymentMode}</Text>
              </View>
            </ScrollView>

            <View style={[styles.paymentModalActions, isCompactLayout ? { flexDirection: 'column', gap: 6 } : null]}>
              <Pressable
                onPress={() => setShowPaymentStep(false)}
                disabled={saving}
                style={[styles.modalSecondaryBtn, { backgroundColor: saving ? theme.primaryMuted : theme.pillBg }]}
              >
                <Text style={[styles.modalSecondaryText, { color: saving ? '#FFFFFF' : theme.pillText }]}>Back</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalPrimaryBtn,
                  isCompactLayout ? { width: '100%' } : null,
                  { backgroundColor: saving || !paymentReady ? theme.primaryMuted : theme.primary }
                ]}
                onPress={promptQueueSale}
                disabled={saving || syncBusy || !paymentReady}
              >
                <Text style={styles.modalPrimaryText}>{saving ? 'Saving Sale...' : 'Complete Sale'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(postSaleLending)}
        transparent
        animationType="slide"
        onRequestClose={closePostSaleLendingModal}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closePostSaleLendingModal} />
          <View
            style={[
              styles.modalCard,
              styles.paymentModalCard,
              isCompactLayout ? { height: '90%', maxHeight: '94%', paddingHorizontal: 10, paddingVertical: 10, gap: 8 } : null,
              { backgroundColor: theme.card, borderColor: theme.cardBorder }
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.heading }]}>Post-Sale Lending</Text>
            <Text style={[styles.paymentHint, isCompactLayout ? { fontSize: 11 } : null, { color: theme.subtext }]}>
              Select returnable items to lend out for this completed sale. Inventory will be deducted immediately.
            </Text>

            {postSaleLending ? (
              <>
                <View style={[styles.summary, { borderColor: theme.cardBorder }]}>
                  <Text style={[styles.summaryText, { color: theme.subtext }]}>Sale: {postSaleLending.saleId}</Text>
                  <Text style={[styles.summaryText, { color: theme.subtext }]}>Customer: {postSaleLending.customerName ?? postSaleLending.customerId}</Text>
                  <Text style={[styles.summaryText, { color: theme.subtext }]}>Branch: {postSaleLending.branchName}</Text>
                  <Text style={[styles.summaryText, { color: theme.subtext }]}>Location: {postSaleLending.locationName}</Text>
                </View>

                <ScrollView style={styles.paymentModalBody} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
                  {postSaleLending.products.map((product) => (
                    <View
                      key={product.product_id}
                      style={[styles.lendingProductCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                    >
                      <Text style={[styles.cartName, { color: theme.heading }]}>{product.name}</Text>
                      <Text style={[styles.summaryText, { color: theme.subtext }]}>
                        {product.sku} | Available {product.available_qty.toFixed(4)} {product.lending_unit_type ?? product.unit}
                      </Text>
                      {product.requires_deposit || product.default_deposit_amount !== null ? (
                        <Text style={[styles.summaryText, { color: theme.subtext }]}>
                          Deposit {product.default_deposit_amount !== null ? `default PHP ${product.default_deposit_amount.toFixed(2)}` : 'required'}
                        </Text>
                      ) : null}

                      <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Quantity To Lend</Text>
                      <TextInput
                        value={lendingQtyByProduct[product.product_id] ?? ''}
                        onChangeText={(value) =>
                          setLendingQtyByProduct((prev) => ({ ...prev, [product.product_id]: value }))
                        }
                        keyboardType="numeric"
                        placeholder="0"
                        placeholderTextColor={theme.inputPlaceholder}
                        style={[styles.input, { backgroundColor: theme.card, color: theme.inputText }]}
                      />

                      {product.requires_deposit || product.default_deposit_amount !== null ? (
                        <>
                          <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Deposit Amount</Text>
                          <TextInput
                            value={lendingDepositByProduct[product.product_id] ?? ''}
                            onChangeText={(value) =>
                              setLendingDepositByProduct((prev) => ({ ...prev, [product.product_id]: value }))
                            }
                            keyboardType="numeric"
                            placeholder="0.00"
                            placeholderTextColor={theme.inputPlaceholder}
                            style={[styles.input, { backgroundColor: theme.card, color: theme.inputText }]}
                          />
                        </>
                      ) : null}
                    </View>
                  ))}

                  <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Remarks (Optional)</Text>
                  <TextInput
                    value={lendingRemarks}
                    onChangeText={setLendingRemarks}
                    placeholder="Reason or reminder for this lending"
                    placeholderTextColor={theme.inputPlaceholder}
                    style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
                  />
                </ScrollView>

                <View style={[styles.paymentModalActions, isCompactLayout ? { flexDirection: 'column', gap: 6 } : null]}>
                  <Pressable
                    onPress={closePostSaleLendingModal}
                    disabled={lendingSaving}
                    style={[styles.modalSecondaryBtn, { backgroundColor: lendingSaving ? theme.primaryMuted : theme.pillBg }]}
                  >
                    <Text style={[styles.modalSecondaryText, { color: lendingSaving ? '#FFFFFF' : theme.pillText }]}>Skip</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.modalPrimaryBtn,
                      isCompactLayout ? { width: '100%' } : null,
                      { backgroundColor: lendingSaving ? theme.primaryMuted : theme.primary }
                    ]}
                    onPress={() => void savePostSaleLending()}
                    disabled={lendingSaving}
                  >
                    <Text style={styles.modalPrimaryText}>{lendingSaving ? 'Saving Lending...' : 'Save Lending'}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10
  },
  header: {
    gap: 2
  },
  title: {
    fontSize: 18,
    fontWeight: '700'
  },
  sub: {
    fontSize: 13
  },
  contextBar: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  shiftGuardBar: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  shiftGuardTitle: {
    fontSize: 12,
    fontWeight: '800'
  },
  shiftGuardSub: {
    fontSize: 11
  },
  shiftGuardAction: {
    alignSelf: 'flex-start',
    marginTop: 6,
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  shiftGuardActionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800'
  },
  contextText: {
    fontSize: 12,
    fontWeight: '600'
  },
  row: {
    flexDirection: 'row',
    gap: 8
  },
  modePill: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center'
  },
  selectorButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 2
  },
  selectorHalf: {
    flex: 1
  },
  selectorLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  selectorValue: {
    fontSize: 14,
    fontWeight: '700'
  },
  selectorMeta: {
    fontSize: 11,
    marginTop: 2
  },
  block: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '700'
  },
  paymentHint: {
    fontSize: 12
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700'
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  cartName: {
    fontSize: 13,
    fontWeight: '700'
  },
  cartCode: {
    fontSize: 11,
    marginTop: 1
  },
  cartPrice: {
    fontSize: 11,
    marginTop: 1
  },
  flowChip: {
    marginTop: 6,
    minHeight: 24,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  flowChipText: {
    fontSize: 10,
    fontWeight: '800'
  },
  cartLineTotal: {
    minWidth: 88,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '700'
  },
  cartRightRail: {
    alignItems: 'flex-end',
    gap: 6
  },
  qtyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center'
  },
  qtyText: {
    fontSize: 16,
    fontWeight: '700'
  },
  qtyValue: {
    minWidth: 22,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700'
  },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14
  },
  methodPill: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center'
  },
  summary: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2
  },
  summaryText: {
    fontSize: 12
  },
  summaryTotal: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '800'
  },
  paymentKpiRow: {
    flexDirection: 'row',
    gap: 8
  },
  paymentKpiCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 2
  },
  paymentKpiLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  paymentKpiValue: {
    fontSize: 14,
    fontWeight: '800'
  },
  checkoutBtn: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkoutText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800'
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
    paddingTop: 12,
    justifyContent: 'flex-end'
  },
  modalCard: {
    borderWidth: 1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '90%',
    minHeight: '72%',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10
  },
  paymentModalCard: {
    height: '80%',
    maxHeight: '80%'
  },
  itemSelectModalCard: {
    borderWidth: 1,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    width: '100%',
    maxHeight: '94%',
    minHeight: '80%',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800'
  },
  modalSearch: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14
  },
  itemCategoryWrap: {
    height: 42,
  },
  itemCategoryScroll: {
    flexGrow: 0,
  },
  itemCategoryRow: {
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingRight: 8
  },
  itemCategoryChip: {
    height: 30,
    maxWidth: 180,
    borderRadius: 999,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center'
  },
  itemCategoryChipText: {
    maxWidth: 158,
    fontSize: 11,
    fontWeight: '700'
  },
  modalList: {
    maxHeight: 360
  },
  itemSelectList: {
    flex: 1
  },
  itemSelectListContent: {
    gap: 10,
    paddingBottom: 8
  },
  modalRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 1
  },
  itemSelectCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    overflow: 'hidden'
  },
  itemSelectCardDisabled: {
    opacity: 0.72
  },
  itemSelectCardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10
  },
  itemSelectCardTitleWrap: {
    flex: 1,
    gap: 2
  },
  itemSelectCardTitle: {
    fontSize: 15,
    fontWeight: '800'
  },
  itemSelectCardSub: {
    fontSize: 12
  },
  itemSelectPricePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  itemSelectPriceText: {
    fontSize: 12,
    fontWeight: '800'
  },
  noStockBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#B91C1C',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 3
  },
  noStockBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900'
  },
  noStockWatermark: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -58 }, { translateY: -10 }, { rotate: '-20deg' }],
    fontSize: 20,
    fontWeight: '900',
    color: 'rgba(185, 28, 28, 0.22)',
    zIndex: 1
  },
  itemSelectCardMeta: {
    fontSize: 12
  },
  itemFlowPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10
  },
  itemFlowPriceText: {
    fontSize: 11,
    fontWeight: '700'
  },
  itemStockMetrics: {
    flexDirection: 'row',
    gap: 8
  },
  itemStockChip: {
    flex: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 1
  },
  itemStockChipLabel: {
    fontSize: 10,
    fontWeight: '700'
  },
  itemStockChipValue: {
    fontSize: 13,
    fontWeight: '800'
  },
  modalRowTitle: {
    fontSize: 13,
    fontWeight: '700'
  },
  modalRowSub: {
    fontSize: 11
  },
  modalPrice: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '700'
  },
  modalEmpty: {
    fontSize: 12,
    paddingVertical: 12,
    textAlign: 'center'
  },
  modalClose: {
    minHeight: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalCloseText: {
    fontSize: 12,
    fontWeight: '700'
  },
  paymentModalBody: {
    flex: 1
  },
  paymentModalActions: {
    flexDirection: 'row',
    gap: 8
  },
  lendingProductCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 6
  },
  modalSecondaryBtn: {
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalSecondaryText: {
    fontSize: 13,
    fontWeight: '700'
  },
  modalPrimaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800'
  },
  tutorialTargetFocus: {
    borderWidth: 2,
    borderColor: '#F59E0B',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6
  }
});
