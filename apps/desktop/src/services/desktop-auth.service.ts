import type { DesktopAppState } from '../db/schema';
import { desktopSettingsService } from './desktop-settings.service';

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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
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

export class DesktopAuthService {
  async login(
    baseUrl: string,
    email: string,
    password: string,
    clientId: string,
    deviceId: string
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    clientId: string;
    signedInAt: string;
  }> {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-id': clientId,
        'x-vpos-client': 'desktop'
      },
      body: JSON.stringify({
        email,
        password,
        device_id: deviceId
      })
    });

    if (!response.ok) {
      throw new Error(`Desktop sign-in failed (${response.status})`);
    }

    const data = (await response.json()) as LoginResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      clientId: data.client_id || clientId,
      signedInAt: new Date().toISOString()
    };
  }

  async refreshSession(state: DesktopAppState): Promise<DesktopAppState> {
    const refreshToken = state.auth.refreshToken;
    if (!refreshToken) {
      throw new Error('Desktop session has no refresh token. Please sign in again.');
    }

    const response = await fetch(`${normalizeBaseUrl(state.setup.apiBaseUrl)}/auth/refresh`, {
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
      throw new Error(`Desktop session refresh failed (${response.status}). Please sign in again.`);
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
    await desktopSettingsService.saveState(nextState);
    return nextState;
  }

  async claimEnrollment(
    baseUrl: string,
    setupToken: string,
    deviceId: string
  ): Promise<EnrollmentClaimResponse> {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/mobile-enrollment/claim`, {
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

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(detail || `Desktop quick setup failed (${response.status})`);
    }

    return (await response.json()) as EnrollmentClaimResponse;
  }

  async authorizedFetch(
    state: DesktopAppState,
    url: string,
    init: RequestInit = {}
  ): Promise<{ response: Response; state: DesktopAppState }> {
    let workingState = state;
    let response = await fetch(url, {
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
    response = await fetch(url, {
      ...init,
      headers: {
        ...buildHeaders(workingState, workingState.auth.accessToken),
        ...(init.headers ?? {})
      }
    });
    return { response, state: workingState };
  }
}

export const desktopAuthService = new DesktopAuthService();
