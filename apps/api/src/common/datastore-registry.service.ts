import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaService } from './prisma.service';

type RegistryRow = {
  companyId: string;
  datastoreRef: string;
  encryptedUrl: string;
  iv: string;
  authTag: string;
  keyVersion: string;
};

type EncryptionProfile = {
  currentVersion: string;
  currentKey: Buffer;
  decryptKeysByVersion: Map<string, Buffer>;
  fallbackDecryptKeys: Buffer[];
};

@Injectable()
export class DatastoreRegistryService {
  private readonly logger = new Logger(DatastoreRegistryService.name);
  private readonly memoryRegistry = new Map<string, RegistryRow>();

  constructor(private readonly prisma: PrismaService) {}

  async registerTenantDatastoreUrl(
    companyId: string,
    datastoreRef: string,
    url: string
  ): Promise<void> {
    if (!companyId?.trim()) {
      throw new InternalServerErrorException('companyId is required for datastore registry');
    }
    const ref = datastoreRef.trim();
    if (!ref) {
      throw new InternalServerErrorException('datastoreRef is required for datastore registry');
    }
    const encrypted = this.encrypt(url);
    const row: RegistryRow = {
      companyId: companyId.trim(),
      datastoreRef: ref,
      encryptedUrl: encrypted.ciphertextB64,
      iv: encrypted.ivB64,
      authTag: encrypted.authTagB64,
      keyVersion: encrypted.keyVersion
    };

    const repo = this.getRepo();
    if (!repo) {
      this.memoryRegistry.set(this.memoryKey(row.companyId, row.datastoreRef), row);
      return;
    }

    await repo.upsert({
      where: {
        companyId_datastoreRef: {
          companyId: row.companyId,
          datastoreRef: row.datastoreRef
        }
      },
      update: {
        encryptedUrl: row.encryptedUrl,
        iv: row.iv,
        authTag: row.authTag,
        keyVersion: row.keyVersion
      },
      create: row
    });
  }

  async resolveTenantDatastoreUrl(
    companyId: string,
    datastoreRef: string
  ): Promise<string | null> {
    if (/^postgres(ql)?:\/\//i.test(datastoreRef)) {
      return datastoreRef;
    }
    const ref = datastoreRef.trim();
    if (!ref) {
      return null;
    }
    const normalizedCompanyId = companyId.trim();
    if (!normalizedCompanyId) {
      return null;
    }

    const repo = this.getRepo();
    if (!repo) {
      const memoryRow = this.memoryRegistry.get(this.memoryKey(normalizedCompanyId, ref));
      if (!memoryRow) {
        return null;
      }
      const decrypted = this.decrypt(memoryRow);
      const profile = this.resolveEncryptionProfile();
      if (memoryRow.keyVersion !== profile.currentVersion || decrypted.usedVersion !== profile.currentVersion) {
        await this.registerTenantDatastoreUrl(normalizedCompanyId, ref, decrypted.url);
      }
      return decrypted.url;
    }

    const row = (await repo.findUnique({
      where: {
        companyId_datastoreRef: {
          companyId: normalizedCompanyId,
          datastoreRef: ref
        }
      },
      select: {
        companyId: true,
        datastoreRef: true,
        encryptedUrl: true,
        iv: true,
        authTag: true,
        keyVersion: true
      }
    })) as RegistryRow | null;

    if (!row) {
      return null;
    }
    const decrypted = this.decrypt(row);
    const profile = this.resolveEncryptionProfile();
    if (row.keyVersion !== profile.currentVersion || decrypted.usedVersion !== profile.currentVersion) {
      await this.registerTenantDatastoreUrl(normalizedCompanyId, ref, decrypted.url);
    }
    return decrypted.url;
  }

  async ensureTenantDatastoreUrl(companyId: string, datastoreRef: string): Promise<string> {
    if (/^postgres(ql)?:\/\//i.test(datastoreRef)) {
      return datastoreRef;
    }
    const ref = datastoreRef.trim();
    if (!ref) {
      throw new ServiceUnavailableException('Dedicated datastore reference is required');
    }

    const existing = await this.resolveTenantDatastoreUrl(companyId, ref);
    if (existing) {
      return existing;
    }

    const fromEnv = this.resolveUrlFromEnv(ref);
    if (fromEnv) {
      await this.registerTenantDatastoreUrl(companyId, ref, fromEnv);
      return fromEnv;
    }

    if (!this.allowDefaultDerivedUrl()) {
      throw new ServiceUnavailableException(
        `Dedicated datastore URL is not configured for ref ${ref}`
      );
    }

    const derived = this.deriveDedicatedUrl(ref);
    await this.registerTenantDatastoreUrl(companyId, ref, derived);
    this.logger.log(`Registered derived dedicated datastore URL for ${companyId}/${ref}`);
    return derived;
  }

