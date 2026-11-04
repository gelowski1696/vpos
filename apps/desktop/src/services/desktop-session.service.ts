import {
  DesktopSessionService as CoreDesktopSessionService,
  type DesktopSessionPorts
} from '@vpos/desktop-core';
import { desktopAuthService } from './desktop-auth.service';
import { desktopSettingsService } from './desktop-settings.service';
import { desktopSubscriptionPolicyService } from './desktop-subscription-policy.service';

export type {
  DesktopCacheSessionInput,
  DesktopSessionAuthPort,
  DesktopSessionPorts,
  DesktopSessionSettingsPort,
  DesktopSessionSubscriptionPolicyPort,
  DesktopStartupStage
} from '@vpos/desktop-core';

function defaultPorts(): DesktopSessionPorts {
  return {
    auth: desktopAuthService,
    settings: desktopSettingsService,
    subscriptionPolicy: desktopSubscriptionPolicyService
  };
}

export class DesktopSessionService extends CoreDesktopSessionService {
  constructor(ports: DesktopSessionPorts = defaultPorts()) {
    super(ports);
  }
}

export const desktopSessionService = new DesktopSessionService();
