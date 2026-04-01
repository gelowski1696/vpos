import { invoke } from '@tauri-apps/api/tauri';
import type { OutboxItem } from '@vpos/shared-types';
import {
  DEFAULT_DESKTOP_APP_STATE,
  type DesktopAppState,
  type DesktopMasterDataRow,
  type DesktopSaleRecord
} from './schema';

const STORAGE_KEY = 'vpos-desktop-app-state';
const OUTBOX_KEY = 'vpos-desktop-outbox';
const SALES_KEY = 'vpos-desktop-sales';
const MASTER_DATA_KEY = 'vpos-desktop-master-data';

type WindowWithTauri = Window & {
  __TAURI_INTERNALS__?: unknown;
};

export type DesktopOutboxInput = Pick<
  OutboxItem,
  'id' | 'entity' | 'action' | 'payload' | 'idempotency_key' | 'created_at'
>;

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in (window as WindowWithTauri);
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function parseLocalState(raw: string | null): DesktopAppState {
  if (!raw) {
    return DEFAULT_DESKTOP_APP_STATE;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DesktopAppState>;
    return {
      ...DEFAULT_DESKTOP_APP_STATE,
      ...parsed,
      printerProfiles: Array.isArray(parsed.printerProfiles)
        ? parsed.printerProfiles.map((profile) => ({
            id: profile.id,
            label: profile.label,
            mode: profile.mode,
            printerName: profile.printerName,
            printerHost: profile.printerHost,
            printerPort: profile.printerPort,
            lastTestedAt: profile.lastTestedAt ?? null,
            lastSuccessAt: profile.lastSuccessAt ?? null,
            lastTestStatus: profile.lastTestStatus ?? 'idle',
            lastTestMessage: profile.lastTestMessage ?? null
          }))
        : DEFAULT_DESKTOP_APP_STATE.printerProfiles,
      setup: {
        ...DEFAULT_DESKTOP_APP_STATE.setup,
        ...parsed.setup
      },
      auth: {
        ...DEFAULT_DESKTOP_APP_STATE.auth,
        ...parsed.auth
      },
      sync: {
        ...DEFAULT_DESKTOP_APP_STATE.sync,
        ...parsed.sync
      }
    };
  } catch {
    return DEFAULT_DESKTOP_APP_STATE;
  }
}

function parseLocalOutbox(raw: string | null): OutboxItem[] {
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as OutboxItem[];
  } catch {
    return [];
  }
}

function parseLocalSales(raw: string | null): DesktopSaleRecord[] {
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as DesktopSaleRecord[];
  } catch {
    return [];
  }
}

function parseLocalMasterData(raw: string | null): DesktopMasterDataRow[] {
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as DesktopMasterDataRow[];
  } catch {
    return [];
  }
}

export class DesktopDb {
  async loadState(): Promise<DesktopAppState> {
    if (isTauriRuntime()) {
      return invoke<DesktopAppState>('desktop_load_state');
    }
    if (!canUseStorage()) {
      return DEFAULT_DESKTOP_APP_STATE;
    }
    return parseLocalState(window.localStorage.getItem(STORAGE_KEY));
  }

