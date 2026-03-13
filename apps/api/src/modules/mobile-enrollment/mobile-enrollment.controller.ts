import { BadRequestException, Body, Controller, ForbiddenException, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { MobileEnrollmentService } from './mobile-enrollment.service';

type RequestWithTenant = Request & {
  user?: { sub?: string; company_id?: string; roles?: string[] };
  companyId?: string;
};

@Controller('mobile-enrollment')
export class MobileEnrollmentController {
  constructor(private readonly mobileEnrollmentService: MobileEnrollmentService) {}

  @Post('tokens')
  @Roles('owner', 'platform_owner')
  async createToken(
    @Req() req: RequestWithTenant,
    @Body() body: Record<string, unknown>
  ): ReturnType<MobileEnrollmentService['createToken']> {
    const companyId = this.resolveTargetCompanyId(req, body.companyId);
    const userId = String(body.user_id ?? body.userId ?? '').trim();
    const branchId = String(body.branch_id ?? body.branchId ?? '').trim();
    const locationId = String(body.location_id ?? body.locationId ?? '').trim();
    const expiresInMinutesRaw = body.expires_in_minutes ?? body.expiresInMinutes;
    const expiresInMinutes =
      expiresInMinutesRaw === undefined || expiresInMinutesRaw === null || expiresInMinutesRaw === ''
        ? undefined
        : Number(expiresInMinutesRaw);

    if (!userId || !branchId || !locationId) {
      throw new BadRequestException('user_id, branch_id, and location_id are required');
    }

    return this.mobileEnrollmentService.createToken({
      companyId,
      actorUserId: req.user?.sub ?? null,
      userId,
      branchId,
      locationId,
      expiresInMinutes
    });
  }

  @Public()
  @Post('claim')
  async claimToken(
    @Req() req: Request,
    @Body() body: Record<string, unknown>
  ): ReturnType<MobileEnrollmentService['claimToken']> {
    const setupToken = String(body.setup_token ?? body.setupToken ?? '').trim();
    const deviceId = String(body.device_id ?? body.deviceId ?? '').trim();
    if (!setupToken || !deviceId) {
      throw new BadRequestException('setup_token and device_id are required');
    }

    const claimedIp = this.readClaimedIp(req);
    const claimedUserAgent = String(req.headers['user-agent'] ?? '').trim() || null;
    return this.mobileEnrollmentService.claimToken({
      setupToken,
      deviceId,
      claimedIp,
      claimedUserAgent
    });
  }

  private requireCompanyId(req: RequestWithTenant): string {
    const companyId = req.user?.company_id ?? req.companyId;
    if (!companyId) {
      throw new BadRequestException('Tenant context missing');
    }
    return companyId;
  }

  private resolveTargetCompanyId(req: RequestWithTenant, requestedCompanyId: unknown): string {
    const actorCompanyId = this.requireCompanyId(req);
    const requested =
      typeof requestedCompanyId === 'string'
        ? requestedCompanyId.trim()
        : typeof requestedCompanyId === 'number'
          ? String(requestedCompanyId)
          : '';

    if (!requested || requested === actorCompanyId) {
      return actorCompanyId;
    }

    const roles = req.user?.roles ?? [];
    if (!roles.includes('platform_owner')) {
      throw new ForbiddenException('Cross-tenant enrollment setup requires platform_owner role');
    }

    return requested;
  }

  private readClaimedIp(req: Request): string | null {
    const forwarded = req.headers['x-forwarded-for'];
    if (Array.isArray(forwarded) && forwarded.length > 0) {
      return forwarded[0]?.split(',')[0]?.trim() || null;
    }
    if (typeof forwarded === 'string' && forwarded.trim()) {
      return forwarded.split(',')[0]?.trim() || null;
    }
    if (typeof req.ip === 'string' && req.ip.trim()) {
      return req.ip.trim();
    }
    return null;
  }
}
