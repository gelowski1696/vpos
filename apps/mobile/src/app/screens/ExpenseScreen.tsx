import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import { toastError, toastSuccess } from '../goey-toast';
import type { AppTheme } from '../theme';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { loadExpenseCategoryOptions, type MasterDataOption } from '../master-data-local';
import { useTutorialTarget } from '../tutorial/tutorial-provider';

type ShiftRow = {
  id: string;
  payload: string;
  created_at: string;
};

type ShiftPayload = {
  status?: string;
  opened_at?: string;
};

type ShiftOption = MasterDataOption & {
  status?: string;
};

type PettyCashRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
};

type PettyCashPayload = {
  shift_id?: string;
  category_code?: string;
  direction?: 'IN' | 'OUT';
  amount?: number;
  notes?: string | null;
  created_at?: string;
};

type ParsedEntry = {
  id: string;
  direction: 'IN' | 'OUT';
  amount: number;
  shiftId: string;
  categoryCode: string;
  notes: string;
  createdAt: string;
  syncStatus: string;
};

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  onDataChanged?: () => Promise<void> | void;
  syncBusy?: boolean;
};

function parsePayload<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return {} as T;
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

function fmtMoney(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `PHP ${safe.toFixed(2)}`;
}

export function ExpenseScreen({ db, theme, onDataChanged, syncBusy = false }: Props): JSX.Element {
  const tutorialCreate = useTutorialTarget('expense-create');
  const tutorialFilter = useTutorialTarget('expense-filter');
  const [categoryCode, setCategoryCode] = useState('');
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [amount, setAmount] = useState('0');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [shiftOptions, setShiftOptions] = useState<ShiftOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<MasterDataOption[]>([]);
  const [rows, setRows] = useState<PettyCashRow[]>([]);
  const [entryFilter, setEntryFilter] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const prevSyncBusyRef = useRef(syncBusy);

  const parsedAmount = Number(amount || '0');
  const quickAmountOptions = ['100', '200', '500', '1000'];

  const openShiftOptions = useMemo(
    () => shiftOptions.filter((option) => option.status === 'open'),
    [shiftOptions]
  );
  const activeShift = openShiftOptions[0] ?? null;

  const parsedEntries = useMemo<ParsedEntry[]>(() => {
    return rows.map((row) => {
      const payload = parsePayload<PettyCashPayload>(row.payload);
      const directionValue = (payload.direction ?? 'OUT').toUpperCase() === 'IN' ? 'IN' : 'OUT';
      const amountValue = Number(payload.amount ?? 0);
      return {
        id: row.id,
        direction: directionValue,
        amount: Number.isFinite(amountValue) ? Number(amountValue.toFixed(2)) : 0,
        shiftId: payload.shift_id?.trim() || '-',
        categoryCode: payload.category_code?.trim() || '-',
        notes: payload.notes?.trim() || '',
        createdAt: payload.created_at || row.created_at,
        syncStatus: row.sync_status
      };
    });
  }, [rows]);

  const filteredEntries = useMemo(() => {
    if (entryFilter === 'ALL') {
      return parsedEntries;
    }
    return parsedEntries.filter((entry) => entry.direction === entryFilter);
  }, [entryFilter, parsedEntries]);

  const totals = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    for (const row of parsedEntries) {
      if (row.direction === 'IN') {
        totalIn += row.amount;
      } else {
        totalOut += row.amount;
      }
    }
    return {
      totalIn: Number(totalIn.toFixed(2)),
      totalOut: Number(totalOut.toFixed(2))
    };
  }, [parsedEntries]);

  const pendingCount = useMemo(
    () => parsedEntries.filter((entry) => entry.syncStatus.trim().toLowerCase() !== 'synced').length,
    [parsedEntries]
  );

  const selectedCategory = useMemo(
    () => categoryOptions.find((option) => option.id === categoryCode) ?? null,
    [categoryCode, categoryOptions]
  );

  const filteredCategoryOptions = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();
    if (!query) {
      return categoryOptions.slice(0, 80);
    }
    return categoryOptions
      .filter((option) => `${option.label} ${option.subtitle ?? ''} ${option.id}`.toLowerCase().includes(query))
      .slice(0, 80);
  }, [categoryOptions, categorySearch]);

  const refresh = async (): Promise<void> => {
    const [shiftRows, categories, pettyRows] = await Promise.all([
      db.getAllAsync<ShiftRow>(
        `
        SELECT id, payload, created_at
        FROM shifts_local
        ORDER BY created_at DESC
        LIMIT 80
        `
      ),
      loadExpenseCategoryOptions(db),
      db.getAllAsync<PettyCashRow>(
        `
        SELECT id, payload, sync_status, created_at
        FROM petty_cash_local
        ORDER BY created_at DESC
        LIMIT 60
        `
      )
    ]);

    const nextShiftOptions: ShiftOption[] = shiftRows.map((row) => {
      const payload = parsePayload<ShiftPayload>(row.payload);
      const status = (payload.status ?? '').toLowerCase();
      return {
        id: row.id,
        label: row.id,
        subtitle: `${status || 'unknown'} | ${fmtDate(payload.opened_at ?? row.created_at)}`,
        status
      };
    });

    setShiftOptions(nextShiftOptions);
    setCategoryOptions(categories);
    setRows(pettyRows);

    setCategoryCode((current) => {
      if (current && categories.some((option) => option.id === current)) {
        return current;
      }
      return '';
    });
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (prevSyncBusyRef.current && !syncBusy) {
      void refresh();
    }
    prevSyncBusyRef.current = syncBusy;
  }, [syncBusy]);

  const resetEntryDraft = (): void => {
    setCategoryCode('');
    setDirection('OUT');
    setAmount('0');
    setNotes('');
    setCategorySearch('');
  };

  const openCreateModal = (): void => {
    resetEntryDraft();
    setEntryModalOpen(true);
  };

  const closeCreateModal = (): void => {
    if (saving) {
      return;
    }
    setEntryModalOpen(false);
    setCategoryModalOpen(false);
  };

  const createEntry = async (): Promise<void> => {
    if (!activeShift?.id) {
      toastError('Petty Cash', 'No active open shift. Start duty first.');
      return;
    }
    if (!categoryCode.trim()) {
      toastError('Petty Cash', 'Expense category is required.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toastError('Petty Cash', 'Amount must be greater than zero.');
      return;
    }

    setSaving(true);
    try {
      const service = new OfflineTransactionService(db);
      const id = await service.createOfflinePettyCash({
        shiftId: activeShift.id,
        categoryCode: categoryCode.trim(),
        direction,
        amount: parsedAmount,
        notes: notes.trim() || undefined
      });
      toastSuccess('Petty cash queued', `${direction} ${parsedAmount.toFixed(2)} | ${id}`);
      setEntryModalOpen(false);
      setCategoryModalOpen(false);
      resetEntryDraft();
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unable to queue petty cash entry.';
      toastError('Petty cash failed', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}> 
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.heading }]}>Expense / Petty Cash</Text>
          <Text style={[styles.sub, { color: theme.subtext }]}>Cash in/out entries with active-shift control and offline queue.</Text>
        </View>
        <Pressable
          style={[styles.refreshBtn, { backgroundColor: saving || syncBusy ? theme.primaryMuted : theme.primary }]}
          onPress={() => void refresh()}
          disabled={saving || syncBusy}
        >
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}> 
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Open Shifts</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>{openShiftOptions.length}</Text>
        </View>
        <View style={[styles.kpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}> 
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Pending Sync</Text>
          <Text style={[styles.kpiValue, { color: pendingCount > 0 ? theme.danger : theme.heading }]}>{pendingCount}</Text>
        </View>
        <View style={[styles.kpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}> 
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Local Entries</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>{parsedEntries.length}</Text>
        </View>
      </View>

      <View style={[styles.netCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}> 
        <View style={{ flex: 1 }}>
          <Text style={[styles.netLabel, { color: theme.subtext }]}>Cash IN</Text>
          <Text style={[styles.netInValue, { color: theme.primary }]}>{fmtMoney(totals.totalIn)}</Text>
        </View>
        <View style={styles.netDivider} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.netLabel, { color: theme.subtext }]}>Cash OUT</Text>
          <Text style={[styles.netOutValue, { color: theme.danger }]}>{fmtMoney(totals.totalOut)}</Text>
        </View>
      </View>

      <View style={[styles.activeShiftCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}> 
        <Text style={[styles.activeShiftLabel, { color: theme.subtext }]}>Active Shift (Read-only)</Text>
        <Text style={[styles.activeShiftValue, { color: activeShift ? theme.heading : theme.danger }]}> 
          {activeShift ? activeShift.label : 'No open shift'}
        </Text>
        <Text style={[styles.activeShiftHint, { color: theme.subtext }]}> 
          Shift is locked to the currently open duty and is not selectable here.
        </Text>
      </View>

      <View ref={tutorialCreate.ref} onLayout={tutorialCreate.onLayout}>
        <Pressable
          style={[
            styles.primaryBtn,
            {
              backgroundColor: saving || syncBusy || !activeShift ? theme.primaryMuted : theme.primary
            },
            tutorialCreate.active ? styles.tutorialTargetFocus : null
          ]}
          onPress={openCreateModal}
          disabled={saving || syncBusy || !activeShift}
        >
          <Text style={styles.primaryText}>Create Petty Cash Entry</Text>
        </Pressable>
      </View>

      <View style={[styles.block, { borderColor: theme.cardBorder }]}> 
        <View style={styles.blockHead}>
          <Text style={[styles.blockTitle, { color: theme.heading }]}>Recent Local Entries</Text>
          <View ref={tutorialFilter.ref} onLayout={tutorialFilter.onLayout} style={styles.filterRow}>
            {(['ALL', 'OUT', 'IN'] as const).map((value) => {
              const selected = entryFilter === value;
              return (
                <Pressable
                  key={value}
                  style={[
                    styles.filterChip,
                    { backgroundColor: selected ? theme.pillActive : theme.pillBg },
                    tutorialFilter.active ? styles.tutorialTargetFocus : null
                  ]}
                  onPress={() => setEntryFilter(value)}
                >
                  <Text style={[styles.filterChipText, { color: selected ? '#FFFFFF' : theme.pillText }]}>{value}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {filteredEntries.length === 0 ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>No local petty cash entries yet.</Text>
        ) : (
          filteredEntries.slice(0, 12).map((entry) => {
            const isOut = entry.direction === 'OUT';
            return (
              <View key={entry.id} style={[styles.entryCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}> 
                <View style={styles.entryTop}>
                  <View style={[styles.entryDirectionBadge, { backgroundColor: isOut ? theme.dangerMuted : theme.primaryMuted }]}> 
                    <Text style={styles.entryDirectionText}>{entry.direction}</Text>
                  </View>
                  <Text style={[styles.entryAmount, { color: isOut ? theme.danger : theme.primary }]}>{fmtMoney(entry.amount)}</Text>
                  <SyncStatusBadge status={entry.syncStatus} />
                </View>
                <Text style={[styles.itemMetaStrong, { color: theme.heading }]}>
                  {entry.categoryCode} | Shift {entry.shiftId}
                </Text>
                <Text style={[styles.itemMeta, { color: theme.subtext }]}>{fmtDate(entry.createdAt)}</Text>
                {entry.notes ? (
                  <Text numberOfLines={2} style={[styles.itemMeta, { color: theme.subtext }]}>Note: {entry.notes}</Text>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      <Modal visible={entryModalOpen} transparent animationType='slide' onRequestClose={closeCreateModal}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeCreateModal} />
          <View style={[styles.modalCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}> 
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: theme.heading }]}>New Petty Cash Entry</Text>
                <Text style={[styles.modalSub, { color: theme.subtext }]}>Queue one cash movement entry.</Text>
              </View>
              <Pressable
                style={[styles.modalClose, { borderColor: theme.cardBorder, backgroundColor: theme.pillBg }]}
                onPress={closeCreateModal}
                disabled={saving}
              >
                <Text style={[styles.modalCloseText, { color: theme.pillText }]}>Close</Text>
              </Pressable>
            </View>

            <View style={[styles.modalShiftCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}> 
              <Text style={[styles.modalShiftLabel, { color: theme.subtext }]}>Active Shift</Text>
              <Text style={[styles.modalShiftValue, { color: activeShift ? theme.heading : theme.danger }]}> 
                {activeShift?.label ?? 'No open shift'}
              </Text>
            </View>

            <Pressable
              style={[styles.selectTrigger, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}
              onPress={() => {
                if (!saving && categoryOptions.length > 0) {
                  setCategorySearch('');
                  setCategoryModalOpen(true);
                }
              }}
              disabled={saving || categoryOptions.length === 0}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.selectLabel, { color: theme.subtext }]}>Expense Category</Text>
                <Text style={[styles.selectValue, { color: selectedCategory ? theme.heading : theme.inputPlaceholder }]}>
                  {selectedCategory ? selectedCategory.label : categoryOptions.length ? 'Select expense category' : 'No category available'}
                </Text>
                {selectedCategory?.subtitle ? (
                  <Text style={[styles.selectSub, { color: theme.subtext }]}>{selectedCategory.subtitle}</Text>
                ) : null}
              </View>
              <Text style={[styles.selectChevron, { color: theme.subtext }]}>{'>'}</Text>
            </Pressable>

            <View style={styles.row}>
              {(['OUT', 'IN'] as const).map((value) => {
                const selected = direction === value;
                const isOut = value === 'OUT';
                return (
                  <Pressable
                    key={value}
                    style={[
                      styles.directionPill,
                      {
                        backgroundColor: selected ? (isOut ? theme.danger : theme.primary) : theme.inputBg,
                        borderColor: selected ? 'transparent' : theme.cardBorder
                      }
                    ]}
                    onPress={() => setDirection(value)}
                    disabled={saving}
                  >
                    <Text style={[styles.directionTitle, { color: selected ? '#FFFFFF' : theme.heading }]}>{value === 'OUT' ? 'Cash Out' : 'Cash In'}</Text>
                    <Text style={[styles.directionSub, { color: selected ? '#FFFFFF' : theme.subtext }]}>{value === 'OUT' ? 'Expense' : 'Replenish'}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={[styles.amountCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}> 
              <Text style={[styles.amountLabel, { color: theme.subtext }]}>Amount</Text>
              <View style={styles.amountInputRow}>
                <Text style={[styles.amountPrefix, { color: theme.subtext }]}>PHP</Text>
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType='numeric'
                  placeholder='0.00'
                  placeholderTextColor={theme.inputPlaceholder}
                  style={[styles.amountInput, { color: theme.inputText }]}
                />
              </View>
              <View style={styles.quickRow}>
                {quickAmountOptions.map((quick) => (
                  <Pressable
                    key={quick}
                    style={[styles.quickChip, { backgroundColor: theme.pillBg }]}
                    onPress={() => setAmount(quick)}
                    disabled={saving}
                  >
                    <Text style={[styles.quickChipText, { color: theme.pillText }]}>+{quick}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder='Reference or note (optional)'
              placeholderTextColor={theme.inputPlaceholder}
              multiline
              style={[styles.notesInput, { backgroundColor: theme.inputBg, color: theme.inputText, borderColor: theme.cardBorder }]}
            />

            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtnSecondary, { borderColor: theme.cardBorder, backgroundColor: theme.pillBg }]}
                onPress={closeCreateModal}
                disabled={saving}
              >
                <Text style={[styles.modalBtnSecondaryText, { color: theme.pillText }]}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.modalBtnPrimary,
                  {
                    backgroundColor:
                      saving || !activeShift || !categoryCode.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0
                        ? theme.primaryMuted
                        : direction === 'OUT'
                          ? theme.danger
                          : theme.primary
                  }
                ]}
                onPress={() => void createEntry()}
                disabled={
                  saving || !activeShift || !categoryCode.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0
                }
              >
                <Text style={styles.modalBtnPrimaryText}>{saving ? 'Queueing...' : 'Queue Entry'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={categoryModalOpen} transparent animationType='fade' onRequestClose={() => setCategoryModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setCategoryModalOpen(false)} />
          <View style={[styles.pickerCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}> 
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: theme.heading }]}>Select Expense Category</Text>
              <Pressable
                style={[styles.modalClose, { borderColor: theme.cardBorder, backgroundColor: theme.pillBg }]}
                onPress={() => setCategoryModalOpen(false)}
              >
                <Text style={[styles.modalCloseText, { color: theme.pillText }]}>Close</Text>
              </Pressable>
            </View>

            <TextInput
              value={categorySearch}
              onChangeText={setCategorySearch}
              placeholder='Search category...'
              placeholderTextColor={theme.inputPlaceholder}
              style={[styles.searchInput, { backgroundColor: theme.inputBg, color: theme.inputText, borderColor: theme.cardBorder }]}
            />

            <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
              {filteredCategoryOptions.length === 0 ? (
                <Text style={[styles.sub, { color: theme.subtext }]}>No matching category.</Text>
              ) : (
                filteredCategoryOptions.map((option) => {
                  const selected = option.id === categoryCode;
                  return (
                    <Pressable
                      key={option.id}
                      style={[
                        styles.pickerItem,
                        {
                          borderColor: theme.cardBorder,
                          backgroundColor: selected ? theme.pillBg : theme.inputBg
                        }
                      ]}
                      onPress={() => {
                        setCategoryCode(option.id);
                        setCategoryModalOpen(false);
                      }}
                    >
                      <Text style={[styles.pickerItemTitle, { color: theme.heading }]}>{option.label}</Text>
                      {option.subtitle ? (
                        <Text style={[styles.pickerItemSub, { color: theme.subtext }]}>{option.subtitle}</Text>
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
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
    gap: 10
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  title: {
    fontSize: 18,
    fontWeight: '700'
  },
  sub: {
    fontSize: 13
  },
  refreshBtn: {
    minHeight: 38,
    minWidth: 86,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  refreshText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 8
  },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: '800'
  },
  netCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  netDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#9FB3C8'
  },
  netLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  netInValue: {
    fontSize: 16,
    fontWeight: '800'
  },
  netOutValue: {
    fontSize: 16,
    fontWeight: '800'
  },
  activeShiftCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3
  },
  activeShiftLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  activeShiftValue: {
    fontSize: 14,
    fontWeight: '800'
  },
  activeShiftHint: {
    fontSize: 11
  },
  primaryBtn: {
    minHeight: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center'
  },
  primaryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14
  },
  tutorialTargetFocus: {
    borderWidth: 2,
    borderColor: '#F59E0B',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6
  },
  block: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8
  },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '700'
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6
  },
  filterChip: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    justifyContent: 'center',
    alignItems: 'center'
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700'
  },
  entryCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4
  },
  entryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  entryDirectionBadge: {
    minHeight: 22,
    minWidth: 44,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  entryDirectionText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF'
  },
  entryAmount: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800'
  },
  itemMetaStrong: {
    fontSize: 12,
    fontWeight: '700'
  },
  itemMeta: {
    fontSize: 11
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end'
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 16, 28, 0.52)'
  },
  modalCard: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    maxHeight: '84%'
  },
  pickerCard: {
    marginHorizontal: 16,
    marginVertical: 80,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
    flex: 1
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800'
  },
  modalSub: {
    fontSize: 12
  },
  modalClose: {
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalCloseText: {
    fontSize: 12,
    fontWeight: '700'
  },
  modalShiftCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  modalShiftLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  modalShiftValue: {
    fontSize: 14,
    fontWeight: '800'
  },
  selectTrigger: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  selectLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  selectValue: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2
  },
  selectSub: {
    fontSize: 11,
    marginTop: 2
  },
  selectChevron: {
    fontSize: 18,
    fontWeight: '800'
  },
  row: {
    flexDirection: 'row',
    gap: 8
  },
  directionPill: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  directionTitle: {
    fontSize: 13,
    fontWeight: '800'
  },
  directionSub: {
    fontSize: 11,
    marginTop: 2
  },
  amountCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8
  },
  amountLabel: {
    fontSize: 11,
    fontWeight: '600'
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  amountPrefix: {
    fontSize: 14,
    fontWeight: '700'
  },
  amountInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    paddingVertical: 2
  },
  quickRow: {
    flexDirection: 'row',
    gap: 6
  },
  quickChip: {
    paddingHorizontal: 10,
    minHeight: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center'
  },
  quickChipText: {
    fontSize: 11,
    fontWeight: '700'
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    minHeight: 70,
    textAlignVertical: 'top'
  },
  modalActions: {
    flexDirection: 'row',
    gap: 8
  },
  modalBtnSecondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalBtnSecondaryText: {
    fontSize: 13,
    fontWeight: '700'
  },
  modalBtnPrimary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalBtnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700'
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13
  },
  pickerList: {
    flex: 1
  },
  pickerListContent: {
    gap: 8,
    paddingBottom: 8
  },
  pickerItem: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 2
  },
  pickerItemTitle: {
    fontSize: 13,
    fontWeight: '700'
  },
  pickerItemSub: {
    fontSize: 11
  }
});