  async saveState(state: DesktopAppState): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('desktop_save_state', { state });
      return;
    }
    if (!canUseStorage()) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  async listSales(): Promise<DesktopSaleRecord[]> {
    if (isTauriRuntime()) {
      return invoke<DesktopSaleRecord[]>('desktop_list_sales');
    }
    if (!canUseStorage()) {
      return [];
    }
    return parseLocalSales(window.localStorage.getItem(SALES_KEY));
  }

  async saveSale(sale: DesktopSaleRecord): Promise<DesktopSaleRecord> {
    if (isTauriRuntime()) {
      return invoke<DesktopSaleRecord>('desktop_save_sale', { sale });
    }
    const rows = await this.listSales();
    const filtered = rows.filter((row) => row.id !== sale.id);
    filtered.unshift(sale);
    if (canUseStorage()) {
      window.localStorage.setItem(SALES_KEY, JSON.stringify(filtered));
    }
    return sale;
  }

  async markSaleSyncStatus(id: string, syncStatus: DesktopSaleRecord['syncStatus']): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('desktop_mark_sale_sync_status', { id, syncStatus });
      return;
    }
    const rows = await this.listSales();
    const next = rows.map((row) =>
      row.id === id
        ? {
            ...row,
            syncStatus,
            updatedAt: new Date().toISOString()
          }
        : row
    );
    if (canUseStorage()) {
      window.localStorage.setItem(SALES_KEY, JSON.stringify(next));
    }
  }

  async listMasterData(entity?: string): Promise<DesktopMasterDataRow[]> {
    if (isTauriRuntime()) {
      return invoke<DesktopMasterDataRow[]>('desktop_list_master_data', { entity: entity ?? null });
    }
    if (!canUseStorage()) {
      return [];
    }
    const rows = parseLocalMasterData(window.localStorage.getItem(MASTER_DATA_KEY));
    if (!entity) {
      return rows;
    }
    return rows.filter((row) => row.entity === entity);
  }

  async replaceMasterDataEntity(entity: string, rows: DesktopMasterDataRow[]): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('desktop_replace_master_data_entity', { entity, rows });
      return;
    }
    const current = await this.listMasterData();
    const next = [...current.filter((row) => row.entity !== entity), ...rows];
    if (canUseStorage()) {
      window.localStorage.setItem(MASTER_DATA_KEY, JSON.stringify(next));
    }
  }

  async upsertMasterDataRows(rows: DesktopMasterDataRow[]): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('desktop_upsert_master_data_rows', { rows });
      return;
    }
    const current = await this.listMasterData();
    const byKey = new Map(current.map((row) => [`${row.entity}::${row.recordId}`, row] as const));
    rows.forEach((row) => {
      byKey.set(`${row.entity}::${row.recordId}`, row);
    });
    if (canUseStorage()) {
      window.localStorage.setItem(MASTER_DATA_KEY, JSON.stringify(Array.from(byKey.values())));
    }
  }

  async listOutboxItems(): Promise<OutboxItem[]> {
    if (isTauriRuntime()) {
      return invoke<OutboxItem[]>('desktop_list_outbox');
    }
    if (!canUseStorage()) {
      return [];
    }
    return parseLocalOutbox(window.localStorage.getItem(OUTBOX_KEY));
  }

  async enqueueOutboxItem(input: DesktopOutboxInput): Promise<OutboxItem> {
    if (isTauriRuntime()) {
      return invoke<OutboxItem>('desktop_enqueue_outbox_item', { input });
    }
    const now = new Date().toISOString();
    const next: OutboxItem = {
      ...input,
      status: 'pending' as OutboxItem['status'],
      retry_count: 0,
      last_error: null,
      updated_at: now
    };
    const rows = await this.listOutboxItems();
    const filtered = rows.filter((row) => row.id !== input.id);
    filtered.unshift(next);
    if (canUseStorage()) {
      window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(filtered));
    }
    return next;
  }

  async markOutboxStatus(id: string, status: OutboxItem['status'], lastError?: string | null): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('desktop_mark_outbox_status', { id, status, lastError: lastError ?? null });
      return;
    }
    const rows = await this.listOutboxItems();
    const next = rows.map((row) =>
      row.id === id
        ? { ...row, status, last_error: lastError ?? null, updated_at: new Date().toISOString() }
        : row
    );
    if (canUseStorage()) {
      window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
    }
  }

  async incrementOutboxRetry(id: string, error: string): Promise<void> {
    if (isTauriRuntime()) {
      await invoke('desktop_increment_outbox_retry', { id, error });
      return;
    }
    const rows = await this.listOutboxItems();
    const next = rows.map((row) =>
      row.id === id
        ? {
            ...row,
            status: 'failed' as OutboxItem['status'],
            retry_count: row.retry_count + 1,
            last_error: error,
            updated_at: new Date().toISOString()
          }
        : row
    );
    if (canUseStorage()) {
      window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
    }
  }
}

export const desktopDb = new DesktopDb();
