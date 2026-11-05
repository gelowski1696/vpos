export type CsvColumn<Row extends Record<string, unknown> = Record<string, unknown>> = {
  key: keyof Row | string;
  label: string;
  value?: (row: Row) => unknown;
};

export function toggleRowSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function togglePageSelection(
  selected: ReadonlySet<string>,
  pageIds: string[],
  shouldSelect: boolean
): Set<string> {
  const next = new Set(selected);
  for (const id of pageIds) {
    if (shouldSelect) {
      next.add(id);
    } else {
      next.delete(id);
    }
  }
  return next;
}

export function reconcileSelection(
  selected: ReadonlySet<string>,
  availableIds: string[]
): Set<string> {
  const available = new Set(availableIds);
  return new Set([...selected].filter((id) => available.has(id)));
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^\s*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildCsv<Row extends Record<string, unknown>>(
  rows: Row[],
  columns: Array<CsvColumn<Row>>
): string {
  const header = columns.map((column) => csvCell(column.label)).join(',');
  const body = rows.map((row) =>
    columns
      .map((column) => csvCell(column.value ? column.value(row) : row[column.key]))
      .join(',')
  );
  return [header, ...body].join('\r\n');
}
