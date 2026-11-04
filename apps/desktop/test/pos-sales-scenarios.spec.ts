import type { DesktopPaymentMethod, DesktopPaymentMode, DesktopSalePayload } from '../src/db/schema';
import { buildSaleOutboxPayload } from '../src/services/desktop-sale-sync-payload';

type PaymentRow = {
  method: DesktopPaymentMethod;
  amount: number;
};

type Scenario = {
  name: string;
  flowUsed: string;
  paymentMode: DesktopPaymentMode;
  saleType: 'PICKUP' | 'DELIVERY';
  paymentMethod: DesktopPaymentMethod;
  subtotal: number;
  discountAmount: number;
  deliveryFee: number;
  payments: PaymentRow[];
  expectedValidOnApiRule: boolean;
};

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function makePayload(input: Scenario): DesktopSalePayload {
  const totalAmount = round2(Math.max(0, input.subtotal - input.discountAmount + input.deliveryFee));
  const paidAmount = round2(input.payments.reduce((sum, row) => sum + row.amount, 0));
  const creditBalance = round2(Math.max(0, totalAmount - paidAmount));
  const changeAmount = input.paymentMode === 'FULL' ? round2(Math.max(0, paidAmount - totalAmount)) : 0;

  return {
    id: `sale-${input.name.toLowerCase().replace(/\s+/g, '-')}`,
    shiftId: 'shift-1',
    customerId: 'cust-1',
    customerName: 'Scenario Customer',
    recreatedFromSaleId: null,
    personnelId: 'personnel-1',
    personnelName: 'P1',
    helperId: null,
    helperName: null,
    personnel: [{ userId: 'personnel-1', role: 'DRIVER', name: 'P1' }],
    saleType: input.saleType,
    paymentMode: input.paymentMode,
    paymentMethod: input.paymentMethod,
    hideAmounts: false,
    branchId: 'branch-1',
    branchLabel: 'Main',
    locationId: 'loc-1',
    locationLabel: 'Front',
    subtotal: input.subtotal,
    discountAmount: input.discountAmount,
    deliveryFee: input.deliveryFee,
    totalAmount,
    paidAmount,
    changeAmount,
    creditBalance,
    payments: input.payments.map((row) => ({
      method: row.method,
      amount: round2(row.amount),
      referenceNo: null
    })),
    rewardId: null,
    rewardName: null,
    rewardPointsCost: 0,
    rewardDiscountAmount: 0,
    rewardRedemptionUsed: false,
    notes: input.flowUsed,
    lines: [
      {
        lineId: 'line-1',
        productId: 'prod-1',
        productName: 'LPG A',
        quantity: 5,
        unitPrice: 150,
        lineTotal: 750,
        cylinderFlow: 'NON_REFILL'
      }
    ],
    createdAt: '2026-05-25T00:00:00.000Z'
  };
}

function passesApiSalePaymentRule(payload: Record<string, unknown>): boolean {
  const subtotal = round2(Number(payload.subtotal ?? 0));
  const discountAmount = round2(Number(payload.discount_amount ?? payload.discountAmount ?? 0));
  const paymentMode = String(payload.payment_mode ?? payload.paymentMode ?? 'FULL').toUpperCase();
  const payments = Array.isArray(payload.payments) ? payload.payments : [];
  const paymentTotal = round2(
    payments.reduce((sum, row) => {
      const item = row as Record<string, unknown>;
      return sum + Number(item.amount ?? 0);
    }, 0)
  );
  const netSaleTotal = round2(Math.max(0, subtotal - discountAmount));

  if (paymentMode === 'FULL') {
    return paymentTotal === netSaleTotal;
  }
  return paymentTotal >= 0 && paymentTotal <= netSaleTotal;
}

