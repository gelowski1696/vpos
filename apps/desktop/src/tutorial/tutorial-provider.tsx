import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { DESKTOP_TUTORIAL_DEFINITIONS } from './tutorial-definitions';
import type {
  DesktopTutorialDefinition,
  DesktopTutorialScope,
  DesktopTutorialScreenKey,
  DesktopTutorialTargetKey,
  DesktopTutorialTargetRect
} from './tutorial-types';

type DesktopTutorialOpenOptions = {
  startStep?: number;
};

type DesktopTutorialState = {
  scope: DesktopTutorialScope | null;
  stepIndex: number;
  definition: DesktopTutorialDefinition | null;
  totalSteps: number;
  activeStep: DesktopTutorialDefinition['steps'][number] | null;
  activeTargetKey: DesktopTutorialTargetKey | null;
  activeTargetRect: DesktopTutorialTargetRect | null;
};

type DesktopTutorialActions = {
  open: (scope: DesktopTutorialScope, options?: DesktopTutorialOpenOptions) => void;
  close: () => void;
  pause: () => void;
  next: () => boolean;
  back: () => void;
  registerTargetRef: (key: DesktopTutorialTargetKey, node: HTMLElement | null) => void;
  measureTarget: (key: DesktopTutorialTargetKey) => void;
  reportTargetLayout: (key: DesktopTutorialTargetKey, rect: DesktopTutorialTargetRect | null) => void;
  isTargetActive: (key: DesktopTutorialTargetKey) => boolean;
  setScreenNavigator: (handler: ((screen: DesktopTutorialScreenKey) => void) | null) => void;
  setEnsureVisibleHandler: (handler: ((rect: DesktopTutorialTargetRect) => void) | null) => void;
};

const DesktopTutorialStateContext = createContext<DesktopTutorialState | null>(null);
const DesktopTutorialActionsContext = createContext<DesktopTutorialActions | null>(null);

function clampStepIndex(scope: DesktopTutorialScope, input: number): number {
  const steps = DESKTOP_TUTORIAL_DEFINITIONS[scope]?.steps.length ?? 0;
  if (steps <= 0 || !Number.isFinite(input)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.floor(input), steps - 1));
}

