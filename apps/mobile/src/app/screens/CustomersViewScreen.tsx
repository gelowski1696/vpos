import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { AppTheme } from '../theme';
import { loadCustomerOptions, type MasterDataOption } from '../master-data-local';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { useTutorialTarget } from '../tutorial/tutorial-provider';

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  preferredBranchId?: string;
  onDataChanged?: () => Promise<void> | void;
  syncBusy?: boolean;
};

export function CustomersViewScreen({
  db,
  theme,
  syncBusy = false
}: Props): JSX.Element {
  const tutorialSearch = useTutorialTarget('customers-search');
  const tutorialFirstCard = useTutorialTarget('customers-first-card');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<MasterDataOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<MasterDataOption | null>(null);
  const [transactions, setTransactions] = useState<CustomerTransaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const prevSyncBusyRef = useRef(syncBusy);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const customers = await loadCustomerOptions(db);
      setRows(customers);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [db]);

  useEffect(() => {
    if (prevSyncBusyRef.current && !syncBusy) {
      void refresh();
      if (selectedCustomer) {
        void openTransactions(selectedCustomer);
      }
    }
    prevSyncBusyRef.current = syncBusy;
  }, [syncBusy, selectedCustomer]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return rows;
    }
    return rows.filter((row) =>
      `${row.label} ${row.subtitle ?? ''} ${row.id}`.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const summary = useMemo(() => {
    const withBalance = rows.filter((row) => Number(row.balance ?? 0) > 0).length;
    const totalOutstanding = rows.reduce((sum, row) => sum + Number(row.balance ?? 0), 0);
    return {
      totalCustomers: rows.length,
      withBalance,
      totalOutstanding: Number(totalOutstanding.toFixed(2))
    };
  }, [rows]);

  const selectedCustomerCode = useMemo(() => {
    if (!selectedCustomer?.subtitle) {
      return null;
    }
    const [code] = selectedCustomer.subtitle.split(' - ');
    return code || null;
  }, [selectedCustomer]);

  const transactionSummary = useMemo(() => {
    let saleCount = 0;
    let paymentCount = 0;
    let saleTotal = 0;
    let paymentTotal = 0;
    for (const item of transactions) {
      if (item.type === 'SALE') {
        saleCount += 1;
        saleTotal += item.amount;
      } else {
        paymentCount += 1;
        paymentTotal += item.amount;
      }
    }
    return {
      saleCount,
      paymentCount,
      saleTotal: Number(saleTotal.toFixed(2)),
      paymentTotal: Number(paymentTotal.toFixed(2))
    };
  }, [transactions]);

  const closeTransactions = (): void => {
    setSelectedCustomer(null);
    setTransactions([]);
    setTransactionsLoading(false);
  };

  const openTransactions = async (customer: MasterDataOption): Promise<void> => {
    setSelectedCustomer(customer);
    setTransactions([]);
    setTransactionsLoading(true);
    try {
      const result = await loadCustomerTransactions(db, customer.id);
      setTransactions(result);
    } finally {
      setTransactionsLoading(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <Text style={[styles.title, { color: theme.heading }]}>Customers</Text>
      <Text style={[styles.sub, { color: theme.subtext }]}>
        View customer balances and tap a customer to see transaction history.
      </Text>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Customers</Text>
          <Text style={[styles.summaryValue, { color: theme.heading }]}>{summary.totalCustomers}</Text>
        </View>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>With Balance</Text>
          <Text style={[styles.summaryValue, { color: theme.heading }]}>{summary.withBalance}</Text>
        </View>
        <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Outstanding</Text>
          <Text style={[styles.summaryValue, { color: theme.heading }]}>{fmtMoney(summary.totalOutstanding)}</Text>
        </View>
      </View>

      <View style={styles.row}>
        <View ref={tutorialSearch.ref} onLayout={tutorialSearch.onLayout} style={{ flex: 1 }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search customer code, tier, or name..."
            placeholderTextColor={theme.inputPlaceholder}
            style={[
              styles.input,
              { backgroundColor: theme.inputBg, color: theme.inputText },
              tutorialSearch.active ? styles.tutorialTargetFocus : null
            ]}
          />
        </View>
        <Pressable
          style={[styles.refreshBtn, { backgroundColor: loading || syncBusy ? theme.primaryMuted : theme.primary }]}
          onPress={() => void refresh()}
          disabled={loading || syncBusy}
        >
          <Text style={styles.refreshText}>{loading ? '...' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator>
        {loading ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>Loading customers...</Text>
        ) : filtered.length === 0 ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>No customers found.</Text>
        ) : (
          filtered.map((row, index) => (
            <Pressable
              key={row.id}
              style={[
                styles.itemCard,
                { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
                tutorialFirstCard.active && index === 0 ? styles.tutorialTargetFocus : null
              ]}
              onPress={() => void openTransactions(row)}
              ref={index === 0 ? tutorialFirstCard.ref : undefined}
              onLayout={index === 0 ? tutorialFirstCard.onLayout : undefined}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: theme.heading }]}>{row.label}</Text>
                <Text style={[styles.itemMeta, { color: theme.subtext }]}>{row.subtitle ?? row.id}</Text>
              </View>
              <View style={styles.itemActions}>
                <Text style={[styles.balanceValue, { color: theme.heading }]}>
                  {fmtMoney(Number(row.balance ?? 0))}
                </Text>
                <Text style={[styles.viewHint, { color: theme.primary }]}>View Transactions</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <Modal visible={Boolean(selectedCustomer)} transparent animationType="slide" onRequestClose={closeTransactions}>
        {selectedCustomer ? (
          <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={closeTransactions} />
            <View style={[styles.modalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
              <View style={styles.modalHead}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalTitle, { color: theme.heading }]}>{selectedCustomer.label}</Text>
                  <Text style={[styles.modalSub, { color: theme.subtext }]}>
                    {selectedCustomerCode ?? selectedCustomer.id}
                  </Text>
                </View>
                <Pressable
                  style={[styles.closeBtn, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                  onPress={closeTransactions}
                >
                  <Text style={[styles.closeText, { color: theme.pillText }]}>Close</Text>
                </Pressable>
              </View>

              <View style={styles.summaryRow}>
                <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Sales</Text>
                  <Text style={[styles.summaryValue, { color: theme.heading }]}>{transactionSummary.saleCount}</Text>
                </View>
                <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Payments</Text>
                  <Text style={[styles.summaryValue, { color: theme.heading }]}>{transactionSummary.paymentCount}</Text>
                </View>
                <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Balance</Text>
                  <Text style={[styles.summaryValue, { color: theme.heading }]}>
                    {fmtMoney(Number(selectedCustomer.balance ?? 0))}
                  </Text>
                </View>
              </View>

              <ScrollView
                style={styles.modalList}
                contentContainerStyle={styles.modalListContent}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {transactionsLoading ? (
                  <Text style={[styles.sub, { color: theme.subtext }]}>Loading transactions...</Text>
                ) : transactions.length === 0 ? (
                  <Text style={[styles.sub, { color: theme.subtext }]}>No local transactions found for this customer.</Text>
                ) : (
                  transactions.map((item) => (
                    <View
                      key={item.id}
                      style={[styles.transactionCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={styles.transactionTop}>
                          <Text style={[styles.transactionType, { color: item.type === 'SALE' ? theme.primary : theme.pillText }]}>
                            {item.type}
                          </Text>
                          <Text style={[styles.transactionDate, { color: theme.subtext }]}>{fmtDate(item.createdAt)}</Text>
                        </View>
                        <Text style={[styles.transactionTitle, { color: theme.heading }]}>{item.title}</Text>
                        <Text style={[styles.itemMeta, { color: theme.subtext }]}>{item.subtitle}</Text>
                      </View>
                      <View style={styles.transactionRight}>
                        <Text style={[styles.transactionAmount, { color: theme.heading }]}>{fmtMoney(item.amount)}</Text>
                        <SyncStatusBadge status={item.syncStatus} />
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

type LocalSaleRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
};

type LocalPaymentRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
};

type SalePayload = {
  id?: string;
  sale_type?: string;
  customer_id?: string;
  lines?: Array<{
    quantity?: number;
    unitPrice?: number;
    unit_price?: number;
  }>;
  discount_amount?: number;
  created_at?: string;
};

type CustomerPaymentPayload = {
  id?: string;
  sale_id?: string;
  customer_id?: string;
  method?: string;
  amount?: number;
  reference_no?: string | null;
  created_at?: string;
};

type CustomerTransaction = {
  id: string;
  type: 'SALE' | 'PAYMENT';
  amount: number;
  createdAt: string;
  syncStatus: string;
  title: string;
  subtitle: string;
};

function parsePayload<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return {} as T;
  }
}

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmtMoney(value: number): string {
  return `PHP ${value.toFixed(2)}`;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

async function loadCustomerTransactions(
  db: SQLiteDatabase,
  customerId: string
): Promise<CustomerTransaction[]> {
  const customerNeedleCompact = `%"customer_id":"${customerId}"%`;
  const customerNeedleSpaced = `%"customer_id": "${customerId}"%`;

  const [sales, payments] = await Promise.all([
    db.getAllAsync<LocalSaleRow>(
      `
      SELECT id, payload, sync_status, created_at
      FROM sales_local
      WHERE payload LIKE ? OR payload LIKE ?
      ORDER BY created_at DESC
      LIMIT 300
      `,
      customerNeedleCompact,
      customerNeedleSpaced
    ),
    db.getAllAsync<LocalPaymentRow>(
      `
      SELECT id, payload, sync_status, created_at
      FROM customer_payments_local
      WHERE payload LIKE ? OR payload LIKE ?
      ORDER BY created_at DESC
      LIMIT 300
      `,
      customerNeedleCompact,
      customerNeedleSpaced
    )
  ]);

  const txns: CustomerTransaction[] = [];

  for (const row of sales) {
    const payload = parsePayload<SalePayload>(row.payload);
    const subtotal = (payload.lines ?? []).reduce((sum, line) => {
      const qty = toAmount(line.quantity);
      const unitPrice = toAmount(line.unitPrice ?? line.unit_price);
      return sum + qty * unitPrice;
    }, 0);
    const discount = toAmount(payload.discount_amount);
    const total = Number(Math.max(0, subtotal - discount).toFixed(2));
    txns.push({
      id: `sale-${row.id}`,
      type: 'SALE',
      amount: total,
      createdAt: payload.created_at ?? row.created_at,
      syncStatus: row.sync_status,
      title: `Sale ${payload.id ?? row.id}`,
      subtitle: `${String(payload.sale_type ?? 'PICKUP').toUpperCase()} - ${fmtMoney(total)}`
    });
  }

  for (const row of payments) {
    const payload = parsePayload<CustomerPaymentPayload>(row.payload);
    txns.push({
      id: `payment-${row.id}`,
      type: 'PAYMENT',
      amount: Number(Math.max(0, toAmount(payload.amount)).toFixed(2)),
      createdAt: payload.created_at ?? row.created_at,
      syncStatus: row.sync_status,
      title: `Payment ${payload.id ?? row.id}`,
      subtitle: `${String(payload.method ?? 'CASH').toUpperCase()} - ${payload.sale_id ? `Sale ${payload.sale_id}` : 'Unlinked'}${payload.reference_no ? ` - Ref ${payload.reference_no}` : ''}`
    });
  }

  return txns.sort((a, b) => {
    const aTs = new Date(a.createdAt).getTime();
    const bTs = new Date(b.createdAt).getTime();
    return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
  });
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
    fontSize: 18,
    fontWeight: '700'
  },
  sub: {
    fontSize: 12
  },
  subStrong: {
    fontSize: 12,
    fontWeight: '700'
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 58,
    paddingHorizontal: 8,
    paddingVertical: 8
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4
  },
  summaryValue: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '800'
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center'
  },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 13
  },
  refreshBtn: {
    minWidth: 86,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  refreshText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800'
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '700'
  },
  infoValue: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700'
  },
  list: {
    maxHeight: 420
  },
  listContent: {
    gap: 8
  },
  itemCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  itemName: {
    fontSize: 13,
    fontWeight: '700'
  },
  itemMeta: {
    marginTop: 2,
    fontSize: 11
  },
  itemActions: {
    minWidth: 120,
    alignItems: 'flex-end',
    gap: 3
  },
  balanceValue: {
    fontSize: 12,
    fontWeight: '800'
  },
  viewHint: {
    fontSize: 10,
    fontWeight: '700'
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 8, 23, 0.55)'
  },
  modalCard: {
    height: '75%',
    maxHeight: '88%',
    minHeight: '75%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800'
  },
  modalSub: {
    marginTop: 2,
    fontSize: 12
  },
  closeBtn: {
    minHeight: 34,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  closeText: {
    fontSize: 12,
    fontWeight: '700'
  },
  modalList: {
    flex: 1
  },
  modalListContent: {
    gap: 8,
    paddingBottom: 8
  },
  transactionCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  transactionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  transactionType: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3
  },
  transactionDate: {
    fontSize: 10,
    fontWeight: '600'
  },
  transactionTitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700'
  },
  transactionRight: {
    alignItems: 'flex-end',
    gap: 5
  },
  transactionAmount: {
    fontSize: 12,
    fontWeight: '800'
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
