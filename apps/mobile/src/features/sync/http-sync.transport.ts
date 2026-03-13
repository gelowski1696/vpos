import type { SyncPullResponse, SyncPushRequest, SyncPushResult } from '@vpos/shared-types';
import type { SyncTransport } from '@vpos/offline-core';
import { normalizeApiBaseUrl } from '../../app/api-base-url';

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

type HttpSyncTransportOptions = {
  baseUrl: string;
  getAccessToken?: () => Promise<string | undefined> | string | undefined;
  getClientId?: () => Promise<string | undefined> | string | undefined;
};

export class HttpSyncTransport implements SyncTransport {
  private readonly baseUrl: string;
  private readonly getAccessToken?: HttpSyncTransportOptions['getAccessToken'];
  private readonly getClientId?: HttpSyncTransportOptions['getClientId'];
  private readonly fetchFn: FetchLike;

  constructor(options: HttpSyncTransportOptions) {
    this.baseUrl = normalizeApiBaseUrl(options.baseUrl);
    this.getAccessToken = options.getAccessToken;
    this.getClientId = options.getClientId;

    const availableFetch = (globalThis as { fetch?: FetchLike }).fetch;
    if (!availableFetch) {
      throw new Error('Global fetch is not available in this runtime');
    }
    this.fetchFn = availableFetch;
  }

  async push(request: SyncPushRequest): Promise<SyncPushResult> {
    const response = await this.fetchFn(`${this.baseUrl}/sync/push`, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(request)
    });
    if (!response.ok) {
      throw new Error(`Sync push failed with status ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as SyncPushResult;
  }

  async pull(since?: string | null, deviceId?: string): Promise<SyncPullResponse> {
    const params = new URLSearchParams();
    if (since) {
      params.set('since', since);
    }
    if (deviceId) {
      params.set('device_id', deviceId);
    }

    const query = params.toString();
    const url = query ? `${this.baseUrl}/sync/pull?${query}` : `${this.baseUrl}/sync/pull`;
    const response = await this.fetchFn(url, {
      method: 'GET',
      headers: await this.headers()
    });

    if (!response.ok) {
      throw new Error(`Sync pull failed with status ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as SyncPullResponse;
  }

  private async headers(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };

    if (!this.getAccessToken) {
      return headers;
    }

    const token = await this.getAccessToken();
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    if (this.getClientId) {
      const clientId = await this.getClientId();
      if (clientId) {
        headers['x-client-id'] = clientId;
      }
    }
    return headers;
  }
}
