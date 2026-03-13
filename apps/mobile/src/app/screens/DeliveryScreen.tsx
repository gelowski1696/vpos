import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import { toastError, toastSuccess } from '../goey-toast';
import type { AppTheme } from '../theme';
import { MasterDataSelect } from '../components/MasterDataSelect';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import {
  type MasterDataOption,
  loadBranchOptions,
  loadCustomerOptions,
  loadLocationOptions,
  loadPersonnelOptions
} from '../master-data-local';

type DeliveryRow = {
  id: string;
  payload: string;
  sync_status: string;
  created_at: string;
};

type DeliveryPayload = {
  customer_id?: string;
  order_type?: string;
  status?: string;
  personnel?: Array<{ userId?: string; personnelId?: string; role?: string }>;
};

type Props = {
  db: SQLiteDatabase;
  theme: AppTheme;
  preferredBranchId?: string;
  onDataChanged?: () => Promise<void> | void;
  syncBusy?: boolean;
};

function parsePayload(row: string): DeliveryPayload {
  try {
    return JSON.parse(row) as DeliveryPayload;
  } catch {
    return {};
  }
}

const FALLBACK_BRANCHES: MasterDataOption[] = [{ id: 'branch-main', label: 'Main Branch' }];
const FALLBACK_LOCATIONS: MasterDataOption[] = [{ id: 'loc-main', label: 'Main Store' }];

