import type { DesktopSalePayload } from '../src/db/schema';
import { buildSaleOutboxPayload } from '../src/services/desktop-sale-sync-payload';

function makePayload(overrides: Partial<DesktopSalePayload> = {}): DesktopSalePayload {
  return {
    id: 'sale-1',
    shiftId: 'shift-1',
    customerId: 'cust-1',
    customerName: 'Customer One',
    saleType: 'DELIVERY',
    paymentMode: 'FULL',
    paymentMethod: 'CASH',
    branchId: 'branch-1',
    branchLabel: 'Main',
    locationId: 'loc-1',
    locationLabel: 'Front',
    subtotal: 1000,
    discountAmount: 0,
    deliveryFee: 100,
    totalAmount: 1100,
    paidAmount: 1100,
    changeAmount: 0,
    creditBalance: 0,
    payments: [{ method: 'CASH', amount: 1100 }],
    notes: null,
    lines: [],
    createdAt: '2026-05-25T00:00:00.000Z',
    ...overrides
  };
}

describe('buildSaleOutboxPayload', () => {
  it('converts delivery fee into sync-compatible discount_amount while keeping desktop discountAmount', () => {
    const payload = makePayload({ discountAmount: 0, deliveryFee: 100 });
    const outbox = buildSaleOutboxPayload(payload);

    expect(outbox.discountAmount).toBe(0);
    expect(outbox.deliveryFee).toBe(100);
    expect(outbox.delivery_fee).toBe(100);
    expect(outbox.discount_amount).toBe(-100);
  });

  it('keeps discount_amount aligned with net sale total when both discount and delivery fee are present', () => {
    const payload = makePayload({
      discountAmount: 75,
      deliveryFee: 20,
      subtotal: 1000,
      totalAmount: 945
    });

    const outbox = buildSaleOutboxPayload(payload);

    expect(outbox.discount_amount).toBe(55);
  });

  it('normalizes the desktop delivery payload shape that was failing in sync', () => {
    const payload = {
      id: 'desk-sale-1779697821536',
      saleType: 'DELIVERY',
      paymentMode: 'FULL',
      subtotal: 750,
      discountAmount: 0,
      deliveryFee: 20,
      totalAmount: 770,
      paidAmount: 770,
      payments: [{ method: 'E_WALLET', amount: 770 }],
      lines: [{ productId: 'p-1', quantity: 5, unitPrice: 150 }]
    };

    const outbox = buildSaleOutboxPayload(payload);

    expect(outbox.discount_amount).toBe(-20);
    expect(outbox.delivery_fee).toBe(20);
  });

  it('strips reward metadata from normal sales that are not redeeming a reward', () => {
    const payload = makePayload({
      rewardId: null,
      rewardName: null,
      rewardPointsCost: 0,
      rewardDiscountAmount: 0,
      rewardBaseAmount: 1100,
      rewardRedemptionUsed: false
    });

    const outbox = buildSaleOutboxPayload(payload);

    expect(outbox.rewardId).toBeUndefined();
    expect(outbox.rewardName).toBeUndefined();
    expect(outbox.rewardPointsCost).toBeUndefined();
    expect(outbox.rewardDiscountAmount).toBeUndefined();
    expect(outbox.rewardBaseAmount).toBeUndefined();
    expect(outbox.rewardRedemptionUsed).toBeUndefined();
  });

  it('also strips reward metadata when the reward id is omitted entirely', () => {
    const payload = makePayload({
      rewardId: undefined,
      rewardName: 'Should not persist',
      rewardPointsCost: 100,
      rewardDiscountAmount: 50,
      rewardBaseAmount: 1100,
      rewardRedemptionUsed: false
    } as Partial<DesktopSalePayload>);

    const outbox = buildSaleOutboxPayload(payload);

    expect(outbox.rewardId).toBeUndefined();
    expect(outbox.rewardName).toBeUndefined();
    expect(outbox.rewardPointsCost).toBeUndefined();
    expect(outbox.rewardDiscountAmount).toBeUndefined();
    expect(outbox.rewardBaseAmount).toBeUndefined();
    expect(outbox.rewardRedemptionUsed).toBeUndefined();
  });

  it('mirrors commission preview fields into sync payload keys', () => {
    const payload = makePayload({
      commissionSplitMode: 'EQUAL',
      commissionTotal: 30,
      commissions: [
        {
          productId: 'prod-1',
          productName: 'LPG 11kg',
          personnelId: 'person-1',
          personnelName: 'Driver One',
          personnelRole: 'DRIVER',
          saleType: 'DELIVERY',
          quantity: 3,
          commissionRate: 10,
          splitPercent: 50,
          commissionAmount: 15
        },
        {
          productId: 'prod-1',
          productName: 'LPG 11kg',
          personnelId: 'person-2',
          personnelName: 'Helper One',
          personnelRole: 'HELPER',
          saleType: 'DELIVERY',
          quantity: 3,
          commissionRate: 10,
          splitPercent: 50,
          commissionAmount: 15
        }
      ]
    });

    const outbox = buildSaleOutboxPayload(payload);

    expect(outbox.commission_split_mode).toBe('EQUAL');
    expect(outbox.commission_total).toBe(30);
    expect(outbox.commissions).toEqual([
      expect.objectContaining({
        product_id: 'prod-1',
        personnel_id: 'person-1',
        commission_amount: 15
      }),
      expect.objectContaining({
        product_id: 'prod-1',
        personnel_id: 'person-2',
        commission_amount: 15
      })
    ]);
  });
});
