export interface FactEvent<TPayload extends Record<string, unknown>> {
  id: string;
  company_id: string;
  branch_id?: string;
  location_id?: string;
  user_id?: string;
  event_type: string;
  happened_at: string;
  payload: TPayload;
}

export type SalesEventPayload = {
  sale_id: string;
  customer_id?: string;
  total_amount: number;
  payment_methods: string[];
};

export type StockMovementEventPayload = {
  ledger_id: string;
  sku_id: string;
  qty_delta: number;
  movement_type: string;
};

export type DeliveryPerformanceEventPayload = {
  delivery_order_id: string;
  status: string;
  elapsed_minutes?: number;
};

export type UserBehaviorEventPayload = {
  action: string;
  screen: string;
  metadata?: Record<string, unknown>;
};

export interface AnalyticsExportBatch {
  cursor: string;
  events: Array<FactEvent<Record<string, unknown>>>;
}

export interface AnalyticsExportService {
  exportSince(cursor?: string): Promise<AnalyticsExportBatch>;
}

export class StubAnalyticsExportService implements AnalyticsExportService {
  async exportSince(cursor = '0'): Promise<AnalyticsExportBatch> {
    return {
      cursor,
      events: []
    };
  }
}
