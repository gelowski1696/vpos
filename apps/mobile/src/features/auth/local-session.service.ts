import { sha256 } from 'js-sha256';
import type { SQLiteDatabase } from 'expo-sqlite';

type SessionRow = {
  encrypted_access_token: string | null;
  encrypted_refresh_token: string | null;
  client_id: string | null;
  pin_hash: string | null;
  pin_salt: string | null;
};

export interface SessionRefreshTransport {
  refresh(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
  }>;
}

export class LocalSessionService {
  private hydrated = false;
  private encryptedAccessToken?: string;
  private encryptedRefreshToken?: string;
  private clientId?: string;
  private pinHash?: string;
  private pinSalt?: string;

  constructor(private readonly db?: SQLiteDatabase) {}

  async cacheSession(
    accessToken: string,
    refreshToken: string,
    pin?: string | null,
    clientId?: string
  ): Promise<void> {
    await this.hydrateFromStorage();
    this.encryptedAccessToken = this.encrypt(accessToken);
    this.encryptedRefreshToken = this.encrypt(refreshToken);
    this.clientId = clientId?.trim() ? clientId.trim() : this.clientId;
    const normalizedPin = pin?.trim() ?? '';
    if (normalizedPin.length > 0) {
      this.pinSalt = this.createSalt();
      this.pinHash = this.hashPin(normalizedPin, this.pinSalt);
    }
    await this.persistToStorage();
  }

  async unlock(pin: string): Promise<boolean> {
    await this.hydrateFromStorage();
    if (!this.pinHash || !this.pinSalt) {
      return false;
    }
    return this.hashPin(pin, this.pinSalt) === this.pinHash;
  }

  async initializeFromStorage(force = false): Promise<void> {
    await this.hydrateFromStorage(force);
  }

  async reloadFromStorage(): Promise<void> {
    await this.hydrateFromStorage(true);
  }

  hasCachedSession(): boolean {
    return Boolean(this.encryptedAccessToken && this.encryptedRefreshToken);
  }

  async hasPin(): Promise<boolean> {
    await this.hydrateFromStorage();
    return Boolean(this.pinHash && this.pinSalt);
  }

  async hasCachedCashierRole(): Promise<boolean> {
    await this.hydrateFromStorage();
    const accessToken = this.encryptedAccessToken ? this.decrypt(this.encryptedAccessToken) : '';
    if (!accessToken) {
      return false;
    }
    const payload = this.parseJwtPayload(accessToken);
    const rolesRaw = (payload?.roles as unknown) ?? [];
    const roles = Array.isArray(rolesRaw)
      ? rolesRaw.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
      : [];
    return roles.includes('cashier');
  }

  async setPin(pin: string): Promise<void> {
    await this.hydrateFromStorage();
    const normalizedPin = pin.trim();
    if (!normalizedPin) {
      return;
    }
    this.pinSalt = this.createSalt();
    this.pinHash = this.hashPin(normalizedPin, this.pinSalt);
    await this.persistToStorage();
  }

  async changePin(currentPin: string | null, nextPin: string): Promise<boolean> {
    await this.hydrateFromStorage();
    const normalizedNext = nextPin.trim();
    if (!normalizedNext) {
      return false;
    }
    const hasExisting = Boolean(this.pinHash && this.pinSalt);
    if (hasExisting) {
      const normalizedCurrent = currentPin?.trim() ?? '';
      if (!normalizedCurrent) {
        return false;
      }
      const valid = this.hashPin(normalizedCurrent, this.pinSalt as string) === this.pinHash;
      if (!valid) {
        return false;
      }
    }
    this.pinSalt = this.createSalt();
    this.pinHash = this.hashPin(normalizedNext, this.pinSalt);
    await this.persistToStorage();
    return true;
  }

  async getAccessToken(): Promise<string | undefined> {
    await this.hydrateFromStorage();
    if (!this.encryptedAccessToken) {
      return undefined;
    }
    return this.decrypt(this.encryptedAccessToken);
  }

  async getRefreshToken(): Promise<string | undefined> {
    await this.hydrateFromStorage();
    if (!this.encryptedRefreshToken) {
      return undefined;
    }
    return this.decrypt(this.encryptedRefreshToken);
  }

  async getClientId(): Promise<string | undefined> {
    await this.hydrateFromStorage();
    return this.clientId?.trim() ? this.clientId : undefined;
  }

  async refreshSession(transport: SessionRefreshTransport): Promise<boolean> {
    await this.hydrateFromStorage();
    const refreshToken = this.encryptedRefreshToken ? this.decrypt(this.encryptedRefreshToken) : undefined;
    if (!refreshToken) {
      return false;
    }

    try {
      const refreshed = await transport.refresh(refreshToken);
      this.encryptedAccessToken = this.encrypt(refreshed.access_token);
      this.encryptedRefreshToken = this.encrypt(refreshed.refresh_token);
      await this.persistToStorage();
      return true;
    } catch (error) {
      if (this.isSubscriptionEndedRefreshError(error)) {
        this.encryptedAccessToken = undefined;
        this.encryptedRefreshToken = undefined;
        this.clientId = undefined;
        await this.persistToStorage();
        throw error instanceof Error ? error : new Error('SUBSCRIPTION_ENDED');
      }
      if (this.isUnauthorizedRefreshError(error)) {
        this.encryptedAccessToken = undefined;
        this.encryptedRefreshToken = undefined;
        this.clientId = undefined;
        await this.persistToStorage();
      }
      return false;
    }
  }

