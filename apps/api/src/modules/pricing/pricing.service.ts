import { Injectable, NotFoundException } from '@nestjs/common';
import { PriceResolutionInput, PriceResolutionOutput } from '@vpos/shared-types';
import { MasterDataService } from '../master-data/master-data.service';

@Injectable()
export class PricingService {
  constructor(private readonly masterDataService: MasterDataService) {}

  async resolve(input: PriceResolutionInput): Promise<PriceResolutionOutput> {
    const requestedAt = input.requested_at;
    const requestedFlow = this.normalizeFlowMode(input.cylinder_flow);
    const product = await this.masterDataService.getProductById(input.product_id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    const defaultUnitCost = product.standardCost ?? null;

    const customer = await this.masterDataService.getCustomerById(input.customer_id);
    const activeLists = await this.masterDataService.getActivePriceLists(requestedAt);

    const contractPrice = await this.resolveContract(input, activeLists, requestedFlow, defaultUnitCost);
    if (contractPrice) {
      return contractPrice;
    }

    const customerGroupPrice = this.resolveCustomerGroup(
      input,
      customer?.customerCategoryId ?? null,
      activeLists,
      requestedFlow,
      defaultUnitCost
    );
    if (customerGroupPrice) {
      return customerGroupPrice;
    }

    const tierPrice = this.resolveTier(input, customer?.tier ?? null, activeLists, requestedFlow, defaultUnitCost);
    if (tierPrice) {
      return tierPrice;
    }

    const branchPrice = this.resolveBranch(input, activeLists, requestedFlow, defaultUnitCost);
    if (branchPrice) {
      return branchPrice;
    }

    const globalPrice = this.resolveGlobal(input, activeLists, requestedFlow, defaultUnitCost);
    if (globalPrice) {
      return globalPrice;
    }

    throw new NotFoundException('No active price rule for product');
  }

  private async resolveContract(
    input: PriceResolutionInput,
    lists: Awaited<ReturnType<MasterDataService['getActivePriceLists']>>,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null,
    defaultUnitCost: number | null
  ): Promise<PriceResolutionOutput | null> {
    const contractLists = lists.filter(
      (list) => list.scope === 'CONTRACT' && input.customer_id && list.customerId === input.customer_id
    );
    const contractRule = this.findRule(contractLists, input.product_id, requestedFlow);
    if (contractRule) {
      return {
        source: 'contract',
        unit_price: contractRule.unitPrice,
        discount_cap_percent: contractRule.discountCapPct,
        resolved_unit_cost: this.resolveUnitCost(contractRule.unitCost, defaultUnitCost),
        price_list_id: contractRule.priceListId,
        price_rule_id: contractRule.ruleId
      };
    }

    if (!input.customer_id) {
      return null;
    }

    const customer = await this.masterDataService.getCustomerById(input.customer_id);
    if (customer?.contractPrice) {
      return {
        source: 'contract',
        unit_price: customer.contractPrice,
        discount_cap_percent: 0,
        resolved_unit_cost: defaultUnitCost
      };
    }

    return null;
  }

  private resolveCustomerGroup(
    input: PriceResolutionInput,
    customerCategoryId: string | null,
    lists: Awaited<ReturnType<MasterDataService['getActivePriceLists']>>,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null,
    defaultUnitCost: number | null
  ): PriceResolutionOutput | null {
    if (!customerCategoryId) {
      return null;
    }

    const groupLists = lists.filter(
      (list) => list.scope === 'CUSTOMER_GROUP' && list.customerCategoryId === customerCategoryId
    );
    const rule = this.findRule(groupLists, input.product_id, requestedFlow);
    if (!rule) {
      return null;
    }

    return {
      source: 'customer_group',
      unit_price: rule.unitPrice,
      discount_cap_percent: rule.discountCapPct,
      resolved_unit_cost: this.resolveUnitCost(rule.unitCost, defaultUnitCost),
      price_list_id: rule.priceListId,
      price_rule_id: rule.ruleId
    };
  }

  private resolveTier(
    input: PriceResolutionInput,
    customerTier: string | null,
    lists: Awaited<ReturnType<MasterDataService['getActivePriceLists']>>,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null,
    defaultUnitCost: number | null
  ): PriceResolutionOutput | null {
    if (!customerTier) {
      return null;
    }

    const tierLists = lists.filter((list) => list.scope === 'TIER' && list.customerTier === customerTier);
    const rule = this.findRule(tierLists, input.product_id, requestedFlow);
    if (!rule) {
      return null;
    }

    return {
      source: 'tier',
      unit_price: rule.unitPrice,
      discount_cap_percent: rule.discountCapPct,
      resolved_unit_cost: this.resolveUnitCost(rule.unitCost, defaultUnitCost),
      price_list_id: rule.priceListId,
      price_rule_id: rule.ruleId
    };
  }

  private resolveBranch(
    input: PriceResolutionInput,
    lists: Awaited<ReturnType<MasterDataService['getActivePriceLists']>>,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null,
    defaultUnitCost: number | null
  ): PriceResolutionOutput | null {
    const branchLists = lists.filter((list) => list.scope === 'BRANCH' && list.branchId === input.branch_id);
    const rule = this.findRule(branchLists, input.product_id, requestedFlow);
    if (!rule) {
      return null;
    }

    return {
      source: 'branch',
      unit_price: rule.unitPrice,
      discount_cap_percent: rule.discountCapPct,
      resolved_unit_cost: this.resolveUnitCost(rule.unitCost, defaultUnitCost),
      price_list_id: rule.priceListId,
      price_rule_id: rule.ruleId
    };
  }

  private resolveGlobal(
    input: PriceResolutionInput,
    lists: Awaited<ReturnType<MasterDataService['getActivePriceLists']>>,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null,
    defaultUnitCost: number | null
  ): PriceResolutionOutput | null {
    const globalLists = lists.filter((list) => list.scope === 'GLOBAL');
    const rule = this.findRule(globalLists, input.product_id, requestedFlow);
    if (!rule) {
      return null;
    }

    return {
      source: 'global',
      unit_price: rule.unitPrice,
      discount_cap_percent: rule.discountCapPct,
      resolved_unit_cost: this.resolveUnitCost(rule.unitCost, defaultUnitCost),
      price_list_id: rule.priceListId,
      price_rule_id: rule.ruleId
    };
  }

  private findRule(
    lists: Awaited<ReturnType<MasterDataService['getActivePriceLists']>>,
    productId: string,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null
  ): {
    ruleId: string;
    priceListId: string;
    unitPrice: number;
    unitCost?: number | null;
    discountCapPct: number;
    priority: number;
  } | null {
    const rules = lists
      .flatMap((list) =>
        list.rules
          .filter((rule) => {
            if (rule.productId !== productId) {
              return false;
            }
            return this.flowRank(rule.flowMode, requestedFlow) !== null;
          })
          .map((rule) => ({
            ...rule,
            ruleId: rule.id,
            priceListId: list.id,
            startsAt: list.startsAt,
            flowRank: this.flowRank(rule.flowMode, requestedFlow) ?? 99
          }))
      )
      .sort((a, b) => {
        if (a.flowRank !== b.flowRank) {
          return a.flowRank - b.flowRank;
        }
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }

        return new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
      });

    if (rules.length === 0) {
      return null;
    }

    return rules[0];
  }

  private resolveUnitCost(ruleUnitCost: number | null | undefined, defaultUnitCost: number | null): number | null {
    if (ruleUnitCost === null || ruleUnitCost === undefined) {
      return defaultUnitCost;
    }
    return Number(ruleUnitCost);
  }

  private normalizeFlowMode(value: unknown): 'REFILL_EXCHANGE' | 'NON_REFILL' | null {
    return value === 'REFILL_EXCHANGE' || value === 'NON_REFILL' ? value : null;
  }

  private flowRank(
    ruleFlowMode: unknown,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null
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
}
