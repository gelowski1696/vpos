import { useEffect, useMemo, useState } from 'react';
import { useDesktopTutorialActions, useDesktopTutorialState } from './tutorial-provider';
import type { DesktopTutorialScope } from './tutorial-types';

type Props = {
  onCompleteScope?: (scope: DesktopTutorialScope) => void | Promise<void>;
  onPauseScope?: (scope: DesktopTutorialScope) => void | Promise<void>;
  onSkipScope?: (scope: DesktopTutorialScope) => void | Promise<void>;
};

export function DesktopTutorialOverlayHost(props: Props): JSX.Element | null {
  const tutorial = useDesktopTutorialState();
  const actions = useDesktopTutorialActions();
  const [overlayHeight, setOverlayHeight] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);

  useEffect(() => {
    if (!tutorial.scope || !tutorial.activeTargetKey) {
      return;
    }
    actions.measureTarget(tutorial.activeTargetKey);
  }, [actions, tutorial.activeTargetKey, tutorial.scope]);

  const cardPlacement = useMemo(() => {
    const screenHeight = overlayHeight > 0 ? overlayHeight : window.innerHeight || 760;
    const topInset = 14;
    const bottomInset = 20;
    const targetGap = 12;
    const minCardHeight = 210;
    const defaultCardHeight = 250;
    const estimatedCardHeight = cardHeight > 0 ? cardHeight : defaultCardHeight;
    const boundedCardHeight = Math.min(
      Math.max(estimatedCardHeight, minCardHeight),
      Math.max(screenHeight - topInset - bottomInset, minCardHeight)
    );

    if (!tutorial.activeTargetRect) {
      return {
        top: undefined as number | undefined,
        bottom: 96 as number | undefined,
        maxHeight: Math.max(screenHeight - 120, minCardHeight)
      };
    }

    const targetTop = Math.max(tutorial.activeTargetRect.y - 8, topInset);
    const targetBottom = Math.min(
      tutorial.activeTargetRect.y + tutorial.activeTargetRect.height + 8,
      screenHeight - bottomInset
    );
    const roomAbove = Math.max(targetTop - topInset - targetGap, 0);
    const roomBelow = Math.max(screenHeight - bottomInset - targetBottom - targetGap, 0);
    const placeAbove = roomBelow < boundedCardHeight && roomAbove > roomBelow;

    if (placeAbove) {
      const top = Math.max(topInset, targetTop - targetGap - boundedCardHeight);
      return {
        top,
        bottom: undefined as number | undefined,
        maxHeight: Math.max(roomAbove, minCardHeight)
      };
    }

    const maxBelowHeight = Math.max(roomBelow, minCardHeight);
    const top = Math.min(
      targetBottom + targetGap,
      screenHeight - bottomInset - Math.min(maxBelowHeight, boundedCardHeight)
    );
    return {
      top: Math.max(top, topInset),
      bottom: undefined as number | undefined,
      maxHeight: maxBelowHeight
    };
  }, [cardHeight, overlayHeight, tutorial.activeTargetRect]);

  if (!tutorial.scope) {
    return null;
  }

  const progress = tutorial.totalSteps ? `${tutorial.stepIndex + 1}/${tutorial.totalSteps}` : '0/0';
  const rect = tutorial.activeTargetRect;

  const onNext = (): void => {
    const finished = actions.next();
    if (finished) {
      void props.onCompleteScope?.(tutorial.scope!);
    }
  };

  const onPause = (): void => {
    actions.pause();
    void props.onPauseScope?.(tutorial.scope!);
  };

  const onSkip = (): void => {
    actions.close();
    void props.onSkipScope?.(tutorial.scope!);
  };

  return (
    <div
      className="desktop-tutorial-overlay"
      onClick={(event) => event.stopPropagation()}
      ref={(node) => {
        if (node) {
          const nextHeight = node.getBoundingClientRect().height;
          if (nextHeight > 0 && Math.abs(nextHeight - overlayHeight) > 0.5) {
            setOverlayHeight(nextHeight);
          }
        }
      }}
    >
      <div className="desktop-tutorial-mask-layer" aria-hidden="true">
        {rect ? (
          <>
            <div className="desktop-tutorial-mask desktop-tutorial-mask-top" style={{ height: Math.max(rect.y - 8, 0) }} />
            <div
              className="desktop-tutorial-mask desktop-tutorial-mask-left"
              style={{
                top: Math.max(rect.y - 8, 0),
                width: Math.max(rect.x - 8, 0),
                height: rect.height + 16
              }}
            />
            <div
              className="desktop-tutorial-mask desktop-tutorial-mask-right"
              style={{
                top: Math.max(rect.y - 8, 0),
                left: rect.x + rect.width + 8,
                height: rect.height + 16
              }}
            />
            <div className="desktop-tutorial-mask desktop-tutorial-mask-bottom" style={{ top: rect.y + rect.height + 8 }} />
            <div
              className="desktop-tutorial-spotlight"
              style={{
                top: Math.max(rect.y - 8, 0),
                left: Math.max(rect.x - 8, 0),
                width: rect.width + 16,
                height: rect.height + 16
              }}
            />
          </>
        ) : (
          <div className="desktop-tutorial-mask desktop-tutorial-mask-full" />
        )}
      </div>

      <div
        className="desktop-tutorial-card"
        style={{
          top: cardPlacement.top,
          bottom: cardPlacement.bottom,
          maxHeight: cardPlacement.maxHeight
        }}
        ref={(node) => {
          if (node) {
            const nextHeight = node.getBoundingClientRect().height;
            if (nextHeight > 0 && Math.abs(nextHeight - cardHeight) > 0.5) {
              setCardHeight(nextHeight);
            }
          }
        }}
      >
        <div className="desktop-tutorial-header">
          <div className="desktop-tutorial-icon">{tutorial.activeStep?.icon ?? '\u2139'}</div>
          <div className="desktop-tutorial-copy">
            <div className="desktop-tutorial-title">{tutorial.definition?.title ?? 'Walkthrough'}</div>
            <div className="desktop-tutorial-step">{tutorial.activeStep?.title ?? 'Step'} · {progress}</div>
          </div>
        </div>

        <div className="desktop-tutorial-target-pill">Focus: {tutorial.activeStep?.target ?? 'General guide'}</div>
        <p className="desktop-tutorial-description">
          {tutorial.activeStep?.description ?? 'Follow the guide to continue.'}
        </p>

        <div className="desktop-tutorial-actions">
          <button className="secondary-btn mini-btn" type="button" onClick={onPause}>
            Later
          </button>
          <button className="secondary-btn mini-btn" type="button" onClick={onSkip}>
            Skip
          </button>
          <button className="secondary-btn mini-btn" type="button" onClick={actions.back} disabled={tutorial.stepIndex === 0}>
            Back
          </button>
          <button className="primary-btn mini-btn" type="button" onClick={onNext}>
            {tutorial.stepIndex >= tutorial.totalSteps - 1
              ? tutorial.definition?.doneLabel ?? 'Done'
              : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
