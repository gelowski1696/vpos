import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Post,
  Req,
  UnauthorizedException
} from '@nestjs/common';
import { AuditActionLevel } from '@prisma/client';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from './audit.service';

type RequestWithUser = Request & {
  user?: {
    sub?: string;
    email?: string;
    name?: string;
    full_name?: string;
    company_id?: string;
    roles?: string[];
  };
  companyId?: string;
};

type WebAuditEventPayload = {
  method?: unknown;
  path?: unknown;
  outcome?: unknown;
  status?: unknown;
  status_code?: unknown;
  statusCode?: unknown;
  duration_ms?: unknown;
  durationMs?: unknown;
  message?: unknown;
  entity?: unknown;
  entity_id?: unknown;
  entityId?: unknown;
  company_id?: unknown;
  companyId?: unknown;
  target_company_id?: unknown;
  targetCompanyId?: unknown;
};

function readString(value: unknown, maxLength = 240): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function readNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function normalizeMethod(value: unknown): 'POST' | 'PUT' | 'PATCH' | 'DELETE' {
  const normalized = readString(value, 16)?.toUpperCase();
  if (normalized === 'PUT' || normalized === 'PATCH' || normalized === 'DELETE') {
    return normalized;
  }
  return 'POST';
}

function normalizeOutcome(payload: WebAuditEventPayload): 'SUCCESS' | 'ERROR' {
  const raw = readString(payload.outcome ?? payload.status, 32)?.toUpperCase();
  return raw === 'ERROR' || raw === 'FAILED' || raw === 'FAILURE' ? 'ERROR' : 'SUCCESS';
}

function actionFor(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', outcome: 'SUCCESS' | 'ERROR'): string {
  const verb = method === 'DELETE' ? 'DELETE' : method === 'PUT' || method === 'PATCH' ? 'UPDATE' : 'SAVE';
  return `WEB_${verb}_${outcome}`;
}

function entityFromPath(path: string): string {
  const pathname = path.split('?')[0] ?? path;
  const segments = pathname.split('/').map((segment) => segment.trim()).filter(Boolean);
  if (segments[0] === 'master-data' && segments[1]) {
    return `Web${toPascalCase(segments[1])}`;
  }
  if (segments[0] === 'platform' && segments[1] === 'owner' && segments[2] === 'tenants') {
    return 'WebTenant';
  }
  if (segments[0]) {
    return `Web${toPascalCase(segments[0])}`;
  }
  return 'WebRequest';
}

function toPascalCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join('');
}

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Roles('admin', 'owner', 'platform_owner', 'supervisor', 'cashier', 'driver', 'helper')
  @Post('web-event')
  async recordWebEvent(
    @Req() req: RequestWithUser,
    @Body() payload: WebAuditEventPayload
  ): Promise<{ ok: true }> {
    const actorCompanyId = this.requireCompanyId(req);
    const targetCompanyId = this.resolveTargetCompanyId(
      req,
      payload.target_company_id ?? payload.targetCompanyId ?? payload.company_id ?? payload.companyId,
      actorCompanyId
    );
    const path = readString(payload.path, 600);
    if (!path) {
      throw new BadRequestException('path is required');
    }

    const method = normalizeMethod(payload.method);
    const outcome = normalizeOutcome(payload);
    await this.auditService.record({
      companyId: targetCompanyId,
      userId: req.user?.sub ?? null,
      action: actionFor(method, outcome),
      entity: readString(payload.entity, 120) ?? entityFromPath(path),
      entityId: readString(payload.entity_id ?? payload.entityId, 180),
      level: outcome === 'ERROR' ? AuditActionLevel.WARNING : AuditActionLevel.INFO,
      metadata: {
        client: 'web',
        method,
        path,
        outcome,
        statusCode: readNumber(payload.status_code ?? payload.statusCode),
        durationMs: readNumber(payload.duration_ms ?? payload.durationMs),
        message: readString(payload.message, 800),
        actorUserId: req.user?.sub ?? null,
        actorName: readString(req.user?.name ?? req.user?.full_name, 240),
        actorEmail: readString(req.user?.email, 240),
        actorCompanyId,
        targetCompanyId
      }
    });
    return { ok: true };
  }

  private requireCompanyId(req: RequestWithUser): string {
    const companyId = req.user?.company_id ?? req.companyId;
    if (!companyId) {
      throw new UnauthorizedException('Tenant context missing');
    }
    return companyId;
  }

  private resolveTargetCompanyId(
    req: RequestWithUser,
    requestedCompanyId: unknown,
    actorCompanyId: string
  ): string {
    const requested = readString(requestedCompanyId, 180);
    if (!requested || requested === actorCompanyId) {
      return actorCompanyId;
    }
    const roles = req.user?.roles ?? [];
    if (!roles.includes('platform_owner')) {
      throw new ForbiddenException('Cross-tenant web audit events require platform_owner role');
    }
    return requested;
  }
}
