import { useEffect } from 'react';
import { DESKTOP_ROUTES, type DesktopRouteId } from '../app/routes';

type Options = {
  enabled?: boolean;
  onSelectRoute: (route: DesktopRouteId) => void;
  onEscape?: () => void;
  onCommandPalette?: () => void;
};

const FUNCTION_KEY_PATTERN = /^F([1-9]|1[0-2])$/;
const FUNCTION_KEYCODE_MIN = 112; // F1
const FUNCTION_KEYCODE_MAX = 123; // F12

type FunctionKeyLikeEvent = Pick<KeyboardEvent, 'key' | 'code' | 'keyCode' | 'which'>;

export function resolveFunctionKey(event: FunctionKeyLikeEvent): string | null {
  const key = typeof event.key === 'string' ? event.key.trim().toUpperCase() : '';
  if (FUNCTION_KEY_PATTERN.test(key)) {
    return key;
  }

  const code = typeof event.code === 'string' ? event.code.trim().toUpperCase() : '';
  if (FUNCTION_KEY_PATTERN.test(code)) {
    return code;
  }

  const legacyCode =
    typeof event.keyCode === 'number' && Number.isFinite(event.keyCode) && event.keyCode > 0
      ? event.keyCode
      : typeof event.which === 'number' && Number.isFinite(event.which) && event.which > 0
        ? event.which
        : 0;

  if (legacyCode >= FUNCTION_KEYCODE_MIN && legacyCode <= FUNCTION_KEYCODE_MAX) {
    return `F${legacyCode - FUNCTION_KEYCODE_MIN + 1}`;
  }

  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) {
    return false;
  }
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

/**
 * Wires desktop keyboard shortcuts:
 *   - F1..F11 jump to the matching route by `shortcut` field
 *   - Ctrl/Cmd+1..5 jump to the first 5 routes (left rail order)
 *   - Ctrl/Cmd+K opens the command palette (if a handler is provided)
 *   - Escape calls the escape handler (close modal, drawer, etc.)
 *
 * F-keys ALWAYS preventDefault (so the browser's F1-help / F11-fullscreen / etc.
 * never fires inside the desktop app), and they fire even while a text input has
 * focus — F-keys don't produce characters, and the cashier needs to switch
 * routes without leaving the search field.
 *
 * Ctrl-digit shortcuts and Ctrl+K skip while typing, so the cashier can still
 * type "1234" into a search box without jumping routes.
 *
 * Listener is attached at capture phase on `window` so it beats any in-tree
 * handler that might preventDefault first.
 */
export function useDesktopShortcuts({
  enabled = true,
  onSelectRoute,
  onEscape,
  onCommandPalette
}: Options): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const handler = (event: KeyboardEvent): void => {
      // Function keys: highest priority, fire even in inputs.
      const functionKey = resolveFunctionKey(event);
      if (functionKey) {
        // Always suppress browser default for F1-F12 inside the app.
        event.preventDefault();
        event.stopPropagation();
        const match = DESKTOP_ROUTES.find((route) => route.shortcut?.toUpperCase() === functionKey);
        if (match) {
          onSelectRoute(match.id);
        }
        return;
      }

      if (event.key === 'Escape') {
        if (onEscape) {
          onEscape();
        }
        return;
      }

      const editable = isEditableTarget(event.target);

      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
        if (onCommandPalette) {
          event.preventDefault();
          onCommandPalette();
        }
        return;
      }

      if (editable) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && /^[1-5]$/.test(event.key)) {
        const index = Number.parseInt(event.key, 10) - 1;
        const route = DESKTOP_ROUTES[index];
        if (route) {
          event.preventDefault();
          onSelectRoute(route.id);
        }
      }
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => {
      window.removeEventListener('keydown', handler, { capture: true });
    };
  }, [enabled, onSelectRoute, onEscape, onCommandPalette]);
}
