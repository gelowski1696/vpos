import {
  DesktopLpgItemActionService as CoreDesktopLpgItemActionService,
  type DesktopLpgItemActionPorts
} from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';

export * from '@vpos/desktop-core';

export class DesktopLpgItemActionService extends CoreDesktopLpgItemActionService {
  constructor(ports: DesktopLpgItemActionPorts = {
    repository: desktopDb,
    subscriptionPolicy: desktopSubscriptionPolicyService
  }) {
    super(ports);
  }
}

export const desktopLpgItemActionService = new DesktopLpgItemActionService();
