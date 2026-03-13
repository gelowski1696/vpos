'use client';

import { useEffect, useState } from 'react';
import { Toaster } from 'sileo';

export function WebToaster(): JSX.Element {
  const resolveMode = (): 'light' | 'dark' => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return 'light';
    }
    const stored = window.localStorage.getItem('vpos_admin_theme');
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  };

  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (): void => {
      setTheme(resolveMode());
    };
    applyTheme();
    const observer = new MutationObserver(applyTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class']
    });
    const onStorage = (event: StorageEvent): void => {
      if (event.key === 'vpos_admin_theme') {
        applyTheme();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return (
    <Toaster
      position="top-center"
      offset={{ top: 16 }}
      theme={theme}
      options={{
        duration: 3000,
        roundness: 12,
        fill: theme === 'dark' ? '#ffffff' : '#0f172a'
      }}
    />
  );
}
