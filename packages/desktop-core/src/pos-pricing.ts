import type {
  DesktopCylinderFlowSelection,
  DesktopMasterDataRow,
  DesktopOption,
  DesktopPosRewardRecord,
  DesktopPosRewardType,
  DesktopSaleType
} from './schema';

export type DesktopPosPriceRule = {
  productId: string;
  flowMode: 'ANY' | DesktopCylinderFlowSelection;
  unitPrice: number;
  priority: number;
};

export type DesktopPosPriceList = {
  id: string;
  scope: 'GLOBAL' | 'BRANCH' | 'TIER' | 'CUSTOMER_GROUP' | 'CONTRACT';
  branchId: string | null;
  customerTier: string | null;
  customerCategoryId: string | null;
  customerId: string | null;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  rules: DesktopPosPriceRule[];
};

export type DesktopRewardCartLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
  isLpg: boolean;
  cylinderFlow?: DesktopCylinderFlowSelection | null;
};

export type DesktopRewardValue = {
  baseAmount: number;
  itemDiscount: number;
  deliveryDiscount: number;
  totalDiscount: number;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePayload(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value !== 'string') return value;
  try { return asRecord(JSON.parse(value)); }
  catch { return {}; }
}

function parseDateMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDesktopPosPriceLists(rows: DesktopMasterDataRow[]): DesktopPosPriceList[] {
  const scopes = new Set<DesktopPosPriceList['scope']>(['GLOBAL', 'BRANCH', 'TIER', 'CUSTOMER_GROUP', 'CONTRACT']);
  const lists: DesktopPosPriceList[] = [];
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    const scope = (asString(payload['scope']) ?? 'GLOBAL').toUpperCase() as DesktopPosPriceList['scope'];
    const id = asString(payload['id']) ?? row.recordId;
    const startsAt = asString(payload['startsAt'] ?? payload['starts_at']) ?? row.updatedAt;
    if (!id || !scopes.has(scope) || parseDateMs(startsAt) === null) continue;
    const rules = (Array.isArray(payload['rules']) ? payload['rules'] : []).map((value) => {
      const rule = asRecord(value);
      const productId = asString(rule['productId'] ?? rule['product_id']);
      const unitPrice = asNumber(rule['unitPrice'] ?? rule['unit_price']);
      const flow = (asString(rule['flowMode'] ?? rule['flow_mode']) ?? 'ANY').toUpperCase();
      if (!productId || unitPrice === null) return null;
      return {
        productId,
        unitPrice: round2(unitPrice),
        priority: asNumber(rule['priority']) ?? 0,
        flowMode: flow === 'REFILL_EXCHANGE' || flow === 'NON_REFILL' ? flow : 'ANY'
      } satisfies DesktopPosPriceRule;
    }).filter((rule): rule is DesktopPosPriceRule => Boolean(rule));
    lists.push({
      id,
      scope,
      branchId: asString(payload['branchId'] ?? payload['branch_id']),
      customerTier: asString(payload['customerTier'] ?? payload['customer_tier'])?.toUpperCase() ?? null,
      customerCategoryId: asString(payload['customerCategoryId'] ?? payload['customer_category_id']),
      customerId: asString(payload['customerId'] ?? payload['customer_id']),
      startsAt,
      endsAt: asString(payload['endsAt'] ?? payload['ends_at']),
      isActive: payload['isActive'] !== false && payload['is_active'] !== false,
      rules
    });
  }
  return lists;
}

export function resolveDesktopUnitPrice(input: {
  productId: string;
  branchId: string;
  customer: DesktopOption | null;
  priceLists: DesktopPosPriceList[];
  allowCustomPricing: boolean;
  atIso?: string;
  flowMode?: DesktopCylinderFlowSelection | null;
}): number | null {
  const atMs = parseDateMs(input.atIso ?? new Date().toISOString());
  if (atMs === null) return null;
  const active = input.priceLists.filter((list) => {
    const start = parseDateMs(list.startsAt);
    const end = parseDateMs(list.endsAt);
    return list.isActive && start !== null && start <= atMs && (end === null || end >= atMs);
  });
  const pick = (lists: DesktopPosPriceList[]): number | null => {
    const matches = lists.flatMap((list) => list.rules.filter((rule) => rule.productId === input.productId).map((rule) => {
      const flowRank = !input.flowMode
        ? rule.flowMode === 'ANY' ? 0 : null
        : rule.flowMode === input.flowMode ? 0 : rule.flowMode === 'ANY' ? 1 : null;
      return flowRank === null ? null : { ...rule, flowRank };
    })).filter((rule): rule is DesktopPosPriceRule & { flowRank: number } => Boolean(rule));
    matches.sort((a, b) => a.flowRank - b.flowRank || a.priority - b.priority);
    return matches.length ? round2(matches[0].unitPrice) : null;
  };
  const contract = pick(active.filter((list) => list.scope === 'CONTRACT' && list.customerId === input.customer?.id));
  if (contract !== null) return contract;
  if (input.allowCustomPricing && input.customer?.customerCategoryId) {
    const group = pick(active.filter((list) => list.scope === 'CUSTOMER_GROUP' && list.customerCategoryId === input.customer?.customerCategoryId));
    if (group !== null) return group;
  }
  if (input.customer?.contractPrice && input.customer.contractPrice > 0) return round2(input.customer.contractPrice);
  const tier = pick(active.filter((list) => list.scope === 'TIER' && list.customerTier === input.customer?.tier?.toUpperCase()));
  if (tier !== null) return tier;
  const branch = pick(active.filter((list) => list.scope === 'BRANCH' && list.branchId === input.branchId));
  if (branch !== null) return branch;
  return pick(active.filter((list) => list.scope === 'GLOBAL'));
}

