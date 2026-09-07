export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
export const API_CLIENT_ID = process.env.NEXT_PUBLIC_CLIENT_ID ?? 'DEMO';

const ACCESS_TOKEN_KEY = 'vpos_admin_access_token';
const REFRESH_TOKEN_KEY = 'vpos_admin_refresh_token';
const CLIENT_ID_KEY = 'vpos_admin_client_id';

type AccessTokenPayload = {
  roles?: string[];
  email?: string;
  company_id?: string;
  must_change_password?: boolean;
};

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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

export function getSessionRequiresPasswordChange(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const token = getAccessToken();
  if (!token) {
    return false;
  }
  const payload = decodeJwtPayload(token);
  return payload?.must_change_password === true;
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

type WebAuditOutcome = 'SUCCESS' | 'ERROR';

function pathUrl(path: string): URL {
  return new URL(path, 'http://vpos.local');
}

function readTargetCompanyIdFromPath(path: string): string | null {
  try {
    const url = pathUrl(path);
    const fromQuery =
      url.searchParams.get('companyId') ??
      url.searchParams.get('company_id') ??
      url.searchParams.get('tenant_company_id');
    if (fromQuery?.trim()) {
      return fromQuery.trim();
    }

    const segments = url.pathname.split('/').map((segment) => segment.trim()).filter(Boolean);
    if (
      segments[0] === 'platform' &&
      segments[1] === 'owner' &&
      segments[2] === 'tenants' &&
      segments[3] &&
      segments[3] !== 'provision-from-subscription'
    ) {
      return decodeURIComponent(segments[3]);
    }
  } catch {
    return null;
  }
  return null;
}

function readEntityIdFromPath(path: string): string | null {
  try {
    const segments = pathUrl(path).pathname.split('/').map((segment) => segment.trim()).filter(Boolean);
    if (segments[0] === 'master-data') {
      if (segments[1] === 'inventory') {
        return null;
      }
      return segments[2] ? decodeURIComponent(segments[2]) : null;
    }
    if (segments[0] === 'platform' && segments[1] === 'owner' && segments[2] === 'tenants' && segments[3]) {
      return segments[3] === 'provision-from-subscription' ? null : decodeURIComponent(segments[3]);
    }
    if (segments[0] === 'delivery' && segments[1] === 'orders') {
      return segments[2] ? decodeURIComponent(segments[2]) : null;
    }
    if (
      segments[0] === 'purchase-orders' ||
      segments[0] === 'transfers' ||
      segments[0] === 'lending' ||
      segments[0] === 'lpg-item-actions' ||
      segments[0] === 'customer-payments' ||
      segments[0] === 'sales' ||
      segments[0] === 'reviews'
    ) {
      return segments[1] ? decodeURIComponent(segments[1]) : null;
    }
    if (segments[0] === 'vcard' && segments[1] === 'rewards' && segments[2] === 'redemptions') {
      return segments[3] ? decodeURIComponent(segments[3]) : null;
    }
    if (segments[0] === 'vcard' && (segments[1] === 'cards' || segments[1] === 'rewards')) {
      return segments[2] ? decodeURIComponent(segments[2]) : null;
    }
  } catch {
    return null;
  }
  return null;
}

function readEntityFromPath(path: string): string {
  const cleanPath = path.split('?')[0] ?? path;
  const mappings: Array<[RegExp, string]> = [
    [/^\/master-data\/branches(?:\/|$)/, 'Branch'],
    [/^\/master-data\/locations(?:\/|$)/, 'Location'],
    [/^\/master-data\/users(?:\/|$)/, 'User'],
    [/^\/master-data\/rider-users(?:\/|$)/, 'User'],
    [/^\/master-data\/personnel-roles(?:\/|$)/, 'PersonnelRole'],
    [/^\/master-data\/personnels(?:\/|$)/, 'Personnel'],
    [/^\/master-data\/customers(?:\/|$)/, 'Customer'],
    [/^\/master-data\/customer-categories(?:\/|$)/, 'CustomerCategory'],
    [/^\/master-data\/suppliers(?:\/|$)/, 'Supplier'],
    [/^\/master-data\/cylinder-types(?:\/|$)/, 'CylinderType'],
    [/^\/master-data\/products(?:\/|$)/, 'Product'],
    [/^\/master-data\/product-categories(?:\/|$)/, 'ProductCategory'],
    [/^\/master-data\/product-brands(?:\/|$)/, 'ProductBrand'],
    [/^\/master-data\/price-lists(?:\/|$)/, 'PriceList'],
    [/^\/master-data\/inventory\/opening-stock(?:\/|$)/, 'InventoryOpeningStock'],
    [/^\/purchase-orders(?:\/|$)/, 'PurchaseOrder'],
    [/^\/delivery\/orders(?:\/|$)/, 'DeliveryOrder'],
    [/^\/transfers(?:\/|$)/, 'Transfer'],
    [/^\/lending(?:\/|$)/, 'Lending'],
    [/^\/lpg-item-actions(?:\/|$)/, 'LpgItemAction'],
    [/^\/customer-payments(?:\/|$)/, 'CustomerPayment'],
    [/^\/sales(?:\/|$)/, 'Sale'],
    [/^\/vcard(?:\/|$)/, 'VCard'],
    [/^\/branding(?:\/|$)/, 'Branding'],
    [/^\/platform\/owner\/tenants(?:\/|$)/, 'Tenant'],
    [/^\/platform\/pos-settings(?:\/|$)/, 'PosSettings'],
    [/^\/database-maintenance(?:\/|$)/, 'DatabaseMaintenance'],
    [/^\/reviews(?:\/|$)/, 'SyncReview'],
    [/^\/auth(?:\/|$)/, 'Auth']
  ];
  return mappings.find(([pattern]) => pattern.test(cleanPath))?.[1] ?? 'WebRequest';
}

function shouldAuditWebWrite(path: string, method: RequestOptions['method'], authEnabled: boolean): boolean {
  return authEnabled && method !== 'GET' && !path.startsWith('/audit/web-event');
}

async function recordWebAuditEvent(input: {
  path: string;
  method: RequestOptions['method'];
  outcome: WebAuditOutcome;
  statusCode: number;
  message?: string | null;
  durationMs: number;
  clientId?: string | null;
}): Promise<void> {
  try {
    const token = getAccessToken();
    if (!token) {
      return;
    }
    const clientId = input.clientId?.trim() || getSessionClientId() || API_CLIENT_ID;
    await fetch(`${API_BASE_URL}/audit/web-event`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'X-VPOS-Client': 'web',
        'X-Client-Channel': 'WEB',
        'X-Client-Id': clientId,
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        method: input.method,
        path: input.path,
        outcome: input.outcome,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
        message: input.message ?? null,
        entity: readEntityFromPath(input.path),
        entityId: readEntityIdFromPath(input.path),
        companyId: readTargetCompanyIdFromPath(input.path)
      })
    });
  } catch {
    // Audit logging must never make the original web action fail.
  }
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

