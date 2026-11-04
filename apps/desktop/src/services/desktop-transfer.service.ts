import { DesktopTransferService as CoreDesktopTransferService, type DesktopTransferPorts } from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';

export * from '@vpos/desktop-core';

export class DesktopTransferService extends CoreDesktopTransferService {
  constructor(ports: DesktopTransferPorts = {
    repository: desktopDb,
    subscriptionPolicy: desktopSubscriptionPolicyService
  }) {
    super(ports);
  }
}

export const desktopTransferService = new DesktopTransferService();
