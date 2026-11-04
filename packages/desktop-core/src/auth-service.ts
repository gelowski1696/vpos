import type { DesktopAppState } from './schema';

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

type LoginResponse = {
  access_token: string;
  refresh_token: string;
  client_id: string;
};

type RefreshResponse = {
  access_token: string;
  refresh_token: string;
};

type EnrollmentClaimResponse = {
  access_token: string;
  refresh_token: string;
  client_id: string;
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

type ParsedErrorBody = {
  message?: unknown;
  error?: unknown;
  code?: unknown;
  subscription_status?: unknown;
  grace_until?: unknown;
};

type AuthHttpError = Error & { code?: string };

export interface DesktopAuthSettingsPort {
  saveState(state: DesktopAppState): Promise<DesktopAppState>;
}

export interface DesktopAuthSubscriptionPolicyPort {
  applyRemotePayload(
    payload: Record<string, unknown>,
    updatedAt?: string,
    source?: string
  ): Promise<unknown>;
}

export type DesktopAuthPorts = {
  settings: DesktopAuthSettingsPort;
  subscriptionPolicy: DesktopAuthSubscriptionPolicyPort;
  fetch?: typeof globalThis.fetch;
  readTimeoutMs?: () => number;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function getDesktopEnv(): Record<string, string | undefined> | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
}

function readFetchTimeoutMs(): number {
  const raw = Number(getDesktopEnv()?.VPOS_DESKTOP_FETCH_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_FETCH_TIMEOUT_MS;
}

function buildHeaders(state: DesktopAppState, accessToken?: string | null): HeadersInit {
  const headers: HeadersInit = {
    'content-type': 'application/json',
    'x-vpos-client': 'desktop'
  };
  if (state.setup.clientId) {
    headers['x-client-id'] = state.setup.clientId;
  }
  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

function parseErrorPayload(rawText: string): ParsedErrorBody {
  if (!rawText.trim()) {
    return {};
  }
  try {
    return JSON.parse(rawText) as ParsedErrorBody;
  } catch {
    return {};
  }
}

function resolveErrorCode(payload: ParsedErrorBody, rawText: string): string | undefined {
  if (typeof payload.code === 'string' && payload.code.trim()) {
    return payload.code.trim().toUpperCase();
  }
  if (/SUBSCRIPTION_ENDED|PAST_DUE|CANCELED|SUSPENDED|GRACE WINDOW ENDED|EXPIRED/i.test(rawText)) {
    return 'SUBSCRIPTION_ENDED';
  }
  return undefined;
}

function friendlyAuthNetworkMessage(action: 'sign in' | 'quick setup', cause: unknown): string {
  const rawMessage = cause instanceof Error ? cause.message : String(cause ?? '');
  if (/abort|timed out|timeout/i.test(rawMessage)) {
    return action === 'sign in'
      ? 'The sign-in request took too long. Check your connection and try again.'
      : 'Quick setup took too long. Check your connection and try again.';
  }
  return action === 'sign in'
    ? 'We could not reach the sign-in server. Check the API URL and internet connection, then try again.'
    : 'We could not reach the setup server. Check the API URL and internet connection, then try again.';
}

function friendlyAuthHttpMessage(action: 'sign in' | 'quick setup' | 'refresh', status: number, code?: string): string {
  if (code === 'SUBSCRIPTION_ENDED') {
    return 'This account is not active right now. Ask your administrator to renew or reactivate the subscription.';
  }

  if (action === 'refresh') {
    if (status === 400 || status === 401 || status === 422) {
      return 'Desktop session expired. Please sign in again.';
    }
    if (status === 403) {
      return 'This account cannot continue on this device. Ask your administrator to check access.';
    }
    if (status === 404) {
      return 'We could not find the desktop session service. Check the API URL or sign in again.';
    }
    if (status === 429) {
      return 'Too many session refresh attempts. Wait a moment, then try again.';
    }
    if (status >= 500) {
      return 'The server is having trouble refreshing the desktop session. Please try again shortly.';
    }
    return 'Desktop session refresh failed. Please sign in again.';
  }

  if (action === 'quick setup') {
    if (status === 400 || status === 401 || status === 404 || status === 410 || status === 422) {
      return 'This QR setup code could not be used. Ask your administrator for a new setup code.';
    }
    if (status === 403) {
      return 'This device is not allowed to complete quick setup. Ask your administrator to check access.';
    }
    if (status === 429) {
      return 'Too many setup attempts. Wait a moment, then try again.';
    }
    if (status >= 500) {
      return 'The server is having trouble completing quick setup. Please try again shortly.';
    }
    return 'Quick setup could not be completed. Check the setup details and try again.';
  }

  if (status === 400 || status === 401 || status === 422) {
    return 'We could not sign you in. Check the email and password, then try again.';
  }
  if (status === 403) {
    return 'This account cannot sign in on this device. Ask your administrator to check access.';
  }
  if (status === 404) {
    return 'We could not find the desktop sign-in service. Check the API URL or ask your administrator for the correct setup details.';
  }
  if (status === 409) {
    return 'This device setup does not match the account. Ask your administrator to check the device setup.';
  }
  if (status === 429) {
    return 'Too many sign-in attempts. Wait a moment, then try again.';
  }
  if (status >= 500) {
    return 'The server is having trouble signing you in. Please try again shortly.';
  }
  return 'We could not sign you in. Check your connection and setup details, then try again.';
}

async function readFriendlyAuthHttpError(
  action: 'sign in' | 'quick setup' | 'refresh',
  response: Response,
  subscriptionPolicy: DesktopAuthSubscriptionPolicyPort
): Promise<AuthHttpError> {
  const rawText = await response.text().catch(() => '');
  const payload = parseErrorPayload(rawText);
  const code = resolveErrorCode(payload, rawText);
  if (code === 'SUBSCRIPTION_ENDED') {
    await subscriptionPolicy.applyRemotePayload(
      {
        status: payload.subscription_status,
        grace_until: payload.grace_until,
        source: `auth_${action.replace(/\s+/g, '_')}`
      },
      undefined,
      `auth_${action.replace(/\s+/g, '_')}`
    ).catch(() => null);
  }
  const error: AuthHttpError = new Error(friendlyAuthHttpMessage(action, response.status, code));
  if (code) {
    error.code = code;
  }
  return error;
}

export class DesktopAuthService {
  constructor(private readonly ports: DesktopAuthPorts) {}

  private async fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    const timeoutMs = this.ports.readTimeoutMs?.() ?? readFetchTimeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await (this.ports.fetch ?? globalThis.fetch)(url, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Desktop request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async login(
    baseUrl: string,
    email: string,
    password: string,
    clientId: string | undefined,
    deviceId: string
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    clientId: string;
    signedInAt: string;
  }> {
    const normalizedClientId = clientId?.trim() || '';
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(normalizedClientId ? { 'x-client-id': normalizedClientId } : {}),
          'x-vpos-client': 'desktop'
        },
        body: JSON.stringify({
          email,
          password,
          device_id: deviceId
        })
      });
    } catch (error) {
      throw new Error(friendlyAuthNetworkMessage('sign in', error));
    }

    if (!response.ok) {
      throw await readFriendlyAuthHttpError('sign in', response, this.ports.subscriptionPolicy);
    }

    const data = (await response.json()) as LoginResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      clientId: data.client_id || normalizedClientId,
      signedInAt: new Date().toISOString()
    };
  }

  async refreshSession(state: DesktopAppState): Promise<DesktopAppState> {
    const refreshToken = state.auth.refreshToken;
    if (!refreshToken) {
      throw new Error('Desktop session has no refresh token. Please sign in again.');
    }

    const response = await this.fetchWithTimeout(`${normalizeBaseUrl(state.setup.apiBaseUrl)}/auth/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vpos-client': 'desktop'
      },
      body: JSON.stringify({
        refresh_token: refreshToken
      })
    });

    if (!response.ok) {
      throw await readFriendlyAuthHttpError('refresh', response, this.ports.subscriptionPolicy);
    }

    const data = (await response.json()) as RefreshResponse;
    const nextState: DesktopAppState = {
      ...state,
      auth: {
        ...state.auth,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        signedInAt: new Date().toISOString()
      }
    };
    await this.ports.settings.saveState(nextState);
    return nextState;
  }

  async logout(
    state: DesktopAppState,
    refreshToken: string,
    options?: { action?: 'switch_cashier' | 'full_sign_out' }
  ): Promise<boolean> {
    const action = options?.action?.trim();
    const response = await this.fetchWithTimeout(`${normalizeBaseUrl(state.setup.apiBaseUrl)}/auth/logout`, {
      method: 'POST',
      headers: {
        ...buildHeaders(state, null),
        ...(action ? { 'x-vpos-auth-action': action } : {})
      },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    return response.ok;
  }

  async claimEnrollment(
    baseUrl: string,
    setupToken: string,
    deviceId: string
  ): Promise<EnrollmentClaimResponse> {
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/mobile-enrollment/claim`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-vpos-client': 'desktop'
        },
        body: JSON.stringify({
          setup_token: setupToken,
          device_id: deviceId
        })
      });
    } catch (error) {
      throw new Error(friendlyAuthNetworkMessage('quick setup', error));
    }

    if (!response.ok) {
      throw await readFriendlyAuthHttpError('quick setup', response, this.ports.subscriptionPolicy);
    }

    return (await response.json()) as EnrollmentClaimResponse;
  }

  async authorizedFetch(
    state: DesktopAppState,
    url: string,
    init: RequestInit = {}
  ): Promise<{ response: Response; state: DesktopAppState }> {
    let workingState = state;
    let response = await this.fetchWithTimeout(url, {
      ...init,
      headers: {
        ...buildHeaders(workingState, workingState.auth.accessToken),
        ...(init.headers ?? {})
      }
    });

    if (response.status !== 401 || !workingState.auth.refreshToken) {
      return { response, state: workingState };
    }

    workingState = await this.refreshSession(workingState);
    response = await this.fetchWithTimeout(url, {
      ...init,
      headers: {
        ...buildHeaders(workingState, workingState.auth.accessToken),
        ...(init.headers ?? {})
      }
    });
    return { response, state: workingState };
  }
}