  private getRepo():
    | {
        upsert: (args: unknown) => Promise<unknown>;
        findUnique: (args: unknown) => Promise<unknown>;
      }
    | null {
    const candidate = (this.prisma as unknown as { tenantDatastoreRegistry?: unknown })
      .tenantDatastoreRegistry as
      | {
          upsert: (args: unknown) => Promise<unknown>;
          findUnique: (args: unknown) => Promise<unknown>;
        }
      | undefined;
    if (!candidate || typeof candidate.upsert !== 'function' || typeof candidate.findUnique !== 'function') {
      return null;
    }
    return candidate;
  }

  private encrypt(plainText: string): {
    ciphertextB64: string;
    ivB64: string;
    authTagB64: string;
    keyVersion: string;
  } {
    const profile = this.resolveEncryptionProfile();
    const key = profile.currentKey;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertextB64: encrypted.toString('base64'),
      ivB64: iv.toString('base64'),
      authTagB64: authTag.toString('base64'),
      keyVersion: profile.currentVersion
    };
  }

  private decrypt(row: RegistryRow): { url: string; usedVersion: string } {
    const profile = this.resolveEncryptionProfile();
    const tried = new Set<string>();
    const attempts: Array<{ version: string; key: Buffer }> = [];

    const exact = profile.decryptKeysByVersion.get(row.keyVersion);
    if (exact) {
      attempts.push({ version: row.keyVersion, key: exact });
      tried.add(row.keyVersion);
    }

    for (const [version, key] of profile.decryptKeysByVersion.entries()) {
      if (tried.has(version)) {
        continue;
      }
      attempts.push({ version, key });
      tried.add(version);
    }

    for (const key of profile.fallbackDecryptKeys) {
      attempts.push({ version: 'fallback', key });
    }

    for (const attempt of attempts) {
      const url = this.tryDecryptWithKey(row, attempt.key);
      if (url !== null) {
        return { url, usedVersion: attempt.version };
      }
    }

    throw new ServiceUnavailableException(
      `Failed to decrypt datastore URL for ref ${row.datastoreRef}`
    );
  }

  private resolveEncryptionProfile(): EncryptionProfile {
    const currentRaw =
      process.env.VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT?.trim() ??
      process.env.VPOS_DATASTORE_ENCRYPTION_KEY?.trim() ??
      '';
    const currentVersionRaw = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT_VERSION?.trim();
    const currentVersion = currentVersionRaw || 'v1';
    if (currentRaw) {
      const decryptKeysByVersion = new Map<string, Buffer>();
      decryptKeysByVersion.set(currentVersion, this.parseKeyMaterial(currentRaw));

      const previousRaw = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS?.trim();
      const previousVersionRaw = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS_VERSION?.trim();
      const previousVersion = previousVersionRaw || 'v0';
      if (previousRaw) {
        decryptKeysByVersion.set(previousVersion, this.parseKeyMaterial(previousRaw));
      }

      const legacyRaw = process.env.VPOS_DATASTORE_ENCRYPTION_KEY?.trim();
      const legacyVersionRaw = process.env.VPOS_DATASTORE_ENCRYPTION_KEY_LEGACY_VERSION?.trim();
      const legacyVersion = legacyVersionRaw || 'v1';
      if (legacyRaw) {
        decryptKeysByVersion.set(legacyVersion, this.parseKeyMaterial(legacyRaw));
      }

      return {
        currentVersion,
        currentKey: this.parseKeyMaterial(currentRaw),
        decryptKeysByVersion,
        fallbackDecryptKeys: [this.parseKeyMaterial(currentRaw)]
      };
    }

    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT (or VPOS_DATASTORE_ENCRYPTION_KEY) is required in production'
      );
    }

    const fallback = `${process.env.JWT_ACCESS_SECRET ?? ''}:${process.env.JWT_REFRESH_SECRET ?? ''}:vpos-datastore-registry`;
    const fallbackKey = createHash('sha256')
      .update(fallback || 'vpos-dev-datastore-registry', 'utf8')
      .digest();
    return {
      currentVersion: 'dev-fallback',
      currentKey: fallbackKey,
      decryptKeysByVersion: new Map([['dev-fallback', fallbackKey]]),
      fallbackDecryptKeys: [fallbackKey]
    };
  }

  private parseKeyMaterial(configured: string): Buffer {
    if (configured.startsWith('base64:')) {
      const buf = Buffer.from(configured.slice('base64:'.length), 'base64');
      return createHash('sha256').update(buf).digest();
    }
    if (/^[A-Fa-f0-9]{64}$/.test(configured)) {
      const buf = Buffer.from(configured, 'hex');
      return createHash('sha256').update(buf).digest();
    }
    return createHash('sha256').update(configured, 'utf8').digest();
  }

  private tryDecryptWithKey(row: RegistryRow, key: Buffer): string | null {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(row.encryptedUrl, 'base64')),
        decipher.final()
      ]);
      return decrypted.toString('utf8');
    } catch {
      return null;
    }
  }

  private resolveUrlFromEnv(datastoreRef: string): string | null {
    const fromJson = this.readDedicatedUrlMap()[datastoreRef];
    if (fromJson?.trim()) {
      return fromJson.trim();
    }

    const envKey = `VPOS_DEDICATED_DB_URL_${this.toEnvKey(datastoreRef)}`;
    const fromEnv = process.env[envKey]?.trim();
    if (fromEnv) {
      return fromEnv;
    }
    return null;
  }

  private deriveDedicatedUrl(datastoreRef: string): string {
    const base = process.env.VPOS_DEDICATED_DB_BASE_URL?.trim() || process.env.DATABASE_URL?.trim();
    if (!base) {
      throw new ServiceUnavailableException(
        'DATABASE_URL (or VPOS_DEDICATED_DB_BASE_URL) is required to derive dedicated datastore URL'
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(base);
    } catch {
      throw new ServiceUnavailableException('Invalid DATABASE_URL for dedicated URL derivation');
    }

    // Legacy smoke/provisioning refs used older db-name prefixes; keep compatibility for existing tenants.
    const legacyLive = this.tryLegacyPatternDbName(datastoreRef, 'tenant-ded-live-', 'vpos_ded_live_');
    if (legacyLive) {
      parsed.pathname = `/${legacyLive}`;
      return parsed.toString();
    }
    const legacySmoke = this.tryLegacyPatternDbName(datastoreRef, 'tenant-ded-smoke-', 'vpos_ded_smoke_');
    if (legacySmoke) {
      parsed.pathname = `/${legacySmoke}`;
      return parsed.toString();
    }

    const prefix = process.env.VPOS_DEDICATED_DB_NAME_PREFIX?.trim() || 'vpos_tenant_';
    const slug = datastoreRef
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'tenant';
    const dbName = `${prefix}${slug}`.slice(0, 63);
    parsed.pathname = `/${dbName}`;
    return parsed.toString();
  }

  private allowDefaultDerivedUrl(): boolean {
    const raw = process.env.VPOS_DERIVE_DEDICATED_URL_ON_PROVISION?.trim().toLowerCase();
    if (!raw) {
      return true;
    }
    return raw === 'true' || raw === '1' || raw === 'yes';
  }

  private readDedicatedUrlMap(): Record<string, string> {
    const raw = process.env.VPOS_DEDICATED_DB_URLS_JSON?.trim();
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      return parsed;
    } catch {
      this.logger.warn('Invalid VPOS_DEDICATED_DB_URLS_JSON; expected JSON object');
      return {};
    }
  }

  private toEnvKey(value: string): string {
    return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  }

  private memoryKey(companyId: string, datastoreRef: string): string {
    return `${companyId}::${datastoreRef}`;
  }

  private tryLegacyPatternDbName(
    datastoreRef: string,
    refPrefix: string,
    dbPrefix: string
  ): string | null {
    const normalized = datastoreRef.trim().toLowerCase();
    if (!normalized.startsWith(refPrefix)) {
      return null;
    }
    const suffix = normalized.slice(refPrefix.length).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!suffix) {
      return null;
    }
    return `${dbPrefix}${suffix}`.slice(0, 63);
  }
}