function redirectToPasswordChange(): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (window.location.pathname !== '/change-password') {
    window.location.replace('/change-password');
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const authEnabled = options.auth ?? true;
  const method = options.method ?? 'GET';
  const requestStartedAt = Date.now();
  const auditWrite = shouldAuditWebWrite(path, method, authEnabled);
  const clientId = options.clientId?.trim() || getSessionClientId() || API_CLIENT_ID;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-VPOS-Client': 'web',
    'X-Client-Channel': 'WEB'
  };
  if (!options.omitClientId) {
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
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    let errorMessage = text || `API error (${response.status})`;

    let parsed: {
      message?: string | string[];
      error?: string;
      statusCode?: number;
      code?: string;
    } | null = null;
    try {
      parsed = JSON.parse(text) as {
        message?: string | string[];
        error?: string;
        statusCode?: number;
        code?: string;
      };
    } catch {
      parsed = null;
    }
    if (parsed) {
      if (
        authEnabled &&
        response.status === 403 &&
        typeof parsed.code === 'string' &&
        parsed.code.trim().toUpperCase() === 'PASSWORD_CHANGE_REQUIRED'
      ) {
        redirectToPasswordChange();
      }
      const message = parsed.message;
      if (Array.isArray(message)) {
        const joined = message.map((entry) => String(entry).trim()).filter(Boolean).join('; ');
        if (joined) {
          errorMessage = joined;
        }
      } else if (typeof message === 'string' && message.trim()) {
        errorMessage = message.trim();
      }
      if (errorMessage === (text || `API error (${response.status})`) && typeof parsed.error === 'string' && parsed.error.trim()) {
        errorMessage = parsed.error.trim();
      }
    }

    if (auditWrite) {
      void recordWebAuditEvent({
        path,
        method,
        outcome: 'ERROR',
        statusCode: response.status,
        message: errorMessage,
        durationMs: Date.now() - requestStartedAt,
        clientId
      });
    }

    if (authEnabled && response.status === 401) {
      redirectToLoginForSession('unauthorized');
      throw new Error('Session expired or unauthorized. Redirecting to login.');
    }

    throw new Error(errorMessage);
  }

  if (auditWrite) {
    void recordWebAuditEvent({
      path,
      method,
      outcome: 'SUCCESS',
      statusCode: response.status,
      durationMs: Date.now() - requestStartedAt,
      clientId
    });
  }

  return (await response.json()) as T;
}