  async clearSession(options?: { clearPin?: boolean }): Promise<void> {
    await this.hydrateFromStorage(true);
    this.encryptedAccessToken = undefined;
    this.encryptedRefreshToken = undefined;
    this.clientId = undefined;
    if (options?.clearPin === true) {
      this.pinHash = undefined;
      this.pinSalt = undefined;
    }
    await this.persistToStorage();
  }

  private encrypt(value: string): string {
    // Keep local cache obfuscated without relying on Node.js Buffer.
    const encoded = [...value].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('');
    return `hx1:${encoded}`;
  }

  private decrypt(value: string): string {
    if (!value.startsWith('hx1:')) {
      // Legacy/plain cache fallback.
      return value;
    }
    const hex = value.slice(4);
    if (!hex || hex.length % 4 !== 0) {
      return '';
    }
    const chars: string[] = [];
    for (let i = 0; i < hex.length; i += 4) {
      const code = Number.parseInt(hex.slice(i, i + 4), 16);
      if (!Number.isFinite(code)) {
        return '';
      }
      chars.push(String.fromCharCode(code));
    }
    return chars.join('');
  }

  private createSalt(): string {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  }

  private hashPin(pin: string, salt: string): string {
    return sha256(`${salt}:${pin}`);
  }

  private parseJwtPayload(token: string): Record<string, unknown> | null {
    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }
    const base64 = this.base64UrlToBase64(parts[1]);
    if (!base64) {
      return null;
    }
    try {
      const decoded = globalThis.atob
        ? globalThis.atob(base64)
        : this.base64DecodeFallback(base64);
      return JSON.parse(decoded) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private base64UrlToBase64(value: string): string {
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

  private base64DecodeFallback(value: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let output = '';
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < value.length; i += 1) {
      const char = value.charAt(i);
      if (char === '=') {
        break;
      }
      const index = chars.indexOf(char);
      if (index < 0) {
        continue;
      }
      buffer = (buffer << 6) | index;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        output += String.fromCharCode((buffer >> bits) & 0xff);
      }
    }
    return output;
  }

  private isUnauthorizedRefreshError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return /status\s+401|status\s+403/i.test(message);
  }

  private isSubscriptionEndedRefreshError(error: unknown): boolean {
    const anyError = error as { code?: unknown; status?: unknown; message?: unknown } | null;
    const code = typeof anyError?.code === 'string' ? anyError.code.toUpperCase() : '';
    if (code === 'SUBSCRIPTION_ENDED') {
      return true;
    }
    const status = Number(anyError?.status);
    const message = error instanceof Error ? error.message : String(anyError?.message ?? error ?? '');
    if (message.toUpperCase().includes('SUBSCRIPTION_ENDED')) {
      return true;
    }
    return status === 403 && /(SUBSCRIPTION|PAST_DUE|CANCELED|SUSPENDED|EXPIRED)/i.test(message);
  }

  private async hydrateFromStorage(force = false): Promise<void> {
    if ((this.hydrated && !force) || !this.db) {
      this.hydrated = true;
      return;
    }

    const row = await this.db.getFirstAsync<SessionRow>(
      'SELECT encrypted_access_token, encrypted_refresh_token, client_id, pin_hash, pin_salt FROM auth_session WHERE id = 1'
    );

    this.encryptedAccessToken = row?.encrypted_access_token ?? undefined;
    this.encryptedRefreshToken = row?.encrypted_refresh_token ?? undefined;
    this.clientId = row?.client_id ?? undefined;
    this.pinHash = row?.pin_hash ?? undefined;
    this.pinSalt = row?.pin_salt ?? undefined;
    this.hydrated = true;
  }

  private async persistToStorage(): Promise<void> {
    if (!this.db) {
      return;
    }

    await this.db.runAsync(
      `
      INSERT INTO auth_session(
        id,
        encrypted_refresh_token,
        encrypted_access_token,
        client_id,
        pin_hash,
        pin_salt,
        updated_at
      )
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        encrypted_refresh_token = excluded.encrypted_refresh_token,
        encrypted_access_token = excluded.encrypted_access_token,
        client_id = excluded.client_id,
        pin_hash = excluded.pin_hash,
        pin_salt = excluded.pin_salt,
        updated_at = excluded.updated_at
      `,
      this.encryptedRefreshToken ?? null,
      this.encryptedAccessToken ?? null,
      this.clientId ?? null,
      this.pinHash ?? null,
      this.pinSalt ?? null,
      new Date().toISOString()
    );
  }
}
