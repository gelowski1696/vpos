import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { View } from 'react-native';
import { TUTORIAL_DEFINITIONS } from './tutorial-definitions';
import type {
  TutorialDefinition,
  TutorialScope,
  TutorialScreenKey,
  TutorialTargetKey,
  TutorialTargetRect,
} from './tutorial-types';

type TutorialOpenOptions = {
  startStep?: number;
};

type TutorialState = {
  scope: TutorialScope | null;
  stepIndex: number;
  definition: TutorialDefinition | null;
  totalSteps: number;
  activeStep: TutorialDefinition['steps'][number] | null;
  activeTargetKey: TutorialTargetKey | null;
  activeTargetRect: TutorialTargetRect | null;
};

type TutorialActions = {
  open: (scope: TutorialScope, options?: TutorialOpenOptions) => void;
  close: () => void;
  pause: () => void;
  next: () => boolean;
  back: () => void;
  registerTargetRef: (key: TutorialTargetKey, node: View | null) => void;
  measureTarget: (key: TutorialTargetKey) => void;
  reportTargetLayout: (key: TutorialTargetKey, rect: TutorialTargetRect | null) => void;
  isTargetActive: (key: TutorialTargetKey) => boolean;
  setScreenNavigator: (handler: ((screen: TutorialScreenKey) => void) | null) => void;
  setEnsureVisibleHandler: (handler: ((rect: TutorialTargetRect) => void) | null) => void;
  setViewportOffset: (offset: { x: number; y: number } | null) => void;
};

const TutorialStateContext = createContext<TutorialState | null>(null);
const TutorialActionsContext = createContext<TutorialActions | null>(null);

function clampStepIndex(scope: TutorialScope, input: number): number {
  const steps = TUTORIAL_DEFINITIONS[scope]?.steps.length ?? 0;
  if (steps <= 0) {
    return 0;
  }
  if (!Number.isFinite(input)) {
    return 0;
  }
  const rounded = Math.floor(input);
  if (rounded <= 0) {
    return 0;
  }
  return Math.min(rounded, steps - 1);
}

