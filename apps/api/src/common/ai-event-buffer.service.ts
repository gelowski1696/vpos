import { Injectable } from '@nestjs/common';
import { type FactEvent } from '@vpos/ai-ready';

@Injectable()
export class AiEventBufferService {
  private readonly eventsByCompany = new Map<string, Array<FactEvent<Record<string, unknown>>>>();
  private readonly sequenceByCompany = new Map<string, number>();

  append(
    event: Omit<FactEvent<Record<string, unknown>>, 'id'> & { id?: string }
  ): FactEvent<Record<string, unknown>> {
    const nextId = event.id ?? this.nextEventId(event.company_id);
    const row: FactEvent<Record<string, unknown>> = {
      ...event,
      id: nextId
    };
    const companyEvents = this.eventsByCompany.get(event.company_id) ?? [];
    companyEvents.push(row);
    this.eventsByCompany.set(event.company_id, companyEvents);
    return row;
  }

  exportSince(
    companyId: string,
    cursor: string | undefined,
    limit: number
  ): { cursor: string; events: Array<FactEvent<Record<string, unknown>>> } {
    const events = this.eventsByCompany.get(companyId) ?? [];
    const offset = this.parseCursor(cursor);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 200;
    const slice = events.slice(offset, offset + safeLimit);
    const nextOffset = offset + slice.length;
    return {
      cursor: String(nextOffset),
      events: slice
    };
  }

  private parseCursor(cursor: string | undefined): number {
    if (!cursor?.trim()) {
      return 0;
    }
    const parsed = Number.parseInt(cursor.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return parsed;
  }

  private nextEventId(companyId: string): string {
    const current = this.sequenceByCompany.get(companyId) ?? 0;
    const next = current + 1;
    this.sequenceByCompany.set(companyId, next);
    return `ai-event-${companyId}-${String(next).padStart(8, '0')}`;
  }
}
