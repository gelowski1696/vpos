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

    const customer = await this.masterDataService.getCustomerById(input.customer_id);
    const activeLists = await this.masterDataService.getActivePriceLists(requestedAt);

    const contractPrice = await this.resolveContract(input, activeLists, requestedFlow);
    if (contractPrice) {
      return contractPrice;
    }

    const tierPrice = this.resolveTier(input, customer?.tier ?? null, activeLists, requestedFlow);
    if (tierPrice) {
      return tierPrice;
    }

    const branchPrice = this.resolveBranch(input, activeLists, requestedFlow);
    if (branchPrice) {
      return branchPrice;
    }

    const globalPrice = this.resolveGlobal(input, activeLists, requestedFlow);
    if (globalPrice) {
      return globalPrice;
    }

    throw new NotFoundException('No active price rule for product');
  }

  private async resolveContract(
    input: PriceResolutionInput,
    lists: Awaited<ReturnType<MasterDataService['getActivePriceLists']>>,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null
  ): Promise<PriceResolutionOutput | null> {
    const contractLists = lists.filter(
      (list) => list.scope === 'CONTRACT' && input.customer_id && list.customerId === input.customer_id
    );
    const contractRule = this.findRule(contractLists, input.product_id, requestedFlow);
    if (contractRule) {
      return {
        source: 'contract',
        unit_price: contractRule.unitPrice,
        discount_cap_percent: contractRule.discountCapPct
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
        discount_cap_percent: 0
      };
    }

    return null;
  }

  private resolveTier(
    input: PriceResolutionInput,
    customerTier: string | null,
    lists: Awaited<ReturnType<MasterDataService['getActivePriceLists']>>,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null
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
      discount_cap_percent: rule.discountCapPct
    };
  }

  private resolveBranch(
    input: PriceResolutionInput,
    lists: Awaited<ReturnType<MasterDataService['getActivePriceLists']>>,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null
  ): PriceResolutionOutput | null {
    const branchLists = lists.filter((list) => list.scope === 'BRANCH' && list.branchId === input.branch_id);
    const rule = this.findRule(branchLists, input.product_id, requestedFlow);
    if (!rule) {
      return null;
    }

    return {
      source: 'branch',
      unit_price: rule.unitPrice,
      discount_cap_percent: rule.discountCapPct
    };
  }

  private resolveGlobal(
    input: PriceResolutionInput,
    lists: Awaited<ReturnType<MasterDataService['getActivePriceLists']>>,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null
  ): PriceResolutionOutput | null {
    const globalLists = lists.filter((list) => list.scope === 'GLOBAL');
    const rule = this.findRule(globalLists, input.product_id, requestedFlow);
    if (!rule) {
      return null;
    }

    return {
      source: 'global',
      unit_price: rule.unitPrice,
      discount_cap_percent: rule.discountCapPct
    };
  }

  private findRule(
    lists: Awaited<ReturnType<MasterDataService['getActivePriceLists']>>,
    productId: string,
    requestedFlow: 'REFILL_EXCHANGE' | 'NON_REFILL' | null
  ): { unitPrice: number; discountCapPct: number; priority: number } | null {
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
