import { DatastoreRegistryService } from '../src/common/datastore-registry.service';
import type { PrismaService } from '../src/common/prisma.service';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

type RegistryStore = Map<string, {
  companyId: string;
  datastoreRef: string;
  encryptedUrl: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}>;

describe('DatastoreRegistryService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      VPOS_DATASTORE_ENCRYPTION_KEY: 'test-datastore-key',
      DATABASE_URL: 'postgresql://vpos:vpos@localhost:5432/vpos?schema=public'
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  function buildPrismaMock(store: RegistryStore): PrismaService {
    const tenantDatastoreRegistry = {
      upsert: jest.fn().mockImplementation(async (args: {
        where: { companyId_datastoreRef: { companyId: string; datastoreRef: string } };
        update: {
          encryptedUrl: string;
          iv: string;
          authTag: string;
          keyVersion: string;
        };
        create: {
          companyId: string;
          datastoreRef: string;
          encryptedUrl: string;
          iv: string;
          authTag: string;
          keyVersion: string;
        };
      }) => {
        const key = `${args.where.companyId_datastoreRef.companyId}::${args.where.companyId_datastoreRef.datastoreRef}`;
        const existing = store.get(key);
        if (existing) {
          const next = {
            ...existing,
            ...args.update
          };
          store.set(key, next);
          return next;
        }
        store.set(key, args.create);
        return args.create;
      }),
      findUnique: jest.fn().mockImplementation(async (args: {
        where: { companyId_datastoreRef: { companyId: string; datastoreRef: string } };
      }) => {
        const key = `${args.where.companyId_datastoreRef.companyId}::${args.where.companyId_datastoreRef.datastoreRef}`;
        return store.get(key) ?? null;
      })
    };

    return { tenantDatastoreRegistry } as unknown as PrismaService;
  }

  function keyFromSecret(secret: string): Buffer {
    if (secret.startsWith('base64:')) {
      const buf = Buffer.from(secret.slice('base64:'.length), 'base64');
      return createHash('sha256').update(buf).digest();
    }
    if (/^[A-Fa-f0-9]{64}$/.test(secret)) {
      const buf = Buffer.from(secret, 'hex');
      return createHash('sha256').update(buf).digest();
    }
    return createHash('sha256').update(secret, 'utf8').digest();
  }

  function encryptWithSecret(secret: string, plain: string, keyVersion: string): {
    encryptedUrl: string;
    iv: string;
    authTag: string;
    keyVersion: string;
  } {
    const key = keyFromSecret(secret);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      encryptedUrl: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyVersion
    };
  }

  it('stores encrypted URL and resolves decrypted value', async () => {
    const store: RegistryStore = new Map();
    const prismaMock = buildPrismaMock(store);
    const service = new DatastoreRegistryService(prismaMock);

    await service.registerTenantDatastoreUrl(
      'comp-1',
      'ded-ref-1',
      'postgresql://vpos:vpos@localhost:5432/vpos_tenant_ref_1?schema=public'
    );

    const rawStored = store.get('comp-1::ded-ref-1');
    expect(rawStored).toBeDefined();
    expect(rawStored?.encryptedUrl).not.toContain('postgresql://');

    const resolved = await service.resolveTenantDatastoreUrl('comp-1', 'ded-ref-1');
    expect(resolved).toBe('postgresql://vpos:vpos@localhost:5432/vpos_tenant_ref_1?schema=public');
  });

  it('imports env-mapped URL into registry during ensure call', async () => {
    process.env.VPOS_DEDICATED_DB_URLS_JSON = JSON.stringify({
      'ded-ref-2': 'postgresql://vpos:vpos@localhost:5432/vpos_tenant_ref_2?schema=public'
    });
    const store: RegistryStore = new Map();
    const prismaMock = buildPrismaMock(store);
    const service = new DatastoreRegistryService(prismaMock);

    const resolved = await service.ensureTenantDatastoreUrl('comp-2', 'ded-ref-2');

    expect(resolved).toBe('postgresql://vpos:vpos@localhost:5432/vpos_tenant_ref_2?schema=public');
    const rawStored = store.get('comp-2::ded-ref-2');
    expect(rawStored).toBeDefined();
  });

  it('derives and stores a default dedicated URL when mapping is missing', async () => {
    delete process.env.VPOS_DEDICATED_DB_URLS_JSON;
    process.env.VPOS_DERIVE_DEDICATED_URL_ON_PROVISION = 'true';
    process.env.VPOS_DEDICATED_DB_NAME_PREFIX = 'vpos_ded_';

    const store: RegistryStore = new Map();
    const prismaMock = buildPrismaMock(store);
    const service = new DatastoreRegistryService(prismaMock);

    const resolved = await service.ensureTenantDatastoreUrl('comp-3', 'Tenant Ref 3');

    expect(resolved).toContain('/vpos_ded_tenant_ref_3');
    const rawStored = store.get('comp-3::Tenant Ref 3');
    expect(rawStored).toBeDefined();
  });

  it('derives legacy live-smoke datastore refs using old db naming scheme', async () => {
    delete process.env.VPOS_DEDICATED_DB_URLS_JSON;
    process.env.VPOS_DERIVE_DEDICATED_URL_ON_PROVISION = 'true';

    const store: RegistryStore = new Map();
    const prismaMock = buildPrismaMock(store);
    const service = new DatastoreRegistryService(prismaMock);

    const resolved = await service.ensureTenantDatastoreUrl(
      'comp-legacy',
      'tenant-ded-live-20260225174622-94bb5914'
    );

    expect(resolved).toContain('/vpos_ded_live_20260225174622_94bb5914');
  });

  it('decrypts with previous key and lazily rotates ciphertext to current key version', async () => {
    delete process.env.VPOS_DATASTORE_ENCRYPTION_KEY;
    process.env.VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT = 'new-rotation-key';
    process.env.VPOS_DATASTORE_ENCRYPTION_KEY_CURRENT_VERSION = 'v2';
    process.env.VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS = 'old-rotation-key';
    process.env.VPOS_DATASTORE_ENCRYPTION_KEY_PREVIOUS_VERSION = 'v1';

    const store: RegistryStore = new Map();
    const prismaMock = buildPrismaMock(store);
    const service = new DatastoreRegistryService(prismaMock);
    const legacyCipher = encryptWithSecret(
      'old-rotation-key',
      'postgresql://vpos:vpos@localhost:5432/vpos_tenant_rotated?schema=public',
      'v1'
    );
    store.set('comp-rotate::ded-ref-rotate', {
      companyId: 'comp-rotate',
      datastoreRef: 'ded-ref-rotate',
      encryptedUrl: legacyCipher.encryptedUrl,
      iv: legacyCipher.iv,
      authTag: legacyCipher.authTag,
      keyVersion: legacyCipher.keyVersion
    });

    const resolved = await service.resolveTenantDatastoreUrl('comp-rotate', 'ded-ref-rotate');
    expect(resolved).toBe('postgresql://vpos:vpos@localhost:5432/vpos_tenant_rotated?schema=public');
    const updated = store.get('comp-rotate::ded-ref-rotate');
    expect(updated?.keyVersion).toBe('v2');
  });
});
