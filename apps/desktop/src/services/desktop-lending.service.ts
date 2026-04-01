import type {
  DesktopAppState,
  DesktopLendingDetail,
  DesktopLendingRecord,
  DesktopLendingReturn,
  DesktopLendingReturnDraft
} from '../db/schema';
import { desktopDb } from '../db/sqlite';
import { desktopMasterDataService } from './desktop-master-data.service';

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
  buildLocalReturnedDetail(
    detail: DesktopLendingDetail,
    state: DesktopAppState,
    draft: DesktopLendingReturnDraft
  ): DesktopLendingDetail {
    const now = new Date().toISOString();
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
        lending_return_id: `desktop-lending-return-${Date.now()}`,
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
    const nextDetail = this.buildLocalReturnedDetail(detail, state, draft);
    const now = new Date().toISOString();
    await desktopDb.upsertMasterDataRows([
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
    await desktopDb.enqueueOutboxItem({
      id: `outbox-lending-return-${detail.lending_id}-${Date.now()}`,
      entity: 'lending_return',
      action: 'create',
      payload: {
        id: `desktop-lending-return-${Date.now()}`,
        lending_id: detail.lending_id,
        sale_id: detail.sale_id,
        customer_id: detail.customer_id,
        remarks: draft.remarks ?? null,
        lines: draft.lines.map((line) => {
          const source = detail.lines.find((entry) => entry.lending_line_id === line.lending_line_id);
          return {
            lending_line_id: line.lending_line_id,
            product_id: source?.product_id ?? null,
            product_name: source?.product_name ?? null,
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
    return desktopMasterDataService.loadCachedLendingDetail(lendingId);
  }
}

export const desktopLendingService = new DesktopLendingService();
