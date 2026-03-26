'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../../lib/api-client';
import { toastError, toastInfo, toastSuccess } from '../../../lib/web-toast';

type Branch = { id: string; code: string; name: string; isActive: boolean };
type Customer = { id: string; code: string; name: string };
type ProductOption = { id: string; code?: string | null; name: string; sku?: string | null };
type InventoryCard = {
  id: string;
  card_uid: string;
  card_number: string;
  serial_number: string | null;
  status: 'UNASSIGNED' | 'ASSIGNED' | 'INACTIVE' | 'REVOKED';
  branch_id: string | null;
  location_id: string | null;
  updated_at: string;
};
type CustomerCard = {
  id: string;
  customer: { id: string; code: string; name: string; points_balance: number };
  card: InventoryCard;
  status: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  assigned_at: string;
};
type PointsPolicy = {
  earn_peso_per_point: number;
  redeem_peso_per_point: number;
  min_spend_for_earn: number;
  max_redeem_points_per_txn: number | null;
  points_expiry_days: number | null;
  updated_at: string;
};
type PointsLedger = {
  id: string;
  customer_id: string;
  txn_type: string;
  points: number;
  source_type: string;
  remarks: string | null;
  created_at: string;
};
type RewardType =
  | 'DISCOUNT_FIXED'
  | 'DISCOUNT_PERCENT'
  | 'FREE_PRODUCT'
  | 'FREE_DELIVERY'
  | 'FREE_SERVICE'
  | 'FREE_REFILL'
  | 'VOUCHER';
type RewardStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
type RewardRecord = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  reward_type: RewardType;
  status: RewardStatus;
  points_cost: number;
  product_id: string | null;
  free_qty: number | null;
  discount_value: number | null;
  min_spend: number | null;
  max_discount_amount: number | null;
  stackable: boolean;
  per_customer_limit: number | null;
  daily_limit: number | null;
  valid_from: string | null;
  valid_to: string | null;
  updated_at: string;
  scopes: Array<{ id: string; branch_id: string | null; location_id: string | null }>;
};
type RewardRedemptionStatus = 'RESERVED' | 'APPLIED' | 'CANCELLED' | 'VOIDED' | 'EXPIRED';
type RewardRedemptionRecord = {
  id: string;
  customer_id: string;
  card_inventory_id: string | null;
  reward_id: string;
  sale_id: string | null;
  status: RewardRedemptionStatus;
  points_spent: number;
  value_applied: number | null;
  remarks: string | null;
  metadata: Record<string, unknown>;
  redeemed_at: string;
  applied_at: string | null;
  cancelled_at: string | null;
  voided_at: string | null;
  expires_at: string | null;
  reward: RewardRecord;
};
type CustomerCardsTab =
  | 'customer-cards'
  | 'points-policy'
  | 'points-actions'
  | 'rewards-catalog'
  | 'redemption-history';
type AssignmentFilter = 'ALL' | 'ASSIGNED' | 'UNASSIGNED';
type RewardFormState = {
  id: string | null;
  code: string;
  name: string;
  description: string;
  rewardType: RewardType;
  status: RewardStatus;
  pointsCost: string;
  productId: string;
  discountValue: string;
  freeQty: string;
  minSpend: string;
  maxDiscountAmount: string;
  stackable: boolean;
  perCustomerLimit: string;
  dailyLimit: string;
  validFrom: string;
  validTo: string;
};

