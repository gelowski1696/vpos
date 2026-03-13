import { Injectable, Logger } from '@nestjs/common';

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
  refreshToken?: string;
};

@Injectable()
export class SubmanTokenService {
  private readonly logger = new Logger(SubmanTokenService.name);
  private cached: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  isEnabled(): boolean {
    const raw = process.env.SUBMAN_TOKEN_AUTO_REFRESH?.trim().toLowerCase();
    if (!raw) {
      return false;
    }
    return raw === 'true' || raw === '1' || raw === 'yes';
  }

  async getBearerToken(forceRefresh = false): Promise<string | null> {
    if (!this.isEnabled()) {
      return process.env.SUBMAN_BEARER_TOKEN?.trim() || null;
    }

    if (!forceRefresh && this.cached && this.cached.expiresAtMs - Date.now() > 30_000) {
      return this.cached.accessToken;
    }

    if (!this.inflight) {
      this.inflight = this.fetchFreshToken()
        .catch((error) => {
          this.logger.warn(
            `SubMan token refresh failed: ${error instanceof Error ? error.message : 'unknown error'}`
          );
          throw error;
        })
        .finally(() => {
          this.inflight = null;
        });
    }

    try {
      return await this.inflight;
    } catch {
      return process.env.SUBMAN_BEARER_TOKEN?.trim() || null;
    }
  }

  invalidateCachedToken(): void {
    this.cached = null;
  }

  private async fetchFreshToken(): Promise<string> {
    const baseUrl = process.env.SUBMAN_BASE_URL?.trim();
    const email = process.env.SUBMAN_AUTH_EMAIL?.trim();
    const password = process.env.SUBMAN_AUTH_PASSWORD?.trim();
    if (!baseUrl || !email || !password) {
      throw new Error(
        'SUBMAN_BASE_URL, SUBMAN_AUTH_EMAIL, and SUBMAN_AUTH_PASSWORD are required for auto token refresh'
      );
    }

    const authPath = process.env.SUBMAN_AUTH_LOGIN_PATH?.trim() || '/v1/auth/login';
    const url = `${baseUrl.replace(/\/$/, '')}${authPath.startsWith('/') ? authPath : `/${authPath}`}`;
    const timeoutMs = Number(process.env.SUBMAN_TIMEOUT_MS ?? 8000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const gatewayClientId = process.env.SUBMAN_CLIENT_ID?.trim() || 'subman-mobile';
    let payload: Record<string, unknown> = {
      email,
      password
    };
    const extraRaw = process.env.SUBMAN_AUTH_EXTRA_JSON?.trim();
    if (extraRaw) {
      try {
        const extra = JSON.parse(extraRaw) as Record<string, unknown>;
        payload = { ...payload, ...extra };
      } catch {
        // keep base payload
      }
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': gatewayClientId
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const raw = await response.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        parsed = {};
      }

      if (!response.ok) {
        throw new Error(`SubMan auth failed (${response.status})`);
      }

      const token = this.pickAccessToken(parsed);
      if (!token) {
        throw new Error('SubMan auth response did not include access token');
      }
      const refreshToken = this.pickRefreshToken(parsed);
      const ttlSec = this.resolveTokenTtlSeconds(token);
      this.cached = {
        accessToken: token,
        expiresAtMs: Date.now() + ttlSec * 1000,
        refreshToken: refreshToken ?? undefined
      };
      return token;
    } finally {
      clearTimeout(timeout);
    }
  }

  private pickAccessToken(payload: Record<string, unknown>): string | null {
    const data = payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {};
    const candidates = [
      payload.access_token,
      payload.accessToken,
      payload.token,
      data.access_token,
      data.accessToken,
      data.token
    ];
    for (const candidate of candidates) {
      const token = String(candidate ?? '').trim();
      if (token) {
        return token;
      }
    }
    return null;
  }

  private pickRefreshToken(payload: Record<string, unknown>): string | null {
    const data = payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {};
    const candidates = [
      payload.refresh_token,
      payload.refreshToken,
      data.refresh_token,
      data.refreshToken
    ];
    for (const candidate of candidates) {
      const token = String(candidate ?? '').trim();
      if (token) {
        return token;
      }
    }
    return null;
  }

  private resolveTokenTtlSeconds(jwt: string): number {
    const configuredFallback = this.readPositiveInt('SUBMAN_TOKEN_TTL_SEC', 14 * 60);
    const parts = jwt.split('.');
    if (parts.length < 2) {
      return configuredFallback;
    }

    try {
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson) as { exp?: number };
      if (!payload.exp || !Number.isFinite(payload.exp)) {
        return configuredFallback;
      }
      const ttlSec = Math.max(30, Math.floor(payload.exp - Date.now() / 1000 - 30));
      return ttlSec;
    } catch {
      return configuredFallback;
    }
  }

  private readPositiveInt(envKey: string, fallback: number): number {
    const parsed = Number(process.env[envKey] ?? fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }
}
