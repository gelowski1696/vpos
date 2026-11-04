import { DesktopLendingService as CoreDesktopLendingService, type DesktopLendingPorts } from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';
import { desktopMasterDataService } from './desktop-master-data.service';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';

export * from '@vpos/desktop-core';

export class DesktopLendingService extends CoreDesktopLendingService {
  constructor(ports: DesktopLendingPorts = {
    repository: desktopDb,
    cache: desktopMasterDataService,
    subscriptionPolicy: desktopSubscriptionPolicyService
  }) {
    super(ports);
  }
}

export const desktopLendingService = new DesktopLendingService();
