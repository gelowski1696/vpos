export type DailyTotal = {
  date: string;
  value: number;
};

export function buildDailyTotals<Row>(
  rows: Row[],
  options: {
    date: (row: Row) => string | null | undefined;
    value: (row: Row) => number;
    limit: number;
  }
): DailyTotal[] {
  const limit = Math.floor(options.limit);
  if (limit <= 0) {
    return [];
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    const rawDate = options.date(row);
    const value = options.value(row);
    if (!rawDate || !Number.isFinite(value) || Number.isNaN(new Date(rawDate).getTime())) {
      continue;
    }
    const date = rawDate.slice(0, 10);
    totals.set(date, (totals.get(date) ?? 0) + value);
  }

  return Array.from(totals, ([date, value]) => ({ date, value }))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-limit);
}
