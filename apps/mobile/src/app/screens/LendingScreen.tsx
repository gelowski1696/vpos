import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { LocalSessionService } from '../../features/auth/local-session.service';
import { HttpAuthTransport } from '../../features/auth/http-auth.transport';
import { normalizeApiBaseUrl } from '../api-base-url';
import { toastError, toastInfo, toastSuccess } from '../goey-toast';
import type { AppTheme } from '../theme';

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  preferredBranchId?: string;
  onDataChanged?: () => Promise<void> | void;
  syncBusy?: boolean;
};

type LendingStatus =
  | 'OPEN'
  | 'PARTIALLY_RETURNED'
  | 'CLOSED'
  | 'OVERDUE'
  | 'CANCELLED'
  | 'FORCE_CLOSED';
type LendingReturnCondition = 'GOOD' | 'DAMAGED' | 'LOST';

type LendingRecord = {
  lending_id: string;
  branch_id: string;
  branch_name: string | null;
  location_id: string;
  location_name: string | null;
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  sale_id: string;
  status: LendingStatus;
  due_at: string | null;
  remarks: string | null;
  opened_at: string;
  line_count: number;
  total_quantity_lent: number;
  total_quantity_returned: number;
};

type LendingLineRecord = {
  lending_line_id: string;
  product_id: string;
  product_sku: string | null;
  product_name: string | null;
  quantity_lent: number;
  quantity_returned: number;
  quantity_open: number;
  deposit_amount: number | null;
  remarks: string | null;
};

type LendingReturnRecord = {
  lending_return_id: string;
  lending_line_id: string;
  returned_qty: number;
  condition: LendingReturnCondition;
  remarks: string | null;
  received_by_name: string | null;
  returned_at: string;
};

type LendingDetailRecord = LendingRecord & {
  lines: LendingLineRecord[];
  returns: LendingReturnRecord[];
};

const env = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env;
const API_BASE_URL = normalizeApiBaseUrl(
  env?.EXPO_PUBLIC_API_BASE_URL ?? 'https://vmjamtech.com/api'
);

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

function fmtMoney(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) {
    return '-';
  }
  return `PHP ${Number(value).toFixed(2)}`;
}

