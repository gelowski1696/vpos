export type CustomerPaymentPurpose = 'SALE_BALANCE' | 'LENDING_DEPOSIT';

export function normalizeCustomerPaymentPurpose(value: unknown): CustomerPaymentPurpose {
  const normalized =
    typeof value === 'string'
      ? value.trim().toUpperCase().replace(/\s+/g, '_')
      : '';
  if (normalized === 'LENDING_DEPOSIT') {
    return 'LENDING_DEPOSIT';
  }
  return 'SALE_BALANCE';
}

export function isBalanceAffectingCustomerPaymentPurpose(
  purpose: CustomerPaymentPurpose | string | null | undefined
): boolean {
  return normalizeCustomerPaymentPurpose(purpose) === 'SALE_BALANCE';
}
