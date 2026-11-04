import {
  isDesktopRewardEligible,
  parseDesktopPosPriceLists,
  parseDesktopPosReward,
  resolveDesktopRewardValue,
  resolveDesktopUnitPrice,
  type DesktopMasterDataRow
} from '@vpos/desktop-core';

describe('shared POS pricing and rewards', () => {
  it('applies contract, customer-group, tier, branch, and global pricing precedence with flow rules', () => {
    const updatedAt = '2026-10-09T00:00:00.000Z';
    const rows: DesktopMasterDataRow[] = [
      ['global', { id: 'global', scope: 'GLOBAL', startsAt: '2026-01-01T00:00:00.000Z', rules: [{ productId: 'p1', flowMode: 'ANY', unitPrice: 100, priority: 1 }] }],
      ['branch', { id: 'branch', scope: 'BRANCH', branchId: 'b1', startsAt: '2026-01-01T00:00:00.000Z', rules: [{ productId: 'p1', flowMode: 'ANY', unitPrice: 95, priority: 1 }] }],
      ['tier', { id: 'tier', scope: 'TIER', customerTier: 'VIP', startsAt: '2026-01-01T00:00:00.000Z', rules: [{ productId: 'p1', flowMode: 'ANY', unitPrice: 90, priority: 1 }] }],
      ['group', { id: 'group', scope: 'CUSTOMER_GROUP', customerCategoryId: 'cat1', startsAt: '2026-01-01T00:00:00.000Z', rules: [{ productId: 'p1', flowMode: 'ANY', unitPrice: 85, priority: 1 }] }],
      ['contract', { id: 'contract', scope: 'CONTRACT', customerId: 'c1', startsAt: '2026-01-01T00:00:00.000Z', rules: [{ productId: 'p1', flowMode: 'ANY', unitPrice: 80, priority: 2 }, { productId: 'p1', flowMode: 'REFILL_EXCHANGE', unitPrice: 75, priority: 1 }] }]
    ].map(([recordId, payload]) => ({ entity: 'price_list', recordId: String(recordId), payload: JSON.stringify(payload), updatedAt }));
    const priceLists = parseDesktopPosPriceLists(rows);
    const base = { productId: 'p1', branchId: 'b1', customer: { id: 'c1', label: 'Customer', tier: 'VIP', customerCategoryId: 'cat1' }, priceLists, allowCustomPricing: true, atIso: '2026-10-09T00:00:00.000Z' };

    expect(resolveDesktopUnitPrice({ ...base, flowMode: 'REFILL_EXCHANGE' })).toBe(75);
    expect(resolveDesktopUnitPrice({ ...base, flowMode: 'NON_REFILL' })).toBe(80);
    expect(resolveDesktopUnitPrice({ ...base, customer: { id: 'c2', label: 'Group', tier: 'VIP', customerCategoryId: 'cat1' } })).toBe(85);
    expect(resolveDesktopUnitPrice({ ...base, customer: null })).toBe(95);
  });

  it('parses cached rewards and calculates eligible discounts', () => {
    const reward = parseDesktopPosReward({
      id: 'reward-1', code: 'FREE-REFILL', name: 'Free refill', reward_type: 'FREE_REFILL',
      points_cost: 50, product_id: 'lpg-1', free_qty: 1, min_spend: 500, status: 'ACTIVE'
    });
    expect(reward).not.toBeNull();
    const input = {
      reward: reward!, customer: { id: 'customer-1', label: 'Customer', pointsBalance: 100 },
      lines: [{ productId: 'lpg-1', quantity: 2, unitPrice: 900, isLpg: true, cylinderFlow: 'REFILL_EXCHANGE' as const }],
      subtotal: 1_800, manualDiscount: 100, saleType: 'PICKUP' as const, deliveryFee: 0
    };

    expect(isDesktopRewardEligible(input)).toBe(true);
    expect(resolveDesktopRewardValue(input)).toMatchObject({ baseAmount: 1_700, itemDiscount: 900, totalDiscount: 900 });
    expect(isDesktopRewardEligible({ ...input, customer: { id: 'customer-1', label: 'Customer', pointsBalance: 10 } })).toBe(false);
  });
});
