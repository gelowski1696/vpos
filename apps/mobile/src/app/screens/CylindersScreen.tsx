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
import { loadLocationOptions, type MasterDataOption } from '../master-data-local';
import { OfflineCylinderWorkflowService } from '../../features/cylinders/offline-cylinder-workflow.service';
import { LocalSessionService } from '../../features/auth/local-session.service';
import { HttpAuthTransport } from '../../features/auth/http-auth.transport';
import { normalizeApiBaseUrl } from '../api-base-url';
import { toastError, toastInfo, toastSuccess } from '../goey-toast';
import type { AppTheme } from '../theme';

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  preferredBranchId?: string;
  preferredLocationId?: string;
  onDataChanged?: () => Promise<void> | void;
  syncBusy?: boolean;
};

type CylinderStatus = 'FULL' | 'EMPTY' | 'DAMAGED' | 'JUNKED' | 'DISPOSED' | 'LOST';
type ActionType = 'JUNK' | 'DISPOSE' | 'REPLACE';

type LocalCylinderRow = {
  serial: string;
  cylinder_type_code: string;
  status: CylinderStatus;
  location_id: string;
  ownership: string;
  updated_at: string;
};

type LocalServiceActionRow = {
  id: string;
  action_type: ActionType;
  source_serial: string | null;
  replacement_serial: string | null;
  branch_id: string | null;
  location_id: string | null;
  customer_id: string | null;
  sale_id: string | null;
  reason: string;
  notes: string | null;
  sync_status: string;
  created_at: string;
  updated_at: string;
};

type ServerServiceActionRow = {
  id: string;
  actionType: ActionType;
  sourceSerial: string | null;
  replacementSerial: string | null;
  branchId: string;
  locationId: string;
  customerId: string | null;
  saleId: string | null;
  reason: string;
  notes: string | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  branchCode: string | null;
  branchName: string | null;
  locationCode: string | null;
  locationName: string | null;
  sourceCylinderStatus: CylinderStatus | null;
  sourceCylinderLocationId: string | null;
  replacementCylinderStatus: CylinderStatus | null;
  replacementCylinderLocationId: string | null;
};

const env = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env;
const API_BASE_URL = normalizeApiBaseUrl(
  env?.EXPO_PUBLIC_API_BASE_URL ?? 'https://vmjamtech.com/api'
);

