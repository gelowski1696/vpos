'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type AdminTourStep = {
  id: string;
  title: string;
  description: string;
  selectors: string[];
  placement?: 'auto' | 'top' | 'bottom';
};

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const OVERLAY_PADDING = 8;
const TOOLTIP_WIDTH = 360;
const TOOLTIP_GAP = 14;
const TOOLTIP_ESTIMATED_HEIGHT = 210;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isElementVisible(element: Element): element is HTMLElement {
  const htmlElement = element as HTMLElement;
  const styles = window.getComputedStyle(htmlElement);
  const rect = htmlElement.getBoundingClientRect();
  return styles.display !== 'none' && styles.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function findStepTarget(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const found = document.querySelector(selector);
    if (found && isElementVisible(found)) {
      return found;
    }
  }
  return null;
}

export function AdminWalkthrough({
  open,
  steps,
  onClose,
  onComplete
}: {
  open: boolean;
  steps: AdminTourStep[];
  onClose: () => void;
  onComplete: () => void;
}): JSX.Element | null {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const currentStep = steps[currentStepIndex] ?? null;
  const isLastStep = currentStepIndex >= steps.length - 1;
  const stepSignature = useMemo(() => steps.map((step) => step.id).join('|'), [steps]);

  const remeasure = useCallback(() => {
    if (!open || !currentStep) {
      return;
    }

    const target = findStepTarget(currentStep.selectors);
    if (!target) {
      setTargetRect(null);
      return;
    }

    const rect = target.getBoundingClientRect();
    setTargetRect({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height
    });
  }, [currentStep, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const refreshViewport = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    refreshViewport();
    remeasure();

    const handleResize = () => {
      refreshViewport();
      remeasure();
    };
    const handleScroll = () => remeasure();

    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, remeasure]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      setCurrentStepIndex(0);
      return;
    }
    const frame = window.requestAnimationFrame(() => remeasure());
    return () => window.cancelAnimationFrame(frame);
  }, [currentStepIndex, open, remeasure, stepSignature]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setCurrentStepIndex(0);
  }, [open, stepSignature]);

  const paddedRect = useMemo(() => {
    if (!targetRect) {
      return null;
    }

    return {
      top: Math.max(8, targetRect.top - OVERLAY_PADDING),
      left: Math.max(8, targetRect.left - OVERLAY_PADDING),
      width: Math.max(24, targetRect.width + OVERLAY_PADDING * 2),
      height: Math.max(24, targetRect.height + OVERLAY_PADDING * 2)
    };
  }, [targetRect]);

  const tooltipPosition = useMemo(() => {
    if (!open) {
      return null;
    }

    const viewportWidth = viewport.width || 1280;
    const viewportHeight = viewport.height || 720;

    if (!paddedRect) {
      return {
        top: viewportHeight / 2 - 100,
        left: viewportWidth / 2 - TOOLTIP_WIDTH / 2
      };
    }

    const centeredLeft = clamp(
      paddedRect.left + paddedRect.width / 2 - TOOLTIP_WIDTH / 2,
      12,
      Math.max(12, viewportWidth - TOOLTIP_WIDTH - 12)
    );

    const placement = currentStep?.placement ?? 'auto';
    const canPlaceBelow = paddedRect.top + paddedRect.height + TOOLTIP_GAP + TOOLTIP_ESTIMATED_HEIGHT <= viewportHeight - 12;
    const canPlaceAbove = paddedRect.top - TOOLTIP_GAP - TOOLTIP_ESTIMATED_HEIGHT >= 12;

    if ((placement === 'bottom' && canPlaceBelow) || (placement === 'auto' && canPlaceBelow)) {
      return {
        top: paddedRect.top + paddedRect.height + TOOLTIP_GAP,
        left: centeredLeft
      };
    }

    if ((placement === 'top' && canPlaceAbove) || (placement === 'auto' && canPlaceAbove)) {
      return {
        top: Math.max(12, paddedRect.top - TOOLTIP_ESTIMATED_HEIGHT - TOOLTIP_GAP),
        left: centeredLeft
      };
    }

    // Fallback for explicit placement that doesn't fit in viewport.
    if (canPlaceAbove) {
      return {
        top: Math.max(12, paddedRect.top - TOOLTIP_ESTIMATED_HEIGHT - TOOLTIP_GAP),
        left: centeredLeft
      };
    }
    if (canPlaceBelow) {
      return {
        top: paddedRect.top + paddedRect.height + TOOLTIP_GAP,
        left: centeredLeft
      };
    }

    return {
      top: clamp(viewportHeight / 2 - TOOLTIP_ESTIMATED_HEIGHT / 2, 12, viewportHeight - TOOLTIP_ESTIMATED_HEIGHT - 12),
      left: centeredLeft
    };
  }, [currentStep?.placement, open, paddedRect, viewport.height, viewport.width]);

  if (!open || !currentStep || !tooltipPosition) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[90]">
      {paddedRect ? (
        <>
          <div className="pointer-events-none fixed left-0 top-0 bg-slate-950/72 transition-all duration-300" style={{ width: '100%', height: paddedRect.top }} />
          <div className="pointer-events-none fixed left-0 bg-slate-950/72 transition-all duration-300" style={{ top: paddedRect.top, width: paddedRect.left, height: paddedRect.height }} />
          <div
            className="pointer-events-none fixed bg-slate-950/72 transition-all duration-300"
            style={{
              top: paddedRect.top,
              left: paddedRect.left + paddedRect.width,
              right: 0,
              height: paddedRect.height
            }}
          />
          <div
            className="pointer-events-none fixed left-0 bg-slate-950/72 transition-all duration-300"
            style={{
              top: paddedRect.top + paddedRect.height,
              width: '100%',
              bottom: 0
            }}
          />

          <div
            className="pointer-events-none fixed rounded-2xl border-2 border-amber-300/95 shadow-[0_0_0_2px_rgba(251,191,36,0.4),0_0_24px_rgba(251,191,36,0.45)] transition-all duration-300"
            style={{
              top: paddedRect.top,
              left: paddedRect.left,
              width: paddedRect.width,
              height: paddedRect.height
            }}
          />
        </>
      ) : (
        <div className="pointer-events-none fixed inset-0 bg-slate-950/72" />
      )}

      <div
        className="pointer-events-auto fixed z-[91] w-[min(92vw,360px)] rounded-2xl border border-amber-400/60 bg-white p-4 text-slate-900 shadow-2xl shadow-black/60"
        style={{
          top: tooltipPosition.top,
          left: tooltipPosition.left
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
            Step {currentStepIndex + 1} of {steps.length}
          </p>
          <button
            className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100"
            onClick={onClose}
            type="button"
          >
            Skip
          </button>
        </div>

        <h3 className="text-base font-semibold leading-snug text-slate-900">{currentStep.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">{currentStep.description}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={currentStepIndex === 0}
            onClick={() => setCurrentStepIndex((index) => Math.max(0, index - 1))}
            type="button"
          >
            Back
          </button>
          <button
            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-slate-700"
            onClick={() => {
              if (isLastStep) {
                onComplete();
                return;
              }
              setCurrentStepIndex((index) => Math.min(steps.length - 1, index + 1));
            }}
            type="button"
          >
            {isLastStep ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
