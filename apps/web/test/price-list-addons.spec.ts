import {
  getScopeLookupOrder,
  lookupStepLabel,
  scopeLabel,
  scopeLabelWithAddonText
} from '../src/lib/price-list-addons';

describe('web add-on pricing helpers', () => {
  it('uses 4-step lookup order when custom pricing add-on is disabled', () => {
    expect(getScopeLookupOrder(false)).toEqual(['CONTRACT', 'TIER', 'BRANCH', 'GLOBAL']);
    expect(lookupStepLabel('GLOBAL', false)).toBe('Checked step 4 of 4');
  });

  it('uses 5-step lookup order when custom pricing add-on is enabled', () => {
    expect(getScopeLookupOrder(true)).toEqual(['CONTRACT', 'CUSTOMER_GROUP', 'TIER', 'BRANCH', 'GLOBAL']);
    expect(lookupStepLabel('CUSTOMER_GROUP', true)).toBe('Checked step 2 of 5');
    expect(lookupStepLabel('GLOBAL', true)).toBe('Checked step 5 of 5');
  });

  it('marks customer-group scope as add-on in labels', () => {
    expect(scopeLabel('CUSTOMER_GROUP')).toBe('Custom Pricing (Customer Category)');
    expect(scopeLabelWithAddonText('CUSTOMER_GROUP')).toBe('Custom Pricing (Customer Category) (Add-on)');
    expect(scopeLabelWithAddonText('GLOBAL')).toBe('Default Price (All Customers)');
  });
});
