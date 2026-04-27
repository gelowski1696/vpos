import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  cylinderSizeLabel?: string | null;
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

type HeldCartLine = {
  lineId: string;
  productId: string;
  productName: string;
  subtitle?: string;
  quantity: number;
  unitPrice: number;
  cylinderFlow?: CylinderFlowSelection | null;
};

type HeldCartRecord = {
  id: string;
  label: string;
  customerId: string | null;
  customerName: string | null;
  driverId: string | null;
  driverName: string | null;
  helperId: string | null;
  helperName: string | null;
  saleType: 'PICKUP' | 'DELIVERY';
  paymentMode: 'FULL' | 'PARTIAL';
  paymentMethod: 'CASH' | 'CARD' | 'E_WALLET';
  paidAmount: number;
  discountAmount: number;
  deliveryFee: number;
  notes: string | null;
  lines: HeldCartLine[];
  createdAt: string;
  updatedAt: string;
};

type HeldCartDbRow = {
  record_id: string;
  payload: string;
  updated_at: string;
};

export type PosRecreateDraft = {
  requestId: string;
  sourceSaleId: string;
  branchId: string;
  locationId: string;
  customerId: string | null;
  saleType: 'PICKUP' | 'DELIVERY';
  paymentMode: 'FULL' | 'PARTIAL';
  paymentMethod: 'CASH' | 'CARD' | 'E_WALLET';
  discountAmount: number;
  creditNotes: string | null;
  driverId: string | null;
  helperId: string | null;
  lines: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    cylinderFlow?: CylinderFlowSelection | null;
  }>;
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

