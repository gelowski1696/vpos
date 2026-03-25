import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UnauthorizedException
} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  VcardService,
  type VcardCapabilitiesResponse,
  type VcardTopologyResponse
} from './vcard.service';

type RequestWithTenant = Request & {
  user?: { company_id?: string; roles?: string[] };
  companyId?: string;
};

@Controller('vcard')
@Roles('admin', 'owner', 'platform_owner')
export class VcardController {
  constructor(private readonly vcardService: VcardService) {}

  @Get('capabilities')
  getCapabilities(@Req() req: RequestWithTenant): VcardCapabilitiesResponse {
    return this.vcardService.getCapabilities({
      actorCompanyId: req.user?.company_id ?? req.companyId,
      actorRoles: req.user?.roles ?? []
    });
  }

  @Get('topology')
  async getTopology(
    @Req() req: RequestWithTenant,
    @Query('companyId') companyId?: string
  ): Promise<VcardTopologyResponse> {
    const actorRoles = req.user?.roles ?? [];
    const actorCompanyId = req.user?.company_id ?? req.companyId;
    const targetCompanyId = companyId?.trim();
    const isPlatformOwner = actorRoles.map((role) => role.toLowerCase()).includes('platform_owner');

    if (!isPlatformOwner && !actorCompanyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    if (!isPlatformOwner && targetCompanyId && targetCompanyId !== actorCompanyId) {
      throw new ForbiddenException('Cross-tenant V-CARD topology requires platform_owner role');
    }

    return this.vcardService.getTopology({
      actorCompanyId,
      actorRoles,
      targetCompanyId
    });
  }
}
