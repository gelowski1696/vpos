import {
  DesktopSalesService as CoreDesktopSalesService,
  type DesktopSalesPorts
} from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';
import { desktopAuthService } from './desktop-auth.service';
import { desktopSettingsService } from './desktop-settings.service';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';

export * from '@vpos/desktop-core';

function defaultPorts(): DesktopSalesPorts {
  return {
    repository: desktopDb,
    auth: desktopAuthService,
    settings: desktopSettingsService,
    subscriptionPolicy: desktopSubscriptionPolicyService
  };
}

export class DesktopSalesService extends CoreDesktopSalesService {
  constructor(ports: DesktopSalesPorts = defaultPorts()) {
    super(ports);
  }
}

export const desktopSalesService = new DesktopSalesService();