function hashText(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function maskCardNumber(value: string): string {
  const normalized = value.replace(/\s+/g, '');
  if (normalized.length <= 4) return normalized;
  const tail = normalized.slice(-4);
  return `•••• •••• •••• ${tail}`;
}

const CARD_THEME_CLASSES = [
  'from-indigo-700 via-blue-600 to-cyan-500',
  'from-fuchsia-600 via-purple-600 to-indigo-600',
  'from-slate-900 via-slate-800 to-slate-700',
  'from-pink-600 via-rose-500 to-orange-400',
  'from-emerald-700 via-teal-600 to-cyan-500',
  'from-violet-700 via-purple-700 to-fuchsia-600'
];

function fmtDate(value: string | null | undefined): string {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function parseNum(v: string, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseOpt(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function emptyRewardForm(): RewardFormState {
  return {
    id: null,
    code: '',
    name: '',
    description: '',
    rewardType: 'DISCOUNT_FIXED',
    status: 'ACTIVE',
    pointsCost: '',
    productId: '',
    discountValue: '',
    freeQty: '',
    minSpend: '',
    maxDiscountAmount: '',
    stackable: false,
    perCustomerLimit: '',
    dailyLimit: '',
    validFrom: '',
    validTo: ''
  };
}

export default function CustomerCardsPage(): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [branchId, setBranchId] = useState('');
  const [customerId, setCustomerId] = useState('');

  const [inventoryCards, setInventoryCards] = useState<InventoryCard[]>([]);
  const [customerCards, setCustomerCards] = useState<CustomerCard[]>([]);
  const [reassignCustomerId, setReassignCustomerId] = useState('');

  const [policy, setPolicy] = useState<PointsPolicy | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [earnRatio, setEarnRatio] = useState('100');
  const [redeemRatio, setRedeemRatio] = useState('1');
  const [minSpend, setMinSpend] = useState('0');
  const [maxRedeem, setMaxRedeem] = useState('');
  const [expiryDays, setExpiryDays] = useState('');

  const [pointsBusy, setPointsBusy] = useState(false);
  const [pointsCustomerId, setPointsCustomerId] = useState('');
  const [pointsCardId, setPointsCardId] = useState('');
  const [pointsAmount, setPointsAmount] = useState('');
  const [pointsValue, setPointsValue] = useState('');
  const [pointsRemarks, setPointsRemarks] = useState('');
  const [ledger, setLedger] = useState<PointsLedger[]>([]);
  const [rewards, setRewards] = useState<RewardRecord[]>([]);
  const [rewardsBusy, setRewardsBusy] = useState(false);
  const [rewardSearch, setRewardSearch] = useState('');
  const [rewardHistory, setRewardHistory] = useState<RewardRedemptionRecord[]>([]);
  const [rewardHistoryBusy, setRewardHistoryBusy] = useState(false);
  const [rewardHistoryStatus, setRewardHistoryStatus] = useState<'ALL' | RewardRedemptionStatus>('ALL');
  const [rewardModalOpen, setRewardModalOpen] = useState(false);
  const [rewardForm, setRewardForm] = useState<RewardFormState>(emptyRewardForm);
  const [activeTab, setActiveTab] = useState<CustomerCardsTab>('customer-cards');
  const [cardSearch, setCardSearch] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('ALL');
  const [assignConfirm, setAssignConfirm] = useState<{
    cardId: string;
    cardNumber: string;
  } | null>(null);
  const [cardActionCardId, setCardActionCardId] = useState<string | null>(null);
  const [assignTargetCustomerId, setAssignTargetCustomerId] = useState('');
  const [assignCustomerSearch, setAssignCustomerSearch] = useState('');
  const selectedBranch = useMemo(
    () => branches.find((row) => row.id === branchId) ?? null,
    [branches, branchId]
  );
  const customerNameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const filteredAssignCustomers = useMemo(() => {
    const query = assignCustomerSearch.trim().toLowerCase();
    return customers.filter((row) => {
      if (!query) {
        return true;
      }
      return (
        row.name.toLowerCase().includes(query) ||
        row.code.toLowerCase().includes(query)
      );
    });
  }, [assignCustomerSearch, customers]);
  const assignedByInventoryId = useMemo(() => {
    const map = new Map<string, CustomerCard>();
    for (const row of customerCards) {
      if (row.status !== 'ACTIVE') {
        continue;
      }
      map.set(row.card.id, row);
    }
    return map;
  }, [customerCards]);
  const visualCards = useMemo(() => {
    const search = cardSearch.trim().toLowerCase();
    return inventoryCards
      .map((card) => {
        const assigned = assignedByInventoryId.get(card.id) ?? null;
        const isAssigned = card.status === 'ASSIGNED' || Boolean(assigned);
        return {
          ...card,
          customerName: assigned?.customer.name ?? null,
          isAssigned
        };
      })
      .filter((row) => {
        if (assignmentFilter === 'ASSIGNED' && !row.isAssigned) {
          return false;
        }
        if (assignmentFilter === 'UNASSIGNED' && row.isAssigned) {
          return false;
        }
        if (!search) {
          return true;
        }
        return (
          (row.customerName ?? '').toLowerCase().includes(search) ||
          row.card_number.toLowerCase().includes(search) ||
          (row.serial_number ?? '').toLowerCase().includes(search)
        );
      });
  }, [assignedByInventoryId, assignmentFilter, cardSearch, inventoryCards]);
  const activeActionCard = useMemo(
    () => (cardActionCardId ? visualCards.find((row) => row.id === cardActionCardId) ?? null : null),
    [cardActionCardId, visualCards]
  );
  const activeActionBinding = useMemo(
    () => (activeActionCard ? assignedByInventoryId.get(activeActionCard.id) ?? null : null),
    [activeActionCard, assignedByInventoryId]
  );
  const filteredRewards = useMemo(() => {
    const query = rewardSearch.trim().toLowerCase();
    return rewards.filter((reward) => {
      if (!query) {
        return true;
      }
      return (
        reward.name.toLowerCase().includes(query) ||
        reward.code.toLowerCase().includes(query) ||
        (reward.description ?? '').toLowerCase().includes(query)
      );
    });
  }, [rewardSearch, rewards]);

  function getErrorMessage(cause: unknown, fallback: string): string {
    if (cause instanceof Error && cause.message.trim()) {
      return cause.message;
    }
    return fallback;
  }

  async function loadBase(): Promise<void> {
    const [b, c, p] = await Promise.all([
      apiRequest<Branch[]>('/master-data/branches'),
      apiRequest<Customer[]>('/master-data/customers'),
      apiRequest<ProductOption[]>('/master-data/products')
    ]);
    const active = (b ?? []).filter((x) => x.isActive);
    setBranches(active);
    setCustomers(c ?? []);
    setProducts(p ?? []);
    setBranchId((current) => (current && active.some((x) => x.id === current) ? current : active[0]?.id ?? ''));
    setCustomerId((current) => (current && (c ?? []).some((x) => x.id === current) ? current : c?.[0]?.id ?? ''));
    setReassignCustomerId((current) => (current && (c ?? []).some((x) => x.id === current) ? current : c?.[0]?.id ?? ''));
  }

  async function loadCards(): Promise<void> {
    if (!branchId) {
      setInventoryCards([]);
      setCustomerCards([]);
      return;
    }
    const [inventory, bound] = await Promise.all([
      apiRequest<InventoryCard[]>(`/vcard/inventory/cards?branch_id=${encodeURIComponent(branchId)}&limit=300`),
      apiRequest<CustomerCard[]>('/vcard/cards?limit=300')
    ]);
    const branchBound = (bound ?? []).filter((row) => row.card.branch_id === branchId);
    setInventoryCards(inventory ?? []);
    setCustomerCards(branchBound);
    setCardActionCardId((current) => {
      if (current && (inventory ?? []).some((x) => x.id === current)) return current;
      return null;
    });
  }

  async function loadPolicy(): Promise<void> {
    const p = await apiRequest<PointsPolicy>('/vcard/points/policy');
    setPolicy(p);
    setEarnRatio(String(p.earn_peso_per_point));
    setRedeemRatio(String(p.redeem_peso_per_point));
    setMinSpend(String(p.min_spend_for_earn));
    setMaxRedeem(p.max_redeem_points_per_txn == null ? '' : String(p.max_redeem_points_per_txn));
    setExpiryDays(p.points_expiry_days == null ? '' : String(p.points_expiry_days));
  }

  async function loadRewards(): Promise<void> {
    if (!branchId) {
      setRewards([]);
      return;
    }
    const rows = await apiRequest<RewardRecord[]>(
      `/vcard/rewards?branch_id=${encodeURIComponent(branchId)}&limit=200`
    );
    setRewards(rows ?? []);
  }

  async function loadRewardHistory(): Promise<void> {
    if (!branchId) {
      setRewardHistory([]);
      return;
    }
    const rows = await apiRequest<RewardRedemptionRecord[]>(
      '/vcard/rewards/redemptions?limit=300'
    );
    setRewardHistory(rows ?? []);
  }

  async function loadLedger(targetCustomerId?: string): Promise<void> {
    const q = new URLSearchParams({ limit: '200' });
    if (targetCustomerId?.trim()) q.set('customer_id', targetCustomerId.trim());
    const rows = await apiRequest<PointsLedger[]>(`/vcard/points/ledger?${q.toString()}`);
    setLedger(rows ?? []);
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadBase();
        await loadPolicy();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to load page.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!branchId) return;
    void loadCards().catch((cause) => {
      const message = getErrorMessage(cause, 'Failed to load cards.');
      setError(message);
      toastError('Load cards failed', { description: message });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    if (!branchId) return;
    void loadRewards().catch((cause) => {
      const message = getErrorMessage(cause, 'Failed to load rewards.');
      setError(message);
      toastError('Load rewards failed', { description: message });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    if (!branchId) return;
    void loadRewardHistory().catch((cause) => {
      const message = getErrorMessage(cause, 'Failed to load redemption history.');
      setError(message);
      toastError('Load redemption history failed', { description: message });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  useEffect(() => {
    if (!pointsCustomerId) return;
    void loadLedger(pointsCustomerId).catch((cause) => {
      const message = getErrorMessage(cause, 'Failed to load points ledger.');
      setError(message);
      toastError('Load points ledger failed', { description: message });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsCustomerId]);

  async function refresh(): Promise<void> {
    setBusy(true);
    try {
      await Promise.all([
        loadCards(),
        loadPolicy(),
        loadLedger(pointsCustomerId),
        loadRewards(),
        loadRewardHistory()
      ]);
      toastSuccess('Data refreshed');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to refresh.';
      setError(message);
      toastError('Refresh failed', { description: message });
    } finally {
      setBusy(false);
    }
  }

  async function assign(cardId: string, targetCustomerId: string): Promise<boolean> {
    if (!targetCustomerId || !cardId) {
      toastInfo('Target customer is required.');
      return false;
    }
    setBusy(true);
    try {
      await apiRequest('/vcard/cards/assign', {
        method: 'POST',
        body: { customer_id: targetCustomerId, card_inventory_id: cardId }
      });
      toastSuccess('Card assigned');
      setCustomerId(targetCustomerId);
      setPointsCustomerId(targetCustomerId);
      await loadCards();
      await loadLedger(targetCustomerId);
      return true;
    } catch (cause) {
      toastError('Assign failed', { description: cause instanceof Error ? cause.message : 'Failed' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function openCardActions(card: { id: string; card_number: string; isAssigned: boolean }): Promise<void> {
    if (customers.length === 0) {
      toastInfo('No customers available for assignment.');
      return;
    }
    const bound = assignedByInventoryId.get(card.id) ?? null;
    const defaultCustomerId = bound?.customer.id || customerId || customers[0]?.id || '';
    setAssignTargetCustomerId(defaultCustomerId);
    setReassignCustomerId(defaultCustomerId);
    setAssignCustomerSearch('');
    setCardActionCardId(card.id);
    setAssignConfirm({
      cardId: card.id,
      cardNumber: card.card_number
    });
  }

  async function confirmAssignCard(): Promise<void> {
    if (!assignConfirm) {
      return;
    }
    if (!assignTargetCustomerId) {
      toastInfo('Select customer to continue.');
      return;
    }
    const ok = await assign(assignConfirm.cardId, assignTargetCustomerId);
    if (ok) {
      setAssignConfirm(null);
      setCardActionCardId(null);
      setAssignTargetCustomerId('');
      setAssignCustomerSearch('');
    }
  }

  async function reassignFromCardModal(): Promise<void> {
    if (!activeActionBinding) return;
    if (!reassignCustomerId) {
      toastInfo('Select customer for reassign');
      return;
    }
    setBusy(true);
    try {
      await apiRequest(`/vcard/cards/${encodeURIComponent(activeActionBinding.id)}/reassign`, {
        method: 'PATCH',
        body: { customer_id: reassignCustomerId }
      });
      toastSuccess('Card reassigned');
      setPointsCustomerId(reassignCustomerId);
      setAssignTargetCustomerId(reassignCustomerId);
      await loadCards();
      await loadLedger(reassignCustomerId);
    } catch (cause) {
      toastError('Reassign failed', { description: cause instanceof Error ? cause.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  function openPointsForCard(): void {
    if (!activeActionBinding) return;
    setPointsCustomerId(activeActionBinding.customer.id);
    setPointsCardId(activeActionBinding.card.id);
    setActiveTab('points-actions');
    toastInfo('Opened Points Actions for selected card');
    setCardActionCardId(null);
    setAssignConfirm(null);
  }

  async function doStatus(id: string, status: 'ACTIVE' | 'INACTIVE' | 'REVOKED'): Promise<void> {
    setBusy(true);
    try {
      await apiRequest(`/vcard/cards/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: { status }
      });
      toastSuccess(`Card is now ${status.toLowerCase()}`);
      await loadCards();
    } catch (cause) {
      toastError('Status update failed', { description: cause instanceof Error ? cause.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  async function unassign(id: string): Promise<void> {
    setBusy(true);
    try {
      await apiRequest(`/vcard/cards/${encodeURIComponent(id)}/unassign`, { method: 'PATCH', body: {} });
      toastSuccess('Card unassigned');
      await loadCards();
    } catch (cause) {
      toastError('Unassign failed', { description: cause instanceof Error ? cause.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  async function savePolicy(): Promise<void> {
    setPolicyBusy(true);
    try {
      await apiRequest('/vcard/points/policy', {
        method: 'PUT',
        body: {
          earn_peso_per_point: parseNum(earnRatio, 100),
          redeem_peso_per_point: parseNum(redeemRatio, 1),
          min_spend_for_earn: parseNum(minSpend, 0),
          max_redeem_points_per_txn: parseOpt(maxRedeem),
          points_expiry_days: parseOpt(expiryDays)
        }
      });
      await loadPolicy();
      toastSuccess('Points policy saved');
    } catch (cause) {
      toastError('Policy save failed', { description: cause instanceof Error ? cause.message : 'Failed' });
    } finally {
      setPolicyBusy(false);
    }
  }

  async function submitPoints(action: 'earn' | 'redeem' | 'adjust'): Promise<void> {
    if (!pointsCustomerId) {
      toastInfo('Select customer first');
      return;
    }
    setPointsBusy(true);
    try {
      if (action === 'earn') {
        await apiRequest('/vcard/points/earn', {
          method: 'POST',
          body: {
            customer_id: pointsCustomerId,
            card_inventory_id: pointsCardId || null,
            amount: parseOpt(pointsAmount),
            points: parseOpt(pointsValue),
            remarks: pointsRemarks || null
          }
        });
      } else if (action === 'redeem') {
        await apiRequest('/vcard/points/redeem', {
          method: 'POST',
          body: {
            customer_id: pointsCustomerId,
            card_inventory_id: pointsCardId || null,
            amount: parseOpt(pointsAmount),
            points: parseNum(pointsValue, 0),
            remarks: pointsRemarks || null
          }
        });
      } else {
        await apiRequest('/vcard/points/adjust', {
          method: 'POST',
          body: {
            customer_id: pointsCustomerId,
            card_inventory_id: pointsCardId || null,
            delta_points: parseNum(pointsValue, 0),
            remarks: pointsRemarks || null
          }
        });
      }
      toastSuccess(`Points ${action} recorded`);
      await loadCards();
      await loadLedger(pointsCustomerId);
    } catch (cause) {
      toastError(`Points ${action} failed`, { description: cause instanceof Error ? cause.message : 'Failed' });
    } finally {
      setPointsBusy(false);
    }
  }

  function openCreateReward(): void {
    setRewardForm(emptyRewardForm());
    setRewardModalOpen(true);
  }

  function openEditReward(reward: RewardRecord): void {
    setRewardForm({
      id: reward.id,
      code: reward.code,
      name: reward.name,
      description: reward.description ?? '',
      rewardType: reward.reward_type,
      status: reward.status,
      pointsCost: String(reward.points_cost),
      productId: reward.product_id ?? '',
      discountValue: reward.discount_value == null ? '' : String(reward.discount_value),
      freeQty: reward.free_qty == null ? '' : String(reward.free_qty),
      minSpend: reward.min_spend == null ? '' : String(reward.min_spend),
      maxDiscountAmount: reward.max_discount_amount == null ? '' : String(reward.max_discount_amount),
      stackable: reward.stackable,
      perCustomerLimit: reward.per_customer_limit == null ? '' : String(reward.per_customer_limit),
      dailyLimit: reward.daily_limit == null ? '' : String(reward.daily_limit),
      validFrom: reward.valid_from ? reward.valid_from.slice(0, 16) : '',
      validTo: reward.valid_to ? reward.valid_to.slice(0, 16) : ''
    });
    setRewardModalOpen(true);
  }

  async function saveReward(): Promise<void> {
    if (!branchId) {
      toastInfo('Select branch first.');
      return;
    }
    if (!rewardForm.code.trim() || !rewardForm.name.trim() || !rewardForm.pointsCost.trim()) {
      toastInfo('Code, name, and points cost are required.');
      return;
    }
    setRewardsBusy(true);
    try {
      const payload = {
        code: rewardForm.code.trim().toUpperCase(),
        name: rewardForm.name.trim(),
        description: rewardForm.description.trim() || null,
        reward_type: rewardForm.rewardType,
        status: rewardForm.status,
        points_cost: parseNum(rewardForm.pointsCost, 0),
        product_id: rewardForm.productId.trim() || null,
        discount_value: parseOpt(rewardForm.discountValue),
        free_qty: parseOpt(rewardForm.freeQty),
        min_spend: parseOpt(rewardForm.minSpend),
        max_discount_amount: parseOpt(rewardForm.maxDiscountAmount),
        stackable: rewardForm.stackable,
        per_customer_limit: parseOpt(rewardForm.perCustomerLimit),
        daily_limit: parseOpt(rewardForm.dailyLimit),
        valid_from: rewardForm.validFrom.trim() || null,
        valid_to: rewardForm.validTo.trim() || null,
        scopes: [{ branch_id: branchId }]
      };
      if (rewardForm.id) {
        await apiRequest(`/vcard/rewards/${encodeURIComponent(rewardForm.id)}`, {
          method: 'PATCH',
          body: payload
        });
        toastSuccess('Reward updated');
      } else {
        await apiRequest('/vcard/rewards', {
          method: 'POST',
          body: payload
        });
        toastSuccess('Reward created');
      }
      setRewardModalOpen(false);
      setRewardForm(emptyRewardForm());
      await Promise.all([loadRewards(), loadRewardHistory()]);
    } catch (cause) {
      toastError('Reward save failed', { description: getErrorMessage(cause, 'Failed to save reward.') });
    } finally {
      setRewardsBusy(false);
    }
  }

  async function updateRewardRedemptionStatus(
    redemption: RewardRedemptionRecord,
    action: 'cancel' | 'void'
  ): Promise<void> {
    const label = action === 'cancel' ? 'cancel' : 'void';
    if (!window.confirm(`Are you sure you want to ${label} this redemption?`)) {
      return;
    }
    setRewardHistoryBusy(true);
    try {
      await apiRequest(`/vcard/rewards/redemptions/${encodeURIComponent(redemption.id)}/${label}`, {
        method: 'PATCH',
        body: {
          remarks:
            action === 'cancel'
              ? 'Cancelled from rewards history'
              : 'Voided from rewards history'
        }
      });
      toastSuccess(`Redemption ${action}ed`);
      await Promise.all([loadRewardHistory(), loadLedger(pointsCustomerId), loadCards()]);
    } catch (cause) {
      toastError(`Unable to ${label} redemption`, {
        description: getErrorMessage(cause, `Failed to ${label} redemption.`)
      });
    } finally {
      setRewardHistoryBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500 dark:text-slate-400">Loading customer cards...</p>;

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-brandPrimary">Customer Cards</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Branch card assignment, revoke/reactivate, and points in one non-technical workflow.</p>
      </div>

      {error ? <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">{error}</div> : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'customer-cards', label: 'Customer Cards' },
            { key: 'rewards-catalog', label: 'Rewards Catalog' },
            { key: 'redemption-history', label: 'Redemption History' },
            { key: 'points-policy', label: 'Points Policy' },
            { key: 'points-actions', label: 'Points Actions' }
          ] as const).map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                activeTab === tab.key
                  ? 'bg-brandPrimary text-white'
                  : 'border border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'customer-cards' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Customer Cards</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="rounded-full border border-slate-300 px-2 py-1 dark:border-slate-700">
              Branch: {selectedBranch ? `${selectedBranch.name} (${selectedBranch.code})` : '-'}
            </span>
            <button type="button" className="rounded-full border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700 disabled:opacity-60" disabled={busy} onClick={() => void refresh()}>
              {busy ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Only cards created for the selected branch are shown. Click any card to open assign/reassign/status/revoke/unassign actions.
          </p>

          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              value={cardSearch}
              onChange={(e) => setCardSearch(e.target.value)}
              placeholder="Search by customer, card number, or serial"
            />
            <div className="flex flex-wrap items-center gap-2">
              {(['ALL', 'ASSIGNED', 'UNASSIGNED'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                    assignmentFilter === value
                      ? 'border-brandPrimary bg-brandPrimary text-white'
                      : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                  onClick={() => setAssignmentFilter(value)}
                >
                  {value === 'ALL' ? 'All Cards' : value}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            Showing {visualCards.length} card(s)
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visualCards.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                No cards found for this filter/search.
              </div>
            ) : (
              visualCards.map((card) => {
                const themeClass = CARD_THEME_CLASSES[hashText(card.id) % CARD_THEME_CLASSES.length];
                const assigned = assignedByInventoryId.get(card.id) ?? null;
                return (
                  <button
                    key={card.id}
                    type="button"
                    className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${themeClass} p-4 text-white shadow-lg transition-transform ${
                      busy ? 'opacity-90' : 'cursor-pointer hover:-translate-y-0.5'
                    }`}
                    onClick={() => void openCardActions(card)}
                    disabled={busy}
                  >
                    <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/20" />
                    <div className="pointer-events-none absolute -bottom-10 -left-10 h-24 w-24 rounded-full bg-white/15" />

                    <div className="relative flex items-start justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-white/90">
                        VMJAMTECH CARD
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${card.isAssigned ? 'bg-emerald-400/25 text-emerald-100' : 'bg-amber-300/25 text-amber-100'}`}>
                        {card.isAssigned ? 'Assigned' : 'Unassigned'}
                      </span>
                    </div>

                    <p className="relative mt-5 font-mono text-lg tracking-[0.18em]">
                      {maskCardNumber(card.card_number)}
                    </p>

                    <div className="relative mt-5 flex items-end justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-white/70">Customer</p>
                        <p className="truncate font-semibold">
                          {card.customerName ?? 'Available for assignment'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wide text-white/70">Serial</p>
                        <p className="font-mono">{card.serial_number ?? '-'}</p>
                      </div>
                    </div>

                    <div className="relative mt-3 flex items-center justify-between text-[11px] text-white/85">
                      <span>Status: {card.status}</span>
                      <span>Points: {assigned?.customer.points_balance ?? 0}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      {activeTab === 'points-policy' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Points Policy</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Updated: {fmtDate(policy?.updated_at ?? null)}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-5">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              <span>Earn Peso Per Point</span>
              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={earnRatio} onChange={(e) => setEarnRatio(e.target.value)} placeholder="100" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              <span>Redeem Peso Per Point</span>
              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={redeemRatio} onChange={(e) => setRedeemRatio(e.target.value)} placeholder="1" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              <span>Minimum Spend For Earn</span>
              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} placeholder="0" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              <span>Max Redeem Points (Optional)</span>
              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={maxRedeem} onChange={(e) => setMaxRedeem(e.target.value)} placeholder="Unlimited" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              <span>Points Expiry Days (Optional)</span>
              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} placeholder="No expiry" />
            </label>
          </div>
          <button type="button" className="mt-3 rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={policyBusy} onClick={() => void savePolicy()}>{policyBusy ? 'Saving...' : 'Save Policy'}</button>
        </div>
      ) : null}

      {activeTab === 'points-actions' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Points Actions</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-5">
            <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={pointsCustomerId} onChange={(e) => setPointsCustomerId(e.target.value)}>
              <option value="">Select customer...</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </select>
            <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={pointsCardId} onChange={(e) => setPointsCardId(e.target.value)} placeholder="Card ID (optional)" />
            <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={pointsAmount} onChange={(e) => setPointsAmount(e.target.value)} placeholder="Amount (optional)" />
            <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={pointsValue} onChange={(e) => setPointsValue(e.target.value)} placeholder="Points / Delta" />
            <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-800" value={pointsRemarks} onChange={(e) => setPointsRemarks(e.target.value)} placeholder="Remarks" />
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60" disabled={pointsBusy} onClick={() => void submitPoints('earn')}>Earn</button>
            <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60" disabled={pointsBusy} onClick={() => void submitPoints('redeem')}>Redeem</button>
            <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60" disabled={pointsBusy} onClick={() => void submitPoints('adjust')}>Adjust</button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Points</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Remarks</th></tr></thead>
              <tbody>
                {ledger.length === 0 ? <tr><td className="px-3 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={6}>No points transactions found.</td></tr> : ledger.slice(0, 100).map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2">{fmtDate(row.created_at)}</td>
                    <td className="px-3 py-2">{customerNameById.get(row.customer_id) ?? row.customer_id}</td>
                    <td className="px-3 py-2">{row.txn_type}</td>
                    <td className="px-3 py-2">{row.points}</td>
                    <td className="px-3 py-2">{row.source_type}</td>
                    <td className="px-3 py-2">{row.remarks ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === 'rewards-catalog' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Rewards Catalog</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Build branch reward offers that POS can redeem during checkout.
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              onClick={openCreateReward}
              disabled={rewardsBusy || !branchId}
            >
              Add Reward
            </button>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              value={rewardSearch}
              onChange={(e) => setRewardSearch(e.target.value)}
              placeholder="Search reward by name, code, or description"
            />
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
              Branch scope: {selectedBranch ? `${selectedBranch.name} (${selectedBranch.code})` : '-'}
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {filteredRewards.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                No rewards found for this branch yet.
              </div>
            ) : (
              filteredRewards.map((reward) => (
                <button
                  key={reward.id}
                  type="button"
                  className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brandPrimary/40 dark:border-slate-700 dark:bg-slate-950"
                  onClick={() => openEditReward(reward)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{reward.code}</p>
                      <h3 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">{reward.name}</h3>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                      reward.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : reward.status === 'DRAFT'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                    }`}>
                      {reward.status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                    {reward.description?.trim() || 'No description yet.'}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
                      <div className="uppercase tracking-wide text-slate-400">Type</div>
                      <div className="mt-1 font-semibold">{reward.reward_type.replace(/_/g, ' ')}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
                      <div className="uppercase tracking-wide text-slate-400">Points</div>
                      <div className="mt-1 font-semibold">{reward.points_cost}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
                      <div className="uppercase tracking-wide text-slate-400">Discount</div>
                      <div className="mt-1 font-semibold">{reward.discount_value == null ? '-' : `PHP ${reward.discount_value.toFixed(2)}`}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/70">
                      <div className="uppercase tracking-wide text-slate-400">Minimum Spend</div>
                      <div className="mt-1 font-semibold">{reward.min_spend == null ? '-' : `PHP ${reward.min_spend.toFixed(2)}`}</div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    Updated {fmtDate(reward.updated_at)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      {activeTab === 'redemption-history' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Redemption History</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Branch-scoped reward reservations and applications. Staff can cancel reserved rewards or void applied ones.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                value={rewardHistoryStatus}
                onChange={(e) => setRewardHistoryStatus(e.target.value as 'ALL' | RewardRedemptionStatus)}
              >
                {(['ALL', 'RESERVED', 'APPLIED', 'CANCELLED', 'VOIDED', 'EXPIRED'] as const).map((value) => (
                  <option key={value} value={value}>
                    {value === 'ALL' ? 'All Statuses' : value}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60"
                disabled={rewardHistoryBusy}
                onClick={() => void (async () => {
                  setRewardHistoryBusy(true);
                  try {
                    await loadRewardHistory();
                    toastSuccess('Redemption history refreshed');
                  } catch (cause) {
                    toastError('Refresh failed', { description: getErrorMessage(cause, 'Failed to refresh reward history.') });
                  } finally {
                    setRewardHistoryBusy(false);
                  }
                })()}
              >
                {rewardHistoryBusy ? 'Refreshing...' : 'Refresh History'}
              </button>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {rewardHistory
              .filter((row) => {
                const branchMeta = typeof row.metadata.branch_id === 'string' ? row.metadata.branch_id : null;
                const inBranch =
                  branchMeta === branchId ||
                  row.reward.scopes.some((scope) => scope.branch_id === branchId);
                if (!inBranch) {
                  return false;
                }
                if (rewardHistoryStatus !== 'ALL' && row.status !== rewardHistoryStatus) {
                  return false;
                }
                return true;
              })
              .map((row) => {
                const customerLabel = customerNameById.get(row.customer_id) ?? row.customer_id;
                const canCancel = row.status === 'RESERVED';
                const canVoid = row.status === 'RESERVED' || row.status === 'APPLIED';
                return (
                  <div
                    key={row.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
                            {row.reward.code}
                          </span>
                          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                            row.status === 'APPLIED'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                              : row.status === 'RESERVED'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                                : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                          }`}>
                            {row.status}
                          </span>
                        </div>
                        <div>
                          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                            {row.reward.name}
                          </h3>
                          <p className="text-sm text-slate-600 dark:text-slate-300">
                            Customer: {customerLabel}
                          </p>
                        </div>
                        <div className="grid gap-2 text-xs text-slate-500 dark:text-slate-400 md:grid-cols-2 xl:grid-cols-4">
                          <div>Redeemed: {fmtDate(row.redeemed_at)}</div>
                          <div>Points: {row.points_spent}</div>
                          <div>Applied Value: {row.value_applied == null ? '-' : `PHP ${row.value_applied.toFixed(2)}`}</div>
                          <div>Sale ID: {row.sale_id ?? '-'}</div>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Remarks: {row.remarks?.trim() || 'No remarks'}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-60 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
                          disabled={!canCancel || rewardHistoryBusy}
                          onClick={() => void updateRewardRedemptionStatus(row, 'cancel')}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900 disabled:opacity-60 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100"
                          disabled={!canVoid || rewardHistoryBusy}
                          onClick={() => void updateRewardRedemptionStatus(row, 'void')}
                        >
                          Void
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            {rewardHistory.filter((row) => {
              const branchMeta = typeof row.metadata.branch_id === 'string' ? row.metadata.branch_id : null;
              const inBranch =
                branchMeta === branchId ||
                row.reward.scopes.some((scope) => scope.branch_id === branchId);
              if (!inBranch) {
                return false;
              }
              if (rewardHistoryStatus !== 'ALL' && row.status !== rewardHistoryStatus) {
                return false;
              }
              return true;
            }).length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                No reward redemptions found for this branch and filter.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {assignConfirm ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
          onClick={() => {
            setAssignConfirm(null);
            setCardActionCardId(null);
          }}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Card Actions</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Card: <span className="font-semibold text-slate-900 dark:text-slate-100">{maskCardNumber(assignConfirm.cardNumber)}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {activeActionBinding
                ? `Current customer: ${activeActionBinding.customer.name} (${activeActionBinding.customer.code})`
                : 'No customer assigned yet.'}
            </p>
            <input
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
              value={assignCustomerSearch}
              onChange={(e) => setAssignCustomerSearch(e.target.value)}
              placeholder="Search customer..."
            />
            <div className="mt-3 max-h-56 space-y-2 overflow-auto rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              {filteredAssignCustomers.length === 0 ? (
                <p className="px-2 py-1 text-xs text-slate-500 dark:text-slate-400">No customer found.</p>
              ) : (
                filteredAssignCustomers.map((row) => {
                  const active = row.id === assignTargetCustomerId;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                        active
                          ? 'border-brandPrimary bg-brandPrimary/10 text-brandPrimary'
                          : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                      }`}
                      onClick={() => setAssignTargetCustomerId(row.id)}
                    >
                      <div className="font-semibold">{row.name}</div>
                      <div className="text-xs opacity-80">{row.code}</div>
                    </button>
                  );
                })
              )}
            </div>
            {activeActionBinding ? (
              <div className="mt-4 grid gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700 md:grid-cols-2">
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60"
                  onClick={() => void reassignFromCardModal()}
                  disabled={busy || !reassignCustomerId}
                >
                  Reassign
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60"
                  onClick={openPointsForCard}
                  disabled={busy}
                >
                  Open Points Actions
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 disabled:opacity-60"
                  onClick={() => void doStatus(activeActionBinding.id, activeActionBinding.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE')}
                  disabled={busy}
                >
                  {activeActionBinding.status === 'INACTIVE' ? 'Reactivate' : 'Deactivate'}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-100 disabled:opacity-60"
                  onClick={() => void doStatus(activeActionBinding.id, activeActionBinding.status === 'REVOKED' ? 'ACTIVE' : 'REVOKED')}
                  disabled={busy}
                >
                  {activeActionBinding.status === 'REVOKED' ? 'Reactivate' : 'Revoke'}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600 disabled:opacity-60 md:col-span-2"
                  onClick={() => void unassign(activeActionBinding.id)}
                  disabled={busy || activeActionBinding.status === 'REVOKED'}
                >
                  Unassign
                </button>
              </div>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                onClick={() => {
                  setAssignConfirm(null);
                  setCardActionCardId(null);
                }}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={() => void confirmAssignCard()}
                disabled={busy || !assignTargetCustomerId || Boolean(activeActionBinding)}
              >
                {busy ? 'Assigning...' : activeActionBinding ? 'Already Assigned' : 'Confirm Assign'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rewardModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
          onClick={() => {
            if (!rewardsBusy) {
              setRewardModalOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {rewardForm.id ? 'Edit Reward' : 'Create Reward'}
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  This reward will be scoped to the currently selected branch.
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                onClick={() => setRewardModalOpen(false)}
                disabled={rewardsBusy}
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Reward Code</span>
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.code} onChange={(e) => setRewardForm((prev) => ({ ...prev, code: e.target.value }))} placeholder="WELCOME50" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Reward Name</span>
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.name} onChange={(e) => setRewardForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="PHP 50 LPG Discount" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Reward Type</span>
                <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.rewardType} onChange={(e) => setRewardForm((prev) => ({ ...prev, rewardType: e.target.value as RewardType }))}>
                  {(['DISCOUNT_FIXED','DISCOUNT_PERCENT','FREE_PRODUCT','FREE_DELIVERY','FREE_SERVICE','FREE_REFILL','VOUCHER'] as const).map((value) => (
                    <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Status</span>
                <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.status} onChange={(e) => setRewardForm((prev) => ({ ...prev, status: e.target.value as RewardStatus }))}>
                  {(['DRAFT','ACTIVE','INACTIVE','ARCHIVED'] as const).map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="md:col-span-2 xl:col-span-4 flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Description</span>
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.description} onChange={(e) => setRewardForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Short non-technical description shown to staff and customers." />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Points Cost</span>
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.pointsCost} onChange={(e) => setRewardForm((prev) => ({ ...prev, pointsCost: e.target.value }))} placeholder="100" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Product Target</span>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                  value={rewardForm.productId}
                  onChange={(e) => setRewardForm((prev) => ({ ...prev, productId: e.target.value }))}
                >
                  <option value="">No product target</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}{product.code ? ` (${product.code})` : product.sku ? ` (${product.sku})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Discount Value</span>
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.discountValue} onChange={(e) => setRewardForm((prev) => ({ ...prev, discountValue: e.target.value }))} placeholder="50 or 10 for percent" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Free Qty</span>
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.freeQty} onChange={(e) => setRewardForm((prev) => ({ ...prev, freeQty: e.target.value }))} placeholder="1" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Minimum Spend</span>
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.minSpend} onChange={(e) => setRewardForm((prev) => ({ ...prev, minSpend: e.target.value }))} placeholder="500" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Max Discount Amount</span>
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.maxDiscountAmount} onChange={(e) => setRewardForm((prev) => ({ ...prev, maxDiscountAmount: e.target.value }))} placeholder="100" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Per Customer Limit</span>
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.perCustomerLimit} onChange={(e) => setRewardForm((prev) => ({ ...prev, perCustomerLimit: e.target.value }))} placeholder="1" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Daily Limit</span>
                <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.dailyLimit} onChange={(e) => setRewardForm((prev) => ({ ...prev, dailyLimit: e.target.value }))} placeholder="20" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Valid From</span>
                <input type="datetime-local" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.validFrom} onChange={(e) => setRewardForm((prev) => ({ ...prev, validFrom: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Valid To</span>
                <input type="datetime-local" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" value={rewardForm.validTo} onChange={(e) => setRewardForm((prev) => ({ ...prev, validTo: e.target.value }))} />
              </label>
              <label className="mt-5 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={rewardForm.stackable} onChange={(e) => setRewardForm((prev) => ({ ...prev, stackable: e.target.checked }))} />
                Allow stacking with other promos
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200"
                onClick={() => setRewardModalOpen(false)}
                disabled={rewardsBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-brandPrimary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={() => void saveReward()}
                disabled={rewardsBusy}
              >
                {rewardsBusy ? 'Saving...' : rewardForm.id ? 'Save Changes' : 'Create Reward'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
