import type {
  DesktopAppState,
  DesktopLendingDetail,
  DesktopLendingRecord,
  DesktopLendingReturn,
  DesktopLendingReturnDraft
} from './schema';
import type { DesktopOperationalRepository, DesktopTransactionPolicyPort } from './operational-ports';

export interface DesktopLendingCachePort {
  loadCachedLendingDetail(lendingId: string): Promise<DesktopLendingDetail | null>;
}

export type DesktopLendingPorts = {
  repository: DesktopOperationalRepository;
  cache: DesktopLendingCachePort;
  subscriptionPolicy: DesktopTransactionPolicyPort;
};

function round(value: number): number {
  return Number(value.toFixed(3));
}

function computeStatus(detail: DesktopLendingDetail): DesktopLendingRecord['status'] {
  const totalOpen = detail.lines.reduce((sum, line) => sum + Math.max(0, line.quantity_open), 0);
  if (totalOpen <= 0) {
    return 'CLOSED';
  }
  if (detail.due_at && new Date(detail.due_at).getTime() < Date.now()) {
    return 'OVERDUE';
  }
  return detail.total_quantity_returned > 0 ? 'PARTIALLY_RETURNED' : 'OPEN';
}

export class DesktopLendingService {
  constructor(private readonly ports: DesktopLendingPorts) {}

  buildLocalReturnedDetail(
    detail: DesktopLendingDetail,
    state: DesktopAppState,
    draft: DesktopLendingReturnDraft,
    timestamp = new Date().toISOString()
  ): DesktopLendingDetail {
    const now = timestamp;
    const lendingReturnId = `desktop-lending-return-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const linesById = new Map(detail.lines.map((line) => [line.lending_line_id, line]));
    const nextLines = detail.lines.map((line) => {
      const match = draft.lines.find((entry) => entry.lending_line_id === line.lending_line_id);
      if (!match) {
        return line;
      }
      const nextReturned = round(line.quantity_returned + match.returned_qty);
      return {
        ...line,
        quantity_returned: nextReturned,
        quantity_open: round(Math.max(0, line.quantity_lent - nextReturned)),
        updated_at: now
      };
    });

    const nextReturns: DesktopLendingReturn[] = [
      {
        lending_return_id: lendingReturnId,
        lending_line_id: draft.lines[0]?.lending_line_id ?? detail.lending_id,
        returned_qty: round(draft.lines.reduce((sum, line) => sum + line.returned_qty, 0)),
        condition: draft.lines.length === 1 ? draft.lines[0].condition : 'GOOD',
        remarks: draft.remarks ?? null,
        received_by_user_id: null,
        received_by_name: state.setup.operatorName || 'Desktop staff',
        returned_at: now,
        created_at: now
      },
      ...detail.returns
    ];

    const totalReturned = round(nextLines.reduce((sum, line) => sum + line.quantity_returned, 0));
    const status = computeStatus({ ...detail, lines: nextLines, returns: nextReturns, total_quantity_returned: totalReturned });

    return {
      ...detail,
      lines: nextLines,
      returns: nextReturns,
      total_quantity_returned: totalReturned,
      status,
      closed_at: status === 'CLOSED' ? now : detail.closed_at,
      updated_at: now
    };
  }

  async queueOfflineReturn(
    state: DesktopAppState,
    detail: DesktopLendingDetail,
    draft: DesktopLendingReturnDraft
  ): Promise<DesktopLendingDetail> {
    await this.ports.subscriptionPolicy.assertCanCreateTransactions('lending_return');
    if (detail.status === 'CLOSED' || detail.status === 'CANCELLED' || detail.status === 'FORCE_CLOSED') {
      throw new Error('This lending record is closed and cannot accept another return.');
    }
    if (!draft.lines.length) {
      throw new Error('Enter a return quantity for at least one lending item.');
    }
    const sourceById = new Map(detail.lines.map((line) => [line.lending_line_id, line] as const));
    const seenLineIds = new Set<string>();
    for (const line of draft.lines) {
      const source = sourceById.get(line.lending_line_id);
      if (!source) throw new Error(`Lending line ${line.lending_line_id} was not found.`);
      if (seenLineIds.has(line.lending_line_id)) throw new Error('A lending line cannot be returned more than once in the same action.');
      seenLineIds.add(line.lending_line_id);
      if (!Number.isFinite(line.returned_qty) || line.returned_qty <= 0) throw new Error('Return quantities must be greater than zero.');
      if (line.returned_qty > source.quantity_open) throw new Error(`${source.product_name || source.product_id} only has ${source.quantity_open} open.`);
    }
    const now = new Date().toISOString();
    const nextDetail = this.buildLocalReturnedDetail(detail, state, draft, now);
    const queuedReturnId =
      nextDetail.returns[0]?.lending_return_id ??
      `desktop-lending-return-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    await this.ports.repository.upsertMasterDataRows([
      {
        entity: 'lending_detail',
        recordId: detail.lending_id,
        payload: JSON.stringify(nextDetail),
        updatedAt: now
      },
      {
        entity: 'lending',
        recordId: detail.lending_id,
        payload: JSON.stringify(nextDetail),
        updatedAt: now
      }
    ]);
    await this.ports.repository.enqueueOutboxItem({
      id: `outbox-lending-return-${detail.lending_id}-${Date.now()}`,
      entity: 'lending_return',
      action: 'create',
        payload: {
          id: queuedReturnId,
          lending_return_id: queuedReturnId,
          lending_id: detail.lending_id,
          sale_id: detail.sale_id,
        customer_id: detail.customer_id,
        location_id: detail.location_id,
        location_name: detail.location_name ?? null,
        remarks: draft.remarks ?? null,
        lines: draft.lines.map((line) => {
          const source = detail.lines.find((entry) => entry.lending_line_id === line.lending_line_id);
          const sourcePayload = (source ?? {}) as Record<string, unknown>;
          const sourceSaleLineIndexRaw = Number(
            sourcePayload.source_sale_line_index ?? sourcePayload.sourceSaleLineIndex
          );
          const sourceSaleLineIndex =
            Number.isInteger(sourceSaleLineIndexRaw) && sourceSaleLineIndexRaw >= 0
              ? sourceSaleLineIndexRaw
              : null;
          return {
            lending_line_id: line.lending_line_id,
            product_id: source?.product_id ?? null,
            product_name: source?.product_name ?? null,
            source_sale_line_id: source?.source_sale_line_id ?? null,
            source_sale_line_index: sourceSaleLineIndex,
            returned_qty: line.returned_qty,
            condition: line.condition,
            remarks: line.remarks ?? null
          };
        }),
        created_at: now
      },
      idempotency_key: `desktop-lending-return:${detail.lending_id}:${now}`,
      created_at: now
    });
    return nextDetail;
  }

  async refreshCachedDetail(lendingId: string): Promise<DesktopLendingDetail | null> {
    return this.ports.cache.loadCachedLendingDetail(lendingId);
  }
}