function fmtDate(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function statusTone(
  status: CylinderStatus,
  theme: AppTheme
): { bg: string; text: string; border: string } {
  if (status === 'FULL') {
    return { bg: theme.pillBg, text: theme.pillText, border: theme.cardBorder };
  }
  if (status === 'EMPTY') {
    return { bg: theme.inputBg, text: theme.subtext, border: theme.cardBorder };
  }
  if (status === 'DAMAGED') {
    return { bg: theme.dangerMuted, text: '#FFFFFF', border: theme.danger };
  }
  if (status === 'JUNKED') {
    return { bg: '#8A5A2B', text: '#FFFFFF', border: '#8A5A2B' };
  }
  if (status === 'DISPOSED') {
    return { bg: '#5B6775', text: '#FFFFFF', border: '#5B6775' };
  }
  return { bg: '#6D3B4A', text: '#FFFFFF', border: '#6D3B4A' };
}

function actionLabel(value: ActionType): string {
  if (value === 'JUNK') return 'Moved To Junk';
  if (value === 'DISPOSE') return 'Disposed';
  return 'Replaced';
}

function normalizeServerAction(row: ServerServiceActionRow): LocalServiceActionRow {
  return {
    id: row.id,
    action_type: row.actionType,
    source_serial: row.sourceSerial,
    replacement_serial: row.replacementSerial,
    branch_id: row.branchId,
    location_id: row.locationId,
    customer_id: row.customerId,
    sale_id: row.saleId,
    reason: row.reason,
    notes: row.notes,
    sync_status: 'synced',
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

export function CylindersScreen({
  db,
  theme,
  preferredBranchId,
  preferredLocationId,
  onDataChanged,
  syncBusy = false
}: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | CylinderStatus>('ALL');
  const [rows, setRows] = useState<LocalCylinderRow[]>([]);
  const [actions, setActions] = useState<LocalServiceActionRow[]>([]);
  const [locationOptions, setLocationOptions] = useState<MasterDataOption[]>([]);
  const [selected, setSelected] = useState<LocalCylinderRow | null>(null);
  const [actionModal, setActionModal] = useState<null | 'JUNK' | 'DISPOSE' | 'REPLACE'>(null);
  const [replacementSerial, setReplacementSerial] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const workflowService = useMemo(() => new OfflineCylinderWorkflowService(db), [db]);

  const apiRequest = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const session = new LocalSessionService(db);
      await session.initializeFromStorage();
      const transport = new HttpAuthTransport({ baseUrl: API_BASE_URL });
      const accessToken = await session.getAccessToken();
      if (!accessToken) {
        throw new Error('No active access token. Please sign in again.');
      }

      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${accessToken}`);
      headers.set('Content-Type', 'application/json');

      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Request failed (${response.status})`);
      }

      return (await response.json()) as T;
    },
    [db]
  );

  const loadServerActions = useCallback(async (): Promise<LocalServiceActionRow[]> => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '160');
      if (preferredBranchId) {
        params.set('branch_id', preferredBranchId);
      }
      const remoteRows = await apiRequest<ServerServiceActionRow[]>(
        `/cylinders/service-actions?${params.toString()}`
      );
      return remoteRows.map(normalizeServerAction);
    } catch {
      return [];
    }
  }, [apiRequest, preferredBranchId]);

  const loadLocalData = useCallback(async (): Promise<{
    cylinders: LocalCylinderRow[];
    actions: LocalServiceActionRow[];
  }> => {
    const [cylinderRows, locationRows, localServiceActions, remoteServiceActions] = await Promise.all([
      db.getAllAsync<LocalCylinderRow>(
        `
        SELECT serial, cylinder_type_code, status, location_id, ownership, updated_at
        FROM cylinders_local
        ORDER BY updated_at DESC, serial ASC
        `
      ),
      loadLocationOptions(db),
      workflowService.listLocalServiceActions(120),
      loadServerActions()
    ]);
    const mergedActionMap = new Map<string, LocalServiceActionRow>();
    for (const row of remoteServiceActions) {
      mergedActionMap.set(row.id, row);
    }
    for (const row of localServiceActions) {
      const existing = mergedActionMap.get(row.id);
      if (!existing || row.sync_status !== 'synced') {
        mergedActionMap.set(row.id, row);
      }
    }
    const mergedActions = [...mergedActionMap.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    );
    setRows(cylinderRows);
    setLocationOptions(locationRows);
    setActions(mergedActions);
    return {
      cylinders: cylinderRows,
      actions: mergedActions
    };
  }, [db, loadServerActions, workflowService]);

  useEffect(() => {
    void loadLocalData();
  }, [loadLocalData]);

  const locationMap = useMemo(
    () => new Map(locationOptions.map((row) => [row.id, row])),
    [locationOptions]
  );

  const branchLocationIds = useMemo(() => {
    if (!preferredBranchId) {
      return null;
    }
    return new Set(
      locationOptions.filter((row) => row.branchId === preferredBranchId).map((row) => row.id)
    );
  }, [locationOptions, preferredBranchId]);

  const filteredRows = useMemo(() => {
    const search = normalize(query);
    return rows
      .filter((row) => (statusFilter === 'ALL' ? true : row.status === statusFilter))
      .filter((row) => (branchLocationIds ? branchLocationIds.has(row.location_id) : true))
      .filter((row) => {
        if (!search) return true;
        const locationLabel = locationMap.get(row.location_id)?.label ?? row.location_id;
        return `${row.serial} ${row.cylinder_type_code} ${row.status} ${locationLabel}`
          .toLowerCase()
          .includes(search);
      });
  }, [rows, statusFilter, branchLocationIds, query, locationMap]);

  const selectedActions = useMemo(() => {
    if (!selected) return [];
    return actions.filter(
      (row) =>
        row.source_serial === selected.serial || row.replacement_serial === selected.serial
    );
  }, [actions, selected]);

  const replacementCandidates = useMemo(() => {
    if (!selected) return [];
    return rows.filter((row) => {
      if (row.serial === selected.serial) return false;
      if (row.status !== 'FULL') return false;
      if (branchLocationIds && !branchLocationIds.has(row.location_id)) return false;
      return true;
    });
  }, [rows, selected, branchLocationIds]);

  const selectedLocationLabel = selected
    ? locationMap.get(selected.location_id)?.label ?? selected.location_id
    : '-';

  const canJunk =
    selected &&
    selected.status !== 'JUNKED' &&
    selected.status !== 'DISPOSED' &&
    selected.status !== 'LOST';
  const canDispose = selected && (selected.status === 'DAMAGED' || selected.status === 'JUNKED');
  const canReplace =
    selected &&
    selected.status !== 'DISPOSED' &&
    selected.status !== 'LOST' &&
    selected.status !== 'JUNKED';

  function resetActionState(nextAction: 'JUNK' | 'DISPOSE' | 'REPLACE'): void {
    setActionModal(nextAction);
    setReason('');
    setNotes('');
    setReplacementSerial(null);
  }

  async function handleSubmitAction(): Promise<void> {
    if (!selected || !actionModal || saving) {
      return;
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toastError(actionLabel(actionModal), 'Reason is required.');
      return;
    }

    setSaving(true);
    try {
      if (actionModal === 'JUNK') {
        await workflowService.junk({
          serial: selected.serial,
          branchId: preferredBranchId ?? null,
          reason: trimmedReason,
          notes: notes.trim() || null
        });
        toastSuccess('Junk queued', 'Cylinder marked as junk locally and queued for sync.');
      } else if (actionModal === 'DISPOSE') {
        await workflowService.dispose({
          serial: selected.serial,
          branchId: preferredBranchId ?? null,
          reason: trimmedReason,
          notes: notes.trim() || null
        });
        toastSuccess('Dispose queued', 'Cylinder disposal was saved locally and queued for sync.');
      } else {
        if (!replacementSerial) {
          toastError('Replace Cylinder', 'Choose a replacement cylinder first.');
          return;
        }
        const replacement = replacementCandidates.find((row) => row.serial === replacementSerial);
        if (!replacement) {
          toastError('Replace Cylinder', 'Replacement cylinder could not be found.');
          return;
        }
        const fromLocationId = preferredLocationId ?? replacement.location_id;
        await workflowService.replace({
          sourceSerial: selected.serial,
          replacementSerial,
          fromLocationId,
          toLocationId: selected.location_id,
          branchId: preferredBranchId ?? null,
          reason: trimmedReason,
          notes: notes.trim() || null
        });
        toastSuccess('Replace queued', 'Cylinder replacement was saved locally and queued for sync.');
      }

      setActionModal(null);
      const refreshed = await loadLocalData();
      setSelected(refreshed.cylinders.find((row) => row.serial === selected.serial) ?? null);
      await onDataChanged?.();
      if (!syncBusy) {
        toastInfo('Sync Reminder', 'Sync when ready to post the queued cylinder action to the server.');
      }
    } catch (error) {
      toastError(
        actionLabel(actionModal),
        error instanceof Error ? error.message : 'Action failed.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.screen, { backgroundColor: theme.background }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.hero, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <Text style={[styles.heroTitle, { color: theme.heading }]}>Cylinders</Text>
        <Text style={[styles.heroSub, { color: theme.subtext }]}>
          Review serial cylinders, open each detail card, and queue junk, dispose, or replace actions even while offline.
        </Text>
      </View>

      <View style={[styles.filtersCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by serial, type code, or location"
          placeholderTextColor={theme.inputPlaceholder}
          style={[
            styles.searchInput,
            {
              backgroundColor: theme.inputBg,
              color: theme.inputText,
              borderColor: theme.cardBorder
            }
          ]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {(['ALL', 'FULL', 'EMPTY', 'DAMAGED', 'JUNKED', 'DISPOSED', 'LOST'] as const).map((value) => {
            const active = statusFilter === value;
            return (
              <Pressable
                key={value}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? theme.primary : theme.pillBg,
                    borderColor: active ? theme.primary : theme.cardBorder
                  }
                ]}
                onPress={() => setStatusFilter(value)}
              >
                <Text style={[styles.chipText, { color: active ? '#FFFFFF' : theme.pillText }]}>
                  {value}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.listGap}>
        {filteredRows.map((row) => {
          const locationLabel = locationMap.get(row.location_id)?.label ?? row.location_id;
          const tone = statusTone(row.status, theme);
          const pendingCount = actions.filter(
            (entry) =>
              entry.sync_status !== 'synced' &&
              (entry.source_serial === row.serial || entry.replacement_serial === row.serial)
          ).length;
          return (
            <Pressable
              key={row.serial}
              style={[styles.rowCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}
              onPress={() => setSelected(row)}
            >
              <View style={styles.rowHead}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: theme.heading }]}>{row.serial}</Text>
                  <Text style={[styles.rowSub, { color: theme.subtext }]}>
                    {row.cylinder_type_code} • {locationLabel}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                  <Text style={[styles.statusBadgeText, { color: tone.text }]}>{row.status}</Text>
                </View>
              </View>
              <View style={styles.rowMeta}>
                <Text style={[styles.rowMetaText, { color: theme.subtext }]}>
                  Updated {fmtDate(row.updated_at)}
                </Text>
                {pendingCount > 0 ? (
                  <Text style={[styles.rowMetaText, { color: theme.primary }]}>
                    {pendingCount} queued
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
        {filteredRows.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[styles.emptyTitle, { color: theme.heading }]}>No cylinders found</Text>
            <Text style={[styles.emptySub, { color: theme.subtext }]}>
              Try another search or switch the status filter.
            </Text>
          </View>
        ) : null}
      </View>

      <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalDismiss} onPress={() => setSelected(null)} />
          <View style={[styles.modalCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            {selected ? (
              <>
                <View style={styles.modalHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modalTitle, { color: theme.heading }]}>{selected.serial}</Text>
                    <Text style={[styles.modalSub, { color: theme.subtext }]}>
                      {selected.cylinder_type_code} • {selectedLocationLabel}
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.closeBtn, { backgroundColor: theme.pillBg, borderColor: theme.cardBorder }]}
                    onPress={() => setSelected(null)}
                  >
                    <Text style={[styles.closeBtnText, { color: theme.pillText }]}>Close</Text>
                  </Pressable>
                </View>

                <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
                  <View style={[styles.detailCard, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder }]}>
                    <Text style={[styles.detailLabel, { color: theme.subtext }]}>Status</Text>
                    <Text style={[styles.detailValue, { color: theme.heading }]}>{selected.status}</Text>
                    <Text style={[styles.detailLabel, { color: theme.subtext }]}>Location</Text>
                    <Text style={[styles.detailValue, { color: theme.heading }]}>{selectedLocationLabel}</Text>
                    <Text style={[styles.detailLabel, { color: theme.subtext }]}>Last Updated</Text>
                    <Text style={[styles.detailValue, { color: theme.heading }]}>{fmtDate(selected.updated_at)}</Text>
                  </View>

                  <View style={styles.actionRow}>
                    <Pressable
                      style={[
                        styles.actionBtn,
                        {
                          backgroundColor: canJunk ? theme.primary : theme.primaryMuted,
                          borderColor: theme.cardBorder,
                          opacity: canJunk ? 1 : 0.6
                        }
                      ]}
                      onPress={() => resetActionState('JUNK')}
                      disabled={!canJunk}
                    >
                      <Text style={styles.actionBtnText}>Move To Junk</Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.actionBtn,
                        {
                          backgroundColor: canDispose ? theme.danger : theme.dangerMuted,
                          borderColor: theme.cardBorder,
                          opacity: canDispose ? 1 : 0.6
                        }
                      ]}
                      onPress={() => resetActionState('DISPOSE')}
                      disabled={!canDispose}
                    >
                      <Text style={styles.actionBtnText}>Dispose</Text>
                    </Pressable>
                  </View>

                  <Pressable
                    style={[
                      styles.fullWidthAction,
                      {
                        backgroundColor: canReplace ? theme.pillBg : theme.inputBg,
                        borderColor: theme.cardBorder,
                        opacity: canReplace ? 1 : 0.6
                      }
                    ]}
                    onPress={() => resetActionState('REPLACE')}
                    disabled={!canReplace}
                  >
                    <Text style={[styles.fullWidthActionText, { color: theme.pillText }]}>
                      Replace Cylinder
                    </Text>
                    <Text style={[styles.fullWidthActionSub, { color: theme.subtext }]}>
                      Use a FULL branch cylinder as the replacement and queue it for sync.
                    </Text>
                  </Pressable>

                  <Text style={[styles.sectionTitle, { color: theme.heading }]}>Recent Activity</Text>
                  {selectedActions.length === 0 ? (
                    <View style={[styles.detailCard, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder }]}>
                      <Text style={[styles.detailValue, { color: theme.subtext }]}>
                        No cylinder service activity yet for this serial.
                      </Text>
                    </View>
                  ) : (
                    selectedActions.map((row) => (
                      <View
                        key={row.id}
                        style={[styles.historyCard, { backgroundColor: theme.inputBg, borderColor: theme.cardBorder }]}
                      >
                        <View style={styles.rowHead}>
                          <Text style={[styles.historyTitle, { color: theme.heading }]}>
                            {actionLabel(row.action_type)}
                          </Text>
                          <Text style={[styles.historySync, { color: row.sync_status === 'synced' ? theme.primary : theme.subtext }]}>
                            {row.sync_status}
                          </Text>
                        </View>
                        <Text style={[styles.historyLine, { color: theme.subtext }]}>
                          {fmtDate(row.created_at)}
                        </Text>
                        <Text style={[styles.historyLine, { color: theme.subtext }]}>
                          Reason: {row.reason}
                        </Text>
                        {row.replacement_serial ? (
                          <Text style={[styles.historyLine, { color: theme.subtext }]}>
                            Replacement: {row.replacement_serial}
                          </Text>
                        ) : null}
                      </View>
                    ))
                  )}
                </ScrollView>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal visible={actionModal !== null} transparent animationType="fade" onRequestClose={() => setActionModal(null)}>
        <View style={styles.centerOverlay}>
          <Pressable style={styles.centerDismiss} onPress={() => setActionModal(null)} />
          <View style={[styles.centerCard, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
            <Text style={[styles.modalTitle, { color: theme.heading }]}>
              {actionModal ? actionLabel(actionModal) : 'Cylinder Action'}
            </Text>
            <Text style={[styles.modalSub, { color: theme.subtext }]}>
              This action is saved locally first and will sync to the server later.
            </Text>

            {actionModal === 'REPLACE' ? (
              <View style={{ gap: 8 }}>
                <Text style={[styles.fieldLabel, { color: theme.heading }]}>Replacement Cylinder</Text>
                <ScrollView style={styles.replacementList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {replacementCandidates.map((row) => {
                    const active = replacementSerial === row.serial;
                    const locationLabel = locationMap.get(row.location_id)?.label ?? row.location_id;
                    return (
                      <Pressable
                        key={row.serial}
                        style={[
                          styles.replacementRow,
                          {
                            backgroundColor: active ? theme.primary : theme.inputBg,
                            borderColor: active ? theme.primary : theme.cardBorder
                          }
                        ]}
                        onPress={() => setReplacementSerial(row.serial)}
                      >
                        <Text style={[styles.replacementTitle, { color: active ? '#FFFFFF' : theme.heading }]}>
                          {row.serial}
                        </Text>
                        <Text style={[styles.replacementSub, { color: active ? '#FFFFFF' : theme.subtext }]}>
                          {row.cylinder_type_code} • {locationLabel}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            <Text style={[styles.fieldLabel, { color: theme.heading }]}>Reason</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Why is this action needed?"
              placeholderTextColor={theme.inputPlaceholder}
              style={[
                styles.textInput,
                { backgroundColor: theme.inputBg, color: theme.inputText, borderColor: theme.cardBorder }
              ]}
            />

            <Text style={[styles.fieldLabel, { color: theme.heading }]}>Notes</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes"
              placeholderTextColor={theme.inputPlaceholder}
              multiline
              style={[
                styles.notesInput,
                { backgroundColor: theme.inputBg, color: theme.inputText, borderColor: theme.cardBorder }
              ]}
            />

            <View style={styles.dialogActions}>
              <Pressable
                style={[styles.dialogBtn, { backgroundColor: theme.pillBg, borderColor: theme.cardBorder }]}
                onPress={() => setActionModal(null)}
              >
                <Text style={[styles.dialogBtnText, { color: theme.pillText }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.dialogBtn,
                  {
                    backgroundColor: actionModal === 'DISPOSE' ? theme.danger : theme.primary,
                    borderColor: theme.cardBorder,
                    opacity: saving ? 0.7 : 1
                  }
                ]}
                onPress={() => void handleSubmitAction()}
                disabled={saving}
              >
                <Text style={styles.actionBtnText}>{saving ? 'Saving...' : 'Save Action'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 10
  },
  hero: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 4
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800'
  },
  heroSub: {
    fontSize: 12,
    lineHeight: 18
  },
  filtersCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    gap: 10
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    fontSize: 14
  },
  chipRow: {
    gap: 8,
    paddingRight: 12
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  chipText: {
    fontSize: 12,
    fontWeight: '700'
  },
  listGap: {
    gap: 8
  },
  rowCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '800'
  },
  rowSub: {
    marginTop: 2,
    fontSize: 12
  },
  rowMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8
  },
  rowMetaText: {
    fontSize: 11,
    fontWeight: '600'
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800'
  },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 4
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800'
  },
  emptySub: {
    fontSize: 12
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
    justifyContent: 'flex-end'
  },
  modalDismiss: {
    flex: 1
  },
  modalCard: {
    height: '90%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 16
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800'
  },
  modalSub: {
    fontSize: 12,
    lineHeight: 18
  },
  closeBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '700'
  },
  modalScroll: {
    flex: 1
  },
  modalBody: {
    paddingBottom: 24,
    gap: 10
  },
  detailCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '700'
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '700'
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8
  },
  actionBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800'
  },
  fullWidthAction: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4
  },
  fullWidthActionText: {
    fontSize: 14,
    fontWeight: '800'
  },
  fullWidthActionSub: {
    fontSize: 12
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800'
  },
  historyCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 4
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '800'
  },
  historySync: {
    fontSize: 11,
    fontWeight: '700'
  },
  historyLine: {
    fontSize: 12
  },
  centerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 23, 0.55)',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  centerDismiss: {
    ...StyleSheet.absoluteFillObject
  },
  centerCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 10,
    maxHeight: '80%'
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700'
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    fontSize: 14
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 96,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    fontSize: 14
  },
  replacementList: {
    maxHeight: 180
  },
  replacementRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8
  },
  replacementTitle: {
    fontSize: 13,
    fontWeight: '800'
  },
  replacementSub: {
    fontSize: 12,
    marginTop: 2
  },
  dialogActions: {
    flexDirection: 'row',
    gap: 8
  },
  dialogBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dialogBtnText: {
    fontSize: 13,
    fontWeight: '800'
  }
});
