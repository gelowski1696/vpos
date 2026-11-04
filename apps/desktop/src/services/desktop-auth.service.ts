import {
  DesktopAuthService as CoreDesktopAuthService,
  type DesktopAuthPorts
} from '@vpos/desktop-core';
import { desktopSettingsService } from './desktop-settings.service';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';

export type {
  DesktopAuthPorts,
  DesktopAuthSettingsPort,
  DesktopAuthSubscriptionPolicyPort
} from '@vpos/desktop-core';

function defaultPorts(): DesktopAuthPorts {
  return {
    settings: desktopSettingsService,
    subscriptionPolicy: desktopSubscriptionPolicyService
  };
}

export class DesktopAuthService extends CoreDesktopAuthService {
  constructor(ports: DesktopAuthPorts = defaultPorts()) {
    super(ports);
  }
}

export const desktopAuthService = new DesktopAuthService();
