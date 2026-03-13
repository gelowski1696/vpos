import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from './prisma.service';
import { RequestContextService } from './request-context.service';

type TenantAwareRequest = Request & {
  clientId?: string;
  companyId?: string;
  datastoreMode?: 'SHARED_DB' | 'DEDICATED_DB';
  datastoreRef?: string | null;
};

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService
  ) {}

  async use(req: TenantAwareRequest, _res: Response, next: NextFunction): Promise<void> {
    const headerValue = req.headers['x-client-id'];
    const requestedClientId = (
      Array.isArray(headerValue) ? headerValue[0] : headerValue
    )?.trim();

    const defaultClientId = process.env.DEFAULT_CLIENT_ID?.trim();
    const clientId = requestedClientId || defaultClientId || '';
    const normalizedClientId = clientId.toUpperCase();
    let companyId: string | undefined;
    let resolvedClientId = clientId || undefined;
    let datastoreMode: 'SHARED_DB' | 'DEDICATED_DB' = 'SHARED_DB';
    let datastoreRef: string | null = null;

    const canUseDatabaseTenantLookup = process.env.NODE_ENV !== 'test' || process.env.VPOS_TEST_USE_DB === 'true';
    const allowFallback = this.allowTenantFallback();
    const fallbackCompanyId = clientId ? this.fallbackCompanyId(normalizedClientId) : undefined;

    if (clientId && canUseDatabaseTenantLookup) {
      try {
        let company = await this.prisma.company.findFirst({
          where: {
            OR: [
              { code: { equals: clientId, mode: 'insensitive' } },
              { externalClientId: { equals: clientId, mode: 'insensitive' } },
              { code: { equals: normalizedClientId, mode: 'insensitive' } },
              { externalClientId: { equals: normalizedClientId, mode: 'insensitive' } }
            ]
          },
          select: {
            id: true,
            code: true,
            externalClientId: true,
            datastoreMode: true,
            datastoreRef: true
          }
        });

        if (!company && normalizedClientId === 'DEMO' && this.allowLegacyDemoBootstrap()) {
          company = await this.prisma.company.create({
            data: {
              id: 'comp-demo',
              code: 'DEMO',
              externalClientId: 'DEMO',
              name: 'VPOS Demo LPG Co.',
              currencyCode: 'PHP',
              timezone: 'Asia/Manila'
            },
            select: {
              id: true,
              code: true,
              externalClientId: true,
              datastoreMode: true,
              datastoreRef: true
            }
          });
        }

        companyId = company?.id;
        resolvedClientId = company?.externalClientId ?? company?.code ?? clientId;
        datastoreMode = company?.datastoreMode ?? 'SHARED_DB';
        datastoreRef = company?.datastoreRef ?? null;
      } catch {
        companyId = allowFallback ? fallbackCompanyId : undefined;
        resolvedClientId = clientId;
      }
    } else if (clientId) {
      companyId = allowFallback ? fallbackCompanyId : undefined;
      resolvedClientId = clientId;
    }

    req.clientId = resolvedClientId;
    req.companyId = companyId;
    req.datastoreMode = datastoreMode;
    req.datastoreRef = datastoreRef;

    this.requestContext.run({ clientId: resolvedClientId, companyId, datastoreMode, datastoreRef }, () => {
      next();
    });
  }

  private allowLegacyDemoBootstrap(): boolean {
    return process.env.VPOS_ALLOW_DEMO_TENANT_BOOTSTRAP === 'true';
  }

  private allowTenantFallback(): boolean {
    if (process.env.VPOS_TENANT_CONTEXT_ALLOW_FALLBACK === 'true') {
      return true;
    }
    return process.env.NODE_ENV === 'test';
  }

  private fallbackCompanyId(clientId: string): string {
    if (clientId.toUpperCase() === 'DEMO') {
      return 'comp-demo';
    }
    const normalized = clientId.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    return `comp-${normalized}`;
  }
}
