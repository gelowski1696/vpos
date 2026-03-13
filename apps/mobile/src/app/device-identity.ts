import type { SQLiteDatabase } from "expo-sqlite";

function sanitizeDeviceId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function generateDeviceId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `vpos-${ts}-${rand}`;
}

export async function getOrCreateDeviceId(
  db: SQLiteDatabase,
  preferredId?: string | null,
): Promise<string> {
  const existing = await db.getFirstAsync<{ device_id: string }>(
    "SELECT device_id FROM device_identity WHERE id = 1",
  );
  const stored = sanitizeDeviceId(existing?.device_id);
  if (stored) {
    return stored;
  }

  const resolved = sanitizeDeviceId(preferredId) ?? generateDeviceId();
  await db.runAsync(
    `
    INSERT INTO device_identity(id, device_id, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      device_id = excluded.device_id,
      updated_at = excluded.updated_at
    `,
    resolved,
    new Date().toISOString(),
  );
  return resolved;
}
