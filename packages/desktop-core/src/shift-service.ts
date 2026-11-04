import type { OutboxItem } from '@vpos/shared-types';
import type {
  DesktopAppState,
  DesktopMasterDataRow,
  DesktopShiftCashEntry,
  DesktopShiftInventorySnapshot,
  DesktopShiftRecord
} from './schema';

type DesktopShiftOutboxInput = Pick<
  OutboxItem,
  'id' | 'entity' | 'action' | 'payload' | 'idempotency_key' | 'created_at'
>;

export interface DesktopShiftRepository {
  listMasterData(entity?: string): Promise<DesktopMasterDataRow[]>;
  upsertMasterDataRows(rows: DesktopMasterDataRow[]): Promise<void>;
  enqueueOutboxItem(input: DesktopShiftOutboxInput): Promise<unknown>;
}

export interface DesktopShiftInventorySnapshotPort {
  captureSnapshot(input: {
    locationId: string;
    locationLabel?: string | null;
  }): Promise<DesktopShiftInventorySnapshot>;
}

export interface DesktopShiftSubscriptionPolicyPort {
  assertCanCreateTransactions(operation?: string): Promise<unknown>;
}

export type DesktopShiftPorts = {
  repository: DesktopShiftRepository;
  inventory: DesktopShiftInventorySnapshotPort;
  subscriptionPolicy: DesktopShiftSubscriptionPolicyPort;
};

const SHIFT_ENTITY = 'desktop_shift';
const SHIFT_CASH_ENTITY = 'desktop_shift_cash';

export type DesktopOpenShiftInput = {
  openingCash: number;
  openingCashDenominations?: Array<{
    denomination: number;
    quantity: number;
  }>;
};

export type DesktopCloseShiftInput = {
  shiftId: string;
  closingCash: number;
  closingCashDenominations?: Array<{
    denomination: number;
    quantity: number;
  }>;
  cashVariance: number;
  closingInventorySnapshot?: DesktopShiftInventorySnapshot | null;
};

