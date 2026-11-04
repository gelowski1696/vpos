import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 * SSR-safe: returns `false` until mount.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const list = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };
    setMatches(list.matches);
    list.addEventListener('change', handler);
    return () => {
      list.removeEventListener('change', handler);
    };
  }, [query]);

  return matches;
}

/**
 * Named breakpoints aligned with tailwind.config.js + theme.css.
 * Use the matching helper hooks below to read live state.
 */
export const DESKTOP_BREAKPOINTS = {
  xs: 480,
  sm: 768,
  md: 1024,
  lg: 1280,
  xl: 1536,
  '2xl': 1800,
  '3xl': 2200
} as const;

export type DesktopBreakpoint = keyof typeof DESKTOP_BREAKPOINTS;

export function useBreakpointUp(name: DesktopBreakpoint): boolean {
  return useMediaQuery(`(min-width: ${DESKTOP_BREAKPOINTS[name]}px)`);
}

export function useBreakpointDown(name: DesktopBreakpoint): boolean {
  return useMediaQuery(`(max-width: ${DESKTOP_BREAKPOINTS[name] - 0.05}px)`);
}
