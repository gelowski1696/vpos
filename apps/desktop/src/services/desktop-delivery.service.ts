import { DesktopDeliveryService as CoreDesktopDeliveryService, type DesktopDeliveryPorts } from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';

export * from '@vpos/desktop-core';

export class DesktopDeliveryService extends CoreDesktopDeliveryService {
  constructor(ports: DesktopDeliveryPorts = {
    repository: desktopDb,
    subscriptionPolicy: desktopSubscriptionPolicyService
  }) {
    super(ports);
  }
}

export const desktopDeliveryService = new DesktopDeliveryService();
