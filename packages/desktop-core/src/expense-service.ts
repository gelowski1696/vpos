import type { DesktopAppState, DesktopExpenseRecord, DesktopShiftRecord } from './schema';
import type { DesktopOperationalRepository, DesktopTransactionPolicyPort } from './operational-ports';

export interface DesktopExpenseShiftPort {
  listShifts(): Promise<DesktopShiftRecord[]>;
}

export type DesktopExpensePorts = {
  repository: DesktopOperationalRepository;
  shift: DesktopExpenseShiftPort;
  subscriptionPolicy: DesktopTransactionPolicyPort;
};

export type CreateDesktopExpenseInput = {
  shiftId: string;
  categoryCode: string;
  categoryLabel?: string | null;
  direction: 'IN' | 'OUT';
  amount: number;
  notes?: string | null;
  attachments?: Array<{
    id?: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    previewDataUrl?: string | null;
    uploadedUrl?: string | null;
    sourceChannel?: string | null;
    createdAt?: string;
  }>;
};

export type DesktopPettyCashSummary = {
  totalIn: number;
  totalOut: number;
  net: number;
  entries: DesktopExpenseRecord[];
};

export function summarizeDesktopPettyCash(
  records: DesktopExpenseRecord[],
  filters: { shiftId?: string | null; since?: string | null; until?: string | null } = {}
): DesktopPettyCashSummary {
  const sinceMs = filters.since ? new Date(filters.since).getTime() : Number.NEGATIVE_INFINITY;
  const untilMs = filters.until ? new Date(filters.until).getTime() : Number.POSITIVE_INFINITY;
  const entries = records
    .filter((record) => !filters.shiftId || record.shiftId === filters.shiftId)
    .filter((record) => {
      const createdMs = new Date(record.createdAt).getTime();
      return Number.isFinite(createdMs) && createdMs >= sinceMs && createdMs <= untilMs;
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const totalIn = entries
    .filter((record) => record.direction === 'IN')
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const totalOut = entries
    .filter((record) => record.direction === 'OUT')
    .reduce((sum, record) => sum + Number(record.amount || 0), 0);
  return {
    totalIn: Number(totalIn.toFixed(2)),
    totalOut: Number(totalOut.toFixed(2)),
    net: Number((totalIn - totalOut).toFixed(2)),
    entries
  };
}

const ALLOWED_PETTY_CASH_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp'
]);

function parsePayload<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function stripDataUrlPrefix(value: string): string {
  const marker = ';base64,';
  const index = value.toLowerCase().indexOf(marker);
  if (index < 0) {
    return value;
  }
  return value.slice(index + marker.length);
}

export class DesktopExpenseService {
  constructor(private readonly ports: DesktopExpensePorts) {}

