
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import { toastError, toastSuccess } from '../goey-toast';
import type { AppTheme } from '../theme';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { type MasterDataOption, loadBranchOptions, loadLocationOptions } from '../master-data-local';
import { LocalSessionService } from '../../features/auth/local-session.service';
import { useTutorialTarget } from '../tutorial/tutorial-provider';

type ShiftRow = { id: string; payload: string; sync_status: string; created_at: string };
type ShiftCashRow = { id: string; payload: string; sync_status: string; created_at: string };
type SaleRow = { id: string; payload: string; sync_status: string; created_at: string };
type CustomerPaymentRow = { id: string; payload: string; sync_status: string; created_at: string };
type PettyCashRow = { id: string; payload: string; sync_status: string; created_at: string };

type ShiftPayload = {
  status?: string;
  opening_cash?: number;
  closing_cash?: number;
  opened_at?: string;
};
type SalePayload = { payments?: Array<{ method?: string; amount?: number }> };
type ShiftCashPayload = { shift_id?: string; direction?: 'IN' | 'OUT' | string; amount?: number };
type CustomerPaymentPayload = { method?: string; amount?: number };
type PettyCashPayload = { shift_id?: string; direction?: 'IN' | 'OUT' | string; amount?: number };

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  preferredBranchId?: string;
  preferredLocationId?: string;
  onDataChanged?: () => Promise<void> | void;
  syncBusy?: boolean;
};

