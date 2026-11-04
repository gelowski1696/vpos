import type { OutboxItem } from '@vpos/shared-types';
import type { DesktopPaymentMethod } from '../db/schema';

export type LendingDepositLineLike = {
  deposit_amount: number | null;
};

export type LendingDepositPaymentOutboxInput = {
  lendingId: string;
  saleId: string;
  customerId: string;
  receiptNumber: string;
  branchId: string | null;
  locationId: string | null;
  paymentMethod: DesktopPaymentMethod;
  depositLines: LendingDepositLineLike[];
  notes: string | null;
};

export type LendingDepositPaymentSummary = {
  paymentId: string;
  amount: number;
  method: DesktopPaymentMethod;
  postedAt: string;
  notes: string | null;
};

export type LendingDepositPaymentOutboxResult = {
  outbox: Pick<OutboxItem, 'id' | 'entity' | 'action' | 'payload' | 'idempotency_key' | 'created_at'>;
  summary: LendingDepositPaymentSummary;
};

export function sumLendingDepositAmount(lines: LendingDepositLineLike[]): number {
  return Number(
    lines.reduce((sum, line) => sum + Number(line.deposit_amount ?? 0), 0).toFixed(2)
  );
}

export function buildLendingDepositPaymentOutbox(
  input: LendingDepositPaymentOutboxInput
): LendingDepositPaymentOutboxResult | null {
  const amount = sumLendingDepositAmount(input.depositLines);
  if (amount <= 0) {
    return null;
  }

  const createdAt = new Date().toISOString();
  const paymentId = `customer-payment-lending-deposit-${input.lendingId}`;
  const notes =
    input.notes ??
    `Lending deposit for receipt ${input.receiptNumber}`;
  const payload = {
    id: paymentId,
    payment_id: paymentId,
    purpose: 'LENDING_DEPOSIT',
    sale_id: input.saleId,
    customer_id: input.customerId,
    branch_id: input.branchId,
    location_id: input.locationId,
    method: input.paymentMethod,
    amount,
    reference_no: null,
    notes,
    posted_at: createdAt,
    created_at: createdAt
  };

  return {
    outbox: {
      id: `outbox-lending-deposit-${input.lendingId}`,
      entity: 'customer_payment',
      action: 'create',
      payload,
      idempotency_key: `desktop-lending-deposit:${input.lendingId}`,
      created_at: createdAt
    },
    summary: {
      paymentId,
      amount,
      method: input.paymentMethod,
      postedAt: createdAt,
      notes
    }
  };
}
