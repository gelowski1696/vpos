import { BadGatewayException, Injectable } from '@nestjs/common';
import { SubmanTokenService } from './subman-token.service';

type SubscriptionGatewayMeta = {
  source: 'network' | 'cache';
  stale: boolean;
  fetchedAt: string;
  failureCount: number;
  circuitOpenUntil: string | null;
};

type SubscriptionGatewayResult = {
  payload: Record<string, unknown>;
  meta: SubscriptionGatewayMeta;
};

type SubscriptionTenantProfileResult = {
  payload: Record<string, unknown>;
  meta: SubscriptionGatewayMeta;
};

type ActiveSubscriptionOption = {
  subscription_id: string;
  status: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  plan_id: string | null;
  plan_name: string | null;
  start_date: string | null;
  end_date: string | null;
  next_billing_date: string | null;
  client_id_hint: string;
};

type ActiveSubscriptionListResult = {
  items: ActiveSubscriptionOption[];
  meta: SubscriptionGatewayMeta;
};

type FetchOptions = {
  allowStaleOnFailure?: boolean;
  apiKeyOverride?: string;
  bearerTokenOverride?: string;
};

type CacheEntry = {
  payload: Record<string, unknown>;
  fetchedAt: number;
};

class SubmanUnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmanUnauthorizedError';
  }
}