  async listExpenses(): Promise<DesktopExpenseRecord[]> {
    const rows = await this.ports.repository.listMasterData('desktop_expense');
    return rows
      .map((row) => parsePayload<DesktopExpenseRecord>(row.payload))
      .filter((row): row is DesktopExpenseRecord => Boolean(row))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createExpense(
    appState: DesktopAppState,
    input: CreateDesktopExpenseInput
  ): Promise<DesktopExpenseRecord> {
    const shiftId = input.shiftId.trim();
    const categoryCode = input.categoryCode.trim();
    const amount = Number(input.amount);
    if (!shiftId) {
      throw new Error('Start duty first before recording petty cash.');
    }
    if (!categoryCode) {
      throw new Error('Expense category is required.');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Amount must be greater than zero.');
    }
    if (!input.notes?.trim()) {
      throw new Error('Description is required.');
    }
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('petty_cash');

    const shifts = await this.ports.shift.listShifts();
    const shift = shifts.find((row) => row.id === shiftId);
    if (!shift || shift.status !== 'OPEN') {
      throw new Error('Petty cash requires an open shift.');
    }

    const id = `desktop-expense-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const now = new Date().toISOString();
    const attachments = (input.attachments ?? [])
      .map((attachment) => ({
        id: attachment.id?.trim() || `desktop-expense-attachment-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
        fileName: attachment.fileName.trim(),
        mimeType: attachment.mimeType.trim().toLowerCase(),
        sizeBytes: Math.trunc(Number(attachment.sizeBytes)),
        previewDataUrl: attachment.previewDataUrl?.trim() || null,
        uploadedUrl: attachment.uploadedUrl?.trim() || null,
        sourceChannel: attachment.sourceChannel?.trim() || 'desktop',
        createdAt: attachment.createdAt ?? now
      }))
      .filter((attachment) => attachment.fileName && Number.isFinite(attachment.sizeBytes) && attachment.sizeBytes > 0);
    if (attachments.length > 3) {
      throw new Error('Petty cash allows up to 3 attachments only.');
    }
    for (const attachment of attachments) {
      if (!ALLOWED_PETTY_CASH_ATTACHMENT_MIME_TYPES.has(attachment.mimeType)) {
        throw new Error('Petty cash attachments must be jpg/jpeg/png/webp image files.');
      }
      if (attachment.sizeBytes > 5 * 1024 * 1024) {
        throw new Error('Petty cash attachment cannot exceed 5 MB.');
      }
      if (!attachment.previewDataUrl && !attachment.uploadedUrl) {
        throw new Error('Petty cash attachment is missing upload data.');
      }
    }
    const record: DesktopExpenseRecord = {
      id,
      shiftId,
      categoryCode,
      categoryLabel: input.categoryLabel?.trim() || null,
      direction: input.direction,
      amount: Number(amount.toFixed(2)),
      notes: input.notes?.trim() || null,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        previewDataUrl: attachment.previewDataUrl,
        uploadedUrl: attachment.uploadedUrl,
        createdAt: attachment.createdAt
      })),
      syncStatus: 'pending',
      lastError: null,
      createdAt: now,
      updatedAt: now
    };

    await this.ports.repository.upsertMasterDataRows([
      {
        entity: 'desktop_expense',
        recordId: id,
        payload: JSON.stringify(record),
        updatedAt: now
      }
    ]);

    await this.ports.repository.enqueueOutboxItem({
      id: `outbox-petty-cash-${id}`,
      entity: 'petty_cash',
      action: 'create',
      payload: {
        id,
        shift_id: shiftId,
        category_code: categoryCode,
        direction: input.direction,
        amount: Number(amount.toFixed(2)),
        notes: input.notes?.trim() || null,
        attachments: attachments.map((attachment) => ({
          id: attachment.id,
          file_name: attachment.fileName,
          mime_type: attachment.mimeType,
          size_bytes: attachment.sizeBytes,
          data_base64: attachment.previewDataUrl ? stripDataUrlPrefix(attachment.previewDataUrl) : null,
          uploaded_url: attachment.uploadedUrl,
          source_channel: attachment.sourceChannel,
          created_at: attachment.createdAt
        })),
        created_at: now
      },
      idempotency_key: `idem-petty-cash-${id}`,
      created_at: now
    });

    return record;
  }

  async updateExpenseSyncStatus(
    expenseId: string,
    syncStatus: DesktopExpenseRecord['syncStatus'],
    lastError?: string | null
  ): Promise<void> {
    const rows = await this.listExpenses();
    const record = rows.find((row) => row.id === expenseId);
    if (!record) {
      return;
    }
    const next: DesktopExpenseRecord = {
      ...record,
      syncStatus,
      lastError: lastError ?? null,
      updatedAt: new Date().toISOString()
    };
    await this.ports.repository.upsertMasterDataRows([
      {
        entity: 'desktop_expense',
        recordId: expenseId,
        payload: JSON.stringify(next),
        updatedAt: next.updatedAt
      }
    ]);
  }
}