export type DesktopShiftCashInput = {
  shiftId: string;
  direction: 'IN' | 'OUT';
  amount: number;
  notes?: string | null;
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const atobFn = (globalThis as { atob?: (value: string) => string }).atob;
    return typeof atobFn === 'function' ? atobFn(padded) : null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  const decoded = decodeBase64Url(parts[1]);
  if (!decoded) {
    return null;
  }
  try {
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseShift(payload: string): DesktopShiftRecord | null {
  try {
    return JSON.parse(payload) as DesktopShiftRecord;
  } catch {
    return null;
  }
}

function parseShiftCash(payload: string): DesktopShiftCashEntry | null {
  try {
    return JSON.parse(payload) as DesktopShiftCashEntry;
  } catch {
    return null;
  }
}

function resolveSessionIdentity(appState: DesktopAppState): { userId: string; cashierName: string } {
  const payload = decodeJwtPayload(appState.auth.accessToken);
  const userId =
    typeof payload?.sub === 'string' && payload.sub.trim()
      ? payload.sub.trim()
      : appState.auth.userEmail?.trim() || appState.setup.authEmail.trim();
  const cashierName =
    (typeof payload?.full_name === 'string' && payload.full_name.trim()) ||
    (typeof payload?.name === 'string' && payload.name.trim()) ||
    appState.auth.userFullName?.trim() ||
    appState.setup.operatorName.trim() ||
    appState.auth.userEmail?.trim() ||
    'Cashier';
  return { userId, cashierName };
}

function normalizeCashDenominations(
  entries: DesktopOpenShiftInput['openingCashDenominations'] | DesktopCloseShiftInput['closingCashDenominations'],
  label: 'Opening' | 'Closing'
): Array<{ denomination: number; quantity: number; total: number }> {
  if (!Array.isArray(entries)) {
    return [];
  }
  const normalized: Array<{ denomination: number; quantity: number; total: number }> = [];
  for (const entry of entries) {
    const denomination = Number(entry?.denomination);
    const quantityRaw = Number(entry?.quantity);
    if (!Number.isFinite(denomination) || denomination <= 0) {
      throw new Error(`${label} cash contains an invalid denomination.`);
    }
    if (!Number.isInteger(quantityRaw) || quantityRaw <= 0) {
      throw new Error(`${label} denomination quantities must be positive whole numbers.`);
    }
    const quantity = quantityRaw;
    normalized.push({
      denomination,
      quantity,
      total: Number((denomination * quantity).toFixed(2))
    });
  }
  return normalized.sort((a, b) => b.denomination - a.denomination);
}

export class DesktopShiftService {
  constructor(private readonly ports: DesktopShiftPorts) {}

  async listShifts(): Promise<DesktopShiftRecord[]> {
    const rows = await this.ports.repository.listMasterData(SHIFT_ENTITY);
    return rows
      .map((row) => parseShift(row.payload))
      .filter((row): row is DesktopShiftRecord => Boolean(row))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async listShiftCashEntries(): Promise<DesktopShiftCashEntry[]> {
    const rows = await this.ports.repository.listMasterData(SHIFT_CASH_ENTITY);
    return rows
      .map((row) => parseShiftCash(row.payload))
      .filter((row): row is DesktopShiftCashEntry => Boolean(row))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async openShift(appState: DesktopAppState, input: DesktopOpenShiftInput): Promise<DesktopShiftRecord> {
    if (!appState.setup.branchId.trim() || !appState.setup.locationId.trim()) {
      throw new Error('Choose a branch and location first before starting duty.');
    }
    const { userId, cashierName } = resolveSessionIdentity(appState);
    if (!userId.trim()) {
      throw new Error('Desktop sign-in is missing the cashier identity. Sign in again first.');
    }
    const existing = await this.findActiveShift();
    if (existing) {
      throw new Error('An active shift is already open. End it first before starting a new one.');
    }

    const openingCash = Number(input.openingCash);
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      throw new Error('Opening cash must be zero or greater.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('shift_open');
    const openingCashDenominations = normalizeCashDenominations(input.openingCashDenominations, 'Opening');
    if (openingCashDenominations.length > 0) {
      const totalFromDenominations = Number(
        openingCashDenominations.reduce((sum, row) => sum + row.total, 0).toFixed(2)
      );
      if (Math.abs(totalFromDenominations - openingCash) > 0.009) {
        throw new Error('Opening cash total does not match the denomination count.');
      }
    }

    const openingInventorySnapshot = await this.ports.inventory.captureSnapshot({
      locationId: appState.setup.locationId,
      locationLabel: appState.setup.locationLabel
    });
    const now = new Date().toISOString();
    const record: DesktopShiftRecord = {
      id: createId('desk-shift'),
      branchId: appState.setup.branchId,
      branchLabel: appState.setup.branchLabel,
      locationId: appState.setup.locationId,
      locationLabel: appState.setup.locationLabel,
      userId,
      cashierName,
      openingCash,
      openingCashDenominations: openingCashDenominations.length ? openingCashDenominations : undefined,
      openingInventorySnapshot,
      closingCash: null,
      closingCashDenominations: undefined,
      cashVariance: null,
      closingInventorySnapshot: null,
      status: 'OPEN',
      syncStatus: 'pending',
      lastError: null,
      openedAt: now,
      closedAt: null,
      createdAt: now,
      updatedAt: now
    };

    await this.ports.repository.upsertMasterDataRows([
      {
        entity: SHIFT_ENTITY,
        recordId: record.id,
        payload: JSON.stringify(record),
        updatedAt: record.updatedAt
      }
    ]);

    await this.ports.repository.enqueueOutboxItem({
      id: `outbox-${record.id}`,
      entity: 'shift',
      action: 'open',
      payload: {
        id: record.id,
        branch_id: record.branchId,
        location_id: record.locationId,
        user_id: record.userId,
        opening_cash: record.openingCash,
        opening_cash_denominations: record.openingCashDenominations ?? null,
        opening_inventory_snapshot: record.openingInventorySnapshot,
        status: 'open',
        opened_at: record.openedAt
      },
      idempotency_key: `desktop-shift-open:${record.id}`,
      created_at: now
    });

    return record;
  }

  async closeShift(appState: DesktopAppState, input: DesktopCloseShiftInput): Promise<DesktopShiftRecord> {
    const shifts = await this.listShifts();
    const current = shifts.find((row) => row.id === input.shiftId);
    if (!current) {
      throw new Error('This shift could not be found anymore.');
    }
    if (current.status !== 'OPEN') {
      throw new Error('This shift is already closed.');
    }
    const identity = resolveSessionIdentity(appState);
    if (identity.userId !== current.userId) {
      throw new Error(`Only ${current.cashierName} can close this shift. Sign in with the opening cashier account.`);
    }
    const closingCash = Number(input.closingCash);
    const cashVariance = Number(input.cashVariance);
    if (!Number.isFinite(closingCash) || closingCash < 0) {
      throw new Error('Counted cash must be zero or greater.');
    }
    const closingCashDenominations = normalizeCashDenominations(input.closingCashDenominations, 'Closing');
    if (closingCashDenominations.length > 0) {
      const totalFromDenominations = Number(
        closingCashDenominations.reduce((sum, row) => sum + row.total, 0).toFixed(2)
      );
      if (Math.abs(totalFromDenominations - closingCash) > 0.009) {
        throw new Error('Counted cash total does not match the closing denomination count.');
      }
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('shift_close');

    const closingInventorySnapshot =
      input.closingInventorySnapshot ??
      (await this.ports.inventory.captureSnapshot({
        locationId: current.locationId,
        locationLabel: current.locationLabel
      }));
    const now = new Date().toISOString();
    const next: DesktopShiftRecord = {
      ...current,
      closingCash,
      closingCashDenominations: closingCashDenominations.length ? closingCashDenominations : undefined,
      cashVariance: Number.isFinite(cashVariance) ? cashVariance : 0,
      closingInventorySnapshot,
      status: 'CLOSED',
      syncStatus: 'pending',
      lastError: null,
      closedAt: now,
      updatedAt: now
    };

    await this.ports.repository.upsertMasterDataRows([
      {
        entity: SHIFT_ENTITY,
        recordId: next.id,
        payload: JSON.stringify(next),
        updatedAt: next.updatedAt
      }
    ]);

    await this.ports.repository.enqueueOutboxItem({
      id: createId('outbox-shift-close'),
      entity: 'shift',
      action: 'close',
      payload: {
        id: next.id,
        closing_cash: next.closingCash,
        closing_cash_denominations: next.closingCashDenominations ?? null,
        cash_variance: next.cashVariance,
        closing_inventory_snapshot: next.closingInventorySnapshot,
        status: 'closed',
        closed_at: next.closedAt
      },
      idempotency_key: `desktop-shift-close:${next.id}:${now}`,
      created_at: now
    });

    return next;
  }

  async createShiftCashEntry(input: DesktopShiftCashInput): Promise<DesktopShiftCashEntry> {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Cash adjustment amount must be greater than zero.');
    }
    const shifts = await this.listShifts();
    const shift = shifts.find((row) => row.id === input.shiftId);
    if (!shift || shift.status !== 'OPEN') {
      throw new Error('Open a shift first before adding cash adjustments.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('shift_cash_entry');

    const now = new Date().toISOString();
    const record: DesktopShiftCashEntry = {
      id: createId('desk-shift-cash'),
      shiftId: input.shiftId,
      direction: input.direction,
      amount,
      notes: input.notes?.trim() || null,
      syncStatus: 'pending',
      lastError: null,
      createdAt: now,
      updatedAt: now
    };

    await this.ports.repository.upsertMasterDataRows([
      {
        entity: SHIFT_CASH_ENTITY,
        recordId: record.id,
        payload: JSON.stringify(record),
        updatedAt: record.updatedAt
      }
    ]);

    await this.ports.repository.enqueueOutboxItem({
      id: `outbox-${record.id}`,
      entity: 'shift_cash_entry',
      action: 'create',
      payload: {
        id: record.id,
        shift_id: record.shiftId,
        direction: record.direction,
        amount: record.amount,
        notes: record.notes ?? null,
        created_at: record.createdAt
      },
      idempotency_key: `desktop-shift-cash:${record.id}`,
      created_at: now
    });

    return record;
  }

  async updateShiftSyncStatus(id: string, syncStatus: DesktopShiftRecord['syncStatus'], lastError?: string | null): Promise<void> {
    const shifts = await this.listShifts();
    const current = shifts.find((row) => row.id === id);
    if (!current) {
      return;
    }
    const next: DesktopShiftRecord = {
      ...current,
      syncStatus,
      lastError: lastError ?? null,
      updatedAt: new Date().toISOString()
    };
    await this.ports.repository.upsertMasterDataRows([
      {
        entity: SHIFT_ENTITY,
        recordId: next.id,
        payload: JSON.stringify(next),
        updatedAt: next.updatedAt
      }
    ]);
  }

  async updateShiftCashSyncStatus(id: string, syncStatus: DesktopShiftCashEntry['syncStatus'], lastError?: string | null): Promise<void> {
    const entries = await this.listShiftCashEntries();
    const current = entries.find((row) => row.id === id);
    if (!current) {
      return;
    }
    const next: DesktopShiftCashEntry = {
      ...current,
      syncStatus,
      lastError: lastError ?? null,
      updatedAt: new Date().toISOString()
    };
    await this.ports.repository.upsertMasterDataRows([
      {
        entity: SHIFT_CASH_ENTITY,
        recordId: next.id,
        payload: JSON.stringify(next),
        updatedAt: next.updatedAt
      }
    ]);
  }

  async findActiveShift(): Promise<DesktopShiftRecord | null> {
    const shifts = await this.listShifts();
    return shifts.find((row) => row.status === 'OPEN') ?? null;
  }
}
