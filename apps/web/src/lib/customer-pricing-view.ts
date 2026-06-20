import { getScopeLookupOrder, type PriceListScope } from './price-list-addons';

export type CustomerPricingFlowMode = 'ANY' | 'REFILL_EXCHANGE' | 'NON_REFILL';

export type CustomerPricingCustomer = {
  id: string;
  code: string;
  name: string;
  tier?: string | null;
  customerCategoryId?: string | null;
  contractPrice?: number | null;
  province?: string | null;
  city?: string | null;
  isActive: boolean;
};

export type CustomerPricingBranch = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type CustomerPricingCategory = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type CustomerPricingProduct = {
  id: string;
  sku: string;
  name: string;
  category?: string | null;
  isActive: boolean;
  standardCost?: number | null;
};

export type CustomerPricingRule = {
  id: string;
  productId: string;
  flowMode: CustomerPricingFlowMode;
  unitPrice: number;
  unitCost?: number | null;
  discountCapPct: number;
  priority: number;
};

export type CustomerPricingList = {
  id: string;
  code: string;
  name: string;
  scope: PriceListScope;
  activeVersionId?: string | null;
  branchId?: string | null;
  customerTier?: string | null;
  customerCategoryId?: string | null;
  customerId?: string | null;
  startsAt: string;
  endsAt?: string | null;
  isActive: boolean;
  rules: CustomerPricingRule[];
};

export type CustomerPricingSource =
  | 'contract_list'
  | 'customer_contract_price'
  | 'customer_group'
  | 'tier'
  | 'branch'
  | 'global';

export type CustomerPricingCandidate = {
  source: CustomerPricingSource;
  sourceLabel: string;
  scope: PriceListScope;
  priceListId?: string | null;
  priceListCode?: string | null;
  priceListName?: string | null;
  ruleId?: string | null;
  unitPrice: number;
  resolvedUnitCost: number | null;
  discountCapPct: number;
  priority?: number | null;
  flowMode?: CustomerPricingFlowMode | null;
  startsAt?: string | null;
};

export type CustomerPricingProductRow = {
  product: CustomerPricingProduct;
  candidates: Partial<Record<PriceListScope, CustomerPricingCandidate | null>>;
  final: CustomerPricingCandidate | null;
};

export type CustomerPricingView = {
  customer: CustomerPricingCustomer;
  branch: CustomerPricingBranch;
  requestedAt: string;
  requestedFlow: CustomerPricingFlowMode | null;
  customPricingEnabled: boolean;
  applicableLists: Array<CustomerPricingList & { ruleCount: number }>;
  productRows: CustomerPricingProductRow[];
};

export type ResolveCustomerPricingViewInput = {
  customer: CustomerPricingCustomer;
  branchId: string;
  requestedAt: string;
  requestedFlow: CustomerPricingFlowMode | null;
  products: CustomerPricingProduct[];
  branches: CustomerPricingBranch[];
  priceLists: CustomerPricingList[];
  customPricingEnabled: boolean;
};

function normalizeFlowMode(value: unknown): CustomerPricingFlowMode | null {
  if (value === 'REFILL_EXCHANGE' || value === 'NON_REFILL') {
    return value;
  }
  return null;
}

function flowRank(
  ruleFlowMode: unknown,
  requestedFlow: CustomerPricingFlowMode | null
): number | null {
  const normalizedRuleFlow =
    ruleFlowMode === 'REFILL_EXCHANGE' || ruleFlowMode === 'NON_REFILL' || ruleFlowMode === 'ANY'
      ? ruleFlowMode
      : 'ANY';
  if (!requestedFlow) {
    return normalizedRuleFlow === 'ANY' ? 0 : null;
  }
  if (normalizedRuleFlow === requestedFlow) {
    return 0;
  }
  if (normalizedRuleFlow === 'ANY') {
    return 1;
  }
  return null;
}

function resolveUnitCost(unitCost: number | null | undefined, defaultUnitCost: number | null): number | null {
  if (unitCost === null || unitCost === undefined) {
    return defaultUnitCost;
  }
  return Number(unitCost);
}

