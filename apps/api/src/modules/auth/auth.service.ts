import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Optional,
  UnauthorizedException
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { v4 as uuidv4 } from 'uuid';
import { AuthRepository } from './auth.repository';
import { PrismaService } from '../../common/prisma.service';

type TokenPair = {
  access_token: string;
  refresh_token: string;
  access_expires_in: string;
  refresh_expires_in: string;
};

type LoginTokenPair = TokenPair & {
  client_id: string;
};

type ManagedAuthUserInput = {
  id: string;
  company_id: string;
  email: string;
  full_name?: string;
  roles: string[];
  active: boolean;
  password?: string;
};

type AuthChannelOptions = {
  mobileChannel?: boolean;
  authAction?: string;
};

@Injectable()
export class AuthService {
  private seedReady?: Promise<void>;

  constructor(
    private readonly repository: AuthRepository,
    private readonly jwtService: JwtService,
    @Optional() private readonly prisma?: PrismaService
  ) {}

  private canUseDatabaseAuth(): boolean {
    return Boolean(this.prisma) && (process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true');
  }

  private isProductionRuntime(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private memoryFallbackAllowed(): boolean {
    if (process.env.VPOS_AUTH_ALLOW_MEMORY_FALLBACK === 'true') {
      return true;
    }
    return !this.isProductionRuntime();
  }

  private assertProductionDatabaseAuth(): void {
    if (this.isProductionRuntime() && !this.prisma) {
      throw new InternalServerErrorException('Database auth is required in production');
    }
  }

  private getPrismaIfEnabled(): PrismaService | null {
    return this.canUseDatabaseAuth() && this.prisma ? this.prisma : null;
  }

  private shouldSeedLegacyDemoTenant(): boolean {
    const raw = process.env.VPOS_AUTH_SEED_LEGACY_DEMO?.trim().toLowerCase();
    if (!raw) {
      return process.env.NODE_ENV === 'test';
    }
    return raw === 'true' || raw === '1' || raw === 'yes';
  }

  private async ensureSeedUsers(): Promise<void> {
    if (this.seedReady) {
      return this.seedReady;
    }

    this.seedReady = (async () => {
      this.assertProductionDatabaseAuth();
      const adminPasswordHash = await argon2.hash('Admin@123');
      const cashierPasswordHash = await argon2.hash('Cashier@123');
      const ownerPasswordHash = await argon2.hash('Owner@123');
      const seedLegacyDemo = this.shouldSeedLegacyDemoTenant();

      if (seedLegacyDemo && this.memoryFallbackAllowed()) {
        this.repository.upsertUser({
          id: 'user-admin-1',
          company_id: 'comp-demo',
          email: 'admin@vpos.local',
          password_hash: adminPasswordHash,
          roles: ['admin', 'supervisor'],
          active: true
        });
        this.repository.upsertUser({
          id: 'user-cashier-1',
          company_id: 'comp-demo',
          email: 'cashier@vpos.local',
          password_hash: cashierPasswordHash,
          roles: ['cashier'],
          active: true
        });
        this.repository.upsertUser({
          id: 'user-owner-1',
          company_id: 'comp-demo',
          email: 'owner@vpos.local',
          password_hash: ownerPasswordHash,
          roles: ['platform_owner', 'owner', 'admin'],
          active: true
        });
      }

      const prisma = this.getPrismaIfEnabled();
      if (!prisma) {
        return;
      }
      if (!seedLegacyDemo) {
        return;
      }

      try {
        const company = await prisma.company.upsert({
          where: { code: 'DEMO' },
          update: {
            name: 'VPOS Demo LPG Co.',
            currencyCode: 'PHP',
            timezone: 'Asia/Manila'
          },
          create: {
            id: 'comp-demo',
            code: 'DEMO',
            name: 'VPOS Demo LPG Co.',
            currencyCode: 'PHP',
            timezone: 'Asia/Manila'
          }
        });

        const roleAdmin = await prisma.role.upsert({
          where: { companyId_name: { companyId: company.id, name: 'admin' } },
          update: {},
          create: { companyId: company.id, name: 'admin' }
        });
        const roleSupervisor = await prisma.role.upsert({
          where: { companyId_name: { companyId: company.id, name: 'supervisor' } },
          update: {},
          create: { companyId: company.id, name: 'supervisor' }
        });
        const roleCashier = await prisma.role.upsert({
          where: { companyId_name: { companyId: company.id, name: 'cashier' } },
          update: {},
          create: { companyId: company.id, name: 'cashier' }
        });
        const rolePlatformOwner = await prisma.role.upsert({
          where: { companyId_name: { companyId: company.id, name: 'platform_owner' } },
          update: {},
          create: { companyId: company.id, name: 'platform_owner' }
        });
        const roleOwner = await prisma.role.upsert({
          where: { companyId_name: { companyId: company.id, name: 'owner' } },
          update: {},
          create: { companyId: company.id, name: 'owner' }
        });

        const adminUser = await prisma.user.upsert({
          where: { companyId_email: { companyId: company.id, email: 'admin@vpos.local' } },
          update: {
            fullName: 'Demo Admin',
            isActive: true,
            passwordHash: adminPasswordHash
          },
          create: {
            id: 'user-admin-1',
            companyId: company.id,
            email: 'admin@vpos.local',
            fullName: 'Demo Admin',
            passwordHash: adminPasswordHash,
            isActive: true
          }
        });

        const cashierUser = await prisma.user.upsert({
          where: { companyId_email: { companyId: company.id, email: 'cashier@vpos.local' } },
          update: {
            fullName: 'Demo Cashier',
            isActive: true,
            passwordHash: cashierPasswordHash
          },
          create: {
            id: 'user-cashier-1',
            companyId: company.id,
            email: 'cashier@vpos.local',
            fullName: 'Demo Cashier',
            passwordHash: cashierPasswordHash,
            isActive: true
          }
        });
        const ownerUser = await prisma.user.upsert({
          where: { companyId_email: { companyId: company.id, email: 'owner@vpos.local' } },
          update: {
            fullName: 'Platform Owner',
            isActive: true,
            passwordHash: ownerPasswordHash
          },
          create: {
            id: 'user-owner-1',
            companyId: company.id,
            email: 'owner@vpos.local',
            fullName: 'Platform Owner',
            passwordHash: ownerPasswordHash,
            isActive: true
          }
        });

        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: adminUser.id, roleId: roleAdmin.id } },
          update: {},
          create: { userId: adminUser.id, roleId: roleAdmin.id }
        });
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: adminUser.id, roleId: roleSupervisor.id } },
          update: {},
          create: { userId: adminUser.id, roleId: roleSupervisor.id }
        });
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: cashierUser.id, roleId: roleCashier.id } },
          update: {},
          create: { userId: cashierUser.id, roleId: roleCashier.id }
        });
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: ownerUser.id, roleId: rolePlatformOwner.id } },
          update: {},
          create: { userId: ownerUser.id, roleId: rolePlatformOwner.id }
        });
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: ownerUser.id, roleId: roleOwner.id } },
          update: {},
          create: { userId: ownerUser.id, roleId: roleOwner.id }
        });
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: ownerUser.id, roleId: roleAdmin.id } },
          update: {},
          create: { userId: ownerUser.id, roleId: roleAdmin.id }
        });
      } catch {
        // DB is optional during bootstrap/test fallback mode.
      }
    })();

    return this.seedReady;
  }

  private async resolveCompanyId(clientId?: string, emailHint?: string): Promise<{ companyId: string; clientCode: string }> {
    const explicitClientCode = clientId?.trim();
    const hasExplicitClientCode = Boolean(explicitClientCode);
    const configuredDefaultClient = process.env.DEFAULT_CLIENT_ID?.trim() ?? '';
    const requestedClientCode = (explicitClientCode || configuredDefaultClient).trim();
    const normalizedRequestedClientCode = requestedClientCode.toUpperCase();

    const prisma = this.getPrismaIfEnabled();
    if (prisma) {
      try {
        if (!hasExplicitClientCode && emailHint) {
          const emailMatches = await prisma.user.findMany({
            where: {
              email: emailHint,
              isActive: true
            },
            select: {
              companyId: true,
              company: {
                select: {
                  code: true,
                  externalClientId: true
                }
              }
            },
            take: 2
          });

          if (emailMatches.length === 1) {
            const row = emailMatches[0];
            return {
              companyId: row.companyId,
              clientCode: row.company.externalClientId ?? row.company.code
            };
          }

          if (emailMatches.length > 1) {
            throw new BadRequestException('Multiple tenant accounts found for this email. Enter tenant client id.');
          }
        }

        if (requestedClientCode) {
          const company = await prisma.company.findFirst({
            where: {
              OR: [
                { code: { equals: requestedClientCode, mode: 'insensitive' } },
                { externalClientId: { equals: requestedClientCode, mode: 'insensitive' } },
                { code: { equals: normalizedRequestedClientCode, mode: 'insensitive' } },
                { externalClientId: { equals: normalizedRequestedClientCode, mode: 'insensitive' } }
              ]
            },
            select: { id: true, code: true, externalClientId: true }
          });
          if (company) {
            return { companyId: company.id, clientCode: company.externalClientId ?? company.code };
          }
        }
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }
        if (this.isProductionRuntime()) {
          throw new InternalServerErrorException('Tenant resolution datastore unavailable');
        }
      }
    }

    if (!hasExplicitClientCode && emailHint && this.memoryFallbackAllowed()) {
      const match = this.repository.findByEmail(emailHint);
      if (match) {
        const inferredClientCode = match.company_id === 'comp-demo' ? 'DEMO' : match.company_id.replace(/^comp-/, '').toUpperCase();
        return { companyId: match.company_id, clientCode: inferredClientCode };
      }
    }

    if (!requestedClientCode) {
      throw new BadRequestException(
        'Tenant client id is required. Provide X-Client-Id or configure DEFAULT_CLIENT_ID.'
      );
    }

    if (this.isProductionRuntime() || !this.allowAuthTenantFallback()) {
      throw new UnauthorizedException('Tenant not found for client id');
    }

    return {
      companyId: this.fallbackCompanyId(normalizedRequestedClientCode),
      clientCode: normalizedRequestedClientCode
    };
  }

  private allowAuthTenantFallback(): boolean {
    return process.env.VPOS_AUTH_TENANT_FALLBACK === 'true';
  }

  private fallbackCompanyId(clientCode: string): string {
    if (clientCode.toUpperCase() === 'DEMO') {
      return 'comp-demo';
    }
    const normalized = clientCode.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return `comp-${normalized}`;
  }

  async login(
    email: string,
    password: string,
    deviceId: string,
    clientId?: string,
    options?: AuthChannelOptions
  ): Promise<LoginTokenPair> {
    this.assertProductionDatabaseAuth();
    await this.ensureSeedUsers();
    const normalizedEmail = email.trim().toLowerCase();
    const { companyId, clientCode } = await this.resolveCompanyId(clientId, normalizedEmail);

    const prisma = this.getPrismaIfEnabled();
    if (prisma) {
      try {
        const dbUser = await prisma.user.findUnique({
          where: {
            companyId_email: {
              companyId,
              email: normalizedEmail
            }
          },
          include: {
            userRoles: { include: { role: true } }
          }
        });

        if (!dbUser || !dbUser.isActive) {
          throw new UnauthorizedException('Invalid credentials');
        }
        const validPassword = await argon2.verify(dbUser.passwordHash, password);
        if (!validPassword) {
          throw new UnauthorizedException('Invalid credentials');
        }
        const roles = dbUser.userRoles.map((entry) => entry.role.name);
        await this.assertMobileCashierRolePolicy(
          options,
          dbUser.companyId,
          dbUser.id,
          dbUser.email,
          roles
        );
        await this.assertSubscriptionLoginAllowed(dbUser.companyId);
        const tokenPair = await this.issueTokenPair(dbUser.id, dbUser.companyId, dbUser.email, roles, deviceId);
        return {
          ...tokenPair,
          client_id: clientCode
        };
      } catch (error) {
        if (
          error instanceof UnauthorizedException ||
          error instanceof BadRequestException ||
          error instanceof ForbiddenException
        ) {
          throw error;
        }
        throw new InternalServerErrorException('Auth datastore unavailable');
      }
    }

    if (!this.memoryFallbackAllowed()) {
      throw new InternalServerErrorException('Auth datastore unavailable');
    }

    const memoryUser =
      this.repository.findByEmailAndCompany(normalizedEmail, companyId) ??
      (companyId === 'comp-demo' ? this.repository.findByEmail(normalizedEmail) : undefined);
    if (!memoryUser || !memoryUser.active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const validPassword = await argon2.verify(memoryUser.password_hash, password);
    if (!validPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.assertMobileCashierRolePolicy(
      options,
      memoryUser.company_id,
      memoryUser.id,
      memoryUser.email,
      memoryUser.roles
    );
    await this.assertSubscriptionLoginAllowed(memoryUser.company_id);

    const tokenPair = await this.issueTokenPair(memoryUser.id, memoryUser.company_id, memoryUser.email, memoryUser.roles, deviceId);
    return {
      ...tokenPair,
      client_id: clientCode
    };
  }

  async refresh(refreshToken: string, options?: AuthChannelOptions): Promise<TokenPair> {
    this.assertProductionDatabaseAuth();
    let payload: { sub: string; company_id: string; email: string; roles: string[]; type: string; jti: string; device_id: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret'
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const prisma = this.getPrismaIfEnabled();
    if (prisma) {
      try {
        const stored = await prisma.refreshToken.findUnique({
          where: { jti: payload.jti },
          include: {
            user: {
              include: {
                userRoles: { include: { role: true } }
              }
            }
          }
        });

        if (!stored) {
          throw new UnauthorizedException('Refresh token not found');
        }
        if (stored.revokedAt) {
          throw new UnauthorizedException('Refresh token reuse detected');
        }

        const matches = await argon2.verify(stored.tokenHash, refreshToken);
        if (!matches) {
          throw new UnauthorizedException('Refresh token mismatch');
        }

        const nextJti = uuidv4();
        await prisma.refreshToken.update({
          where: { id: stored.id },
          data: {
            revokedAt: new Date(),
            replacedBy: nextJti
          }
        });

        if (!stored.user.isActive) {
          throw new UnauthorizedException('User not active');
        }

        const roles = stored.user.userRoles.map((entry) => entry.role.name);
        await this.assertMobileCashierRolePolicy(
          options,
          stored.user.companyId,
          stored.user.id,
          stored.user.email,
          roles
        );
        await this.assertSubscriptionLoginAllowed(stored.user.companyId);
        return this.issueTokenPair(
          stored.user.id,
          stored.user.companyId,
          stored.user.email,
          roles,
          payload.device_id,
          nextJti
        );
      } catch (error) {
        if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
          throw error;
        }
        throw new InternalServerErrorException('Auth datastore unavailable');
      }
    }

    if (!this.memoryFallbackAllowed()) {
      throw new InternalServerErrorException('Auth datastore unavailable');
    }

    const stored = this.repository.getRefreshToken(payload.jti);
    if (!stored) {
      throw new UnauthorizedException('Refresh token not found');
    }

    if (stored.revoked) {
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const matches = await argon2.verify(stored.token_hash, refreshToken);
    if (!matches) {
      throw new UnauthorizedException('Refresh token mismatch');
    }

    const nextJti = uuidv4();
    this.repository.revokeRefreshToken(payload.jti, nextJti);

    const user = this.repository.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    await this.assertMobileCashierRolePolicy(
      options,
      user.company_id,
      user.id,
      user.email,
      user.roles
    );
    await this.assertSubscriptionLoginAllowed(user.company_id);

    return this.issueTokenPair(user.id, user.company_id, user.email, user.roles, payload.device_id, nextJti);
  }

  async logout(refreshToken?: string, options?: AuthChannelOptions): Promise<{ success: true }> {
    this.assertProductionDatabaseAuth();
    if (!refreshToken) {
      return { success: true };
    }

    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret'
      }) as {
        jti: string;
        type: string;
        sub?: string;
        company_id?: string;
        device_id?: string;
      };

      if (payload.type !== 'refresh') {
        throw new BadRequestException('Invalid token type');
      }

      const prisma = this.getPrismaIfEnabled();
      if (prisma) {
        try {
          await prisma.refreshToken.updateMany({
            where: {
              jti: payload.jti,
              revokedAt: null
            },
            data: {
              revokedAt: new Date()
            }
          });
          await this.recordMobileCashierSwitchAudit(payload, options);
          return { success: true };
        } catch {
          throw new InternalServerErrorException('Auth datastore unavailable');
        }
      }

      if (!this.memoryFallbackAllowed()) {
        throw new InternalServerErrorException('Auth datastore unavailable');
      }

      this.repository.revokeRefreshToken(payload.jti);
      await this.recordMobileCashierSwitchAudit(payload, options);
      return { success: true };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async issueTokenPairForUser(input: {
    userId: string;
    companyId: string;
    deviceId: string;
  }): Promise<LoginTokenPair> {
    this.assertProductionDatabaseAuth();
    await this.ensureSeedUsers();

    const prisma = this.getPrismaIfEnabled();
    if (prisma) {
      try {
        const dbUser = await prisma.user.findFirst({
          where: {
            id: input.userId,
            companyId: input.companyId
          },
          include: {
            userRoles: { include: { role: true } },
            company: {
              select: {
                code: true,
                externalClientId: true
              }
            }
          }
        });
        if (!dbUser || !dbUser.isActive) {
          throw new UnauthorizedException('User is not active');
        }

        const roles = dbUser.userRoles.map((entry) => entry.role.name);
        const tokenPair = await this.issueTokenPair(
          dbUser.id,
          dbUser.companyId,
          dbUser.email,
          roles,
          input.deviceId
        );
        return {
          ...tokenPair,
          client_id: dbUser.company.externalClientId ?? dbUser.company.code
        };
      } catch (error) {
        if (error instanceof UnauthorizedException) {
          throw error;
        }
        throw new InternalServerErrorException('Auth datastore unavailable');
      }
    }

    if (!this.memoryFallbackAllowed()) {
      throw new InternalServerErrorException('Auth datastore unavailable');
    }

    const user = this.repository.findById(input.userId);
    if (!user || user.company_id !== input.companyId || !user.active) {
      throw new UnauthorizedException('User is not active');
    }

    const tokenPair = await this.issueTokenPair(
      user.id,
      user.company_id,
      user.email,
      user.roles,
      input.deviceId
    );
    const clientCode = user.company_id === 'comp-demo' ? 'DEMO' : user.company_id.replace(/^comp-/, '').toUpperCase();
    return {
      ...tokenPair,
      client_id: clientCode
    };
  }

  async upsertManagedUser(input: ManagedAuthUserInput): Promise<void> {
    this.assertProductionDatabaseAuth();
    await this.ensureSeedUsers();
    const normalizedEmail = input.email.trim().toLowerCase();

    const prisma = this.getPrismaIfEnabled();
    if (prisma) {
      try {
        const byId = await prisma.user.findUnique({
          where: { id: input.id },
          select: { id: true, companyId: true, fullName: true, passwordHash: true }
        });

        const byEmail = await prisma.user.findUnique({
          where: {
            companyId_email: {
              companyId: input.company_id,
              email: normalizedEmail
            }
          },
          select: { id: true, companyId: true, fullName: true, passwordHash: true }
        });

        const existing = byId && byId.companyId === input.company_id ? byId : byEmail;

        let passwordHash = existing?.passwordHash;
        if (input.password && input.password.trim()) {
          passwordHash = await argon2.hash(input.password.trim());
        }
        if (!passwordHash) {
          passwordHash = await argon2.hash('Welcome@123');
        }

        const fullName = input.full_name?.trim() || existing?.fullName || normalizedEmail;
        const user =
          existing
            ? await prisma.user.update({
                where: { id: existing.id },
                data: {
                  email: normalizedEmail,
                  fullName,
                  isActive: input.active,
                  passwordHash
                }
              })
            : await prisma.user.create({
                data: {
                  id: input.id,
                  companyId: input.company_id,
                  email: normalizedEmail,
                  fullName,
                  passwordHash,
                  isActive: input.active
                }
              });

        const uniqueRoles = [...new Set(input.roles.map((role) => role.trim()).filter(Boolean))];
        const roleIds: string[] = [];
        for (const roleName of uniqueRoles) {
          const role = await prisma.role.upsert({
            where: {
              companyId_name: {
                companyId: input.company_id,
                name: roleName
              }
            },
            update: {},
            create: {
              companyId: input.company_id,
              name: roleName
            }
          });
          roleIds.push(role.id);
        }

        if (roleIds.length === 0) {
          await prisma.userRole.deleteMany({ where: { userId: user.id } });
        } else {
          await prisma.userRole.deleteMany({
            where: {
              userId: user.id,
              roleId: { notIn: roleIds }
            }
          });
          for (const roleId of roleIds) {
            await prisma.userRole.upsert({
              where: { userId_roleId: { userId: user.id, roleId } },
              update: {},
              create: { userId: user.id, roleId }
            });
          }
        }
        return;
      } catch {
        throw new InternalServerErrorException('Failed to provision auth user');
      }
    }

    if (!this.memoryFallbackAllowed()) {
      throw new InternalServerErrorException('Failed to provision auth user');
    }

    const existingById = this.repository.findById(input.id);
    const existingByEmail = this.repository.findByEmail(normalizedEmail);
    let passwordHash = existingById?.password_hash ?? existingByEmail?.password_hash;

    if (input.password && input.password.trim()) {
      passwordHash = await argon2.hash(input.password.trim());
    }
    if (!passwordHash) {
      passwordHash = await argon2.hash('Welcome@123');
    }

    this.repository.upsertUser({
      id: input.id,
      company_id: input.company_id,
      email: normalizedEmail,
      password_hash: passwordHash,
      roles: input.roles,
      active: input.active
    });
  }

  private async issueTokenPair(
    userId: string,
    companyId: string,
    email: string,
    roles: string[],
    deviceId: string,
    forcedJti?: string
  ): Promise<TokenPair> {
    this.assertProductionDatabaseAuth();
    const accessPayload = {
      sub: userId,
      company_id: companyId,
      email,
      roles,
      type: 'access'
    };

    const refreshJti = forcedJti ?? uuidv4();
    const refreshPayload = {
      ...accessPayload,
      type: 'refresh',
      jti: refreshJti,
      device_id: deviceId
    };

    const accessExpiresIn = process.env.JWT_ACCESS_TTL ?? '15m';
    const refreshExpiresIn = process.env.JWT_REFRESH_TTL ?? '7d';

    const accessToken = await this.jwtService.signAsync(accessPayload, {
      secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      expiresIn: accessExpiresIn
    });

    const refreshToken = await this.jwtService.signAsync(refreshPayload, {
      secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
      expiresIn: refreshExpiresIn
    });

    const refreshTokenHash = await argon2.hash(refreshToken);
    const prisma = this.getPrismaIfEnabled();
    if (prisma) {
      try {
        await prisma.refreshToken.create({
          data: {
            userId,
            jti: refreshJti,
            tokenHash: refreshTokenHash,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          }
        });
      } catch {
        throw new InternalServerErrorException('Failed to persist refresh token');
      }
    } else {
      if (!this.memoryFallbackAllowed()) {
        throw new InternalServerErrorException('Failed to persist refresh token');
      }
      this.repository.saveRefreshToken({
        jti: refreshJti,
        user_id: userId,
        company_id: companyId,
        token_hash: refreshTokenHash,
        revoked: false,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      });
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      access_expires_in: accessExpiresIn,
      refresh_expires_in: refreshExpiresIn
    };
  }

  private async assertMobileCashierRolePolicy(
    options: AuthChannelOptions | undefined,
    companyId: string,
    userId: string,
    email: string,
    roles: string[]
  ): Promise<void> {
    if (!options?.mobileChannel) {
      return;
    }
    const hasCashierRole = roles.some((role) => role.trim().toLowerCase() === 'cashier');
    if (hasCashierRole) {
      return;
    }
    await this.recordMobileAuthDeniedAudit(companyId, userId, email, roles);
    throw new UnauthorizedException('Mobile login is restricted to cashier accounts');
  }

  private async assertSubscriptionLoginAllowed(companyId: string): Promise<void> {
    const prisma = this.getPrismaIfEnabled();
    if (!prisma) {
      return;
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        subscriptionStatus: true,
        entitlement: {
          select: {
            status: true,
            graceUntil: true
          }
        }
      }
    });

    const status = company?.entitlement?.status ?? company?.subscriptionStatus ?? 'ACTIVE';
    const graceUntil = company?.entitlement?.graceUntil ?? null;

    if (status === 'ACTIVE') {
      return;
    }

    if (status === 'PAST_DUE' && graceUntil && graceUntil.getTime() >= Date.now()) {
      return;
    }

    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: 'SUBSCRIPTION_ENDED',
      subscription_status: status,
      grace_until: graceUntil ? graceUntil.toISOString() : null,
      message:
        status === 'PAST_DUE'
          ? 'Subscription has expired (grace window ended). Please renew your subscription.'
          : `Subscription is ${status}. Please contact your administrator.`
    });
  }

  private async recordMobileAuthDeniedAudit(
    companyId: string,
    userId: string,
    email: string,
    roles: string[]
  ): Promise<void> {
    const prisma = this.getPrismaIfEnabled();
    if (!prisma) {
      return;
    }
    try {
      await prisma.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'MOBILE_AUTH_DENIED_ROLE',
          level: 'WARNING',
          entity: 'User',
          entityId: userId,
          metadata: {
            email,
            roles,
            reason: 'cashier_role_required'
          }
        }
      });
    } catch {
      // Keep auth flow resilient even when audit sink is temporarily unavailable.
    }
  }

  private async recordMobileCashierSwitchAudit(
    payload: { sub?: string; company_id?: string; device_id?: string },
    options?: AuthChannelOptions
  ): Promise<void> {
    const action = (options?.authAction ?? '').trim().toLowerCase();
    if (!options?.mobileChannel || action !== 'switch_cashier') {
      return;
    }
    const companyId = payload.company_id?.trim();
    const userId = payload.sub?.trim();
    if (!companyId || !userId) {
      return;
    }

    const prisma = this.getPrismaIfEnabled();
    if (!prisma) {
      return;
    }
    try {
      await prisma.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'MOBILE_CASHIER_SWITCH',
          level: 'INFO',
          entity: 'User',
          entityId: userId,
          metadata: {
            device_id: payload.device_id ?? null,
            source: 'mobile_logout'
          }
        }
      });
    } catch {
      // Keep logout resilient if audit sink is unavailable.
    }
  }
}
