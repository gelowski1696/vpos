import type { DesktopSalePayload } from '../db/schema';

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCommissionRow(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const productId = asTrimmedString(row.product_id ?? row.productId);
  const personnelName = asTrimmedString(row.personnel_name ?? row.personnelName);
  const commissionAmount = asNumber(row.commission_amount ?? row.commissionAmount);
  if (!productId || !personnelName || commissionAmount === null) {
    return null;
  }
  return {
    product_id: productId,
    product_name: asTrimmedString(row.product_name ?? row.productName) ?? productId,
    personnel_id: asTrimmedString(row.personnel_id ?? row.personnelId),
    personnel_name: personnelName,
    personnel_role: asTrimmedString(row.personnel_role ?? row.personnelRole),
    sale_type: asTrimmedString(row.sale_type ?? row.saleType)?.toUpperCase() === 'DELIVERY' ? 'DELIVERY' : 'PICKUP',
    quantity: round2(asNumber(row.quantity ?? row.qty) ?? 0),
    commission_rate: round2(asNumber(row.commission_rate ?? row.commissionRate) ?? 0),
    split_percent: round2(asNumber(row.split_percent ?? row.splitPercent) ?? 0),
    commission_amount: round2(commissionAmount)
  };
}

export function buildSaleOutboxPayload(payload: DesktopSalePayload | Record<string, unknown>): Record<string, unknown> {
  const source = payload as Record<string, unknown>;
  const subtotal = asNumber(source.subtotal);
  const totalAmount = asNumber(source.totalAmount ?? source.total_amount);
  const discountAmount = round2(asNumber(source.discountAmount ?? source.discount_amount) ?? 0);
  const deliveryFee = round2(asNumber(source.deliveryFee ?? source.delivery_fee) ?? 0);
  const rewardId = asTrimmedString(source.rewardId ?? source.reward_id);
  const rewardUsed =
    source.rewardRedemptionUsed === true ||
    source.reward_redemption_used === true ||
    rewardId !== null;
  // Sync sales posting computes net as subtotal - discount_amount.
  // Prefer deriving discount_amount from stored subtotal/total so legacy rows stay valid.
  const syncDiscountAmount =
    subtotal !== null && totalAmount !== null
      ? round2(subtotal - totalAmount)
      : round2(discountAmount - deliveryFee);

  const outbox: Record<string, unknown> = {
    ...source,
    discount_amount: syncDiscountAmount,
    delivery_fee: deliveryFee
  };
  const commissionTotal = asNumber(source.commissionTotal ?? source.commission_total);
  const commissionSplitMode = asTrimmedString(source.commissionSplitMode ?? source.commission_split_mode);
  const commissionRows = Array.isArray(source.commissions)
    ? source.commissions.map(normalizeCommissionRow).filter((row): row is Record<string, unknown> => Boolean(row))
    : [];
  outbox.commission_split_mode = commissionSplitMode?.toUpperCase() || 'EQUAL';
  outbox.commission_total = round2(
    commissionTotal ??
      commissionRows.reduce((sum, row) => sum + (asNumber(row.commission_amount) ?? 0), 0)
  );
  outbox.commissions = commissionRows;

  if (!rewardUsed) {
    delete outbox.rewardId;
    delete outbox.reward_id;
    delete outbox.rewardName;
    delete outbox.reward_name;
    delete outbox.rewardPointsCost;
    delete outbox.reward_points_cost;
    delete outbox.rewardDiscountAmount;
    delete outbox.reward_discount_amount;
    delete outbox.rewardBaseAmount;
    delete outbox.reward_base_amount;
    delete outbox.rewardRedemptionUsed;
    delete outbox.reward_redemption_used;
    delete outbox.rewardRedemptionUsedAt;
    delete outbox.reward_redemption_used_at;
  }

  return outbox;
}