function sourceLabelFor(source: CustomerPricingSource): string {
  switch (source) {
    case 'contract_list':
      return 'Specific Customer Contract';
    case 'customer_contract_price':
      return 'Customer Contract Price';
    case 'customer_group':
      return 'Customer Category Price';
    case 'tier':
      return 'Customer Tier Price';
    case 'branch':
      return 'Branch Override';
    case 'global':
      return 'Default Price';
    default:
      return 'Resolved Price';
  }
}

function makeCandidate(
  source: CustomerPricingSource,
  scope: PriceListScope,
  input: {
    priceListId?: string | null;
    priceListCode?: string | null;
    priceListName?: string | null;
    ruleId?: string | null;
    unitPrice: number;
    resolvedUnitCost: number | null;
    discountCapPct: number;
    priority?: number | null;
    flowMode?: CustomerPricingFlowMode | null;
    startsAt?: string | null;
  }
): CustomerPricingCandidate {
  return {
    source,
    sourceLabel: sourceLabelFor(source),
    scope,
    priceListId: input.priceListId ?? null,
    priceListCode: input.priceListCode ?? null,
    priceListName: input.priceListName ?? null,
    ruleId: input.ruleId ?? null,
    unitPrice: Number(input.unitPrice),
    resolvedUnitCost: input.resolvedUnitCost,
    discountCapPct: Number(input.discountCapPct),
    priority: input.priority ?? null,
    flowMode: input.flowMode ?? null,
    startsAt: input.startsAt ?? null
  };
}

function listAppliesToCustomer(
  list: CustomerPricingList,
  customer: CustomerPricingCustomer,
  branchId: string
): boolean {
  switch (list.scope) {
    case 'CONTRACT':
      return Boolean(list.customerId && list.customerId === customer.id);
    case 'CUSTOMER_GROUP':
      return Boolean(customer.customerCategoryId && list.customerCategoryId === customer.customerCategoryId);
    case 'TIER':
      return Boolean(customer.tier && list.customerTier === customer.tier);
    case 'BRANCH':
      return Boolean(branchId && list.branchId === branchId);
    case 'GLOBAL':
      return true;
    default:
      return false;
  }
}

function isActiveAt(list: CustomerPricingList, requestedAt: string): boolean {
  if (!list.isActive) {
    return false;
  }
  const at = new Date(requestedAt).getTime();
  if (!Number.isFinite(at)) {
    return false;
  }
  const start = new Date(list.startsAt).getTime();
  const end = list.endsAt ? new Date(list.endsAt).getTime() : Number.POSITIVE_INFINITY;
  return start <= at && at <= end;
}

function sortRules(
  rules: Array<
    CustomerPricingRule & {
      priceListId: string;
      priceListCode: string;
      priceListName: string;
      startsAt: string;
    }
  >,
  requestedFlow: CustomerPricingFlowMode | null
): typeof rules {
  return [...rules]
    .filter((rule) => flowRank(rule.flowMode, requestedFlow) !== null)
    .sort((a, b) => {
      const aRank = flowRank(a.flowMode, requestedFlow) ?? 99;
      const bRank = flowRank(b.flowMode, requestedFlow) ?? 99;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
    });
}

function resolveScopeCandidate(
  scope: PriceListScope,
  lists: CustomerPricingList[],
  product: CustomerPricingProduct,
  requestedFlow: CustomerPricingFlowMode | null
): CustomerPricingCandidate | null {
  const defaultUnitCost = product.standardCost ?? null;
  const matchingLists = lists.filter((list) => list.scope === scope);
  const rules = sortRules(
    matchingLists.flatMap((list) =>
      list.rules
        .filter((rule) => rule.productId === product.id)
        .map((rule) => ({
          ...rule,
          priceListId: list.id,
          priceListCode: list.code,
          priceListName: list.name,
          startsAt: list.startsAt,
          scope: list.scope
        }))
    ),
    requestedFlow
  );

  if (rules.length === 0) {
    return null;
  }

  const winner = rules[0];
  return makeCandidate(
    scope === 'CONTRACT' ? 'contract_list' : scope === 'CUSTOMER_GROUP' ? 'customer_group' : scope === 'TIER' ? 'tier' : scope === 'BRANCH' ? 'branch' : 'global',
    scope,
    {
      priceListId: winner.priceListId,
      priceListCode: winner.priceListCode,
      priceListName: winner.priceListName,
      ruleId: winner.id,
      unitPrice: winner.unitPrice,
      resolvedUnitCost: resolveUnitCost(winner.unitCost, defaultUnitCost),
      discountCapPct: winner.discountCapPct,
      priority: winner.priority,
      flowMode: normalizeFlowMode(winner.flowMode) ?? 'ANY',
      startsAt: winner.startsAt
    }
  );
}

