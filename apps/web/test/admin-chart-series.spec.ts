import { buildDailyTotals } from '../src/lib/admin-chart-series';

describe('buildDailyTotals', () => {
  it('groups valid values by day, sorts them, and keeps the newest requested points', () => {
    const rows = [
      { createdAt: '2026-11-03T08:00:00.000Z', amount: 20 },
      { createdAt: '2026-11-01T09:00:00.000Z', amount: 10 },
      { createdAt: '2026-11-03T10:00:00.000Z', amount: 5 },
      { createdAt: 'not-a-date', amount: 100 },
      { createdAt: '2026-11-02T10:00:00.000Z', amount: Number.NaN }
    ];

    expect(
      buildDailyTotals(rows, {
        date: (row) => row.createdAt,
        value: (row) => row.amount,
        limit: 2
      })
    ).toEqual([
      { date: '2026-11-01', value: 10 },
      { date: '2026-11-03', value: 25 }
    ]);
  });

  it('returns an empty series for a non-positive limit', () => {
    expect(
      buildDailyTotals([{ date: '2026-11-01', value: 10 }], {
        date: (row) => row.date,
        value: (row) => row.value,
        limit: 0
      })
    ).toEqual([]);
  });
});
