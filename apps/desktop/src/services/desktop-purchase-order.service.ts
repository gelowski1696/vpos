import {
  DesktopPurchaseOrderService as CoreDesktopPurchaseOrderService,
  type DesktopPurchaseOrderPorts
} from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';

export * from '@vpos/desktop-core';

export class DesktopPurchaseOrderService extends CoreDesktopPurchaseOrderService {
  constructor(ports: DesktopPurchaseOrderPorts = {
    repository: desktopDb,
    subscriptionPolicy: desktopSubscriptionPolicyService
  }) {
    super(ports);
  }
}

export const desktopPurchaseOrderService = new DesktopPurchaseOrderService();
