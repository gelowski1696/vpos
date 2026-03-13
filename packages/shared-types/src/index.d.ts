export type UUID = string;
export declare enum LocationType {
    BRANCH_STORE = "BRANCH_STORE",
    BRANCH_WAREHOUSE = "BRANCH_WAREHOUSE",
    TRUCK = "TRUCK",
    PERSONNEL = "PERSONNEL"
}
export declare enum OutboxStatus {
    PENDING = "pending",
    PROCESSING = "processing",
    SYNCED = "synced",
    FAILED = "failed",
    NEEDS_REVIEW = "needs_review"
}
export interface OutboxItem {
    id: UUID;
    entity: string;
    action: string;
    payload: Record<string, unknown>;
    idempotency_key: string;
    status: OutboxStatus;
    retry_count: number;
    last_error?: string | null;
    created_at: string;
    updated_at: string;
}
export interface SyncPushRequest {
    device_id: string;
    last_pull_token?: string | null;
    outbox_items: Array<{
        id: string;
        entity: string;
        action: string;
        payload: Record<string, unknown>;
        idempotency_key: string;
        created_at: string;
    }>;
}
export interface SyncPushResult {
    accepted: string[];
    rejected: Array<{
        id: string;
        reason: string;
        review_id?: string;
    }>;
}
export interface SyncPullResponse {
    changes: Array<{
        entity: string;
        action: string;
        payload: Record<string, unknown>;
        updated_at: string;
    }>;
    conflicts: Array<{
        id: string;
        entity: string;
        reason: string;
        payload: Record<string, unknown>;
    }>;
    next_token: string;
}
export declare enum PaymentMethod {
    CASH = "CASH",
    CARD = "CARD",
    E_WALLET = "E_WALLET"
}
export declare enum SaleType {
    PICKUP = "PICKUP",
    DELIVERY = "DELIVERY"
}
export declare enum CylinderEventType {
    ISSUE = "ISSUE",
    RETURN = "RETURN",
    EXCHANGE = "EXCHANGE",
    TRANSFER = "TRANSFER",
    REFILL = "REFILL",
    DAMAGE = "DAMAGE",
    LOSS = "LOSS"
}
export interface PriceResolutionInput {
    company_id: string;
    branch_id: string;
    customer_id?: string;
    product_id: string;
    quantity: number;
    requested_at: string;
}
export interface PriceResolutionOutput {
    source: 'contract' | 'tier' | 'branch' | 'global';
    unit_price: number;
    discount_cap_percent: number;
}
