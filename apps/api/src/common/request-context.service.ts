import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantRequestContext = {
  clientId?: string;
  companyId?: string;
  datastoreMode?: 'SHARED_DB' | 'DEDICATED_DB';
  datastoreRef?: string | null;
};

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<TenantRequestContext>();

  run<T>(context: TenantRequestContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): TenantRequestContext | undefined {
    return this.storage.getStore();
  }
}
