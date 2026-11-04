import type { DesktopSetupState } from '../db/schema';
import type { DesktopStartupStage } from '../services/desktop-session.service';

export function prepareStartupSetup(
  setup: DesktopSetupState,
  stage: DesktopStartupStage
): DesktopSetupState {
  return {
    ...setup,
    clientId: stage === 'LOGIN' ? '' : setup.clientId
  };
}

export function updateLoginEmail(setup: DesktopSetupState, authEmail: string): DesktopSetupState {
  const emailChanged = setup.authEmail.trim().toLowerCase() !== authEmail.trim().toLowerCase();
  return {
    ...setup,
    authEmail,
    clientId: emailChanged ? '' : setup.clientId
  };
}
