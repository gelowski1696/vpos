import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  status: string;
};

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase();
}

function palette(status: string): { bg: string; text: string } {
  const normalized = normalizeStatus(status);
  if (normalized === 'synced') {
    return { bg: '#DCFCE7', text: '#166534' };
  }
  if (normalized === 'failed') {
    return { bg: '#FEE2E2', text: '#991B1B' };
  }
  if (normalized === 'needs_review') {
    return { bg: '#FEF3C7', text: '#92400E' };
  }
  if (normalized === 'processing') {
    return { bg: '#DBEAFE', text: '#1D4ED8' };
  }
  return { bg: '#FDE68A', text: '#92400E' };
}

export function SyncStatusBadge({ status }: Props): JSX.Element {
  const colors = palette(status);
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.text, { color: colors.text }]}>{normalizeStatus(status).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  text: {
    fontSize: 10,
    fontWeight: '800'
  }
});
