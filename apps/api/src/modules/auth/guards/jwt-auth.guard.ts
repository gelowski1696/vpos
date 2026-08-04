import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      url?: string;
      originalUrl?: string;
      clientId?: string;
      companyId?: string;
      user?: { sub: string; email: string; roles: string[]; company_id: string; personnel_id?: string | null };
    }>();

    const authorization = this.pickHeader(request.headers.authorization);
    if (!authorization?.startsWith('Bearer ')) {
      if (this.tryPlatformOwnerKeyAuth(request)) {
        return true;
      }
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authorization.slice('Bearer '.length);
    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret'
      }) as {
        sub: string;
        email: string;
        roles: string[];
        type: string;
        company_id: string;
        personnel_id?: string | null;
        must_change_password?: boolean;
      };

      if (payload.type !== 'access') {
        throw new UnauthorizedException('Invalid token type');
      }
      if (request.companyId && payload.company_id !== request.companyId) {
        throw new UnauthorizedException('Tenant mismatch');
      }
      if (!request.companyId) {
        request.companyId = payload.company_id;
      }
      if (!request.companyId) {
        throw new UnauthorizedException('Tenant context missing');
      }

      request.user = {
        sub: payload.sub,
        email: payload.email,
        roles: payload.roles,
        company_id: payload.company_id,
        personnel_id: payload.personnel_id ?? null
      };
      if (
        payload.must_change_password &&
        this.isWebAdminClient(request.headers) &&
        !this.isPasswordChangePath(request.originalUrl ?? request.url ?? '')
      ) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Password change is required before accessing this module.'
        });
      }
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid token');
    }
  }

  private pickHeader(input: string | string[] | undefined): string | null {
    if (Array.isArray(input)) {
      return input[0]?.trim() || null;
    }
    if (typeof input === 'string') {
      return input.trim() || null;
    }
    return null;
  }

  private tryPlatformOwnerKeyAuth(request: {
    headers: Record<string, string | string[] | undefined>;
    url?: string;
    originalUrl?: string;
    companyId?: string;
    user?: { sub: string; email: string; roles: string[]; company_id: string };
  }): boolean {
    const expected =
      process.env.VCARD_PLATFORM_OWNER_KEY?.trim() ??
      process.env.VPOS_PLATFORM_OWNER_KEY?.trim() ??
      '';
    if (!expected) {
      return false;
    }

    const provided =
      this.pickHeader(request.headers['x-platform-owner-key']) ??
      this.pickHeader(request.headers['x-vcard-admin-key']) ??
      '';
    if (!provided || provided !== expected) {
      return false;
    }

    const path = (request.originalUrl ?? request.url ?? '').toLowerCase();
    const allowedPrefixes = [
      '/api/vcard',
      '/vcard',
      '/api/nfc',
      '/nfc',
      '/api/master-data/branches',
      '/master-data/branches',
      '/api/master-data/locations',
      '/master-data/locations',
      '/api/master-data/customers',
      '/master-data/customers'
    ];
    if (!allowedPrefixes.some((prefix) => path.startsWith(prefix))) {
      return false;
    }

    if (!request.companyId) {
      request.companyId = 'platform-owner';
    }
    request.user = {
      sub: 'platform-owner-service',
      email: 'platform-owner-service@vmjamtech.local',
      roles: ['platform_owner'],
      company_id: request.companyId
    };
    return true;
  }

  private isPasswordChangePath(path: string): boolean {
    const normalized = path.toLowerCase();
    return normalized.includes('/auth/change-password');
  }

  private isWebAdminClient(headers: Record<string, string | string[] | undefined>): boolean {
    const client = this.pickHeader(headers['x-vpos-client'])?.toLowerCase() ?? '';
    return client === 'web';
  }
}
