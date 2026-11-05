import { PricingService } from '../src/modules/pricing/pricing.service';

describe('PricingService customer discount', () => {
  const input = {
    company_id: 'company-1',
    branch_id: 'branch-1',
    customer_id: 'customer-1',
    product_id: 'product-1',
    quantity: 1,
    requested_at: '2026-11-05T00:00:00.000Z'
  };

  function buildService(lists: Array<Record<string, unknown>>): PricingService {
    const masterDataService = {
      getProductById: jest.fn().mockResolvedValue({ id: 'product-1', standardCost: 600 }),
      getCustomerById: jest.fn().mockResolvedValue({
        id: 'customer-1',
        tier: 'REGULAR',
        customerCategoryId: null,
        contractPrice: 50
      }),
      getActivePriceLists: jest.fn().mockResolvedValue(lists)
    };
    return new PricingService(masterDataService as never);
  }

  it('subtracts the fixed discount from the current branch price', async () => {
    const service = buildService([
      {
        id: 'branch-list',
        scope: 'BRANCH',
        branchId: 'branch-1',
        startsAt: '2026-01-01T00:00:00.000Z',
        rules: [{
          id: 'branch-rule', productId: 'product-1', flowMode: 'ANY', unitPrice: 940,
          unitCost: null, discountCapPct: 8, priority: 1
        }]
      }
    ]);

    await expect(service.resolve(input)).resolves.toMatchObject({
      source: 'branch',
      unit_price: 890
    });
  });

  it('keeps an explicit customer contract rule ahead of the fixed discount', async () => {
    const service = buildService([
      {
        id: 'contract-list',
        scope: 'CONTRACT',
        customerId: 'customer-1',
        startsAt: '2026-01-01T00:00:00.000Z',
        rules: [{
          id: 'contract-rule', productId: 'product-1', flowMode: 'ANY', unitPrice: 900,
          unitCost: null, discountCapPct: 10, priority: 1
        }]
      }
    ]);

    await expect(service.resolve(input)).resolves.toMatchObject({
      source: 'contract',
      unit_price: 900
    });
  });
});
