import type { DesktopStartupStage } from '../services/desktop-session.service';

export function shouldPreventDesktopClose(
  startupStage: DesktopStartupStage,
  accessToken: string | null
): boolean {
  return startupStage === 'READY' && Boolean(accessToken?.trim());
}
