import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import Toast from 'react-native-toast-message';
import {
  getNativeNfcCapabilities,
  startNativeNfcScan,
  stopNativeNfcScan,
  subscribeToNfcTagEvents,
  type NativeNfcCapabilities,
  type NfcTagEvent
} from './src/features/nfc/native-nfc.bridge';
import {
  initLocalStore,
  listOutbox,
  listSyncableOutbox,
  loadAuditCache,
  loadCardsCache,
  queueOutbox,
  replaceAuditCache,
  replaceCardsCache,
  resetFailedOutboxToPending,
  updateOutboxStatus,
  type NfcOutboxItem
} from './src/features/offline/local-store';
import {
  goeyToastConfig,
  toastError,
  toastInfo,
  toastSuccess
} from './src/goey-toast';

type LoginResponse = {
  access_token: string;
  refresh_token?: string;
  client_id?: string;
};

type ApiUser = {
  id: string;
  full_name: string;
  email: string;
  roles: string[];
  is_active?: boolean;
};

type BoundCardResponse = {
  id: string;
  uid: string;
  status: string;
  owner: {
    id: string;
    full_name: string;
    email: string;
  };
};

type ApiCard = {
  id: string;
  uid: string;
  status: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  owner: {
    id: string;
    full_name: string;
    email: string;
  };
  assigned_at: string;
  updated_at: string;
};

type CardStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'REVOKED';
type AuditEventFilter = 'ALL' | 'BIND' | 'REASSIGN' | 'DEACTIVATE' | 'REACTIVATE' | 'REVOKE';
type AdminTab = 'SYNC' | 'SCOPE' | 'NFC' | 'ENROLL' | 'CARDS' | 'CUSTOMERS' | 'AUDIT' | 'POINTS';

type TopologyLocation = {
  id: string;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
};

type TopologyBranch = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  locations: TopologyLocation[];
};

type TopologyTenant = {
  company_id: string;
  company_code: string;
  company_name: string;
  branches: TopologyBranch[];
  unassigned_locations: TopologyLocation[];
};

type VcardTopologyResponse = {
  generated_at: string;
  actor_scope: 'PLATFORM_OWNER' | 'TENANT_ADMIN';
  tenants: TopologyTenant[];
};

type ApiCustomer = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  outstandingBalance?: number;
};

type VcardInventoryCard = {
  id: string;
  card_uid: string;
  card_number: string;
  serial_number: string | null;
  card_url: string | null;
  status: 'UNASSIGNED' | 'ASSIGNED' | 'INACTIVE' | 'REVOKED';
  branch_id: string | null;
  location_id: string | null;
};

type VcardCustomerCard = {
  id: string;
  customer: {
    id: string;
    code: string;
    name: string;
    points_balance: number;
  };
  card: VcardInventoryCard;
  status: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  assigned_at: string;
  unassigned_at: string | null;
  revoked_at: string | null;
  updated_at: string;
};

type PickerKind =
  | 'TENANT'
  | 'BRANCH'
  | 'LOCATION'
  | 'CUSTOMER'
  | 'INVENTORY_CARD'
  | 'REASSIGN_CUSTOMER';

type CustomerLifecycleAction = 'REASSIGN' | 'UNASSIGN' | 'REVOKE' | 'REACTIVATE';

type ApiAuditEvent = {
  id: string;
  card_id: string;
  uid: string;
  event_type: 'BIND' | 'REASSIGN' | 'DEACTIVATE' | 'REACTIVATE' | 'REVOKE';
  actor: {
    id: string;
    full_name: string;
    email: string;
  } | null;
  payload: Record<string, unknown>;
  created_at: string;
};

type VcardPointsPolicy = {
  company_id: string;
  earn_peso_per_point: number;
  redeem_peso_per_point: number;
  min_spend_for_earn: number;
  max_redeem_points_per_txn: number | null;
  points_expiry_days: number | null;
  updated_at: string;
};

type SessionClaims = {
  userId: string | null;
  email: string | null;
  companyId: string | null;
  roles: string[];
};

type WriteQueueStatus = 'pending' | 'needs_review';

const env = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env;

function normalizeApiBaseUrl(input: string): string {
  const value = input.trim().replace(/\/+$/, '');
  if (!value) {
    return '';
  }
  if (/\/api$/i.test(value)) {
    return value;
  }
  return `${value}/api`;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const mod = normalized.length % 4;
  const padded = mod === 0 ? normalized : `${normalized}${'='.repeat(4 - mod)}`;
  return globalThis.atob ? globalThis.atob(padded) : '';
}

function decodeSessionClaims(accessToken: string): SessionClaims | null {
  const token = accessToken.trim();
  if (!token) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    const rolesRaw = payload.roles;
    const roles = Array.isArray(rolesRaw)
      ? rolesRaw.map((value) => String(value).trim().toLowerCase()).filter((value) => value.length > 0)
      : [];
    const userId = typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : null;
    const email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : null;
    const companyIdRaw = payload.company_id ?? payload.companyId;
    const companyId = typeof companyIdRaw === 'string' && companyIdRaw.trim() ? companyIdRaw.trim() : null;
    return {
      userId,
      email,
      companyId,
      roles
    };
  } catch {
    return null;
  }
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }
  const asRecord = payload as Record<string, unknown>;
  if (typeof asRecord.message === 'string' && asRecord.message.trim().length > 0) {
    return asRecord.message.trim();
  }
  if (Array.isArray(asRecord.message) && asRecord.message.length > 0) {
    const first = asRecord.message[0];
    if (typeof first === 'string' && first.trim().length > 0) {
      return first.trim();
    }
  }
  if (typeof asRecord.error === 'string' && asRecord.error.trim().length > 0) {
    return asRecord.error.trim();
  }
  return fallback;
}

function extractErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const asRecord = payload as Record<string, unknown>;
  if (typeof asRecord.code === 'string' && asRecord.code.trim().length > 0) {
    return asRecord.code.trim().toUpperCase();
  }
  return null;
}

function shouldMarkNeedsReview(status: number, code: string | null): boolean {
  if (status === 409) {
    return true;
  }
  if (!code) {
    return false;
  }
  return (
    code === 'NFC_UID_ALREADY_BOUND' ||
    code === 'NFC_CARD_NOT_FOUND' ||
    code === 'NFC_OWNER_INACTIVE' ||
    code === 'NFC_CARD_REVOKED' ||
    code === 'NFC_INVALID_TRANSITION'
  );
}

function isRetryableServerFailure(status: number): boolean {
  return status >= 500 && status <= 599;
}

function isLikelyNetworkError(cause: unknown): boolean {
  if (!(cause instanceof Error)) {
    return false;
  }
  const message = cause.message.toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('timed out')
  );
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function mapApiUser(input: unknown): ApiUser | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const row = input as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  if (!id) {
    return null;
  }
  const fullNameRaw = row.full_name ?? row.fullName;
  const fullName = typeof fullNameRaw === 'string' && fullNameRaw.trim() ? fullNameRaw.trim() : id;
  const email = typeof row.email === 'string' ? row.email.trim() : '-';
  const roles = Array.isArray(row.roles)
    ? row.roles
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0)
    : [];
  const activeRaw = row.is_active ?? row.isActive;
  const isActive = typeof activeRaw === 'boolean' ? activeRaw : undefined;
  return {
    id,
    full_name: fullName,
    email,
    roles,
    is_active: isActive
  };
}

function mapApiCard(input: unknown): ApiCard | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const row = input as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const uid = typeof row.uid === 'string' ? row.uid.trim() : '';
  const statusRaw = typeof row.status === 'string' ? row.status.trim().toUpperCase() : '';
  const status = statusRaw === 'ACTIVE' || statusRaw === 'INACTIVE' || statusRaw === 'REVOKED'
    ? statusRaw
    : 'INACTIVE';
  if (!id || !uid) {
    return null;
  }
  const ownerRaw = row.owner;
  const owner = ownerRaw && typeof ownerRaw === 'object'
    ? (ownerRaw as Record<string, unknown>)
    : {};
  const ownerId = typeof owner.id === 'string' ? owner.id.trim() : '';
  const ownerName = typeof owner.full_name === 'string' && owner.full_name.trim()
    ? owner.full_name.trim()
    : ownerId || '-';
  const ownerEmail = typeof owner.email === 'string' && owner.email.trim()
    ? owner.email.trim()
    : '-';
  const assignedAt = typeof row.assigned_at === 'string' ? row.assigned_at : '';
  const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : '';
  return {
    id,
    uid,
    status,
    owner: {
      id: ownerId || '-',
      full_name: ownerName,
      email: ownerEmail
    },
    assigned_at: assignedAt,
    updated_at: updatedAt
  };
}

function mapApiAuditEvent(input: unknown): ApiAuditEvent | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const row = input as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const cardId = typeof row.card_id === 'string' ? row.card_id.trim() : '';
  const uid = typeof row.uid === 'string' ? row.uid.trim() : '';
  const eventTypeRaw = typeof row.event_type === 'string' ? row.event_type.trim().toUpperCase() : '';
  const eventType =
    eventTypeRaw === 'BIND' ||
    eventTypeRaw === 'REASSIGN' ||
    eventTypeRaw === 'DEACTIVATE' ||
    eventTypeRaw === 'REACTIVATE' ||
    eventTypeRaw === 'REVOKE'
      ? eventTypeRaw
      : null;
  if (!id || !cardId || !uid || !eventType) {
    return null;
  }
  const actorRaw = row.actor;
  const actorObj = actorRaw && typeof actorRaw === 'object' ? (actorRaw as Record<string, unknown>) : null;
  const actor =
    actorObj && typeof actorObj.id === 'string'
      ? {
          id: actorObj.id.trim(),
          full_name:
            typeof actorObj.full_name === 'string' && actorObj.full_name.trim()
              ? actorObj.full_name.trim()
              : actorObj.id.trim(),
          email:
            typeof actorObj.email === 'string' && actorObj.email.trim() ? actorObj.email.trim() : '-'
        }
      : null;
  const payload =
    row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};
  const createdAt = typeof row.created_at === 'string' ? row.created_at : '';
  return {
    id,
    card_id: cardId,
    uid,
    event_type: eventType,
    actor,
    payload,
    created_at: createdAt
  };
}

function mapVcardPointsPolicy(input: unknown): VcardPointsPolicy | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const row = input as Record<string, unknown>;
  const companyId = typeof row.company_id === 'string' ? row.company_id.trim() : '';
  const earnPesoPerPoint = Number(row.earn_peso_per_point);
  const redeemPesoPerPoint = Number(row.redeem_peso_per_point);
  const minSpendForEarn = Number(row.min_spend_for_earn);
  const maxRedeemRaw = row.max_redeem_points_per_txn;
  const expiryRaw = row.points_expiry_days;
  const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : '';
  if (
    !companyId ||
    !Number.isFinite(earnPesoPerPoint) ||
    !Number.isFinite(redeemPesoPerPoint) ||
    !Number.isFinite(minSpendForEarn)
  ) {
    return null;
  }
  const maxRedeemPointsPerTxn =
    maxRedeemRaw === null || maxRedeemRaw === undefined ? null : Number(maxRedeemRaw);
  const pointsExpiryDays =
    expiryRaw === null || expiryRaw === undefined ? null : Number(expiryRaw);
  return {
    company_id: companyId,
    earn_peso_per_point: earnPesoPerPoint,
    redeem_peso_per_point: redeemPesoPerPoint,
    min_spend_for_earn: minSpendForEarn,
    max_redeem_points_per_txn:
      maxRedeemPointsPerTxn !== null && Number.isFinite(maxRedeemPointsPerTxn)
        ? maxRedeemPointsPerTxn
        : null,
    points_expiry_days:
      pointsExpiryDays !== null && Number.isFinite(pointsExpiryDays) ? pointsExpiryDays : null,
    updated_at: updatedAt
  };
}

function mapApiCustomer(input: unknown): ApiCustomer | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const row = input as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const code = typeof row.code === 'string' ? row.code.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  if (!id || !name) {
    return null;
  }
  return {
    id,
    code: code || id,
    name,
    is_active: row.isActive !== false && row.is_active !== false,
    outstandingBalance:
      typeof row.outstandingBalance === 'number'
        ? row.outstandingBalance
        : typeof row.outstanding_balance === 'number'
          ? row.outstanding_balance
          : undefined
  };
}

function mapVcardInventoryCard(input: unknown): VcardInventoryCard | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const row = input as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const cardUid = typeof row.card_uid === 'string' ? row.card_uid.trim() : '';
  const cardNumber = typeof row.card_number === 'string' ? row.card_number.trim() : '';
  const statusRaw = typeof row.status === 'string' ? row.status.trim().toUpperCase() : '';
  const status =
    statusRaw === 'UNASSIGNED' ||
    statusRaw === 'ASSIGNED' ||
    statusRaw === 'INACTIVE' ||
    statusRaw === 'REVOKED'
      ? statusRaw
      : 'INACTIVE';
  if (!id || !cardUid || !cardNumber) {
    return null;
  }
  return {
    id,
    card_uid: cardUid,
    card_number: cardNumber,
    serial_number: typeof row.serial_number === 'string' ? row.serial_number : null,
    card_url: typeof row.card_url === 'string' ? row.card_url : null,
    status,
    branch_id: typeof row.branch_id === 'string' ? row.branch_id : null,
    location_id: typeof row.location_id === 'string' ? row.location_id : null
  };
}

function mapVcardCustomerCard(input: unknown): VcardCustomerCard | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const row = input as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const statusRaw = typeof row.status === 'string' ? row.status.trim().toUpperCase() : '';
  const status =
    statusRaw === 'ACTIVE' || statusRaw === 'INACTIVE' || statusRaw === 'REVOKED'
      ? statusRaw
      : 'INACTIVE';
  const customerRaw =
    row.customer && typeof row.customer === 'object' ? (row.customer as Record<string, unknown>) : null;
  const cardRaw = row.card;
  const card = mapVcardInventoryCard(cardRaw);
  if (!id || !customerRaw || !card) {
    return null;
  }
  const customerId = typeof customerRaw.id === 'string' ? customerRaw.id.trim() : '';
  const customerCode = typeof customerRaw.code === 'string' ? customerRaw.code.trim() : '';
  const customerName = typeof customerRaw.name === 'string' ? customerRaw.name.trim() : '';
  if (!customerId || !customerName) {
    return null;
  }
  return {
    id,
    customer: {
      id: customerId,
      code: customerCode || customerId,
      name: customerName,
      points_balance:
        typeof customerRaw.points_balance === 'number' ? customerRaw.points_balance : 0
    },
    card,
    status,
    assigned_at: typeof row.assigned_at === 'string' ? row.assigned_at : '',
    unassigned_at: typeof row.unassigned_at === 'string' ? row.unassigned_at : null,
    revoked_at: typeof row.revoked_at === 'string' ? row.revoked_at : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : ''
  };
}

