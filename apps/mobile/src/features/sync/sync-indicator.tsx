import React from 'react';
import { Text, View } from 'react-native';

export function SyncIndicator({ online, pendingCount }: { online: boolean; pendingCount: number }): JSX.Element {
  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: online ? '#0f766e' : '#f59e0b',
        backgroundColor: online ? '#042f2e' : '#422006',
        padding: 12
      }}
    >
      <Text style={{ color: '#f8fafc', fontWeight: '600' }}>{online ? 'Online' : 'Offline'}</Text>
      <Text style={{ color: '#cbd5e1', marginTop: 4 }}>{pendingCount} pending sync item(s)</Text>
    </View>
  );
}
