import * as SQLite from 'expo-sqlite';

export type LocalCard = {
  id: string;
  uid: string;
  status: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  owner: {
    id: string;
    full_name: string;
    email: string;
  };
  assigned_at: string;
  updated_at: string;
};

export type LocalAuditEvent = {
  id: string;
  card_id: string;
  uid: string;
  event_type: 'BIND' | 'REASSIGN' | 'DEACTIVATE' | 'REACTIVATE' | 'REVOKE';
  actor: {
    id: string;
    full_name: string;
    email: string;
  } | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type NfcOutboxStatus = 'pending' | 'processing' | 'failed' | 'needs_review' | 'done';

export type NfcOutboxItem = {
  id: string;
  operation: string;
  method: 'POST' | 'PATCH';
  path: string;
  payload: Record<string, unknown>;
  status: NfcOutboxStatus;
  retry_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type QueueOutboxInput = {
  operation: string;
  method: 'POST' | 'PATCH';
  path: string;
  payload: Record<string, unknown>;
  status?: NfcOutboxStatus;
  lastError?: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | undefined;

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parsing failures and fallback to empty object.
  }
  return {};
}

export function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('vcard-admin.db');
  }
  return dbPromise;
}

export async function initLocalStore(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS nfc_cards_local (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      status TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nfc_cards_local_status_updated_at
      ON nfc_cards_local(status, updated_at);

    CREATE TABLE IF NOT EXISTS nfc_card_events_local (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nfc_card_events_local_card_created_at
      ON nfc_card_events_local(card_id, created_at);

    CREATE TABLE IF NOT EXISTS nfc_outbox (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nfc_outbox_status_created_at
      ON nfc_outbox(status, created_at);
  `);
}

export async function replaceCardsCache(rows: LocalCard[]): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM nfc_cards_local;');
  for (const row of rows) {
    await db.runAsync(
      `
      INSERT INTO nfc_cards_local(id, uid, status, payload, updated_at)
      VALUES (?, ?, ?, ?, ?)
      `,
      row.id,
      row.uid,
      row.status,
      JSON.stringify(row),
      row.updated_at
    );
  }
}

export async function loadCardsCache(): Promise<LocalCard[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payload: string }>(
    `
    SELECT payload
    FROM nfc_cards_local
    ORDER BY updated_at DESC
    `
  );
  return rows
    .map((row) => parseObject(row.payload) as LocalCard)
    .filter((row) => Boolean(row?.id && row?.uid));
}

export async function replaceAuditCache(rows: LocalAuditEvent[]): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM nfc_card_events_local;');
  for (const row of rows) {
    await db.runAsync(
      `
      INSERT INTO nfc_card_events_local(id, card_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
      `,
      row.id,
      row.card_id,
      row.event_type,
      JSON.stringify(row),
      row.created_at
    );
  }
}

export async function loadAuditCache(): Promise<LocalAuditEvent[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payload: string }>(
    `
    SELECT payload
    FROM nfc_card_events_local
    ORDER BY created_at DESC
    `
  );
  return rows
    .map((row) => parseObject(row.payload) as LocalAuditEvent)
    .filter((row) => Boolean(row?.id && row?.card_id && row?.uid));
}

export async function queueOutbox(input: QueueOutboxInput): Promise<NfcOutboxItem> {
  const db = await getDb();
  const now = new Date().toISOString();
  const item: NfcOutboxItem = {
    id: createLocalId('nfc-outbox'),
    operation: input.operation,
    method: input.method,
    path: input.path,
    payload: input.payload,
    status: input.status ?? 'pending',
    retry_count: 0,
    last_error: input.lastError ?? null,
    created_at: now,
    updated_at: now
  };
  await db.runAsync(
    `
    INSERT INTO nfc_outbox(
      id, operation, method, path, payload, status, retry_count, last_error, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    item.id,
    item.operation,
    item.method,
    item.path,
    JSON.stringify(item.payload),
    item.status,
    item.retry_count,
    item.last_error,
    item.created_at,
    item.updated_at
  );
  return item;
}

export async function listOutbox(limit = 150): Promise<NfcOutboxItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    operation: string;
    method: string;
    path: string;
    payload: string;
    status: string;
    retry_count: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
    SELECT id, operation, method, path, payload, status, retry_count, last_error, created_at, updated_at
    FROM nfc_outbox
    ORDER BY created_at DESC
    LIMIT ?
    `,
    limit
  );
  return rows.map((row) => ({
    id: row.id,
    operation: row.operation,
    method: row.method === 'PATCH' ? 'PATCH' : 'POST',
    path: row.path,
    payload: parseObject(row.payload),
    status: (row.status as NfcOutboxStatus) ?? 'pending',
    retry_count: Number.isFinite(Number(row.retry_count)) ? Number(row.retry_count) : 0,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

export async function listSyncableOutbox(): Promise<NfcOutboxItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    operation: string;
    method: string;
    path: string;
    payload: string;
    status: string;
    retry_count: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
    SELECT id, operation, method, path, payload, status, retry_count, last_error, created_at, updated_at
    FROM nfc_outbox
    WHERE status IN ('pending', 'failed')
    ORDER BY created_at ASC
    `
  );
  return rows.map((row) => ({
    id: row.id,
    operation: row.operation,
    method: row.method === 'PATCH' ? 'PATCH' : 'POST',
    path: row.path,
    payload: parseObject(row.payload),
    status: (row.status as NfcOutboxStatus) ?? 'pending',
    retry_count: Number.isFinite(Number(row.retry_count)) ? Number(row.retry_count) : 0,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));
}

export async function updateOutboxStatus(
  id: string,
  status: NfcOutboxStatus,
  lastError?: string | null,
  retryDelta = 0
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
    UPDATE nfc_outbox
    SET
      status = ?,
      last_error = ?,
      retry_count = retry_count + ?,
      updated_at = ?
    WHERE id = ?
    `,
    status,
    lastError ?? null,
    retryDelta,
    now,
    id
  );
}

export async function resetFailedOutboxToPending(): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db.runAsync(
    `
    UPDATE nfc_outbox
    SET status = 'pending', updated_at = ?
    WHERE status = 'failed'
    `,
    now
  );
  return result.changes ?? 0;
}
