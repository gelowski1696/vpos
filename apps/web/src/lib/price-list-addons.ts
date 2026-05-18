export type PriceListScope = 'GLOBAL' | 'BRANCH' | 'TIER' | 'CUSTOMER_GROUP' | 'CONTRACT';

export const SCOPE_INFO: Array<{
  scope: PriceListScope;
  label: string;
  description: string;
  priority: number;
}> = [
  {
    scope: 'GLOBAL',
    label: 'Default Price (All Customers)',
    description: 'Used only when no other matching price list is found.',
    priority: 4
  },
  {
    scope: 'BRANCH',
    label: 'Branch Override',
    description: 'Checked after Customer Tier and before Default Price.',
    priority: 3
  },
  {
    scope: 'TIER',
    label: 'Customer Tier Price',
    description: 'Checked after Custom Pricing and before Branch.',
    priority: 2
  },
  {
    scope: 'CUSTOMER_GROUP',
    label: 'Custom Pricing (Customer Category)',
    description: 'Checked after Specific Customer and before Customer Tier.',
    priority: 5
  },
  {
    scope: 'CONTRACT',
    label: 'Specific Customer Contract',
    description: 'Checked first. Applies only to one specific customer.',
    priority: 1
  }
];

export function getScopeLookupOrder(customPricingEnabled: boolean): PriceListScope[] {
  return customPricingEnabled
    ? ['CONTRACT', 'CUSTOMER_GROUP', 'TIER', 'BRANCH', 'GLOBAL']
    : ['CONTRACT', 'TIER', 'BRANCH', 'GLOBAL'];
}

export function scopeLabel(scope: PriceListScope): string {
  return SCOPE_INFO.find((entry) => entry.scope === scope)?.label ?? scope;
}

export function isAddonScope(scope: PriceListScope): boolean {
  return scope === 'CUSTOMER_GROUP';
}

export function scopeLabelWithAddonText(scope: PriceListScope): string {
  return isAddonScope(scope) ? `${scopeLabel(scope)} (Add-on)` : scopeLabel(scope);
}

export function lookupStepLabel(scope: PriceListScope, customPricingEnabled: boolean): string {
  const lookupOrder = getScopeLookupOrder(customPricingEnabled);
  const step = lookupOrder.indexOf(scope) + 1;
  if (step <= 0) {
    return `Checked step - of ${lookupOrder.length}`;
  }
  return `Checked step ${step} of ${lookupOrder.length}`;
}
