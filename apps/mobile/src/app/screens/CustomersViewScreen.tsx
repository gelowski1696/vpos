import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { AppTheme } from '../theme';
import { loadCustomerOptions, type MasterDataOption } from '../master-data-local';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { useTutorialTarget } from '../tutorial/tutorial-provider';
import { OfflineTransactionService } from '../../services/offline-transaction.service';
import { toastError, toastSuccess } from '../goey-toast';

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
  preferredBranchId,
  onDataChanged,
  syncBusy = false,
}: Props): JSX.Element {
  const tutorialSearch = useTutorialTarget('customers-search');
  const tutorialFirstCard = useTutorialTarget('customers-first-card');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<MasterDataOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<MasterDataOption | null>(null);
  const [transactions, setTransactions] = useState<CustomerTransaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createAddress, setCreateAddress] = useState('');
  const [createCode, setCreateCode] = useState('');
  const [createContactNumber, setCreateContactNumber] = useState('');
  const [createGas, setCreateGas] = useState('');
  const [createProvince, setCreateProvince] = useState('');
  const [createCity, setCreateCity] = useState('');
  const [createSaving, setCreateSaving] = useState(false);
  const prevSyncBusyRef = useRef(syncBusy);
  const offlineTransactions = useMemo(() => new OfflineTransactionService(db), [db]);

  const tutorialFocusStyle = tutorialSearch.active || tutorialFirstCard.active
    ? {
        borderWidth: 2,
        borderColor: '#F59E0B',
        shadowColor: '#F59E0B',
        shadowOpacity: 0.35,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 0 },
        elevation: 6,
      }
    : null;

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
      `${row.label} ${row.code ?? ''} ${row.address ?? ''} ${row.subtitle ?? ''} ${row.id}`.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const summary = useMemo(() => {
    const withBalance = rows.filter((row) => Number(row.balance ?? 0) > 0).length;
    const totalOutstanding = rows.reduce((sum, row) => sum + Number(row.balance ?? 0), 0);
    const totalPoints = rows.reduce((sum, row) => sum + Number(row.pointsBalance ?? 0), 0);
    return {
      totalCustomers: rows.length,
      withBalance,
      totalOutstanding: Number(totalOutstanding.toFixed(2)),
      totalPoints: Math.max(0, Math.floor(totalPoints)),
    };
  }, [rows]);

  const selectedCustomerCode = useMemo(() => {
    if (!selectedCustomer) {
      return null;
    }
    if (selectedCustomer.code?.trim()) {
      return selectedCustomer.code.trim();
    }
    if (!selectedCustomer.subtitle) {
      return null;
    }
    const [code] = selectedCustomer.subtitle.split(' - ');
    return code || null;
  }, [selectedCustomer]);

  const selectedCustomerAddress = useMemo(() => {
    const value = selectedCustomer?.address?.trim() ?? '';
    return value || null;
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
      paymentTotal: Number(paymentTotal.toFixed(2)),
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
      const result = await loadCustomerTransactions(db, customer);
      setTransactions(result);
    } finally {
      setTransactionsLoading(false);
    }
  };

  const closeCreateModal = (force = false): void => {
    if (createSaving && !force) {
      return;
    }
    setCreateModalOpen(false);
    setCreateName('');
    setCreateAddress('');
    setCreateCode('');
    setCreateContactNumber('');
    setCreateGas('');
    setCreateProvince('');
    setCreateCity('');
  };

  const handleCreateCustomer = async (): Promise<void> => {
    const name = createName.trim();
    if (!name) {
      toastError('Customer', 'Customer name is required.');
      return;
    }

    setCreateSaving(true);
    try {
      const customerId = await offlineTransactions.createOfflineCustomer({
        name,
        address: createAddress.trim() || undefined,
        code: createCode.trim() || undefined,
        contactNumber: createContactNumber.trim() || undefined,
        gas: createGas.trim() || undefined,
        province: createProvince.trim() || undefined,
        city: createCity.trim() || undefined
      });
      await refresh();
      await onDataChanged?.();
      const created = (await loadCustomerOptions(db)).find((row) => row.id === customerId) ?? null;
      if (created) {
        setSelectedCustomer(created);
      }
      toastSuccess('Customer saved locally', `${name} is ready to use and will sync later.`);
      closeCreateModal(true);
    } catch (cause) {
      toastError('Customer save failed', cause instanceof Error ? cause.message : 'Unable to save customer locally.');
    } finally {
      setCreateSaving(false);
    }
  };

  return (
    <View
      className="gap-2.5 rounded-2xl border px-3.5 py-3.5"
      style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
    >
      <View className="flex-row flex-wrap gap-2">
        {[
          ['Customers', summary.totalCustomers],
          ['With Balance', summary.withBalance],
          ['Outstanding', fmtMoney(summary.totalOutstanding)],
          ['Points', summary.totalPoints],
        ].map(([label, value]) => (
          <View
            key={String(label)}
            className="min-h-[58px] grow basis-[48%] rounded-xl border px-2 py-2"
            style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
          >
            <Text className="text-[10px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
              {label}
            </Text>
            <Text className="mt-1 text-[13px] font-extrabold" style={{ color: theme.heading }}>
              {String(value)}
            </Text>
          </View>
        ))}
      </View>

      <View className="flex-row items-center gap-2">
        <View ref={tutorialSearch.ref} onLayout={tutorialSearch.onLayout} className="flex-1">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search customer code, tier, or name..."
            placeholderTextColor={theme.inputPlaceholder}
            className="rounded-xl px-3 py-[11px] text-[13px]"
            style={[
              { backgroundColor: theme.inputBg, color: theme.inputText },
              tutorialSearch.active ? tutorialFocusStyle : null,
            ]}
          />
        </View>
        <Pressable
          className="min-h-[42px] min-w-[86px] items-center justify-center rounded-[10px] px-2.5"
          style={{ backgroundColor: createSaving || syncBusy ? theme.primaryMuted : theme.pillBg }}
          onPress={() => setCreateModalOpen(true)}
          disabled={createSaving || syncBusy}
        >
          <Text className="text-xs font-extrabold" style={{ color: theme.pillText }}>
            New Customer
          </Text>
        </Pressable>
        <Pressable
          className="min-h-[42px] min-w-[86px] items-center justify-center rounded-[10px] px-2.5"
          style={{ backgroundColor: loading || syncBusy ? theme.primaryMuted : theme.primary }}
          onPress={() => void refresh()}
          disabled={loading || syncBusy}
        >
          <Text className="text-xs font-extrabold text-white">{loading ? '...' : 'Refresh'}</Text>
        </Pressable>
      </View>

      <Modal visible={createModalOpen} transparent animationType="slide" onRequestClose={() => closeCreateModal()}>
        <View className="flex-1 justify-end pt-3">
          <Pressable className="absolute inset-0 bg-[rgba(2,8,23,0.55)]" onPress={() => closeCreateModal()} />
          <View
            className="w-full rounded-t-[20px] border px-3.5 py-3.5"
            style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
          >
            <Text className="text-base font-extrabold" style={{ color: theme.heading }}>
              New Customer
            </Text>
            <Text className="mt-1 text-[12px]" style={{ color: theme.subtext }}>
              Save a customer locally now. We&apos;ll sync it when the device connects again.
            </Text>

            <View className="mt-3 gap-2.5">
              <View>
                <Text className="mb-1 text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                  Name
                </Text>
                <TextInput
                  value={createName}
                  onChangeText={setCreateName}
                  placeholder="Customer name"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View>
                <Text className="mb-1 text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                  Address
                </Text>
                <TextInput
                  value={createAddress}
                  onChangeText={setCreateAddress}
                  placeholder="Customer address"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View>
                <Text className="mb-1 text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                  Code
                </Text>
                <TextInput
                  value={createCode}
                  onChangeText={setCreateCode}
                  placeholder="Optional code"
                  placeholderTextColor={theme.inputPlaceholder}
                  autoCapitalize="characters"
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View>
                <Text className="mb-1 text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                  Contact Number
                </Text>
                <TextInput
                  value={createContactNumber}
                  onChangeText={setCreateContactNumber}
                  placeholder="Optional contact number"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View>
                <Text className="mb-1 text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                  Gas
                </Text>
                <TextInput
                  value={createGas}
                  onChangeText={setCreateGas}
                  placeholder="Optional gas preference"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View>
                <Text className="mb-1 text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                  Province
                </Text>
                <TextInput
                  value={createProvince}
                  onChangeText={setCreateProvince}
                  placeholder="Optional province"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
              <View>
                <Text className="mb-1 text-[11px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                  City
                </Text>
                <TextInput
                  value={createCity}
                  onChangeText={setCreateCity}
                  placeholder="Optional city"
                  placeholderTextColor={theme.inputPlaceholder}
                  className="rounded-xl px-3 py-[11px] text-[13px]"
                  style={{ backgroundColor: theme.inputBg, color: theme.inputText }}
                />
              </View>
            </View>

            <View className="mt-4 flex-row gap-2">
              <Pressable
                className="min-h-[42px] flex-1 items-center justify-center rounded-[10px] px-2.5"
                style={{ backgroundColor: theme.pillBg }}
                onPress={() => closeCreateModal()}
                disabled={createSaving}
              >
                <Text className="text-xs font-extrabold" style={{ color: theme.pillText }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                className="min-h-[42px] flex-1 items-center justify-center rounded-[10px] px-2.5"
                style={{ backgroundColor: createSaving ? theme.primaryMuted : theme.primary }}
                onPress={() => void handleCreateCustomer()}
                disabled={createSaving}
              >
                <Text className="text-xs font-extrabold text-white">{createSaving ? 'Saving...' : 'Save Customer'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <View className="gap-2">
        {loading ? (
          <Text className="text-xs" style={{ color: theme.subtext }}>
            Loading customers...
          </Text>
        ) : filtered.length === 0 ? (
          <Text className="text-xs" style={{ color: theme.subtext }}>
            No customers found.
          </Text>
        ) : (
          filtered.map((row, index) => (
            <Pressable
              key={row.id}
              className="flex-row items-center gap-2 rounded-[10px] border px-2.5 py-2.5"
              style={[
                { borderColor: theme.cardBorder, backgroundColor: theme.inputBg },
                tutorialFirstCard.active && index === 0 ? tutorialFocusStyle : null,
              ]}
              onPress={() => void openTransactions(row)}
              ref={index === 0 ? tutorialFirstCard.ref : undefined}
              onLayout={index === 0 ? tutorialFirstCard.onLayout : undefined}
            >
              <View className="flex-1">
                <Text className="text-[13px] font-bold" style={{ color: theme.heading }}>
                  {row.label}
                </Text>
                <Text className="mt-0.5 text-[11px]" style={{ color: theme.subtext }}>
                  {formatCustomerSubtitle(row)}
                </Text>
                <View className="mt-1.5 flex-row flex-wrap gap-1.5">
                  <View
                    className="min-h-7 justify-center rounded-full border px-2.5"
                    style={{ backgroundColor: theme.pillBg, borderColor: theme.cardBorder }}
                  >
                    <Text className="text-[11px] font-bold" style={{ color: theme.pillText }}>
                      Points {Math.max(0, Math.floor(Number(row.pointsBalance ?? 0)))}
                    </Text>
                  </View>
                </View>
              </View>
              <View className="min-w-[108px] items-end gap-[3px]">
                <Text className="text-xs font-extrabold" style={{ color: theme.heading }}>
                  {fmtMoney(Number(row.balance ?? 0))}
                </Text>
                <Text className="text-[10px] font-semibold" style={{ color: theme.subtext }}>
                  Balance Due
                </Text>
                <Text className="text-[10px] font-bold" style={{ color: theme.primary }}>
                  View Transactions
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </View>

      <Modal visible={Boolean(selectedCustomer)} transparent animationType="slide" onRequestClose={closeTransactions}>
        {selectedCustomer ? (
          <View className="flex-1 justify-end pt-3">
            <Pressable className="absolute inset-0 bg-[rgba(2,8,23,0.55)]" onPress={closeTransactions} />
            <View
              className="h-[95%] min-h-[90%] max-h-[95%] gap-2.5 rounded-t-[18px] border px-3 pb-3.5 pt-3"
              style={{ backgroundColor: theme.card, borderColor: theme.cardBorder }}
            >
              <View className="flex-row items-center justify-between gap-2">
                <View className="flex-1">
                  <Text className="text-base font-extrabold" style={{ color: theme.heading }}>
                    {selectedCustomer.label}
                  </Text>
                  <Text className="mt-0.5 text-xs" style={{ color: theme.subtext }}>
                    {selectedCustomerCode ?? selectedCustomer.id}
                  </Text>
                </View>
                <Pressable
                  className="min-h-[34px] min-w-[72px] items-center justify-center rounded-[10px] border px-3"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                  onPress={closeTransactions}
                >
                  <Text className="text-xs font-bold" style={{ color: theme.pillText }}>
                    Close
                  </Text>
                </Pressable>
              </View>

              <View className="flex-row flex-wrap gap-2">
                {[
                  ['Sales', transactionSummary.saleCount],
                  ['Payments', transactionSummary.paymentCount],
                  ['Balance', fmtMoney(Number(selectedCustomer.balance ?? 0))],
                  ['Points', Math.max(0, Math.floor(Number(selectedCustomer.pointsBalance ?? 0)))],
                ].map(([label, value]) => (
                  <View
                    key={String(label)}
                    className="min-h-[58px] grow basis-[48%] rounded-xl border px-2 py-2"
                    style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                  >
                    <Text className="text-[10px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                      {label}
                    </Text>
                    <Text className="mt-1 text-[13px] font-extrabold" style={{ color: theme.heading }}>
                      {String(value)}
                    </Text>
                  </View>
                ))}
              </View>

              {selectedCustomerAddress ? (
                <View
                  className="rounded-xl border px-2.5 py-2"
                  style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                >
                  <Text className="text-[10px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                    Customer Address
                  </Text>
                  <Text className="mt-1 text-xs font-semibold" style={{ color: theme.heading }}>
                    {selectedCustomerAddress}
                  </Text>
                </View>
              ) : null}

              {selectedCustomer?.contactNumber || selectedCustomer?.gas || selectedCustomer?.province || selectedCustomer?.city ? (
                <View className="flex-row flex-wrap gap-2">
                  {selectedCustomer.contactNumber ? (
                    <View
                      className="min-h-[58px] grow basis-[48%] rounded-xl border px-2 py-2"
                      style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                    >
                      <Text className="text-[10px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                        Contact Number
                      </Text>
                      <Text className="mt-1 text-[13px] font-extrabold" style={{ color: theme.heading }}>
                        {selectedCustomer.contactNumber}
                      </Text>
                    </View>
                  ) : null}
                  {selectedCustomer.gas ? (
                    <View
                      className="min-h-[58px] grow basis-[48%] rounded-xl border px-2 py-2"
                      style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                    >
                      <Text className="text-[10px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                        Gas
                      </Text>
                      <Text className="mt-1 text-[13px] font-extrabold" style={{ color: theme.heading }}>
                        {selectedCustomer.gas}
                      </Text>
                    </View>
                  ) : null}
                  {selectedCustomer.province ? (
                    <View
                      className="min-h-[58px] grow basis-[48%] rounded-xl border px-2 py-2"
                      style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                    >
                      <Text className="text-[10px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                        Province
                      </Text>
                      <Text className="mt-1 text-[13px] font-extrabold" style={{ color: theme.heading }}>
                        {selectedCustomer.province}
                      </Text>
                    </View>
                  ) : null}
                  {selectedCustomer.city ? (
                    <View
                      className="min-h-[58px] grow basis-[48%] rounded-xl border px-2 py-2"
                      style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                    >
                      <Text className="text-[10px] font-bold uppercase tracking-[0.4px]" style={{ color: theme.subtext }}>
                        City
                      </Text>
                      <Text className="mt-1 text-[13px] font-extrabold" style={{ color: theme.heading }}>
                        {selectedCustomer.city}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <ScrollView
                className="min-h-0 flex-1"
                contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {transactionsLoading ? (
                  <Text className="text-xs" style={{ color: theme.subtext }}>
                    Loading transactions...
                  </Text>
                ) : transactions.length === 0 ? (
                  <Text className="text-xs" style={{ color: theme.subtext }}>
                    No transactions found for this customer.
                  </Text>
                ) : (
                  transactions.map((item) => (
                    <View
                      key={item.id}
                      className="flex-row items-center gap-2 rounded-[10px] border px-2.5 py-[9px]"
                      style={{ borderColor: theme.cardBorder, backgroundColor: theme.inputBg }}
                    >
                      <View className="flex-1">
                        <View className="flex-row items-center justify-between gap-2">
                          <Text
                            className="text-[10px] font-extrabold tracking-[0.3px]"
                            style={{ color: item.type === 'SALE' ? theme.primary : theme.pillText }}
                          >
                            {item.type}
                          </Text>
                          <Text className="text-[10px] font-semibold" style={{ color: theme.subtext }}>
                            {fmtDate(item.createdAt)}
                          </Text>
                        </View>
                        <Text className="mt-0.5 text-xs font-bold" style={{ color: theme.heading }}>
                          {item.title}
                        </Text>
                        <Text className="text-[11px]" style={{ color: theme.subtext }}>
                          {item.subtitle}
                        </Text>
                      </View>
                      <View className="items-end gap-[5px]">
                        <Text className="text-xs font-extrabold" style={{ color: theme.heading }}>
                          {fmtMoney(item.amount)}
                        </Text>
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

type RemoteSaleRow = {
  record_id: string;
  payload: string;
  updated_at: string;
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
  customerId?: string;
  customer_name?: string;
  customerName?: string;
  customer_code?: string;
  customerCode?: string;
  lines?: Array<{
    quantity?: number;
    qty?: number;
    unitPrice?: number;
    unit_price?: number;
  }>;
  discount_amount?: number;
  receipt_number?: string | null;
  receiptNumber?: string | null;
  created_at?: string;
};

type RemoteSaleEnvelope = {
  id?: string;
  payload?: SalePayload | string | null;
  created_at?: string;
  updated_at?: string;
  receipt_number?: string | null;
  sync_status?: string | null;
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

function readSaleCustomerId(payload: SalePayload): string | null {
  const value = payload.customer_id?.trim() || payload.customerId?.trim() || '';
  return value || null;
}

function readSaleCustomerName(payload: SalePayload): string | null {
  const value = payload.customer_name?.trim() || payload.customerName?.trim() || '';
  return value || null;
}

function readSaleReceiptNumber(payload: SalePayload): string | null {
  const value = payload.receipt_number?.trim() || payload.receiptNumber?.trim() || '';
  return value || null;
}

function readSaleCustomerCode(payload: SalePayload): string | null {
  const value = payload.customer_code?.trim() || payload.customerCode?.trim() || '';
  return value || null;
}

function normalizeRemoteSalePayload(rowPayload: string): SalePayload {
  const parsed = parsePayload<RemoteSaleEnvelope | SalePayload>(rowPayload);
  const nestedPayload =
    parsed && typeof parsed === 'object' && 'payload' in parsed
      ? parsed.payload
      : null;
  if (nestedPayload && typeof nestedPayload === 'object') {
    return nestedPayload as SalePayload;
  }
  if (typeof nestedPayload === 'string') {
    return parsePayload<SalePayload>(nestedPayload);
  }
  return parsed as SalePayload;
}

function formatCustomerSubtitle(row: MasterDataOption): string {
  const raw = (row.subtitle ?? row.code ?? row.id).trim();
  const cleaned = raw
    .replace(/(?:\s*-\s*)?Bal:\s*PHP\s*\d+(?:\.\d+)?/gi, '')
    .replace(/(?:\s*-\s*)?Pts:\s*\d+/gi, '')
    .trim()
    .replace(/\s*-\s*$/g, '');
  return cleaned.length > 0 ? cleaned : row.id;
}

async function loadCustomerTransactions(
  db: SQLiteDatabase,
  customer: MasterDataOption,
): Promise<CustomerTransaction[]> {
  const customerId = customer.id;
  const customerName = customer.label.trim().toLowerCase();
  const customerCode = formatCustomerSubtitle(customer).split(' - ')[0]?.trim() || null;
  const customerNeedleCompact = `%"customer_id":"${customerId}"%`;
  const customerNeedleSpaced = `%"customer_id": "${customerId}"%`;

  const [sales, remoteSales, payments] = await Promise.all([
    db.getAllAsync<LocalSaleRow>(
      `
      SELECT id, payload, sync_status, created_at
      FROM sales_local
      WHERE payload LIKE ? OR payload LIKE ?
      ORDER BY created_at DESC
      LIMIT 300
      `,
      customerNeedleCompact,
      customerNeedleSpaced,
    ),
    db.getAllAsync<RemoteSaleRow>(
      `
      SELECT record_id, payload, updated_at
      FROM master_data_local
      WHERE entity = 'remote_sale'
      ORDER BY updated_at DESC
      LIMIT 500
      `,
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
      customerNeedleSpaced,
    ),
  ]);

  const txns: CustomerTransaction[] = [];

  for (const row of sales) {
    const payload = parsePayload<SalePayload>(row.payload);
    const subtotal = (payload.lines ?? []).reduce((sum, line) => {
      const qty = toAmount(line.quantity ?? line.qty);
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
      subtitle: `${String(payload.sale_type ?? 'PICKUP').toUpperCase()} - ${fmtMoney(total)}`,
    });
  }

  for (const row of remoteSales) {
    const payload = normalizeRemoteSalePayload(row.payload);
    const payloadCustomerId = readSaleCustomerId(payload);
    const payloadCustomerName = readSaleCustomerName(payload)?.toLowerCase() || null;
    const payloadCustomerCode = readSaleCustomerCode(payload);
    if (
      payloadCustomerId !== customerId &&
      payloadCustomerName !== customerName &&
      payloadCustomerCode !== customerCode
    ) {
      continue;
    }
    const subtotal = (payload.lines ?? []).reduce((sum, line) => {
      const qty = toAmount(line.quantity ?? line.qty);
      const unitPrice = toAmount(line.unitPrice ?? line.unit_price);
      return sum + qty * unitPrice;
    }, 0);
    const discount = toAmount(payload.discount_amount);
    const total = Number(Math.max(0, subtotal - discount).toFixed(2));
    txns.push({
      id: `remote-sale-${payload.id ?? row.record_id}`,
      type: 'SALE',
      amount: total,
      createdAt: payload.created_at ?? row.updated_at,
      syncStatus: 'synced',
      title: `Sale ${payload.id ?? row.record_id}`,
      subtitle: `${String(payload.sale_type ?? 'PICKUP').toUpperCase()} - ${fmtMoney(total)}${readSaleReceiptNumber(payload) ? ` - #${readSaleReceiptNumber(payload)}` : ''}`,
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
      subtitle: `${String(payload.method ?? 'CASH').toUpperCase()} - ${payload.sale_id ? `Sale ${payload.sale_id}` : 'Unlinked'}${payload.reference_no ? ` - Ref ${payload.reference_no}` : ''}`,
    });
  }

  const transactions = txns.sort((a, b) => {
    const aTs = new Date(a.createdAt).getTime();
    const bTs = new Date(b.createdAt).getTime();
    return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
  });

  return transactions;
}
