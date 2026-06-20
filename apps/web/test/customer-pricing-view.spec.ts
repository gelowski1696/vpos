import { resolveCustomerPricingView } from '../src/lib/customer-pricing-view';

describe('customer pricing view resolver', () => {
  const branch = { id: 'branch-1', code: 'BR01', name: 'Main Branch', isActive: true };
  const customer = {
    id: 'customer-1',
    code: 'CU001',
    name: 'Acme Gas',
    tier: 'PREMIUM',
    customerCategoryId: 'category-1',
    contractPrice: 750,
    province: 'Bulacan',
    city: 'Malolos',
    isActive: true
  };
  const product = {
    id: 'product-1',
    sku: 'LPG-11',
    name: '11kg LPG',
    category: 'LPG',
    isActive: true,
    standardCost: 42
  };

  it('keeps the backend lookup order and resolves the winning scope first', () => {
    const view = resolveCustomerPricingView({
      customer,
      branchId: branch.id,
      requestedAt: '2026-06-20T00:00:00.000Z',
      requestedFlow: null,
      products: [product],
      branches: [branch],
      customPricingEnabled: true,
      priceLists: [
        {
          id: 'contract-list',
          code: 'PL-CONTRACT',
          name: 'Contract List',
          scope: 'CONTRACT',
          customerId: customer.id,
          startsAt: '2026-06-01T00:00:00.000Z',
          endsAt: null,
          isActive: true,
          rules: [
            {
              id: 'contract-rule',
              productId: product.id,
              flowMode: 'ANY',
              unitPrice: 100,
              unitCost: null,
              discountCapPct: 0,
              priority: 1
            }
          ]
        },
        {
          id: 'group-list',
          code: 'PL-GROUP',
          name: 'Category List',
          scope: 'CUSTOMER_GROUP',
          customerCategoryId: customer.customerCategoryId,
          startsAt: '2026-06-01T00:00:00.000Z',
          endsAt: null,
          isActive: true,
          rules: [
            {
              id: 'group-rule',
              productId: product.id,
              flowMode: 'ANY',
              unitPrice: 200,
              unitCost: null,
              discountCapPct: 0,
              priority: 1
            }
          ]
        },
        {
          id: 'tier-list',
          code: 'PL-TIER',
          name: 'Tier List',
          scope: 'TIER',
          customerTier: customer.tier,
          startsAt: '2026-06-01T00:00:00.000Z',
          endsAt: null,
          isActive: true,
          rules: [
            {
              id: 'tier-rule',
              productId: product.id,
              flowMode: 'ANY',
              unitPrice: 300,
              unitCost: null,
              discountCapPct: 0,
              priority: 1
            }
          ]
        },
        {
          id: 'branch-list',
          code: 'PL-BRANCH',
          name: 'Branch List',
          scope: 'BRANCH',
          branchId: branch.id,
          startsAt: '2026-06-01T00:00:00.000Z',
          endsAt: null,
          isActive: true,
          rules: [
            {
              id: 'branch-rule',
              productId: product.id,
              flowMode: 'ANY',
              unitPrice: 400,
              unitCost: null,
              discountCapPct: 0,
              priority: 1
            }
          ]
        },
        {
          id: 'global-list',
          code: 'PL-GLOBAL',
          name: 'Global List',
          scope: 'GLOBAL',
          startsAt: '2026-06-01T00:00:00.000Z',
          endsAt: null,
          isActive: true,
          rules: [
            {
              id: 'global-rule',
              productId: product.id,
              flowMode: 'ANY',
              unitPrice: 500,
              unitCost: null,
              discountCapPct: 0,
              priority: 1
            }
          ]
        }
      ]
    });

    expect(view.applicableLists.map((row) => row.scope)).toEqual([
      'CONTRACT',
      'CUSTOMER_GROUP',
      'TIER',
      'BRANCH',
      'GLOBAL'
    ]);
    expect(view.productRows[0].final?.source).toBe('contract_list');
    expect(view.productRows[0].final?.unitPrice).toBe(100);
  });

  it('falls back to the customer contract price when there is no contract price list', () => {
    const view = resolveCustomerPricingView({
      customer: {
        ...customer,
        contractPrice: 875
      },
      branchId: branch.id,
      requestedAt: '2026-06-20T00:00:00.000Z',
      requestedFlow: 'NON_REFILL',
      products: [product],
      branches: [branch],
      customPricingEnabled: false,
      priceLists: [
        {
          id: 'global-list',
          code: 'PL-GLOBAL',
          name: 'Global List',
          scope: 'GLOBAL',
          startsAt: '2026-06-01T00:00:00.000Z',
          endsAt: null,
          isActive: true,
          rules: [
            {
              id: 'global-rule',
              productId: product.id,
              flowMode: 'ANY',
              unitPrice: 500,
              unitCost: null,
              discountCapPct: 0,
              priority: 1
            }
          ]
        }
      ]
    });

    expect(view.productRows[0].final?.source).toBe('customer_contract_price');
    expect(view.productRows[0].final?.unitPrice).toBe(875);
  });
});
