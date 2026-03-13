import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { useTutorialTarget } from './tutorial-provider';
import type { TutorialTargetKey } from './tutorial-types';

type Props = {
  targetKey: TutorialTargetKey;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  activeStyle?: StyleProp<ViewStyle>;
};

export function TutorialTarget(props: Props): JSX.Element {
  const target = useTutorialTarget(props.targetKey);
  return (
    <View
      ref={target.ref}
      onLayout={target.onLayout}
      style={[props.style, target.active ? props.activeStyle : null]}
    >
      {props.children}
    </View>
  );
}
