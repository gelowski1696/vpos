import {
  DesktopShiftService as CoreDesktopShiftService,
  type DesktopShiftPorts
} from '@vpos/desktop-core';
import { desktopDb } from '../db/sqlite';
import { desktopShiftInventoryReportService } from './desktop-shift-inventory-report.service';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';

export * from '@vpos/desktop-core';

function defaultPorts(): DesktopShiftPorts {
  return {
    repository: desktopDb,
    inventory: desktopShiftInventoryReportService,
    subscriptionPolicy: desktopSubscriptionPolicyService
  };
}

export class DesktopShiftService extends CoreDesktopShiftService {
  constructor(ports: DesktopShiftPorts = defaultPorts()) {
    super(ports);
  }
}

export const desktopShiftService = new DesktopShiftService();