export default function App(): JSX.Element {
  const nfcTapDedupMs = 2500;
  const adminRoles = useMemo(() => new Set(['admin', 'owner', 'platform_owner']), []);
  const lastAcceptedTagRef = useRef<{ uidHex: string; at: number } | null>(null);

  const [apiBaseUrl, setApiBaseUrl] = useState(
    normalizeApiBaseUrl(env?.EXPO_PUBLIC_API_BASE_URL ?? 'https://vmjamtech.com/api')
  );
  const [clientId, setClientId] = useState((env?.EXPO_PUBLIC_CLIENT_ID ?? '').trim());
  const [platformOwnerKey, setPlatformOwnerKey] = useState(
    (env?.EXPO_PUBLIC_VCARD_PLATFORM_OWNER_KEY ?? '').trim()
  );
  const [platformKeySession, setPlatformKeySession] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [sessionClaims, setSessionClaims] = useState<SessionClaims | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [topology, setTopology] = useState<VcardTopologyResponse | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);

  const [capabilities, setCapabilities] = useState<NativeNfcCapabilities | null>(null);
  const [nfcBusy, setNfcBusy] = useState(false);
  const [nfcError, setNfcError] = useState<string | null>(null);
  const [nfcScanNotice, setNfcScanNotice] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastTag, setLastTag] = useState<NfcTagEvent | null>(null);

  const [users, setUsers] = useState<ApiUser[]>([]);
  const [usersBusy, setUsersBusy] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const [bindBusy, setBindBusy] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);
  const [lastBoundCard, setLastBoundCard] = useState<BoundCardResponse | null>(null);
  const [cards, setCards] = useState<ApiCard[]>([]);
  const [cardsBusy, setCardsBusy] = useState(false);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [cardSearch, setCardSearch] = useState('');
  const [cardStatusFilter, setCardStatusFilter] = useState<CardStatusFilter>('ALL');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [cardActionBusy, setCardActionBusy] = useState(false);
  const [cardActionError, setCardActionError] = useState<string | null>(null);
  const [cardActionSuccess, setCardActionSuccess] = useState<string | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replaceSuccess, setReplaceSuccess] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<ApiAuditEvent[]>([]);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditFilter, setAuditFilter] = useState<AuditEventFilter>('ALL');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditCsvBusy, setAuditCsvBusy] = useState(false);
  const [auditCsvError, setAuditCsvError] = useState<string | null>(null);
  const [auditCsvInfo, setAuditCsvInfo] = useState<string | null>(null);
  const [auditCsvPreview, setAuditCsvPreview] = useState('');
  const [pointsPolicy, setPointsPolicy] = useState<VcardPointsPolicy | null>(null);
  const [pointsPolicyBusy, setPointsPolicyBusy] = useState(false);
  const [pointsPolicyError, setPointsPolicyError] = useState<string | null>(null);
  const [pointsPolicyInfo, setPointsPolicyInfo] = useState<string | null>(null);
  const [policyEarnPesoPerPoint, setPolicyEarnPesoPerPoint] = useState('100');
  const [policyRedeemPesoPerPoint, setPolicyRedeemPesoPerPoint] = useState('1');
  const [policyMinSpendForEarn, setPolicyMinSpendForEarn] = useState('0');
  const [policyMaxRedeemPoints, setPolicyMaxRedeemPoints] = useState('');
  const [policyPointsExpiryDays, setPolicyPointsExpiryDays] = useState('');
  const [pointsCustomerId, setPointsCustomerId] = useState('');
  const [pointsCardInventoryId, setPointsCardInventoryId] = useState('');
  const [pointsAmount, setPointsAmount] = useState('');
  const [pointsValue, setPointsValue] = useState('');
  const [pointsRemarks, setPointsRemarks] = useState('');
  const [pointsActionBusy, setPointsActionBusy] = useState(false);
  const [pointsActionError, setPointsActionError] = useState<string | null>(null);
  const [pointsActionInfo, setPointsActionInfo] = useState<string | null>(null);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [customersBusy, setCustomersBusy] = useState(false);
  const [customersError, setCustomersError] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [inventoryCards, setInventoryCards] = useState<VcardInventoryCard[]>([]);
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [selectedInventoryCardId, setSelectedInventoryCardId] = useState<string | null>(null);
  const [customerCards, setCustomerCards] = useState<VcardCustomerCard[]>([]);
  const [customerCardsBusy, setCustomerCardsBusy] = useState(false);
  const [customerCardsError, setCustomerCardsError] = useState<string | null>(null);
  const [selectedCustomerCardId, setSelectedCustomerCardId] = useState<string | null>(null);
  const [customerActionBusy, setCustomerActionBusy] = useState(false);
  const [customerActionModalOpen, setCustomerActionModalOpen] = useState(false);
  const [customerConfirmAction, setCustomerConfirmAction] = useState<CustomerLifecycleAction | null>(null);
  const [pendingReassignCardId, setPendingReassignCardId] = useState<string | null>(null);
  const [createCardBusy, setCreateCardBusy] = useState(false);
  const [cardNumberDraft, setCardNumberDraft] = useState('');
  const [serialNumberDraft, setSerialNumberDraft] = useState('');
  const [cardUrlDraft, setCardUrlDraft] = useState('');
  const [assignBusy, setAssignBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState<PickerKind | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [dbReady, setDbReady] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [outboxItems, setOutboxItems] = useState<NfcOutboxItem[]>([]);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState<string | null>(null);
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('SCOPE');

  const deviceLabel = useMemo(() => {
    if (!capabilities) {
      return 'Loading...';
    }
    return `${capabilities.deviceManufacturer} ${capabilities.deviceModel}`;
  }, [capabilities]);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  const hasNfcAdminAccess = useMemo(() => {
    if (!sessionClaims) {
      return false;
    }
    return sessionClaims.roles.some((role) => adminRoles.has(role));
  }, [adminRoles, sessionClaims]);

  const adminTabs = useMemo(
    (): Array<{ id: AdminTab; label: string }> => [
      { id: 'SYNC', label: 'Sync' },
      { id: 'SCOPE', label: 'Scope' },
      { id: 'NFC', label: 'NFC' },
      { id: 'ENROLL', label: 'Enroll' },
      { id: 'CARDS', label: 'Cards' },
      { id: 'CUSTOMERS', label: 'Customers' },
      { id: 'AUDIT', label: 'Audit' },
      { id: 'POINTS', label: 'Points' }
    ],
    []
  );

  const filteredUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase();
    const activeUsers = users.filter((user) => user.is_active !== false);
    if (!query) {
      return activeUsers;
    }
    return activeUsers.filter((user) => {
      const byName = user.full_name.toLowerCase().includes(query);
      const byEmail = user.email.toLowerCase().includes(query);
      const byRole = user.roles.join(', ').toLowerCase().includes(query);
      return byName || byEmail || byRole;
    });
  }, [users, userQuery]);

  const selectedTenant = useMemo(
    () => topology?.tenants.find((tenant) => tenant.company_id === selectedTenantId) ?? null,
    [topology, selectedTenantId]
  );

  const branchOptions = useMemo(() => selectedTenant?.branches ?? [], [selectedTenant]);

  const locationOptions = useMemo(() => {
    if (!selectedTenant) {
      return [];
    }
    if (!selectedBranchId) {
      return selectedTenant.unassigned_locations;
    }
    const branch = selectedTenant.branches.find((item) => item.id === selectedBranchId);
    return branch?.locations ?? [];
  }, [selectedBranchId, selectedTenant]);

  const selectedBranch = useMemo(
    () => branchOptions.find((branch) => branch.id === selectedBranchId) ?? null,
    [branchOptions, selectedBranchId]
  );

  const selectedLocation = useMemo(
    () => locationOptions.find((location) => location.id === selectedLocationId) ?? null,
    [locationOptions, selectedLocationId]
  );

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  const selectedInventoryCard = useMemo(
    () => inventoryCards.find((card) => card.id === selectedInventoryCardId) ?? null,
    [inventoryCards, selectedInventoryCardId]
  );

  const selectedCustomerCard = useMemo(
    () => customerCards.find((row) => row.id === selectedCustomerCardId) ?? null,
    [customerCards, selectedCustomerCardId]
  );
  const customerConfirmTargetCard = useMemo(() => {
    const targetId =
      customerConfirmAction === 'REASSIGN' ? pendingReassignCardId : selectedCustomerCardId;
    if (!targetId) {
      return null;
    }
    return customerCards.find((row) => row.id === targetId) ?? null;
  }, [customerCards, customerConfirmAction, pendingReassignCardId, selectedCustomerCardId]);

  const activeCompanyId = selectedTenantId?.trim() ?? '';
  const isConnected = Boolean(accessToken && hasNfcAdminAccess);

  const canCreateInventoryCard = Boolean(
    selectedTenantId &&
      lastTag?.uidHex &&
      cardNumberDraft.trim() &&
      !createCardBusy
  );

  const pickerOptions = useMemo((): Array<{ id: string; title: string; subtitle?: string }> => {
    if (!pickerOpen) {
      return [];
    }
    const query = pickerQuery.trim().toLowerCase();
    const filterRows = (rows: Array<{ id: string; title: string; subtitle?: string }>) =>
      rows.filter((row) => {
        if (!query) {
          return true;
        }
        return (
          row.title.toLowerCase().includes(query) ||
          (row.subtitle ?? '').toLowerCase().includes(query)
        );
      });

    if (pickerOpen === 'TENANT') {
      return filterRows(
        (topology?.tenants ?? []).map((row) => ({
          id: row.company_id,
          title: `${row.company_code} • ${row.company_name}`,
          subtitle: row.company_id
        }))
      );
    }
    if (pickerOpen === 'BRANCH') {
      return filterRows(
        branchOptions.map((row) => ({
          id: row.id,
          title: `${row.code} • ${row.name}`,
          subtitle: row.id
        }))
      );
    }
    if (pickerOpen === 'LOCATION') {
      return filterRows(
        locationOptions.map((row) => ({
          id: row.id,
          title: `${row.code} • ${row.name}`,
          subtitle: row.type
        }))
      );
    }
    if (pickerOpen === 'CUSTOMER' || pickerOpen === 'REASSIGN_CUSTOMER') {
      return filterRows(
        customers.map((row) => ({
          id: row.id,
          title: `${row.code} • ${row.name}`,
          subtitle: row.outstandingBalance !== undefined ? `Balance: PHP ${row.outstandingBalance.toFixed(2)}` : undefined
        }))
      );
    }
    return filterRows(
      inventoryCards.map((row) => ({
        id: row.id,
        title: `${row.card_number} • ${row.card_uid}`,
        subtitle: `${row.status}${row.serial_number ? ` • ${row.serial_number}` : ''}`
      }))
    );
  }, [pickerOpen, pickerQuery, topology, branchOptions, locationOptions, customers, inventoryCards]);

  const filteredCards = useMemo(() => {
    const search = cardSearch.trim().toLowerCase();
    return cards.filter((card) => {
      if (cardStatusFilter !== 'ALL' && card.status !== cardStatusFilter) {
        return false;
      }
      if (!search) {
        return true;
      }
      return (
        card.uid.toLowerCase().includes(search) ||
        card.owner.full_name.toLowerCase().includes(search) ||
        card.owner.email.toLowerCase().includes(search) ||
        card.id.toLowerCase().includes(search)
      );
    });
  }, [cards, cardSearch, cardStatusFilter]);

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) ?? null,
    [cards, selectedCardId]
  );

  const filteredAuditEvents = useMemo(() => {
    const query = auditSearch.trim().toLowerCase();
    return auditEvents.filter((event) => {
      if (auditFilter !== 'ALL' && event.event_type !== auditFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        event.uid.toLowerCase().includes(query) ||
        event.card_id.toLowerCase().includes(query) ||
        event.event_type.toLowerCase().includes(query) ||
        (event.actor?.full_name ?? '').toLowerCase().includes(query) ||
        (event.actor?.email ?? '').toLowerCase().includes(query)
      );
    });
  }, [auditEvents, auditFilter, auditSearch]);

  const pointsWarnings = useMemo(() => {
    const warnings: string[] = [];
    const minSpend = Number(policyMinSpendForEarn);
    const earnAmount = Number(pointsAmount);
    if (
      Number.isFinite(minSpend) &&
      minSpend > 0 &&
      Number.isFinite(earnAmount) &&
      earnAmount > 0 &&
      earnAmount < minSpend
    ) {
      warnings.push(`Earn amount is below min spend (${minSpend.toFixed(2)} PHP).`);
    }

    const maxRedeem = Number(policyMaxRedeemPoints);
    const redeemPoints = Number(pointsValue);
    if (
      Number.isFinite(maxRedeem) &&
      maxRedeem > 0 &&
      Number.isFinite(redeemPoints) &&
      redeemPoints > maxRedeem
    ) {
      warnings.push(`Redeem points exceed max per txn (${Math.trunc(maxRedeem)}).`);
    }

    const redeemRatio = Number(policyRedeemPesoPerPoint);
    if (
      Number.isFinite(redeemRatio) &&
      redeemRatio > 0 &&
      Number.isFinite(redeemPoints) &&
      redeemPoints > 0 &&
      Number.isFinite(earnAmount) &&
      earnAmount > 0
    ) {
      const maxRedeemAmount = redeemPoints * redeemRatio;
      if (earnAmount > maxRedeemAmount) {
        warnings.push(
          `Amount exceeds redeem ratio cap (${redeemRatio.toFixed(2)} PHP/point for ${redeemPoints} points).`
        );
      }
    }

    return warnings;
  }, [policyMaxRedeemPoints, policyMinSpendForEarn, policyRedeemPesoPerPoint, pointsAmount, pointsValue]);

  const outboxSummary = useMemo(() => {
    return outboxItems.reduce(
      (acc, item) => {
        if (item.status === 'pending') {
          acc.pending += 1;
        } else if (item.status === 'failed') {
          acc.failed += 1;
        } else if (item.status === 'needs_review') {
          acc.needsReview += 1;
        } else if (item.status === 'done') {
          acc.done += 1;
        }
        return acc;
      },
      { pending: 0, failed: 0, needsReview: 0, done: 0 }
    );
  }, [outboxItems]);

  const baseHeaders = (withAuth = false): Record<string, string> => ({
    'content-type': 'application/json',
    ...(clientId.trim() ? { 'x-client-id': clientId.trim() } : {}),
    ...(platformOwnerKey.trim() ? { 'x-platform-owner-key': platformOwnerKey.trim() } : {}),
    ...(withAuth && accessToken && !platformKeySession ? { authorization: `Bearer ${accessToken}` } : {})
  });

  const refreshOutbox = async (): Promise<void> => {
    if (!dbReady) {
      return;
    }
    const rows = await listOutbox(200);
    setOutboxItems(rows);
  };

  const hydrateLocalCache = async (): Promise<void> => {
    if (!dbReady) {
      return;
    }
    const [cachedCards, cachedAudit, cachedOutbox] = await Promise.all([
      loadCardsCache(),
      loadAuditCache(),
      listOutbox(200)
    ]);
    if (cards.length === 0 && cachedCards.length > 0) {
      setCards(cachedCards);
    }
    if (auditEvents.length === 0 && cachedAudit.length > 0) {
      setAuditEvents(cachedAudit);
    }
    setOutboxItems(cachedOutbox);
  };

  const queueCardWrite = async (
    operation: string,
    method: 'POST' | 'PATCH',
    path: string,
    payload: Record<string, unknown>,
    status: WriteQueueStatus,
    reason: string
  ): Promise<void> => {
    if (!dbReady) {
      return;
    }
    await queueOutbox({
      operation,
      method,
      path,
      payload,
      status,
      lastError: reason
    });
    await refreshOutbox();
  };

  useEffect(() => {
    let active = true;
    const bootstrapLocalStore = async (): Promise<void> => {
      try {
        await initLocalStore();
        if (!active) {
          return;
        }
        setDbReady(true);
        const [cachedCards, cachedAudit, cachedOutbox] = await Promise.all([
          loadCardsCache(),
          loadAuditCache(),
          listOutbox(200)
        ]);
        if (!active) {
          return;
        }
        if (cachedCards.length > 0) {
          setCards(cachedCards);
        }
        if (cachedAudit.length > 0) {
          setAuditEvents(cachedAudit);
        }
        setOutboxItems(cachedOutbox);
      } catch (cause) {
        if (!active) {
          return;
        }
        const message = cause instanceof Error ? cause.message : 'Local store init failed.';
        setOfflineNotice(`Local offline cache unavailable: ${message}`);
      }
    };
    void bootstrapLocalStore();
    return () => {
      active = false;
    };
  }, []);

  const loadCapabilities = async (): Promise<void> => {
    const info = await getNativeNfcCapabilities();
    setCapabilities(info);
  };

  useEffect(() => {
    void loadCapabilities();
    const subscription = subscribeToNfcTagEvents((tag) => {
      const now = Date.now();
      const previous = lastAcceptedTagRef.current;
      if (previous && previous.uidHex === tag.uidHex && now - previous.at < nfcTapDedupMs) {
        const seconds = Math.ceil((nfcTapDedupMs - (now - previous.at)) / 1000);
        setNfcScanNotice(`Duplicate tap ignored (${seconds}s cooldown).`);
        return;
      }
      lastAcceptedTagRef.current = { uidHex: tag.uidHex, at: now };
      setNfcScanNotice(null);
      setLastTag(tag);
      setBindError(null);
    });
    return () => {
      subscription.remove();
      void stopNativeNfcScan();
    };
  }, []);

  const handleLogin = async (): Promise<void> => {
    const normalizedBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
    if (!normalizedBaseUrl) {
      setAuthError('API Base URL is required.');
      toastError('Connect failed', 'API Base URL is required.');
      return;
    }
    if (!platformOwnerKey.trim()) {
      setAuthError('Platform owner key is required.');
      toastError('Connect failed', 'Platform owner key is required.');
      return;
    }

    setAuthBusy(true);
    setAuthError(null);
    setUsersError(null);
    setCardsError(null);
    setCardActionError(null);
    setCardActionSuccess(null);
    setReplaceError(null);
    setReplaceSuccess(null);
    setAuditError(null);
    setBindError(null);
    setOfflineNotice(null);
    setScopeError(null);
    try {
      const response = await fetch(`${normalizedBaseUrl}/vcard/topology`, {
        method: 'GET',
        headers: baseHeaders(false)
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `Connect failed (${response.status})`));
      }
      const parsed = payload as VcardTopologyResponse;
      if (!Array.isArray(parsed.tenants)) {
        throw new Error('Unexpected topology response format.');
      }
      setTopology(parsed);
      const firstTenantId = parsed.tenants[0]?.company_id ?? null;
      setSelectedTenantId((current) => (current && parsed.tenants.some((row) => row.company_id === current) ? current : firstTenantId));
      setAccessToken('platform-owner-key-session');
      setPlatformKeySession(true);
      setSessionClaims({
        userId: 'platform-owner-service',
        email: 'platform-owner-service@vmjamtech.local',
        companyId: firstTenantId,
        roles: ['platform_owner']
      });
      setApiBaseUrl(normalizedBaseUrl);
      if (dbReady) {
        await hydrateLocalCache();
      }
      toastSuccess('Connected', `Loaded ${parsed.tenants.length} tenant profile(s).`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Connect failed.';
      setAuthError(message);
      setAccessToken(null);
      setPlatformKeySession(false);
      setSessionClaims(null);
      setTopology(null);
      setSelectedTenantId(null);
      toastError('Connect failed', message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLoadUsers = async (): Promise<void> => {
    if (!accessToken) {
      setUsersError('Connect first to load users.');
      return;
    }
    if (!ensureAdminAccess()) {
      return;
    }
    setUsersBusy(true);
    setUsersError(null);
    try {
      const query = activeCompanyId
        ? `?companyId=${encodeURIComponent(activeCompanyId)}`
        : '';
      const response = await fetch(`${apiBaseUrl}/master-data/users${query}`, {
        method: 'GET',
        headers: baseHeaders(true)
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `Load users failed (${response.status})`));
      }
      if (!Array.isArray(payload)) {
        throw new Error('Unexpected users response format.');
      }
      const nextUsers = payload.map((row) => mapApiUser(row)).filter((row): row is ApiUser => Boolean(row));
      setUsers(nextUsers);
      if (selectedUserId && !nextUsers.some((user) => user.id === selectedUserId)) {
        setSelectedUserId(null);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load users.';
      setUsersError(message);
    } finally {
      setUsersBusy(false);
    }
  };

  const handleLoadCards = async (): Promise<void> => {
    if (!accessToken) {
      setCardsError('Connect first to load cards.');
      return;
    }
    if (!ensureAdminAccess()) {
      return;
    }
    setCardsBusy(true);
    setCardsError(null);
    setOfflineNotice(null);
    try {
      const query = new URLSearchParams();
      query.set('limit', '200');
      if (activeCompanyId) {
        query.set('companyId', activeCompanyId);
      }
      const querySuffix = query.toString();
      const response = await fetch(
        `${apiBaseUrl}/nfc/cards${querySuffix ? `?${querySuffix}` : ''}`,
        {
          method: 'GET',
          headers: baseHeaders(true)
        }
      );
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `Load cards failed (${response.status})`));
      }
      if (!Array.isArray(payload)) {
        throw new Error('Unexpected card list response format.');
      }
      const nextCards = payload.map((entry) => mapApiCard(entry)).filter((entry): entry is ApiCard => Boolean(entry));
      setCards(nextCards);
      if (dbReady) {
        await replaceCardsCache(nextCards);
      }
      if (selectedCardId && !nextCards.some((entry) => entry.id === selectedCardId)) {
        setSelectedCardId(null);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load cards.';
      if (dbReady) {
        const cachedCards = await loadCardsCache();
        if (cachedCards.length > 0) {
          setCards(cachedCards);
          setCardsError(`Live card load failed; showing local cache. ${message}`);
          setOfflineNotice('Using cached card records while API is unavailable.');
        } else {
          setCardsError(message);
        }
      } else {
        setCardsError(message);
      }
    } finally {
      setCardsBusy(false);
    }
  };

  const handleLoadAudit = async (): Promise<void> => {
    if (!accessToken) {
      setAuditError('Connect first to load audit events.');
      return;
    }
    if (!ensureAdminAccess()) {
      return;
    }
    setAuditBusy(true);
    setAuditError(null);
    setOfflineNotice(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (activeCompanyId) {
        params.set('companyId', activeCompanyId);
      }
      if (auditFilter !== 'ALL') {
        params.set('event_type', auditFilter);
      }
      if (selectedCardId) {
        params.set('card_id', selectedCardId);
      }
      const response = await fetch(`${apiBaseUrl}/nfc/audit?${params.toString()}`, {
        method: 'GET',
        headers: baseHeaders(true)
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `Load audit failed (${response.status})`));
      }
      if (!Array.isArray(payload)) {
        throw new Error('Unexpected audit response format.');
      }
      const nextEvents = payload
        .map((entry) => mapApiAuditEvent(entry))
        .filter((entry): entry is ApiAuditEvent => Boolean(entry));
      setAuditEvents(nextEvents);
      if (dbReady) {
        await replaceAuditCache(nextEvents);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load audit events.';
      if (dbReady) {
        const cachedAudit = await loadAuditCache();
        if (cachedAudit.length > 0) {
          setAuditEvents(cachedAudit);
          setAuditError(`Live audit load failed; showing local cache. ${message}`);
          setOfflineNotice('Using cached audit events while API is unavailable.');
        } else {
          setAuditError(message);
        }
      } else {
        setAuditError(message);
      }
    } finally {
      setAuditBusy(false);
    }
  };

  const handleExportAuditCsv = async (): Promise<void> => {
    if (!accessToken) {
      setAuditCsvError('Connect first to export audit CSV.');
      return;
    }
    if (!ensureAdminAccess()) {
      return;
    }
    setAuditCsvBusy(true);
    setAuditCsvError(null);
    setAuditCsvInfo(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '1000');
      if (activeCompanyId) {
        params.set('companyId', activeCompanyId);
      }
      if (auditFilter !== 'ALL') {
        params.set('event_type', auditFilter);
      }
      if (selectedCardId) {
        params.set('card_id', selectedCardId);
      }

      const response = await fetch(`${apiBaseUrl}/nfc/audit/export.csv?${params.toString()}`, {
        method: 'GET',
        headers: {
          ...baseHeaders(true),
          accept: 'text/csv'
        }
      });
      const text = await response.text();
      if (!response.ok) {
        try {
          const parsed = JSON.parse(text) as unknown;
          throw new Error(extractErrorMessage(parsed, `Audit CSV export failed (${response.status})`));
        } catch {
          throw new Error(text || `Audit CSV export failed (${response.status})`);
        }
      }

      const lineCount = text.split('\n').length;
      setAuditCsvPreview(text.slice(0, 4000));
      setAuditCsvInfo(`Export ready (${lineCount} lines). Share sheet opened.`);
      await Share.share({
        title: 'V-CARD NFC Audit CSV',
        message: text
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to export audit CSV.';
      setAuditCsvError(message);
    } finally {
      setAuditCsvBusy(false);
    }
  };

  const handleLoadScopeData = async (): Promise<void> => {
    if (!isConnected) {
      setScopeError('Connect first to load tenant scope.');
      return;
    }
    if (!activeCompanyId) {
      setScopeError('Select a tenant first.');
      return;
    }
    setScopeBusy(true);
    setScopeError(null);
    setCustomersError(null);
    setInventoryError(null);
    setCustomerCardsError(null);
    try {
      const [customersResponse, inventoryResponse, customerCardsResponse] = await Promise.all([
        fetch(
          `${apiBaseUrl}/master-data/customers?companyId=${encodeURIComponent(activeCompanyId)}&include_balance=1`,
          { method: 'GET', headers: baseHeaders(true) }
        ),
        fetch(
          `${apiBaseUrl}/vcard/inventory/cards?companyId=${encodeURIComponent(activeCompanyId)}&limit=200`,
          { method: 'GET', headers: baseHeaders(true) }
        ),
        fetch(
          `${apiBaseUrl}/vcard/cards?companyId=${encodeURIComponent(activeCompanyId)}&limit=200`,
          { method: 'GET', headers: baseHeaders(true) }
        )
      ]);

      const [customersPayload, inventoryPayload, customerCardsPayload] = await Promise.all([
        parseJsonResponse(customersResponse),
        parseJsonResponse(inventoryResponse),
        parseJsonResponse(customerCardsResponse)
      ]);

      if (!customersResponse.ok) {
        throw new Error(extractErrorMessage(customersPayload, `Load customers failed (${customersResponse.status})`));
      }
      if (!inventoryResponse.ok) {
        throw new Error(extractErrorMessage(inventoryPayload, `Load inventory cards failed (${inventoryResponse.status})`));
      }
      if (!customerCardsResponse.ok) {
        throw new Error(extractErrorMessage(customerCardsPayload, `Load customer cards failed (${customerCardsResponse.status})`));
      }

      const mappedCustomers = Array.isArray(customersPayload)
        ? customersPayload.map((row) => mapApiCustomer(row)).filter((row): row is ApiCustomer => Boolean(row))
        : [];
      const mappedInventoryCards = Array.isArray(inventoryPayload)
        ? inventoryPayload
            .map((row) => mapVcardInventoryCard(row))
            .filter((row): row is VcardInventoryCard => Boolean(row))
        : [];
      const mappedCustomerCards = Array.isArray(customerCardsPayload)
        ? customerCardsPayload
            .map((row) => mapVcardCustomerCard(row))
            .filter((row): row is VcardCustomerCard => Boolean(row))
        : [];

      setCustomers(mappedCustomers);
      setInventoryCards(mappedInventoryCards);
      setCustomerCards(mappedCustomerCards);

      setSelectedCustomerId((current) =>
        current && mappedCustomers.some((row) => row.id === current) ? current : mappedCustomers[0]?.id ?? null
      );
      const defaultInventoryCard =
        mappedInventoryCards.find((row) => row.status === 'UNASSIGNED') ?? mappedInventoryCards[0] ?? null;
      setSelectedInventoryCardId((current) =>
        current && mappedInventoryCards.some((row) => row.id === current) ? current : defaultInventoryCard?.id ?? null
      );
      setSelectedCustomerCardId((current) =>
        current && mappedCustomerCards.some((row) => row.id === current) ? current : mappedCustomerCards[0]?.id ?? null
      );
      if (customerActionModalOpen && !mappedCustomerCards.some((row) => row.id === selectedCustomerCardId)) {
        setCustomerActionModalOpen(false);
        setCustomerConfirmAction(null);
        setPendingReassignCardId(null);
      }
      toastSuccess('Scope loaded', `${mappedCustomers.length} customers, ${mappedInventoryCards.length} cards.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load tenant scope data.';
      setScopeError(message);
      toastError('Scope load failed', message);
    } finally {
      setScopeBusy(false);
    }
  };

  const handleCreateInventoryCard = async (): Promise<void> => {
    if (!isConnected) {
      toastError('Create card', 'Connect first.');
      return;
    }
    if (!activeCompanyId) {
      toastError('Create card', 'Select a tenant first.');
      return;
    }
    if (!lastTag?.uidHex) {
      toastError('Create card', 'Tap NFC card first to capture UID.');
      return;
    }
    if (!cardNumberDraft.trim()) {
      toastError('Create card', 'Card number is required.');
      return;
    }

    setCreateCardBusy(true);
    setInventoryError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/vcard/inventory/cards`, {
        method: 'POST',
        headers: baseHeaders(true),
        body: JSON.stringify({
          companyId: activeCompanyId,
          card_uid: lastTag.uidHex,
          card_number: cardNumberDraft.trim(),
          serial_number: serialNumberDraft.trim() || null,
          card_url: cardUrlDraft.trim() || null,
          branch_id: selectedBranchId || null,
          location_id: selectedLocationId || null,
          tag_type: 'NFC',
          writable: true
        })
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `Create card failed (${response.status})`));
      }
      const created = mapVcardInventoryCard(payload);
      if (!created) {
        throw new Error('Unexpected create card response format.');
      }
      setCardNumberDraft('');
      setSerialNumberDraft('');
      setCardUrlDraft('');
      setSelectedInventoryCardId(created.id);
      toastSuccess('Card created', `${created.card_number} (${created.card_uid})`);
      await handleLoadScopeData();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to create inventory card.';
      setInventoryError(message);
      toastError('Create card failed', message);
    } finally {
      setCreateCardBusy(false);
    }
  };

  const handleAssignCardToCustomer = (): void => {
    if (!selectedCustomer || !selectedInventoryCard) {
      toastError('Assign card', 'Select customer and card first.');
      return;
    }
    Alert.alert(
      'Assign Card',
      `Assign card ${selectedInventoryCard.card_number} to ${selectedCustomer.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Assign',
          style: 'default',
          onPress: () => {
            void (async () => {
              setAssignBusy(true);
              setCustomerCardsError(null);
              try {
                const response = await fetch(`${apiBaseUrl}/vcard/cards/assign`, {
                  method: 'POST',
                  headers: baseHeaders(true),
                  body: JSON.stringify({
                    companyId: activeCompanyId,
                    customer_id: selectedCustomer.id,
                    card_inventory_id: selectedInventoryCard.id
                  })
                });
                const payload = await parseJsonResponse(response);
                if (!response.ok) {
                  throw new Error(extractErrorMessage(payload, `Assign failed (${response.status})`));
                }
                toastSuccess('Assigned', `${selectedInventoryCard.card_number} -> ${selectedCustomer.name}`);
                await handleLoadScopeData();
              } catch (cause) {
                const message = cause instanceof Error ? cause.message : 'Failed to assign card.';
                setCustomerCardsError(message);
                toastError('Assign failed', message);
              } finally {
                setAssignBusy(false);
              }
            })();
          }
        }
      ]
    );
  };

  const openCustomerCardActions = (customerCardId: string): void => {
    setSelectedCustomerCardId(customerCardId);
    setPendingReassignCardId(null);
    setCustomerConfirmAction(null);
    setCustomerActionModalOpen(true);
  };

  const handleRequestCustomerReassign = (): void => {
    if (!selectedCustomerCard) {
      toastError('Reassign card', 'Select a customer card first.');
      return;
    }
    if (selectedCustomerCard.status === 'REVOKED') {
      toastError('Reassign card', 'Revoked cards cannot be reassigned.');
      return;
    }
    setPendingReassignCardId(selectedCustomerCard.id);
    setCustomerActionModalOpen(false);
    setPickerQuery('');
    setPickerOpen('REASSIGN_CUSTOMER');
  };

  const executeCustomerCardLifecycle = async (action: CustomerLifecycleAction): Promise<void> => {
    if (!isConnected) {
      toastError('Card action', 'Connect first.');
      return;
    }
    if (!activeCompanyId) {
      toastError('Card action', 'Select a tenant first.');
      return;
    }

    const targetCardId =
      action === 'REASSIGN' ? pendingReassignCardId ?? selectedCustomerCardId : selectedCustomerCardId;
    if (!targetCardId) {
      toastError('Card action', 'Select a customer card first.');
      return;
    }
    const targetCard = customerCards.find((row) => row.id === targetCardId) ?? null;
    if (!targetCard) {
      toastError('Card action', 'Selected customer card is no longer available.');
      return;
    }

    let endpoint = '';
    let body: Record<string, unknown> = { companyId: activeCompanyId };
    let successTitle = 'Card updated';
    let successBody = `${targetCard.card.card_number} updated successfully.`;
    let errorTitle = 'Card action failed';

    if (action === 'REASSIGN') {
      if (!selectedCustomerId) {
        toastError('Reassign card', 'Select target customer first.');
        return;
      }
      if (targetCard.customer.id === selectedCustomerId) {
        toastInfo('Reassign card', 'Selected customer already owns this card.');
        return;
      }
      endpoint = `/vcard/cards/${encodeURIComponent(targetCard.id)}/reassign`;
      body = { ...body, customer_id: selectedCustomerId };
      successTitle = 'Card reassigned';
      successBody = `${targetCard.card.card_number} was reassigned.`;
      errorTitle = 'Reassign failed';
    } else if (action === 'UNASSIGN') {
      endpoint = `/vcard/cards/${encodeURIComponent(targetCard.id)}/unassign`;
      successTitle = 'Card unassigned';
      successBody = `${targetCard.card.card_number} is now unassigned.`;
      errorTitle = 'Unassign failed';
    } else if (action === 'REVOKE') {
      endpoint = `/vcard/cards/${encodeURIComponent(targetCard.id)}/status`;
      body = { ...body, status: 'REVOKED' };
      successTitle = 'Card revoked';
      successBody = `${targetCard.card.card_number} is revoked.`;
      errorTitle = 'Revoke failed';
    } else {
      endpoint = `/vcard/cards/${encodeURIComponent(targetCard.id)}/status`;
      body = { ...body, status: 'ACTIVE' };
      successTitle = 'Card reactivated';
      successBody = `${targetCard.card.card_number} is active again.`;
      errorTitle = 'Reactivate failed';
    }

    setCustomerActionBusy(true);
    setCustomerCardsError(null);
    try {
      const response = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'PATCH',
        headers: baseHeaders(true),
        body: JSON.stringify(body)
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `${errorTitle} (${response.status})`));
      }

      toastSuccess(successTitle, successBody);
      setCustomerConfirmAction(null);
      setCustomerActionModalOpen(false);
      setPendingReassignCardId(null);
      await handleLoadScopeData();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Card action failed.';
      setCustomerCardsError(message);
      toastError(errorTitle, message);
    } finally {
      setCustomerActionBusy(false);
    }
  };

  const handleSelectPickerOption = (id: string): void => {
    if (!pickerOpen) {
      return;
    }
    if (pickerOpen === 'TENANT') {
      setSelectedTenantId(id);
    } else if (pickerOpen === 'BRANCH') {
      setSelectedBranchId(id);
      setSelectedLocationId(null);
    } else if (pickerOpen === 'LOCATION') {
      setSelectedLocationId(id);
    } else if (pickerOpen === 'CUSTOMER') {
      setSelectedCustomerId(id);
    } else if (pickerOpen === 'REASSIGN_CUSTOMER') {
      setSelectedCustomerId(id);
      if (!pendingReassignCardId) {
        toastError('Reassign card', 'No selected customer card to reassign.');
      } else {
        setCustomerConfirmAction('REASSIGN');
      }
    } else if (pickerOpen === 'INVENTORY_CARD') {
      setSelectedInventoryCardId(id);
    }
    setPickerOpen(null);
    setPickerQuery('');
  };

  const hydratePointsPolicyForm = (policy: VcardPointsPolicy): void => {
    setPolicyEarnPesoPerPoint(String(policy.earn_peso_per_point));
    setPolicyRedeemPesoPerPoint(String(policy.redeem_peso_per_point));
    setPolicyMinSpendForEarn(String(policy.min_spend_for_earn));
    setPolicyMaxRedeemPoints(
      policy.max_redeem_points_per_txn === null ? '' : String(policy.max_redeem_points_per_txn)
    );
    setPolicyPointsExpiryDays(
      policy.points_expiry_days === null ? '' : String(policy.points_expiry_days)
    );
  };

  const handleLoadPointsPolicy = async (): Promise<void> => {
    if (!accessToken) {
      setPointsPolicyError('Connect first to load points policy.');
      return;
    }
    if (!activeCompanyId) {
      setPointsPolicyError('Select a tenant first.');
      return;
    }
    if (!ensureAdminAccess()) {
      return;
    }
    setPointsPolicyBusy(true);
    setPointsPolicyError(null);
    setPointsPolicyInfo(null);
    try {
      const response = await fetch(
        `${apiBaseUrl}/vcard/points/policy?companyId=${encodeURIComponent(activeCompanyId)}`,
        {
        method: 'GET',
        headers: baseHeaders(true)
        }
      );
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `Load policy failed (${response.status})`));
      }
      const parsed = mapVcardPointsPolicy(payload);
      if (!parsed) {
        throw new Error('Unexpected points policy response format.');
      }
      setPointsPolicy(parsed);
      hydratePointsPolicyForm(parsed);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load points policy.';
      setPointsPolicyError(message);
    } finally {
      setPointsPolicyBusy(false);
    }
  };

  const handleSavePointsPolicy = async (): Promise<void> => {
    if (!accessToken) {
      setPointsPolicyError('Connect first to update points policy.');
      return;
    }
    if (!ensureAdminAccess()) {
      return;
    }
    if (!activeCompanyId) {
      setPointsPolicyError('Select a tenant first.');
      return;
    }
    setPointsPolicyBusy(true);
    setPointsPolicyError(null);
    setPointsPolicyInfo(null);
    try {
      const body: Record<string, unknown> = {
        earn_peso_per_point: Number(policyEarnPesoPerPoint || 0),
        redeem_peso_per_point: Number(policyRedeemPesoPerPoint || 0),
        min_spend_for_earn: Number(policyMinSpendForEarn || 0),
        max_redeem_points_per_txn: policyMaxRedeemPoints.trim()
          ? Number(policyMaxRedeemPoints)
          : null,
        points_expiry_days: policyPointsExpiryDays.trim() ? Number(policyPointsExpiryDays) : null
      };
      const response = await fetch(
        `${apiBaseUrl}/vcard/points/policy?companyId=${encodeURIComponent(activeCompanyId)}`,
        {
        method: 'PUT',
        headers: baseHeaders(true),
        body: JSON.stringify(body)
        }
      );
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `Update policy failed (${response.status})`));
      }
      const parsed = mapVcardPointsPolicy(payload);
      if (!parsed) {
        throw new Error('Unexpected policy update response format.');
      }
      setPointsPolicy(parsed);
      hydratePointsPolicyForm(parsed);
      setPointsPolicyInfo('Points policy saved.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to save points policy.';
      setPointsPolicyError(message);
    } finally {
      setPointsPolicyBusy(false);
    }
  };

  const handleSubmitPointsAction = async (action: 'earn' | 'redeem' | 'adjust'): Promise<void> => {
    if (!accessToken) {
      setPointsActionError('Connect first to submit points action.');
      return;
    }
    if (!ensureAdminAccess()) {
      return;
    }
    if (!activeCompanyId) {
      setPointsActionError('Select a tenant first.');
      return;
    }
    const customerId = pointsCustomerId.trim();
    if (!customerId) {
      setPointsActionError('Customer ID is required.');
      return;
    }

    setPointsActionBusy(true);
    setPointsActionError(null);
    setPointsActionInfo(null);
    try {
      const pointsNumeric = Number(pointsValue || 0);
      const amountNumeric = Number(pointsAmount || 0);
      const body: Record<string, unknown> = {
        companyId: activeCompanyId,
        customer_id: customerId,
        ...(pointsCardInventoryId.trim() ? { card_inventory_id: pointsCardInventoryId.trim() } : {}),
        ...(pointsRemarks.trim() ? { remarks: pointsRemarks.trim() } : {})
      };
      let path = '/vcard/points/earn';
      if (action === 'earn') {
        if (!Number.isFinite(amountNumeric) && !Number.isFinite(pointsNumeric)) {
          throw new Error('Provide amount or points for earn action.');
        }
        if (Number.isFinite(amountNumeric) && amountNumeric > 0) {
          body.amount = amountNumeric;
        }
        if (Number.isFinite(pointsNumeric) && pointsNumeric > 0) {
          body.points = pointsNumeric;
        }
      } else if (action === 'redeem') {
        if (!Number.isFinite(pointsNumeric) || pointsNumeric <= 0) {
          throw new Error('Redeem points must be greater than 0.');
        }
        path = '/vcard/points/redeem';
        body.points = pointsNumeric;
        if (Number.isFinite(amountNumeric) && amountNumeric > 0) {
          body.amount = amountNumeric;
        }
      } else {
        if (!Number.isFinite(pointsNumeric) || pointsNumeric === 0) {
          throw new Error('Adjust delta points must be non-zero.');
        }
        path = '/vcard/points/adjust';
        body.delta_points = Math.trunc(pointsNumeric);
      }

      const response = await fetch(`${apiBaseUrl}${path}`, {
        method: 'POST',
        headers: baseHeaders(true),
        body: JSON.stringify(body)
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        throw new Error(extractErrorMessage(payload, `Points ${action} failed (${response.status})`));
      }
      const row = payload as Record<string, unknown>;
      const txnType = typeof row.txn_type === 'string' ? row.txn_type : action.toUpperCase();
      const pointsApplied = Number(row.points ?? 0);
      setPointsActionInfo(`${txnType}: ${Number.isFinite(pointsApplied) ? pointsApplied : '-'} points recorded.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to submit points action.';
      setPointsActionError(message);
    } finally {
      setPointsActionBusy(false);
    }
  };

  useEffect(() => {
    if (!isConnected || !activeCompanyId) {
      return;
    }
    const timer = setTimeout(() => {
      void handleLoadScopeData();
    }, 120);
    return () => clearTimeout(timer);
  }, [isConnected, activeCompanyId]);

  useEffect(() => {
    setSelectedBranchId(null);
    setSelectedLocationId(null);
  }, [selectedTenantId]);

  useEffect(() => {
    if (!selectedBranchId) {
      return;
    }
    const branch = branchOptions.find((row) => row.id === selectedBranchId);
    if (!branch) {
      setSelectedBranchId(null);
      return;
    }
    if (selectedLocationId && !branch.locations.some((row) => row.id === selectedLocationId)) {
      setSelectedLocationId(null);
    }
  }, [selectedBranchId, selectedLocationId, branchOptions]);

  useEffect(() => {
    if (!accessToken || !hasNfcAdminAccess || !activeCompanyId) {
      return;
    }
    const timer = setTimeout(() => {
      void handleLoadAudit();
    }, 150);
    return () => clearTimeout(timer);
  }, [accessToken, auditFilter, hasNfcAdminAccess, selectedCardId, activeCompanyId]);

  useEffect(() => {
    if (!accessToken || !hasNfcAdminAccess || !activeCompanyId) {
      return;
    }
    const timer = setTimeout(() => {
      void handleLoadPointsPolicy();
    }, 220);
    return () => clearTimeout(timer);
  }, [accessToken, hasNfcAdminAccess, activeCompanyId]);

  const ensureAdminAccess = (message?: string): boolean => {
    if (hasNfcAdminAccess) {
      return true;
    }
    const error = message ?? 'NFC admin access required for this action.';
    setAuthError(error);
    return false;
  };

  const updateCardDetails = async (
    cardId: string,
    endpoint: string,
    body: Record<string, unknown>,
    successMessage: string
  ): Promise<void> => {
    if (!accessToken) {
      setCardActionError('Connect first to manage cards.');
      return;
    }
    if (!ensureAdminAccess()) {
      return;
    }
    setCardActionBusy(true);
    setCardActionError(null);
    setCardActionSuccess(null);
    setSyncError(null);
    setSyncSuccess(null);
    try {
      const method = endpoint === '/revoke' ? 'POST' : 'PATCH';
      const path = `/nfc/cards/${cardId}${endpoint}`;
      const response = await fetch(`${apiBaseUrl}${path}`, {
        method: endpoint === '/revoke' ? 'POST' : 'PATCH',
        headers: baseHeaders(true),
        body: JSON.stringify(body)
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        const code = extractErrorCode(payload);
        const message = extractErrorMessage(payload, `Card action failed (${response.status})`);
        if (shouldMarkNeedsReview(response.status, code)) {
          await queueCardWrite(
            endpoint === '/revoke' ? 'REVOKE' : 'UPDATE',
            method,
            path,
            body,
            'needs_review',
            `${code ?? 'CONFLICT'}: ${message}`
          );
          setCardActionError(`Queued as needs review: ${message}`);
          setOfflineNotice('Some queued actions need manual review before retry.');
          return;
        }
        if (isRetryableServerFailure(response.status)) {
          await queueCardWrite(
            endpoint === '/revoke' ? 'REVOKE' : 'UPDATE',
            method,
            path,
            body,
            'pending',
            message
          );
          setCardActionSuccess('API unavailable; action queued and will sync later.');
          setOfflineNotice('Write action queued because server is temporarily unavailable.');
          return;
        }
        throw new Error(message);
      }
      setCardActionSuccess(successMessage);
      await handleLoadCards();
      await refreshOutbox();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to apply card action.';
      if (isLikelyNetworkError(cause)) {
        const method = endpoint === '/revoke' ? 'POST' : 'PATCH';
        const path = `/nfc/cards/${cardId}${endpoint}`;
        await queueCardWrite(
          endpoint === '/revoke' ? 'REVOKE' : 'UPDATE',
          method,
          path,
          body,
          'pending',
          message
        );
        setCardActionSuccess('No network connection; action queued for sync.');
        setOfflineNotice('Write action queued while offline.');
      } else {
        setCardActionError(message);
      }
    } finally {
      setCardActionBusy(false);
    }
  };

  const handleReassignCard = (): void => {
    if (!selectedCard) {
      setCardActionError('Select a card first.');
      return;
    }
    if (selectedCard.status === 'REVOKED') {
      setCardActionError('Revoked cards cannot be reassigned.');
      return;
    }
    if (!selectedUser) {
      setCardActionError('Select a new owner in the user list first.');
      return;
    }
    if (selectedUser.id === selectedCard.owner.id) {
      setCardActionError('Selected user is already the owner of this card.');
      return;
    }
    Alert.alert(
      'Confirm Reassign',
      `Reassign card ${selectedCard.uid} to ${selectedUser.full_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reassign',
          onPress: () =>
            void updateCardDetails(
              selectedCard.id,
              '',
              {
                owner_id: selectedUser.id,
                metadata: {
                  source: 'mobile-nfc-admin',
                  action: 'REASSIGN'
                }
              },
              'Card owner updated successfully.'
            )
        }
      ]
    );
  };

  const handleToggleCardStatus = (): void => {
    if (!selectedCard) {
      setCardActionError('Select a card first.');
      return;
    }
    if (selectedCard.status === 'REVOKED') {
      setCardActionError('Revoked cards cannot be reactivated/deactivated.');
      return;
    }
    const nextStatus = selectedCard.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    Alert.alert(
      `Confirm ${nextStatus === 'ACTIVE' ? 'Reactivate' : 'Deactivate'}`,
      `${nextStatus === 'ACTIVE' ? 'Reactivate' : 'Deactivate'} card ${selectedCard.uid}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextStatus === 'ACTIVE' ? 'Reactivate' : 'Deactivate',
          onPress: () =>
            void updateCardDetails(
              selectedCard.id,
              '',
              {
                status: nextStatus,
                metadata: {
                  source: 'mobile-nfc-admin',
                  action: nextStatus === 'ACTIVE' ? 'REACTIVATE' : 'DEACTIVATE'
                }
              },
              `Card marked as ${nextStatus}.`
            )
        }
      ]
    );
  };

  const handleRevokeCard = (): void => {
    if (!selectedCard) {
      setCardActionError('Select a card first.');
      return;
    }
    if (selectedCard.status === 'REVOKED') {
      setCardActionError('This card is already revoked.');
      return;
    }
    Alert.alert(
      'Confirm Revoke',
      `Revoke card ${selectedCard.uid}? This action blocks regular use.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () =>
            void updateCardDetails(
              selectedCard.id,
              '/revoke',
              {
                metadata: {
                  source: 'mobile-nfc-admin',
                  action: 'REVOKE'
                }
              },
              'Card revoked successfully.'
            )
        }
      ]
    );
  };

  const executeReplaceLostCard = async (): Promise<void> => {
    if (!selectedCard) {
      setReplaceError('Select a card first.');
      return;
    }
    const replacementUid = (lastTag?.uidHex ?? '').trim().toUpperCase();
    if (!replacementUid) {
      setReplaceError('Tap the replacement NFC card first to capture UID.');
      return;
    }
    if (selectedCard.status === 'REVOKED') {
      setReplaceError('Cannot replace a card that is already revoked.');
      return;
    }
    if (replacementUid === selectedCard.uid.toUpperCase()) {
      setReplaceError('Replacement UID cannot be the same as current card UID.');
      return;
    }
    if (!accessToken) {
      setReplaceError('Connect first to manage cards.');
      return;
    }
    if (!ensureAdminAccess()) {
      return;
    }
    setReplaceBusy(true);
    setReplaceError(null);
    setReplaceSuccess(null);
    setSyncError(null);
    setSyncSuccess(null);
    const bindBody = {
      owner_id: selectedCard.owner.id,
      uid: replacementUid,
      metadata: {
        source: 'mobile-nfc-admin',
        action: 'REPLACE_LOST_CARD_BIND',
        replaced_card_id: selectedCard.id,
        replaced_uid: selectedCard.uid
      }
    };
    const revokeBody = {
      metadata: {
        source: 'mobile-nfc-admin',
        action: 'REPLACE_LOST_CARD_REVOKE_OLD',
        replacement_uid: replacementUid
      }
    };
    try {
      const bindResponse = await fetch(`${apiBaseUrl}/nfc/cards/bind`, {
        method: 'POST',
        headers: baseHeaders(true),
        body: JSON.stringify(bindBody)
      });
      const bindPayload = await parseJsonResponse(bindResponse);
      if (!bindResponse.ok) {
        const code = extractErrorCode(bindPayload);
        const message = extractErrorMessage(
          bindPayload,
          `Replacement bind failed (${bindResponse.status})`
        );
        if (shouldMarkNeedsReview(bindResponse.status, code)) {
          await queueCardWrite(
            'REPLACE_BIND',
            'POST',
            '/nfc/cards/bind',
            bindBody,
            'needs_review',
            `${code ?? 'CONFLICT'}: ${message}`
          );
          setReplaceError(`Queued as needs review: ${message}`);
          setOfflineNotice('Replacement needs manual review because of a conflict.');
          return;
        }
        if (isRetryableServerFailure(bindResponse.status)) {
          await queueCardWrite(
            'REPLACE_BIND',
            'POST',
            '/nfc/cards/bind',
            bindBody,
            'pending',
            message
          );
          await queueCardWrite(
            'REPLACE_REVOKE_OLD',
            'POST',
            `/nfc/cards/${selectedCard.id}/revoke`,
            revokeBody,
            'pending',
            'Queued after replacement bind request.'
          );
          setReplaceSuccess('API unavailable; replacement flow queued for sync.');
          setOfflineNotice('Replace flow queued because server is temporarily unavailable.');
          return;
        }
        throw new Error(message);
      }
      const newCard = bindPayload as BoundCardResponse;

      const revokeResponse = await fetch(`${apiBaseUrl}/nfc/cards/${selectedCard.id}/revoke`, {
        method: 'POST',
        headers: baseHeaders(true),
        body: JSON.stringify({
          metadata: {
            source: 'mobile-nfc-admin',
            action: 'REPLACE_LOST_CARD_REVOKE_OLD',
            replacement_card_id: newCard.id,
            replacement_uid: newCard.uid
          }
        })
      });
      const revokePayload = await parseJsonResponse(revokeResponse);
      if (!revokeResponse.ok) {
        const code = extractErrorCode(revokePayload);
        const message = extractErrorMessage(revokePayload, `status ${revokeResponse.status}`);
        const combined = `Replacement card was bound (${newCard.uid}) but old card revoke failed: ${message}`;
        if (shouldMarkNeedsReview(revokeResponse.status, code)) {
          await queueCardWrite(
            'REPLACE_REVOKE_OLD',
            'POST',
            `/nfc/cards/${selectedCard.id}/revoke`,
            {
              metadata: {
                source: 'mobile-nfc-admin',
                action: 'REPLACE_LOST_CARD_REVOKE_OLD',
                replacement_card_id: newCard.id,
                replacement_uid: newCard.uid
              }
            },
            'needs_review',
            `${code ?? 'CONFLICT'}: ${combined}`
          );
          setReplaceError(combined);
          setOfflineNotice('Old card revoke needs manual review.');
          return;
        }
        if (isRetryableServerFailure(revokeResponse.status)) {
          await queueCardWrite(
            'REPLACE_REVOKE_OLD',
            'POST',
            `/nfc/cards/${selectedCard.id}/revoke`,
            {
              metadata: {
                source: 'mobile-nfc-admin',
                action: 'REPLACE_LOST_CARD_REVOKE_OLD',
                replacement_card_id: newCard.id,
                replacement_uid: newCard.uid
              }
            },
            'pending',
            combined
          );
          setReplaceSuccess(
            `New card ${newCard.uid} is active. Old card revoke queued because the server is unavailable.`
          );
          setOfflineNotice('Queued revoke for old card after replacement.');
          return;
        }
        throw new Error(combined);
      }

      setLastBoundCard(newCard);
      setSelectedCardId(newCard.id);
      setReplaceSuccess(
        `Replaced lost card successfully. New UID ${newCard.uid} is now active and old UID ${selectedCard.uid} is revoked.`
      );
      await handleLoadCards();
      await handleLoadAudit();
      await refreshOutbox();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Replace lost card failed.';
      if (isLikelyNetworkError(cause)) {
        await queueCardWrite('REPLACE_BIND', 'POST', '/nfc/cards/bind', bindBody, 'pending', message);
        await queueCardWrite(
          'REPLACE_REVOKE_OLD',
          'POST',
          `/nfc/cards/${selectedCard.id}/revoke`,
          revokeBody,
          'pending',
          'Queued after network failure during replacement flow.'
        );
        setReplaceSuccess('No network connection; replacement flow queued for sync.');
        setOfflineNotice('Replace flow queued while offline.');
      } else {
        setReplaceError(message);
      }
    } finally {
      setReplaceBusy(false);
    }
  };

  const handleReplaceLostCard = (): void => {
    if (!selectedCard) {
      setReplaceError('Select a card first.');
      return;
    }
    const replacementUid = (lastTag?.uidHex ?? '').trim().toUpperCase();
    if (!replacementUid) {
      setReplaceError('Tap the replacement NFC card first.');
      return;
    }
    Alert.alert(
      'Confirm Replace Lost Card',
      `Old UID: ${selectedCard.uid}\nNew UID: ${replacementUid}\nOwner: ${selectedCard.owner.full_name}\n\nThis will bind the new card and revoke the old one.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace Now', onPress: () => void executeReplaceLostCard() }
      ]
    );
  };

  const handleStartScan = async (): Promise<void> => {
    if (!ensureAdminAccess('NFC admin access required to start scan.')) {
      return;
    }
    lastAcceptedTagRef.current = null;
    setNfcScanNotice(null);
    setNfcBusy(true);
    setNfcError(null);
    try {
      await startNativeNfcScan();
      setScanning(true);
      await loadCapabilities();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to start NFC scan.';
      setNfcError(message);
      setScanning(false);
    } finally {
      setNfcBusy(false);
    }
  };

  const handleStopScan = async (): Promise<void> => {
    if (!ensureAdminAccess('NFC admin access required to stop scan.')) {
      return;
    }
    setNfcScanNotice(null);
    setNfcBusy(true);
    setNfcError(null);
    try {
      await stopNativeNfcScan();
      setScanning(false);
      await loadCapabilities();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to stop NFC scan.';
      setNfcError(message);
    } finally {
      setNfcBusy(false);
    }
  };

  const submitBind = async (): Promise<void> => {
    if (!ensureAdminAccess()) {
      return;
    }
    if (!selectedUser || !lastTag?.uidHex) {
      setBindError('Select an owner and tap a card first.');
      return;
    }
    setBindBusy(true);
    setBindError(null);
    setLastBoundCard(null);
    setSyncError(null);
    setSyncSuccess(null);
    const bindBody = {
      owner_id: selectedUser.id,
      uid: lastTag.uidHex,
      metadata: {
        source: 'mobile-nfc-admin',
        tech_list: lastTag.techList,
        observed_at: lastTag.timestampIso,
        device_model: capabilities?.deviceModel ?? 'Unknown',
        device_brand: capabilities?.deviceBrand ?? 'Unknown',
        device_manufacturer: capabilities?.deviceManufacturer ?? 'Unknown'
      }
    };
    try {
      const response = await fetch(`${apiBaseUrl}/nfc/cards/bind`, {
        method: 'POST',
        headers: baseHeaders(true),
        body: JSON.stringify(bindBody)
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok) {
        const code = extractErrorCode(payload);
        const message = extractErrorMessage(payload, `Bind failed (${response.status})`);
        if (shouldMarkNeedsReview(response.status, code)) {
          await queueCardWrite(
            'BIND',
            'POST',
            '/nfc/cards/bind',
            bindBody,
            'needs_review',
            `${code ?? 'CONFLICT'}: ${message}`
          );
          setBindError(`Queued as needs review: ${message}`);
          setOfflineNotice('Bind request needs manual review due to a conflict.');
          return;
        }
        if (isRetryableServerFailure(response.status)) {
          await queueCardWrite('BIND', 'POST', '/nfc/cards/bind', bindBody, 'pending', message);
          setBindError('Bind queued because server is unavailable. It will sync later.');
          setOfflineNotice('Card bind queued for retry.');
          return;
        }
        throw new Error(message);
      }
      const bound = payload as BoundCardResponse;
      setLastBoundCard(bound);
      setSelectedCardId(bound.id);
      await handleLoadCards();
      await refreshOutbox();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Bind failed.';
      if (isLikelyNetworkError(cause)) {
        await queueCardWrite('BIND', 'POST', '/nfc/cards/bind', bindBody, 'pending', message);
        setBindError('No network connection. Bind queued and will sync when available.');
        setOfflineNotice('Card bind queued while offline.');
      } else {
        setBindError(message);
      }
    } finally {
      setBindBusy(false);
    }
  };

  const handleConfirmBind = (): void => {
    if (!selectedUser || !lastTag?.uidHex) {
      setBindError('Select an owner and tap a card first.');
      return;
    }
    Alert.alert(
      'Confirm Card Binding',
      `Bind card ${lastTag.uidHex} to ${selectedUser.full_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm Bind', onPress: () => void submitBind() }
      ]
    );
  };

  const handleRetryFailedOutbox = async (): Promise<void> => {
    if (!dbReady) {
      return;
    }
    const resetCount = await resetFailedOutboxToPending();
    await refreshOutbox();
    if (resetCount > 0) {
      setSyncSuccess(`Moved ${resetCount} failed action(s) back to pending.`);
      setSyncError(null);
    } else {
      setSyncSuccess('No failed actions to retry.');
      setSyncError(null);
    }
  };

  const handleSyncOutbox = async (): Promise<void> => {
    if (!accessToken) {
      setSyncError('Connect first to sync queued actions.');
      return;
    }
    if (!ensureAdminAccess()) {
      return;
    }
    if (!dbReady) {
      setSyncError('Local store is not ready.');
      return;
    }

    setSyncBusy(true);
    setSyncError(null);
    setSyncSuccess(null);
    setOfflineNotice(null);
    try {
      const items = await listSyncableOutbox();
      if (items.length === 0) {
        setSyncSuccess('No queued actions to sync.');
        await refreshOutbox();
        return;
      }

      let successCount = 0;
      let failedCount = 0;
      let reviewCount = 0;
      for (const item of items) {
        try {
          await updateOutboxStatus(item.id, 'processing', item.last_error);
          const response = await fetch(`${apiBaseUrl}${item.path}`, {
            method: item.method,
            headers: baseHeaders(true),
            body: JSON.stringify(item.payload)
          });
          const payload = await parseJsonResponse(response);
          if (response.ok) {
            await updateOutboxStatus(item.id, 'done', null);
            successCount += 1;
            continue;
          }

          const code = extractErrorCode(payload);
          const message = extractErrorMessage(payload, `Sync failed (${response.status})`);
          if (shouldMarkNeedsReview(response.status, code)) {
            await updateOutboxStatus(item.id, 'needs_review', `${code ?? 'CONFLICT'}: ${message}`);
            reviewCount += 1;
            continue;
          }

          if (isRetryableServerFailure(response.status)) {
            await updateOutboxStatus(item.id, 'failed', message, 1);
            failedCount += 1;
            continue;
          }

          await updateOutboxStatus(item.id, 'needs_review', message, 1);
          reviewCount += 1;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Network failure during sync.';
          await updateOutboxStatus(item.id, 'failed', message, 1);
          failedCount += 1;
        }
      }

      await refreshOutbox();
      await handleLoadCards();
      await handleLoadAudit();

      const parts = [`Synced: ${successCount}`];
      if (failedCount > 0) {
        parts.push(`Failed: ${failedCount}`);
      }
      if (reviewCount > 0) {
        parts.push(`Needs review: ${reviewCount}`);
      }
      setSyncSuccess(parts.join(' | '));
      if (reviewCount > 0) {
        setOfflineNotice('Some actions need review before they can be retried.');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Outbox sync failed.';
      setSyncError(message);
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.pageScroll}
        contentContainerStyle={[styles.content, hasNfcAdminAccess ? styles.contentWithBottomTabs : null]}
      >
        <View style={styles.card}>
          <Text style={styles.title}>V-CARD</Text>
          <Text style={styles.subtitle}>Platform Owner NFC/RFID Console</Text>
          <TextInput
            style={styles.input}
            value={apiBaseUrl}
            onChangeText={setApiBaseUrl}
            autoCapitalize="none"
            placeholder="API Base URL (e.g. https://vmjamtech.com/api)"
            placeholderTextColor="#9CA3AF"
          />
          <TextInput
            style={styles.input}
            value={platformOwnerKey}
            onChangeText={setPlatformOwnerKey}
            autoCapitalize="none"
            secureTextEntry
            placeholder="Platform Owner Key"
            placeholderTextColor="#9CA3AF"
          />
          <Pressable
            style={[styles.primaryBtn, authBusy ? styles.primaryBtnDisabled : null]}
            onPress={() => void handleLogin()}
            disabled={authBusy}
          >
            <Text style={styles.primaryBtnText}>{authBusy ? 'Connecting...' : 'Connect (No Login UI)'}</Text>
          </Pressable>
          <Text style={styles.metaText}>
            Session: {isConnected ? 'Connected' : 'Not connected'}
          </Text>
          {authError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{authError}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.sessionBanner}>
          <Text style={styles.sessionBannerText}>
            Tenant: {selectedTenant?.company_name ?? '-'} | Client: {clientId || '-'}
          </Text>
          <Text style={styles.sessionBannerText}>
            User: {sessionClaims?.email ?? '-'} | Roles: {sessionClaims?.roles.join(', ') || '-'}
          </Text>
        </View>

        {accessToken && !hasNfcAdminAccess ? (
          <View style={styles.lockedCard}>
            <Text style={styles.lockedTitle}>Access Restricted</Text>
            <Text style={styles.lockedText}>
              This app is restricted to NFC administrators. Sign in with role `admin`, `owner`, or `platform_owner`.
            </Text>
          </View>
        ) : null}

        {hasNfcAdminAccess ? (
        <>
        <View style={[styles.card, activeAdminTab !== 'SYNC' ? styles.hiddenSection : null]}>
          <Text style={styles.subtitle}>Offline Sync Queue</Text>
          <Text style={styles.metaText}>
            Local DB: {dbReady ? 'Ready' : 'Initializing...'} | Pending: {outboxSummary.pending} | Failed:{' '}
            {outboxSummary.failed} | Needs Review: {outboxSummary.needsReview}
          </Text>
          <View style={styles.actions}>
            <Pressable
              style={[styles.primaryBtn, (syncBusy || !accessToken) ? styles.primaryBtnDisabled : null]}
              onPress={() => void handleSyncOutbox()}
              disabled={syncBusy || !accessToken}
            >
              <Text style={styles.primaryBtnText}>{syncBusy ? 'Syncing...' : 'Sync Queued Actions'}</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, (syncBusy || !dbReady) ? styles.secondaryBtnDisabled : null]}
              onPress={() => void handleRetryFailedOutbox()}
              disabled={syncBusy || !dbReady}
            >
              <Text style={styles.secondaryBtnText}>Retry Failed</Text>
            </Pressable>
          </View>
          {offlineNotice ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>{offlineNotice}</Text>
            </View>
          ) : null}
          {syncError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{syncError}</Text>
            </View>
          ) : null}
          {syncSuccess ? (
            <View style={styles.successBox}>
              <Text style={styles.successTitle}>Sync Result</Text>
              <Text style={styles.successText}>{syncSuccess}</Text>
            </View>
          ) : null}
          <View style={styles.outboxList}>
            {outboxItems.length === 0 ? (
              <Text style={styles.metaText}>No queued actions yet.</Text>
            ) : (
              outboxItems.slice(0, 8).map((item) => (
                <View key={item.id} style={styles.outboxRow}>
                  <Text style={styles.outboxRowTitle}>{item.operation}</Text>
                  <Text style={styles.cardRowMeta}>
                    {item.method} {item.path}
                  </Text>
                  <Text style={styles.cardRowMeta}>
                    Status: {item.status} | Retries: {item.retry_count}
                  </Text>
                  <Text style={styles.cardRowMeta}>At: {item.created_at}</Text>
                  {item.last_error ? <Text style={styles.cardRowMeta}>Error: {item.last_error}</Text> : null}
                </View>
              ))
            )}
          </View>
        </View>

        <View style={[styles.card, activeAdminTab !== 'SCOPE' ? styles.hiddenSection : null]}>
          <Text style={styles.subtitle}>Scope Selector (Tenant / Branch / Location)</Text>
          <View style={styles.actions}>
            <Pressable
              style={[styles.secondaryBtn, (scopeBusy || !isConnected) ? styles.secondaryBtnDisabled : null]}
              onPress={() => void handleLoadScopeData()}
              disabled={scopeBusy || !isConnected}
            >
              <Text style={styles.secondaryBtnText}>{scopeBusy ? 'Loading...' : 'Refresh Scope'}</Text>
            </Pressable>
          </View>

          <Pressable style={styles.selectBtn} onPress={() => setPickerOpen('TENANT')}>
            <Text style={styles.selectBtnLabel}>Tenant</Text>
            <Text style={styles.selectBtnValue}>
              {selectedTenant ? `${selectedTenant.company_code} • ${selectedTenant.company_name}` : 'Select Tenant'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.selectBtn, !selectedTenantId ? styles.secondaryBtnDisabled : null]}
            onPress={() => setPickerOpen('BRANCH')}
            disabled={!selectedTenantId}
          >
            <Text style={styles.selectBtnLabel}>Branch</Text>
            <Text style={styles.selectBtnValue}>
              {selectedBranch ? `${selectedBranch.code} • ${selectedBranch.name}` : 'All Branches / Unassigned'}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.selectBtn, !selectedTenantId ? styles.secondaryBtnDisabled : null]}
            onPress={() => setPickerOpen('LOCATION')}
            disabled={!selectedTenantId}
          >
            <Text style={styles.selectBtnLabel}>Location</Text>
            <Text style={styles.selectBtnValue}>
              {selectedLocation ? `${selectedLocation.code} • ${selectedLocation.name}` : 'All Locations'}
            </Text>
          </Pressable>

          <Text style={styles.metaText}>
            Customers: {customers.length} | Inventory Cards: {inventoryCards.length} | Assigned Cards: {customerCards.length}
          </Text>

          {scopeError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{scopeError}</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, activeAdminTab !== 'NFC' ? styles.hiddenSection : null]}>
          <Text style={styles.subtitle}>3) Tap Card (NFC Reader)</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Device</Text>
            <Text style={styles.value}>{deviceLabel}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>NFC Hardware</Text>
            <Text style={styles.value}>{capabilities?.hasNfcHardware ? 'Detected' : 'Not detected'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>NFC Enabled</Text>
            <Text style={styles.value}>{capabilities?.isNfcEnabled ? 'Yes' : 'No'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Scan State</Text>
            <Text style={styles.value}>{scanning ? 'Scanning' : 'Stopped'}</Text>
          </View>
          <View style={styles.actions}>
            <Pressable
              style={[styles.primaryBtn, nfcBusy ? styles.primaryBtnDisabled : null]}
              onPress={() => void handleStartScan()}
              disabled={nfcBusy}
            >
              <Text style={styles.primaryBtnText}>Start Scan</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, nfcBusy ? styles.secondaryBtnDisabled : null]}
              onPress={() => void handleStopScan()}
              disabled={nfcBusy}
            >
              <Text style={styles.secondaryBtnText}>Stop Scan</Text>
            </Pressable>
          </View>
          <View style={styles.previewBox}>
            <Text style={styles.label}>Last UID (HEX)</Text>
            <Text style={styles.previewValue}>{lastTag?.uidHex || '-'}</Text>
            <Text style={styles.label}>Timestamp</Text>
            <Text style={styles.previewMeta}>{lastTag?.timestampIso || '-'}</Text>
            <Text style={styles.label}>Tech List</Text>
            <Text style={styles.previewMeta}>
              {lastTag?.techList?.length ? lastTag.techList.join(', ') : '-'}
            </Text>
          </View>
          {nfcError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{nfcError}</Text>
            </View>
          ) : null}
          {nfcScanNotice ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>{nfcScanNotice}</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, activeAdminTab !== 'ENROLL' ? styles.hiddenSection : null]}>
          <Text style={styles.subtitle}>Create Inventory Card</Text>
          <Text style={styles.metaText}>Tenant: {selectedTenant?.company_name ?? '-'}</Text>
          <Text style={styles.metaText}>Card UID (from NFC): {lastTag?.uidHex ?? '-'}</Text>
          <TextInput
            style={styles.input}
            value={cardNumberDraft}
            onChangeText={setCardNumberDraft}
            placeholder="Card Number (required)"
            placeholderTextColor="#9CA3AF"
          />
          <TextInput
            style={styles.input}
            value={serialNumberDraft}
            onChangeText={setSerialNumberDraft}
            placeholder="Serial Number (optional)"
            placeholderTextColor="#9CA3AF"
          />
          <TextInput
            style={styles.input}
            value={cardUrlDraft}
            onChangeText={setCardUrlDraft}
            autoCapitalize="none"
            placeholder="Card URL (optional)"
            placeholderTextColor="#9CA3AF"
          />
          <Pressable
            style={[styles.primaryBtn, (!canCreateInventoryCard || createCardBusy) ? styles.primaryBtnDisabled : null]}
            onPress={() => void handleCreateInventoryCard()}
            disabled={!canCreateInventoryCard || createCardBusy}
          >
            <Text style={styles.primaryBtnText}>{createCardBusy ? 'Creating...' : 'Create Inventory Card'}</Text>
          </Pressable>
          {inventoryError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{inventoryError}</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, activeAdminTab !== 'CARDS' ? styles.hiddenSection : null]}>
          <Text style={styles.subtitle}>Inventory Card List</Text>
          <View style={styles.actions}>
            <Pressable
              style={[styles.secondaryBtn, (inventoryBusy || !isConnected) ? styles.secondaryBtnDisabled : null]}
              onPress={() => void handleLoadScopeData()}
              disabled={inventoryBusy || !isConnected}
            >
              <Text style={styles.secondaryBtnText}>{inventoryBusy ? 'Loading...' : 'Refresh Inventory'}</Text>
            </Pressable>
          </View>
          <View style={styles.cardsList}>
            {inventoryBusy ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#2563EB" size="small" />
                <Text style={styles.metaText}>Loading inventory cards...</Text>
              </View>
            ) : inventoryCards.length === 0 ? (
              <Text style={styles.metaText}>No inventory cards for selected tenant/scope.</Text>
            ) : (
              inventoryCards.map((card) => (
                <Pressable
                  key={card.id}
                  style={[styles.cardRow, selectedInventoryCardId === card.id ? styles.cardRowSelected : null]}
                  onPress={() => {
                    setSelectedInventoryCardId(card.id);
                  }}
                >
                  <Text style={styles.cardRowUid}>{card.card_number}</Text>
                  <Text style={styles.cardRowMeta}>UID: {card.card_uid}</Text>
                  <Text style={styles.cardRowMeta}>Serial: {card.serial_number || '-'}</Text>
                  <Text style={styles.cardRowMeta}>Status: {card.status}</Text>
                  <Text style={styles.cardRowMeta}>Card ID: {card.id}</Text>
                </Pressable>
              ))
            )}
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.subtitle}>Selected Inventory Card</Text>
            {selectedInventoryCard ? (
              <>
                <Text style={styles.metaText}>Card No: {selectedInventoryCard.card_number}</Text>
                <Text style={styles.metaText}>UID: {selectedInventoryCard.card_uid}</Text>
                <Text style={styles.metaText}>Serial: {selectedInventoryCard.serial_number || '-'}</Text>
                <Text style={styles.metaText}>URL: {selectedInventoryCard.card_url || '-'}</Text>
                <Text style={styles.metaText}>Status: {selectedInventoryCard.status}</Text>
                <Text style={styles.metaText}>Branch ID: {selectedInventoryCard.branch_id || '-'}</Text>
                <Text style={styles.metaText}>Location ID: {selectedInventoryCard.location_id || '-'}</Text>
              </>
            ) : (
              <Text style={styles.metaText}>Tap an inventory card row above to inspect details.</Text>
            )}
          </View>

          {inventoryError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{inventoryError}</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, activeAdminTab !== 'CUSTOMERS' ? styles.hiddenSection : null]}>
          <Text style={styles.subtitle}>Customer Assignment Flow</Text>
          <Pressable style={styles.selectBtn} onPress={() => setPickerOpen('CUSTOMER')}>
            <Text style={styles.selectBtnLabel}>Customer</Text>
            <Text style={styles.selectBtnValue}>
              {selectedCustomer ? `${selectedCustomer.code} • ${selectedCustomer.name}` : 'Select Customer'}
            </Text>
          </Pressable>
          <Pressable style={styles.selectBtn} onPress={() => setPickerOpen('INVENTORY_CARD')}>
            <Text style={styles.selectBtnLabel}>Card</Text>
            <Text style={styles.selectBtnValue}>
              {selectedInventoryCard
                ? `${selectedInventoryCard.card_number} • ${selectedInventoryCard.card_uid}`
                : 'Select Inventory Card'}
            </Text>
          </Pressable>

          <View style={styles.actions}>
            <Pressable
              style={[styles.primaryBtn, (assignBusy || !selectedCustomer || !selectedInventoryCard) ? styles.primaryBtnDisabled : null]}
              onPress={handleAssignCardToCustomer}
              disabled={assignBusy || !selectedCustomer || !selectedInventoryCard}
            >
              <Text style={styles.primaryBtnText}>{assignBusy ? 'Assigning...' : 'Assign Card to Customer'}</Text>
            </Pressable>
          </View>

          <View style={styles.auditList}>
            {customerCardsBusy ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#2563EB" size="small" />
                <Text style={styles.metaText}>Loading customer assignments...</Text>
              </View>
            ) : customerCards.length === 0 ? (
              <Text style={styles.metaText}>No customer card assignments yet.</Text>
            ) : (
              customerCards.map((row) => (
                <Pressable
                  key={row.id}
                  style={[styles.auditRow, selectedCustomerCardId === row.id ? styles.cardRowSelected : null]}
                  onPress={() => setSelectedCustomerCardId(row.id)}
                >
                  <Text style={styles.auditRowTitle}>{row.customer.name}</Text>
                  <Text style={styles.cardRowMeta}>Card: {row.card.card_number}</Text>
                  <Text style={styles.cardRowMeta}>UID: {row.card.card_uid}</Text>
                  <Text style={styles.cardRowMeta}>Points: {row.customer.points_balance}</Text>
                  <Text style={styles.cardRowMeta}>Status: {row.status}</Text>
                  <Pressable
                    style={styles.inlineActionBtn}
                    onPress={() => openCustomerCardActions(row.id)}
                  >
                    <Text style={styles.inlineActionText}>Manage Lifecycle</Text>
                  </Pressable>
                </Pressable>
              ))
            )}
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.subtitle}>Selected Customer Card</Text>
            {selectedCustomerCard ? (
              <>
                <Text style={styles.metaText}>Customer: {selectedCustomerCard.customer.name}</Text>
                <Text style={styles.metaText}>Card: {selectedCustomerCard.card.card_number}</Text>
                <Text style={styles.metaText}>UID: {selectedCustomerCard.card.card_uid}</Text>
                <Text style={styles.metaText}>Status: {selectedCustomerCard.status}</Text>
                <Text style={styles.metaText}>Assigned: {selectedCustomerCard.assigned_at || '-'}</Text>
                <Text style={styles.metaText}>Unassigned: {selectedCustomerCard.unassigned_at || '-'}</Text>
                <Text style={styles.metaText}>Revoked: {selectedCustomerCard.revoked_at || '-'}</Text>
                <Pressable
                  style={[styles.primaryBtn, customerActionBusy ? styles.primaryBtnDisabled : null]}
                  onPress={() => openCustomerCardActions(selectedCustomerCard.id)}
                  disabled={customerActionBusy}
                >
                  <Text style={styles.primaryBtnText}>Open Lifecycle Actions</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.metaText}>Select one assignment row above.</Text>
            )}
          </View>
          {customerCardsError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{customerCardsError}</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, activeAdminTab !== 'AUDIT' ? styles.hiddenSection : null]}>
          <Text style={styles.subtitle}>6) Audit Events</Text>
          <View style={styles.actions}>
            <Pressable
              style={[styles.secondaryBtn, (auditBusy || !accessToken) ? styles.secondaryBtnDisabled : null]}
              onPress={() => void handleLoadAudit()}
              disabled={auditBusy || !accessToken}
            >
              <Text style={styles.secondaryBtnText}>Refresh Audit</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (auditCsvBusy || !accessToken) ? styles.primaryBtnDisabled : null]}
              onPress={() => void handleExportAuditCsv()}
              disabled={auditCsvBusy || !accessToken}
            >
              <Text style={styles.primaryBtnText}>{auditCsvBusy ? 'Exporting...' : 'Export Audit CSV'}</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.input}
            value={auditSearch}
            onChangeText={setAuditSearch}
            autoCapitalize="none"
            placeholder="Search by UID, event, actor, card ID"
            placeholderTextColor="#9CA3AF"
          />
          <View style={styles.filterRow}>
            {(['ALL', 'BIND', 'REASSIGN', 'DEACTIVATE', 'REACTIVATE', 'REVOKE'] as const).map((eventType) => {
              const active = auditFilter === eventType;
              return (
                <Pressable
                  key={eventType}
                  style={[styles.filterChip, active ? styles.filterChipActive : null]}
                  onPress={() => setAuditFilter(eventType)}
                >
                  <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : null]}>
                    {eventType}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.auditList}>
            {auditBusy ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color="#2563EB" size="small" />
                <Text style={styles.metaText}>Loading audit events...</Text>
              </View>
            ) : filteredAuditEvents.length === 0 ? (
              <Text style={styles.metaText}>No audit events matched your filter.</Text>
            ) : (
              filteredAuditEvents.map((event) => (
                <View key={event.id} style={styles.auditRow}>
                  <Text style={styles.auditRowTitle}>{event.event_type}</Text>
                  <Text style={styles.cardRowMeta}>UID: {event.uid}</Text>
                  <Text style={styles.cardRowMeta}>Card ID: {event.card_id}</Text>
                  <Text style={styles.cardRowMeta}>
                    Actor: {event.actor ? `${event.actor.full_name} (${event.actor.email})` : 'System'}
                  </Text>
                  <Text style={styles.cardRowMeta}>At: {event.created_at || '-'}</Text>
                </View>
              ))
            )}
          </View>
          {auditError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{auditError}</Text>
            </View>
          ) : null}
          {auditCsvError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{auditCsvError}</Text>
            </View>
          ) : null}
          {auditCsvInfo ? (
            <View style={styles.successBox}>
              <Text style={styles.successTitle}>Audit CSV</Text>
              <Text style={styles.successText}>{auditCsvInfo}</Text>
            </View>
          ) : null}
          {auditCsvPreview ? (
            <View style={styles.previewBox}>
              <Text style={styles.label}>CSV Preview (first ~4KB)</Text>
              <Text style={styles.previewMeta}>{auditCsvPreview}</Text>
            </View>
          ) : null}
        </View>

        <View style={[styles.card, activeAdminTab !== 'POINTS' ? styles.hiddenSection : null]}>
          <Text style={styles.subtitle}>7) V-CARD Points Policy + Actions</Text>
          <View style={styles.actions}>
            <Pressable
              style={[styles.secondaryBtn, (pointsPolicyBusy || !accessToken) ? styles.secondaryBtnDisabled : null]}
              onPress={() => void handleLoadPointsPolicy()}
              disabled={pointsPolicyBusy || !accessToken}
            >
              <Text style={styles.secondaryBtnText}>Refresh Policy</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, (pointsPolicyBusy || !accessToken) ? styles.primaryBtnDisabled : null]}
              onPress={() => void handleSavePointsPolicy()}
              disabled={pointsPolicyBusy || !accessToken}
            >
              <Text style={styles.primaryBtnText}>{pointsPolicyBusy ? 'Saving...' : 'Save Policy'}</Text>
            </Pressable>
          </View>
          <Text style={styles.metaText}>Tenant: {pointsPolicy?.company_id ?? sessionClaims?.companyId ?? '-'}</Text>
          <Text style={styles.metaText}>Last update: {pointsPolicy?.updated_at ?? '-'}</Text>
          <TextInput
            style={styles.input}
            value={policyEarnPesoPerPoint}
            onChangeText={setPolicyEarnPesoPerPoint}
            keyboardType="numeric"
            placeholder="Earn Ratio: PHP per 1 point"
            placeholderTextColor="#9CA3AF"
          />
          <TextInput
            style={styles.input}
            value={policyRedeemPesoPerPoint}
            onChangeText={setPolicyRedeemPesoPerPoint}
            keyboardType="numeric"
            placeholder="Redeem Ratio: PHP value per 1 point"
            placeholderTextColor="#9CA3AF"
          />
          <TextInput
            style={styles.input}
            value={policyMinSpendForEarn}
            onChangeText={setPolicyMinSpendForEarn}
            keyboardType="numeric"
            placeholder="Min Spend For Earn (PHP)"
            placeholderTextColor="#9CA3AF"
          />
          <TextInput
            style={styles.input}
            value={policyMaxRedeemPoints}
            onChangeText={setPolicyMaxRedeemPoints}
            keyboardType="numeric"
            placeholder="Max Redeem Points Per Txn (blank = no limit)"
            placeholderTextColor="#9CA3AF"
          />
          <TextInput
            style={styles.input}
            value={policyPointsExpiryDays}
            onChangeText={setPolicyPointsExpiryDays}
            keyboardType="numeric"
            placeholder="Points Expiry Days (blank = no expiry)"
            placeholderTextColor="#9CA3AF"
          />

          <View style={styles.detailBox}>
            <Text style={styles.subtitle}>Points Action Tester</Text>
            <TextInput
              style={styles.input}
              value={pointsCustomerId}
              onChangeText={setPointsCustomerId}
              autoCapitalize="none"
              placeholder="Customer ID (required)"
              placeholderTextColor="#9CA3AF"
            />
            <TextInput
              style={styles.input}
              value={pointsCardInventoryId}
              onChangeText={setPointsCardInventoryId}
              autoCapitalize="none"
              placeholder="Card Inventory ID (optional)"
              placeholderTextColor="#9CA3AF"
            />
            <TextInput
              style={styles.input}
              value={pointsAmount}
              onChangeText={setPointsAmount}
              keyboardType="numeric"
              placeholder="Amount (PHP, optional for earn/redeem)"
              placeholderTextColor="#9CA3AF"
            />
            <TextInput
              style={styles.input}
              value={pointsValue}
              onChangeText={setPointsValue}
              keyboardType="numeric"
              placeholder="Points (earn/redeem) or Delta Points (adjust)"
              placeholderTextColor="#9CA3AF"
            />
            <TextInput
              style={styles.input}
              value={pointsRemarks}
              onChangeText={setPointsRemarks}
              placeholder="Remarks (optional)"
              placeholderTextColor="#9CA3AF"
            />

            {pointsWarnings.length > 0 ? (
              <View style={styles.infoBox}>
                {pointsWarnings.map((warning, index) => (
                  <Text key={`${warning}-${index}`} style={styles.infoText}>
                    {warning}
                  </Text>
                ))}
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                style={[styles.secondaryBtn, (pointsActionBusy || !accessToken) ? styles.secondaryBtnDisabled : null]}
                onPress={() => void handleSubmitPointsAction('earn')}
                disabled={pointsActionBusy || !accessToken}
              >
                <Text style={styles.secondaryBtnText}>Earn</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, (pointsActionBusy || !accessToken) ? styles.secondaryBtnDisabled : null]}
                onPress={() => void handleSubmitPointsAction('redeem')}
                disabled={pointsActionBusy || !accessToken}
              >
                <Text style={styles.secondaryBtnText}>Redeem</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, (pointsActionBusy || !accessToken) ? styles.secondaryBtnDisabled : null]}
                onPress={() => void handleSubmitPointsAction('adjust')}
                disabled={pointsActionBusy || !accessToken}
              >
                <Text style={styles.secondaryBtnText}>Adjust</Text>
              </Pressable>
            </View>

            {pointsActionError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{pointsActionError}</Text>
              </View>
            ) : null}
            {pointsActionInfo ? (
              <View style={styles.successBox}>
                <Text style={styles.successTitle}>Points Action</Text>
                <Text style={styles.successText}>{pointsActionInfo}</Text>
              </View>
            ) : null}
          </View>

          {pointsPolicyError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{pointsPolicyError}</Text>
            </View>
          ) : null}
          {pointsPolicyInfo ? (
            <View style={styles.successBox}>
              <Text style={styles.successTitle}>Policy</Text>
              <Text style={styles.successText}>{pointsPolicyInfo}</Text>
            </View>
          ) : null}
        </View>
        </>
        ) : null}
      </ScrollView>

      <Modal
        visible={customerActionModalOpen && Boolean(selectedCustomerCard)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (customerActionBusy) {
            return;
          }
          setCustomerActionModalOpen(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Customer Card Actions</Text>
            {selectedCustomerCard ? (
              <>
                <Text style={styles.metaText}>
                  {selectedCustomerCard.customer.code} - {selectedCustomerCard.customer.name}
                </Text>
                <Text style={styles.metaText}>
                  Card: {selectedCustomerCard.card.card_number} ({selectedCustomerCard.card.card_uid})
                </Text>
                <Text style={styles.metaText}>Current Status: {selectedCustomerCard.status}</Text>

                <Pressable
                  style={[styles.secondaryBtn, customerActionBusy ? styles.secondaryBtnDisabled : null]}
                  onPress={handleRequestCustomerReassign}
                  disabled={customerActionBusy}
                >
                  <Text style={styles.secondaryBtnText}>Reassign</Text>
                </Pressable>

                <View style={styles.actions}>
                  <Pressable
                    style={[styles.primaryBtn, customerActionBusy ? styles.primaryBtnDisabled : null]}
                    onPress={() => setCustomerConfirmAction('UNASSIGN')}
                    disabled={customerActionBusy}
                  >
                    <Text style={styles.primaryBtnText}>Unassign</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      selectedCustomerCard.status === 'REVOKED' ? styles.primaryBtn : styles.dangerBtn,
                      customerActionBusy ? styles.primaryBtnDisabled : null
                    ]}
                    onPress={() =>
                      setCustomerConfirmAction(
                        selectedCustomerCard.status === 'REVOKED' ? 'REACTIVATE' : 'REVOKE'
                      )
                    }
                    disabled={customerActionBusy}
                  >
                    <Text style={styles.primaryBtnText}>
                      {selectedCustomerCard.status === 'REVOKED' ? 'Reactivate' : 'Revoke'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            <Pressable
              style={[styles.secondaryBtn, customerActionBusy ? styles.secondaryBtnDisabled : null]}
              onPress={() => setCustomerActionModalOpen(false)}
              disabled={customerActionBusy}
            >
              <Text style={styles.secondaryBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={customerConfirmAction !== null && Boolean(customerConfirmTargetCard)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (customerActionBusy) {
            return;
          }
          setCustomerConfirmAction(null);
          setPendingReassignCardId(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {customerConfirmTargetCard && customerConfirmAction ? (
              <>
                <Text style={styles.modalTitle}>
                  {customerConfirmAction === 'REASSIGN'
                    ? 'Confirm Reassign'
                    : customerConfirmAction === 'UNASSIGN'
                      ? 'Confirm Unassign'
                      : customerConfirmAction === 'REVOKE'
                        ? 'Confirm Revoke'
                        : 'Confirm Reactivate'}
                </Text>
                <Text style={styles.metaText}>
                  Card: {customerConfirmTargetCard.card.card_number} ({customerConfirmTargetCard.card.card_uid})
                </Text>
                <Text style={styles.metaText}>
                  Current customer: {customerConfirmTargetCard.customer.name}
                </Text>
                {customerConfirmAction === 'REASSIGN' ? (
                  <Text style={styles.metaText}>
                    New customer: {selectedCustomer ? selectedCustomer.name : 'Select customer first'}
                  </Text>
                ) : null}
                <Text style={styles.modalNote}>
                  {customerConfirmAction === 'REASSIGN'
                    ? 'This will move the card binding to the selected customer.'
                    : customerConfirmAction === 'UNASSIGN'
                      ? 'This will keep the card in inventory as unassigned.'
                      : customerConfirmAction === 'REVOKE'
                        ? 'This will mark the card as revoked and prevent normal use.'
                        : 'This will reactivate this customer-card binding.'}
                </Text>

                <View style={styles.actions}>
                  <Pressable
                    style={[styles.secondaryBtn, customerActionBusy ? styles.secondaryBtnDisabled : null]}
                    onPress={() => {
                      setCustomerConfirmAction(null);
                      setPendingReassignCardId(null);
                    }}
                    disabled={customerActionBusy}
                  >
                    <Text style={styles.secondaryBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      customerConfirmAction === 'REVOKE' ? styles.dangerBtn : styles.primaryBtn,
                      customerActionBusy ? styles.primaryBtnDisabled : null
                    ]}
                    onPress={() => {
                      if (!customerConfirmAction) {
                        return;
                      }
                      void executeCustomerCardLifecycle(customerConfirmAction);
                    }}
                    disabled={customerActionBusy}
                  >
                    <Text style={styles.primaryBtnText}>{customerActionBusy ? 'Processing...' : 'Confirm'}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={pickerOpen !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (pickerOpen === 'REASSIGN_CUSTOMER') {
            setPendingReassignCardId(null);
          }
          setPickerOpen(null);
          setPickerQuery('');
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {pickerOpen === 'TENANT'
                ? 'Select Tenant'
                : pickerOpen === 'BRANCH'
                  ? 'Select Branch'
                  : pickerOpen === 'LOCATION'
                    ? 'Select Location'
                    : pickerOpen === 'CUSTOMER' || pickerOpen === 'REASSIGN_CUSTOMER'
                      ? 'Select Customer'
                      : 'Select Card'}
            </Text>
            <TextInput
              style={styles.input}
              value={pickerQuery}
              onChangeText={setPickerQuery}
              autoCapitalize="none"
              placeholder="Search..."
              placeholderTextColor="#9CA3AF"
            />
            <ScrollView style={styles.modalList}>
              {pickerOptions.length === 0 ? (
                <Text style={styles.metaText}>No results.</Text>
              ) : (
                pickerOptions.map((row) => (
                  <Pressable key={row.id} style={styles.modalRow} onPress={() => handleSelectPickerOption(row.id)}>
                    <Text style={styles.modalRowTitle}>{row.title}</Text>
                    {row.subtitle ? <Text style={styles.modalRowSubtitle}>{row.subtitle}</Text> : null}
                  </Pressable>
                ))
              )}
            </ScrollView>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => {
                if (pickerOpen === 'REASSIGN_CUSTOMER') {
                  setPendingReassignCardId(null);
                }
                setPickerOpen(null);
                setPickerQuery('');
              }}
            >
              <Text style={styles.secondaryBtnText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {hasNfcAdminAccess ? (
        <View style={styles.bottomTabBar}>
          {adminTabs.map((tab) => {
            const active = activeAdminTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                style={[styles.bottomTabBtn, active ? styles.bottomTabBtnActive : null]}
                onPress={() => setActiveAdminTab(tab.id)}
              >
                <Text style={[styles.bottomTabText, active ? styles.bottomTabTextActive : null]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Toast config={goeyToastConfig} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B1220'
  },
  pageScroll: {
    flex: 1
  },
  content: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 12
  },
  contentWithBottomTabs: {
    paddingBottom: 96
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8
  },
  sessionBanner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2
  },
  sessionBannerText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600'
  },
  lockedCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#450A0A',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6
  },
  lockedTitle: {
    color: '#FECACA',
    fontSize: 13,
    fontWeight: '800'
  },
  lockedText: {
    color: '#FCA5A5',
    fontSize: 12,
    lineHeight: 18
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#F9FAFB'
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#D1D5DB',
    fontWeight: '700'
  },
  input: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#0F172A',
    color: '#E5E7EB',
    paddingHorizontal: 12
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8
  },
  label: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '700'
  },
  value: {
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right'
  },
  actions: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 8
  },
  primaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB'
  },
  primaryBtnDisabled: {
    opacity: 0.55
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700'
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#0F172A'
  },
  secondaryBtnDisabled: {
    opacity: 0.55
  },
  secondaryBtnText: {
    color: '#E5E7EB',
    fontWeight: '700'
  },
  selectBtn: {
    minHeight: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
    gap: 2
  },
  selectBtnLabel: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '700'
  },
  selectBtnValue: {
    color: '#F3F4F6',
    fontSize: 13,
    fontWeight: '700'
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap'
  },
  filterChip: {
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  filterChipActive: {
    borderColor: '#2563EB',
    backgroundColor: '#1D4ED8'
  },
  filterChipText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700'
  },
  filterChipTextActive: {
    color: '#FFFFFF'
  },
  hiddenSection: {
    display: 'none'
  },
  bottomTabBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
    backgroundColor: '#0B1220',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    gap: 6
  },
  bottomTabBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  bottomTabBtnActive: {
    backgroundColor: '#1D4ED8'
  },
  bottomTabText: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '700'
  },
  bottomTabTextActive: {
    color: '#FFFFFF'
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2, 8, 23, 0.65)',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  modalCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
    maxHeight: '80%'
  },
  modalTitle: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '800'
  },
  modalNote: {
    color: '#CBD5E1',
    fontSize: 12
  },
  modalList: {
    maxHeight: 340
  },
  modalRow: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
    backgroundColor: '#0F172A'
  },
  modalRowTitle: {
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '700'
  },
  modalRowSubtitle: {
    marginTop: 2,
    color: '#9CA3AF',
    fontSize: 11
  },
  usersList: {
    maxHeight: 240,
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    padding: 8,
    gap: 8
  },
  userRow: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111827'
  },
  userRowSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#0A2A63'
  },
  userName: {
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '700'
  },
  userMeta: {
    color: '#D1D5DB',
    fontSize: 11
  },
  selectedTag: {
    color: '#BFDBFE',
    fontSize: 10,
    fontWeight: '800'
  },
  metaText: {
    color: '#CBD5E1',
    fontSize: 12
  },
  loadingRow: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  cardsList: {
    maxHeight: 320,
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    padding: 8,
    gap: 8
  },
  outboxList: {
    maxHeight: 240,
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    padding: 8,
    gap: 8
  },
  outboxRow: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
    backgroundColor: '#111827'
  },
  outboxRowTitle: {
    color: '#F9FAFB',
    fontSize: 12,
    fontWeight: '800'
  },
  auditList: {
    maxHeight: 320,
    borderWidth: 1,
    borderColor: '#1F2937',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    padding: 8,
    gap: 8
  },
  cardRow: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
    backgroundColor: '#111827'
  },
  cardRowSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#0A2A63'
  },
  cardRowUid: {
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '800'
  },
  cardRowMeta: {
    color: '#D1D5DB',
    fontSize: 11
  },
  inlineActionBtn: {
    marginTop: 6,
    minHeight: 32,
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 10
  },
  inlineActionText: {
    color: '#E5E7EB',
    fontSize: 11,
    fontWeight: '700'
  },
  auditRow: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
    backgroundColor: '#111827'
  },
  auditRowTitle: {
    color: '#F9FAFB',
    fontSize: 12,
    fontWeight: '800'
  },
  detailBox: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
    backgroundColor: '#0F172A'
  },
  dangerBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B91C1C'
  },
  previewBox: {
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
    backgroundColor: '#0F172A'
  },
  previewValue: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '800'
  },
  previewMeta: {
    color: '#D1D5DB',
    fontSize: 12
  },
  errorBox: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#7F1D1D',
    backgroundColor: '#450A0A',
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600'
  },
  infoBox: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1D4ED8',
    backgroundColor: '#0A2A63',
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  infoText: {
    color: '#BFDBFE',
    fontSize: 12,
    fontWeight: '600'
  },
  successBox: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#14532D',
    backgroundColor: '#052E16',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2
  },
  successTitle: {
    color: '#86EFAC',
    fontSize: 13,
    fontWeight: '800'
  },
  successText: {
    color: '#DCFCE7',
    fontSize: 12
  }
});

