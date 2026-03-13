import type { SessionRefreshTransport } from './local-session.service';
import { normalizeApiBaseUrl } from '../../app/api-base-url';

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

type AuthTokenPair = {
  access_token: string;
  refresh_token: string;
  access_expires_in: string;
  refresh_expires_in: string;
  client_id?: string;
};

type EnrollmentClaimResponse = AuthTokenPair & {
  user_id: string;
  user_email: string;
  user_full_name: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  location_id: string;
  location_code: string;
  location_name: string;
};

type HttpAuthTransportOptions = {
  baseUrl: string;
};

type ParsedErrorBody = {
  statusCode?: number;
  message?: unknown;
  error?: unknown;
  code?: unknown;
  subscription_status?: unknown;
  grace_until?: unknown;
};

export class AuthTransportError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly payload?: unknown;

  constructor(message: string, status: number, code?: string, payload?: unknown) {
    super(message);
    this.name = 'AuthTransportError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export class HttpAuthTransport implements SessionRefreshTransport {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(options: HttpAuthTransportOptions) {
    this.baseUrl = normalizeApiBaseUrl(options.baseUrl);
    const availableFetch = (globalThis as { fetch?: FetchLike }).fetch;
    if (!availableFetch) {
      throw new Error('Global fetch is not available in this runtime');
    }
    this.fetchFn = availableFetch;
  }

  private parseErrorPayload(rawText: string): ParsedErrorBody {
    if (!rawText.trim()) {
      return {};
    }
    try {
      return JSON.parse(rawText) as ParsedErrorBody;
    } catch {
      return {};
    }
  }

  private errorMessageFromPayload(payload: ParsedErrorBody, fallback: string): string {
    const message = payload.message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
    if (Array.isArray(message) && message.length > 0) {
      const first = message[0];
      if (typeof first === 'string' && first.trim()) {
        return first.trim();
      }
    }
    const error = payload.error;
    if (typeof error === 'string' && error.trim()) {
      return `${fallback}: ${error.trim()}`;
    }
    return fallback;
  }

  private resolveErrorCode(status: number, payload: ParsedErrorBody, text: string): string | undefined {
    if (typeof payload.code === 'string' && payload.code.trim()) {
      return payload.code.trim().toUpperCase();
    }
    const normalized = text.toUpperCase();
    if (normalized.includes('SUBSCRIPTION_ENDED')) {
      return 'SUBSCRIPTION_ENDED';
    }
    if (
      status === 403 &&
      /(SUBSCRIPTION|PAST_DUE|CANCELED|SUSPENDED|GRACE WINDOW ENDED|EXPIRED)/i.test(text)
    ) {
      return 'SUBSCRIPTION_ENDED';
    }
    return undefined;
  }

  private async throwAuthError(prefix: string, status: number, response: { text(): Promise<string> }): Promise<never> {
    const rawText = await response.text();
    const payload = this.parseErrorPayload(rawText);
    const fallback = `${prefix} failed with status ${status}`;
    const message = this.errorMessageFromPayload(payload, fallback);
    const code = this.resolveErrorCode(status, payload, rawText);
    throw new AuthTransportError(`${fallback}: ${message}`, status, code, payload);
  }

  async login(input: { email: string; password: string; device_id: string }): Promise<AuthTokenPair> {
    const response = await this.fetchFn(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vpos-client': 'mobile' },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      await this.throwAuthError('Auth login', response.status, response);
    }
    return (await response.json()) as AuthTokenPair;
  }

  async refresh(refreshToken: string): Promise<{ access_token: string; refresh_token: string }> {
    const response = await this.fetchFn(`${this.baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vpos-client': 'mobile' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!response.ok) {
      await this.throwAuthError('Auth refresh', response.status, response);
    }
    const payload = (await response.json()) as AuthTokenPair;
    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token
    };
  }

  async logout(
    refreshToken: string,
    options?: { action?: 'switch_cashier' | 'full_sign_out' }
  ): Promise<boolean> {
    const action = options?.action?.trim();
    const response = await this.fetchFn(`${this.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vpos-client': 'mobile',
        ...(action ? { 'x-vpos-auth-action': action } : {})
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (!response.ok) {
      return false;
    }
    return true;
  }

  async claimEnrollment(setupToken: string, deviceId: string): Promise<EnrollmentClaimResponse> {
    const response = await this.fetchFn(`${this.baseUrl}/mobile-enrollment/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        setup_token: setupToken,
        device_id: deviceId
      })
    });
    if (!response.ok) {
      throw new Error(`Enrollment claim failed with status ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as EnrollmentClaimResponse;
  }
}
