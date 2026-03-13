import type { SQLiteDatabase } from 'expo-sqlite';

export type PosDefaultLpgFlow = 'NONE' | 'REFILL_EXCHANGE' | 'NON_REFILL';

export type StartupState = {
  selectedBranchId: string | null;
  selectedBranchName: string | null;
  selectedLocationId: string | null;
  selectedLocationName: string | null;
  lastMasterDataSyncAt: string | null;
  lastMasterDataFingerprint: string | null;
  lastServerCheckAt: string | null;
  lastServerStatus: 'UNKNOWN' | 'ONLINE' | 'OFFLINE';
  posDefaultLpgFlow: PosDefaultLpgFlow;
  lastLoginEmail: string | null;
  tutorialSeenAt: string | null;
  tutorialSeenKeys: string[];
  tutorialProgressByScope: Record<string, number>;
};

const DEFAULT_STATE: StartupState = {
  selectedBranchId: null,
  selectedBranchName: null,
  selectedLocationId: null,
  selectedLocationName: null,
  lastMasterDataSyncAt: null,
  lastMasterDataFingerprint: null,
  lastServerCheckAt: null,
  lastServerStatus: 'UNKNOWN',
  posDefaultLpgFlow: 'NONE',
  lastLoginEmail: null,
  tutorialSeenAt: null,
  tutorialSeenKeys: [],
  tutorialProgressByScope: {}
};

export async function getStartupState(db: SQLiteDatabase): Promise<StartupState> {
  const row = await db.getFirstAsync<{
    selected_branch_id: string | null;
    selected_branch_name: string | null;
    selected_location_id: string | null;
    selected_location_name: string | null;
    last_master_data_sync_at: string | null;
    last_master_data_fingerprint: string | null;
    last_server_check_at: string | null;
    last_server_status: string | null;
    pos_default_lpg_flow: string | null;
    last_login_email: string | null;
    tutorial_seen_at: string | null;
    tutorial_seen_keys_json: string | null;
    tutorial_progress_json: string | null;
  }>(
    `
    SELECT
      selected_branch_id,
      selected_branch_name,
      selected_location_id,
      selected_location_name,
      last_master_data_sync_at,
      last_master_data_fingerprint,
      last_server_check_at,
      last_server_status,
      pos_default_lpg_flow
      ,last_login_email,
      tutorial_seen_at,
      tutorial_seen_keys_json,
      tutorial_progress_json
    FROM app_state
    WHERE id = 1
    `
  );

  if (!row) {
    return DEFAULT_STATE;
  }

  const status = row.last_server_status === 'ONLINE' || row.last_server_status === 'OFFLINE' ? row.last_server_status : 'UNKNOWN';
  const posDefaultLpgFlow: PosDefaultLpgFlow =
    row.pos_default_lpg_flow === 'REFILL_EXCHANGE' || row.pos_default_lpg_flow === 'NON_REFILL'
      ? row.pos_default_lpg_flow
      : 'NONE';

  let tutorialSeenKeys: string[] = [];
  if (typeof row.tutorial_seen_keys_json === 'string' && row.tutorial_seen_keys_json.trim()) {
    try {
      const parsed = JSON.parse(row.tutorial_seen_keys_json) as unknown;
      if (Array.isArray(parsed)) {
        tutorialSeenKeys = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      }
    } catch {
      tutorialSeenKeys = [];
    }
  }

  let tutorialProgressByScope: Record<string, number> = {};
  if (typeof row.tutorial_progress_json === 'string' && row.tutorial_progress_json.trim()) {
    try {
      const parsed = JSON.parse(row.tutorial_progress_json) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        tutorialProgressByScope = Object.entries(parsed as Record<string, unknown>).reduce<Record<string, number>>(
          (acc, [key, value]) => {
            if (typeof key !== 'string' || !key.trim()) {
              return acc;
            }
            const numeric = Number(value);
            if (Number.isFinite(numeric) && numeric >= 0) {
              acc[key] = Math.floor(numeric);
            }
            return acc;
          },
          {},
        );
      }
    } catch {
      tutorialProgressByScope = {};
    }
  }

  return {
    selectedBranchId: row.selected_branch_id,
    selectedBranchName: row.selected_branch_name,
    selectedLocationId: row.selected_location_id,
    selectedLocationName: row.selected_location_name,
    lastMasterDataSyncAt: row.last_master_data_sync_at,
    lastMasterDataFingerprint: row.last_master_data_fingerprint,
    lastServerCheckAt: row.last_server_check_at,
    lastServerStatus: status,
    posDefaultLpgFlow,
    lastLoginEmail: row.last_login_email,
    tutorialSeenAt: row.tutorial_seen_at,
    tutorialSeenKeys,
    tutorialProgressByScope
  };
}

export async function updateStartupState(
  db: SQLiteDatabase,
  patch: Partial<StartupState>
): Promise<void> {
  const current = await getStartupState(db);
  const next: StartupState = {
    selectedBranchId: patch.selectedBranchId ?? current.selectedBranchId,
    selectedBranchName: patch.selectedBranchName ?? current.selectedBranchName,
    selectedLocationId: patch.selectedLocationId ?? current.selectedLocationId,
    selectedLocationName: patch.selectedLocationName ?? current.selectedLocationName,
    lastMasterDataSyncAt: patch.lastMasterDataSyncAt ?? current.lastMasterDataSyncAt,
    lastMasterDataFingerprint: patch.lastMasterDataFingerprint ?? current.lastMasterDataFingerprint,
    lastServerCheckAt: patch.lastServerCheckAt ?? current.lastServerCheckAt,
    lastServerStatus: patch.lastServerStatus ?? current.lastServerStatus,
    posDefaultLpgFlow: patch.posDefaultLpgFlow ?? current.posDefaultLpgFlow,
    lastLoginEmail: patch.lastLoginEmail ?? current.lastLoginEmail,
    tutorialSeenAt: patch.tutorialSeenAt ?? current.tutorialSeenAt,
    tutorialSeenKeys: patch.tutorialSeenKeys ?? current.tutorialSeenKeys,
    tutorialProgressByScope: patch.tutorialProgressByScope ?? current.tutorialProgressByScope
  };

  await db.runAsync(
    `
    INSERT INTO app_state(
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
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      selected_branch_id = excluded.selected_branch_id,
      selected_branch_name = excluded.selected_branch_name,
      selected_location_id = excluded.selected_location_id,
      selected_location_name = excluded.selected_location_name,
      last_master_data_sync_at = excluded.last_master_data_sync_at,
      last_master_data_fingerprint = excluded.last_master_data_fingerprint,
      last_server_check_at = excluded.last_server_check_at,
      last_server_status = excluded.last_server_status,
      pos_default_lpg_flow = excluded.pos_default_lpg_flow,
      last_login_email = excluded.last_login_email,
      tutorial_seen_at = excluded.tutorial_seen_at,
      tutorial_seen_keys_json = excluded.tutorial_seen_keys_json,
      tutorial_progress_json = excluded.tutorial_progress_json,
      updated_at = excluded.updated_at
    `,
    next.selectedBranchId,
    next.selectedBranchName,
    next.selectedLocationId,
    next.selectedLocationName,
    next.lastMasterDataSyncAt,
    next.lastMasterDataFingerprint,
    next.lastServerCheckAt,
    next.lastServerStatus,
    next.posDefaultLpgFlow,
    next.lastLoginEmail,
    next.tutorialSeenAt,
    JSON.stringify(next.tutorialSeenKeys),
    JSON.stringify(next.tutorialProgressByScope ?? {}),
    new Date().toISOString()
  );
}
