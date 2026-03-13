import { Body, Controller, Get, Put } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { BrandingConfigRecord, BrandingService } from './branding.service';
import { UpdateBrandingDto } from './dto/update-branding.dto';

@Controller('branding')
@Roles('admin', 'owner')
export class BrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get('config')
  getConfig(): Promise<BrandingConfigRecord> {
    return this.brandingService.getConfig();
  }

  @Put('config')
  updateConfig(@Body() body: UpdateBrandingDto): Promise<BrandingConfigRecord> {
    return this.brandingService.updateConfig({
      companyName: body.companyName,
      companyLogo: body.companyLogo,
      logoLight: body.logoLight,
      logoDark: body.logoDark,
      receiptLogo: body.receiptLogo,
      primaryColor: body.primaryColor,
      secondaryColor: body.secondaryColor,
      receiptFooterText: body.receiptFooterText,
      invoiceNumberFormat: body.invoiceNumberFormat,
      officialNumberFormat: body.officialNumberFormat
    });
  }
}
