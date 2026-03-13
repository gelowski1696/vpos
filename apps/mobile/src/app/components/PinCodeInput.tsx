import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  InteractionManager,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  Vibration,
  View,
} from "react-native";
import type { AppTheme } from "../theme";

type PinCodeInputProps = {
  value: string;
  onChange: (next: string) => void;
  editable: boolean;
  theme: AppTheme;
  autoFocus?: boolean;
  length?: number;
};

function sanitizePin(value: string, length: number): string {
  return value.replace(/\D/g, "").slice(0, length);
}

function triggerLightHaptic(): void {
  try {
    Vibration.vibrate(10);
  } catch {
    // no-op when vibration is unavailable
  }
}

export function PinCodeInput({
  value,
  onChange,
  editable,
  theme,
  autoFocus = false,
  length = 4,
}: PinCodeInputProps): JSX.Element {
  const inputRef = useRef<TextInput | null>(null);
  const [focused, setFocused] = useState(false);
  const boxScalesRef = useRef<Animated.Value[]>(
    Array.from({ length }, () => new Animated.Value(1)),
  );
  const prevLengthRef = useRef(0);
  const revealUntilRef = useRef<Record<number, number>>({});
  const revealTimeoutsRef = useRef<Record<number, ReturnType<typeof setTimeout>>>(
    {},
  );
  const [, setRevealTick] = useState(0);
  const pin = useMemo(() => sanitizePin(value, length), [value, length]);

  const focusInput = (): void => {
    if (!editable) {
      return;
    }
    inputRef.current?.focus();
  };

  const focusInputWithRetry = (): void => {
    if (!editable) {
      return;
    }
    focusInput();
    const attempts = [80, 180];
    for (const delay of attempts) {
      setTimeout(() => {
        if (!editable) {
          return;
        }
        focusInput();
      }, delay);
    }
  };

  const handleChangeText = (text: string): void => {
    onChange(sanitizePin(text, length));
  };

  useEffect(() => {
    if (boxScalesRef.current.length !== length) {
      boxScalesRef.current = Array.from(
        { length },
        () => new Animated.Value(1),
      );
    }
  }, [length]);

  useEffect(() => {
    if (!autoFocus || !editable) {
      return;
    }
    let mounted = true;
    const attempts = [30, 150, 320];
    const handles = attempts.map((delay) =>
      setTimeout(() => {
        if (!mounted) {
          return;
        }
        InteractionManager.runAfterInteractions(() => {
          if (!mounted) {
            return;
          }
          focusInputWithRetry();
        });
      }, delay),
    );
    return () => {
      mounted = false;
      for (const handle of handles) {
        clearTimeout(handle);
      }
    };
  }, [autoFocus, editable]);

  useEffect(() => {
    return () => {
      const timeouts = Object.values(revealTimeoutsRef.current);
      for (const timeout of timeouts) {
        clearTimeout(timeout);
      }
      revealTimeoutsRef.current = {};
    };
  }, []);

  useEffect(() => {
    const prevLen = prevLengthRef.current;
    const nextLen = pin.length;
    if (nextLen > prevLen) {
      const idx = Math.min(nextLen - 1, boxScalesRef.current.length - 1);
      const target = boxScalesRef.current[idx];
      if (target) {
        target.setValue(0.92);
        Animated.sequence([
          Animated.timing(target, {
            toValue: 1.08,
            duration: 110,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(target, {
            toValue: 1,
            duration: 110,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start();
      }
      triggerLightHaptic();
      const revealIndex = Math.min(nextLen - 1, length - 1);
      const now = Date.now();
      revealUntilRef.current[revealIndex] = now + 500;
      const existing = revealTimeoutsRef.current[revealIndex];
      if (existing) {
        clearTimeout(existing);
      }
      revealTimeoutsRef.current[revealIndex] = setTimeout(() => {
        delete revealUntilRef.current[revealIndex];
        delete revealTimeoutsRef.current[revealIndex];
        setRevealTick((tick) => tick + 1);
      }, 520);
      setRevealTick((tick) => tick + 1);
    }
    prevLengthRef.current = nextLen;
  }, [pin, length]);

  return (
    <Pressable
      onPress={focusInputWithRetry}
      style={styles.wrap}
      accessibilityRole="button"
      accessibilityLabel="PIN input"
    >
      <TextInput
        ref={inputRef}
        value={pin}
        onChangeText={handleChangeText}
        editable={editable}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        showSoftInputOnFocus
        contextMenuHidden
        caretHidden
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selection={{ start: pin.length, end: pin.length }}
        style={styles.hiddenInput}
      />
      <View style={styles.row}>
        {Array.from({ length }, (_, index) => {
          const isFilled = index < pin.length;
          const isActive =
            focused &&
            (index === pin.length || (pin.length === length && index === length - 1));
          const revealUntil = revealUntilRef.current[index] ?? 0;
          const showPlain = isFilled && Date.now() <= revealUntil;
          const char = pin[index] ?? "";
          return (
            <Animated.View
              key={`pin-box-${index}`}
              style={[
                styles.box,
                { transform: [{ scale: boxScalesRef.current[index] ?? 1 }] },
                {
                  backgroundColor: theme.inputBg,
                  borderColor: isActive ? theme.primary : theme.cardBorder,
                },
              ]}
            >
              <Text style={[styles.boxText, { color: theme.inputText }]}>
                {isFilled ? (showPlain ? char : "\u2022") : ""}
              </Text>
            </Animated.View>
          );
        })}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
  },
  hiddenInput: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    opacity: 0.015,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  box: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  boxText: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 2,
  },
});