export function DesktopTutorialProvider({ children }: { children: ReactNode }): JSX.Element {
  const [scope, setScope] = useState<DesktopTutorialScope | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRects, setTargetRects] = useState<Partial<Record<DesktopTutorialTargetKey, DesktopTutorialTargetRect>>>({});
  const targetRefs = useRef<Partial<Record<DesktopTutorialTargetKey, HTMLElement | null>>>({});
  const scopeRef = useRef<DesktopTutorialScope | null>(null);
  const stepIndexRef = useRef(0);
  const activeTargetKeyRef = useRef<DesktopTutorialTargetKey | null>(null);
  const screenNavigatorRef = useRef<((screen: DesktopTutorialScreenKey) => void) | null>(null);
  const ensureVisibleRef = useRef<((rect: DesktopTutorialTargetRect) => void) | null>(null);
  const actionsRef = useRef<DesktopTutorialActions | null>(null);

  const definition = scope ? DESKTOP_TUTORIAL_DEFINITIONS[scope] : null;
  const totalSteps = definition?.steps.length ?? 0;
  const safeIndex = totalSteps > 0 ? Math.min(stepIndex, totalSteps - 1) : 0;
  const activeStep = totalSteps > 0 ? definition?.steps[safeIndex] ?? null : null;
  const activeTargetKey = activeStep?.targetKey ?? null;
  const activeTargetRect = activeTargetKey ? targetRects[activeTargetKey] ?? null : null;

  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  useEffect(() => {
    stepIndexRef.current = safeIndex;
  }, [safeIndex]);

  useEffect(() => {
    activeTargetKeyRef.current = activeTargetKey;
  }, [activeTargetKey]);

  const open = useCallback((nextScope: DesktopTutorialScope, options?: DesktopTutorialOpenOptions) => {
    const nextStepIndex = clampStepIndex(nextScope, options?.startStep ?? 0);
    scopeRef.current = nextScope;
    stepIndexRef.current = nextStepIndex;
    setScope(nextScope);
    setStepIndex(nextStepIndex);
  }, []);

  const close = useCallback(() => {
    scopeRef.current = null;
    stepIndexRef.current = 0;
    setScope(null);
    setStepIndex(0);
  }, []);

  const pause = useCallback(() => {
    scopeRef.current = null;
    setScope(null);
  }, []);

  const next = useCallback((): boolean => {
    const currentScope = scopeRef.current;
    if (!currentScope) {
      return true;
    }
    const steps = DESKTOP_TUTORIAL_DEFINITIONS[currentScope]?.steps.length ?? 0;
    const currentStepIndex = stepIndexRef.current;
    if (steps <= 0 || currentStepIndex >= steps - 1) {
      return true;
    }
    setStepIndex((previous) => {
      const nextStepIndex = Math.min(previous + 1, steps - 1);
      stepIndexRef.current = nextStepIndex;
      return nextStepIndex;
    });
    return false;
  }, []);

  const back = useCallback(() => {
    setStepIndex((previous) => {
      const nextStepIndex = previous <= 0 ? 0 : previous - 1;
      stepIndexRef.current = nextStepIndex;
      return nextStepIndex;
    });
  }, []);

  const reportTargetLayout = useCallback((key: DesktopTutorialTargetKey, rect: DesktopTutorialTargetRect | null) => {
    setTargetRects((current) => {
      if (!rect) {
        if (!(key in current)) {
          return current;
        }
        const nextState = { ...current };
        delete nextState[key];
        return nextState;
      }
      const previous = current[key];
      if (
        previous &&
        Math.abs(previous.x - rect.x) < 0.5 &&
        Math.abs(previous.y - rect.y) < 0.5 &&
        Math.abs(previous.width - rect.width) < 0.5 &&
        Math.abs(previous.height - rect.height) < 0.5
      ) {
        return current;
      }
      return { ...current, [key]: rect };
    });
  }, []);

  const measureTarget = useCallback(
    (key: DesktopTutorialTargetKey) => {
      const node = targetRefs.current[key];
      if (!node) {
        return;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }
      reportTargetLayout(key, {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      });
    },
    [reportTargetLayout]
  );

  const registerTargetRef = useCallback(
    (key: DesktopTutorialTargetKey, node: HTMLElement | null) => {
      targetRefs.current[key] = node;
      if (!node) {
        reportTargetLayout(key, null);
        return;
      }
      window.requestAnimationFrame(() => {
        measureTarget(key);
      });
    },
    [measureTarget, reportTargetLayout]
  );

  const isTargetActive = useCallback((key: DesktopTutorialTargetKey) => activeTargetKeyRef.current === key, []);

  const setScreenNavigator = useCallback((handler: ((screen: DesktopTutorialScreenKey) => void) | null) => {
    screenNavigatorRef.current = handler;
  }, []);

  const setEnsureVisibleHandler = useCallback((handler: ((rect: DesktopTutorialTargetRect) => void) | null) => {
    ensureVisibleRef.current = handler;
  }, []);

  useEffect(() => {
    if (!scope || !activeStep?.screen) {
      return;
    }
    screenNavigatorRef.current?.(activeStep.screen);
  }, [activeStep?.screen, safeIndex, scope]);

  useEffect(() => {
    if (!scope || !activeTargetKey) {
      return;
    }
    actionsRef.current?.measureTarget(activeTargetKey);
  }, [activeTargetKey, scope]);

  useEffect(() => {
    if (!scope || !activeTargetRect) {
      return;
    }
    ensureVisibleRef.current?.(activeTargetRect);
  }, [activeTargetRect, scope]);

  useEffect(() => {
    if (!scope || !activeTargetKey) {
      return;
    }

    const refreshTarget = (): void => {
      actionsRef.current?.measureTarget(activeTargetKey);
    };

    refreshTarget();
    window.addEventListener('resize', refreshTarget);
    window.addEventListener('scroll', refreshTarget, true);
    const interval = window.setInterval(refreshTarget, 180);

    return () => {
      window.removeEventListener('resize', refreshTarget);
      window.removeEventListener('scroll', refreshTarget, true);
      window.clearInterval(interval);
    };
  }, [activeTargetKey, scope]);

  const stateValue = useMemo<DesktopTutorialState>(
    () => ({
      scope,
      stepIndex: safeIndex,
      definition,
      totalSteps,
      activeStep,
      activeTargetKey,
      activeTargetRect
    }),
    [activeStep, activeTargetKey, activeTargetRect, definition, safeIndex, scope, totalSteps]
  );

  const actionsValue = useMemo<DesktopTutorialActions>(
    () => ({
      open,
      close,
      pause,
      next,
      back,
      registerTargetRef,
      measureTarget,
      reportTargetLayout,
      isTargetActive,
      setScreenNavigator,
      setEnsureVisibleHandler
    }),
    [back, close, isTargetActive, measureTarget, next, open, pause, registerTargetRef, reportTargetLayout, setEnsureVisibleHandler, setScreenNavigator]
  );

  useEffect(() => {
    actionsRef.current = actionsValue;
  }, [actionsValue]);

  return (
    <DesktopTutorialStateContext.Provider value={stateValue}>
      <DesktopTutorialActionsContext.Provider value={actionsValue}>{children}</DesktopTutorialActionsContext.Provider>
    </DesktopTutorialStateContext.Provider>
  );
}

export function useDesktopTutorialState(): DesktopTutorialState {
  const context = useContext(DesktopTutorialStateContext);
  if (!context) {
    throw new Error('useDesktopTutorialState must be used inside DesktopTutorialProvider.');
  }
  return context;
}

export function useDesktopTutorialActions(): DesktopTutorialActions {
  const context = useContext(DesktopTutorialActionsContext);
  if (!context) {
    throw new Error('useDesktopTutorialActions must be used inside DesktopTutorialProvider.');
  }
  return context;
}

export function useDesktopTutorialTarget(
  key: DesktopTutorialTargetKey
): {
  ref: (node: HTMLElement | null) => void;
  active: boolean;
} {
  const actions = useDesktopTutorialActions();
  const state = useDesktopTutorialState();

  const ref = useCallback(
    (node: HTMLElement | null) => {
      actions.registerTargetRef(key, node);
    },
    [actions, key]
  );

  return {
    ref,
    active: state.activeTargetKey === key
  };
}