function parsePayload<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const atobFn = (globalThis as { atob?: (input: string) => string }).atob;
  if (!atobFn) {
    return null;
  }
  try {
    return atobFn(padded);
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  const decoded = decodeBase64Url(parts[1]);
  if (!decoded) {
    return null;
  }
  try {
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function fmtMoney(value: number): string {
  return `PHP ${round2(value).toFixed(2)}`;
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

function toTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

const FALLBACK_BRANCHES: MasterDataOption[] = [{ id: 'branch-main', label: 'Main Branch' }];
const FALLBACK_LOCATIONS: MasterDataOption[] = [{ id: 'loc-main', label: 'Main Store' }];

export function ShiftScreen({
  db,
  theme,
  preferredBranchId,
  preferredLocationId,
  onDataChanged,
  syncBusy = false
}: Props): JSX.Element {
  const tutorialStartDuty = useTutorialTarget('shift-start-duty');
  const tutorialEndDuty = useTutorialTarget('shift-end-duty');
  const tutorialCashAdjust = useTutorialTarget('shift-cash-adjust');
  const [branchId, setBranchId] = useState('branch-main');
  const [locationId, setLocationId] = useState('loc-main');
  const [userId, setUserId] = useState('');
  const [cashierLabel, setCashierLabel] = useState<string>('Unknown user');

  const [openingCash, setOpeningCash] = useState('0');
  const [closingCash, setClosingCash] = useState('0');
  const [cashDirection, setCashDirection] = useState<'IN' | 'OUT'>('OUT');
  const [cashAmount, setCashAmount] = useState('0');
  const [cashNotes, setCashNotes] = useState('');

  const [startModalOpen, setStartModalOpen] = useState(false);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [cashModalOpen, setCashModalOpen] = useState(false);

  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [cashEntries, setCashEntries] = useState<ShiftCashRow[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [customerPayments, setCustomerPayments] = useState<CustomerPaymentRow[]>([]);
  const [pettyCashEntries, setPettyCashEntries] = useState<PettyCashRow[]>([]);
  const [branches, setBranches] = useState<MasterDataOption[]>(FALLBACK_BRANCHES);
  const [locations, setLocations] = useState<MasterDataOption[]>(FALLBACK_LOCATIONS);
  const [saving, setSaving] = useState(false);
  const prevSyncBusyRef = useRef(syncBusy);
  const scopedLocations = useMemo(() => {
    const branchScoped = locations.filter((option) => !option.branchId || option.branchId === branchId);
    return branchScoped.length ? branchScoped : locations;
  }, [locations, branchId]);

  useEffect(() => {
    void refreshMasterData();
    void refresh();
    void resolveSessionUser();
  }, []);

  useEffect(() => {
    if (prevSyncBusyRef.current && !syncBusy) {
      void refresh();
      void refreshMasterData();
    }
    prevSyncBusyRef.current = syncBusy;
  }, [syncBusy]);

  useEffect(() => {
    if (!scopedLocations.length) {
      return;
    }
    if (scopedLocations.some((option) => option.id === locationId)) {
      return;
    }
    setLocationId(scopedLocations[0].id);
  }, [scopedLocations, locationId]);

  useEffect(() => {
    if (!preferredBranchId) {
      return;
    }
    if (!branches.some((option) => option.id === preferredBranchId)) {
      return;
    }
    setBranchId(preferredBranchId);
  }, [preferredBranchId, branches]);

  useEffect(() => {
    if (!preferredLocationId) {
      return;
    }
    if (!scopedLocations.some((option) => option.id === preferredLocationId)) {
      return;
    }
    setLocationId(preferredLocationId);
  }, [preferredLocationId, scopedLocations]);

  const refreshMasterData = async (): Promise<void> => {
    const [nextBranches, nextLocations] = await Promise.all([loadBranchOptions(db), loadLocationOptions(db)]);
    const branchOptions = nextBranches.length ? nextBranches : FALLBACK_BRANCHES;
    const locationOptions = nextLocations.length ? nextLocations : FALLBACK_LOCATIONS;

    setBranches(branchOptions);
    setLocations(locationOptions);

    setBranchId((current) => {
      if (preferredBranchId && branchOptions.some((option) => option.id === preferredBranchId)) {
        return preferredBranchId;
      }
      if (branchOptions.some((option) => option.id === current)) {
        return current;
      }
      return branchOptions[0].id;
    });

    setLocationId((current) => {
      if (preferredLocationId && locationOptions.some((option) => option.id === preferredLocationId)) {
        return preferredLocationId;
      }
      return locationOptions.some((option) => option.id === current) ? current : locationOptions[0].id;
    });
  };

  const resolveSessionUser = async (): Promise<void> => {
    const session = new LocalSessionService(db);
    await session.initializeFromStorage();
    const token = await session.getAccessToken();
    const payload = decodeJwtPayload(token);
    const nextUserId = typeof payload?.sub === 'string' ? payload.sub.trim() : '';
    const fullNameRaw =
      (typeof payload?.full_name === 'string' ? payload.full_name : '') ||
      (typeof payload?.name === 'string' ? payload.name : '');
    const email = typeof payload?.email === 'string' ? payload.email.trim() : '';
    setUserId(nextUserId);
    setCashierLabel((fullNameRaw || email || nextUserId || 'Unknown user').trim());
  };

  const refresh = async (): Promise<void> => {
    const [shiftRows, cashRows, saleRows, paymentRows, pettyRows] = await Promise.all([
      db.getAllAsync<ShiftRow>(
        `
        SELECT id, payload, sync_status, created_at
        FROM shifts_local
        ORDER BY created_at DESC
        LIMIT 50
        `
      ),
      db.getAllAsync<ShiftCashRow>(
        `
        SELECT id, payload, sync_status, created_at
        FROM shift_cash_entries_local
        ORDER BY created_at DESC
        LIMIT 200
        `
      ),
      db.getAllAsync<SaleRow>(
        `
        SELECT id, payload, sync_status, created_at
        FROM sales_local
        ORDER BY created_at DESC
        LIMIT 500
        `
      ),
      db.getAllAsync<CustomerPaymentRow>(
        `
        SELECT id, payload, sync_status, created_at
        FROM customer_payments_local
        ORDER BY created_at DESC
        LIMIT 500
        `
      ),
      db.getAllAsync<PettyCashRow>(
        `
        SELECT id, payload, sync_status, created_at
        FROM petty_cash_local
        ORDER BY created_at DESC
        LIMIT 200
        `
      )
    ]);

    setShifts(shiftRows);
    setCashEntries(cashRows);
    setSales(saleRows);
    setCustomerPayments(paymentRows);
    setPettyCashEntries(pettyRows);
  };
  const activeShift = useMemo(() => {
    for (const row of shifts) {
      const payload = parsePayload<ShiftPayload>(row.payload);
      if ((payload?.status ?? '').toLowerCase() === 'open') {
        return { row, payload };
      }
    }
    return null;
  }, [shifts]);

  const activeShiftId = activeShift?.row.id ?? null;
  const activeShiftOpenedAt = activeShift?.payload?.opened_at ?? activeShift?.row.created_at ?? null;
  const activeShiftOpenedAtTs = useMemo(() => toTimestamp(activeShiftOpenedAt), [activeShiftOpenedAt]);
  const activeShiftOpeningCash = useMemo(() => toAmount(activeShift?.payload?.opening_cash), [activeShift]);

  const branchLabel = useMemo(
    () => branches.find((option) => option.id === branchId)?.label ?? branchId,
    [branches, branchId]
  );
  const locationLabel = useMemo(
    () => scopedLocations.find((option) => option.id === locationId)?.label ?? locationId,
    [scopedLocations, locationId]
  );

  const financials = useMemo(() => {
    if (!activeShiftId) {
      return {
        cashSales: 0,
        customerCashPayments: 0,
        shiftCashIn: 0,
        shiftCashOut: 0,
        pettyCashIn: 0,
        pettyCashOut: 0,
        expectedCash: 0
      };
    }

    let cashSales = 0;
    for (const row of sales) {
      const createdAtTs = toTimestamp(row.created_at);
      if (createdAtTs < activeShiftOpenedAtTs) {
        continue;
      }
      const payload = parsePayload<SalePayload>(row.payload);
      for (const payment of payload?.payments ?? []) {
        if ((payment.method ?? '').toUpperCase() === 'CASH') {
          cashSales += toAmount(payment.amount);
        }
      }
    }

    let customerCashPayments = 0;
    for (const row of customerPayments) {
      const createdAtTs = toTimestamp(row.created_at);
      if (createdAtTs < activeShiftOpenedAtTs) {
        continue;
      }
      const payload = parsePayload<CustomerPaymentPayload>(row.payload);
      if ((payload?.method ?? '').toUpperCase() === 'CASH') {
        customerCashPayments += toAmount(payload?.amount);
      }
    }

    let shiftCashIn = 0;
    let shiftCashOut = 0;
    for (const row of cashEntries) {
      const payload = parsePayload<ShiftCashPayload>(row.payload);
      if ((payload?.shift_id ?? '') !== activeShiftId) {
        continue;
      }
      const amount = toAmount(payload?.amount);
      if ((payload?.direction ?? '').toUpperCase() === 'IN') {
        shiftCashIn += amount;
      } else {
        shiftCashOut += amount;
      }
    }

    let pettyCashIn = 0;
    let pettyCashOut = 0;
    for (const row of pettyCashEntries) {
      const payload = parsePayload<PettyCashPayload>(row.payload);
      if ((payload?.shift_id ?? '') !== activeShiftId) {
        continue;
      }
      const amount = toAmount(payload?.amount);
      if ((payload?.direction ?? '').toUpperCase() === 'IN') {
        pettyCashIn += amount;
      } else {
        pettyCashOut += amount;
      }
    }

    const expectedCash =
      activeShiftOpeningCash + cashSales + customerCashPayments + shiftCashIn + pettyCashIn - shiftCashOut - pettyCashOut;

    return {
      cashSales: round2(cashSales),
      customerCashPayments: round2(customerCashPayments),
      shiftCashIn: round2(shiftCashIn),
      shiftCashOut: round2(shiftCashOut),
      pettyCashIn: round2(pettyCashIn),
      pettyCashOut: round2(pettyCashOut),
      expectedCash: round2(expectedCash)
    };
  }, [activeShiftId, activeShiftOpenedAtTs, activeShiftOpeningCash, sales, customerPayments, cashEntries, pettyCashEntries]);

  useEffect(() => {
    if (endModalOpen) {
      setClosingCash(financials.expectedCash.toFixed(2));
    }
  }, [endModalOpen, financials.expectedCash]);

  const closingCashValue = useMemo(() => toAmount(closingCash), [closingCash]);
  const computedVariance = useMemo(() => round2(closingCashValue - financials.expectedCash), [closingCashValue, financials]);
  const pendingCount = useMemo(() => {
    let count = 0;
    for (const row of shifts) {
      if (row.sync_status !== 'synced') {
        count += 1;
      }
    }
    for (const row of cashEntries) {
      if (row.sync_status !== 'synced') {
        count += 1;
      }
    }
    return count;
  }, [shifts, cashEntries]);

  const openDuty = async (): Promise<void> => {
    if (activeShiftId) {
      toastError('Shift', 'A duty is already active. End it first before starting a new one.');
      return;
    }
    const opening = Number(openingCash || '0');
    if (!branchId.trim() || !locationId.trim() || !userId.trim()) {
      toastError('Shift', 'Startup branch/location and logged-in cashier are required.');
      return;
    }
    if (!Number.isFinite(opening) || opening < 0) {
      toastError('Shift', 'Opening cash must be zero or greater.');
      return;
    }

    setSaving(true);
    try {
      const service = new OfflineTransactionService(db);
      const shiftId = await service.openOfflineShift({
        branchId: branchId.trim(),
        locationId: locationId.trim(),
        userId: userId.trim(),
        openingCash: opening
      });
      toastSuccess('Duty started', `Start duty queued: ${shiftId}`);
      setStartModalOpen(false);
      setClosingCash('0');
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      toastError('Start duty failed', cause instanceof Error ? cause.message : 'Unable to queue duty start.');
    } finally {
      setSaving(false);
    }
  };

  const endDuty = async (): Promise<void> => {
    if (!activeShiftId) {
      toastError('Shift', 'No active duty found. Start duty first.');
      return;
    }
    if (!Number.isFinite(closingCashValue) || closingCashValue < 0) {
      toastError('Shift', 'Actual counted cash must be zero or greater.');
      return;
    }

    setSaving(true);
    try {
      const service = new OfflineTransactionService(db);
      await service.closeOfflineShift({
        shiftId: activeShiftId,
        closingCash: round2(closingCashValue),
        cashVariance: computedVariance
      });
      toastSuccess('Duty ended', `End duty queued for ${activeShiftId}`);
      setEndModalOpen(false);
      setClosingCash('0');
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      toastError('End duty failed', cause instanceof Error ? cause.message : 'Unable to queue duty close.');
    } finally {
      setSaving(false);
    }
  };

  const addShiftCashEntry = async (): Promise<void> => {
    if (!activeShiftId) {
      toastError('Shift cash', 'Start duty before adding cash adjustments.');
      return;
    }
    const amount = Number(cashAmount || '0');
    if (!Number.isFinite(amount) || amount <= 0) {
      toastError('Shift cash', 'Amount must be greater than zero.');
      return;
    }

    setSaving(true);
    try {
      const service = new OfflineTransactionService(db);
      await service.createOfflineShiftCashEntry({
        shiftId: activeShiftId,
        direction: cashDirection,
        amount: round2(amount),
        notes: cashNotes.trim() || undefined
      });
      toastSuccess('Cash adjustment queued', `${cashDirection} ${fmtMoney(amount)}`);
      setCashAmount('0');
      setCashNotes('');
      setCashModalOpen(false);
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      toastError('Shift cash failed', cause instanceof Error ? cause.message : 'Unable to queue shift cash entry.');
    } finally {
      setSaving(false);
    }
  };

  const renderContextCard = (label: string, value: string): JSX.Element => (
    <View style={[styles.contextCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
      <Text style={[styles.contextLabel, { color: theme.subtext }]}>{label}</Text>
      <Text style={[styles.contextValue, { color: theme.heading }]}>{value || '-'}</Text>
    </View>
  );
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.heading }]}>Shift / Duty</Text>
          <Text style={[styles.sub, { color: theme.subtext }]}>Modern duty flow: start, cash adjust, and end duty through guided modals.</Text>
        </View>
      </View>

      <View style={styles.kpiRow}>
        <View style={[styles.kpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Duty Status</Text>
          <Text style={[styles.kpiValue, { color: activeShiftId ? theme.primary : theme.danger }]}>{activeShiftId ? 'ACTIVE' : 'INACTIVE'}</Text>
        </View>
        <View style={[styles.kpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Expected Cash</Text>
          <Text style={[styles.kpiValue, { color: theme.heading }]}>{fmtMoney(financials.expectedCash)}</Text>
        </View>
        <View style={[styles.kpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
          <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Pending Sync</Text>
          <Text style={[styles.kpiValue, { color: pendingCount > 0 ? theme.danger : theme.heading }]}>{pendingCount}</Text>
        </View>
      </View>

      <View style={styles.contextRow}>
        {renderContextCard('Branch', branchLabel)}
        {renderContextCard('Location', locationLabel)}
      </View>
      <View style={styles.contextRow}>
        {renderContextCard('Cashier', cashierLabel)}
        {renderContextCard('Opened At', activeShiftId ? fmtDate(activeShiftOpenedAt) : 'No active duty')}
      </View>

      <View style={[styles.actionRow, { borderColor: theme.cardBorder }]}>
        <View ref={tutorialStartDuty.ref} onLayout={tutorialStartDuty.onLayout} style={{ flex: 1 }}>
          <Pressable
            style={[
              styles.actionBtn,
              { backgroundColor: saving || syncBusy || !!activeShiftId ? theme.primaryMuted : theme.primary },
              tutorialStartDuty.active ? styles.tutorialTargetFocus : null
            ]}
            onPress={() => setStartModalOpen(true)}
            disabled={saving || syncBusy || Boolean(activeShiftId)}
          >
            <Text style={styles.actionBtnTitle}>Start Duty</Text>
            <Text style={styles.actionBtnSub}>Open with starting cash</Text>
          </Pressable>
        </View>
        <View ref={tutorialEndDuty.ref} onLayout={tutorialEndDuty.onLayout} style={{ flex: 1 }}>
          <Pressable
            style={[
              styles.actionBtn,
              { backgroundColor: saving || syncBusy || !activeShiftId ? theme.primaryMuted : theme.primary },
              tutorialEndDuty.active ? styles.tutorialTargetFocus : null
            ]}
            onPress={() => setEndModalOpen(true)}
            disabled={saving || syncBusy || !activeShiftId}
          >
            <Text style={styles.actionBtnTitle}>End Duty</Text>
            <Text style={styles.actionBtnSub}>Count and close shift</Text>
          </Pressable>
        </View>
      </View>

      <View ref={tutorialCashAdjust.ref} onLayout={tutorialCashAdjust.onLayout}>
        <Pressable
          style={[
            styles.secondaryBtn,
            { backgroundColor: saving || syncBusy || !activeShiftId ? theme.primaryMuted : theme.primary },
            tutorialCashAdjust.active ? styles.tutorialTargetFocus : null
          ]}
          onPress={() => setCashModalOpen(true)}
          disabled={saving || syncBusy || !activeShiftId}
        >
          <Text style={styles.primaryText}>Add Cash Adjustment</Text>
        </Pressable>
      </View>

      <View style={[styles.block, { borderColor: theme.cardBorder }]}> 
        <Text style={[styles.blockTitle, { color: theme.heading }]}>Recent Local Duties</Text>
        {shifts.length === 0 ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>No local duties yet.</Text>
        ) : (
          shifts.slice(0, 6).map((row) => {
            const payload = parsePayload<ShiftPayload>(row.payload);
            return (
              <View key={row.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemId, { color: theme.heading }]}>{row.id}</Text>
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}> {(payload?.status ?? 'unknown').toUpperCase()} | Open {fmtMoney(toAmount(payload?.opening_cash))} | Close {fmtMoney(toAmount(payload?.closing_cash))}</Text>
                </View>
                <SyncStatusBadge status={row.sync_status} />
              </View>
            );
          })
        )}
      </View>

      <View style={[styles.block, { borderColor: theme.cardBorder }]}> 
        <Text style={[styles.blockTitle, { color: theme.heading }]}>Recent Cash Adjustments</Text>
        {cashEntries.length === 0 ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>No local cash adjustments yet.</Text>
        ) : (
          cashEntries.slice(0, 6).map((row) => {
            const payload = parsePayload<ShiftCashPayload>(row.payload);
            return (
              <View key={row.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemId, { color: theme.heading }]}>{row.id}</Text>
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}> {(payload?.direction ?? '-').toUpperCase()} {fmtMoney(toAmount(payload?.amount))} | Shift {payload?.shift_id ?? '-'}</Text>
                </View>
                <SyncStatusBadge status={row.sync_status} />
              </View>
            );
          })
        )}
      </View>

      <Modal visible={startModalOpen} transparent animationType='slide' onRequestClose={() => setStartModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => !saving && setStartModalOpen(false)} />
          <View style={[styles.modalCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}> 
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: theme.heading }]}>Start Duty</Text>
                <Text style={[styles.modalSub, { color: theme.subtext }]}>Start with opening cash for this cashier session.</Text>
              </View>
              <Pressable style={[styles.modalClose, { borderColor: theme.cardBorder, backgroundColor: theme.pillBg }]} onPress={() => setStartModalOpen(false)} disabled={saving}>
                <Text style={[styles.modalCloseText, { color: theme.pillText }]}>Close</Text>
              </Pressable>
            </View>

            <View style={styles.contextRow}>{renderContextCard('Branch', branchLabel)}{renderContextCard('Location', locationLabel)}</View>
            <View style={styles.contextRow}>{renderContextCard('Cashier', cashierLabel)}</View>

            <TextInput
              value={openingCash}
              onChangeText={setOpeningCash}
              keyboardType='numeric'
              placeholder='Opening Cash'
              placeholderTextColor={theme.inputPlaceholder}
              editable={!saving && !syncBusy}
              style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
            />

            <Pressable style={[styles.primaryBtn, { backgroundColor: saving || syncBusy || !!activeShiftId ? theme.primaryMuted : theme.primary }]} onPress={() => void openDuty()} disabled={saving || syncBusy || Boolean(activeShiftId)}>
              <Text style={styles.primaryText}>{saving ? 'Queueing...' : 'Start Duty'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={endModalOpen} transparent animationType='slide' onRequestClose={() => setEndModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => !saving && setEndModalOpen(false)} />
          <View style={[styles.modalCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}> 
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: theme.heading }]}>End Duty</Text>
                <Text style={[styles.modalSub, { color: theme.subtext }]}>Review totals, count cash, then close duty.</Text>
              </View>
              <Pressable style={[styles.modalClose, { borderColor: theme.cardBorder, backgroundColor: theme.pillBg }]} onPress={() => setEndModalOpen(false)} disabled={saving}>
                <Text style={[styles.modalCloseText, { color: theme.pillText }]}>Close</Text>
              </Pressable>
            </View>

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
              <View style={styles.kpiRow}>
                <View style={[styles.kpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Opening Cash</Text>
                  <Text style={[styles.kpiValue, { color: theme.heading }]}>{fmtMoney(activeShiftOpeningCash)}</Text>
                </View>
                <View style={[styles.kpiCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}>
                  <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Expected Cash</Text>
                  <Text style={[styles.kpiValue, { color: theme.heading }]}>{fmtMoney(financials.expectedCash)}</Text>
                </View>
              </View>

              <View style={[styles.breakdownCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}> 
                <Text style={[styles.breakdownLine, { color: theme.subtext }]}>Cash Sales: {fmtMoney(financials.cashSales)}</Text>
                <Text style={[styles.breakdownLine, { color: theme.subtext }]}>Customer Cash Payments: {fmtMoney(financials.customerCashPayments)}</Text>
                <Text style={[styles.breakdownLine, { color: theme.subtext }]}>Shift Cash IN: {fmtMoney(financials.shiftCashIn)}</Text>
                <Text style={[styles.breakdownLine, { color: theme.subtext }]}>Shift Cash OUT: {fmtMoney(financials.shiftCashOut)}</Text>
                <Text style={[styles.breakdownLine, { color: theme.subtext }]}>Petty Cash IN: {fmtMoney(financials.pettyCashIn)}</Text>
                <Text style={[styles.breakdownLine, { color: theme.subtext }]}>Petty Cash OUT: {fmtMoney(financials.pettyCashOut)}</Text>
              </View>

              <TextInput
                value={closingCash}
                onChangeText={setClosingCash}
                keyboardType='numeric'
                placeholder='Actual Counted Cash'
                placeholderTextColor={theme.inputPlaceholder}
                editable={Boolean(activeShiftId) && !saving && !syncBusy}
                style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
              />

              <View style={[styles.varianceCard, { borderColor: theme.cardBorder, backgroundColor: theme.inputBg }]}> 
                <Text style={[styles.kpiLabel, { color: theme.subtext }]}>Variance (Actual - Expected)</Text>
                <Text style={[styles.varianceValue, { color: Math.abs(computedVariance) < 0.005 ? theme.primary : theme.danger }]}>
                  {fmtMoney(computedVariance)}
                </Text>
              </View>
            </ScrollView>

            <Pressable style={[styles.primaryBtn, { backgroundColor: saving || syncBusy || !activeShiftId ? theme.primaryMuted : theme.primary }]} onPress={() => void endDuty()} disabled={saving || syncBusy || !activeShiftId}>
              <Text style={styles.primaryText}>{saving ? 'Queueing...' : 'End Duty'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={cashModalOpen} transparent animationType='slide' onRequestClose={() => setCashModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => !saving && setCashModalOpen(false)} />
          <View style={[styles.modalCard, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}> 
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: theme.heading }]}>Cash Adjustment</Text>
                <Text style={[styles.modalSub, { color: theme.subtext }]}>Record cash IN or OUT adjustments during active duty.</Text>
              </View>
              <Pressable style={[styles.modalClose, { borderColor: theme.cardBorder, backgroundColor: theme.pillBg }]} onPress={() => setCashModalOpen(false)} disabled={saving}>
                <Text style={[styles.modalCloseText, { color: theme.pillText }]}>Close</Text>
              </Pressable>
            </View>

            <View style={styles.directionRow}>
              {(['OUT', 'IN'] as const).map((dir) => {
                const selected = dir === cashDirection;
                return (
                  <Pressable
                    key={dir}
                    style={[styles.directionPill, { backgroundColor: selected ? theme.primary : theme.pillBg }]}
                    onPress={() => setCashDirection(dir)}
                    disabled={saving || syncBusy || !activeShiftId}
                  >
                    <Text style={{ color: selected ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: 12 }}>{dir}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.quickRow}>
              {['100', '200', '500', '1000'].map((quick) => (
                <Pressable
                  key={quick}
                  style={[styles.quickChip, { backgroundColor: theme.pillBg }]}
                  onPress={() => setCashAmount(String(round2(toAmount(cashAmount) + Number(quick))))}
                  disabled={saving || syncBusy || !activeShiftId}
                >
                  <Text style={[styles.quickChipText, { color: theme.pillText }]}>+{quick}</Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              value={cashAmount}
              onChangeText={setCashAmount}
              keyboardType='numeric'
              placeholder='Amount'
              placeholderTextColor={theme.inputPlaceholder}
              editable={Boolean(activeShiftId) && !saving && !syncBusy}
              style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
            />
            <TextInput
              value={cashNotes}
              onChangeText={setCashNotes}
              placeholder='Reason / Notes'
              placeholderTextColor={theme.inputPlaceholder}
              editable={Boolean(activeShiftId) && !saving && !syncBusy}
              style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
            />

            <Pressable style={[styles.primaryBtn, { backgroundColor: saving || syncBusy || !activeShiftId ? theme.primaryMuted : theme.primary }]} onPress={() => void addShiftCashEntry()} disabled={saving || syncBusy || !activeShiftId}>
              <Text style={styles.primaryText}>{saving ? 'Queueing...' : 'Add Cash Adjustment'}</Text>
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
    fontSize: 16,
    fontWeight: '800'
  },
  contextRow: {
    flexDirection: 'row',
    gap: 8
  },
  contextCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  contextLabel: {
    fontSize: 10,
    fontWeight: '700'
  },
  contextValue: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700'
  },
  actionRow: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    flexDirection: 'row',
    gap: 8
  },
  actionBtn: {
    flex: 1,
    minHeight: 74,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center'
  },
  actionBtnTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800'
  },
  actionBtnSub: {
    color: '#E7F2FF',
    fontSize: 11,
    marginTop: 2
  },
  secondaryBtn: {
    minHeight: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center'
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
  block: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '700'
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  itemId: {
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
    maxHeight: '86%'
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
  modalScroll: {
    maxHeight: 420
  },
  modalScrollContent: {
    gap: 10,
    paddingBottom: 6
  },
  breakdownCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 3
  },
  breakdownLine: {
    fontSize: 12
  },
  varianceCard: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  varianceValue: {
    marginTop: 3,
    fontSize: 16,
    fontWeight: '800'
  },
  input: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14
  },
  directionRow: {
    flexDirection: 'row',
    gap: 8
  },
  directionPill: {
    flex: 1,
    minHeight: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center'
  },
  quickRow: {
    flexDirection: 'row',
    gap: 6
  },
  quickChip: {
    flex: 1,
    minHeight: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center'
  },
  quickChipText: {
    fontSize: 11,
    fontWeight: '700'
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
