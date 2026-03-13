import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import { toastError, toastInfo, toastSuccess } from '../goey-toast';
import type { AppTheme } from '../theme';
import { useTutorialTarget } from '../tutorial/tutorial-provider';
import { SwipeToDeleteRow } from '../components/SwipeToDeleteRow';
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

export type PosQueuedSaleReceiptPayload = {
  saleId: string;
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
    contractPrice: asNumber(payload.contractPrice ?? payload.contract_price)
  };
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
  onDataChanged,
  onPrintQueuedSaleReceipt,
  onGoToShift,
  syncBusy = false
}: Props): JSX.Element {
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
  const [discount, setDiscount] = useState('0');
  const [deliveryFee, setDeliveryFee] = useState('0.00');
  const [paymentMode, setPaymentMode] = useState<'FULL' | 'PARTIAL'>('FULL');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'E_WALLET'>('CASH');
  const [paidAmount, setPaidAmount] = useState('0');
  const [showPaymentStep, setShowPaymentStep] = useState(false);
  const [paymentNotes, setPaymentNotes] = useState('');
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
    void refreshMasterData();
  }, []);

  useEffect(() => {
    void refreshActiveShift();
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [branchId, customerId, locationId]);

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
    const inventoryByProduct = new Map<string, { qtyOnHand: number; qtyFull: number; qtyEmpty: number }>();
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
      const stock = inventoryByProduct.get(id);

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
    if (product.isLpg) {
      const availableFull =
        typeof product.qtyFull === 'number' && Number.isFinite(product.qtyFull) ? Math.max(0, product.qtyFull) : null;
      if (availableFull === null) {
        return `${product.name}: no stock data available yet. Download/sync branch data first.`;
      }
      if (nextTotalQty > availableFull + 0.0001) {
        return `${product.name}: insufficient FULL qty (avail ${availableFull.toFixed(2)}, need ${nextTotalQty.toFixed(2)}).`;
      }
      return null;
    }
    const availableOnHand =
      typeof product.qtyOnHand === 'number' && Number.isFinite(product.qtyOnHand) ? Math.max(0, product.qtyOnHand) : null;
    if (availableOnHand === null) {
      return `${product.name}: no stock data available yet. Download/sync branch data first.`;
    }
    if (nextTotalQty > availableOnHand + 0.0001) {
      return `${product.name}: insufficient qty on hand (avail ${availableOnHand.toFixed(2)}, need ${nextTotalQty.toFixed(2)}).`;
    }
    return null;
  };

  const isItemOutOfStock = (product: Product): boolean => {
    if (product.isLpg) {
      const full = typeof product.qtyFull === 'number' && Number.isFinite(product.qtyFull) ? product.qtyFull : null;
      if (full === null) {
        return true;
      }
      return full <= 0;
    }
    const qoh = typeof product.qtyOnHand === 'number' && Number.isFinite(product.qtyOnHand) ? product.qtyOnHand : null;
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

    const rows = await db.getAllAsync<{ payload: string }>(
      `
      SELECT payload
      FROM master_data_local
      WHERE entity IN (?, ?)
      ORDER BY updated_at DESC
      `,
      'inventory_balance',
      'inventory_balances'
    );

    if (!rows.length) {
      return [];
    }

    const inventoryByProduct = new Map<string, { qtyOnHand: number; qtyFull: number; qtyEmpty: number }>();
    for (const row of rows) {
      const snapshot = parseInventorySnapshot(parseRecord<Record<string, unknown>>(row.payload, {}));
      if (!snapshot) {
        continue;
      }
      if (snapshot.locationId && snapshot.locationId !== locationId.trim()) {
        continue;
      }
      const current = inventoryByProduct.get(snapshot.productId) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
      current.qtyOnHand += snapshot.qtyOnHand;
      current.qtyFull += snapshot.qtyFull;
      current.qtyEmpty += snapshot.qtyEmpty;
      inventoryByProduct.set(snapshot.productId, current);
    }

    const errors: string[] = [];
    for (const line of cart) {
      const inventory = inventoryByProduct.get(line.id) ?? { qtyOnHand: 0, qtyFull: 0, qtyEmpty: 0 };
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
    try {
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

      setCart([]);
      setDiscount('0');
      setDeliveryFee('0.00');
      setPaymentMode('FULL');
      setPaidAmount('0');
      setPaymentNotes('');
      setShowPaymentStep(false);
      setCustomerId('');
      setCustomerSearch('');
      setDriverId('');
      setDriverSearch('');
      setHelperId('');
      setHelperSearch('');
      await onDataChanged?.();
    } catch (cause) {
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
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.heading }]}>POS Sales</Text>
        <Text style={[styles.sub, { color: theme.subtext }]}>Pickup and delivery in one checkout flow.</Text>
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

      <View style={[styles.contextBar, { borderColor: theme.cardBorder, backgroundColor: theme.pillBg }]}>
        <Text style={[styles.contextText, { color: theme.pillText }]}>Branch: {branch?.label ?? branchId}</Text>
        <Text style={[styles.contextText, { color: theme.pillText }]}>Location: {location?.label ?? locationId}</Text>
      </View>

      <View ref={tutorialOrderType.ref} onLayout={tutorialOrderType.onLayout} style={styles.row}>
        {(['PICKUP', 'DELIVERY'] as const).map((mode) => {
          const selected = orderType === mode;
          return (
            <Pressable
              key={mode}
              onPress={() => setOrderType(mode)}
              style={[
                styles.modePill,
                { backgroundColor: selected ? theme.primary : theme.pillBg },
                tutorialOrderType.active ? styles.tutorialTargetFocus : null
              ]}
            >
              <Text style={{ color: selected ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: 12 }}>{mode}</Text>
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
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
            tutorialCustomer.active ? styles.tutorialTargetFocus : null
          ]}
        >
          <Text style={[styles.selectorLabel, { color: theme.subtext }]}>Customer</Text>
          <Text style={[styles.selectorValue, { color: theme.inputText }]}>{selectedCustomer?.label ?? 'Select customer'}</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <Pressable
          onPress={() => {
            setDriverSearch('');
            setDriverModalOpen(true);
          }}
          style={[styles.selectorButton, styles.selectorHalf, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
        >
          <Text style={[styles.selectorLabel, { color: theme.subtext }]}>{personnelLabel} (Required)</Text>
          <Text style={[styles.selectorValue, { color: theme.inputText }]}>
            {selectedDriver?.label ?? `Select ${personnelLabel.toLowerCase()}`}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setHelperSearch('');
            setHelperModalOpen(true);
          }}
          style={[styles.selectorButton, styles.selectorHalf, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
        >
          <Text style={[styles.selectorLabel, { color: theme.subtext }]}>Helper (Optional)</Text>
          <Text style={[styles.selectorValue, { color: theme.inputText }]}>{selectedHelper?.label ?? 'Select helper'}</Text>
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
              <View style={styles.cartRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cartName, { color: theme.heading }]}>{line.name}</Text>
                  <Text style={[styles.cartCode, { color: theme.subtext }]}>{line.subtitle ?? line.id}</Text>
                  {line.isLpg ? (
                    <View style={styles.row}>
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
                <Text style={[styles.cartLineTotal, { color: theme.heading }]}>PHP {(line.unitPrice * line.quantity).toFixed(2)}</Text>
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
          <View style={[styles.itemSelectModalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[styles.modalTitle, { color: theme.heading }]}>Select Item</Text>
            <TextInput
              value={itemSearch}
              onChangeText={setItemSearch}
              placeholder="Search item code or name"
              placeholderTextColor={theme.inputPlaceholder}
              style={[styles.modalSearch, { backgroundColor: theme.inputBg, color: theme.inputText }]}
            />
            <View style={styles.itemCategoryWrap}>
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
                    { backgroundColor: itemCategoryFilter === 'ALL' ? theme.primary : theme.pillBg }
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    ellipsizeMode='tail'
                    style={[styles.itemCategoryChipText, { color: itemCategoryFilter === 'ALL' ? '#FFFFFF' : theme.pillText }]}
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
                        { backgroundColor: selected ? theme.primary : theme.pillBg }
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        ellipsizeMode='tail'
                        style={[styles.itemCategoryChipText, { color: selected ? '#FFFFFF' : theme.pillText }]}
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
                      <View style={[styles.itemSelectPricePill, { backgroundColor: theme.pillBg }]}>
                        <Text style={[styles.itemSelectPriceText, { color: theme.pillText }]}>
                          PHP {product.unitPrice.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                    {product.isLpg ? (
                      <View style={styles.itemFlowPriceRow}>
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
                    <View style={styles.itemStockMetrics}>
                      <View style={[styles.itemStockChip, { backgroundColor: theme.pillBg }]}>
                        <Text style={[styles.itemStockChipLabel, { color: theme.subtext }]}>FULL</Text>
                        <Text style={[styles.itemStockChipValue, { color: theme.heading }]}>{formatQty(product.qtyFull)}</Text>
                      </View>
                      <View style={[styles.itemStockChip, { backgroundColor: theme.pillBg }]}>
                        <Text style={[styles.itemStockChipLabel, { color: theme.subtext }]}>EMPTY</Text>
                        <Text style={[styles.itemStockChipValue, { color: theme.heading }]}>{formatQty(product.qtyEmpty)}</Text>
                      </View>
                      <View style={[styles.itemStockChip, { backgroundColor: theme.pillBg }]}>
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
          <View style={[styles.modalCard, styles.paymentModalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[styles.modalTitle, { color: theme.heading }]}>Payment Details</Text>
            <Text style={[styles.paymentHint, { color: theme.subtext }]}>
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

              <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Payment Type</Text>
              <View style={styles.row}>
                {(['FULL', 'PARTIAL'] as const).map((mode) => {
                  const selected = paymentMode === mode;
                  return (
                    <Pressable
                      key={mode}
                      style={[
                        styles.methodPill,
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
                      <Text style={{ color: selected ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: 12 }}>{mode}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: theme.subtext }]}>Payment Method</Text>
              <View style={styles.row}>
                {(['CASH', 'CARD', 'E_WALLET'] as const).map((method) => {
                  const selected = method === paymentMethod;
                  return (
                    <Pressable
                      key={method}
                      style={[
                        styles.methodPill,
                        {
                          backgroundColor: selected ? theme.primary : theme.pillBg
                        }
                      ]}
                      onPress={() => setPaymentMethod(method)}
                      disabled={saving}
                    >
                      <Text style={{ color: selected ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: 12 }}>{method}</Text>
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

              <View style={styles.paymentKpiRow}>
                <View style={[styles.paymentKpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.paymentKpiLabel, { color: theme.subtext }]}>Total</Text>
                  <Text style={[styles.paymentKpiValue, { color: theme.heading }]}>PHP {total.toFixed(2)}</Text>
                </View>
                <View style={[styles.paymentKpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.paymentKpiLabel, { color: theme.subtext }]}>Paid</Text>
                  <Text style={[styles.paymentKpiValue, { color: theme.heading }]}>PHP {parsedPaidAmount.toFixed(2)}</Text>
                </View>
              </View>

              <View style={styles.paymentKpiRow}>
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
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Applied Payment: PHP {appliedPaidAmount.toFixed(2)}</Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Credit Due: PHP {creditBalance.toFixed(2)}</Text>
                <Text style={[styles.summaryText, { color: theme.subtext }]}>Mode: {paymentMode}</Text>
              </View>
            </ScrollView>

            <View style={styles.paymentModalActions}>
              <Pressable
                onPress={() => setShowPaymentStep(false)}
                disabled={saving}
                style={[styles.modalSecondaryBtn, { backgroundColor: saving ? theme.primaryMuted : theme.pillBg }]}
              >
                <Text style={[styles.modalSecondaryText, { color: saving ? '#FFFFFF' : theme.pillText }]}>Back</Text>
              </Pressable>
              <Pressable
                style={[styles.modalPrimaryBtn, { backgroundColor: saving || !paymentReady ? theme.primaryMuted : theme.primary }]}
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
    backgroundColor: 'rgba(10, 16, 28, 0.56)',
    paddingHorizontal: 16,
    paddingVertical: 28,
    justifyContent: 'center'
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 16,
    maxHeight: '78%',
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
    borderRadius: 18,
    width: '100%',
    maxHeight: '92%',
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
