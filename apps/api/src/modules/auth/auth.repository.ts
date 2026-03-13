import { Injectable } from '@nestjs/common';

export interface AuthUser {
  id: string;
  company_id: string;
  email: string;
  password_hash: string;
  roles: string[];
  active: boolean;
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
  private readonly refreshTokens = new Map<string, StoredRefreshToken>();

  upsertUser(user: AuthUser): void {
    const emailKey = user.email.toLowerCase();
    for (const [key, existing] of this.users.entries()) {
      if (existing.id === user.id && key !== emailKey) {
        this.users.delete(key);
      }
    }
    this.users.set(emailKey, {
      ...user,
      email: emailKey
    });
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
}
