import { OutboxRepository } from '@vpos/offline-core';
import { OutboxItem, OutboxStatus } from '@vpos/shared-types';
import type { SQLiteDatabase } from 'expo-sqlite';

function parsePayload(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export class SQLiteOutboxRepository implements OutboxRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async enqueue(item: {
    id: string;
    entity: string;
    action: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.runAsync(
      `
      INSERT INTO outbox(id, entity, action, payload, idempotency_key, status, retry_count, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
      `,
      item.id,
      item.entity,
      item.action,
      JSON.stringify(item.payload),
      item.idempotencyKey,
      OutboxStatus.PENDING,
      now,
      now
    );
  }

  async listPending(): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<{
      id: string;
      entity: string;
      action: string;
      payload: string;
      idempotency_key: string;
      status: string;
      retry_count: number;
      last_error: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `
      SELECT id, entity, action, payload, idempotency_key, status, retry_count, last_error, created_at, updated_at
      FROM outbox
      WHERE status IN (?, ?)
      ORDER BY created_at ASC
      `,
      OutboxStatus.PENDING,
      OutboxStatus.FAILED
    );

    return rows.map((row) => ({
      id: row.id,
      entity: row.entity,
      action: row.action,
      payload: parsePayload(row.payload),
      idempotency_key: row.idempotency_key,
      status: row.status as OutboxStatus,
      retry_count: row.retry_count,
      last_error: row.last_error,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  async markStatus(id: string, status: OutboxStatus, lastError?: string | null): Promise<void> {
    await this.db.runAsync(
      'UPDATE outbox SET status = ?, last_error = ?, updated_at = ? WHERE id = ?',
      status,
      lastError ?? null,
      new Date().toISOString(),
      id
    );
  }

  async incrementRetry(id: string, error: string): Promise<void> {
    await this.db.runAsync(
      `
      UPDATE outbox
      SET retry_count = retry_count + 1, status = ?, last_error = ?, updated_at = ?
      WHERE id = ?
      `,
      OutboxStatus.FAILED,
      error,
      new Date().toISOString(),
      id
    );
  }
}
