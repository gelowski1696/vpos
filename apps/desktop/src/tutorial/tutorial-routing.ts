import type { DesktopRouteId } from '../app/routes';
import type { DesktopTutorialScope, DesktopTutorialScreenKey } from './tutorial-types';

const SCREEN_TO_ROUTE: Record<DesktopTutorialScreenKey, DesktopRouteId> = {
  HOME: 'dashboard',
  POS: 'pos',
  EXPENSE: 'expense',
  SETTINGS: 'settings'
};

const ROUTE_TO_SCOPE: Partial<Record<DesktopRouteId, DesktopTutorialScope>> = {
  dashboard: 'HOME',
  pos: 'POS',
  expense: 'EXPENSE',
  settings: 'SETTINGS'
};

export function getRouteForTutorialScreen(screen: DesktopTutorialScreenKey): DesktopRouteId {
  return SCREEN_TO_ROUTE[screen];
}

export function getTutorialScopeForRoute(route: DesktopRouteId): DesktopTutorialScope {
  return ROUTE_TO_SCOPE[route] ?? 'APP_WALKTHROUGH';
}