export type PosQueueOrderReceiptPayload = {
  queueId: string;
  queueLabel: string;
  branchId: string;
  branchName: string;
  locationId: string;
  locationName: string;
  cashierName: string | null;
  orderType: 'PICKUP' | 'DELIVERY';
  customerName: string | null;
  customerAddress?: string | null;
  personnelName: string | null;
  helperName: string | null;
  lines: Array<{ name: string; subtitle?: string; quantity: number; unitPrice: number }>;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  notes?: string | null;
  paymentMode: 'FULL' | 'PARTIAL';
  paymentMethod: 'CASH' | 'CARD' | 'E_WALLET';
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
  onPrintQueueOrderReceipt?: (payload: PosQueueOrderReceiptPayload) => Promise<PosQueuedSaleReceiptResult>;
  onGoToShift?: () => void;
  recreateDraft?: PosRecreateDraft | null;
  onConsumeRecreateDraft?: () => void;
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

function normalizeSearchTerm(value: string): string {
  return value.replace(/[%_]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
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

function parseCylinderSizeLabel(payload: Record<string, unknown>): string | null {
  const raw =
    asNumber(payload.sizeKg ?? payload.size_kg) ??
    asNumber(payload.size) ??
    asNumber(payload.cylinderSize ?? payload.cylinder_size);
  if (raw !== null && raw > 0) {
    return `${raw} kg`;
  }
  const text =
    asString(payload.sizeKg ?? payload.size_kg) ??
    asString(payload.size) ??
    asString(payload.cylinderSize ?? payload.cylinder_size);
  return text && text.trim().length > 0 ? text.trim() : null;
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
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  theme: AppTheme;
};

function PickerModal(props: PickerModalProps): JSX.Element {
  const filtered = useMemo(() => {
    const q = normalizeSearchTerm(props.search);
    if (!q) {
      return props.options.slice(0, 120);
    }
    return props.options.filter((option) => {
      const blob = `${option.label} ${option.subtitle ?? ''} ${option.address ?? ''} ${option.id}`.toLowerCase();
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
                    {option.address ? (
                      <Text style={[styles.modalRowSub, { color: props.theme.subtext }]} numberOfLines={2}>
                        {option.address}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={styles.modalFooterActions}>
            {props.onAction ? (
              <Pressable
                onPress={props.onAction}
                disabled={props.actionDisabled}
                style={[
                  styles.modalClose,
                  styles.modalActionButton,
                  { backgroundColor: props.actionDisabled ? props.theme.primaryMuted : props.theme.primary }
                ]}
              >
                <Text style={[styles.modalCloseText, { color: '#FFFFFF' }]}>{props.actionLabel ?? 'Add New'}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={props.onClose} style={[styles.modalClose, { backgroundColor: props.theme.pillBg }]}>
              <Text style={[styles.modalCloseText, { color: props.theme.pillText }]}>Close</Text>
            </Pressable>
          </View>
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
  onPrintQueueOrderReceipt,
  onGoToShift,
  recreateDraft = null,
  onConsumeRecreateDraft,
  syncBusy = false
}: Props): JSX.Element {
  const insets = useSafeAreaInsets();
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
  const [saving, setSaving] = useState(false);
  const [selectedCustomerOutstanding, setSelectedCustomerOutstanding] = useState(0);
  const prevSyncBusyRef = useRef(syncBusy);
  const lastAppliedRecreateDraftIdRef = useRef<string | null>(null);
  const activeRecreatedFromSaleIdRef = useRef<string | null>(null);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);

  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [createCustomerModalOpen, setCreateCustomerModalOpen] = useState(false);
  const [driverModalOpen, setDriverModalOpen] = useState(false);
  const [helperModalOpen, setHelperModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [queuePreviewOpen, setQueuePreviewOpen] = useState(false);
  const [heldCartModalOpen, setHeldCartModalOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [createCustomerName, setCreateCustomerName] = useState('');
  const [createCustomerAddress, setCreateCustomerAddress] = useState('');
  const [createCustomerCode, setCreateCustomerCode] = useState('');
  const [createCustomerContactNumber, setCreateCustomerContactNumber] = useState('');
  const [createCustomerGas, setCreateCustomerGas] = useState('');
  const [createCustomerProvince, setCreateCustomerProvince] = useState('');
  const [createCustomerCity, setCreateCustomerCity] = useState('');
  const [createCustomerSaving, setCreateCustomerSaving] = useState(false);
  const [driverSearch, setDriverSearch] = useState('');
  const [helperSearch, setHelperSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [heldCartSearch, setHeldCartSearch] = useState('');
  const [heldCarts, setHeldCarts] = useState<HeldCartRecord[]>([]);
  const [itemCategoryFilter, setItemCategoryFilter] = useState<string>('ALL');
  const offlineTransactions = useMemo(() => new OfflineTransactionService(db), [db]);

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
  const selectedCustomerAddress = useMemo(() => selectedCustomer?.address?.trim() ?? '', [selectedCustomer]);
  const selectedDriver = useMemo(() => personnels.find((option) => option.id === driverId), [personnels, driverId]);
  const selectedHelper = useMemo(() => personnels.find((option) => option.id === helperId), [personnels, helperId]);
  const personnelLabel = orderType === 'DELIVERY' ? 'Driver' : 'Personnel';
  const currentPointsBalance = customerProfile?.pointsBalance ?? 0;
  const isCustomerReady = customerId.trim().length > 0;

  const closeCreateCustomerModal = (force = false): void => {
    if (createCustomerSaving && !force) {
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
      toastError('Customer', 'Customer name is required.');
      return;
    }

    setCreateCustomerSaving(true);
    try {
      const createdId = await offlineTransactions.createOfflineCustomer({
        name,
        address: createCustomerAddress.trim() || undefined,
        code: createCustomerCode.trim() || undefined,
        contactNumber: createCustomerContactNumber.trim() || undefined,
        gas: createCustomerGas.trim() || undefined,
        province: createCustomerProvince.trim() || undefined,
        city: createCustomerCity.trim() || undefined
      });
      const customerOptions = await loadCustomerOptions(db);
      setCustomers(customerOptions);
      setCustomerId(createdId);
      setCustomerSearch('');
      await onDataChanged?.();
      toastSuccess('Customer saved locally', `${name} is ready for this sale and will sync later.`);
      closeCreateCustomerModal(true);
      setCustomerModalOpen(false);
    } catch (cause) {
      toastError('Customer save failed', cause instanceof Error ? cause.message : 'Unable to save customer locally.');
    } finally {
      setCreateCustomerSaving(false);
    }
  };
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
    const q = normalizeSearchTerm(itemSearch);
    return catalog
      .filter((item) => {
        if (itemCategoryFilter !== 'ALL' && (item.category?.trim() ?? '') !== itemCategoryFilter) {
          return false;
        }
        if (!q) {
          return true;
        }
        return `${item.name} ${item.subtitle ?? ''} ${item.id} ${item.category ?? ''} ${item.cylinderSizeLabel ?? ''}`.toLowerCase().includes(q);
      })
      .slice(0, 120);
  }, [catalog, itemSearch, itemCategoryFilter]);

  const filteredHeldCarts = useMemo(() => {
    const q = normalizeSearchTerm(heldCartSearch);
    if (!q) {
      return heldCarts;
    }
    return heldCarts.filter((held) => {
      const lineNames = held.lines.map((line) => line.productName).join(' ');
      const blob = `${held.label} ${held.customerName ?? ''} ${lineNames}`.toLowerCase();
      return blob.includes(q);
    });
  }, [heldCartSearch, heldCarts]);

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
    void refreshHeldCarts();
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
      void refreshHeldCarts();
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

  useEffect(() => {
    if (!recreateDraft || lastAppliedRecreateDraftIdRef.current === recreateDraft.requestId) {
      return;
    }

    const nextCart: CartLine[] = recreateDraft.lines.map((line) => {
      const product = catalog.find((entry) => entry.id === line.productId);
      return {
        ...(product ?? {
          id: line.productId,
          name: line.productId,
          unitPrice: line.unitPrice,
          subtitle: line.productId,
          isLpg: Boolean(line.cylinderFlow)
        }),
        lineId: `${line.productId}:${line.cylinderFlow ?? 'NA'}:${Date.now()}:${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        cylinderFlow: line.cylinderFlow ?? null
      };
    });

    setBranchId(recreateDraft.branchId);
    setLocationId(recreateDraft.locationId);
    setOrderType(recreateDraft.saleType);
    setCustomerId(recreateDraft.customerId ?? '');
    setDriverId(recreateDraft.driverId ?? '');
    setHelperId(recreateDraft.helperId ?? '');
    setCart(nextCart);
    setDiscount(recreateDraft.discountAmount.toFixed(2));
    setDeliveryFee('0.00');
    setPaymentMode(recreateDraft.paymentMode);
    setPaymentMethod(recreateDraft.paymentMethod);
    setPaidAmount('0');
    setPaymentNotes(recreateDraft.creditNotes ?? '');
    setSelectedRewardId('');
    setAvailableRewards([]);
    setShowPaymentStep(false);
    setCustomerModalOpen(false);
    setDriverModalOpen(false);
    setHelperModalOpen(false);
    setItemModalOpen(false);

    activeRecreatedFromSaleIdRef.current = recreateDraft.sourceSaleId;
    lastAppliedRecreateDraftIdRef.current = recreateDraft.requestId;
    onConsumeRecreateDraft?.();
    toastInfo('Sale recreated', 'Review the copied draft, then complete the corrected sale.');
  }, [catalog, onConsumeRecreateDraft, recreateDraft]);

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
    const [productRows, cylinderRows] = await Promise.all([
      db.getAllAsync<{ payload: string }>(
      `
      SELECT payload
      FROM master_data_local
      WHERE entity IN (?, ?)
      ORDER BY updated_at DESC
      `,
      'product',
      'products'
      ),
      db.getAllAsync<{ record_id: string; payload: string }>(
        `
        SELECT record_id, payload
        FROM master_data_local
        WHERE entity IN (?, ?, ?, ?)
        ORDER BY updated_at DESC
        `,
        'cylinder_type',
        'cylinder_types',
        'cylinder-type',
        'cylinder-types'
      )
    ]);

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
    const cylinderSizeById = new Map<string, string>();
    for (const row of cylinderRows) {
      const payload = parseRecord<Record<string, unknown>>(row.payload, {});
      const id = asString(payload.id) ?? asString(row.record_id);
      if (!id || cylinderSizeById.has(id)) {
        continue;
      }
      const sizeLabel = parseCylinderSizeLabel(payload);
      if (sizeLabel) {
        cylinderSizeById.set(id, sizeLabel);
      }
    }
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
      const cylinderTypeId = asString(payload.cylinderTypeId ?? payload.cylinder_type_id);

      const isLpg =
        payload.isLpg === true ||
        payload.is_lpg === true ||
        Boolean(cylinderTypeId);

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
        cylinderSizeLabel:
          parseCylinderSizeLabel(payload) ??
          (cylinderTypeId ? (cylinderSizeById.get(cylinderTypeId) ?? null) : null),
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

  const createHeldCartId = (): string =>
    `held-cart-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

  const buildHeldCartLabel = (): string => {
    if (selectedCustomer?.label?.trim()) {
      return `${selectedCustomer.label.trim()} ${new Date().toLocaleTimeString()}`;
    }
    return `Held Cart ${new Date().toLocaleTimeString()}`;
  };

  const queuePreviewLines = cart.slice(0, 12).map((line) => ({
    id: line.lineId,
    name: line.name,
    qty: Math.max(1, Math.trunc(line.quantity)),
    amount: round2(line.unitPrice * line.quantity),
    subtitle: line.subtitle
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
    notes,
    personnelName,
    helperName,
    lines
  }: {
    queueId: string;
    queueLabel: string;
    createdAt: string;
    customerName: string | null;
    customerAddress: string | null;
    saleType: 'PICKUP' | 'DELIVERY';
    paymentMode: 'FULL' | 'PARTIAL';
    paymentMethod: 'CASH' | 'CARD' | 'E_WALLET';
    paidAmount: number;
    discountAmount: number;
    deliveryFee: number;
    notes: string | null;
    personnelName: string | null;
    helperName: string | null;
    lines: Array<{ name: string; subtitle?: string; quantity: number; unitPrice: number }>;
  }): PosQueueOrderReceiptPayload => {
    const subtotalValue = round2(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
    const totalValue = round2(subtotalValue - queueDiscountAmount + queueDeliveryFee);
    return {
      queueId,
      queueLabel,
      branchId: branchId.trim(),
      branchName: branch?.label ?? branchId.trim(),
      locationId: locationId.trim(),
      locationName: location?.label ?? locationId.trim(),
      cashierName: cashierName?.trim() ? cashierName.trim() : null,
      orderType: saleType,
      customerName,
      customerAddress,
      personnelName,
      helperName,
      lines: lines.map((line) => ({
        name: line.name,
        subtitle: line.subtitle,
        quantity: Math.max(1, Math.trunc(line.quantity)),
        unitPrice: round2(line.unitPrice)
      })),
      subtotal: subtotalValue,
      discount: round2(queueDiscountAmount),
      total: totalValue,
      paidAmount: round2(queuePaidAmount),
      notes,
      paymentMode: queuePaymentMode,
      paymentMethod: queuePaymentMethod,
      createdAt
    };
  };

  const printQueueOrderReceipt = async (payload: PosQueueOrderReceiptPayload): Promise<void> => {
    if (!onPrintQueueOrderReceipt) {
      toastInfo('Queue print unavailable', 'Queue printing is not configured on this device.');
      return;
    }
    try {
      const result = await onPrintQueueOrderReceipt(payload);
      if (result.printed) {
        toastSuccess('Queue slip printed', result.receiptNumber ? `Slip #${result.receiptNumber}` : payload.queueLabel);
      } else if (result.message) {
        toastInfo('Queue slip not printed', result.message);
      }
    } catch (cause) {
      toastError('Queue slip failed', cause instanceof Error ? cause.message : 'Unable to print queue slip.');
    }
  };

  const refreshHeldCarts = async (): Promise<void> => {
    const rows = await db.getAllAsync<HeldCartDbRow>(
      `
      SELECT record_id, payload, updated_at
      FROM master_data_local
      WHERE entity = ?
      ORDER BY updated_at DESC
      `,
      'held_cart'
    );
    const next: HeldCartRecord[] = [];
    for (const row of rows) {
      const payload = parseRecord<Record<string, unknown>>(row.payload, {});
      const id = asString(payload.id) ?? row.record_id;
      const linesRaw = Array.isArray(payload.lines) ? payload.lines : [];
      const lines: HeldCartLine[] = [];
      for (const lineRow of linesRaw) {
        if (!lineRow || typeof lineRow !== 'object') {
          continue;
        }
        const line = lineRow as Record<string, unknown>;
        const productId = asString(line.productId ?? line.product_id);
        const productName = asString(line.productName ?? line.product_name);
        const quantity = asNumber(line.quantity) ?? 0;
        const unitPrice = asNumber(line.unitPrice ?? line.unit_price) ?? 0;
        if (!productId || !productName || quantity <= 0) {
          continue;
        }
        const cylinderFlowRaw = asString(line.cylinderFlow ?? line.cylinder_flow)?.toUpperCase();
        const cylinderFlow: CylinderFlowSelection | null =
          cylinderFlowRaw === 'REFILL_EXCHANGE' || cylinderFlowRaw === 'NON_REFILL' ? cylinderFlowRaw : null;
        lines.push({
          lineId: asString(line.lineId ?? line.line_id) ?? createLineId(productId, cylinderFlow),
          productId,
          productName,
          subtitle: asString(line.subtitle) ?? undefined,
          quantity: Math.max(1, Math.trunc(quantity)),
          unitPrice: round2(unitPrice),
          cylinderFlow
        });
      }
      if (!lines.length) {
        continue;
      }
      next.push({
        id,
        label: asString(payload.label) ?? `Held Cart ${new Date(row.updated_at).toLocaleTimeString()}`,
        customerId: asString(payload.customerId ?? payload.customer_id),
        customerName: asString(payload.customerName ?? payload.customer_name),
        driverId: asString(payload.driverId ?? payload.driver_id),
        driverName: asString(payload.driverName ?? payload.driver_name),
        helperId: asString(payload.helperId ?? payload.helper_id),
        helperName: asString(payload.helperName ?? payload.helper_name),
        saleType: asString(payload.saleType ?? payload.sale_type)?.toUpperCase() === 'DELIVERY' ? 'DELIVERY' : 'PICKUP',
        paymentMode: asString(payload.paymentMode ?? payload.payment_mode)?.toUpperCase() === 'PARTIAL' ? 'PARTIAL' : 'FULL',
        paymentMethod:
          asString(payload.paymentMethod ?? payload.payment_method)?.toUpperCase() === 'CARD'
            ? 'CARD'
            : asString(payload.paymentMethod ?? payload.payment_method)?.toUpperCase() === 'E_WALLET'
              ? 'E_WALLET'
              : 'CASH',
        paidAmount: round2(Math.max(0, asNumber(payload.paidAmount ?? payload.paid_amount) ?? 0)),
        discountAmount: round2(Math.max(0, asNumber(payload.discountAmount ?? payload.discount_amount) ?? 0)),
        deliveryFee: round2(Math.max(0, asNumber(payload.deliveryFee ?? payload.delivery_fee) ?? 0)),
        notes: asString(payload.notes),
        lines,
        createdAt: asString(payload.createdAt ?? payload.created_at) ?? row.updated_at,
        updatedAt: asString(payload.updatedAt ?? payload.updated_at) ?? row.updated_at
      });
    }
    next.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    setHeldCarts(next);
  };

  const clearCheckoutForm = (): void => {
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
    activeRecreatedFromSaleIdRef.current = null;
  };

  const holdCurrentCart = async (): Promise<void> => {
    if (!cart.length) {
      toastError('Hold cart', 'Add item(s) first before holding a cart.');
      return;
    }
    const now = new Date().toISOString();
    const record: HeldCartRecord = {
      id: createHeldCartId(),
      label: buildHeldCartLabel(),
      customerId: customerId.trim() || null,
      customerName: selectedCustomer?.label ?? null,
      driverId: driverId.trim() || null,
      driverName: selectedDriver?.label ?? null,
      helperId: helperId.trim() || null,
      helperName: selectedHelper?.label ?? null,
      saleType: orderType,
      paymentMode,
      paymentMethod,
      paidAmount: round2(parsedPaidAmount),
      discountAmount: round2(discountValue),
      deliveryFee: round2(deliveryFeeValue),
      notes: paymentNotes.trim() || null,
      lines: cart.map((line) => ({
        lineId: line.lineId,
        productId: line.id,
        productName: line.name,
        subtitle: line.subtitle,
        quantity: Math.max(1, Math.trunc(line.quantity)),
        unitPrice: round2(line.unitPrice),
        cylinderFlow: line.cylinderFlow ?? null
      })),
      createdAt: now,
      updatedAt: now
    };
    await db.runAsync(
      `
      INSERT OR REPLACE INTO master_data_local(entity, record_id, payload, updated_at)
      VALUES (?, ?, ?, ?)
      `,
      'held_cart',
      record.id,
      JSON.stringify(record),
      now
    );
    clearCheckoutForm();
    setQueuePreviewOpen(false);
    await refreshHeldCarts();
    toastSuccess('Queued order saved', `${record.label} was added to queue orders.`);
  };

  const promptHoldCurrentCart = (): void => {
    if (!hasCart || saving || syncBusy) {
      return;
    }
    setQueuePreviewOpen(true);
  };

  const removeHeldCart = async (heldId: string): Promise<void> => {
    await db.runAsync('DELETE FROM master_data_local WHERE entity = ? AND record_id = ?', 'held_cart', heldId);
    await refreshHeldCarts();
  };

  const recallHeldCart = async (held: HeldCartRecord): Promise<void> => {
    const nextCart: CartLine[] = held.lines.map((line) => {
      const product = catalog.find((entry) => entry.id === line.productId);
      return {
        ...(product ?? {
          id: line.productId,
          name: line.productName,
          subtitle: line.subtitle ?? line.productId,
          unitPrice: line.unitPrice,
          isLpg: Boolean(line.cylinderFlow)
        }),
        lineId: line.lineId || createLineId(line.productId, line.cylinderFlow ?? null),
        quantity: Math.max(1, Math.trunc(line.quantity)),
        unitPrice: line.unitPrice,
        cylinderFlow: line.cylinderFlow ?? null
      };
    });
    setCart(nextCart);
    setCustomerId(held.customerId ?? '');
    setDriverId(held.driverId ?? '');
    setHelperId(held.helperId ?? '');
    setOrderType(held.saleType);
    setPaymentMode(held.paymentMode ?? 'FULL');
    setPaymentMethod(held.paymentMethod ?? 'CASH');
    setPaidAmount(String(held.paidAmount ?? 0));
    setDiscount((held.discountAmount ?? 0).toFixed(2));
    setDeliveryFee((held.deliveryFee ?? 0).toFixed(2));
    setPaymentNotes(held.notes ?? '');
    setSelectedRewardId('');
    setAvailableRewards([]);
    setShowPaymentStep(false);
    setHeldCartModalOpen(false);
    await removeHeldCart(held.id);
    toastSuccess('Queue order loaded', `${held.label} was restored into POS.`);
  };

  const linkRecreatedSourceSaleLocally = async (sourceSaleId: string, recreatedSaleId: string): Promise<void> => {
    const row = await db.getFirstAsync<{ payload: string }>(
      'SELECT payload FROM sales_local WHERE id = ?',
      sourceSaleId
    );
    if (!row?.payload) {
      return;
    }
    const payload = parseRecord<Record<string, unknown>>(row.payload, {});
    const nextPayload = {
      ...payload,
      recreated_by_sale_id: recreatedSaleId
    };
    await db.runAsync(
      'UPDATE sales_local SET payload = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(nextPayload),
      new Date().toISOString(),
      sourceSaleId
    );
  };

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
    const nextQty = Math.trunc(quantity);
    if (!Number.isFinite(nextQty) || nextQty <= 0) {
      setCart((prev) => prev.filter((line) => line.lineId !== lineId));
      return;
    }
    let stockError: string | null = null;
    setCart((prev) => {
      const target = prev.find((line) => line.lineId === lineId);
      if (!target) {
        return prev;
      }
      if (nextQty <= target.quantity) {
        return prev.map((line) => (line.lineId === lineId ? { ...line, quantity: nextQty } : line));
      }
      const currentTotalQty = prev
        .filter((line) => line.id === target.id)
        .reduce((sum, line) => sum + line.quantity, 0);
      const nextTotalQty = round2(currentTotalQty - target.quantity + nextQty);
      stockError = validateProductQtyForCart(target, nextTotalQty);
      if (stockError) {
        return prev;
      }
      return prev.map((line) => (line.lineId === lineId ? { ...line, quantity: nextQty } : line));
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
    setPaidAmount('0');
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
        recreatedFromSaleId: activeRecreatedFromSaleIdRef.current,
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
          isLpg: line.isLpg === true,
          ...(line.isLpg && line.cylinderFlow ? { cylinderFlow: line.cylinderFlow } : {})
        })),
        payments: [{ method: paymentMethod, amount: appliedPaidAmount }]
      });

      if (activeRecreatedFromSaleIdRef.current) {
        await linkRecreatedSourceSaleLocally(activeRecreatedFromSaleIdRef.current, saleId);
      }

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

      clearCheckoutForm();
      await refreshCatalog();
      await onDataChanged?.();
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
      className="gap-2.5 rounded-2xl border px-3.5 py-3.5"
      style={[
        isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 10, gap: 8, borderRadius: 14 } : null,
        { backgroundColor: theme.card, borderColor: theme.cardBorder }
      ]}
    >
      <View className="flex-row justify-end">
        <Pressable
          className="relative min-h-9 flex-row items-center justify-center gap-2 rounded-full border px-3"
          style={{
            borderColor: theme.cardBorder,
            backgroundColor: theme.pillBg,
            opacity: heldCarts.length > 0 ? 1 : 0.55
          }}
          onPress={() => {
            setHeldCartSearch('');
            setHeldCartModalOpen(true);
          }}
          disabled={heldCarts.length === 0}
          accessibilityLabel="Queue Orders"
        >
          <Text className="text-sm font-extrabold" style={{ color: theme.pillText }}>{'\uD83D\uDCC2'}</Text>
          <Text className="text-[11px] font-bold" style={{ color: theme.pillText }}>
            Queue Orders
          </Text>
          {heldCarts.length > 0 ? (
            <View
              className="absolute -right-1 -top-1 min-h-[16px] min-w-[16px] items-center justify-center rounded-full px-1"
              style={{ backgroundColor: theme.primary }}
            >
              <Text className="text-[9px] font-extrabold text-white">
                {heldCarts.length > 99 ? '99+' : heldCarts.length}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <View
        className="gap-0.5 rounded-xl border px-2.5 py-2"
        style={[
          {
            borderColor: theme.cardBorder,
            backgroundColor: activeShiftId ? theme.inputBg : theme.pillBg
          }
        ]}
      >
        <Text className="text-xs font-extrabold" style={{ color: activeShiftId ? theme.heading : theme.pillText }}>
          {activeShiftId ? 'Duty Active' : 'Duty Required'}
        </Text>
        <Text className="text-[11px]" style={{ color: activeShiftId ? theme.subtext : theme.pillText }}>
          {activeShiftId
            ? `Shift ${activeShiftId} is active.`
            : 'Start Duty in Shift tab before proceeding to payment.'}
        </Text>
        {!activeShiftId ? (
          <Pressable
            className="mt-1.5 min-h-8 self-start items-center justify-center rounded-full px-3"
            style={{ backgroundColor: theme.primary }}
            onPress={onGoToShift}
            disabled={!onGoToShift}
          >
            <Text className="text-[11px] font-extrabold text-white">Go to Shift</Text>
          </Pressable>
        ) : null}
      </View>

      <View
        ref={tutorialOrderType.ref}
        onLayout={tutorialOrderType.onLayout}
        className="flex-row gap-2"
        style={isCompactLayout ? { gap: 6 } : null}
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
          className="rounded-xl border px-3 py-[11px]"
          style={[
            isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
            tutorialCustomer.active ? styles.tutorialTargetFocus : null
          ]}
        >
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Customer</Text>
          <Text className="text-sm font-bold" style={[isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]} numberOfLines={1}>
            {selectedCustomer?.label ?? 'Select customer'}
          </Text>
          {selectedCustomer ? (
            <Text className="mt-0.5 text-[11px]" style={{ color: theme.subtext }}>
              Points: {currentPointsBalance} | Balance: PHP {selectedCustomerOutstanding.toFixed(2)}
            </Text>
          ) : null}
          {selectedCustomerAddress ? (
            <Text className="mt-0.5 text-[11px]" style={{ color: theme.subtext }} numberOfLines={2}>
              {selectedCustomerAddress}
            </Text>
          ) : null}
        </Pressable>
      </View>

      <View className="flex-row gap-2" style={isCompactLayout ? { flexDirection: 'column', gap: 6 } : null}>
        <Pressable
          onPress={() => {
            setDriverSearch('');
            setDriverModalOpen(true);
          }}
          className="flex-1 rounded-xl border px-3 py-[11px]"
          style={[
            isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
          ]}
        >
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>{personnelLabel} (Required)</Text>
          <Text className="text-sm font-bold" style={[isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]} numberOfLines={1}>
            {selectedDriver?.label ?? `Select ${personnelLabel.toLowerCase()}`}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setHelperSearch('');
            setHelperModalOpen(true);
          }}
          className="flex-1 rounded-xl border px-3 py-[11px]"
          style={[
            isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }
          ]}
        >
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Helper (Optional)</Text>
          <Text className="text-sm font-bold" style={[isCompactLayout ? { fontSize: 13 } : null, { color: theme.inputText }]} numberOfLines={1}>
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
          className="rounded-xl border px-3 py-[11px]"
          style={[
            isCompactLayout ? { paddingHorizontal: 10, paddingVertical: 9 } : null,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
            tutorialItemSelector.active ? styles.tutorialTargetFocus : null
          ]}
        >
          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Items</Text>
          <Text className="text-sm font-bold" style={{ color: theme.inputText }}>Tap to add item ({cart.length} in cart)</Text>
        </Pressable>
      </View>
      <Text className="text-[13px]" style={{ color: theme.subtext }}>
        Default LPG flow for new item:{' '}
        {defaultLpgFlowForNewItem === 'NONE'
          ? 'Require per item'
          : defaultLpgFlowForNewItem === 'REFILL_EXCHANGE'
            ? 'Refill Exchange'
            : 'Non-Refill'}
      </Text>

      <View className="gap-2 rounded-xl border px-2.5 py-2.5" style={{ borderColor: theme.cardBorder }}>
        <Text className="text-sm font-bold" style={{ color: theme.heading }}>Cart</Text>
        {cart.length === 0 ? (
          <Text className="text-[13px]" style={{ color: theme.subtext }}>No items added yet.</Text>
        ) : (
          cart.map((line) => (
            <SwipeToDeleteRow
              key={line.lineId}
              theme={theme}
              onDelete={() => updateQty(line.lineId, 0)}
              disabled={saving || syncBusy}
              deleteLabel="Remove"
            >
              <View className="flex-row items-start gap-2" style={isCompactLayout ? { alignItems: 'flex-start' } : null}>
                <View style={{ flex: 1 }}>
                  <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{line.name}</Text>
                  <Text style={[styles.cartCode, { color: theme.subtext }]}>{line.subtitle ?? line.id}</Text>
                  {line.isLpg ? (
                    <Text style={[styles.cartCode, { color: theme.subtext }]}>
                      Size: {(line.cylinderSizeLabel ?? '').trim() || '-'}
                    </Text>
                  ) : null}
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
                  <Text className="text-[11px]" style={{ color: theme.subtext }}>PHP {line.unitPrice.toFixed(2)} each</Text>
                </View>
                <View style={[styles.cartRightRail, isCompactLayout ? { minWidth: 88 } : null]}>
                  <Text
                    className="text-[13px] font-bold"
                    style={[isCompactLayout ? { minWidth: 0, textAlign: 'right' } : null, { color: theme.heading }]}
                  >
                    PHP {(line.unitPrice * line.quantity).toFixed(2)}
                  </Text>
                  <View className="flex-row items-center gap-2">
                    <Pressable className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: theme.pillBg }} onPress={() => updateQty(line.lineId, line.quantity - 1)}>
                      <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>-</Text>
                    </Pressable>
                    <TextInput
                      value={String(line.quantity)}
                      onChangeText={(value) => {
                        const digits = value.replace(/[^0-9]/g, '');
                        if (!digits) {
                          return;
                        }
                        const parsed = Number.parseInt(digits, 10);
                        if (!Number.isFinite(parsed)) {
                          return;
                        }
                        updateQty(line.lineId, parsed);
                      }}
                      keyboardType="number-pad"
                      className="min-w-[44px] rounded-md px-1 py-0.5 text-center text-[13px] font-bold"
                      style={{ backgroundColor: theme.inputBg, color: theme.heading, borderColor: theme.cardBorder, borderWidth: 1 }}
                    />
                    <Pressable className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: theme.pillBg }} onPress={() => updateQty(line.lineId, line.quantity + 1)}>
                      <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>+</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </SwipeToDeleteRow>
          ))
        )}
      </View>

      <View className="gap-0.5 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.cardBorder }}>
        <Text className="text-xs" style={{ color: theme.subtext }}>Order Type: {orderType}</Text>
        <Text className="text-xs" style={{ color: theme.subtext }}>
          LPG Mix: Refill {lpgFlowSummary.refill} | Non-Refill {lpgFlowSummary.nonRefill}
        </Text>
        <Text className="text-xs" style={{ color: theme.subtext }}>Customer: {selectedCustomer?.label ?? '-'}</Text>
        <Text className="text-xs" style={{ color: theme.subtext }}>Address: {selectedCustomerAddress}</Text>
        <Text className="text-xs" style={{ color: theme.subtext }}>{personnelLabel}: {selectedDriver?.label ?? '-'}</Text>
        <Text className="text-xs" style={{ color: theme.subtext }}>Helper: {selectedHelper?.label ?? '-'}</Text>
        <Text className="text-xs" style={{ color: theme.subtext }}>Items: {cart.length}</Text>
        <Text className="text-xs" style={{ color: theme.subtext }}>Subtotal: PHP {subtotal.toFixed(2)}</Text>
        {discountValue > 0 ? (
          <Text className="text-xs" style={{ color: theme.subtext }}>Discount: PHP {discountValue.toFixed(2)}</Text>
        ) : null}
        <Text className="mt-1 text-base font-extrabold" style={{ color: theme.heading }}>Total: PHP {total.toFixed(2)}</Text>
      </View>

      <View className="flex-row gap-2">
        <Pressable
          className="min-h-10 flex-1 items-center justify-center rounded-xl px-3"
          style={{ backgroundColor: hasCart && !saving && !syncBusy ? theme.pillBg : theme.cardBorder }}
          onPress={promptHoldCurrentCart}
          disabled={!hasCart || saving || syncBusy}
        >
          <Text className="text-[12px] font-bold" style={{ color: theme.pillText }}>Add to Queue</Text>
        </Pressable>
      </View>

      {!showPaymentStep ? (
        <View ref={tutorialProceedPayment.ref} onLayout={tutorialProceedPayment.onLayout}>
          <Pressable
            className="min-h-11 items-center justify-center rounded-xl px-3"
            style={[
              { backgroundColor: canProceedToPayment && Boolean(activeShiftId) ? theme.primary : theme.primaryMuted },
              tutorialProceedPayment.active ? styles.tutorialTargetFocus : null
            ]}
            onPress={() => void handleProceedToPayment()}
            disabled={!canProceedToPayment || saving || syncBusy || !activeShiftId}
          >
            <Text className="text-[13px] font-bold text-white">Proceed to Payment</Text>
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
        actionLabel="New Customer"
        onAction={() => setCreateCustomerModalOpen(true)}
        actionDisabled={createCustomerSaving}
        theme={theme}
      />

      <Modal
        visible={createCustomerModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => closeCreateCustomerModal()}
      >
        <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] pt-3" style={{ paddingBottom: Math.max(insets.bottom + 8, 12) }}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => closeCreateCustomerModal()} />
          <View
            className="w-full gap-2.5 rounded-t-[20px] border px-3 py-3"
            style={[
              isCompactLayout ? { minHeight: '44%', maxHeight: '82%', paddingHorizontal: 10, paddingVertical: 10, gap: 8 } : { minHeight: '40%', maxHeight: '74%' },
              { backgroundColor: theme.card, borderColor: theme.cardBorder }
            ]}
          >
            <View className="gap-1">
              <Text className="text-base font-extrabold" style={{ color: theme.heading }}>New Customer</Text>
              <Text className="text-[12px]" style={{ color: theme.subtext }}>
                Save a customer locally now. We&apos;ll sync it when the device is connected again.
              </Text>
            </View>

            <View className="gap-2">
              <View className="gap-1">
                <Text className="text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Name</Text>
                <TextInput
                  value={createCustomerName}
                  onChangeText={setCreateCustomerName}
                  placeholder="Customer name"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View className="gap-1">
                <Text className="text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Address</Text>
                <TextInput
                  value={createCustomerAddress}
                  onChangeText={setCreateCustomerAddress}
                  placeholder="Customer address"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View className="gap-1">
                <Text className="text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Code</Text>
                <TextInput
                  value={createCustomerCode}
                  onChangeText={setCreateCustomerCode}
                  placeholder="Optional code"
                  placeholderTextColor={theme.inputPlaceholder}
                  autoCapitalize="characters"
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View className="gap-1">
                <Text className="text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Contact Number</Text>
                <TextInput
                  value={createCustomerContactNumber}
                  onChangeText={setCreateCustomerContactNumber}
                  placeholder="Optional contact number"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View className="gap-1">
                <Text className="text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Gas</Text>
                <TextInput
                  value={createCustomerGas}
                  onChangeText={setCreateCustomerGas}
                  placeholder="Optional gas preference"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View className="gap-1">
                <Text className="text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Province</Text>
                <TextInput
                  value={createCustomerProvince}
                  onChangeText={setCreateCustomerProvince}
                  placeholder="Optional province"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View className="gap-1">
                <Text className="text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>City</Text>
                <TextInput
                  value={createCustomerCity}
                  onChangeText={setCreateCustomerCity}
                  placeholder="Optional city"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
            </View>

            <View className="flex-row gap-2">
              <Pressable
                className="min-h-10 flex-1 items-center justify-center rounded-xl px-3"
                style={{ backgroundColor: theme.pillBg }}
                onPress={() => closeCreateCustomerModal()}
                disabled={createCustomerSaving}
              >
                <Text className="text-[12px] font-bold" style={{ color: theme.pillText }}>Cancel</Text>
              </Pressable>
              <Pressable
                className="min-h-10 flex-1 items-center justify-center rounded-xl px-3"
                style={{ backgroundColor: createCustomerSaving ? theme.primaryMuted : theme.primary }}
                onPress={() => void handleCreateOfflineCustomer()}
                disabled={createCustomerSaving}
              >
                <Text className="text-[12px] font-bold text-white">{createCustomerSaving ? 'Saving...' : 'Save Customer'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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

      <Modal
        visible={queuePreviewOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setQueuePreviewOpen(false)}
      >
        <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] pt-3" style={{ paddingBottom: Math.max(insets.bottom + 8, 12) }}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setQueuePreviewOpen(false)} />
          <View
            className="w-full gap-2.5 rounded-t-[20px] border px-3 py-3"
            style={[
              isCompactLayout ? { minHeight: '58%', maxHeight: '90%', paddingHorizontal: 10, paddingVertical: 10, gap: 8 } : { minHeight: '54%', maxHeight: '86%' },
              { backgroundColor: theme.card, borderColor: theme.cardBorder }
            ]}
          >
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Add to Queue</Text>
                <Text className="text-[12px]" style={{ color: theme.subtext }}>
                  Review the queued order preview before saving it for later recall.
                </Text>
              </View>
              <Pressable
                className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                onPress={() => setQueuePreviewOpen(false)}
              >
                <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Back</Text>
              </Pressable>
            </View>

            <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ gap: 10, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
              <View className="gap-2 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                <Text className="text-[11px] font-bold uppercase tracking-[1px]" style={{ color: theme.subtext }}>Print Preview</Text>
                <View className="flex-row flex-wrap gap-2">
                  <View className="rounded-full px-3 py-1" style={{ backgroundColor: theme.card }}>
                    <Text className="text-[11px] font-bold" style={{ color: theme.pillText }}>{orderType}</Text>
                  </View>
                  <View className="rounded-full px-3 py-1" style={{ backgroundColor: theme.card }}>
                    <Text className="text-[11px] font-bold" style={{ color: theme.pillText }}>{cart.length} item(s)</Text>
                  </View>
                </View>
                <View className="gap-1">
                  <Text className="text-[12px] font-bold" style={{ color: theme.subtext }}>Customer</Text>
                  <Text className="text-[14px] font-extrabold" style={{ color: theme.heading }}>
                    {selectedCustomer?.label?.trim() || 'Walk-in customer'}
                  </Text>
                </View>
                <View className="gap-1">
                  <Text className="text-[12px] font-bold" style={{ color: theme.subtext }}>Address</Text>
                  <Text className="text-[13px]" style={{ color: theme.heading }}>
                    {selectedCustomerAddress || ''}
                  </Text>
                </View>
              </View>

              <View className="gap-2 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                <Text className="text-[11px] font-bold uppercase tracking-[1px]" style={{ color: theme.subtext }}>Details</Text>
                {queuePreviewLines.length === 0 ? (
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>No items in this order.</Text>
                ) : (
                  queuePreviewLines.map((line, index) => (
                    <View
                      key={line.id}
                      className="flex-row items-start justify-between gap-3 rounded-xl border px-3 py-2.5"
                      style={{ borderColor: theme.cardBorder, backgroundColor: theme.card }}
                    >
                      <View className="min-w-0 flex-1 flex-row items-start gap-2.5">
                        <View className="mt-0.5 h-6 min-w-6 items-center justify-center rounded-full" style={{ backgroundColor: theme.inputBg }}>
                          <Text className="text-[11px] font-bold" style={{ color: theme.pillText }}>{index + 1}</Text>
                        </View>
                        <View className="min-w-0 flex-1 gap-0.5">
                          <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{line.name}</Text>
                          {line.subtitle ? (
                            <Text className="text-[11px]" style={{ color: theme.subtext }}>{line.subtitle}</Text>
                          ) : null}
                        </View>
                      </View>
                      <View className="items-end gap-0.5">
                        <Text className="text-[11px] font-bold" style={{ color: theme.subtext }}>Qty {line.qty}</Text>
                        <Text className="text-[12px] font-extrabold" style={{ color: theme.heading }}>
                          PHP {line.amount.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
                {cart.length > queuePreviewLines.length ? (
                  <Text className="text-[11px]" style={{ color: theme.subtext }}>
                    +{cart.length - queuePreviewLines.length} more item(s)
                  </Text>
                ) : null}
              </View>

              <View className="gap-2 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                <Text className="text-[11px] font-bold uppercase tracking-[1px]" style={{ color: theme.subtext }}>Summary</Text>
                <View className="flex-row gap-2">
                  <View className="flex-1 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.cardBorder, backgroundColor: theme.card }}>
                    <Text className="text-[11px] font-bold" style={{ color: theme.subtext }}>Subtotal</Text>
                    <Text className="text-[14px] font-extrabold" style={{ color: theme.heading }}>PHP {subtotal.toFixed(2)}</Text>
                  </View>
                  <View className="flex-1 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.cardBorder, backgroundColor: theme.card }}>
                    <Text className="text-[11px] font-bold" style={{ color: theme.subtext }}>Total</Text>
                    <Text className="text-[14px] font-extrabold" style={{ color: theme.heading }}>PHP {total.toFixed(2)}</Text>
                  </View>
                </View>
              </View>

              <View className="gap-2 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                <Text className="text-[11px] font-bold uppercase tracking-[1px]" style={{ color: theme.subtext }}>Total</Text>
                <Text className="text-[18px] font-extrabold" style={{ color: theme.heading }}>
                  PHP {total.toFixed(2)}
                </Text>
              </View>
            </ScrollView>

            <View className="flex-row gap-2">
              <Pressable
                className="min-h-11 flex-1 items-center justify-center rounded-xl px-3"
                style={{ backgroundColor: theme.pillBg }}
                onPress={() => setQueuePreviewOpen(false)}
              >
                <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Back</Text>
              </Pressable>
              <Pressable
                className="min-h-11 flex-1 items-center justify-center rounded-xl px-3"
                style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, borderWidth: 1 }}
                onPress={() => {
                  void printQueueOrderReceipt(
                    buildQueueOrderReceiptPayload({
                      queueId: `preview-${Date.now()}`,
                      queueLabel: buildHeldCartLabel(),
                      createdAt: new Date().toISOString(),
                      customerName: selectedCustomer?.label ?? null,
                      customerAddress: selectedCustomerAddress || null,
                      saleType: orderType,
                      paymentMode,
                      paymentMethod,
                      paidAmount: parsedPaidAmount,
                      discountAmount: discountValue,
                      deliveryFee: deliveryFeeValue,
                      notes: paymentNotes.trim() || null,
                      personnelName: selectedDriver?.label ?? null,
                      helperName: selectedHelper?.label ?? null,
                      lines: cart.map((line) => ({
                        name: line.name,
                        subtitle: line.subtitle,
                        quantity: line.quantity,
                        unitPrice: line.unitPrice
                      }))
                    })
                  );
                }}
              >
                <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Print</Text>
              </Pressable>
              <Pressable
                className="min-h-11 flex-1 items-center justify-center rounded-xl px-3"
                style={{ backgroundColor: theme.primary }}
                onPress={() => {
                  void holdCurrentCart();
                }}
              >
                <Text className="text-[13px] font-bold text-white">Add to Queue</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={heldCartModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHeldCartModalOpen(false)}
      >
        <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] pt-3" style={{ paddingBottom: Math.max(insets.bottom + 8, 12) }}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setHeldCartModalOpen(false)} />
          <View
            className="min-h-[70%] max-h-[94%] w-full gap-2.5 rounded-t-[20px] border px-3 py-3"
            style={[
              isCompactLayout ? { minHeight: '76%', maxHeight: '96%', paddingHorizontal: 10, paddingVertical: 10, gap: 8 } : null,
              { backgroundColor: theme.card, borderColor: theme.cardBorder }
            ]}
          >
            <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Queue Orders</Text>
            <TextInput
              value={heldCartSearch}
              onChangeText={setHeldCartSearch}
              placeholder="Search queued order, customer, or item"
              placeholderTextColor={theme.inputPlaceholder}
              className="rounded-xl px-3 py-[11px] text-[13px]"
              style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
            />
            <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ gap: 10, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
              {filteredHeldCarts.length === 0 ? (
                <Text style={[styles.modalEmpty, { color: theme.subtext }]}>
                  No queued orders yet.
                </Text>
              ) : (
                filteredHeldCarts.map((held) => {
                  const heldTotal = round2(
                    held.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0) -
                      held.discountAmount +
                      held.deliveryFee
                  );
                  return (
                    <View
                      key={held.id}
                      className="gap-2 rounded-xl border px-3 py-3"
                      style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                    >
                      <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>
                        {held.label}
                      </Text>
                      <Text className="text-[12px]" style={{ color: theme.subtext }}>
                        {held.customerName ?? 'Walk-in customer'} | {held.lines.length} line(s) | PHP {heldTotal.toFixed(2)}
                      </Text>
                      <Text className="text-[11px]" style={{ color: theme.subtext }}>
                        {new Date(held.updatedAt).toLocaleString()}
                      </Text>
                      <View className="flex-row gap-2">
                        <Pressable
                          className="min-h-10 flex-1 items-center justify-center rounded-xl px-3"
                          style={{ backgroundColor: theme.primary }}
                          onPress={() => {
                            void recallHeldCart(held);
                          }}
                        >
                          <Text className="text-[12px] font-bold text-white">Recall</Text>
                        </Pressable>
                        <Pressable
                          className="min-h-10 flex-1 items-center justify-center rounded-xl px-3"
                          style={{ backgroundColor: theme.card, borderColor: theme.cardBorder, borderWidth: 1 }}
                          onPress={() => {
                            const customerOption = held.customerId ? customers.find((option) => option.id === held.customerId) : undefined;
                            void printQueueOrderReceipt(
                              buildQueueOrderReceiptPayload({
                                queueId: held.id,
                                queueLabel: held.label,
                                createdAt: held.createdAt,
                                customerName: held.customerName,
                                customerAddress: customerOption?.address?.trim() ?? null,
                                saleType: held.saleType,
                                paymentMode: held.paymentMode,
                                paymentMethod: held.paymentMethod,
                                paidAmount: held.paidAmount,
                                discountAmount: held.discountAmount,
                                deliveryFee: held.deliveryFee,
                                notes: held.notes,
                                personnelName: held.driverName ?? null,
                                helperName: held.helperName ?? null,
                                lines: held.lines.map((line) => ({
                                  name: line.productName,
                                  subtitle: line.subtitle,
                                  quantity: line.quantity,
                                  unitPrice: line.unitPrice
                                }))
                              })
                            );
                          }}
                        >
                          <Text className="text-[12px] font-bold" style={{ color: theme.pillText }}>Print</Text>
                        </Pressable>
                        <Pressable
                          className="min-h-10 flex-1 items-center justify-center rounded-xl px-3"
                          style={{ backgroundColor: theme.pillBg }}
                          onPress={() => {
                            Alert.alert('Delete held cart?', `${held.label}`, [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: () => {
                                  void removeHeldCart(held.id);
                                }
                              }
                            ]);
                          }}
                        >
                          <Text className="text-[12px] font-bold" style={{ color: theme.pillText }}>Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
            <Pressable
              onPress={() => setHeldCartModalOpen(false)}
              className="min-h-10 items-center justify-center rounded-xl px-3"
              style={{ backgroundColor: theme.pillBg }}
            >
              <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={itemModalOpen} transparent animationType="fade" onRequestClose={() => setItemModalOpen(false)}>
        <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] pt-3" style={{ paddingBottom: Math.max(insets.bottom + 8, 12) }}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setItemModalOpen(false)} />
          <View
            className="min-h-[82%] max-h-[94%] w-full gap-2.5 rounded-t-[20px] border px-3 py-3"
            style={[
              isCompactLayout ? { minHeight: '86%', maxHeight: '96%', paddingHorizontal: 10, paddingVertical: 10, gap: 8 } : null,
              { backgroundColor: theme.card, borderColor: theme.cardBorder }
            ]}
          >
            <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Select Item</Text>
            <TextInput
              value={itemSearch}
              onChangeText={(value) => setItemSearch(value.replace(/[%_]/g, ''))}
              placeholder="Search item code or name"
              placeholderTextColor={theme.inputPlaceholder}
              className="rounded-xl px-3 py-[11px] text-[13px]"
              style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
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
            <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ gap: 10, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
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
                      className="gap-2 rounded-xl border px-3 py-3"
                      style={[
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
                    <View className="flex-row items-start justify-between gap-3">
                      <View className="min-w-0 flex-1 gap-0.5">
                        <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>{product.name}</Text>
                        <Text className="text-[12px]" style={{ color: theme.subtext }}>
                          {product.subtitle ?? product.id}
                        </Text>
                        {product.isLpg ? (
                          <Text className="text-[12px]" style={{ color: theme.subtext }}>
                            Size: {(product.cylinderSizeLabel ?? '').trim() || '-'}
                          </Text>
                        ) : null}
                      </View>
                      <View className="rounded-full px-3 py-1" style={[isCompactLayout ? { paddingHorizontal: 8, paddingVertical: 4 } : null, { backgroundColor: theme.pillBg }]}>
                        <Text className="text-[11px] font-semibold" style={{ color: theme.pillText }}>
                          PHP {product.unitPrice.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                    {product.isLpg ? (
                      <View className="flex-row flex-wrap gap-2" style={isCompactLayout ? { flexDirection: 'column', alignItems: 'flex-start', gap: 2 } : null}>
                        <Text className="text-[12px]" style={{ color: theme.subtext }}>
                          Refill: {flowPrice.refill !== null ? `PHP ${flowPrice.refill.toFixed(2)}` : '-'}
                        </Text>
                        <Text className="text-[12px]" style={{ color: theme.subtext }}>
                          Non-Refill: {flowPrice.nonRefill !== null ? `PHP ${flowPrice.nonRefill.toFixed(2)}` : '-'}
                        </Text>
                      </View>
                    ) : null}
                    {product.category ? <Text className="text-[12px]" style={{ color: theme.subtext }}>Category: {product.category}</Text> : null}
                    <View style={[styles.itemStockMetrics, isCompactLayout ? { flexWrap: 'wrap', gap: 6 } : null]}>
                      <View className="min-w-[31%] flex-1 rounded-xl px-3 py-2" style={[isCompactLayout ? { minWidth: '31%', flexBasis: '31%' } : null, { backgroundColor: theme.pillBg }]}>
                        <Text className="text-[10px] font-semibold uppercase" style={{ color: theme.subtext }}>FULL</Text>
                        <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{formatQty(product.qtyFull)}</Text>
                      </View>
                      <View className="min-w-[31%] flex-1 rounded-xl px-3 py-2" style={[isCompactLayout ? { minWidth: '31%', flexBasis: '31%' } : null, { backgroundColor: theme.pillBg }]}>
                        <Text className="text-[10px] font-semibold uppercase" style={{ color: theme.subtext }}>EMPTY</Text>
                        <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{formatQty(product.qtyEmpty)}</Text>
                      </View>
                      <View className="min-w-[31%] flex-1 rounded-xl px-3 py-2" style={[isCompactLayout ? { minWidth: '31%', flexBasis: '31%' } : null, { backgroundColor: theme.pillBg }]}>
                        <Text className="text-[10px] font-semibold uppercase" style={{ color: theme.subtext }}>QOH</Text>
                        <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{formatQty(product.qtyOnHand)}</Text>
                      </View>
                    </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Pressable onPress={() => setItemModalOpen(false)} className="min-h-10 items-center justify-center rounded-xl px-3" style={{ backgroundColor: theme.pillBg }}>
              <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Close</Text>
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
        <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] pt-3" style={{ paddingTop: Math.max(insets.top + 8, 16) }}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => {
              if (!saving) {
                setShowPaymentStep(false);
              }
            }}
          />
          <View
            className="w-full self-center rounded-t-[20px] border"
            style={[
              styles.modalCard,
              styles.paymentModalCard,
              isCompactLayout ? styles.paymentModalCardCompact : styles.paymentModalCardRegular,
              shortEdge >= 600 ? styles.paymentModalCardWide : null,
              { backgroundColor: theme.card, borderColor: theme.cardBorder }
            ]}
          >
            <View style={styles.paymentModalHeader}>
              <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Payment Details</Text>
              <Text className="text-[12px]" style={[isCompactLayout ? { fontSize: 11 } : null, { color: theme.subtext }]}>
                {paymentMode === 'FULL'
                  ? 'Full payment: amount tendered can be equal or higher than total (change is auto-calculated).'
                  : 'Partial payment: collect any amount from 0 up to less than total; remaining becomes customer credit.'}
              </Text>
            </View>

            <View style={styles.paymentModalBodyWrap}>
              <ScrollView
                style={styles.paymentModalBody}
                contentContainerStyle={[
                  styles.paymentModalBodyContent,
                  isCompactLayout ? styles.paymentModalBodyContentCompact : null
                ]}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                <View className="gap-1.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder }}>
                <Text className="text-[12px]" style={{ color: theme.subtext }}>Order Type: {orderType}</Text>
                <Text className="text-[12px]" style={{ color: theme.subtext }}>
                  LPG Mix: Refill {lpgFlowSummary.refill} | Non-Refill {lpgFlowSummary.nonRefill}
                </Text>
                <Text className="text-[12px]" style={{ color: theme.subtext }}>Customer: {selectedCustomer?.label ?? '-'}</Text>
                <Text className="text-[12px]" style={{ color: theme.subtext }}>Customer Address: {selectedCustomerAddress}</Text>
                <Text className="text-[12px]" style={{ color: theme.subtext }}>
                  Customer Current Balance: PHP {selectedCustomerOutstanding.toFixed(2)}
                </Text>
                <Text className="text-[12px]" style={{ color: theme.subtext }}>{personnelLabel}: {selectedDriver?.label ?? '-'}</Text>
                <Text className="text-[12px]" style={{ color: theme.subtext }}>Helper: {selectedHelper?.label ?? '-'}</Text>
              </View>

                {currentPointsBalance > 0 ? (
                  <View className="gap-2 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder }}>
                    <Text className="text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Reward Redemption</Text>
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>
                      Available points: {currentPointsBalance}
                    </Text>
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>
                      Pick one reward to reserve/apply during checkout. Discount fields can still be adjusted before saving.
                    </Text>
                    {rewardsLoading ? (
                      <Text className="text-[12px]" style={{ color: theme.subtext }}>Loading rewards...</Text>
                    ) : rewardEligibleOptions.length === 0 ? (
                      <Text className="text-[12px]" style={{ color: theme.subtext }}>No active checkout rewards available for this customer/branch.</Text>
                    ) : (
                      <View className="flex-row flex-wrap gap-2">
                        {rewardEligibleOptions.map((reward) => {
                          const active = reward.id === selectedRewardId;
                          return (
                            <Pressable
                              key={reward.id}
                              className="min-h-10 basis-[48%] items-center justify-center rounded-xl px-3 py-2"
                              style={{ backgroundColor: active ? theme.primary : theme.pillBg }}
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
                            className="min-h-10 basis-[48%] items-center justify-center rounded-xl px-3 py-2"
                            style={{ backgroundColor: theme.pillBg }}
                            onPress={() => setSelectedRewardId('')}
                            disabled={saving}
                          >
                            <Text style={{ color: theme.pillText, fontWeight: '700', fontSize: 11 }}>Clear Reward</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    )}
                  </View>
                ) : null}

                <Text className="text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Payment Type</Text>
                <View className="flex-row gap-2" style={isCompactLayout ? { gap: 6 } : null}>
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
                        setPaidAmount('0');
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

                <Text className="text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Payment Method</Text>
                <View className="flex-row flex-wrap gap-2" style={isCompactLayout ? { flexWrap: 'wrap', gap: 6 } : null}>
                {(['CASH', 'CARD', 'E_WALLET'] as const).map((method) => {
                  const selected = method === paymentMethod;
                  return (
                    <Pressable
                      key={method}
                      style={[
                        styles.methodPill,
                        isCompactLayout ? { flex: 0, width: '48%', minHeight: 38 } : null,
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

                <Text className="text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Discount Amount</Text>
                <TextInput
                value={discount}
                onChangeText={setDiscount}
                keyboardType="numeric"
                editable={canProceedToPayment && !saving}
                placeholder="0.00"
                placeholderTextColor={theme.inputPlaceholder}
                className="rounded-xl px-3 py-[11px] text-[13px]"
                style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
              />

                {orderType === 'DELIVERY' ? (
                  <>
                    <Text className="text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Delivery Fee</Text>
                    <TextInput
                    value={deliveryFee}
                    onChangeText={setDeliveryFee}
                    keyboardType="numeric"
                    editable={canProceedToPayment && !saving}
                    placeholder="0.00"
                    placeholderTextColor={theme.inputPlaceholder}
                    className="rounded-xl px-3 py-[11px] text-[13px]"
                    style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                  />
                  </>
                ) : null}

                <Text className="text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                  {paymentMode === 'FULL' ? 'Amount Tendered' : 'Amount Collected'}
                </Text>
                <View className="flex-row items-center gap-2">
                  <TextInput
                    value={paidAmount}
                    onChangeText={setPaidAmount}
                    keyboardType="numeric"
                    editable={canProceedToPayment && !saving}
                    placeholder="0.00"
                    placeholderTextColor={theme.inputPlaceholder}
                    className="flex-1 rounded-xl px-3 py-[11px] text-[13px]"
                    style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                  />
                  <Pressable
                    className="min-h-[44px] min-w-[68px] items-center justify-center rounded-xl px-3"
                    style={{ backgroundColor: theme.pillBg }}
                    onPress={() => setPaidAmount(total.toFixed(2))}
                    disabled={!canProceedToPayment || saving}
                  >
                    <Text className="text-[12px] font-bold" style={{ color: theme.pillText }}>Exact</Text>
                  </Pressable>
                </View>

                <View className="flex-row gap-2" style={isCompactLayout ? { flexDirection: 'column', gap: 6 } : null}>
                  <View className="flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                  <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Paid</Text>
                  <Text className="text-base font-extrabold" style={{ color: theme.heading }}>PHP {parsedPaidAmount.toFixed(2)}</Text>
                </View>
                  <View className="flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                  <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Change</Text>
                  <Text className="text-base font-extrabold" style={{ color: theme.heading }}>PHP {changeAmount.toFixed(2)}</Text>
                </View>
                </View>

                <View className="flex-row gap-2" style={isCompactLayout ? { flexDirection: 'column', gap: 6 } : null}>
                  <View className="flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                  <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Credit</Text>
                  <Text className="text-base font-extrabold" style={{ color: theme.heading }}>PHP {creditBalance.toFixed(2)}</Text>
                </View>
                  <View className="flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                  <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Total</Text>
                  <Text className="text-base font-extrabold" style={{ color: theme.heading }}>PHP {total.toFixed(2)}</Text>
                </View>
                </View>

                <Text className="text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>Notes (Optional)</Text>
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
                className="rounded-xl px-3 py-[11px] text-[13px]"
                style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
              />

                <View className="gap-1.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder }}>
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>Items: {cart.length}</Text>
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>Subtotal: PHP {subtotal.toFixed(2)}</Text>
                  {discountValue > 0 ? (
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>Discount: PHP {discountValue.toFixed(2)}</Text>
                  ) : null}
                  {orderType === 'DELIVERY' ? (
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>Delivery Fee: PHP {deliveryFeeValue.toFixed(2)}</Text>
                  ) : null}
                  {selectedReward ? (
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>
                      Reward: {selectedReward.name} ({selectedReward.points_cost} pts)
                    </Text>
                  ) : null}
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>Applied Payment: PHP {appliedPaidAmount.toFixed(2)}</Text>
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>Credit Due: PHP {creditBalance.toFixed(2)}</Text>
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>Mode: {paymentMode}</Text>
                </View>
              </ScrollView>
            </View>

            <View
              style={[
                styles.paymentModalActions,
                isCompactLayout ? styles.paymentModalActionsCompact : null,
                {
                  borderTopColor: theme.cardBorder,
                  backgroundColor: theme.card,
                  paddingBottom: Math.max(insets.bottom + 4, 12)
                }
              ]}
            >
              <Pressable
                onPress={() => setShowPaymentStep(false)}
                disabled={saving}
                style={[
                  styles.modalSecondaryBtn,
                  isCompactLayout ? styles.paymentModalSecondaryBtnCompact : null,
                  { backgroundColor: saving ? theme.primaryMuted : theme.pillBg }
                ]}
              >
                <Text style={[styles.modalSecondaryText, { color: saving ? '#FFFFFF' : theme.pillText }]}>Back</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalPrimaryBtn,
                  isCompactLayout ? styles.paymentModalPrimaryBtnCompact : null,
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
    paddingBottom: 12,
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
    width: '100%',
    height: '92%',
    maxHeight: '95%',
    minHeight: '90%',
    paddingBottom: 0,
    gap: 0,
    overflow: 'hidden'
  },
  paymentModalCardCompact: {
    paddingHorizontal: 10,
    paddingTop: 10,
    height: '90%',
    maxHeight: '95%',
    minHeight: '90%'
  },
  paymentModalCardRegular: {
    paddingHorizontal: 14,
    paddingTop: 14
  },
  paymentModalCardWide: {
    maxWidth: 560
  },
  paymentModalHeader: {
    gap: 6,
    paddingBottom: 10,
    flexShrink: 0
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
    justifyContent: 'center',
    flex: 1
  },
  modalFooterActions: {
    flexDirection: 'row',
    gap: 8
  },
  modalActionButton: {
    minWidth: 112
  },
  modalCloseText: {
    fontSize: 12,
    fontWeight: '700'
  },
  paymentModalBody: {
    flex: 1,
    minHeight: 0
  },
  paymentModalBodyWrap: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden'
  },
  paymentModalBodyContent: {
    gap: 10,
    paddingBottom: 16
  },
  paymentModalBodyContentCompact: {
    gap: 8,
    paddingBottom: 12
  },
  paymentModalActions: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 10,
    paddingBottom: 10,
    flexShrink: 0,
    zIndex: 2,
    elevation: 2
  },
  paymentModalActionsCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8
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
  paymentModalSecondaryBtnCompact: {
    minHeight: 40,
    minWidth: 96,
    paddingHorizontal: 12
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
  paymentModalPrimaryBtnCompact: {
    minHeight: 40,
    flex: 1
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