describe('desktop POS sales scenarios (payment modes + methods)', () => {
  const scenarios: Scenario[] = [
    {
      name: 'FULL CASH PICKUP',
      flowUsed: 'POS Checkout -> Local Sale -> Outbox Queue -> Sync Push -> API sales/post',
      paymentMode: 'FULL',
      saleType: 'PICKUP',
      paymentMethod: 'CASH',
      subtotal: 500,
      discountAmount: 0,
      deliveryFee: 0,
      payments: [{ method: 'CASH', amount: 500 }],
      expectedValidOnApiRule: true
    },
    {
      name: 'FULL CARD DELIVERY WITH FEE',
      flowUsed: 'POS Checkout (Delivery Fee) -> Local Sale -> Outbox Queue -> Sync Push -> API sales/post',
      paymentMode: 'FULL',
      saleType: 'DELIVERY',
      paymentMethod: 'CARD',
      subtotal: 750,
      discountAmount: 0,
      deliveryFee: 20,
      payments: [{ method: 'CARD', amount: 770 }],
      expectedValidOnApiRule: true
    },
    {
      name: 'FULL E_WALLET PICKUP WITH DISCOUNT',
      flowUsed: 'POS Checkout (Discount) -> Local Sale -> Outbox Queue -> Sync Push -> API sales/post',
      paymentMode: 'FULL',
      saleType: 'PICKUP',
      paymentMethod: 'E_WALLET',
      subtotal: 1000,
      discountAmount: 85,
      deliveryFee: 0,
      payments: [{ method: 'E_WALLET', amount: 915 }],
      expectedValidOnApiRule: true
    },
    {
      name: 'PARTIAL CASH DELIVERY',
      flowUsed: 'POS Partial Payment -> Local Sale -> Outbox Queue -> Sync Push -> API sales/post',
      paymentMode: 'PARTIAL',
      saleType: 'DELIVERY',
      paymentMethod: 'CASH',
      subtotal: 1000,
      discountAmount: 50,
      deliveryFee: 30,
      payments: [{ method: 'CASH', amount: 600 }],
      expectedValidOnApiRule: true
    },
    {
      name: 'PARTIAL CARD PICKUP',
      flowUsed: 'POS Partial Payment -> Local Sale -> Outbox Queue -> Sync Push -> API sales/post',
      paymentMode: 'PARTIAL',
      saleType: 'PICKUP',
      paymentMethod: 'CARD',
      subtotal: 900,
      discountAmount: 0,
      deliveryFee: 0,
      payments: [{ method: 'CARD', amount: 450 }],
      expectedValidOnApiRule: true
    },
    {
      name: 'PARTIAL E_WALLET PICKUP',
      flowUsed: 'POS Partial Payment -> Local Sale -> Outbox Queue -> Sync Push -> API sales/post',
      paymentMode: 'PARTIAL',
      saleType: 'PICKUP',
      paymentMethod: 'E_WALLET',
      subtotal: 600,
      discountAmount: 20,
      deliveryFee: 0,
      payments: [{ method: 'E_WALLET', amount: 200 }],
      expectedValidOnApiRule: true
    },
    {
      name: 'FULL PAYMENT MISMATCH SHOULD FAIL',
      flowUsed: 'POS Checkout -> Local Sale -> Outbox Queue -> Sync Push -> API sales/post (validation fail case)',
      paymentMode: 'FULL',
      saleType: 'PICKUP',
      paymentMethod: 'CASH',
      subtotal: 1000,
      discountAmount: 0,
      deliveryFee: 0,
      payments: [{ method: 'CASH', amount: 999 }],
      expectedValidOnApiRule: false
    }
  ];

  it.each(scenarios)('$name', (scenario) => {
    const payload = makePayload(scenario);
    const outboxPayload = buildSaleOutboxPayload(payload);
    const expectedSyncDiscount = round2(payload.subtotal - payload.totalAmount);

    expect(outboxPayload.discount_amount).toBe(expectedSyncDiscount);
    expect(outboxPayload.delivery_fee).toBe(round2(payload.deliveryFee ?? 0));
    expect(passesApiSalePaymentRule(outboxPayload)).toBe(scenario.expectedValidOnApiRule);
  });

  it('normalizes the exact reported FULL + E_WALLET + DELIVERY payload to pass API net-total rule', () => {
    const payload: DesktopSalePayload = {
      id: 'desk-sale-1779697821536',
      shiftId: 'desk-shift-1779695279453-340889',
      customerId: '747975b3-27a0-4477-aa91-11d3570b7baa',
      customerName: 'Faith',
      recreatedFromSaleId: null,
      personnelId: '814f8262-1d99-41cc-a598-edf00263310c',
      personnelName: 'P1DESK - Personnel-1 from Desktop',
      helperId: null,
      helperName: null,
      personnel: [
        {
          userId: '814f8262-1d99-41cc-a598-edf00263310c',
          role: 'DRIVER',
          name: 'P1DESK - Personnel-1 from Desktop'
        }
      ],
      saleType: 'DELIVERY',
      paymentMode: 'FULL',
      paymentMethod: 'E_WALLET',
      hideAmounts: false,
      branchId: '5934ae7f-b4f5-4d98-8f2d-32893e3c96cc',
      branchLabel: 'VMJAM - Desktop',
      locationId: '420de5c4-d9e5-4c1f-8060-9d9b0532a8ef',
      locationLabel: 'VMJAM - Desktop Primary',
      subtotal: 750,
      discountAmount: 0,
      deliveryFee: 20,
      totalAmount: 770,
      paidAmount: 770,
      changeAmount: 0,
      creditBalance: 0,
      payments: [
        {
          method: 'E_WALLET',
          amount: 770,
          referenceNo: null
        }
      ],
      rewardId: null,
      rewardName: null,
      rewardPointsCost: 0,
      rewardDiscountAmount: 0,
      rewardRedemptionUsed: false,
      notes: 'Volume Price | Reopened from 20260525-0000002',
      lines: [
        {
          lineId: 'cart-line-1779696939507-374357',
          productId: '96d8a160-7fb4-47a4-94da-f765a0d2188f',
          productName: 'A',
          quantity: 5,
          unitPrice: 150,
          lineTotal: 750,
          cylinderFlow: 'NON_REFILL'
        }
      ],
      createdAt: '2026-05-25T08:30:21.533Z'
    };

    const outboxPayload = buildSaleOutboxPayload(payload);
    expect(outboxPayload.discount_amount).toBe(-20);
    expect(outboxPayload.delivery_fee).toBe(20);
    expect(passesApiSalePaymentRule(outboxPayload)).toBe(true);
  });
});
