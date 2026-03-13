export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
export const API_CLIENT_ID = process.env.NEXT_PUBLIC_CLIENT_ID ?? 'DEMO';

const ACCESS_TOKEN_KEY = 'vpos_admin_access_token';
const REFRESH_TOKEN_KEY = 'vpos_admin_refresh_token';
const CLIENT_ID_KEY = 'vpos_admin_client_id';

type AccessTokenPayload = {
  roles?: string[];
  email?: string;
  company_id?: string;
};

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, unknown>;
  auth?: boolean;
  clientId?: string;
  omitClientId?: boolean;
};

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

function decodeJwtPayload(token: string): AccessTokenPayload | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json = atob(padded);
    return JSON.parse(json) as AccessTokenPayload;
  } catch {
    return null;
  }
}

export function getSessionRoles(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  const token = getAccessToken();
  if (!token) {
    return [];
  }
  const payload = decodeJwtPayload(token);
  return Array.isArray(payload?.roles) ? payload.roles.map((role) => String(role)) : [];
}

export function getSessionCompanyId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const token = getAccessToken();
  if (!token) {
    return null;
  }
  const payload = decodeJwtPayload(token);
  return typeof payload?.company_id === 'string' ? payload.company_id : null;
}

export function getSessionClientId(): string {
  if (typeof window === 'undefined') {
    return API_CLIENT_ID;
  }
  return window.localStorage.getItem(CLIENT_ID_KEY)?.trim() || API_CLIENT_ID;
}

export function saveAuthSession(accessToken: string, refreshToken: string, clientId?: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  if (clientId?.trim()) {
    window.localStorage.setItem(CLIENT_ID_KEY, clientId.trim());
  }
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(CLIENT_ID_KEY);
}

function redirectToLoginForSession(reason: 'missing_token' | 'unauthorized'): void {
  if (typeof window === 'undefined') {
    return;
  }
  clearAuthSession();
  const target = `/login?reason=${reason}`;
  if (window.location.pathname !== '/login') {
    window.location.replace(target);
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const authEnabled = options.auth ?? true;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (!options.omitClientId) {
    const clientId = options.clientId?.trim() || getSessionClientId() || API_CLIENT_ID;
    headers['X-Client-Id'] = clientId;
  }

  if (authEnabled) {
    const token = getAccessToken();
    if (!token) {
      redirectToLoginForSession('missing_token');
      throw new Error('Session expired. Redirecting to login.');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    if (authEnabled && response.status === 401) {
      redirectToLoginForSession('unauthorized');
      throw new Error('Session expired or unauthorized. Redirecting to login.');
    }
    const text = await response.text();
    if (!text) {
      throw new Error(`API error (${response.status})`);
    }

    let parsed: { message?: string | string[]; error?: string; statusCode?: number } | null = null;
    try {
      parsed = JSON.parse(text) as { message?: string | string[]; error?: string; statusCode?: number };
    } catch {
      parsed = null;
    }
    if (parsed) {
      const message = parsed.message;
      if (Array.isArray(message)) {
        const joined = message.map((entry) => String(entry).trim()).filter(Boolean).join('; ');
        if (joined) {
          throw new Error(joined);
        }
      } else if (typeof message === 'string' && message.trim()) {
        throw new Error(message.trim());
      }
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        throw new Error(parsed.error.trim());
      }
    }

    throw new Error(text || `API error (${response.status})`);
  }

  return (await response.json()) as T;
}
