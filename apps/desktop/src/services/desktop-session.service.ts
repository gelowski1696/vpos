import type { DesktopAppState } from '../db/schema';
import { desktopAuthService } from './desktop-auth.service';
import { desktopSettingsService } from './desktop-settings.service';

export type DesktopStartupStage = 'LOGIN' | 'UNLOCK' | 'SETUP' | 'READY';

type CacheSessionInput = {
  accessToken: string;
  refreshToken: string;
  userEmail?: string | null;
  userFullName?: string | null;
  pin?: string | null;
};

function createSalt(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().replace(/-/g, '');
  }
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
}

function base64UrlToBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  if (padding === 2) {
    return `${normalized}==`;
  }
  if (padding === 3) {
    return `${normalized}=`;
  }
  if (padding === 0) {
    return normalized;
  }
  return '';
}

function decodeBase64(value: string): string | null {
  if (!value) {
    return null;
  }
  try {
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return window.atob(value);
    }
  } catch {
    return null;
  }
  return null;
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  const decoded = decodeBase64(base64UrlToBase64(parts[1] ?? ''));
  if (!decoded) {
    return null;
  }
  try {
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readPayloadString(payload: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!payload) {
    return null;
  }
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export class DesktopSessionService {
  async bootstrap(state: DesktopAppState): Promise<{ stage: DesktopStartupStage; state: DesktopAppState }> {
    if (!state.auth.accessToken || !state.auth.refreshToken) {
      return { stage: 'LOGIN', state };
    }

    try {
      const nextState = await desktopAuthService.refreshSession(state);
      return {
        stage: nextState.setupCompleted ? 'READY' : 'SETUP',
        state: nextState
      };
    } catch {
      if (!(state.auth.accessToken && state.auth.refreshToken)) {
        return { stage: 'LOGIN', state };
      }
      if (this.hasPinConfigured(state)) {
        return { stage: 'UNLOCK', state };
      }
      return {
        stage: state.setupCompleted ? 'READY' : 'SETUP',
        state
      };
    }
  }

  hasPinConfigured(state: DesktopAppState): boolean {
    return Boolean(state.auth.pinHash && state.auth.pinSalt);
  }

  async unlock(state: DesktopAppState, pin: string): Promise<boolean> {
    const normalized = pin.trim();
    if (!normalized || !state.auth.pinHash || !state.auth.pinSalt) {
      return false;
    }
    const computed = await sha256(`${state.auth.pinSalt}:${normalized}`);
    return computed === state.auth.pinHash;
  }

  async cacheSession(state: DesktopAppState, input: CacheSessionInput): Promise<DesktopAppState> {
    const payload = parseJwtPayload(input.accessToken);
    const normalizedPin = input.pin?.trim() ?? '';
    const pinSalt = normalizedPin ? createSalt() : state.auth.pinSalt;
    const pinHash = normalizedPin && pinSalt ? await sha256(`${pinSalt}:${normalizedPin}`) : state.auth.pinHash;

    const nextState: DesktopAppState = {
      ...state,
      setup: {
        ...state.setup,
        authEmail: input.userEmail?.trim() || state.setup.authEmail
      },
      auth: {
        ...state.auth,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        signedInAt: new Date().toISOString(),
        userEmail:
          input.userEmail?.trim() ||
          readPayloadString(payload, 'email', 'preferred_username', 'username') ||
          state.auth.userEmail,
        userFullName:
          input.userFullName?.trim() ||
          readPayloadString(payload, 'full_name', 'fullName', 'display_name', 'displayName', 'name') ||
          state.auth.userFullName,
        pinHash: pinHash ?? null,
        pinSalt: pinSalt ?? null
      }
    };

    await desktopSettingsService.saveState(nextState);
    return nextState;
  }

  async setPin(state: DesktopAppState, pin: string): Promise<DesktopAppState> {
    const normalized = pin.trim();
    if (!normalized) {
      return state;
    }
    const pinSalt = createSalt();
    const pinHash = await sha256(`${pinSalt}:${normalized}`);
    const nextState: DesktopAppState = {
      ...state,
      auth: {
        ...state.auth,
        pinHash,
        pinSalt
      }
    };
    await desktopSettingsService.saveState(nextState);
    return nextState;
  }

  async clearSession(state: DesktopAppState, options?: { clearPin?: boolean }): Promise<DesktopAppState> {
    const nextState: DesktopAppState = {
      ...state,
      setupCompleted: options?.clearPin === true ? false : state.setupCompleted,
      auth: {
        accessToken: null,
        refreshToken: null,
        signedInAt: null,
        userEmail: null,
        userFullName: null,
        pinHash: options?.clearPin === true ? null : state.auth.pinHash,
        pinSalt: options?.clearPin === true ? null : state.auth.pinSalt
      }
    };
    await desktopSettingsService.saveState(nextState);
    return nextState;
  }
}

export const desktopSessionService = new DesktopSessionService();
