import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Toast, { type ToastConfig, type ToastShowParams } from 'react-native-toast-message';

type GoeyToastKind = 'goeySuccess' | 'goeyError' | 'goeyInfo';

function GoeyToastCard(props: {
  kind: GoeyToastKind;
  title?: string;
  message?: string;
}): JSX.Element {
  const palette =
    props.kind === 'goeySuccess'
      ? { bg: '#0E3A2D', border: '#2CB67D', title: '#D7FFF0' }
      : props.kind === 'goeyError'
        ? { bg: '#3A1320', border: '#FF6B81', title: '#FFE0E8' }
        : { bg: '#102E44', border: '#67A8FF', title: '#E5F3FF' };

  return (
    <View style={[styles.shell, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.title, { color: palette.title }]}>{props.title ?? 'Notice'}</Text>
      {props.message ? <Text style={styles.message}>{props.message}</Text> : null}
    </View>
  );
}

export const goeyToastConfig: ToastConfig = {
  goeySuccess: ({ text1, text2 }) => <GoeyToastCard kind="goeySuccess" title={text1} message={text2} />,
  goeyError: ({ text1, text2 }) => <GoeyToastCard kind="goeyError" title={text1} message={text2} />,
  goeyInfo: ({ text1, text2 }) => <GoeyToastCard kind="goeyInfo" title={text1} message={text2} />
};

let topOffset = 54;

export function setToastTopOffset(nextTopOffset: number): void {
  const normalized = Number.isFinite(nextTopOffset) ? Math.round(nextTopOffset) : 54;
  topOffset = Math.max(16, normalized);
}

function show(type: GoeyToastKind, title: string, message?: string): void {
  const payload: ToastShowParams = {
    type,
    text1: title,
    text2: message,
    position: 'top',
    visibilityTime: 2500,
    autoHide: true,
    topOffset
  };
  Toast.show(payload);
}

export function toastSuccess(title: string, message?: string): void {
  show('goeySuccess', title, message);
}

export function toastError(title: string, message?: string): void {
  show('goeyError', title, message);
}

export function toastInfo(title: string, message?: string): void {
  show('goeyInfo', title, message);
}

const styles = StyleSheet.create({
  shell: {
    width: '92%',
    maxWidth: 520,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8
  },
  title: {
    fontSize: 14,
    fontWeight: '700'
  },
  message: {
    marginTop: 4,
    color: '#D0D7E2',
    fontSize: 12
  }
});