function isRewardType(value: string | null): value is DesktopPosRewardType {
  return value === 'DISCOUNT_FIXED' || value === 'DISCOUNT_PERCENT' || value === 'FREE_DELIVERY' || value === 'FREE_PRODUCT' || value === 'FREE_REFILL';
}

export function parseDesktopPosReward(value: string | Record<string, unknown>): DesktopPosRewardRecord | null {
  const row = parsePayload(value);
  const id = asString(row['id']);
  const rewardType = asString(row['rewardType'] ?? row['reward_type'])?.toUpperCase() ?? null;
  if (!id || !isRewardType(rewardType)) return null;
  const statusValue = asString(row['status'])?.toUpperCase();
  const status: DesktopPosRewardRecord['status'] = statusValue === 'DRAFT' || statusValue === 'INACTIVE' || statusValue === 'ARCHIVED' ? statusValue : 'ACTIVE';
  return {
    id,
    code: asString(row['code']) ?? id,
    name: asString(row['name']) ?? id,
    description: asString(row['description']),
    rewardType,
    pointsCost: Math.max(0, asNumber(row['pointsCost'] ?? row['points_cost']) ?? 0),
    productId: asString(row['productId'] ?? row['product_id']),
    freeQty: asNumber(row['freeQty'] ?? row['free_qty']),
    discountValue: asNumber(row['discountValue'] ?? row['discount_value']),
    minSpend: asNumber(row['minSpend'] ?? row['min_spend']),
    status
  };
}

export function resolveDesktopRewardValue(input: {
  reward: DesktopPosRewardRecord;
  lines: DesktopRewardCartLine[];
  subtotal: number;
  manualDiscount: number;
  saleType: DesktopSaleType;
  deliveryFee: number;
}): DesktopRewardValue {
  const merchandiseBase = round2(Math.max(0, input.subtotal - input.manualDiscount));
  const baseAmount = round2(merchandiseBase + (input.saleType === 'DELIVERY' ? Math.max(0, input.deliveryFee) : 0));
  let itemDiscount = 0;
  let deliveryDiscount = 0;
  if (input.reward.rewardType === 'DISCOUNT_FIXED') {
    itemDiscount = Math.min(merchandiseBase, Math.max(0, input.reward.discountValue ?? 0));
  } else if (input.reward.rewardType === 'DISCOUNT_PERCENT') {
    itemDiscount = Math.min(merchandiseBase, merchandiseBase * Math.max(0, input.reward.discountValue ?? 0) / 100);
  } else if (input.reward.rewardType === 'FREE_PRODUCT') {
    const target = input.lines.find((line) => line.productId === input.reward.productId && !line.isLpg);
    if (target) itemDiscount = Math.min(merchandiseBase, Math.min(target.quantity, Math.max(1, input.reward.freeQty ?? 1)) * target.unitPrice);
  } else if (input.reward.rewardType === 'FREE_REFILL') {
    let remaining = Math.max(1, input.reward.freeQty ?? 1);
    for (const line of input.lines.filter((entry) => entry.isLpg && entry.cylinderFlow === 'REFILL_EXCHANGE' && (!input.reward.productId || entry.productId === input.reward.productId))) {
      const quantity = Math.min(line.quantity, remaining);
      itemDiscount += quantity * line.unitPrice;
      remaining -= quantity;
      if (remaining <= 0) break;
    }
    itemDiscount = Math.min(merchandiseBase, itemDiscount);
  } else if (input.reward.rewardType === 'FREE_DELIVERY' && input.saleType === 'DELIVERY') {
    deliveryDiscount = Math.max(0, input.deliveryFee);
  }
  itemDiscount = round2(itemDiscount);
  deliveryDiscount = round2(deliveryDiscount);
  return { baseAmount, itemDiscount, deliveryDiscount, totalDiscount: round2(itemDiscount + deliveryDiscount) };
}

export function isDesktopRewardEligible(input: {
  reward: DesktopPosRewardRecord;
  customer: DesktopOption | null;
  lines: DesktopRewardCartLine[];
  subtotal: number;
  manualDiscount: number;
  saleType: DesktopSaleType;
  deliveryFee: number;
}): boolean {
  if (!input.customer || input.reward.status !== 'ACTIVE') return false;
  if (input.reward.pointsCost > (input.customer.pointsBalance ?? 0)) return false;
  const value = resolveDesktopRewardValue(input);
  if (input.reward.minSpend !== null && value.baseAmount < input.reward.minSpend) return false;
  if (input.reward.rewardType === 'FREE_DELIVERY' && input.saleType !== 'DELIVERY') return false;
  if ((input.reward.rewardType === 'FREE_PRODUCT' || input.reward.rewardType === 'FREE_REFILL') && value.totalDiscount <= 0) return false;
  return value.totalDiscount > 0;
}
