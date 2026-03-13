import { LocalSessionService } from './local-session.service';
import { HttpAuthTransport } from './http-auth.transport';

export type AuthStage = 'BOOTING' | 'LOGIN' | 'UNLOCK' | 'READY';

export class MobileAuthFlow {
  constructor(
    private readonly session: LocalSessionService,
    private readonly transport: HttpAuthTransport,
    private readonly deviceId: string
  ) {}

  async bootstrap(): Promise<AuthStage> {
    await this.session.initializeFromStorage();
    if (!this.session.hasCachedSession()) {
      return 'LOGIN';
    }
    if (!(await this.session.hasCachedCashierRole())) {
      await this.session.clearSession();
      return 'LOGIN';
    }

    const refreshed = await this.session.refreshSession(this.transport);
    if (refreshed) {
      if (!(await this.session.hasCachedCashierRole())) {
        await this.session.clearSession();
        return 'LOGIN';
      }
      return 'READY';
    }

    if (!this.session.hasCachedSession()) {
      return 'LOGIN';
    }

    // Offline fallback: if we already have a cached session, allow app reopen
    // without forcing online login. PIN-enabled devices still go through unlock.
    if (!(await this.session.hasPin())) {
      return 'READY';
    }

    return 'UNLOCK';
  }

  async login(input: { email: string; password: string; pin?: string | null }): Promise<AuthStage> {
    const response = await this.transport.login({
      email: input.email,
      password: input.password,
      device_id: this.deviceId
    });

    await this.session.cacheSession(response.access_token, response.refresh_token, input.pin, response.client_id);
    if (!(await this.session.hasCachedCashierRole())) {
      await this.session.clearSession();
      throw new Error('Mobile login is restricted to cashier accounts');
    }
    return 'READY';
  }

  async unlock(pin: string): Promise<AuthStage> {
    if (!(await this.session.hasCachedCashierRole())) {
      await this.session.clearSession();
      return 'LOGIN';
    }

    const unlocked = await this.session.unlock(pin);
    if (!unlocked) {
      return 'UNLOCK';
    }

    // Best-effort refresh; when offline, continue with cached session.
    await this.session.refreshSession(this.transport);
    if (!this.session.hasCachedSession()) {
      return 'LOGIN';
    }
    if (!(await this.session.hasCachedCashierRole())) {
      await this.session.clearSession();
      return 'LOGIN';
    }
    return 'READY';
  }

  async hasPinConfigured(): Promise<boolean> {
    return this.session.hasPin();
  }

  async reloadSessionState(): Promise<void> {
    await this.session.reloadFromStorage();
  }

  async logout(): Promise<AuthStage> {
    // Lock-only logout for fast relogin/PIN unlock; keeps cached session and PIN.
    return 'LOGIN';
  }

  async fullSignOut(reason: 'switch_cashier' | 'full_sign_out' = 'full_sign_out'): Promise<AuthStage> {
    const refreshToken = await this.session.getRefreshToken();
    if (refreshToken) {
      try {
        await this.transport.logout(refreshToken, { action: reason });
      } catch {
        // Logout should still clear local session if server is unreachable.
      }
    }

    await this.session.clearSession({ clearPin: true });
    return 'LOGIN';
  }
}
