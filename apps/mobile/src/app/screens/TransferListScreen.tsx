import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { SQLiteDatabase } from "expo-sqlite";
import type { AppTheme } from "../theme";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import { loadProductOptions, type MasterDataOption } from "../master-data-local";

type TransferRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
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

type TransferFilter = "ALL" | "PENDING" | "SYNCED" | "NEEDS_REVIEW" | "FAILED";

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
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function toQty(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function TransferListScreen({
  db,
  theme,
  syncBusy = false,
}: Props): JSX.Element {
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TransferFilter>("ALL");
  const [productMap, setProductMap] = useState<Map<string, MasterDataOption>>(
    new Map(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const prevSyncBusyRef = useRef(syncBusy);

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await db.getAllAsync<TransferRow>(
        `
        SELECT id, payload, sync_status, created_at, updated_at
        FROM transfers_local
        ORDER BY created_at DESC
        LIMIT 250
        `,
      );
      setRows(result);
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
      if (filter === "PENDING" && status !== "pending") {
        return false;
      }
      if (filter === "SYNCED" && status !== "synced") {
        return false;
      }
      if (filter === "NEEDS_REVIEW" && status !== "needs_review") {
        return false;
      }
      if (filter === "FAILED" && status !== "failed") {
        return false;
      }
      if (!q) {
        return true;
      }
      const payload = parsePayload(row.payload);
      const blob =
        `${row.id} ${payload.transfer_mode ?? ""} ${payload.source_location_label ?? payload.source_location_id ?? ""} ${payload.destination_location_label ?? payload.destination_location_id ?? ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [rows, query, filter]);

  const stats = useMemo(() => {
    return {
      all: rows.length,
      pending: rows.filter((row) => row.sync_status === "pending").length,
      synced: rows.filter((row) => row.sync_status === "synced").length,
      review: rows.filter((row) => row.sync_status === "needs_review").length,
    };
  }, [rows]);

  const selectedPayload = selectedRow ? parsePayload(selectedRow.payload) : null;
  const selectedLines = Array.isArray(selectedPayload?.lines)
    ? selectedPayload?.lines ?? []
    : [];

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.card, borderColor: theme.cardBorder },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.heading }]}>
            Transfer List
          </Text>
          <Text style={[styles.sub, { color: theme.subtext }]}>
            View local transfer history and sync statuses.
          </Text>
        </View>
        <Pressable
          onPress={() => void refresh()}
          style={[
            styles.refreshBtn,
            {
              backgroundColor: loading || syncBusy ? theme.primaryMuted : theme.primary,
            },
          ]}
          disabled={loading || syncBusy}
        >
          <Text style={styles.refreshText}>
            {loading ? "Refreshing..." : "Refresh"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.kpiRow}>
        <View
          style={[
            styles.kpiCard,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
          ]}
        >
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>All</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>
            {stats.all}
          </Text>
        </View>
        <View
          style={[
            styles.kpiCard,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
          ]}
        >
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Pending</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>
            {stats.pending}
          </Text>
        </View>
        <View
          style={[
            styles.kpiCard,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
          ]}
        >
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Synced</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>
            {stats.synced}
          </Text>
        </View>
        <View
          style={[
            styles.kpiCard,
            { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
          ]}
        >
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Review</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>
            {stats.review}
          </Text>
        </View>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search transfer id, mode, source, destination"
        placeholderTextColor={theme.inputPlaceholder}
        style={[
          styles.searchInput,
          { borderColor: theme.cardBorder, backgroundColor: theme.inputBg, color: theme.inputText },
        ]}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.filterRow}>
          {(["ALL", "PENDING", "SYNCED", "NEEDS_REVIEW", "FAILED"] as const).map(
            (entry) => {
              const selected = filter === entry;
              return (
                <Pressable
                  key={entry}
                  onPress={() => setFilter(entry)}
                  style={[
                    styles.filterChip,
                    { backgroundColor: selected ? theme.primary : theme.pillBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      { color: selected ? "#FFFFFF" : theme.pillText },
                    ]}
                  >
                    {entry === "NEEDS_REVIEW" ? "NEEDS REVIEW" : entry}
                  </Text>
                </Pressable>
              );
            },
          )}
        </View>
      </ScrollView>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {filteredRows.length === 0 ? (
          <Text style={[styles.emptyText, { color: theme.subtext }]}>
            No transfer records found.
          </Text>
        ) : (
          filteredRows.map((row) => {
            const payload = parsePayload(row.payload);
            const lines = Array.isArray(payload.lines) ? payload.lines : [];
            const totalFull = lines.reduce(
              (sum, line) => sum + toQty(line.qty_full ?? line.qtyFull),
              0,
            );
            const totalEmpty = lines.reduce(
              (sum, line) => sum + toQty(line.qty_empty ?? line.qtyEmpty),
              0,
            );
            return (
              <Pressable
                key={row.id}
                onPress={() => setSelectedId(row.id)}
                style={[
                  styles.rowCard,
                  { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
                ]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.rowId, { color: theme.heading }]}>
                    {row.id}
                  </Text>
                  <Text style={[styles.rowMeta, { color: theme.subtext }]}>
                    {(payload.transfer_mode ?? "GENERAL").replace(/_/g, " ")}
                  </Text>
                  <Text style={[styles.rowMeta, { color: theme.subtext }]}>
                    {payload.source_location_label ??
                      payload.source_location_id ??
                      "-"}{" "}
                    →{" "}
                    {payload.destination_location_label ??
                      payload.destination_location_id ??
                      "-"}
                  </Text>
                  <Text style={[styles.rowMeta, { color: theme.subtext }]}>
                    FULL {totalFull.toFixed(2)} • EMPTY {totalEmpty.toFixed(2)}
                  </Text>
                  <Text style={[styles.rowMeta, { color: theme.subtext }]}>
                    {fmtDate(row.created_at)}
                  </Text>
                </View>
                <SyncStatusBadge status={row.sync_status} />
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={Boolean(selectedRow)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedId(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setSelectedId(null)} />
          <View
            style={[
              styles.modalCard,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
            ]}
          >
            <Text style={[styles.modalTitle, { color: theme.heading }]}>
              Transfer Details
            </Text>
            <Text style={[styles.modalSub, { color: theme.subtext }]}>
              {selectedRow?.id}
            </Text>
            {selectedPayload ? (
              <View style={{ gap: 6 }}>
                <Text style={[styles.modalSub, { color: theme.subtext }]}>
                  Mode: {(selectedPayload.transfer_mode ?? "GENERAL").replace(/_/g, " ")}
                </Text>
                <Text style={[styles.modalSub, { color: theme.subtext }]}>
                  Source:{" "}
                  {selectedPayload.source_location_label ??
                    selectedPayload.source_location_id ??
                    "-"}
                </Text>
                <Text style={[styles.modalSub, { color: theme.subtext }]}>
                  Destination:{" "}
                  {selectedPayload.destination_location_label ??
                    selectedPayload.destination_location_id ??
                    "-"}
                </Text>
                {selectedPayload.supplier_name ? (
                  <Text style={[styles.modalSub, { color: theme.subtext }]}>
                    Supplier: {selectedPayload.supplier_name}
                  </Text>
                ) : null}
                <Text style={[styles.modalSub, { color: theme.subtext }]}>
                  Created: {fmtDate(selectedRow?.created_at)}
                </Text>
              </View>
            ) : null}

            <ScrollView style={styles.modalList} contentContainerStyle={{ gap: 8 }}>
              {selectedLines.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.subtext }]}>
                  No line items.
                </Text>
              ) : (
                selectedLines.map((line, index) => {
                  const productId = String(line.productId ?? line.product_id ?? "");
                  const label =
                    productMap.get(productId)?.label ??
                    productMap.get(productId)?.subtitle ??
                    (productId || "-");
                  const full = toQty(line.qty_full ?? line.qtyFull);
                  const empty = toQty(line.qty_empty ?? line.qtyEmpty);
                  return (
                    <View
                      key={`${productId}-${index}`}
                      style={[
                        styles.modalLine,
                        {
                          borderColor: theme.cardBorder,
                          backgroundColor: theme.inputBg,
                        },
                      ]}
                    >
                      <Text style={[styles.modalLineTitle, { color: theme.heading }]}>
                        {label}
                      </Text>
                      <Text style={[styles.modalLineSub, { color: theme.subtext }]}>
                        FULL {full.toFixed(2)} • EMPTY {empty.toFixed(2)}
                      </Text>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <Pressable
              onPress={() => setSelectedId(null)}
              style={[styles.closeBtn, { backgroundColor: theme.pillBg }]}
            >
              <Text style={[styles.closeBtnText, { color: theme.pillText }]}>
                Close
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  sub: {
    fontSize: 13,
  },
  refreshBtn: {
    minHeight: 38,
    minWidth: 92,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  refreshText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },
  kpiRow: {
    flexDirection: "row",
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 1,
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: "800",
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 8,
  },
  filterChip: {
    minHeight: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: "800",
  },
  list: {
    maxHeight: 480,
  },
  listContent: {
    gap: 8,
    paddingBottom: 8,
  },
  rowCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 2,
    flexDirection: "row",
    alignItems: "center",
  },
  rowId: {
    fontSize: 12,
    fontWeight: "700",
  },
  rowMeta: {
    fontSize: 11,
  },
  emptyText: {
    fontSize: 12,
    textAlign: "center",
    paddingVertical: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 16, 28, 0.56)",
    paddingHorizontal: 16,
    paddingVertical: 24,
    justifyContent: "center",
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 16,
    width: "100%",
    minHeight: "72%",
    maxHeight: "90%",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  modalSub: {
    fontSize: 12,
  },
  modalList: {
    flex: 1,
  },
  modalLine: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  modalLineTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  modalLineSub: {
    fontSize: 11,
  },
  closeBtn: {
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