export function resolveCustomerPricingView(
  input: ResolveCustomerPricingViewInput
): CustomerPricingView {
  const scopeOrder = getScopeLookupOrder(input.customPricingEnabled);
  const activeLists = input.priceLists.filter((list) => isActiveAt(list, input.requestedAt));
  const scopedActiveLists = input.customPricingEnabled
    ? activeLists
    : activeLists.filter((list) => list.scope !== 'CUSTOMER_GROUP');
  const applicableLists = activeLists
    .filter((list) => (input.customPricingEnabled ? true : list.scope !== 'CUSTOMER_GROUP'))
    .filter((list) => listAppliesToCustomer(list, input.customer, input.branchId))
    .sort((a, b) => {
      const scopeDiff = scopeOrder.indexOf(a.scope) - scopeOrder.indexOf(b.scope);
      if (scopeDiff !== 0) {
        return scopeDiff;
      }
      const startDiff = new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
      if (startDiff !== 0) {
        return startDiff;
      }
      return a.code.localeCompare(b.code);
    })
    .map((list) => ({
      ...list,
      ruleCount: list.rules.length
    }));

  const productRows = [...input.products]
    .sort((a, b) => {
      const activeDiff = Number(b.isActive) - Number(a.isActive);
      if (activeDiff !== 0) {
        return activeDiff;
      }
      return `${a.sku} ${a.name}`.localeCompare(`${b.sku} ${b.name}`);
    })
    .map((product) => {
      const contractLists = scopedActiveLists.filter(
        (list) => list.scope === 'CONTRACT' && list.customerId === input.customer.id
      );
      const contractCandidate =
        resolveScopeCandidate('CONTRACT', contractLists, product, input.requestedFlow) ??
        (input.customer.contractPrice === null || input.customer.contractPrice === undefined
          ? null
          : makeCandidate('customer_contract_price', 'CONTRACT', {
              unitPrice: input.customer.contractPrice,
              resolvedUnitCost: product.standardCost ?? null,
              discountCapPct: 0,
              startsAt: input.requestedAt
            }));
      const scopeCandidates: Partial<Record<PriceListScope, CustomerPricingCandidate | null>> = {
        CONTRACT: contractCandidate,
        TIER: resolveScopeCandidate(
          'TIER',
          scopedActiveLists.filter((list) => list.customerTier === input.customer.tier),
          product,
          input.requestedFlow
        ),
        BRANCH: resolveScopeCandidate(
          'BRANCH',
          scopedActiveLists.filter((list) => list.branchId === input.branchId),
          product,
          input.requestedFlow
        ),
        GLOBAL: resolveScopeCandidate('GLOBAL', scopedActiveLists, product, input.requestedFlow)
      };

      if (input.customPricingEnabled) {
        scopeCandidates.CUSTOMER_GROUP = resolveScopeCandidate(
          'CUSTOMER_GROUP',
          activeLists.filter(
            (list) =>
              Boolean(input.customer.customerCategoryId) &&
              list.customerCategoryId === input.customer.customerCategoryId
          ),
          product,
          input.requestedFlow
        );
      }

      const final = scopeOrder
        .map((scope) => scopeCandidates[scope] ?? null)
        .find((candidate): candidate is CustomerPricingCandidate => Boolean(candidate))
        ?? null;

      return {
        product,
        candidates: scopeCandidates,
        final
      };
    });

  const branch = input.branches.find((row) => row.id === input.branchId) ?? {
    id: input.branchId,
    code: input.branchId,
    name: 'Selected branch',
    isActive: true
  };

  return {
    customer: input.customer,
    branch,
    requestedAt: input.requestedAt,
    requestedFlow: input.requestedFlow,
    customPricingEnabled: input.customPricingEnabled,
    applicableLists,
    productRows
  };
}
