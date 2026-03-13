import * as SQLite from 'expo-sqlite';
import { MOBILE_SQL_SCHEMA } from './schema';

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('vpos.db');
  }
  return databasePromise;
}

export async function initDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(MOBILE_SQL_SCHEMA.outbox);
  await db.execAsync(MOBILE_SQL_SCHEMA.transactions);
  await db.execAsync(MOBILE_SQL_SCHEMA.syncState);
  await db.execAsync(MOBILE_SQL_SCHEMA.authSession);
  await db.execAsync(MOBILE_SQL_SCHEMA.deviceIdentity);
  await db.execAsync(MOBILE_SQL_SCHEMA.printerSettings);
  await db.execAsync(MOBILE_SQL_SCHEMA.receiptLayoutSettings);
  await db.execAsync(MOBILE_SQL_SCHEMA.subscriptionPolicy);
  await db.execAsync(MOBILE_SQL_SCHEMA.appState);

  try {
    await db.execAsync('ALTER TABLE auth_session ADD COLUMN pin_salt TEXT;');
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    await db.execAsync('ALTER TABLE auth_session ADD COLUMN client_id TEXT;');
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    await db.execAsync('ALTER TABLE app_state ADD COLUMN last_master_data_fingerprint TEXT;');
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    await db.execAsync('ALTER TABLE app_state ADD COLUMN selected_location_id TEXT;');
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    await db.execAsync('ALTER TABLE app_state ADD COLUMN selected_location_name TEXT;');
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    await db.execAsync("ALTER TABLE app_state ADD COLUMN pos_default_lpg_flow TEXT NOT NULL DEFAULT 'NONE';");
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    await db.execAsync('ALTER TABLE app_state ADD COLUMN last_login_email TEXT;');
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    await db.execAsync('ALTER TABLE app_state ADD COLUMN tutorial_seen_at TEXT;');
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    await db.execAsync('ALTER TABLE app_state ADD COLUMN tutorial_seen_keys_json TEXT;');
  } catch {
    // Column already exists on upgraded databases.
  }

  try {
    await db.execAsync('ALTER TABLE app_state ADD COLUMN tutorial_progress_json TEXT;');
  } catch {
    // Column already exists on upgraded databases.
  }

  await db.runAsync(
    'INSERT OR IGNORE INTO sync_state(id, last_pull_token, updated_at) VALUES (1, NULL, ?)',
    new Date().toISOString()
  );

  await db.runAsync(
    `
    INSERT OR IGNORE INTO auth_session(
      id,
      encrypted_refresh_token,
      encrypted_access_token,
      client_id,
      pin_hash,
      pin_salt,
      updated_at
    )
    VALUES (1, NULL, NULL, NULL, NULL, NULL, ?)
    `,
    new Date().toISOString()
  );

  const now = new Date().toISOString();
  await db.runAsync(
    `
    INSERT OR IGNORE INTO subscription_policy_state(id, status, grace_until, source, effective_at, updated_at)
    VALUES (1, ?, NULL, ?, ?, ?)
    `,
    'ACTIVE',
    'bootstrap',
    now,
    now
  );

  await db.runAsync(
    `
    INSERT OR IGNORE INTO app_state(
      id,
      selected_branch_id,
      selected_branch_name,
      selected_location_id,
      selected_location_name,
      last_master_data_sync_at,
      last_master_data_fingerprint,
      last_server_check_at,
      last_server_status,
      pos_default_lpg_flow,
      last_login_email,
      tutorial_seen_at,
      tutorial_seen_keys_json,
      tutorial_progress_json,
      updated_at
    )
    VALUES (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'UNKNOWN', 'NONE', NULL, NULL, NULL, '{}', ?)
    `,
    now
  );
}
