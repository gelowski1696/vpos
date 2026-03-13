import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
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
      headers: Record<string, string | undefined>;
      clientId?: string;
      companyId?: string;
      user?: { sub: string; email: string; roles: string[]; company_id: string };
    }>();

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = header.slice('Bearer '.length);
    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret'
      }) as { sub: string; email: string; roles: string[]; type: string; company_id: string };

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
        company_id: payload.company_id
      };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid token');
    }
  }
}
