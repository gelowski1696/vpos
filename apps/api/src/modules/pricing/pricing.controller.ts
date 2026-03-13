import { Body, Controller, Post } from '@nestjs/common';
import { PriceResolutionInput, PriceResolutionOutput } from '@vpos/shared-types';
import { PricingService } from './pricing.service';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post('resolve')
  resolve(@Body() body: PriceResolutionInput): Promise<PriceResolutionOutput> {
    return this.pricingService.resolve(body);
  }
}
