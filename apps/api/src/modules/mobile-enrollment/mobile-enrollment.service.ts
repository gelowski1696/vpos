import { BadRequestException, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { LocationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { TenantDatasourceRouterService } from '../../common/tenant-datasource-router.service';
import { AuthService } from '../auth/auth.service';

type EnrollmentTokenInput = {
  companyId: string;
  actorUserId?: string | null;
  userId: string;
  branchId: string;
  locationId: string;
  expiresInMinutes?: number;
};

type EnrollmentClaimInput = {
  setupToken: string;
  deviceId: string;
  claimedIp?: string | null;
  claimedUserAgent?: string | null;
};

const DEFAULT_EXPIRY_MINUTES = 60;
const MIN_EXPIRY_MINUTES = 5;
const MAX_EXPIRY_MINUTES = 240;

@Injectable()
export class MobileEnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    @Optional() private readonly tenantRouter?: TenantDatasourceRouterService
  ) {}

  async createToken(input: EnrollmentTokenInput): Promise<{
    id: string;
    expires_at: string;
    setup_token: string;
    setup_url: string;
    user: { id: string; email: string; full_name: string };
    branch: { id: string; code: string; name: string };
    location: { id: string; code: string; name: string };
  }> {
    const userId = input.userId.trim();
    const branchId = input.branchId.trim();
    const locationId = input.locationId.trim();
    if (!userId || !branchId || !locationId) {
      throw new BadRequestException('user_id, branch_id, and location_id are required');
    }

    const minutes = this.normalizeExpiryMinutes(input.expiresInMinutes);
    const expiresAt = new Date(Date.now() + minutes * 60_000);

    const [company, user, sharedBranch, sharedLocation] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: input.companyId },
        select: { id: true, code: true, externalClientId: true }
      }),
      this.prisma.user.findFirst({
        where: { id: userId, companyId: input.companyId, isActive: true },
        include: {
          userRoles: {
            include: {
              role: { select: { name: true } }
            }
          }
        }
      }),
      this.prisma.branch.findFirst({
        where: { id: branchId, companyId: input.companyId, isActive: true },
        select: { id: true, code: true, name: true }
      }),
      this.prisma.location.findFirst({
        where: { id: locationId, companyId: input.companyId, isActive: true },
        select: { id: true, code: true, name: true, branchId: true, type: true }
      })
    ]);

    if (!company) {
      throw new BadRequestException('Tenant company not found');
    }
    if (!user) {
      throw new BadRequestException('Cashier user not found or inactive');
    }

    const roleNames = user.userRoles.map((entry) => entry.role.name.toLowerCase());
    if (!roleNames.includes('cashier')) {
      throw new BadRequestException('QR setup can only be generated for cashier users');
    }

    const resolvedScope = await this.resolveBranchAndLocationScope(
      input.companyId,
      branchId,
      locationId,
      sharedBranch,
      sharedLocation
    );

    if (!resolvedScope.branch) {
      throw new BadRequestException('Selected branch not found or inactive');
    }
    if (!resolvedScope.location) {
      throw new BadRequestException('Selected location not found or inactive');
    }
    if (!resolvedScope.location.branchId || resolvedScope.location.branchId !== resolvedScope.branch.id) {
      throw new BadRequestException('Selected location does not belong to the selected branch');
    }

    const setupToken = this.generateRawToken();
    const tokenHash = this.hashToken(setupToken);

    const created = await this.prisma.mobileEnrollmentToken.create({
      data: {
        companyId: input.companyId,
        userId: user.id,
        branchId: resolvedScope.branch.id,
        locationId: resolvedScope.location.id,
        createdByUserId: input.actorUserId?.trim() || null,
        tokenHash,
        expiresAt
      },
      select: {
        id: true,
        expiresAt: true
      }
    });

    const setupUrl = this.buildSetupUrl(setupToken, company.externalClientId ?? company.code);

    return {
      id: created.id,
      expires_at: created.expiresAt.toISOString(),
      setup_token: setupToken,
      setup_url: setupUrl,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.fullName
      },
      branch: resolvedScope.branch,
      location: {
        id: resolvedScope.location.id,
        code: resolvedScope.location.code,
        name: resolvedScope.location.name
      }
    };
  }

  async claimToken(input: EnrollmentClaimInput): Promise<{
    access_token: string;
    refresh_token: string;
    access_expires_in: string;
    refresh_expires_in: string;
    client_id: string;
    user_id: string;
    user_email: string;
    user_full_name: string;
    branch_id: string;
    branch_code: string;
    branch_name: string;
    location_id: string;
    location_code: string;
    location_name: string;
  }> {
    const setupToken = input.setupToken.trim();
    const deviceId = input.deviceId.trim();
    if (!setupToken || !deviceId) {
      throw new BadRequestException('setup_token and device_id are required');
    }

    const tokenHash = this.hashToken(setupToken);
    const now = new Date();

    const consumed = await this.prisma.$transaction(async (tx) => {
      const row = await tx.mobileEnrollmentToken.findUnique({
        where: { tokenHash },
        include: {
          company: { select: { id: true, code: true, externalClientId: true } },
          user: {
            include: {
              userRoles: {
                include: {
                  role: { select: { name: true } }
                }
              }
            }
          },
          branch: { select: { id: true, code: true, name: true } },
          location: { select: { id: true, code: true, name: true, branchId: true } }
        }
      });

      if (!row || row.revokedAt) {
        throw new UnauthorizedException('Invalid or revoked setup token');
      }
      if (row.usedAt) {
        throw new UnauthorizedException('Setup token was already used');
      }
      if (row.expiresAt.getTime() <= now.getTime()) {
        throw new UnauthorizedException('Setup token expired');
      }
      if (!row.user.isActive) {
        throw new UnauthorizedException('Cashier account is inactive');
      }
      if (row.location.branchId !== row.branch.id) {
        throw new UnauthorizedException('Setup token scope is invalid');
      }

      const roles = row.user.userRoles.map((entry) => entry.role.name.toLowerCase());
      if (!roles.includes('cashier')) {
        throw new UnauthorizedException('Setup token user is no longer a cashier');
      }

      const marked = await tx.mobileEnrollmentToken.updateMany({
        where: {
          id: row.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now }
        },
        data: {
          usedAt: now,
          claimedDeviceId: deviceId,
          claimedIp: input.claimedIp?.trim() || null,
          claimedUserAgent: input.claimedUserAgent?.trim() || null
        }
      });

      if (marked.count !== 1) {
        throw new UnauthorizedException('Setup token was already consumed');
      }

      return row;
    });

    const tokenPair = await this.authService.issueTokenPairForUser({
      userId: consumed.user.id,
      companyId: consumed.company.id,
      deviceId
    });

    return {
      ...tokenPair,
      user_id: consumed.user.id,
      user_email: consumed.user.email,
      user_full_name: consumed.user.fullName,
      branch_id: consumed.branch.id,
      branch_code: consumed.branch.code,
      branch_name: consumed.branch.name,
      location_id: consumed.location.id,
      location_code: consumed.location.code,
      location_name: consumed.location.name
    };
  }

  private normalizeExpiryMinutes(value?: number): number {
    if (value === undefined || value === null) {
      return DEFAULT_EXPIRY_MINUTES;
    }
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) {
      throw new BadRequestException('expires_in_minutes must be a number');
    }
    const rounded = Math.floor(normalized);
    if (rounded < MIN_EXPIRY_MINUTES || rounded > MAX_EXPIRY_MINUTES) {
      throw new BadRequestException(
        `expires_in_minutes must be between ${MIN_EXPIRY_MINUTES} and ${MAX_EXPIRY_MINUTES}`
      );
    }
    return rounded;
  }

  private generateRawToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private buildSetupUrl(token: string, clientId: string): string {
    const scheme = process.env.MOBILE_SETUP_SCHEME?.trim() || 'vpos';
    return `${scheme}://enroll?token=${encodeURIComponent(token)}&client_id=${encodeURIComponent(clientId)}`;
  }

  private async resolveBranchAndLocationScope(
    companyId: string,
    branchId: string,
    locationId: string,
    sharedBranch: { id: string; code: string; name: string } | null,
    sharedLocation: { id: string; code: string; name: string; branchId: string | null; type: LocationType } | null
  ): Promise<{
    branch: { id: string; code: string; name: string } | null;
    location: { id: string; code: string; name: string; branchId: string | null; type: LocationType } | null;
  }> {
    let branch = sharedBranch;
    let location = sharedLocation;

    if (branch && location) {
      return { branch, location };
    }

    if (!this.tenantRouter) {
      return { branch, location };
    }

    try {
      const binding = await this.tenantRouter.forCompany(companyId);
      const [tenantBranch, tenantLocation] = await Promise.all([
        binding.client.branch.findFirst({
          where: { id: branchId, companyId, isActive: true },
          select: { id: true, code: true, name: true }
        }),
        binding.client.location.findFirst({
          where: { id: locationId, companyId, isActive: true },
          select: { id: true, code: true, name: true, branchId: true, type: true }
        })
      ]);

      if (tenantBranch && !branch) {
        branch = tenantBranch;
      }
      if (tenantLocation && !location) {
        location = tenantLocation;
      }

      // Keep shared control DB references in sync so MobileEnrollmentToken FK constraints remain valid.
      if (tenantBranch) {
        await this.prisma.branch.upsert({
          where: { id: tenantBranch.id },
          update: {
            companyId,
            code: tenantBranch.code,
            name: tenantBranch.name,
            isActive: true
          },
          create: {
            id: tenantBranch.id,
            companyId,
            code: tenantBranch.code,
            name: tenantBranch.name,
            isActive: true
          }
        });
      }

      if (tenantLocation) {
        await this.prisma.location.upsert({
          where: { id: tenantLocation.id },
          update: {
            companyId,
            branchId: tenantLocation.branchId,
            code: tenantLocation.code,
            name: tenantLocation.name,
            type: tenantLocation.type,
            isActive: true
          },
          create: {
            id: tenantLocation.id,
            companyId,
            branchId: tenantLocation.branchId,
            code: tenantLocation.code,
            name: tenantLocation.name,
            type: tenantLocation.type ?? LocationType.BRANCH_STORE,
            isActive: true
          }
        });
      }
    } catch {
      // Fall back to shared lookup result only.
    }

    return { branch, location };
  }
}
