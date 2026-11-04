import {
  DesktopSyncService as CoreDesktopSyncService,
  type DesktopSyncPorts
} from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';
import { desktopAuthService } from './desktop-auth.service';
import { desktopDeliveryService } from './desktop-delivery.service';
import { desktopExpenseService } from './desktop-expense.service';
import { desktopPurchaseOrderService } from './desktop-purchase-order.service';
import { desktopSettingsService } from './desktop-settings.service';
import { desktopShiftService } from './desktop-shift.service';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';
import { desktopTransferService } from './desktop-transfer.service';

export * from '@vpos/desktop-core';

function defaultPorts(): DesktopSyncPorts {
  return {
    repository: desktopDb,
    auth: desktopAuthService,
    settings: desktopSettingsService,
    subscriptionPolicy: desktopSubscriptionPolicyService,
    transfer: desktopTransferService,
    shift: desktopShiftService,
    delivery: desktopDeliveryService,
    purchaseOrder: desktopPurchaseOrderService,
    expense: desktopExpenseService
  };
}

export class DesktopSyncService extends CoreDesktopSyncService {
  constructor(ports: DesktopSyncPorts = defaultPorts()) {
    super(ports);
  }
}

export const desktopSyncService = new DesktopSyncService();
