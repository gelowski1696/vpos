export type ApiClientConfig = {
  baseUrl: string;
};

export class DesktopApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  async health(): Promise<{ ok: boolean; message: string }> {
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/health`);
    if (!response.ok) {
      throw new Error(`Health request failed (${response.status})`);
    }
    return { ok: true, message: 'API is reachable.' };
  }
}
