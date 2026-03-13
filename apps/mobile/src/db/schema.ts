export const MOBILE_SQL_SCHEMA = {
  outbox: `
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status_created_at ON outbox(status, created_at);
  `,
  transactions: `
    CREATE TABLE IF NOT EXISTS sales_local (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sales_local_sync_status ON sales_local(sync_status, created_at);

    CREATE TABLE IF NOT EXISTS customer_payments_local (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_customer_payments_local_sync_status ON customer_payments_local(sync_status, created_at);

    CREATE TABLE IF NOT EXISTS transfers_local (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_local_sync_status ON transfers_local(sync_status, created_at);

    CREATE TABLE IF NOT EXISTS petty_cash_local (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_petty_cash_local_sync_status ON petty_cash_local(sync_status, created_at);

    CREATE TABLE IF NOT EXISTS delivery_orders_local (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_orders_local_sync_status ON delivery_orders_local(sync_status, created_at);

    CREATE TABLE IF NOT EXISTS shifts_local (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shifts_local_sync_status ON shifts_local(sync_status, created_at);

    CREATE TABLE IF NOT EXISTS shift_cash_entries_local (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shift_cash_entries_local_sync_status ON shift_cash_entries_local(sync_status, created_at);

    CREATE TABLE IF NOT EXISTS receipts_local (
      sale_id TEXT PRIMARY KEY,
      receipt_number TEXT NOT NULL,
      payload TEXT NOT NULL,
      reprint_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_local_receipt_number ON receipts_local(receipt_number);

    CREATE TABLE IF NOT EXISTS cylinders_local (
      serial TEXT PRIMARY KEY,
      cylinder_type_code TEXT NOT NULL,
      status TEXT NOT NULL,
      location_id TEXT NOT NULL,
      ownership TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cylinders_local_location_status ON cylinders_local(location_id, status);

    CREATE TABLE IF NOT EXISTS cylinder_events_local (
      id TEXT PRIMARY KEY,
      serial TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cylinder_events_local_sync_status ON cylinder_events_local(sync_status, created_at);

    CREATE TABLE IF NOT EXISTS master_data_local (
      entity TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (entity, record_id)
    );
    CREATE INDEX IF NOT EXISTS idx_master_data_local_updated_at ON master_data_local(updated_at);

    CREATE TABLE IF NOT EXISTS sync_reviews_local (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      reason TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_reviews_local_status_updated_at ON sync_reviews_local(status, updated_at);
  `,
  syncState: `
    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_pull_token TEXT,
      updated_at TEXT NOT NULL
    );
  `,
  authSession: `
    CREATE TABLE IF NOT EXISTS auth_session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      encrypted_refresh_token TEXT,
      encrypted_access_token TEXT,
      client_id TEXT,
      pin_hash TEXT,
      pin_salt TEXT,
      updated_at TEXT NOT NULL
    );
  `,
  deviceIdentity: `
    CREATE TABLE IF NOT EXISTS device_identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      device_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
  printerSettings: `
    CREATE TABLE IF NOT EXISTS printer_settings (
      device_id TEXT PRIMARY KEY,
      printer_type TEXT NOT NULL,
      config_json TEXT,
      updated_at TEXT NOT NULL
    );
  `,
  receiptLayoutSettings: `
    CREATE TABLE IF NOT EXISTS receipt_layout_settings (
      device_id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
  subscriptionPolicy: `
    CREATE TABLE IF NOT EXISTS subscription_policy_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL,
      grace_until TEXT,
      source TEXT,
      effective_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
  appState: `
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      selected_branch_id TEXT,
      selected_branch_name TEXT,
      selected_location_id TEXT,
      selected_location_name TEXT,
      last_master_data_sync_at TEXT,
      last_master_data_fingerprint TEXT,
      last_server_check_at TEXT,
      last_server_status TEXT NOT NULL DEFAULT 'UNKNOWN',
      pos_default_lpg_flow TEXT NOT NULL DEFAULT 'NONE',
      last_login_email TEXT,
      tutorial_seen_at TEXT,
      tutorial_seen_keys_json TEXT,
      tutorial_progress_json TEXT,
      updated_at TEXT NOT NULL
    );
  `
};
