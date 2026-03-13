import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { AppTheme } from '../theme';
import { useTutorialTarget } from '../tutorial/tutorial-provider';

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  pendingCount: number;
  serverOnline: boolean;
  selectedBranchName?: string | null;
  selectedLocationName?: string | null;
  lastMasterDataSyncAt?: string | null;
};

type Counters = {
  sales: number;
  transfers: number;
  pettyCash: number;
  deliveries: number;
};

function fmtDate(value: string | null | undefined): string {
  if (!value) {
    return 'N/A';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export function HomeScreen({
  db,
  theme,
  pendingCount,
  serverOnline,
  selectedBranchName,
  selectedLocationName,
  lastMasterDataSyncAt
}: Props): JSX.Element {
  const tutorialStatus = useTutorialTarget('home-status');
  const tutorialPending = useTutorialTarget('home-pending');
  const [counts, setCounts] = useState<Counters>({
    sales: 0,
    transfers: 0,
    pettyCash: 0,
    deliveries: 0
  });

  useEffect(() => {
    let mounted = true;
    const load = async (): Promise<void> => {
      const [sales, transfers, pettyCash, deliveries] = await Promise.all([
        db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM sales_local'),
        db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM transfers_local'),
        db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM petty_cash_local'),
        db.getFirstAsync<{ total: number }>('SELECT COUNT(*) AS total FROM delivery_orders_local')
      ]);
      if (!mounted) {
        return;
      }
      setCounts({
        sales: Number(sales?.total ?? 0),
        transfers: Number(transfers?.total ?? 0),
        pettyCash: Number(pettyCash?.total ?? 0),
        deliveries: Number(deliveries?.total ?? 0)
      });
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [db, pendingCount]);

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <Text style={[styles.title, { color: theme.heading }]}>Dashboard</Text>
      <Text style={[styles.sub, { color: theme.subtext }]}>
        {selectedBranchName ?? 'No branch'}{selectedLocationName ? ` / ${selectedLocationName}` : ''}
      </Text>

      <View style={styles.row}>
        <View ref={tutorialStatus.ref} onLayout={tutorialStatus.onLayout} style={{ flex: 1 }}>
          <View
            style={[
              styles.kpi,
              { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
              tutorialStatus.active ? styles.tutorialTargetFocus : null
            ]}
          >
            <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Status</Text>
            <Text style={[styles.kpiValue, { color: theme.heading }]}>{serverOnline ? 'Online' : 'Offline'}</Text>
          </View>
        </View>
        <View ref={tutorialPending.ref} onLayout={tutorialPending.onLayout} style={{ flex: 1 }}>
          <View
            style={[
              styles.kpi,
              { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
              tutorialPending.active ? styles.tutorialTargetFocus : null
            ]}
          >
            <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Pending Sync</Text>
            <Text style={[styles.kpiValue, { color: theme.heading }]}>{pendingCount}</Text>
          </View>
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.kpi, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Sales</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>{counts.sales}</Text>
        </View>
        <View style={[styles.kpi, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Transfers</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>{counts.transfers}</Text>
        </View>
      </View>

      <View style={styles.row}>
        <View style={[styles.kpi, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Petty Cash</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>{counts.pettyCash}</Text>
        </View>
        <View style={[styles.kpi, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Deliveries</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>{counts.deliveries}</Text>
        </View>
      </View>

      <Text style={[styles.foot, { color: theme.subtext }]}>
        Last branch data sync: {fmtDate(lastMasterDataSyncAt)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10
  },
  title: {
    fontSize: 19,
    fontWeight: '800'
  },
  sub: {
    fontSize: 12
  },
  row: {
    flexDirection: 'row',
    gap: 8
  },
  kpi: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 62,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4
  },
  kpiValue: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '800'
  },
  foot: {
    marginTop: 4,
    fontSize: 11
  },
  tutorialTargetFocus: {
    borderWidth: 2,
    borderColor: '#F59E0B',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6
  }
});
