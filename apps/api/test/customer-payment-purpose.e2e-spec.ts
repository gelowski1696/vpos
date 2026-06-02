import {
  isBalanceAffectingCustomerPaymentPurpose,
  normalizeCustomerPaymentPurpose
} from '../src/modules/customer-payments/customer-payment-purpose';

describe('customer payment purpose helpers', () => {
  it('treats lending deposits as non-balance-affecting payments', () => {
    expect(normalizeCustomerPaymentPurpose('lending deposit')).toBe('LENDING_DEPOSIT');
    expect(isBalanceAffectingCustomerPaymentPurpose('SALE_BALANCE')).toBe(true);
    expect(isBalanceAffectingCustomerPaymentPurpose('LENDING_DEPOSIT')).toBe(false);
  });
});
