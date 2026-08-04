import { Injectable } from '@nestjs/common';

export interface AuthUser {
  id: string;
  company_id: string;
  personnel_id?: string | null;
  username?: string | null;
  email: string;
  password_hash: string;
  roles: string[];
  active: boolean;
  must_change_password?: boolean;
}

export interface StoredRefreshToken {
  jti: string;
  user_id: string;
  company_id: string;
  token_hash: string;
  revoked: boolean;
  replaced_by?: string;
  expires_at: Date;
}

@Injectable()
export class AuthRepository {
  private readonly users = new Map<string, AuthUser>();
  private readonly usernames = new Map<string, string>();
  private readonly refreshTokens = new Map<string, StoredRefreshToken>();

  upsertUser(user: AuthUser): void {
    const emailKey = user.email.toLowerCase();
    for (const [key, existing] of this.users.entries()) {
      if (existing.id === user.id && key !== emailKey) {
        this.users.delete(key);
      }
    }
    for (const [usernameKey, mappedEmail] of this.usernames.entries()) {
      const existing = this.users.get(mappedEmail);
      if (!existing || existing.id === user.id) {
        this.usernames.delete(usernameKey);
      }
    }
    const username = user.username?.trim().toLowerCase() || null;
    this.users.set(emailKey, {
      ...user,
      username,
      email: emailKey,
      must_change_password: user.must_change_password === true
    });
    if (username) {
      this.usernames.set(this.companyScopedLoginKey(user.company_id, username), emailKey);
    }
  }

  findByEmail(email: string): AuthUser | undefined {
    return this.users.get(email.toLowerCase());
  }

  findByEmailAndCompany(email: string, companyId: string): AuthUser | undefined {
    const user = this.users.get(email.toLowerCase());
    if (!user) {
      return undefined;
    }
    return user.company_id === companyId ? user : undefined;
  }

  findByLoginAndCompany(login: string, companyId: string): AuthUser | undefined {
    const normalized = login.trim().toLowerCase();
    const byEmail = this.findByEmailAndCompany(normalized, companyId);
    if (byEmail) {
      return byEmail;
    }
    const emailKey = this.usernames.get(this.companyScopedLoginKey(companyId, normalized));
    return emailKey ? this.users.get(emailKey) : undefined;
  }

  findByLogin(login: string): AuthUser | undefined {
    const normalized = login.trim().toLowerCase();
    const byEmail = this.findByEmail(normalized);
    if (byEmail) {
      return byEmail;
    }
    const matches = [...this.usernames.entries()]
      .filter(([key]) => key.endsWith(`::${normalized}`))
      .map(([, emailKey]) => this.users.get(emailKey))
      .filter((user): user is AuthUser => Boolean(user));
    return matches.length === 1 ? matches[0] : undefined;
  }

  findById(userId: string): AuthUser | undefined {
    return [...this.users.values()].find((user) => user.id === userId);
  }

  saveRefreshToken(token: StoredRefreshToken): void {
    this.refreshTokens.set(token.jti, token);
  }

  getRefreshToken(jti: string): StoredRefreshToken | undefined {
    return this.refreshTokens.get(jti);
  }

  revokeRefreshToken(jti: string, replacement?: string): void {
    const token = this.refreshTokens.get(jti);
    if (!token) {
      return;
    }
    token.revoked = true;
    token.replaced_by = replacement;
  }

  private companyScopedLoginKey(companyId: string, login: string): string {
    return `${companyId}::${login}`;
  }
}