@Injectable()
export class SubscriptionGatewayService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly profileCache = new Map<string, CacheEntry>();
  private readonly activeListCache = new Map<string, CacheEntry>();
  private consecutiveFailures = 0;
  private circuitOpenUntilMs = 0;

  constructor(private readonly tokenService: SubmanTokenService) {}

  private readMs(envKey: string, fallback: number): number {
    const raw = Number(process.env[envKey]);
    if (!Number.isFinite(raw) || raw <= 0) {
      return fallback;
    }
    return Math.floor(raw);
  }

  private get cacheTtlMs(): number {
    return this.readMs('SUBMAN_CACHE_TTL_MS', 60_000);
  }

  private get staleCacheTtlMs(): number {
    return this.readMs('SUBMAN_STALE_TTL_MS', 10 * 60_000);
  }

  private get circuitFailureThreshold(): number {
    return this.readMs('SUBMAN_CIRCUIT_FAIL_THRESHOLD', 3);
  }

  private get circuitOpenMs(): number {
    return this.readMs('SUBMAN_CIRCUIT_OPEN_MS', 45_000);
  }

  private isCircuitOpen(now: number): boolean {
    return this.circuitOpenUntilMs > now;
  }

  private toResult(entry: CacheEntry, source: 'network' | 'cache', stale: boolean): SubscriptionGatewayResult {
    return {
      payload: entry.payload,
      meta: {
        source,
        stale,
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
        failureCount: this.consecutiveFailures,
        circuitOpenUntil: this.circuitOpenUntilMs > Date.now() ? new Date(this.circuitOpenUntilMs).toISOString() : null
      }
    };
  }

  private toListResult(entry: CacheEntry, source: 'network' | 'cache', stale: boolean): ActiveSubscriptionListResult {
    return {
      items: this.toActiveSubscriptionOptions(entry.payload),
      meta: {
        source,
        stale,
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
        failureCount: this.consecutiveFailures,
        circuitOpenUntil: this.circuitOpenUntilMs > Date.now() ? new Date(this.circuitOpenUntilMs).toISOString() : null
      }
    };
  }

  private getFreshCache(clientId: string, now: number): CacheEntry | undefined {
    const cached = this.cache.get(clientId);
    if (!cached) {
      return undefined;
    }
    if (now - cached.fetchedAt <= this.cacheTtlMs) {
      return cached;
    }
    return undefined;
  }

  private getStaleCache(clientId: string, now: number): CacheEntry | undefined {
    const cached = this.cache.get(clientId);
    if (!cached) {
      return undefined;
    }
    if (now - cached.fetchedAt <= this.staleCacheTtlMs) {
      return cached;
    }
    return undefined;
  }

  private markFailure(now: number): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.circuitFailureThreshold) {
      this.circuitOpenUntilMs = now + this.circuitOpenMs;
    }
  }

  private markSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntilMs = 0;
  }

  private normalizePayload(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== 'object') {
      return {};
    }
    const root = payload as Record<string, unknown>;
    const data = root.data;
    if (Array.isArray(data)) {
      return { data };
    }
    if (data && typeof data === 'object') {
      return data as Record<string, unknown>;
    }
    return root;
  }

  private async buildGatewayHeaders(
    clientId: string,
    apiKeyOverride?: string,
    bearerTokenOverride?: string,
    forceRefreshToken = false
  ): Promise<Record<string, string>> {
    const gatewayClientId = process.env.SUBMAN_CLIENT_ID?.trim() || clientId;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Client-Id': gatewayClientId
    };

    const apiKey = apiKeyOverride?.trim() || process.env.SUBMAN_API_KEY?.trim();
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const bearerToken =
      bearerTokenOverride?.trim() ||
      (await this.tokenService.getBearerToken(forceRefreshToken)) ||
      process.env.SUBMAN_BEARER_TOKEN?.trim();
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }

    return headers;
  }

  private async fetchJson(
    url: string,
    headers: Record<string, string>,
    timeoutMs: number
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      const raw = await response.text();
      let payload: Record<string, unknown> = {};
      try {
        payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        payload = {};
      }
      if (!response.ok) {
        const upstreamMessage = (() => {
          const value = payload.message;
          if (Array.isArray(value) && value.length > 0) {
            return String(value[0]);
          }
          if (typeof value === 'string' && value.trim()) {
            return value.trim();
          }
          if (typeof raw === 'string' && raw.trim()) {
            return raw.trim();
          }
          return '';
        })();

        if (response.status === 401) {
          throw new SubmanUnauthorizedError(
            upstreamMessage || 'Subscription gateway unauthorized (401)'
          );
        }

        throw new BadGatewayException(
          `Subscription gateway request failed (${response.status})${upstreamMessage ? `: ${upstreamMessage}` : ''}`
        );
      }
      return this.normalizePayload(payload);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchJsonWithAuthRetry(
    url: string,
    clientId: string,
    timeoutMs: number,
    options: FetchOptions = {}
  ): Promise<Record<string, unknown>> {
    const headers = await this.buildGatewayHeaders(
      clientId,
      options.apiKeyOverride,
      options.bearerTokenOverride,
      false
    );

    try {
      return await this.fetchJson(url, headers, timeoutMs);
    } catch (error) {
      if (!(error instanceof SubmanUnauthorizedError)) {
        throw error;
      }

      const usingApiKey = Boolean(options.apiKeyOverride?.trim() || process.env.SUBMAN_API_KEY?.trim());
      const usingTokenOverride = Boolean(options.bearerTokenOverride?.trim());
      if (usingApiKey || usingTokenOverride || !this.tokenService.isEnabled()) {
        throw new BadGatewayException(
          `Subscription gateway unauthorized (401). ${error.message}. Configure SUBMAN_API_KEY or SUBMAN_BEARER_TOKEN.`
        );
      }

      this.tokenService.invalidateCachedToken();
      const retryHeaders = await this.buildGatewayHeaders(
        clientId,
        options.apiKeyOverride,
        options.bearerTokenOverride,
        true
      );
      try {
        return await this.fetchJson(url, retryHeaders, timeoutMs);
      } catch (retryError) {
        if (retryError instanceof SubmanUnauthorizedError) {
          throw new BadGatewayException(
            `Subscription gateway unauthorized (401) after token refresh. ${retryError.message}`
          );
        }
        throw retryError;
      }
    }
  }

  private resolveBaseUrl(): string {
    const baseUrl = process.env.SUBMAN_BASE_URL?.trim();
    if (!baseUrl) {
      throw new BadGatewayException('SUBMAN_BASE_URL is not configured');
    }
    return baseUrl.replace(/\/$/, '');
  }

  private resolvePath(pathTemplate: string, clientId: string): string {
    const encodedClientId = encodeURIComponent(clientId);
    return pathTemplate
      .replace(':client_id', encodedClientId)
      .replace('{client_id}', encodedClientId);
  }

  private buildUrl(baseUrl: string, pathTemplate: string, clientId: string): string {
    const resolvedPath = this.resolvePath(pathTemplate, clientId);
    return `${baseUrl}${resolvedPath.startsWith('/') ? resolvedPath : `/${resolvedPath}`}`;
  }

  private readLegacySubscriptions(raw: Record<string, unknown>): Array<Record<string, unknown>> {
    const data = raw.data;
    if (Array.isArray(data)) {
      return data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
    }
    if (raw && typeof raw === 'object' && 'status' in raw) {
      return [raw];
    }
    return [];
  }

  private pickLegacySubscription(
    rows: Array<Record<string, unknown>>
  ): Record<string, unknown> | undefined {
    if (rows.length === 0) {
      return undefined;
    }
    const score = (statusRaw: unknown): number => {
      const status = String(statusRaw ?? '').toUpperCase();
      if (status === 'ACTIVE') return 5;
      if (status === 'TRIALING') return 4;
      if (status === 'PAUSED') return 3;
      if (status === 'CANCELED') return 2;
      if (status === 'EXPIRED') return 1;
      return 0;
    };

    return [...rows].sort((a, b) => score(b.status) - score(a.status))[0];
  }

  private normalizeMatchValue(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private pickSubscriptionForTarget(
    rows: Array<Record<string, unknown>>,
    targetClientId: string
  ): Record<string, unknown> | undefined {
    if (rows.length === 0) {
      return undefined;
    }

    const needle = this.normalizeMatchValue(targetClientId);
    if (!needle) {
      return this.pickLegacySubscription(rows);
    }

    const exactMatch = rows.find((row) => {
      const customer =
        row.customer && typeof row.customer === 'object'
          ? (row.customer as Record<string, unknown>)
          : {};

      const candidates = [
        row.id,
        row.clientId,
        row.customerId,
        customer.id,
        customer.email,
        customer.storeName,
        customer.store_name,
        customer.fullName,
        customer.full_name
      ];

      return candidates.some((candidate) => this.normalizeMatchValue(candidate) === needle);
    });

    if (exactMatch) {
      return exactMatch;
    }

    return this.pickLegacySubscription(rows);
  }

  private toStringOrNull(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized : null;
  }

  private toClientIdHint(row: Record<string, unknown>): string {
    const subscriptionId = this.toStringOrNull(row.id);
    if (subscriptionId) {
      return subscriptionId;
    }

    const customer =
      row.customer && typeof row.customer === 'object'
        ? (row.customer as Record<string, unknown>)
        : {};
    const fallback =
      this.toStringOrNull(customer.email) ??
      this.toStringOrNull(customer.id) ??
      this.toStringOrNull(row.customerId) ??
      'SUBSCRIPTION';

    return fallback;
  }

  private toActiveSubscriptionOption(row: Record<string, unknown>): ActiveSubscriptionOption {
    const customer =
      row.customer && typeof row.customer === 'object'
        ? (row.customer as Record<string, unknown>)
        : {};
    const plan =
      row.plan && typeof row.plan === 'object'
        ? (row.plan as Record<string, unknown>)
        : {};

    const customerName =
      this.toStringOrNull(customer.storeName) ??
      this.toStringOrNull(customer.store_name) ??
      this.toStringOrNull(customer.fullName) ??
      this.toStringOrNull(customer.full_name) ??
      this.toStringOrNull(customer.email) ??
      `Customer ${this.toStringOrNull(customer.id) ?? this.toStringOrNull(row.customerId) ?? 'Unknown'}`;

    return {
      subscription_id: this.toStringOrNull(row.id) ?? this.toClientIdHint(row),
      status: String(row.status ?? 'ACTIVE').toUpperCase(),
      customer_id: this.toStringOrNull(row.customerId) ?? this.toStringOrNull(customer.id),
      customer_name: customerName,
      customer_email: this.toStringOrNull(customer.email),
      plan_id: this.toStringOrNull(row.planId) ?? this.toStringOrNull(plan.id),
      plan_name: this.toStringOrNull(plan.name),
      start_date: this.toStringOrNull(row.startDate),
      end_date: this.toStringOrNull(row.endDate),
      next_billing_date: this.toStringOrNull(row.nextBillingDate),
      client_id_hint: this.toClientIdHint(row)
    };
  }

  private toActiveSubscriptionOptions(raw: Record<string, unknown>): ActiveSubscriptionOption[] {
    const rows = this.readLegacySubscriptions(raw);
    return rows
      .filter((row) => String(row.status ?? '').toUpperCase() === 'ACTIVE')
      .map((row) => this.toActiveSubscriptionOption(row));
  }

  private statusFromLegacy(value: unknown): 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED' {
    const status = String(value ?? '').toUpperCase();
    if (status === 'ACTIVE' || status === 'TRIALING') return 'ACTIVE';
    if (status === 'PAUSED') return 'SUSPENDED';
    if (status === 'CANCELED') return 'CANCELED';
    return 'PAST_DUE';
  }

  private planCodeFromLegacyName(nameRaw: unknown): string {
    const normalized = String(nameRaw ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!normalized) {
      return 'BASIC_SINGLE';
    }
    if (normalized.includes('MULTI') || normalized.includes('ENTERPRISE')) {
      return 'PRO_MULTI';
    }
    if (normalized.includes('WAREHOUSE')) {
      return 'PRO_SINGLE_WAREHOUSE';
    }
    if (normalized.includes('BASIC') || normalized.includes('STARTER') || normalized.includes('SINGLE')) {
      return 'BASIC_SINGLE';
    }
    return normalized;
  }

  private toEntitlementPayload(clientId: string, raw: Record<string, unknown>): Record<string, unknown> {
    if (
      raw.status !== undefined ||
      raw.features !== undefined ||
      raw.plan_code !== undefined ||
      raw.planCode !== undefined
    ) {
      return {
        client_id: clientId,
        ...raw
      };
    }

    const legacyRows = this.readLegacySubscriptions(raw);
    const chosen = this.pickSubscriptionForTarget(legacyRows, clientId);
    if (!chosen) {
      throw new BadGatewayException('Subscription gateway payload missing entitlement fields');
    }

    const planObj = chosen.plan;
    const plan =
      planObj && typeof planObj === 'object'
        ? (planObj as Record<string, unknown>)
        : {};
    const planCode = this.planCodeFromLegacyName(plan.code ?? plan.name ?? chosen.planId);

    return {
      client_id: clientId,
      status: this.statusFromLegacy(chosen.status),
      plan_code: planCode,
      grace_until:
        typeof chosen.endDate === 'string'
          ? chosen.endDate
          : typeof chosen.nextBillingDate === 'string'
            ? chosen.nextBillingDate
            : null
    };
  }

  private toProfilePayload(clientId: string, raw: Record<string, unknown>): Record<string, unknown> {
    if (
      raw.company_name !== undefined ||
      raw.companyName !== undefined ||
      raw.business_name !== undefined ||
      raw.client_name !== undefined
    ) {
      return {
        client_id: clientId,
        ...raw
      };
    }

    const legacyRows = this.readLegacySubscriptions(raw);
    const chosen = this.pickSubscriptionForTarget(legacyRows, clientId);
    if (!chosen) {
      return {
        client_id: clientId,
        company_name: `Tenant ${clientId}`,
        company_code: clientId
      };
    }

    const customerObj = chosen.customer;
    const customer =
      customerObj && typeof customerObj === 'object'
        ? (customerObj as Record<string, unknown>)
        : {};
    const companyName =
      String(
        customer.storeName ??
          customer.store_name ??
          customer.fullName ??
          customer.full_name ??
          customer.email ??
          `Tenant ${clientId}`
      ).trim() || `Tenant ${clientId}`;

    const companyCode = clientId
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24);

    return {
      client_id: clientId,
      company_name: companyName,
      company_code: companyCode || clientId
    };
  }

  async fetchCurrentEntitlement(clientId: string, options: FetchOptions = {}): Promise<SubscriptionGatewayResult> {
    const now = Date.now();
    const freshCache = this.getFreshCache(clientId, now);
    if (freshCache) {
      return this.toResult(freshCache, 'cache', false);
    }

    if (this.isCircuitOpen(now)) {
      const staleCache = this.getStaleCache(clientId, now);
      if (options.allowStaleOnFailure && staleCache) {
        return this.toResult(staleCache, 'cache', true);
      }
      throw new BadGatewayException('Subscription gateway circuit is open');
    }

    const baseUrl = this.resolveBaseUrl();
    const primaryPath =
      process.env.SUBMAN_ENTITLEMENT_PATH?.trim() ||
      '/v1/subscriptions?status=ACTIVE&limit=20&sortBy=updatedAt&sortOrder=desc';
    const fallbackLegacyPath = '/v1/subscriptions?status=ACTIVE&limit=20&sortBy=updatedAt&sortOrder=desc';
    const paths = primaryPath === fallbackLegacyPath ? [primaryPath] : [primaryPath, fallbackLegacyPath];
    const timeoutMs = Number(process.env.SUBMAN_TIMEOUT_MS ?? 8000);
    try {
      let normalizedPayload: Record<string, unknown> | null = null;
      let lastError: unknown;
      for (const path of paths) {
        try {
          const url = this.buildUrl(baseUrl, path, clientId);
          const rawPayload = await this.fetchJsonWithAuthRetry(url, clientId, timeoutMs, options);
          normalizedPayload = this.toEntitlementPayload(clientId, rawPayload);
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!normalizedPayload) {
        if (lastError instanceof BadGatewayException) {
          throw lastError;
        }
        throw new BadGatewayException('Subscription gateway unavailable');
      }

      const savedEntry: CacheEntry = {
        payload: normalizedPayload,
        fetchedAt: Date.now()
      };
      this.cache.set(clientId, savedEntry);
      this.markSuccess();
      return this.toResult(savedEntry, 'network', false);
    } catch (error) {
      this.markFailure(now);
      const staleCache = this.getStaleCache(clientId, Date.now());
      if (options.allowStaleOnFailure && staleCache) {
        return this.toResult(staleCache, 'cache', true);
      }
      if (error instanceof BadGatewayException) {
        throw error;
      }
      throw new BadGatewayException('Subscription gateway unavailable');
    }
  }

  async fetchTenantProfile(
    clientId: string,
    options: FetchOptions = {}
  ): Promise<SubscriptionTenantProfileResult> {
    const now = Date.now();
    const freshCache = this.profileCache.get(clientId);
    if (freshCache && now - freshCache.fetchedAt <= this.cacheTtlMs) {
      return this.toResult(freshCache, 'cache', false);
    }

    if (this.isCircuitOpen(now)) {
      const stale = this.profileCache.get(clientId);
      if (options.allowStaleOnFailure && stale && now - stale.fetchedAt <= this.staleCacheTtlMs) {
        return this.toResult(stale, 'cache', true);
      }
      throw new BadGatewayException('Subscription gateway circuit is open');
    }

    const baseUrl = this.resolveBaseUrl();
    const timeoutMs = Number(process.env.SUBMAN_TIMEOUT_MS ?? 8000);
    const primaryPath =
      process.env.SUBMAN_CLIENT_PROFILE_PATH?.trim() ||
      '/v1/subscriptions?status=ACTIVE&limit=1&sortBy=updatedAt&sortOrder=desc';
    const fallbackLegacyPath = '/v1/subscriptions?status=ACTIVE&limit=1&sortBy=updatedAt&sortOrder=desc';
    const paths = primaryPath === fallbackLegacyPath ? [primaryPath] : [primaryPath, fallbackLegacyPath];
    try {
      let payload: Record<string, unknown> | null = null;
      let lastError: unknown;
      for (const path of paths) {
        try {
          const url = this.buildUrl(baseUrl, path, clientId);
          const rawPayload = await this.fetchJsonWithAuthRetry(url, clientId, timeoutMs, options);
          payload = this.toProfilePayload(clientId, rawPayload);
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!payload) {
        if (lastError instanceof BadGatewayException) {
          throw lastError;
        }
        throw new BadGatewayException('Subscription gateway unavailable');
      }

      const savedEntry: CacheEntry = {
        payload,
        fetchedAt: Date.now()
      };
      this.profileCache.set(clientId, savedEntry);
      this.markSuccess();
      return this.toResult(savedEntry, 'network', false);
    } catch (error) {
      this.markFailure(now);
      const stale = this.profileCache.get(clientId);
      if (options.allowStaleOnFailure && stale && Date.now() - stale.fetchedAt <= this.staleCacheTtlMs) {
        return this.toResult(stale, 'cache', true);
      }
      if (error instanceof BadGatewayException) {
        throw error;
      }
      throw new BadGatewayException('Subscription gateway unavailable');
    }
  }

  async listActiveSubscriptions(options: FetchOptions = {}): Promise<ActiveSubscriptionListResult> {
    const now = Date.now();
    const cacheKey = `active-list::${process.env.SUBMAN_CLIENT_ID?.trim() || 'default'}::${options.apiKeyOverride?.trim() || 'default'}`;
    const freshCache = this.activeListCache.get(cacheKey);
    if (freshCache && now - freshCache.fetchedAt <= this.cacheTtlMs) {
      return this.toListResult(freshCache, 'cache', false);
    }

    if (this.isCircuitOpen(now)) {
      const stale = this.activeListCache.get(cacheKey);
      if (options.allowStaleOnFailure && stale && now - stale.fetchedAt <= this.staleCacheTtlMs) {
        return this.toListResult(stale, 'cache', true);
      }
      throw new BadGatewayException('Subscription gateway circuit is open');
    }

    const baseUrl = this.resolveBaseUrl();
    const primaryPath =
      process.env.SUBMAN_ACTIVE_SUBSCRIPTIONS_PATH?.trim() ||
      '/v1/subscriptions?status=ACTIVE&limit=200&sortBy=updatedAt&sortOrder=desc';
    const fallbackPath = '/v1/subscriptions?status=ACTIVE&limit=200&sortBy=updatedAt&sortOrder=desc';
    const paths = primaryPath === fallbackPath ? [primaryPath] : [primaryPath, fallbackPath];
    const timeoutMs = Number(process.env.SUBMAN_TIMEOUT_MS ?? 8000);
    try {
      let payload: Record<string, unknown> | null = null;
      let lastError: unknown;
      for (const path of paths) {
        try {
          const url = this.buildUrl(baseUrl, path, 'SUBMAN_ACTIVE_LIST');
          const rawPayload = await this.fetchJsonWithAuthRetry(
            url,
            'SUBMAN_ACTIVE_LIST',
            timeoutMs,
            options
          );
          payload = rawPayload;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!payload) {
        if (lastError instanceof BadGatewayException) {
          throw lastError;
        }
        throw new BadGatewayException('Subscription gateway unavailable');
      }

      const savedEntry: CacheEntry = {
        payload,
        fetchedAt: Date.now()
      };
      this.activeListCache.set(cacheKey, savedEntry);
      this.markSuccess();
      return this.toListResult(savedEntry, 'network', false);
    } catch (error) {
      this.markFailure(now);
      const stale = this.activeListCache.get(cacheKey);
      if (options.allowStaleOnFailure && stale && Date.now() - stale.fetchedAt <= this.staleCacheTtlMs) {
        return this.toListResult(stale, 'cache', true);
      }
      if (error instanceof BadGatewayException) {
        throw error;
      }
      throw new BadGatewayException('Subscription gateway unavailable');
    }
  }
}