export function DeliveryScreen({ db, theme, preferredBranchId, onDataChanged, syncBusy = false }: Props): JSX.Element {
  const [branchId, setBranchId] = useState('branch-main');
  const [sourceLocationId, setSourceLocationId] = useState('loc-main');
  const [customerId, setCustomerId] = useState('');
  const [orderType, setOrderType] = useState<'PICKUP' | 'DELIVERY'>('DELIVERY');
  const [driverId, setDriverId] = useState('');
  const [helperId, setHelperId] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [branches, setBranches] = useState<MasterDataOption[]>(FALLBACK_BRANCHES);
  const [locations, setLocations] = useState<MasterDataOption[]>(FALLBACK_LOCATIONS);
  const [customers, setCustomers] = useState<MasterDataOption[]>([]);
  const [personnels, setPersonnels] = useState<MasterDataOption[]>([]);
  const [saving, setSaving] = useState(false);

  const scopedLocations = useMemo(() => {
    const branchScoped = locations.filter((option) => !option.branchId || option.branchId === branchId);
    return branchScoped.length ? branchScoped : locations;
  }, [locations, branchId]);

  const personnelChoices = useMemo(
    () => personnels.filter((option) => option.id !== helperId || option.id === driverId),
    [personnels, helperId, driverId]
  );

  const helperChoices = useMemo(
    () => personnels.filter((option) => option.id !== driverId || option.id === helperId),
    [personnels, helperId, driverId]
  );

  useEffect(() => {
    void refreshMasterData();
    void refresh();
  }, []);

  useEffect(() => {
    if (!scopedLocations.length) {
      return;
    }
    if (scopedLocations.some((option) => option.id === sourceLocationId)) {
      return;
    }
    setSourceLocationId(scopedLocations[0].id);
  }, [scopedLocations, sourceLocationId]);

  const refreshMasterData = async (): Promise<void> => {
    const [nextBranches, nextLocations, nextCustomers, nextPersonnels] = await Promise.all([
      loadBranchOptions(db),
      loadLocationOptions(db),
      loadCustomerOptions(db),
      loadPersonnelOptions(db)
    ]);

    const branchOptions = nextBranches.length ? nextBranches : FALLBACK_BRANCHES;
    const locationOptions = nextLocations.length ? nextLocations : FALLBACK_LOCATIONS;

    setBranches(branchOptions);
    setLocations(locationOptions);
    setCustomers(nextCustomers);
    setPersonnels(nextPersonnels);

    setBranchId((current) => {
      if (branchOptions.some((option) => option.id === current)) {
        return current;
      }
      if (preferredBranchId && branchOptions.some((option) => option.id === preferredBranchId)) {
        return preferredBranchId;
      }
      return branchOptions[0].id;
    });
    setSourceLocationId((current) =>
      locationOptions.some((option) => option.id === current) ? current : locationOptions[0].id
    );
    setCustomerId((current) => (current && !nextCustomers.some((option) => option.id === current) ? '' : current));
    setDriverId((current) => (current && !nextPersonnels.some((option) => option.id === current) ? '' : current));
    setHelperId((current) => (current && !nextPersonnels.some((option) => option.id === current) ? '' : current));
  };

  useEffect(() => {
    if (!preferredBranchId) {
      return;
    }
    if (!branches.some((option) => option.id === preferredBranchId)) {
      return;
    }
    setBranchId(preferredBranchId);
  }, [preferredBranchId, branches]);

  const refresh = async (): Promise<void> => {
    const result = await db.getAllAsync<DeliveryRow>(
      `
      SELECT id, payload, sync_status, created_at
      FROM delivery_orders_local
      ORDER BY created_at DESC
      LIMIT 20
      `
    );
    setRows(result);
  };

  const createDelivery = async (): Promise<void> => {
    if (!branchId.trim() || !sourceLocationId.trim() || !customerId.trim()) {
      toastError('Delivery', 'Branch, source location, and customer are required.');
      return;
    }

    setSaving(true);
    try {
      const personnel: Array<{ userId: string; role: 'DRIVER' | 'HELPER' }> = [];
      if (driverId.trim()) {
        personnel.push({ userId: driverId.trim(), role: 'DRIVER' });
      }
      if (helperId.trim()) {
        personnel.push({ userId: helperId.trim(), role: 'HELPER' });
      }

      const service = new OfflineTransactionService(db);
      const id = await service.createOfflineDeliveryOrder({
        branchId: branchId.trim(),
        sourceLocationId: sourceLocationId.trim(),
        customerId: customerId.trim(),
        orderType,
        notes: notes.trim() || undefined,
        personnel
      });

      toastSuccess('Delivery queued', `Order ID: ${id}`);
      setCustomerId('');
      setDriverId('');
      setHelperId('');
      setNotes('');
      await refresh();
      await onDataChanged?.();
    } catch (cause) {
      toastError('Delivery failed', cause instanceof Error ? cause.message : 'Unable to queue delivery order.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}> 
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.heading }]}>Delivery Orders</Text>
          <Text style={[styles.sub, { color: theme.subtext }]}>Queue delivery jobs offline and sync later.</Text>
        </View>
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <MasterDataSelect
            label="Branch"
            placeholder="Select branch"
            value={branchId}
            options={branches}
            theme={theme}
            onChange={setBranchId}
            disabled={saving || syncBusy}
          />
        </View>
        <View style={{ flex: 1 }}>
          <MasterDataSelect
            label="Source Location"
            placeholder="Select location"
            value={sourceLocationId}
            options={scopedLocations}
            theme={theme}
            onChange={setSourceLocationId}
            disabled={saving || syncBusy}
          />
        </View>
      </View>

      <MasterDataSelect
        label="Customer"
        placeholder="Select customer"
        value={customerId}
        options={customers}
        theme={theme}
        onChange={setCustomerId}
        disabled={saving || syncBusy}
      />

      <View style={styles.row}>
        {(['DELIVERY', 'PICKUP'] as const).map((type) => {
          const selected = orderType === type;
          return (
            <Pressable
              key={type}
              onPress={() => setOrderType(type)}
              style={[
                styles.typePill,
                {
                  backgroundColor: selected ? theme.primary : theme.pillBg
                }
              ]}
            >
              <Text style={{ color: selected ? '#FFFFFF' : theme.pillText, fontWeight: '700', fontSize: 12 }}>{type}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <MasterDataSelect
            label="Driver (optional)"
            placeholder="Select driver"
            value={driverId}
            options={personnelChoices}
            theme={theme}
            onChange={setDriverId}
            disabled={saving || syncBusy}
            optional
          />
        </View>
        <View style={{ flex: 1 }}>
          <MasterDataSelect
            label="Helper (optional)"
            placeholder="Select helper"
            value={helperId}
            options={helperChoices}
            theme={theme}
            onChange={setHelperId}
            disabled={saving || syncBusy}
            optional
          />
        </View>
      </View>

      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder="Notes (optional)"
        placeholderTextColor={theme.inputPlaceholder}
        style={[styles.input, { backgroundColor: theme.inputBg, color: theme.inputText }]}
      />

      <Pressable
        style={[styles.primaryBtn, { backgroundColor: saving ? theme.primaryMuted : theme.primary }]}
        onPress={() => void createDelivery()}
        disabled={saving || syncBusy}
      >
        <Text style={styles.primaryText}>{saving ? 'Queueing...' : 'Queue Delivery Order'}</Text>
      </Pressable>

      <View style={[styles.block, { borderColor: theme.cardBorder }]}> 
        <Text style={[styles.blockTitle, { color: theme.heading }]}>Recent Local Deliveries</Text>
        {rows.length === 0 ? (
          <Text style={[styles.sub, { color: theme.subtext }]}>No local delivery orders yet.</Text>
        ) : (
          rows.slice(0, 8).map((row) => {
            const payload = parsePayload(row.payload);
            const personnelCount = Array.isArray(payload.personnel) ? payload.personnel.length : 0;
            return (
              <View key={row.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemId, { color: theme.heading }]}>{row.id}</Text>
                  <Text style={[styles.itemMeta, { color: theme.subtext }]}>
                    {payload.order_type ?? 'DELIVERY'} - {payload.status ?? 'created'} - {personnelCount} personnel
                  </Text>
                </View>
                <SyncStatusBadge status={row.sync_status} />
              </View>
            );
          })
        )}
      </View>
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
    alignItems: 'flex-start'
  },
  title: {
    fontSize: 18,
    fontWeight: '700'
  },
  sub: {
    fontSize: 13
  },
  row: {
    flexDirection: 'row',
    gap: 8
  },
  input: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14
  },
  typePill: {
    flex: 1,
    minHeight: 38,
    borderRadius: 999,
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
  }
});
