import React, { useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { AppTheme } from '../theme';
import { useTutorialActions, useTutorialState } from './tutorial-provider';
import type { TutorialScope } from './tutorial-types';

type Props = {
  theme: AppTheme;
  onCompleteScope?: (scope: TutorialScope) => void;
  onPauseScope?: (scope: TutorialScope) => void;
  onSkipScope?: (scope: TutorialScope) => void;
};

export function TutorialOverlayHost(props: Props): JSX.Element | null {
  const tutorial = useTutorialState();
  const actions = useTutorialActions();
  const [overlayHeight, setOverlayHeight] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);
  const top = useSharedValue(0);
  const left = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);

  useEffect(() => {
    if (!tutorial.scope || !tutorial.activeTargetKey) {
      return;
    }
    actions.measureTarget(tutorial.activeTargetKey);
  }, [tutorial.scope, tutorial.activeTargetKey, actions]);

  useEffect(() => {
    if (!tutorial.scope || !tutorial.activeTargetRect) {
      return;
    }
    const rect = tutorial.activeTargetRect;
    top.value = withTiming(Math.max(rect.y - 8, 0), {
      duration: 230,
      easing: Easing.out(Easing.cubic),
    });
    left.value = withTiming(Math.max(rect.x - 8, 0), {
      duration: 230,
      easing: Easing.out(Easing.cubic),
    });
    width.value = withTiming(Math.max(rect.width + 16, 1), {
      duration: 230,
      easing: Easing.out(Easing.cubic),
    });
    height.value = withTiming(Math.max(rect.height + 16, 1), {
      duration: 230,
      easing: Easing.out(Easing.cubic),
    });
  }, [tutorial.scope, tutorial.activeTargetRect, top, left, width, height]);

  const spotlightStyle = useAnimatedStyle(() => ({
    top: top.value,
    left: left.value,
    width: width.value,
    height: height.value,
  }));
  const topMaskStyle = useAnimatedStyle(() => ({
    height: top.value,
  }));
  const leftMaskStyle = useAnimatedStyle(() => ({
    top: top.value,
    width: left.value,
    height: height.value,
  }));
  const rightMaskStyle = useAnimatedStyle(() => ({
    top: top.value,
    left: left.value + width.value,
    height: height.value,
  }));
  const bottomMaskStyle = useAnimatedStyle(() => ({
    top: top.value + height.value,
  }));

  const cardPlacement = useMemo(() => {
    const SCREEN_FALLBACK_HEIGHT = 760;
    const TOP_INSET = 14;
    const BOTTOM_INSET = 14;
    const TARGET_GAP = 12;
    const MIN_CARD_HEIGHT = 180;
    const DEFAULT_CARD_HEIGHT = 228;

    const containerHeight = overlayHeight > 0 ? overlayHeight : SCREEN_FALLBACK_HEIGHT;
    const estimatedCardHeight = cardHeight > 0 ? cardHeight : DEFAULT_CARD_HEIGHT;
    const boundedCardHeight = Math.min(
      Math.max(estimatedCardHeight, MIN_CARD_HEIGHT),
      Math.max(containerHeight - TOP_INSET - BOTTOM_INSET, MIN_CARD_HEIGHT),
    );

    if (!tutorial.activeTargetRect) {
      return {
        top: undefined as number | undefined,
        bottom: 94 as number | undefined,
        maxHeight: Math.max(containerHeight - 108, MIN_CARD_HEIGHT),
      };
    }

    const targetTop = Math.max(tutorial.activeTargetRect.y - 8, TOP_INSET);
    const targetBottom = Math.min(
      tutorial.activeTargetRect.y + tutorial.activeTargetRect.height + 8,
      containerHeight - BOTTOM_INSET,
    );
    const roomAbove = Math.max(targetTop - TOP_INSET - TARGET_GAP, 0);
    const roomBelow = Math.max(containerHeight - BOTTOM_INSET - targetBottom - TARGET_GAP, 0);

    const shouldPlaceAbove =
      roomBelow < boundedCardHeight && roomAbove > roomBelow;

    if (shouldPlaceAbove) {
      const top = Math.max(TOP_INSET, targetTop - TARGET_GAP - boundedCardHeight);
      return {
        top,
        bottom: undefined as number | undefined,
        maxHeight: Math.max(roomAbove, MIN_CARD_HEIGHT),
      };
    }

    const maxBelowHeight = Math.max(roomBelow, MIN_CARD_HEIGHT);
    const top = Math.min(
      targetBottom + TARGET_GAP,
      containerHeight - BOTTOM_INSET - Math.min(maxBelowHeight, boundedCardHeight),
    );

    return {
      top: Math.max(top, TOP_INSET),
      bottom: undefined as number | undefined,
      maxHeight: maxBelowHeight,
    };
  }, [overlayHeight, cardHeight, tutorial.activeTargetRect]);

  if (!tutorial.scope) {
    return null;
  }

  const progress = tutorial.totalSteps
    ? `${tutorial.stepIndex + 1}/${tutorial.totalSteps}`
    : '0/0';

  const onNext = (): void => {
    const isDone = actions.next();
    if (isDone) {
      props.onCompleteScope?.(tutorial.scope!);
    }
  };

  const onPause = (): void => {
    actions.pause();
    props.onPauseScope?.(tutorial.scope!);
  };

  const onSkip = (): void => {
    props.onSkipScope?.(tutorial.scope!);
  };

  const handleOverlayLayout = (event: LayoutChangeEvent): void => {
    const nextHeight = event.nativeEvent.layout.height;
    if (nextHeight > 0 && Math.abs(nextHeight - overlayHeight) > 0.5) {
      setOverlayHeight(nextHeight);
    }
  };

  const handleCardLayout = (event: LayoutChangeEvent): void => {
    const nextHeight = event.nativeEvent.layout.height;
    if (nextHeight > 0 && Math.abs(nextHeight - cardHeight) > 0.5) {
      setCardHeight(nextHeight);
    }
  };

  return (
    <View style={styles.overlay} pointerEvents='box-none' onLayout={handleOverlayLayout}>
      <View style={styles.maskLayer} pointerEvents='none'>
        {tutorial.activeTargetRect ? (
          <>
            <Animated.View style={[styles.maskBlock, styles.maskTop, topMaskStyle]} />
            <Animated.View style={[styles.maskBlock, styles.maskLeft, leftMaskStyle]} />
            <Animated.View style={[styles.maskBlock, styles.maskRight, rightMaskStyle]} />
            <Animated.View style={[styles.maskBlock, styles.maskBottom, bottomMaskStyle]} />
            <Animated.View style={[styles.spotlight, spotlightStyle]} />
          </>
        ) : (
          <View style={[styles.maskBlock, StyleSheet.absoluteFillObject]} />
        )}
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: props.theme.card,
            borderColor: props.theme.cardBorder,
            top: cardPlacement.top,
            bottom: cardPlacement.bottom,
            maxHeight: cardPlacement.maxHeight,
          },
        ]}
        onLayout={handleCardLayout}
      >
        <View style={styles.headerRow}>
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: props.theme.pillBg, borderColor: props.theme.cardBorder },
            ]}
          >
            <Text style={[styles.iconText, { color: props.theme.pillText }]}>
              {tutorial.activeStep?.icon ?? '\u2139'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: props.theme.heading }]}>
              {tutorial.definition?.title ?? 'Tutorial'}
            </Text>
            <Text style={[styles.sub, { color: props.theme.subtext }]}>Step {progress}</Text>
          </View>
        </View>

        <View
          style={[
            styles.targetPill,
            { backgroundColor: props.theme.inputBg, borderColor: props.theme.cardBorder },
          ]}
        >
          <Text style={[styles.targetText, { color: props.theme.pillText }]}>
            Focus: {tutorial.activeStep?.target ?? 'General'}
          </Text>
        </View>

        <Text style={[styles.desc, { color: props.theme.subtext }]}>
          {tutorial.activeStep?.description ?? 'Follow the guide to continue.'}
        </Text>

        <View style={styles.actions}>
          <Pressable
            onPress={onPause}
            style={[
              styles.ghostBtn,
              {
                borderColor: props.theme.cardBorder,
                backgroundColor: props.theme.pillBg,
              },
            ]}
          >
            <Text style={[styles.ghostText, { color: props.theme.pillText }]}>
              Later
            </Text>
          </Pressable>
          <Pressable
            onPress={onSkip}
            style={[
              styles.ghostBtn,
              {
                borderColor: props.theme.cardBorder,
                backgroundColor: props.theme.pillBg,
              },
            ]}
          >
            <Text style={[styles.ghostText, { color: props.theme.pillText }]}>Skip</Text>
          </Pressable>
          <Pressable
            disabled={tutorial.stepIndex === 0}
            onPress={actions.back}
            style={[
              styles.ghostBtn,
              {
                borderColor: props.theme.cardBorder,
                backgroundColor:
                  tutorial.stepIndex === 0 ? props.theme.inputBg : props.theme.pillBg,
              },
            ]}
          >
            <Text
              style={[
                styles.ghostText,
                {
                  color:
                    tutorial.stepIndex === 0
                      ? props.theme.subtext
                      : props.theme.pillText,
                },
              ]}
            >
              Back
            </Text>
          </Pressable>
          <Pressable
            onPress={onNext}
            style={[styles.primaryBtn, { backgroundColor: props.theme.primary }]}
          >
            <Text style={styles.primaryText}>
              {tutorial.stepIndex >= tutorial.totalSteps - 1
                ? tutorial.definition?.doneLabel ?? 'Done'
                : 'Next'}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 140,
    elevation: 140,
  },
  maskLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  maskBlock: {
    position: 'absolute',
    backgroundColor: 'rgba(4, 12, 24, 0.56)',
    left: 0,
    right: 0,
    bottom: 0,
  },
  maskTop: {
    top: 0,
    bottom: undefined,
  },
  maskLeft: {
    left: 0,
    right: undefined,
    bottom: undefined,
  },
  maskRight: {
    right: 0,
    bottom: undefined,
  },
  maskBottom: {
    left: 0,
    right: 0,
    bottom: 0,
  },
  spotlight: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#F59E0B',
    borderRadius: 12,
    backgroundColor: 'transparent',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  card: {
    position: 'absolute',
    left: 14,
    right: 14,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 16,
    fontWeight: '800',
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
  },
  sub: {
    fontSize: 11,
    marginTop: 1,
  },
  targetPill: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  targetText: {
    fontSize: 12,
    fontWeight: '700',
  },
  desc: {
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  ghostBtn: {
    minWidth: 74,
    flexGrow: 1,
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  ghostText: {
    fontSize: 12,
    fontWeight: '700',
  },
  primaryBtn: {
    minWidth: 110,
    flexGrow: 1.2,
    minHeight: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
});