export function TutorialProvider(props: { children: React.ReactNode }): JSX.Element {
  const [scope, setScope] = useState<TutorialScope | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRects, setTargetRects] = useState<
    Partial<Record<TutorialTargetKey, TutorialTargetRect>>
  >({});
  const targetRefs = useRef<Partial<Record<TutorialTargetKey, View | null>>>({});
  const scopeRef = useRef<TutorialScope | null>(null);
  const stepIndexRef = useRef(0);
  const activeTargetKeyRef = useRef<TutorialTargetKey | null>(null);
  const screenNavigatorRef = useRef<((screen: TutorialScreenKey) => void) | null>(null);
  const ensureVisibleRef = useRef<((rect: TutorialTargetRect) => void) | null>(null);
  const viewportOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const actionsRef = useRef<TutorialActions | null>(null);

  const definition = scope ? TUTORIAL_DEFINITIONS[scope] : null;
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

  const open = useCallback((nextScope: TutorialScope, options?: TutorialOpenOptions) => {
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
    const steps = TUTORIAL_DEFINITIONS[currentScope]?.steps.length ?? 0;
    const currentStepIndex = stepIndexRef.current;
    if (steps <= 0 || currentStepIndex >= steps - 1) {
      return true;
    }
    setStepIndex((prev) => {
      const nextStepIndex = Math.min(prev + 1, steps - 1);
      stepIndexRef.current = nextStepIndex;
      return nextStepIndex;
    });
    return false;
  }, []);

  const back = useCallback(() => {
    setStepIndex((prev) => {
      const nextStepIndex = prev <= 0 ? 0 : prev - 1;
      stepIndexRef.current = nextStepIndex;
      return nextStepIndex;
    });
  }, []);

  const reportTargetLayout = useCallback(
    (key: TutorialTargetKey, rect: TutorialTargetRect | null) => {
      setTargetRects((current) => {
        if (!rect) {
          if (!(key in current)) {
            return current;
          }
          const nextState = { ...current };
          delete nextState[key];
          return nextState;
        }
        const prev = current[key];
        if (
          prev &&
          Math.abs(prev.x - rect.x) < 0.5 &&
          Math.abs(prev.y - rect.y) < 0.5 &&
          Math.abs(prev.width - rect.width) < 0.5 &&
          Math.abs(prev.height - rect.height) < 0.5
        ) {
          return current;
        }
        return { ...current, [key]: rect };
      });
    },
    [],
  );

  const measureTarget = useCallback(
    (key: TutorialTargetKey) => {
      const node = targetRefs.current[key];
      if (!node || typeof node.measureInWindow !== 'function') {
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) {
          return;
        }
        const offset = viewportOffsetRef.current;
        reportTargetLayout(key, {
          x: x - offset.x,
          y: y - offset.y,
          width,
          height,
        });
      });
    },
    [reportTargetLayout],
  );

  const registerTargetRef = useCallback(
    (key: TutorialTargetKey, node: View | null) => {
      targetRefs.current[key] = node;
      if (!node) {
        reportTargetLayout(key, null);
        return;
      }
      requestAnimationFrame(() => {
        measureTarget(key);
      });
    },
    [measureTarget, reportTargetLayout],
  );

  const isTargetActive = useCallback(
    (key: TutorialTargetKey) => activeTargetKeyRef.current === key,
    [],
  );

  const setScreenNavigator = useCallback((handler: ((screen: TutorialScreenKey) => void) | null) => {
    screenNavigatorRef.current = handler;
  }, []);

  const setEnsureVisibleHandler = useCallback((handler: ((rect: TutorialTargetRect) => void) | null) => {
    ensureVisibleRef.current = handler;
  }, []);

  const setViewportOffset = useCallback((offset: { x: number; y: number } | null) => {
    viewportOffsetRef.current = offset ?? { x: 0, y: 0 };
  }, []);

  useEffect(() => {
    if (!scope || !activeStep?.screen) {
      return;
    }
    screenNavigatorRef.current?.(activeStep.screen);
  }, [scope, activeStep?.screen, safeIndex]);

  useEffect(() => {
    if (!scope || !activeTargetKey) {
      return;
    }
    actionsRef.current?.measureTarget(activeTargetKey);
  }, [scope, activeTargetKey]);

  useEffect(() => {
    if (!scope || !activeTargetRect) {
      return;
    }
    ensureVisibleRef.current?.(activeTargetRect);
  }, [scope, activeTargetRect]);

  useEffect(() => {
    if (!scope || !activeTargetKey) {
      return;
    }
    const id = setInterval(() => {
      actionsRef.current?.measureTarget(activeTargetKey);
    }, 120);
    return () => {
      clearInterval(id);
    };
  }, [scope, activeTargetKey]);

  const stateValue = useMemo<TutorialState>(
    () => ({
      scope,
      stepIndex: safeIndex,
      definition,
      totalSteps,
      activeStep,
      activeTargetKey,
      activeTargetRect,
    }),
    [scope, safeIndex, definition, totalSteps, activeStep, activeTargetKey, activeTargetRect],
  );

  const actionValue = useMemo<TutorialActions>(
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
      setEnsureVisibleHandler,
      setViewportOffset,
    }),
    [
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
      setEnsureVisibleHandler,
      setViewportOffset,
    ],
  );

  useEffect(() => {
    actionsRef.current = actionValue;
  }, [actionValue]);

  return (
    <TutorialStateContext.Provider value={stateValue}>
      <TutorialActionsContext.Provider value={actionValue}>
        {props.children}
      </TutorialActionsContext.Provider>
    </TutorialStateContext.Provider>
  );
}

export function useTutorialState(): TutorialState {
  const value = useContext(TutorialStateContext);
  if (!value) {
    throw new Error('useTutorialState must be used inside TutorialProvider.');
  }
  return value;
}

export function useTutorialActions(): TutorialActions {
  const value = useContext(TutorialActionsContext);
  if (!value) {
    throw new Error('useTutorialActions must be used inside TutorialProvider.');
  }
  return value;
}

export function useTutorialTarget(key: TutorialTargetKey): {
  ref: (node: View | null) => void;
  onLayout: () => void;
  active: boolean;
} {
  const actions = useTutorialActions();
  const state = useTutorialState();
  const ref = useCallback(
    (node: View | null) => {
      actions.registerTargetRef(key, node);
    },
    [actions, key],
  );
  const onLayout = useCallback(() => {
    actions.measureTarget(key);
  }, [actions, key]);

  return {
    ref,
    onLayout,
    active: state.activeTargetKey === key,
  };
}
