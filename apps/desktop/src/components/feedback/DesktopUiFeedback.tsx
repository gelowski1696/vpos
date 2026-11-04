import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type DesktopToastTone = 'info' | 'success' | 'warning' | 'error';

type LoadingInput =
  | boolean
  | {
      visible: boolean;
      label?: string;
    };

type DesktopUiContextValue = {
  showToast: (input: {
    message: string;
    tone?: DesktopToastTone;
    durationMs?: number;
    loadingBeforeToastMs?: number;
    loadingLabel?: string;
  }) => void;
  setLoading: (input: LoadingInput) => void;
  clearLoading: () => void;
};

type DesktopToastEntry = {
  id: number;
  message: string;
  tone: DesktopToastTone;
};

const DesktopUiContext = createContext<DesktopUiContextValue | null>(null);

export function DesktopUiProvider({ children }: { children: ReactNode }): JSX.Element {
  const [loadingState, setLoadingState] = useState<{ visible: boolean; label: string }>({
    visible: false,
    label: 'Loading...'
  });
  const [toasts, setToasts] = useState<DesktopToastEntry[]>([]);
  const toastTimersRef = useRef<Map<number, number>>(new Map());
  const toastDelayTimersRef = useRef<Map<number, number>>(new Map());
  const toastIdRef = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((entry) => entry.id !== id));
    const timerId = toastTimersRef.current.get(id);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (message: string, tone: DesktopToastTone, durationMs: number) => {
      toastIdRef.current += 1;
      const id = Date.now() + toastIdRef.current;
      setToasts((prev) => [...prev, { id, message, tone }].slice(-4));
      const timerId = window.setTimeout(() => {
        setToasts((prev) => prev.filter((entry) => entry.id !== id));
        toastTimersRef.current.delete(id);
      }, Math.max(800, durationMs));
      toastTimersRef.current.set(id, timerId);
    },
    []
  );

  const showToast = useCallback(
    ({
      message,
      tone = 'info',
      durationMs = tone === 'error' ? 4200 : 2800,
      loadingBeforeToastMs = tone === 'success' ? 260 : 0,
      loadingLabel = 'Processing...'
    }: {
      message: string;
      tone?: DesktopToastTone;
      durationMs?: number;
      loadingBeforeToastMs?: number;
      loadingLabel?: string;
    }) => {
      const nextMessage = message.trim();
      if (!nextMessage) {
        return;
      }
      const delayMs = Math.max(0, loadingBeforeToastMs);
      if (delayMs > 0) {
        toastIdRef.current += 1;
        const id = Date.now() + toastIdRef.current;
        setLoadingState({ visible: true, label: loadingLabel.trim() || 'Processing...' });
        const timerId = window.setTimeout(() => {
          toastDelayTimersRef.current.delete(id);
          setLoadingState((prev) => ({ ...prev, visible: false }));
          pushToast(nextMessage, tone, durationMs);
        }, Math.max(180, delayMs));
        toastDelayTimersRef.current.set(id, timerId);
        return;
      }
      pushToast(nextMessage, tone, durationMs);
    },
    [pushToast]
  );

  useEffect(
    () => () => {
      for (const timerId of toastDelayTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      toastDelayTimersRef.current.clear();
      for (const timerId of toastTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      toastTimersRef.current.clear();
    },
    []
  );

  const setLoading = useCallback((input: LoadingInput) => {
    if (typeof input === 'boolean') {
      setLoadingState((prev) => ({
        visible: input,
        label: input ? prev.label || 'Loading...' : prev.label
      }));
      return;
    }
    setLoadingState({
      visible: input.visible,
      label: input.label?.trim() || 'Loading...'
    });
  }, []);

  const clearLoading = useCallback(() => {
    setLoadingState((prev) => ({ ...prev, visible: false }));
  }, []);

  const value = useMemo<DesktopUiContextValue>(
    () => ({
      showToast,
      setLoading,
      clearLoading
    }),
    [clearLoading, setLoading, showToast]
  );

  return (
    <DesktopUiContext.Provider value={value}>
      {children}
      <div className="desktop-toast-stack" role="status" aria-live="polite" aria-atomic="true">
        {toasts.map((entry) => (
          <div key={entry.id} className={`desktop-toast desktop-toast-${entry.tone}`} onClick={() => dismissToast(entry.id)}>
            <span className="desktop-toast-dot" aria-hidden="true" />
            <span>{entry.message}</span>
          </div>
        ))}
      </div>

      {loadingState.visible ? (
        <div className="desktop-loading-overlay" role="status" aria-live="polite">
          <div className="desktop-loading-card">
            <div className="desktop-loading-spinner" />
            <strong>{loadingState.label}</strong>
          </div>
        </div>
      ) : null}
    </DesktopUiContext.Provider>
  );
}

export function useDesktopUi(): DesktopUiContextValue {
  const context = useContext(DesktopUiContext);
  if (!context) {
    throw new Error('useDesktopUi must be used within DesktopUiProvider.');
  }
  return context;
}
