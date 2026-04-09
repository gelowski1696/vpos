import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { AppTheme } from '../theme';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { loadProductOptions, type MasterDataOption } from '../master-data-local';

type TransferRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
};

type CachedMasterDataRow = {
  record_id: string;
  payload: string;
  updated_at: string;
};

type TransferPayload = {
  transfer_mode?: string;
  source_location_label?: string;
  source_location_id?: string;
  destination_location_label?: string;
  destination_location_id?: string;
  supplier_name?: string;
  lines?: Array<{
    productId?: string;
    product_id?: string;
    qtyFull?: number;
    qty_full?: number;
    qtyEmpty?: number;
    qty_empty?: number;
  }>;
};

type TransferFilter = 'ALL' | 'PENDING' | 'SYNCED' | 'NEEDS_REVIEW' | 'FAILED';
const TRANSFER_PAGE_SIZE = 20;

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  syncBusy?: boolean;
};

function parsePayload(value: string): TransferPayload {
  try {
    return JSON.parse(value) as TransferPayload;
  } catch {
    return {};
  }
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

function formatTransferModeLabel(value: string | null | undefined): string {
  switch (String(value ?? '').trim().toUpperCase()) {
    case 'SUPPLIER_RESTOCK_IN':
      return 'Supplier Restock In';
    case 'SUPPLIER_RESTOCK_OUT':
      return 'Supplier Restock Out';
    case 'STORE_TO_WAREHOUSE':
      return 'Warehouse Restock Out';
    case 'WAREHOUSE_TO_STORE':
      return 'Warehouse Restock In';
    case 'CREATE':
      return 'Create';
    case 'USED':
      return 'Used';
    case 'CONVERT':
      return 'Convert';
    case 'INTER_STORE_TRANSFER':
      return 'Inter-Store Transfer';
    case 'GENERAL':
    case '':
      return 'General';
    default:
      return String(value).replace(/_/g, ' ');
  }
}

function toQty(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTransferSyncStatus(value: unknown): string {
  const normalized = normalizeText(value)?.toLowerCase();
  return normalized ?? 'synced';
}

function normalizeTransferRowCandidate(candidate: Record<string, unknown>, fallbackId: string): TransferRow | null {
  const id = normalizeText(candidate.id) ?? fallbackId;
  if (!id) {
    return null;
  }
  const rawPayload = candidate.payload;
  const payload =
    rawPayload && typeof rawPayload === 'object'
      ? (rawPayload as TransferPayload)
      : parsePayload(typeof rawPayload === 'string' ? rawPayload : '{}');
  const createdAt = normalizeText(candidate.created_at);
  if (!createdAt) {
    return null;
  }
  return {
    id,
    payload: JSON.stringify(payload),
    sync_status: normalizeTransferSyncStatus(candidate.sync_status),
    created_at: createdAt,
    updated_at: normalizeText(candidate.updated_at) ?? createdAt,
  };
}

function mergeTransferRows(localRows: TransferRow[], remoteRows: TransferRow[]): TransferRow[] {
  const merged = new Map<string, TransferRow>();
  for (const row of localRows) {
    merged.set(row.id, row);
  }
  for (const row of remoteRows) {
    if (!merged.has(row.id)) {
      merged.set(row.id, row);
    }
  }
  return [...merged.values()].sort((a, b) => {
    const left = new Date(b.created_at).getTime();
    const right = new Date(a.created_at).getTime();
    if (!Number.isNaN(left) && !Number.isNaN(right) && left !== right) {
      return left - right;
    }
    return b.created_at.localeCompare(a.created_at);
  });
}

function parseDateInput(value: string, endOfDay = false): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function matchesDateRange(value: string, fromDate: string, toDate: string): boolean {
  const target = new Date(value).getTime();
  if (Number.isNaN(target)) {
    return false;
  }
  const from = parseDateInput(fromDate, false);
  const to = parseDateInput(toDate, true);
  if (from !== null && target < from) {
    return false;
  }
  if (to !== null && target > to) {
    return false;
  }
  return true;
}

function toDateValue(value: string): Date {
  const parsed = parseDateInput(value, false);
  return parsed === null ? new Date() : new Date(parsed);
}

function formatDateInputLocal(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayDateInput(): string {
  return formatDateInputLocal(new Date());
}

export function TransferListScreen({ db, theme, syncBusy = false }: Props): JSX.Element {
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TransferFilter>('ALL');
  const [fromDate, setFromDate] = useState(todayDateInput);
  const [toDate, setToDate] = useState(todayDateInput);
  const [currentPage, setCurrentPage] = useState(1);
  const [pickerTarget, setPickerTarget] = useState<'from' | 'to' | null>(null);
  const [productMap, setProductMap] = useState<Map<string, MasterDataOption>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const prevSyncBusyRef = useRef(syncBusy);

  const selectedRow = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);
  const closeTransferDetails = (): void => setSelectedId(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const localRows = await db.getAllAsync<TransferRow>(
        `
        SELECT id, payload, sync_status, created_at, updated_at
        FROM transfers_local
        ORDER BY created_at DESC
        `,
      );
      const cachedRows = await db.getAllAsync<CachedMasterDataRow>(
        `
        SELECT record_id, payload, updated_at
        FROM master_data_local
        WHERE entity = 'remote_transfer'
        ORDER BY updated_at DESC
        `,
      );
      const remoteRows = cachedRows
        .map((row) => normalizeTransferRowCandidate(parsePayload(row.payload) as Record<string, unknown>, row.record_id))
        .filter((row): row is TransferRow => Boolean(row));
      setRows(mergeTransferRows(localRows, remoteRows));
    } finally {
      setLoading(false);
    }
  };

  const loadReference = async (): Promise<void> => {
    const products = await loadProductOptions(db);
    setProductMap(new Map(products.map((item) => [item.id, item])));
  };

  useEffect(() => {
    void refresh();
    void loadReference();
  }, []);

  useEffect(() => {
    if (prevSyncBusyRef.current && !syncBusy) {
      void refresh();
    }
    prevSyncBusyRef.current = syncBusy;
  }, [syncBusy]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const status = row.sync_status.toLowerCase();
      if (filter === 'PENDING' && status !== 'pending') {
        return false;
      }
      if (filter === 'SYNCED' && status !== 'synced') {
        return false;
      }
      if (filter === 'NEEDS_REVIEW' && status !== 'needs_review') {
        return false;
      }
      if (filter === 'FAILED' && status !== 'failed') {
        return false;
      }
      if (!matchesDateRange(row.created_at, fromDate, toDate)) {
        return false;
      }
      if (!q) {
        return true;
      }
      const payload = parsePayload(row.payload);
      const blob = `${row.id} ${payload.transfer_mode ?? ''} ${payload.source_location_label ?? payload.source_location_id ?? ''} ${payload.destination_location_label ?? payload.destination_location_id ?? ''}`.toLowerCase();
      return blob.includes(q);
    });
  }, [rows, query, filter, fromDate, toDate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, filter, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / TRANSFER_PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * TRANSFER_PAGE_SIZE;
    return filteredRows.slice(start, start + TRANSFER_PAGE_SIZE);
  }, [currentPage, filteredRows]);

  const handleDatePick = (event: DateTimePickerEvent, selectedDate?: Date): void => {
    if (event.type === 'dismissed') {
      setPickerTarget(null);
      return;
    }
    if (!selectedDate || !pickerTarget) {
      return;
    }
    const nextValue = formatDateInputLocal(selectedDate);
    if (pickerTarget === 'from') {
      setFromDate(nextValue);
    } else {
      setToDate(nextValue);
    }
    if (Platform.OS !== 'ios') {
      setPickerTarget(null);
    }
  };

  const stats = useMemo(
    () => ({
      all: rows.length,
      pending: rows.filter((row) => row.sync_status === 'pending').length,
      synced: rows.filter((row) => row.sync_status === 'synced').length,
      review: rows.filter((row) => row.sync_status === 'needs_review').length,
    }),
    [rows],
  );

  const selectedPayload = selectedRow ? parsePayload(selectedRow.payload) : null;
  const selectedLines = Array.isArray(selectedPayload?.lines) ? selectedPayload?.lines ?? [] : [];
  const selectedTotalFull = useMemo(
    () => selectedLines.reduce((sum, line) => sum + toQty(line.qty_full ?? line.qtyFull), 0),
    [selectedLines],
  );
  const selectedTotalEmpty = useMemo(
    () => selectedLines.reduce((sum, line) => sum + toQty(line.qty_empty ?? line.qtyEmpty), 0),
    [selectedLines],
  );

  return (
    <View className="gap-2.5 rounded-2xl border px-3.5 py-3.5" style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}>
      <View className="flex-row items-start gap-2.5">
        <View className="flex-1">
          <Text className="text-lg font-bold" style={{ color: theme.heading }}>Transfer List</Text>
          <Text className="text-[13px]" style={{ color: theme.subtext }}>
            View cached branch transfers, local transfer history, and sync statuses.
          </Text>
        </View>
        <Pressable
          onPress={() => void refresh()}
          className="min-h-[38px] min-w-[92px] items-center justify-center rounded-[10px] px-2.5"
          style={{ backgroundColor: loading || syncBusy ? theme.primaryMuted : theme.primary }}
          disabled={loading || syncBusy}
        >
          <Text className="text-xs font-bold text-white">{loading ? 'Refreshing...' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <View className="flex-row gap-2">
        {[
          ['All', stats.all],
          ['Pending', stats.pending],
          ['Synced', stats.synced],
          ['Review', stats.review],
        ].map(([label, value]) => (
          <View key={String(label)} className="flex-1 gap-px rounded-xl border px-2 py-2" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
            <Text className="text-[10px] font-semibold" style={{ color: theme.subtext }}>{String(label)}</Text>
            <Text className="text-base font-extrabold" style={{ color: theme.heading }}>{String(value)}</Text>
          </View>
        ))}
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search transfer id, mode, source, destination"
        placeholderTextColor={theme.inputPlaceholder}
        className="rounded-xl border px-3 py-[11px] text-sm"
        style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg, color: theme.inputText }}
      />

      <View className="flex-row gap-2.5">
        <Pressable className="flex-1 gap-1.5" onPress={() => setPickerTarget('from')}>
          <Text className="text-[11px] font-bold" style={{ color: theme.subtext }}>From</Text>
          <View className="min-h-[45px] justify-center rounded-xl border px-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
            <Text className="text-[13px] font-semibold" style={{ color: fromDate ? theme.inputText : theme.inputPlaceholder }}>
              {fromDate || 'Select start date'}
            </Text>
          </View>
        </Pressable>
        <Pressable className="flex-1 gap-1.5" onPress={() => setPickerTarget('to')}>
          <Text className="text-[11px] font-bold" style={{ color: theme.subtext }}>To</Text>
          <View className="min-h-[45px] justify-center rounded-xl border px-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
            <Text className="text-[13px] font-semibold" style={{ color: toDate ? theme.inputText : theme.inputPlaceholder }}>
              {toDate || 'Select end date'}
            </Text>
          </View>
        </Pressable>
      </View>

      {pickerTarget ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setPickerTarget(null)}>
          <View className="flex-1 justify-end pt-3">
            <Pressable className="absolute inset-0 bg-[rgba(2,8,23,0.55)]" onPress={() => setPickerTarget(null)} />
            <View className="w-full gap-2.5 rounded-t-[18px] border px-3 py-3" style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}>
              <View className="flex-row items-center justify-between gap-2.5">
                <Text className="text-base font-extrabold" style={{ color: theme.heading }}>
                  {pickerTarget === 'from' ? 'Select start date' : 'Select end date'}
                </Text>
                <Pressable onPress={() => setPickerTarget(null)} className="min-h-10 items-center justify-center rounded-[10px] px-3" style={{ backgroundColor: theme.pillBg }}>
                  <Text className="text-xs font-bold" style={{ color: theme.pillText }}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={pickerTarget === 'from' ? toDateValue(fromDate) : toDateValue(toDate)}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handleDatePick}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2 pr-2">
          {(['ALL', 'PENDING', 'SYNCED', 'NEEDS_REVIEW', 'FAILED'] as const).map((entry) => {
            const selected = filter === entry;
            return (
              <Pressable
                key={entry}
                onPress={() => setFilter(entry)}
                className="min-h-8 items-center justify-center rounded-full px-3"
                style={{ backgroundColor: selected ? theme.primary : theme.pillBg }}
              >
                <Text className="text-[11px] font-extrabold" style={{ color: selected ? '#FFFFFF' : theme.pillText }}>
                  {entry === 'NEEDS_REVIEW' ? 'NEEDS REVIEW' : entry}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <ScrollView className="max-h-[480px]" contentContainerStyle={{ gap: 8, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
        {filteredRows.length === 0 ? (
          <Text className="py-3 text-center text-xs" style={{ color: theme.subtext }}>No transfer records found.</Text>
        ) : (
          pagedRows.map((row) => {
            const payload = parsePayload(row.payload);
            const lines = Array.isArray(payload.lines) ? payload.lines : [];
            const totalFull = lines.reduce((sum, line) => sum + toQty(line.qty_full ?? line.qtyFull), 0);
            const totalEmpty = lines.reduce((sum, line) => sum + toQty(line.qty_empty ?? line.qtyEmpty), 0);
            return (
              <Pressable
                key={row.id}
                onPress={() => setSelectedId(row.id)}
                className="flex-row items-center gap-2 rounded-xl border px-2.5 py-[9px]"
                style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
              >
                <View className="flex-1 gap-0.5">
                  <Text className="text-xs font-bold" style={{ color: theme.heading }}>{row.id}</Text>
                  <Text className="text-[11px]" style={{ color: theme.subtext }}>{formatTransferModeLabel(payload.transfer_mode)}</Text>
                  <Text className="text-[11px]" style={{ color: theme.subtext }}>
                    {payload.source_location_label ?? payload.source_location_id ?? '-'} {'>'} {payload.destination_location_label ?? payload.destination_location_id ?? '-'}
                  </Text>
                  <Text className="text-[11px]" style={{ color: theme.subtext }}>FULL {totalFull.toFixed(2)} • EMPTY {totalEmpty.toFixed(2)}</Text>
                  <Text className="text-[11px]" style={{ color: theme.subtext }}>{fmtDate(row.created_at)}</Text>
                </View>
                <SyncStatusBadge status={row.sync_status} />
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {filteredRows.length > 0 ? (
        <View className="gap-2.5">
          <Text className="text-[11px]" style={{ color: theme.subtext }}>
            Showing {(currentPage - 1) * TRANSFER_PAGE_SIZE + 1}-{Math.min(currentPage * TRANSFER_PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
          </Text>
          <View className="flex-row items-center justify-between gap-2">
            <Pressable
              onPress={() => setCurrentPage((page) => Math.max(1, page - 1))}
              className="min-h-[34px] items-center justify-center rounded-[10px] border px-3.5"
              style={{ backgroundColor: currentPage === 1 ? theme.primaryMuted : theme.pillBg, borderColor: theme.cardBorder }}
              disabled={currentPage === 1}
            >
              <Text className="text-[11px] font-bold" style={{ color: currentPage === 1 ? '#FFFFFF' : theme.pillText }}>Previous</Text>
            </Pressable>
            <Text className="text-[11px] font-bold" style={{ color: theme.heading }}>Page {currentPage} of {totalPages}</Text>
            <Pressable
              onPress={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              className="min-h-[34px] items-center justify-center rounded-[10px] border px-3.5"
              style={{ backgroundColor: currentPage === totalPages ? theme.primaryMuted : theme.pillBg, borderColor: theme.cardBorder }}
              disabled={currentPage === totalPages}
            >
              <Text className="text-[11px] font-bold" style={{ color: currentPage === totalPages ? '#FFFFFF' : theme.pillText }}>Next</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Modal visible={Boolean(selectedRow)} transparent animationType="slide" onRequestClose={closeTransferDetails}>
        {selectedRow ? (
          <View className="flex-1 justify-end bg-[rgba(2,8,23,0.55)] pt-3">
            <Pressable className="absolute inset-0" onPress={closeTransferDetails} />
            <View
              className="w-full rounded-t-[20px] border px-3 py-3"
              style={{ minHeight: '78%', maxHeight: '90%', backgroundColor: theme.card, borderColor: theme.cardBorder }}
            >
              <View className="flex-row items-start justify-between gap-2">
                <View>
                  <Text className="text-base font-extrabold" style={{ color: theme.heading }}>Transfer Details</Text>
                  <Text className="text-[12px]" style={{ color: theme.subtext }}>Transfer ID {selectedRow.id}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <SyncStatusBadge status={selectedRow.sync_status} />
                  <Pressable
                    className="min-h-10 min-w-[72px] items-center justify-center rounded-xl border px-3"
                    style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                    onPress={closeTransferDetails}
                  >
                    <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>Back</Text>
                  </Pressable>
                </View>
              </View>

              <View className="mt-3 min-h-0 flex-1 gap-3">
                <ScrollView
                  className="min-h-0 flex-1"
                  contentContainerStyle={{ gap: 10, paddingBottom: 10 }}
                  showsVerticalScrollIndicator
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  {selectedPayload ? (
                    <>
                      <View className="gap-1.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                        <Text className="text-xl font-extrabold" style={{ color: theme.heading }}>{selectedRow.id}</Text>
                        <Text className="text-[12px]" style={{ color: theme.subtext }}>
                          {formatTransferModeLabel(selectedPayload.transfer_mode)}
                        </Text>
                        <Text className="text-[12px]" style={{ color: theme.subtext }}>
                          {fmtDate(selectedRow.created_at)}
                        </Text>
                      </View>

                      <View className="flex-row flex-wrap gap-2">
                        <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Source</Text>
                          <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>
                            {selectedPayload.source_location_label ?? selectedPayload.source_location_id ?? '-'}
                          </Text>
                        </View>
                        <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Destination</Text>
                          <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>
                            {selectedPayload.destination_location_label ?? selectedPayload.destination_location_id ?? '-'}
                          </Text>
                        </View>
                        {selectedPayload.supplier_name ? (
                          <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                            <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Supplier</Text>
                            <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>{selectedPayload.supplier_name}</Text>
                          </View>
                        ) : null}
                      </View>

                      <View className="flex-row flex-wrap gap-2">
                        <View className="min-w-[31%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Lines</Text>
                          <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{selectedLines.length}</Text>
                        </View>
                        <View className="min-w-[31%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Full</Text>
                          <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{selectedTotalFull.toFixed(2)}</Text>
                        </View>
                        <View className="min-w-[31%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                          <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Empty</Text>
                          <Text className="text-[15px] font-extrabold" style={{ color: theme.heading }}>{selectedTotalEmpty.toFixed(2)}</Text>
                        </View>
                      </View>
                    </>
                  ) : null}

                  <Text className="text-[12px] font-extrabold uppercase tracking-[0.4px]" style={{ color: theme.heading }}>Items</Text>

                  {selectedLines.length === 0 ? (
                    <Text className="py-3 text-center text-xs" style={{ color: theme.subtext }}>No line items.</Text>
                  ) : (
                    selectedLines.map((line, index) => {
                      const productId = String(line.productId ?? line.product_id ?? '');
                      const label = productMap.get(productId)?.label ?? productMap.get(productId)?.subtitle ?? (productId || '-');
                      const full = toQty(line.qty_full ?? line.qtyFull);
                      const empty = toQty(line.qty_empty ?? line.qtyEmpty);
                      return (
                        <View key={`${productId}-${index}`} className="gap-2 rounded-xl border px-3 py-3" style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}>
                          <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>{label}</Text>
                          <Text className="text-[12px]" style={{ color: theme.subtext }}>{productId || '-'}</Text>
                          <View className="flex-row flex-wrap gap-2">
                            <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                              <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Full Qty</Text>
                              <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>{full.toFixed(2)}</Text>
                            </View>
                            <View className="min-w-[48%] flex-1 gap-0.5 rounded-xl border px-2.5 py-2" style={{ borderColor: theme.cardBorder }}>
                              <Text className="text-[11px] font-semibold" style={{ color: theme.subtext }}>Empty Qty</Text>
                              <Text className="text-[14px] font-bold" style={{ color: theme.heading }}>{empty.toFixed(2)}</Text>
                            </View>
                          </View>
                        </View>
                      );
                    })
                  )}
                </ScrollView>

                <View className="border-t pt-3" style={{ borderColor: theme.cardBorder }}>
                  <Pressable onPress={closeTransferDetails} className="min-h-10 items-center justify-center rounded-[10px]" style={{ backgroundColor: theme.pillBg }}>
                    <Text className="text-xs font-bold" style={{ color: theme.pillText }}>Close</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

