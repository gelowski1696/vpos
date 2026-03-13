import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { TenancyDatastoreMode } from '@prisma/client';
import { CompanyContextService } from '../../common/company-context.service';
import { PrismaService } from '../../common/prisma.service';
import { TenantDatasourceRouterService } from '../../common/tenant-datasource-router.service';

export type BrandingConfigRecord = {
  companyName: string;
  companyLogo: string | null;
  logoLight: string | null;
  logoDark: string | null;
  receiptLogo: string | null;
  primaryColor: string;
  secondaryColor: string;
  receiptFooterText: string;
  invoiceNumberFormat: string;
  officialNumberFormat: string;
  updatedAt: string;
};

type BrandingTierPolicy = {
  allowCustomLogos?: boolean;
  allowCustomColors?: boolean;
  allowCustomReceiptFooter?: boolean;
  allowCustomNumberFormats?: boolean;
  maxReceiptFooterLength?: number;
};

type BrandingEventContext = {
  planCode: string | null;
  payload: Record<string, unknown> | null;
};

@Injectable()
export class BrandingService {
  private readonly memoryConfigByCompany = new Map<string, BrandingConfigRecord>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyContext: CompanyContextService,
    private readonly tenantRouter: TenantDatasourceRouterService
  ) {}

  async getConfig(): Promise<BrandingConfigRecord> {
    const companyId = await this.companyContext.getCompanyId();
    const fallback = this.getMemoryConfig(companyId);
    let usingDedicated = false;
    try {
      const binding = await this.tenantRouter.forCompany(companyId);
      usingDedicated = binding.mode === TenancyDatastoreMode.DEDICATED_DB;
      const row = await binding.client.brandingConfig.upsert({
        where: { companyId },
        update: {},
        create: {
          companyId,
          companyName: fallback.companyName,
          companyLogo: fallback.companyLogo,
          logoLight: fallback.logoLight,
          logoDark: fallback.logoDark,
          receiptLogo: fallback.receiptLogo,
          primaryColor: fallback.primaryColor,
          secondaryColor: fallback.secondaryColor,
          receiptFooterText: fallback.receiptFooterText,
          invoiceNumberFormat: fallback.invoiceNumberFormat,
          officialNumberFormat: fallback.officialNumberFormat
        }
      });
      const mapped = this.map(row);
      this.setMemoryConfig(companyId, mapped);
      return mapped;
    } catch (error) {
      if (usingDedicated) {
        throw error;
      }
      return fallback;
    }
  }

  async updateConfig(payload: Partial<Omit<BrandingConfigRecord, 'updatedAt'>>): Promise<BrandingConfigRecord> {
    const companyId = await this.companyContext.getCompanyId();
    const fallback = this.getMemoryConfig(companyId);
    let nextMemory: BrandingConfigRecord = {
      ...fallback,
      ...payload,
      updatedAt: new Date().toISOString()
    };

    let usingDedicated = false;
    try {
      const binding = await this.tenantRouter.forCompany(companyId);
      usingDedicated = binding.mode === TenancyDatastoreMode.DEDICATED_DB;
      const existing = await binding.client.brandingConfig.findUnique({
        where: { companyId }
      });
      const current = existing ? this.map(existing) : fallback;

      await this.enforceTierBrandingPolicy(companyId, payload, current);

      nextMemory = {
        ...current,
        ...payload,
        updatedAt: new Date().toISOString()
      };

      const row = await binding.client.brandingConfig.upsert({
        where: { companyId },
        update: {
          companyName: payload.companyName,
          companyLogo: payload.companyLogo,
          logoLight: payload.logoLight,
          logoDark: payload.logoDark,
          receiptLogo: payload.receiptLogo,
          primaryColor: payload.primaryColor,
          secondaryColor: payload.secondaryColor,
          receiptFooterText: payload.receiptFooterText,
          invoiceNumberFormat: payload.invoiceNumberFormat,
          officialNumberFormat: payload.officialNumberFormat
        },
        create: {
          companyId,
          companyName: nextMemory.companyName,
          companyLogo: nextMemory.companyLogo,
          logoLight: nextMemory.logoLight,
          logoDark: nextMemory.logoDark,
          receiptLogo: nextMemory.receiptLogo,
          primaryColor: nextMemory.primaryColor,
          secondaryColor: nextMemory.secondaryColor,
          receiptFooterText: nextMemory.receiptFooterText,
          invoiceNumberFormat: nextMemory.invoiceNumberFormat,
          officialNumberFormat: nextMemory.officialNumberFormat
        }
      });
      nextMemory = this.map(row);
      this.setMemoryConfig(companyId, nextMemory);
    } catch (error) {
      if (usingDedicated) {
        throw error;
      }
      // keep in-memory value if DB is unavailable
      this.setMemoryConfig(companyId, nextMemory);
    }

    return nextMemory;
  }

  private getMemoryConfig(companyId: string): BrandingConfigRecord {
    const existing = this.memoryConfigByCompany.get(companyId);
    if (existing) {
      return existing;
    }
    const created = this.defaults();
    this.memoryConfigByCompany.set(companyId, created);
    return created;
  }

  private setMemoryConfig(companyId: string, config: BrandingConfigRecord): void {
    this.memoryConfigByCompany.set(companyId, config);
  }

  private defaults(): BrandingConfigRecord {
    return {
      companyName: 'VPOS Demo LPG Co.',
      companyLogo: null,
      logoLight: null,
      logoDark: null,
      receiptLogo: null,
      primaryColor: '#0B3C5D',
      secondaryColor: '#328CC1',
      receiptFooterText: 'Thank you for choosing VPOS LPG.',
      invoiceNumberFormat: '{BRANCH}-{YYYY}-{SEQ}',
      officialNumberFormat: 'OR-{YYYY}-{SEQ}',
      updatedAt: new Date().toISOString()
    };
  }

  private async enforceTierBrandingPolicy(
    companyId: string,
    payload: Partial<Omit<BrandingConfigRecord, 'updatedAt'>>,
    current: BrandingConfigRecord
  ): Promise<void> {
    const policy = await this.resolveTierPolicy(companyId);
    if (!policy) {
      return;
    }

    const changed = <K extends keyof Omit<BrandingConfigRecord, 'updatedAt'>>(key: K): boolean => {
      const nextValue = payload[key];
      if (nextValue === undefined) {
        return false;
      }
      return this.normalizeValue(nextValue) !== this.normalizeValue(current[key] as string | null);
    };

    if (policy.allowCustomLogos === false) {
      const logoTouched =
        changed('companyLogo') || changed('logoLight') || changed('logoDark') || changed('receiptLogo');
      if (logoTouched) {
        throw new ForbiddenException('Current subscription tier does not allow custom logos.');
      }
    }

    if (policy.allowCustomColors === false && (changed('primaryColor') || changed('secondaryColor'))) {
      throw new ForbiddenException('Current subscription tier does not allow custom theme colors.');
    }

    if (policy.allowCustomReceiptFooter === false && changed('receiptFooterText')) {
      throw new ForbiddenException('Current subscription tier does not allow custom receipt footer text.');
    }

    if (policy.allowCustomNumberFormats === false && (changed('invoiceNumberFormat') || changed('officialNumberFormat'))) {
      throw new ForbiddenException('Current subscription tier does not allow custom numbering formats.');
    }

    if (payload.receiptFooterText !== undefined && Number.isFinite(policy.maxReceiptFooterLength)) {
      const text = String(payload.receiptFooterText ?? '');
      if (text.length > Number(policy.maxReceiptFooterLength)) {
        throw new BadRequestException(
          `Receipt footer length exceeds tier limit (${Number(policy.maxReceiptFooterLength)} characters).`
        );
      }
    }
  }

  private normalizeValue(value: string | null | undefined): string {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value);
  }

  private async resolveTierPolicy(companyId: string): Promise<BrandingTierPolicy | null> {
    const configuredLimits = this.readConfiguredTierPolicies();
    const hasConfiguredLimits = Object.keys(configuredLimits).length > 0;

    if (!hasConfiguredLimits) {
      return null;
    }

    try {
      const context = await this.resolveBrandingEventContext(companyId);
      if (!context.planCode) {
        return this.readFeatureOverridePolicy(context.payload);
      }

      const base = configuredLimits[context.planCode.toUpperCase()] ?? null;
      const featureOverride = this.readFeatureOverridePolicy(context.payload);
      if (!base && !featureOverride) {
        return null;
      }
      return {
        ...(base ?? {}),
        ...(featureOverride ?? {})
      };
    } catch {
      // If entitlement context is unavailable, do not block branding updates.
      return null;
    }
  }

  private async resolveBrandingEventContext(companyId: string): Promise<BrandingEventContext> {
    const events = await this.prisma.companyEntitlementEvent.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { payload: true }
    });

    for (const row of events) {
      const payload = this.toRecord(row.payload);
      if (!payload) {
        continue;
      }
      const planCode = this.readString(payload, ['plan_code', 'planCode']);
      if (planCode) {
        return {
          planCode,
          payload
        };
      }
    }

    const latestPayload = events.length > 0 ? this.toRecord(events[0].payload) : null;
    return {
      planCode: null,
      payload: latestPayload
    };
  }

  private readConfiguredTierPolicies(): Record<string, BrandingTierPolicy> {
    const raw = process.env.VPOS_BRANDING_LIMITS_BY_PLAN_JSON?.trim();
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      const normalized: Record<string, BrandingTierPolicy> = {};
      for (const [key, value] of Object.entries(parsed)) {
        const policy = this.toBrandingTierPolicy(value);
        if (policy) {
          normalized[key.trim().toUpperCase()] = policy;
        }
      }
      return normalized;
    } catch {
      return {};
    }
  }

  private readFeatureOverridePolicy(payload: Record<string, unknown> | null): BrandingTierPolicy | null {
    if (!payload) {
      return null;
    }
    const features = this.toRecord(payload.features);
    const branding = this.toRecord(features?.branding ?? features?.branding_limits ?? payload.branding_limits);
    if (!branding) {
      return null;
    }
    return this.toBrandingTierPolicy(branding);
  }

  private toBrandingTierPolicy(value: unknown): BrandingTierPolicy | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const policy: BrandingTierPolicy = {};

    const allowCustomLogos = this.toBoolean(row.allowCustomLogos ?? row.allow_custom_logos);
    const allowCustomColors = this.toBoolean(row.allowCustomColors ?? row.allow_custom_colors);
    const allowCustomReceiptFooter = this.toBoolean(row.allowCustomReceiptFooter ?? row.allow_custom_receipt_footer);
    const allowCustomNumberFormats = this.toBoolean(row.allowCustomNumberFormats ?? row.allow_custom_number_formats);
    const maxReceiptFooterLength = this.toNumber(row.maxReceiptFooterLength ?? row.max_receipt_footer_length);

    if (allowCustomLogos !== null) {
      policy.allowCustomLogos = allowCustomLogos;
    }
    if (allowCustomColors !== null) {
      policy.allowCustomColors = allowCustomColors;
    }
    if (allowCustomReceiptFooter !== null) {
      policy.allowCustomReceiptFooter = allowCustomReceiptFooter;
    }
    if (allowCustomNumberFormats !== null) {
      policy.allowCustomNumberFormats = allowCustomNumberFormats;
    }
    if (maxReceiptFooterLength !== null) {
      policy.maxReceiptFooterLength = maxReceiptFooterLength;
    }

    if (Object.keys(policy).length === 0) {
      return null;
    }
    return policy;
  }

  private toBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === 'no') {
        return false;
      }
    }
    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
    }
    return null;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private readString(value: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    return null;
  }

  private map(row: {
    companyName: string;
    companyLogo: string | null;
    logoLight: string | null;
    logoDark: string | null;
    receiptLogo: string | null;
    primaryColor: string;
    secondaryColor: string;
    receiptFooterText: string | null;
    invoiceNumberFormat: string;
    officialNumberFormat: string;
    updatedAt: Date;
  }): BrandingConfigRecord {
    return {
      companyName: row.companyName,
      companyLogo: row.companyLogo,
      logoLight: row.logoLight,
      logoDark: row.logoDark,
      receiptLogo: row.receiptLogo,
      primaryColor: row.primaryColor,
      secondaryColor: row.secondaryColor,
      receiptFooterText: row.receiptFooterText ?? '',
      invoiceNumberFormat: row.invoiceNumberFormat,
      officialNumberFormat: row.officialNumberFormat,
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
