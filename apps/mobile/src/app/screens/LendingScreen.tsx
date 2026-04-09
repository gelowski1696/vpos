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
import { OfflineTransactionService } from '../../services/offline-transaction.service';
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

type LocalLendingRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
};

type LocalLendingPayload = {
  lending_id?: string;
  sale_id?: string;
  branch_id?: string;
  branch_name?: string | null;
  location_id?: string;
  location_name?: string | null;
  customer_id?: string;
  customer_name?: string | null;
  status?: string;
  due_at?: string | null;
  remarks?: string | null;
  opened_at?: string;
  line_count?: number;
  total_quantity_lent?: number;
  total_quantity_returned?: number;
  lines?: Array<{
    product_id?: string;
    product_name?: string | null;
    product_sku?: string | null;
    quantity?: number;
    deposit_amount?: number | null;
    remarks?: string | null;
    source_sale_line_id?: string | null;
  }>;
};

type LocalLendingReturnRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
};

type LocalLendingReturnPayload = {
  lending_return_id?: string;
  lending_id?: string;
  sale_id?: string | null;
  customer_id?: string | null;
  remarks?: string | null;
  lines?: Array<{
    lending_line_id?: string;
    product_id?: string | null;
    product_name?: string | null;
    returned_qty?: number;
    condition?: LendingReturnCondition;
  }>;
  created_at?: string;
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

function formatLendingStatusLabel(status: LendingStatus | string | null | undefined): string {
  switch (String(status ?? '').trim().toUpperCase()) {
    case 'OPEN':
      return 'Lended';
    case 'CLOSED':
      return 'Returned';
    case 'PARTIALLY_RETURNED':
      return 'Partially Returned';
    case 'FORCE_CLOSED':
      return 'Force Closed';
    case 'OVERDUE':
      return 'Overdue';
    default:
      return String(status ?? '-').replace(/_/g, ' ');
  }
}

function parsePayload<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return {} as T;
  }
}

