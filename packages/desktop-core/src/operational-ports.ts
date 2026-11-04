import type { OutboxItem } from '@vpos/shared-types';
import type { DesktopMasterDataRow } from './schema';

export type DesktopOperationalOutboxInput = Pick<
  OutboxItem,
  'id' | 'entity' | 'action' | 'payload' | 'idempotency_key' | 'created_at'
>;

export interface DesktopOperationalRepository {
  listMasterData(entity?: string): Promise<DesktopMasterDataRow[]>;
  upsertMasterDataRows(rows: DesktopMasterDataRow[]): Promise<void>;
  enqueueOutboxItem(input: DesktopOperationalOutboxInput): Promise<unknown>;
}

export interface DesktopTransactionPolicyPort {
  assertCanCreateTransactions(operation?: string): Promise<unknown>;
}
