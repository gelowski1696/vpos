import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RequestContextService } from './request-context.service';

@Injectable()
export class CompanyContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService
  ) {}

  async getCompanyId(): Promise<string> {
    const context = this.requestContext.get();
    if (context?.companyId) {
      return context.companyId;
    }

    const clientId = (context?.clientId || process.env.DEFAULT_CLIENT_ID || '').trim();
    if (!clientId) {
      throw new Error('Tenant context missing: client id is required');
    }
    const normalizedClientId = clientId.toUpperCase();
    const existing = await this.prisma.company.findFirst({
      where: {
        OR: [
          { code: { equals: clientId, mode: 'insensitive' } },
          { externalClientId: { equals: clientId, mode: 'insensitive' } },
          { code: { equals: normalizedClientId, mode: 'insensitive' } },
          { externalClientId: { equals: normalizedClientId, mode: 'insensitive' } }
        ]
      },
      select: { id: true }
    });

    if (existing) {
      return existing.id;
    }

    if (!(normalizedClientId === 'DEMO' && this.allowLegacyDemoBootstrap())) {
      throw new Error(`Company not found for client id: ${clientId}`);
    }

    const created = await this.prisma.company.create({
      data: {
        id: 'comp-demo',
        code: 'DEMO',
        externalClientId: 'DEMO',
        name: 'VPOS Demo LPG Co.',
        subscriptionStatus: 'ACTIVE',
        currencyCode: 'PHP',
        timezone: 'Asia/Manila'
      },
      select: { id: true }
    });

    return created.id;
  }

  private allowLegacyDemoBootstrap(): boolean {
    return process.env.VPOS_ALLOW_DEMO_TENANT_BOOTSTRAP === 'true';
  }
}
