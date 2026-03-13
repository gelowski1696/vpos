import React, { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AppTheme } from '../theme';

type Props = {
  children: React.ReactNode;
  onDelete: () => void;
  theme: AppTheme;
  disabled?: boolean;
  deleteLabel?: string;
};

const ACTION_WIDTH = 92;
const DRAG_LIMIT = 132;
const OPEN_THRESHOLD = 52;

export function SwipeToDeleteRow({
  children,
  onDelete,
  theme,
  disabled = false,
  deleteLabel = 'Delete'
}: Props): JSX.Element {
  const translateX = useRef(new Animated.Value(0)).current;
  const [open, setOpen] = useState(false);
  const actionOpacity = translateX.interpolate({
    inputRange: [-ACTION_WIDTH, -16, 0],
    outputRange: [1, 0.25, 0],
    extrapolate: 'clamp'
  });

  const animateTo = (toValue: number, nextOpen: boolean): void => {
    Animated.spring(translateX, {
      toValue,
      friction: 9,
      tension: 120,
      useNativeDriver: true
    }).start();
    setOpen(nextOpen);
  };

  const close = (): void => {
    animateTo(0, false);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) => {
          if (disabled) {
            return false;
          }
          return Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy);
        },
        onPanResponderMove: (_, gesture) => {
          const base = open ? -ACTION_WIDTH : 0;
          const next = Math.max(-DRAG_LIMIT, Math.min(0, base + gesture.dx));
          translateX.setValue(next);
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx < -OPEN_THRESHOLD || (open && gesture.dx < 20)) {
            animateTo(-ACTION_WIDTH, true);
            return;
          }
          close();
        },
        onPanResponderTerminate: () => {
          close();
        }
      }),
    [disabled, open, translateX]
  );

  return (
    <View style={styles.container}>
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[
          styles.actions,
          {
            backgroundColor: theme.dangerMuted,
            opacity: actionOpacity
          }
        ]}
      >
        <Pressable
          style={[styles.deleteButton, { backgroundColor: theme.danger }]}
          onPress={() => {
            onDelete();
            close();
          }}
          disabled={disabled}
        >
          <Text style={styles.deleteText}>{deleteLabel}</Text>
        </Pressable>
      </Animated.View>
      <Animated.View style={[styles.foreground, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12
  },
  foreground: {
    width: '100%'
  },
  actions: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center'
  },
  deleteButton: {
    width: ACTION_WIDTH - 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10
  },
  deleteText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800'
  }
});