function fmtQty(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) {
    return '0';
  }
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function LendingScreen({
  db,
  theme,
  preferredBranchId,
  onDataChanged,
  syncBusy = false
}: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | LendingStatus>('ALL');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LendingRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<LendingDetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnSaving, setReturnSaving] = useState(false);
  const [returnQtyByLine, setReturnQtyByLine] = useState<Record<string, string>>({});
  const [returnConditionByLine, setReturnConditionByLine] = useState<
    Record<string, LendingReturnCondition>
  >({});
  const [returnRemarks, setReturnRemarks] = useState('');

  const apiRequest = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const session = new LocalSessionService(db);
      await session.initializeFromStorage();
      const transport = new HttpAuthTransport({ baseUrl: API_BASE_URL });
      const send = async (token?: string): Promise<Response> => {
        const clientId = await session.getClientId();
        const headers = new Headers(init?.headers ?? {});
        headers.set('content-type', 'application/json');
        if (token) {
          headers.set('authorization', `Bearer ${token}`);
        }
        if (clientId?.trim()) {
          headers.set('x-client-id', clientId.trim());
        }
        return fetch(`${API_BASE_URL}${path}`, {
          ...init,
          headers
        });
      };

      let token = await session.getAccessToken();
      let response = await send(token);
      if (response.status === 401) {
        const refreshed = await session.refreshSession(transport);
        if (refreshed) {
          token = await session.getAccessToken();
          response = await send(token);
        }
      }
      if (!response.ok) {
        let message = `Request failed (${response.status})`;
        try {
          const payload = (await response.json()) as { message?: string | string[]; error?: string };
          if (Array.isArray(payload.message)) {
            message = payload.message.join(', ');
          } else if (typeof payload.message === 'string') {
            message = payload.message;
          } else if (typeof payload.error === 'string') {
            message = payload.error;
          }
        } catch {
          // ignore parse failure
        }
        throw new Error(message);
      }
      return (await response.json()) as T;
    },
    [db]
  );

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (preferredBranchId?.trim()) {
        params.set('branch_id', preferredBranchId.trim());
      }
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }
      params.set('limit', '120');
      const data = await apiRequest<LendingRecord[]>(`/lending?${params.toString()}`);
      setRows(data);
    } catch (cause) {
      toastError('Lending', cause instanceof Error ? cause.message : 'Unable to load lending records.');
    } finally {
      setLoading(false);
    }
  }, [apiRequest, preferredBranchId, statusFilter]);

  const openDetail = useCallback(
    async (lendingId: string): Promise<void> => {
      setSelectedId(lendingId);
      setDetailLoading(true);
      try {
        const detail = await apiRequest<LendingDetailRecord>(
          `/lending/${encodeURIComponent(lendingId)}`
        );
        setSelectedDetail(detail);
      } catch (cause) {
        toastError('Lending', cause instanceof Error ? cause.message : 'Unable to load lending detail.');
      } finally {
        setDetailLoading(false);
      }
    },
    [apiRequest]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return rows;
    }
    return rows.filter((row) =>
      `${row.lending_id} ${row.sale_id} ${row.customer_name ?? ''} ${row.customer_code ?? ''} ${row.branch_name ?? ''} ${row.location_name ?? ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [query, rows]);

  const canReturn =
    selectedDetail &&
    selectedDetail.status !== 'CLOSED' &&
    selectedDetail.status !== 'CANCELLED' &&
    selectedDetail.status !== 'FORCE_CLOSED' &&
    selectedDetail.lines.some((line) => line.quantity_open > 0);

  const openReturnModal = (): void => {
    if (!selectedDetail || !canReturn) {
      return;
    }
    setReturnQtyByLine(
      Object.fromEntries(selectedDetail.lines.map((line) => [line.lending_line_id, '']))
    );
    setReturnConditionByLine(
      Object.fromEntries(selectedDetail.lines.map((line) => [line.lending_line_id, 'GOOD']))
    );
    setReturnRemarks('');
    setReturnModalOpen(true);
  };

  const saveReturn = async (): Promise<void> => {
    if (!selectedDetail || returnSaving) {
      return;
    }
    const lines = selectedDetail.lines
      .map((line) => ({
        line,
        qty: Number(returnQtyByLine[line.lending_line_id] || '0'),
        condition: returnConditionByLine[line.lending_line_id] ?? 'GOOD'
      }))
      .filter((entry) => Number.isFinite(entry.qty) && entry.qty > 0);

    if (lines.length === 0) {
      toastInfo('Return', 'Enter quantity for at least one open lending line.');
      return;
    }
    for (const entry of lines) {
      if (entry.qty > entry.line.quantity_open) {
        toastError(
          'Return',
          `${entry.line.product_name ?? entry.line.product_id} only has ${fmtQty(entry.line.quantity_open)} open.`
        );
        return;
      }
    }

    setReturnSaving(true);
    try {
      const detail = await apiRequest<LendingDetailRecord>(
        `/lending/${encodeURIComponent(selectedDetail.lending_id)}/return`,
        {
          method: 'POST',
          body: JSON.stringify({
            remarks: returnRemarks.trim() || null,
            lines: lines.map((entry) => ({
              lending_line_id: entry.line.lending_line_id,
              returned_qty: entry.qty,
              condition: entry.condition
            }))
          })
        }
      );
      setSelectedDetail(detail);
      setReturnModalOpen(false);
      toastSuccess('Return saved', `Updated lending ${detail.lending_id}.`);
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      toastError('Return failed', cause instanceof Error ? cause.message : 'Unable to save return.');
    } finally {
      setReturnSaving(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <Text style={[styles.title, { color: theme.heading }]}>Lending</Text>
      <Text style={[styles.sub, { color: theme.subtext }]}>
        Track open lendings, view details, and record returned tanks or accessories.
      </Text>

      <View style={styles.topRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by customer, sale, or lending ID..."
          placeholderTextColor={theme.inputPlaceholder}
          style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
        />
        <Pressable
          style={[styles.refreshBtn, { backgroundColor: loading || syncBusy ? theme.primaryMuted : theme.primary }]}
          onPress={() => void refresh()}
          disabled={loading || syncBusy}
        >
          <Text style={styles.refreshText}>{loading ? '...' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {(['ALL', 'OPEN', 'PARTIALLY_RETURNED', 'OVERDUE', 'CLOSED'] as const).map((value) => {
          const active = statusFilter === value;
          return (
            <Pressable
              key={value}
              style={[
                styles.filterPill,
                { backgroundColor: active ? theme.primary : theme.pillBg, borderColor: theme.cardBorder }
              ]}
              onPress={() => setStatusFilter(value)}
            >
              <Text style={{ color: active ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: 10 }}>
                {value === 'PARTIALLY_RETURNED' ? 'PARTIAL' : value}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator>
        {filteredRows.length === 0 ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>
            {loading ? 'Loading lending records...' : 'No lending records found.'}
          </Text>
        ) : (
          filteredRows.map((row) => {
            const openQty = Math.max(0, row.total_quantity_lent - row.total_quantity_returned);
            const statusTone =
              row.status === 'OVERDUE'
                ? '#B45309'
                : row.status === 'CLOSED'
                  ? '#166534'
                  : row.status === 'CANCELLED' || row.status === 'FORCE_CLOSED'
                    ? '#991B1B'
                    : theme.primary;
            return (
              <Pressable
                key={row.lending_id}
                style={[styles.itemCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                onPress={() => void openDetail(row.lending_id)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemName, { color: theme.heading }]}>
                    {row.customer_name ?? row.customer_code ?? row.customer_id}
                  </Text>
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                    Lending {row.lending_id} | Sale {row.sale_id}
                  </Text>
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                    {row.branch_name ?? row.branch_id} / {row.location_name ?? row.location_id}
                  </Text>
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                    Open {fmtQty(openQty)} of {fmtQty(row.total_quantity_lent)} | {fmtDate(row.opened_at)}
                  </Text>
                </View>
                <View style={styles.itemActions}>
                  <View style={[styles.statusPill, { backgroundColor: `${statusTone}20` }]}>
                    <Text style={[styles.statusText, { color: statusTone }]}>{row.status}</Text>
                  </View>
                  <Text style={[styles.viewHint, { color: theme.primary }]}>View Detail</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Modal visible={Boolean(selectedId)} transparent animationType="slide" onRequestClose={() => setSelectedId(null)}>
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              setSelectedId(null);
              setSelectedDetail(null);
            }}
          />
          <View style={[styles.modalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            {detailLoading || !selectedDetail ? (
              <Text style={[styles.sub, { color: theme.subtext }]}>Loading lending detail...</Text>
            ) : (
              <>
                <View style={styles.modalHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modalTitle, { color: theme.heading }]}>Lending Detail</Text>
                    <Text style={[styles.modalSub, { color: theme.subtext }]}>
                      {selectedDetail.lending_id} | Sale {selectedDetail.sale_id}
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.closeBtn, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                    onPress={() => {
                      setSelectedId(null);
                      setSelectedDetail(null);
                    }}
                  >
                    <Text style={[styles.closeText, { color: theme.pillText }]}>Close</Text>
                  </Pressable>
                </View>

                <View style={styles.summaryRow}>
                  <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Customer</Text>
                    <Text style={[styles.summaryValue, { color: theme.heading }]}>
                      {selectedDetail.customer_name ?? selectedDetail.customer_code ?? selectedDetail.customer_id}
                    </Text>
                  </View>
                  <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Status</Text>
                    <Text style={[styles.summaryValue, { color: theme.heading }]}>{selectedDetail.status}</Text>
                  </View>
                  <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Due</Text>
                    <Text style={[styles.summaryValue, { color: theme.heading }]}>{fmtDate(selectedDetail.due_at)}</Text>
                  </View>
                  <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Opened</Text>
                    <Text style={[styles.summaryValue, { color: theme.heading }]}>{fmtDate(selectedDetail.opened_at)}</Text>
                  </View>
                </View>

                <ScrollView style={styles.modalList} contentContainerStyle={styles.modalListContent} showsVerticalScrollIndicator nestedScrollEnabled>
                  <Text style={[styles.sectionTitle, { color: theme.heading }]}>Lines</Text>
                  {selectedDetail.lines.map((line) => (
                    <View
                      key={line.lending_line_id}
                      style={[styles.detailCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                    >
                      <Text style={[styles.itemName, { color: theme.heading }]}>
                        {line.product_name ?? line.product_id}
                      </Text>
                      <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                        {line.product_sku ?? line.product_id}
                      </Text>
                      <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                        Lent {fmtQty(line.quantity_lent)} | Returned {fmtQty(line.quantity_returned)} | Open {fmtQty(line.quantity_open)}
                      </Text>
                      {line.deposit_amount !== null ? (
                        <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                          Deposit {fmtMoney(line.deposit_amount)}
                        </Text>
                      ) : null}
                    </View>
                  ))}

                  <Text style={[styles.sectionTitle, { color: theme.heading }]}>Returns</Text>
                  {selectedDetail.returns.length === 0 ? (
                    <Text style={[styles.sub, { color: theme.subtext }]}>No returns recorded yet.</Text>
                  ) : (
                    selectedDetail.returns.map((entry) => (
                      <View
                        key={entry.lending_return_id}
                        style={[styles.detailCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                      >
                        <Text style={[styles.itemName, { color: theme.heading }]}>
                          Qty {fmtQty(entry.returned_qty)} | {entry.condition}
                        </Text>
                        <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                          {fmtDate(entry.returned_at)}
                        </Text>
                        {entry.received_by_name ? (
                          <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                            Received by {entry.received_by_name}
                          </Text>
                        ) : null}
                        {entry.remarks ? (
                          <Text style={[styles.itemMeta, { color: theme.subtext }]}>{entry.remarks}</Text>
                        ) : null}
                      </View>
                    ))
                  )}
                </ScrollView>

                <View style={styles.actionRow}>
                  <Pressable
                    style={[
                      styles.primaryBtn,
                      { backgroundColor: canReturn ? theme.primary : theme.primaryMuted }
                    ]}
                    disabled={!canReturn}
                    onPress={openReturnModal}
                  >
                    <Text style={styles.primaryBtnText}>Record Return</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={returnModalOpen} transparent animationType="fade" onRequestClose={() => setReturnModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setReturnModalOpen(false)} />
          <View style={[styles.returnModalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: theme.heading }]}>Record Return</Text>
                <Text style={[styles.modalSub, { color: theme.subtext }]}>
                  Enter returned quantity for the open lines below.
                </Text>
              </View>
              <Pressable
                style={[styles.closeBtn, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                onPress={() => setReturnModalOpen(false)}
                disabled={returnSaving}
              >
                <Text style={[styles.closeText, { color: theme.pillText }]}>Close</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.modalList} contentContainerStyle={styles.modalListContent} showsVerticalScrollIndicator nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {selectedDetail?.lines
                .filter((line) => line.quantity_open > 0)
                .map((line) => (
                  <View
                    key={line.lending_line_id}
                    style={[styles.detailCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
                  >
                    <Text style={[styles.itemName, { color: theme.heading }]}>
                      {line.product_name ?? line.product_id}
                    </Text>
                    <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                      Open {fmtQty(line.quantity_open)}
                    </Text>
                    <TextInput
                      value={returnQtyByLine[line.lending_line_id] ?? ''}
                      onChangeText={(value) =>
                        setReturnQtyByLine((prev) => ({ ...prev, [line.lending_line_id]: value }))
                      }
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={theme.inputPlaceholder}
                      style={[styles.inputStandalone, { backgroundColor: theme.card, color: theme.inputText }]}
                    />
                    <View style={styles.filterRow}>
                      {(['GOOD', 'DAMAGED', 'LOST'] as const).map((value) => {
                        const active = (returnConditionByLine[line.lending_line_id] ?? 'GOOD') === value;
                        return (
                          <Pressable
                            key={value}
                            style={[
                              styles.filterPill,
                              { backgroundColor: active ? theme.primary : theme.pillBg, borderColor: theme.cardBorder }
                            ]}
                            onPress={() =>
                              setReturnConditionByLine((prev) => ({
                                ...prev,
                                [line.lending_line_id]: value
                              }))
                            }
                          >
                            <Text style={{ color: active ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: 10 }}>
                              {value}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}

              <TextInput
                value={returnRemarks}
                onChangeText={setReturnRemarks}
                placeholder="Remarks (optional)"
                placeholderTextColor={theme.inputPlaceholder}
                style={[styles.inputStandalone, { backgroundColor: theme.inputBg, color: theme.inputText }]}
              />
            </ScrollView>

            <View style={styles.actionRow}>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: returnSaving ? theme.primaryMuted : theme.primary }]}
                onPress={() => void saveReturn()}
                disabled={returnSaving}
              >
                <Text style={styles.primaryBtnText}>{returnSaving ? 'Saving...' : 'Save Return'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
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
  topRow: {
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
  inputStandalone: {
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
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap'
  },
  filterPill: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  list: {
    flex: 1
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
    minWidth: 110,
    alignItems: 'flex-end',
    gap: 4
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800'
  },
  viewHint: {
    fontSize: 10,
    fontWeight: '700'
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingTop: 12
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 8, 23, 0.55)'
  },
  modalCard: {
    maxHeight: '92%',
    minHeight: '74%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10
  },
  returnModalCard: {
    marginHorizontal: 16,
    marginBottom: 20,
    maxHeight: '88%',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    minWidth: 72,
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
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: '48%',
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
    fontSize: 12,
    fontWeight: '800'
  },
  modalList: {
    flex: 1
  },
  modalListContent: {
    gap: 8,
    paddingBottom: 8
  },
  sectionTitle: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700'
  },
  detailCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8
  },
  primaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800'
  }
});