function shouldQueueOffline(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('network error') ||
    normalized.includes('request failed (503)') ||
    normalized.includes('request failed (502)') ||
    normalized.includes('request failed (504)')
  );
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
  const [localPendingRowsById, setLocalPendingRowsById] = useState<Map<string, LendingDetailRecord>>(new Map());
  const [pendingReturnsByLendingId, setPendingReturnsByLendingId] = useState<
    Map<string, LocalLendingReturnPayload[]>
  >(new Map());
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

  const applyPendingReturns = useCallback(
    (
      detail: LendingDetailRecord,
      pending: LocalLendingReturnPayload[] | undefined
    ): LendingDetailRecord => {
      if (!pending?.length) {
        return detail;
      }
      const extraReturnedByLine = new Map<string, number>();
      const extraReturns: LendingReturnRecord[] = [];
      for (const entry of pending) {
        for (const line of entry.lines ?? []) {
          const lineId = line.lending_line_id?.trim();
          const qty = Number(line.returned_qty ?? 0);
          if (!lineId || !Number.isFinite(qty) || qty <= 0) {
            continue;
          }
          extraReturnedByLine.set(
            lineId,
            Number(((extraReturnedByLine.get(lineId) ?? 0) + qty).toFixed(4))
          );
          extraReturns.push({
            lending_return_id:
              entry.lending_return_id ?? `${detail.lending_id}-${lineId}-${extraReturns.length + 1}`,
            lending_line_id: lineId,
            returned_qty: qty,
            condition: line.condition ?? 'GOOD',
            remarks: entry.remarks ?? null,
            received_by_name: 'Pending Sync',
            returned_at: entry.created_at ?? new Date().toISOString()
          });
        }
      }

      const lines = detail.lines.map((line) => {
        const extraReturned = extraReturnedByLine.get(line.lending_line_id) ?? 0;
        const quantityReturned = Number((line.quantity_returned + extraReturned).toFixed(4));
        return {
          ...line,
          quantity_returned: quantityReturned,
          quantity_open: Number(Math.max(0, line.quantity_lent - quantityReturned).toFixed(4))
        };
      });
      const totalQuantityReturned = Number(
        lines.reduce((sum, line) => sum + line.quantity_returned, 0).toFixed(4)
      );
      const hasOpen = lines.some((line) => line.quantity_open > 0);
      const status: LendingStatus = hasOpen
        ? totalQuantityReturned > 0
          ? 'PARTIALLY_RETURNED'
          : detail.status
        : 'CLOSED';
      return {
        ...detail,
        status,
        total_quantity_returned: totalQuantityReturned,
        lines,
        returns: [...extraReturns, ...detail.returns]
      };
    },
    []
  );

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    const localMap = new Map<string, LendingDetailRecord>();
    const localList: LendingRecord[] = [];
    try {
      const localRows = await db.getAllAsync<LocalLendingRow>(
        `
        SELECT id, payload, sync_status, created_at, updated_at
        FROM lending_local
        WHERE sync_status IN ('pending', 'processing', 'failed')
        ORDER BY created_at DESC
        `
      );
      for (const row of localRows) {
        const payload = parsePayload<LocalLendingPayload>(row.payload);
        const detail: LendingDetailRecord = {
          lending_id: payload.lending_id ?? row.id,
          branch_id: payload.branch_id ?? '-',
          branch_name: payload.branch_name ?? null,
          location_id: payload.location_id ?? '-',
          location_name: payload.location_name ?? null,
          customer_id: payload.customer_id ?? '-',
          customer_code: null,
          customer_name: payload.customer_name ?? null,
          sale_id: payload.sale_id ?? '-',
          status: 'OPEN',
          due_at: payload.due_at ?? null,
          remarks: payload.remarks ?? null,
          opened_at: payload.opened_at ?? row.created_at,
          line_count: Number(payload.line_count ?? (payload.lines?.length ?? 0)),
          total_quantity_lent: Number(payload.total_quantity_lent ?? 0),
          total_quantity_returned: Number(payload.total_quantity_returned ?? 0),
          lines: (payload.lines ?? []).map((line, index) => ({
            lending_line_id: `${row.id}-line-${index}`,
            product_id: line.product_id ?? '-',
            product_sku: line.product_sku ?? null,
            product_name: line.product_name ?? null,
            quantity_lent: Number(line.quantity ?? 0),
            quantity_returned: 0,
            quantity_open: Number(line.quantity ?? 0),
            deposit_amount:
              line.deposit_amount === null || line.deposit_amount === undefined
                ? null
                : Number(line.deposit_amount),
            remarks: line.remarks ?? null
          })),
          returns: []
        };
        localMap.set(detail.lending_id, detail);
        if (statusFilter === 'ALL' || statusFilter === 'OPEN') {
          localList.push(detail);
        }
      }
      setLocalPendingRowsById(localMap);

      const localReturnRows = await db.getAllAsync<LocalLendingReturnRow>(
        `
        SELECT id, payload, sync_status, created_at, updated_at
        FROM lending_returns_local
        WHERE sync_status IN ('pending', 'processing', 'failed')
        ORDER BY created_at DESC
        `
      );
      const pendingReturnsMap = new Map<string, LocalLendingReturnPayload[]>();
      for (const row of localReturnRows) {
        const payload = parsePayload<LocalLendingReturnPayload>(row.payload);
        const lendingId = payload.lending_id?.trim();
        if (!lendingId) {
          continue;
        }
        const existing = pendingReturnsMap.get(lendingId) ?? [];
        existing.push({
          ...payload,
          lending_return_id: payload.lending_return_id ?? row.id,
          created_at: payload.created_at ?? row.created_at
        });
        pendingReturnsMap.set(lendingId, existing);
      }
      setPendingReturnsByLendingId(pendingReturnsMap);

      const params = new URLSearchParams();
      if (preferredBranchId?.trim()) {
        params.set('branch_id', preferredBranchId.trim());
      }
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }
      params.set('limit', '120');
      const data = await apiRequest<LendingRecord[]>(`/lending?${params.toString()}`);
      const merged = data.map((row) => {
        const pending = pendingReturnsMap.get(row.lending_id);
        if (!pending?.length) {
          return row;
        }
        const extraReturned = pending.reduce((sum, entry) => {
          return (
            sum +
            (entry.lines ?? []).reduce((lineSum, line) => lineSum + Number(line.returned_qty ?? 0), 0)
          );
        }, 0);
        const totalReturned = Number((row.total_quantity_returned + extraReturned).toFixed(4));
        const totalOpen = Number((row.total_quantity_lent - totalReturned).toFixed(4));
        return {
          ...row,
          status: totalOpen <= 0 ? 'CLOSED' : totalReturned > 0 ? 'PARTIALLY_RETURNED' : row.status,
          total_quantity_returned: totalReturned
        };
      });
      setRows([...localList, ...merged]);
    } catch (cause) {
      if (localList.length > 0) {
        setRows([...localList]);
      } else {
        toastError('Lending', cause instanceof Error ? cause.message : 'Unable to load lending records.');
      }
    } finally {
      setLoading(false);
    }
  }, [apiRequest, db, preferredBranchId, statusFilter]);

  const openDetail = useCallback(
    async (lendingId: string): Promise<void> => {
      setSelectedId(lendingId);
      const localDetail = localPendingRowsById.get(lendingId);
      if (localDetail) {
        setSelectedDetail(localDetail);
        setDetailLoading(false);
        return;
      }
      setDetailLoading(true);
      try {
        const detail = await apiRequest<LendingDetailRecord>(
          `/lending/${encodeURIComponent(lendingId)}`
        );
        setSelectedDetail(applyPendingReturns(detail, pendingReturnsByLendingId.get(lendingId)));
      } catch (cause) {
        toastError('Lending', cause instanceof Error ? cause.message : 'Unable to load lending detail.');
      } finally {
        setDetailLoading(false);
      }
    },
    [apiRequest, applyPendingReturns, localPendingRowsById, pendingReturnsByLendingId]
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
    !localPendingRowsById.has(selectedDetail.lending_id) &&
    selectedDetail.status !== 'CLOSED' &&
    selectedDetail.status !== 'CANCELLED' &&
    selectedDetail.status !== 'FORCE_CLOSED' &&
    selectedDetail.lines.some((line) => line.quantity_open > 0);
  const returnableLines = selectedDetail?.lines.filter((line) => line.quantity_open > 0) ?? [];

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
      const body = {
        remarks: returnRemarks.trim() || null,
        lines: lines.map((entry) => ({
          lending_line_id: entry.line.lending_line_id,
          returned_qty: entry.qty,
          condition: entry.condition
        }))
      };
      let queuedOffline = false;
      let detail: LendingDetailRecord | null = null;
      try {
        detail = await apiRequest<LendingDetailRecord>(
          `/lending/${encodeURIComponent(selectedDetail.lending_id)}/return`,
          {
            method: 'POST',
            body: JSON.stringify(body)
          }
        );
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Unable to save return.';
        if (!shouldQueueOffline(message)) {
          throw cause;
        }
        queuedOffline = true;
      }
      if (queuedOffline) {
        const service = new OfflineTransactionService(db);
        await service.createOfflineLendingReturn({
          lendingId: selectedDetail.lending_id,
          saleId: selectedDetail.sale_id,
          customerId: selectedDetail.customer_id,
          remarks: returnRemarks.trim() || null,
          lines: lines.map((entry) => ({
            lendingLineId: entry.line.lending_line_id,
            productId: entry.line.product_id,
            productName: entry.line.product_name,
            returnedQty: entry.qty,
            condition: entry.condition
          }))
        });
      }
      setReturnModalOpen(false);
      toastSuccess(
        queuedOffline ? 'Return queued offline' : 'Return saved',
        `Updated lending ${selectedDetail.lending_id}.`
      );
      await refresh();
      if (queuedOffline) {
        setSelectedDetail(
          applyPendingReturns(selectedDetail, [
            ...(pendingReturnsByLendingId.get(selectedDetail.lending_id) ?? []),
            {
              lending_return_id: '',
              lending_id: selectedDetail.lending_id,
              sale_id: selectedDetail.sale_id,
              customer_id: selectedDetail.customer_id,
              remarks: returnRemarks.trim() || null,
              created_at: new Date().toISOString(),
              lines: lines.map((entry) => ({
                lending_line_id: entry.line.lending_line_id,
                product_id: entry.line.product_id,
                product_name: entry.line.product_name,
                returned_qty: entry.qty,
                condition: entry.condition
              }))
            }
          ])
        );
      } else if (detail) {
        setSelectedDetail(detail);
      }
      await onDataChanged?.();
    } catch (cause) {
      toastError('Return failed', cause instanceof Error ? cause.message : 'Unable to save return.');
    } finally {
      setReturnSaving(false);
    }
  };

  return (
    <View className="gap-2.5 rounded-2xl border px-3.5 py-3.5" style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}>
      <Text className="text-lg font-bold" style={{ color: theme.heading }}>Lending</Text>
      <Text className="text-[13px]" style={{ color: theme.subtext }}>
        Track open lendings, view details, and record returned tanks or accessories.
      </Text>

      <View className="flex-row gap-2">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by customer, sale, or lending ID..."
          placeholderTextColor={theme.inputPlaceholder}
          className="min-h-11 flex-1 rounded-xl px-3 py-[11px] text-[13px]"
          style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
        />
        <Pressable
          className="min-h-11 items-center justify-center rounded-xl px-4"
          style={{ backgroundColor: loading || syncBusy ? theme.primaryMuted : theme.primary }}
          onPress={() => void refresh()}
          disabled={loading || syncBusy}
        >
          <Text className="text-[13px] font-bold text-white">{loading ? '...' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {(['ALL', 'OPEN', 'PARTIALLY_RETURNED', 'OVERDUE', 'CLOSED'] as const).map((value) => {
          const active = statusFilter === value;
          return (
            <Pressable
              key={value}
              className="min-h-9 items-center justify-center rounded-full border px-3"
              style={{ backgroundColor: active ? theme.primary : theme.pillBg, borderColor: theme.cardBorder }}
              onPress={() => setStatusFilter(value)}
            >
              <Text className="text-[10px] font-bold" style={{ color: active ? '#FFFFFF' : theme.pillText }}>
                {value === 'ALL' ? 'ALL' : formatLendingStatusLabel(value)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ gap: 10, paddingBottom: 8 }} showsVerticalScrollIndicator>
        {filteredRows.length === 0 ? (
          <Text className="text-[13px]" style={{ color: theme.subtext }}>
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
                    Lended {fmtQty(openQty)} remaining of {fmtQty(row.total_quantity_lent)} | {fmtDate(row.opened_at)}
                  </Text>
                </View>
                <View style={styles.itemActions}>
                  <View style={[styles.statusPill, { backgroundColor: `${statusTone}20` }]}>
                    <Text style={[styles.statusText, { color: statusTone }]}>{formatLendingStatusLabel(row.status)}</Text>
                  </View>
                  <Text style={[styles.viewHint, { color: theme.primary }]}>View Detail</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={Boolean(selectedId) && !returnModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedId(null)}
      >
        <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] px-3 pt-3">
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              setSelectedId(null);
              setSelectedDetail(null);
            }}
          />
          <View className="min-h-[80%] max-h-[92%] gap-3 rounded-[20px] border p-3" style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}>
            {detailLoading || !selectedDetail ? (
              <Text style={[styles.sub, { color: theme.subtext }]}>Loading lending detail...</Text>
            ) : (
              <>
                <View className="flex-row items-start gap-2">
                  <View style={{ flex: 1 }}>
                    <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Lending Detail</Text>
                    <Text className="text-[12px]" style={{ color: theme.subtext }}>
                      {selectedDetail.lending_id} | Sale {selectedDetail.sale_id}
                    </Text>
                  </View>
                  <Pressable
                    className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                    style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                    onPress={() => {
                      setSelectedId(null);
                      setSelectedDetail(null);
                    }}
                  >
                    <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Close</Text>
                  </Pressable>
                </View>

                {localPendingRowsById.has(selectedDetail.lending_id) ? (
                  <View style={[styles.detailCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.itemName, { color: theme.heading }]}>Pending Sync</Text>
                    <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                      This lending was queued offline. Returns become available after the record syncs to the server.
                    </Text>
                  </View>
                ) : null}
                {!localPendingRowsById.has(selectedDetail.lending_id) &&
                (pendingReturnsByLendingId.get(selectedDetail.lending_id)?.length ?? 0) > 0 ? (
                  <View style={[styles.detailCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.itemName, { color: theme.heading }]}>Pending Return Sync</Text>
                    <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                      Some returns were queued offline and are already reflected below. They will finalize once sync completes.
                    </Text>
                  </View>
                ) : null}

                <View style={styles.summaryRow}>
                  <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Customer</Text>
                    <Text style={[styles.summaryValue, { color: theme.heading }]}>
                      {selectedDetail.customer_name ?? selectedDetail.customer_code ?? selectedDetail.customer_id}
                    </Text>
                  </View>
                  <View style={[styles.summaryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Status</Text>
                    <Text style={[styles.summaryValue, { color: theme.heading }]}>{formatLendingStatusLabel(selectedDetail.status)}</Text>
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

                {selectedDetail.status === 'OVERDUE' ? (
                  <View style={[styles.detailCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                    <Text style={[styles.itemName, { color: theme.heading }]}>Why this is overdue</Text>
                    <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                      The due date has already passed and this lending still has quantity open.
                    </Text>
                  </View>
                ) : null}

                <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ gap: 10, paddingBottom: 8 }} showsVerticalScrollIndicator nestedScrollEnabled>
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

                <View className="pt-1">
                  <Pressable
                    className="min-h-11 items-center justify-center rounded-xl px-3"
                    style={{ backgroundColor: canReturn ? theme.primary : theme.primaryMuted }}
                    disabled={!canReturn}
                    onPress={openReturnModal}
                  >
                    <Text className="text-[13px] font-bold text-white">Record Return</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={returnModalOpen} transparent animationType="fade" onRequestClose={() => setReturnModalOpen(false)}>
        <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] px-3 pt-3">
          <Pressable style={styles.modalBackdrop} onPress={() => setReturnModalOpen(false)} />
          <View
            className="min-h-[82%] max-h-[94%] gap-3 rounded-[20px] border p-3"
            style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
            onStartShouldSetResponder={() => true}
          >
            <View className="flex-row items-start gap-2">
              <View style={{ flex: 1 }}>
                <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Record Return</Text>
                <Text className="text-[12px]" style={{ color: theme.subtext }}>
                  Enter returned quantity for the open lines below.
                </Text>
              </View>
              <Pressable
                className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                onPress={() => setReturnModalOpen(false)}
                disabled={returnSaving}
              >
                <Text className="text-[13px] font-bold" style={{ color: theme.pillText }}>Close</Text>
              </Pressable>
            </View>

            <ScrollView
              className="min-h-0 flex-1"
              contentContainerStyle={{ gap: 10, paddingBottom: 8 }}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              keyboardShouldPersistTaps="always"
              keyboardDismissMode="none"
            >
              <View style={[styles.detailCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                  Choose the line, type the quantity being returned, then tap `Save Return`.
                </Text>
              </View>

              {returnableLines.length === 0 ? (
                <View style={[styles.detailCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.itemName, { color: theme.heading }]}>No Open Lines</Text>
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                    There are no remaining quantities available to return for this lending.
                  </Text>
                </View>
              ) : null}

              {returnableLines.map((line) => (
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
                    <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Return Qty</Text>
                    <TextInput
                      value={returnQtyByLine[line.lending_line_id] ?? ''}
                      onChangeText={(value) =>
                        setReturnQtyByLine((prev) => ({ ...prev, [line.lending_line_id]: value }))
                      }
                      autoFocus={
                        returnableLines[0]?.lending_line_id === line.lending_line_id
                      }
                      keyboardType="decimal-pad"
                      blurOnSubmit={false}
                      placeholder="0"
                      placeholderTextColor={theme.inputPlaceholder}
                      style={[
                        styles.inputStandalone,
                        styles.strongInput,
                        {
                          backgroundColor: theme.card,
                          color: theme.inputText,
                          borderColor: theme.cardBorder
                        }
                      ]}
                    />
                    <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Condition</Text>
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

              <Text style={[styles.summaryLabel, { color: theme.subtext }]}>Remarks</Text>
              <TextInput
                value={returnRemarks}
                onChangeText={setReturnRemarks}
                placeholder="Remarks (optional)"
                placeholderTextColor={theme.inputPlaceholder}
                blurOnSubmit={false}
                style={[
                  styles.inputStandalone,
                  styles.strongInput,
                  { backgroundColor: theme.inputBg, color: theme.inputText, borderColor: theme.cardBorder }
                ]}
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
  strongInput: {
    minHeight: 48,
    borderWidth: 1
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
  returnModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24
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
    height: '70%',
    maxHeight: '70%',
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
